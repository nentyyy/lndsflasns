import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

const CARDS = 18;

// Поведение карты на каждой фазе. Возвращает x/y/rotate/scale + zIndex.
function targetForCard(i, phase) {
  if (phase === 'stack') {
    // Плотная стопка, лёгкое веерное смещение
    return {
      x: (i - CARDS / 2) * 0.6,
      y: (i % 2 === 0 ? -1 : 1) * 0.5,
      rotate: (i - CARDS / 2) * 0.8,
      scale: 0.92 + (i % 5) * 0.003,
      zIndex: i
    };
  }
  if (phase === 'riffle') {
    // Классическая «рифл» тасовка: половина карт уходит вправо, половина влево
    const side = i % 2 === 0 ? -1 : 1;
    const lane = Math.floor(i / 2);
    return {
      x: side * (54 + lane * 1.2),
      y: -8 + lane * 0.4,
      rotate: side * (12 + lane * 0.8),
      scale: 1,
      zIndex: 10 + lane
    };
  }
  if (phase === 'cascade') {
    // Каскад вверх — карты летят с разных сторон с разной высотой
    const angle = (i / CARDS) * Math.PI * 2;
    const radius = 36;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.55 - 4,
      rotate: (angle * 180) / Math.PI - 90,
      scale: 0.94,
      zIndex: 5 + (i % 7)
    };
  }
  if (phase === 'shuffle') {
    // Хаотичная тасовка
    const seed = i * 17 + 3;
    return {
      x: ((seed % 11) - 5) * 12,
      y: ((seed % 7) - 3) * 8,
      rotate: ((seed % 13) - 6) * 9,
      scale: 1,
      zIndex: 4 + (seed % 12)
    };
  }
  if (phase === 'fan') {
    // 5 карт «избранных» расходятся в широкий веер, остальные уходят в фон
    if (i < 5) {
      const offset = i - 2;
      return { x: offset * 34, y: 0, rotate: offset * 9, scale: 1.04, zIndex: 50 + i };
    }
    const side = i % 2 === 0 ? -1 : 1;
    const dist = 120 + (i % 6) * 6;
    return {
      x: side * dist,
      y: 38 + (i % 5) * 4,
      rotate: side * 26,
      scale: 0.84,
      zIndex: i
    };
  }
  return { x: 0, y: 0, rotate: 0, scale: 1, zIndex: i };
}

const phaseLabel = {
  stack:    'Собираем колоду',
  riffle:   'Рифл-тасовка',
  cascade:  'Каскад',
  shuffle:  'Перемешивание',
  fan:      'Печать наложена'
};

export default function Splash({ onDone, duration = 3000 }) {
  const [phase, setPhase] = useState('stack');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const seq = [
      { p: 'stack',   at: 0.00 },
      { p: 'riffle',  at: 0.18 },
      { p: 'stack',   at: 0.36 },
      { p: 'cascade', at: 0.50 },
      { p: 'shuffle', at: 0.66 },
      { p: 'stack',   at: 0.80 },
      { p: 'fan',     at: 0.90 }
    ];
    const timers = seq.map(({ p, at }) => setTimeout(() => setPhase(p), duration * at));
    const finish = setTimeout(() => onDone && onDone(), duration);
    return () => { timers.forEach(clearTimeout); clearTimeout(finish); };
  }, [onDone, duration]);

  useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setProgress(Math.round(p * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  return (
    <motion.div
      className="dw-splash"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="dw-splash-inner">
        <div className="dw-splash-title">
          <span>DEADWILL</span>
          <span className="dw-splash-sub">— запечатанные завещания —</span>
        </div>

        <div className="dw-splash-stage dw-splash-stage--wide">
          {Array.from({ length: CARDS }).map((_, i) => {
            const t = targetForCard(i, phase);
            return (
              <motion.div
                key={i}
                className="dw-splash-card"
                initial={{ x: 0, y: 0, rotate: 0, scale: 0.8, opacity: 0 }}
                animate={{
                  opacity: phase === 'fan' && i >= 5 ? 0.35 : 1,
                  x: t.x, y: t.y, rotate: t.rotate, scale: t.scale
                }}
                transition={{
                  type: 'spring',
                  stiffness: 240,
                  damping: 22,
                  mass: 0.55,
                  delay: i * 0.012
                }}
                style={{ zIndex: t.zIndex }}
              />
            );
          })}
        </div>

        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="dw-splash-bar">
            <motion.div
              className="dw-splash-bar-fill"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ ease: 'linear', duration: 0.15 }}
            />
          </div>
          <div className="dw-splash-status">
            <span>{phaseLabel[phase] || 'Загрузка'}</span>
            <span>{progress}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
