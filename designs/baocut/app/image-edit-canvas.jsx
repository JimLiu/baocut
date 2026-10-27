/* 工具 › 图片处理的画布（2026-10-27；规则在 model-image-edit.js）。
   - 放大：只显示原图与放大后的尺寸；
   - 去除物体、重绘：在图上涂抹（笔画半径按原图像素），可撤销一笔、清空；
   - 去水印：在图上拖框，可以框几处；批量时同一组框用于每一张（框按原图像素记，尺寸不同的图按比例换算）；
   - 扩图：新画布上按锚点放原图，新增的部分是棋盘格，四边标出加了多少像素。
   坐标一律是原图像素：叠在图上的 SVG 用原图尺寸做 viewBox，指针位置按显示框换算。本机文件真读像素尺寸；Space 里的条目按它记的分辨率，
   画面是示意块（交互原型不读条目的真文件）。 */
(function () {
  const {useRef, useState} = React;
  const E = window.BC_IMAGE_EDIT;

  /** 台面里图的大小：按比例，宽不超过台面、高不超过 456px（台面 480 减内边距） */
  const FRAME_MAX_H = 456;
  const fit = (w, h, maxH = FRAME_MAX_H) => ({aspectRatio: `${w} / ${h}`, width: `min(100%, ${Math.round((maxH * w) / h)}px)`});
  /** 放大只是看一眼原图，不在上面操作：台面矮一些 */
  const PEEK_MAX_H = 200;

  /** 原图：本机文件显示真图，Space 条目显示示意块 */
  function Picture({src}) {
    return src.url
      ? <img className="iecv__img" src={src.url} alt={src.name} draggable={false} />
      : <span className="iecv__img iecv__art" aria-label={src.name}><span className="t-detail-xs">{src.name}</span></span>;
  }

  /** 指针位置 → 原图像素 */
  function toImage(ev, el, src) {
    const box = el.getBoundingClientRect();
    const x = ((ev.clientX - box.left) / box.width) * src.width;
    const y = ((ev.clientY - box.top) / box.height) * src.height;
    return [Math.max(0, Math.min(src.width, Math.round(x))), Math.max(0, Math.min(src.height, Math.round(y)))];
  }

  /** 涂抹或框选的一层：`mode` 为 'brush' | 'box' */
  function SelectionLayer({src, mode, sel, setSel, brush}) {
    const ref = useRef(null);
    const drag = useRef(null);
    const [hover, setHover] = useState(null);
    const down = (ev) => {
      ev.currentTarget.setPointerCapture(ev.pointerId);
      const p = toImage(ev, ref.current, src);
      if (mode === 'brush') {
        drag.current = {kind: 'brush'};
        setSel({...sel, strokes: (sel.strokes || []).concat([{r: brush, pts: [p]}])});
      } else {
        drag.current = {kind: 'box', from: p};
        setSel({...sel, boxes: (sel.boxes || []).concat([{x: p[0], y: p[1], w: 0, h: 0}])});
      }
    };
    const move = (ev) => {
      const p = toImage(ev, ref.current, src);
      setHover(p);
      const d = drag.current;
      if (!d) return;
      if (d.kind === 'brush') {
        const strokes = sel.strokes.slice();
        const last = strokes[strokes.length - 1];
        strokes[strokes.length - 1] = {...last, pts: last.pts.concat([p])};
        setSel({...sel, strokes});
      } else {
        const boxes = sel.boxes.slice();
        boxes[boxes.length - 1] = {x: Math.min(d.from[0], p[0]), y: Math.min(d.from[1], p[1]), w: Math.abs(p[0] - d.from[0]), h: Math.abs(p[1] - d.from[1])};
        setSel({...sel, boxes});
      }
    };
    const up = () => {
      // 一下点击没拖出框：不留一个空框
      if (drag.current && drag.current.kind === 'box') setSel({...sel, boxes: sel.boxes.filter((b) => b.w > 4 && b.h > 4)});
      drag.current = null;
    };
    const path = (s) => s.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') + (s.pts.length === 1 ? ' l0.1 0' : '');
    return (
      <svg ref={ref} className={cx('iecv__sel', mode === 'box' && 'is-box')} viewBox={`0 0 ${src.width} ${src.height}`} preserveAspectRatio="none"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setHover(null)}
        role="img" aria-label={mode === 'brush' ? '在图上涂抹选区' : '在图上拖框'}>
        {(sel.strokes || []).map((s, i) => <path key={i} className="iecv__stroke" d={path(s)} strokeWidth={s.r * 2} />)}
        {(sel.boxes || []).map((b, i) => <rect key={i} className="iecv__box" x={b.x} y={b.y} width={b.w} height={b.h} />)}
        {mode === 'brush' && hover ? <>
          {/* 深浅两圈：亮图与暗图上都看得见笔刷边 */}
          <circle className="iecv__cursor iecv__cursor--dark" cx={hover[0]} cy={hover[1]} r={brush} />
          <circle className="iecv__cursor" cx={hover[0]} cy={hover[1]} r={brush} />
        </> : null}
      </svg>
    );
  }

  /** 批量去水印：第 2 张起按比例换算后的框，小图预览，比例不同的标出来 */
  function BatchPeek({first, others, sel}) {
    if (!others.length || !(sel.boxes || []).length) return null;
    const shown = others.slice(0, 4);
    return <div className="iecv__peek">
      {shown.map((o, i) => {
        const s = E.scaleSelection(sel, first, o);
        return <figure key={i} className="iecv__peekitem">
          <div className="iecv__frame" style={fit(o.width, o.height, 72)}>
            <Picture src={o} />
            <svg className="iecv__sel is-static" viewBox={`0 0 ${o.width} ${o.height}`} preserveAspectRatio="none" aria-hidden="true">
              {s.boxes.map((b, j) => <rect key={j} className="iecv__box" x={b.x} y={b.y} width={b.w} height={b.h} />)}
            </svg>
          </div>
          <figcaption className="t-detail-xs t-truncate">{o.name}{E.ratioDiffers(first, o) ? ' · 比例不同，框可能偏' : ''}</figcaption>
        </figure>;
      })}
      {others.length > shown.length ? <span className="t-detail-xs">还有 {others.length - shown.length} 张</span> : null}
    </div>;
  }

  /** 扩图的新画布：棋盘格是新增的部分，原图按锚点放 */
  function ExpandStage({src, plan}) {
    const pct = (n, of) => `${(n / of) * 100}%`;
    return (
      <div className="iecv__frame iecv__frame--expand checker" style={fit(plan.width, plan.height)}>
        <div className="iecv__placed" style={{left: pct(plan.x, plan.width), top: pct(plan.y, plan.height), width: pct(src.width, plan.width), height: pct(src.height, plan.height)}}>
          <Picture src={src} />
        </div>
        {['left', 'top', 'right', 'bottom'].map((side) => plan.added[side] > 0
          ? <span key={side} className={`iecv__add iecv__add--${side} t-detail-xs t-mono`}>+{plan.added[side]}</span> : null)}
      </div>
    );
  }

  /** 画布：按工具决定是只看、涂抹、框选还是扩图预览；下面一行是工具条与尺寸 */
  function EditCanvas({op, src, sel, setSel, form, set, others = []}) {
    const o = E.opById(op);
    const stats = o.select ? E.selectionStats(sel, src) : null;
    const plan = op === 'expand' ? E.expandPlan(src, form) : null;
    const undo = () => {
      const key = o.select === 'brush' ? 'strokes' : 'boxes';
      setSel({...sel, [key]: (sel[key] || []).slice(0, -1)});
    };
    const count = o.select === 'brush' ? (sel.strokes || []).length : (sel.boxes || []).length;
    const roi = stats && form.method === 'model' ? E.workArea(stats.box, src) : null;
    const up = op === 'upscale' ? E.upscaleSize(src, form.scale, form.model) : null;
    const addPreset = (p) => setSel({...sel, boxes: (sel.boxes || []).concat([p.box(src.width, src.height)])});
    return (
      <div className="iecv">
        <div className={cx('iecv__stage', up && 'iecv__stage--peek')}>
          {plan && !plan.same ? <ExpandStage src={src} plan={plan} /> : (
            <div className="iecv__frame" style={fit(src.width, src.height, up ? PEEK_MAX_H : FRAME_MAX_H)}>
              <Picture src={src} />
              {o.select ? <SelectionLayer src={src} mode={o.select} sel={sel} setSel={setSel} brush={form.brush} /> : null}
            </div>
          )}
        </div>
        <div className="iecv__bar">
          <span className="t-detail-xs t-mono">{src.width}×{src.height}</span>
          {up ? <span className="t-detail-xs">→ {up.width}×{up.height}</span> : null}
          {plan && !plan.same ? <span className="t-detail-xs">→ {plan.width}×{plan.height}</span> : null}
          {o.select === 'brush' ? (
            <span className="iecv__brush">
              <span className="t-detail-xs">笔刷</span>
              <Slider value={form.brush} min={8} max={160} step={4} onChange={(v) => set({brush: v})} aria-label="笔刷大小" />
              <span className="t-detail-xs t-mono">{form.brush * 2} px</span>
            </span>
          ) : null}
          <span className="grow" />
          {stats ? <span className="t-detail-xs">选区约占画面 {Math.max(1, Math.round(stats.coverage * 100))}%{roi ? ` · 送去修补的一块 ${roi.w}×${roi.h}` : ''}</span> : null}
          {o.select ? <>
            <Btn size="s" variant="quiet" icon="undo" disabled={!count} onClick={undo}>{o.select === 'brush' ? '撤销一笔' : '去掉上一个框'}</Btn>
            <Btn size="s" variant="quiet" disabled={!count} onClick={() => setSel({strokes: [], boxes: []})}>清空</Btn>
          </> : null}
        </div>
        {o.select && !count ? <span className="t-detail-xs iecv__hint">{o.select === 'brush'
          ? `按住拖动，把要${op === 'repaint' ? '重绘' : '去掉'}的地方涂满；边缘多涂一点更自然。`
          : '在水印上拖一个框；有几处就框几处。也可以点下面的常见位置。'}</span> : null}
        {o.select === 'box' ? <div className="vw__chips" role="group" aria-label="常见的水印位置">
          {E.BOX_PRESETS.map((p) => <Chip key={p.k} pill icon="plus" onClick={() => addPreset(p)}>{p.label}</Chip>)}
        </div> : null}
        {o.select === 'box' ? <BatchPeek first={src} others={others} sel={sel} /> : null}
      </div>
    );
  }

  Object.assign(window, {ImageEditCanvas: EditCanvas});
})();
