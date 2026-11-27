// Efectos compartidos: sonidos sintetizados, vibración, confeti, utilidades.
const FX = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('cv_muted') === '1'; } catch {}
  const ac = () => {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (freq, dur = 0.15, type = 'square', vol = 0.15, when = 0) => {
    if (muted) return;
    const a = ac(), t = a.currentTime + when;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  };
  const noise = (dur = 0.2, vol = 0.4, filterFreq = 1800) => {
    if (muted) return;
    const a = ac(), t = a.currentTime;
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq;
    const g = a.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(a.destination); src.start(t);
  };
  const sfx = {
    tick: () => tone(1400, 0.03, 'square', 0.06),
    beep: () => tone(520, 0.25, 'square', 0.12),
    go: () => tone(1040, 0.5, 'square', 0.14),
    shot: () => { noise(0.18, 0.6, 2500); tone(160, 0.12, 'sine', 0.3); },
    splat: () => noise(0.35, 0.5, 900),
    rev: () => {
      if (muted) return;
      const a = ac(), t = a.currentTime;
      const o = a.createOscillator(), g = a.createGain(), f = a.createBiquadFilter();
      o.type = 'sawtooth'; f.type = 'lowpass'; f.frequency.value = 900;
      o.frequency.setValueAtTime(60, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.7);
      o.frequency.exponentialRampToValueAtTime(140, t + 1.2);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(f).connect(g).connect(a.destination); o.start(t); o.stop(t + 1.35);
    },
    heart: () => { tone(70, 0.12, 'sine', 0.5); tone(60, 0.14, 'sine', 0.4, 0.18); },
    win: () => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'square', 0.1, i * 0.12)),
    pop: () => tone(880, 0.06, 'triangle', 0.15),
  };
  const play = name => { try { sfx[name]?.(); } catch {} };
  const vibrate = pattern => { try { navigator.vibrate?.(pattern); } catch {} };
  const setMuted = m => { muted = m; try { localStorage.setItem('cv_muted', m ? '1' : '0'); } catch {} };

  // Confeti / pintura
  let cv, cx, parts = [], raf = null;
  function confetti(n = 160, colors = ['#39ff14', '#ff5a1f', '#ffd60a', '#00d4ff', '#ff2d55', '#ffffff']) {
    if (!cv) {
      cv = document.createElement('canvas'); cv.className = 'confetti';
      document.body.appendChild(cv); cx = cv.getContext('2d');
    }
    cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
    for (let i = 0; i < n; i++) parts.push({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
      vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 6, r: (4 + Math.random() * 7) * devicePixelRatio,
      rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: colors[i % colors.length], blob: Math.random() < 0.3,
    });
    if (!raf) loop();
  }
  function loop() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter(p => p.y < cv.height + 40);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.rot += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot); cx.fillStyle = p.c;
      if (p.blob) { cx.beginPath(); cx.arc(0, 0, p.r * 0.7, 0, 7); cx.fill(); }
      else cx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      cx.restore();
    }
    raf = parts.length ? requestAnimationFrame(loop) : (cx.clearRect(0, 0, cv.width, cv.height), null);
  }

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(3, '0');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function toast(html, cls = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + cls; el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 3600);
    setTimeout(() => el.remove(), 4200);
  }
  function avatarHtml(p, cls = '') {
    return p.photo
      ? `<img class="ava ${cls}" src="${esc(p.photo)}" alt="" loading="lazy">`
      : `<div class="ava ava-fallback ${cls}">${esc((p.nick || '?').slice(0, 2).toUpperCase())}</div>`;
  }

  return { play, vibrate, confetti, setMuted, isMuted: () => muted, esc, pad, sleep, toast, avatarHtml };
})();
