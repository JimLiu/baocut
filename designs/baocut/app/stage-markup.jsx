/* 标记层与工具条（docs/design/lite-editor §4；模型在 model-markup.js）：轻量与时间线两种视图同一套，stage.jsx 挂。App 与 Web 两个入口都加载：
   App（`BC_SURFACE.agent`）最后「添加到对话」；Web 没有会话可发，是截图模式（§4.1、§8）——没有评论，「添加到对话」换成
   复制图片 / 下载图片（原型只出提示示意，不真的出图），出了图就清掉这一帧的标记；选择元素的框连标签一起画进图里。
   标注模式下铺在画面（`.frame`）上：画笔、直线、箭头、矩形、圆、编号、文字画在一张按像素定位的 SVG 里，文字、元素框与评论印章是 HTML；
   任何工具下按在已有标记上都是选中并拖动（矩形 / 圆有八枚把手，直线 / 箭头两端各一枚），按在空处才按当前工具画。
   「选择元素」与「评论」把指针下的舞台节点（字幕 `[data-subs]`、元素 `[data-el]`，HTML 动画里就是那个节点）照 DevTools 的样子高亮并出一张小卡；
   点一下，选择元素记一条元素标记，评论落一枚印章并打开批注框（点中了元素就连元素一起）。
   工具条浮在画面底上，两行：主工具条是工具、撤销 / 重做、标记过的帧、「添加到对话」（整组换成视频标注进 composer 草稿）、关闭（有标记先问一句）；
   底下隔 2px 贴一条副工具条，左端与主工具条对齐，放当前工具的属性（形状的一排、文字的粗斜下划线 / 字号 / 字体），竖线右边是颜色与粗细。 */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const MK = window.BC_MARKUP;
  const N = window.BC_STAGE_NOTES;
  const T = window.BC_TIME;
  const L = window.BC_LITE;
  /* 这一组标记的用法：只看表面能不能交给 Agent（Web 不能，是截图模式） */
  const MODE = window.BC_SURFACE && !window.BC_SURFACE.agent ? 'screenshot' : 'agent';

  /* 形状与粗细的小图标：S2 没有直线 / 矩形 / 圆 / 箭头 / 编号的图标，用 currentColor 画几笔。
     形状的做成 S2 图标（createIcon）放进按钮的图标槽，和别的图标钮一样大小、一样的内边距；裸 svg 会被当成文字标签加左右内边距。 */
  const shapeIcon = draw => window.RSP.createIcon(props => <svg {...props} viewBox="0 0 16 16" className={cx(props.className, 'mk-glyph')}>{draw}</svg>);
  const SHAPE_ICON = {
    line: shapeIcon(<path d="M3 13 L13 3" />),
    arrow: shapeIcon(<path d="M3 13 L13 3 M7 3 H13 V9" />),
    rect: shapeIcon(<rect x="3" y="4" width="10" height="8" />),
    ellipse: shapeIcon(<ellipse cx="8" cy="8" rx="6" ry="4.5" />),
    step: shapeIcon(<><circle cx="8" cy="8" r="6" /><text x="8" y="10.5" className="mk-glyph__n">1</text></>),
  };
  const ShapeGlyph = ({k}) => { const I = SHAPE_ICON[k] || SHAPE_ICON.rect; return <I />; };
  /* 粗细的样本：一段这么粗的横线，圆头缩在框里（最粗的是一枚短胶囊）；下拉里的 `long` 更长一些 */
  const WidthGlyph = ({w, long}) => { const W = long ? 32 : 20; return <svg className={cx('mk-glyph', long ? 'mk-glyph--long' : 'mk-glyph--wide')} viewBox={`0 0 ${W} 16`} aria-hidden="true"><path d={`M${2 + w / 2} 8 H${W - 2 - w / 2}`} style={{strokeWidth: w}} /></svg>; };
  /** 文字标记的样式落到 DOM：字号、粗体、斜体、下划线走内联，字体走 `data-font`（CSS 里给字族）。标记层与标注层同一套。 */
  const textLook = m => { const t = MK.textStyleOf(m); return {font: t.font, style: {fontSize: t.size, fontWeight: t.bold ? 700 : 400, fontStyle: t.italic ? 'italic' : 'normal', textDecorationLine: t.underline ? 'underline' : 'none'}}; };
  const TOOL_ICON = {element: 'Select', comment: 'Comment', pen: 'Edit', text: 'Text'};
  const IMPLICIT_ROLE = {BUTTON: 'button', A: 'link', IMG: 'img', H1: 'heading', H2: 'heading', H3: 'heading', H4: 'heading', INPUT: 'textbox', VIDEO: 'video', svg: 'img'};

  /** 指针下的舞台节点（document.elementsFromPoint，跳过标记层、标注层、画面自己的底与网格）：
      字幕归到 `[data-subs]`、元素归到 `[data-el]`，别的就是那个 HTML 节点（HTML 动画视频里的节点走这条）。给出它在画面上的像素框与说明。 */
  function pickAt(frame, clientX, clientY) {
    if (!frame) return null;
    const f = frame.getBoundingClientRect();
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el === frame || !frame.contains(el)) continue;
      if (el.closest('.mk, .stnotes, .frame__bg, .frame__grid')) continue;
      const sub = el.closest('[data-subs]');
      const node = sub || el.closest('[data-el]') || el;
      const r = node.getBoundingClientRect();
      const rect = {x: r.left - f.left, y: r.top - f.top, w: r.width, h: r.height};
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      let info;
      if (sub) info = {kind: 'caption', id: node.dataset.subs, text, anchor: `[data-subs="${node.dataset.subs}"]`};
      else if (node.dataset.el) info = {kind: 'element', id: node.dataset.el, text, anchor: `[data-el="${node.dataset.el}"]`};
      else {
        const tag = node.tagName.toLowerCase();
        const cls = Array.from(node.classList).slice(0, 2).map(c => '.' + c).join('');
        info = {kind: 'html', tag, selector: `${tag}${node.id ? '#' + node.id : ''}${cls}`, w: r.width, h: r.height, text,
          name: node.getAttribute('aria-label') || text, role: node.getAttribute('role') || IMPLICIT_ROLE[node.tagName] || null, focusable: node.tabIndex >= 0};
      }
      return {rect, info: {...info, label: MK.elementLabel(info), detail: MK.elementDetail(info)}};
    }
    return null;
  }

  /** 这一组标记换成视频标注进 composer 草稿（store 的 `videoNotes[videoId]`）：一处标记一项，时刻是画它时的播放头，落点（段、句）按各自的时刻；
      给人看时同一帧的几处算一条（model-stage-notes.js 的 `groups`），`whereLabel` 留给那一条的说法。返回加进去的项数。 */
  function sendMarks(app, ctx, marks) {
    const videoId = ctx.proj.id;
    const whereAt = t => (ctx.noteContext ? ctx.noteContext(t / 1000) : {});
    const base = {video: videoId, revision: ctx.history?.revision ?? 0};
    const labelOf = n => {
      const ctxLabel = L ? L.contextLabel(whereAt(n.timeMs)) : '';
      return (n.element ? `${T.timecode(n.timeMs / 1000)} · ${n.element.label}` : N.label(n)) + (ctxLabel ? ` · ${ctxLabel}` : '');
    };
    const notes = MK.toNotes(marks, base, labelOf, whereAt).map(n => {
      const where = L ? L.contextLabel(whereAt(n.timeMs)) : '';
      return where ? {...n, whereLabel: where} : n;
    });
    let list = app.videoNotes[videoId] || [];
    let added = 0;
    for (const n of notes) {
      const r = N.add(list, n);
      if (r.error) { app.toast(r.error, 'negative'); break; }
      list = r.notes; added++;
    }
    if (added) { app.setVideoNotes(videoId, list); app.toast(`已添加到对话 · ${N.tokenLabel(list)}`); }
    return added;
  }

  /* ---------- 画面上的一条标记 ---------- */

  /** 箭头的头：顶在终点，大小跟粗细走；线身缩短一点免得从头里戳出来。 */
  function arrowHead(a, b, w) {
    const len = 8 + w * 2, ang = Math.atan2(b.y - a.y, b.x - a.x);
    const p = (d, t) => `${b.x - d * Math.cos(ang + t)},${b.y - d * Math.sin(ang + t)}`;
    return {points: `${b.x},${b.y} ${p(len, 0.45)} ${p(len, -0.45)}`, end: {x: b.x - len * 0.6 * Math.cos(ang), y: b.y - len * 0.6 * Math.sin(ang)}};
  }
  /** 一条线、框、圆、画笔或编号：像素坐标画在画面大小的 SVG 里。标注层（stage-notes.jsx）用它画草稿里的标记，`hit={false}` 不出点选用的透明宽描边。 */
  function SvgMark({m, px, n, ghost, selected, hit = true}) {
    const p = px(m);
    const g = {'data-mark': ghost ? undefined : m.id, 'data-color': m.color, className: cx('mk__m mk-c', ghost && 'is-ghost', selected && 'is-sel'), style: {'--mkw': m.width}};
    if (m.kind === 'rect') return <g {...g}><rect className="mk__stroke" x={p.x} y={p.y} width={p.w} height={p.h} rx="2" />{hit ? <rect className="mk__hit" x={p.x} y={p.y} width={p.w} height={p.h} /> : null}</g>;
    if (m.kind === 'ellipse') return <g {...g}><ellipse className="mk__stroke" cx={p.x + p.w / 2} cy={p.y + p.h / 2} rx={p.w / 2} ry={p.h / 2} />{hit ? <ellipse className="mk__hit" cx={p.x + p.w / 2} cy={p.y + p.h / 2} rx={p.w / 2} ry={p.h / 2} /> : null}</g>;
    if (m.kind === 'line' || m.kind === 'arrow') {
      const b = px({x: m.to.x, y: m.to.y});
      const head = m.kind === 'arrow' ? arrowHead(p, b, m.width) : null;
      const e = head ? head.end : b;
      return <g {...g}><line className="mk__stroke" x1={p.x} y1={p.y} x2={e.x} y2={e.y} />{head ? <polygon className="mk__fill" points={head.points} /> : null}{hit ? <line className="mk__hit" x1={p.x} y1={p.y} x2={b.x} y2={b.y} /> : null}</g>;
    }
    if (m.kind === 'pen') {
      const pts = (m.points || []).map(q => { const r = px(q); return `${r.x},${r.y}`; }).join(' ');
      return <g {...g}><polyline className="mk__stroke" points={pts} />{hit ? <polyline className="mk__hit" points={pts} /> : null}</g>;
    }
    if (m.kind === 'step') return <g {...g}><circle className="mk__fill mk__step" cx={p.x} cy={p.y} r="12" /><text className="mk__n" x={p.x} y={p.y}>{n}</text>{hit ? <circle className="mk__hit mk__step-hit" cx={p.x} cy={p.y} r="16" /> : null}</g>;
    return null;
  }

  /** 文字标记：一块可编辑的字，没字时显示占位；Enter / 失焦提交，空的就去掉。 */
  function TextMark({m, px, editing, onInput, onCommit}) {
    const ref = useRef(null);
    const p = px(m);
    useEffect(() => { const el = ref.current; if (el && el.textContent !== (m.text || '')) el.textContent = m.text || ''; }, [m.id, editing]);
    useEffect(() => {
      const el = ref.current;
      if (!editing || !el) return;
      el.focus();
      const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
    }, [editing]);
    const look = textLook(m);
    return <div ref={ref} className="mk__text mk-c" data-mark={m.id} data-color={m.color} data-font={look.font} data-empty={!m.text ? 'true' : undefined} data-placeholder="输入文字"
      contentEditable={editing ? 'true' : 'false'} suppressContentEditableWarning role={editing ? 'textbox' : undefined} aria-label="文字标记"
      style={{left: p.x, top: p.y, ...look.style}}
      onInput={e => onInput(e.currentTarget.textContent)} onBlur={() => { if (editing) onCommit(); }}
      onKeyDown={e => { e.stopPropagation(); if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); } }} />;
  }

  /** 评论印章与它的批注框：印章是一枚带角的圆（写了字的实心），批注框列落点、输入框、「发给智能体」与发送。 */
  function CommentMark({m, px, open, where, initials, onOpen, onClose, onText, onSend, onKeep}) {
    const R = window.RSP;
    const anchor = useRef(null);
    const [toAgent, setToAgent] = useState(true);
    const p = px(m);
    const text = String(m.text || '');
    const ok = !!text.trim();
    const submit = () => { if (!ok) return; if (toAgent) onSend(); else onKeep(); };
    return <div ref={anchor} className={cx('mk__cm', ok && 'has-text', open && 'is-open')} data-mark={m.id} style={{left: p.x, top: p.y}}>
      <span className="mk__stamp" aria-label={ok ? `评论：${text}` : '评论'}>{initials}</span>
      <Popover open={open} onClose={onClose} anchorRef={anchor} dir="right" width={320} label="评论">
        <div className="mk-cm" onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}>
          <p className="mk-cm__where" title={where}>{where}</p>
          <R.TextArea aria-label="评论" placeholder="要怎么改？" value={text} onChange={onText} autoFocus UNSAFE_className="mk-cm__input" />
          <div className="mk-cm__foot">
            <Checkbox on={toAgent} onChange={setToAgent} label="发给智能体" />
            <IconBtn size="s" tip={toAgent ? '发送 · ⌘Enter' : '留在画面上'} disabled={!ok} onClick={submit}><R.Icons.Send /></IconBtn>
          </div>
        </div>
      </Popover>
    </div>;
  }

  /** 选择元素 / 评论工具下，指针悬停的节点：高亮它的框，底下（放不下就上面）一张卡写选择器、尺寸与可访问性，照 DevTools 的样子。 */
  function HoverCard({hit, frame, brief}) {
    const {rect, info} = hit;
    const below = rect.y + rect.h + 72 < frame.h;
    const style = {left: Math.max(0, Math.min(rect.x, frame.w - 260)), top: below ? rect.y + rect.h + 6 : rect.y >= 80 ? rect.y - 80 : rect.y + 6};
    const name = info.kind === 'html' ? info.name : info.text;
    return <>
      <div className="mk__hl" style={{left: rect.x, top: rect.y, width: rect.w, height: rect.h}} aria-hidden="true" />
      <div className="mk__card" style={style} role="status">
        <div className="mk__card-sel">{info.kind === 'html' ? info.selector : info.label}<span className="mk__card-size">{Math.round(rect.w)} × {Math.round(rect.h)}</span></div>
        {!brief && info.kind === 'html' ? <>
          <div className="mk__card-h">可访问性</div>
          <div className="mk__card-row"><span>名称</span><span className="t-truncate">{name || '—'}</span></div>
          <div className="mk__card-row"><span>角色</span><span>{info.role || '—'}</span></div>
          <div className="mk__card-row"><span>键盘可聚焦</span><span>{info.focusable ? '✓' : '—'}</span></div>
        </> : null}
        {!brief && info.kind !== 'html' ? <div className="mk__card-row"><span>{info.kind === 'caption' ? '字幕' : '元素'}</span><span className="t-truncate">{info.text || info.id}</span></div> : null}
      </div>
    </>;
  }

  /* ---------- 标记层 ---------- */

  /** 画面上的标记层：按像素画这一组标记，接手势。状态在 editor.jsx（`ctx.markup` / `ctx.setMarkup`），切视图不丢。 */
  /** 画面（`.frame`）的像素尺寸：标记层与标注层（stage-notes.jsx）都按它把归一化坐标换成像素。 */
  function useFrameSize(frameRef) {
    const [size, setSize] = useState({w: 0, h: 0});
    useLayoutEffect(() => {
      const el = frameRef.current;
      if (!el) return undefined;
      const read = () => { const r = el.getBoundingClientRect(); setSize({w: r.width, h: r.height}); };
      read();
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }, [frameRef.current]);
    return size;
  }

  function MarkupLayer({ctx, frameRef}) {
    const app = useApp();
    const st = ctx.markup;
    const set = ctx.setMarkup;
    const size = useFrameSize(frameRef);
    const [drag, setDrag] = useState(null);       // 正在画的那一笔（像素）
    const [hover, setHover] = useState(null);     // 选择元素 / 评论工具下指针悬停的节点
    const [editing, setEditing] = useState(null); // 正在编辑的文字标记
    const [open, setOpen] = useState(null);       // 批注框开着的评论
    useEffect(() => { setHover(null); setOpen(null); }, [st.tool]);
    const tool = st.tool;
    const picking = tool === 'element' || tool === 'comment';
    const frame = {w: size.w || 1, h: size.h || 1};
    const at = e => { const b = frameRef.current.getBoundingClientRect(); return {x: e.clientX - b.left, y: e.clientY - b.top}; };
    const px = m => ({x: m.x * frame.w, y: m.y * frame.h, w: (m.w || 0) * frame.w, h: (m.h || 0) * frame.h});
    const initials = (app.user?.name || app.prefs?.userName || '我').split(/\s+/).map(s => s[0]).join('').slice(0, 2).toUpperCase();
    /* 此刻的播放头（毫秒）：新画的标记属于这一帧；画面上只画这一帧的（±0.5 s，同草稿标注） */
    const nowMs = Math.round(ctx.playT * 1000);
    const add = mark => set(s => MK.add(s, {timeMs: nowMs, ...mark}));
    const whereText = m => {
      const t = (m.timeMs || 0) / 1000;
      const where = ctx.noteContext ? ctx.noteContext(t) : {};
      const ctxLabel = L ? L.contextLabel(where) : '';
      return `${T.timecode(t)} · ${m.element ? m.element.label : `画面${N.place({x: m.x, y: m.y, w: 0, h: 0})}`}${ctxLabel ? ` · ${ctxLabel}` : ''}`;
    };

    const track = (e, onMove, onUp) => {
      const p0 = at(e);
      const move = ev => onMove(at(ev), p0);
      const up = ev => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onUp(at(ev), p0); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    const dn = (p, p0) => [(p.x - p0.x) / frame.w, (p.y - p0.y) / frame.h];
    /* 按下：把手 → 改形；已有标记 → 选中并拖动（松手没挪算点一下：文字进入编辑、评论打开批注框）；空处 → 按工具画 / 点 / 选元素 */
    const down = e => {
      if (e.button !== 0) return;
      const t = e.target;
      if (t.closest('[data-pop]')) return;
      const handle = t.closest('.mk__handle');
      const markEl = t.closest('[data-mark]');
      if (handle) {
        e.preventDefault(); e.stopPropagation();
        const id = st.sel, orig = st.marks.find(m => m.id === id);
        if (!orig) return;
        const k = handle.dataset.handle;
        track(e, (p, p0) => set(s => MK.update(s, id, MK.resize(orig, k, ...dn(p, p0)), {history: false})), () => set(s => MK.finishDrag(s, id, orig)));
        return;
      }
      if (markEl) {
        const id = markEl.dataset.mark;
        if (t.isContentEditable && editing === id) return;   // 正在编辑的文字：让它放光标
        e.preventDefault(); e.stopPropagation();
        const orig = st.marks.find(m => m.id === id);
        if (!orig) return;
        set(s => MK.select(s, id));
        setOpen(null);
        track(e, (p, p0) => set(s => MK.update(s, id, MK.move(orig, ...dn(p, p0)), {history: false})), (p, p0) => {
          if (Math.hypot(p.x - p0.x, p.y - p0.y) >= 4) { set(s => MK.finishDrag(s, id, orig)); return; }
          set(s => MK.update(s, id, orig, {history: false}));
          if (orig.kind === 'text') setEditing(id);
          if (orig.kind === 'comment') setOpen(id);
        });
        return;
      }
      e.preventDefault(); e.stopPropagation();
      setOpen(null);
      if (picking) {
        const hit = pickAt(frameRef.current, e.clientX, e.clientY);
        if (tool === 'element') {
          if (!hit) { set(s => MK.select(s, null)); return; }
          const box = MK.fromGesture('rect', hit.rect, {x: hit.rect.x + hit.rect.w, y: hit.rect.y + hit.rect.h}, frame);
          add({kind: 'element', ...box, element: hit.info});
          return;
        }
        const id = `c${Date.now().toString(36)}`;
        const box = hit ? MK.fromGesture('rect', hit.rect, {x: hit.rect.x + hit.rect.w, y: hit.rect.y + hit.rect.h}, frame) : null;
        add({id, kind: 'comment', ...MK.fromGesture('comment', at(e), null, frame), text: '', element: hit ? {...hit.info, box} : null});
        setOpen(id);
        return;
      }
      if (tool === 'text') {
        const id = `t${Date.now().toString(36)}`;
        add({id, kind: 'text', ...MK.fromGesture('text', at(e), null, frame), text: ''});
        setEditing(id);
        return;
      }
      const kind = tool === 'pen' ? 'pen' : st.shape;
      if (kind === 'step') { add({kind, ...MK.fromGesture(kind, at(e), null, frame)}); return; }
      const p0 = at(e), pts = [p0];
      set(s => MK.select(s, null));
      setDrag({kind, color: st.color, width: st.width, from: p0, to: p0, points: pts});
      track(e, p => { if (kind === 'pen') pts.push(p); setDrag(d => (d ? {...d, to: p, points: pts.slice()} : d)); }, p => {
        setDrag(null);
        const moved = kind === 'pen' ? pts.length >= 2 : Math.hypot(p.x - p0.x, p.y - p0.y) >= 4;
        if (moved) add({kind, ...MK.fromGesture(kind, p0, p, frame, pts)});
      });
    };
    const move = e => {
      if (!picking || drag) return;
      setHover(e.target.closest('[data-mark], .mk__handle') ? null : pickAt(frameRef.current, e.clientX, e.clientY));
    };

    /* 文字与评论的内容：输入中不进历史，提交时空的去掉 */
    const setText = (id, text) => set(s => MK.update(s, id, {text}, {history: false}));
    const commitText = id => { setEditing(null); set(s => { const m = s.marks.find(x => x.id === id); return m && String(m.text || '').trim() ? MK.update(s, id, {text: m.text.trim()}, {history: false}) : MK.remove(s, id); }); };
    const sendComment = id => {
      const m = st.marks.find(x => x.id === id);
      if (!m) return;
      setOpen(null);
      if (sendMarks(app, ctx, [m])) set(s => MK.remove(s, id));
    };
    const keepComment = id => { setOpen(null); app.toast('评论留在画面上 · 按「添加到对话」一起发'); };
    const closeComment = id => { setOpen(null); set(s => { const m = s.marks.find(x => x.id === id); return m && !String(m.text || '').trim() ? MK.remove(s, id) : s; }); };

    const shown = MK.onFrame(st.marks, nowMs);
    const sel = shown.find(m => m.id === st.sel) || null;
    const selBounds = sel && !['rect', 'ellipse', 'line', 'arrow'].includes(sel.kind) ? px(MK.bounds(sel)) : null;
    const ghost = drag ? {id: 'ghost', color: drag.color, width: drag.width, kind: drag.kind,
      ...MK.fromGesture(drag.kind, drag.from, drag.to, frame, drag.points)} : null;
    const cursorFor = {element: 'default', comment: 'default', text: 'text'};
    return <div className={cx('mk', drag && 'is-drawing')} data-tool={tool} style={{cursor: cursorFor[tool]}} onPointerDown={down} onPointerMove={picking ? move : undefined}
      onPointerLeave={() => setHover(null)} onClick={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <svg className="mk__svg" width={size.w} height={size.h} aria-hidden="true">
        {shown.map(m => <SvgMark key={m.id} m={m} px={px} n={m.kind === 'step' ? MK.stepNumber(st.marks, m.id) : null} selected={m.id === st.sel} />)}
        {ghost ? <SvgMark m={ghost} px={px} ghost /> : null}
      </svg>
      <div className="mk__html">
        {shown.map(m => {
          if (m.kind === 'text') return <TextMark key={m.id} m={m} px={px} editing={editing === m.id} onInput={t => setText(m.id, t)} onCommit={() => commitText(m.id)} />;
          if (m.kind === 'element') { const p = px(m); return <div key={m.id} className={cx('mk__el mk-c', m.id === st.sel && 'is-sel')} data-mark={m.id} data-color={m.color} style={{left: p.x, top: p.y, width: p.w, height: p.h}}>
            <span className="mk__el-label">{m.element?.label}</span></div>; }
          if (m.kind === 'comment') return <CommentMark key={m.id} m={m} px={px} open={open === m.id} where={whereText(m)} initials={initials}
            onClose={() => closeComment(m.id)} onText={t => setText(m.id, t)} onSend={() => sendComment(m.id)} onKeep={() => keepComment(m.id)} />;
          return null;
        })}
        {sel && sel.kind === 'comment' && sel.element?.box ? <div className="mk__hl is-static" style={{left: px(sel.element.box).x, top: px(sel.element.box).y, width: px(sel.element.box).w, height: px(sel.element.box).h}} aria-hidden="true" /> : null}
        {selBounds ? <div className="mk__sel" style={{left: selBounds.x - 4, top: selBounds.y - 4, width: selBounds.w + 8, height: selBounds.h + 8}} aria-hidden="true" /> : null}
        {sel ? MK.handles(sel).map(h => { const q = px(h); return <span key={h.k} className="mk__handle" data-handle={h.k} style={{left: q.x, top: q.y}} />; }) : null}
        {hover && !drag ? <HoverCard hit={hover} frame={frame} brief={tool === 'comment'} /> : null}
      </div>
    </div>;
  }

  /* ---------- 工具条 ---------- */

  function MarkupBar({ctx}) {
    const app = useApp();
    const R = window.RSP;
    const st = ctx.markup;
    const set = ctx.setMarkup;
    const [menu, setMenu] = useState(null);   // 'shape' | 'color' | 'width'
    const on = !!(ctx.annotating && st);
    const playRef = useRef(ctx.playT);
    playRef.current = ctx.playT;
    useEffect(() => { if (!on) setMenu(null); }, [on]);
    /* 工具条挂在 body 下（fixed，不受舞台 overflow 裁切）：舞台里只留一枚空锚点，按舞台的位置放——两行的底边离舞台底 12，
       主工具条对舞台居中（副工具条左端跟它对齐，不参与居中），比舞台宽时左右收进窗口 8 以内 */
    const anchorRef = useRef(null);
    const barRef = useRef(null);
    const [place, setPlace] = useState(null);
    useLayoutEffect(() => {
      const stage = anchorRef.current && anchorRef.current.parentElement;
      const bar = barRef.current;
      if (!on || !stage || !bar) return undefined;
      const update = () => {
        const r = stage.getBoundingClientRect();
        const half = bar.offsetWidth / 2;
        const left = Math.max(8 + half, Math.min(window.innerWidth - 8 - half, r.left + r.width / 2)) - half;
        setPlace({left, bottom: window.innerHeight - r.bottom + 12});
      };
      update();
      const ro = new ResizeObserver(update);
      ro.observe(stage); ro.observe(bar);
      window.addEventListener('resize', update);
      document.addEventListener('scroll', update, {capture: true, passive: true});
      return () => { ro.disconnect(); window.removeEventListener('resize', update); document.removeEventListener('scroll', update, {capture: true}); };
    }, [on]);
    /* 标注时的键（捕获阶段，先于 editor-keys.jsx 的全局键）：Esc 关闭、⌘Z / ⇧⌘Z 撤销重做、⌫ 删选中的、⇧⌘S 选择元素、⇧⌘C 评论。输入框与弹层开着时不接。 */
    useEffect(() => {
      if (!on) return undefined;
      const key = e => {
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('[data-pop], dialog[open], [role="dialog"][data-rac]')) return;
        const meta = e.metaKey || e.ctrlKey;
        const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        const stop = () => { e.preventDefault(); e.stopPropagation(); };
        if (k === 'Escape') { stop(); ctx.closeMarkup(); }
        else if (meta && k === 'z') { stop(); set(s => (e.shiftKey ? MK.redo(s) : MK.undo(s))); }
        else if (meta && e.shiftKey && (k === 's' || k === 'c') && MK.toolsFor(MODE).some(t => t.k === (k === 's' ? 'element' : 'comment'))) { const tool = k === 's' ? 'element' : 'comment'; stop(); set(s => MK.setTool(s, s.tool === tool ? 'pen' : tool)); }
        else if (k === 'Delete' || k === 'Backspace') { stop(); set(s => (s.sel && MK.onFrame(s.marks, Math.round(playRef.current * 1000)).some(m => m.id === s.sel) ? MK.remove(s, s.sel) : s)); }
      };
      window.addEventListener('keydown', key, true);
      return () => window.removeEventListener('keydown', key, true);
    }, [on]);
    if (!on) return null;
    const sendable = MK.sendable(st.marks);
    const reset = () => set(s => MK.init(MK.keep(s)));
    const send = () => { if (sendMarks(app, ctx, st.marks)) { reset(); ctx.setAnnotating(false); } };
    /* 截图模式：只出当前帧（播放头那一帧）上的标记；出了图就清掉这一帧的标记（别的帧的留着）、不退出（原型只出提示） */
    const nowMs = Math.round(ctx.playT * 1000);
    const onFrame = MK.sendable(MK.onFrame(st.marks, nowMs));
    const copyShot = () => { set(s => MK.forgetFrame(s, nowMs)); app.toast('已复制图片'); };
    const downloadShot = () => { set(s => MK.forgetFrame(s, nowMs)); app.toast(`已下载 ${MK.shotName(ctx.proj && ctx.proj.name, nowMs)}`); };
    /* 标记帧的书签（lite-editor §4.1）：画过标记的每一帧，点一项定位过去；播放头所在的那一帧打勾。时间线上的印章挤在一起时靠它挑 */
    const marked = MK.markedFrames(st.marks);
    const here = marked.find(f => Math.abs(f.timeMs - nowMs) <= 500);
    const toggle = k => setMenu(menu === k ? null : k);
    /* 带下拉的钮的面：当前值的样本 + 小箭头，并排一行（S2 的钮内部是网格，两个子节点会上下叠，所以先包成一个） */
    const Face = ({children}) => <span className="mk-bar__face">{children}<span className="mk-bar__chev" aria-hidden="true"><R.Icons.ChevronDown /></span></span>;
    /* 下拉里的一行：样本、名字（粗细只有样本，名字给读屏）、当前项打勾 */
    const Row = ({on: isOn, onClick, children, label, ariaLabel}) => <BCAction type="button" className={cx('mk-menu__row', isOn && 'is-on')} role="menuitemradio" aria-checked={isOn} aria-label={ariaLabel} onClick={onClick}>
      {children}<span className="mk-menu__label">{label}</span>{isOn ? <R.Icons.Checkmark /> : null}</BCAction>;
    const tools = MK.toolsFor(MODE);
    const toolLabel = k => tools.find(t => t.k === k)?.label || '';
    const shapeLabel = MK.SHAPES.find(sh => sh.k === st.shape)?.label || '';
    const ts = st.textStyle || MK.TEXT_STYLE;
    /* 一件工具：切换钮。形状钮只显示记住的那一种形状（没有下拉），按下就用它画；换形状在副工具条上 */
    const toolBtn = t => {
      if (t.k === 'shape') return <IconBtn key={t.k} size="s" on={st.tool === 'shape'} tip={`形状 · ${shapeLabel}`} onClick={() => set(s => MK.setTool(s, 'shape'))}><ShapeGlyph k={st.shape} /></IconBtn>;
      const I = R.Icons[TOOL_ICON[t.k]];
      return <IconBtn key={t.k} size="s" on={st.tool === t.k} tip={t.sk ? `${t.label} · ${t.sk}` : t.label} onClick={() => set(s => MK.setTool(s, t.k))}><I /></IconBtn>;
    };
    /* 副工具条左半：这件工具自己的属性（选择元素、评论、画笔没有） */
    const own = st.tool === 'shape' ? <div className="mk-bar__group">
      {MK.SHAPES.map(sh => <IconBtn key={sh.k} size="s" on={st.shape === sh.k} tip={sh.label} onClick={() => set(s => MK.setShape(s, sh.k))}><ShapeGlyph k={sh.k} /></IconBtn>)}
    </div> : st.tool === 'text' ? <div className="mk-bar__group">
      <IconBtn size="s" on={ts.bold} tip="粗体" onClick={() => set(s => MK.setTextStyle(s, {bold: !ts.bold}))}><R.Icons.TextBold /></IconBtn>
      <IconBtn size="s" on={ts.italic} tip="斜体" onClick={() => set(s => MK.setTextStyle(s, {italic: !ts.italic}))}><R.Icons.TextItalic /></IconBtn>
      <IconBtn size="s" on={ts.underline} tip="下划线" onClick={() => set(s => MK.setTextStyle(s, {underline: !ts.underline}))}><R.Icons.TextUnderline /></IconBtn>
      <div className="mk-bar__dd">
        <IconBtn size="s" tip={`字号 · ${ts.size}`} aria-haspopup="menu" aria-expanded={menu === 'size'} onClick={() => toggle('size')}><Face><R.Icons.TextSize /><span className="mk-bar__val">{ts.size}</span></Face></IconBtn>
        <Popover open={menu === 'size'} onClose={() => setMenu(null)} dir="up" width={100} label="字号" className="mk-pop">
          <div className="mk-menu" role="menu">{MK.FONT_SIZES.map(n => <Row key={n} on={ts.size === n} label={String(n)} onClick={() => { set(s => MK.setTextStyle(s, {size: n})); setMenu(null); }} />)}</div>
        </Popover>
      </div>
      <div className="mk-bar__dd">
        <IconBtn size="s" tip={`字体 · ${MK.FONTS.find(f => f.k === ts.font)?.label || ''}`} aria-haspopup="menu" aria-expanded={menu === 'font'} onClick={() => toggle('font')}>
          <Face><span className="mk-bar__val mk-font" data-font={ts.font}>{MK.FONTS.find(f => f.k === ts.font)?.label}</span></Face></IconBtn>
        <Popover open={menu === 'font'} onClose={() => setMenu(null)} dir="up" width={140} label="字体" className="mk-pop">
          <div className="mk-menu" role="menu">{MK.FONTS.map(f => <Row key={f.k} on={ts.font === f.k} onClick={() => { set(s => MK.setTextStyle(s, {font: f.k})); setMenu(null); }}><span className="mk-menu__label mk-font" data-font={f.k}>{f.label}</span></Row>)}</div>
        </Popover>
      </div>
    </div> : null;
    return <>
      <span ref={anchorRef} hidden />
      {ReactDOM.createPortal(<div className="mk-stack" style={place || {visibility: 'hidden'}}>
        <div ref={barRef} className="mk-bar" role="toolbar" aria-label="标记工具">
          <div className="mk-bar__group">{tools.filter(t => t.k !== 'text').map(toolBtn)}</div>
          <span className="vrule" />
          {toolBtn(tools.find(t => t.k === 'text'))}
          <span className="vrule" />
          <div className="mk-bar__group">
            <IconBtn size="s" tip="撤销 · ⌘Z" disabled={!MK.canUndo(st)} onClick={() => set(MK.undo)}><R.Icons.Undo /></IconBtn>
            <IconBtn size="s" tip="重做 · ⇧⌘Z" disabled={!MK.canRedo(st)} onClick={() => set(MK.redo)}><R.Icons.Redo /></IconBtn>
          </div>
          <span className="vrule" />
          <div className="mk-bar__dd">
            <IconBtn size="s" tip={marked.length ? `标记过的帧 · ${marked.length}` : '标记过的帧'} disabled={!marked.length} aria-haspopup="menu" aria-expanded={menu === 'marks'} onClick={() => toggle('marks')}>
              <Face><R.Icons.Bookmark /></Face></IconBtn>
            <Popover open={menu === 'marks' && marked.length > 0} onClose={() => setMenu(null)} dir="up" width={180} label="标记过的帧" className="mk-pop">
              <div className="mk-menu" role="menu">{marked.map(f => <Row key={f.timeMs} on={here === f} label={`${T.timecode(f.timeMs / 1000, {decimals: 1})} · ${f.count} 处标记`}
                onClick={() => { ctx.seek(f.timeMs / 1000); setMenu(null); }} />)}</div>
            </Popover>
          </div>
          <span className="vrule" />
          {MODE === 'screenshot' ? <div className="mk-bar__group">
            <IconBtn size="s" tip="复制图片" disabled={!onFrame.length} onClick={copyShot}><R.Icons.Copy /></IconBtn>
            <IconBtn size="s" tip="下载图片" disabled={!onFrame.length} onClick={downloadShot}><R.Icons.Download /></IconBtn>
          </div> : <R.Button variant="primary" size="S" isDisabled={!sendable.length} onPress={send} UNSAFE_className="mk-bar__send"><R.Text>添加到对话</R.Text></R.Button>}
          <IconBtn size="s" tip="关闭标记 · Esc" onClick={() => ctx.closeMarkup()}><R.Icons.Close /></IconBtn>
        </div>
        {/* 副工具条：当前工具的属性 ｜ 颜色、粗细（文字按字号、评论是印章，没有粗细） */}
        <div className="mk-bar mk-bar--sub" role="toolbar" aria-label={`${toolLabel(st.tool)} · 样式`}>
          {own}
          {own ? <span className="vrule" /> : null}
          <div className="mk-bar__dd">
            <IconBtn size="s" tip={`颜色 · ${MK.COLORS.find(c => c.k === st.color)?.label || ''}`} aria-haspopup="menu" aria-expanded={menu === 'color'} onClick={() => toggle('color')}>
              <Face><span className="mk-dot mk-c" data-color={st.color} /></Face></IconBtn>
            <Popover open={menu === 'color'} onClose={() => setMenu(null)} dir="up" width={140} label="颜色" className="mk-pop">
              <div className="mk-menu" role="menu">{MK.COLORS.map(c => <Row key={c.k} on={st.color === c.k} label={c.label} onClick={() => { set(s => MK.setColor(s, c.k)); setMenu(null); }}><span className="mk-dot mk-c" data-color={c.k} /></Row>)}</div>
            </Popover>
          </div>
          {MK.hasWidth(st.tool) ? <div className="mk-bar__dd">
            <IconBtn size="s" tip={`粗细 · ${st.width} px`} aria-haspopup="menu" aria-expanded={menu === 'width'} onClick={() => toggle('width')}><Face><WidthGlyph w={st.width} /></Face></IconBtn>
            <Popover open={menu === 'width'} onClose={() => setMenu(null)} dir="up" width={120} label="粗细" className="mk-pop">
              <div className="mk-menu" role="menu">{MK.WIDTHS.map(w => <Row key={w} on={st.width === w} ariaLabel={`${w} px`} onClick={() => { set(s => MK.setWidth(s, w)); setMenu(null); }}><WidthGlyph w={w} long /></Row>)}</div>
            </Popover>
          </div> : null}
        </div>
      </div>, document.body)}
      <ConfirmDialog ask={st.ask ? {title: '放弃这些标记？', body: MODE === 'screenshot' ? '关闭会去掉画面上的标记。需要的话先复制或下载图片。' : '画面上有还没添加到对话的标记，放弃会把它们去掉。', cancelLabel: '继续标记', confirmLabel: '放弃', tone: 'negative'} : null}
        onCancel={() => set(s => ({...s, ask: false}))} onConfirm={() => { reset(); ctx.setAnnotating(false); }} />
    </>;
  }

  // 画法也给标注层（stage-notes.jsx）用：一条标记的 SVG、文字标记的样式、画面尺寸
  Object.assign(window, {MarkupLayer, MarkupBar, BC_MARKUP_UI: {SvgMark, textLook, useFrameSize}});
})();
