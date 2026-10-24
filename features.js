// Patient-side features for index.html: Emergency SOS + Smart Health Card.
// Uses `currentUser` and `logout()` from the main page script.

function shEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shPost(url, data) {
    const fd = new FormData();
    Object.keys(data || {}).forEach(k => fd.append(k, data[k] ?? ''));
    return fetch(url, { method: 'POST', body: fd }).then(r => r.json());
}

function shPin(kind, icon) {
    return L.divIcon({ className: '', html: `<div class="map-pin ${kind}"><i class="fas ${icon}"></i></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
}

function showBookingSuccess(b) {
    const nice = new Date(b.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    document.body.insertAdjacentHTML('beforeend', `
        <div class="sh-success" id="shSuccess" onclick="if (event.target === this) closeBookingSuccess()">
            <div class="sh-success-card">
                <div class="sh-check"><i class="fas fa-check"></i></div>
                <h2>Appointment Booked!</h2>
                <p class="sh-sub">Your request has been sent to the hospital.</p>
                <div class="sh-token"><small>YOUR TOKEN NUMBER</small><b>${shEsc(b.token)}</b></div>
                <div class="sh-details">
                    <div><i class="fas fa-user-doctor"></i> ${shEsc(b.doctor)} <span>${shEsc(b.spec || '')}</span></div>
                    <div><i class="far fa-calendar"></i> ${shEsc(nice)}</div>
                    <div><i class="far fa-clock"></i> ${shEsc(b.time)}</div>
                </div>
                <p class="sh-mail"><i class="fas fa-envelope"></i> Confirmation sent to <b>${shEsc(b.email)}</b>. You will also get a reminder before your appointment.</p>
                <div class="sh-actions">
                    <button class="ghost" onclick="closeBookingSuccess()">Done</button>
                    <button onclick="closeBookingSuccess(); switchView('bookings')">View My Bookings</button>
                </div>
            </div>
        </div>`);
}

function closeBookingSuccess() {
    const el = document.getElementById('shSuccess');
    if (el) el.remove();
}

// =====================================================================
// EMERGENCY SOS
// Press SOS -> 5 second countdown (cancel for accidental presses) -> the phone's
// location is sent to the hospital automatically -> live ambulance tracking.
// =====================================================================
const SOS_KEY = 'smartHealthSosToken';
const sos = { token: localStorage.getItem(SOS_KEY), countdown: null, poll: null, watch: null, lastSent: 0, map: null, meMarker: null, ambMarker: null, fitted: false };

document.body.insertAdjacentHTML('beforeend', `
    <button class="sos-fab" id="sosFab" onclick="sosPressed()" aria-label="Emergency SOS">
        <i class="fas fa-truck-medical"></i>SOS<small id="sosFabLabel">EMERGENCY</small>
    </button>
    <div class="sos-overlay" id="sosOverlay"><div class="sos-panel" id="sosPanel"></div></div>`);

function sosPanel(html) {
    document.getElementById('sosPanel').innerHTML = html;
    document.getElementById('sosOverlay').classList.add('show');
}

function sosHide() {
    document.getElementById('sosOverlay').classList.remove('show');
}

function sosPressed() {
    if (sos.token) { sosShowTracking(); return; }
    let left = 5;
    const draw = () => sosPanel(`
        <h2><i class="fas fa-triangle-exclamation"></i> Emergency SOS</h2>
        <p>Sending your live location to the hospital in</p>
        <div class="sos-count">${left}</div>
        <p>An ambulance will be sent to where you are.</p>
        <div class="sos-actions">
            <button onclick="sosAbortCountdown()">Cancel</button>
            <button class="danger" onclick="sosSendNow()">Send now</button>
        </div>`);
    draw();
    sos.countdown = setInterval(() => {
        left--;
        if (left <= 0) sosSendNow(); else draw();
    }, 1000);
}

function sosAbortCountdown() {
    clearInterval(sos.countdown);
    sosHide();
}

function sosSendNow() {
    clearInterval(sos.countdown);
    sosPanel(`<h2><i class="fas fa-location-crosshairs fa-beat"></i> Getting your location…</h2>
              <p>Please allow location access if your phone asks.</p>`);

    const send = (pos) => {
        const user = (typeof currentUser !== 'undefined' && currentUser) ? currentUser : {};
        shPost('api/sos?action=create', {
            lat: pos ? pos.coords.latitude : '', lng: pos ? pos.coords.longitude : '',
            accuracy: pos ? Math.round(pos.coords.accuracy) : '',
            name: user.name || '', phone: user.phone || ''
        }).then(res => {
            if (res.status !== 'success') throw new Error(res.message);
            sos.token = res.token;
            sos.hasLocation = !!pos;
            localStorage.setItem(SOS_KEY, res.token);
            sosStartTracking();
            sosShowTracking();
        }).catch(() => sosPanel(`
            <h2>Could not reach the hospital</h2>
            <p>Check your internet connection, or call for help directly.</p>
            <div class="sos-actions">
                <a class="call" href="tel:108"><i class="fas fa-phone"></i> Call 108</a>
                <button class="danger" onclick="sosSendNow()">Try again</button>
                <button onclick="sosHide()">Close</button>
            </div>`));
    };

    if (!navigator.geolocation) return send(null);

    // The first reading is often a rough Wi-Fi/network guess. Listen for up to 10 s
    // and keep the most accurate one; stop early once it is good enough (GPS lock).
    let best = null, done = false;
    const finish = () => {
        if (done) return;
        done = true;
        navigator.geolocation.clearWatch(watch);
        clearTimeout(timer);
        sos.bestAcc = best ? best.coords.accuracy : Infinity;
        send(best);
    };
    const watch = navigator.geolocation.watchPosition(pos => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (best.coords.accuracy <= 50) finish();
    }, err => { if (err.code === err.PERMISSION_DENIED) finish(); }, { enableHighAccuracy: true, maximumAge: 0 });
    const timer = setTimeout(finish, 10000);
}

function sosStartTracking() {
    document.getElementById('sosFab').classList.add('active');
    document.getElementById('sosFabLabel').textContent = 'TRACKING';

    clearInterval(sos.poll);
    sos.poll = setInterval(sosRefresh, 4000);
    sosRefresh();

    // Keep sending the live position while the alert is open (at most every 8 s)
    if (navigator.geolocation && sos.watch === null) {
        sos.watch = navigator.geolocation.watchPosition(pos => {
            if (!sos.token || Date.now() - sos.lastSent < 8000) return;
            // Never let a rough reading overwrite a better one, or a pin the caller placed by hand
            if (localStorage.getItem(SOS_KEY + 'Manual') || pos.coords.accuracy > Math.max(sos.bestAcc || Infinity, 100)) return;
            sos.bestAcc = Math.min(sos.bestAcc || Infinity, pos.coords.accuracy);
            sos.lastSent = Date.now();
            sos.hasLocation = true;
            shPost('api/sos?action=updateLocation', {
                token: sos.token, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy)
            }).catch(() => {});
        }, () => {}, { enableHighAccuracy: true, maximumAge: 5000 });
    }
}

function sosStopTracking() {
    if (typeof guideStop === 'function') guideStop();
    clearInterval(sos.poll);
    if (sos.watch !== null) navigator.geolocation.clearWatch(sos.watch);
    Object.assign(sos, { token: null, poll: null, watch: null, map: null, meMarker: null, ambMarker: null, routeLayers: null, fitted: false, data: null,
                         nearby: null, nearbyAt: null, nearbyLayer: null });
    localStorage.removeItem(SOS_KEY);
    localStorage.removeItem(SOS_KEY + 'Manual');
    sos.bestAcc = null;
    document.getElementById('sosFab').classList.remove('active');
    document.getElementById('sosFabLabel').textContent = 'EMERGENCY';
}

function sosShowTracking() {
    sos.map = null; sos.meMarker = null; sos.ambMarker = null; sos.routeLayers = null; sos.fitted = false; sos.centred = false;
    sosPanel(`
        <h2><i class="fas fa-truck-medical"></i> Emergency SOS</h2>
        <div class="sos-status" id="sosStatus">Contacting hospital…</div>
        <div id="sosPhoneBox"></div>
        <div class="sos-accuracy" id="sosAccuracy"></div>
        <div class="sos-map" id="sosMap"></div>
        <div class="sos-guide" id="sosGuide"></div>
        <div class="sos-actions" id="sosActions"></div>
        <div class="sos-nearby" id="sosNearby"></div>`);
    sos.nearbyAt = null;
    sos.nearbyFitted = false;
    if (sos.data) sosRender(sos.data); else sosRefresh();
}

function sosRefresh() {
    if (!sos.token) return;
    fetch('api/sos?action=track&token=' + encodeURIComponent(sos.token))
        .then(r => r.json())
        .then(data => {
            if (data.status !== 'success') { sosStopTracking(); sosHide(); return; }
            sos.data = data;
            sosRender(data);
        })
        .catch(() => {});
}

function sosRender(data) {
    const statusEl = document.getElementById('sosStatus');
    if (!statusEl) return; // panel is hidden; FAB keeps showing "TRACKING"

    const a = data.alert, amb = data.ambulance, hospital = data.hospital;
    const hasLoc = a.lat !== null;
    let text = '', ok = false;

    if (a.state === 'New') {
        text = `Alert received by ${shEsc(hospital.name)}.<small>${hasLoc ? 'Your location has been shared. An ambulance is being assigned…' : 'We could not read your location — please enter your phone number so the hospital can call you.'}</small>`;
    } else if (a.state === 'Dispatched') {
        ok = true;
        text = `Ambulance ${shEsc(amb.vehicle_no)} is on the way${data.eta ? ` — about ${data.eta.minutes} min (${data.eta.km} km by road)` : ''}.<small>Driver: ${shEsc(amb.driver_name)} ${shEsc(amb.driver_phone || '')}${data.eta && !data.eta.live ? ' · estimated position on the route' : (amb.live ? ' · live GPS' : '')}</small>`;
    } else if (a.state === 'Arrived') {
        ok = true;
        text = `Ambulance ${shEsc(amb.vehicle_no)} has arrived at your location.`;
    } else {
        ok = true;
        text = a.state === 'Cancelled' ? 'This alert was cancelled.' : 'This emergency has been closed by the hospital.';
    }
    statusEl.className = 'sos-status' + (ok ? ' ok' : '');
    statusEl.innerHTML = text;

    const phoneBox = document.getElementById('sosPhoneBox');
    if (!hasLoc && a.state === 'New' && !phoneBox.innerHTML) {
        phoneBox.innerHTML = `<div class="sos-phone"><input type="tel" id="sosPhone" placeholder="Your mobile number">
            <button onclick="sosSendPhone()">Send</button></div>`;
    } else if (hasLoc) {
        phoneBox.innerHTML = '';
    }

    const closed = a.state === 'Resolved' || a.state === 'Cancelled';
    document.getElementById('sosActions').innerHTML = closed
        ? `<button onclick="sosStopTracking(); sosHide();">Close</button>`
        : `<a class="call" href="tel:${shEsc(amb && amb.driver_phone ? amb.driver_phone : hospital.phone)}"><i class="fas fa-phone"></i> ${amb && amb.driver_phone ? 'Call driver' : 'Call hospital'}</a>
           <button onclick="sosHide()">Hide</button>
           <button class="danger" onclick="sosCancel()">Cancel alert</button>`;
    if (closed) clearInterval(sos.poll);

    // Map: me + ambulance
    if (typeof L === 'undefined') return;
    if (!sos.map) {
        sos.map = L.map('sosMap', { zoomControl: false }).setView([hasLoc ? a.lat : hospital.lat, hasLoc ? a.lng : hospital.lng], 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, className: 'rt-tiles', attribution: '&copy; OpenStreetMap contributors' }).addTo(sos.map);
        setTimeout(() => sos.map && sos.map.invalidateSize(), 150);
        L.marker([hospital.lat, hospital.lng], { icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="rt-start"><i></i><span>Hospital</span></div>' }), zIndexOffset: 500 }).addTo(sos.map).bindPopup(shEsc(hospital.name));
        if (typeof guideRedraw === 'function' && guide.target) setTimeout(guideRedraw, 200);
    }
    // road route from the ambulance's start to the caller: grey where it has driven, red still to go
    if (data.route && typeof amDrawRoute === 'function') {
        sos.routeLayers = sos.routeLayers || {};
        amDrawRoute(sos.map, sos.routeLayers, data.route, data.eta ? data.eta.fraction : (a.state === 'Dispatched' ? 0 : 1));
    }
    const points = [];
    if (hasLoc) {
        const p = [parseFloat(a.lat), parseFloat(a.lng)];
        if (!sos.meMarker) {
            // Draggable: on a laptop/desktop there is no GPS, so the caller can correct the pin by hand
            sos.meMarker = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [34, 44], iconAnchor: [17, 42], html: '<div class="rt-pin"><i></i></div>' }), draggable: true, zIndexOffset: 600 }).addTo(sos.map).bindPopup('You');
            sos.meMarker.on('dragstart', () => { sos.dragging = true; });
            sos.meMarker.on('dragend', () => {
                const at = sos.meMarker.getLatLng();
                localStorage.setItem(SOS_KEY + 'Manual', '1');
                shPost('api/sos?action=updateLocation', { token: sos.token, lat: at.lat, lng: at.lng, accuracy: 0 })
                    .finally(() => { sos.dragging = false; sosRefresh(); });
            });
        } else if (!sos.dragging) {
            sos.meMarker.setLatLng(typeof guide !== 'undefined' && guide.pos && guide.target ? guide.pos : p);
        }
        points.push(p);
    }

    // Tell the caller how good the fix is. accuracy 0 = pin placed by hand.
    const accEl = document.getElementById('sosAccuracy');
    const acc = a.accuracy === null ? null : +a.accuracy;
    if (!hasLoc || closed) {
        accEl.innerHTML = '';
    } else if (acc === 0) {
        accEl.className = 'sos-accuracy good';
        accEl.innerHTML = '<i class="fas fa-map-pin"></i> Location set by you on the map.';
    } else if (acc !== null && acc <= 100) {
        accEl.className = 'sos-accuracy good';
        accEl.innerHTML = `<i class="fas fa-location-crosshairs"></i> Live GPS location — accurate to about ${acc} m.`;
    } else {
        accEl.className = 'sos-accuracy poor';
        accEl.innerHTML = `<i class="fas fa-triangle-exclamation"></i> Location is only approximate (about ${acc >= 1000 ? (acc / 1000).toFixed(1) + ' km' : acc + ' m'} off) — this device has no GPS.
            <b>Drag the red pin to your exact place</b>, or use a mobile phone with Location turned on.`;
    }
    if (amb && amb.lat !== null) {
        const p = [parseFloat(amb.lat), parseFloat(amb.lng)];
        if (sos.ambMarker) (typeof amGlide === 'function' ? amGlide(sos.ambMarker, p, 1200) : sos.ambMarker.setLatLng(p));
        else sos.ambMarker = L.marker(p, { icon: L.divIcon({ className: '', iconSize: [40, 40], iconAnchor: [20, 20], html: '<div class="rt-amb"><i class="fas fa-truck-medical"></i></div>' }), zIndexOffset: 900 }).addTo(sos.map).bindPopup('Ambulance');
        points.push(p);
        if (sos.fitted && !sos.map.getBounds().contains(p)) sos.fitted = false; // ambulance drove off screen: re-frame
    }
    if (hasLoc && !closed) sosLoadNearby(+a.lat, +a.lng);
    else if (closed) document.getElementById('sosNearby').innerHTML = '';

    if (points.length === 2 && !sos.fitted) {
        sos.map.fitBounds(points, { padding: [40, 40], maxZoom: 16 });
        sos.fitted = true;
    } else if (points.length === 1 && !sos.centred) {
        sos.map.setView(points[0], 16);
        sos.centred = true; // only once, so the caller can pan and drag the pin freely
    }
}

// ---------------------------------------------------------------- nearby hospitals
// Real hospitals around the caller from Google Maps (fetched by the server through SerpApi), nearest
// first, with a call button and Google Maps directions - for when going there yourself is quicker.
function sosLoadNearby(lat, lng) {
    // again only when the caller has moved more than about 500 m
    if (sos.nearbyAt && Math.abs(sos.nearbyAt[0] - lat) < 0.005 && Math.abs(sos.nearbyAt[1] - lng) < 0.005) {
        if (sos.nearby) sosDrawNearby(sos.nearby, lat, lng);
        return;
    }
    sos.nearbyAt = [lat, lng];
    const box = document.getElementById('sosNearby');
    box.innerHTML = '<div class="sos-nearby-head"><b><i class="fas fa-hospital"></i> Nearby hospitals</b><span>Finding hospitals around you…</span></div><div class="sos-skel"></div><div class="sos-skel"></div>';
    fetch('api/sos?action=nearby&token=' + encodeURIComponent(sos.token)).then(r => r.json()).then(d => {
        if (d.status !== 'success' || !d.enabled) { box.innerHTML = ''; return; }
        sos.nearby = d.hospitals;
        sosDrawNearby(d.hospitals, lat, lng);
    }).catch(() => { box.innerHTML = ''; sos.nearbyAt = null; });
}

function sosDrawNearby(list, lat, lng) {
    const box = document.getElementById('sosNearby');
    if (!box) return;
    if (!list.length) {
        box.innerHTML = '<div class="sos-nearby-head"><b><i class="fas fa-hospital"></i> Nearby hospitals</b><span>No hospital found close to you. Call 108 for help.</span></div>';
        return;
    }
    box.innerHTML = `<div class="sos-nearby-head"><b><i class="fas fa-hospital"></i> Nearby hospitals</b><span>From Google Maps · nearest first</span></div>
        ${list.map((h, i) => `<div class="sos-hosp ${typeof guide !== 'undefined' && guide.target && guide.target.name === h.name ? 'is-active' : ''}" data-name="${shEsc(h.name)}">
            <span class="sos-hosp-n">${i + 1}</span>
            <div class="sos-hosp-main">
                <b>${shEsc(h.name)}</b>
                <small>${h.km} km · ${shEsc(h.type)}${h.rating ? ` · <i class="fas fa-star"></i> ${h.rating}${h.reviews ? ` (${(+h.reviews).toLocaleString('en-IN')})` : ''}` : ''}</small>
                ${h.open ? `<em class="${/24 hours|open/i.test(h.open) && !/closed/i.test(h.open) ? 'open' : ''}">${shEsc(h.open)}</em>` : ''}
                <small class="sos-hosp-addr">${shEsc(h.address)}</small>
            </div>
            <div class="sos-hosp-go">
                ${h.phone ? `<a href="tel:${shEsc(h.phone.replace(/[^+\d]/g, ''))}" title="Call ${shEsc(h.name)}"><i class="fas fa-phone"></i> Call</a>` : ''}
                <button type="button" onclick="sosRouteTo(${i})" title="Show the road route and guide me by voice"><i class="fas fa-diamond-turn-right"></i> Route</button>
            </div>
        </div>`).join('')}`;

    // the same hospitals as pins on the map
    if (!sos.map || typeof L === 'undefined') return;
    if (sos.nearbyLayer) sos.nearbyLayer.remove();
    sos.nearbyLayer = L.layerGroup(list.map((h, i) => L.marker([h.lat, h.lng], {
        icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="sos-h-pin">${i + 1}</div>` })
    }).bindPopup(`<b>${shEsc(h.name)}</b><br>${h.km} km${h.phone ? '<br>' + shEsc(h.phone) : ''}`))).addTo(sos.map);
    // once, while no ambulance is on its way: show the caller with the three nearest hospitals
    if (!sos.nearbyFitted && !(sos.data && sos.data.ambulance) && !(typeof guide !== 'undefined' && guide.target)) {
        sos.nearbyFitted = true;
        const frame = [[lat, lng], ...list.slice(0, 3).map(h => [h.lat, h.lng])];
        // after the panel has its final size, otherwise Leaflet frames the wrong area
        setTimeout(() => { if (!sos.map) return; sos.map.invalidateSize(); sos.map.fitBounds(frame, { padding: [30, 30], maxZoom: 16 }); }, 350);
    }
}

function sosSendPhone() {
    const phone = document.getElementById('sosPhone').value.trim();
    if (phone.replace(/\D/g, '').length < 10) return shToast('Please enter a valid mobile number.', 'error');
    shPost('api/sos?action=updateLocation', { token: sos.token, phone })
        .then(() => { document.getElementById('sosPhoneBox').innerHTML = '<p>Thank you — the hospital will call you.</p>'; });
}

async function sosCancel() {
    if (!await shConfirm('Cancel the emergency alert? The ambulance will be told not to come.', { yes: 'Yes, cancel alert', no: 'Keep alert', danger: true })) return;
    shPost('api/sos?action=cancel', { token: sos.token }).finally(() => { sosStopTracking(); sosHide(); });
}

// Resume tracking after a page reload
if (sos.token) sosStartTracking();

// =====================================================================
// SMART PATIENT QR CARD
// =====================================================================
let healthCard = null;

function loadHealthCard() {
    const box = document.getElementById('healthcard-body');
    if (!healthCard) box.innerHTML = '<div class="hc-layout"><div class="ap-skeleton" style="height: 320px;"></div><div class="ap-skeleton" style="height: 320px;"></div></div>';

    Promise.all([
        fetch('api/patient?action=card').then(r => r.json()),
        fetch('api/patient?action=prescriptions').then(r => r.json())
    ]).then(([cardRes, rxRes]) => {
        if (cardRes.status !== 'success') {
            // No server session (e.g. logged in before this feature existed)
            box.innerHTML = `<div class="ap-empty"><span class="ap-empty-art"><i class="fas fa-lock"></i></span><b>Please log in again</b>
                For your privacy, your health card opens only after a fresh login.
                <button type="button" class="ap-btn" onclick="logout(true)"><i class="fas fa-arrow-right-to-bracket"></i>Log in again</button></div>`;
            return;
        }
        healthCard = cardRes.card;
        hcRender(healthCard, rxRes.prescriptions || []);
    }).catch(() => {
        box.innerHTML = '<div class="ap-empty"><span class="ap-empty-art"><i class="fas fa-triangle-exclamation"></i></span><b>Could not load your health card</b>Please try again.</div>';
    });
}

function hcRender(c, rx) {
    // what a doctor would want to find on the card, and whether it is filled in
    const checks = [
        ['blood group', c.blood], ['age', c.age], ['phone number', c.phone],
        ['emergency contact', c.emergency_contact], ['allergies', c.allergies], ['past conditions', c.conditions]
    ];
    const missing = checks.filter(([, value]) => !String(value || '').trim()).map(([name]) => name);
    const done = checks.length - missing.length, pct = Math.round(done / checks.length * 100);

    document.getElementById('healthcard-body').innerHTML = `
    <div class="hc-layout">
        <div class="hc-side">
            <div class="hc-stage" id="hcStage">
                <div class="hc-flip">
                    <div class="hc-card hc-front">
                        <div class="hc-shine"></div>
                        <div class="hc-top">
                            <img src="assets/logo-mark.png" alt="">
                            <div><b>SmartHealth Hospital</b><small>Patient Card</small></div>
                            <i class="fas fa-wifi" aria-hidden="true"></i>
                        </div>
                        <div class="hc-row">
                            <div class="hc-qr" id="hcQr"></div>
                            <div class="hc-meta">
                                <small>Name</small>
                                <h4>${shEsc(c.name)}</h4>
                                <div class="hc-facts">
                                    <span class="is-blood"><small>Blood</small><b>${shEsc(c.blood || '—')}</b></span>
                                    <span><small>Age</small><b>${shEsc(c.age || '—')}</b></span>
                                </div>
                                <div class="hc-line"><i class="fas fa-phone"></i>${shEsc(c.phone || '—')}</div>
                                <div class="hc-line"><i class="fas fa-life-ring"></i>Emergency: ${shEsc(c.emergency_contact || '—')}</div>
                            </div>
                        </div>
                        <div class="hc-note">Show this QR at the hospital. The doctor scans it to see your medical history, allergies and last prescriptions.</div>
                    </div>
                    <div class="hc-card hc-back">
                        <div class="hc-qr hc-qr-big" id="hcQrBig"></div>
                        <b>${shEsc(c.name)}</b>
                        <small>Hold this up to the scanner at the hospital</small>
                    </div>
                </div>
            </div>
            <div class="hc-buttons">
                <button type="button" class="hc-btn hc-btn--main" onclick="hcFlip()"><i class="fas fa-repeat"></i><span id="hcFlipText">Show large QR</span></button>
                <button type="button" class="hc-btn" onclick="printHealthCard()"><i class="fas fa-print"></i>Print / Save</button>
                <button type="button" class="hc-btn" onclick="regenerateHealthCard()"><i class="fas fa-rotate"></i>New QR</button>
            </div>
            <div class="hc-ready ${missing.length ? '' : 'is-full'}">
                <span class="kpi-ring"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="23"/><circle class="on" cx="28" cy="28" r="23" pathLength="1" style="--off: ${(1 - done / checks.length).toFixed(3)};"/></svg><b>${pct}%</b></span>
                <div class="hc-ready-text">
                    <b>${missing.length ? 'Your card is not complete yet' : 'Your card is complete'}</b>
                    <p>${missing.length ? `Still to add: ${shEsc(missing.join(', '))}.` : 'A doctor who scans it sees everything they need.'}</p>
                    ${missing.some(m => ['blood group', 'age', 'phone number'].includes(m)) ? `<button type="button" onclick="switchView('profile')">Add them in My Profile →</button>` : ''}
                </div>
            </div>
        </div>
        <div class="hc-main">
            <div class="card">
                <h4 class="hc-h"><i class="fas fa-notes-medical"></i>Medical Information</h4>
                <div class="hc-form">
                    <div class="form-group is-wide">
                        <label>Allergies (medicines, food, etc.)</label>
                        <textarea id="hcAllergies" rows="2" placeholder="e.g. Penicillin, peanuts — write “None” if you have none">${shEsc(c.allergies)}</textarea>
                    </div>
                    <div class="form-group is-wide">
                        <label>Past Diseases / Ongoing Conditions</label>
                        <textarea id="hcConditions" rows="3" placeholder="e.g. Diabetes (since 2020), Asthma">${shEsc(c.conditions)}</textarea>
                    </div>
                    <div class="form-group is-wide">
                        <label>Emergency Contact Number</label>
                        <input type="tel" id="hcEmergency" value="${shEsc(c.emergency_contact)}" placeholder="Family member's mobile number">
                    </div>
                    <button class="btn btn-success" onclick="saveMedicalInfo()"><i class="fas fa-floppy-disk"></i> Save Medical Information</button>
                </div>
            </div>
            <div class="card">
                <h4 class="hc-h"><i class="fas fa-file-prescription"></i>My Prescriptions<small>${rx.length}</small></h4>
                ${rx.length ? `<div class="rx-list">${rx.map((p, i) => `
                    <div class="rx-item" style="--i: ${Math.min(i, 8)};">
                        <h5>${shEsc(p.diagnosis)}</h5>
                        <div class="rx-meta">
                            <span><i class="fas fa-user-doctor"></i>${shEsc(p.doctor_name || 'Doctor')}${p.specialization ? ` · ${shEsc(p.specialization)}` : ''}</span>
                            <span><i class="far fa-calendar"></i>${shEsc((p.created_at || '').slice(0, 10))}</span>
                        </div>
                        <pre>${shEsc(p.medicines)}</pre>
                        ${p.notes ? `<div class="rx-advice"><i class="fas fa-lightbulb"></i>Advice: ${shEsc(p.notes)}</div>` : ''}
                    </div>`).join('')}</div>`
                : `<div class="ap-empty" style="padding: 30px 20px;"><span class="ap-empty-art"><i class="fas fa-file-prescription"></i></span><b>No prescriptions yet</b>They appear here after a doctor visit.</div>`}
            </div>
        </div>
    </div>`;

    new QRCode(document.getElementById('hcQr'), { text: c.qr_text, width: 300, height: 300, correctLevel: QRCode.CorrectLevel.M });
    new QRCode(document.getElementById('hcQrBig'), { text: c.qr_text, width: 420, height: 420, correctLevel: QRCode.CorrectLevel.M });
    hcTilt();
}

// Turns the card over: details on the front, a large QR on the back
function hcFlip() {
    const flipped = document.getElementById('hcStage').classList.toggle('is-flipped');
    document.getElementById('hcFlipText').textContent = flipped ? 'Show card details' : 'Show large QR';
}

// The card leans towards the pointer and a light slides across it
function hcTilt() {
    const stage = document.getElementById('hcStage'), flip = stage.querySelector('.hc-flip');
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    stage.addEventListener('mousemove', e => {
        const r = stage.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
        stage.classList.add('is-tilting');
        flip.style.setProperty('--ry', ((x - .5) * 14).toFixed(2) + 'deg');
        flip.style.setProperty('--rx', ((.5 - y) * 10).toFixed(2) + 'deg');
        flip.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        flip.style.setProperty('--my', (y * 100).toFixed(1) + '%');
    });
    stage.addEventListener('mouseleave', () => {
        stage.classList.remove('is-tilting');
        flip.style.setProperty('--ry', '0deg');
        flip.style.setProperty('--rx', '0deg');
    });
}

function saveMedicalInfo() {
    shPost('api/patient?action=saveMedical', {
        allergies: document.getElementById('hcAllergies').value,
        conditions: document.getElementById('hcConditions').value,
        emergency_contact: document.getElementById('hcEmergency').value
    }).then(res => {
        if (res.status !== 'success') return shToast(res.message || 'Could not save.', 'error');
        shToast('Medical information saved.', 'success');
        loadHealthCard();
    });
}

async function regenerateHealthCard() {
    if (!await shConfirm('Create a new QR code? Any card you printed earlier will stop working.', { yes: 'Create new QR' })) return;
    shPost('api/patient?action=regenerate', {}).then(loadHealthCard);
}

function printHealthCard() {
    const canvas = document.querySelector('#hcQr canvas');
    if (!canvas || !healthCard) return;
    const c = healthCard;
    const w = window.open('', '_blank', 'width=460,height=640');
    if (!w) return shToast('Please allow pop-ups to print the card.', 'error');
    w.document.write(`<!DOCTYPE html><html><head><title>SmartHealth Patient Card</title>
        <style>
            body { font-family: Arial, sans-serif; display: flex; justify-content: center; padding: 24px; }
            .c { width: 340px; border: 2px solid #1d4ed8; border-radius: 14px; padding: 18px; text-align: center; }
            h1 { font-size: 15px; color: #1d4ed8; letter-spacing: 1px; margin: 0 0 10px; }
            h2 { font-size: 20px; margin: 10px 0 6px; }
            img { width: 220px; height: 220px; }
            p { margin: 3px 0; font-size: 13px; }
            small { color: #555; display: block; margin-top: 10px; }
        </style></head><body><div class="c">
            <h1>SMARTHEALTH PATIENT CARD</h1>
            <img src="${canvas.toDataURL('image/png')}" alt="QR">
            <h2>${shEsc(c.name)}</h2>
            <p>Blood Group: <b>${shEsc(c.blood || '—')}</b> &nbsp; Age: <b>${shEsc(c.age || '—')}</b></p>
            <p>Emergency Contact: <b>${shEsc(c.emergency_contact || '—')}</b></p>
            <small>Scan at the hospital to open medical history.</small>
        </div></body></html>`);
    w.document.close();
    w.onload = () => w.print();
}
