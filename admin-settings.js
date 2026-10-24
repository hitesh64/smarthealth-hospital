// Admin > Settings: staff users (their own admin-panel login) and roles (which sections a role opens).
// Uses afApi() / afEsc() from admin-features.js, shToast() / shConfirm() from popups.js and adminInfo from admin.js.

let stData = { roles: [], users: [], sections: [] };

function stPost(action, data) { return afApi('api/admin/settings', action, {}, data); }

function loadSettings() {
    return afApi('api/admin/settings', 'data').then(d => {
        if (d.status !== 'success') {
            document.getElementById('st-users-body').innerHTML = `<tr><td colspan="6">${afEsc(d.message || 'Could not load the settings.')}</td></tr>`;
            return;
        }
        stData = d;
        renderStaffUsers();
        renderRoles();
    });
}

function stSectionLabel(key) { const s = stData.sections.find(x => x.key === key); return s ? s.label : key; }

function stChips(perms, all) {
    if (all) return '<span class="st-chip st-chip--all"><i class="fas fa-crown"></i> Every section</span>';
    return perms.length ? perms.map(p => `<span class="st-chip">${afEsc(stSectionLabel(p))}</span>`).join('') : '<span class="st-chip st-chip--none">Nothing yet</span>';
}

function stWhen(v) { return v ? afEsc(String(v).slice(0, 16)) : '<span class="muted">Never</span>'; }

function renderStaffUsers() {
    const q = (document.getElementById('st-users-search').value || '').trim().toLowerCase();
    const rows = stData.users.filter(u => !q || [u.name, u.email, u.role].join(' ').toLowerCase().includes(q));
    document.getElementById('st-users-count').textContent = stData.users.length;
    document.getElementById('st-users-body').innerHTML = rows.length ? rows.map(u => {
        const role = stData.roles.find(r => r.id === u.role_id);
        return `<tr class="${u.active ? '' : 'is-off'}">
            <td><div class="cell-person">${avatarHtml(u.name)}<span><span class="cell-strong">${afEsc(u.name)}</span>${u.is_me ? ' <span class="badge accepted">You</span>' : ''}<br><small>${afEsc(u.email)}</small></span></div></td>
            <td><span class="badge ${u.super ? 'danger' : 'accepted'}">${afEsc(u.role)}</span></td>
            <td><div class="st-chips">${role ? stChips(role.permissions, role.builtin) : '<span class="st-chip st-chip--none">No role</span>'}</div></td>
            <td>${u.active ? '<span class="badge confirmed">Active</span>' : '<span class="badge manual">Switched off</span>'}</td>
            <td>${stWhen(u.last_login)}</td>
            <td><div class="row-actions">
                <button class="btn btn--sm btn--outline" onclick="openStaffUser(${u.id})"><i class="fas fa-pen"></i> Edit</button>
                ${u.is_me ? '' : `<button class="btn btn--sm btn--danger-soft" onclick="deleteStaffUser(${u.id})" title="Delete login"><i class="fas fa-trash"></i></button>`}
            </div></td>
        </tr>`;
    }).join('') : `<tr><td class="empty" colspan="6"><i class="fas fa-users"></i>${stData.users.length ? 'No staff user matches this search.' : 'No staff users yet.'}</td></tr>`;
}

function renderRoles() {
    document.getElementById('st-roles-count').textContent = stData.roles.length;
    document.getElementById('st-roles').innerHTML = stData.roles.map(r => `
        <article class="st-role ${r.builtin ? 'is-super' : ''}">
            <div class="st-role-head">
                <div><h3>${r.builtin ? '<i class="fas fa-crown"></i> ' : ''}${afEsc(r.name)}</h3><p>${afEsc(r.description || '')}</p></div>
                <span class="st-role-users"><i class="fas fa-user"></i> ${r.users}</span>
            </div>
            <div class="st-chips">${stChips(r.permissions, r.builtin)}</div>
            <div class="row-actions">
                <button class="btn btn--sm btn--outline" onclick="openRole(${r.id})"><i class="fas fa-pen"></i> ${r.builtin ? 'View' : 'Edit'}</button>
                <button class="btn btn--sm btn--outline" onclick="openStaffUser(0, ${r.id})"><i class="fas fa-user-plus"></i> Add user</button>
                ${r.builtin ? '' : `<button class="btn btn--sm btn--danger-soft" onclick="deleteRole(${r.id})" title="Delete role"><i class="fas fa-trash"></i></button>`}
            </div>
        </article>`).join('');
}

function closeSettingsModal(id) { document.getElementById(id).style.display = 'none'; }

// ---------------------------------------------------------------- roles

function openRole(id) {
    const r = id ? stData.roles.find(x => x.id === id) : null;
    const locked = r && r.builtin;
    document.getElementById('role-title').textContent = r ? (locked ? 'Super Admin role' : `Edit role · ${r.name}`) : 'Add role';
    document.getElementById('role-body').innerHTML = `
        <form class="dash-form" onsubmit="saveRole(event, ${r ? r.id : 0})">
            <div class="form-group"><label for="role-name">Role name</label><input id="role-name" required maxlength="60" ${locked ? 'disabled' : ''} value="${afEsc(r ? r.name : '')}" placeholder="e.g. Receptionist"></div>
            <div class="form-group"><label for="role-desc">Description <small>(optional)</small></label><input id="role-desc" maxlength="200" value="${afEsc(r ? r.description : '')}" placeholder="What this person does"></div>
            <div class="form-group span-2">
                <label>Sections this role can open
                    ${locked ? '' : `<span class="st-pick"><button type="button" onclick="stTickAll(true)">Select all</button> · <button type="button" onclick="stTickAll(false)">None</button></span>`}</label>
                ${locked ? '<p class="st-note"><i class="fas fa-crown"></i> Super Admin always has every section, so the hospital can never be locked out.</p>' : ''}
                <div class="st-perms">${stData.sections.map(s => `
                    <label class="st-perm ${s.key === 'settings' ? 'is-power' : ''}">
                        <input type="checkbox" value="${s.key}" ${locked || (r && r.permissions.includes(s.key)) ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                        <span><b>${afEsc(s.label)}</b><small>${afEsc(s.description)}</small></span>
                    </label>`).join('')}</div>
            </div>
            <div class="form-submit">
                <button class="btn" type="submit">${locked ? 'Save description' : 'Save role'}</button>
                <button class="btn btn--outline" type="button" onclick="closeSettingsModal('roleModal')">Cancel</button>
            </div>
        </form>`;
    document.getElementById('roleModal').style.display = 'flex';
    if (!locked) document.getElementById('role-name').focus();
}

function stTickAll(on) { document.querySelectorAll('#role-body .st-perm input').forEach(c => { c.checked = on; }); }

function saveRole(e, id) {
    e.preventDefault();
    const perms = [...document.querySelectorAll('#role-body .st-perm input:checked')].map(c => c.value);
    if (perms.includes('settings') && id !== stData.roles.find(r => r.builtin)?.id) {
        // Settings lets someone make themselves Super Admin, so it is worth a second look
        if (!document.getElementById('role-body').dataset.warned) {
            document.getElementById('role-body').dataset.warned = '1';
            return shToast('Settings gives full control (they can create users and roles). Press Save again if that is what you want.', 'info');
        }
    }
    stPost('saveRole', { id, name: document.getElementById('role-name').value.trim(), description: document.getElementById('role-desc').value.trim(),
        permissions: JSON.stringify(perms) }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shToast('Role saved. Staff with this role see the new sections the next time their page loads.', 'success');
        closeSettingsModal('roleModal');
        loadSettings();
    });
}

async function deleteRole(id) {
    const r = stData.roles.find(x => x.id === id);
    if (!await shConfirm(`Delete the role "${r.name}"?`, { yes: 'Delete role', danger: true })) return;
    stPost('deleteRole', { id }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        loadSettings();
    });
}

// ---------------------------------------------------------------- staff users

function openStaffUser(id, roleId) {
    const u = id ? stData.users.find(x => x.id === id) : null;
    const chosen = u ? u.role_id : (roleId || (stData.roles.find(r => !r.builtin) || stData.roles[0] || {}).id);
    document.getElementById('staff-title').textContent = u ? `Edit · ${u.name}` : 'Add staff user';
    document.getElementById('staff-body').innerHTML = `
        <form class="dash-form" onsubmit="saveStaffUser(event, ${u ? u.id : 0})" autocomplete="off">
            <div class="form-group"><label for="su-name">Full name</label><input id="su-name" required maxlength="100" value="${afEsc(u ? u.name : '')}" placeholder="e.g. Priya Sharma"></div>
            <div class="form-group"><label for="su-email">Login email</label><input id="su-email" type="email" required value="${afEsc(u ? u.email : '')}" placeholder="name@hospital.com" autocomplete="off"></div>
            <div class="form-group"><label for="su-pass">${u ? 'New password <small>(leave empty to keep the current one)</small>' : 'Password <small>(at least 8 characters)</small>'}</label>
                <div class="st-pass"><input id="su-pass" type="password" minlength="8" ${u ? '' : 'required'} autocomplete="new-password">
                <button type="button" class="btn btn--sm btn--outline" onclick="stTogglePass()" title="Show / hide"><i class="fas fa-eye"></i></button></div></div>
            <div class="form-group"><label for="su-role">Role</label>
                <select id="su-role" onchange="stRolePreview()" ${u && u.is_me && u.super ? 'disabled' : ''}>${stData.roles.map(r => `<option value="${r.id}" ${r.id === chosen ? 'selected' : ''}>${afEsc(r.name)}</option>`).join('')}</select></div>
            <div class="form-group span-2"><label>This person will be able to open</label><div class="st-chips" id="su-preview"></div></div>
            <div class="form-group span-2"><label class="med-check"><input type="checkbox" id="su-active" ${!u || u.active ? 'checked' : ''} ${u && u.is_me ? 'disabled' : ''}> Account is active (can sign in)</label></div>
            <p class="st-note span-2"><i class="fas fa-circle-info"></i> They sign in on this same admin page with this email and password.</p>
            <div class="form-submit">
                <button class="btn" type="submit">${u ? 'Save changes' : 'Create login'}</button>
                <button class="btn btn--outline" type="button" onclick="closeSettingsModal('staffUserModal')">Cancel</button>
            </div>
        </form>`;
    stRolePreview();
    document.getElementById('staffUserModal').style.display = 'flex';
    document.getElementById('su-name').focus();
}

function stRolePreview() {
    const r = stData.roles.find(x => x.id === +document.getElementById('su-role').value);
    document.getElementById('su-preview').innerHTML = r ? stChips(r.permissions, r.builtin) : '';
}

function stTogglePass() {
    const el = document.getElementById('su-pass');
    el.type = el.type === 'password' ? 'text' : 'password';
}

function saveStaffUser(e, id) {
    e.preventDefault();
    stPost('saveUser', { id, name: document.getElementById('su-name').value.trim(), email: document.getElementById('su-email').value.trim(),
        password: document.getElementById('su-pass').value, role_id: document.getElementById('su-role').value,
        active: document.getElementById('su-active').checked ? '1' : '0' }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        shToast(id ? 'Staff user updated.' : 'Login created. They can sign in on the admin page now.', 'success');
        closeSettingsModal('staffUserModal');
        loadSettings();
    });
}

async function deleteStaffUser(id) {
    const u = stData.users.find(x => x.id === id);
    if (!await shConfirm(`Delete the login of ${u.name} (${u.email})? They will not be able to sign in any more.`, { yes: 'Delete login', danger: true })) return;
    stPost('deleteUser', { id }).then(res => {
        if (res.status !== 'success') return shToast(res.message, 'error');
        loadSettings();
    });
}
