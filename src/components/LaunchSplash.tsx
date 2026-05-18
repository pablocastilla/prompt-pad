import React, { useEffect, useState } from 'react';
import { useStore } from '../store';

const PARTICLE_COUNT = 42;
const PALETTES = [
  ['#ffe28a', '#ff78c8', '#67f5e6', '#ffd446', '#ff5ea8'],
  ['#ffac6f', '#ff78c8', '#9befff', '#ff934f', '#ff3d99'],
  ['#c5ff7a', '#ffe28a', '#ff78c8', '#b8ff42', '#ff6bb0'],
];

interface Particle {
  id: number;
  color: string;
  x: number;
  y: number;
  size: number;
  delay: number;
  duration: number;
  rotation: number;
}

export function LaunchSplash() {
  const launchSplash = useStore(s => s.launchSplash);
  const settings = useStore(s => s.settings);
  const [visible, setVisible] = useState(false);
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (launchSplash === 0 || settings.theme !== 'gaudy') return;

    const palette = PALETTES[launchSplash % PALETTES.length];
    const items: Particle[] = Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      id: i,
      color: palette[i % palette.length],
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: 6 + Math.random() * 28,
      delay: Math.random() * 0.15,
      duration: 0.5 + Math.random() * 0.7,
      rotation: Math.random() * 720 - 360,
    }));
    setParticles(items);
    setVisible(true);

    const timer = setTimeout(() => setVisible(false), 1200);
    return () => clearTimeout(timer);
  }, [launchSplash, settings.theme]);

  if (!visible) return null;

  return (
    <div className="launch-splash" aria-hidden="true">
      <div className="launch-splash-flash" />
      <div className="launch-splash-rings">
        <div className="launch-splash-ring" />
        <div className="launch-splash-ring" />
        <div className="launch-splash-ring" />
      </div>
      <div className="launch-splash-text">🚀 LAUNCHED 🚀</div>
      {particles.map(p => (
        <span
          key={p.id}
          className="launch-splash-particle"
          style={{
            '--sx': `${p.x}%`,
            '--sy': `${p.y}%`,
            '--ss': `${p.size}px`,
            '--sd': `${p.delay}s`,
            '--sD': `${p.duration}s`,
            '--sr': `${p.rotation}deg`,
            '--sc': p.color,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
