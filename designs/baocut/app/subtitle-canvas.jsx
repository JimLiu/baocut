/* Canvas owns the pixels and RAF owns time. CSS only lays out the canvas. */
(function () {
  const WORDS = ['The', 'quick', 'brown', 'fox'];
  function paintSubtitleDemo(ctx, width, height, frame, options = {}) {
    /* @ds-allow: subtitle sample pixels, independent from application chrome. */
    const {active = '#635bff', plain = '#595650'} = options; const words = WORDS;
    const rgb = active.slice(1, 7).match(/.{2}/g).map(x => parseInt(x, 16));
    /* @ds-allow: contrasting ink inside the subtitle sample, shared with native renderer. */
    const contrast = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 > 140 ? '#0d0d0d' : '#ffffff';
    ctx.clearRect(0, 0, width, height);
    /* @ds-allow: fixed sample background is raster content, shared with native thumbnails. */
    ctx.fillStyle = '#f0f0f0'; ctx.fillRect(0, 0, width, height);
    ctx.font = '600 14px Arial, sans-serif';
    const gap = 4, widths = words.map((w) => ctx.measureText(w).width);
    const lineWidths = [widths[0] + widths[1] + gap, widths[2] + widths[3] + gap];
    const total = Math.max(...lineWidths);
    const fit = Math.min(1, (width - 20) / total);
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.scale(fit, fit);
    const transform = (p) => {
      const x = p.rx * Math.PI / 180, y = p.ry * Math.PI / 180, z = p.rz * Math.PI / 180;
      const sx = Math.sin(x), cx = Math.cos(x), sy = Math.sin(y), cy = Math.cos(y), sz = Math.sin(z), cz = Math.cos(z);
      ctx.translate(0, p.dy * 18);
      ctx.transform(p.scale * cy * cz, p.scale * (cx * sz + sx * sy * cz), -p.scale * cy * sz, p.scale * (cx * cz - sx * sy * sz), 0, 0);
      ctx.globalAlpha *= p.opacity;
    };
    transform(frame.block);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    words.forEach((word, i) => {
      const p = frame.words[i], w = widths[i], row = Math.floor(i / 2);
      const center = -lineWidths[row] / 2 + (i % 2 ? widths[i - 1] + gap : 0) + w / 2;
      const y = p.centered ? 0 : row * 20 - 10;
      ctx.save();
      if (p.blockScaled) { transform(p); ctx.translate(p.centered ? 0 : center, y); }
      else { ctx.translate(p.centered ? 0 : center, y); transform(p); }
      if (p.chip) {
        ctx.save(); ctx.globalAlpha *= p.chip.alpha; ctx.fillStyle = active;
        const bw = (w + 8) * p.chip.scale, bh = 20 * p.chip.scale;
        ctx.beginPath(); ctx.roundRect(-bw / 2, -bh / 2, bw, bh, Math.min(bh / 2, p.chip.corner_rounding * 14)); ctx.fill(); ctx.restore();
      }
      ctx.fillStyle = p.chip ? contrast : p.tint ? active : plain;
      ctx.fillText(word, 0, 0);
      ctx.restore();
    });
    ctx.restore();
  }
  function SubtitleCanvas({demo, playing = false, active}) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const el = ref.current, ctx = el.getContext('2d');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
      let raf = 0, visible = true, origin = performance.now();
      const draw = (now) => {
        const box = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
        if (el.width !== w || el.height !== h) {el.width = w; el.height = h;}
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const running = playing && visible && !reduced.matches && !document.hidden;
        paintSubtitleDemo(ctx, box.width, box.height, window.BC_SC.frame(demo, running ? (now - origin) / 1000 : 0.675), {active});
        if (running) raf = requestAnimationFrame(draw);
      };
      const restart = () => {cancelAnimationFrame(raf); origin = performance.now(); draw(origin);};
      const resize = new ResizeObserver(restart); resize.observe(el);
      const observer = new IntersectionObserver(([entry]) => {visible = entry.isIntersecting; restart();}); observer.observe(el);
      reduced.addEventListener('change', restart); document.addEventListener('visibilitychange', restart);
      restart();
      return () => {cancelAnimationFrame(raf); resize.disconnect(); observer.disconnect(); reduced.removeEventListener('change', restart); document.removeEventListener('visibilitychange', restart);};
    }, [demo, playing, active]);
    return <canvas ref={ref} className="subtitle-canvas" aria-hidden="true" />;
  }
  Object.assign(window, {SubtitleCanvas, paintSubtitleDemo});
})();
