// My Profile page (patient site): the summary card follows the form as it is typed, the blood group
// is picked from chips, and the save bar says whether anything is waiting to be saved.
// Uses `currentUser` and saveProfile() from the main page script, and shEsc() from popups.js.

const PF_BLOOD = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];

function profValues() {
    const val = id => document.getElementById(id).value.trim();
    return { name: val('profName'), phone: val('profPhone'), age: val('profAge'), blood: document.getElementById('profBlood').value, address: val('profAddress') };
}

// Redraws the summary card and the save bar from what is in the form right now.
// Called when the page opens, on every change, and by saveProfile() when it finishes.
function profRefresh() {
    if (!document.getElementById('pfName') || !currentUser) return;
    const v = profValues();

    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el.textContent === text) return;
        el.textContent = text;
        el.classList.remove('is-new');
        void el.offsetWidth;
        el.classList.add('is-new');
    };
    document.getElementById('pfName').textContent = v.name || 'Your name';
    document.getElementById('pfEmail').textContent = currentUser.email || '';
    set('pfBlood', v.blood || '—');
    set('pfAge', v.age || '—');
    set('pfPhone', v.phone || '—');
    // the picture changes only with the saved name, not on every key press
    const picture = currentUser.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentUser.name || 'User')}&background=2563eb&color=fff&bold=true&size=200`;
    const img = document.getElementById('pfAvatar');
    if (img.getAttribute('src') !== picture) img.src = picture;

    document.querySelectorAll('#pfBloodChips button').forEach(b => b.classList.toggle('active', b.dataset.blood === v.blood));

    const checks = [['Full name', v.name.length > 1], ['Phone number', !!v.phone], ['Age', !!v.age], ['Blood group', !!v.blood], ['Address', !!v.address]];
    const done = checks.filter(c => c[1]).length, pct = Math.round(done / checks.length * 100);
    document.getElementById('pfPct').textContent = pct + '%';
    document.getElementById('pfBar').style.width = pct + '%';
    document.getElementById('pfMeter').classList.toggle('is-full', done === checks.length);
    const list = document.getElementById('pfChecks');
    if (!list.children.length) list.innerHTML = checks.map(c => `<li><i class="fas fa-check"></i>${c[0]}</li>`).join('');
    [...list.children].forEach((li, i) => li.classList.toggle('ok', checks[i][1]));

    // anything different from what is saved?
    const saved = { name: currentUser.name || '', phone: currentUser.phone || '', age: String(currentUser.age || ''), blood: currentUser.blood || 'A+', address: currentUser.address || '' };
    const dirty = Object.keys(saved).some(k => String(saved[k]).trim() !== v[k]);
    const bar = document.getElementById('pfSave'), btn = document.getElementById('pfSaveBtn');
    bar.classList.toggle('is-dirty', dirty);
    document.getElementById('pfState').innerHTML = dirty
        ? '<i class="fas fa-circle"></i>You have unsaved changes'
        : '<i class="fas fa-circle-check"></i>Everything is saved';
    btn.disabled = !dirty;
    btn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Profile Details';
}

function profSave() {
    const btn = document.getElementById('pfSaveBtn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Saving…';
    saveProfile(); // it calls profRefresh() when the server has answered
}

(function profSetup() {
    const chips = document.getElementById('pfBloodChips');
    if (!chips) return;
    chips.innerHTML = PF_BLOOD.map(b => `<button type="button" data-blood="${b}">${b}</button>`).join('');
    chips.addEventListener('click', e => {
        const chip = e.target.closest('button');
        if (!chip) return;
        document.getElementById('profBlood').value = chip.dataset.blood;
        profRefresh();
    });
    document.getElementById('profile-view').addEventListener('input', profRefresh);
})();
