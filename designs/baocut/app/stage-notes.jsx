/* 视频标注（product-design §3.2.3「视频标注」、§5.3）：编辑器预览画面上的标注层，与 composer 上方、已发送消息里的「视频标注 · N 条」。
   舞台工具条的「标注」打开标注模式（stage.jsx 的 StageBar）：画面上方出一条小工具条选种类（框 / 箭头 / 文字 / 编号），
   在画面上拖一个框、拖一条箭头，或点一个位置，批注框里写一句「添加到对话」，这一条进这部视频的草稿（store 的 `videoNotes[videoId]`），
   画面上出对应的标记。标记只画播放头附近那一帧的；别的时刻的在 composer 列表里，点一条跳到那个时刻。
   发送后草稿清空，标记随之消失。批注框用设计稿标签的那个（home-design.jsx 的 DesignNoteForm）。只在 App 入口加载。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const N = window.BC_STAGE_NOTES;
  const T = window.BC_TIME;

  const px = v => `${v * 100}%`;

  /* 画面上的一个标记：框是描边的矩形，箭头是一条带头的线，文字是一枚写着批注的签，编号是一枚圆点；都带整份草稿里的序号。
     点序号看批注，可以从对话里移除（草稿）；已发送的消息不画标记。 */
  function StageNoteMark({pin, onRemove}) {
    /* 轻量编辑器的标记工具送来的带 `style`（颜色、粗细）：按它的颜色画（stage-notes.css 的 .stnotes__mark[data-color]），别的仍是蓝 */
    return <div className="stnotes__mark" data-color={pin.style?.color} style={pin.style ? {'--stnw': pin.style.width} : undefined}><NoteMark pin={pin} onRemove={onRemove} /></div>;
  }
  function NoteMark({pin, onRemove}) {
    const R = window.RSP;
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    const r = pin.region;
    const badge = <span ref={anchor} className="stnotes__badge">
      <R.ActionButton size="XS" aria-label={`标注 ${pin.n}：${pin.text}`} onPress={() => setOpen(v => !v)}>{pin.n}</R.ActionButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={280} label={`标注 ${pin.n}`}>
        <div className="home-design__pin-note">
          <p className="home-design__form-label">{pin.label}</p>
          <p>{pin.text}</p>
          <R.ActionButton isQuiet size="S" onPress={() => { setOpen(false); onRemove(pin.id); }}><R.Icons.Delete /><R.Text>从对话中移除</R.Text></R.ActionButton>
        </div>
      </Popover>
    </span>;
    if (pin.kind === 'box') return <div className="stnotes__box" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}</div>;
    if (pin.kind === 'arrow') return <>
      <svg className="stnotes__arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={r.x * 100} y1={r.y * 100} x2={pin.to.x * 100} y2={pin.to.y * 100} vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="stnotes__head" style={{left: px(pin.to.x), top: px(pin.to.y)}} aria-hidden="true" />
      <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>
    </>;
    if (pin.kind === 'text') return <div className="stnotes__point stnotes__text" style={{left: px(r.x), top: px(r.y)}}>{badge}<span className="stnotes__label">{pin.text}</span></div>;
    /* 标记工具送来的：元素是一个虚线框（标签写它是谁），评论是一枚点（印章截图在 composer 列表里） */
    if (pin.kind === 'element') return <div className="stnotes__box stnotes__element" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}<span className="stnotes__label">{pin.element?.label}</span></div>;
    /* 轻量编辑器补的三种（docs/design/lite-editor §4）：直线是没有头的箭头，圆是画成椭圆的框，画笔是一条折线 */
    if (pin.kind === 'line') return <>
      <svg className="stnotes__arrow" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={r.x * 100} y1={r.y * 100} x2={pin.to.x * 100} y2={pin.to.y * 100} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>
    </>;
    if (pin.kind === 'ellipse') return <div className="stnotes__box stnotes__ellipse" style={{left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h)}}>{badge}</div>;
    if (pin.kind === 'pen') return <>
      <svg className="stnotes__arrow stnotes__pen" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={(pin.points || []).map(p => `${p.x * 100},${p.y * 100}`).join(' ')} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="stnotes__point" style={{left: px(pin.points?.[0]?.x ?? r.x), top: px(pin.points?.[0]?.y ?? r.y)}}>{badge}</div>
    </>;
    return <div className="stnotes__point" style={{left: px(r.x), top: px(r.y)}}>{badge}</div>;
  }
  const penPath = pts => pts.map(p => `${p.x},${p.y}`).join(' ');

  /** 画面（`.frame`）里的标注层：标记一直画（有草稿时），标注模式下再铺一层接手势。 */
  function StageNotesLayer({ctx, frameRef}) {
    const app = useApp();
    const R = window.RSP;
    const videoId = ctx.proj.id;
    const notes = app.videoNotes[videoId] || [];
    const annotating = !!ctx.annotating;
    const kind = ctx.noteKind || 'box';
    const [drag, setDrag] = useState(null);      // 进行中的手势（像素，相对画面）
    const [target, setTarget] = useState(null);  // 画完、还没写批注的那一条
    const anchor = useRef(null);
    const at = e => {
      const b = frameRef.current.getBoundingClientRect();
      return {x: e.clientX - b.left, y: e.clientY - b.top, w: b.width, h: b.height};
    };
    useEffect(() => { if (!annotating) { setDrag(null); setTarget(null); } }, [annotating]);
    // Esc 先关批注框，再退出标注模式
    useEffect(() => {
      if (!annotating) return undefined;
      const key = e => { if (e.key === 'Escape' && !e.defaultPrevented) { if (target) setTarget(null); else ctx.setAnnotating(false); } };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, [annotating, target]);
    const down = e => {
      if (e.button !== 0) return;
      // 批注框是这一层的子节点（弹层只是视觉上浮在顶层）：点进输入框不算在画面上起手，否则刚画的那一条会被当成「没拖出来」扔掉
      if (e.target.closest('.home-design__form, [popover]')) return;
      e.preventDefault(); e.stopPropagation();
      const p = at(e);
      const start = {kind, from: {x: p.x, y: p.y}, to: {x: p.x, y: p.y}, frame: {w: p.w, h: p.h}, points: [{x: p.x, y: p.y}]};
      const pts = start.points;
      setDrag(start); setTarget(null);
      const move = ev => {
        const q = at(ev);
        if (kind === 'pen') pts.push({x: q.x, y: q.y});
        setDrag(d => d ? {...d, to: {x: q.x, y: q.y}, points: pts.slice()} : d);
      };
      const up = ev => {
        window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
        const q = at(ev);
        const moved = kind === 'pen' ? pts.length >= 2 : Math.hypot(q.x - p.x, q.y - p.y) >= 4;
        const geo = N.normalize(kind, start.from, moved ? {x: q.x, y: q.y} : null, start.frame, pts);
        setDrag(null);
        const dragKinds = {box: '拖出一个框', arrow: '从起点拖到要指的地方', line: '从一头拖到另一头', ellipse: '拖出一个圆', pen: '在画面上画一道'};
        if (dragKinds[kind] && !moved) { app.toast(dragKinds[kind]); return; }
        /* 轻量编辑器（docs/design/lite-editor §4.3）：标注还记下落在哪一段、哪一句；时间线视图没有这一层，就只有时刻 */
        const where = ctx.noteContext ? ctx.noteContext(ctx.playT) : {};
        const note = {kind, ...geo, ...where, video: videoId, revision: ctx.history?.revision ?? 0, timeMs: Math.round(ctx.playT * 1000)};
        const ctxLabel = window.BC_LITE ? window.BC_LITE.contextLabel(where) : '';
        setTarget({...note, label: N.label(note) + (ctxLabel ? ` · ${ctxLabel}` : '')});
      };
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    };
    const add = text => {
      const next = N.add(notes, {id: crypto.randomUUID(), ...target, text});
      if (next.error) { app.toast(next.error, 'negative'); return; }
      app.setVideoNotes(videoId, next.notes);
      setTarget(null);
      app.toast(`已添加到对话 · ${N.tokenLabel(next.notes)}`);
    };
    const remove = id => app.setVideoNotes(videoId, N.remove(notes, id));
    const pins = N.pins(notes, videoId, ctx.playT);
    // 手势进行中的临时图形（像素）；画完的那一条在 target 里按归一化坐标画
    const ghost = drag ? (drag.kind === 'box' || drag.kind === 'ellipse'
      ? <div className={cx('stnotes__box is-ghost', drag.kind === 'ellipse' && 'stnotes__ellipse')} style={{left: Math.min(drag.from.x, drag.to.x), top: Math.min(drag.from.y, drag.to.y), width: Math.abs(drag.to.x - drag.from.x), height: Math.abs(drag.to.y - drag.from.y)}} />
      : drag.kind === 'arrow' || drag.kind === 'line' ? <svg className="stnotes__arrow is-ghost" aria-hidden="true"><line x1={drag.from.x} y1={drag.from.y} x2={drag.to.x} y2={drag.to.y} /></svg>
      : drag.kind === 'pen' ? <svg className="stnotes__arrow stnotes__pen is-ghost" aria-hidden="true"><polyline points={penPath(drag.points)} /></svg> : null) : null;
    const targetMark = target ? (target.kind === 'box' || target.kind === 'ellipse'
      ? <div ref={anchor} className={cx('stnotes__box is-ghost', target.kind === 'ellipse' && 'stnotes__ellipse')} style={{left: px(target.region.x), top: px(target.region.y), width: px(target.region.w), height: px(target.region.h)}} />
      : <span ref={anchor} className="stnotes__anchor" style={{left: px(target.to ? target.to.x : target.region.x), top: px(target.to ? target.to.y : target.region.y)}} />) : null;
    if (!notes.length && !annotating) return null;
    return <div className={cx('stnotes', annotating && 'is-annotating')} data-kind={kind} onMouseDown={annotating ? down : undefined} onClick={e => e.stopPropagation()}>
      {pins.map(pin => <StageNoteMark key={pin.id} pin={pin} onRemove={remove} />)}
      {ghost}
      {target?.kind === 'arrow' || target?.kind === 'line' ? <svg className="stnotes__arrow is-ghost" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1={target.region.x * 100} y1={target.region.y * 100} x2={target.to.x * 100} y2={target.to.y * 100} vectorEffect="non-scaling-stroke" /></svg> : null}
      {target?.kind === 'pen' ? <svg className="stnotes__arrow stnotes__pen is-ghost" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline points={target.points.map(p => `${p.x * 100},${p.y * 100}`).join(' ')} vectorEffect="non-scaling-stroke" /></svg> : null}
      {targetMark}
      {target ? <Popover open onClose={() => setTarget(null)} anchorRef={anchor} width={320} label="添加标注">
        <window.DesignNoteForm key={`${target.kind}@${target.region.x},${target.region.y}@${target.timeMs}`} target={target} onAdd={add} onCancel={() => setTarget(null)} />
      </Popover> : null}
    </div>;
  }

  /** 标注模式的小工具条（舞台顶上）：种类、提示、这一帧之外还有几条、完成。 */
  function StageNotesToolbar({ctx}) {
    const app = useApp();
    const R = window.RSP;
    /* 轻量视图有自己的标记工具条（editor-lite.jsx 的 LiteMarkupBar，列全七种），这一条只在时间线视图出 */
    if (!ctx.annotating || ctx.view === 'lite') return null;
    const kind = ctx.noteKind || 'box';
    const notes = app.videoNotes[ctx.proj.id] || [];
    const away = N.elsewhere(notes, ctx.proj.id, ctx.playT);
    const hint = N.KINDS.find(k => k.kind === kind)?.hint;
    return <div className="stnotes-bar" role="toolbar" aria-label="视频标注">
      <div className="stnotes-bar__kinds" role="radiogroup" aria-label="标注种类">
        {N.KINDS.filter(k => !k.lite).map(k => <R.ToggleButton key={k.kind} size="S" isQuiet isSelected={k.kind === kind} onChange={() => ctx.setNoteKind(k.kind)} aria-label={k.label}>
          <R.Text>{k.label}</R.Text></R.ToggleButton>)}
      </div>
      <span className="stnotes-bar__hint" role="status">{hint} · 在 {T.timecode(ctx.playT)} 这一帧{away ? ` · 另有 ${away} 条在别的时刻` : ''} · Esc 退出</span>
      <R.ActionButton size="S" onPress={() => ctx.setAnnotating(false)}><R.Text>完成</R.Text></R.ActionButton>
    </div>;
  }

  /* composer 上方与已发送消息里的「视频标注 · N 条」：画法与幻灯片、设计稿标注的标签一家。点开列出各条：时刻与位置、批注，
     点一条跳到那部视频的那个时刻。给了 `onRemove` 是草稿，可以逐条移除或全部移除；不给是已发送的消息，只读。 */
  function VideoNotesToken({notes, onRemove, onClear}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const anchor = useRef(null);
    if (!notes?.length) return null;
    const draft = !!onRemove;
    const jump = n => {
      setOpen(false);
      if (!app.projById(n.video)) { app.toast('这部视频已移走或删除', 'negative'); return; }
      app.openMovie(n.video, {t: n.timeMs / 1000});
    };
    return <div ref={anchor} className="cins-token home-slides-notes">
      <BCAction className="home-slides-notes__open" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(v => !v)}>
        <window.RSP.Icons.Comment /><span>{N.tokenLabel(notes)}</span>
      </BCAction>
      {draft ? <IconBtn icon="close" size="xs" tip="移除全部视频标注" onClick={onClear} /> : null}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={360} dir={draft ? 'up' : 'down'} label={N.tokenLabel(notes)}>
        <ol className="home-slides-notes__list bc-scroll">
          {notes.map((n, i) => <li key={n.id} className="home-slides-notes__item">
            <BCAction className="home-slides-notes__jump" aria-label={`第 ${i + 1} 条，${n.label}：${n.text}`} onClick={() => jump(n)}>
              <b className="home-slides-notes__n">{i + 1}</b>
              <span className="home-slides-notes__body"><small>{n.label}</small>{n.text ? <span>{n.text}</span> : null}
                {/* 评论的附件：那一帧带位置印章的截图（原型里画一块示意帧与印章，正式版是真截图） */}
                {n.shot ? <span className="stnotes__shot" role="img" aria-label={`截图 · ${T.timecode(n.shot.timeMs / 1000)} · 印章在画面${N.place({...n.shot.stamp, w: 0, h: 0})}`}>
                  <span className="stnotes__shot-stamp" style={{left: px(n.shot.stamp.x), top: px(n.shot.stamp.y)}} /></span> : null}</span>
            </BCAction>
            {draft ? <IconBtn icon="close" size="xs" tip={`移除第 ${i + 1} 条标注`} onClick={() => { if (notes.length === 1) setOpen(false); onRemove(n.id); }} /> : null}
          </li>)}
        </ol>
      </Popover>
    </div>;
  }

  Object.assign(window, {StageNotesLayer, StageNotesToolbar, VideoNotesToken});
})();
