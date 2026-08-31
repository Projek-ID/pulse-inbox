const crypto = require('node:crypto');
const { addMessage, listMessages } = require('./store');
const { extractOtp, extractLinks, makePreview, htmlToText } = require('./parser');

const BASE_URL = (process.env.MAILTM_API_URL || 'https://api.mail.tm').replace(/\/$/, '');
const USER_AGENT = process.env.MAILTM_USER_AGENT || 'PULSE-INBOX-PRO/5.0';
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.MAILTM_REQUEST_TIMEOUT_MS || 15000));
const MAX_RETRIES = Math.max(1, Number(process.env.MAILTM_MAX_RETRIES || 3));
const MAX_MESSAGES_PER_SYNC = Math.min(30, Math.max(1, Number(process.env.MAILTM_MAX_MESSAGES_PER_SYNC || 30)));

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function mailtm(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  let lastError;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = {
        Accept: 'application/json, application/ld+json;q=0.9',
        'User-Agent': USER_AGENT,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      };
      const response = await fetch(url, { ...options, headers, signal: controller.signal });
      clearTimeout(timer);
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

      if (response.ok) return data;

      const message = data?.message || data?.detail || data?.['hydra:description'] || `Mail.tm HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === MAX_RETRIES - 1) throw error;
      lastError = error;
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * (attempt + 1));
    } catch (error) {
      clearTimeout(timer);
      lastError = error.name === 'AbortError' ? new Error(`Mail.tm timeout setelah ${REQUEST_TIMEOUT_MS}ms`) : error;
      if (attempt === MAX_RETRIES - 1) throw lastError;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastError || new Error('Mail.tm request failed');
}

function randomPassword() {
  return `P${crypto.randomBytes(18).toString('base64url')}Aa9!`;
}
function randomId(bytes = 8) { return crypto.randomBytes(bytes).toString('hex'); }

function membersFromCollection(data) {
  if (Array.isArray(data?.['hydra:member'])) return data['hydra:member'];
  if (Array.isArray(data?.member)) return data.member;
  if (Array.isArray(data)) return data;
  return [];
}

function isUsableDomain(domain) {
  return Boolean(domain?.domain) && domain.isPrivate !== true && domain.isActive !== false;
}

async function getDomains() {
  // IMPORTANT: Mail.tm currently returns the canonical collection at /domains.
  // Read this endpoint first instead of assuming /domains?page=1 has the same shape.
  const first = await mailtm('/domains');
  const collected = [...membersFromCollection(first)];
  const total = Number(first?.['hydra:totalItems'] || collected.length || 0);
  const next = first?.['hydra:view']?.['hydra:next'];

  // Follow explicit Hydra next links when present, capped to avoid loops.
  const seenUrls = new Set([`${BASE_URL}/domains`]);
  let nextUrl = typeof next === 'string' ? next : null;
  let guard = 0;
  while (nextUrl && guard++ < 10 && collected.length < total && !seenUrls.has(nextUrl)) {
    seenUrls.add(nextUrl);
    const relative = nextUrl.startsWith(BASE_URL) ? nextUrl.slice(BASE_URL.length) : nextUrl;
    const page = await mailtm(relative.startsWith('/') ? relative : `/domains?page=${guard + 1}`);
    collected.push(...membersFromCollection(page));
    nextUrl = page?.['hydra:view']?.['hydra:next'] || null;
  }

  // De-duplicate by domain name and only return domains usable for account creation.
  const map = new Map();
  for (const d of collected) if (isUsableDomain(d)) map.set(d.domain, d);
  return [...map.values()];
}

async function createMailTmMailbox({ ttlDays }) {
  const domains = await getDomains();
  if (!domains.length) {
    const error = new Error('Mail.tm tidak mengembalikan domain aktif yang dapat digunakan. Coba `npm run check:mailtm`.');
    error.status = 503;
    throw error;
  }

  const domain = domains[Math.floor(Math.random() * domains.length)].domain;
  const username = `pulse${randomId(7)}`.toLowerCase();
  const password = randomPassword();
  const address = `${username}@${domain}`;

  const account = await mailtm('/accounts', {
    method: 'POST',
    body: JSON.stringify({ address, password })
  });
  const tokenData = await mailtm('/token', {
    method: 'POST',
    body: JSON.stringify({ address, password })
  });

  if (!tokenData?.token || !account?.id) {
    throw new Error('Mail.tm tidak mengembalikan account id/token yang valid.');
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + Number(ttlDays || 30) * 86400000);
  return {
    id: randomId(9),
    provider: 'mail.tm',
    providerAccountId: account.id,
    address,
    prefix: username,
    domain,
    password,
    token: tokenData.token,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString()
  };
}

async function fetchMessageDetail(mailbox, messageId) {
  return mailtm(`/messages/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${mailbox.token}` }
  });
}

function normalizeMessage(mailbox, raw) {
  const html = Array.isArray(raw.html) ? raw.html.join('\n') : (raw.html || '');
  const text = raw.text || htmlToText(html);
  const combined = `${raw.subject || ''}\n${raw.intro || ''}\n${text}\n${html}`;
  return {
    id: raw.id,
    mailboxId: mailbox.id,
    providerMessageId: raw.id,
    from: raw.from?.address ? (raw.from.name ? `${raw.from.name} <${raw.from.address}>` : raw.from.address) : 'unknown',
    to: raw.to?.map(x => x.address).join(', ') || mailbox.address,
    subject: raw.subject || '(no subject)',
    text,
    html,
    preview: makePreview(raw.intro || text),
    otp: extractOtp(combined),
    links: extractLinks(combined),
    receivedAt: raw.createdAt || new Date().toISOString(),
    read: Boolean(raw.seen),
    hasAttachments: Boolean(raw.hasAttachments),
    attachments: raw.attachments || []
  };
}

async function syncMailbox(mailbox) {
  if (!mailbox?.token) throw new Error('Mailbox token tidak tersedia.');
  const data = await mailtm('/messages?page=1', {
    headers: { Authorization: `Bearer ${mailbox.token}` }
  });
  const summaries = membersFromCollection(data).slice(0, MAX_MESSAGES_PER_SYNC);
  const existingIds = new Set(listMessages(mailbox.id).map(m => m.providerMessageId || m.id));
  const fresh = [];

  for (const item of summaries) {
    if (!item?.id || existingIds.has(item.id)) continue;
    try {
      const detail = await fetchMessageDetail(mailbox, item.id);
      const message = normalizeMessage(mailbox, detail);
      addMessage(message);
      fresh.push(message);
    } catch (error) {
      console.error(`Mail.tm message ${item.id} failed:`, error.message);
    }
  }
  return fresh;
}

async function markMessageRead(mailbox, messageId) {
  return mailtm(`/messages/${encodeURIComponent(messageId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${mailbox.token}` }
  });
}

async function deleteRemoteMailbox(mailbox) {
  if (!mailbox?.token || !mailbox.providerAccountId) return;
  try {
    await mailtm(`/accounts/${encodeURIComponent(mailbox.providerAccountId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${mailbox.token}` }
    });
  } catch (error) {
    if (error.status !== 404 && error.status !== 401) throw error;
  }
}

module.exports = { createMailTmMailbox, syncMailbox, markMessageRead, deleteRemoteMailbox, getDomains };
