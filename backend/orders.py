"""Medicine orders: the steps an order moves through, cancelling, unpaid UPI orders running out of
time, the delivery OTP and the status mails."""
import re
import secrets
from datetime import timedelta
from urllib.parse import quote

import bcrypt

from . import config
from .db import db, now
from .mail import notify_patient
from .utils import nice_date

UPI_RE = re.compile(r"^[a-zA-Z0-9._-]{2,}@[a-zA-Z0-9]{2,}$")


def upi_enabled():
    return bool(UPI_RE.match(config.UPI_ID or ""))


def money(v):
    return f"{float(v or 0):.2f}"


def upi_link(order):
    """The link every UPI app understands (it is also what the QR code holds). The amount and the
    order number are fixed in it, so the patient cannot pay the wrong amount by mistake."""
    params = [("pa", config.UPI_ID), ("pn", config.UPI_PAYEE_NAME), ("am", money(order["total"])),
              ("cu", "INR"), ("tn", f"Order {order['order_no']}"), ("tr", order["order_no"])]
    return "upi://pay?" + "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params)


def order_flow(delivery_type):
    """The steps an order moves through, in order. The last one means the patient has the medicines."""
    if delivery_type == "Pickup":
        return ["Placed", "Confirmed", "Packed", "Ready for Pickup", "Collected"]
    return ["Placed", "Confirmed", "Packed", "Out for Delivery", "Delivered"]


def next_status(order):
    flow = order_flow(order.get("delivery_type"))
    if order.get("status") in flow:
        at = flow.index(order["status"])
        if at < len(flow) - 1:
            return flow[at + 1]
    return None


def cancel_order(order_id, reason, from_statuses, by, only_unpaid=False):
    """Cancels an order and puts its medicines back in stock. `from_statuses` limits when it is
    allowed. Money already paid by UPI becomes "Refund Due". Returns False when the order had
    already moved on, so stock is never returned twice."""
    query = {"_id": order_id, "status": {"$in": list(from_statuses)}}
    if only_unpaid:
        query["payment_status"] = "Pending"
    res = db.medicine_orders.update_one(query, [{"$set": {
        "status": "Cancelled", "cancel_reason": (reason or "")[:255], "cancelled_by": by, "updated_at": "$$NOW",
        "payment_status": {"$switch": {"branches": [
            {"case": {"$in": ["$payment_status", ["Submitted", "Paid"]]}, "then": "Refund Due"},
            {"case": {"$eq": ["$payment_status", "Pending"]}, "then": "Not Paid"},
        ], "default": "$payment_status"}},
    }}])
    if res.modified_count != 1:
        return False
    order = db.medicine_orders.find_one({"_id": order_id}, {"items": 1})
    for item in order.get("items", []):
        db.medicines.update_one({"_id": item["medicine_id"]}, {"$inc": {"stock": int(item["qty"])}})
    return True


def expire_unpaid_orders():
    """A UPI order holds its medicines while it waits for payment. If the patient does not pay in
    UPI_PAY_MINUTES the order is cancelled, the stock is released and the patient is told by mail.
    The clock restarts when the pharmacy asks for the payment reference again."""
    late = db.medicine_orders.find({
        "status": "Placed", "payment_method": "UPI", "payment_status": "Pending",
        "updated_at": {"$lt": now() - timedelta(minutes=config.UPI_PAY_MINUTES)}}, {"_id": 1})
    done = 0
    for o in list(late):
        if cancel_order(o["_id"], f"Payment was not completed within {config.UPI_PAY_MINUTES} minutes", ["Placed"], "system", True):
            notify_order_status(o["_id"])
            done += 1
    return done


def issue_delivery_otp(order_id):
    """Makes a new 6-digit OTP for the order (resetting the tries) and returns it for the email.
    Only its hash is stored."""
    otp = str(secrets.randbelow(900000) + 100000)
    db.medicine_orders.update_one({"_id": order_id}, {"$set": {
        "delivery_otp_hash": bcrypt.hashpw(otp.encode(), bcrypt.gensalt()).decode(),
        "otp_sent_at": now(), "otp_attempts": 0}})
    return otp


def order_email(order_id, event="", ref="", otp=""):
    """[to, subject, body] for the order's current status, or for a payment event:
    'otp', 'submitted', 'verified', 'rejected' (with the reference that was not found) or 'refunded'."""
    o = db.medicine_orders.find_one({"_id": order_id})
    if not o:
        return None
    pickup = o["delivery_type"] == "Pickup"
    upi = o["payment_method"] == "UPI"
    paid = o.get("payment_status") == "Paid"
    total = money(o["total"])
    lines = "".join(f"  {i['name']} x {i['qty']} {i['unit']} = Rs. {money(i['line_total'])}\n" for i in o.get("items", []))
    payment = o["payment_method"] if not upi else "UPI - " + {
        "Pending": "NOT PAID YET", "Submitted": f"paid, being verified (UTR {o.get('payment_ref')})",
        "Paid": f"PAID (UTR {o.get('payment_ref')})"}.get(o.get("payment_status"), o.get("payment_status"))
    fee = f"Rs. {money(o['delivery_fee'])}" if float(o.get("delivery_fee") or 0) > 0 else "Free"
    bill = (lines + f"\nSubtotal: Rs. {money(o['subtotal'])}\n" + ("Pickup" if pickup else "Delivery") + f": {fee}"
            + "\n" + ("TOTAL" if paid else "TOTAL TO PAY") + f": Rs. {total}\nPayment: {payment}")
    where = (f"Pickup at the {config.HOSPITAL_NAME} pharmacy counter" if pickup
             else f"Delivery to: {o.get('address')}, {o.get('city')} - {o.get('pincode')}")
    placed_on = nice_date(o["created_at"])
    details = (f"ORDER DETAILS\n-------------\nOrder number: {o['order_no']}\nPlaced on: {placed_on}\n\nMEDICINES\n---------\n{bill}\n\n"
               + ("PICKUP" if pickup else "DELIVERY") + f"\n--------\n{where}\nName: {o['customer_name']}\nMobile: {o['phone']}"
               + (f"\nYour note: {o['notes']}" if o.get("notes") else ""))
    hello = f"Hi {o['customer_name']},\n\n"
    bye = f"\n\n- {config.HOSPITAL_NAME}"
    pay_now = f"Open Medicine Store > My Orders and press \"Pay now\" on order {o['order_no']}"
    otp_box = "" if not otp else (
        f"\n\nDELIVERY OTP: {otp}\nGive this OTP to the delivery person ONLY when the medicines are in your hand. "
        "The order is marked delivered only after the OTP is entered. Never share it before that - not even on a phone call. "
        f"It is valid for {config.DELIVERY_OTP_HOURS} hours.")

    if event:
        mails = {
            "otp": (f"New delivery OTP - {o['order_no']}",
                    f"Here is a NEW delivery OTP for your order {o['order_no']}. The earlier OTP no longer works.{otp_box}"),
            "submitted": (f"Payment reference received - {o['order_no']}",
                          f"Thank you. We have received your UPI payment reference for order {o['order_no']}.\n\nAmount: Rs. {total}\n"
                          f"UTR / reference: {o.get('payment_ref')}\n\nThe pharmacy will now check the payment and confirm your order. "
                          "You will get an email as soon as it is verified."),
            "verified": (f"Payment received - {o['order_no']}",
                         f"We have RECEIVED your UPI payment for order {o['order_no']}.\n\nAmount paid: Rs. {total}\n"
                         f"UTR / reference: {o.get('payment_ref')}\n\nYour order is now being prepared. "
                         + ("We will email you when it is ready for pickup." if pickup else "Nothing more has to be paid on delivery.")),
            "rejected": (f"Payment not found - {o['order_no']}",
                         f"We could NOT find a UPI payment of Rs. {total} with the reference you entered ({ref}) for order {o['order_no']}.\n\n"
                         f"If you have paid, please check the 12-digit UTR in your UPI app (under transaction details) and enter it again:\n{pay_now}.\n\n"
                         f"If you have not paid yet, you can pay from the same place. Please do it within {config.UPI_PAY_MINUTES} minutes, "
                         f"otherwise the order is cancelled automatically.\nFor help call {config.HOSPITAL_PHONE}."),
            "refunded": (f"Refund sent - {o['order_no']}",
                         f"The refund of Rs. {total} for your cancelled order {o['order_no']} has been sent back to the account you paid from"
                         + (f" (payment UTR {o.get('payment_ref')})" if o.get("payment_ref") else "")
                         + f".\n\nIt can take up to 3-5 working days to show in your bank account. For help call {config.HOSPITAL_PHONE}."),
        }
        mail = mails.get(event)
        return [o["user_email"], mail[0], hello + mail[1] + bye] if mail else None

    collect = "It is already paid online - nothing more to pay." if paid else f"Please keep Rs. {total} ready."
    if o.get("payment_status") == "Refund Due":
        refund = (f"Your UPI payment of Rs. {total}" + (f" (UTR {o.get('payment_ref')})" if o.get("payment_ref") else "")
                  + " will be REFUNDED to the account you paid from. We will email you when the refund is sent.")
    else:
        refund = "You do not have to pay anything for this order" + ("" if pickup else " and nothing will be delivered") + "."

    status = o["status"]
    if status == "Placed":
        body = (f"Thank you! We have received your medicine order.\n\n{details}\n\n"
                + (f"PAYMENT PENDING\n---------------\nYour order is reserved for {config.UPI_PAY_MINUTES} minutes. To pay Rs. {total} by UPI:\n"
                   f"{pay_now}, scan the QR code with any UPI app (Google Pay, PhonePe, Paytm, BHIM) and then enter the 12-digit UTR "
                   "shown in your UPI app.\nIf it is not paid in time the order is cancelled automatically.\n\n" if upi and not paid else "")
                + "WHAT HAPPENS NEXT\n-----------------\n"
                + ("1. The pharmacy verifies your payment and confirms your order." if upi else "1. The pharmacy confirms your order.")
                + "\n2. Your medicines are packed.\n"
                + (("3. We email you when the order is ready - collect it at the pharmacy counter" + ("." if upi else f" and pay Rs. {total} in cash."))
                   if pickup else ("3. The order is sent out for delivery" + ("." if upi else f" - pay Rs. {total} in cash when it arrives.")))
                + "\n\nYou will get an email at every step. You can track the order, or cancel it before it is packed, under Medicine Store > My Orders."
                + f"\nFor help call {config.HOSPITAL_PHONE}.")
    elif status == "Confirmed":
        body = f"Your medicine order {o['order_no']} has been CONFIRMED by the pharmacy and is being prepared."
    elif status == "Packed":
        body = f"Your medicine order {o['order_no']} has been PACKED."
    elif status == "Out for Delivery":
        body = f"Your medicine order {o['order_no']} is OUT FOR DELIVERY.\n\n{where}\n\n{collect}{otp_box}"
    elif status == "Ready for Pickup":
        body = (f"Your medicine order {o['order_no']} is READY FOR PICKUP at the {config.HOSPITAL_NAME} pharmacy counter.\n\n"
                f"Please bring this order number. {collect}")
    elif status in ("Delivered", "Collected"):
        body = f"Your medicine order {o['order_no']} has been {status.upper()}. Thank you!"
    elif status == "Cancelled":
        by = o.get("cancelled_by")
        if by == "patient":
            head = f"As you asked, your medicine order {o['order_no']} has been CANCELLED."
            tail = f"If you did not cancel this order yourself, please contact us at {config.HOSPITAL_PHONE}."
        elif by == "system":
            head = f"Your medicine order {o['order_no']} has been CANCELLED because the UPI payment was not completed in time."
            tail = (f"If money was taken from your account for this order, call {config.HOSPITAL_PHONE} with the UTR and we will sort it out. "
                    "You can place a new order any time under Medicine Store." if o.get("payment_status") == "Not Paid"
                    else f"You can place a new order any time under Medicine Store. For help call {config.HOSPITAL_PHONE}.")
        else:
            head = (f"We are sorry - your medicine order {o['order_no']} has been CANCELLED by the {config.HOSPITAL_NAME} pharmacy.\n\n"
                    f"Reason: {o.get('cancel_reason')}")
            tail = f"You can place a new order any time under Medicine Store. For help call {config.HOSPITAL_PHONE}."
        body = (f"{head}\n\n{refund}\n\nCANCELLED ORDER\n---------------\nOrder number: {o['order_no']}\nPlaced on: {placed_on}\n"
                f"Cancelled on: {nice_date(o.get('updated_at') or now())}\n\n{lines}\nOrder total was: Rs. {total}\n\n{tail}")
    else:
        return None
    return [o["user_email"], f"Medicine order {o['order_no']} - {status}", hello + body + bye]


def notify_order_status(order_id, event="", ref="", otp=""):
    mail = order_email(order_id, event, ref, otp)
    if mail:
        notify_patient(mail[0], mail[1], mail[2], otp)
