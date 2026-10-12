// Admin portal core: sign-in, navigation, and the Appointments / Patients / Doctors / Ambulance pages.
// The feature pages (Analytics, SOS, Pharmacy, Notifications) are in admin-features.js.

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = shEsc; // from popups.js

const PAGE_TITLES = {
    'booking-tab': 'Appointments', 'registered-users-tab': 'Patients', 'doctor-list-tab': 'Doctors',
    'ambulance-bookings-tab': 'Ambulance Bookings', 'sos-tab': 'SOS Alerts', 'medicine-tab': 'Medicine Stock',
    'orders-tab': 'Medicine Orders', 'analytics-tab': 'Analytics', 'notifications-tab': 'Notifications'
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
    fetch("adminRegister.php", { method: "POST", body: formData })
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
    fetch("adminLogin.php", { method: "POST", body: formData })
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
    fetch('adminApi.php?action=logout', { method: 'POST' });
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
    fetch("getBookings.php")
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
    fetch(`updateBookingStatus.php?id=${id}&status=${newStatus}`)
        .then(res => res.text())
        .then(data => { shNotify(data); loadBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

async function deleteDocBooking(id) {
    if (!await shConfirm('Permanently delete this appointment record?', { yes: 'Delete', danger: true })) return;
    fetch("deleteBooking.php?id=" + id)
        .then(res => res.text())
        .then(data => { shNotify(data); loadBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

// ---------------------------------------------------------------- patients
let usersData = [];

function loadRegisteredUsers() {
    fetch("getUsers.php")
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
let ambData = [];

function loadAmbulanceBookings() {
    fetch("getAmbulance.php")
        .then(res => res.json())
        .then(rows => {
            ambData = rows.slice().reverse(); // newest request first
            const waiting = rows.filter(a => (a.status || 'Pending') !== 'Dispatched').length;
            document.getElementById('kpi-ambulance').textContent = rows.length;
            document.getElementById('kpi-ambulance-hint').textContent = waiting ? `${waiting} awaiting dispatch` : 'Total requests';
            renderAmbulance();
        })
        .catch(() => { document.getElementById('amb-bookings-table-body').innerHTML = emptyRow(6, 'fa-circle-exclamation', 'Could not load ambulance bookings.'); });
}

function renderAmbulance() {
    const q = searchValue('amb-search');
    const rows = ambData.filter(a => matches(q, a.patient_name, a.phone, a.address, a.emergency_type));
    document.getElementById('amb-count').textContent = rows.length;
    document.getElementById('amb-bookings-table-body').innerHTML = rows.length ? rows.map(a => {
        const sent = a.status === 'Dispatched';
        return `<tr>
            <td class="cell-strong">${esc(a.patient_name || 'N/A')}</td>
            <td>${esc(a.phone || '—')}</td>
            <td>${esc(a.address || '—')}</td>
            <td>${esc(a.emergency_type || '—')}</td>
            <td><span class="badge ${sent ? 'confirmed' : 'pending'}">${sent ? 'Dispatched' : 'Pending'}</span></td>
            <td><div class="row-actions">
                ${sent ? '' : `<button class="btn btn--sm" onclick="updateAmbStatus(${+a.id}, 'Dispatched')"><i class="fas fa-truck-medical"></i> Dispatch</button>`}
                <button class="btn btn--sm btn--danger-soft" onclick="deleteAmbBooking(${+a.id})"><i class="fas fa-trash"></i> Delete</button>
            </div></td>
        </tr>`;
    }).join('') : emptyRow(6, 'fa-truck-medical', ambData.length ? 'No requests match this search.' : 'No ambulance bookings found.');
}

function updateAmbStatus(id, newStatus) {
    fetch(`updateAmbulanceStatus.php?id=${id}&status=${newStatus}`)
        .then(res => res.text())
        .then(data => { shNotify(data); loadAmbulanceBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

async function deleteAmbBooking(id) {
    if (!await shConfirm('Permanently delete this ambulance request?', { yes: 'Delete', danger: true })) return;
    fetch("deleteAmbulance.php?id=" + id)
        .then(res => res.text())
        .then(data => { shNotify(data); loadAmbulanceBookings(); })
        .catch(() => shToast('Could not reach the server.', 'error'));
}

// ---------------------------------------------------------------- doctors
let doctorsData = [];

function loadAddedDoctors() {
    return fetch("getDoctors.php")
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
    fetch("deleteDoctor.php?id=" + id)
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
    fetch("addDoctor.php", { method: "POST", body: formData })
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
    fetch("updateDoctor.php", { method: "POST", body: formData })
        .then(res => res.text())
        .then(data => {
            shNotify(data);
            if (/success/i.test(data)) closeEditModal();
            loadAddedDoctors();
        })
        .catch(() => shToast('Could not reach the server.', 'error'))
        .finally(() => { btn.disabled = false; });
}
