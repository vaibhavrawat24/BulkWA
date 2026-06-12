/* ── State ──────────────────────────────────────────────────────────────── */
const state = {
  page:         'dashboard',
  contactsPage: 1,
  filter:       'all',
  campaign:     null,
  pollTimer:    null,
};

/* ── API helpers ────────────────────────────────────────────────────────── */
const api = {
  get:  url       => fetch(url).then(r => r.json()),
  post: (url, d)  => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json()),
  del:  url       => fetch(url, { method: 'DELETE' }).then(r => r.json()),
};

/* ── Toast ──────────────────────────────────────────────────────────────── */
function toast(msg, type = 'success') {
  const icon = type === 'success'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon}<span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);

  setTimeout(() => {
    el.classList.add('removing');
    setTimeout(() => el.remove(), 200);
  }, 3500);
}

/* ── Navigation ─────────────────────────────────────────────────────────── */
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bottom-item').forEach(b => {
    b.classList.toggle('active', b.dataset.page === page);
  });
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.add('active');

  const titles = { dashboard: 'Dashboard', contacts: 'Contacts', campaign: 'Campaign', setup: 'Setup', logs: 'Logs' };
  document.getElementById('topbar-title').textContent = titles[page] || page;

  state.page = page;
  loadPage(page);
}

function loadPage(page) {
  if (page === 'dashboard') loadDashboard();
  if (page === 'contacts')  loadContacts();
  if (page === 'campaign')  loadCampaignPage();
  if (page === 'setup')     loadSetup();
  if (page === 'logs')      loadLogs();
}

/* ── Dashboard ──────────────────────────────────────────────────────────── */
async function loadDashboard() {
  const data = await api.get('/api/campaign');
  state.campaign = data;
  renderDashboard(data);
}

async function renderDashboard(data) {
  const { stats, active, sentToday, dailyLimit, nextSendIn, daysLeft } = data;

  // Stats
  document.getElementById('stat-total').textContent   = stats.total;
  document.getElementById('stat-sent').textContent    = stats.sent;
  document.getElementById('stat-pending').textContent = stats.pending;
  document.getElementById('stat-failed').textContent  = stats.failed;

  // Progress
  const pct = stats.total > 0 ? Math.round((stats.sent / stats.total) * 100) : 0;
  document.getElementById('progress-fill').style.width = `${pct}%`;
  document.getElementById('progress-pct').textContent  = `${pct}%`;

  // Today
  document.getElementById('sent-today').textContent        = sentToday;
  document.getElementById('daily-limit-display').textContent = dailyLimit;
  document.getElementById('daily-limit-input').value        = dailyLimit;

  // Next send
  const ns = document.getElementById('next-send');
  if (!active) {
    ns.textContent = '— min';
  } else if (nextSendIn === 0) {
    ns.textContent = 'Sending now';
  } else {
    ns.textContent = `${nextSendIn} min`;
  }

  // Days left
  document.getElementById('days-left').textContent = stats.pending > 0 ? `~${Math.max(1, daysLeft)} days` : '—';

  // Badge + button
  const badge = document.getElementById('campaign-badge');
  const btn   = document.getElementById('toggle-btn');

  if (stats.pending === 0 && stats.total > 0) {
    badge.textContent = 'Completed';
    badge.className   = 'badge done';
    btn.innerHTML     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="20 6 9 17 4 12"/></svg> Completed';
    btn.disabled      = true;
  } else if (active) {
    badge.textContent = 'Active';
    badge.className   = 'badge active';
    btn.innerHTML     = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause Campaign';
    btn.className     = 'btn btn-primary btn-lg paused';
    btn.disabled      = false;
  } else {
    badge.textContent = 'Paused';
    badge.className   = 'badge';
    btn.innerHTML     = '<svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Campaign';
    btn.className     = 'btn btn-primary btn-lg';
    btn.disabled      = stats.total === 0;
  }

  // Meta
  const meta = document.getElementById('campaign-meta');
  if (stats.total === 0) {
    meta.textContent = 'No contacts loaded — go to Contacts to upload';
  } else {
    meta.textContent = `${stats.sent} of ${stats.total} messages sent`;
  }

  // Setup warning
  const cfg = await api.get('/api/config').catch(() => ({}));
  const needsSetup = !cfg.phoneNumberId || !cfg.accessToken || !cfg.templateName;
  document.getElementById('setup-warning').style.display = needsSetup ? 'flex' : 'none';
}

/* ── Campaign toggle ────────────────────────────────────────────────────── */
async function toggleCampaign() {
  const current = state.campaign?.active || false;
  const limit   = parseInt(document.getElementById('daily-limit-input').value) || 50;
  await api.post('/api/campaign', { active: !current, dailyLimit: limit });
  toast(!current ? 'Campaign started!' : 'Campaign paused.');
  loadDashboard();
}

function adjustLimit(by) {
  const input = document.getElementById('daily-limit-input');
  input.value = Math.max(1, Math.min(500, parseInt(input.value || 50) + by));
}

/* ── Contacts ────────────────────────────────────────────────────────────── */
async function loadContacts() {
  const campaign = await api.get('/api/campaign');
  const { stats } = campaign;

  // Tab counts
  document.getElementById('tab-all').textContent     = stats.total;
  document.getElementById('tab-pending').textContent = stats.pending;
  document.getElementById('tab-sent').textContent    = stats.sent;
  document.getElementById('tab-failed').textContent  = stats.failed;

  await fetchContactsPage();
}

async function fetchContactsPage() {
  const res  = await api.get(`/api/contacts?status=${state.filter}&page=${state.contactsPage}&limit=20`);
  const tbody = document.getElementById('contacts-tbody');

  if (res.total === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="5"><div class="empty-state">No contacts found.</div></td></tr>';
    document.getElementById('pagination').style.display = 'none';
    return;
  }

  tbody.innerHTML = res.data.map((c, i) => `
    <tr>
      <td>${(state.contactsPage - 1) * 20 + i + 1}</td>
      <td>${c.name || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td style="font-family:monospace">${c.phone}</td>
      <td>${statusBadge(c.status, c.error)}</td>
      <td>${c.sentAt ? formatTime(c.sentAt) : '<span style="color:var(--text-muted)">—</span>'}</td>
    </tr>
  `).join('');

  const pages = res.pages;
  const page  = state.contactsPage;
  const pag   = document.getElementById('pagination');
  pag.style.display = pages > 1 ? 'flex' : 'none';
  document.getElementById('page-info').textContent = `Page ${page} of ${pages}`;
  document.getElementById('prev-btn').disabled     = page <= 1;
  document.getElementById('next-btn').disabled     = page >= pages;
}

function statusBadge(status, error) {
  const labels = { sent: 'Sent', pending: 'Pending', failed: 'Failed' };
  const t = `<span class="status-badge ${status}"><span class="status-dot"></span>${labels[status] || status}</span>`;
  return error ? `${t}<div style="font-size:11px;color:var(--red);margin-top:3px">${error}</div>` : t;
}

function changePage(dir) {
  state.contactsPage += dir;
  fetchContactsPage();
}

function setFilter(f) {
  state.filter = f;
  state.contactsPage = 1;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.filter === f));
  fetchContactsPage();
}

async function clearContacts() {
  if (!confirm('Clear all contacts? This cannot be undone.')) return;
  await api.del('/api/contacts');
  toast('Contacts cleared.');
  loadContacts();
}

async function retryFailed() {
  const res = await api.post('/api/contacts/retry-failed', {});
  toast(`${res.count} failed contacts marked for retry.`);
  loadContacts();
}

async function resetAll() {
  if (!confirm('Reset all contacts to pending? Sent messages will remain delivered.')) return;
  await api.post('/api/contacts/reset-all', {});
  toast('All contacts reset to pending.');
  loadContacts();
}

/* ── File Upload ─────────────────────────────────────────────────────────── */
function setupUpload() {
  const zone  = document.getElementById('dropzone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handleUpload(input.files[0]);
  });
}

async function handleUpload(file) {
  const form = new FormData();
  form.append('file', file);

  const zone = document.getElementById('dropzone');
  zone.style.opacity = '.5';

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form }).then(r => r.json());

    if (!res.ok) {
      toast(res.error || 'Upload failed', 'error');
      return;
    }

    document.getElementById('feedback-title').textContent = `${res.count} contacts loaded`;
    document.getElementById('feedback-sub').textContent   = `Columns detected: ${res.columns.join(', ')}`;
    document.getElementById('upload-feedback').style.display = 'flex';
    toast(`${res.count} contacts uploaded successfully!`);
    state.contactsPage = 1;
    loadContacts();
  } catch {
    toast('Upload failed. Please check your file.', 'error');
  } finally {
    zone.style.opacity = '1';
  }
}

/* ── Campaign Page ───────────────────────────────────────────────────────── */
async function loadCampaignPage() {
  const [cfg, campaign] = await Promise.all([api.get('/api/config'), api.get('/api/campaign')]);

  document.getElementById('campaign-limit').value     = campaign.dailyLimit || 50;
  document.getElementById('campaign-country').value   = cfg.countryCode || '91';
  document.getElementById('campaign-variables').value = cfg.variables || '';

  // Highlight active preset
  document.querySelectorAll('.limit-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === campaign.dailyLimit);
  });

  // Timeline
  const { stats } = campaign;
  const limit = campaign.dailyLimit || 50;
  document.getElementById('tl-total').textContent = stats.total || '—';
  document.getElementById('tl-limit').textContent = limit;
  document.getElementById('tl-days').textContent  = stats.pending > 0 ? `~${Math.ceil(stats.pending / limit)} days` : '—';
  document.getElementById('tl-cost').textContent  = stats.total > 0 ? `₹${(stats.total * 1.09).toFixed(0)}` : '—';
}

async function saveCampaignSettings() {
  const limit   = parseInt(document.getElementById('campaign-limit').value) || 50;
  const country = document.getElementById('campaign-country').value.trim() || '91';
  const vars    = document.getElementById('campaign-variables').value.trim();

  const cfg = await api.get('/api/config');
  await Promise.all([
    api.post('/api/campaign', { dailyLimit: limit }),
    api.post('/api/config', { ...cfg, countryCode: country, variables: vars }),
  ]);
  toast('Campaign settings saved!');
  loadCampaignPage();
}

function setLimitPreset(val) {
  document.getElementById('campaign-limit').value = val;
  document.querySelectorAll('.limit-preset').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.textContent) === val);
  });
}

/* ── Setup ───────────────────────────────────────────────────────────────── */
async function loadSetup() {
  const cfg = await api.get('/api/config');
  document.getElementById('cfg-phone-id').value  = cfg.phoneNumberId || '';
  document.getElementById('cfg-token').value     = cfg.accessToken || '';
  document.getElementById('cfg-template').value  = cfg.templateName || '';
  document.getElementById('cfg-lang').value      = cfg.templateLang || 'en_US';
  document.getElementById('cfg-country').value   = cfg.countryCode || '91';
}

async function saveConfig() {
  const data = {
    phoneNumberId: document.getElementById('cfg-phone-id').value.trim(),
    accessToken:   document.getElementById('cfg-token').value.trim(),
    templateName:  document.getElementById('cfg-template').value.trim(),
    templateLang:  document.getElementById('cfg-lang').value,
    countryCode:   document.getElementById('cfg-country').value.trim() || '91',
  };

  if (!data.phoneNumberId || !data.accessToken || !data.templateName) {
    toast('Please fill in all required fields.', 'error');
    return;
  }

  await api.post('/api/config', data);
  toast('Credentials saved!');
}

async function testConnection() {
  const btn = document.getElementById('test-btn');
  const res = document.getElementById('test-result');
  btn.textContent = 'Testing…';
  btn.disabled    = true;

  const data = await api.get('/api/test-connection');

  if (data.ok) {
    res.className   = 'test-result success';
    res.innerHTML   = `Connected! Phone: <strong>${data.phone}</strong> (${data.name})`;
    res.style.display = 'block';
    toast('Connection successful!');
  } else {
    res.className   = 'test-result error';
    res.textContent = `Error: ${data.error}`;
    res.style.display = 'block';
    toast('Connection failed. Check your credentials.', 'error');
  }

  btn.textContent = 'Test Connection';
  btn.disabled    = false;
}

function toggleTokenVisibility() {
  const input = document.getElementById('cfg-token');
  const btn   = input.nextElementSibling;
  if (input.type === 'password') { input.type = 'text';     btn.textContent = 'Hide'; }
  else                           { input.type = 'password'; btn.textContent = 'Show'; }
}

function toggleAccordion() {
  const body  = document.getElementById('accordion-body');
  const arrow = document.getElementById('accordion-arrow');
  const open  = body.style.display === 'none';
  body.style.display  = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(180deg)' : '';
}

/* ── Logs ────────────────────────────────────────────────────────────────── */
async function loadLogs() {
  const logs = await api.get('/api/logs');
  const el   = document.getElementById('logs-list');

  if (!logs.length) {
    el.innerHTML = '<div class="empty-state">No activity yet. Start your campaign to see logs here.</div>';
    return;
  }

  el.innerHTML = logs.map(log => `
    <div class="log-item">
      <div class="log-icon ${log.status}">
        ${log.status === 'sent'
          ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
        }
      </div>
      <div class="log-body">
        <div class="log-name">${log.name || 'Unknown'}</div>
        <div class="log-phone">${log.phone}</div>
        ${log.error ? `<div class="log-error">${log.error}</div>` : ''}
      </div>
      <div class="log-time">${formatTime(log.time)}</div>
    </div>
  `).join('');
}

async function clearLogs() {
  await api.del('/api/logs');
  toast('Logs cleared.');
  loadLogs();
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/* ── Polling ─────────────────────────────────────────────────────────────── */
function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => {
    if (state.page === 'dashboard') loadDashboard();
    if (state.page === 'logs'     ) loadLogs();
  }, 5000);
}

/* ── Init ────────────────────────────────────────────────────────────────── */
function init() {
  // Nav clicks
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.page));
  });

  // Filter tabs
  document.getElementById('filter-tabs').addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (tab) setFilter(tab.dataset.filter);
  });

  setupUpload();
  loadDashboard();
  startPolling();
}

document.addEventListener('DOMContentLoaded', init);
