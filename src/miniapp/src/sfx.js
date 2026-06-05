// Лёгкий синтезатор звуков на Web Audio — без файлов. Тон/звон по уровню приза.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('dw_muted') === '1'; } catch {}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('dw_muted', muted ? '1' : '0'); } catch {}
}

function ac() {
  if (muted) return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch { return null; }
}

// Базовый тон.
function tone(freq, dur, { type = 'sine', gain = 0.15, delay = 0 } = {}) {
  const a = ac(); if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type; osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(a.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function chord(freqs, dur, opts) { freqs.forEach((f, i) => tone(f, dur, { ...opts, delay: (opts?.delay || 0) + i * 0.04 })); }

// Тик таймера — нарастающая громкость (vol 0..1).
export function tick(vol = 0.3) { tone(1200, 0.05, { type: 'square', gain: 0.04 + vol * 0.12 }); }

// Звук открытия ячейки по призу.
export function revealSound(credit) {
  if (credit <= 0) { tone(150, 0.12, { type: 'sine', gain: 0.07 }); return; }
  if (credit <= 5) { tone(440, 0.16, { type: 'triangle', gain: 0.12 }); }          // бронза
  else if (credit <= 20) { chord([660, 880], 0.22, { type: 'triangle', gain: 0.12 }); } // серебро
  else { // золотой колокол + эхо
    chord([523, 784, 1047], 0.5, { type: 'sine', gain: 0.16 });
    tone(1047, 0.6, { type: 'sine', gain: 0.08, delay: 0.18 });
  }
}

// Монеты при зачислении — серия щелчков, длина ~ сумме.
export function coinsSound(amount) {
  const n = Math.min(10, Math.max(2, Math.round(amount / 10)));
  for (let i = 0; i < n; i++) tone(900 + i * 40, 0.06, { type: 'square', gain: 0.06, delay: i * 0.05 });
}

export function enterSound() { chord([330, 494], 0.3, { type: 'sine', gain: 0.08 }); }
export function winFanfare() { chord([523, 659, 784, 1047], 0.6, { type: 'sine', gain: 0.16 }); }
export function loseSound() { tone(196, 0.4, { type: 'sawtooth', gain: 0.1 }); tone(147, 0.5, { type: 'sawtooth', gain: 0.08, delay: 0.1 }); }
