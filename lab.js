// Lab Tests page (patient site): the test catalogue, booking with home sample collection or a lab
// visit, the patient's bookings and their reports (printable, values flagged against normal ranges).
// Uses `currentUser`, switchView(), shToast() / shConfirm() and shEsc() from the main page scripts.

const LB_FLOW = ['Booked', 'Sample Collected', 'Processing', 'Report Ready'];
const LB_CART_KEY = 'smartHealthLabCart';
const lab = { loaded: false, tests: [], categories: [], cfg: {}, cart: [], tab: 'book', cat: 'All', q: '', bookings: [],
              mineLoaded: false, form: { collection: 'Home', date: '', slot: '' } };

try { lab.cart = JSON.parse(localStorage.getItem(LB_CART_KEY)) || []; } catch (e) { lab.cart = []; }

function lbMoney(v) { return '₹' + Math.round(+v || 0).toLocaleString('en-IN'); }
function lbToday(offset) {
    const d = new Date(Date.now() + (offset || 0) * 86400000);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function lbTest(code) { return lab.tests.find(t => t.code === code); }
function lbSaveCart() { try { localStorage.setItem(LB_CART_KEY, JSON.stringify(lab.cart)); } catch (e) {} }
function lbHours(h) { return h < 24 ? `${h} h` : (h % 24 ? `${h} h` : `${h / 24} day${h > 24 ? 's' : ''}`); }

// Called by switchView('lab')
function labOpen(tab) {
    if (tab) lab.tab = tab;
    lbTabs();
    if (!lab.loaded) {
        document.getElementById('lab-body').innerHTML = '<div class="lb-skeleton"></div><div class="lb-skeleton"></div>';
        fetch('api/lab?action=tests').then(r => r.json()).then(d => {
            if (d.status !== 'success') throw new Error();
            Object.assign(lab, { loaded: true, tests: d.tests, categories: d.categories, cfg: d });
            lab.cart = lab.cart.filter(c => lbTest(c));
            lbDraw();
        }).catch(() => {
            document.getElementById('lab-body').innerHTML = '<div class="ap-empty"><span class="ap-empty-art"><i class="fas fa-triangle-exclamation"></i></span><b>Could not load the lab tests</b>Please check your connection and open this page again.</div>';
        });
    } else {
        lbDraw();
    }
    lbLoadMine();
}

function lbTabs() {
    const open = lab.bookings.filter(b => ['Booked', 'Sample Collected', 'Processing'].includes(b.status)).length;
    const ready = lab.bookings.filter(b => b.status === 'Report Ready').length;
    document.getElementById('lbTabs').innerHTML = [
        ['book', 'fa-vials', 'Book tests', lab.cart.length || ''],
        ['my', 'fa-file-medical', 'My bookings & reports', lab.bookings.length || '']
    ].map(([k, icon, label, n]) => `<button type="button" class="lb-tab ${lab.tab === k ? 'active' : ''}" onclick="labTab('${k}')"><i class="fas ${icon}"></i>${label}${n !== '' ? `<b>${n}</b>` : ''}</button>`).join('');
    const nav = document.getElementById('navLab');
    if (nav) { nav.hidden = !(open || ready); nav.textContent = open + ready; }
}

function labTab(k) {
    lab.tab = k;
    lbTabs();
    lbDraw();
}

function lbDraw() {
    if (!lab.loaded && lab.tab === 'book') return;
    if (lab.tab === 'my') return lbDrawMine();
    const body = document.getElementById('lab-body');
    if (!body.querySelector('.lb-layout')) {
        body.innerHTML = `
            <div class="lb-layout">
                <div class="lb-main">
                    <div class="lb-tools">
                        <label class="lb-find"><i class="fas fa-magnifying-glass"></i><input type="search" id="lbFind" placeholder="Search a test, e.g. thyroid, sugar, vitamin D" value="${shEsc(lab.q)}"></label>
                    </div>
                    <div class="lb-cats" id="lbCats"></div>
                    <div class="lb-grid" id="lbGrid"></div>
                </div>
                <aside class="lb-side" id="lbSide"></aside>
            </div>`;
        document.getElementById('lbFind').addEventListener('input', e => { lab.q = e.target.value.trim().toLowerCase(); lbDrawGrid(); });
    }
    lbDrawGrid();
    lbDrawSide();
}

function lbDrawGrid() {
    const cats = ['All', ...lab.categories];
    document.getElementById('lbCats').innerHTML = cats.map(c => `<button type="button" class="${c === lab.cat ? 'active' : ''}" onclick="lab.cat='${shEsc(c)}'; lbDrawGrid()">${shEsc(c)}</button>`).join('');
    const q = lab.q;
    const shown = lab.tests.filter(t => (lab.cat === 'All' || t.category === lab.cat)
        && (!q || (t.name + ' ' + t.code + ' ' + t.category + ' ' + t.description + ' ' + t.includes.map(i => i.name).join(' ')).toLowerCase().includes(q)));
    const inPackage = code => lab.cart.map(lbTest).find(p => p && p.is_package && p.includes.some(i => i.code === code));
    document.getElementById('lbGrid').innerHTML = shown.length ? shown.map((t, i) => {
        const added = lab.cart.includes(t.code), covered = !added && inPackage(t.code);
        return `
        <article class="lb-card ${t.is_package ? 'is-pkg' : ''} ${added ? 'is-added' : ''}" style="--i: ${Math.min(i, 10)};">
            <div class="lb-card-top">
                <span class="lb-cat">${shEsc(t.category)}</span>
                ${t.popular && !t.is_package ? '<span class="lb-pop"><i class="fas fa-star"></i>Popular</span>' : ''}
            </div>
            <h4>${shEsc(t.name)}</h4>
            <p>${shEsc(t.description)}</p>
            ${t.is_package ? `<div class="lb-includes"><b>${t.includes.length} tests · ${t.parameter_count} parameters</b>${t.includes.map(x => `<span>${shEsc(x.name)}</span>`).join('')}</div>` : ''}
            <div class="lb-chips">
                ${t.sample ? `<span><i class="fas fa-vial"></i>${shEsc(t.sample)}</span>` : ''}
                <span><i class="far fa-clock"></i>Report in ${lbHours(t.tat_hours)}</span>
                ${t.fasting_hours ? `<span class="is-warn"><i class="fas fa-utensils"></i>${t.fasting_hours} h fasting</span>` : '<span><i class="fas fa-mug-hot"></i>No fasting</span>'}
                <span class="${t.home ? 'is-ok' : ''}"><i class="fas ${t.home ? 'fa-house-medical' : 'fa-hospital'}"></i>${t.home ? 'Home collection' : 'At the hospital'}</span>
                ${!t.is_package && t.parameter_count > 1 ? `<span><i class="fas fa-list-check"></i>${t.parameter_count} parameters</span>` : ''}
            </div>
            <div class="lb-card-foot">
                <div class="lb-price"><b>${lbMoney(t.price)}</b>${t.worth && t.worth > t.price ? `<s>${lbMoney(t.worth)}</s><em>Save ${lbMoney(t.worth - t.price)}</em>` : ''}</div>
                ${covered ? `<span class="lb-covered"><i class="fas fa-check"></i>In ${shEsc(covered.name)}</span>`
                    : `<button type="button" class="lb-add" onclick="lbToggle('${t.code}')">${added ? '<i class="fas fa-check"></i>Added' : '<i class="fas fa-plus"></i>Add'}</button>`}
            </div>
        </article>`;
    }).join('') : '<div class="ap-empty" style="grid-column: 1 / -1;"><span class="ap-empty-art"><i class="fas fa-flask"></i></span><b>No test found</b>Try another word or category.</div>';
}

function lbToggle(code) {
    const t = lbTest(code);
    if (lab.cart.includes(code)) {
        lab.cart = lab.cart.filter(c => c !== code);
    } else {
        // a package replaces the single tests it already contains
        if (t.is_package) {
            const dropped = lab.cart.filter(c => t.includes.some(i => i.code === c));
            if (dropped.length) shToast(`${dropped.map(c => lbTest(c).name).join(', ')} ${dropped.length > 1 ? 'are' : 'is'} included in ${t.name}, so removed from your list.`, 'info');
            lab.cart = lab.cart.filter(c => !dropped.includes(c));
        }
        lab.cart.push(code);
    }
    lbSaveCart();
    lbTabs();
    lbDrawGrid();
    lbDrawSide();
}

function lbChosen() { return lab.cart.map(lbTest).filter(Boolean); }

function lbTotals() {
    const chosen = lbChosen(), home = lab.form.collection === 'Home';
    const subtotal = chosen.reduce((s, t) => s + t.price, 0);
    const fee = home && subtotal && subtotal <= lab.cfg.free_above ? lab.cfg.home_fee : 0;
    return { chosen, home, subtotal, fee, total: subtotal + fee, fasting: Math.max(0, ...chosen.map(t => t.fasting_hours)),
             homeOk: chosen.every(t => t.home) };
}

function lbSlotOk(date, slot, home) {
    if (date !== lbToday()) return true;
    const m = slot.match(/(\d+):(\d+) (AM|PM)/);
    let h = +m[1] % 12 + (m[3] === 'PM' ? 12 : 0);
    const at = new Date(); at.setHours(h, +m[2], 0, 0);
    return at - Date.now() > (home ? 60 : 15) * 60000;
}

function lbDrawSide() {
    const side = document.getElementById('lbSide');
    if (!side) return;
    const t = lbTotals(), f = lab.form;
    if (!t.homeOk && f.collection === 'Home') f.collection = 'Lab';
    const keep = {};
    side.querySelectorAll('input, textarea, select').forEach(el => { if (el.id) keep[el.id] = el.value; });
    const u = currentUser || {};
    const val = (id, fallback) => shEsc(keep[id] !== undefined ? keep[id] : (fallback ?? ''));
    if (!f.date) f.date = lbToday();
    const slots = f.collection === 'Home' ? lab.cfg.home_slots : lab.cfg.lab_slots;
    if (f.slot && (!slots.includes(f.slot) || !lbSlotOk(f.date, f.slot, f.collection === 'Home'))) f.slot = '';

    side.innerHTML = `
        <div class="lb-box">
            <h4><i class="fas fa-basket-shopping"></i>Your tests <small>${t.chosen.length}</small></h4>
            ${t.chosen.length ? `<ul class="lb-cart">${t.chosen.map(x => `<li><span>${shEsc(x.name)}${x.is_package ? `<small>${x.includes.length} tests</small>` : ''}</span><b>${lbMoney(x.price)}</b>
                <button type="button" onclick="lbToggle('${x.code}')" aria-label="Remove"><i class="fas fa-xmark"></i></button></li>`).join('')}</ul>`
                : '<p class="lb-muted">Add tests from the list. Not sure which? A <b>health package</b> covers the common checks at a lower price.</p>'}
        </div>
        ${t.chosen.length ? `
        <div class="lb-box">
            <h4><i class="fas fa-truck-droplet"></i>Sample collection</h4>
            <div class="lb-modes">
                <button type="button" class="${f.collection === 'Home' ? 'active' : ''}" ${t.homeOk ? '' : 'disabled'} onclick="lab.form.collection='Home'; lbDrawSide()">
                    <i class="fas fa-house-medical"></i><span><b>Home collection</b><small>${t.homeOk ? (t.subtotal > lab.cfg.free_above ? 'Free' : lbMoney(lab.cfg.home_fee) + ' (free above ' + lbMoney(lab.cfg.free_above) + ')') : 'Not for ECG / X-ray'}</small></span></button>
                <button type="button" class="${f.collection === 'Lab' ? 'active' : ''}" onclick="lab.form.collection='Lab'; lbDrawSide()">
                    <i class="fas fa-hospital"></i><span><b>Visit the lab</b><small>No charge · ${shEsc(lab.cfg.lab.address.split(',').slice(-3, -1).join(',') || 'at the hospital')}</small></span></button>
            </div>
            <div class="lb-form">
                <div class="lb-row">
                    <label>Patient name<input id="lbName" value="${val('lbName', u.name)}" autocomplete="name"></label>
                </div>
                <div class="lb-row lb-row--3">
                    <label>Age<input id="lbAge" type="number" min="0" max="120" value="${val('lbAge', u.age)}"></label>
                    <label>Gender<select id="lbGender">${['', 'Male', 'Female', 'Other'].map(g => `<option value="${g}" ${(keep.lbGender || '') === g ? 'selected' : ''}>${g || 'Choose'}</option>`).join('')}</select></label>
                    <label>Mobile<input id="lbPhone" type="tel" value="${val('lbPhone', u.phone)}" autocomplete="tel"></label>
                </div>
                ${f.collection === 'Home' ? `<label>Collection address<textarea id="lbAddress" rows="2" placeholder="Flat / house no., building, street, area, PIN">${val('lbAddress', u.address)}</textarea></label>`
                    : `<p class="lb-where"><i class="fas fa-location-dot"></i>${shEsc(lab.cfg.lab.name)}, ${shEsc(lab.cfg.lab.address)}</p>`}
                <label>Date<input id="lbDate" type="date" min="${lbToday()}" max="${lbToday(lab.cfg.days_ahead)}" value="${shEsc(f.date)}" onchange="lab.form.date=this.value; lbDrawSide()"></label>
                <span class="lb-label">Time ${f.collection === 'Home' ? '(the collector reaches within this hour)' : ''}</span>
                <div class="lb-slots">${slots.map(s => {
                    const okSlot = lbSlotOk(f.date, s, f.collection === 'Home');
                    return `<button type="button" class="${f.slot === s ? 'active' : ''}" ${okSlot ? '' : 'disabled'} onclick="lab.form.slot='${s}'; lbDrawSide()">${s}</button>`;
                }).join('')}</div>
                ${t.fasting && f.slot && /(1[2-9]|0[1-9]):\d\d PM|11:\d\d AM/.test(f.slot) ? `<p class="lb-warn"><i class="fas fa-triangle-exclamation"></i>Fasting tests are best done early in the morning. Choose a slot before 11 AM if you can.</p>` : ''}
                <label>Referred by doctor <small>(optional)</small><input id="lbRef" value="${val('lbRef')}" placeholder="e.g. Dr. Patil"></label>
            </div>
            ${t.fasting ? `<p class="lb-prep"><i class="fas fa-utensils"></i><span><b>Fasting needed:</b> no food for ${t.fasting}-${t.fasting + 2} hours before the sample. Water is allowed.</span></p>` : ''}
            <div class="lb-total">
                <div><span>Tests</span><b>${lbMoney(t.subtotal)}</b></div>
                ${f.collection === 'Home' ? `<div><span>Home collection</span><b>${t.fee ? lbMoney(t.fee) : 'Free'}</b></div>` : ''}
                <div class="is-sum"><span>Total · pay at collection</span><b>${lbMoney(t.total)}</b></div>
            </div>
            <button type="button" class="btn lb-book" id="lbBookBtn" onclick="lbBook()"><i class="fas fa-calendar-check"></i>Book ${t.chosen.length} test${t.chosen.length > 1 ? 's' : ''} · ${lbMoney(t.total)}</button>
        </div>` : ''}`;
}

async function lbBook() {
    if (!currentUser) return shToast('Please log in to book lab tests.', 'error');
    const t = lbTotals(), f = lab.form, get = id => (document.getElementById(id) || {}).value || '';
    const missing = [];
    if (get('lbName').trim().length < 2) missing.push('patient name');
    if (get('lbAge') === '') missing.push('age');
    if (!get('lbGender')) missing.push('gender');
    if (get('lbPhone').replace(/\D/g, '').length < 10) missing.push('10-digit mobile number');
    if (f.collection === 'Home' && get('lbAddress').trim().length < 10) missing.push('collection address');
    if (!f.slot) missing.push('time slot');
    if (missing.length) return shToast('Please fill in: ' + missing.join(', ') + '.', 'error');

    const btn = document.getElementById('lbBookBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Booking…';
    const fd = new FormData();
    Object.entries({ items: JSON.stringify(lab.cart), patient_name: get('lbName').trim(), age: get('lbAge'), gender: get('lbGender'),
        phone: get('lbPhone'), collection_type: f.collection, address: get('lbAddress'), date: f.date, slot: f.slot, referred_by: get('lbRef') })
        .forEach(([k, v]) => fd.append(k, v));
    try {
        const res = await fetch('api/lab?action=book', { method: 'POST', body: fd }).then(r => r.json());
        if (res.status !== 'success') throw new Error(res.message || 'Could not book the tests.');
        const tests = t.chosen.map(x => x.name), booked = { ...f };
        lab.cart = [];
        lab.form.slot = '';
        lbSaveCart();
        lbBooked(res, tests, booked);
        document.querySelector('.main-content').scrollTo(0, 0);
        lab.mineLoaded = false;
        lab.tab = 'my';
        lbTabs();
        lbLoadMine();
    } catch (e) {
        shToast(e.message === 'Failed to fetch' ? 'Server connection failed.' : e.message, 'error');
        btn.disabled = false;
        lbDrawSide();
    }
}

function lbBooked(res, tests, f) {
    const nice = new Date(f.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sh-success" id="shSuccess" onclick="if (event.target === this) closeBookingSuccess()">
            <div class="sh-success-card">
                <div class="sh-check"><i class="fas fa-check"></i></div>
                <h2>Lab test booked!</h2>
                <p class="sh-sub">${f.collection === 'Home' ? 'A collector will come to your address.' : 'Please come to the lab at your time.'}</p>
                <div class="sh-token"><small>BOOKING NUMBER</small><b style="font-size: 1.6rem;">${shEsc(res.booking_no)}</b></div>
                <div class="sh-details">
                    <div><i class="fas fa-vials"></i> ${shEsc(tests.join(', '))}</div>
                    <div><i class="far fa-calendar"></i> ${shEsc(nice)} · ${shEsc(f.slot)}</div>
                    <div><i class="fas fa-indian-rupee-sign"></i> ${lbMoney(res.total)} <span>pay at collection</span></div>
                </div>
                ${res.preparation ? `<p class="sh-mail" style="text-align: left; white-space: pre-line;"><i class="fas fa-clipboard-list"></i> ${shEsc(res.preparation)}</p>` : ''}
                <div class="sh-actions">
                    <button onclick="closeBookingSuccess()">Done</button>
                </div>
            </div>
        </div>`);
}

// ---------------------------------------------------------------- my bookings

function lbLoadMine() {
    if (!currentUser) return;
    fetch('api/lab?action=my').then(r => r.json()).then(d => {
        if (d.status !== 'success') {
            if (lab.tab === 'my') document.getElementById('lab-body').innerHTML = `<div class="ap-empty"><span class="ap-empty-art"><i class="fas fa-lock"></i></span><b>Please log in again</b>For your privacy, lab reports open only after a fresh login.
                <button type="button" class="ap-btn" onclick="logout(true)"><i class="fas fa-arrow-right-to-bracket"></i>Log in again</button></div>`;
            return;
        }
        lab.bookings = d.bookings;
        lab.mineLoaded = true;
        lbTabs();
        if (lab.tab === 'my') lbDrawMine();
    }).catch(() => {});
}

function lbDrawMine() {
    const body = document.getElementById('lab-body');
    if (!lab.mineLoaded) { body.innerHTML = '<div class="lb-skeleton"></div>'; return; }
    if (!lab.bookings.length) {
        body.innerHTML = `<div class="ap-empty"><span class="ap-empty-art"><i class="fas fa-flask-vial"></i></span><b>No lab bookings yet</b>Book a test and your reports will appear here.
            <button type="button" class="ap-btn" onclick="labTab('book')"><i class="fas fa-plus"></i>Book a test</button></div>`;
        return;
    }
    body.innerHTML = '<div class="lb-mine">' + lab.bookings.map((b, i) => {
        const at = LB_FLOW.indexOf(b.status), off = b.status === 'Cancelled';
        const date = new Date(b.slot_date + 'T00:00:00');
        return `
        <article class="ap-card ${off ? 'is-off' : (b.status === 'Report Ready' ? 'is-done' : 'is-accepted')}" style="--i: ${Math.min(i, 8)};">
            <div class="ap-date"><small>${date.toLocaleDateString('en-IN', { month: 'short' })}</small><b>${date.getDate()}</b><span>${shEsc(b.slot_time)}</span></div>
            <div class="ap-main">
                <div class="ap-doc"><div style="min-width: 0;"><h4>${shEsc(b.items.map(x => x.name).join(', '))}</h4>
                    <p>${shEsc(b.booking_no)} · ${shEsc(b.patient_name)} (${shEsc(b.age)} ${shEsc((b.gender || '')[0] || '')})</p></div></div>
                <div class="ap-meta">
                    <span><i class="fas ${b.collection_type === 'Home Collection' ? 'fa-house-medical' : 'fa-hospital'}"></i>${shEsc(b.collection_type)}</span>
                    <span><i class="fas fa-indian-rupee-sign"></i>${lbMoney(b.total)}</span>
                    ${b.status === 'Report Ready' ? `<span class="${b.abnormal ? 'lb-flagged' : 'ap-when'}">${b.abnormal ? `${b.abnormal} value${b.abnormal > 1 ? 's' : ''} outside range` : 'All values in range'}</span>` : ''}
                    ${b.fasting_hours && b.status === 'Booked' ? `<span class="lb-flagged"><i class="fas fa-utensils"></i>${b.fasting_hours} h fasting</span>` : ''}
                </div>
                ${off ? `<p class="ap-note"><i class="fas fa-circle-info"></i>This booking was cancelled${b.cancel_reason && b.cancelled_by === 'lab' ? ': ' + shEsc(b.cancel_reason) : ''}.</p>` : apSteps(['Booked', 'Collected', 'Processing', 'Report ready'], at + 1)}
            </div>
            <div class="ap-side">
                <span class="ap-status"><i class="fas ${off ? 'fa-ban' : (b.status === 'Report Ready' ? 'fa-file-circle-check' : 'fa-hourglass-half')}"></i>${shEsc(b.status)}</span>
                ${b.status === 'Report Ready' ? `<button type="button" class="ap-btn" onclick="lbReport(${+b.id})"><i class="fas fa-file-medical"></i>View report</button>` : ''}
                ${b.can_cancel ? `<button type="button" class="ap-btn ap-btn--danger" onclick="lbCancel(${+b.id})"><i class="fas fa-xmark"></i>Cancel</button>` : ''}
            </div>
        </article>`;
    }).join('') + '</div>';
}

async function lbCancel(id) {
    if (!await shConfirm('Cancel this lab booking?', { yes: 'Yes, cancel it', danger: true })) return;
    const res = await fetch('api/lab?action=cancel', { method: 'POST', body: new URLSearchParams({ id }) }).then(r => r.json()).catch(() => ({}));
    if (res.status !== 'success') return shToast(res.message || 'Could not cancel.', 'error');
    shToast('Lab booking cancelled.', 'success');
    lbLoadMine();
}

// ---------------------------------------------------------------- the report

// lbReportHtml() and LB_REPORT_CSS are in lab-report.js (shared with the admin panel)

function lbReport(id) {
    const b = lab.bookings.find(x => x.id === id);
    if (!b) return;
    document.body.insertAdjacentHTML('beforeend', `
        <div class="lb-report" id="lbReportBox" onclick="if (event.target === this) this.remove()">
            <div class="lb-report-panel">
                <div class="lb-report-bar">
                    <b><i class="fas fa-file-medical"></i> Lab report ${shEsc(b.booking_no)}</b>
                    <div><button type="button" class="ap-btn" onclick="lbPrint(${+id})"><i class="fas fa-print"></i>Print / Save PDF</button>
                    <button type="button" class="ap-btn" onclick="document.getElementById('lbReportBox').remove()"><i class="fas fa-xmark"></i>Close</button></div>
                </div>
                <style>${LB_REPORT_CSS}</style>
                <div class="lb-report-doc">${lbReportHtml(b)}</div>
            </div>
        </div>`);
}

function lbPrint(id) {
    const b = lab.bookings.find(x => x.id === id);
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) return shToast('Please allow pop-ups to print the report.', 'error');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lab report ${shEsc(b.booking_no)}</title>
        <style>body { margin: 24px; } ${LB_REPORT_CSS} @page { margin: 14mm; }</style></head><body>${lbReportHtml(b)}</body></html>`);
    w.document.close();
    w.onload = () => w.print();
}

// The Lab Tests tab badge is filled once the patient is known
document.addEventListener('DOMContentLoaded', () => { if (currentUser) setTimeout(lbLoadMine, 800); });
