const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ mailboxes: [], messages: [] }, null, 2));
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function cleanupExpired() {
  const db = readDb();
  const now = Date.now();
  const activeMailboxes = db.mailboxes.filter((m) => new Date(m.expiresAt).getTime() > now);
  const activeIds = new Set(activeMailboxes.map((m) => m.id));
  const activeMessages = db.messages.filter((msg) => activeIds.has(msg.mailboxId));
  if (activeMailboxes.length !== db.mailboxes.length || activeMessages.length !== db.messages.length) {
    writeDb({ mailboxes: activeMailboxes, messages: activeMessages });
  }
  return { mailboxes: activeMailboxes, messages: activeMessages };
}

function listMailboxes() {
  return cleanupExpired().mailboxes.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getMailbox(id) {
  return cleanupExpired().mailboxes.find((m) => m.id === id) || null;
}

function addMailbox(mailbox) {
  const db = cleanupExpired();
  db.mailboxes.push(mailbox);
  writeDb(db);
  return mailbox;
}

function deleteMailbox(id) {
  const db = cleanupExpired();
  db.mailboxes = db.mailboxes.filter((m) => m.id !== id);
  db.messages = db.messages.filter((msg) => msg.mailboxId !== id);
  writeDb(db);
}

function listMessages(mailboxId) {
  return cleanupExpired().messages
    .filter((msg) => msg.mailboxId === mailboxId)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

function getMessage(id) {
  return cleanupExpired().messages.find((msg) => msg.id === id) || null;
}

function updateMessage(id, patch) {
  const db = cleanupExpired();
  const index = db.messages.findIndex((msg) => msg.id === id);
  if (index === -1) return null;
  db.messages[index] = { ...db.messages[index], ...patch };
  writeDb(db);
  return db.messages[index];
}

function addMessage(message) {
  const db = cleanupExpired();
  db.messages.push(message);
  writeDb(db);
  return message;
}

module.exports = {
  listMailboxes,
  getMailbox,
  addMailbox,
  deleteMailbox,
  listMessages,
  getMessage,
  updateMessage,
  addMessage,
  cleanupExpired
};
