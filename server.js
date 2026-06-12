const express = require('express');
const multer  = require('multer');
const xlsx    = require('xlsx');
const cron    = require('node-cron');
const fs      = require('fs');
const axios   = require('axios');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ── Data directory ─────────────────────────────────────────────────────────
const DATA = './data';
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA);

const FILE = {
  config:   `${DATA}/config.json`,
  contacts: `${DATA}/contacts.json`,
  campaign: `${DATA}/campaign.json`,
  logs:     `${DATA}/logs.json`,
};

const DEFAULT_CAMPAIGN = {
  active: false, dailyLimit: 50, sentToday: 0,
  lastReset: null, lastSentAt: null,
};

function read(f, d)   { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
function save(f, d)   { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Config ─────────────────────────────────────────────────────────────────
app.get('/api/config', (_, res) => res.json(read(FILE.config, {})));

app.post('/api/config', (req, res) => {
  save(FILE.config, req.body);
  res.json({ ok: true });
});

app.get('/api/test-connection', async (_, res) => {
  const cfg = read(FILE.config, {});
  if (!cfg.phoneNumberId || !cfg.accessToken) {
    return res.json({ ok: false, error: 'Phone Number ID and Access Token are required.' });
  }
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v18.0/${cfg.phoneNumberId}`,
      { params: { fields: 'display_phone_number,verified_name', access_token: cfg.accessToken } }
    );
    res.json({ ok: true, phone: data.display_phone_number, name: data.verified_name });
  } catch (e) {
    res.json({ ok: false, error: e.response?.data?.error?.message || e.message });
  }
});

// ── Contacts ───────────────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

const PHONE_KEYS = ['phone', 'phonenumber', 'phone number', 'mobile', 'number', 'whatsapp', 'contact'];
const NAME_KEYS  = ['name', 'fullname', 'full name', 'contact name', 'customer name'];

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const wb   = xlsx.read(req.file.buffer);
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (!rows.length) return res.status(400).json({ error: 'File is empty' });

  const cols     = Object.keys(rows[0]);
  const phoneCol = cols.find(k => PHONE_KEYS.includes(k.toLowerCase().trim()));
  const nameCol  = cols.find(k => NAME_KEYS.includes(k.toLowerCase().trim()));

  if (!phoneCol) {
    return res.status(400).json({ error: `No phone column found. Expected one of: ${PHONE_KEYS.join(', ')}` });
  }

  const cfg         = read(FILE.config, {});
  const countryCode = cfg.countryCode || '91';

  const contacts = rows.map((row, i) => {
    const rawPhone = String(row[phoneCol] || '').replace(/[\s\-\+\(\)\.]/g, '');
    if (!rawPhone || !/^\d{7,15}$/.test(rawPhone)) return null;

    const phone = rawPhone.length === 10 ? `${countryCode}${rawPhone}` : rawPhone;

    return {
      id:     i + 1,
      name:   nameCol ? String(row[nameCol] || '').trim() : '',
      phone,
      data:   row,
      status: 'pending',
      sentAt: null,
      error:  null,
    };
  }).filter(Boolean);

  save(FILE.contacts, contacts);
  res.json({ ok: true, count: contacts.length, columns: cols });
});

app.get('/api/contacts', (req, res) => {
  let list = read(FILE.contacts, []);

  if (req.query.status && req.query.status !== 'all') {
    list = list.filter(c => c.status === req.query.status);
  }

  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = parseInt(req.query.limit) || 20;
  const total = list.length;
  const data  = list.slice((page - 1) * limit, page * limit);

  res.json({ total, page, limit, pages: Math.ceil(total / limit), data });
});

app.delete('/api/contacts', (_, res) => {
  save(FILE.contacts, []);
  save(FILE.campaign, DEFAULT_CAMPAIGN);
  res.json({ ok: true });
});

app.post('/api/contacts/retry-failed', (_, res) => {
  const contacts = read(FILE.contacts, []);
  let count = 0;
  contacts.forEach(c => {
    if (c.status === 'failed') { c.status = 'pending'; c.error = null; count++; }
  });
  save(FILE.contacts, contacts);
  res.json({ ok: true, count });
});

app.post('/api/contacts/reset-all', (_, res) => {
  const contacts = read(FILE.contacts, []);
  contacts.forEach(c => { c.status = 'pending'; c.error = null; c.sentAt = null; });
  save(FILE.contacts, contacts);
  const c = read(FILE.campaign, DEFAULT_CAMPAIGN);
  c.sentToday = 0; c.lastSentAt = null;
  save(FILE.campaign, c);
  res.json({ ok: true });
});

// ── Campaign ───────────────────────────────────────────────────────────────
app.get('/api/campaign', (_, res) => {
  const c        = read(FILE.campaign, DEFAULT_CAMPAIGN);
  const contacts = read(FILE.contacts, []);

  const stats = {
    total:   contacts.length,
    sent:    contacts.filter(x => x.status === 'sent').length,
    pending: contacts.filter(x => x.status === 'pending').length,
    failed:  contacts.filter(x => x.status === 'failed').length,
  };

  const minutesBetween = c.dailyLimit > 0 ? 1440 / c.dailyLimit : 1440;
  const elapsedMin     = c.lastSentAt ? (Date.now() - c.lastSentAt) / 60000 : minutesBetween;
  const nextSendIn     = Math.max(0, Math.ceil(minutesBetween - elapsedMin));

  const daysLeft = stats.pending > 0
    ? Math.ceil((stats.pending - (c.dailyLimit - c.sentToday)) / c.dailyLimit) + (c.sentToday < c.dailyLimit ? 0 : 1)
    : 0;

  res.json({ ...c, stats, nextSendIn, daysLeft });
});

app.post('/api/campaign', (req, res) => {
  const c = { ...read(FILE.campaign, DEFAULT_CAMPAIGN), ...req.body };
  save(FILE.campaign, c);
  res.json({ ok: true, campaign: c });
});

// ── Logs ───────────────────────────────────────────────────────────────────
app.get('/api/logs', (_, res) => res.json(read(FILE.logs, [])));

app.delete('/api/logs', (_, res) => {
  save(FILE.logs, []);
  res.json({ ok: true });
});

// ── WhatsApp Send ──────────────────────────────────────────────────────────
async function sendWA(cfg, contact) {
  const variables = (cfg.variables || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  const components = [];
  if (variables.length > 0) {
    const params = variables.map(col => ({
      type: 'text',
      text: String(contact.data?.[col] || contact.name || contact.phone),
    }));
    components.push({ type: 'body', parameters: params });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to:   contact.phone,
    type: 'template',
    template: {
      name:     cfg.templateName,
      language: { code: cfg.templateLang || 'en_US' },
      ...(components.length && { components }),
    },
  };

  const { data } = await axios.post(
    `https://graph.facebook.com/v18.0/${cfg.phoneNumberId}/messages`,
    payload,
    { headers: { Authorization: `Bearer ${cfg.accessToken}` } }
  );
  return data;
}

// ── Cron: one message per interval, spread evenly across the day ───────────
cron.schedule('* * * * *', async () => {
  const campaign = read(FILE.campaign, DEFAULT_CAMPAIGN);
  if (!campaign.active) return;

  const today = new Date().toDateString();
  if (campaign.lastReset !== today) {
    campaign.sentToday = 0;
    campaign.lastReset = today;
  }

  if (campaign.sentToday >= campaign.dailyLimit) return;

  const minutesBetween = 1440 / campaign.dailyLimit;
  if (campaign.lastSentAt && (Date.now() - campaign.lastSentAt) < minutesBetween * 60 * 1000) return;

  const cfg = read(FILE.config, {});
  if (!cfg.phoneNumberId || !cfg.accessToken || !cfg.templateName) return;

  const contacts = read(FILE.contacts, []);
  const contact  = contacts.find(c => c.status === 'pending');

  if (!contact) {
    campaign.active = false;
    save(FILE.campaign, campaign);
    return;
  }

  const logs = read(FILE.logs, []);

  try {
    await sendWA(cfg, contact);
    contact.status = 'sent';
    contact.sentAt = new Date().toISOString();
    logs.unshift({
      id: Date.now(), name: contact.name, phone: contact.phone,
      status: 'sent', time: contact.sentAt,
    });
  } catch (err) {
    contact.status = 'failed';
    contact.error  = err.response?.data?.error?.message || err.message;
    logs.unshift({
      id: Date.now(), name: contact.name, phone: contact.phone,
      status: 'failed', error: contact.error, time: new Date().toISOString(),
    });
  }

  campaign.sentToday++;
  campaign.lastSentAt = Date.now();

  save(FILE.contacts, contacts);
  save(FILE.campaign,  campaign);
  save(FILE.logs,      logs.slice(0, 500));
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(3000, () => {
  console.log('');
  console.log('  WhatsApp Bulk Sender running at http://localhost:3000');
  console.log('');
});
