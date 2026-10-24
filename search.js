// Header search for the patient site: doctors, specialities, medicines and the pages of the site.
// Uses `doctors`, renderDoctors() and switchView() from the main page script, and the store from store.js.

const SEARCH_PAGES = [
    { text: 'Dashboard', sub: 'Find a doctor and book an appointment', icon: 'fa-home', keys: 'home doctors book appointment', run: () => goToView('home') },
    { text: 'AI Symptom Check', sub: 'Describe your symptoms and get guidance', icon: 'fa-robot', keys: 'symptoms ai checker disease fever pain', run: () => goToView('ai-checker') },
    { text: 'My Profile', sub: 'Name, phone, age, blood group, address', icon: 'fa-user', keys: 'profile account details', run: () => goToView('profile') },
    { text: 'My Health Card', sub: 'QR card, medical information, prescriptions', icon: 'fa-qrcode', keys: 'health card qr prescription allergies medical history', run: () => goToView('healthcard') },
    { text: 'Medicine Store', sub: 'Order medicines from the hospital pharmacy', icon: 'fa-pills', keys: 'medicine pharmacy shop buy tablets syrup store', run: () => openStore('shop', '') },
    { text: 'My Cart', sub: 'Review your medicines and place the order', icon: 'fa-cart-shopping', keys: 'cart checkout place order pay upi', run: () => openStore('cart') },
    { text: 'My Medicine Orders', sub: 'Track, pay or cancel an order', icon: 'fa-box', keys: 'orders track delivery payment refund cancel upi', run: () => openStore('orders') },
    { text: 'Lab Tests', sub: 'Blood tests, health packages, home sample collection', icon: 'fa-flask-vial', keys: 'lab test blood cbc sugar thyroid lipid vitamin urine report pathology checkup package ecg xray', run: () => goToView('lab') },
    { text: 'My Lab Reports', sub: 'Lab bookings and reports', icon: 'fa-file-medical', keys: 'lab report result pathology', run: () => { goToView('lab'); labTab('my'); } },
    { text: 'My Appointments', sub: 'Booked appointments and token numbers', icon: 'fa-calendar-check', keys: 'bookings appointments token history cancel', run: () => goToView('bookings') },
    { text: 'Health Blog', sub: 'Hospital services and wellness tips', icon: 'fa-blog', keys: 'blog articles tips services facilities', run: () => goToView('blog') },
    { text: 'Book Ambulance', sub: 'Ambulance to your location, tracked live on the map', icon: 'fa-ambulance', keys: 'ambulance emergency sos accident', run: () => goToView('ambulance') }
];

const search = { results: [], active: -1 };

// Opens a view from anywhere (the sidebar highlight follows)
function goToView(view) {
    switchView(view);
}

function searchMark(text, query) {
    const safe = shEsc(text);
    const q = shEsc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return q ? safe.replace(new RegExp('(' + q + ')', 'gi'), '<span class="highlight">$1</span>') : safe;
}

// Doctors on the dashboard follow what is typed, as before
function searchFilterDoctors(query) {
    renderDoctors(query ? doctors.filter(d => (d.name + ' ' + d.spec).toLowerCase().includes(query)) : doctors);
}

function searchShowDoctors(query, label) {
    goToView('home');
    document.getElementById('searchInput').value = label;
    document.getElementById('searchBar').classList.add('has-text');
    searchFilterDoctors(query.toLowerCase());
    const box = document.getElementById('doctors-container');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const SEARCH_RECENT_KEY = 'smartHealthRecentSearches';

function searchRecent() {
    try { return JSON.parse(localStorage.getItem(SEARCH_RECENT_KEY)) || []; } catch (e) { return []; }
}

function searchRemember(text) {
    localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify([text, ...searchRecent().filter(t => t !== text)].slice(0, 4)));
}

// Draws the grouped list. `extra` is optional HTML shown under the groups.
function searchRender(groups, query, extra) {
    search.results = groups.flatMap(g => g[1]);
    search.active = search.results.length ? 0 : -1;
    const box = document.getElementById('searchSuggestions');
    let i = 0;
    box.innerHTML = groups.map(([title, items]) => `
        <div class="suggestion-group">${title}</div>
        ${items.map(item => {
            const n = i++;
            return `<div class="suggestion-item${n === 0 ? ' active' : ''}" data-i="${n}">
                <div class="suggestion-icon">${item.img ? `<img src="${shEsc(item.img)}" alt="" onerror="this.outerHTML='<i class=&quot;fas ${item.icon}&quot;></i>'">` : `<i class="fas ${item.icon}"></i>`}</div>
                <div class="suggestion-body">
                    <div class="suggestion-text">${searchMark(item.text, query)}</div>
                    <div class="suggestion-sub">${shEsc(item.sub)}</div>
                </div>
                <i class="fas fa-arrow-right suggestion-go"></i>
            </div>`;
        }).join('')}`).join('') + (extra || '')
        + '<div class="suggestion-foot"><span><kbd>↑</kbd><kbd>↓</kbd>move</span><span><kbd>Enter</kbd>open</span><span><kbd>Esc</kbd>close</span></div>';
    box.style.display = 'block';
}

// What the empty box offers as soon as it is clicked: recent searches, the usual destinations, the departments
function searchHome() {
    const groups = [];
    const recent = searchRecent().map(text => ({ text, sub: 'Search again', icon: 'fa-clock-rotate-left', again: true }));
    if (recent.length) groups.push(['Recent', recent]);
    const quick = ['My Appointments', 'Medicine Store', 'AI Symptom Check', 'My Health Card', 'Book Ambulance']
        .map(name => SEARCH_PAGES.find(p => p.text === name)).filter(Boolean);
    groups.push(['Go to', quick]);

    const specs = [...new Set(doctors.map(d => d.spec))].filter(Boolean);
    const chips = specs.length ? `<div class="suggestion-group">Departments</div><div class="suggestion-chips">${specs.map(spec =>
        `<span class="suggestion-chip" data-spec="${shEsc(spec)}"><i class="fas fa-stethoscope"></i>${shEsc(spec)} <small>${doctors.filter(d => d.spec === spec).length}</small></span>`).join('')}</div>` : '';
    searchRender(groups, '', chips);
}

function searchRun() {
    const input = document.getElementById('searchInput');
    const query = input.value.trim().toLowerCase();
    document.getElementById('searchBar').classList.toggle('has-text', input.value !== '');
    if (!query) {
        // an emptied box puts back any doctor filter a search result applied
        if (typeof finderApply === 'function' && doctors.length) finderApply();
        return document.activeElement === input ? searchHome() : searchClose();
    }

    const has = text => String(text || '').toLowerCase().includes(query);
    const groups = [];

    const docs = doctors.filter(d => has(d.name)).slice(0, 5).map(d => ({
        text: d.name, sub: d.spec, img: d.img, icon: 'fa-user-doctor', run: () => searchShowDoctors(d.name, d.name)
    }));
    if (docs.length) groups.push(['Doctors', docs]);

    const specs = [...new Set(doctors.map(d => d.spec))].filter(has).slice(0, 4).map(spec => {
        const n = doctors.filter(d => d.spec === spec).length;
        return { text: spec, sub: `${n} doctor${n === 1 ? '' : 's'} in this department`, icon: 'fa-stethoscope', run: () => searchShowDoctors(spec, spec) };
    });
    if (specs.length) groups.push(['Departments', specs]);

    // everyday words for a problem ("knee pain", "skin rash") point to the department that treats it
    const hinted = (typeof FINDER_DEPTS !== 'undefined' ? FINDER_DEPTS : [])
        .filter(d => d.keys.some(k => query.includes(k)) && !specs.some(s => s.text === d.name)).slice(0, 2).map(d => {
            const n = doctors.filter(x => x.spec === d.name).length;
            return {
                text: d.name, icon: d.icon, sub: `${d.sub} · ${n ? `${n} doctor${n === 1 ? '' : 's'}` : 'no doctors listed yet'}`,
                run: () => { goToView('home'); filterCategory(d.name); dashScrollTo('dash-doctors'); }
            };
        });
    if (hinted.length) groups.push(['Suggested department', hinted]);

    const meds = store.products.filter(p => has(p.name) || has(p.category) || has(p.description)).slice(0, 5).map(p => ({
        text: p.name, img: p.image, icon: 'fa-pills',
        sub: `${p.category} · ${stMoney(p.price)} per ${p.unit}${+p.available < 1 ? ' · out of stock' : ''}`,
        run: () => openStore('shop', p.name)
    }));
    if (meds.length) groups.push(['Medicines', meds]);

    const pages = SEARCH_PAGES.filter(p => has(p.text) || has(p.keys)).slice(0, 4);
    if (pages.length) groups.push(['Pages', pages]);

    if (groups.length) return searchRender(groups, query);
    search.results = [];
    search.active = -1;
    const box = document.getElementById('searchSuggestions');
    box.innerHTML = `<div class="suggestion-item none"><i class="fas fa-magnifying-glass"></i><b>Nothing matches “${shEsc(input.value.trim())}”</b>
        <span>Try a doctor's name, a department, a medicine, or a symptom such as “knee pain”.</span></div>`;
    box.style.display = 'block';
}

function searchClose() {
    document.getElementById('searchSuggestions').style.display = 'none';
    search.results = [];
    search.active = -1;
}

function searchPick(i) {
    const item = search.results[i];
    if (!item) return;
    const input = document.getElementById('searchInput');
    // a recent search is typed back in rather than opened
    if (item.again) { input.value = item.text; return searchRun(); }
    if (input.value.trim()) searchRemember(item.text);
    searchClose();
    input.value = '';
    document.getElementById('searchBar').classList.remove('has-text');
    input.blur();
    item.run();
}

function searchMove(step) {
    if (!search.results.length) return;
    search.active = (search.active + step + search.results.length) % search.results.length;
    document.querySelectorAll('#searchSuggestions .suggestion-item').forEach(el => {
        const on = +el.dataset.i === search.active;
        el.classList.toggle('active', on);
        if (on) el.scrollIntoView({ block: 'nearest' });
    });
}

(function searchSetup() {
    const input = document.getElementById('searchInput');
    // medicines are searchable even before the store has been opened: fetch them once, on first use
    let asked = false;
    const loadMedicines = () => {
        if (asked || store.products.length) return;
        asked = true;
        fetch('api/store?action=products').then(r => r.json()).then(d => {
            if (d.status === 'success' && !store.products.length) { store.products = d.products; if (input.value.trim()) searchRun(); }
        }).catch(() => { asked = false; });
    };
    input.addEventListener('input', () => { loadMedicines(); searchRun(); });
    input.addEventListener('focus', () => {
        loadMedicines();
        searchRun();
    });
    input.addEventListener('blur', searchClose);
    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); searchMove(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); searchMove(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); searchPick(search.active); }
        else if (e.key === 'Escape') { searchClose(); input.blur(); }
    });
    // mousedown, not click: the choice must register before the input loses focus
    document.getElementById('searchSuggestions').addEventListener('mousedown', e => {
        e.preventDefault(); // keep the typing cursor in the box
        const item = e.target.closest('.suggestion-item[data-i]'), chip = e.target.closest('.suggestion-chip');
        if (item) searchPick(+item.dataset.i);
        else if (chip) { searchClose(); input.blur(); searchShowDoctors(chip.dataset.spec, chip.dataset.spec); }
    });
    document.getElementById('searchClear').addEventListener('click', () => {
        input.value = '';
        searchRun();
        input.focus();
    });
    document.addEventListener('click', e => {
        if (!document.getElementById('searchContainer').contains(e.target)) searchClose();
    });
})();
