import { useEffect, useRef } from 'react';

const CYAN = '0, 245, 212';
const VIOLET = '157, 78, 221';

/**
 * Full-screen animated backdrop: the brain artwork, two drifting aurora glows and a live neural
 * network on a canvas. Neurons drift, link to close neighbours, fire electrical signals along the
 * links and react to the pointer. It never captures input, pauses while the tab is hidden and
 * draws a single still frame for users who prefer reduced motion.
 */
export default function NeuralBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: -9999, y: -9999, active: false };
    let width = 0;
    let height = 0;
    let nodes = [];
    let signals = [];
    let raf = 0;
    let linkDist = 150;

    const makeNodes = () => {
      // Density follows screen area so phones stay light and large monitors stay rich.
      const count = Math.max(34, Math.min(110, Math.round((width * height) / 15000)));
      linkDist = width < 700 ? 115 : 150;
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: Math.random() * 1.6 + 1.1,
        rgb: Math.random() > 0.45 ? CYAN : VIOLET,
        pulse: 0,
      }));
      signals = [];
    };

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      makeNodes();
      if (reduced) draw();
    };

    const pathFrom = (start, steps) => {
      const path = [start];
      let cur = start;
      for (let s = 0; s < steps; s += 1) {
        const near = [];
        nodes.forEach((n, i) => {
          if (path.includes(i)) return;
          if (Math.hypot(nodes[cur].x - n.x, nodes[cur].y - n.y) < linkDist) near.push(i);
        });
        if (!near.length) break;
        cur = near[Math.floor(Math.random() * near.length)];
        path.push(cur);
      }
      return path;
    };

    function draw() {
      ctx.clearRect(0, 0, width, height);

      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y);
          if (d < linkDist) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(190, 215, 255, ${(1 - d / linkDist) * 0.16})`;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      for (const n of nodes) {
        if (!reduced) {
          n.x += n.vx;
          n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
          // Neurons close to the pointer are drawn towards it and linked to it.
          if (pointer.active) {
            const dx = pointer.x - n.x;
            const dy = pointer.y - n.y;
            const d = Math.hypot(dx, dy);
            if (d < 170) {
              n.x += dx * 0.004;
              n.y += dy * 0.004;
              ctx.beginPath();
              ctx.moveTo(n.x, n.y);
              ctx.lineTo(pointer.x, pointer.y);
              ctx.strokeStyle = `rgba(${n.rgb}, ${(1 - d / 170) * 0.35})`;
              ctx.lineWidth = 0.8;
              ctx.stroke();
              if (d < 60) n.pulse = Math.max(n.pulse, 0.6);
            }
          }
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + n.pulse * 2.2, 0, Math.PI * 2);
        if (n.pulse > 0) {
          n.pulse = Math.max(0, n.pulse - 0.035);
          ctx.shadowBlur = 12;
          ctx.shadowColor = `rgb(${n.rgb})`;
        }
        ctx.fillStyle = `rgba(${n.rgb}, 0.95)`;
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      if (reduced) return;

      if (signals.length < 18 && Math.random() < 0.05) {
        const start = Math.floor(Math.random() * nodes.length);
        const path = pathFrom(start, 3 + Math.floor(Math.random() * 4));
        if (path.length > 1) {
          signals.push({ path, step: 0, t: 0, speed: 0.014 + Math.random() * 0.016, rgb: nodes[start].rgb, trail: [] });
        }
      }

      for (let s = signals.length - 1; s >= 0; s -= 1) {
        const sig = signals[s];
        const a = nodes[sig.path[sig.step]];
        const b = nodes[sig.path[sig.step + 1]];
        const x = a.x + (b.x - a.x) * sig.t;
        const y = a.y + (b.y - a.y) * sig.t;
        sig.trail.push({ x, y });
        if (sig.trail.length > 9) sig.trail.shift();

        if (sig.trail.length > 1) {
          ctx.beginPath();
          ctx.moveTo(sig.trail[0].x, sig.trail[0].y);
          for (let k = 1; k < sig.trail.length; k += 1) ctx.lineTo(sig.trail[k].x, sig.trail[k].y);
          ctx.strokeStyle = `rgba(${sig.rgb}, 0.9)`;
          ctx.lineWidth = 1.7;
          ctx.lineCap = 'round';
          ctx.shadowBlur = 10;
          ctx.shadowColor = `rgb(${sig.rgb})`;
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        ctx.beginPath();
        ctx.arc(x, y, 2.3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 12;
        ctx.shadowColor = `rgb(${sig.rgb})`;
        ctx.fill();
        ctx.shadowBlur = 0;

        sig.t += sig.speed;
        if (sig.t >= 1) {
          b.pulse = 1;
          sig.step += 1;
          sig.t = 0;
          if (sig.step >= sig.path.length - 1) signals.splice(s, 1);
        }
      }
    }

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) raf = requestAnimationFrame(loop);
    };
    const onMove = (e) => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; };
    const onLeave = () => { pointer.active = false; };

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    if (!reduced) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="neural-bg" aria-hidden="true">
      <div className="nb-image" />
      <div className="nb-orb nb-orb-a" />
      <div className="nb-orb nb-orb-b" />
      <canvas ref={canvasRef} className="nb-canvas" />
    </div>
  );
}
