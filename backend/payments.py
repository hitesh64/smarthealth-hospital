"""Razorpay online payments for medicine orders and lab tests, and the receipt that is emailed.

1. start()   - the server creates a Razorpay order for the amount stored in the database (never the
               amount the browser sends) and the browser opens Razorpay Checkout with it.
2. confirm() - Checkout hands back the payment id and a signature. The signature is checked with the
               key secret and the payment is read back from Razorpay before anything is marked paid.
3. sync()    - if the browser closed right after paying, the payment is found later (My Orders, or
               just before an unpaid order would be cancelled), so nobody pays without getting it.
A paid order or booking that is cancelled gets its money back through refund_for().
"""
import hashlib
import hmac
import secrets
from datetime import timedelta
from html import escape

import requests
from pymongo import ReturnDocument

from . import config
from .db import db, next_id, now
from .utils import background, nice_date

API = "https://api.razorpay.com/v1"
KINDS = {
    "medicine": {"coll": "medicine_orders", "no": "order_no", "label": "Medicine order"},
    "lab": {"coll": "lab_bookings", "no": "booking_no", "label": "Lab test booking"},
}


# bank codes Razorpay sends for net banking -> names for the receipt
BANKS = {"SBIN": "State Bank of India", "HDFC": "HDFC Bank", "ICIC": "ICICI Bank", "UTIB": "Axis Bank", "KKBK": "Kotak Mahindra Bank",
         "PUNB_R": "Punjab National Bank", "BARB_R": "Bank of Baroda", "CNRB": "Canara Bank", "UBIN": "Union Bank of India",
         "IDIB": "Indian Bank", "YESB": "Yes Bank", "IDFB": "IDFC First Bank", "INDB": "IndusInd Bank", "BKID": "Bank of India",
         "MAHB": "Bank of Maharashtra", "IBKL": "IDBI Bank", "FDRL": "Federal Bank", "AIRP": "Airtel Payments Bank"}


class PaymentError(Exception):
    pass


def enabled():
    return bool(config.RAZORPAY_KEY_ID and config.RAZORPAY_KEY_SECRET)


def test_mode():
    return config.RAZORPAY_KEY_ID.startswith("rzp_test_")


def paise(rupees):
    return int(round(float(rupees or 0) * 100))


def rs(v):
    return f"{float(v or 0):,.2f}"


def _api(method, path, body=None, params=None):
    try:
        r = requests.request(method, API + path, auth=(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET),
                             json=body, params=params, timeout=20)
    except requests.RequestException as exc:
        raise PaymentError("Could not reach Razorpay. Please check your internet connection and try again.") from exc
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400:
        raise PaymentError((data.get("error") or {}).get("description") or f"Razorpay answered {r.status_code}.")
    return data


# ---------------------------------------------------------------- paying

def start(kind, doc, site_url=""):
    """Checkout settings for paying `doc` (a medicine order or a lab booking) online. An unfinished
    Razorpay order for the same amount is reused, so pressing "Pay now" again never makes a second one."""
    k = KINDS[kind]
    amount = paise(doc["total"])
    p = db.payments.find_one({"kind": kind, "ref_id": doc["_id"], "status": "created", "amount_paise": amount})
    if not p:
        ro = _api("POST", "/orders", {"amount": amount, "currency": "INR", "receipt": doc[k["no"]],
                                       "notes": {"kind": kind, "ref_no": doc[k["no"]], "email": doc["user_email"]}})
        p = {"_id": next_id("payments"), "kind": kind, "ref_id": doc["_id"], "ref_no": doc[k["no"]],
             "user_email": doc["user_email"], "amount": round(float(doc["total"]), 2), "amount_paise": amount,
             "currency": "INR", "rzp_order_id": ro["id"], "rzp_payment_id": None, "status": "created",
             "method": None, "method_text": None, "receipt_no": None, "receipt_token": None,
             "site_url": site_url, "error": None, "created_at": now(), "checked_at": now(), "paid_at": None}
        db.payments.insert_one(p)
    elif site_url and site_url != p.get("site_url"):
        db.payments.update_one({"_id": p["_id"]}, {"$set": {"site_url": site_url}})
    site = (site_url or p.get("site_url") or "").rstrip("/")
    return {"key": config.RAZORPAY_KEY_ID, "order_id": p["rzp_order_id"], "amount": amount, "currency": "INR",
            # Razorpay comes back to this address after the bank / card page (works where popups are blocked)
            "callback_url": f"{site}/api/pay/callback" if site else "",
            "total": round(float(doc["total"]), 2), "name": config.HOSPITAL_NAME,
            "description": f"{k['label']} {doc[k['no']]}", "kind": kind, "ref_id": doc["_id"], "ref_no": doc[k["no"]],
            "prefill": {"name": doc.get("customer_name") or doc.get("patient_name") or "",
                        "email": doc["user_email"], "contact": ("+91" + doc["phone"]) if len(doc.get("phone") or "") == 10 else ""},
            "theme": config.RAZORPAY_THEME, "test_mode": test_mode()}


def confirm(order_id, payment_id, signature, email):
    """Checks what Razorpay Checkout returned and marks the order paid. Returns the payment record."""
    p = db.payments.find_one({"rzp_order_id": order_id or "", "user_email": email})
    if not p:
        raise PaymentError("This payment does not belong to your account.")
    expected = hmac.new(config.RAZORPAY_KEY_SECRET.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature or ""):
        raise PaymentError("The payment could not be verified. If money was taken, it is refunded automatically by Razorpay.")
    if p["status"] != "created":
        return p  # already settled (another tab, or found by sync)
    return _settle(p, _api("GET", f"/payments/{payment_id}", params={"expand[]": "card"}))


def record_failure(order_id, email, reason):
    db.payments.update_one({"rzp_order_id": order_id or "", "user_email": email, "status": "created"},
                           {"$set": {"error": (reason or "Payment failed")[:255]}, "$inc": {"failed_tries": 1}})


def _method_text(rp):
    m = rp.get("method")
    if m == "upi":
        return "UPI" + (f" ({rp['vpa']})" if rp.get("vpa") else "")
    if m == "card":
        c = rp.get("card") or {}
        return " ".join(x for x in [c.get("network"), (c.get("type") or "").title(), "card"] if x) + (f" **** {c['last4']}" if c.get("last4") else "")
    if m == "netbanking":
        bank = BANKS.get(rp.get("bank") or "", rp.get("bank") or "")
        return "Net banking" + (f" ({bank})" if bank else "")
    if m == "wallet":
        return "Wallet" + (f" ({rp['wallet'].title()})" if rp.get("wallet") else "")
    return "EMI" if m == "emi" else (m or "Online").replace("_", " ").title()


def _settle(p, rp):
    if rp.get("order_id") != p["rzp_order_id"] or int(rp.get("amount") or 0) != p["amount_paise"]:
        raise PaymentError("The payment does not match this order.")
    if rp.get("status") == "authorized":
        rp = _api("POST", f"/payments/{rp['id']}/capture", {"amount": p["amount_paise"], "currency": "INR"})
    if rp.get("status") != "captured":
        raise PaymentError("The payment was not completed, so no money was taken. Please try again.")
    if rp.get("method") == "card" and not rp.get("card"):
        try:
            rp = _api("GET", f"/payments/{rp['id']}", params={"expand[]": "card"})
        except PaymentError:
            pass
    seq = next_id("receipts")
    done = db.payments.find_one_and_update({"_id": p["_id"], "status": "created"}, {"$set": {
        "status": "paid", "rzp_payment_id": rp["id"], "method": rp.get("method"), "method_text": _method_text(rp),
        "receipt_no": f"RCP{now().astimezone(config.IST).strftime('%y%m%d')}{seq:04d}",
        "receipt_token": secrets.token_urlsafe(18), "paid_at": now(), "error": None}}, return_document=ReturnDocument.AFTER)
    if not done:
        return db.payments.find_one({"_id": p["_id"]})
    _apply(done)
    return done


def _apply(p):
    """Marks the order / booking paid, or sends the money back when it can no longer be served."""
    coll = db[KINDS[p["kind"]]["coll"]]
    fields = {"payment_status": "Paid", "payment_ref": p["rzp_payment_id"], "paid_at": p["paid_at"],
              "payment_detail": p["method_text"], "receipt_no": p["receipt_no"], "receipt_token": p["receipt_token"],
              "updated_at": now()}
    if p["kind"] == "lab":
        fields.update(payment="Paid online", payment_method="Online")
    res = coll.update_one({"_id": p["ref_id"], "status": {"$ne": "Cancelled"}, "payment_status": {"$ne": "Paid"}}, {"$set": fields})
    if res.modified_count == 1:
        background(send_receipt, p["_id"])
        return
    ref = coll.find_one({"_id": p["ref_id"]}) or {}
    if ref.get("status") == "Cancelled" and ref.get("payment_status") not in ("Refunded", "Refund Due"):
        # paid after it was cancelled (for example the time to pay ran out): the money goes back
        coll.update_one({"_id": p["ref_id"]}, {"$set": {**fields, "payment_status": "Refund Due"}})
        background(refund_for, p["kind"], p["ref_id"], "Cancelled before the payment arrived")
    elif ref.get("payment_ref") != p["rzp_payment_id"]:
        # paid twice (two tabs): the second payment is returned
        background(refund_payment, p, "Duplicate payment")


def sync(p):
    """Finds a payment the browser did not report back (closed tab, lost connection).
    Returns the settled payment record, or None when nothing was paid."""
    if not p or p["status"] != "created" or not enabled():
        return None
    db.payments.update_one({"_id": p["_id"]}, {"$set": {"checked_at": now()}})
    try:
        items = _api("GET", f"/orders/{p['rzp_order_id']}/payments").get("items", [])
    except PaymentError:
        return None
    for rp in items:
        if rp.get("status") in ("captured", "authorized"):
            try:
                return _settle(p, rp)
            except PaymentError:
                continue
    return None


def sync_pending(kind, query=None, min_gap_seconds=15):
    """sync() for the unfinished payments of some orders / bookings (each looked up at most every
    `min_gap_seconds`). Returns how many turned out to be paid."""
    if not enabled():
        return 0
    found = 0
    q = {"kind": kind, "status": "created", "checked_at": {"$lt": now() - timedelta(seconds=min_gap_seconds)}, **(query or {})}
    for p in list(db.payments.find(q).limit(10)):
        if sync(p):
            found += 1
    return found


# ---------------------------------------------------------------- refunds

def refund_payment(p, reason):
    """Sends one payment back through Razorpay. Returns '' when it went out, otherwise the error."""
    if not db.payments.find_one_and_update({"_id": p["_id"], "status": "paid"}, {"$set": {"status": "refunding"}}):
        return "This payment is not refundable (already refunded or not paid)."
    try:
        # only what is still unrefunded (a part may have been refunded from the Razorpay Dashboard)
        rp = _api("GET", f"/payments/{p['rzp_payment_id']}")
        left = int(rp.get("amount") or 0) - int(rp.get("amount_refunded") or 0)
        if left <= 0:
            rf = {"id": "refunded-in-dashboard"}
        else:
            # Razorpay pays refunds out of the account balance; with too little it only answers "invalid request"
            try:
                balance = int(_api("GET", "/balance").get("balance"))
            except (PaymentError, TypeError, ValueError):
                balance = None
            if balance is not None and balance < left:
                raise PaymentError(f"the Razorpay account balance (Rs. {rs(balance / 100)}) is lower than the refund "
                                   f"(Rs. {rs(left / 100)}). Refunds are paid from the balance - try again once more payments have come in.")
            rf = _api("POST", f"/payments/{p['rzp_payment_id']}/refund",
                      {"amount": left, "notes": {"reason": (reason or "Cancelled")[:200], "ref_no": p["ref_no"]}})
    except PaymentError as exc:
        db.payments.update_one({"_id": p["_id"]}, {"$set": {"status": "paid", "error": f"Refund failed: {exc}"[:255]}})
        return str(exc)
    db.payments.update_one({"_id": p["_id"]}, {"$set": {"status": "refunded", "refund_id": rf.get("id"),
                                                        "refund_reason": reason, "refunded_at": now(), "error": None}})
    return ""


def refund_for(kind, ref_id, reason):
    """Gives back the online payment of a cancelled order / booking and emails the patient.
    Returns '' when the refund was sent, otherwise the error (the order then stays "Refund Due")."""
    coll = db[KINDS[kind]["coll"]]
    p = db.payments.find_one({"kind": kind, "ref_id": ref_id, "status": "paid"}, sort=[("_id", -1)])
    if not p:
        return "No online payment was found for this order."
    error = refund_payment(p, reason)
    if error:
        coll.update_one({"_id": ref_id}, {"$set": {"refund_error": error[:255]}})
        return error
    p = db.payments.find_one({"_id": p["_id"]})
    coll.update_one({"_id": ref_id, "payment_status": "Refund Due"}, {"$set": {
        "payment_status": "Refunded", "refund_id": p.get("refund_id"), "refunded_at": now(), "refund_error": None, "updated_at": now()}})
    if kind == "medicine":
        from .orders import notify_order_status
        notify_order_status(ref_id, "refunded")
    else:
        b = coll.find_one({"_id": ref_id}) or {}
        from .mail import send_email
        send_email(b.get("user_email"), f"Refund sent - {b.get('booking_no')}",
                   f"Hi {b.get('patient_name')},\n\nThe refund of Rs. {rs(p['amount'])} for your cancelled lab booking {b.get('booking_no')} "
                   f"has been sent back to the {p.get('method_text') or 'account'} you paid with.\n\n"
                   f"Payment ID: {p['rzp_payment_id']}\nRefund ID: {p.get('refund_id')}\n\n"
                   f"It usually shows in your account within 5-7 working days. For help call {config.HOSPITAL_PHONE}.\n\n"
                   f"- {config.HOSPITAL_NAME} Laboratory")
    return ""


# ---------------------------------------------------------------- receipt

def receipt_view(p):
    """Everything the receipt shows (page, email and the success popup)."""
    k = KINDS[p["kind"]]
    d = db[k["coll"]].find_one({"_id": p["ref_id"]}) or {}
    if p["kind"] == "medicine":
        pickup = d.get("delivery_type") == "Pickup"
        items = [{"name": i["name"], "detail": f"{i['qty']} {i['unit']} x Rs. {rs(i['price'])}", "amount": i["line_total"]}
                 for i in d.get("items", [])]
        lines = [["Subtotal", rs(d.get("subtotal"))], ["Pickup" if pickup else "Delivery",
                 rs(d["delivery_fee"]) if float(d.get("delivery_fee") or 0) > 0 else "Free"]]
        name = d.get("customer_name")
        info = [["Order", "Pickup at the pharmacy counter" if pickup else "Home delivery"]]
        if not pickup:
            info.append(["Deliver to", f"{d.get('address')}, {d.get('city')} - {d.get('pincode')}"])
        nxt = ("The pharmacy will now confirm and pack your order. "
               + ("We will email you when it is ready for pickup." if pickup else "Nothing more has to be paid on delivery.")
               + " You get an email at every step and can track it under Medicine Store > My Orders.")
    else:
        home = d.get("collection_type") == "Home Collection"
        items = [{"name": i["name"], "detail": ", ".join(c["name"] for c in i.get("components", [])) if i.get("is_package") else "Lab test",
                  "amount": i["price"]} for i in d.get("items", [])]
        lines = [["Tests", rs(d.get("subtotal"))]]
        if home:
            lines.append(["Home collection", rs(d["collection_fee"]) if d.get("collection_fee") else "Free"])
        name = d.get("patient_name")
        info = [["Patient", f"{d.get('patient_name')} ({d.get('age')} {(d.get('gender') or '')[:1]})"],
                ["Slot", f"{d.get('slot_date')} at {d.get('slot_time')}"],
                ["Collection", f"At home: {d.get('address')}" if home else f"Lab visit at {config.HOSPITAL_NAME}, {config.HOSPITAL_ADDRESS}"]]
        nxt = ((d.get("preparation") + "\n") if d.get("preparation") else "") + \
              "Please keep a photo ID ready. Your report will appear under Lab Tests > My Bookings."
    status = {"paid": "Paid", "refunding": "Paid", "refunded": "Refunded"}.get(p["status"], "Pending")
    link = f"{(p.get('site_url') or '').rstrip('/')}/receipt.html?t={p.get('receipt_token')}" if p.get("site_url") else ""
    return {"receipt_no": p.get("receipt_no"), "status": status, "kind": p["kind"], "kind_label": k["label"],
            "ref_no": p["ref_no"], "name": name, "email": p["user_email"], "phone": d.get("phone"),
            "amount": p["amount"], "amount_text": rs(p["amount"]), "items": [{**i, "amount": rs(i["amount"])} for i in items],
            "lines": lines, "info": info, "next": nxt, "method": p.get("method_text") or "Online",
            "payment_id": p.get("rzp_payment_id"), "order_id": p["rzp_order_id"],
            "paid_at": nice_date(p["paid_at"]) if p.get("paid_at") else "",
            "refund_id": p.get("refund_id"), "refunded_at": nice_date(p["refunded_at"]) if p.get("refunded_at") else "",
            "test_mode": p["rzp_order_id"].startswith("order_") and test_mode(), "link": link,
            "hospital": {"name": config.HOSPITAL_NAME, "address": config.HOSPITAL_ADDRESS, "phone": config.HOSPITAL_PHONE}}


def receipt_text(r):
    rows = "".join(f"  {i['name']}  ({i['detail']})  Rs. {i['amount']}\n" for i in r["items"])
    rows += "".join(f"  {a}: {'Rs. ' + b if b != 'Free' else b}\n" for a, b in r["lines"])
    info = "".join(f"{a}: {b}\n" for a, b in r["info"])
    return (f"Hi {r['name']},\n\nThank you! We have RECEIVED your payment of Rs. {r['amount_text']}.\n\n"
            f"PAYMENT RECEIPT\n---------------\nReceipt no: {r['receipt_no']}\n{r['kind_label']}: {r['ref_no']}\n"
            f"Paid on: {r['paid_at']}\nPaid by: {r['method']}\nPayment ID: {r['payment_id']}\n\n"
            f"BILL\n----\n{rows}  TOTAL PAID: Rs. {r['amount_text']}\n\n{info}\nWHAT HAPPENS NEXT\n-----------------\n{r['next']}\n\n"
            + (f"View or download the receipt: {r['link']}\n\n" if r["link"] else "")
            + ("(Test mode payment - no real money was charged.)\n\n" if r["test_mode"] else "")
            + f"For help call {r['hospital']['phone']}.\n\n- {r['hospital']['name']}")


def receipt_html(r):
    """The receipt as an email. Mail apps only understand tables and inline styles."""
    e = lambda v: escape(str(v if v is not None else ""))
    item_rows = "".join(
        f'<tr><td style="padding:10px 0;border-bottom:1px solid #eef2f7;"><div style="font-weight:600;color:#0f172a;">{e(i["name"])}</div>'
        f'<div style="font-size:12px;color:#64748b;">{e(i["detail"])}</div></td>'
        f'<td align="right" style="padding:10px 0;border-bottom:1px solid #eef2f7;font-weight:600;color:#0f172a;white-space:nowrap;">&#8377; {e(i["amount"])}</td></tr>'
        for i in r["items"])
    line_rows = "".join(
        f'<tr><td style="padding:6px 0;color:#475569;">{e(a)}</td><td align="right" style="padding:6px 0;color:#475569;">{"" if b == "Free" else "&#8377; "}{e(b)}</td></tr>'
        for a, b in r["lines"])
    info_rows = "".join(
        f'<tr><td style="padding:5px 12px 5px 0;color:#64748b;font-size:13px;vertical-align:top;white-space:nowrap;">{e(a)}</td>'
        f'<td style="padding:5px 0;color:#0f172a;font-size:13px;">{e(b)}</td></tr>' for a, b in r["info"])
    meta = [("Receipt no.", r["receipt_no"]), (r["kind_label"], r["ref_no"]), ("Paid on", r["paid_at"]),
            ("Paid by", r["method"]), ("Payment ID", r["payment_id"])]
    meta_rows = "".join(
        f'<tr><td style="padding:5px 0;color:#64748b;font-size:13px;">{e(a)}</td><td align="right" style="padding:5px 0;color:#0f172a;font-size:13px;font-weight:600;">{e(b)}</td></tr>'
        for a, b in meta)
    button = (f'<tr><td align="center" style="padding:8px 28px 26px;"><a href="{e(r["link"])}" style="display:inline-block;background:#2563eb;color:#ffffff;'
              f'text-decoration:none;font-weight:700;padding:13px 26px;border-radius:10px;font-size:14px;">View &amp; download receipt</a></td></tr>') if r["link"] else ""
    test = ('<tr><td style="padding:0 28px 18px;"><div style="background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:10px;'
            'padding:10px 12px;font-size:12px;">TEST MODE payment - no real money was charged.</div></td></tr>') if r["test_mode"] else ""
    nxt = e(r["next"]).replace("\n", "<br>")
    h = r["hospital"]
    return f"""<!doctype html><html><body style="margin:0;padding:0;background:#eef2f7;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 10px 30px rgba(15,23,42,.08);">
<tr><td style="background:linear-gradient(135deg,#1d4ed8,#4f46e5);background-color:#1d4ed8;padding:26px 28px;color:#ffffff;">
  <div style="font-size:13px;letter-spacing:2px;opacity:.85;text-transform:uppercase;">{e(h['name'])}</div>
  <div style="font-size:24px;font-weight:800;margin-top:6px;">Payment successful</div>
  <div style="font-size:14px;opacity:.9;margin-top:4px;">Receipt for {e(r['kind_label'].lower())} {e(r['ref_no'])}</div>
</td></tr>
<tr><td align="center" style="padding:26px 28px 6px;">
  <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;background:#16a34a;color:#ffffff;font-size:30px;font-weight:700;">&#10003;</div>
  <div style="font-size:13px;color:#64748b;margin-top:12px;">Amount paid</div>
  <div style="font-size:34px;font-weight:800;color:#0f172a;">&#8377; {e(r['amount_text'])}</div>
  <div style="font-size:14px;color:#475569;margin-top:4px;">Hi {e(r['name'])}, thank you for your payment.</div>
</td></tr>
<tr><td style="padding:18px 28px 4px;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:10px 14px;">{meta_rows}</table></td></tr>
<tr><td style="padding:18px 28px 0;"><div style="font-size:12px;letter-spacing:1.5px;color:#64748b;text-transform:uppercase;font-weight:700;">Bill</div>
  <table width="100%" cellpadding="0" cellspacing="0">{item_rows}{line_rows}
  <tr><td style="padding:12px 0 0;font-weight:800;color:#0f172a;font-size:16px;border-top:2px solid #0f172a;">Total paid</td>
      <td align="right" style="padding:12px 0 0;font-weight:800;color:#0f172a;font-size:16px;border-top:2px solid #0f172a;">&#8377; {e(r['amount_text'])}</td></tr></table></td></tr>
<tr><td style="padding:20px 28px 0;"><table cellpadding="0" cellspacing="0">{info_rows}</table></td></tr>
<tr><td style="padding:18px 28px;"><div style="background:#eff6ff;border-radius:12px;padding:12px 14px;font-size:13px;color:#1e3a8a;line-height:1.55;"><b>What happens next</b><br>{nxt}</div></td></tr>
{test}{button}
<tr><td style="background:#f8fafc;padding:16px 28px;font-size:12px;color:#64748b;line-height:1.6;">{e(h['name'])} &middot; {e(h['address'])}<br>Help: {e(h['phone'])} &middot; Payments secured by Razorpay</td></tr>
</table></td></tr></table></body></html>"""


def send_receipt(payment_id):
    """Emails the receipt for one paid payment. The patient can also open it any time from the link in it."""
    from .mail import send_email
    p = db.payments.find_one({"_id": payment_id})
    if not p or p["status"] not in ("paid", "refunding", "refunded"):
        return False
    r = receipt_view(p)
    sent = send_email(p["user_email"], f"Payment receipt {r['receipt_no']} - Rs. {r['amount_text']} paid for {r['ref_no']}",
                      receipt_text(r), html=receipt_html(r))
    db.payments.update_one({"_id": p["_id"]}, {"$set": {"receipt_mailed_at": now(), "receipt_mailed": bool(sent)}})
    return sent
