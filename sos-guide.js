// SOS > Nearby hospitals > Route: the road route from the caller to the chosen hospital on the SOS map,
// with spoken turn-by-turn guidance (Hindi or English) that follows the phone's GPS.
// Uses sos / shEsc / shToast from features.js and Leaflet (L).

const guide = {
    target: null, route: null, steps: [], next: 1, said: {}, watch: null, pos: null, acc: null,
    layers: null, endMarker: null, lastReroute: 0, rerouting: false, arrived: false,
    voice: true, lang: 'hi'
};
try {
    guide.lang = localStorage.getItem('sosGuideLang') || 'hi';
    guide.voice = localStorage.getItem('sosGuideVoice') !== '0';
} catch (e) { /* private mode: defaults */ }

// ---------------------------------------------------------------- words
const GUIDE_DIR = {
    hi: { left: 'बाएं', right: 'दाएं', 'slight left': 'हल्का बाएं', 'slight right': 'हल्का दाएं', 'sharp left': 'पूरा बाएं',
          'sharp right': 'पूरा दाएं', straight: 'सीधे', uturn: 'यू-टर्न लेकर' },
    en: { left: 'left', right: 'right', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharp left',
          'sharp right': 'sharp right', straight: 'straight', uturn: 'with a U-turn' }
};

function guideDistText(m, lang) {
    if (m >= 1000) {
        const km = (Math.round(m / 100) / 10).toString();
        return lang === 'hi' ? `${km} किलोमीटर` : `${km} kilometres`;
    }
    const r = m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10);
    return lang === 'hi' ? `${r} मीटर` : `${r} metres`;
}

// What to do at one step. lang 'hi' / 'en'
function guideStepText(s, lang) {
    const hi = lang === 'hi', dir = GUIDE_DIR[lang][s.modifier] || '', road = s.name;
    const name = guide.target ? guide.target.name : '';
    switch (s.type) {
        case 'depart':
            return hi ? `${road ? road + ' पर ' : ''}चलना शुरू कीजिए` : `Start on ${road || 'the road'}`;
        case 'arrive':
            return hi ? `आप ${name} पहुंच गए हैं` : `You have arrived at ${name}`;
        case 'roundabout': case 'rotary': case 'roundabout turn':
            return hi ? `गोल चक्कर से ${s.exit || 1} नंबर का रास्ता लीजिए${road ? ', ' + road + ' की ओर' : ''}`
                      : `At the roundabout, take exit ${s.exit || 1}${road ? ' onto ' + road : ''}`;
        case 'fork':
            return hi ? `दोराहे पर ${dir} वाला रास्ता लीजिए` : `Keep ${dir} at the fork`;
        case 'end of road':
            return hi ? `सड़क खत्म होने पर ${dir} मुड़िए` : `At the end of the road, turn ${dir}`;
        case 'merge':
            return hi ? `${dir} ओर मिल जाइए${road ? ', ' + road + ' पर' : ''}` : `Merge ${dir}${road ? ' onto ' + road : ''}`;
        case 'continue': case 'new name':
            if (!s.modifier || s.modifier === 'straight') return hi ? `सीधे चलते रहिए${road ? ', ' + road + ' पर' : ''}` : `Continue straight${road ? ' on ' + road : ''}`;
            // falls through: a bend in the road is said like a turn
        default:
            if (s.modifier === 'straight') return hi ? 'सीधे चलिए' : 'Go straight';
            return hi ? `${dir} मुड़िए${road ? ', ' + road + ' पर' : ''}` : `Turn ${dir}${road ? ' onto ' + road : ''}`;
    }
}

function guideAhead(s, metres, lang) {
    return lang === 'hi' ? `${guideDistText(metres, lang)} बाद ${guideStepText(s, lang)}` : `In ${guideDistText(metres, lang)}, ${guideStepText(s, lang).replace(/^./, c => c.toLowerCase())}`;
}

// ---------------------------------------------------------------- voice
function guideVoiceFor(lang) {
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    const want = lang === 'hi' ? 'hi' : 'en-in';
    return voices.find(v => v.lang.toLowerCase().replace('_', '-').startsWith(want))
        || (lang === 'en' ? voices.find(v => v.lang.toLowerCase().startsWith('en')) : null);
}

// say(hiText, enText): Hindi when chosen and the phone has a Hindi voice, otherwise English
function guideSay(hiText, enText) {
    if (!guide.voice || !window.speechSynthesis) return;
    let lang = guide.lang, voice = guideVoiceFor(lang);
    if (lang === 'hi' && !voice && speechSynthesis.getVoices().length) { lang = 'en'; voice = guideVoiceFor('en'); }
    const u = new SpeechSynthesisUtterance(lang === 'hi' ? hiText : enText);
    u.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    if (voice) u.voice = voice;
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};  // loads the voice list early

// ---------------------------------------------------------------- start / stop
function sosRouteTo(i) {
    const h = (sos.nearby || [])[i];
    if (!h || !sos.token) return;
    guideStop(true);
    guide.target = h;
    guide.said = {};
    guide.arrived = false;
    document.querySelectorAll('.sos-hosp').forEach((el, n) => el.classList.toggle('is-active', n === i));
    guideCard(`<div class="sos-guide-now"><i class="fas fa-circle-notch fa-spin"></i> ${guide.lang === 'hi' ? 'रास्ता बना रहे हैं…' : 'Finding the road route…'}</div>`);
    // speech must be started by a tap on some phones: an empty sentence unlocks it
    if (window.speechSynthesis && guide.voice) { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch (e) {} }
    guideFetch(false);
    guideWatch();
}

function guideFetch(reroute) {
    const h = guide.target;
    if (!h) return;
    const params = new URLSearchParams({ action: 'routeTo', token: sos.token, lat: h.lat, lng: h.lng });
    if (guide.pos) { params.set('from_lat', guide.pos[0]); params.set('from_lng', guide.pos[1]); }
    guide.rerouting = true;
    fetch('api/sos?' + params).then(r => r.json()).then(d => {
        guide.rerouting = false;
        if (guide.target !== h) return;  // another hospital was chosen meanwhile
        if (d.status !== 'success') { if (!reroute) { guideCard(''); shToast(d.message || 'Could not make the route.', 'error'); } return; }
        guide.route = d.route;
        guide.steps = d.route.steps || [];
        guide.next = 1;
        guide.said = {};
        guide.summary = d.summary;
        guideDraw(true);
        const s = d.summary, first = guide.steps[1], total = d.route.distance_m;
        const hi = `${h.name} तक रास्ता। ${guideDistText(total, 'hi')}, लगभग ${s.minutes} मिनट।` + (first ? ` ${guideAhead(first, guide.steps[0].distance, 'hi')}।` : '');
        const en = `Route to ${h.name}. ${guideDistText(total, 'en')}, about ${s.minutes} minutes.` + (first ? ` ${guideAhead(first, guide.steps[0].distance, 'en')}.` : '');
        // the first turn was just announced: do not say it again at once
        if (first && guide.steps[0].distance <= 180) guide.said['1pre'] = 1;
        guideSay(reroute ? (guide.lang === 'hi' ? 'नया रास्ता। ' : '') + hi : hi, reroute ? 'New route. ' + en : en);
        guideUpdateCard();
    }).catch(() => { guide.rerouting = false; if (!reroute) { guideCard(''); shToast('Could not reach the hospital server.', 'error'); } });
}

function guideStop(keepTarget) {
    if (guide.watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(guide.watch);
    guide.watch = null;
    if (window.speechSynthesis) speechSynthesis.cancel();
    guideClearLayers();
    guide.route = null; guide.steps = [];
    if (!keepTarget) {
        guide.target = null;
        guideCard('');
        document.querySelectorAll('.sos-hosp.is-active').forEach(el => el.classList.remove('is-active'));
    }
}

// ---------------------------------------------------------------- map
function guideClearLayers() {
    if (guide.layers) guide.layers.forEach(l => l.remove());
    guide.layers = null;
}

// fit: frame the whole route (first draw)
function guideDraw(fit) {
    if (!guide.route || !sos.map || typeof L === 'undefined') return;
    guideClearLayers();
    const c = guide.route.coords;
    guide.layers = [
        L.polyline(c, { color: '#ffffff', weight: 11, opacity: 1, lineCap: 'round', lineJoin: 'round' }),
        L.polyline(c, { color: '#16a34a', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' }),
        L.marker(c[c.length - 1], { zIndexOffset: 800, icon: L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
            html: '<div class="sos-h-pin is-goal"><i class="fas fa-hospital"></i></div>' }) }).bindPopup(shEsc(guide.target.name))
    ].map(l => l.addTo(sos.map));
    if (fit) setTimeout(() => sos.map && sos.map.fitBounds(c, { padding: [28, 28], maxZoom: 17 }), 50);
}

// the SOS panel was opened again (new map): draw the route on it
function guideRedraw() {
    guide.layers = null;
    if (!guide.target) return;
    document.querySelectorAll('.sos-hosp').forEach(el => el.classList.toggle('is-active', el.dataset.name === guide.target.name));
    guideDraw(true);
    guideUpdateCard();
}

// ---------------------------------------------------------------- following the phone
function guideWatch() {
    if (!navigator.geolocation || guide.watch !== null) return;
    guide.watch = navigator.geolocation.watchPosition(p => guideOnPosition(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
        () => {}, { enableHighAccuracy: true, maximumAge: 2000 });
}

function guideMeters(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b[0] - a[0]), dLng = toR(b[1] - a[1]);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

// shortest distance (m) from p to the route line
function guideOffRoute(p) {
    const c = guide.route.coords, k = Math.cos(p[0] * Math.PI / 180) * 111320, m = 110540;
    let best = Infinity;
    for (let i = 1; i < c.length; i++) {
        const ax = (c[i - 1][1] - p[1]) * k, ay = (c[i - 1][0] - p[0]) * m, bx = (c[i][1] - p[1]) * k, by = (c[i][0] - p[0]) * m;
        const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
}

// exposed for testing on a computer without GPS: guideOnPosition(lat, lng, accuracy)
function guideOnPosition(lat, lng, acc) {
    guide.pos = [lat, lng];
    guide.acc = acc;
    if (sos.meMarker && !sos.dragging) sos.meMarker.setLatLng(guide.pos);
    if (!guide.route || guide.arrived || !guide.steps.length) return guideUpdateCard();

    // at the hospital, whichever way the caller got there
    const goal = guide.route.coords[guide.route.coords.length - 1];
    if (guideMeters(guide.pos, goal) <= 40) {
        guide.arrived = true;
        guide.next = guide.steps.length - 1;
        const s = guide.steps[guide.next] || { type: 'arrive' };
        guideSay(guideStepText({ ...s, type: 'arrive' }, 'hi'), guideStepText({ ...s, type: 'arrive' }, 'en'));
        if (guide.watch !== null) { navigator.geolocation.clearWatch(guide.watch); guide.watch = null; }
        return guideUpdateCard();
    }

    // left the route: make a new one from here (at most every 20 s, only with a usable fix)
    if (!guide.rerouting && (acc || 0) <= 60 && guideOffRoute(guide.pos) > 70 && Date.now() - guide.lastReroute > 20000) {
        guide.lastReroute = Date.now();
        guideSay('आप रास्ते से हट गए हैं, नया रास्ता बना रहे हैं', 'You are off the route. Finding a new route');
        return guideFetch(true);
    }

    // skip steps that are already behind (the phone may jump ahead between fixes)
    while (guide.next < guide.steps.length - 1) {
        const s = guide.steps[guide.next], after = guide.steps[guide.next + 1];
        if (guideMeters(guide.pos, [after.lat, after.lng]) < guideMeters(guide.pos, [s.lat, s.lng]) && guideMeters(guide.pos, [s.lat, s.lng]) > 60) guide.next++;
        else break;
    }
    const s = guide.steps[guide.next];
    const d = guideMeters(guide.pos, [s.lat, s.lng]);
    if (s.type === 'arrive' && d <= 40) {
        guide.arrived = true;
        guideSay(guideStepText(s, 'hi'), guideStepText(s, 'en'));
        if (guide.watch !== null) { navigator.geolocation.clearWatch(guide.watch); guide.watch = null; }
    } else if (d <= 35) {
        if (!guide.said[guide.next + 'now']) { guide.said[guide.next + 'now'] = 1; guideSay('अब ' + guideStepText(s, 'hi'), 'Now ' + guideStepText(s, 'en').replace(/^./, c => c.toLowerCase())); }
        if (s.type !== 'arrive') guide.next++;
    } else if (d <= 180 && !guide.said[guide.next + 'pre']) {
        guide.said[guide.next + 'pre'] = 1;
        guideSay(guideAhead(s, d, 'hi'), guideAhead(s, d, 'en'));
    } else if (d > 1500 && !guide.said[guide.next + 'far']) {
        guide.said[guide.next + 'far'] = 1;
        guideSay(guideAhead(s, d, 'hi'), guideAhead(s, d, 'en'));
    }
    guideUpdateCard();
}

// ---------------------------------------------------------------- the card under the map
function guideCard(html) {
    const box = document.getElementById('sosGuide');
    if (box) box.innerHTML = html;
}

function guideRemaining() {
    if (!guide.route) return null;
    const s = guide.steps[guide.next];
    if (!s || !guide.pos) return guide.route.distance_m;
    let m = guideMeters(guide.pos, [s.lat, s.lng]);
    for (let i = guide.next; i < guide.steps.length; i++) m += guide.steps[i].distance;
    return m;
}

function guideUpdateCard() {
    const h = guide.target;
    if (!h || !document.getElementById('sosGuide')) return;
    if (!guide.route) return;
    const lang = guide.lang, s = guide.steps[guide.next];
    const d = s && guide.pos ? guideMeters(guide.pos, [s.lat, s.lng]) : (guide.steps[0] ? guide.steps[0].distance : 0);
    const now = guide.arrived ? guideStepText({ type: 'arrive' }, lang)
        : (s ? guideAhead(s, d, lang) : (lang === 'hi' ? 'नक्शे पर हरे रास्ते पर चलिए' : 'Follow the green route on the map'));
    const left = guideRemaining(), sum = guide.summary || { km: 0, minutes: 0 };
    const mins = left && guide.route.distance_m ? Math.max(1, Math.round(sum.minutes * left / guide.route.distance_m)) : sum.minutes;
    const icon = !s || guide.arrived ? 'fa-flag-checkered' : ({ left: 'fa-arrow-left', 'slight left': 'fa-arrow-left', 'sharp left': 'fa-arrow-left',
        right: 'fa-arrow-right', 'slight right': 'fa-arrow-right', 'sharp right': 'fa-arrow-right', uturn: 'fa-rotate-left' }[s.modifier] || 'fa-arrow-up');
    const maps = `https://www.google.com/maps/dir/?api=1${guide.pos ? `&origin=${guide.pos[0]},${guide.pos[1]}` : ''}&destination=${h.lat},${h.lng}&travelmode=driving`;
    guideCard(`
        <div class="sos-guide-head"><b><i class="fas fa-route"></i> ${shEsc(h.name)}</b>
            <span>${guideDistText(left || 0, 'en').replace(' kilometres', ' km').replace(' metres', ' m')} · ${mins} min${guide.route.source !== 'road' ? ' (straight-line estimate)' : ''}</span></div>
        <div class="sos-guide-now ${guide.arrived ? 'is-done' : ''}"><i class="fas ${icon}"></i><span>${shEsc(now)}</span></div>
        ${!guide.pos && !guide.arrived ? `<p class="sos-guide-tip">${lang === 'hi' ? 'चलते समय फ़ोन की लोकेशन चालू रखिए - हर मोड़ से पहले बोलकर बताएंगे।' : 'Keep location on while you go - each turn is announced before you reach it.'}</p>` : ''}
        ${guide.voice && lang === 'hi' && window.speechSynthesis && speechSynthesis.getVoices().length && !guideVoiceFor('hi')
            ? '<p class="sos-guide-tip">इस डिवाइस में हिंदी आवाज़ नहीं है, इसलिए निर्देश अंग्रेज़ी में बोले जाएंगे।</p>' : ''}
        <div class="sos-guide-btns">
            <button type="button" onclick="guideToggleVoice()"><i class="fas ${guide.voice ? 'fa-volume-high' : 'fa-volume-xmark'}"></i> ${guide.voice ? 'Voice on' : 'Voice off'}</button>
            <button type="button" onclick="guideToggleLang()">${lang === 'hi' ? 'हिंदी' : 'English'}</button>
            <button type="button" onclick="guideRepeat()"><i class="fas fa-rotate-right"></i> ${lang === 'hi' ? 'दोहराएं' : 'Repeat'}</button>
            <a href="${maps}" target="_blank" rel="noopener"><i class="fab fa-google"></i> Maps</a>
            <button type="button" class="stop" onclick="guideStop()" aria-label="Stop route"><i class="fas fa-xmark"></i></button>
        </div>`);
}

function guideToggleVoice() {
    guide.voice = !guide.voice;
    try { localStorage.setItem('sosGuideVoice', guide.voice ? '1' : '0'); } catch (e) {}
    if (!guide.voice && window.speechSynthesis) speechSynthesis.cancel();
    if (guide.voice) guideRepeat();
    guideUpdateCard();
}

function guideToggleLang() {
    guide.lang = guide.lang === 'hi' ? 'en' : 'hi';
    try { localStorage.setItem('sosGuideLang', guide.lang); } catch (e) {}
    guideUpdateCard();
    guideRepeat();
}

function guideRepeat() {
    const s = guide.steps[guide.next];
    if (guide.arrived && s) return guideSay(guideStepText(s, 'hi'), guideStepText(s, 'en'));
    if (!s) return;
    const d = guide.pos ? guideMeters(guide.pos, [s.lat, s.lng]) : guide.steps[0].distance;
    guideSay(guideAhead(s, d, 'hi'), guideAhead(s, d, 'en'));
}
