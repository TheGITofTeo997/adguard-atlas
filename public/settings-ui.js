const $ = (id) => document.getElementById(id);

async function api(path, body) {
  const init = { credentials: 'same-origin' };
  if (body !== undefined) Object.assign(init, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await fetch(path, init);
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function initSettingsUI({ settings, defaults, presets, onChange, getServerSource }) {
  const dlg = $('settings');
  const controls = [...dlg.querySelectorAll('[data-setting]')];
  const box = $('presets');

  for (const [id, p] of Object.entries(presets)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.preset = id;
    b.style.setProperty('--sw-bg', p.bg);
    b.style.setProperty('--sw-ac', p.accent);
    const label = document.createElement('span');
    label.textContent = p.name;
    b.append(label);
    b.addEventListener('click', () => { settings.preset = id; settings.accent = null; onChange('preset'); refresh(); });
    box.append(b);
  }

  function refresh() {
    for (const el of controls) {
      const k = el.dataset.setting;
      const v = k === 'accent' ? (settings.accent || presets[settings.preset].accent) : settings[k];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    }
    for (const b of box.children) b.classList.toggle('on', b.dataset.preset === settings.preset);
    for (const out of dlg.querySelectorAll('[data-out]')) out.textContent = settings[out.dataset.out];
    const s = getServerSource();
    for (const [k, v] of [['srcLat', s?.lat], ['srcLng', s?.lng]]) {
      const el = dlg.querySelector(`[data-setting="${k}"]`);
      el.placeholder = v === undefined ? (k === 'srcLat' ? 'lat' : 'lng') : String(v);
    }
  }

  for (const el of controls) {
    el.addEventListener('input', () => {
      const k = el.dataset.setting;
      settings[k] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value);
      onChange(k);
      refresh();
    });
  }

  $('reset-accent').addEventListener('click', () => { settings.accent = null; onChange('accent'); refresh(); });
  $('reset-source').addEventListener('click', () => { settings.srcLat = ''; settings.srcLng = ''; onChange('srcLat'); refresh(); });
  $('reset-all').addEventListener('click', () => { Object.assign(settings, defaults); onChange('preset'); onChange('colorMode'); onChange('globe'); refresh(); });
  $('settings-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  /* ---------------- 2FA ---------------- */
  const msg = (text, ok = false) => { const m = $('twofa-msg'); m.textContent = text || ''; m.dataset.ok = ok ? '1' : ''; };
  const show = (name) => { for (const id of ['off', 'setup', 'codes', 'on']) $(`twofa-${id}`).hidden = id !== name; };

  async function loadSecurity() {
    msg('');
    try {
      const s = await api('/api/security');
      $('twofa-status').textContent = s.twofa
        ? `Enabled · ${s.recoveryLeft} recovery code${s.recoveryLeft === 1 ? '' : 's'} left.`
        : 'Disabled. Adds a one-time code from your authenticator app at sign-in.';
      show(s.twofa ? 'on' : 'off');
      if (!s.persistent) msg('2FA changes require a writable data directory. Check the Docker /data volume.');
    } catch (e) { msg(e.message); }
  }

  $('twofa-start').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    msg('');
    try {
      const r = await api('/api/2fa/setup', {});
      $('twofa-qr').src = r.qr;
      $('twofa-secret').textContent = r.secret;
      $('twofa-code').value = '';
      show('setup');
      $('twofa-code').focus();
    } catch (e) { msg(e.message); }
    finally { button.disabled = false; }
  });
  $('twofa-cancel').addEventListener('click', loadSecurity);
  $('twofa-confirm').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    msg('');
    try {
      const r = await api('/api/2fa/enable', { code: $('twofa-code').value });
      $('twofa-recovery').textContent = r.recoveryCodes.join('\n');
      $('twofa-status').textContent = 'Enabled. Use a fresh code at your next sign-in.';
      $('twofa-code').value = '';
      $('twofa-secret').textContent = '';
      $('twofa-qr').removeAttribute('src');
      show('codes');
    } catch (e) { msg(e.message); }
    finally { button.disabled = false; }
  });
  $('twofa-code').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('twofa-confirm').click();
  });
  $('twofa-done').addEventListener('click', () => { $('twofa-recovery').textContent = ''; loadSecurity(); });
  $('twofa-disable').addEventListener('click', async () => {
    msg('');
    try {
      await api('/api/2fa/disable', { password: $('twofa-pw').value, code: $('twofa-dcode').value });
      $('twofa-pw').value = ''; $('twofa-dcode').value = '';
      await loadSecurity();
      msg('2FA disabled.', true);
    } catch (e) { msg(e.message); }
  });

  return {
    refresh,
    open() { refresh(); if ($('twofa-codes').hidden) loadSecurity(); dlg.showModal(); }
  };
}

