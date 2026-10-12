// Patient dashboard (home view): greeting, summary tiles, next appointment and entrance motion.
// Uses `currentUser`, `doctors` and switchView() from the main page script, and shEsc() from popups.js.

const DASH_REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function dashToday() {
    const d = new Date();
    return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// "02:00 PM" -> minutes since midnight, so same-day appointments sort correctly
function dashSlotMinutes(slot) {
    const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(slot || '');
    if (!m) return 0;
    return ((+m[1] % 12) + (m[3].toUpperCase() === 'PM' ? 12 : 0)) * 60 + +m[2];
}

function dashNiceDate(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    if (iso === dashToday()) return 'Today';
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

// Numbers count up to their real value; the figure shown at the end is always the exact one
function dashCount(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const from = parseInt(el.textContent, 10) || 0;
    if (DASH_REDUCED_MOTION || from === value) { el.textContent = value; return; }
    const start = performance.now(), duration = 700;
    (function tick(now) {
        const t = Math.min((now - start) / duration, 1);
        el.textContent = Math.round(from + (value - from) * (1 - Math.pow(1 - t, 3)));
        if (t < 1) requestAnimationFrame(tick);
    })(start);
}

function dashScrollTo(id) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: DASH_REDUCED_MOTION ? 'auto' : 'smooth', block: 'start' });
}

function dashGreeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? 'Good morning' : (hour < 17 ? 'Good afternoon' : 'Good evening');
    const first = currentUser && currentUser.name ? String(currentUser.name).trim().split(/\s+/)[0] : '';
    const title = document.getElementById('dashGreeting'), text = first ? `${part}, ${first}` : part;
    // rebuilt only when the wording changes, so the words do not animate in again on every refresh
    if (title.dataset.text !== text) {
        title.dataset.text = text;
        const words = (first ? part + ',' : part).split(' ');
        title.innerHTML = words.map((w, i) => `<span class="hero-word" style="--w: ${i};">${shEsc(w)}</span>`).join(' ')
            + (first ? ` <span class="hero-word hero-name" style="--w: ${words.length};">${shEsc(first)}</span>` : '');
    }
    const night = hour >= 18 || hour < 5, sky = document.getElementById('heroSky');
    sky.classList.toggle('is-night', night);
    sky.innerHTML = `<i class="fas ${night ? 'fa-moon' : (hour < 12 ? 'fa-sun' : 'fa-cloud-sun')}"></i>`;
    document.getElementById('dashDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function dashRenderNext(next) {
    const box = document.getElementById('dashNext');
    if (!next) {
        box.innerHTML = `
            <div class="dash-next-top">Next appointment</div>
            <div class="dash-next-empty">
                <span class="dash-next-art"><i class="fas fa-calendar-plus"></i></span>
                <b>Nothing scheduled</b>You have no upcoming appointments. Choose a doctor to book one.
            </div>
            <div class="dash-next-foot is-center"><button class="dash-link" onclick="dashScrollTo('dash-doctors')">Find a doctor <i class="fas fa-arrow-right"></i></button></div>`;
        return;
    }
    const doc = doctors.find(d => d.id == next.doctor_id) || { name: 'Your doctor', spec: '', img: '' };
    const status = next.status || 'Pending';
    const days = Math.round((new Date(next.appointment_date + 'T00:00:00') - new Date(dashToday() + 'T00:00:00')) / 86400000);
    box.innerHTML = `
        <div class="dash-next-top">Next appointment <span class="dash-next-status ${status === 'Accepted' ? 'accepted' : ''}">${shEsc(status === 'Pending' ? 'Awaiting confirmation' : status)}</span></div>
        <div class="dash-next-doc">
            <img src="${shEsc(doc.img)}" alt="" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(doc.name)}&background=2563eb&color=fff'">
            <div style="min-width: 0;"><h3>${shEsc(doc.name)}</h3><p>${shEsc(doc.spec)}</p></div>
            <div class="dash-next-when"><small>${days > 1 ? 'In' : 'When'}</small><b>${days <= 0 ? 'Today' : (days === 1 ? 'Tomorrow' : days + ' days')}</b></div>
        </div>
        <div class="dash-next-tear"></div>
        <div class="dash-next-rows">
            <div><small>Date</small><b>${shEsc(dashNiceDate(next.appointment_date))}</b></div>
            <div><small>Time</small><b>${shEsc(next.time_slot)}</b></div>
            <div><small>Token</small><b>${shEsc(next.token_no || '—')}</b></div>
        </div>
        <div class="dash-next-foot"><button class="dash-link" onclick="switchView('bookings')">View all appointments <i class="fas fa-arrow-right"></i></button></div>`;
}

// The lights behind the greeting lean away from the pointer and the ticket tilts towards it
(function dashHeroSetup() {
    const hero = document.getElementById('dashHero');
    if (!hero || DASH_REDUCED_MOTION) return;
    hero.addEventListener('mousemove', e => {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--px', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
        hero.style.setProperty('--py', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    });
    hero.addEventListener('mouseleave', () => { hero.style.setProperty('--px', 0); hero.style.setProperty('--py', 0); });
})();

// Fills the greeting, the four tiles and the next-appointment panel
function refreshDashboard() {
    if (!document.getElementById('dashGreeting')) return;
    dashGreeting();
    finderMoveGlider(); // the home view may have been hidden when the departments were drawn
    qaRefresh();

    if (typeof doctors !== 'undefined' && doctors.length) {
        dashCount('dashKpiDoctors', doctors.length);
        dashCount('dashKpiDepts', new Set(doctors.map(d => d.spec)).size);
        kpiDoctors();
    }
    if (!currentUser || !currentUser.email) return;

    const me = String(currentUser.email).toLowerCase().trim();
    fetch('getBookings.php').then(r => r.json()).then(all => {
        const mine = all.filter(b => b.user_id && String(b.user_id).toLowerCase().trim() === me);
        const today = dashToday();
        const upcoming = mine
            .filter(b => ['Pending', 'Accepted'].includes(b.status || 'Pending') && b.appointment_date >= today)
            .sort((a, b) => a.appointment_date.localeCompare(b.appointment_date) || dashSlotMinutes(a.time_slot) - dashSlotMinutes(b.time_slot));
        const visits = mine.filter(b => b.status === 'Confirmed' || b.status === 'Completed');

        dashCount('dashKpiUpcoming', upcoming.length);
        const navCount = document.getElementById('navUpcoming');
        if (navCount) { navCount.textContent = upcoming.length; navCount.hidden = !upcoming.length; }
        dashCount('dashKpiVisits', visits.length);
        kpiBookings(upcoming, visits);
        document.getElementById('dashKpiUpcomingNote').textContent = upcoming.length ? 'Next: ' + dashNiceDate(upcoming[0].appointment_date) : 'Nothing scheduled';
        dashRenderNext(upcoming[0]);
    }).catch(() => {
        document.getElementById('dashNext').innerHTML = '<div class="dash-next-label">Next appointment</div><p class="dash-next-empty">Could not load your appointments right now.</p>';
    });
}

// =====================================================================
// SUMMARY TILES
// =====================================================================
// A tile's small chart is redrawn only when its numbers change, so it does not replay on every refresh
function kpiDraw(id, signature, html) {
    const el = document.getElementById(id);
    if (!el || el.dataset.sig === signature) return;
    el.dataset.sig = signature;
    el.innerHTML = html;
}

// Doctors in today, and which departments have doctors
function kpiDoctors() {
    const total = doctors.length, today = doctors.filter(finderAvailableToday).length;
    kpiDraw('kpiVizDoctors', `${today}/${total}`, `<span class="kpi-ring" title="${today} of ${total} in today">
        <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23"/><circle class="on" cx="28" cy="28" r="23" pathLength="1" style="--off: ${(1 - today / total).toFixed(3)};"/></svg>
        <b>${today}/${total}</b></span>`);
    document.getElementById('dashKpiDoctorsNote').innerHTML = today ? `<b>${today}</b> in today` : 'None in today';

    const depts = (finder.depts || FINDER_DEPTS).filter(d => d.name !== 'All');
    const counts = depts.map(d => doctors.filter(x => x.spec === d.name).length), staffed = counts.filter(Boolean).length;
    kpiDraw('kpiVizDepts', counts.join(','), `<span class="kpi-segs">${depts.map((d, i) =>
        `<i class="${counts[i] ? 'on' : ''}" style="--n: ${i};" title="${shEsc(d.name)}: ${counts[i]} doctor${counts[i] === 1 ? '' : 's'}"></i>`).join('')}</span>`);
    document.getElementById('dashKpiDeptsNote').innerHTML = `<b>${staffed}</b> of ${depts.length} with doctors`;
}

// The week ahead (days with an appointment are filled) and visits over the last six months
function kpiBookings(upcoming, visits) {
    const now = new Date(), iso = d => new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const week = [0, 1, 2, 3, 4, 5, 6].map(i => {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), key = iso(d);
        return { letter: d.toLocaleDateString('en-IN', { weekday: 'narrow' }), label: dashNiceDate(key), n: upcoming.filter(b => b.appointment_date === key).length };
    });
    kpiDraw('kpiVizUpcoming', week.map(w => w.n).join(','), `<span class="kpi-bars">${week.map((w, i) =>
        `<span class="${i ? '' : 'is-now'}" title="${shEsc(w.label)}: ${w.n} appointment${w.n === 1 ? '' : 's'}"><i class="${w.n ? 'on' : ''}" style="--n: ${i}; --h: ${w.n ? 100 : 24}%;"></i><em>${w.letter}</em></span>`).join('')}</span>`);

    const months = [5, 4, 3, 2, 1, 0].map(back => {
        const d = new Date(now.getFullYear(), now.getMonth() - back, 1), key = iso(d).slice(0, 7);
        return { name: d.toLocaleDateString('en-IN', { month: 'short' }), n: visits.filter(b => String(b.appointment_date).slice(0, 7) === key).length };
    });
    const most = Math.max(...months.map(m => m.n), 1);
    kpiDraw('kpiVizVisits', months.map(m => m.n).join(','), `<span class="kpi-bars">${months.map((m, i) =>
        `<span class="${i === 5 ? 'is-now' : ''}" title="${m.name}: ${m.n} visit${m.n === 1 ? '' : 's'}"><i class="${m.n ? 'on' : ''}" style="--n: ${i}; --h: ${m.n ? Math.max(Math.round(m.n / most * 100), 30) : 12}%;"></i><em>${m.name[0]}</em></span>`).join('')}</span>`);
    document.getElementById('dashKpiVisitsNote').innerHTML = months[5].n ? `<b>${months[5].n}</b> this month` : 'None this month yet';
}

// =====================================================================
// FIND A DOCTOR
// =====================================================================
// `keys` are everyday words a patient might type; they only pick a department, nothing is diagnosed.
const FINDER_DEPTS = [
    { name: 'Cardiology', sub: 'Heart care', icon: 'fa-heart-pulse', keys: ['heart', 'chest', 'blood pressure', 'bp', 'palpitation', 'cholesterol', 'dil', 'seene'] },
    { name: 'Dermatology', sub: 'Skin and hair', icon: 'fa-hand-dots', keys: ['skin', 'rash', 'acne', 'pimple', 'itch', 'hair', 'eczema', 'allergy', 'khujli', 'daane', 'twacha'] },
    { name: 'Dentistry', sub: 'Teeth and gums', icon: 'fa-tooth', keys: ['tooth', 'teeth', 'gum', 'cavity', 'dental', 'braces', 'daant', 'dant'] },
    { name: 'Oncology', sub: 'Cancer care', icon: 'fa-ribbon', keys: ['cancer', 'tumor', 'tumour', 'lump', 'chemo', 'ganth'] },
    { name: 'Neurology', sub: 'Brain and nerves', icon: 'fa-brain', keys: ['headache', 'migraine', 'brain', 'nerve', 'seizure', 'dizzy', 'dizziness', 'numb', 'memory', 'sir dard', 'chakkar'] },
    { name: 'Orthopedics', sub: 'Bones and joints', icon: 'fa-bone', keys: ['bone', 'joint', 'knee', 'back pain', 'fracture', 'shoulder', 'spine', 'neck', 'sprain', 'haddi', 'ghutna', 'kamar'] },
    { name: 'Pediatrics', sub: 'Child care', icon: 'fa-baby', keys: ['child', 'baby', 'kid', 'infant', 'newborn', 'vaccin', 'bachcha', 'bacha'] }
];
const FINDER_URGENT = ['chest pain', 'heart attack', 'stroke', 'unconscious', 'not breathing', 'cannot breathe', "can't breathe", 'heavy bleeding', 'accident', 'behosh'];
const FINDER_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const finder = { dept: 'All', today: false, sort: false };

// "Mon-Fri", "Mon, Wed, Fri", "Monday to Saturday", "Daily" -> Set of weekday numbers (0 = Sunday).
// Returns null when the text cannot be understood, so nothing is claimed about that doctor's days.
function finderParseDays(text) {
    const t = String(text || '').toLowerCase();
    if (/daily|every\s*day|all\s*days/.test(t)) return new Set([0, 1, 2, 3, 4, 5, 6]);
    const days = new Set();
    t.split(/[,&\/]|\band\b/).forEach(part => {
        const found = (part.match(/sun|mon|tue|wed|thu|fri|sat/g) || []).map(d => FINDER_DAYS.indexOf(d));
        if (found.length === 2 && /-|–|\bto\b/.test(part)) {
            for (let d = found[0]; ; d = (d + 1) % 7) { days.add(d); if (d === found[1]) break; }
        } else found.forEach(d => days.add(d));
    });
    return days.size ? days : null;
}

function finderSlots() {
    return [...document.querySelectorAll('#timeSlots .slot-btn')].map(b => b.textContent.trim());
}

// The first day this doctor can still be booked: date, how many days away, and which times are already past
function finderNextDay(days) {
    const slots = finderSlots(), now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
    for (let offset = 0; offset < 14; offset++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        if (days && !days.has(d.getDay())) continue;
        const open = slots.map(s => offset > 0 || dashSlotMinutes(s) > nowMin);
        if (!open.some(Boolean)) continue;
        const iso = new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        const label = offset === 0 ? 'Today' : (offset === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
        return { iso, offset, label, slots, open };
    }
    return null;
}

function finderAvailableToday(doc) {
    const days = finderParseDays(doc.days), next = days && finderNextDay(days);
    return !!next && next.offset === 0;
}

// Called once the doctors list has loaded
function finderLoad() {
    const known = FINDER_DEPTS.map(d => d.name);
    const extra = [...new Set(doctors.map(d => d.spec))].filter(s => s && !known.includes(s))
        .map(name => ({ name, sub: 'Specialist care', icon: 'fa-stethoscope', keys: [name.toLowerCase()] }));
    const depts = [{ name: 'All', label: 'All departments', sub: 'Every doctor', icon: 'fa-hospital' }, ...FINDER_DEPTS, ...extra];
    finder.depts = depts;

    document.getElementById('finderDepts').innerHTML = '<span class="finder-glider"></span>' + depts.map(d => {
        const count = d.name === 'All' ? doctors.length : doctors.filter(x => x.spec === d.name).length;
        return `<button type="button" class="finder-dept ${count ? '' : 'is-empty'}" data-dept="${shEsc(d.name)}">
            <span class="finder-dept-icon"><i class="fas ${d.icon}"></i></span>
            <span class="finder-dept-text"><b>${shEsc(d.label || d.name)}</b><small>${shEsc(d.sub)}</small></span>
            <span class="finder-dept-count">${count}</span>
        </button>`;
    }).join('');
    document.querySelectorAll('.finder-dept').forEach(btn => btn.addEventListener('click', () => {
        finderAskReset();
        filterCategory(btn.dataset.dept);
    }));
    filterCategory(finder.dept);
}

function finderMoveGlider() {
    const active = document.querySelector('.finder-dept.active'), glider = document.querySelector('.finder-glider');
    if (!active || !glider) return;
    glider.style.height = active.offsetHeight + 'px';
    glider.style.transform = `translateY(${active.offsetTop}px)`;
}
window.addEventListener('resize', finderMoveGlider);

// Shows one department (or 'All'); kept under its old name because other scripts may call it
function filterCategory(dept) {
    finder.dept = dept;
    document.querySelectorAll('.finder-dept').forEach(b => b.classList.toggle('active', b.dataset.dept === dept));
    finderMoveGlider();
    const active = document.querySelector('.finder-dept.active');
    if (active && window.innerWidth <= 980) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    finderApply();
}

function finderToggle(key) {
    finder[key] = !finder[key];
    document.getElementById(key === 'today' ? 'finderToday' : 'finderSort').setAttribute('aria-pressed', finder[key]);
    finderApply();
}

function finderApply() {
    let list = finder.dept === 'All' ? doctors.slice() : doctors.filter(d => d.spec === finder.dept);
    if (finder.today) list = list.filter(finderAvailableToday);
    if (finder.sort) list.sort((a, b) => (+b.exp || 0) - (+a.exp || 0));
    document.getElementById('finderTitle').textContent = finder.dept === 'All' ? 'All departments' : finder.dept;
    renderDoctors(list);
}

function finderShowAll() {
    finderAskReset();
    if (finder.today) finderToggle('today');
    filterCategory('All');
}

function renderDoctors(list) {
    const container = document.getElementById('doctors-container');
    const count = document.getElementById('dashDocCount');
    count.textContent = list.length + (list.length === 1 ? ' doctor' : ' doctors');
    count.style.display = '';

    if (!list.length) {
        const where = finder.dept === 'All' ? '' : ` in ${shEsc(finder.dept)}`;
        container.innerHTML = `<div class="dash-empty"><i class="fas fa-user-doctor"></i>
            ${finder.today ? `No doctor${where} is available for the rest of today.` : `No doctors${where} are listed yet.`}
            ${doctors.length ? '<br><button type="button" onclick="finderShowAll()">Show all doctors</button>' : ''}</div>`;
        return;
    }

    const todayNo = new Date().getDay();
    container.innerHTML = list.map((doc, i) => {
        const days = finderParseDays(doc.days), next = finderNextDay(days), today = !!days && !!next && next.offset === 0;
        // Monday first, the way a clinic week is usually read
        const week = days ? `<div class="doc-week"><small>This week</small><div class="doc-week-days">${[1, 2, 3, 4, 5, 6, 0].map(d =>
            `<span class="${days.has(d) ? 'on' : ''} ${d === todayNo ? 'today' : ''}" title="${FINDER_DAYS[d]}">${FINDER_DAYS[d][0].toUpperCase()}</span>`).join('')}</div></div>` : '';
        const status = !days ? (doc.days ? `<i class="far fa-calendar"></i>${shEsc(doc.days)}` : '')
            : (today ? '<i class="fas fa-circle-check"></i>Available today' : (next ? `<i class="far fa-clock"></i>Next available ${shEsc(next.label.toLowerCase())}` : ''));
        const slots = next ? next.slots.map((s, n) =>
            `<button type="button" class="doc-slot" ${next.open[n] ? '' : 'disabled'} onclick="finderQuickBook(${+doc.id}, '${shEsc(s)}', '${next.iso}')">${shEsc(s)}</button>`).join('') : '';
        return `
            <article class="doc-row" style="--i: ${Math.min(i, 8)};">
                <div class="doc-id">
                    <span class="doc-photo">
                        <img src="${shEsc(doc.img)}" alt="" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(doc.name)}&background=2563eb&color=fff'">
                        ${today ? '<i class="doc-live" title="Available today"></i>' : ''}
                    </span>
                    <div style="min-width: 0;">
                        <h4>${shEsc(doc.name)}</h4>
                        <div class="doc-sub"><span class="doc-spec">${shEsc(doc.spec)}</span>${doc.exp ? `<span>${shEsc(doc.exp)} yrs experience</span>` : ''}</div>
                        ${status ? `<div class="doc-avail ${today ? 'is-today' : ''}">${status}</div>` : ''}
                    </div>
                </div>
                ${week}
                <div class="doc-slots">
                    <small>${next ? `${shEsc(next.label)} &middot; tap a time to book` : 'Book a visit'}</small>
                    <div class="doc-slot-row">${slots}
                        <button type="button" class="doc-slot doc-slot--more" onclick="openBookingModal(${+doc.id})">Other date<i class="fas fa-arrow-right"></i></button>
                    </div>
                </div>
            </article>`;
    }).join('');
}

// One tap on a time opens the booking form with that doctor, date and time already chosen
function finderQuickBook(id, slot, iso) {
    openBookingModal(id);
    document.getElementById('bookDate').value = iso;
    const btn = [...document.querySelectorAll('#timeSlots .slot-btn')].find(b => b.textContent.trim() === slot);
    if (btn) selectSlot(btn, slot);
}

// --- "Describe the problem": everyday words pick the department ---
function finderAskReset() {
    document.getElementById('finderAsk').value = '';
    document.querySelector('.finder-ask').classList.remove('has-text');
    document.getElementById('finderHint').hidden = true;
}

function finderAsk() {
    const text = document.getElementById('finderAsk').value.toLowerCase().trim();
    const hint = document.getElementById('finderHint');
    document.querySelector('.finder-ask').classList.toggle('has-text', text !== '');
    hint.className = 'finder-hint';
    if (text.length < 3) { hint.hidden = true; if (!text) filterCategory('All'); return; }

    if (FINDER_URGENT.some(k => text.includes(k))) {
        hint.classList.add('is-urgent');
        hint.innerHTML = `<i class="fas fa-triangle-exclamation"></i><span><b>This may be an emergency.</b> Do not wait for an appointment.</span>
            <button type="button" onclick="sosPressed()">Emergency SOS</button>`;
        hint.hidden = false;
        return;
    }

    let best = null, bestScore = 0;
    (finder.depts || []).forEach(d => {
        const score = (d.keys || []).reduce((sum, k) => sum + (text.includes(k) ? k.length : 0), 0);
        if (score > bestScore) { best = d; bestScore = score; }
    });
    if (best) {
        filterCategory(best.name);
        const row = document.querySelector('.finder-dept.active');
        if (row) { row.classList.remove('is-suggested'); void row.offsetWidth; row.classList.add('is-suggested'); }
        hint.innerHTML = `<i class="fas fa-wand-magic-sparkles"></i><span>Showing <b>${shEsc(best.name)}</b> (${shEsc(best.sub.toLowerCase())}) for what you described. Not the right fit?</span>
            <button type="button" onclick="switchView('ai-checker')">Try the AI Symptom Check</button>`;
    } else {
        hint.innerHTML = `<i class="fas fa-circle-question"></i><span>We could not match that to a department.</span>
            <button type="button" onclick="switchView('ai-checker')">Try the AI Symptom Check</button>`;
    }
    hint.hidden = false;
}

(function finderAskSetup() {
    const input = document.getElementById('finderAsk');
    if (!input) return;
    let timer;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(finderAsk, 250); });
    document.getElementById('finderAskClear').addEventListener('click', () => { finderAskReset(); filterCategory('All'); input.focus(); });
})();

// =====================================================================
// HOSPITAL SERVICES SHOWCASE
// =====================================================================
// All services stay listed by name, so nothing is hidden behind a rotating banner. It moves on by
// itself slowly, waits while the pointer or keyboard is on it, and stops for good once the patient picks one.
const SVC_ITEMS = [
    {
        title: 'Specialist Appointments', line: 'Book a doctor in a few taps', icon: 'fa-user-doctor', tone: '#2563eb',
        kicker: 'Outpatient care', head: 'See the right specialist, on a day that suits you',
        text: 'Choose a department, see which days each doctor is in, and book a time straight from the list.',
        facts: ['Token number at once', 'Pay at the hospital'], cta: 'Find a doctor', run: () => dashScrollTo('dash-doctors'),
        img: 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=1200&q=80'
    },
    {
        title: 'AI Symptom Check', line: 'Not sure whom to see?', icon: 'fa-stethoscope', tone: '#4f46e5',
        kicker: 'Guidance', head: 'Describe how you feel, get pointed to the right department',
        text: 'Write your symptoms in your own words. You get home-care steps and the kind of specialist to consult.',
        facts: ['Available any time', 'Guidance, not a diagnosis'], cta: 'Check symptoms', run: () => switchView('ai-checker'),
        img: 'https://images.unsplash.com/photo-1538108149393-fbbd81895907?w=1200&q=80'
    },
    {
        title: 'Emergency Ambulance', line: 'Help at your location', icon: 'fa-truck-medical', tone: '#dc2626',
        kicker: 'Emergency', head: 'An ambulance sent to where you are',
        text: 'Press SOS to share your live location with the hospital, or request an ambulance to an address.',
        facts: ['Live location with SOS', '24×7 helpline'], cta: 'Request an ambulance', run: () => switchView('ambulance'),
        img: 'https://images.unsplash.com/photo-1551076805-e1869033e561?w=1200&q=80'
    },
    {
        title: 'Medicine Store', line: 'Delivered or ready to collect', icon: 'fa-pills', tone: '#0d9488',
        kicker: 'Pharmacy', head: 'Order medicines from the hospital pharmacy',
        text: 'Add what you need to the cart and follow the order from confirmation to your door or the pickup counter.',
        facts: ['Home delivery or pickup', 'Order status by email'], cta: 'Open the store', run: () => switchView('store'),
        img: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=1200&q=80'
    }
];

const svc = { index: 0, hover: false, focus: false, offscreen: false };

function svcPauseState() {
    const el = document.getElementById('svcShowcase');
    if (el) el.classList.toggle('is-paused', svc.hover || svc.focus || svc.offscreen || document.hidden);
}

function svcSetAuto(on) {
    const el = document.getElementById('svcShowcase'), btn = document.getElementById('svcPlay');
    el.classList.toggle('is-auto', on);
    btn.innerHTML = `<i class="fas ${on ? 'fa-pause' : 'fa-play'}"></i>`;
    btn.setAttribute('aria-label', on ? 'Pause' : 'Play');
}

function svcGo(n, byUser) {
    const total = SVC_ITEMS.length, next = (n + total) % total;
    if (byUser) svcSetAuto(false);
    if (next === svc.index) return;
    const stage = document.querySelector('.svc-stage'), slides = stage.querySelectorAll('.svc-slide'), tabs = document.querySelectorAll('.svc-tab');
    stage.dataset.dir = n < svc.index ? 'prev' : 'next';
    slides.forEach(s => s.classList.remove('prev'));
    slides[svc.index].classList.replace('active', 'prev');
    slides[next].classList.add('active');
    tabs.forEach((t, i) => { t.classList.toggle('active', i === next); t.setAttribute('aria-selected', i === next); t.tabIndex = i === next ? 0 : -1; });
    document.getElementById('svcNow').textContent = String(next + 1).padStart(2, '0');
    svc.index = next;
}

function svcRun(i) { SVC_ITEMS[i].run(); }

(function svcSetup() {
    const el = document.getElementById('svcShowcase');
    if (!el) return;
    el.innerHTML = `
        <div class="svc-tabs" role="tablist" aria-label="Hospital services">${SVC_ITEMS.map((s, i) => `
            <button type="button" class="svc-tab ${i ? '' : 'active'}" role="tab" aria-selected="${!i}" tabindex="${i ? -1 : 0}" style="--tone: ${s.tone};" onclick="svcGo(${i}, true)">
                <span class="svc-tab-icon" style="background-image: url('${s.img.replace('w=1200', 'w=160')}');"><i class="fas ${s.icon}"></i></span>
                <span class="svc-tab-text"><b>${s.title}</b><small>${s.line}</small></span>
                <i class="fas fa-chevron-right"></i>
                <span class="svc-bar"><i></i></span>
            </button>`).join('')}
        </div>
        <div class="svc-stage">${SVC_ITEMS.map((s, i) => `
            <div class="svc-slide ${i ? '' : 'active'}" style="--tone: ${s.tone};">
                <div class="svc-img" style="background-image: url('${s.img}');"></div>
                <div class="svc-shade"></div>
                <div class="svc-mark" aria-hidden="true"><i class="fas ${s.icon}"></i></div>
                <div class="svc-copy">
                    <span class="svc-kicker">${s.kicker}</span>
                    <h2>${s.head}</h2>
                    <p>${s.text}</p>
                    <ul class="svc-facts">${s.facts.map(f => `<li><i class="fas fa-check"></i>${f}</li>`).join('')}</ul>
                    <div class="svc-cta"><button type="button" class="dash-btn dash-btn--light" onclick="svcRun(${i})">${s.cta} <i class="fas fa-arrow-right"></i></button></div>
                </div>
            </div>`).join('')}
            <div class="svc-ctrl">
                <span class="svc-count"><b id="svcNow">01</b> / ${String(SVC_ITEMS.length).padStart(2, '0')}</span>
                <button type="button" aria-label="Previous service" onclick="svcGo(svc.index - 1, true)"><i class="fas fa-chevron-left"></i></button>
                <button type="button" id="svcPlay"></button>
                <button type="button" aria-label="Next service" onclick="svcGo(svc.index + 1, true)"><i class="fas fa-chevron-right"></i></button>
            </div>
        </div>`;

    const stage = el.querySelector('.svc-stage'), tabs = el.querySelector('.svc-tabs');
    document.getElementById('svcPlay').addEventListener('click', () => svcSetAuto(!el.classList.contains('is-auto')));
    svcSetAuto(!DASH_REDUCED_MOTION);

    // the bar under the open service finishing is what moves it on, so a pause never loses its place
    // (a bar that finished in the same frame the patient took over must not move it again)
    tabs.addEventListener('animationend', e => {
        if (e.animationName !== 'svcFill' || !el.classList.contains('is-auto') || !e.target.closest('.svc-tab.active')) return;
        svcGo(svc.index + 1, false);
    });
    tabs.addEventListener('keydown', e => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        svcGo(svc.index + step, true);
        tabs.querySelectorAll('.svc-tab')[svc.index].focus();
    });

    el.addEventListener('mouseenter', () => { svc.hover = true; svcPauseState(); });
    el.addEventListener('mouseleave', () => { svc.hover = false; svcPauseState(); stage.style.setProperty('--px', 0); stage.style.setProperty('--py', 0); });
    el.addEventListener('focusin', () => { svc.focus = true; svcPauseState(); });
    el.addEventListener('focusout', () => { svc.focus = false; svcPauseState(); });
    document.addEventListener('visibilitychange', svcPauseState);
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(([entry]) => { svc.offscreen = !entry.isIntersecting; svcPauseState(); }, { threshold: 0.3 }).observe(el);
    }

    if (!DASH_REDUCED_MOTION) {
        stage.addEventListener('mousemove', e => {
            const r = stage.getBoundingClientRect();
            stage.style.setProperty('--px', ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
            stage.style.setProperty('--py', ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
        });
    }

    let touchX = null;
    stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', e => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) > 45) svcGo(svc.index + (dx < 0 ? 1 : -1), true);
    }, { passive: true });
})();

// =====================================================================
// SIDEBAR
// =====================================================================
// One highlight slides to the open page instead of each item lighting up on its own
function navMoveGlider() {
    const glider = document.getElementById('navGlider'), active = document.querySelector('#navItems .nav-item.active');
    if (!glider) return;
    glider.classList.toggle('is-on', !!active);
    if (!active) return;
    glider.classList.toggle('is-danger', active.classList.contains('nav-item--danger'));
    glider.style.height = active.offsetHeight + 'px';
    glider.style.transform = `translateY(${active.offsetTop}px)`;
}

(function navSetup() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !document.getElementById('navGlider')) return;
    navMoveGlider();
    window.addEventListener('resize', navMoveGlider);
    // collapsing the menu changes every item's position
    new MutationObserver(() => requestAnimationFrame(navMoveGlider)).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(navMoveGlider);
})();

// =====================================================================
// HEADER
// =====================================================================
const HEADER_PAGES = {
    'home': 'Dashboard', 'bookings': 'My Appointments', 'ai-checker': 'AI Symptom Check', 'store': 'Medicine Store',
    'healthcard': 'My Health Card', 'ambulance': 'Book Ambulance', 'profile': 'My Profile', 'blog': 'Health Blog'
};

// Called by switchView(): the header names the page you are on
function headerSetPage(view) {
    navMoveGlider();
    const el = document.getElementById('headerPage');
    if (!el || !HEADER_PAGES[view] || el.textContent === HEADER_PAGES[view]) return;
    el.textContent = HEADER_PAGES[view];
    el.classList.remove('is-changing');
    void el.offsetWidth;
    el.classList.add('is-changing');
    headerProgress();
}

function headerProgress() {
    const box = document.querySelector('.main-content'), header = document.getElementById('appHeader');
    if (!box || !header) return;
    const room = box.scrollHeight - box.clientHeight;
    header.style.setProperty('--progress', room > 0 ? Math.min(box.scrollTop / room, 1).toFixed(4) : 0);
    header.classList.toggle('is-scrolled', box.scrollTop > 8);
}

(function headerSetup() {
    const header = document.getElementById('appHeader');
    if (!header) return;
    document.querySelector('.main-content').addEventListener('scroll', headerProgress, { passive: true });
    headerProgress();

    // the empty search box quietly shows what it can find
    const input = document.getElementById('searchInput');
    const hints = [input.placeholder, 'Find a doctor by name…', 'Find a department…', 'Find a medicine…', 'Describe a symptom — try “knee pain”', 'Jump to a page — try “appointments”'];
    let n = 0;
    if (!DASH_REDUCED_MOTION) setInterval(() => {
        if (document.hidden || input.value || document.activeElement === input) return;
        input.classList.add('is-swapping');
        setTimeout(() => { n = (n + 1) % hints.length; input.placeholder = hints[n]; input.classList.remove('is-swapping'); }, 260);
    }, 4000);
})();

// =====================================================================
// QUICK ACTIONS
// =====================================================================
// The tiles show what is true right now: the doctors you can book and what is in your cart
function qaRefresh() {
    const faces = document.getElementById('qaFaces');
    if (!faces) return;
    if (typeof doctors !== 'undefined' && doctors.length) {
        const depts = new Set(doctors.map(d => d.spec)).size;
        document.getElementById('qaDocMeta').textContent =
            `${doctors.length} doctor${doctors.length === 1 ? '' : 's'} across ${depts} department${depts === 1 ? '' : 's'} — pick a day and a time.`;
        faces.innerHTML = doctors.slice(0, 4).map(d =>
            `<img src="${shEsc(d.img)}" alt="" title="${shEsc(d.name)}" onerror="this.onerror=null; this.src='https://ui-avatars.com/api/?name=${encodeURIComponent(d.name)}&background=2563eb&color=fff'">`).join('')
            + (doctors.length > 4 ? `<span>+${doctors.length - 4}</span>` : '');
    }
    const cart = typeof stCartCount === 'function' ? stCartCount() : 0, meta = document.getElementById('qaCartMeta');
    meta.textContent = cart ? `${cart} item${cart === 1 ? '' : 's'} waiting in your cart` : 'Order for delivery or pickup';
    meta.classList.toggle('is-live', cart > 0);
}

(function qaSetup() {
    const grid = document.getElementById('quickActions');
    if (!grid) return;

    // the week ahead, starting today
    const today = new Date();
    document.getElementById('qaWeek').innerHTML = [0, 1, 2, 3, 4, 5, 6].map(i => {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
        return `<span class="qa-day ${i ? '' : 'is-today'}" style="--n: ${i};"><span>${i ? d.toLocaleDateString('en-IN', { weekday: 'short' }) : 'Today'}</span><em>${d.getDate()}</em></span>`;
    }).join('');

    // percentages, so the light lands under the pointer whatever the page zoom is
    const light = e => {
        const tile = e.target.closest('.qa-tile, .dash-kpi');
        if (!tile) return;
        const r = tile.getBoundingClientRect();
        tile.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        tile.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
    };
    grid.addEventListener('mousemove', light);
    document.getElementById('dashKpis').addEventListener('mousemove', light);

    // the cart badge in the header changes whenever the cart does
    const badge = document.querySelector('.header .st-cart-count');
    if (badge) new MutationObserver(qaRefresh).observe(badge, { childList: true, characterData: true, subtree: true });
})();

// =====================================================================
// FOOTER
// =====================================================================
// On a desktop the page scrolls inside .main-content, on a phone the window itself scrolls
function ftTop() {
    const behavior = DASH_REDUCED_MOTION ? 'auto' : 'smooth';
    document.querySelector('.main-content').scrollTo({ top: 0, behavior });
    window.scrollTo({ top: 0, behavior });
}

(function ftSetup() {
    const year = document.getElementById('ftYear');
    if (year) year.textContent = new Date().getFullYear();
})();

// Sections fade and rise into place the first time they scroll into view
(function dashReveal() {
    const items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) { items.forEach(el => el.classList.add('is-in')); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
    }), { threshold: 0.08 });
    items.forEach(el => io.observe(el));
})();

refreshDashboard();
