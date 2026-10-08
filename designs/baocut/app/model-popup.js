(function () {
/** Window-space popup placement. Prefer the requested side; flip, then clamp. */
function popupPlacement(anchor, width, height, viewport, align = 'left', dir = 'down') {
  const margin = 8;
  const gap = 6;
  const w = Math.min(width, Math.max(0, viewport.width - margin * 2));
    const h = Math.min(height, Math.max(0, viewport.height - margin * 2));
    if (dir === 'right') {
      const x = anchor.right + gap + w <= viewport.width - margin
        ? anchor.right + gap : anchor.left - gap - w;
      return {left: Math.max(margin, Math.min(x, viewport.width - w - margin)),
        top: Math.max(margin, Math.min(anchor.top, viewport.height - h - margin))};
    }
  const down = anchor.bottom + gap;
  const up = anchor.top - gap - h;
  const downFits = down + h <= viewport.height - margin;
  const upFits = up >= margin;
  let side = dir;
  if (dir === 'down' && !downFits && upFits) side = 'up';
  if (dir === 'up' && !upFits && downFits) side = 'down';
  if (!downFits && !upFits) side = viewport.height - anchor.bottom >= anchor.top ? 'down' : 'up';
  return {
    left: Math.max(margin, Math.min(align === 'right' ? anchor.right - w : anchor.left, viewport.width - w - margin)),
    top: Math.max(margin, Math.min(side === 'up' ? up : down, viewport.height - h - margin)),
  };
}

  const api = {popupPlacement};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BC_POPUP = api;
})();
