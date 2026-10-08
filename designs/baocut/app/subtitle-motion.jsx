/* Production WASM renders these previews. This view only supplies a specimen
   and its clock; it does not duplicate text-motion formulas. */
(function () {
  let runtime;
  const load = () => runtime || (runtime = import(new URL('.runtime/subtitles/bcut_wasm_subtitle.js', location.href).href).then(async (m) => {
    await m.default();
    const names = ['NotoSansSC-Variable.ttf', 'Anton-Regular.ttf', 'Inter-Medium.ttf', 'Poppins-Black.ttf', 'RobotoMono-Medium.ttf', 'PlayfairDisplay-Italic.ttf', 'Oswald-Bold.ttf', 'PlayfairDisplay-Regular.ttf'];
    const fonts = await Promise.all(names.map(name => fetch(new URL('../.runtime/subtitles/fonts/' + name, new URL('app/subtitle-motion.jsx', location.href))).then(r => {if (!r.ok) throw Error('font unavailable'); return r.arrayBuffer();}).then(b => new Uint8Array(b))));
    return {m, fonts, names};
  }).catch(error => {runtime = null; throw error;}));
  function SubTextMotion({paint, text, fz = 16, t, dur = 4, loop = false, still = false, surface = false, timed = true}) {
    const ref = React.useRef(null), [ready, setReady] = React.useState(false), [box, setBox] = React.useState(null);
    const [visible, setVisible] = React.useState(false), [hovered, setHovered] = React.useState(false);
    const animate = loop && hovered && !window.subReduced;
    React.useEffect(() => {
      const observer = new IntersectionObserver(([entry]) => setVisible(!!entry.isIntersecting));
      if (ref.current) observer.observe(ref.current.parentElement);
      return () => observer.disconnect();
    }, []);
    const time = React.useRef(t), drawNow = React.useRef(null); time.current = t;
    React.useEffect(() => {if (drawNow.current) drawNow.current(performance.now());}, [t]);
    const encoded = JSON.stringify(paint);
    React.useEffect(() => {
      const canvas = ref.current;
      if (!canvas || !visible) return;
      let planner, disposed = false, raf = 0, origin = performance.now();
      setReady(false);
      load().then(({m, fonts, names}) => {
        if (disposed) return;
        const p = JSON.parse(encoded), native = Object.assign({}, p.nativeStyle || {}, {
          fontFamily: p.font, fontColor: p.color, bold: p.bold, italic: p.italic, fontWeight: p.weight,
          background: p.opacity > 0, backgroundColor: /^#[0-9a-f]{6}$/i.test(p.bg || '') ? p.bg + Math.round(Math.max(0, Math.min(100,p.opacity || 0)) * 2.55).toString(16).padStart(2,'0') : p.bg,
          borderRadius: (p.corners || 0) * 30 / 55, backgroundPadding: (p.pad || 0) * 42 / 80,
          lineHeight: (p.lh || 120) / 100, letterSpacing: (p.spacing || 0) * 30 / 100,
          textOutline: {on: p.outline, width: (p.outlineW || 0) * 1.25, color: p.outlineColor},
          dropShadow: {on: p.shadow, blur: (p.shBlur || 0) / 100, distance: (p.shDist || 0) / 100, rotation: p.shAngle || 0, color: p.shColor, opacity: p.nativeStyle?.dropShadow?.opacity ?? 1},
          textMotion: p.textMotion, wordBackground: p.wordBackground, mode: 'orig', tracks: [{role: 'source'}],
          fontSizeBasis: 'height', fontSize: surface ? 540 / 3 : 540 / 8, x: 50, y: 50, width: 94, verticalAlign: 'center',
          wordAnimation: {animationName: 'None'}, displayTiming: {leadIn: 0, tail: 0},
        });
        if (!timed && native.textMotion) { native.textMotion = Object.assign({}, native.textMotion); delete native.textMotion.emphasis; }
        canvas.width = Math.max(160, Math.round(canvas.clientWidth * 2)); canvas.height = Math.round(fz * (surface ? 6 : 16));
        const chosen = {'Anton':'Anton-Regular.ttf','Inter':'Inter-Medium.ttf','Poppins Black':'Poppins-Black.ttf','Roboto Mono':'RobotoMono-Medium.ttf','Playfair Display': p.italic ? 'PlayfairDisplay-Italic.ttf' : 'PlayfairDisplay-Regular.ttf','Oswald':'Oswald-Bold.ttf'}[p.font];
        planner = new m.SubtitlePreview(); planner.setFonts(fonts.filter((_,i) => i === 0 || names[i] === chosen)); planner.setCanvasSize(canvas.width, canvas.height);
        const words = String(text || '').split(/\s+/u).filter(Boolean);
        const doc = {meta: {duration: dur}, style: native, cues: [{id: 'sample', start: 0, end: dur, text,
          words: words.map((word, i) => ({id: 's' + i, text: word, t0: i * dur / Math.max(1, words.length), t1: (i + 1) * dur / Math.max(1, words.length)}))}], sentences: [], transCues: []};
        if (!surface) {
          planner.loadDocument(JSON.stringify({...doc, style: {...native, textMotion: null}}), dur, 30);
          const measure = planner.renderSubtitleRaster(Math.min(.675, dur / 2), undefined);
          setBox({height: Math.max(fz, measure.height / 2), top: measure.y / 2}); measure.free();
        }
        planner.loadDocument(JSON.stringify(doc), dur, 30);
        const ctx = canvas.getContext('2d');
        const draw = now => {
          if (disposed || !planner) return;
          const frame = planner.renderSubtitleRaster((still || (loop && !animate)) ? .675 : animate ? (now - origin) / 1000 % dur : Math.max(0, Math.min(dur - 1 / 30, time.current || 0)), undefined);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (frame.width) ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), frame.x, frame.y);
          frame.free(); setReady(true);
          if (animate && !still && !document.hidden) raf = requestAnimationFrame(draw);
        };
        drawNow.current = draw; draw(origin);
        if (loop && !animate) {planner.free(); planner = null; drawNow.current = null;}
      }).catch(error => {if (!disposed) {setReady(false); console.warn('Subtitle preview unavailable', error);}});
      return () => {disposed = true; drawNow.current = null; cancelAnimationFrame(raf); if (planner) planner.free();};
    }, [encoded, text, fz, dur, loop, still, timed, visible, animate, surface]);
    return <span onMouseEnter={() => {setVisible(true); setHovered(true);}} onMouseLeave={() => setHovered(false)} onFocus={() => {setVisible(true); setHovered(true);}} onBlur={() => setHovered(false)} className={'submotion-preview' + (surface ? ' submotion-preview--sample' : ' submotion-preview--stage')} style={{height: !surface && box ? box.height : fz * 3}}>
      <canvas ref={ref} style={{width: '100%', height: surface ? '100%' : fz * 8, position: surface ? undefined : 'absolute', top: !surface && box ? -box.top : 0, opacity: ready ? 1 : 0}} />
      {!ready && <span className="submotion-fallback" style={{fontSize: fz, color: paint.color, background: paint.opacity > 0 ? paint.bg : undefined, fontFamily: paint.stack}}>{text}</span>}
    </span>;
  }
  function SubTextMotionControls({paint, set}) {
    const motion = paint.textMotion || {};
    const [open, setOpen] = React.useState(null);
    const change = (stage, key, value) => set({textMotion: Object.assign({}, motion, {[stage]: Object.assign({}, motion[stage], {[key]: value})})});
    return <div className="sec">
      {['in', 'out', 'loop'].filter(stage => motion[stage]).map(stage => <React.Fragment key={stage}>
        <SecHead>{{in: '入场', out: '退场', loop: '循环'}[stage]}</SecHead>
        <ValueRow label="时长" value={motion[stage].durationSeconds} min={.01} max={3} step={.01} unit="s" onChange={v => change(stage, 'durationSeconds', v)} />
        <ValueRow label="错开间隔" value={motion[stage].staggerSeconds || 0} min={0} max={.5} step={.01} unit="s" onChange={v => change(stage, 'staggerSeconds', v)} />
        <ValueRow label="强度" value={motion[stage].intensity} min={0} max={2} step={.05} onChange={v => change(stage, 'intensity', v)} />
      </React.Fragment>)}
      {motion.emphasis && <>
        <PRow label="强调颜色"><ColorField inline value={motion.emphasis.color} open={open === 'emphasis'} onToggle={() => setOpen(open === 'emphasis' ? null : 'emphasis')}
          onPick={(color, live) => {change('emphasis', 'color', color); if (!live) setOpen(null);}} /></PRow>
        <ValueRow label="强调缩放" value={motion.emphasis.scale} min={.8} max={1.5} step={.01} onChange={v => change('emphasis', 'scale', v)} />
        <ValueRow label="时长" value={motion.emphasis.durationSeconds} min={.01} max={1} step={.01} unit="s" onChange={v => change('emphasis', 'durationSeconds', v)} />
      </>}
      {motion.karaoke && <>
        <PRow label="已唱颜色"><ColorField inline value={motion.karaoke.color} open={open === 'karaoke'} onToggle={() => setOpen(open === 'karaoke' ? null : 'karaoke')}
          onPick={(color, live) => {change('karaoke', 'color', color); if (!live) setOpen(null);}} /></PRow>
        <PRow label="引导点"><Switch on={!!motion.karaoke.guide} onChange={v => change('karaoke', 'guide', v)} /></PRow>
        <PRow label="预告下一句"><Switch on={!!motion.karaoke.nextLine} onChange={v => change('karaoke', 'nextLine', v)} /></PRow>
      </>}
      {paint.wordBackground && ['color', 'activeColor'].map(key => <PRow key={key} label={key === 'color' ? '词块颜色' : '当前词块'}>
        <ColorField inline value={paint.wordBackground[key]} open={open === key} onToggle={() => setOpen(open === key ? null : key)}
          onPick={(color, live) => {set({wordBackground: Object.assign({}, paint.wordBackground, {[key]: color})}); if (!live) setOpen(null);}} />
      </PRow>)}
    </div>;
  }
  Object.assign(window, {SubTextMotion, SubTextMotionControls});
})();
