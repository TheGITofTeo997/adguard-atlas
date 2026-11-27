const form = document.getElementById('login-form');
const error = document.getElementById('error');
const button = form.querySelector('[type=submit]');
const back = document.getElementById('back');
let ticket = null;

function step(second) {
  document.getElementById('creds').hidden = second;
  document.getElementById('code-row').hidden = !second;
  back.hidden = !second;
  button.textContent = second ? 'Verify code' : 'Sign in';
  form.elements.code.value = '';
  const field = second ? document.getElementById('code') : form.elements.username;
  field.required = true;
  field.focus();
  if (second) { form.elements.username.required = false; form.elements.password.required = false; }
  else { document.getElementById('code').required = false; form.elements.username.required = true; form.elements.password.required = true; }
}

back.addEventListener('click', () => {
  ticket = null;
  error.textContent = '';
  step(false);
});

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), credentials: 'same-origin'
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  return { res, data };
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.textContent = '';
  button.disabled = true;
  back.disabled = true;
  try {
    const { res, data } = ticket
      ? await post('/api/login/2fa', { ticket, code: form.elements.code.value })
      : await post('/api/login', { username: form.elements.username.value, password: form.elements.password.value, remember: form.elements.remember.checked });

    if (res.ok && data.twofa) { ticket = data.ticket; step(true); return; }
    if (res.ok) { window.location.href = '/'; return; }

    if (ticket && /expired|again/i.test(data.error || '')) { ticket = null; step(false); error.textContent = data.error; }
    else if (res.status === 429) error.textContent = data.error || 'Too many attempts. Try again later.';
    else error.textContent = data.error || 'Sign-in failed.';
  } catch {
    error.textContent = 'Server unreachable.';
  } finally {
    button.disabled = false;
    back.disabled = false;
  }
});
