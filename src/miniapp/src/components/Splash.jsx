import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

const CARDS = 7;

export default function Splash({ onDone, duration = 2400 }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const finish = setTimeout(() => onDone && onDone(), duration);
    return () => clearTimeout(finish);
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

        {/* Веер карт, который мягко «дышит» — компактно, без вылетов за экран */}
        <div className="dw-splash-fan">
          {Array.from({ length: CARDS }).map((_, i) => {
            const offset = i - (CARDS - 1) / 2; // -3..3
            return (
              <motion.div
                key={i}
                className="dw-splash-card"
                initial={{ rotate: 0, x: 0, y: 40, opacity: 0 }}
                animate={{
                  rotate: [0, offset * 11, 0],
                  x: [0, offset * 22, 0],
                  y: [10, 0, 10],
                  opacity: 1
                }}
                transition={{
                  duration: 1.8,
                  ease: 'easeInOut',
                  repeat: Infinity,
                  delay: i * 0.06
                }}
                style={{ zIndex: i }}
              />
            );
          })}
        </div>

        <div className="dw-splash-progress">
          <div className="dw-splash-bar">
            <motion.div
              className="dw-splash-bar-fill"
              animate={{ width: `${progress}%` }}
              transition={{ ease: 'linear', duration: 0.15 }}
            />
          </div>
          <div className="dw-splash-status">
            <span>Тасуем колоду</span>
            <span>{progress}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
