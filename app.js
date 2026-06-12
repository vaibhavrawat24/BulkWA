/* ── Storage ─────────────────────────────────────────────────────────────── */
const LS = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const KEY = { cfg: 'wa_config', contacts: 'wa_contacts' };

/* ── State ───────────────────────────────────────────────────────────────── */
const state = {
  page:    'send',
  filter:  'all',
  cPage:   1,
  sending: false,
  paused:  false,
  stop:    false,
};
let pauseResolve = null;

/* ── Toast ───────────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const icon = type === 'success'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}`, innerHTML: `${icon}<span>${msg}</span>` });
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 200); }, 3500);
}

/* ── Navigation ──────────────────────────────────────────────────────────── */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById('topbar-title').textContent = { send: 'Send', contacts: 'Contacts', settings: 'Settings' }[page];
  state.page = page;
  if (page === 'send')     loadSendPage();
  if (page === 'contacts') loadContactsPage();
  if (page === 'settings') loadSettingsPage();
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function getContacts()        { return LS.get(KEY.contacts, []); }
function saveContacts(list)   { LS.set(KEY.contacts, list); }

function getStats() {
  const list = getContacts();
  return {
    total:   list.length,
    sent:    list.filter(c => c.status === 'sent').length,
    pending: list.filter(c => c.status === 'pending').length,
    failed:  list.filter(c => c.status === 'failed').length,
  };
}

function markContact(id, status, error = null) {
  const list = getContacts();
  const c = list.find(x => x.id === id);
  if (!c) return;
  c.status = status;
  c.sentAt = status === 'sent' ? new Date().toISOString() : null;
  c.error  = error;
  saveContacts(list);
}

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function statusBadge(status, error) {
  const labels = { sent: 'Sent', pending: 'Pending', failed: 'Failed' };
  let html = `<span class="status-badge ${status}"><span class="status-dot"></span>${labels[status]}</span>`;
  if (error) html += `<div style="font-size:11px;color:var(--red);margin-top:3px">${error}</div>`;
  return html;
}

/* ── Send Page ───────────────────────────────────────────────────────────── */
function loadSendPage() {
  const stats = getStats();
  const cfg   = LS.get(KEY.cfg, {});

  document.getElementById('s-total').textContent   = stats.total;
  document.getElementById('s-sent').textContent    = stats.sent;
  document.getElementById('s-pending').textContent = stats.pending;
  document.getElementById('s-failed').textContent  = stats.failed;

  const noSettings = !cfg.phoneNumberId || !cfg.accessToken || !cfg.templateName;
  document.getElementById('warn-settings').style.display = noSettings ? 'flex' : 'none';
  document.getElementById('warn-contacts').style.display = stats.total === 0 ? 'flex' : 'none';

  if (!state.sending) {
    document.getElementById('send-progress').style.display = 'none';
    document.getElementById('send-actions').style.display  = 'block';
    document.getElementById('batch-size').max = stats.pending;
    if (stats.pending > 0 && parseInt(document.getElementById('batch-size').value) > stats.pending) {
      document.getElementById('batch-size').value = stats.pending;
    }
  }
}

/* ── Send Logic ──────────────────────────────────────────────────────────── */
async function startSending() {
  const cfg       = LS.get(KEY.cfg, {});
  const batchSize = parseInt(document.getElementById('batch-size').value) || 50;
  const delaySec  = parseInt(document.getElementById('delay-sec').value) || 15;

  if (!cfg.phoneNumberId || !cfg.accessToken || !cfg.templateName) {
    toast('Please complete Settings first.', 'error'); return;
  }

  const pending = getContacts().filter(c => c.status === 'pending');
  if (!pending.length) { toast('No pending contacts.', 'error'); return; }

  const batch = pending.slice(0, batchSize);

  state.sending = true;
  state.paused  = false;
  state.stop    = false;

  document.getElementById('send-actions').style.display  = 'none';
  document.getElementById('send-progress').style.display = 'block';
  document.getElementById('pause-btn').textContent = 'Pause';

  for (let i = 0; i < batch.length; i++) {
    if (state.stop) break;

    if (state.paused) {
      document.getElementById('pause-btn').textContent = 'Resume';
      document.getElementById('progress-label').textContent = 'Paused';
      await new Promise(r => { pauseResolve = r; });
      document.getElementById('pause-btn').textContent = 'Pause';
    }

    const contact = batch[i];
    const pct = Math.round((i / batch.length) * 100);

    document.getElementById('progress-fill').style.width = `${pct}%`;
    document.getElementById('progress-count').textContent = `${i} / ${batch.length}`;
    document.getElementById('progress-label').textContent = 'Sending…';
    document.getElementById('current-contact').textContent =
      `→ ${contact.name || 'Contact'} (+${contact.phone})`;

    try {
      const res = await sendWA(cfg, contact);
      if (res.messages?.[0]?.id || res.messaging_product) {
        markContact(contact.id, 'sent');
      } else {
        markContact(contact.id, 'failed', res.error?.message || 'Unknown error');
      }
    } catch (err) {
      markContact(contact.id, 'failed', err.message);
    }

    if (i < batch.length - 1 && !state.stop) {
      const delayMs = delaySec * 1000;
      const minsLeft = Math.ceil(((batch.length - i - 1) * delaySec) / 60);
      document.getElementById('progress-label').textContent = `Waiting ${delaySec}s before next…`;
      document.getElementById('current-contact').textContent = `~${minsLeft} min remaining`;
      await sleep(delayMs);
    }
  }

  // Done
  state.sending = false;
  document.getElementById('progress-fill').style.width     = '100%';
  document.getElementById('progress-count').textContent    = `${batch.length} / ${batch.length}`;
  document.getElementById('progress-label').textContent    = state.stop ? 'Stopped.' : 'Batch complete!';
  document.getElementById('current-contact').textContent   = '';

  setTimeout(() => {
    document.getElementById('send-progress').style.display = 'none';
    document.getElementById('send-actions').style.display  = 'block';
    loadSendPage();
  }, 2500);

  if (!state.stop) toast(`Batch complete! ${batch.length} messages processed.`);
}

function togglePause() {
  state.paused = !state.paused;
  if (!state.paused && pauseResolve) { pauseResolve(); pauseResolve = null; }
}

function stopSending() {
  state.stop    = true;
  state.paused  = false;
  state.sending = false;
  if (pauseResolve) { pauseResolve(); pauseResolve = null; }
  toast('Sending stopped.');
}

/* ── WhatsApp API ────────────────────────────────────────────────────────── */
async function sendWA(cfg, contact) {
  const { phoneNumberId, accessToken, templateName, templateLang, variables } = cfg;

  const components = [];
  if (variables) {
    const cols   = variables.split(',').map(s => s.trim()).filter(Boolean);
    const params = cols.map(col => ({ type: 'text', text: String(contact.data?.[col] || contact.name || contact.phone) }));
    if (params.length) components.push({ type: 'body', parameters: params });
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to:   contact.phone,
      type: 'template',
      template: {
        name:     templateName,
        language: { code: templateLang || 'en_US' },
        ...(components.length && { components }),
      },
    }),
  });

  return res.json();
}

/* ── Contacts Page ───────────────────────────────────────────────────────── */
function loadContactsPage() {
  const stats = getStats();
  document.getElementById('tc-all').textContent     = stats.total;
  document.getElementById('tc-pending').textContent = stats.pending;
  document.getElementById('tc-sent').textContent    = stats.sent;
  document.getElementById('tc-failed').textContent  = stats.failed;
  renderContactsTable();

  // Show feedback if contacts exist
  if (stats.total > 0) {
    document.getElementById('upload-feedback').style.display = 'flex';
    document.getElementById('feedback-title').textContent    = `${stats.total} contacts loaded`;
    document.getElementById('feedback-sub').textContent      = `${stats.pending} pending · ${stats.sent} sent · ${stats.failed} failed`;
  }
}

function renderContactsTable() {
  const all    = getContacts().filter(c => state.filter === 'all' || c.status === state.filter);
  const limit  = 20;
  const pages  = Math.max(1, Math.ceil(all.length / limit));
  state.cPage  = Math.min(state.cPage, pages);
  const slice  = all.slice((state.cPage - 1) * limit, state.cPage * limit);
  const tbody  = document.getElementById('contacts-tbody');

  if (!slice.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="5"><div class="empty-state">No contacts found.</div></td></tr>`;
    document.getElementById('pagination').style.display = 'none';
    return;
  }

  tbody.innerHTML = slice.map((c, i) => `
    <tr>
      <td>${(state.cPage - 1) * limit + i + 1}</td>
      <td>${c.name || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="font-family:monospace;font-size:12px">${c.phone}</td>
      <td>${statusBadge(c.status, c.error)}</td>
      <td style="font-size:12px;color:var(--text-muted)">${formatTime(c.sentAt)}</td>
    </tr>`).join('');

  const pag = document.getElementById('pagination');
  pag.style.display = pages > 1 ? 'flex' : 'none';
  document.getElementById('page-info').textContent = `Page ${state.cPage} of ${pages}`;
  document.getElementById('prev-btn').disabled = state.cPage <= 1;
  document.getElementById('next-btn').disabled = state.cPage >= pages;
}

function changePage(dir) { state.cPage += dir; renderContactsTable(); }

function setFilter(f) {
  state.filter = f; state.cPage = 1;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.filter === f));
  renderContactsTable();
}

function retryFailed() {
  const list = getContacts(); let n = 0;
  list.forEach(c => { if (c.status === 'failed') { c.status = 'pending'; c.error = null; n++; } });
  saveContacts(list); toast(`${n} contacts marked for retry.`); loadContactsPage();
}

function resetAll() {
  if (!confirm('Reset all contacts to pending?')) return;
  const list = getContacts();
  list.forEach(c => { c.status = 'pending'; c.error = null; c.sentAt = null; });
  saveContacts(list); toast('All contacts reset.'); loadContactsPage();
}

function clearContacts() {
  if (!confirm('Delete all contacts? This cannot be undone.')) return;
  saveContacts([]); toast('Contacts cleared.');
  document.getElementById('upload-feedback').style.display = 'none';
  loadContactsPage();
}

/* ── File Upload ─────────────────────────────────────────────────────────── */
function setupUpload() {
  const zone  = document.getElementById('dropzone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]); });
  input.addEventListener('change', () => { if (input.files[0]) parseFile(input.files[0]); });
}

function parseFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const wb   = XLSX.read(e.target.result, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    if (!rows.length) { toast('File is empty.', 'error'); return; }

    const cols     = Object.keys(rows[0]);
    const PHONE_K  = ['phone', 'phonenumber', 'phone number', 'mobile', 'number', 'whatsapp'];
    const NAME_K   = ['name', 'fullname', 'full name', 'contact name'];
    const phoneCol = cols.find(k => PHONE_K.includes(k.toLowerCase().trim()));
    const nameCol  = cols.find(k => NAME_K.includes(k.toLowerCase().trim()));

    if (!phoneCol) { toast(`No phone column found. Expected: ${PHONE_K.slice(0,3).join(', ')}`, 'error'); return; }

    const cfg         = LS.get(KEY.cfg, {});
    const countryCode = cfg.countryCode || '91';

    const contacts = rows.map((row, i) => {
      const raw = String(row[phoneCol] || '').replace(/[\s\-\+\(\)\.]/g, '');
      if (!raw || !/^\d{7,15}$/.test(raw)) return null;
      const phone = raw.length === 10 ? `${countryCode}${raw}` : raw;
      return { id: i + 1, name: nameCol ? String(row[nameCol] || '').trim() : '', phone, data: row, status: 'pending', sentAt: null, error: null };
    }).filter(Boolean);

    if (!contacts.length) { toast('No valid phone numbers found.', 'error'); return; }

    // Merge with existing: preserve status of already-processed contacts
    const existing = getContacts();
    const existingMap = Object.fromEntries(existing.map(c => [c.phone, c]));
    const merged = contacts.map(c => existingMap[c.phone] ? { ...c, status: existingMap[c.phone].status, sentAt: existingMap[c.phone].sentAt, error: existingMap[c.phone].error } : c);

    saveContacts(merged);

    document.getElementById('feedback-title').textContent = `${merged.length} contacts loaded`;
    document.getElementById('feedback-sub').textContent   = `Columns detected: ${cols.join(', ')}`;
    document.getElementById('upload-feedback').style.display = 'flex';

    toast(`${merged.length} contacts uploaded!`);
    state.cPage = 1;
    loadContactsPage();
  };
  reader.readAsArrayBuffer(file);
}

/* ── Settings Page ───────────────────────────────────────────────────────── */
function loadSettingsPage() {
  const cfg = LS.get(KEY.cfg, {});
  document.getElementById('cfg-phone-id').value  = cfg.phoneNumberId || '';
  document.getElementById('cfg-token').value     = cfg.accessToken   || '';
  document.getElementById('cfg-template').value  = cfg.templateName  || '';
  document.getElementById('cfg-lang').value      = cfg.templateLang  || 'en_US';
  document.getElementById('cfg-country').value   = cfg.countryCode   || '91';
  document.getElementById('cfg-variables').value = cfg.variables     || '';
}

function saveSettings() {
  const data = {
    phoneNumberId: document.getElementById('cfg-phone-id').value.trim(),
    accessToken:   document.getElementById('cfg-token').value.trim(),
    templateName:  document.getElementById('cfg-template').value.trim(),
    templateLang:  document.getElementById('cfg-lang').value,
    countryCode:   document.getElementById('cfg-country').value.trim() || '91',
    variables:     document.getElementById('cfg-variables').value.trim(),
  };
  if (!data.phoneNumberId || !data.accessToken || !data.templateName) {
    toast('Please fill in all required fields.', 'error'); return;
  }
  LS.set(KEY.cfg, data);
  toast('Settings saved!');
}

async function testConnection() {
  const btn = document.getElementById('test-btn');
  const res = document.getElementById('test-result');
  const cfg = LS.get(KEY.cfg, {});

  if (!cfg.phoneNumberId || !cfg.accessToken) { toast('Save your credentials first.', 'error'); return; }

  btn.textContent = 'Testing…'; btn.disabled = true;

  try {
    const r = await fetch(`https://graph.facebook.com/v18.0/${cfg.phoneNumberId}?fields=display_phone_number,verified_name&access_token=${cfg.accessToken}`);
    const d = await r.json();
    if (d.display_phone_number) {
      res.className = 'test-result success';
      res.innerHTML = `Connected! <strong>${d.display_phone_number}</strong> (${d.verified_name})`;
      toast('Connection successful!');
    } else {
      throw new Error(d.error?.message || 'Unknown error');
    }
  } catch (e) {
    res.className   = 'test-result error';
    res.textContent = `Error: ${e.message}`;
    toast('Connection failed.', 'error');
  }

  res.style.display = 'block';
  btn.textContent = 'Test Connection'; btn.disabled = false;
}

function toggleToken() {
  const input = document.getElementById('cfg-token');
  const btn   = input.nextElementSibling;
  input.type  = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? 'Show' : 'Hide';
}

function toggleAccordion() {
  const body  = document.getElementById('acc-body');
  const arrow = document.getElementById('acc-arrow');
  const open  = body.style.display === 'none';
  body.style.display    = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(180deg)' : '';
}

/* ── Init ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-page]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.page)));
  document.getElementById('filter-tabs').addEventListener('click', e => { const t = e.target.closest('.tab'); if (t) setFilter(t.dataset.filter); });
  setupUpload();
  loadSendPage();
});
