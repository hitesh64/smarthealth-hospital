// Patient-side medicine store for index.html: products, cart, checkout form, my orders.
// Uses `currentUser` and `logout()` from the main page script, and shEsc / shPost / shToast / shConfirm.

const ST_CART_KEY = 'smartHealthCart';
const store = {
    products: [], fee: 0, freeAbove: 0, maxQty: 20,
    tab: 'shop', category: 'All', search: '',
    cart: {},        // { medicineId: qty }
    form: null,      // checkout form values, kept while the cart is redrawn
    orders: null, poll: null, placing: false,
    upi: false, payMinutes: 30, payTimer: null   // UPI is offered only when the hospital has set its UPI ID
};
try { store.cart = JSON.parse(localStorage.getItem(ST_CART_KEY)) || {}; } catch (e) { store.cart = {}; }

function stMoney(v) {
    return '₹' + (+v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function stCartCount() {
    return Object.values(store.cart).reduce((sum, q) => sum + q, 0);
}

function stSaveCart() {
    localStorage.setItem(ST_CART_KEY, JSON.stringify(store.cart));
    stUpdateBadges();
}

function stUpdateBadges() {
    const n = stCartCount();
    document.querySelectorAll('.st-cart-count').forEach(el => {
        el.textContent = n;
        el.style.display = n > 0 ? '' : 'none';
    });
    stMoveGlider(); // the Cart tab changes width when its count appears
}

// Cart lines joined with the live product list
function stCartLines() {
    return Object.keys(store.cart).map(id => {
        const p = store.products.find(x => x.id == id);
        return p ? { p, qty: store.cart[id], total: +p.price * store.cart[id] } : null;
    }).filter(Boolean);
}

// Stock may have changed since the cart was filled: drop what is gone, lower what is short.
function stSyncCart() {
    let changed = false;
    Object.keys(store.cart).forEach(id => {
        const p = store.products.find(x => x.id == id);
        if (!p || +p.available < 1) { delete store.cart[id]; changed = true; }
        else if (store.cart[id] > +p.available) { store.cart[id] = +p.available; changed = true; }
    });
    if (changed) {
        stSaveCart();
        shToast('Your cart was updated — some medicines are no longer available in that quantity.', 'error');
    }
}

// Called by switchView('store')
function loadStore() {
    const box = document.getElementById('store-body');
    if (!store.products.length) box.innerHTML = '<div class="st-grid">' + '<div class="st-skel"></div>'.repeat(4) + '</div>';
    return fetch('storeApi.php?action=products').then(r => r.json()).then(d => {
        if (d.status !== 'success') throw new Error(d.message);
        store.products = d.products;
        store.fee = +d.delivery_fee;
        store.freeAbove = +d.free_delivery_above;
        store.maxQty = +d.max_qty;
        store.upi = !!d.upi_enabled;
        store.payMinutes = +d.upi_pay_minutes;
        stSyncCart();
        stRender();
    }).catch(() => {
        box.innerHTML = '<div class="st-none"><i class="fas fa-triangle-exclamation"></i>Could not load the medicine store. Please try again.</div>';
    });
}

// Opens the store from the header or the search box: tab is 'shop', 'cart' or 'orders';
// `find` (optional) is put in the shop's search box.
function openStore(tab, find) {
    store.tab = tab || 'shop';
    if (find !== undefined) { store.search = find; store.category = 'All'; }
    clearInterval(store.poll);
    switchView('store'); // loads the products and draws store.tab
    if (store.tab === 'orders') stTab('orders');
}

function stTab(tab) {
    store.tab = tab;
    clearInterval(store.poll);
    stRender();
    if (tab === 'orders') {
        stLoadOrders();
        // order status changes at the pharmacy show up without a manual refresh
        store.poll = setInterval(() => {
            if (document.getElementById('store-view').style.display !== 'none') stLoadOrders(true);
        }, 20000);
    }
}

// The tab bar is built once, so its highlight can slide between tabs instead of being redrawn
function stRender() {
    if (!document.getElementById('st-panel')) {
        document.getElementById('store-body').innerHTML = `
            <div class="st-tabs" id="st-tabs">
                <span class="st-glider"></span>
                <button data-tab="shop" onclick="stTab('shop')"><i class="fas fa-store"></i> Shop</button>
                <button data-tab="cart" onclick="stTab('cart')"><i class="fas fa-cart-shopping"></i> Cart <span class="st-count st-cart-count" style="display:none;">0</span></button>
                <button data-tab="orders" onclick="stTab('orders')"><i class="fas fa-box"></i> My Orders</button>
            </div>
            <div id="st-panel"></div>`;
    }
    document.querySelectorAll('#st-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === store.tab));
    if (store.tab === 'shop') stRenderShop();
    else if (store.tab === 'cart') stRenderCart();
    else stRenderOrders();
    stUpdateBadges();
    stEnter();
}

function stMoveGlider() {
    const active = document.querySelector('#st-tabs button.active'), glider = document.querySelector('.st-glider');
    if (!active || !glider) return;
    glider.style.width = active.offsetWidth + 'px';
    glider.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener('resize', stMoveGlider);

// Plays the entrance motion for what was just drawn. The class is taken off again so that
// later redraws of the same tab (a quantity change, the orders refresh) stay still.
function stEnter() {
    const panel = document.getElementById('st-panel');
    if (!panel) return;
    panel.classList.remove('st-enter');
    void panel.offsetWidth;
    panel.classList.add('st-enter');
    clearTimeout(store.enterTimer);
    store.enterTimer = setTimeout(() => panel.classList.remove('st-enter'), 1400);
}

// ---------------------------------------------------------------- shop
function stRenderShop() {
    const cats = ['All', ...new Set(store.products.map(p => p.category))];
    if (!cats.includes(store.category)) store.category = 'All';
    const facts = [
        ['fa-truck', `Home delivery ${stMoney(store.fee)}`],
        ['fa-gift', `Free delivery from ${stMoney(store.freeAbove)}`],
        ['fa-store', 'Pickup at the pharmacy is free'],
        ['fa-money-bill', store.upi ? 'Pay by UPI or cash' : 'Pay in cash on delivery']
    ];
    document.getElementById('st-panel').innerHTML = `
        <div class="st-facts">${facts.map(([icon, text], i) => `<span style="--i: ${i};"><i class="fas ${icon}"></i>${text}</span>`).join('')}</div>
        <div class="st-toolbar">
            <div class="st-search"><i class="fas fa-magnifying-glass"></i>
                <input type="search" placeholder="Search medicines…" value="${shEsc(store.search)}" oninput="store.search = this.value; stRenderGrid()"></div>
            <div class="st-chips">${cats.map(c => `<button class="${c === store.category ? 'active' : ''}" data-cat="${shEsc(c)}" onclick="stSetCategory(this.dataset.cat)">${shEsc(c)}</button>`).join('')}</div>
        </div>
        <div class="st-grid" id="st-grid"></div>
        <div class="st-bar" id="st-bar"></div>`;
    stRenderGrid();
}

// Only the chips and the grid change, so the search box keeps its text and cursor
function stSetCategory(cat) {
    store.category = cat;
    document.querySelectorAll('.st-chips button').forEach(b => b.classList.toggle('active', b.dataset.cat === cat));
    stRenderGrid();
}

// The button under a product: out of stock, the quantity stepper, or "Add to cart"
function stCardAction(p) {
    const left = +p.available, qty = store.cart[p.id] || 0;
    if (left < 1) return '<button class="st-add" disabled>Out of stock</button>';
    return qty ? stStepper(p.id, qty, left) : `<button class="st-add" onclick="stSetQty(${p.id}, 1)"><i class="fas fa-cart-plus"></i> Add to cart</button>`;
}

function stRenderGrid() {
    const q = store.search.trim().toLowerCase();
    const rows = store.products.filter(p =>
        (store.category === 'All' || p.category === store.category) &&
        (!q || (p.name + ' ' + (p.description || '') + ' ' + p.category).toLowerCase().includes(q)));
    const grid = document.getElementById('st-grid');
    grid.innerHTML = rows.length ? rows.map((p, i) => {
        const left = +p.available;
        return `<div class="st-card ${left < 1 ? 'out' : ''} ${store.cart[p.id] ? 'in-cart' : ''}" style="--i: ${Math.min(i, 10)};">
            <div class="st-img">${p.image ? `<img src="${shEsc(p.image)}" alt="${shEsc(p.name)}" loading="lazy">` : '<i class="fas fa-pills"></i>'}
                <span class="st-tag">${shEsc(p.category)}</span>
                ${left >= 1 && left <= 5 ? `<span class="st-low">Only ${left} left</span>` : ''}
                <span class="st-incart"><i class="fas fa-check"></i> In cart</span>
            </div>
            <div class="st-info">
                <h4>${shEsc(p.name)}</h4>
                ${p.description ? `<p class="st-desc">${shEsc(p.description)}</p>` : ''}
                <div class="st-price">${stMoney(p.price)} <small>per ${shEsc(p.unit)}</small></div>
                <div class="st-act" data-id="${+p.id}">${stCardAction(p)}</div>
            </div>
        </div>`;
    }).join('') : `<div class="st-none"><i class="fas ${store.products.length ? 'fa-magnifying-glass' : 'fa-box-open'}"></i>${store.products.length ? 'No medicines match your search.' : 'No medicines are available in the store right now.'}</div>`;
    // cards rise in when the list itself changes, not when a quantity does
    grid.classList.remove('is-fresh');
    void grid.offsetWidth;
    grid.classList.add('is-fresh');
    stBar();
}

function stStepper(id, qty, max) {
    return `<div class="st-stepper">
        <button onclick="stSetQty(${id}, ${qty - 1})" aria-label="Less">−</button>
        <span>${qty}</span>
        <button onclick="stSetQty(${id}, ${qty + 1})" ${qty >= max ? 'disabled' : ''} aria-label="More">+</button>
    </div>`;
}

// The bar at the bottom of the shop: what is in the cart, and the way to it
function stBar() {
    const bar = document.getElementById('st-bar');
    if (!bar) return;
    const n = stCartCount(), subtotal = stCartLines().reduce((s, l) => s + l.total, 0);
    bar.classList.toggle('show', n > 0);
    if (n) bar.innerHTML = `
        <span class="st-bar-icon"><i class="fas fa-cart-shopping"></i><b>${n}</b></span>
        <span class="st-bar-text"><b>${n} item${n === 1 ? '' : 's'} in your cart</b><small>Subtotal ${stMoney(subtotal)}</small></span>
        <button onclick="stTab('cart')">View cart <i class="fas fa-arrow-right"></i></button>`;
}

// A dot flies from the product to the cart button in the header, which then gives a small bump
function stFly(from) {
    const cart = document.querySelector('.header .header-icon-btn');
    if (!cart || !document.body.animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to = cart.getBoundingClientRect();
    const x0 = from.left + from.width / 2, y0 = from.top + from.height / 2, x1 = to.left + to.width / 2, y1 = to.top + to.height / 2;
    const dot = document.createElement('div');
    dot.className = 'st-fly';
    dot.style.left = x0 + 'px';
    dot.style.top = y0 + 'px';
    document.body.appendChild(dot);
    dot.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${(x1 - x0) * .55}px, ${(y1 - y0) * .25 - 60}px) scale(1.3)`, opacity: 1, offset: .45 },
        { transform: `translate(${x1 - x0}px, ${y1 - y0}px) scale(.3)`, opacity: .4 }
    ], { duration: 650, easing: 'cubic-bezier(.3, .7, .3, 1)' }).onfinish = () => {
        dot.remove();
        cart.classList.remove('st-bump');
        void cart.offsetWidth;
        cart.classList.add('st-bump');
    };
}

function stSetQty(id, qty) {
    const p = store.products.find(x => x.id == id);
    if (!p) return;
    const before = store.cart[id] || 0, clicked = document.activeElement;
    const from = clicked && clicked.closest && clicked.closest('.st-card') ? clicked.getBoundingClientRect() : null;
    qty = Math.max(0, Math.min(qty, +p.available));
    if (qty) store.cart[id] = qty; else delete store.cart[id];
    stSaveCart();
    if (store.tab === 'cart') return stRenderCart();

    // in the shop only this product's button is redrawn, so the rest of the page stays put
    const act = document.querySelector(`.st-act[data-id="${+id}"]`);
    if (!act) return stRenderGrid();
    act.innerHTML = stCardAction(p);
    act.closest('.st-card').classList.toggle('in-cart', qty > 0);
    stBar();
    if (qty > before && from) stFly(from);
}

// ---------------------------------------------------------------- cart + checkout
function stRenderCart() {
    const panel = document.getElementById('st-panel');
    const lines = stCartLines();
    if (!lines.length) {
        panel.innerHTML = `<div class="card st-empty"><i class="fas fa-cart-shopping"></i>
            <p>Your cart is empty.</p><button class="btn" style="width:auto;" onclick="stTab('shop')">Browse medicines</button></div>`;
        return;
    }
    if (!store.form) {
        const u = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
        store.form = { name: u.name || '', phone: u.phone || '', delivery_type: 'Home Delivery', address: u.address || '', city: '', pincode: '', notes: '', saved: false };
        try { Object.assign(store.form, JSON.parse(localStorage.getItem(stDetailsKey())) || {}); } catch (e) {}
        if (stDetailsError()) store.form.saved = false;
    }
    const f = store.form, pickup = f.delivery_type === 'Pickup', upi = stPayMethod() === 'UPI';
    const subtotal = lines.reduce((s, l) => s + l.total, 0);
    const fee = (pickup || subtotal >= store.freeAbove) ? 0 : store.fee;

    const meter = pickup || !(store.freeAbove > 0) ? '' : `<div class="st-meter ${fee ? '' : 'full'}">
        <div><i class="fas ${fee ? 'fa-truck' : 'fa-circle-check'}"></i><span>${fee ? `Add <b>${stMoney(store.freeAbove - subtotal)}</b> more for free delivery` : 'You have free delivery on this order'}</span></div>
        <span><i style="width: ${Math.min(subtotal / store.freeAbove * 100, 100).toFixed(1)}%;"></i></span></div>`;

    panel.innerHTML = `
    <div class="st-checkout">
            <ol class="st-flow"><li class="done">Cart</li><li class="${f.saved ? 'done' : 'now'}">Delivery details</li><li class="${f.saved ? 'now' : ''}">Review &amp; pay</li></ol>
            <div class="card">
                <h4 class="st-h"><span class="st-num">1</span> Items in your cart</h4>
                ${lines.map(l => `<div class="st-line">
                    <div class="st-line-img">${l.p.image ? `<img src="${shEsc(l.p.image)}" alt="">` : '<i class="fas fa-pills"></i>'}</div>
                    <div class="st-line-name"><b>${shEsc(l.p.name)}</b><small>${stMoney(l.p.price)} per ${shEsc(l.p.unit)}</small></div>
                    ${stStepper(l.p.id, l.qty, +l.p.available)}
                    <div class="st-line-total">${stMoney(l.total)}</div>
                    <button class="st-remove" onclick="stSetQty(${l.p.id}, 0)" aria-label="Remove"><i class="fas fa-trash"></i></button>
                </div>`).join('')}
                ${meter}
            </div>
            ${f.saved ? `
            <div class="card">
                <h4 class="st-h"><span class="st-num done"><i class="fas fa-check"></i></span> Delivery details
                    <button class="st-edit" onclick="stEditDetails()"><i class="fas fa-pen"></i> Edit</button></h4>
                <div class="st-saved">
                    <p><i class="fas ${pickup ? 'fa-store' : 'fa-truck'}"></i> <b>${pickup ? 'Pickup at hospital pharmacy' : 'Home delivery'}</b></p>
                    <p><i class="fas fa-user"></i> ${shEsc(f.name)} · ${shEsc(f.phone)}</p>
                    ${pickup ? '' : `<p><i class="fas fa-location-dot"></i> ${shEsc(f.address)}, ${shEsc(f.city)} - ${shEsc(f.pincode)}</p>`}
                    ${f.notes ? `<p><i class="fas fa-note-sticky"></i> ${shEsc(f.notes)}</p>` : ''}
                </div>
            </div>
            <div class="card st-summary" id="st-summary">
                <h4 class="st-h"><span class="st-num">3</span> Order summary</h4>
                ${lines.map(l => `<div class="st-sum-item"><span>${shEsc(l.p.name)} × ${l.qty} ${shEsc(l.p.unit)}</span><b>${stMoney(l.total)}</b></div>`).join('')}
                <div><span>Subtotal (${stCartCount()} items)</span><b>${stMoney(subtotal)}</b></div>
                <div><span>${pickup ? 'Pickup' : 'Delivery'}</span><b>${fee ? stMoney(fee) : 'Free'}</b></div>
                ${!pickup && fee ? `<p class="st-hint">Add ${stMoney(store.freeAbove - subtotal)} more for free delivery.</p>` : ''}
                <div class="st-total"><span>Total to pay</span><b>${stMoney(subtotal + fee)}</b></div>
                ${store.upi ? `
                <h4 class="st-h" style="margin-top: 1.4rem;"><span class="st-num">4</span> How do you want to pay?</h4>
                <section class="st-choice">
                    <label class="${upi ? 'active' : ''}"><input type="radio" name="stPay" ${upi ? 'checked' : ''} onchange="stSetPay('UPI')">
                        <i class="fas fa-qrcode"></i> <span><b>Pay online by UPI</b><small>Google Pay · PhonePe · Paytm · BHIM — pay now by QR</small></span></label>
                    <label class="${upi ? '' : 'active'}"><input type="radio" name="stPay" ${upi ? '' : 'checked'} onchange="stSetPay('COD')">
                        <i class="fas fa-money-bill"></i> <span><b>${pickup ? 'Pay at pickup' : 'Cash on delivery'}</b><small>${pickup ? 'Pay in cash at the pharmacy counter' : 'Pay in cash when the medicines arrive'}</small></span></label>
                </section>` : `
                <p class="st-hint"><i class="fas fa-money-bill"></i> ${pickup ? 'Pay in cash at the pharmacy counter.' : 'Cash on delivery — pay when the medicines arrive.'}</p>`}
                <button class="btn btn-success" id="st-place" onclick="stPlaceOrder()">${upi
                    ? `<i class="fas fa-qrcode"></i> Place Order &amp; Pay ${stMoney(subtotal + fee)}`
                    : '<i class="fas fa-check"></i> Place Order'}</button>
                ${upi ? `<p class="st-hint" style="margin: .8rem 0 0; text-align: center;">The UPI QR code opens next. Your medicines are held for ${store.payMinutes} minutes while you pay.</p>` : ''}
                <p class="st-hint" style="margin: 1rem 0 0; text-align: center;"><i class="fas fa-envelope"></i> The full order details will be emailed to ${shEsc((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || 'your email')}.</p>
            </div>` : `
            <div class="card">
                <h4 class="st-h"><span class="st-num">2</span> Delivery details</h4>
                <div class="st-choice">
                    <label class="${pickup ? '' : 'active'}"><input type="radio" name="stType" ${pickup ? '' : 'checked'} onchange="stSetType('Home Delivery')">
                        <i class="fas fa-truck"></i> <span><b>Home delivery</b><small>${subtotal >= store.freeAbove ? 'Free delivery' : stMoney(store.fee) + ' delivery charge'}</small></span></label>
                    <label class="${pickup ? 'active' : ''}"><input type="radio" name="stType" ${pickup ? 'checked' : ''} onchange="stSetType('Pickup')">
                        <i class="fas fa-store"></i> <span><b>Pickup at hospital pharmacy</b><small>Free · collect at the counter</small></span></label>
                </div>
                <div class="st-row">
                    <div class="form-group"><label>Full name</label><input type="text" data-f="name" value="${shEsc(f.name)}" oninput="stField(this)" maxlength="100"></div>
                    <div class="form-group"><label>Mobile number</label><input type="tel" data-f="phone" value="${shEsc(f.phone)}" oninput="stField(this)" maxlength="14" placeholder="10-digit mobile number"></div>
                </div>
                ${pickup ? '' : `
                <div class="form-group"><label>Delivery address</label><textarea rows="2" data-f="address" oninput="stField(this)" maxlength="255" placeholder="House / flat no., street, landmark">${shEsc(f.address)}</textarea></div>
                <div class="st-row">
                    <div class="form-group"><label>City</label><input type="text" data-f="city" value="${shEsc(f.city)}" oninput="stField(this)" maxlength="60"></div>
                    <div class="form-group"><label>PIN code</label><input type="text" inputmode="numeric" data-f="pincode" value="${shEsc(f.pincode)}" oninput="stField(this)" maxlength="6" placeholder="6 digits"></div>
                </div>`}
                <div class="form-group"><label>Note for the pharmacy (optional)</label><input type="text" data-f="notes" value="${shEsc(f.notes)}" oninput="stField(this)" maxlength="255"></div>
                <button class="btn st-save" onclick="stSaveDetails()"><i class="fas fa-floppy-disk"></i> Save Details &amp; Continue</button>
                <p class="st-hint" style="margin: .8rem 0 0;">The order summary appears after you save these details.</p>
            </div>`}
    </div>`;
}

function stDetailsKey() {
    return 'smartHealthDelivery:' + ((typeof currentUser !== 'undefined' && currentUser && currentUser.email) || 'guest');
}

function stField(el) {
    store.form[el.dataset.f] = el.value;
}

function stSetType(type) {
    store.form.delivery_type = type;
    stRenderCart();
}

// Returns the first problem with the delivery details, or '' when they are complete.
function stDetailsError() {
    const f = store.form;
    if (f.name.trim().length < 2) return 'Please enter your full name.';
    if (!/^[6-9]\d{9}$/.test(stPhone(f.phone))) return 'Please enter a valid 10-digit mobile number.';
    if (f.delivery_type !== 'Pickup') {
        if (f.address.trim().length < 8) return 'Please enter your full delivery address.';
        if (!f.city.trim()) return 'Please enter your city.';
        if (!/^[1-9]\d{5}$/.test(f.pincode.trim())) return 'Please enter a valid 6-digit PIN code.';
    }
    return '';
}

// 09529288179 / +91 95292 88179 -> 9529288179
function stPhone(value) {
    return value.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
}

// Step 2 -> 3: the order summary is only shown once the details are complete and saved.
// They are remembered on this device so the next order starts with them filled in.
function stSaveDetails() {
    const problem = stDetailsError();
    if (problem) return shToast(problem, 'error');
    const f = store.form;
    ['name', 'address', 'city', 'pincode', 'notes'].forEach(k => f[k] = f[k].trim());
    f.phone = stPhone(f.phone);
    f.saved = true;
    localStorage.setItem(stDetailsKey(), JSON.stringify({ ...f, notes: '' }));
    stRenderCart();
    shToast('Delivery details saved. Check your order summary.', 'success');
    document.getElementById('st-summary').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function stEditDetails() {
    store.form.saved = false;
    stRenderCart();
}

function stPlaceOrder() {
    if (store.placing) return;
    const f = store.form, pickup = f.delivery_type === 'Pickup';
    const phone = stPhone(f.phone);
    if (!f.saved || stDetailsError()) return stEditDetails();

    store.placing = true;
    const btn = document.getElementById('st-place');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Placing order…';

    shPost('storeApi.php?action=placeOrder', {
        name: f.name, phone, delivery_type: f.delivery_type, address: f.address, city: f.city, pincode: f.pincode.trim(), notes: f.notes,
        payment: stPayMethod(),
        items: JSON.stringify(Object.keys(store.cart).map(id => ({ id: +id, qty: store.cart[id] })))
    }).then(res => {
        store.placing = false;
        if (res.status !== 'success') {
            if (/log in/i.test(res.message || '')) return stNeedLogin();
            shToast(res.message || 'Could not place the order.', 'error');
            // stock changed under us: reload so the cart shows what is really available
            return loadStore();
        }
        store.cart = {};
        stSaveCart();
        store.form.notes = '';
        store.tab = 'orders';
        loadStore().then(() => stTab('orders'));
        // a UPI order goes straight to the payment screen; a cash order is done
        if (res.pay) stShowPay({ id: res.id, order_no: res.order_no, total: res.total, pay: res.pay }, true);
        else stShowPlaced(res, pickup);
    }).catch(() => {
        store.placing = false;
        shToast('Could not reach the hospital. Check your internet and try again.', 'error');
        stRenderCart();
    });
}

function stShowPlaced(res, pickup) {
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sh-success" id="stPlaced" onclick="if (event.target === this) this.remove()">
            <div class="sh-success-card">
                <div class="sh-check"><i class="fas fa-check"></i></div>
                <h2>Order Placed!</h2>
                <p class="sh-sub">The pharmacy has received your order.</p>
                <div class="sh-token"><small>ORDER NUMBER</small><b style="font-size: 30px;">${shEsc(res.order_no)}</b></div>
                <div class="sh-details">
                    <div><i class="fas fa-indian-rupee-sign"></i> ${stMoney(res.total)} <span>${pickup ? 'pay at pickup' : 'cash on delivery'}</span></div>
                    <div><i class="fas ${pickup ? 'fa-store' : 'fa-truck'}"></i> ${pickup ? 'Pickup at hospital pharmacy' : 'Home delivery'}</div>
                </div>
                <p class="sh-mail"><i class="fas fa-envelope"></i> Updates will be emailed to <b>${shEsc(res.email)}</b> at every step.</p>
                <div class="sh-actions"><button onclick="document.getElementById('stPlaced').remove()">Track my order</button></div>
            </div>
        </div>`);
}

// ---------------------------------------------------------------- UPI payment
// 'UPI' or 'COD' for the order being placed; UPI is offered only when the hospital has set its UPI ID
function stPayMethod() {
    return store.upi && store.form && store.form.payment !== 'COD' ? 'UPI' : 'COD';
}

function stSetPay(method) {
    store.form.payment = method;
    stRenderCart();
}

// Payment screen: QR code for any UPI app, then the patient types the 12-digit UTR as proof.
// o = { id, order_no, total, pay: { upi_link, upi_id, payee, seconds_left } }
function stShowPay(o, justPlaced) {
    stClosePay();
    const phone = window.matchMedia('(pointer: coarse)').matches; // on a phone the UPI app can be opened directly
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sh-success" id="stPay">
            <div class="sh-success-card st-paycard">
                <h2>Pay ${stMoney(o.total)} by UPI</h2>
                <p class="sh-sub">${justPlaced ? 'Order placed. ' : ''}Order ${shEsc(o.order_no)} is reserved for you — <b id="stPayLeft"></b></p>
                <div class="st-pay-step"><span>1</span> Scan this QR with Google Pay, PhonePe, Paytm, BHIM or any UPI app</div>
                <div class="st-pay-qr" id="stPayQr"></div>
                ${phone ? `<a class="st-pay-open" href="${shEsc(o.pay.upi_link)}"><i class="fas fa-mobile-screen"></i> Open UPI app and pay</a>` : ''}
                <div class="st-pay-id">
                    <div><small>Paying to</small><b>${shEsc(o.pay.payee)}</b></div>
                    <div><small>UPI ID</small><b>${shEsc(o.pay.upi_id)}</b> <button onclick="stCopyUpi('${shEsc(o.pay.upi_id)}')" aria-label="Copy UPI ID"><i class="fas fa-copy"></i></button></div>
                    <div><small>Amount</small><b>${stMoney(o.total)}</b></div>
                </div>
                <div class="st-pay-step"><span>2</span> After paying, enter the 12-digit UTR / UPI reference number</div>
                <input class="sh-input" id="stPayUtr" inputmode="numeric" maxlength="12" placeholder="12-digit UTR" autocomplete="off"
                       oninput="this.value = this.value.replace(/\\D/g, '')">
                <p class="st-pay-help">You find it in your UPI app under the payment's details ("UTR" or "UPI transaction ID"). The pharmacy checks it and then confirms your order.</p>
                <div class="sh-actions">
                    <button class="ghost" onclick="stClosePay()">Pay later</button>
                    <button id="stPaySubmit" onclick="stSubmitUtr(${o.id})">I have paid — Submit</button>
                </div>
            </div>
        </div>`);
    new QRCode(document.getElementById('stPayQr'), { text: o.pay.upi_link, width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });

    stPayCountdown(+o.pay.seconds_left);
}

function stPayCountdown(left) {
    const tick = () => {
        const el = document.getElementById('stPayLeft');
        if (!el) return clearInterval(store.payTimer);
        if (left <= 0) {
            clearInterval(store.payTimer);
            stClosePay();
            shToast('The time to pay this order is over, so it was cancelled. Please place the order again.', 'error');
            return stLoadOrders(true);
        }
        el.textContent = `pay within ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
        left--;
    };
    tick();
    store.payTimer = setInterval(tick, 1000);
}

function stClosePay() {
    clearInterval(store.payTimer);
    const el = document.getElementById('stPay');
    if (el) el.remove();
}

function stCopyUpi(id) {
    navigator.clipboard.writeText(id).then(() => shToast('UPI ID copied.', 'success'), () => shToast('Could not copy. UPI ID: ' + id, 'error'));
}

function stPayNow(id) {
    const o = (store.orders || []).find(x => x.id == id);
    if (o && o.pay) stShowPay(o);
}

function stSubmitUtr(id) {
    const utr = document.getElementById('stPayUtr').value.trim();
    if (!/^\d{12}$/.test(utr)) return shToast('Please enter the 12-digit UTR from your UPI app.', 'error');
    const btn = document.getElementById('stPaySubmit');
    btn.disabled = true;
    shPost('storeApi.php?action=submitPayment', { id, utr }).then(res => {
        if (res.status !== 'success') {
            btn.disabled = false;
            return shToast(res.message || 'Could not record the payment.', 'error');
        }
        stClosePay();
        shToast('Thank you! The pharmacy will verify your payment and confirm the order.', 'success');
        if (store.tab === 'orders') stLoadOrders();
    }).catch(() => {
        btn.disabled = false;
        shToast('Could not reach the hospital. Check your internet and try again.', 'error');
    });
}

// Payment line of an order in My Orders
function stPayLine(o) {
    if (o.payment_method !== 'UPI') return '';
    const ref = o.payment_ref ? ` · UTR ${shEsc(o.payment_ref)}` : '';
    if (o.pay) return `<div class="st-payline due"><span><i class="fas fa-clock"></i> <b>Payment pending</b> — pay ${stMoney(o.total)} by UPI within ${Math.max(1, Math.ceil(o.pay.seconds_left / 60))} min or the order is cancelled.</span>
        <button onclick="stPayNow(${o.id})"><i class="fas fa-qrcode"></i> Pay now</button></div>`;
    const text = {
        'Submitted': `<i class="fas fa-hourglass-half"></i> <b>Payment being verified</b> by the pharmacy${ref}`,
        'Paid': `<i class="fas fa-circle-check"></i> <b>Paid online</b>${ref}`,
        'Refund Due': `<i class="fas fa-rotate-left"></i> <b>Refund of ${stMoney(o.total)} is being processed</b>${ref}`,
        'Refunded': `<i class="fas fa-rotate-left"></i> <b>Refund of ${stMoney(o.total)} sent</b> to your UPI account${ref}`
    }[o.payment_status];
    return text ? `<div class="st-payline ${o.payment_status === 'Paid' ? 'ok' : (o.payment_status === 'Submitted' ? 'wait' : '')}"><span>${text}</span></div>` : '';
}

function stNeedLogin() {
    document.getElementById('st-panel').innerHTML = `<div class="card" style="max-width:520px;">
        <p style="margin-bottom:15px;">For your security, please log in again to order medicines. Your cart will be kept.</p>
        <button class="btn" onclick="logout(true)">Log in again</button></div>`;
}

// ---------------------------------------------------------------- my orders
const ST_STATUS_TEXT = {
    'Placed': 'Waiting for the pharmacy to confirm your order.',
    'Confirmed': 'Confirmed — the pharmacy is preparing your medicines.',
    'Packed': 'Your medicines are packed.',
    'Out for Delivery': 'On the way to you. Please keep the cash ready. A 6-digit delivery OTP was emailed to you - tell it to the delivery person only when you have received your medicines.',
    'Ready for Pickup': 'Ready — collect it from the hospital pharmacy counter.',
    'Delivered': 'Delivered. Get well soon!',
    'Collected': 'Collected. Get well soon!'
};

function stLoadOrders(silent) {
    return fetch('storeApi.php?action=myOrders').then(r => r.json()).then(d => {
        if (store.tab !== 'orders') return;
        if (d.status !== 'success') return stNeedLogin();
        store.orders = d.orders;
        stRenderOrders();
        if (!silent) stEnter();
    }).catch(() => { if (!silent) shToast('Could not load your orders.', 'error'); });
}

function stRenderOrders() {
    const panel = document.getElementById('st-panel');
    if (store.orders === null) { panel.innerHTML = '<div class="st-skel" style="height: 16rem;"></div>'; return; }
    if (!store.orders.length) {
        panel.innerHTML = `<div class="card st-empty"><i class="fas fa-box-open"></i>
            <p>You have not ordered any medicines yet.</p><button class="btn" style="width:auto;" onclick="stTab('shop')">Browse medicines</button></div>`;
        return;
    }
    panel.innerHTML = store.orders.map((o, n) => {
        const cancelled = o.status === 'Cancelled', pickup = o.delivery_type === 'Pickup';
        const at = o.flow.indexOf(o.status);
        return `<div class="card st-order" style="--i: ${Math.min(n, 6)};">
            <div class="st-order-head">
                <div><span class="st-order-icon"><i class="fas ${pickup ? 'fa-store' : 'fa-box'}"></i></span><span><b>${shEsc(o.order_no)}</b><small>${shEsc(o.created_at)}</small></span></div>
                <span class="st-status ${cancelled ? 'cancelled' : (at === o.flow.length - 1 ? 'done' : '')}">${shEsc(o.status)}</span>
            </div>
            ${cancelled
                ? `<p class="st-cancelled"><i class="fas fa-ban"></i> This order was cancelled${o.cancel_reason ? ': ' + shEsc(o.cancel_reason) : '.'}</p>`
                : `<div class="st-steps">${o.flow.map((s, i) => `<div class="${i < at ? 'past' : (i === at ? 'now' : '')}" style="--n: ${i};"><span>${i < at ? '<i class="fas fa-check"></i>' : i + 1}</span>${shEsc(s)}</div>`).join('')}</div>
                   <p class="st-now">${shEsc(o.pay ? 'Waiting for your UPI payment.'
                       : (o.payment_status === 'Submitted' ? 'Your payment is being verified by the pharmacy.'
                       : (o.payment_status === 'Paid' && /Delivery|Pickup/.test(o.status) ? ST_STATUS_TEXT[o.status].replace(/ Please keep the cash ready\./, ' It is already paid.') : (ST_STATUS_TEXT[o.status] || ''))))}</p>`}
            ${stPayLine(o)}
            <div class="st-order-body">
                <div>
                    ${o.items.map(i => `<div class="st-item"><span>${shEsc(i.name)} × ${i.qty} ${shEsc(i.unit)}</span><span>${stMoney(i.line_total)}</span></div>`).join('')}
                    <div class="st-item"><span>${pickup ? 'Pickup' : 'Delivery'}</span><span>${+o.delivery_fee ? stMoney(o.delivery_fee) : 'Free'}</span></div>
                    <div class="st-item sum"><span>Total (${o.payment_method === 'UPI' ? 'UPI payment' : shEsc(o.payment_method)})</span><span>${stMoney(o.total)}</span></div>
                </div>
                <div class="st-where">
                    <p><i class="fas ${pickup ? 'fa-store' : 'fa-location-dot'}"></i> ${pickup ? 'Pickup at the hospital pharmacy counter' : `${shEsc(o.address)}, ${shEsc(o.city)} - ${shEsc(o.pincode)}`}</p>
                    <p><i class="fas fa-user"></i> ${shEsc(o.customer_name)} · ${shEsc(o.phone)}</p>
                    ${o.can_cancel ? `<button class="st-cancel" onclick="stCancelOrder(${o.id})">Cancel order</button>` : ''}
                </div>
            </div>
        </div>`;
    }).join('');
}

async function stCancelOrder(id) {
    const o = (store.orders || []).find(x => x.id == id);
    if (!o || !await shConfirm(`Cancel order ${o.order_no}?`, { yes: 'Yes, cancel order', no: 'Keep order', danger: true })) return;
    shPost('storeApi.php?action=cancelOrder', { id }).then(res => {
        if (res.status !== 'success') shToast(res.message || 'Could not cancel the order.', 'error');
        else shToast('Order cancelled.', 'success');
        stLoadOrders();
        // the cancelled medicines are back in stock
        fetch('storeApi.php?action=products').then(r => r.json()).then(d => { if (d.status === 'success') store.products = d.products; }).catch(() => {});
    });
}

stUpdateBadges();
