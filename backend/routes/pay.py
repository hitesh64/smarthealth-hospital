"""Online payment (Razorpay) for the patient pages: start / retry a payment, confirm it after
Checkout, note a failed try, and the receipt page."""
import json
from urllib.parse import urlencode

from flask import Blueprint, redirect, request

from .. import payments
from ..db import db
from ..utils import arg, fail, ok, post, require_user, to_int

bp = Blueprint("pay", __name__)


def _doc_for(kind, ref_id, email):
    if kind not in payments.KINDS:
        fail("Unknown payment", 404)
    doc = db[payments.KINDS[kind]["coll"]].find_one({"_id": to_int(ref_id), "user_email": email})
    if not doc:
        fail("Not found", 404)
    return doc


@bp.post("/api/pay/callback")
def pay_callback():
    """Razorpay Checkout in redirect mode posts the result here (from Razorpay's page, so without the
    login cookie). The signature proves the result is genuine; the patient is then sent back to the
    site, which shows the receipt or offers to try again."""
    order_id, payment_id = post("razorpay_order_id"), post("razorpay_payment_id")
    if not order_id:
        # a failed try: Razorpay sends the order id inside error[metadata]
        try:
            order_id = json.loads(post("error[metadata]") or "{}").get("order_id", "")
        except ValueError:
            order_id = ""
    p = db.payments.find_one({"rzp_order_id": order_id}) if order_id else None
    if not p:
        return redirect("/?" + urlencode({"payerr": "We could not match this payment to an order. If money was taken, "
                                                    "it is refunded automatically by Razorpay."}))
    if not payment_id:
        reason = post("error[description]") or "The payment was not completed."
        payments.record_failure(order_id, p["user_email"], reason)
        return redirect("/?" + urlencode({"payfail": f"{p['kind']}-{p['ref_id']}", "reason": reason}))
    try:
        p = payments.confirm(order_id, payment_id, post("razorpay_signature"), p["user_email"])
    except payments.PaymentError as exc:
        return redirect("/?" + urlencode({"payerr": str(exc)}))
    return redirect("/?" + urlencode({"paid": p["receipt_token"]}))


@bp.route("/api/pay", methods=["GET", "POST"])
def pay_api():
    action = arg("action")

    if action == "receipt":
        # opened from the emailed link, so it works without logging in; the token is long and random
        token = arg("t")
        p = db.payments.find_one({"receipt_token": token}) if len(token) >= 16 else None
        if not p:
            fail("Receipt not found. Please open the link from your email again.", 404)
        return ok(receipt=payments.receipt_view(p))

    email = require_user()
    if not payments.enabled():
        fail("Online payment is not available right now.", 503)

    if action == "start":
        # "Pay now" for an order / booking that was not paid when it was placed
        kind = post("kind")
        doc = _doc_for(kind, post("id"), email)
        if doc.get("status") == "Cancelled":
            fail("This was cancelled, so it cannot be paid.", 409)
        if kind == "medicine":
            from ..orders import pay_seconds_left
            if doc.get("payment_method") != "Online" or doc.get("payment_status") != "Pending":
                fail("This order does not need an online payment any more. Please refresh the page.", 409)
            if pay_seconds_left(doc) <= 0:
                fail("The time to pay this order is over. Please place the order again.", 409)
        elif doc.get("status") != "Booked" or doc.get("payment_status") in ("Paid", "Refund Due", "Refunded"):
            # a lab booking can be paid online any time before the sample is taken
            fail("This booking does not need a payment now. Please refresh the page.", 409)
        try:
            return ok(checkout=payments.start(kind, doc, request.host_url))
        except payments.PaymentError as exc:
            fail(str(exc), 502)

    if action == "verify":
        try:
            p = payments.confirm(post("razorpay_order_id"), post("razorpay_payment_id"), post("razorpay_signature"), email)
        except payments.PaymentError as exc:
            fail(str(exc), 400)
        if p["status"] not in ("paid", "refunding", "refunded"):
            fail("The payment is not complete yet.", 409)
        ref = db[payments.KINDS[p["kind"]]["coll"]].find_one({"_id": p["ref_id"]}, {"status": 1, "payment_status": 1}) or {}
        return ok(receipt=payments.receipt_view(p), token=p["receipt_token"],
                  refunded=ref.get("payment_status") in ("Refund Due", "Refunded"))

    if action == "failed":
        payments.record_failure(post("razorpay_order_id"), email, post("reason"))
        return ok()

    fail("Unknown action", 404)
