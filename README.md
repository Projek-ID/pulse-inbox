# PULSE INBOX PRO v5 — Mail.tm

UI full-screen black/purple dengan bottom navigation GENERATOR / INBOX / AKUN. Backend Node.js menggunakan Mail.tm REST API untuk membuat mailbox, mengambil token, membaca inbox, detail email, menandai pesan terbaca, dan menghapus account.

## Yang diperbaiki di v5

- Resolver domain membaca `GET /domains` canonical collection terlebih dahulu.
- Memproses `hydra:member` secara langsung.
- Mengikuti `hydra:view.hydra:next` bila tersedia.
- Tidak menganggap `/domains?page=1` sebagai satu-satunya sumber.
- Filter domain: harus punya `domain`, tidak private, dan tidak inactive.
- Retry + timeout untuk 408/429/5xx.
- OTP parser: 4–8 digit, format spasi/dash, serta label verification/login/passcode.
- Raw-link parser membaca URL biasa dan `href="https://..."` pada HTML.
- Auto-refresh inbox.
- Custom SVG icons dan ripple click animation.
- Spec yang Anda berikan disimpan di `docs/mailtm-spec.jsonld`.
- `nanoid` tidak digunakan; ID dibuat dengan Node `crypto` agar aman di Termux.

## Termux

Jalankan dari home Termux, bukan `/storage/emulated/0/Download`:

```bash
cd ~
unzip ~/storage/downloads/pulse-inbox-node-mailtm-v5.zip
cd pulse-inbox-v5
npm install
npm run check:mailtm
npm start
```

Buka `http://127.0.0.1:3000`.

Jika check menampilkan:

```text
Mail.tm API OK — usable domains: 1
- emalupe.com | active=true | private=false
```

maka generator sudah menemukan domain aktif.

## Alur Mail.tm

```text
GET /domains
  -> pilih domain aktif
POST /accounts
  -> create mailbox
POST /token
  -> bearer token
GET /messages
  -> list inbox
GET /messages/{id}
  -> email detail
PATCH /messages/{id}
  -> mark read
DELETE /accounts/{id}
  -> delete room
```

Mail.tm mendokumentasikan REST API ini dan batas umum 8 QPS per IP. Attribution ke Mail.tm wajib ditampilkan jika API digunakan; UI project sudah menampilkan credit/link Mail.tm. Jangan gunakan untuk aktivitas ilegal, proxy/mirror API, atau layanan berbayar yang sekadar membungkus Mail.tm.

## Catatan TTL

`TTL 30 DAYS` adalah lifetime room yang disimpan oleh aplikasi lokal. Masa hidup account di provider tetap mengikuti kebijakan Mail.tm.

## Troubleshooting

Jika `npm run check:mailtm` menunjukkan 0:

```bash
curl -s https://api.mail.tm/domains
```

Jika curl menampilkan `hydra:member` dengan domain aktif, versi v5 membaca format tersebut secara langsung.
