// Admin > Laboratory: lab bookings (sample collection, result entry, publishing the report) and the test catalogue.
// Uses afApi() / afEsc() / afMoney() from admin-features.js, shToast() / shConfirm() from popups.js and lbReportHtml() from lab-report.js.

const LAB_FLOW = ['Booked', 'Sample Collected', 'Processing', 'Report Ready'];
const LAB_BADGE = { 'Booked': 'pending', 'Sample Collected': 'accepted', 'Processing': 'accepted', 'Report Ready': 'confirmed', 'Cancelled': 'manual' };
const LAB_FILTERS = { open: 'Open bookings', Booked: 'Awaiting sample', 'Sample Collected': 'Sample collected', Processing: 'Processing', 'Report Ready': 'Reports ready', Cancelled: 'Cancelled', all: 'All bookings' };
let labRows = [], labFilter = 'open', labInfo = null, labTests = [], labTimer = null;

function labPost(action, data) { return afApi('api/lab/admin', action, {}, data); }

function loadLab() {
    if (!labInfo) fetch('api/lab?action=tests').then(r => r.json()).then(d => { labInfo = d.lab; }).catch(() => {});
    return afApi('api/lab/admin', 'list').then(d => {
        if (d.status !== 'success') { document.getElementById('lab-table-body').innerHTML = `<tr><td colspan="6">${AF_NO_SESSION}</td></tr>`; return; }
        labRows = d.bookings;
        const badge = document.getElementById('lab-badge');
        badge.textContent = d.waiting;
        badge.classList.toggle('show', d.waiting > 0);
        const s = d.stats;
        document.getElementById('lab-stats').innerHTML = [
            ['Booked', 'Awaiting sample', s.booked, `${s.today_slots} due today`, 'fa-vial', s.booked ? 'amber' : ''],
            ['Sample Collected', 'Sample collected', s.collected, 'Results to enter', 'fa-flask', ''],
            ['Processing', 'Processing', s.processing, 'Results being checked', 'fa-microscope', ''],
            ['Report Ready', 'Reports ready', s.ready, `${afMoney(s.revenue)} billed`, 'fa-file-circle-check', 'green'],
            ['open', 'Open bookings', s.booked + s.collected + s.processing, 'Need action', 'fa-list-check', ''],
            ['Cancelled', 'Cancelled', s.cancelled, 'By patient or lab', 'fa-ban', ''],
            ['all', 'All bookings', s.total, 'Since the start', 'fa-database', '']
        ].map(([f, label, value, hint, icon, tone]) => `
            <button type="button" class="ord-stat ${tone ? 'tone-' + tone : ''} ${f === labFilter ? 'active' : ''}" onclick="labFilter='${f}'; loadLab()">
                <span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span><span class="v">${value}</span><span class="h">${hint}</span>
            </button>`).join('');
        renderLab();
    }).catch(() => {});
}

function renderLab() {
    const q = (document.getElementById('lab-search').value || '').trim().toLowerCase();
    const rows = labRows.filter(b => (labFilter === 'all' || (labFilter === 'open' ? ['Booked', 'Sample Collected', 'Processing'].includes(b.status) : b.status === labFilter))
        && (!q || [b.booking_no, b.patient_name, b.phone, b.user_email, ...b.items.map(i => i.name)].join(' ').toLowerCase().includes(q)));
    document.getElementById('lab-list-title').innerHTML = `${LAB_FILTERS[labFilter]} <span class="count" id="lab-count">${rows.length}</span>`;
    document.getElementById('lab-table-body').innerHTML = rows.length ? rows.map(b => {
        let actions = '';
        if (b.status === 'Booked') actions += `<button class="btn btn--sm" onclick="labAdvance(${b.id}, 'Booked')"><i class="fas fa-vial"></i> Sample collected</button>`;
        if (['Sample Collected', 'Processing'].includes(b.status)) actions += `<button class="btn btn--sm btn--success" onclick="openLabResults(${b.id})"><i class="fas fa-keyboard"></i> Enter results</button>`;
        if (b.status === 'Report Ready') actions += `<button class="btn btn--sm btn--outline" onclick="previewLabReport(${b.id})"><i class="fas fa-file-medical"></i> Report</button>
            <button class="btn btn--sm btn--outline" onclick="openLabResults(${b.id})" title="Correct results"><i class="fas fa-pen"></i></button>`;
        if (['Booked', 'Sample Collected', 'Processing'].includes(b.status)) actions += `<button class="btn btn--sm btn--danger-soft" onclick="cancelLab(${b.id})">Cancel</button>`;
        return `<tr>
            <td><span class="cell-strong">${afEsc(b.booking_no)}</span><br><small>${afEsc(String(b.created_at).slice(0, 16))}</small></td>
            <td><span class="cell-strong">${afEsc(b.patient_name)}</span> · ${afEsc(b.age)} ${afEsc((b.gender || '')[0] || '')}<br>${afEsc(b.phone)}<br><small>${afEsc(b.user_email)}</small></td>
            <td>${b.items.map(i => `<div>${afEsc(i.name)}${i.is_package ? ` <small>(${i.components.length} tests)</small>` : ''}</div>`).join('')}
                <small>${afMoney(b.total)} · pay at collection${b.fasting_hours ? ` · <b>${b.fasting_hours} h fasting</b>` : ''}</small></td>
            <td><b>${afEsc(b.slot_date)}</b> ${afEsc(b.slot_time)}<br>${afEsc(b.collection_type)}${b.address ? `<br><small>${afEsc(b.address)}</small>` : ''}</td>
            <td><span class="badge ${LAB_BADGE[b.status] || 'pending'}">${afEsc(b.status)}</span>${b.status === 'Report Ready' && b.abnormal ? `<br><small style="color: var(--red); font-weight: 600;">${b.abnormal} flagged</small>` : ''}</td>
            <td><div class="row-actions">${actions}</div></td>
        </tr>`;
    }).join('') : `<tr><td class="empty" colspan="6"><i class="fas fa-flask"></i>${labRows.length ? 'No bookings in this list.' : 'No lab bookings yet.'}</td></tr>`;
}

function labAdvance(id, from) {
    labPost('advance', { id, from }).then(res => {
        if (res.status !== 'success') shToast(res.message, 'error');
        else shToast('Sample marked as collected. The patient has been told by email.', 'success');
        loadLab();
    });
}

async function cancelLab(id) {
    const reason = await shPrompt('Cancel this lab booking? The reason is emailed to the patient.', 'Sample could not be collected', { yes: 'Cancel booking' });
    if (reason === null) return;
    labPost('cancel', { id, reason }).then(res => { if (res.status !== 'success') shToast(res.message, 'error'); loadLab(); });
}

function closeLabModal(id) { document.getElementById(id).style.display = 'none'; }

// ---------------------------------------------------------------- result entry

function labEval(expr, values) {
    // formulas come from the test catalogue, e.g. "tc - hdl - tg / 5"; only numbers, names and + - * / ( ) < > are allowed
    if (!/^[a-z0-9_ .+\-*/()<>=]+$/i.test(expr)) return null;
    const names = Object.keys(values);
    if ((expr.match(/[a-z_][a-z0-9_]*/gi) || []).some(n => values[n] === null || values[n] === undefined)) return null;
    try { return Function(...names, `return (${expr});`)(...names.map(n => values[n])); } catch (e) { return null; }
}

function labFlag(row, value) {
    if (value === '' || value === null || value === undefined) return '';
    if (row.type === 'number') {
        const v = +value;
        if (isNaN(v)) return '';
        if (row.lo !== null && v < row.lo) return 'L';
        if (row.hi !== null && v > row.hi) return 'H';
        return '';
    }
    if (row.type === 'choice' && row.normal.length) return row.normal.map(n => n.toLowerCase()).includes(String(value).toLowerCase()) ? '' : 'A';
    return '';
}

let labEditing = null;

function openLabResults(id) {
    const b = labRows.find(x => x.id === id);
    if (!b) return;
    labEditing = b;
    document.getElementById('lab-res-title').textContent = `Results · ${b.booking_no} · ${b.patient_name} (${b.age} ${b.gender})`;
    document.getElementById('lab-res-body').innerHTML = `
        <div class="lab-res">
            ${b.report.map(sec => `
                <section class="lab-res-test" data-code="${afEsc(sec.code)}">
                    <h4>${afEsc(sec.name)} <small>${afEsc(sec.sample)}${sec.package ? ' · ' + afEsc(sec.package) : ''}</small></h4>
                    <table>
                        <thead><tr><th>Parameter</th><th>Result</th><th>Unit</th><th>Reference (${afEsc(b.gender)})</th><th></th></tr></thead>
                        <tbody>${sec.rows.map(r => `
                            <tr data-key="${afEsc(r.key)}">
                                <td>${afEsc(r.name)}${r.calc ? ' <small class="lab-calc">auto</small>' : ''}</td>
                                <td>${r.type === 'choice'
                                    ? `<select data-field>${['', ...r.choices].map(c => `<option ${String(r.raw) === c ? 'selected' : ''}>${afEsc(c)}</option>`).join('')}</select>`
                                    : (r.type === 'text'
                                        ? `<textarea data-field rows="2">${afEsc(r.raw)}</textarea>`
                                        : `<input data-field type="number" step="any" inputmode="decimal" value="${afEsc(r.raw)}" ${r.calc ? 'placeholder="auto"' : ''}>`)}</td>
                                <td>${afEsc(r.unit)}</td>
                                <td class="lab-ref">${afEsc(r.ref)}</td>
                                <td class="lab-flag"></td>
                            </tr>`).join('')}</tbody>
                    </table>
                </section>`).join('')}
            <div class="form-group"><label>Remarks / pathologist's comment <small>(shown on the report)</small></label>
                <textarea id="lab-remarks" rows="3" placeholder="e.g. Microcytic picture. Advised iron studies.">${afEsc(b.remarks || '')}</textarea></div>
            <div class="form-group"><label>Verified by</label><input id="lab-reported-by" value="${afEsc(b.reported_by || '')}" placeholder="Pathologist name, e.g. Dr. A. Mehta (MD Pathology)"></div>
            <div class="lab-res-actions">
                <button class="btn btn--outline" type="button" onclick="saveLabResults(false)"><i class="fas fa-floppy-disk"></i> Save draft</button>
                <button class="btn btn--success" type="button" onclick="saveLabResults(true)"><i class="fas fa-paper-plane"></i> ${b.status === 'Report Ready' ? 'Update report' : 'Publish report to patient'}</button>
            </div>
        </div>`;
    const body = document.getElementById('lab-res-body');
    body.addEventListener('input', labLiveCheck);
    body.addEventListener('change', labLiveCheck);
    labLiveCheck();
    document.getElementById('labResultModal').style.display = 'flex';
}

// Fills in the calculated values and shows High / Low next to each value while typing
function labLiveCheck() {
    if (!labEditing) return;
    labEditing.report.forEach(sec => {
        const box = document.querySelector(`.lab-res-test[data-code="${CSS.escape(sec.code)}"]`);
        if (!box) return;
        const values = {};
        sec.rows.forEach(r => {
            if (r.type !== 'number') return;
            const el = box.querySelector(`tr[data-key="${CSS.escape(r.key)}"] [data-field]`);
            values[r.key] = el.value === '' ? null : +el.value;
        });
        sec.rows.forEach(r => {
            const tr = box.querySelector(`tr[data-key="${CSS.escape(r.key)}"]`), el = tr.querySelector('[data-field]');
            let v = el.value;
            if (r.calc && el.value === '') {
                const ok = !r.calc_if || labEval(r.calc_if, values);
                const c = ok ? labEval(r.formula, values) : null;
                el.placeholder = c === null || !isFinite(c) ? 'auto' : (+c).toFixed(r.decimals);
                v = c === null || !isFinite(c) ? '' : c;
            }
            const f = labFlag(r, v);
            tr.querySelector('.lab-flag').innerHTML = f ? `<span class="badge danger">${{ H: '▲ High', L: '▼ Low', A: 'Abnormal' }[f]}</span>` : (v !== '' ? '<span class="lab-ok"><i class="fas fa-check"></i></span>' : '');
            tr.classList.toggle('is-flag', !!f);
        });
    });
}

function saveLabResults(publish) {
    const b = labEditing, results = {};
    document.querySelectorAll('#lab-res-body .lab-res-test').forEach(box => {
        const code = box.dataset.code;
        results[code] = {};
        box.querySelectorAll('tr[data-key]').forEach(tr => { results[code][tr.dataset.key] = tr.querySelector('[data-field]').value.trim(); });
    });
    labPost('saveResults', {
        id: b.id, results: JSON.stringify(results), publish: publish ? '1' : '0',
        remarks: document.getElementById('lab-remarks').value, reported_by: document.getElementById('lab-reported-by').value
    }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shToast(publish ? 'Report published. The patient has been emailed and can open it on the website.' : 'Results saved as draft.', 'success');
        closeLabModal('labResultModal');
        loadLab();
    });
}

function previewLabReport(id) {
    const b = labRows.find(x => x.id === id);
    const w = window.open('', '_blank', 'width=900,height=1000');
    if (!w) return shToast('Please allow pop-ups to see the report.', 'error');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Lab report ${afEsc(b.booking_no)}</title>
        <style>body { margin: 24px; } ${LB_REPORT_CSS} @page { margin: 14mm; }</style></head>
        <body>${lbReportHtml(b, labInfo)}<p style="text-align:center;margin-top:20px;"><button onclick="print()">Print / Save PDF</button></p></body></html>`);
    w.document.close();
}

// ---------------------------------------------------------------- test catalogue

function loadLabTests() {
    afApi('api/lab/admin', 'tests').then(d => {
        if (d.status !== 'success') { document.getElementById('lab-tests-body').innerHTML = `<tr><td colspan="7">${AF_NO_SESSION}</td></tr>`; return; }
        labTests = d.tests;
        labTests.categories = d.categories;
        document.getElementById('lab-tests-body').innerHTML = labTests.map(t => `
            <tr class="${t.active ? '' : 'is-off'}">
                <td><span class="cell-strong">${afEsc(t.name)}</span><br><small>${afEsc(t.code)} · ${t.is_package ? `${t.includes.length} tests` : `${t.parameter_count} parameter${t.parameter_count === 1 ? '' : 's'}`}</small></td>
                <td>${afEsc(t.category)}</td>
                <td>${afEsc(t.sample || '—')}<br><small>${t.fasting_hours ? `<b>${t.fasting_hours} h fasting</b> · ` : ''}${t.home ? 'home collection' : 'at hospital only'}</small></td>
                <td>${afMoney(t.price)}${t.worth ? `<br><small><s>${afMoney(t.worth)}</s></small>` : ''}</td>
                <td>${t.tat_hours} h</td>
                <td><label class="med-check"><input type="checkbox" ${t.active ? 'checked' : ''} onchange="toggleLabTest(${t.id}, this.checked)"> ${t.active ? 'Yes' : 'Hidden'}</label></td>
                <td><button class="btn btn--sm btn--outline" onclick="openLabTest(${t.id})"><i class="fas fa-pen"></i> Edit</button></td>
            </tr>`).join('');
    });
}

function toggleLabTest(id, on) {
    labPost('toggleTest', { id, active: on ? '1' : '0' }).then(res => { if (res.status !== 'success') shToast(res.message, 'error'); loadLabTests(); });
}

function labParamRow(p) {
    p = p || { type: 'number', range: [null, null] };
    if (p.type !== 'number') {
        return `<tr data-key="${afEsc(p.key)}" data-fixed="1"><td colspan="6"><input value="${afEsc(p.name)}" data-f="name"> <small>${p.type === 'choice' ? 'choice: ' + afEsc(p.choices.join(' / ')) : 'free text'}</small></td><td></td></tr>`;
    }
    const r = Array.isArray(p.range) ? { M: p.range, F: [null, null] } : (p.range || { M: [null, null], F: [null, null] });
    const both = !Array.isArray(p.range) && p.range;
    const v = x => x === null || x === undefined ? '' : x;
    return `<tr data-key="${afEsc(p.key || '')}">
        <td><input data-f="name" value="${afEsc(p.name || '')}" placeholder="e.g. Serum Iron">${p.calc ? `<small class="lab-calc">auto: ${afEsc(p.calc)}</small>` : ''}</td>
        <td><input data-f="unit" value="${afEsc(p.unit || '')}" placeholder="µg/dL" style="width: 90px;"></td>
        <td><input data-f="low" type="number" step="any" value="${v(r.M[0])}" style="width: 80px;"></td>
        <td><input data-f="high" type="number" step="any" value="${v(r.M[1])}" style="width: 80px;"></td>
        <td><input data-f="low_f" type="number" step="any" value="${both ? v(r.F[0]) : ''}" placeholder="same" style="width: 80px;"></td>
        <td><input data-f="high_f" type="number" step="any" value="${both ? v(r.F[1]) : ''}" placeholder="same" style="width: 80px;"></td>
        <td>${p.calc ? '' : '<button type="button" class="btn btn--sm btn--danger-soft" onclick="this.closest(\'tr\').remove()"><i class="fas fa-xmark"></i></button>'}</td>
    </tr>`;
}

function openLabTest(id) {
    const t = id ? labTests.find(x => x.id === id) : null;
    const cats = (labTests.categories || []).filter(c => c !== 'Health Packages');
    const pkg = t && t.is_package;
    document.getElementById('lab-test-title').textContent = t ? `Edit · ${t.name}` : 'Add Test';
    document.getElementById('lab-test-body').innerHTML = `
        <form class="dash-form" onsubmit="saveLabTest(event, ${t ? t.id : 0})">
            <div class="form-group"><label>Test name</label><input id="lt-name" required value="${afEsc(t ? t.name : '')}" placeholder="e.g. Iron Studies"></div>
            <div class="form-group"><label>Code ${t ? '' : '<small>(short, unique)</small>'}</label><input id="lt-code" ${t ? 'disabled' : 'required'} value="${afEsc(t ? t.code : '')}" placeholder="IRON"></div>
            <div class="form-group"><label>Category</label><select id="lt-category" ${pkg ? 'disabled' : ''}>${(pkg ? ['Health Packages'] : cats).map(c => `<option ${t && t.category === c ? 'selected' : ''}>${afEsc(c)}</option>`).join('')}</select></div>
            <div class="form-group"><label>Price (₹)</label><input id="lt-price" type="number" min="0" required value="${t ? t.price : ''}"></div>
            ${pkg ? `<div class="form-group span-2"><label>Tests in this package</label><p>${t.includes.map(i => afEsc(i.name)).join(', ')}</p></div>` : `
            <div class="form-group"><label>Sample</label><input id="lt-sample" value="${afEsc(t ? t.sample : 'Blood (Serum)')}"></div>
            <div class="form-group"><label>Report in (hours)</label><input id="lt-tat" type="number" min="1" value="${t ? t.tat_hours : 24}"></div>
            <div class="form-group"><label>Fasting (hours, 0 = none)</label><input id="lt-fasting" type="number" min="0" value="${t ? t.fasting_hours : 0}"></div>
            <div class="form-group"><label class="med-check" style="margin-top: 28px;"><input type="checkbox" id="lt-home" ${!t || t.home ? 'checked' : ''}> Home sample collection possible</label></div>
            <div class="form-group span-2"><label>Preparation for the patient</label><input id="lt-prep" value="${afEsc(t ? t.preparation : '')}" placeholder="e.g. Fast for 8 hours. Water is allowed."></div>`}
            <div class="form-group span-2"><label>Description <small>(shown to patients)</small></label><input id="lt-desc" maxlength="500" value="${afEsc(t ? t.description : '')}"></div>
            <div class="form-group span-2"><label class="med-check"><input type="checkbox" id="lt-popular" ${t && t.popular ? 'checked' : ''}> Mark as popular</label></div>
            ${pkg ? '' : `
            <div class="form-group span-2">
                <label>Parameters and reference ranges <small>(leave Female empty when it is the same for everyone)</small></label>
                <div class="table-container"><table class="lab-param-table">
                    <thead><tr><th>Parameter</th><th>Unit</th><th>Low</th><th>High</th><th>Female low</th><th>Female high</th><th></th></tr></thead>
                    <tbody id="lt-params">${(t ? t.parameters : [{ type: 'number', range: [null, null] }]).map(labParamRow).join('')}</tbody>
                </table></div>
                <button type="button" class="btn btn--sm btn--outline" style="margin-top: 8px;" onclick="document.getElementById('lt-params').insertAdjacentHTML('beforeend', labParamRow())"><i class="fas fa-plus"></i> Add parameter</button>
            </div>`}
            <div class="form-submit">
                <button class="btn" type="submit">Save Test</button>
                <button class="btn btn--outline" type="button" onclick="closeLabModal('labTestModal')">Cancel</button>
            </div>
        </form>`;
    document.getElementById('labTestModal').style.display = 'flex';
}

function saveLabTest(e, id) {
    e.preventDefault();
    const g = x => { const el = document.getElementById(x); return el ? (el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value) : ''; };
    const params = [...document.querySelectorAll('#lt-params tr')].map(tr => {
        const row = { key: tr.dataset.key || '' };
        tr.querySelectorAll('[data-f]').forEach(el => { row[el.dataset.f] = el.value; });
        return row;
    });
    labPost('saveTest', { id, name: g('lt-name'), code: g('lt-code'), category: g('lt-category'), price: g('lt-price'), sample: g('lt-sample'),
        tat_hours: g('lt-tat'), fasting_hours: g('lt-fasting'), home: g('lt-home'), preparation: g('lt-prep'), description: g('lt-desc'),
        popular: g('lt-popular'), parameters: JSON.stringify(params) }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shToast('Test saved.', 'success');
        closeLabModal('labTestModal');
        loadLabTests();
    });
}

// the Lab Bookings badge stays current while the panel is open
(function labBadgeTimer() {
    clearInterval(labTimer);
    labTimer = setInterval(() => {
        if (document.getElementById('dashboard-view').offsetParent !== null) loadLab();
    }, 30000);
})();
