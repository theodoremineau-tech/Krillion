/* Trench effects: marine snow, bubbles, bursts, sound. No dependencies. */
(function () {
  'use strict';
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TIER_COLORS = {
    plankton: '#9db4c0', clever: '#c6a6ff', schooler: '#6cc4ff', rare: '#6ff2c4', deep: '#f5c451', one: '#ff6a5c', timeout: '#55687a',
  };

  // ---------- marine snow (ambient, very slow) ----------
  let snowCanvas, snowCtx, flakes = [], snowRAF = 0, snowSpeed = 1;
  function startSnow(canvas) {
    stopSnow();
    if (reduced || !canvas) return;
    snowCanvas = canvas; snowCtx = canvas.getContext('2d');
    const fit = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = r.width * devicePixelRatio; canvas.height = r.height * devicePixelRatio;
    };
    fit();
    window.addEventListener('resize', fit);
    flakes = Array.from({ length: 46 }, () => ({
      x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 1.8, v: 0.00012 + Math.random() * 0.0004, d: Math.random() * Math.PI * 2,
    }));
    const tick = () => {
      const w = canvas.width, h = canvas.height;
      snowCtx.clearRect(0, 0, w, h);
      for (const f of flakes) {
        f.y += f.v * snowSpeed; f.d += 0.01;
        if (f.y > 1.02) { f.y = -0.02; f.x = Math.random(); }
        snowCtx.globalAlpha = 0.18 + f.r * 0.12;
        snowCtx.fillStyle = '#d8f3ee';
        snowCtx.beginPath();
        snowCtx.arc((f.x + Math.sin(f.d) * 0.004) * w, f.y * h, f.r * devicePixelRatio, 0, Math.PI * 2);
        snowCtx.fill();
      }
      snowRAF = requestAnimationFrame(tick);
    };
    tick();
  }
  function stopSnow() { if (snowRAF) cancelAnimationFrame(snowRAF); snowRAF = 0; }
  // Snow rushes upward briefly when the sub drops: it sells the descent.
  function rush() {
    if (reduced) return;
    snowSpeed = -14;
    const start = performance.now();
    const ease = () => {
      const t = (performance.now() - start) / 1100;
      snowSpeed = t >= 1 ? 1 : -14 + 15 * t * t;
      if (t < 1) requestAnimationFrame(ease);
    };
    requestAnimationFrame(ease);
  }

  // ---------- DOM particles ----------
  function bubbles(anchor, count, color) {
    if (reduced || !anchor) return;
    const r = anchor.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const b = document.createElement('span');
      b.className = 'bubble';
      const size = 4 + Math.random() * 10;
      b.style.cssText = `left:${r.left + r.width / 2 + (Math.random() - 0.5) * r.width}px;top:${r.top + r.height / 2}px;width:${size}px;height:${size}px;` +
        `--dx:${(Math.random() - 0.5) * 60}px;--dy:${-80 - Math.random() * 160}px;--dur:${900 + Math.random() * 900}ms;` +
        (color ? `border-color:${color};` : '');
      document.body.appendChild(b);
      setTimeout(() => b.remove(), 2000);
    }
  }
  function burst(anchor, tier) {
    if (reduced || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const color = TIER_COLORS[tier] || '#fff';
    const n = tier === 'one' ? 46 : tier === 'deep' ? 28 : tier === 'rare' ? 18 : 0;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'spark';
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.3;
      const dist = 70 + Math.random() * (tier === 'one' ? 190 : 120);
      p.style.cssText = `left:${cx}px;top:${cy}px;background:${color};--x:${Math.cos(ang) * dist}px;--y:${Math.sin(ang) * dist}px;--dur:${700 + Math.random() * 600}ms;` +
        `width:${3 + Math.random() * 5}px;height:${3 + Math.random() * 5}px;`;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 1500);
    }
    if (tier === 'one') {
      const ring = document.createElement('div');
      ring.className = 'glow-ring';
      ring.style.left = cx + 'px'; ring.style.top = cy + 'px';
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1600);
      document.body.classList.add('flash-one');
      setTimeout(() => document.body.classList.remove('flash-one'), 900);
    }
  }
  function countUp(el, from, to, ms) {
    if (!el) return;
    if (reduced || from === to) { el.textContent = to.toLocaleString('en-US'); return; }
    const start = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(from + (to - from) * e).toLocaleString('en-US');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* unsupported */ } }

  // ---------- sound (synthesised, no files) ----------
  let ac = null;
  let soundOn = true;
  try { soundOn = localStorage.getItem('trench.sound') !== 'off'; } catch (e) { /* storage blocked */ }
  function ctx() {
    if (!soundOn) return null;
    try {
      if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      return ac;
    } catch (e) { return null; }
  }
  function tone(freq, at, dur, type, vol, slideTo) {
    const a = ctx(); if (!a) return;
    const t0 = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.08, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const NOTES = { plankton: [392], clever: [440, 523], schooler: [523, 659], rare: [523, 659, 784], deep: [523, 659, 784, 988], one: [523, 659, 784, 1047, 1319] };
  const sound = {
    get on() { return soundOn; },
    toggle() {
      soundOn = !soundOn;
      try { localStorage.setItem('trench.sound', soundOn ? 'on' : 'off'); } catch (e) { /* ignore */ }
      if (soundOn) tone(660, 0, 0.12, 'sine', 0.05);
      return soundOn;
    },
    unlock() { ctx(); },
    tier(t) {
      const ns = NOTES[t] || [330];
      ns.forEach((f, i) => tone(f, i * 0.07, t === 'one' ? 0.9 : 0.45, 'triangle', 0.07));
      if (t === 'one') ns.forEach((f, i) => tone(f * 2, 0.35 + i * 0.05, 0.8, 'sine', 0.03));
      tone(180, 0, 0.6, 'sine', 0.05, 60); // the drop
    },
    wrong() { tone(160, 0, 0.18, 'square', 0.035, 120); tone(120, 0.09, 0.2, 'square', 0.03, 90); },
    tick(urgent) { tone(urgent ? 990 : 760, 0, 0.05, 'sine', urgent ? 0.05 : 0.025); },
    timeout() { tone(300, 0, 0.7, 'sawtooth', 0.03, 70); },
    start() { [262, 330, 392].forEach((f, i) => tone(f, i * 0.09, 0.3, 'sine', 0.05)); tone(220, 0.25, 1.2, 'sine', 0.04, 55); },
  };

  window.TrenchFX = { startSnow, stopSnow, rush, bubbles, burst, countUp, vibrate, sound, TIER_COLORS, reduced };
})();
