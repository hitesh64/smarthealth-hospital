// Online payment with Razorpay Checkout, shared by the medicine store and the lab.
// The server makes the Razorpay order (amount from the database) and checks the payment afterwards;
// this file only opens Checkout, reports the result and shows the receipt.
// Uses shEsc / shPost / shToast / shConfirm.

const PAY_SDK = 'https://checkout.razorpay.com/v1/checkout.js';
let paySdkLoading = null;

function payRs(v) {
    return '₹' + (+v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function payLoadSdk() {
    if (window.Razorpay) return Promise.resolve();
    if (!paySdkLoading) {
        paySdkLoading = new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = PAY_SDK;
            s.onload = resolve;
            s.onerror = () => { paySdkLoading = null; s.remove(); reject(new Error('sdk')); };
            document.head.appendChild(s);
        });
    }
    return paySdkLoading;
}

// Full-screen "please wait" while Checkout loads and while the payment is being verified
function payBusy(text) {
    let el = document.getElementById('payBusy');
    if (!text) { if (el) el.remove(); return; }
    if (!el) {
        document.body.insertAdjacentHTML('beforeend', `<div class="pay-busy" id="payBusy" role="status"><div class="pay-busy-card">
            <span class="pay-busy-ring"><i class="fas fa-shield-halved"></i></span><b id="payBusyText"></b><small>Secured by Razorpay · do not close this page</small></div></div>`);
        el = document.getElementById('payBusy');
    }
    document.getElementById('payBusyText').textContent = text;
}

// The payment-method card shown in the store and lab checkout
function payMethodCard(active, onclick, test) {
    return `<label class="pay-pick ${active ? 'active' : ''}"><input type="radio" name="payPick" ${active ? 'checked' : ''} onchange="${onclick}">
        <span class="pay-pick-icon"><i class="fas fa-credit-card"></i></span>
        <span class="pay-pick-text"><b>Pay online now ${test ? '<em class="pay-test">TEST MODE</em>' : ''}</b>
            <small>UPI · Cards · Net banking · Wallets</small>
            <span class="pay-chips"><i class="fab fa-google-pay" title="Google Pay"></i><i class="fab fa-cc-visa" title="Visa"></i><i class="fab fa-cc-mastercard" title="Mastercard"></i><i class="fas fa-building-columns" title="Net banking"></i><i class="fas fa-wallet" title="Wallets"></i></span>
        </span>
        <span class="pay-secure"><i class="fas fa-lock"></i> Razorpay</span></label>`;
}

// Opens Razorpay Checkout for a checkout object from the server.
// Resolves { paid: true, receipt, refunded } or { paid: false, reason: 'closed' | 'sdk' | 'verify' | 'network' }.
function payOnline(c) {
    return new Promise(async resolve => {
        payBusy('Opening secure payment…');
        try { await payLoadSdk(); } catch (e) {
            payBusy();
            shToast('Could not load the payment page. Please check your internet and try again.', 'error');
            return resolve({ paid: false, reason: 'sdk' });
        }
        let done = false;
        const finish = result => { if (!done) { done = true; payBusy(); resolve(result); } };
        const rzp = new Razorpay({
            key: c.key, order_id: c.order_id, amount: c.amount, currency: c.currency,
            name: c.name, description: c.description,
            // Checkout runs on https, so only an https logo can be shown in it
            image: location.protocol === 'https:' ? location.origin + '/assets/logo-mark-100.webp' : undefined,
            prefill: c.prefill, notes: { ref_no: c.ref_no }, theme: { color: c.theme || '#2563eb' },
            retry: { enabled: true, max_count: 4 },
            // Redirect mode: the bank / card (3-D Secure) page opens in this window instead of a popup,
            // so it also works where popups are blocked (phones, in-app browsers). Razorpay then posts
            // the result to the server, which comes back to this site with ?paid= or ?payfail=.
            ...(c.callback_url ? { callback_url: c.callback_url, redirect: true } : {}),
            modal: { confirm_close: true, ondismiss: () => finish({ paid: false, reason: 'closed' }) },
            handler: async r => {
                done = true;
                payBusy('Verifying your payment…');
                try {
                    const res = await shPost('api/pay?action=verify', r);
                    payBusy();
                    if (res.status !== 'success') {
                        shToast(res.message || 'The payment could not be verified.', 'error');
                        return resolve({ paid: false, reason: 'verify' });
                    }
                    resolve({ paid: true, receipt: res.receipt, refunded: res.refunded });
                } catch (e) {
                    payBusy();
                    shToast('Your payment went through, but we could not confirm it right now. It will show in your list in a minute.', 'error');
                    resolve({ paid: false, reason: 'network' });
                }
            }
        });
        // Checkout itself shows the error and lets the patient try another way; we only note it
        rzp.on('payment.failed', e => {
            shPost('api/pay?action=failed', { razorpay_order_id: c.order_id, reason: (e && e.error && e.error.description) || '' }).catch(() => {});
        });
        payBusy();
        rzp.open();
    });
}

// "Pay now" for something placed earlier: the server makes / reuses the Razorpay order
async function payAgain(kind, id) {
    payBusy('Opening secure payment…');
    let res;
    try { res = await shPost('api/pay?action=start', { kind, id }); } catch (e) { res = { message: 'Could not reach the hospital. Check your internet and try again.' }; }
    payBusy();
    if (res.status !== 'success') { shToast(res.message || 'Could not start the payment.', 'error'); return { paid: false, reason: 'start' }; }
    return payOnline(res.checkout);
}

function payReceiptUrl(token) {
    return 'receipt.html?t=' + encodeURIComponent(token);
}

// Success popup with the receipt. opts: { title, done (button text), onDone }
function payShowReceipt(r, opts) {
    opts = opts || {};
    document.getElementById('payDone')?.remove();
    const token = (r.link || '').split('t=')[1] || '';
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sh-success pay-done" id="payDone">
            <div class="sh-success-card pay-done-card">
                <div class="pay-burst"><span></span><span></span><span></span><span></span><span></span><span></span>
                    <div class="pay-tick"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div></div>
                <h2>${shEsc(opts.title || 'Payment successful')}</h2>
                <p class="sh-sub">${shEsc(r.kind_label)} ${shEsc(r.ref_no)}${r.test_mode ? ' <em class="pay-test">TEST MODE</em>' : ''}</p>
                <div class="pay-amount"><small>Amount paid</small><b>${payRs(r.amount)}</b></div>
                <div class="pay-slip">
                    <div><span>Receipt no.</span><b>${shEsc(r.receipt_no)}</b></div>
                    <div><span>Paid by</span><b>${shEsc(r.method)}</b></div>
                    <div><span>Payment ID</span><b class="pay-mono">${shEsc(r.payment_id)}</b></div>
                    <div><span>Date</span><b>${shEsc(r.paid_at)}</b></div>
                </div>
                <details class="pay-bill"><summary>Bill details <i class="fas fa-chevron-down"></i></summary>
                    ${r.items.map(i => `<div><span>${shEsc(i.name)}<small>${shEsc(i.detail)}</small></span><b>₹${shEsc(i.amount)}</b></div>`).join('')}
                    ${r.lines.map(([a, b]) => `<div class="is-line"><span>${shEsc(a)}</span><b>${b === 'Free' ? 'Free' : '₹' + shEsc(b)}</b></div>`).join('')}
                    <div class="is-sum"><span>Total paid</span><b>${payRs(r.amount)}</b></div>
                </details>
                <p class="sh-mail"><i class="fas fa-envelope-circle-check"></i> Receipt emailed to <b>${shEsc(r.email)}</b></p>
                <div class="sh-actions">
                    <button class="ghost" onclick="window.open('${payReceiptUrl(token)}', '_blank', 'noopener')"><i class="fas fa-file-invoice"></i> View receipt</button>
                    <button id="payDoneBtn">${shEsc(opts.done || 'Done')}</button>
                </div>
            </div>
        </div>`);
    document.getElementById('payDoneBtn').onclick = () => {
        document.getElementById('payDone')?.remove();
        if (opts.onDone) opts.onDone();
    };
}

// ---------------------------------------------------------------- coming back from Razorpay
// After a redirect-mode payment the server sends the patient to /?paid=<receipt token>,
// /?payfail=<kind>-<id>&reason=... or /?payerr=<message>.
function payOpenList(kind) {
    if (kind === 'lab') { if (typeof lab !== 'undefined') lab.tab = 'my'; if (typeof switchView === 'function') switchView('lab'); }
    else if (typeof openStore === 'function') openStore('orders');
}

async function payReturned() {
    const q = new URLSearchParams(location.search);
    const paid = q.get('paid'), failed = q.get('payfail'), error = q.get('payerr');
    if (!paid && !failed && !error) return;
    history.replaceState(null, '', location.pathname + location.hash);   // a reload must not show it again
    if (paid) {
        const d = await fetch('api/pay?action=receipt&t=' + encodeURIComponent(paid)).then(r => r.json()).catch(() => ({}));
        if (d.status !== 'success') return shToast('Payment received. Your receipt has been emailed to you.', 'success');
        const r = d.receipt;
        payOpenList(r.kind);
        payShowReceipt(r, { title: r.kind === 'lab' ? 'Lab test booked & paid!' : 'Order placed & paid!',
                            done: r.kind === 'lab' ? 'View my bookings' : 'Track my order' });
    } else if (failed) {
        const [kind, id] = failed.split('-');
        payOpenList(kind);
        const reason = (q.get('reason') || 'it was not completed').replace(/[.\s]+$/, '');
        const again = await shConfirm(`Payment failed: ${reason}. No money was taken. Try again?`,
            { yes: 'Try again', no: kind === 'lab' ? 'Pay at collection' : 'Later' });
        if (again) {
            const r = await payAgain(kind, +id);
            if (r.paid) payShowReceipt(r.receipt);
        } else if (kind === 'lab') {
            await shPost('api/lab?action=payLater', { id: +id }).catch(() => {});
            if (typeof lbLoadMine === 'function') lbLoadMine();
            shToast('Your booking is kept - please pay at collection.', 'success');
        }
    } else {
        shToast(error, 'error');
    }
}

// wait until the page's own scripts (login, views) have run
if (document.readyState === 'complete') setTimeout(payReturned, 600);
else window.addEventListener('load', () => setTimeout(payReturned, 600));
