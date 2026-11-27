// Panel del staff: sorteos, boletos extra manuales, jugadores, QR.
const { esc, pad, toast, avatarHtml, play } = FX;
const $view = document.getElementById('view');
let pin = localStorage.getItem('cv_admin_pin') || '';
let state = null, tab = 'draw', filter = '';
const socket = io();

async function api(url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'x-pin': pin }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const sq = id => state?.squads.find(s => s.id === id) || { name: '?', color: '#888' };

let authed = false;
socket.on('state', s => { state = s; document.getElementById('online').textContent = `${s.online} en línea`; if (authed) render(); });
socket.on('online', n => { document.getElementById('online').textContent = `${n} en línea`; });

(async () => {
  if (location.protocol === 'file:') return wrongPlace();
  if (pin) {
    try { await api('/api/admin/login', { pin }); authed = true; return render(); }
    catch { pin = ''; localStorage.removeItem('cv_admin_pin'); }
  }
  loginView();
})();

function wrongPlace() {
  $view.innerHTML = `<section class="view"><div class="hero"><div style="font-size:60px">⚠️</div>
    <h1 style="font-size:24px">Abre el panel desde el servidor</h1>
    <p>Este archivo se abrió directo del disco y no se conecta a nada.<br>Arranca con <b>npm start</b> y entra a <b>http://localhost:PUERTO/admin</b> (el puerto sale en la consola).</p></div></section>`;
}

// Teclado numérico propio: sin autocompletado del navegador y fácil en celular.
function loginView() {
  let typed = '';
  $view.innerHTML = `<section class="view"><div class="hero">
    <h1 style="font-size:30px">Acceso <span class="g">Staff</span></h1>
    <p id="pinMsg">Escribe el PIN del staff</p>
    <div class="pin-dots" id="dots">${'<i></i>'.repeat(4)}</div>
    <div class="pinpad">${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => k === '' ? '<span></span>' : `<button data-k="${k}">${k}</button>`).join('')}</div>
  </div></section>`;
  const dots = document.getElementById('dots'), msg = document.getElementById('pinMsg');
  const paint = () => dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('f', i < typed.length));
  const fail = text => {
    msg.innerHTML = text; msg.style.color = 'var(--red)';
    dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 400);
    typed = ''; paint();
  };
  const press = async k => {
    if (k === '⌫') typed = typed.slice(0, -1);
    else if (typed.length < 4) typed += k;
    paint(); play('tick');
    if (typed.length < 4) return;
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-pin': typed }, body: '{}' });
      if (r.status === 401) return fail('PIN incorrecto, intenta de nuevo');
      if (!r.ok) return fail('El servidor respondió con error (' + r.status + ')');
      pin = typed; authed = true; localStorage.setItem('cv_admin_pin', pin);
      document.removeEventListener('keydown', onKey);
      if (!state) state = await (await fetch('/api/state')).json();
      render();
    } catch { fail('No hay conexión con el servidor. ¿Está corriendo <b>npm start</b>?'); }
  };
  const onKey = e => { if (/^[0-9]$/.test(e.key)) press(e.key); else if (e.key === 'Backspace') press('⌫'); };
  document.addEventListener('keydown', onKey);
  $view.querySelectorAll('.pinpad button').forEach(b => b.onclick = () => press(b.dataset.k));
}

function render() {
  if (!state) return;
  // No re-renderizar mientras se escribe en un input
  const a = document.activeElement;
  if (a && (a.tagName === 'INPUT' || a.tagName === 'SELECT') && $view.contains(a) && $view.dataset.tab === tab) { renderStatsOnly(); return; }
  const players = state.players;
  $view.dataset.tab = tab;
  $view.innerHTML = `
    <div class="stats" id="stats">${statsHtml()}</div>
    <div class="tabs">${[['draw', '🎰 Sorteo'], ['judge', '🥇 Jueces'], ['players', '👥 Jugadores'], ['qr', '📱 QR']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'sel' : ''}">${l}</button>`).join('')}</div>
    <div id="tab">${({ draw: drawTab, judge: judgeTab, players: playersTab, qr: qrTab })[tab]()}</div>`;
  $view.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
  bind();
}
function statsHtml() {
  const players = state.players;
  return [['Jugadores', players.length], ['Con puntos', players.filter(p => p.points > 0).length], ['Regalos', state.config?.gifts ?? '-'], ['Escuadrones', state.squads.filter(s => players.some(p => p.squad === s.id)).length], ['En línea', state.online]]
    .map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join('');
}
function renderStatsOnly() { const s = document.getElementById('stats'); if (s) s.innerHTML = statsHtml(); }

// ----- Sorteo -----
function drawTab() {
  const live = state.live;
  const gifts = state.config?.gifts ?? 10;
  const alive = state.players.filter(p => p.points > 0);
  const reached = alive.length <= gifts;
  const won = new Set(state.winners.filter(w => w.kind === 'spin').map(w => w.playerId));
  const eligible = alive.filter(p => !won.has(p.id)).length;
  const nextNum = Math.max(0, ...state.winners.map(w => w.num || 0)) + 1;
  const liveTxt = !live ? 'Nada en pantalla' :
    live.kind === 'spin' ? `🎰 ${live.scope === 'all' ? 'Tómbola para todos' : 'Tómbola de finalistas'} “${esc(live.prize)}” ${live.done ? '— terminada' : '— girando…'}` :
    `☠️ Eliminación ronda ${live.round} — ${live.done ? 'terminada' : `${live.revealed}/${live.hits.length} golpes`}`;
  const pct = state.players.length ? Math.round(100 * alive.length / state.players.length) : 0;
  return `
    <div class="section"><h3>En pantalla de todos</h3><div style="font-weight:700">${liveTxt}</div>
      ${live ? '<button class="btn ghost" id="clear" style="margin-top:10px">⏹ Quitar de las pantallas</button>' : ''}</div>

    <div class="section stack"><h3>🎁 Regalos</h3>
      <div class="row"><label class="muted" style="font-size:13px;align-self:center;flex:2">¿Cuántos regalos hay? (= finalistas que deben quedar)</label>
        <input class="inp" id="gifts" type="number" min="1" value="${gifts}" style="flex:1"><button class="mini" id="saveGifts" style="flex:0 0 auto">Guardar</button></div>
      <div class="meter"><i style="width:${pct}%"></i></div>
      <div style="font-weight:700">${reached
        ? `🏁 Finalistas definidos: <span style="color:var(--gold)">${alive.length}</span> con puntos`
        : `Con puntos: <span style="color:var(--neon)">${alive.length}</span> · faltan <span style="color:var(--race)">${alive.length - gifts}</span> por quedar en 0`}</div>
    </div>

    <div class="section stack" style="border-color:rgba(255,43,43,.4)"><h3>☠️ Eliminación por puntos</h3>
      <label class="muted" style="font-size:13px">¿A cuántos jugadores les quito 1 punto en esta ronda?</label>
      <input class="inp" id="elimN" type="number" min="1" placeholder="Ej. ${Math.max(1, Math.min(10, alive.length - gifts))}">
      <button class="btn race" id="elim" ${reached ? 'disabled' : ''}>☠️ Iniciar eliminación</button>
      <div class="muted" style="font-size:12px">Se eligen al azar entre quienes tienen puntos. Con 0 quedan fuera de la tómbola y ya no pierden más. Nunca baja de ${gifts} jugadores con puntos.</div>
      <button class="mini" id="restore">↺ Restaurar puntos de todos</button>
    </div>

    <div class="section stack"><h3>🎰 Tómbola de finalistas</h3>
      <div class="row"><input class="inp" id="prizeNum" type="number" min="1" value="${nextNum}" style="flex:0 0 90px" aria-label="Número de premio"><input class="inp" id="prize" placeholder="Nombre del premio (opcional)"></div>
      <button class="btn" id="spin" ${eligible ? '' : 'disabled'}>🎰 Sortear premio #<span id="numEcho">${nextNum}</span></button>
      <div class="muted" style="font-size:12px">${eligible} finalistas sin premio participan. Quien gana sale de la tómbola de finalistas.${reached ? '' : ' <b style="color:var(--race)">Aún hay más jugadores con puntos que regalos.</b>'}</div>
    </div>

    <div class="section winners"><h3>🏆 Premios entregados</h3>${state.winners.map(w => { const p = state.players.find(x => x.id === w.playerId); return p ? `<div class="w">${avatarHtml(p)}<div><b>${esc(p.nick)}</b><div class="muted" style="font-size:12px">#${pad(p.number)}</div></div><div class="prize">${w.kind === 'all' ? '🌟' : '🎁'} ${esc(w.prize)}</div></div>` : ''; }).join('') || '<div class="muted">Aún no hay ganadores</div>'}
      ${state.winners.length ? '<button class="mini danger" id="resetWinners" style="margin-top:10px">Borrar ganadores</button>' : ''}</div>

    <div class="section stack" style="border-color:rgba(255,214,10,.45)"><h3>🌟 Premio para TODOS</h3>
      <input class="inp" id="allPrize" placeholder="Nombre del premio">
      <button class="btn" id="spinAll" style="background:linear-gradient(135deg,#ffd60a,#ff9f0a);color:#1a1400">🌟 Sortear entre TODOS</button>
      <div class="muted" style="font-size:12px">Participan los ${state.players.length} registrados, tengan o no puntos y hayan ganado o no.</div>
    </div>`;
}

// ----- Jueces -----
function judgeTab() {
  const groups = state.squads.map(s => ({ s, m: state.players.filter(p => p.squad === s.id) })).filter(g => g.m.length);
  return `<div class="muted" style="margin-bottom:10px;font-size:13px">Toca la foto del MVP de cada escuadrón (Gotcha o Go-Kart) para darle <b>+1 punto extra</b> (una vida más en la eliminación). Le llega una medalla en su celular.</div>
    ${groups.map(({ s, m }) => `<div class="section" style="border-left:4px solid ${s.color}"><h3 style="color:${s.color}">${esc(s.name)}</h3>
      <div class="judge-grid">${m.map(p => `<button data-mvp="${p.id}">${avatarHtml(p)}<div>${esc(p.nick)}</div><div class="tkb">${p.points > 0 ? '❤️'.repeat(Math.min(p.points, 5)) : '💀'}</div></button>`).join('')}</div></div>`).join('') || '<div class="muted">Sin jugadores aún</div>'}`;
}

// ----- Jugadores -----
function playersTab() {
  const list = state.players.filter(p => !filter || p.nick.toLowerCase().includes(filter) || String(p.number).includes(filter)).slice().reverse();
  return `
    <div class="section stack"><h3>Agregar a mano</h3>
      <div class="row"><input class="inp" id="mNick" placeholder="Nombre" style="flex:2"><select id="mTix"><option value="1">1 punto</option><option value="2">2 puntos</option><option value="3">3 puntos</option></select></div>
      <button class="btn ghost" id="mAdd">➕ Agregar participante</button>
    </div>
    <input class="inp search" id="filter" placeholder="🔎 Buscar por nombre o número" value="${esc(filter)}">
    <div class="plist">${list.map(p => `
      <div class="prow" style="--sqc:${sq(p.squad).color}">
        ${avatarHtml(p)}
        <div class="info"><b>#${pad(p.number)} ${esc(p.nick)}${p.manual ? ' ✍️' : ''}</b>
          <select data-move="${p.id}" style="padding:4px;margin-top:4px;font-size:12px">${state.squads.map(s => `<option value="${s.id}" ${s.id === p.squad ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        </div>
        <button class="mini" data-pt="${p.id}" data-d="-1">−</button>
        <div class="tk" title="Puntos actuales (inicial ${p.tickets})">${p.points}❤️</div>
        <button class="mini plus" data-pt="${p.id}" data-d="1">+</button>
        <button class="mini danger" data-del="${p.id}">✕</button>
      </div>`).join('') || '<div class="muted">Sin jugadores</div>'}</div>`;
}

// ----- QR -----
let qrCache = null;
function qrTab() {
  setTimeout(loadQr, 0);
  return `
    <div class="section center"><h3>QR de registro (entrada)</h3>
      <div id="qrBox" class="muted">Generando…</div></div>
    <div class="section stack"><h3>Configuración</h3>
      <label class="muted" style="font-size:13px">Personas esperadas (define cuántos escuadrones de 5 se crean al inicio)</label>
      <div class="row"><input class="inp" id="expected" type="number" min="5" step="5" value="${Math.max(state.squads.length * 5, 50)}"><button class="btn ghost" id="saveExp" style="flex:0 0 120px">Guardar</button></div>
      <button class="btn ghost" id="resetAll" style="color:var(--red)">🗑 Reiniciar TODO (borra jugadores y fotos)</button>
    </div>`;
}
async function loadQr(base) {
  try {
    qrCache = await api('/api/admin/qr' + (base ? '?base=' + encodeURIComponent(base) : ''));
    const box = document.getElementById('qrBox'); if (!box) return;
    box.innerHTML = `
      <img class="qr" src="${qrCache.qr}" alt="QR">
      <div class="display" style="margin:10px 0;font-size:16px;word-break:break-all">${esc(qrCache.base)}/</div>
      ${qrCache.urls.length > 1 ? `<select id="baseSel">${qrCache.urls.map(u => `<option ${u === qrCache.base ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>` : ''}
      <div class="row" style="margin-top:10px"><input class="inp" id="customBase" placeholder="URL pública (ej. https://xxx.trycloudflare.com)"><button class="mini" id="useBase" style="flex:0 0 auto">Usar</button></div>
      <div class="muted" style="font-size:13px;margin-top:10px">Kiosko iPad: <b>${esc(qrCache.base)}/?modo=ipad</b> (pide el PIN)<br>Arena: <b>${esc(qrCache.base)}/arena</b></div>
      <button class="btn ghost" id="printQr" style="margin-top:10px">🖨 Imprimir QR</button>`;
    const sel = document.getElementById('baseSel'); if (sel) sel.onchange = () => loadQr(sel.value);
    document.getElementById('useBase').onclick = () => { const v = document.getElementById('customBase').value.trim(); if (v) loadQr(v); };
    document.getElementById('printQr').onclick = () => {
      const w = window.open('');
      w.document.write(`<body style="font-family:sans-serif;text-align:center;padding:40px"><h1>GOTCHA &amp; GO-KARTS</h1><h2>Escanea para registrarte 📸</h2><img src="${qrCache.qr}" style="width:80%;max-width:600px"><p style="font-size:22px">${qrCache.base}/</p></body>`);
      w.document.close(); w.onload = () => w.print();
    };
  } catch (e) { toast(e.message); }
}

// ----- Eventos -----
function bind() {
  const $ = id => document.getElementById(id);
  const emit = (action, extra = {}) => socket.emit('admin', { pin, action, ...extra }, r => r?.error ? toast('⚠️ ' + esc(r.error)) : play('pop'));
  if ($('spin')) $('spin').onclick = () => emit('spin', { num: +$('prizeNum').value || null, prize: $('prize').value.trim() });
  if ($('prizeNum')) $('prizeNum').oninput = () => { $('numEcho').textContent = $('prizeNum').value; };
  if ($('spinAll')) $('spinAll').onclick = () => confirm('¿Sortear este premio entre TODOS los participantes?') && emit('spinAll', { prize: $('allPrize').value.trim() || 'Premio para todos' });
  if ($('elim')) $('elim').onclick = () => {
    const n = +$('elimN').value;
    if (!n || n < 1) { toast('Escribe a cuántos jugadores les quitas 1 punto'); $('elimN').focus(); return; }
    $('elimN').value = ''; $('elimN').blur();
    emit('elim', { n });
  };
  if ($('saveGifts')) $('saveGifts').onclick = async () => { const g = +$('gifts').value; if (!g) return toast('Número inválido'); $('gifts').blur(); await api('/api/admin/config', { gifts: g }); toast(`🎁 ${g} regalos`); };
  if ($('restore')) $('restore').onclick = () => confirm('¿Devolver a todos sus puntos iniciales (1 + extras)?') && api('/api/admin/restore', {}).then(() => toast('Puntos restaurados'));
  if ($('clear')) $('clear').onclick = () => emit('clear');
  if ($('resetWinners')) $('resetWinners').onclick = () => confirm('¿Borrar la lista de ganadores?') && api('/api/admin/reset', { what: 'winners' });
  $view.querySelectorAll('[data-mvp]').forEach(b => b.onclick = async () => {
    const p = state.players.find(x => x.id === b.dataset.mvp);
    if (!confirm(`¿+1 punto extra a ${p.nick}? (tendrá ${p.points + 1})`)) return;
    await api('/api/admin/tickets', { id: p.id, delta: 1 }); toast(`🥇 +1 punto a ${esc(p.nick)}`);
  });
  $view.querySelectorAll('[data-pt]').forEach(b => b.onclick = () => api('/api/admin/points', { id: b.dataset.pt, delta: +b.dataset.d }).catch(e => toast(e.message)));
  $view.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const p = state.players.find(x => x.id === b.dataset.del);
    confirm(`¿Eliminar a ${p.nick}?`) && api('/api/admin/delete', { id: p.id });
  });
  $view.querySelectorAll('[data-move]').forEach(s => s.onchange = () => { api('/api/admin/move', { id: s.dataset.move, squad: s.value }); s.blur(); });
  if ($('mAdd')) $('mAdd').onclick = async () => {
    const nick = $('mNick').value.trim(); if (!nick) return toast('Escribe un nombre');
    $('mNick').value = ''; $('mNick').blur();
    const r = await api('/api/admin/player', { nick, tickets: +$('mTix').value });
    toast(`✅ ${esc(nick)} → #${pad(r.player.number)} · ${esc(sq(r.player.squad).name)}`);
  };
  if ($('filter')) $('filter').oninput = e => {
    filter = e.target.value.toLowerCase(); const pos = e.target.selectionStart;
    $view.dataset.tab = ''; render(); const f = $('filter'); f.focus(); f.setSelectionRange(pos, pos);
  };
  if ($('saveExp')) $('saveExp').onclick = async () => { await api('/api/admin/config', { expected: +$('expected').value }); toast('Guardado'); };
  if ($('resetAll')) $('resetAll').onclick = async () => {
    if (prompt('Escribe BORRAR para reiniciar todo') !== 'BORRAR') return;
    await api('/api/admin/reset', { what: 'all' }); toast('Todo reiniciado');
  };
}
