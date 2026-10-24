"""Medicine store (patient side): product list, place an order, pay online (Razorpay) or by UPI QR,
own orders, cancel."""
import json
import re
from datetime import timedelta

from flask import Blueprint, request

from .. import config, payments
from ..db import db, next_id, now, out
from ..mail import retry_failed_emails
from ..orders import (cancel_order, expire_unpaid_orders, notify_order_status, order_flow, pay_seconds_left, upi_enabled,
                      upi_link)
from ..utils import arg, background, fail, ok, post, require_user, to_int, today_ist

bp = Blueprint("store", __name__)

DELIVERY_FEE = 40          # home delivery charge in rupees
FREE_DELIVERY_ABOVE = 500  # no delivery charge from this subtotal
MAX_QTY_PER_ITEM = 20


def pay_info(o):
    """What the browser needs to show the payment screen for an unpaid order; None otherwise."""
    if o["status"] != "Placed" or o.get("payment_status") != "Pending":
        return None
    if o["payment_method"] == "Online" and payments.enabled():
        return {"online": True, "seconds_left": pay_seconds_left(o)}
    if o["payment_method"] != "UPI" or not upi_enabled():
        return None
    return {"upi_link": upi_link(o), "upi_id": config.UPI_ID, "payee": config.UPI_PAYEE_NAME, "seconds_left": pay_seconds_left(o)}


@bp.route("/api/store", methods=["GET", "POST"])
def store_api():
    action = arg("action")
    # unpaid UPI orders that ran out of time give their medicines back before anything is listed or ordered
    expire_unpaid_orders()

    if action == "products":
        # expired medicines and ones without a price are never sold
        today = today_ist()
        rows = db.medicines.find({"for_sale": 1, "price": {"$gt": 0},
                                  "$or": [{"expiry_date": None}, {"expiry_date": {"$gte": today}}]})
        products = [{"id": m["_id"], "name": m["name"], "unit": m.get("unit"), "price": m["price"], "category": m.get("category"),
                     "description": m.get("description"), "image": m.get("image"), "available": min(m.get("stock", 0), MAX_QTY_PER_ITEM)}
                    for m in rows]
        products.sort(key=lambda p: ((p["category"] or "").lower(), p["name"].lower()))
        return ok(products=products, delivery_fee=DELIVERY_FEE, free_delivery_above=FREE_DELIVERY_ABOVE,
                  max_qty=MAX_QTY_PER_ITEM, upi_enabled=upi_enabled() and not payments.enabled(),
                  online_enabled=payments.enabled(), test_mode=payments.test_mode(), upi_pay_minutes=config.UPI_PAY_MINUTES)

    email = require_user()

    if action == "placeOrder":
        name = post("name")
        phone = re.sub(r"\D", "", post("phone"))
        pickup = post("delivery_type") == "Pickup"
        address, city, pincode = post("address"), post("city"), post("pincode")
        online = post("payment") == "Online"
        upi = post("payment") == "UPI"
        if online and not payments.enabled():
            fail("Online payment is not available right now. Please choose cash.")
        if upi and not upi_enabled():
            fail("UPI payment is not available right now. Please choose cash.")
        if len(name) < 2:
            fail("Please enter your full name")
        if not re.match(r"^[6-9]\d{9}$", phone):
            fail("Please enter a valid 10-digit mobile number")
        if not pickup:
            if len(address) < 8:
                fail("Please enter your full delivery address")
            if not city:
                fail("Please enter your city")
            if not re.match(r"^[1-9]\d{5}$", pincode):
                fail("Please enter a valid 6-digit PIN code")

        # cart arrives as [{id, qty}]; the same medicine sent twice is added up
        cart = {}
        try:
            items_in = json.loads(post("items") or "[]")
        except ValueError:
            items_in = []
        for row in items_in if isinstance(items_in, list) else []:
            mid, qty = to_int((row or {}).get("id")), to_int((row or {}).get("qty"))
            if mid > 0 and qty > 0:
                cart[mid] = cart.get(mid, 0) + qty
        if not cart:
            fail("Your cart is empty")

        # prices and stock are read from the database here, never trusted from the browser
        today = today_ist()
        found = {m["_id"]: m for m in db.medicines.find({"_id": {"$in": list(cart)}})}
        items, subtotal = [], 0.0
        for mid, qty in cart.items():
            m = found.get(mid)
            expired = bool(m and m.get("expiry_date") and m["expiry_date"] < today)
            problem = ""
            if not m or not m.get("for_sale") or expired or (m.get("price") or 0) <= 0:
                problem = f"{(m or {}).get('name', 'A medicine in your cart')} is no longer available"
            elif qty > MAX_QTY_PER_ITEM:
                problem = f"You can order at most {MAX_QTY_PER_ITEM} {m['unit']} of {m['name']}"
            elif m.get("stock", 0) < qty:
                problem = (f"Only {m['stock']} {m['unit']} of {m['name']} left in stock" if m.get("stock", 0) > 0
                           else f"{m['name']} is out of stock")
            if problem:
                fail(problem + ". Please update your cart.", 409)
            line = round(float(m["price"]) * qty, 2)
            subtotal += line
            items.append({"medicine_id": mid, "name": m["name"], "unit": m["unit"], "price": float(m["price"]), "qty": qty, "line_total": line})

        # take the stock: each step only succeeds while enough is left, so two people cannot buy the last strip
        taken = []
        for it in items:
            res = db.medicines.update_one({"_id": it["medicine_id"], "stock": {"$gte": it["qty"]}}, {"$inc": {"stock": -it["qty"]}})
            if res.modified_count != 1:
                for t in taken:
                    db.medicines.update_one({"_id": t["medicine_id"]}, {"$inc": {"stock": t["qty"]}})
                fail(f"{it['name']} just ran out of stock. Please update your cart.", 409)
            taken.append(it)

        subtotal = round(subtotal, 2)
        fee = 0 if (pickup or subtotal >= FREE_DELIVERY_ABOVE) else DELIVERY_FEE
        total = round(subtotal + fee, 2)
        oid = next_id("medicine_orders")
        order_no = f"MED{now().astimezone(config.IST).strftime('%y%m%d')}{oid:04d}"
        order = {"_id": oid, "order_no": order_no, "user_email": email, "customer_name": name[:100], "phone": phone,
                 "delivery_type": "Pickup" if pickup else "Home Delivery",
                 "address": None if pickup else address[:255], "city": None if pickup else city[:60],
                 "pincode": None if pickup else pincode,
                 "payment_method": "Online" if online else ("UPI" if upi else ("Pay at Pickup" if pickup else "Cash on Delivery")),
                 "payment_status": "Pending" if (upi or online) else "COD", "payment_ref": None, "paid_at": None,
                 "notes": post("notes")[:255], "subtotal": subtotal, "delivery_fee": fee, "total": total,
                 "status": "Placed", "cancel_reason": None, "cancelled_by": None, "items": items,
                 "delivery_otp_hash": None, "otp_sent_at": None, "otp_attempts": 0, "created_at": now(), "updated_at": now()}
        db.medicine_orders.insert_one(order)
        if online:
            # the receipt mail (with the order details) goes out once it is paid
            try:
                checkout = payments.start("medicine", order, request.host_url)
            except payments.PaymentError as exc:
                cancel_order(oid, "Online payment could not be started", ["Placed"], "system", True)
                fail(f"{exc} Your order was not placed - please try again or choose cash.", 502)
            return ok(id=oid, order_no=order_no, total=total, email=email, payment_method="Online", checkout=checkout,
                      pay=pay_info(order))
        background(notify_order_status, oid)
        return ok(id=oid, order_no=order_no, total=total, email=email, payment_method=order["payment_method"], pay=pay_info(order))

    if action == "submitPayment":
        # the patient has paid in their UPI app and types the 12-digit UTR; the pharmacy then checks it
        utr = re.sub(r"\D", "", post("utr"))
        if not re.match(r"^\d{12}$", utr):
            fail("Please enter the 12-digit UTR / UPI reference number from your UPI app")
        order = db.medicine_orders.find_one({"_id": to_int(post("id")), "user_email": email})
        if not order or order["payment_method"] != "UPI":
            fail("Order not found", 404)
        if order["status"] == "Cancelled":
            fail(f"This order was cancelled, so it cannot be paid. If money was taken, call {config.HOSPITAL_PHONE}.", 409)
        if order.get("payment_status") not in ("Pending", "Submitted"):
            fail("The payment for this order is already recorded.", 409)
        if db.medicine_orders.find_one({"payment_ref": utr, "_id": {"$ne": order["_id"]}}):
            fail("This UTR has already been used for another order. Please check the number.", 409)
        res = db.medicine_orders.update_one(
            {"_id": order["_id"], "status": "Placed", "payment_status": {"$in": ["Pending", "Submitted"]}},
            {"$set": {"payment_status": "Submitted", "payment_ref": utr, "updated_at": now()}})
        if res.matched_count != 1:
            fail("This order can no longer be paid. Please refresh My Orders.", 409)
        background(notify_order_status, order["_id"], "submitted")
        return ok()

    if action == "myOrders":
        # an online payment the browser did not report back (closed tab) is picked up here
        pending = [o["_id"] for o in db.medicine_orders.find({"user_email": email, "payment_method": "Online", "payment_status": "Pending",
                                                               "status": "Placed"}, {"_id": 1})]
        if pending:
            payments.sync_pending("medicine", {"ref_id": {"$in": pending}})
        orders = []
        for o in db.medicine_orders.find({"user_email": email}, {"delivery_otp_hash": 0}).sort("_id", -1):
            row = out(o)
            row["flow"] = order_flow(o["delivery_type"])
            row["can_cancel"] = o["status"] in ("Placed", "Confirmed")
            row["pay"] = pay_info(o)
            orders.append(row)
        # while the patient looks at their orders, send any order mail that failed earlier
        if db.notifications.find_one({"channel": "email", "status": "failed", "recipient": email, "attempts": {"$lt": 6},
                                      "created_at": {"$gt": now() - timedelta(hours=24)}}):
            background(retry_failed_emails, 5)
        return ok(orders=orders)

    if action == "cancelOrder":
        order = db.medicine_orders.find_one({"_id": to_int(post("id")), "user_email": email}, {"_id": 1})
        if not order:
            fail("Order not found", 404)
        # once it is packed the pharmacy has to be called instead
        if not cancel_order(order["_id"], "Cancelled by patient", ["Placed", "Confirmed"], "patient"):
            fail(f"This order can no longer be cancelled here (it is already packed, finished or cancelled). For help call {config.HOSPITAL_PHONE}.", 409)
        background(notify_order_status, order["_id"])
        return ok()

    fail("Unknown action", 404)
