// Book Ambulance page (patient site).
//  * The pickup point is set on a map: GPS, an address search, a tap on the map or dragging the pin.
//  * A road route is drawn from the hospital in Mumbai to that point, with the distance and time.
//  * After booking, the request can be followed live: the ambulance moves along the route on the map.
// Uses `currentUser`, switchView(), shToast() / shConfirm() from the main page and shEsc() / shPin() from features.js.

const AM_TYPES = [
    { value: 'Heart Attack / Stroke', label: 'Heart attack or stroke', icon: 'fa-heart-pulse' },
    { value: 'Accident / Trauma', label: 'Accident or injury', icon: 'fa-car-burst' },
    { value: 'Pregnancy', label: 'Pregnancy', icon: 'fa-person-pregnant' },
    { value: 'General Emergency', label: 'Other emergency', icon: 'fa-kit-medical' }
];
const AM_FIELDS = ['ambName', 'ambPhone', 'ambAddress'];
const AM_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
// shown until the server has told us where the hospital is
const AM_DEFAULT_HOSPITAL = { name: 'SmartHealth Hospital', lat: 19.11499, lng: 72.86817, address: 'Andheri East, Mumbai' };

const am = { map: null, hospital: null, hospMarker: null, pin: null, pinMarker: null, line: null, routeSeq: 0, autoAddress: '', searchTimer: null, track: null };

// ---------------------------------------------------------------- shared map helpers (also used by the SOS tracker)

function amTiles(map) {
    L.tileLayer(AM_TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
}

// Length in km between two [lat, lng] points
function amKm(a, b) {
    const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

// The route split at `fraction` of its length: [part already driven, part still to drive]
function amSplitRoute(coords, fraction) {
    if (!coords || coords.length < 2) return [[], coords || []];
    if (fraction <= 0) return [[], coords];
    if (fraction >= 1) return [coords, []];
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + amKm(coords[i - 1], coords[i]));
    const target = cum[cum.length - 1] * fraction;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const seg = cum[i] - cum[i - 1], t = seg ? (target - cum[i - 1]) / seg : 0;
    const mid = [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
    return [coords.slice(0, i).concat([mid]), [mid].concat(coords.slice(i))];
}

// Draws a route on a map: grey where the ambulance has been, red where it still has to go.
// `layers` keeps the two lines between calls so they are updated instead of redrawn.
function amDrawRoute(map, layers, coords, fraction) {
    const [done, left] = amSplitRoute(coords, fraction || 0);
    if (!layers.left) {
        layers.done = L.polyline([], { color: '#94a3b8', weight: 6, opacity: .8, lineCap: 'round' }).addTo(map);
        layers.casing = L.polyline([], { color: '#fff', weight: 9, opacity: .9, lineCap: 'round' }).addTo(map);
        layers.left = L.polyline([], { color: '#dc2626', weight: 5, opacity: .95, lineCap: 'round' }).addTo(map);
    }
    layers.done.setLatLngs(done);
    layers.casing.setLatLngs(left);
    layers.left.setLatLngs(left);
}

// Moves a marker smoothly to its new place instead of jumping
function amGlide(marker, to, ms) {
    const from = marker.getLatLng(), start = performance.now();
    if (marker._amGlide) cancelAnimationFrame(marker._amGlide);
    const step = now => {
        const t = Math.min(1, (now - start) / (ms || 900)), e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        marker.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]);
        if (t < 1) marker._amGlide = requestAnimationFrame(step);
    };
    marker._amGlide = requestAnimationFrame(step);
}

function amMinutes(m) {
    if (m < 60) return `${Math.max(1, Math.round(m))} min`;
    return `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min`;
}

async function amGet(url) {
    const r = await fetch(url);
    return r.json();
}

// ---------------------------------------------------------------- emergency type tiles

function ambPick(value) {
    document.getElementById('ambType').value = value;
    document.querySelectorAll('#amTypes button').forEach(b => b.classList.toggle('active', b.dataset.type === value));
}

// Called by switchView('ambulance'). In an emergency nobody should have to type what the hospital
// already knows, so empty boxes are filled from the profile; anything already typed is left alone.
function ambOpen() {
    if (currentUser) {
        const from = { ambName: currentUser.name, ambPhone: currentUser.phone };
        let filled = false;
        Object.keys(from).forEach(id => {
            const el = document.getElementById(id);
            if (!el.value.trim() && from[id]) { el.value = from[id]; filled = true; }
        });
        if (filled) document.getElementById('amFilled').hidden = false;
    }
    ambInitMap();
}

// ---------------------------------------------------------------- the pickup map

function ambInitMap() {
    if (typeof L === 'undefined') return;
    if (am.map) { setTimeout(() => am.map.invalidateSize(), 120); return; }
    const h = am.hospital || AM_DEFAULT_HOSPITAL;
    am.map = L.map('amMap', { zoomControl: true, scrollWheelZoom: false }).setView([h.lat, h.lng], 12);
    amTiles(am.map);
    am.hospMarker = L.marker([h.lat, h.lng], { icon: shPin('hosp', 'fa-hospital'), zIndexOffset: 500 }).addTo(am.map)
        .bindPopup(`<b>${shEsc(h.name)}</b><br>${shEsc(h.address || '')}`);
    am.map.on('click', e => ambSetPin(e.latlng.lat, e.latlng.lng, 'map'));
    am.map.on('focus', () => am.map.scrollWheelZoom.enable());
    am.map.on('blur', () => am.map.scrollWheelZoom.disable());
    setTimeout(() => am.map.invalidateSize(), 150);

    // where the hospital really is (it can be changed in the server settings)
    amGet('api/ambulance').then(d => {
        if (!d.hospital) return;
        am.hospital = d.hospital;
        am.hospMarker.setLatLng([d.hospital.lat, d.hospital.lng]).setPopupContent(`<b>${shEsc(d.hospital.name)}</b><br>${shEsc(d.hospital.address)}`);
        if (!am.pin) am.map.setView([d.hospital.lat, d.hospital.lng], 12);
    }).catch(() => {});
}

function ambSetPin(lat, lng, source, label) {
    am.pin = { lat, lng, source };
    if (!am.pinMarker) {
        am.pinMarker = L.marker([lat, lng], { icon: shPin('me', 'fa-location-dot'), draggable: true, zIndexOffset: 1000 }).addTo(am.map);
        am.pinMarker.on('dragend', () => {
            const p = am.pinMarker.getLatLng();
            ambSetPin(p.lat, p.lng, 'map');
        });
    } else {
        am.pinMarker.setLatLng([lat, lng]);
    }
    document.getElementById('amMapHint').innerHTML = '<i class="fas fa-circle-check"></i>Pickup point set. Drag the red pin if it is not exactly right.';
    document.getElementById('amMapHint').classList.add('is-set');
    ambPreviewRoute();
    ambFillAddress(lat, lng, label);
}

// The address box follows the pin, unless the patient has written their own address in it
function ambFillAddress(lat, lng, label) {
    const box = document.getElementById('ambAddress');
    const mine = box.value.trim() && box.value.trim() !== am.autoAddress;
    if (mine) return;
    const put = text => {
        if (!text || (box.value.trim() && box.value.trim() !== am.autoAddress)) return;
        box.value = am.autoAddress = text;
        box.closest('.form-group').classList.remove('is-missing');
    };
    if (label) return put(label);
    amGet(`api/geo/reverse?lat=${lat}&lng=${lng}`).then(d => put(d.address)).catch(() => {});
}

function ambPreviewRoute() {
    const seq = ++am.routeSeq, box = document.getElementById('amRoute');
    box.hidden = false;
    box.className = 'am-route';
    box.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>Finding the road route from the hospital…</span>';
    amGet(`api/ambulance/route?lat=${am.pin.lat}&lng=${am.pin.lng}`).then(d => {
        if (seq !== am.routeSeq) return; // the pin moved again meanwhile
        if (d.status !== 'success') throw new Error(d.message);
        am.hospital = d.hospital;
        if (!am.line) am.line = {};
        amDrawRoute(am.map, am.line, d.route, 0);
        am.map.fitBounds(L.latLngBounds(d.route).pad(0.15), { maxZoom: 16 });
        const s = d.summary;
        const far = !d.in_service_area;
        box.className = 'am-route' + (far ? ' is-far' : '');
        box.innerHTML = `
            <span class="am-route-ico"><i class="fas ${far ? 'fa-triangle-exclamation' : 'fa-route'}"></i></span>
            <div>
                <b>${s.km} km by road · about ${amMinutes(s.minutes)}</b>
                <small>From ${shEsc(d.hospital.name)}, ${shEsc(d.hospital.address)}${s.source === 'estimate' ? ' · approximate (road map not reachable)' : ''}</small>
                ${far ? `<small class="am-far">This place is ${d.straight_km} km from the hospital, outside our ${d.service_radius_km} km Mumbai service area. You can still book, but for a faster response call <a href="tel:108">108</a>.</small>` : ''}
            </div>`;
    }).catch(() => {
        if (seq !== am.routeSeq) return;
        box.className = 'am-route is-far';
        box.innerHTML = '<span class="am-route-ico"><i class="fas fa-triangle-exclamation"></i></span><div><b>Could not draw the route</b><small>Your pickup point is still saved and sent with the booking.</small></div>';
    });
}

function ambUseGps() {
    const btn = document.getElementById('amGpsBtn');
    if (!navigator.geolocation) return shToast('This device cannot share its location. Search the address or tap the map instead.', 'error');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Finding you…';
    const done = () => { btn.disabled = false; btn.innerHTML = '<i class="fas fa-location-crosshairs"></i> Use my current location'; };
    navigator.geolocation.getCurrentPosition(pos => {
        done();
        ambSetPin(pos.coords.latitude, pos.coords.longitude, 'gps');
        if (pos.coords.accuracy > 300) {
            shToast(`Your location is only approximate (about ${Math.round(pos.coords.accuracy)} m). Drag the pin to the exact place.`, 'info');
        }
    }, err => {
        done();
        shToast(err.code === err.PERMISSION_DENIED ? 'Location permission was denied. Search the address or tap the map instead.'
            : 'Could not read your location. Search the address or tap the map instead.', 'error');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
}

function ambSearchSetup() {
    const input = document.getElementById('amSearch'), list = document.getElementById('amResults');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(am.searchTimer);
        const q = input.value.trim();
        if (q.length < 3) { list.hidden = true; return; }
        am.searchTimer = setTimeout(() => {
            list.hidden = false;
            list.innerHTML = '<div class="am-res-note"><i class="fas fa-circle-notch fa-spin"></i> Searching…</div>';
            amGet('api/geo/search?q=' + encodeURIComponent(q)).then(d => {
                if (input.value.trim() !== q) return;
                const places = d.places || [];
                list.innerHTML = places.length ? places.map((p, i) => `
                    <button type="button" data-i="${i}"><i class="fas fa-location-dot"></i><span>${shEsc(p.name)}<small>${p.km} km from the hospital</small></span></button>`).join('')
                    : `<div class="am-res-note">${shEsc(d.message || 'No place found. Try a nearby landmark, or tap the map.')}</div>`;
                list.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
                    const p = places[+b.dataset.i];
                    list.hidden = true;
                    input.value = '';
                    ambSetPin(p.lat, p.lng, 'search', p.name);
                }));
            }).catch(() => { list.innerHTML = '<div class="am-res-note">Search is not available right now. Tap the map instead.</div>'; });
        }, 450);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') list.hidden = true; });
    document.addEventListener('click', e => { if (!e.target.closest('.am-search')) list.hidden = true; });
}

// ---------------------------------------------------------------- booking

async function ambSubmit() {
    const empty = AM_FIELDS.filter(id => !document.getElementById(id).value.trim());
    AM_FIELDS.forEach(id => document.getElementById(id).closest('.form-group').classList.toggle('is-missing', empty.includes(id)));
    if (empty.length) {
        document.getElementById(empty[0]).focus();
        return shToast('Please fill in the patient name, phone number and pickup address.', 'error');
    }
    if (!currentUser) return shToast('Please log in to book an ambulance, or press SOS.', 'error');
    if (!am.pin && !await shConfirm('No pickup point is set on the map. We will try to find the address you typed - the route may be less exact. Book anyway?',
        { yes: 'Book anyway', no: 'Set it on the map' })) return;

    const btn = document.getElementById('amSubmit');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending your request…';
    const fd = new FormData();
    fd.append('name', document.getElementById('ambName').value.trim());
    fd.append('phone', document.getElementById('ambPhone').value.trim());
    fd.append('pickup', document.getElementById('ambAddress').value.trim());
    fd.append('destination', document.getElementById('ambType').value);
    if (am.pin) { fd.append('lat', am.pin.lat); fd.append('lng', am.pin.lng); fd.append('pin_source', am.pin.source); }
    try {
        const res = await fetch('api/ambulance/book', { method: 'POST', body: fd }).then(r => r.json());
        if (res.status !== 'success') throw new Error(res.message || 'Could not book the ambulance.');
        shToast('Ambulance requested. The emergency desk has your location.', 'success');
        document.getElementById('amFilled').hidden = true;
        document.getElementById('ambAddress').value = am.autoAddress = '';
        if (!res.located) shToast('We could not find that address on the map. The hospital will call you to confirm it.', 'info');
        ambTrackOpen(res.id);
    } catch (e) {
        shToast(e.message === 'Failed to fetch' ? 'Server Error' : e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-truck-medical"></i> Confirm Ambulance Booking';
    }
}

// From the "what happens next" card: straight to the ambulance tab of My Appointments
function ambTrack() {
    switchView('bookings');
    apTab('ambulance');
}

async function ambCancelRequest(id) {
    const res = await fetch('api/ambulance/cancel', { method: 'POST', body: new URLSearchParams({ id }) }).then(r => r.json()).catch(() => ({}));
    if (res.status !== 'success') return shToast(res.message || 'Could not cancel the request.', 'error');
    shToast('Ambulance request cancelled.', 'success');
    if (typeof renderBookings === 'function' && document.getElementById('bookings-view').style.display === 'block') renderBookings();
    if (am.track && am.track.id === id) ambTrackRefresh();
}

// ---------------------------------------------------------------- live tracking

const AM_STEPS = ['Requested', 'Dispatched', 'Arrived', 'Completed'];

function ambTrackOpen(id) {
    ambTrackClose();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="amt-overlay" id="amTrackBox" onclick="if (event.target === this) ambTrackClose()">
            <div class="amt-panel" role="dialog" aria-label="Ambulance tracking">
                <div class="amt-head">
                    <div><small>Ambulance request #${+id}</small><h3 id="amtTitle">Loading…</h3></div>
                    <button type="button" class="amt-close" onclick="ambTrackClose()" aria-label="Close"><i class="fas fa-xmark"></i></button>
                </div>
                <div class="amt-map" id="amtMap"></div>
                <div class="amt-body" id="amtBody"></div>
            </div>
        </div>`);
    am.track = { id, map: null, layers: {}, amb: null, pickup: null, fitted: false, timer: setInterval(ambTrackRefresh, 4000) };
    ambTrackRefresh();
}

function ambTrackClose() {
    if (!am.track) return;
    clearInterval(am.track.timer);
    if (am.track.map) am.track.map.remove();
    am.track = null;
    const box = document.getElementById('amTrackBox');
    if (box) box.remove();
}

function ambTrackRefresh() {
    const t = am.track;
    if (!t) return;
    amGet('api/ambulance/track?id=' + t.id).then(d => {
        if (!am.track || am.track !== t) return;
        if (d.status !== 'success') {
            document.getElementById('amtTitle').textContent = d.message || 'Could not load this request';
            clearInterval(t.timer);
            return;
        }
        ambTrackRender(t, d);
    }).catch(() => {});
}

function ambTrackRender(t, d) {
    const r = d.request, amb = d.ambulance, eta = d.eta, h = d.hospital;
    const state = r.status;
    const step = { Pending: 1, Dispatched: 2, Arrived: 3, Completed: 4 }[state] || 0;
    const titles = {
        Pending: 'Waiting for an ambulance to be assigned',
        Dispatched: `Ambulance on the way${eta ? ` · ${eta.minutes_left > 0 ? amMinutes(eta.minutes_left) : 'arriving now'}` : ''}`,
        Arrived: 'The ambulance has reached you',
        Completed: 'Completed - the patient reached the hospital',
        Cancelled: 'This request was cancelled'
    };
    document.getElementById('amtTitle').textContent = titles[state] || state;

    // ---- map
    if (typeof L !== 'undefined') {
        if (!t.map) {
            t.map = L.map('amtMap', { zoomControl: false }).setView([h.lat, h.lng], 13);
            amTiles(t.map);
            L.control.zoom({ position: 'bottomright' }).addTo(t.map);
            L.marker([h.lat, h.lng], { icon: shPin('hosp', 'fa-hospital') }).addTo(t.map).bindPopup(`<b>${shEsc(h.name)}</b><br>${shEsc(h.address)}`);
            setTimeout(() => t.map && t.map.invalidateSize(), 150);
        }
        if (r.pickup_lat !== null && !t.pickup) {
            t.pickup = L.marker([r.pickup_lat, r.pickup_lng], { icon: shPin('me', 'fa-location-dot') }).addTo(t.map).bindPopup('Pickup point');
        }
        if (d.route) amDrawRoute(t.map, t.layers, d.route, eta ? eta.fraction : (state === 'Arrived' || state === 'Completed' ? 1 : 0));
        if (amb && amb.lat !== null && ['Dispatched', 'Arrived'].includes(state)) {
            const p = [+amb.lat, +amb.lng];
            if (!t.amb) t.amb = L.marker(p, { icon: shPin('amb', 'fa-truck-medical'), zIndexOffset: 900 }).addTo(t.map).bindPopup(shEsc(amb.vehicle_no));
            else amGlide(t.amb, p, 1200);
        } else if (t.amb) {
            t.map.removeLayer(t.amb);
            t.amb = null;
        }
        if (!t.fitted && d.route) {
            t.map.fitBounds(L.latLngBounds(d.route).pad(0.12), { maxZoom: 16 });
            t.fitted = true;
        }
    }

    // ---- details
    const s = d.route_summary;
    const live = amb && amb.live;
    const open = ['Pending', 'Dispatched', 'Arrived'].includes(state);
    let info = '';
    if (state === 'Pending') {
        info = `<div class="amt-eta"><i class="fas fa-hourglass-half"></i><div><b>Request received by the emergency desk</b>
            <small>${s ? `The ambulance will drive ${s.km} km from ${shEsc(h.name)} - about ${amMinutes(s.minutes)} once it leaves.` : 'The hospital will call you to confirm the address.'}</small></div></div>`;
    } else if (state === 'Dispatched' && eta) {
        info = `<div class="amt-eta is-live"><i class="fas fa-truck-medical"></i><div>
            <b>${eta.minutes_left > 0 ? amMinutes(eta.minutes_left) : 'Arriving now'} <span>· ${eta.km_left} km left</span></b>
            <small><em class="amt-dot ${live ? 'on' : ''}"></em>${live ? 'Live GPS from the ambulance' : 'Estimated position on the road route (driver GPS not connected)'}</small></div></div>
            <div class="amt-progress"><i style="width: ${Math.round(eta.fraction * 100)}%"></i></div>`;
    } else if (state === 'Arrived') {
        info = `<div class="amt-eta is-done"><i class="fas fa-location-dot"></i><div><b>The ambulance is at the pickup point</b><small>Please go to the ambulance or guide the crew to the patient.</small></div></div>`;
    }
    document.getElementById('amtBody').innerHTML = `
        ${state === 'Cancelled' ? '' : `<ol class="ap-steps amt-steps">${AM_STEPS.map((n, i) => `<li class="${i < step ? 'done' : (i === step ? 'now' : '')} ${i < step - 1 ? 'fill' : ''}" style="--s: ${i};">${n}</li>`).join('')}</ol>`}
        ${info}
        <div class="amt-facts">
            <span><i class="fas fa-user"></i>${shEsc(r.patient_name)} · ${shEsc(r.emergency_type || 'Emergency')}</span>
            <span><i class="fas fa-location-dot"></i>${shEsc(r.address)}</span>
            ${amb ? `<span><i class="fas fa-truck-medical"></i>${shEsc(amb.vehicle_no)} · Driver ${shEsc(amb.driver_name)}</span>` : ''}
        </div>
        <div class="amt-actions">
            ${open ? `<a class="amt-call" href="tel:${shEsc(amb && amb.driver_phone ? amb.driver_phone : h.phone)}"><i class="fas fa-phone"></i>${amb && amb.driver_phone ? 'Call the driver' : 'Call the hospital'}</a>` : ''}
            ${['Pending', 'Dispatched'].includes(state) ? `<button type="button" class="amt-cancel" onclick="ambTrackCancel(${+r.id})"><i class="fas fa-xmark"></i>Cancel request</button>` : ''}
            <button type="button" class="amt-close-btn" onclick="ambTrackClose()">${open ? 'Hide' : 'Close'}</button>
        </div>`;
    if (!open) clearInterval(t.timer);
}

async function ambTrackCancel(id) {
    if (!await shConfirm('Cancel this ambulance request? The ambulance will be told not to come.', { yes: 'Yes, cancel', no: 'Keep request', danger: true })) return;
    ambCancelRequest(id);
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
    ambSearchSetup();
})();
