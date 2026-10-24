// Lab report layout, shared by the patient site (lab.js) and the admin panel (admin-lab.js).
// Uses shEsc() from popups.js.

const LB_FLAG = { H: ['High', '▲'], L: ['Low', '▼'], A: ['Abnormal', '●'] };

// The report as HTML. Shared by the patient's report window and the admin preview.
function lbReportHtml(b, labInfo) {
    const info = labInfo || (typeof lab !== 'undefined' && lab.cfg && lab.cfg.lab) || { name: 'SmartHealth Hospital Laboratory', address: '', phone: '' };
    const groups = [];
    (b.report || []).forEach(sec => {
        const last = groups[groups.length - 1];
        if (sec.package && last && last.package === sec.package) last.sections.push(sec);
        else groups.push({ package: sec.package, sections: [sec] });
    });
    return `
    <div class="lr">
        <header class="lr-head">
            <div><h1>${shEsc(info.name)}</h1><p>${shEsc(info.address)}${info.phone ? ' · ' + shEsc(info.phone) : ''}</p></div>
            <div class="lr-tag">LABORATORY REPORT</div>
        </header>
        <section class="lr-patient">
            <div><small>Patient</small><b>${shEsc(b.patient_name)}</b></div>
            <div><small>Age / Gender</small><b>${shEsc(b.age)} yrs / ${shEsc(b.gender)}</b></div>
            <div><small>Booking no.</small><b>${shEsc(b.booking_no)}</b></div>
            <div><small>Referred by</small><b>${shEsc(b.referred_by || 'Self')}</b></div>
            <div><small>Sample collected</small><b>${shEsc((b.collected_at || '—').slice(0, 16))}</b></div>
            <div><small>Reported</small><b>${shEsc((b.report_at || '—').slice(0, 16))}</b></div>
        </section>
        ${groups.map(g => `
            ${g.package ? `<h2 class="lr-pkg">${shEsc(g.package)}</h2>` : ''}
            ${g.sections.map(sec => `
            <section class="lr-test">
                <h3>${shEsc(sec.name)} <small>${shEsc(sec.sample)}</small></h3>
                <table>
                    <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference range</th></tr></thead>
                    <tbody>${sec.rows.map(r => `
                        <tr class="${r.flag ? 'is-flag' : ''}">
                            <td>${shEsc(r.name)}${r.calc ? ' <span class="lr-calc">calc.</span>' : ''}</td>
                            <td class="lr-val">${r.value === '' || r.value === null ? '—' : shEsc(r.value)}${r.flag ? ` <span class="lr-flag lr-${r.flag}">${LB_FLAG[r.flag][1]} ${LB_FLAG[r.flag][0]}</span>` : ''}</td>
                            <td>${shEsc(r.unit)}</td>
                            <td class="lr-ref">${shEsc(r.ref)}</td>
                        </tr>`).join('')}</tbody>
                </table>
            </section>`).join('')}`).join('')}
        ${b.remarks ? `<section class="lr-remarks"><b>Remarks</b><p>${shEsc(b.remarks)}</p></section>` : ''}
        <footer class="lr-foot">
            <div><small>Verified by</small><b>${shEsc(b.reported_by || 'Laboratory')}</b></div>
            <p>Results marked ▲ High / ▼ Low are outside the reference range for the patient's age group and gender. Reference ranges can differ between laboratories.
               This report should be read together with a doctor's examination. — End of report —</p>
        </footer>
    </div>`;
}

const LB_REPORT_CSS = `
    .lr { font-family: Inter, Arial, sans-serif; color: #0f172a; max-width: 820px; margin: 0 auto; }
    .lr-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #0d9488; }
    .lr-head h1 { margin: 0; font-size: 20px; color: #0f766e; }
    .lr-head p { margin: 4px 0 0; font-size: 12px; color: #475569; }
    .lr-tag { padding: 6px 10px; border: 1.5px solid #0d9488; border-radius: 6px; font-size: 11px; font-weight: 700; letter-spacing: .08em; color: #0f766e; white-space: nowrap; }
    .lr-patient { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 16px; margin: 14px 0 6px; padding: 12px 14px; border-radius: 8px; background: #f1f5f9; }
    .lr-patient small { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #64748b; }
    .lr-patient b { font-size: 13px; }
    .lr-pkg { margin: 18px 0 0; font-size: 14px; color: #0f766e; text-transform: uppercase; letter-spacing: .06em; }
    .lr-test { margin-top: 14px; break-inside: avoid; }
    .lr-test h3 { margin: 0 0 6px; font-size: 14px; }
    .lr-test h3 small { font-weight: 400; color: #64748b; font-size: 11px; }
    .lr table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    .lr th { text-align: left; padding: 6px 8px; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #475569; background: #e2e8f0; }
    .lr td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .lr td.lr-val { font-weight: 600; white-space: nowrap; }
    .lr td.lr-ref { color: #475569; font-size: 11.5px; }
    .lr tr.is-flag td.lr-val { color: #b91c1c; }
    .lr-flag { font-size: 10.5px; font-weight: 700; }
    .lr-calc { font-size: 10px; color: #94a3b8; }
    .lr-remarks { margin-top: 16px; padding: 10px 12px; border-left: 3px solid #0d9488; background: #f0fdfa; font-size: 12.5px; }
    .lr-remarks p { margin: 4px 0 0; white-space: pre-line; }
    .lr-foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #cbd5e1; display: flex; gap: 20px; align-items: flex-start; }
    .lr-foot small { display: block; font-size: 10px; color: #64748b; text-transform: uppercase; }
    .lr-foot b { white-space: nowrap; }
    .lr-foot p { margin: 0; font-size: 10.5px; line-height: 1.5; color: #64748b; }
    @media (max-width: 600px) { .lr-patient { grid-template-columns: 1fr 1fr; } .lr table { font-size: 11.5px; } }`;

