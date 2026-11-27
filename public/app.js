// App del jugador: registro (selfie + gorritas), pase VIP, arena en vivo, modo kiosko.
const qs = new URLSearchParams(location.search);
const KIOSK = qs.get('modo') === 'ipad';
const ARENA_FIRST = location.pathname === '/arena';
const $view = document.getElementById('view');
const { esc, pad, sleep, play, vibrate, confetti, toast, avatarHtml } = FX;

let token = null;
try { token = KIOSK ? null : localStorage.getItem('cv_token'); } catch {}
let me = null;          // { player, squad, team }
let state = null;       // snapshot del servidor
let offset = 0;         // reloj servidor - reloj local
let current = '';       // vista actual
let kioskPin = sessionStorage.getItem('cv_kpin') || '';
const closedLive = new Set();

// ---------- Utilidades ----------
const sqOf = id => state?.squads.find(s => s.id === id) || me?.squad || { name: '?', color: '#39ff14' };
const playerById = id => state?.players.find(p => p.id === id);
const serverNow = () => Date.now() + offset;
function show(name, html) { current = name; $view.innerHTML = `<section class="view">${html}</section>`; window.scrollTo(0, 0); }
async function api(url, body) {
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || 'Error'), { status: r.status });
  return j;
}

const muteBtn = document.getElementById('muteBtn');
const syncMute = () => { muteBtn.textContent = FX.isMuted() ? '🔇' : '🔊'; };
muteBtn.onclick = () => { FX.setMuted(!FX.isMuted()); syncMute(); play('pop'); };
syncMute();
if (KIOSK) document.getElementById('kioskBar').classList.remove('hidden');

// ---------- Socket ----------
const socket = io({ auth: { token } });
socket.on('state', s => {
  state = s; offset = s.now - Date.now();
  updateOnline(s.online);
  if (me) {
    const p = playerById(me.player.id);
    if (p) { me.player = p; me.team = s.players.filter(x => x.squad === p.squad); me.squad = sqOf(p.squad); }
  }
  if (current === 'pass') renderPassLive();
  if (current === 'arena') renderArena();
  handleLive(s.live);
});
socket.on('online', updateOnline);
socket.on('new-player', p => {
  if (current === 'arena') toast(`🔥 <b>${esc(p.nick)}</b> se unió a ${esc(sqOf(p.squad).name)}`);
  if (current === 'pass' && me && p.squad === me.player.squad && p.id !== me.player.id) {
    toast(`🤝 <b>${esc(p.nick)}</b> entró a tu escuadrón`); play('pop'); vibrate(80);
  }
});
socket.on('bonus', ({ id, tickets }) => {
  if (me && id === me.player.id) {
    toast(`🥇 <div><b>¡Punto extra!</b><br><span class="muted">Ahora tienes ${tickets} ${tickets === 1 ? 'punto' : 'puntos'}</span></div>`, 'gold');
    vibrate([100, 60, 100, 60, 300]); play('win'); confetti(90, ['#ffd60a', '#fff3a0', '#ffffff']);
  }
});
socket.on('hit', onHit);
function updateOnline(n) {
  const pill = document.getElementById('onlinePill');
  if (KIOSK) return;
  pill.classList.remove('hidden');
  document.getElementById('onlineN').textContent = `${n} en línea`;
}

// ---------- Arranque ----------
(async function boot() {
  if (KIOSK) return kioskPin ? introView() : pinView();
  try {
    me = await api('/api/me');
    if (me.token && me.token !== token) { token = me.token; try { localStorage.setItem('cv_token', token); } catch {} reconnect(); }
    ARENA_FIRST ? arenaView() : passView();
  } catch {
    try { localStorage.removeItem('cv_token'); } catch {}
    token = null;
    ARENA_FIRST ? arenaView() : introView();
  }
})();
function reconnect() { socket.auth = { token }; socket.disconnect().connect(); }

// ---------- Kiosko: PIN ----------
function pinView() {
  let pin = '';
  show('pin', `
    <div class="hero">
      <h1 style="font-size:32px">Modo <span class="o">Kiosko</span></h1>
      <p>PIN del staff para activar el iPad</p>
      <div class="pin-dots" id="dots">${'<i></i>'.repeat(4)}</div>
      <div class="pinpad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>
    </div>`);
  const dots = document.getElementById('dots');
  $view.querySelectorAll('.pinpad button').forEach(b => b.onclick = async () => {
    play('tick');
    pin = b.dataset.k === '⌫' ? pin.slice(0, -1) : (pin + b.dataset.k).slice(0, 4);
    dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('f', i < pin.length));
    if (pin.length === 4) {
      try { await api('/api/admin/login', { pin }); kioskPin = pin; sessionStorage.setItem('cv_kpin', pin); introView(); }
      catch { dots.classList.add('shake'); vibrate(200); setTimeout(() => dots.classList.remove('shake'), 400); pin = ''; dots.querySelectorAll('i').forEach(d => d.classList.remove('f')); }
    }
  });
}

// ---------- 1. Intro ----------
function introView() {
  show('intro', `
    <div class="splat" style="top:-40px;left:-60px">💥</div>
    <div class="hero">
      <div class="lights" id="lights"><i></i><i></i><i></i><i></i><i></i></div>
      <h1><span class="g">Gotcha</span><br>&amp;<br><span class="o">Go-Karts</span></h1>
      <p>Regístrate en 30 segundos: selfie de combate, tu apodo y te asignamos escuadrón.</p>
      <div class="badges"><span class="pill">🎯 Escuadrones de 5</span><span class="pill">🎟️ Boleto digital</span><span class="pill">🏆 Rifa en vivo</span></div>
      <button class="btn" id="go">¡Entrar a la pista!</button>
    </div>`);
  const lights = [...document.querySelectorAll('#lights i')];
  let k = 0;
  const idle = setInterval(() => { lights.forEach((l, i) => l.classList.toggle('on', i <= k % 6 && k % 6 < 5)); k++; }, 450);
  document.getElementById('go').onclick = async e => {
    e.target.disabled = true; clearInterval(idle); play('rev'); vibrate(40);
    lights.forEach(l => l.classList.remove('on'));
    for (const l of lights) { await sleep(220); l.classList.add('on'); play('tick'); }
    await sleep(300); document.getElementById('lights').classList.add('go'); play('go');
    await sleep(350); cameraView();
  };
}

// ---------- 2. Cámara ----------
let stream = null;
function stopCam() { stream?.getTracks().forEach(t => t.stop()); stream = null; }
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
let httpsPort = null;
fetch('/api/info').then(r => r.json()).then(j => { httpsPort = j.httpsPort; }).catch(() => {});
const secureUrl = () => httpsPort ? `https://${location.hostname}:${httpsPort}${location.pathname}${location.search}` : null;
function camErrorMsg(err) {
  const n = err?.name || '';
  const mac = /Macintosh/.test(navigator.userAgent) && !IS_MOBILE;
  if (n === 'NotAllowedError' || n === 'SecurityError')
    return `<b>Permiso de cámara bloqueado.</b><br>Toca el candado 🔒 junto a la dirección y permite la cámara, luego reintenta.${mac ? '<br><span class="muted">En Mac revisa también: Ajustes del Sistema → Privacidad y seguridad → Cámara → activa tu navegador.</span>' : ''}`;
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '<b>No se encontró ninguna cámara</b> en este dispositivo.';
  if (n === 'NotReadableError' || n === 'AbortError') return '<b>La cámara está ocupada</b> por otra app (Zoom, Teams, FaceTime…). Ciérrala y reintenta.';
  return '<b>No se pudo abrir la cámara.</b>';
}
async function openStream() {
  try { return await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1080 } }, audio: false }); }
  catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e;
    return await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); // algunas webcams no aceptan las restricciones
  }
}
async function cameraView() {
  const canLive = !!(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
  // En celular por http usamos la cámara nativa (input capture). En laptop/Mac por http no hay forma: hay que ir a https.
  const mode = canLive ? 'live' : IS_MOBILE ? 'native' : 'blocked';
  show('camera', `
    <h2 class="step-title">📸 Foto de combate<small>Mírate a la cámara, pon cara de guerra</small></h2>
    <div class="stage" id="stage">
      ${mode === 'live' ? '<video id="vid" playsinline autoplay muted></video>' : ''}
      <div class="cam-msg ${mode === 'live' ? 'hidden' : ''}" id="camMsg">
        ${mode === 'native' ? '<div style="font-size:80px">🤳</div><p>Toca el botón para abrir la cámara</p>' : ''}
        ${mode === 'blocked' ? `<div style="font-size:60px">🔒</div><p><b>Este navegador solo permite la cámara en conexión segura.</b></p>
          ${secureUrl() ? `<a class="btn" style="text-decoration:none;font-size:15px;padding:14px" href="${secureUrl()}">Abrir versión segura</a><p class="muted" style="font-size:12px">Si aparece “conexión no privada”: Avanzado → Continuar.</p>` : ''}` : ''}
      </div>
      <div class="reticle"><div class="ring"></div></div>
      <div class="countdown" id="cd"></div>
      <div class="flash" id="flash"></div>
    </div>
    <div class="stack" style="margin-top:16px">
      ${mode !== 'blocked' ? `<button class="btn" id="shoot">${mode === 'live' ? '¡Tomar foto de combate!' : 'Abrir cámara'}</button>` : ''}
      <div class="row">
        <button class="btn ghost" id="upload">📁 Subir foto</button>
        <button class="btn ghost" id="noPhoto">😎 Sin foto (avatar)</button>
      </div>
    </div>`);
  const file = document.getElementById('fileCam');
  file.value = '';
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    try { const img = await loadImage(URL.createObjectURL(f)); stopCam(); play('shot'); editorView(squareFrom(img, false)); }
    catch { toast('⚠️ No pude leer esa imagen, prueba con otra'); }
  };
  const pick = native => { native ? file.setAttribute('capture', 'user') : file.removeAttribute('capture'); file.click(); };
  document.getElementById('noPhoto').onclick = () => { stopCam(); editorView(avatarBase(), true); };
  document.getElementById('upload').onclick = () => pick(false);
  if (mode === 'native') { document.getElementById('shoot').onclick = () => pick(true); return; }
  if (mode === 'blocked') return;

  const vid = document.getElementById('vid'), msg = document.getElementById('camMsg'), shoot = document.getElementById('shoot');
  const start = async () => {
    msg.classList.add('hidden');
    try { stream = await openStream(); vid.srcObject = stream; await vid.play().catch(() => {}); shoot.textContent = '¡Tomar foto de combate!'; shoot.onclick = take; }
    catch (err) {
      msg.innerHTML = `<div style="font-size:54px">📷</div><p>${camErrorMsg(err)}</p>`;
      msg.classList.remove('hidden');
      shoot.textContent = IS_MOBILE ? 'Usar cámara del teléfono' : '↻ Reintentar cámara';
      shoot.onclick = IS_MOBILE ? () => pick(true) : start;
    }
  };
  const take = async () => {
    if (!vid.videoWidth) return toast('La cámara aún está cargando…');
    shoot.disabled = true;
    const cd = document.getElementById('cd');
    for (const n of [3, 2, 1]) { cd.textContent = n; play('beep'); vibrate(30); await sleep(700); }
    cd.textContent = '';
    document.getElementById('flash').classList.add('go'); play('shot'); vibrate(120);
    const c = squareFrom(vid, true);
    await sleep(250); stopCam(); editorView(c);
  };
  start();
}
function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function squareFrom(src, mirror) {
  const w = src.videoWidth || src.naturalWidth, h = src.videoHeight || src.naturalHeight;
  const s = Math.min(w, h), c = document.createElement('canvas'); c.width = c.height = 600;
  const x = c.getContext('2d');
  if (mirror) { x.translate(600, 0); x.scale(-1, 1); }
  x.drawImage(src, (w - s) / 2, (h - s) / 2, s, s, 0, 0, 600, 600);
  return c;
}
function avatarBase() {
  const c = document.createElement('canvas'); c.width = c.height = 600;
  const x = c.getContext('2d');
  const colors = [['#39ff14', '#0a3d00'], ['#ff5a1f', '#3d0d00'], ['#00d4ff', '#002a3d'], ['#bf5af2', '#25003d'], ['#ffd60a', '#3d3200']];
  const [a, b] = colors[Math.floor(Math.random() * colors.length)];
  const g = x.createRadialGradient(300, 260, 40, 300, 300, 420); g.addColorStop(0, a); g.addColorStop(1, b);
  x.fillStyle = g; x.fillRect(0, 0, 600, 600);
  return c;
}

// ---------- 3. Editor de gorritas / stickers ----------
const STICKERS = ['🧢', '🪖', '⛑️', '🎩', '👑', '🤠', '🕶️', '🥽', '😎', '🎧', '🏁', '🎯', '🔫', '💥', '🔥', '⚡', '🏆', '💀', '😈', '🦸', '🏎️', '🪂', '💣', '🥇'];
const FACES = ['😎', '😈', '🤠', '🥸', '🤖', '👽', '🦁', '🐯', '🦊', '🐸', '💀', '🐵'];
const FRAMES = [['none', 'Sin marco'], ['gotcha', '🎯 Gotcha'], ['racing', '🏁 Racing'], ['splash', '💥 Pintura'], ['gold', '🏆 VIP']];
function editorView(base, isAvatar = false) {
  const stickers = [];
  let sel = -1, frame = 'gotcha';
  if (isAvatar) stickers.push({ e: FACES[Math.floor(Math.random() * FACES.length)], x: 300, y: 330, s: 360, r: 0 });
  show('editor', `
    <h2 class="step-title">🧢 Ponte guapo<small>Agrega gorritas y accesorios. Arrástralos; pellizca o usa la barra para el tamaño.</small></h2>
    <div class="stage"><canvas id="ed" width="600" height="600"></canvas></div>
    <div class="sticker-ctrl hidden" id="ctrl">
      <span>↔️</span><input type="range" id="size" min="60" max="520">
      <span>🔄</span><input type="range" id="rot" min="-180" max="180">
      <button id="del" aria-label="Quitar">🗑️</button>
    </div>
    ${isAvatar ? `<div class="tray-label">Cara</div><div class="tray" id="faces">${FACES.map(f => `<button data-e="${f}">${f}</button>`).join('')}</div>` : ''}
    <div class="tray-label">Accesorios</div>
    <div class="tray" id="tray">${STICKERS.map(s => `<button data-e="${s}">${s}</button>`).join('')}</div>
    <div class="tray-label">Marco</div>
    <div class="tray frames" id="frames">${FRAMES.map(([k, l]) => `<button data-f="${k}" class="${k === frame ? 'sel' : ''}">${l}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn ghost" id="redo">↺ Otra foto</button>
      <button class="btn" id="ok" style="flex:1.6">¡Listo!</button>
    </div>`);
  const cv = document.getElementById('ed'), ctx = cv.getContext('2d');
  const ctrl = document.getElementById('ctrl'), size = document.getElementById('size'), rot = document.getElementById('rot');
  const draw = (c = ctx, showSel = true) => {
    c.clearRect(0, 0, 600, 600); c.drawImage(base, 0, 0);
    drawFrame(c, frame);
    stickers.forEach((st, i) => {
      c.save(); c.translate(st.x, st.y); c.rotate(st.r * Math.PI / 180);
      c.font = `${st.s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(st.e, 0, 0);
      if (showSel && i === sel) { c.strokeStyle = '#39ff14'; c.lineWidth = 4; c.setLineDash([12, 8]); c.strokeRect(-st.s * 0.6, -st.s * 0.6, st.s * 1.2, st.s * 1.2); }
      c.restore();
    });
  };
  const select = i => {
    sel = i; ctrl.classList.toggle('hidden', i < 0);
    if (i >= 0) { size.value = stickers[i].s; rot.value = stickers[i].r; }
    draw();
  };
  const add = e => {
    play('pop'); vibrate(15);
    const hat = ['🧢', '🪖', '⛑️', '🎩', '👑', '🤠'].includes(e), eyes = ['🕶️', '🥽'].includes(e);
    stickers.push({ e, x: 300 + (Math.random() - 0.5) * 60, y: hat ? 130 : eyes ? 270 : 300 + (Math.random() - 0.5) * 200, s: hat ? 260 : eyes ? 220 : 140, r: 0 });
    select(stickers.length - 1);
  };
  document.getElementById('tray').onclick = e => { const b = e.target.closest('button'); if (b) add(b.dataset.e); };
  const faces = document.getElementById('faces');
  if (faces) faces.onclick = e => { const b = e.target.closest('button'); if (b) { stickers[0].e = b.dataset.e; play('pop'); draw(); } };
  document.getElementById('frames').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    frame = b.dataset.f; play('tick');
    document.querySelectorAll('#frames button').forEach(x => x.classList.toggle('sel', x === b)); draw();
  };
  size.oninput = () => { if (sel >= 0) { stickers[sel].s = +size.value; draw(); } };
  rot.oninput = () => { if (sel >= 0) { stickers[sel].r = +rot.value; draw(); } };
  document.getElementById('del').onclick = () => { if (sel >= 0) { stickers.splice(sel, 1); play('splat'); select(-1); } };

  // Arrastre + pellizco
  const pts = new Map(); let drag = null, pinch = null;
  const pos = ev => { const r = cv.getBoundingClientRect(); return { x: (ev.clientX - r.left) * 600 / r.width, y: (ev.clientY - r.top) * 600 / r.height }; };
  cv.onpointerdown = ev => {
    cv.setPointerCapture(ev.pointerId); const p = pos(ev); pts.set(ev.pointerId, p);
    if (pts.size === 2 && sel >= 0) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), s: stickers[sel].s, r: stickers[sel].r }; drag = null; return;
    }
    let hit = -1;
    for (let i = stickers.length - 1; i >= 0; i--) { const st = stickers[i]; if (Math.abs(p.x - st.x) < st.s * 0.6 && Math.abs(p.y - st.y) < st.s * 0.6) { hit = i; break; } }
    select(hit);
    if (hit >= 0) drag = { dx: p.x - stickers[hit].x, dy: p.y - stickers[hit].y };
  };
  cv.onpointermove = ev => {
    if (!pts.has(ev.pointerId)) return;
    const p = pos(ev); pts.set(ev.pointerId, p);
    if (pinch && pts.size === 2 && sel >= 0) {
      const [a, b] = [...pts.values()];
      const st = stickers[sel];
      st.s = Math.max(40, Math.min(560, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      st.r = pinch.r + (Math.atan2(b.y - a.y, b.x - a.x) - pinch.ang) * 180 / Math.PI;
      size.value = st.s; rot.value = st.r; draw();
    } else if (drag && sel >= 0) { stickers[sel].x = p.x - drag.dx; stickers[sel].y = p.y - drag.dy; draw(); }
  };
  cv.onpointerup = cv.onpointercancel = ev => { pts.delete(ev.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };

  document.getElementById('redo').onclick = () => cameraView();
  document.getElementById('ok').onclick = () => {
    const out = document.getElementById('work'); draw(out.getContext('2d'), false);
    play('shot'); nickView(out.toDataURL('image/jpeg', 0.85));
  };
  draw();
}
function drawFrame(c, kind) {
  if (kind === 'none') return;
  c.save();
  const blob = (x, y, r, col) => {
    c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + x * 0.01, d = r * (1.1 + (i % 3) * 0.35); c.beginPath(); c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.18 + (i % 2) * 0.12), 0, 7); c.fill(); }
  };
  const label = (txt, col) => {
    c.font = '700 44px "Russo One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 8; c.strokeStyle = '#000'; c.strokeText(txt, 300, 556); c.fillStyle = col; c.fillText(txt, 300, 556);
  };
  if (kind === 'gotcha') {
    blob(30, 40, 44, 'rgba(57,255,20,0.9)'); blob(575, 570, 50, 'rgba(57,255,20,0.9)'); blob(570, 30, 22, 'rgba(255,90,31,0.9)');
    c.strokeStyle = '#39ff14'; c.lineWidth = 8;
    [[40, 40, 1, 1], [560, 40, -1, 1], [40, 560, 1, -1], [560, 560, -1, -1]].forEach(([x, y, sx, sy]) => { c.beginPath(); c.moveTo(x, y + 70 * sy); c.lineTo(x, y); c.lineTo(x + 70 * sx, y); c.stroke(); });
    label('GOTCHA', '#39ff14');
  } else if (kind === 'racing') {
    const sq = 30;
    for (let i = 0; i < 20; i++) for (let j = 0; j < 2; j++) {
      c.fillStyle = (i + j) % 2 ? '#fff' : '#111'; c.fillRect(i * sq, j * sq, sq, sq); c.fillRect(i * sq, 600 - (j + 1) * sq, sq, sq);
    }
    c.fillStyle = '#ff5a1f'; c.fillRect(0, 60, 600, 6); c.fillRect(0, 534, 600, 6);
    c.font = '700 40px "Russo One", sans-serif'; c.textAlign = 'center'; c.lineWidth = 8; c.strokeStyle = '#000';
    c.strokeText('GO-KARTS', 300, 500); c.fillStyle = '#ff5a1f'; c.fillText('GO-KARTS', 300, 500);
  } else if (kind === 'splash') {
    blob(60, 60, 60, 'rgba(57,255,20,0.85)'); blob(540, 90, 45, 'rgba(255,90,31,0.85)');
    blob(70, 540, 50, 'rgba(255,214,10,0.85)'); blob(550, 545, 65, 'rgba(0,212,255,0.85)');
  } else if (kind === 'gold') {
    const g = c.createLinearGradient(0, 0, 600, 600); g.addColorStop(0, '#fff3a0'); g.addColorStop(0.5, '#ffd60a'); g.addColorStop(1, '#b8860b');
    c.strokeStyle = g; c.lineWidth = 26; c.strokeRect(13, 13, 574, 574);
    label('★ VIP ★', '#ffd60a');
  }
  c.restore();
}

// ---------- 4. Apodo ----------
function nickView(photo) {
  show('nick', `
    <h2 class="step-title">🪪 Tu nombre de batalla<small>Así te verán todos en la rifa</small></h2>
    <img class="preview-ava" src="${photo}" alt="">
    <div class="stack" style="margin-top:20px">
      <input class="field" id="nick" maxlength="20" placeholder="Apodo o nombre" autocomplete="off" autocapitalize="words">
      <button class="btn race" id="send">🏁 ¡Arrancar!</button>
      <button class="btn ghost" id="back">← Cambiar foto</button>
    </div>`);
  const inp = document.getElementById('nick');
  setTimeout(() => inp.focus(), 300);
  inp.onkeydown = e => { if (e.key === 'Enter') document.getElementById('send').click(); };
  document.getElementById('back').onclick = () => cameraView();
  document.getElementById('send').onclick = async e => {
    const nick = inp.value.trim();
    if (!nick) { inp.classList.add('shake'); vibrate(100); setTimeout(() => inp.classList.remove('shake'), 400); return; }
    e.target.disabled = true; e.target.textContent = 'Asignando escuadrón…';
    try {
      const r = await api('/api/register', { nick, photo, kiosk: KIOSK, pin: KIOSK ? kioskPin : undefined });
      if (!KIOSK) { token = r.token; me = r; try { localStorage.setItem('cv_token', token); } catch {} reconnect(); }
      revealView(r);
    } catch (err) { toast('⚠️ ' + esc(err.message)); e.target.disabled = false; e.target.textContent = '🏁 ¡Arrancar!'; }
  };
}

// ---------- 5. Revelación ----------
function cardHtml(p, squad, reveal = false) {
  const extra = p.tickets > 1;
  const pts = p.points ?? p.tickets;
  const final = pts > 0 && isFinal();
  return `
    <div class="card-wrap"><div class="pcard ${reveal ? 'reveal' : ''} ${pts === 0 ? 'zero' : ''}" style="--sq:${squad.color}">
      <div class="stripe"></div>
      <div class="num"><small>BOLETO</small>#${pad(p.number)}</div>
      <div class="tix"><b>${pts}</b>${pts === 1 ? 'punto' : 'puntos'}<div class="hearts">${'❤️'.repeat(Math.min(pts, 5))}</div></div>
      ${extra ? '<div class="medal">🥇</div>' : ''}
      ${pts === 0 ? '<div class="zero-stamp">SIN PUNTOS</div>' : ''}
      ${final ? '<div class="final-badge">🏁 FINALISTA</div>' : ''}
      ${p.photo ? `<img class="photo" src="${esc(p.photo)}" alt="">` : `<div class="photo ava-fallback">${esc(p.nick.slice(0, 2).toUpperCase())}</div>`}
      <div class="nick">${esc(p.nick)}</div>
      <div class="squad">🛡️ Escuadrón ${esc(squad.name)}</div>
    </div></div>`;
}
function teamHtml(team, squad, myId) {
  const slots = Array.from({ length: Math.max(5, team.length) }, (_, i) => team[i]);
  return `<div class="section"><h3 style="color:${squad.color}">Escuadrón ${esc(squad.name)} · ${team.length}/5</h3>
    <div class="team">${slots.map(m => m
      ? `<div class="m" data-pid="${m.id}">${avatarHtml(m)}<span>${m.id === myId ? 'Tú' : esc(m.nick)}</span></div>`
      : `<div class="m empty"><div class="ava"></div><span>libre</span></div>`).join('')}</div></div>`;
}
async function revealView(r) {
  show('reveal', `
    <div class="hero" id="rv" style="gap:16px">
      <div class="lights" id="lights"><i></i><i></i><i></i></div>
      <h2 class="display" id="rvText" style="font-size:28px">Preparando tu boleto…</h2>
    </div>`);
  const L = [...document.querySelectorAll('#lights i')];
  for (const l of L) { await sleep(550); l.classList.add('on'); play('beep'); vibrate(40); }
  await sleep(600); document.getElementById('lights').classList.add('go'); play('go'); play('rev');
  vibrate([80, 40, 200]);
  await sleep(300);
  confetti(180);
  const sq = r.squad;
  document.getElementById('rv').outerHTML = `
    ${cardHtml(r.player, sq, true)}
    ${teamHtml(r.team, sq, r.player.id)}
    <p class="center muted" style="margin:4px 0 14px">Busca a tu escuadrón <b style="color:${sq.color}">${esc(sq.name)}</b> 🔎</p>
    ${KIOSK ? `
      <button class="btn" id="next">Siguiente participante →</button>
      <div class="kiosk-timer"><i id="kt"></i></div>` : `
      <div class="stack">
        <button class="btn race" id="toArena">🎰 Entrar a la Arena</button>
        <button class="btn ghost" id="toPass">Ver mi pase</button>
      </div>`}`;
  if (KIOSK) {
    const kt = document.getElementById('kt');
    requestAnimationFrame(() => { kt.style.transitionDuration = '15s'; kt.style.width = '0%'; });
    const t = setTimeout(introView, 15000);
    document.getElementById('next').onclick = () => { clearTimeout(t); introView(); };
  } else {
    document.getElementById('toArena').onclick = arenaView;
    document.getElementById('toPass').onclick = passView;
  }
}

// ---------- 6. Pase VIP ----------
function passView() {
  if (!me) return introView();
  show('pass', `<div id="passBody"></div>
    <div class="stack" style="margin-top:6px">
      <button class="btn race" id="toArena">🎰 Entrar a la Arena</button>
    </div>`);
  document.getElementById('toArena').onclick = () => { play('rev'); arenaView(); };
  renderPassLive(true);
}
function renderPassLive(first = false) {
  const el = document.getElementById('passBody'); if (!el || !me) return;
  const sq = sqOf(me.player.squad);
  el.innerHTML = `
    <div class="center" style="margin-bottom:4px"><span class="pill">✅ Ya estás registrado</span></div>
    ${cardHtml(me.player, sq, first)}
    ${teamHtml(me.team, sq, me.player.id)}`;
}

// ---------- 7. Arena ----------
function arenaView() {
  show('arena', `
    <div class="arena-head">
      <h2>La <span>Arena</span></h2>
      <p class="muted" id="arenaSub" style="margin:6px 0 0"></p>
    </div>
    <div id="arenaBody"></div>
    ${me ? '<button class="btn ghost" id="back" style="margin-top:8px">← Mi pase</button>' : '<button class="btn ghost" id="toReg" style="margin-top:8px">← Registrarme</button>'}`);
  document.getElementById('app').classList.add('wide');
  const back = document.getElementById('back');
  if (back) back.onclick = () => { document.getElementById('app').classList.remove('wide'); passView(); };
  const toReg = document.getElementById('toReg');
  if (toReg) toReg.onclick = () => { document.getElementById('app').classList.remove('wide'); introView(); };
  renderArena();
}
function renderArena() {
  const body = document.getElementById('arenaBody'); if (!body || !state) return;
  const players = state.players;
  const alive = players.filter(p => p.points > 0).length;
  const wonIds = new Set(state.winners.map(w => w.playerId));
  document.getElementById('arenaSub').innerHTML = `<b>${players.length}</b> jugadores · <b>${alive}</b> con puntos · <b>${state.config?.gifts ?? '?'}</b> regalos · <b>${state.online}</b> en línea`;
  const squads = state.squads.map(s => ({ s, m: players.filter(p => p.squad === s.id) })).filter(x => x.m.length);
  body.innerHTML = `
    <div class="section center" style="border-color:rgba(255,90,31,.4)">
      ${state.live && !state.live.done
        ? `<div class="display" style="font-size:18px;color:var(--red)">🔴 ¡Sorteo en vivo!</div><div class="muted" style="font-size:13px;margin-top:4px">Toca el botón “Ver” de abajo para entrar</div>`
        : `<div class="display" style="font-size:18px">⏳ Esperando al host…</div><div class="muted" style="font-size:13px;margin-top:4px">Cuando inicie el sorteo, la tómbola aparecerá aquí en tu pantalla</div>`}
    </div>
    ${state.winners.length ? `<div class="section winners"><h3>🏆 Ganadores</h3>${state.winners.map(w => {
      const p = playerById(w.playerId); if (!p) return '';
      return `<div class="w" data-pid="${p.id}">${avatarHtml(p)}<div><b>${esc(p.nick)}</b><div class="muted" style="font-size:12px">#${pad(p.number)}</div></div><div class="prize">${w.kind === 'all' ? '🌟 ' : '🎁 '}${esc(w.prize)}</div></div>`;
    }).join('')}</div>` : ''}
    <div class="section"><h3>Escuadrones</h3><div class="squads-list">${squads.map(({ s, m }) => `
      <div class="sq-row" style="--sqc:${s.color}"><div class="name">${esc(s.name)}</div>
        <div class="mem">${m.map(p => `<span data-pid="${p.id}">${avatarHtml(p)}</span>`).join('')}${'<div class="slot"></div>'.repeat(Math.max(0, 5 - m.length))}</div>
      </div>`).join('') || '<div class="muted">Aún no hay jugadores</div>'}</div></div>
    <div class="section"><h3>Todos los jugadores</h3><div class="grid">${players.map(p => `
      <div data-pid="${p.id}" class="tile ${me && p.id === me.player.id ? 'me' : ''} ${wonIds.has(p.id) ? 'won' : ''} ${p.points === 0 ? 'zero' : ''}" style="--sqc:${sqOf(p.squad).color}">
        ${avatarHtml(p)}<span class="pts">${p.points}</span>
        <div class="n">#${pad(p.number)}</div><div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.nick)}</div>
      </div>`).join('')}</div></div>`;
}

// ---------- Sorteos en vivo ----------
let liveEl = null, liveId = null;
function handleLive(live) {
  if (KIOSK) return;
  try { handleLiveInner(live); } finally { updateLiveBtn(); }
}
// Botón flotante para entrar al sorteo cuando está corriendo (o ver el último resultado).
const liveBtn = document.createElement('button');
liveBtn.className = 'live-btn hidden';
document.body.appendChild(liveBtn);
liveBtn.onclick = () => {
  const live = state?.live; if (!live) return;
  play('rev'); closedLive.delete(live.id);
  if (!['pass', 'arena'].includes(current)) { stopCam(); arenaView(); }
  liveId = null; handleLive(live);
};
function updateLiveBtn() {
  const live = state?.live;
  const show = !KIOSK && live && !liveEl;
  liveBtn.classList.toggle('hidden', !show);
  if (!show) return;
  liveBtn.classList.toggle('done', !!live.done);
  liveBtn.innerHTML = live.done
    ? '🏆 Ver resultado del sorteo'
    : `<span class="rec"></span> EN VIVO · ${live.kind === 'elim' ? 'Eliminación' : 'Tómbola'} <b>VER →</b>`;
}
function handleLiveInner(live) {
  const allowed = ['pass', 'arena'].includes(current);
  if (!live) { closeLive(); return; }
  if (!allowed || closedLive.has(live.id)) return;
  if (live.id !== liveId) { closeLive(); liveId = live.id; live.kind === 'spin' ? startSpinView(live) : startElimView(live); }
  else if (live.kind === 'elim') syncElim(live);
  else if (live.kind === 'spin' && live.done) finishSpin(live);
}
function closeLive() { liveEl?.remove(); liveEl = null; liveId = null; document.body.classList.remove('tense'); updateLiveBtn(); }
function overlay(html) { liveEl = document.createElement('div'); liveEl.className = 'overlay'; liveEl.innerHTML = html; document.body.appendChild(liveEl); return liveEl; }
const isMe = id => me && id === me.player.id;

// Tómbola normal: carrete tipo tragamonedas
const CARD_W = 140;
function startSpinView(live) {
  const pool = live.pool.map(playerById).filter(Boolean);
  const winner = playerById(live.winnerId);
  if (!winner || !pool.length) return;
  const N = 70, WIN_AT = 62;
  const items = Array.from({ length: N }, (_, i) => i === WIN_AT ? winner : pool[Math.floor(Math.random() * pool.length)]);
  const el = overlay(`
    <h2>🎰 ${live.scope === 'all' ? 'Tómbola para todos' : 'Tómbola de finalistas'}</h2><div class="prize-name">${live.scope === 'all' ? '🌟' : '🎁'} ${esc(live.prize)}</div>
    <div class="reel-box" id="rbox"><div class="reel-marker"></div>
      <div class="reel" id="reel">${items.map(p => `<div class="rc" style="--sqc:${sqOf(p.squad).color}">${avatarHtml(p)}<div class="n">#${pad(p.number)} ${esc(p.nick)}</div></div>`).join('')}</div>
    </div>
    <div class="winner-box" id="wbox"><div class="muted">${pool.length} participantes en la tómbola…</div></div>`);
  const reel = el.querySelector('#reel'), box = el.querySelector('#rbox');
  const target = box.clientWidth / 2 - (WIN_AT * CARD_W + 65);
  const startAt = live.startedAt - offset;   // en reloj local
  const remaining = startAt + live.duration - Date.now();
  if (live.done || remaining <= 300) { reel.style.transform = `translateX(${target}px)`; finishSpin(live, true); return; }
  const delay = Math.max(0, startAt - Date.now());
  const dur = Math.min(live.duration, remaining);
  play('rev');
  setTimeout(() => {
    reel.style.transition = `transform ${dur}ms cubic-bezier(0.1, 0.75, 0.12, 1)`;
    reel.style.transform = `translateX(${target}px)`;
    let last = -1;
    const tickLoop = () => {
      if (!reel.isConnected) return;
      const tx = new DOMMatrix(getComputedStyle(reel).transform).m41;
      const idx = Math.floor((box.clientWidth / 2 - tx) / CARD_W);
      if (idx !== last) { last = idx; play('tick'); }
      if (Math.abs(tx - target) > 0.5) requestAnimationFrame(tickLoop);
    };
    requestAnimationFrame(tickLoop);
    setTimeout(() => finishSpin(live), dur + 100);
  }, delay);
}
function finishSpin(live, instant = false) {
  if (!liveEl || liveEl.dataset.done) return;
  liveEl.dataset.done = '1';
  const w = playerById(live.winnerId); if (!w) return;
  liveEl.querySelector('#wbox').innerHTML = `
    ${avatarHtml(w)}
    <div class="wn">${esc(w.nick)}</div>
    <div class="muted">#${pad(w.number)} · Escuadrón ${esc(sqOf(w.squad).name)}</div>
    ${isMe(w.id) ? '<div class="big-msg" style="margin-top:12px">¡GANASTE! 🎉</div>' : ''}
    <button class="btn ghost" id="closeLive" style="margin-top:18px;max-width:260px">Cerrar</button>`;
  liveEl.querySelector('#closeLive').onclick = () => { closedLive.add(live.id); closeLive(); };
  if (!instant) { play('win'); confetti(220); vibrate(isMe(w.id) ? [300, 100, 300, 100, 600] : 80); }
}

// Ronda de eliminación: se quita 1 punto a N jugadores; con 0 quedan fuera.
// Finalistas solo cuando ya hubo eliminación (alguien en 0) y quedan tantos como regalos.
const isFinal = () => !!state && state.players.some(p => p.points === 0) && state.players.filter(p => p.points > 0).length <= (state.config?.gifts ?? 0);
const hearts = n => n > 0 ? (n > 4 ? `❤️×${n}` : '❤️'.repeat(n)) : '💀';
function startElimView(live) {
  const hitSet = new Set(live.hits.slice(0, live.revealed));
  overlay(`
    <h2>☠️ Eliminación · Ronda ${live.round}</h2>
    <div class="prize-name">Se le quita 1 punto a ${live.hits.length} ${live.hits.length === 1 ? 'jugador' : 'jugadores'}</div>
    <div class="center" style="margin-bottom:14px"><div class="counter" id="cnt">${live.alive}</div>
      <div class="muted" id="phase">con puntos · meta: ${live.gifts} finalistas</div></div>
    <div class="rev-grid" id="rgrid">${live.field.map(id => {
      const p = playerById(id); if (!p) return '';
      return `<div class="rt ${p.points === 0 ? 'out' : ''} ${isMe(p.id) ? 'mine' : ''} ${hitSet.has(p.id) ? 'hit' : ''}" data-p="${p.id}" style="--sqc:${sqOf(p.squad).color}">
        ${avatarHtml(p)}<span class="hp">${hearts(p.points)}</span><div class="n">#${pad(p.number)} ${esc(p.nick)}</div></div>`;
    }).join('')}</div>
    <div class="winner-box" id="wbox"></div>`);
  const pre = live.startedAt - offset - Date.now();
  if (pre > 0 && !live.revealed) {
    const ph = document.getElementById('phase');
    let n = Math.ceil(pre / 1000);
    const iv = setInterval(() => {
      if (!ph.isConnected || n <= 0) { clearInterval(iv); if (ph.isConnected) ph.textContent = `con puntos · meta: ${live.gifts} finalistas`; return; }
      ph.textContent = `Comienza en ${n}…`; play('beep'); n--;
    }, 1000);
  }
  syncElim(live);
}
function setGridMode(alive, gifts) {
  const g = document.getElementById('rgrid'); if (!g) return;
  g.classList.toggle('focus', alive <= 12);
  document.body.classList.toggle('tense', alive - gifts <= 3 && alive > gifts);
}
function syncElim(live) {
  if (!liveEl) return;
  for (const id of live.field) {
    const el = liveEl.querySelector(`[data-p="${id}"]`), p = playerById(id);
    if (!el || !p || el.classList.contains('dying')) continue;
    el.classList.toggle('out', p.points === 0);
    el.querySelector('.hp').textContent = hearts(p.points);
  }
  document.getElementById('cnt').textContent = live.alive;
  setGridMode(live.alive, live.gifts);
  if (live.done) finishElim(live);
}
function onHit({ id, playerId, points, alive }) {
  if (!liveEl || id !== liveId || !state?.live) return;
  const gifts = state.live.gifts;
  const el = liveEl.querySelector(`[data-p="${playerId}"]`);
  if (el) {
    el.classList.add('dying', 'hit');
    setTimeout(() => { el.querySelector('.hp').textContent = hearts(points); }, 250);
    setTimeout(() => { el.classList.remove('dying'); if (points === 0) el.classList.add('out'); }, 750);
    if (alive > 12) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  play('shot'); setTimeout(() => play(points === 0 ? 'splat' : 'pop'), 120);
  const cnt = document.getElementById('cnt'); cnt.textContent = alive; cnt.classList.remove('shake'); void cnt.offsetWidth; cnt.classList.add('shake');
  setTimeout(() => setGridMode(alive, gifts), 800);
  if (alive - gifts <= 3) play('heart');
  if (isMe(playerId)) {
    const m = document.createElement('div'); m.className = 'me-out';
    m.innerHTML = points === 0 ? '💀 ¡ELIMINADO!<br><small style="font-size:20px">Te quedaste sin puntos</small>' : `💥 ¡Perdiste un punto!<br><small style="font-size:20px">Te ${points === 1 ? 'queda 1 punto' : `quedan ${points} puntos`}</small>`;
    document.body.appendChild(m); setTimeout(() => m.remove(), 1700);
    vibrate(points === 0 ? [300, 100, 300] : [150]);
  }
}
function finishElim(live) {
  if (!liveEl || liveEl.dataset.done) return;
  liveEl.dataset.done = '1';
  document.body.classList.remove('tense');
  setTimeout(() => {
    if (!liveEl) return;
    const reached = live.alive <= live.gifts;
    const lost = live.hits.length - live.zeroed.length;
    const mine = me && live.field.includes(me.player.id);
    const myPts = me ? playerById(me.player.id)?.points : null;
    if (reached) liveEl.querySelectorAll('.rt:not(.out)').forEach(t => t.classList.add('champ'));
    document.getElementById('phase').textContent = reached ? '¡finalistas definidos!' : `con puntos · meta: ${live.gifts} finalistas`;
    liveEl.querySelector('#wbox').innerHTML = `
      <div class="display" style="font-size:${reached ? 30 : 22}px;color:${reached ? 'var(--gold)' : 'var(--text)'}">${reached ? `🏁 ¡Tenemos a los ${live.alive} finalistas!` : `Fin de la ronda ${live.round}`}</div>
      <div class="muted" style="margin-top:6px">${lost} ${lost === 1 ? 'perdió' : 'perdieron'} un punto · ${live.zeroed.length} ${live.zeroed.length === 1 ? 'eliminado' : 'eliminados'} · quedan ${live.alive}</div>
      ${mine && myPts > 0 && reached ? '<div class="big-msg" style="margin-top:12px">¡ESTÁS EN LA FINAL! 🏁</div>' : ''}
      ${mine && myPts > 0 && !reached ? `<div class="display" style="margin-top:12px;color:var(--neon)">Sigues vivo · ${hearts(myPts)}</div>` : ''}
      <button class="btn ghost" id="closeLive" style="margin-top:18px;max-width:260px">Cerrar</button>`;
    liveEl.querySelector('#closeLive').onclick = () => { closedLive.add(live.id); closeLive(); };
    if (reached) { play('win'); confetti(260, ['#ffd60a', '#fff3a0', '#ffffff', '#39ff14']); vibrate(mine && myPts > 0 ? [300, 100, 300, 100, 600] : 100); }
    else play('go');
  }, 900);
}

// ---------- Perfil de jugador (clic en cualquier tarjeta/foto) ----------
let modalEl = null;
function openPlayer(id) {
  const p = playerById(id); if (!p) return;
  const sq = sqOf(p.squad);
  const team = state.players.filter(x => x.squad === p.squad);
  const prizes = state.winners.filter(w => w.playerId === p.id);
  modalEl?.remove();
  modalEl = document.createElement('div');
  modalEl.className = 'modal';
  modalEl.innerHTML = `<div class="modal-box">
    <button class="icon-btn modal-x" aria-label="Cerrar">✕</button>
    ${isMe(p.id) ? '<div class="center" style="margin-bottom:4px"><span class="pill">👤 Eres tú</span></div>' : ''}
    ${cardHtml(p, sq, true)}
    ${prizes.length ? `<div class="section winners"><h3>🏆 Premios</h3>${prizes.map(w => `<div class="w"><div class="prize" style="margin-left:0">${w.kind === 'all' ? '🌟' : '🎁'} ${esc(w.prize)}</div></div>`).join('')}</div>` : ''}
    ${teamHtml(team, sq, me?.player.id)}
    <p class="center muted" style="font-size:12px;margin:0">Toca a un compañero para ver su tarjeta</p>
  </div>`;
  document.body.appendChild(modalEl);
  play('pop'); vibrate(15);
  modalEl.onclick = e => {
    if (e.target === modalEl || e.target.closest('.modal-x')) { modalEl.remove(); modalEl = null; return; }
    const t = e.target.closest('[data-pid]');
    if (t && t.dataset.pid !== id) openPlayer(t.dataset.pid);
  };
}
document.addEventListener('click', e => {
  if (KIOSK || modalEl?.contains(e.target) || liveEl?.contains(e.target)) return;
  const t = e.target.closest('[data-pid]');
  if (t && state) openPlayer(t.dataset.pid);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalEl) { modalEl.remove(); modalEl = null; } });
