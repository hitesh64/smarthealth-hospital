// Admin portal core: sign-in, navigation, and the Appointments / Patients / Doctors / Ambulance pages.
// The feature pages (Analytics, SOS, Pharmacy, Notifications) are in admin-features.js.

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = shEsc; // from popups.js

const PAGE_TITLES = {
    'booking-tab': 'Appointments', 'registered-users-tab': 'Patients', 'doctor-list-tab': 'Doctors',
    'ambulance-bookings-tab': 'Ambulance Bookings', 'sos-tab': 'SOS Alerts', 'medicine-tab': 'Medicine Stock',
    'orders-tab': 'Medicine Orders', 'analytics-tab': 'Analytics', 'notifications-tab': 'Notifications',
    'lab-tab': 'Lab Bookings', 'lab-tests-tab': 'Test Catalogue'
};

document.getElementById('current-date').innerText = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

function initials(name) {
    const parts = String(name || '').replace(/^dr\.?\s+/i, '').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// Initials circle; a photo covers it when there is one and it loads.
function avatarHtml(name, image) {
    return `<span class="avatar">${esc(initials(name))}${image ? `<img src="${esc(image)}" alt="" onerror="this.remove()">` : ''}</span>`;
}

function emptyRow(cols, icon, text) {
    return `<tr><td class="empty" colspan="${cols}"><i class="fas ${icon}"></i>${esc(text)}</td></tr>`;
}

function formatDate(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    return isNaN(d) ? (ymd || '—') : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function matches(query, ...values) {
    return !query || values.some(v => String(v ?? '').toLowerCase().includes(query));
}

function searchValue(id) {
    return document.getElementById(id).value.trim().toLowerCase();
}

// ---------------------------------------------------------------- sidebar
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('show');
    document.getElementById('sidebar-overlay').classList.toggle('show');
}

function toggleRail() {
    const collapsed = !document.body.classList.contains('rail-collapsed');
    document.body.classList.toggle('rail-collapsed', collapsed);
    localStorage.setItem('medAdminRailCollapsed', collapsed ? '1' : '0');
}

// One menu button: a slide-in drawer on small screens, a collapsed icon rail on large ones
function toggleMenu() {
    if (window.innerWidth <= 992) toggleSidebar();
    else toggleRail();
}

document.body.classList.toggle('rail-collapsed', localStorage.getItem('medAdminRailCollapsed') === '1');

document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleMenu();
    }
    if (e.key === 'Escape') {
        closeEditModal();
        closeAdminModal();
        if (document.getElementById('addDoctorModal').style.display !== 'none') closeAddDoctor();
        if (typeof closeDoctorRecords === 'function') closeDoctorRecords();
        if (typeof closeMedicineForm === 'function' && document.getElementById('medicineModal').style.display !== 'none') closeMedicineForm();
    }
});

document.querySelector('.sidebar-nav').addEventListener('click', e => {
    const li = e.target.closest('li[data-tab]');
    if (li) switchTab(li.dataset.tab);
});

function switchTab(tabId) {
    // "Add Doctor" is a popup over the Doctors page, not a page of its own
    if (tabId === 'doctor-tab') {
        switchTab('doctor-list-tab');
        openAddDoctor();
        return;
    }
    document.querySelectorAll('.content-section').forEach(sec => sec.classList.toggle('active', sec.id === tabId));
    document.querySelectorAll('.nav-links li').forEach(li => li.classList.toggle('active', li.dataset.tab === tabId));
    document.getElementById('page-crumb').textContent = PAGE_TITLES[tabId] || '';
    document.querySelector('.main-content').scrollTop = 0;

    document.getElementById('sidebar').classList.remove('show');
    document.getElementById('sidebar-overlay').classList.remove('show');

    if (tabId === 'booking-tab') loadBookings();
    else if (tabId === 'registered-users-tab') loadRegisteredUsers();
    else if (tabId === 'doctor-list-tab') loadAddedDoctors();
    else if (tabId === 'ambulance-bookings-tab') loadAmbulanceBookings();
    else if (tabId === 'lab-tab') loadLab();
    else if (tabId === 'lab-tests-tab') loadLabTests();
    else if (typeof onFeatureTab === 'function') onFeatureTab(tabId);
}

// ---------------------------------------------------------------- sign-in
function validateInput(id, errorId, validationType) {
    const val = document.getElementById(id).value.trim();
    let isValid = true;
    if (validationType === 'email') isValid = emailRegex.test(val);
    else if (validationType === 'password') isValid = val.length >= 6;
    else if (validationType === 'name') isValid = val.length > 2;
    document.getElementById(errorId).style.display = isValid ? 'none' : 'block';
    return isValid;
}

// Shows the console after a successful sign-in (or a still-valid session on page load)
function enterDashboard(name) {
    document.getElementById('admin-name-display').innerText = name;
    document.getElementById('admin-avatar').textContent = initials(name);
    document.getElementById('auth-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = 'flex';
    loadBookings();
    loadRegisteredUsers();
    loadAddedDoctors();
    loadAmbulanceBookings();
    startAdminFeatures();
}

// New administrators are added from inside the console, by an administrator who is signed in
function openAdminModal() {
    document.getElementById('register-form').reset();
    document.querySelectorAll('#register-form .error-msg').forEach(e => { e.style.display = 'none'; });
    document.getElementById('adminModal').style.display = 'flex';
    document.getElementById('reg-name').focus();
}

function closeAdminModal() {
    document.getElementById('adminModal').style.display = 'none';
    document.getElementById('register-form').reset();
}

function handleRegister(event) {
    if (event) event.preventDefault();
    const isNameValid = validateInput('reg-name', 'reg-name-error', 'name');
    const isEmailValid = validateInput('reg-email', 'reg-email-error', 'email');
    const isPassValid = document.getElementById('reg-password').value.length >= 8;
    document.getElementById('reg-pass-error').style.display = isPassValid ? 'none' : 'block';
    if (!(isNameValid && isEmailValid && isPassValid)) return;

    const formData = new FormData();
    formData.append("name", document.getElementById('reg-name').value.trim());
    formData.append("email", document.getElementById('reg-email').value.trim());
    formData.append("password", document.getElementById('reg-password').value);

    const btn = document.getElementById('reg-btn');
    btn.disabled = true;
    fetch("api/admin/register", { method: "POST", body: formData })
        .then(res => res.text())
        .then(data => {
            if (data.trim() === "success") {
                shToast('Administrator account created. They can sign in now.', 'success');
                closeAdminModal();
            } else {
                shNotify(data);
            }
        })
        .catch(() => shToast('Could not reach the server. Please try again.', 'error'))
        .finally(() => { btn.disabled = false; });
}

function handleLogin(event) {
    if (event) event.preventDefault();
    const isEmailValid = validateInput('login-email', 'login-email-error', 'email');
    const isPassValid = validateInput('login-password', 'login-pass-error', 'password');
    if (!(isEmailValid && isPassValid)) return;

    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-server-error');
    errorDiv.style.display = 'none';

    const formData = new FormData();
    formData.append("email", email);
    formData.append("password", pass);

    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    fetch("api/admin/login", { method: "POST", body: formData })
        .then(res => res.text())
        .then(data => {
            let res = null;
            try { res = JSON.parse(data); } catch (e) { /* plain-text reply: wrong email / password */ }
            if (res && res.status === "success") {
                enterDashboard(res.name);
            } else {
                errorDiv.innerText = (res && res.message) || data.replace(/<[^>]*>/g, ' ').trim() || 'Sign-in failed.';
                errorDiv.style.display = 'block';
            }
        })
        .catch(() => {
            errorDiv.innerText = "Could not reach the server. Please try again.";
            errorDiv.style.display = 'block';
        })
        .finally(() => { btn.disabled = false; });
}

function handleLogout() {
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('auth-view').style.display = 'flex';
    document.getElementById('login-password').value = '';
    stopAdminFeatures();
    fetch('api/admin?action=logout', { method: 'POST' });
}

// ---------------------------------------------------------------- appointments
let bookingsData = [];

// "Confirmed" is what this system stores once the visit has taken place
function bookingState(status) {
    if (status === 'Accepted') return 'Accepted';
    if (status === 'Confirmed' || status === 'Completed') return 'Completed';
    if (status === 'Rejected' || status === 'Cancelled') return 'Closed';
    return 'Pending';
}

function loadBookings() {
    fetch("api/bookings")
        .then(res => res.json())
        .then(rows => {
            bookingsData = rows;
            const pending = rows.filter(b => bookingState(b.status) === 'Pending').length;
            document.getElementById('kpi-bookings').textContent = rows.length;
            document.getElementById('kpi-bookings-hint').textContent = pending ? `${pending} awaiting a decision` : 'Total booked';
            renderBookings();
        })
        .catch(() => { document.getElementById('bookings-table-body').innerHTML = emptyRow(6, 'fa-circle-exclamation', 'Could not load appointments.'); });
}

function renderBookings() {
    const q = searchValue('bookings-search'), state = document.getElementById('bookings-status').value;
    const rows = bookingsData.filter(b => (!state || bookingState(b.status) === state)
        && matches(q, b.patient_name, b.patient_phone, b.doctor_name, b.specialization, b.user_id));
    document.getElementById('bookings-count').textContent = rows.length;

    document.getElementById('bookings-table-body').innerHTML = rows.length ? rows.map(b => {
        const state = bookingState(b.status);
        const remove = `<button class="btn btn--sm btn--danger-soft" onclick="deleteDocBooking(${+b.id})"><i class="fas fa-trash"></i> Delete</button>`;
        let badge, actions;
        if (state === 'Accepted') {
            badge = '<span class="badge accepted">Accepted</span>';
            actions = `<button class="btn btn--sm btn--success" onclick="updateDocStatus(${+b.id}, 'Confirmed')"><i class="fas fa-check"></i> Mark completed</button>`;
        } else if (state === 'Completed') {
            badge = '<span class="badge confirmed">Completed</span>';
            actions = remove;
        } else if (state === 'Closed') {
            badge = `<span class="badge danger">${esc(b.status)}</span>`;
            actions = remove;
        } else {
            badge = '<span class="badge pending">Pending</span>';
            actions = `<button class="btn btn--sm" onclick="updateDocStatus(${+b.id}, 'Accepted')">Accept</button>
                       <button class="btn btn--sm btn--danger-soft" onclick="updateDocStatus(${+b.id}, 'Rejected')">Reject</button>`;
        }
        return `<tr>
            <td><div class="cell-strong">${esc(b.patient_name || 'N/A')}</div><small>${esc(b.patient_phone || 'No phone')}</small></td>
            <td><div class="cell-strong">${esc(b.doctor_name || 'Doctor #' + b.doctor_id)}</div><small>${esc(b.specialization || '')}</small></td>
            <td>${esc(formatDate(b.appointment_date))}<br><small>${esc(b.time_slot || '')}</small></td>
            <td>${b.token_no ? `<span class="mono">#${esc(b.token_no)}</span>` : '—'}</td>
            <td>${badge}</td>
            <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    }).join('') : emptyRow(6, 'fa-calendar-xmark', bookingsData.length ? 'No appointments match this filter.' : 'No appointments booked yet.');
}

async function updateDocStatus(id, newStatus) {
    if (newStatus === 'Rejected' && !await shConfirm('Reject this appointment request? The patient will be informed by email.', { yes: 'Reject', danger: true })) return;
    fetch(`api/bookings/status?id=${id}&status=${newStatus}`)
        .then(res => res.text())
        .then(data => { shNotify(data); loadBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

async function deleteDocBooking(id) {
    if (!await shConfirm('Permanently delete this appointment record?', { yes: 'Delete', danger: true })) return;
    fetch("api/bookings/delete?id=" + id)
        .then(res => res.text())
        .then(data => { shNotify(data); loadBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

// ---------------------------------------------------------------- patients
let usersData = [];

function loadRegisteredUsers() {
    fetch("api/users")
        .then(res => res.json())
        .then(users => {
            usersData = users;
            document.getElementById('kpi-users').textContent = users.length;
            renderUsers();
        })
        .catch(() => { document.getElementById('users-table-body').innerHTML = emptyRow(5, 'fa-circle-exclamation', 'Could not load patients.'); });
}

function renderUsers() {
    const q = searchValue('users-search');
    const rows = usersData.filter(u => matches(q, u.name, u.email, u.phone));
    document.getElementById('users-count').textContent = rows.length;
    document.getElementById('users-table-body').innerHTML = rows.length ? rows.map(u => `
        <tr>
            <td><div class="cell-person">${avatarHtml(u.name)}<span class="cell-strong">${esc(u.name || 'Unnamed')}</span></div></td>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.phone || '—')}</td>
            <td>${esc(u.age || '—')}</td>
            <td>${u.blood ? `<span class="badge danger">${esc(u.blood)}</span>` : '—'}</td>
        </tr>`).join('')
        : emptyRow(5, 'fa-users-slash', usersData.length ? 'No patients match this search.' : 'No patients registered yet.');
}

// ---------------------------------------------------------------- ambulance bookings
// Requests come with a pickup point and a road route from the hospital. Dispatch picks a fleet
// ambulance (the nearest free one unless chosen); the map shows every open request, its route and the fleet.
let ambData = [], ambFleet = [], ambHospital = null, ambMap = null, ambLayer = null, ambFitKey = null;
const AMB_BADGE = { Pending: 'danger', Dispatched: 'accepted', Arrived: 'pending', Completed: 'confirmed', Cancelled: 'manual' };
const AMB_LABEL = { Pending: 'Awaiting dispatch', Dispatched: 'On the way', Arrived: 'At pickup', Completed: 'Completed', Cancelled: 'Cancelled' };

function loadAmbulanceBookings() {
    return fetch('api/ambulance')
        .then(res => res.json())
        .then(d => {
            if (d.status !== 'success') throw new Error(d.message);
            ambData = d.requests || [];
            ambFleet = d.fleet || [];
            ambHospital = d.hospital;
            const waiting = ambData.filter(a => a.status === 'Pending').length;
            document.getElementById('kpi-ambulance').textContent = ambData.length;
            document.getElementById('kpi-ambulance-hint').textContent = waiting ? `${waiting} awaiting dispatch` : 'Total requests';
            renderAmbulance();
        })
        .catch(() => { document.getElementById('amb-bookings-table-body').innerHTML = emptyRow(6, 'fa-circle-exclamation', 'Could not load ambulance bookings.'); });
}

function ambMinutes(m) { return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }

function renderAmbulance() {
    const q = searchValue('amb-search'), filter = document.getElementById('amb-filter').value;
    const open = a => ['Pending', 'Dispatched', 'Arrived'].includes(a.status);
    const rows = ambData.filter(a => (filter === 'open' ? open(a) : (!filter || a.status === filter))
        && matches(q, a.patient_name, a.phone, a.address, a.emergency_type, a.ambulance && a.ambulance.vehicle_no));
    const count = st => ambData.filter(a => a.status === st).length;
    const free = ambFleet.filter(f => f.status === 'Available');
    document.getElementById('amb-stats').innerHTML = [
        ['Awaiting dispatch', count('Pending'), 'Need an ambulance now', 'fa-hourglass-half', count('Pending') ? 'red' : ''],
        ['On the way', count('Dispatched'), 'Driving to the patient', 'fa-truck-medical', ''],
        ['At pickup', count('Arrived'), 'Ambulance has arrived', 'fa-location-dot', ''],
        ['Ambulances free', free.length, `of ${ambFleet.length} in the fleet`, 'fa-warehouse', free.length ? 'green' : 'red']
    ].map(([label, value, hint, icon, tone]) => `<div class="ord-stat ${tone ? 'tone-' + tone : ''}"><span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span><span class="v">${value}</span><span class="h">${hint}</span></div>`).join('');

    document.getElementById('amb-count').textContent = rows.length;
    document.getElementById('amb-bookings-table-body').innerHTML = rows.length ? rows.map(a => {
        const r = a.route_summary, eta = a.eta, amb = a.ambulance;
        let actions = '';
        if (a.status === 'Pending') {
            actions = `<div class="feat-inline">
                <select id="amb-pick-${a.id}" title="Ambulance to send">
                    <option value="">Nearest free ambulance</option>
                    ${free.map(f => `<option value="${f.id}">${esc(f.vehicle_no)} — ${esc(f.driver_name)}</option>`).join('')}
                </select>
                <button class="btn btn--sm btn--danger" onclick="dispatchAmbRequest(${+a.id})"><i class="fas fa-truck-medical"></i> Dispatch</button></div>`;
        } else if (a.status === 'Dispatched') {
            actions = `<button class="btn btn--sm" onclick="setAmbStatus(${+a.id}, 'Arrived')"><i class="fas fa-location-dot"></i> Arrived</button>`;
        }
        if (a.status === 'Dispatched' || a.status === 'Arrived') {
            actions += `<button class="btn btn--sm btn--success" onclick="setAmbStatus(${+a.id}, 'Completed')"><i class="fas fa-circle-check"></i> Complete</button>`;
        }
        if (['Pending', 'Dispatched', 'Arrived'].includes(a.status)) {
            actions += `<button class="btn btn--sm btn--outline" onclick="setAmbStatus(${+a.id}, 'Cancelled')">Cancel</button>`;
        }
        if (a.pickup_lat !== null) actions += `<button class="btn btn--sm btn--outline" onclick="focusAmbRequest(${+a.id})" title="Show on map"><i class="fas fa-map-location-dot"></i></button>`;
        actions += `<button class="btn btn--sm btn--danger-soft" onclick="deleteAmbBooking(${+a.id})" title="Delete"><i class="fas fa-trash"></i></button>`;
        return `<tr>
            <td><span class="cell-strong">${esc(a.patient_name || 'N/A')}</span><br>${esc(a.phone || '—')}<br><small class="muted">#${+a.id} · ${esc(String(a.created_at || '').slice(0, 16))}</small></td>
            <td>${esc(a.address || '—')}${a.pickup_lat !== null ? `<br><a href="https://www.google.com/maps?q=${a.pickup_lat},${a.pickup_lng}" target="_blank" rel="noopener"><i class="fas fa-location-dot"></i> ${(+a.pickup_lat).toFixed(5)}, ${(+a.pickup_lng).toFixed(5)}</a>` : '<br><b style="color: var(--red);">No map pin — call to confirm</b>'}</td>
            <td>${r ? `<b>${r.km} km</b> · ${ambMinutes(r.minutes)}${r.source === 'estimate' ? ' <small>(approx.)</small>' : ''}` : '—'}
                ${eta ? `<br><small>${eta.km_left} km left · ${eta.minutes_left} min · ${eta.live ? 'live GPS' : 'estimated'}</small>` : ''}
                ${amb ? `<br><small><i class="fas fa-truck-medical"></i> ${esc(amb.vehicle_no)} — ${esc(amb.driver_name)}</small>` : ''}</td>
            <td>${esc(a.emergency_type || '—')}</td>
            <td><span class="badge ${AMB_BADGE[a.status] || 'pending'}">${AMB_LABEL[a.status] || esc(a.status)}</span></td>
            <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    }).join('') : emptyRow(6, 'fa-truck-medical', ambData.length ? 'No requests in this list.' : 'No ambulance bookings yet.');
    renderAmbMap();
}

function renderAmbMap() {
    const el = document.getElementById('amb-admin-map');
    if (typeof L === 'undefined' || !el || !el.offsetParent || !ambHospital) return;
    if (!ambMap) {
        ambMap = L.map(el).setView([ambHospital.lat, ambHospital.lng], 12);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(ambMap);
        ambLayer = L.layerGroup().addTo(ambMap);
        setTimeout(() => ambMap.invalidateSize(), 200);
    }
    ambLayer.clearLayers();
    const pin = (kind, icon) => L.divIcon({ className: '', html: `<div class="map-pin ${kind}"><i class="fas ${icon}"></i></div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
    const points = [[ambHospital.lat, ambHospital.lng]];
    L.marker(points[0], { icon: pin('hosp', 'fa-hospital') }).addTo(ambLayer).bindPopup(`<b>${esc(ambHospital.name)}</b><br>${esc(ambHospital.address)}`);
    const active = ambData.filter(a => ['Pending', 'Dispatched', 'Arrived'].includes(a.status) && a.pickup_lat !== null);
    active.forEach(a => {
        if (a.route) L.polyline(a.route, { color: a.status === 'Pending' ? '#b3261e' : '#17539c', weight: 4, opacity: .8, dashArray: a.status === 'Pending' ? '8 8' : null }).addTo(ambLayer);
        L.marker([a.pickup_lat, a.pickup_lng], { icon: pin('me', 'fa-person') }).addTo(ambLayer)
            .bindPopup(`<b>#${a.id} ${esc(a.patient_name)}</b><br>${esc(a.emergency_type)}<br>${esc(AMB_LABEL[a.status])}`);
        points.push([a.pickup_lat, a.pickup_lng]);
    });
    ambFleet.forEach(f => {
        if (f.lat === null) return;
        L.marker([+f.lat, +f.lng], { icon: pin('amb' + (f.status === 'Offline' ? ' off' : ''), 'fa-truck-medical'), zIndexOffset: 500 }).addTo(ambLayer)
            .bindPopup(`${esc(f.vehicle_no)} — ${esc(f.status)}${f.live ? ' (live GPS)' : ''}`);
    });
    document.getElementById('amb-map-note').innerHTML = `${active.length} open request${active.length === 1 ? '' : 's'} on the map &middot; dashed = waiting, blue = ambulance on the way`;
    const key = active.map(a => a.id + a.status).join(',');
    if (key !== ambFitKey) {
        if (points.length > 1) ambMap.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
        ambFitKey = key;
    }
}

function focusAmbRequest(id) {
    const a = ambData.find(x => x.id === id);
    if (!a || !ambMap) return;
    document.getElementById('amb-admin-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (a.route) ambMap.fitBounds(a.route, { padding: [40, 40], maxZoom: 16 });
    else ambMap.setView([a.pickup_lat, a.pickup_lng], 15);
}

function dispatchAmbRequest(id) {
    const fd = new FormData();
    fd.append('id', id);
    fd.append('ambulance_id', document.getElementById('amb-pick-' + id).value);
    fetch('api/ambulance/dispatch', { method: 'POST', body: fd }).then(r => r.json()).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        else shToast(`Ambulance ${res.vehicle_no} dispatched${res.route_summary ? ` — ${res.route_summary.km} km, about ${ambMinutes(res.route_summary.minutes)}` : ''}. The patient can track it live.`, 'success');
        loadAmbulanceBookings();
    }).catch(() => shToast('Could not reach the server.', 'error'));
}

async function setAmbStatus(id, status) {
    if (status === 'Cancelled' && !await shConfirm('Cancel this ambulance request?', { yes: 'Cancel request', danger: true })) return;
    const fd = new FormData();
    fd.append('id', id);
    fd.append('status', status);
    fetch('api/ambulance/status', { method: 'POST', body: fd }).then(r => r.json()).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        loadAmbulanceBookings();
    }).catch(() => shToast('Could not reach the server.', 'error'));
}

async function deleteAmbBooking(id) {
    if (!await shConfirm('Permanently delete this ambulance request?', { yes: 'Delete', danger: true })) return;
    fetch("api/ambulance/delete?id=" + id)
        .then(res => res.json())
        .then(res => { shNotify(res.message || res.status); loadAmbulanceBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

// open requests and moving ambulances refresh by themselves while the page is open
setInterval(() => {
    const tab = document.getElementById('ambulance-bookings-tab');
    if (tab && tab.classList.contains('active') && document.getElementById('dashboard-view').offsetParent !== null) loadAmbulanceBookings();
}, 6000);

// ---------------------------------------------------------------- doctors
let doctorsData = [];

function loadAddedDoctors() {
    return fetch("api/doctors")
        .then(res => res.json())
        .then(doctors => {
            doctorsData = doctors;
            document.getElementById('kpi-doctors').textContent = doctors.length;
            renderDoctors();
        })
        .catch(() => { document.getElementById('doctors-list-table-body').innerHTML = emptyRow(6, 'fa-circle-exclamation', 'Could not load doctors.'); });
}

function renderDoctors() {
    const q = searchValue('doctors-search');
    const rows = doctorsData.filter(d => matches(q, d.doctor_name, d.specialization, d.email));
    document.getElementById('doctors-count').textContent = rows.length;
    document.getElementById('doctors-list-table-body').innerHTML = rows.length ? rows.map(d => `
        <tr>
            <td><div class="cell-person">${avatarHtml(d.doctor_name, d.image)}<span class="cell-strong">${esc(d.doctor_name)}</span></div></td>
            <td>${esc(d.specialization || '—')}</td>
            <td>${d.experience !== null && d.experience !== '' ? esc(d.experience) + (+d.experience === 1 ? ' year' : ' years') : '—'}</td>
            <td>${esc(d.days || '—')}</td>
            <td>${d.email ? esc(d.email) : '<span class="badge manual">Not set</span>'}</td>
            <td><div class="row-actions">
                <button class="btn btn--sm btn--outline" onclick="openDoctorRecords(${+d.id})"><i class="fas fa-folder-open"></i> Records</button>
                <button class="btn btn--sm btn--outline" onclick="editDoctor(${+d.id})"><i class="fas fa-pen"></i> Edit</button>
                <button class="btn btn--sm btn--danger-soft" onclick="removeDoctor(${+d.id})"><i class="fas fa-trash"></i> Remove</button>
            </div></td>
        </tr>`).join('')
        : emptyRow(6, 'fa-user-doctor', doctorsData.length ? 'No doctors match this search.' : 'No doctors added to the system yet.');
}

async function removeDoctor(id) {
    const doc = doctorsData.find(d => d.id == id);
    if (!await shConfirm(`Remove ${doc ? doc.doctor_name : 'this doctor'}? All of their appointments will be deleted as well.`, { yes: 'Remove', danger: true })) return;
    fetch("api/doctors/delete?id=" + id)
        .then(res => res.text())
        .then(data => { shNotify(data); loadAddedDoctors(); loadBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

function addDoctor(event) {
    event.preventDefault();
    const formData = new FormData();
    formData.append("doctor_name", document.getElementById("doc-name").value.trim());
    formData.append("specialization", document.getElementById("doc-spec").value);
    formData.append("experience", document.getElementById("doc-exp").value);
    formData.append("days", document.getElementById("doc-days").value.trim());
    formData.append("image", document.getElementById("doc-img-file").files[0]);
    formData.append("email", document.getElementById("doc-email").value.trim());
    formData.append("password", document.getElementById("doc-password").value);

    const btn = document.getElementById('doc-save');
    btn.disabled = true;
    fetch("api/doctors/add", { method: "POST", body: formData })
        .then(r => r.text())
        .then(data => {
            shNotify(data);
            if (/success/i.test(data)) {
                closeAddDoctor();
                loadAddedDoctors();
            }
        })
        .catch(() => shToast('Could not reach the server.', 'error'))
        .finally(() => { btn.disabled = false; });
}

// Always opens a blank form
function openAddDoctor() {
    document.getElementById('add-doc-form').reset();
    const modal = document.getElementById('addDoctorModal');
    modal.style.display = 'flex';
    modal.querySelector('.modal-content').scrollTop = 0;
    document.getElementById('doc-name').focus();
}

function closeAddDoctor() {
    document.getElementById('addDoctorModal').style.display = 'none';
    document.getElementById('add-doc-form').reset();
}

function editDoctor(id) {
    const doc = doctorsData.find(d => d.id == id);
    if (!doc) return;
    document.getElementById('edit-doc-id').value = doc.id;
    document.getElementById('edit-doc-name').value = doc.doctor_name;
    const spec = document.getElementById('edit-doc-spec');
    // keep a department that is not in the standard list instead of silently changing it
    if (doc.specialization && ![...spec.options].some(o => o.value === doc.specialization)) spec.add(new Option(doc.specialization));
    spec.value = doc.specialization;
    document.getElementById('edit-doc-exp').value = doc.experience;
    document.getElementById('edit-doc-days').value = doc.days;
    document.getElementById('edit-doc-email').value = doc.email || '';
    document.getElementById('edit-doc-password').value = '';
    document.getElementById('edit-doc-image').value = '';
    document.getElementById('editDoctorModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editDoctorModal').style.display = 'none';
}

function saveEditDoctor(e) {
    e.preventDefault();
    const formData = new FormData();
    formData.append("id", document.getElementById("edit-doc-id").value);
    formData.append("doctor_name", document.getElementById("edit-doc-name").value.trim());
    formData.append("specialization", document.getElementById("edit-doc-spec").value);
    formData.append("experience", document.getElementById("edit-doc-exp").value);
    formData.append("days", document.getElementById("edit-doc-days").value.trim());
    formData.append("email", document.getElementById("edit-doc-email").value.trim());
    formData.append("password", document.getElementById("edit-doc-password").value);
    const fileInput = document.getElementById("edit-doc-image");
    if (fileInput.files.length > 0) formData.append("image", fileInput.files[0]);

    const btn = document.getElementById('edit-doc-save');
    btn.disabled = true;
    fetch("api/doctors/update", { method: "POST", body: formData })
        .then(res => res.text())
        .then(data => {
            shNotify(data);
            if (/success/i.test(data)) closeEditModal();
            loadAddedDoctors();
        })
        .catch(() => shToast('Could not reach the server.', 'error'))
        .finally(() => { btn.disabled = false; });
}
