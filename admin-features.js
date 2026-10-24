// Admin feature tabs: Analytics, SOS Alerts, Medicine Stock, Medicine Orders, Notifications.
// Loaded by admin.html. These endpoints need a real admin login (server session).

function afEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function afApi(file, action, params, postData) {
    let url = `${file}?action=${action}`;
    Object.keys(params || {}).forEach(k => url += '&' + k + '=' + encodeURIComponent(params[k]));
    const opts = {};
    if (postData) {
        const fd = new FormData();
        Object.keys(postData).forEach(k => fd.append(k, postData[k] ?? ''));
        opts.method = 'POST';
        opts.body = fd;
    }
    return fetch(url, opts).then(r => r.json());
}

const AF_NO_SESSION = '<div class="feat-warn">Your session has ended. Please sign out and sign in again.</div>';

let afTimer = null, afOrderTimer = null, afMailTimer = null;

// Called after a successful admin login
function startAdminFeatures() {
    // only what the signed-in staff member's role includes is loaded and refreshed
    const can = perm => typeof adminCan !== 'function' || adminCan(perm);
    document.getElementById('an-from').value = afDate(-29);
    document.getElementById('an-to').value = afDate(0);
    clearInterval(afTimer);
    clearInterval(afOrderTimer);
    clearInterval(afMailTimer);
    if (can('sos')) { loadSos(); afTimer = setInterval(loadSos, 5000); } // SOS alerts must show up without a refresh
    if (can('medicines')) loadMedicines();
    if (can('orders')) { loadOrders(); afOrderTimer = setInterval(loadOrders, 20000); } // new orders show up on their own
    if (can('lab') && typeof loadLab === 'function') loadLab();
    afApi('api/admin', 'sendReminders').catch(() => {});
    if (can('notifications')) afMailTimer = setInterval(() => retryEmails(true), 60000);
}

// Stay logged in across a page refresh: if the server still has our admin session,
// go straight to the dashboard instead of showing the login form again.
(function resumeAdminSession() {
    const auth = document.getElementById('auth-view');
    auth.style.visibility = 'hidden'; // no login-form flash while we check
    fetch('api/admin?action=me').then(r => r.json()).then(res => {
        if (res.status !== 'success') throw new Error('not logged in');
        enterDashboard(res);
    }).catch(() => {}).finally(() => { auth.style.visibility = ''; });
})();

function stopAdminFeatures() {
    clearInterval(afTimer);
    clearInterval(afOrderTimer);
    clearInterval(afMailTimer);
    document.getElementById('sos-banner').classList.remove('show');
}

// Called by switchTab()
function onFeatureTab(tabId) {
    if (tabId === 'analytics-tab') loadAnalytics();
    else if (tabId === 'sos-tab') { loadSos(); setTimeout(() => sosMap && sosMap.invalidateSize(), 200); }
    else if (tabId === 'medicine-tab') loadMedicines();
    else if (tabId === 'orders-tab') loadOrders();
    else if (tabId === 'notifications-tab') loadNotifications();
}

function afDate(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function afOpenTab(tabId) {
    switchTab(tabId);
}

// =====================================================================
// ANALYTICS
// =====================================================================
const afCharts = {};
if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
    Chart.defaults.color = '#5b6777';
    Chart.defaults.borderColor = '#e6eaf0';
}

function afChart(id, type, labels, data, color, options) {
    if (typeof Chart === 'undefined') return; // chart library did not load (offline)
    if (afCharts[id]) afCharts[id].destroy();
    afCharts[id] = new Chart(document.getElementById(id), {
        type,
        data: { labels, datasets: [{ data, backgroundColor: color, borderColor: Array.isArray(color) ? '#fff' : color, borderWidth: type === 'line' ? 2 : 1, tension: .3, fill: false, pointRadius: 3 }] },
        options: Object.assign({
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: type === 'doughnut', position: 'bottom' } },
            scales: type === 'doughnut' ? {} : { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }, options || {})
    });
}

function loadAnalytics() {
    const from = document.getElementById('an-from').value, to = document.getElementById('an-to').value;
    afApi('api/admin', 'analytics', { from, to }).then(d => {
        const stats = document.getElementById('an-stats');
        if (d.status !== 'success') { stats.innerHTML = AF_NO_SESSION; return; }
        const s = d.summary;
        stats.innerHTML = [
            ['Patients today', s.today], ['Appointments in range', s.total], ['Unique patients', s.patients],
            ['Average per day', s.avg_per_day], ['Busiest time slot', s.peak_slot || '—'], ['SOS alerts', s.sos]
        ].map(([l, v]) => `<div class="an-stat"><div class="v">${afEsc(v)}</div><div class="l">${l}</div></div>`).join('');

        // Fill days with no appointments so the line shows real gaps as zero
        const byDay = {};
        d.per_day.forEach(r => byDay[r.day] = +r.total);
        const days = [], counts = [];
        for (let t = new Date(d.from + 'T00:00:00'); t <= new Date(d.to + 'T00:00:00'); t.setDate(t.getDate() + 1)) {
            const key = new Date(t - t.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
            days.push(key.slice(5));
            counts.push(byDay[key] || 0);
        }
        const palette = ['#17539c', '#12877f', '#a8610a', '#5a4ea1', '#b3261e', '#1a7f4b', '#7a8797', '#c18a2e'];
        afChart('an-chart-day', 'line', days, counts, '#17539c');
        afChart('an-chart-hours', 'bar', d.busy_hours.map(r => r.time_slot), d.busy_hours.map(r => +r.total), '#12877f');
        afChart('an-chart-dept', 'doughnut', d.departments.map(r => r.department), d.departments.map(r => +r.total), palette);
        afChart('an-chart-status', 'doughnut', d.statuses.map(r => r.status), d.statuses.map(r => +r.total), palette);

        document.getElementById('an-doctors').innerHTML = d.doctors.length ? d.doctors.map(r => `
            <tr><td class="cell-strong">${afEsc(r.doctor)}</td><td>${r.total}</td><td>${r.completed}</td></tr>`).join('')
            : '<tr><td class="empty" colspan="3">No appointments in this date range.</td></tr>';
    });
}

function exportReport() {
    const from = document.getElementById('an-from').value, to = document.getElementById('an-to').value;
    window.location.href = `api/admin?action=export&from=${from}&to=${to}`;
}

// =====================================================================
// EMERGENCY SOS
// =====================================================================
let sosMap = null, sosLayer = null, sosKnownNew = null, sosFitKey = '';

function sosPin(kind, icon) {
    return L.divIcon({ className: '', html: `<div class="map-pin ${kind}"><i class="fas ${icon}"></i></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}

function sosBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.35, 0.7].forEach(t => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
            g.gain.setValueAtTime(0.25, ctx.currentTime + t);
            o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
        });
    } catch (e) { /* browser blocked audio */ }
}

// Which alerts the list shows: 'all' or one status. Set by the dashboard tiles.
let afSosFilter = 'all';
const AF_SOS_LABELS = { all: 'All alerts', New: 'Waiting for dispatch', Dispatched: 'Ambulance en route', Arrived: 'Ambulance on scene', Resolved: 'Resolved', Cancelled: 'Cancelled' };

function setSosFilter(filter) {
    afSosFilter = filter;
    loadSos();
}

// Dashboard tiles. The numbers are counted by the server over every alert and ambulance, not over the 50 alerts listed.
function renderSosStats(s) {
    const tiles = [
        ['New', 'Waiting', s.waiting, 'Need an ambulance now', 'fa-triangle-exclamation', s.waiting ? 'red' : ''],
        ['Dispatched', 'En route', s.dispatched, 'Ambulance on the way', 'fa-truck-medical', ''],
        ['Arrived', 'On scene', s.arrived, 'Ambulance has arrived', 'fa-location-dot', ''],
        ['Resolved', 'Resolved', s.resolved, 'Emergency closed', 'fa-circle-check', 'green'],
        ['Cancelled', 'Cancelled', s.cancelled, 'Cancelled by the caller', 'fa-ban', ''],
        ['all', 'All alerts', s.total, `${s.today} received today`, 'fa-bell', ''],
        [null, 'Ambulances available', s.available, `of ${s.fleet} in the fleet`, 'fa-truck-medical', s.available ? 'green' : (s.fleet ? 'red' : '')],
        [null, 'Ambulances busy', s.busy, `${s.offline} offline`, 'fa-road', '']
    ];
    document.getElementById('sos-stats').innerHTML = tiles.map(([f, label, value, hint, icon, tone]) => `
        <${f ? 'button type="button"' : 'div'} class="ord-stat ${tone ? 'tone-' + tone : ''} ${f && f === afSosFilter ? 'active' : ''}" ${f ? `onclick="setSosFilter('${f}')"` : ''}>
            <span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span>
            <span class="v">${value}</span>
            <span class="h">${hint}</span>
        </${f ? 'button' : 'div'}>`).join('');
}

function loadSos() {
    afApi('api/sos', 'list').then(d => {
        const list = document.getElementById('sos-list');
        if (d.status !== 'success') { list.innerHTML = AF_NO_SESSION; return; }

        renderSosStats(d.stats);
        const shown = afSosFilter === 'all' ? d.alerts : d.alerts.filter(a => a.status === afSosFilter);
        // waiting and active alerts are always in the list; only old closed ones can be cut off
        document.getElementById('sos-summary').innerHTML = `<b>${AF_SOS_LABELS[afSosFilter]}</b> &middot; ${shown.length} listed`
            + (d.stats.total > d.alerts.length ? ` &middot; latest ${d.alerts.length} of ${d.stats.total} alerts` : '');

        const waiting = d.alerts.filter(a => a.status === 'New');
        const active = d.alerts.filter(a => ['New', 'Dispatched', 'Arrived'].includes(a.status));
        const available = d.fleet.filter(f => f.status === 'Available');

        // Badge + flashing banner + sound for alerts nobody has dispatched yet
        const badge = document.getElementById('sos-badge');
        badge.textContent = d.stats.waiting;
        badge.classList.toggle('show', d.stats.waiting > 0);
        const banner = document.getElementById('sos-banner');
        banner.classList.toggle('show', d.stats.waiting > 0);
        banner.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${d.stats.waiting} EMERGENCY SOS ALERT${d.stats.waiting > 1 ? 'S' : ''} WAITING — click to open`;
        const newIds = waiting.map(a => a.id).join(',');
        if (sosKnownNew !== null && waiting.some(a => !sosKnownNew.split(',').includes(String(a.id)))) sosBeep();
        sosKnownNew = newIds;

        list.innerHTML = shown.length ? shown.map(a => {
            const hasLoc = a.lat !== null;
            let actions = '';
            if (a.status === 'New') {
                actions = `<div class="feat-inline">
                    <select id="sos-amb-${a.id}">
                        <option value="">Nearest available ambulance</option>
                        ${available.map(f => `<option value="${f.id}">${afEsc(f.vehicle_no)} — ${afEsc(f.driver_name)}</option>`).join('')}
                    </select>
                    <button class="btn btn--danger" onclick="dispatchSos(${a.id})">Dispatch</button>
                    <button class="btn btn--outline" onclick="resolveSos(${a.id})">Close</button>
                </div>`;
            } else if (a.status === 'Dispatched' || a.status === 'Arrived') {
                actions = `<p><i class="fas fa-truck-medical"></i> ${afEsc(a.vehicle_no)} — ${afEsc(a.driver_name)} ${afEsc(a.driver_phone || '')}</p>
                    <div class="feat-inline"><button class="btn btn--sm btn--success" onclick="resolveSos(${a.id})">Mark resolved</button></div>`;
            }
            return `<div class="sos-item ${afEsc(a.status)}">
                <h4><span>#${a.id} ${afEsc(a.name || 'Unknown person')}</span><span class="badge ${a.status === 'New' ? 'danger' : (a.status === 'Resolved' ? 'confirmed' : (a.status === 'Cancelled' ? 'manual' : 'accepted'))}">${afEsc(a.status)}</span></h4>
                <p><i class="fas fa-phone"></i> ${afEsc(a.phone || 'no phone')} &nbsp; <i class="far fa-clock"></i> ${afEsc(a.created_at)}</p>
                <p>${hasLoc
                    ? `<i class="fas fa-location-dot"></i> <a href="https://www.google.com/maps?q=${a.lat},${a.lng}" target="_blank" rel="noopener">${(+a.lat).toFixed(5)}, ${(+a.lng).toFixed(5)}</a> ${+a.accuracy === 0 && a.accuracy !== null ? '(pin set by caller)'
                        : (+a.accuracy > 500 ? `<b style="color: var(--danger);">(approximate, ±${(+a.accuracy / 1000).toFixed(1)} km — call to confirm)</b>` : `(±${afEsc(a.accuracy ?? '?')} m)`)}`
                    : '<i class="fas fa-location-dot"></i> Location not shared — call the person'}</p>
                ${actions}</div>`;
        }).join('') : `<p class="empty">${d.alerts.length ? 'No alerts in this list.' : 'No SOS alerts yet.'}</p>`;

        renderFleet(d.fleet);
        renderSosMap(d, active);
    }).catch(() => {});
}

function renderSosMap(d, active) {
    const el = document.getElementById('sos-admin-map');
    if (typeof L === 'undefined' || !el.offsetParent) return; // tab not visible yet
    if (!sosMap) {
        sosMap = L.map(el).setView([d.hospital.lat, d.hospital.lng], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'rt-tiles', attribution: '&copy; OpenStreetMap contributors' }).addTo(sosMap);
        sosLayer = L.layerGroup().addTo(sosMap);
    }
    sosLayer.clearLayers();
    const points = [];
    L.marker([d.hospital.lat, d.hospital.lng], { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="rt-start"><i></i><span>Hospital</span></div>' }), zIndexOffset: 400 }).addTo(sosLayer).bindPopup(afEsc(d.hospital.name));
    d.fleet.forEach(f => {
        if (f.lat === null) return;
        L.marker([+f.lat, +f.lng], { icon: sosPin('amb' + (f.status === 'Offline' ? ' off' : ''), 'fa-truck-medical') }).addTo(sosLayer)
            .bindPopup(`${afEsc(f.vehicle_no)} — ${afEsc(f.status)}`);
        if (f.status !== 'Offline') points.push([+f.lat, +f.lng]);
    });
    active.forEach(a => {
        if (a.lat === null) return;
        if (a.route) {
            L.polyline(a.route, { color: '#fff', weight: 9, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(sosLayer);
            L.polyline(a.route, { color: '#1a73e8', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round' }).addTo(sosLayer);
        }
        L.marker([+a.lat, +a.lng], { icon: L.divIcon({ className: '', iconSize: [34, 44], iconAnchor: [17, 42], html: '<div class="rt-pin"><i></i></div>' }), zIndexOffset: 600 }).addTo(sosLayer).bindPopup(`SOS #${a.id} — ${afEsc(a.status)}`);
        points.push([+a.lat, +a.lng]);
    });
    // Re-frame only when the set of active alerts changes, so the admin can pan freely
    const key = active.map(a => a.id).join(',');
    if (key !== sosFitKey && active.some(a => a.lat !== null)) {
        sosMap.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
    }
    sosFitKey = key;
}

function renderFleet(fleet) {
    const base = location.href.replace(/[^/]*$/, '');
    document.getElementById('fleet-body').innerHTML = fleet.length ? fleet.map(f => `
        <tr>
            <td class="cell-strong">${afEsc(f.vehicle_no)}</td>
            <td>${afEsc(f.driver_name)}<br>${afEsc(f.driver_phone || '')}</td>
            <td><span class="badge ${f.status === 'Available' ? 'confirmed' : (f.status === 'Busy' ? 'pending' : 'manual')}">${afEsc(f.status)}</span></td>
            <td><div class="link-box">${afEsc(base)}driver.html?t=${afEsc(f.driver_token)}</div></td>
            <td><div class="row-actions">
                <button class="btn btn--sm btn--outline" onclick="copyDriverLink('${afEsc(f.driver_token)}')"><i class="fas fa-copy"></i> Copy link</button>
                <button class="btn btn--sm btn--danger-soft" onclick="deleteAmbulanceUnit(${f.id})" title="Remove ambulance"><i class="fas fa-trash"></i></button>
            </div></td>
        </tr>`).join('') : '<tr><td class="empty" colspan="5">No ambulances yet. Add one below, then send the driver their link.</td></tr>';
}

function copyDriverLink(token) {
    const link = location.href.replace(/[^/]*$/, '') + 'driver.html?t=' + token;
    navigator.clipboard.writeText(link).then(() => shNotify('Driver link copied. Send it to the driver — they open it on their phone while on duty.'),
        () => shPrompt('Copy this driver link:', link, { readonly: true, yes: 'Done' }));
}

function dispatchSos(id) {
    afApi('api/sos', 'dispatch', {}, { id, ambulance_id: document.getElementById('sos-amb-' + id).value }).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        loadSos();
    });
}

async function resolveSos(id) {
    if (!await shConfirm('Close this emergency?', { yes: 'Yes, close it' })) return;
    afApi('api/sos', 'resolve', {}, { id }).then(loadSos);
}

function addAmbulanceUnit(e) {
    e.preventDefault();
    afApi('api/sos', 'addAmbulance', {}, {
        vehicle_no: document.getElementById('amb-vehicle').value,
        driver_name: document.getElementById('amb-driver').value,
        driver_phone: document.getElementById('amb-phone').value
    }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        e.target.reset();
        loadSos();
    });
}

async function deleteAmbulanceUnit(id) {
    if (!await shConfirm('Remove this ambulance from the fleet? Its driver link will stop working.', { yes: 'Remove', danger: true })) return;
    afApi('api/sos', 'deleteAmbulance', {}, { id }).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        loadSos();
    });
}

// =====================================================================
// MEDICINE STOCK + STORE PRODUCTS
// =====================================================================
let afMedicines = [];

function afMoney(v) {
    return '₹' + (+v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// patients only see a medicine when it is for sale, has a price and has not expired
function afInStore(m) {
    return !!(+m.for_sale && +m.price > 0 && !+m.expired);
}

// Each filter of the inventory table; the dashboard tiles use the same ones, so a tile and its list always agree
let afMedFilter = 'all';
const AF_MED_FILTERS = {
    all: () => true,
    store: afInStore,
    hidden: m => !afInStore(m),
    attention: m => !!(+m.low || +m.expired || +m.expiring),
    low: m => !!+m.low && +m.stock > 0,
    out: m => +m.stock <= 0,
    expiring: m => !!+m.expiring,
    expired: m => !!+m.expired
};
const AF_MED_LABELS = {
    all: 'All medicines', store: 'In patient store', hidden: 'Hidden from store', attention: 'Need attention',
    low: 'Low stock', out: 'Out of stock', expiring: 'Expiring soon', expired: 'Expired'
};

function setMedFilter(filter) {
    afMedFilter = filter;
    renderMedicines();
}

function loadMedicines() {
    afApi('api/admin', 'medicines').then(d => {
        if (d.status !== 'success') { document.getElementById('med-body').innerHTML = `<tr><td colspan="8">${AF_NO_SESSION}</td></tr>`; return; }
        afMedicines = d.medicines;

        const badge = document.getElementById('med-badge');
        badge.textContent = d.alerts;
        badge.classList.toggle('show', d.alerts > 0);

        const low = d.medicines.filter(m => +m.low), exp = d.medicines.filter(m => +m.expired || +m.expiring);
        document.getElementById('med-alerts').innerHTML = (low.length || exp.length) ? `<div class="feat-warn">
            ${low.length ? `<div><i class="fas fa-triangle-exclamation"></i> <b>Low stock:</b> ${low.map(m => `${afEsc(m.name)} (${m.stock} left)`).join(', ')}</div>` : ''}
            ${exp.length ? `<div><i class="fas fa-calendar-xmark"></i> <b>Expired / expiring within 30 days:</b> ${exp.map(m => `${afEsc(m.name)} (${afEsc(m.expiry_date)})`).join(', ')}</div>` : ''}
        </div>` : '';

        renderMedicines();
    }).catch(() => {});
}

// Dashboard tiles + the inventory table for the chosen tile. The server sends every medicine, so the counts are complete.
function renderMedicines() {
    const all = afMedicines, count = f => all.filter(AF_MED_FILTERS[f]).length;
    const units = all.reduce((t, m) => t + +m.stock, 0);
    const value = all.reduce((t, m) => t + (+m.expired ? 0 : +m.stock * +m.price), 0);
    const hidden = count('hidden'), attention = count('attention'), low = count('low'), out = count('out'), expiring = count('expiring'), expired = count('expired');
    const tiles = [
        ['all', 'All medicines', all.length, `${units.toLocaleString('en-IN')} unit${units === 1 ? '' : 's'} in stock`, 'fa-pills', ''],
        ['store', 'In patient store', count('store'), hidden ? `${hidden} hidden from store` : 'None hidden', 'fa-store', 'green'],
        ['attention', 'Need attention', attention, 'Low, expiring or expired', 'fa-triangle-exclamation', attention ? 'red' : ''],
        [null, 'Stock value', afMoney(value), 'At selling price, excl. expired', 'fa-indian-rupee-sign', 'green'],
        ['low', 'Low stock', low, 'At or below alert level', 'fa-arrow-trend-down', low ? 'amber' : ''],
        ['out', 'Out of stock', out, 'Nothing left to sell', 'fa-box-open', out ? 'red' : ''],
        ['expiring', 'Expiring soon', expiring, 'Within 30 days', 'fa-calendar-day', expiring ? 'amber' : ''],
        ['expired', 'Expired', expired, 'Not sold to patients', 'fa-calendar-xmark', expired ? 'red' : '']
    ];
    document.getElementById('med-stats').innerHTML = tiles.map(([f, label, v, hint, icon, tone]) => `
        <${f ? 'button type="button"' : 'div'} class="ord-stat ${tone ? 'tone-' + tone : ''} ${f && f === afMedFilter ? 'active' : ''}" ${f ? `onclick="setMedFilter('${f}')"` : ''}>
            <span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span>
            <span class="v">${v}</span>
            <span class="h">${hint}</span>
        </${f ? 'button' : 'div'}>`).join('');

    const rows = all.filter(AF_MED_FILTERS[afMedFilter]);
    document.getElementById('med-count').textContent = rows.length;
    document.getElementById('med-list-title').textContent = afMedFilter === 'all' ? 'Inventory' : 'Inventory - ' + AF_MED_LABELS[afMedFilter];
    document.getElementById('med-show-all').style.display = afMedFilter === 'all' ? 'none' : '';

    document.getElementById('med-body').innerHTML = rows.length ? rows.map(m => {
        const inStore = afInStore(m), isOut = +m.stock <= 0;
        return `
            <tr class="${+m.low ? 'stock-low' : ''}">
                <td>${m.image ? `<img class="med-thumb" src="${afEsc(m.image)}" alt="">` : '<span class="med-thumb none"><i class="fas fa-pills"></i></span>'}</td>
                <td class="cell-strong">${afEsc(m.name)}<br><small>${afEsc(m.category)}</small></td>
                <td>${afMoney(m.price)}<br><small>per ${afEsc(m.unit)}</small></td>
                <td><span class="stock-num">${m.stock}</span> ${afEsc(m.unit)}</td>
                <td>${m.reorder_level}</td>
                <td>${afEsc(m.expiry_date || '—')}</td>
                <td><div class="badge-stack">${+m.low ? `<span class="badge danger">${isOut ? 'Out of stock' : 'Low stock'}</span>` : ''} ${+m.expired ? '<span class="badge danger">Expired</span>' : ''}
                    ${+m.expiring ? '<span class="badge pending">Expiring soon</span>' : ''} ${(!+m.low && !+m.expired && !+m.expiring) ? '<span class="badge confirmed">OK</span>' : ''}
                    <span class="badge ${inStore ? 'accepted' : 'manual'}">${inStore ? 'In store' : 'Hidden from store'}</span></div></td>
                <td><div class="row-actions">
                    <button class="btn btn--sm btn--outline" onclick="adjustStock(${m.id}, 1)">+ Received</button>
                    <button class="btn btn--sm btn--outline" onclick="adjustStock(${m.id}, -1)">− Sold / Used</button>
                    <button class="btn btn--sm btn--outline" onclick="editMedicine(${m.id})">Edit</button>
                    <button class="btn btn--sm btn--danger-soft" onclick="deleteMedicine(${m.id})" title="Remove medicine"><i class="fas fa-trash"></i></button>
                </div></td>
            </tr>`;
    }).join('') : `<tr><td class="empty" colspan="8">${all.length ? 'No medicines in this list.' : 'No medicines added yet.'}</td></tr>`;
}

async function adjustStock(id, sign) {
    const qty = parseInt(await shPrompt(sign > 0 ? 'Quantity received:' : 'Quantity sold / used:', '10', { type: 'number', yes: 'Update stock' }), 10);
    if (!qty || qty < 0) return;
    afApi('api/admin', 'adjustStock', {}, { id, delta: sign * qty }).then(res => {
        if (res.status === 'success') shToast('Stock updated: ' + res.stock + ' in stock', 'success');
        else shToast(res.message || 'Could not update stock', 'error');
        loadMedicines();
    }).catch(() => shToast('Server connection error', 'error'));
}

function editMedicine(id) {
    const m = afMedicines.find(x => x.id == id);
    if (!m) return;
    document.getElementById('med-id').value = m.id;
    document.getElementById('med-name').value = m.name;
    document.getElementById('med-stock').value = m.stock;
    document.getElementById('med-reorder').value = m.reorder_level;
    document.getElementById('med-unit').value = m.unit;
    document.getElementById('med-expiry').value = m.expiry_date || '';
    document.getElementById('med-price').value = m.price;
    document.getElementById('med-desc').value = m.description || '';
    document.getElementById('med-sale').checked = !!+m.for_sale;
    const cat = document.getElementById('med-category');
    if (![...cat.options].some(o => o.value === m.category)) cat.add(new Option(m.category));
    cat.value = m.category;
    document.getElementById('med-image').value = ''; // left empty, the current photo is kept
    document.getElementById('med-save').textContent = 'Update Medicine';
    document.getElementById('med-form-title').textContent = 'Edit Medicine - ' + m.name;
    showMedicineModal();
}

function resetMedicineForm() {
    document.getElementById('med-form').reset();
    document.getElementById('med-id').value = '';
    document.getElementById('med-save').textContent = 'Save Medicine';
    document.getElementById('med-form-title').textContent = 'Add Medicine';
}

function showMedicineModal() {
    const modal = document.getElementById('medicineModal');
    modal.style.display = 'flex';
    modal.querySelector('.modal-content').scrollTop = 0;
    document.getElementById('med-name').focus();
}

// "Add Medicine" button: always a blank form, even if an edit was left open before
function openMedicineForm() {
    resetMedicineForm();
    showMedicineModal();
}

function closeMedicineForm() {
    document.getElementById('medicineModal').style.display = 'none';
    resetMedicineForm();
}

function saveMedicine(e) {
    e.preventDefault();
    const data = {
        id: document.getElementById('med-id').value,
        name: document.getElementById('med-name').value,
        stock: document.getElementById('med-stock').value,
        reorder_level: document.getElementById('med-reorder').value,
        unit: document.getElementById('med-unit').value,
        expiry_date: document.getElementById('med-expiry').value,
        price: document.getElementById('med-price').value,
        category: document.getElementById('med-category').value,
        description: document.getElementById('med-desc').value,
        for_sale: document.getElementById('med-sale').checked ? '1' : '0'
    };
    const photo = document.getElementById('med-image').files[0];
    if (photo) data.image = photo;
    const btn = document.getElementById('med-save');
    btn.disabled = true;
    afApi('api/admin', 'saveMedicine', {}, data).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shToast(data.id ? 'Medicine updated.' : 'Medicine added.', 'success');
        closeMedicineForm();
        loadMedicines();
    }).catch(() => shToast('Could not save the medicine. Please try again.', 'error'))
      .finally(() => { btn.disabled = false; });
}

async function deleteMedicine(id) {
    if (!await shConfirm('Remove this medicine from the stock list and the patient store?', { yes: 'Remove', danger: true })) return;
    afApi('api/admin', 'deleteMedicine', {}, { id }).then(loadMedicines);
}

// =====================================================================
// MEDICINE ORDERS (placed by patients from the store)
// =====================================================================
let afOrders = [], afOrderStats = null;
// Each filter of the orders list; the dashboard tiles use the same ones, so a tile and its list always agree
const AF_ORDER_FILTERS = {
    all: () => true,
    open: o => o.next_status !== null || o.payment_status === 'Refund Due',
    new: o => o.status === 'Placed' && o.payment_status !== 'Pending',
    unpaid: o => o.status === 'Placed' && o.payment_status === 'Pending',
    preparing: o => o.status === 'Confirmed' || o.status === 'Packed',
    dispatch: o => o.status === 'Out for Delivery' || o.status === 'Ready for Pickup',
    done: o => o.status === 'Delivered' || o.status === 'Collected',
    Cancelled: o => o.status === 'Cancelled',
    refund: o => o.payment_status === 'Refund Due'
};

function setOrderFilter(filter) {
    document.getElementById('ord-filter').value = filter;
    renderOrders();
}

// Dashboard tiles. The numbers are counted by the server over every order, not over the rows listed below.
function renderOrderStats(filter) {
    const s = afOrderStats;
    if (!s) return;
    const tiles = [
        ['new', 'New orders', s.new_orders, s.to_verify ? `${s.to_verify} UPI payment${s.to_verify > 1 ? 's' : ''} to verify` : 'To confirm', 'fa-bell', s.new_orders ? 'red' : ''],
        ['unpaid', 'Awaiting payment', s.awaiting_payment, 'UPI not paid yet', 'fa-hourglass-half', ''],
        ['preparing', 'Being prepared', s.preparing, 'Confirmed or packed', 'fa-box-open', ''],
        ['dispatch', 'Out / ready', s.dispatch, 'For delivery or pickup', 'fa-truck', ''],
        ['done', 'Completed', s.completed, 'Delivered or collected', 'fa-circle-check', 'green'],
        ['Cancelled', 'Cancelled', s.cancelled, s.refund_due ? `${s.refund_due} refund${s.refund_due > 1 ? 's' : ''} due` : 'No refunds due', 'fa-ban', s.refund_due ? 'amber' : ''],
        ['all', 'All orders', s.total, `${s.today} placed today`, 'fa-bag-shopping', ''],
        [null, 'Sales completed', afMoney(s.sales), `${afMoney(s.sales_today)} today`, 'fa-indian-rupee-sign', 'green']
    ];
    document.getElementById('ord-stats').innerHTML = tiles.map(([f, label, value, hint, icon, tone]) => `
        <${f ? 'button type="button"' : 'div'} class="ord-stat ${tone ? 'tone-' + tone : ''} ${f && f === filter ? 'active' : ''}" ${f ? `onclick="setOrderFilter('${f}')"` : ''}>
            <span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span>
            <span class="v">${value}</span>
            <span class="h">${hint}</span>
        </${f ? 'button' : 'div'}>`).join('');
}
const AF_ORDER_DONE = ['Delivered', 'Collected'];
// Button wording for the step the order moves to
const AF_ORDER_STEP = {
    'Confirmed': 'Confirm order', 'Packed': 'Mark packed', 'Out for Delivery': 'Send out for delivery',
    'Ready for Pickup': 'Ready for pickup', 'Delivered': 'Mark delivered', 'Collected': 'Mark collected'
};

const AF_PAY_TEXT = { 'Pending': 'Not paid yet', 'Submitted': 'Paid — to verify', 'Paid': 'Paid', 'Not Paid': 'Not paid', 'Refund Due': 'Refund due', 'Refunded': 'Refunded' };
const AF_PAY_BADGE = { 'Pending': 'pending', 'Submitted': 'danger', 'Paid': 'confirmed', 'Refund Due': 'danger', 'Refunded': 'manual' };
let afUpiId = '';

function loadOrders() {
    afApi('api/admin', 'orders').then(d => {
        if (d.status !== 'success') { document.getElementById('ord-list').innerHTML = AF_NO_SESSION; return; }
        afOrders = d.orders;
        afOrderStats = d.stats;
        afUpiId = d.upi_id || 'the hospital account';
        const badge = document.getElementById('ord-badge');
        badge.textContent = d.waiting;
        badge.classList.toggle('show', d.waiting > 0);
        renderOrders();
    }).catch(() => {});
}

function renderOrders() {
    const filter = document.getElementById('ord-filter').value;
    const rows = afOrders.filter(AF_ORDER_FILTERS[filter] || AF_ORDER_FILTERS.all);
    renderOrderStats(filter);
    const label = document.getElementById('ord-filter').selectedOptions[0].textContent;
    // only old finished orders can be missing from the list (it holds the 200 most relevant)
    const cut = afOrderStats && afOrderStats.total > afOrders.length;
    document.getElementById('ord-summary').innerHTML = `<b>${afEsc(label)}</b> &middot; ${rows.length} order${rows.length === 1 ? '' : 's'} listed`
        + (cut ? ` &middot; the list holds the ${afOrders.length} most recent orders of ${afOrderStats.total}; the counts above cover all of them` : '');
    document.getElementById('ord-list').innerHTML = rows.length ? rows.map(o => {
        const done = AF_ORDER_DONE.includes(o.status), pickup = o.delivery_type === 'Pickup', upi = o.payment_method === 'UPI';
        // UPI: the pharmacy checks the payment before it prepares the order
        const toVerify = upi && o.status === 'Placed' && o.payment_status === 'Submitted';
        const unpaid = upi && o.status === 'Placed' && o.payment_status === 'Pending';
        const refund = o.payment_status === 'Refund Due';
        const otpOut = !pickup && o.status === 'Out for Delivery';          // waiting for the delivery OTP
        const otpStep = !pickup && o.next_status === 'Delivered';
        const tone = (o.status === 'Placed' && !unpaid) || refund ? 'Placed' : (done ? 'done' : (o.status === 'Cancelled' ? '' : 'open'));
        const badge = o.status === 'Placed' ? 'danger' : (done ? 'confirmed' : (o.status === 'Cancelled' ? 'manual' : 'accepted'));
        return `<div class="ord-card ${tone}">
            <div class="ord-head">
                <h4>${afEsc(o.order_no)} <small>${afEsc(o.created_at)}</small></h4>
                <span class="badge ${unpaid ? 'pending' : badge}">${o.status === 'Placed' ? (unpaid ? 'Awaiting payment' : (toVerify ? 'New order — verify payment' : 'New order')) : afEsc(o.status)}</span>
            </div>
            <div class="ord-grid">
                <div>
                    <p><b>${afEsc(o.customer_name)}</b> &nbsp; <i class="fas fa-phone"></i> ${afEsc(o.phone)}</p>
                    <p><i class="fas fa-envelope"></i> ${afEsc(o.user_email)}</p>
                    <p><i class="fas ${pickup ? 'fa-store' : 'fa-truck'}"></i> <b>${pickup ? 'Pickup at pharmacy counter' : 'Home delivery'}</b></p>
                    ${pickup ? '' : `<p><i class="fas fa-location-dot"></i> ${afEsc(o.address)}, ${afEsc(o.city)} - ${afEsc(o.pincode)}</p>`}
                    <p><i class="fas ${upi ? 'fa-qrcode' : 'fa-money-bill'}"></i> ${upi ? '<b>UPI</b>' : afEsc(o.payment_method)}
                        ${upi ? `<span class="badge ${AF_PAY_BADGE[o.payment_status] || 'manual'}">${afEsc(AF_PAY_TEXT[o.payment_status] || o.payment_status)}</span>` : ''}</p>
                    ${o.payment_ref ? `<p><i class="fas fa-hashtag"></i> UTR <b class="ord-utr">${afEsc(o.payment_ref)}</b></p>` : ''}
                    ${o.notes ? `<p><i class="fas fa-note-sticky"></i> ${afEsc(o.notes)}</p>` : ''}
                    ${o.cancel_reason ? `<p style="color: var(--danger);"><i class="fas fa-ban"></i> ${afEsc(o.cancel_reason)}</p>` : ''}
                </div>
                <table class="ord-items">
                    ${o.items.map(i => `<tr><td>${afEsc(i.name)} × ${i.qty} ${afEsc(i.unit)}</td><td>${afMoney(i.line_total)}</td></tr>`).join('')}
                    <tr><td>Delivery</td><td>${+o.delivery_fee ? afMoney(o.delivery_fee) : 'Free'}</td></tr>
                    <tr class="sum"><td>${!upi ? 'Total to collect' : (o.payment_status === 'Paid' ? 'Total (paid by UPI)' : 'Total (UPI)')}</td><td>${afMoney(o.total)}</td></tr>
                </table>
            </div>
            ${toVerify ? `<div class="feat-warn" ><b>Check this payment first:</b> open your UPI app / bank statement for ${afEsc(afUpiId)} and look for
                ${afMoney(o.total)} with UTR <b>${afEsc(o.payment_ref)}</b>. Press "Payment received" only if it is really there.</div>` : ''}
            ${otpOut ? `<div class="feat-warn" ><b><i class="fas fa-key"></i> Delivery OTP:</b> a 6-digit OTP was emailed to ${afEsc(o.user_email)}.
                Hand over the medicines, then ask the patient for the OTP and enter it to complete the delivery.${o.otp_locked ? ' <b style="color: var(--danger);">Locked after too many wrong tries - press "Resend OTP".</b>' : ''}</div>` : ''}
            ${refund ? `<div class="feat-warn" ><b>Refund ${afMoney(o.total)}</b> to the patient from your UPI app (payment UTR ${afEsc(o.payment_ref || '—')}), then press "Refund sent".</div>` : ''}
            ${(o.next_status || refund) ? `<div class="ord-actions">
                ${toVerify ? `<button class="btn btn--success" onclick="orderPayment(${o.id}, 'verifyPayment')"><i class="fas fa-circle-check"></i> Payment received</button>
                              <button class="btn btn--warn" onclick="orderPayment(${o.id}, 'rejectPayment')">Payment not found</button>` : ''}
                ${unpaid ? '<span class="feat-note">Waiting for the patient to pay by UPI.</span>' : ''}
                ${refund ? `<button class="btn btn--success" onclick="orderPayment(${o.id}, 'markRefunded')"><i class="fas fa-rotate-left"></i> Refund sent</button>` : ''}
                ${o.next_status && !toVerify && !unpaid ? `<button class="btn btn--success" onclick="advanceOrder(${o.id})"><i class="fas ${otpStep ? 'fa-key' : 'fa-check'}"></i> ${otpStep ? 'Enter OTP &amp; mark delivered' : (AF_ORDER_STEP[o.next_status] || afEsc(o.next_status))}</button>` : ''}
                ${otpOut ? `<button class="btn btn--warn" onclick="resendOtp(${o.id})"><i class="fas fa-envelope"></i> Resend OTP</button>` : ''}
                ${o.next_status ? `<button class="btn btn--danger" onclick="cancelOrderAdmin(${o.id})">Cancel order</button>` : ''}
            </div>` : ''}
        </div>`;
    }).join('') : '<div class="card"><p class="empty">No orders in this list.</p></div>';
}

async function advanceOrder(id) {
    const o = afOrders.find(x => x.id == id);
    if (!o || !o.next_status) return;
    const body = { id, status: o.next_status };
    // a home delivery is finished only with the OTP the patient received by email
    if (o.next_status === 'Delivered' && o.delivery_type !== 'Pickup') {
        const otp = await shPrompt(`Ask the patient for the 6-digit delivery OTP (emailed to ${o.user_email}) and enter it:`, '', { yes: 'Verify & complete delivery' });
        if (otp === null) return;
        if (!/^\d{6}$/.test(otp.trim())) return shToast('The OTP is 6 digits.', 'error');
        body.otp = otp.trim();
    }
    afApi('api/admin', 'orderStatus', {}, body).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        else shToast(res.new_status === 'Out for Delivery' && o.delivery_type !== 'Pickup'
            ? `${o.order_no}: out for delivery. A delivery OTP has been emailed to the patient.`
            : `${o.order_no}: ${res.new_status}. The patient has been emailed.`, 'success');
        loadOrders();
    }).catch(() => shToast('Server connection error', 'error'));
}

async function resendOtp(id) {
    const o = afOrders.find(x => x.id == id);
    if (!o || !await shConfirm(`Email a NEW delivery OTP to ${o.user_email}? The old OTP will stop working.`, { yes: 'Send new OTP' })) return;
    afApi('api/admin', 'resendDeliveryOtp', {}, { id }).then(res => {
        shToast(res.status === 'success' ? 'A new OTP has been emailed to the patient.' : res.message, res.status === 'success' ? 'success' : 'error');
        loadOrders();
    }).catch(() => shToast('Server connection error', 'error'));
}

// UPI payment decisions: 'verifyPayment', 'rejectPayment' or 'markRefunded'
async function orderPayment(id, action) {
    const o = afOrders.find(x => x.id == id);
    if (!o) return;
    const ask = {
        verifyPayment: [`Have you seen ${afMoney(o.total)} with UTR ${o.payment_ref} in your UPI account?`, { yes: 'Yes, payment received' }, 'Payment verified. The patient has been emailed.'],
        rejectPayment: [`No payment with UTR ${o.payment_ref} arrived? The patient will be asked to check the UTR and enter it again.`, { yes: 'Payment not found', danger: true }, 'The patient has been asked for the correct UTR.'],
        markRefunded: [`Have you sent the refund of ${afMoney(o.total)} to the patient?`, { yes: 'Yes, refund sent' }, 'Marked as refunded. The patient has been emailed.']
    }[action];
    if (!await shConfirm(ask[0], ask[1])) return;
    afApi('api/admin', action, {}, { id }).then(res => {
        shToast(res.status === 'success' ? ask[2] : res.message, res.status === 'success' ? 'success' : 'error');
        loadOrders();
    });
}

async function cancelOrderAdmin(id) {
    const o = afOrders.find(x => x.id == id);
    if (!o) return;
    const reason = await shPrompt(`Cancel ${o.order_no}? The medicines go back into stock. Reason shown to the patient:`, 'Out of stock', { yes: 'Cancel order', no: 'Keep order' });
    if (reason === null) return;
    afApi('api/admin', 'cancelOrder', {}, { id, reason }).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        loadOrders();
        loadMedicines();
    });
}

// =====================================================================
// NOTIFICATIONS (email log)
// =====================================================================
function loadNotifications() {
    afApi('api/admin', 'notifications').then(d => {
        const tbody = document.getElementById('notif-body');
        if (d.status !== 'success') { tbody.innerHTML = `<tr><td colspan="5">${AF_NO_SESSION}</td></tr>`; return; }
        document.getElementById('notif-config').innerHTML = d.email_configured ? ''
            : `<div class="feat-warn"><b>Not delivering yet:</b> the Gmail address and app password are not set in the <code>.env</code> file (MAIL_GMAIL_ADDRESS, MAIL_GMAIL_APP_PASSWORD). Messages below marked "logged" were recorded but not actually sent.</div>`;
        tbody.innerHTML = d.notifications.length ? d.notifications.map(n => `
            <tr>
                <td>${afEsc(n.created_at)}</td>
                <td><span class="badge manual">${afEsc(n.channel)}</span></td>
                <td>${afEsc(n.recipient)}</td>
                <td>${afEsc(n.message)}</td>
                <td><span class="badge ${n.status === 'sent' ? 'confirmed' : (n.status === 'failed' ? 'danger' : 'pending')}" title="${afEsc(n.detail)}">${afEsc(n.status)}</span>${n.status === 'failed' ? `<br><small style="color: var(--danger);">${afEsc(n.detail)}</small>` : ''}</td>
            </tr>`).join('') : '<tr><td class="empty" colspan="5">No messages yet.</td></tr>';
    });
}

// Mails that failed while the internet was down are sent again. Runs by itself every minute
// (quietly) and from the "Retry failed emails" button.
function retryEmails(quiet) {
    afApi('api/admin', 'retryEmails').then(res => {
        if (res.status !== 'success') { if (!quiet) shToast(res.message, 'error'); return; }
        if (!quiet) {
            shToast(res.sent ? `${res.sent} email(s) delivered.` + (res.waiting ? ` ${res.waiting} still waiting.` : '')
                : (res.waiting ? `Could not reach Gmail — ${res.waiting} email(s) still waiting. Check the internet connection.` : 'No failed emails to send.'),
                res.waiting && !res.sent ? 'error' : 'success');
        }
        if (res.sent && document.getElementById('notifications-tab').classList.contains('active')) loadNotifications();
    }).catch(() => {});
}

function sendRemindersNow() {
    afApi('api/admin', 'sendReminders').then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shNotify(`${res.processed} appointment reminder(s) processed.`);
        loadNotifications();
    });
}

// =====================================================================
// DOCTOR RECORDS (click a name in Registered Doctors)
// =====================================================================
let afDocRecords = { pending: [], completed: [] };

function openDoctorRecords(id) {
    afDocRecords = { pending: [], completed: [] };
    document.getElementById('rec-title').textContent = 'Doctor Records';
    document.getElementById('rec-body').innerHTML = '<tr><td class="empty" colspan="6">Loading...</td></tr>';
    document.getElementById('doctorRecordsModal').style.display = 'flex';

    afApi('api/admin', 'doctorRecords', { id }).then(d => {
        if (d.status !== 'success') {
            document.getElementById('rec-body').innerHTML = `<tr><td colspan="6">${d.message === 'Doctor not found' ? 'Doctor not found.' : AF_NO_SESSION}</td></tr>`;
            return;
        }
        document.getElementById('rec-title').textContent = `${d.doctor.doctor_name} — ${d.doctor.specialization}`;
        // Pending = still to be seen (Pending / Accepted); Completed = Confirmed / Completed
        afDocRecords.pending = d.records.filter(r => r.status === 'Pending' || r.status === 'Accepted');
        afDocRecords.completed = d.records.filter(r => r.status === 'Confirmed' || r.status === 'Completed');
        showDoctorRecords('pending');
    }).catch(() => {
        document.getElementById('rec-body').innerHTML = '<tr><td colspan="6">Could not load records.</td></tr>';
    });
}

function showDoctorRecords(kind) {
    const pendingTab = document.getElementById('rec-tab-pending'), completedTab = document.getElementById('rec-tab-completed');
    pendingTab.textContent = `Pending (${afDocRecords.pending.length})`;
    completedTab.textContent = `Completed (${afDocRecords.completed.length})`;
    pendingTab.classList.toggle('active', kind === 'pending');
    completedTab.classList.toggle('active', kind === 'completed');

    const badge = { Pending: 'pending', Accepted: 'accepted' };
    const rows = afDocRecords[kind];
    document.getElementById('rec-body').innerHTML = rows.length ? rows.map(r => `
        <tr>
            <td class="cell-strong">${afEsc(r.patient_name || 'N/A')}</td>
            <td>${afEsc(r.patient_phone || 'N/A')}</td>
            <td>${afEsc(r.appointment_date)}</td>
            <td>${afEsc(r.time_slot)}</td>
            <td>${afEsc(r.token_no || '—')}</td>
            <td><span class="badge ${badge[r.status] || 'confirmed'}">${kind === 'completed' ? 'Completed' : afEsc(r.status)}</span></td>
        </tr>`).join('')
        : `<tr><td class="empty" colspan="6">No ${kind} appointments for this doctor.</td></tr>`;
}

function closeDoctorRecords() {
    document.getElementById('doctorRecordsModal').style.display = 'none';
}
