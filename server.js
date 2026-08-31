const path = require('node:path');
require('dotenv').config();
const http = require('node:http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const store = require('./lib/store');
const { createMailTmMailbox, syncMailbox, markMessageRead, deleteRemoteMailbox, getDomains } = require('./lib/provider');

const PORT = Number(process.env.PORT || 3000);
const TTL_DAYS = Number(process.env.TTL_DAYS || 30);
const VERIFY_SECONDS = Number(process.env.VERIFY_SECONDS || 180);
const AUTO_REFRESH_SECONDS = Math.max(5, Number(process.env.AUTO_REFRESH_SECONDS || 5));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

app.use(cors());
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function summary(mailbox) {
  const messages = store.listMessages(mailbox.id);
  return {
    id: mailbox.id,
    provider: mailbox.provider,
    providerAccountId: mailbox.providerAccountId,
    address: mailbox.address,
    prefix: mailbox.prefix,
    createdAt: mailbox.createdAt,
    expiresAt: mailbox.expiresAt,
    unread: messages.filter((m) => !m.read).length,
    messageCount: messages.length,
    latestAt: messages[0]?.receivedAt || null
  };
}

app.get('/api/config', (req, res) => {
  res.json({
    provider: 'mail.tm',
    providerDocs: 'https://docs.mail.tm/',
    ttlDays: TTL_DAYS,
    verifySeconds: VERIFY_SECONDS,
    autoRefreshSeconds: AUTO_REFRESH_SECONDS,
    attribution: 'Powered by Mail.tm'
  });
});

app.get('/api/mailtm/status', async (req, res) => {
  try {
    const domains = await getDomains();
    res.json({ ok: true, domainCount: domains.length, domains: domains.slice(0, 12).map(d => d.domain), api: process.env.MAILTM_API_URL || 'https://api.mail.tm' });
  } catch (error) {
    res.status(error.status || 502).json({ ok: false, error: error.message, status: error.status || 502 });
  }
});

app.get('/api/domains', async (req, res) => {
  try {
    const domains = await getDomains();
    res.json(domains.map(d => d.domain));
  } catch (error) {
    res.status(error.status || 502).json({ error: `Mail.tm: ${error.message}` });
  }
});

app.get('/api/mailboxes', (req, res) => res.json(store.listMailboxes().map(summary)));

app.post('/api/mailboxes', async (req, res) => {
  try {
    const mailbox = await createMailTmMailbox({ ttlDays: TTL_DAYS });
    store.addMailbox(mailbox);
    io.emit('mailboxes:changed');
    res.status(201).json(summary(mailbox));
  } catch (error) {
    console.error('Mailbox creation failed:', error);
    res.status(error.status || 502).json({ error: `Mail.tm: ${error.message}`, status: error.status || 502 });
  }
});

app.get('/api/mailboxes/:id', (req, res) => {
  const mailbox = store.getMailbox(req.params.id);
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
  res.json(summary(mailbox));
});

app.get('/api/mailboxes/:id/messages', (req, res) => {
  const mailbox = store.getMailbox(req.params.id);
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
  res.json(store.listMessages(mailbox.id));
});

app.post('/api/mailboxes/:id/sync', async (req, res) => {
  const mailbox = store.getMailbox(req.params.id);
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
  try {
    const fresh = await syncMailbox(mailbox);
    io.to(`mailbox:${mailbox.id}`).emit('mailbox:synced', { count: fresh.length });
    if (fresh.length) for (const message of fresh) io.to(`mailbox:${mailbox.id}`).emit('message:new', message);
    io.emit('mailboxes:changed');
    res.json({ added: fresh.length, messages: store.listMessages(mailbox.id) });
  } catch (error) {
    console.error('Sync failed:', error);
    res.status(error.status || 502).json({ error: `Mail.tm: ${error.message}`, status: error.status || 502 });
  }
});

app.delete('/api/mailboxes/:id', async (req, res) => {
  const mailbox = store.getMailbox(req.params.id);
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
  try { await deleteRemoteMailbox(mailbox); } catch (error) { console.error('Remote delete failed:', error.message); }
  store.deleteMailbox(req.params.id);
  io.emit('mailboxes:changed');
  res.status(204).end();
});

app.post('/api/messages/:id/read', async (req, res) => {
  const message = store.getMessage(req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  const mailbox = store.getMailbox(message.mailboxId);
  if (!mailbox) return res.status(404).json({ error: 'Mailbox not found' });
  try {
    await markMessageRead(mailbox, message.providerMessageId || message.id);
    store.updateMessage(message.id, { read: true });
    res.json({ ok: true, messageId: message.id });
  } catch (error) {
    res.status(error.status || 502).json({ error: `Mail.tm: ${error.message}` });
  }
});

io.on('connection', (socket) => {
  socket.on('mailbox:join', (mailboxId) => {
    if (typeof mailboxId === 'string') socket.join(`mailbox:${mailboxId}`);
  });
});

let syncing = false;
setInterval(async () => {
  if (syncing) return;
  syncing = true;
  try {
    const mailboxes = store.listMailboxes();
    for (const mailbox of mailboxes) {
      try {
        const fresh = await syncMailbox(mailbox);
        if (fresh.length) {
          for (const message of fresh) io.to(`mailbox:${mailbox.id}`).emit('message:new', message);
          io.emit('mailboxes:changed');
        }
      } catch (error) {
        console.error(`Sync ${mailbox.address}:`, error.message);
      }
    }
    store.cleanupExpired();
  } finally {
    syncing = false;
  }
}, AUTO_REFRESH_SECONDS * 1000);

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pulse Inbox PRO v5 + Mail.tm running at http://localhost:${PORT}`);
  console.log(`Auto refresh: ${AUTO_REFRESH_SECONDS}s | TTL: ${TTL_DAYS}d | Verify: ${VERIFY_SECONDS}s`);
});
