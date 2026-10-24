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
            ['Booked', 'Awaiting sample', s.booked, `${s.today_slots} due today · ${afMoney(s.to_collect)} to collect`, 'fa-vial', s.booked ? 'amber' : ''],
            ['Sample Collected', 'Sample collected', s.collected, 'Results to enter', 'fa-flask', ''],
            ['Processing', 'Processing', s.processing, 'Results being checked', 'fa-microscope', ''],
            ['Report Ready', 'Reports ready', s.ready, 'Sent to the patients', 'fa-file-circle-check', 'green'],
            ['open', 'Open bookings', s.booked + s.collected + s.processing, 'Need action', 'fa-list-check', ''],
            ['Cancelled', 'Cancelled', s.cancelled, 'By patient or lab', 'fa-ban', ''],
            ['all', 'All bookings', s.total, 'Since the start', 'fa-database', ''],
            // money is taken when the sample is collected, so only collected bookings count as revenue
            [null, 'Total lab revenue', afMoney(s.revenue), `Today ${afMoney(s.revenue_today)} · this month ${afMoney(s.revenue_month)} · ${s.paid_count} paid`, 'fa-indian-rupee-sign', 'green']
        ].map(([f, label, value, hint, icon, tone]) => `
            <${f ? 'button type="button"' : 'div'} class="ord-stat ${tone ? 'tone-' + tone : ''} ${f && f === labFilter ? 'active' : ''}" ${f ? `onclick="labFilter='${f}'; loadLab()"` : 'title="Collected at sample collection. Bookings still waiting for the sample are shown under Awaiting sample."'}>
                <span class="ord-stat-top"><span class="l">${label}</span><i class="fas ${icon}"></i></span><span class="v">${value}</span><span class="h">${hint}</span>
            </${f ? 'button' : 'div'}>`).join('');
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
// One test at a time: the tests are listed on the left with how much is filled in, the chosen test's
// values are typed on the right, and a last step reviews everything before the report is published.
// Fields may stay empty; the report then shows only the values that are entered.

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

// A typed number: {num} when it can be used, {err} when it cannot
function lrCheck(row, raw) {
    const t = String(raw ?? '').replace(/,/g, '').trim();
    if (t === '') return {};
    if (!/^-?\d*\.?\d+$/.test(t)) return { err: 'Enter a number' };
    const n = parseFloat(t);
    if (n < 0) return { err: 'Cannot be negative' };
    if (row.unit === '%' && n > 100) return { err: 'Cannot be more than 100%' };
    return { num: n };
}

let labEditing = null;
const LR_FLAG = { H: ['High', 'fa-arrow-up'], L: ['Low', 'fa-arrow-down'], A: ['Abnormal', 'fa-triangle-exclamation'] };

function openLabResults(id) {
    const b = labRows.find(x => x.id === id);
    if (!b) return;
    const values = {};
    b.report.forEach(sec => {
        values[sec.code] = {};
        sec.rows.forEach(r => { if (!r.calc || r.raw !== '') values[sec.code][r.key] = r.raw === null || r.raw === undefined ? '' : String(r.raw); });
    });
    // a value worked out earlier by the server is shown as automatic again, so it follows its inputs
    b.report.forEach(sec => sec.rows.forEach(r => { if (r.calc) values[sec.code][r.key] = ''; }));
    labEditing = { b, values, active: 0, remarks: b.remarks || '', reportedBy: b.reported_by || '' };
    document.getElementById('lab-res-title').innerHTML = `<i class="fas fa-microscope"></i> Enter results <small>${afEsc(b.booking_no)}</small>`;
    document.getElementById('lab-res-body').innerHTML = `
        <div class="lr2">
            <div class="lr2-patient">
                <span class="lr2-avatar">${afEsc(initials(b.patient_name))}</span>
                <div><b>${afEsc(b.patient_name)}</b><small>${afEsc(b.age)} yrs · ${afEsc(b.gender)} · ${afEsc(b.phone)}</small></div>
                <span class="lr2-tag"><i class="fas fa-vial"></i> Collected ${afEsc(String(b.collected_at || '—').slice(0, 16))}</span>
                ${b.referred_by ? `<span class="lr2-tag"><i class="fas fa-user-doctor"></i> ${afEsc(b.referred_by)}</span>` : ''}
                <span class="lr2-tag lr2-tag--status">${afEsc(b.status)}</span>
            </div>
            <div class="lr2-main">
                <nav class="lr2-tests" id="lr2Tests" aria-label="Tests"></nav>
                <section class="lr2-pane" id="lr2Pane"></section>
            </div>
            <footer class="lr2-foot">
                <div class="lr2-progress"><span id="lr2ProgText"></span><i><b id="lr2ProgBar"></b></i></div>
                <div class="lr2-actions">
                    <button class="btn btn--outline" type="button" onclick="saveLabResults(false)"><i class="fas fa-floppy-disk"></i> Save draft</button>
                    <button class="btn btn--success" type="button" onclick="saveLabResults(true)"><i class="fas fa-paper-plane"></i> ${b.status === 'Report Ready' ? 'Update report' : 'Publish report'}</button>
                </div>
            </footer>
        </div>`;
    lrShow(0);
    document.getElementById('labResultModal').style.display = 'flex';
}

// Number values of one test with the automatic ones worked out; {values, shown: {key: value}, errors}
function lrCompute(sec) {
    const typed = labEditing.values[sec.code], nums = {}, shown = {}, errors = {};
    sec.rows.forEach(r => {
        if (r.type !== 'number') { shown[r.key] = typed[r.key] || ''; return; }
        const c = lrCheck(r, typed[r.key]);
        if (c.err) errors[r.key] = c.err;
        nums[r.key] = c.num === undefined ? null : c.num;
        shown[r.key] = c.num === undefined ? '' : c.num;
    });
    sec.rows.forEach(r => {
        if (r.type !== 'number' || !r.calc || (typed[r.key] || '') !== '') return;
        const okIf = !r.calc_if || labEval(r.calc_if, nums);
        const v = okIf ? labEval(r.formula, nums) : null;
        if (v !== null && isFinite(v) && v >= 0) { nums[r.key] = +v.toFixed(r.decimals); shown[r.key] = nums[r.key]; }
    });
    return { nums, shown, errors };
}

function lrStats(sec) {
    const { shown, errors } = lrCompute(sec);
    const manual = sec.rows.filter(r => !r.calc);
    return {
        filled: manual.filter(r => shown[r.key] !== '' && !errors[r.key]).length, total: manual.length,
        flagged: sec.rows.filter(r => shown[r.key] !== '' && labFlag(r, shown[r.key])).length,
        errors: Object.keys(errors).length
    };
}

function lrNav() {
    const secs = labEditing.b.report;
    let filled = 0, total = 0, flagged = 0;
    document.getElementById('lr2Tests').innerHTML = secs.map((sec, i) => {
        const s = lrStats(sec);
        filled += s.filled; total += s.total; flagged += s.flagged;
        const state = s.errors ? 'is-err' : (s.filled === s.total ? 'is-done' : (s.filled ? 'is-part' : ''));
        return `<button type="button" class="lr2-test ${state} ${labEditing.active === i ? 'active' : ''}" onclick="lrShow(${i})">
            <span class="lr2-ring" style="--p: ${s.total ? s.filled / s.total : 0};"><i class="fas ${s.errors ? 'fa-exclamation' : (s.filled === s.total ? 'fa-check' : 'fa-flask')}"></i></span>
            <span class="lr2-test-name">${afEsc(sec.name)}<small>${s.filled}/${s.total} filled${s.flagged ? ` · <em>${s.flagged} flagged</em>` : ''}</small></span>
        </button>`;
    }).join('') + `<button type="button" class="lr2-test lr2-test--sum ${labEditing.active === secs.length ? 'active' : ''}" onclick="lrShow(${secs.length})">
            <span class="lr2-ring"><i class="fas fa-file-signature"></i></span><span class="lr2-test-name">Review &amp; sign off<small>Remarks, verified by</small></span></button>`;
    document.getElementById('lr2ProgText').innerHTML = `<b>${filled} of ${total}</b> values entered${flagged ? ` · <em>${flagged} outside the normal range</em>` : ''} · empty fields are left off the report`;
    document.getElementById('lr2ProgBar').style.width = (total ? filled / total * 100 : 0) + '%';
}

function lrShow(i) {
    lrKeepSummary();
    labEditing.active = i;
    const secs = labEditing.b.report, pane = document.getElementById('lr2Pane');
    if (i >= secs.length) {
        pane.innerHTML = lrSummaryHtml();
    } else {
        const sec = secs[i], typed = labEditing.values[sec.code];
        const hasChoice = sec.rows.some(r => r.type === 'choice' && r.normal.length);
        pane.innerHTML = `
            <div class="lr2-pane-head">
                <div><h4>${afEsc(sec.name)}</h4><small>${afEsc(sec.sample)}${sec.package ? ' · ' + afEsc(sec.package) : ''} · reference for ${afEsc(labEditing.b.gender)}</small></div>
                <div class="lr2-tools">
                    ${hasChoice ? `<button type="button" class="btn btn--sm btn--outline" onclick="lrSetNormal()" title="Choose the normal finding where nothing is chosen yet"><i class="fas fa-wand-magic-sparkles"></i> Fill normal findings</button>` : ''}
                    <button type="button" class="btn btn--sm btn--outline" onclick="lrClearTest()"><i class="fas fa-eraser"></i> Clear</button>
                </div>
            </div>
            <div class="lr2-warn" id="lr2Warn" hidden></div>
            <div class="lr2-grid">${sec.rows.map(r => `
                <div class="lr2-field ${r.type === 'text' ? 'is-wide' : ''} ${r.calc ? 'is-calc' : ''}" data-key="${afEsc(r.key)}">
                    <label for="lr-${afEsc(r.key)}">${afEsc(r.name)}${r.calc ? ' <span class="lr2-auto" title="Worked out from the other values; type to override">auto</span>' : ''}</label>
                    ${r.type === 'choice'
                        ? `<div class="lr2-choices">${r.choices.map(c => `<button type="button" class="${typed[r.key] === c ? 'active' : ''} ${r.normal.includes(c) ? 'is-normal' : ''}" onclick="lrChoose('${afEsc(r.key)}', this.dataset.v)" data-v="${afEsc(c)}">${afEsc(c)}</button>`).join('')}</div>`
                        : (r.type === 'text'
                            ? `<textarea id="lr-${afEsc(r.key)}" rows="2" data-key="${afEsc(r.key)}" placeholder="Type the finding">${afEsc(typed[r.key] || '')}</textarea>`
                            : `<div class="lr2-input"><input id="lr-${afEsc(r.key)}" data-key="${afEsc(r.key)}" type="text" inputmode="decimal" autocomplete="off" value="${afEsc(typed[r.key] || '')}" placeholder="${r.calc ? 'auto' : '—'}"><span>${afEsc(r.unit)}</span></div>`)}
                    <div class="lr2-meta"><span class="lr2-ref">${r.ref ? 'Normal: ' + afEsc(r.ref) : ''}</span><span class="lr2-pill"></span></div>
                </div>`).join('')}</div>
            <div class="lr2-pane-nav">
                <button type="button" class="btn btn--outline btn--sm" ${i === 0 ? 'disabled' : ''} onclick="lrShow(${i - 1})"><i class="fas fa-arrow-left"></i> Previous</button>
                <button type="button" class="btn btn--sm" onclick="lrShow(${i + 1})">${i === secs.length - 1 ? 'Review &amp; sign off' : 'Next: ' + afEsc(secs[i + 1].name)} <i class="fas fa-arrow-right"></i></button>
            </div>`;
        pane.querySelectorAll('input[data-key], textarea[data-key]').forEach(el => {
            el.addEventListener('input', () => { typed[el.dataset.key] = el.value; lrRefresh(); });
            el.addEventListener('keydown', e => { if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); lrNextField(el); } });
        });
        lrRefresh();
        const first = [...pane.querySelectorAll('input[data-key]')].find(el => !el.value && !el.closest('.is-calc'));
        if (first) setTimeout(() => first.focus(), 50);
    }
    pane.scrollTop = 0;
    lrNav();
}

// Enter jumps to the next empty box, then on to the next test
function lrNextField(el) {
    const boxes = [...document.querySelectorAll('#lr2Pane input[data-key]')];
    const next = boxes.slice(boxes.indexOf(el) + 1).find(x => !x.closest('.is-calc'));
    if (next) next.focus();
    else lrShow(labEditing.active + 1);
}

function lrChoose(key, value) {
    const sec = labEditing.b.report[labEditing.active], typed = labEditing.values[sec.code];
    typed[key] = typed[key] === value ? '' : value; // pressing the chosen one again clears it
    document.querySelectorAll(`#lr2Pane .lr2-field[data-key="${CSS.escape(key)}"] .lr2-choices button`).forEach(btn => btn.classList.toggle('active', btn.dataset.v === typed[key]));
    lrRefresh();
}

function lrSetNormal() {
    const sec = labEditing.b.report[labEditing.active], typed = labEditing.values[sec.code];
    sec.rows.forEach(r => { if (r.type === 'choice' && r.normal.length && !typed[r.key]) typed[r.key] = r.normal[0]; });
    lrShow(labEditing.active);
}

async function lrClearTest() {
    const sec = labEditing.b.report[labEditing.active];
    if (!await shConfirm(`Clear every value of ${sec.name}?`, { yes: 'Clear', danger: true })) return;
    Object.keys(labEditing.values[sec.code]).forEach(k => { labEditing.values[sec.code][k] = ''; });
    lrShow(labEditing.active);
}

// Updates the flags, automatic values and warnings of the open test without redrawing it
function lrRefresh() {
    const sec = labEditing.b.report[labEditing.active];
    if (!sec) return;
    const { shown, errors, nums } = lrCompute(sec), typed = labEditing.values[sec.code];
    sec.rows.forEach(r => {
        const box = document.querySelector(`#lr2Pane .lr2-field[data-key="${CSS.escape(r.key)}"]`);
        if (!box) return;
        const input = box.querySelector('input');
        if (input && r.calc && (typed[r.key] || '') === '') input.placeholder = shown[r.key] !== '' ? String(shown[r.key]) : 'auto';
        const f = errors[r.key] ? '' : labFlag(r, shown[r.key]);
        box.classList.remove('is-H', 'is-L', 'is-A', 'is-ok', 'is-err');
        const pill = box.querySelector('.lr2-pill');
        if (errors[r.key]) { box.classList.add('is-err'); pill.innerHTML = `<i class="fas fa-circle-xmark"></i> ${errors[r.key]}`; }
        else if (f) { box.classList.add('is-' + f); pill.innerHTML = `<i class="fas ${LR_FLAG[f][1]}"></i> ${LR_FLAG[f][0]}`; }
        else if (shown[r.key] !== '') { box.classList.add('is-ok'); pill.innerHTML = '<i class="fas fa-check"></i> Normal'; }
        else pill.innerHTML = '';
    });
    // the differential count of a CBC must add up to about 100 %
    const warn = document.getElementById('lr2Warn');
    const diff = ['neut', 'lymph', 'mono', 'eos', 'baso'];
    if (warn && diff.every(k => sec.rows.some(r => r.key === k)) && diff.every(k => nums[k] !== null && nums[k] !== undefined)) {
        const sum = diff.reduce((s, k) => s + nums[k], 0);
        warn.hidden = Math.abs(sum - 100) <= 2;
        warn.innerHTML = `<i class="fas fa-triangle-exclamation"></i> The differential count adds up to <b>${+sum.toFixed(1)}%</b> - it should be 100%. Please check Neutrophils to Basophils.`;
    } else if (warn) warn.hidden = true;
    lrNav();
}

function lrSummaryHtml() {
    const secs = labEditing.b.report;
    const flaggedRows = [];
    secs.forEach(sec => {
        const { shown } = lrCompute(sec);
        sec.rows.forEach(r => { const f = labFlag(r, shown[r.key]); if (shown[r.key] !== '' && f) flaggedRows.push({ sec, r, v: shown[r.key], f }); });
    });
    return `
        <div class="lr2-pane-head"><div><h4>Review &amp; sign off</h4><small>Check the values outside the normal range, add a remark and publish.</small></div></div>
        <div class="lr2-review">
            ${secs.map((sec, i) => { const s = lrStats(sec); return `<button type="button" class="lr2-review-row" onclick="lrShow(${i})">
                <span>${afEsc(sec.name)}</span><b class="${s.filled === s.total ? 'ok' : (s.filled ? 'part' : 'none')}">${s.filled ? `${s.filled}/${s.total} entered` : 'Result awaited'}</b></button>`; }).join('')}
        </div>
        <h5 class="lr2-h5">Outside the normal range (${flaggedRows.length})</h5>
        ${flaggedRows.length ? `<div class="lr2-flags">${flaggedRows.map(x => `<span class="lr2-flagchip is-${x.f}"><i class="fas ${LR_FLAG[x.f][1]}"></i> ${afEsc(x.r.name)}: <b>${afEsc(x.v)} ${afEsc(x.r.unit)}</b></span>`).join('')}</div>`
            : '<p class="muted">All entered values are within the normal range.</p>'}
        <div class="form-group"><label for="lab-remarks">Remarks / pathologist's comment <small>(printed on the report)</small></label>
            <textarea id="lab-remarks" rows="3" placeholder="e.g. Microcytic picture. Advised iron studies.">${afEsc(labEditing.remarks)}</textarea></div>
        <div class="form-group"><label for="lab-reported-by">Verified by</label>
            <input id="lab-reported-by" value="${afEsc(labEditing.reportedBy)}" placeholder="Pathologist name, e.g. Dr. A. Mehta (MD Pathology)"></div>`;
}

function lrKeepSummary() {
    const rem = document.getElementById('lab-remarks'), by = document.getElementById('lab-reported-by');
    if (rem && labEditing) labEditing.remarks = rem.value;
    if (by && labEditing) labEditing.reportedBy = by.value;
}

async function saveLabResults(publish) {
    lrKeepSummary();
    const e = labEditing, secs = e.b.report;
    // a wrong value is shown where it is, never sent
    const bad = secs.findIndex(sec => lrStats(sec).errors);
    if (bad >= 0) { lrShow(bad); return shToast(`Please correct the marked value in ${secs[bad].name}.`, 'error'); }
    let filled = 0, total = 0;
    secs.forEach(sec => { const s = lrStats(sec); filled += s.filled; total += s.total; });
    if (publish && !filled) return shToast('Enter at least one result before publishing.', 'error');
    if (publish && filled < total && !await shConfirm(`${total - filled} of ${total} values are still empty. The report will show only the entered values, and tests without any value as "Result awaited". Publish now?`, { yes: 'Publish', no: 'Keep editing' })) return;
    const results = {};
    secs.forEach(sec => { results[sec.code] = {}; Object.entries(e.values[sec.code]).forEach(([k, v]) => { results[sec.code][k] = String(v ?? '').replace(/,/g, '').trim(); }); });
    labPost('saveResults', { id: e.b.id, results: JSON.stringify(results), publish: publish ? '1' : '0', remarks: e.remarks, reported_by: e.reportedBy }).then(res => {
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
        if (document.getElementById('dashboard-view').offsetParent !== null && (typeof adminCan !== 'function' || adminCan('lab'))) loadLab();
    }, 30000);
})();
