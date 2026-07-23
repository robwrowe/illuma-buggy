import { useCallback, useEffect, useRef, useState } from 'react';
import { Box } from '@mantine/core';

const PAD = { top: 10, right: 10, bottom: 22, left: 28 };

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sortPoints(points) {
  return [...points].sort((a, b) => a[0] - b[0]);
}

/**
 * Canvas-based 0–255 transfer-curve editor.
 * Linear segments between control points; endpoints at x=0 and x=255 are locked on x.
 */
export function GradientCurveEditor({
  points,
  onChange,
  channelColor = '#888888',
  height = 180,
  disabled = false,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const dragRef = useRef(null); // { idx, pointerId }
  const ptsRef = useRef(points);

  useEffect(() => {
    ptsRef.current = points;
  }, [points]);

  const layout = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return null;
    const cssW = wrap.clientWidth || 320;
    const cssH = height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const plotW = cssW - PAD.left - PAD.right;
    const plotH = cssH - PAD.top - PAD.bottom;
    return { ctx, cssW, cssH, plotW, plotH };
  }, [height]);

  const toCanvas = useCallback((x, y, plotW, plotH) => ({
    cx: PAD.left + (x / 255) * plotW,
    cy: PAD.top + (1 - y / 255) * plotH,
  }), []);

  const fromCanvas = useCallback((cx, cy, plotW, plotH) => ({
    x: clamp(Math.round(((cx - PAD.left) / plotW) * 255), 0, 255),
    y: clamp(Math.round((1 - (cy - PAD.top) / plotH) * 255), 0, 255),
  }), []);

  const draw = useCallback(() => {
    const L = layout();
    if (!L) return;
    const { ctx, cssW, cssH, plotW, plotH } = L;
    const pts = sortPoints(ptsRef.current || []);

    ctx.clearRect(0, 0, cssW, cssH);

    // Plot background
    ctx.fillStyle = '#141418';
    ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

    // Grid every 32
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let v = 0; v <= 255; v += 32) {
      const { cx } = toCanvas(v, 0, plotW, plotH);
      const { cy } = toCanvas(0, v, plotW, plotH);
      ctx.beginPath();
      ctx.moveTo(cx, PAD.top);
      ctx.lineTo(cx, PAD.top + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD.left, cy);
      ctx.lineTo(PAD.left + plotW, cy);
      ctx.stroke();
    }

    // Identity reference
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.beginPath();
    const a = toCanvas(0, 0, plotW, plotH);
    const b = toCanvas(255, 255, plotW, plotH);
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Curve
    if (pts.length >= 2) {
      ctx.strokeStyle = channelColor;
      ctx.globalAlpha = disabled ? 0.35 : 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const { cx, cy } = toCanvas(x, y, plotW, plotH);
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Control points
    pts.forEach(([x, y], i) => {
      const { cx, cy } = toCanvas(x, y, plotW, plotH);
      const isEnd = x === 0 || x === 255;
      const active = i === hoverIdx || dragRef.current?.idx === i;
      ctx.beginPath();
      ctx.arc(cx, cy, active ? 6 : 5, 0, Math.PI * 2);
      ctx.fillStyle = disabled ? '#666' : channelColor;
      ctx.globalAlpha = disabled ? 0.4 : 1;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = active ? 2 : 1;
      ctx.stroke();
      if (active && !isEnd && !disabled) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(cx + 8, cy - 8, 12, 12);
        ctx.fillStyle = '#fff';
        ctx.font = '10px sans-serif';
        ctx.fillText('×', cx + 10, cy + 1);
      }
    });

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('0', PAD.left - 2, PAD.top + plotH + 14);
    ctx.fillText('255', PAD.left + plotW - 18, PAD.top + plotH + 14);
    ctx.fillText('255', 4, PAD.top + 8);
    ctx.fillText('in →', PAD.left + plotW / 2 - 10, cssH - 4);
  }, [channelColor, disabled, hoverIdx, layout, toCanvas]);

  useEffect(() => {
    draw();
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw, points]);

  const hitTest = (cx, cy, plotW, plotH) => {
    const pts = sortPoints(ptsRef.current || []);
    let best = -1;
    let bestD = 10;
    pts.forEach(([x, y], i) => {
      const p = toCanvas(x, y, plotW, plotH);
      const d = Math.hypot(p.cx - cx, p.cy - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const emit = (next) => {
    const sorted = sortPoints(next);
    ptsRef.current = sorted;
    onChange?.(sorted);
  };

  const onPointerDown = (e) => {
    if (disabled) return;
    const L = layout();
    if (!L) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const idx = hitTest(cx, cy, L.plotW, L.plotH);
    if (idx < 0) return;
    // Click on × delete region for non-endpoints
    const pts = sortPoints(ptsRef.current || []);
    const [px, py] = pts[idx];
    if (px !== 0 && px !== 255) {
      const p = toCanvas(px, py, L.plotW, L.plotH);
      if (cx >= p.cx + 8 && cx <= p.cx + 20 && cy >= p.cy - 8 && cy <= p.cy + 4) {
        emit(pts.filter((_, i) => i !== idx));
        setHoverIdx(-1);
        return;
      }
    }
    dragRef.current = { idx, pointerId: e.pointerId };
    canvasRef.current.setPointerCapture(e.pointerId);
    setHoverIdx(idx);
  };

  const onPointerMove = (e) => {
    const L = layout();
    if (!L) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (dragRef.current && !disabled) {
      const pts = sortPoints(ptsRef.current || []).map((p) => [...p]);
      const { idx } = dragRef.current;
      const { x, y } = fromCanvas(cx, cy, L.plotW, L.plotH);
      const isEnd = pts[idx][0] === 0 || pts[idx][0] === 255
        || idx === 0 || idx === pts.length - 1;
      if (isEnd || pts[idx][0] === 0 || pts[idx][0] === 255) {
        // Endpoints: lock x to 0 or 255
        if (pts[idx][0] === 0 || idx === 0) pts[idx] = [0, y];
        else pts[idx] = [255, y];
      } else {
        const lo = pts[idx - 1][0] + 1;
        const hi = pts[idx + 1][0] - 1;
        pts[idx] = [clamp(x, lo, hi), y];
      }
      emit(pts);
      return;
    }

    if (!disabled) setHoverIdx(hitTest(cx, cy, L.plotW, L.plotH));
  };

  const onPointerUp = (e) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      try { canvasRef.current?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
  };

  const onDoubleClick = (e) => {
    if (disabled) return;
    const L = layout();
    if (!L) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const { x, y } = fromCanvas(e.clientX - rect.left, e.clientY - rect.top, L.plotW, L.plotH);
    const pts = sortPoints(ptsRef.current || []).map((p) => [...p]);
    if (pts.some((p) => p[0] === x)) return;
    pts.push([x, y]);
    emit(pts);
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    if (disabled) return;
    const L = layout();
    if (!L) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const idx = hitTest(e.clientX - rect.left, e.clientY - rect.top, L.plotW, L.plotH);
    if (idx < 0) return;
    const pts = sortPoints(ptsRef.current || []);
    if (pts[idx][0] === 0 || pts[idx][0] === 255) return;
    emit(pts.filter((_, i) => i !== idx));
  };

  return (
    <Box
      ref={wrapRef}
      style={{
        width: '100%',
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
        cursor: disabled ? 'default' : 'crosshair',
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { if (!dragRef.current) setHoverIdx(-1); }}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      />
    </Box>
  );
}
