// My Appointments page (patient site): the patient's bookings and ambulance requests, in tabs.
// Uses `currentUser`, `doctors`, openBookingModal() and cancelBooking() from the main page script,
// shEsc() from popups.js and the date helpers from dashboard.js.

const AP_TABS = [
    { key: 'upcoming', label: 'Upcoming', icon: 'fa-calendar-day' },
    { key: 'past', label: 'Past visits', icon: 'fa-clock-rotate-left' },
    { key: 'cancelled', label: 'Cancelled', icon: 'fa-ban' },
    { key: 'ambulance', label: 'Ambulance', icon: 'fa-truck-medical' }
];

const ap = { tab: 'upcoming', doc: [], amb: [], loaded: false };

// Which tab a booking belongs in, and how its card looks.
// In this system "Confirmed" is what the hospital sets once the visit has taken place.
function apState(b) {
    const status = b.status || 'Pending';
    if (status === 'Cancelled' || status === 'Rejected') {
        return { tab: 'cancelled', tone: 'is-off', icon: 'fa-ban', text: status === 'Rejected' ? 'Declined' : 'Cancelled',
            note: status === 'Rejected' ? 'The hospital could not accept this appointment.' : 'This appointment was cancelled.' };
    }
    if (status === 'Confirmed' || status === 'Completed') return { tab: 'past', tone: 'is-done', icon: 'fa-circle-check', text: 'Completed', step: 3 };
    if (b.appointment_date < dashToday()) {
        return { tab: 'past', tone: 'is-off', icon: 'fa-clock', text: 'Date passed', note: 'The date passed without the visit being recorded.' };
    }
    return status === 'Accepted'
        ? { tab: 'upcoming', tone: 'is-accepted', icon: 'fa-thumbs-up', text: 'Accepted', step: 2, open: true }
        : { tab: 'upcoming', tone: 'is-pending', icon: 'fa-hourglass-half', text: 'Awaiting confirmation', step: 1, open: true, canCancel: true };
}

function apSteps(names, done) {
    return `<ol class="ap-steps">${names.map((name, n) =>
        `<li class="${n < done ? 'done' : (n === done ? 'now' : '')} ${n < done - 1 ? 'fill' : ''}" style="--s: ${n};">${name}</li>`).join('')}</ol>`;
}

function apDocCard(b, i) {
    const s = apState(b), doc = doctors.find(d => d.id == b.doctor_id);
    const date = new Date(b.appointment_date + 'T00:00:00'), valid = !isNaN(date);
    const days = valid ? Math.round((date - new Date(dashToday() + 'T00:00:00')) / 86400000) : null;
    const when = s.open && days !== null ? (days <= 0 ? 'Today' : (days === 1 ? 'Tomorrow' : `In ${days} days`)) : '';
    const name = doc ? doc.name : 'Doctor';
    return `
        <article class="ap-card ${s.tone}" style="--i: ${Math.min(i, 8)};">
            <div class="ap-date">${valid
                ? `<small>${date.toLocaleDateString('en-IN', { month: 'short' })}</small><b>${date.getDate()}</b><span>${date.toLocaleDateString('en-IN', { weekday: 'long' })}</span>`
                : `<span>${shEsc(b.appointment_date)}</span>`}</div>
            <div class="ap-main">
                <div class="ap-doc">
                    <img src="${shEsc(doc ? doc.img : '')}" alt="" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=2563eb&color=fff'">
                    <div style="min-width: 0;"><h4>${shEsc(name)}</h4><p>${shEsc(doc ? doc.spec : 'No longer listed')}</p></div>
                </div>
                <div class="ap-meta">
                    <span><i class="far fa-clock"></i>${shEsc(b.time_slot)}</span>
                    ${b.token_no ? `<span class="ap-token">Token ${shEsc(b.token_no)}</span>` : ''}
                    ${when ? `<span class="ap-when">${when}</span>` : ''}
                </div>
                ${s.step ? apSteps(['Requested', 'Accepted', 'Completed'], s.step) : `<p class="ap-note"><i class="fas fa-circle-info"></i>${s.note}</p>`}
            </div>
            <div class="ap-side">
                <span class="ap-status"><i class="fas ${s.icon}"></i>${s.text}</span>
                ${s.canCancel ? `<button type="button" class="ap-btn ap-btn--danger" onclick="cancelBooking(${+b.id}, 'doctor')"><i class="fas fa-xmark"></i>Cancel</button>` : ''}
                ${!s.open && doc ? `<button type="button" class="ap-btn" onclick="openBookingModal(${+doc.id})"><i class="fas fa-rotate-right"></i>Book again</button>` : ''}
            </div>
        </article>`;
}

// Ambulance request card: where it stands, the road distance from the hospital, and live tracking
const AP_AMB = {
    Pending: { tone: 'is-urgent', icon: 'fa-hourglass-half', text: 'Awaiting dispatch', step: 1 },
    Dispatched: { tone: 'is-urgent', icon: 'fa-truck-medical', text: 'On the way', step: 2 },
    Arrived: { tone: 'is-accepted', icon: 'fa-location-dot', text: 'Arrived', step: 3 },
    Completed: { tone: 'is-done', icon: 'fa-circle-check', text: 'Completed', step: 4 },
    Cancelled: { tone: 'is-off', icon: 'fa-ban', text: 'Cancelled', step: 0 }
};

function apAmbCard(b, i) {
    const s = AP_AMB[b.status] || AP_AMB.Pending, open = ['Pending', 'Dispatched', 'Arrived'].includes(b.status);
    const route = b.route_summary, eta = b.eta;
    return `
        <article class="ap-card ${s.tone}" style="--i: ${Math.min(i, 8)};">
            <div class="ap-date"><i class="fas fa-truck-medical"></i><span>Ambulance</span></div>
            <div class="ap-main">
                <div class="ap-doc"><div style="min-width: 0;"><h4>${shEsc(b.emergency_type || 'Emergency')}</h4><p>For ${shEsc(b.patient_name)}${b.created_at ? ' · ' + shEsc(String(b.created_at).slice(0, 16)) : ''}</p></div></div>
                <div class="ap-meta">
                    <span><i class="fas fa-location-dot"></i>${shEsc(b.address)}</span>
                    ${route ? `<span><i class="fas fa-route"></i>${route.km} km from hospital</span>` : ''}
                    ${b.ambulance ? `<span><i class="fas fa-truck-medical"></i>${shEsc(b.ambulance.vehicle_no)}</span>` : ''}
                    ${eta ? `<span class="ap-when">${eta.minutes_left > 0 ? 'About ' + eta.minutes_left + ' min away' : 'Arriving now'}</span>` : ''}
                </div>
                ${s.step ? apSteps(['Requested', 'Dispatched', 'Arrived', 'Completed'], s.step) : `<p class="ap-note"><i class="fas fa-circle-info"></i>This request was cancelled.</p>`}
            </div>
            <div class="ap-side">
                <span class="ap-status"><i class="fas ${s.icon}"></i>${s.text}</span>
                ${b.pickup_lat !== null || open ? `<button type="button" class="ap-btn" onclick="ambTrackOpen(${+b.id})"><i class="fas fa-map-location-dot"></i>${open ? 'Track live' : 'View route'}</button>` : ''}
                ${['Pending', 'Dispatched'].includes(b.status) ? `<button type="button" class="ap-btn ap-btn--danger" onclick="cancelBooking(${+b.id}, 'ambulance')"><i class="fas fa-xmark"></i>Cancel</button>` : ''}
            </div>
        </article>`;
}

function apEmpty(icon, title, text, button) {
    return `<div class="ap-empty"><span class="ap-empty-art"><i class="fas ${icon}"></i></span><b>${title}</b>${text}${button || ''}</div>`;
}

function apMoveGlider() {
    const active = document.querySelector('.ap-tab.active'), glider = document.querySelector('.ap-glider');
    if (!active || !glider) return;
    glider.style.width = active.offsetWidth + 'px';
    glider.style.transform = `translateX(${active.offsetLeft}px)`;
}
window.addEventListener('resize', apMoveGlider);

function apTab(key) {
    ap.tab = key;
    apDraw();
}

function apDraw() {
    const groups = { upcoming: [], past: [], cancelled: [] };
    ap.doc.forEach(b => groups[apState(b).tab].push(b));
    groups.upcoming.sort((a, b) => a.appointment_date.localeCompare(b.appointment_date) || dashSlotMinutes(a.time_slot) - dashSlotMinutes(b.time_slot));
    groups.past.sort((a, b) => b.appointment_date.localeCompare(a.appointment_date));
    groups.cancelled.sort((a, b) => b.appointment_date.localeCompare(a.appointment_date));
    const counts = { upcoming: groups.upcoming.length, past: groups.past.length, cancelled: groups.cancelled.length, ambulance: ap.amb.length };

    // the tab bar is built once so its highlight can slide instead of jumping
    const tabs = document.getElementById('apTabs');
    if (!tabs.children.length) {
        tabs.innerHTML = '<span class="ap-glider"></span>' + AP_TABS.map(t =>
            `<button type="button" class="ap-tab" role="tab" data-tab="${t.key}" onclick="apTab('${t.key}')"><i class="fas ${t.icon}"></i>${t.label}<b></b></button>`).join('');
    }
    tabs.querySelectorAll('.ap-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === ap.tab);
        btn.setAttribute('aria-selected', btn.dataset.tab === ap.tab);
        btn.querySelector('b').textContent = counts[btn.dataset.tab];
    });
    apMoveGlider();

    const bookButton = `<button type="button" class="ap-btn" onclick="switchView('home'); dashScrollTo('dash-doctors')"><i class="fas fa-plus"></i>Book an appointment</button>`;
    const list = document.getElementById('bookings-list');
    if (ap.tab === 'ambulance') {
        list.innerHTML = ap.amb.length ? ap.amb.map(apAmbCard).join('')
            : apEmpty('fa-truck-medical', 'No ambulance requests', 'Requests you make for an ambulance will be listed here.');
    } else if (groups[ap.tab].length) {
        list.innerHTML = groups[ap.tab].map(apDocCard).join('');
    } else {
        list.innerHTML = {
            upcoming: apEmpty('fa-calendar-plus', 'Nothing coming up', 'You have no upcoming appointments.', bookButton),
            past: apEmpty('fa-clock-rotate-left', 'No past visits yet', 'Appointments you have attended will appear here.'),
            cancelled: apEmpty('fa-circle-check', 'Nothing cancelled', 'Cancelled or declined appointments would be listed here.')
        }[ap.tab];
    }
}

// Called by switchView('bookings') and after a booking is made or cancelled
function renderBookings() {
    const list = document.getElementById('bookings-list');
    if (!currentUser || !currentUser.email) {
        list.innerHTML = apEmpty('fa-lock', 'Please log in', 'Log in to see your appointments.');
        return;
    }
    if (!ap.loaded) list.innerHTML = '<div class="ap-skeleton"></div><div class="ap-skeleton"></div>';

    const me = String(currentUser.email).toLowerCase().trim();
    const mine = b => b.user_id && String(b.user_id).toLowerCase().trim() === me;
    Promise.all([
        fetch('api/bookings').then(r => r.json()),
        fetch('api/ambulance').then(r => r.json())
    ]).then(([docBookings, ambRes]) => {
        ap.doc = docBookings.filter(mine);
        ap.amb = (ambRes.requests || []).filter(mine); // newest request first
        ap.loaded = true;
        apDraw();
    }).catch(() => {
        list.innerHTML = apEmpty('fa-triangle-exclamation', 'Could not load your appointments', 'Please check your connection and open this page again.');
    });
}
