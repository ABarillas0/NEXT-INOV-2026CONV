// Convivio ALMO 2026 — Registro + Rifa en vivo (Gotcha & Go-Karts)
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

let PORT = Number(process.env.PORT) || 3000;
let HTTPS_PORT = Number(process.env.HTTPS_PORT) || 3443;
const ADMIN_PIN = process.env.ADMIN_PIN || '2026';
const SQUAD_SIZE = 5;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PHOTO_DIR = path.join(DATA_DIR, 'photos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(PHOTO_DIR, { recursive: true });

const SQUAD_NAMES = [
  ['Alpha', '#39ff14'], ['Viper', '#ff3b30'], ['Nitro', '#ff9500'], ['Apex', '#00d4ff'],
  ['Titan', '#bf5af2'], ['Blaze', '#ff2d55'], ['Turbo', '#ffd60a'], ['Ghost', '#e5e5ea'],
  ['Raptor', '#30d158'], ['Storm', '#64d2ff'], ['Cobra', '#ff6b00'], ['Phantom', '#8e8eff'],
  ['Venom', '#a3ff00'], ['Thunder', '#ffcc00'], ['Shadow', '#9a9aa5'], ['Rocket', '#ff453a'],
  ['Drift', '#5ac8fa'], ['Bullet', '#ff9f0a'], ['Fury', '#ff375f'], ['Piston', '#32d74b'],
];

// ---------- Persistencia ----------
function freshDb() {
  return { config: { expected: 50, gifts: 10 }, players: [], squads: [], winners: [], nextNumber: 1 };
}
let db = freshDb();
try { db = { ...freshDb(), ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
db.config = { ...freshDb().config, ...db.config };
for (const p of db.players) if (typeof p.points !== 'number') p.points = p.tickets; // migración
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), () => {}), 150);
}

// ---------- Escuadrones ----------
function makeSquad(i) {
  const [name, color] = SQUAD_NAMES[i % SQUAD_NAMES.length];
  const suffix = i >= SQUAD_NAMES.length ? ` ${Math.floor(i / SQUAD_NAMES.length) + 1}` : '';
  return { id: i + 1, name: name + suffix, color };
}
function ensureBaseSquads() {
  const base = Math.max(1, Math.ceil(db.config.expected / SQUAD_SIZE));
  while (db.squads.length < base) db.squads.push(makeSquad(db.squads.length));
}
function squadCount(id) { return db.players.filter(p => p.squad === id).length; }
// Orden de llegada: se llena el primer escuadrón con lugar (Alpha, luego Viper…),
// así el primer grupo de 5 puede empezar a jugar sin esperar a los demás.
function assignSquad() {
  ensureBaseSquads();
  const open = db.squads.find(s => squadCount(s.id) < SQUAD_SIZE);
  if (open) return open.id;
  const s = makeSquad(db.squads.length); db.squads.push(s); return s.id;
}

// ---------- Helpers ----------
// Número correlativo + nombre para identificar rápido: "1 · Alpha"
const sqPub = s => s && ({ ...s, num: s.id, name: `${s.id} · ${s.name}` });
const uid = () => crypto.randomBytes(8).toString('hex');
const pub = p => p && ({ id: p.id, number: p.number, nick: p.nick, photo: p.photo, squad: p.squad, tickets: p.tickets, points: p.points, manual: !!p.manual });
function snapshot() {
  return {
    players: db.players.map(pub),
    squads: db.squads.map(sqPub),
    winners: db.winners,
    config: { gifts: db.config.gifts },
    live: liveState(),
    online: onlineCount(),
    now: Date.now(),
  };
}
function broadcast() { io.emit('state', snapshot()); }
function savePhoto(id, dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 3 * 1024 * 1024) return null;
  const file = `${id}.jpg`;
  fs.writeFileSync(path.join(PHOTO_DIR, file), buf);
  return `/photos/${file}?v=${Date.now()}`;
}
function createPlayer({ nick, photo, kiosk = false, manual = false, tickets = 1 }) {
  const id = uid();
  const p = {
    id, token: uid() + uid(), number: db.nextNumber++, nick: String(nick).trim().slice(0, 20),
    photo: null, squad: assignSquad(), tickets: Math.max(1, Number(tickets) || 1), points: Math.max(1, Number(tickets) || 1),
    kiosk, manual, createdAt: Date.now(),
  };
  if (photo) p.photo = savePhoto(id, photo);
  db.players.push(p);
  save();
  return p;
}

// ---------- App ----------
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });

// HTTPS local con certificado propio: los navegadores solo permiten la cámara en vivo
// en https:// o en localhost. Así funciona también en laptops/Mac que entran por la IP.
function loadCert() {
  const file = path.join(DATA_DIR, 'cert.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const selfsigned = require('selfsigned');
  const ips = ['127.0.0.1', ...lanIps()];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'convivio.local' }], {
    days: 365, keySize: 2048, algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))] }],
  });
  const cert = { key: pems.private, cert: pems.cert, ips };
  fs.writeFileSync(file, JSON.stringify(cert));
  return cert;
}
let httpsServer = null;
// Detrás de nginx (que ya da HTTPS real) se apaga con DISABLE_HTTPS=1.
if (process.env.DISABLE_HTTPS !== '1') try {
  let cert = loadCert();
  if (lanIps().some(ip => !cert.ips.includes(ip))) { fs.unlinkSync(path.join(DATA_DIR, 'cert.json')); cert = loadCert(); }
  httpsServer = https.createServer({ key: cert.key, cert: cert.cert }, app);
  io.attach(httpsServer);
} catch (e) { console.warn('No se pudo iniciar HTTPS:', e.message); }

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
app.use('/photos', express.static(PHOTO_DIR, { maxAge: '1d' }));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/arena', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const requirePin = (req, res, next) =>
  (req.get('x-pin') || req.body?.pin) === ADMIN_PIN ? next() : res.status(401).json({ error: 'PIN incorrecto' });

function myPlayer(req) {
  const t = req.get('x-token') || req.cookies.cv_token;
  return t ? db.players.find(p => p.token === t) : null;
}
function teamOf(p) {
  return db.players.filter(x => x.squad === p.squad).map(pub);
}

app.get('/api/me', (req, res) => {
  const p = myPlayer(req);
  if (!p) return res.status(404).json({ error: 'no registrado' });
  res.json({ player: pub(p), token: p.token, squad: sqPub(db.squads.find(s => s.id === p.squad)), team: teamOf(p) });
});

app.post('/api/register', (req, res) => {
  const { nick, photo, kiosk, pin } = req.body || {};
  if (!nick || !String(nick).trim()) return res.status(400).json({ error: 'Falta tu apodo' });
  const isKiosk = !!kiosk;
  if (isKiosk && pin !== ADMIN_PIN) return res.status(401).json({ error: 'PIN de kiosko incorrecto' });
  if (!isKiosk) {
    const existing = myPlayer(req);
    if (existing) return res.json({ player: pub(existing), token: existing.token, squad: sqPub(db.squads.find(s => s.id === existing.squad)), team: teamOf(existing), existing: true });
  }
  const p = createPlayer({ nick, photo, kiosk: isKiosk });
  if (!isKiosk) res.cookie('cv_token', p.token, { maxAge: 1000 * 60 * 60 * 24 * 30, httpOnly: true, sameSite: 'lax' });
  broadcast();
  io.emit('new-player', pub(p));
  res.json({ player: pub(p), token: isKiosk ? null : p.token, squad: sqPub(db.squads.find(s => s.id === p.squad)), team: teamOf(p) });
});

app.get('/api/state', (_, res) => res.json(snapshot()));
app.get('/api/info', (_, res) => res.json({ httpsPort: httpsServer ? HTTPS_PORT : null }));

// ----- Admin -----
app.post('/api/admin/login', requirePin, (_, res) => res.json({ ok: true }));
app.post('/api/admin/player', requirePin, (req, res) => {
  const { nick, tickets } = req.body;
  if (!nick) return res.status(400).json({ error: 'Falta nombre' });
  const p = createPlayer({ nick, manual: true, tickets });
  broadcast();
  res.json({ player: pub(p) });
});
app.post('/api/admin/tickets', requirePin, (req, res) => {
  const p = db.players.find(x => x.id === req.body.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  const d = Number(req.body.delta) || 0;
  p.tickets = Math.max(1, p.tickets + d);
  p.points = Math.max(0, p.points + d);
  save(); broadcast();
  if (d > 0) io.emit('bonus', { id: p.id, tickets: p.points });
  res.json({ player: pub(p) });
});
// Ajuste manual solo de puntos actuales (0 = fuera de la tómbola de finalistas)
app.post('/api/admin/points', requirePin, (req, res) => {
  const p = db.players.find(x => x.id === req.body.id);
  if (!p) return res.status(404).json({ error: 'No existe' });
  p.points = Math.max(0, p.points + (Number(req.body.delta) || 0));
  save(); broadcast(); res.json({ player: pub(p) });
});
// Devuelve a todos sus puntos iniciales (1 + boletos extra)
app.post('/api/admin/restore', requirePin, (_, res) => {
  for (const p of db.players) p.points = p.tickets;
  save(); broadcast(); res.json({ ok: true });
});
app.post('/api/admin/move', requirePin, (req, res) => {
  const p = db.players.find(x => x.id === req.body.id);
  const s = db.squads.find(x => x.id === Number(req.body.squad));
  if (!p || !s) return res.status(404).json({ error: 'No existe' });
  p.squad = s.id; save(); broadcast(); res.json({ ok: true });
});
app.post('/api/admin/delete', requirePin, (req, res) => {
  db.players = db.players.filter(x => x.id !== req.body.id);
  db.winners = db.winners.filter(w => w.playerId !== req.body.id);
  save(); broadcast(); res.json({ ok: true });
});
app.post('/api/admin/config', requirePin, (req, res) => {
  const n = Number(req.body.expected);
  if (n > 0) { db.config.expected = n; ensureBaseSquads(); }
  const g = Number(req.body.gifts);
  if (g > 0) db.config.gifts = Math.floor(g);
  save(); broadcast();
  res.json({ config: db.config });
});
app.post('/api/admin/reset', requirePin, (req, res) => {
  if (req.body.what === 'winners') { db.winners = []; live = null; clearTimeout(elimTimer); }
  if (req.body.what === 'all') {
    db = freshDb(); live = null;
    for (const f of fs.readdirSync(PHOTO_DIR)) fs.unlinkSync(path.join(PHOTO_DIR, f));
  }
  save(); broadcast(); res.json({ ok: true });
});
app.get('/api/admin/qr', requirePin, async (req, res) => {
  const urls = [...lanUrls(), ...lanUrls(true)];
  const base = String(req.query.base || urls[0] || `http://localhost:${PORT}`).replace(/\/+$/, '');
  res.json({ base, urls, qr: await QRCode.toDataURL(base + '/', { width: 600, margin: 1 }), kioskQr: await QRCode.toDataURL(base + '/?modo=ipad', { width: 400, margin: 1 }) });
});

// ---------- Sorteos en vivo ----------
// live = { kind:'spin', id, scope:'finalists'|'all', prize, num, pool:[ids], winnerId, startedAt, duration, done }
// live = { kind:'elim', id, round, hits:[ids], revealed, zeroed:[ids], field:[ids], gifts, startedAt, done }
let live = null;
let elimTimer = null;
function liveState() { return live ? { ...live, now: Date.now() } : null; }
const alivePlayers = () => db.players.filter(p => p.points > 0);
const prizeLabel = (num, prize) => [num ? `Premio #${num}` : '', prize].filter(Boolean).join(' · ') || 'Premio sorpresa';

// Tómbola: 'finalists' = jugadores con puntos que aún no ganan; 'all' = todos los registrados.
function startSpin({ prize, num, scope = 'finalists' }) {
  if (live && !live.done) return 'Ya hay un sorteo en pantalla';
  const won = new Set(db.winners.filter(w => w.kind === 'spin').map(w => w.playerId));
  const pool = scope === 'all' ? db.players.slice() : alivePlayers().filter(p => !won.has(p.id));
  if (!pool.length) return scope === 'all' ? 'No hay jugadores' : 'No quedan finalistas sin premio';
  const winner = pool[Math.floor(Math.random() * pool.length)];
  live = { kind: 'spin', id: uid(), scope, num: num || null, prize: prizeLabel(num, prize), pool: pool.map(p => p.id), winnerId: winner.id, startedAt: Date.now() + 1200, duration: 9000 };
  const thisId = live.id;
  broadcast();
  setTimeout(() => {
    if (live?.id !== thisId) return;
    db.winners.push({ kind: scope === 'all' ? 'all' : 'spin', playerId: winner.id, prize: live.prize, num: live.num, at: Date.now() });
    live.done = true; save(); broadcast();
  }, live.startedAt - Date.now() + live.duration);
  return null;
}

// Ronda de eliminación: a N jugadores al azar (con puntos) se les quita 1 punto.
// Nunca deja menos jugadores con puntos que el número de regalos.
function startElim(n) {
  if (live && !live.done) return 'Ya hay un sorteo en pantalla';
  const gifts = db.config.gifts;
  const field = alivePlayers();
  if (field.length <= gifts) return `Ya quedan ${field.length} finalistas (regalos: ${gifts})`;
  n = Math.max(1, Math.floor(Number(n) || 0));
  const order = field.slice();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let alive = field.length;
  const hits = [];
  for (const p of order) {
    if (hits.length >= n) break;
    if (p.points > 1) hits.push(p.id);
    else if (alive > gifts) { hits.push(p.id); alive--; }
  }
  if (!hits.length) return 'No se pudo quitar puntos sin bajar de los finalistas';
  const round = (db.rounds = (db.rounds || 0) + 1);
  live = { kind: 'elim', id: uid(), round, hits, revealed: 0, zeroed: [], field: field.map(p => p.id), gifts, startedAt: Date.now() + 3500, done: false, alive: field.length };
  const thisId = live.id;
  broadcast();
  const step = () => {
    if (live?.id !== thisId) return;
    if (live.revealed >= hits.length) { live.done = true; save(); broadcast(); return; }
    const p = db.players.find(x => x.id === hits[live.revealed]);
    live.revealed++;
    if (p) {
      p.points = Math.max(0, p.points - 1);
      if (p.points === 0) live.zeroed.push(p.id);
      live.alive = alivePlayers().length;
      io.emit('hit', { id: thisId, playerId: p.id, points: p.points, alive: live.alive, revealed: live.revealed });
    }
    save();
    // Ritmo: rápido con muchos golpes, lento cuando ya casi están los finalistas.
    const close = live.alive - gifts <= 3;
    const delay = close ? 3200 : Math.max(650, Math.min(2200, 16000 / hits.length));
    elimTimer = setTimeout(step, delay);
  };
  elimTimer = setTimeout(step, 3500);
  return null;
}

// ---------- Sockets ----------
const sockets = new Map(); // socket.id -> playerId|null
function onlineCount() { return new Set([...sockets.values()].filter(Boolean)).size; }

io.on('connection', socket => {
  const token = socket.handshake.auth?.token;
  const p = token ? db.players.find(x => x.token === token) : null;
  sockets.set(socket.id, p ? p.id : null);
  socket.emit('state', snapshot());
  io.emit('online', onlineCount());

  socket.on('admin', ({ pin, action, prize, num, n }, cb = () => {}) => {
    if (pin !== ADMIN_PIN) return cb({ error: 'PIN incorrecto' });
    let err = null;
    if (action === 'spin') err = startSpin({ prize, num, scope: 'finalists' });
    else if (action === 'spinAll') err = startSpin({ prize, num, scope: 'all' });
    else if (action === 'elim') err = startElim(n);
    else if (action === 'clear') { clearTimeout(elimTimer); live = null; broadcast(); }
    cb(err ? { error: err } : { ok: true });
  });
  socket.on('disconnect', () => { sockets.delete(socket.id); io.emit('online', onlineCount()); });
});

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
function lanUrls(secure = false) {
  if (secure && !httpsServer) return [];
  return lanIps().map(ip => secure ? `https://${ip}:${HTTPS_PORT}` : `http://${ip}:${PORT}`);
}

ensureBaseSquads(); save();
// Si el puerto está ocupado (otro proyecto), prueba el siguiente.
function listen(srv, port, tries = 20) {
  return new Promise((resolve, reject) => {
    srv.once('error', err => (err.code === 'EADDRINUSE' && tries > 0) ? resolve(listen(srv, port + 1, tries - 1)) : reject(err));
    srv.listen(port, () => resolve(port));
  });
}
(async () => {
  PORT = await listen(server, PORT);
  if (httpsServer) HTTPS_PORT = await listen(httpsServer, HTTPS_PORT).catch(() => { httpsServer = null; return null; });
  console.log(`\n🏁 Convivio ALMO 2026 corriendo`);
  console.log(`   Local:     http://localhost:${PORT}`);
  for (const u of lanUrls()) console.log(`   Red local: ${u}`);
  for (const u of lanUrls(true)) console.log(`   HTTPS:     ${u}   (cámara en vivo; acepta el aviso de certificado)`);
  console.log(`   Admin:     /admin  (PIN ${ADMIN_PIN})   Kiosko iPad: /?modo=ipad\n`);
})();
