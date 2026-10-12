// Book Ambulance page (patient site): emergency type as tiles, details filled from the profile,
// and a confirm button that shows it is working.
// Uses `currentUser` and bookAmbulance() from the main page script.

const AM_TYPES = [
    { value: 'Heart Attack / Stroke', label: 'Heart attack or stroke', icon: 'fa-heart-pulse' },
    { value: 'Accident / Trauma', label: 'Accident or injury', icon: 'fa-car-burst' },
    { value: 'Pregnancy', label: 'Pregnancy', icon: 'fa-person-pregnant' },
    { value: 'General Emergency', label: 'Other emergency', icon: 'fa-kit-medical' }
];
const AM_FIELDS = ['ambName', 'ambPhone', 'ambAddress'];

function ambPick(value) {
    document.getElementById('ambType').value = value;
    document.querySelectorAll('#amTypes button').forEach(b => b.classList.toggle('active', b.dataset.type === value));
}

// Called by switchView('ambulance'). In an emergency nobody should have to type what the hospital
// already knows, so empty boxes are filled from the profile; anything already typed is left alone.
function ambOpen() {
    if (!currentUser) return;
    const from = { ambName: currentUser.name, ambPhone: currentUser.phone, ambAddress: currentUser.address };
    let filled = false;
    AM_FIELDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el.value.trim() && from[id]) { el.value = from[id]; filled = true; }
    });
    if (filled) document.getElementById('amFilled').hidden = false;
}

function ambSubmit() {
    const empty = AM_FIELDS.filter(id => !document.getElementById(id).value.trim());
    AM_FIELDS.forEach(id => document.getElementById(id).closest('.form-group').classList.toggle('is-missing', empty.includes(id)));
    if (empty.length) {
        document.getElementById(empty[0]).focus();
        return bookAmbulance(); // it shows the "provide all details" message
    }
    const btn = document.getElementById('amSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending your request…';
    bookAmbulance(); // it calls ambDone() when the hospital has answered
}

// Called by bookAmbulance() once the request has been answered, whatever the answer
function ambDone() {
    const btn = document.getElementById('amSubmit');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-truck-medical"></i> Confirm Ambulance Booking';
    document.getElementById('amFilled').hidden = true;
}

// From the "what happens next" card: straight to the ambulance tab of My Appointments
function ambTrack() {
    switchView('bookings');
    apTab('ambulance');
}

(function ambSetup() {
    const types = document.getElementById('amTypes');
    if (!types) return;
    types.innerHTML = AM_TYPES.map(t => `<button type="button" data-type="${t.value}" onclick="ambPick(this.dataset.type)"><i class="fas ${t.icon}"></i>${t.label}</button>`).join('');
    ambPick(document.getElementById('ambType').value);
    // a box stops being marked as missing as soon as something is typed in it
    document.getElementById('ambulance-view').addEventListener('input', e => {
        const group = e.target.closest('.form-group');
        if (group) group.classList.remove('is-missing');
    });
})();
