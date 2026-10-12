// Shared in-app popups used by every page instead of the browser's alert / confirm / prompt boxes.

function shEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// =====================================================================
// IN-APP MESSAGES (instead of the browser's alert box)
// =====================================================================
function shToast(message, type) {
    document.querySelectorAll('.sh-toast').forEach(t => t.remove()); // one message at a time, never overlapping
    const el = document.createElement('div');
    el.className = 'sh-toast ' + (type || 'info');
    el.innerHTML = `<i class="fas ${type === 'error' ? 'fa-circle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-circle-info')}"></i> ${shEsc(message)}`;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3500);
}

// Yes / No question in the app's own style. Resolves true or false.
function shConfirm(message, opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'sh-success';
        wrap.innerHTML = `
            <div class="sh-success-card sh-confirm">
                <div class="sh-check ${opts.danger ? 'danger' : 'ask'}"><i class="fas ${opts.danger ? 'fa-triangle-exclamation' : 'fa-question'}"></i></div>
                <p class="sh-question">${shEsc(message)}</p>
                <div class="sh-actions">
                    <button class="ghost" data-answer="no">${shEsc(opts.no || 'Cancel')}</button>
                    <button class="${opts.danger ? 'danger' : ''}" data-answer="yes">${shEsc(opts.yes || 'Yes')}</button>
                </div>
            </div>`;
        const close = answer => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(answer); };
        const onKey = e => { if (e.key === 'Escape') close(false); };
        wrap.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (btn) close(btn.dataset.answer === 'yes');
            else if (e.target === wrap) close(false);
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(wrap);
        wrap.querySelector('[data-answer="yes"]').focus();
    });
}

// A message carried across a page reload (e.g. after logout)
(function showFlash() {
    const msg = sessionStorage.getItem('shFlash');
    if (!msg) return;
    sessionStorage.removeItem('shFlash');
    shToast(msg, 'success');
})();

// For plain-text replies from the server ("Doctor Added Successfully", "Database Error: ...")
// where we only know the wording: red if it reads like a problem, green otherwise.
function shNotify(message) {
    const text = String(message ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    shToast(text.length > 220 ? text.slice(0, 220) + '…' : text,
        /error|fail|invalid|not found|denied|required|cannot|could not|no longer|not available|warning|fatal|incorrect|already/i.test(text) ? 'error' : 'success');
}

// Ask for a value in the app's own style. Resolves the text, or null if cancelled.
function shPrompt(message, value, opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const wrap = document.createElement('div');
        wrap.className = 'sh-success';
        wrap.innerHTML = `
            <div class="sh-success-card sh-confirm">
                <p class="sh-question" style="margin-bottom: 12px;">${shEsc(message)}</p>
                <input class="sh-input" type="${opts.type || 'text'}" value="${shEsc(value ?? '')}" ${opts.readonly ? 'readonly' : ''} ${opts.type === 'number' ? 'min="1"' : ''}>
                <div class="sh-actions">
                    <button class="ghost" data-answer="no">${shEsc(opts.no || 'Cancel')}</button>
                    <button data-answer="yes">${shEsc(opts.yes || 'OK')}</button>
                </div>
            </div>`;
        const input = wrap.querySelector('input');
        const close = ok => { document.removeEventListener('keydown', onKey); wrap.remove(); resolve(ok ? input.value : null); };
        const onKey = e => { if (e.key === 'Escape') close(false); else if (e.key === 'Enter') close(true); };
        wrap.addEventListener('click', e => {
            const btn = e.target.closest('button');
            if (btn) close(btn.dataset.answer === 'yes');
            else if (e.target === wrap) close(false);
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(wrap);
        input.focus();
        input.select();
    });
}
