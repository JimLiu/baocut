/* 轻量编辑器的标记（docs/design/lite-editor §4）：标注模式里画在画面上的一组标记——画笔、直线、箭头、矩形、圆、编号、文字，
   用「选择元素」点中的舞台元素（字幕、元素、HTML 动画里的节点），以及「评论」——点画面上任意位置落一枚印章、写一句话，点中了元素就连元素一起。
   window.BC_MARKUP。纯函数，无 React、无 DOM；只在 App 入口加载。

   与视频标注（model-stage-notes.js）的分工：这里是**画的过程**——一次标注会话里的标记、颜色与粗细、撤销重做、选中与改形；
   按「添加到对话」时整组换成视频标注（`toNotes`），进 `videoNotes[videoId]` 草稿，之后的事归 model-stage-notes。
   标记本身不带批注，要说的话写在对话里；文字标记的内容与评论的话才进批注。评论另带一张「有位置印章的截图」（`shot`：那一帧 + 印章位置，正式版由实现截图合成）。
   几何一律相对画面归一化（0–1，左上为原点）：{x, y, w, h} 是外接框；直线 / 箭头另带 `to`（终点，起点是 x, y）；画笔带 `points[]`；
   文字与编号只有一个点（w、h 为 0）；元素标记的框是元素在画面上的位置。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 颜色是 token 名（CSS 里映射到 S2 的色阶），不是色值；粗细是像素。默认红、4px。 */
  const COLORS = [
    {k: 'red', label: '红'}, {k: 'blue', label: '蓝'}, {k: 'green', label: '绿'}, {k: 'black', label: '黑'}, {k: 'white', label: '白'},
  ];
  const WIDTHS = [2, 4, 6, 8];
  /* 工具条：选择元素 / 评论 / 画笔 / 形状（下拉：直线、箭头、矩形、圆、编号）/ 文字 */
  const TOOLS = [
    {k: 'element', label: '选择元素', sk: '⇧⌘S'}, {k: 'comment', label: '评论', sk: '⇧⌘C'}, {k: 'pen', label: '画笔'}, {k: 'shape', label: '形状'}, {k: 'text', label: '文字'},
  ];
  const SHAPES = [
    {k: 'line', label: '直线'}, {k: 'arrow', label: '箭头'}, {k: 'rect', label: '矩形'}, {k: 'ellipse', label: '圆'}, {k: 'step', label: '编号'},
  ];
  const KIND_LABELS = {pen: '画笔', line: '直线', arrow: '箭头', rect: '矩形', ellipse: '圆', step: '编号', text: '文字', element: '元素', comment: '评论'};
  /** 没写字就发不出去的两种：文字标记、评论。 */
  const NEEDS_TEXT = {text: true, comment: true};
  const HISTORY_MAX = 50;
  const MIN_SIZE = 0.01;

  const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const round = v => Math.round(v * 1000) / 1000;
  let seq = 0;
  const newId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

  function init(over) {
    return {tool: 'pen', shape: 'rect', color: 'red', width: 4, marks: [], past: [], future: [], sel: null, ask: false, ...over};
  }

  const setTool = (s, tool) => ({...s, tool, sel: tool === s.tool ? s.sel : null});
  const setShape = (s, shape) => ({...s, shape, tool: 'shape', sel: null});

  /* 一次改动进历史：过去栈封顶 50，未来栈清空 */
  function commit(s, marks, sel = s.sel) {
    const past = [...s.past, s.marks].slice(-HISTORY_MAX);
    return {...s, marks, past, future: [], sel: sel != null && marks.some(m => m.id === sel) ? sel : null};
  }
  /** 颜色 / 粗细：改当前值；有选中的标记就连它一起改（进历史）。 */
  function setColor(s, color) {
    const next = {...s, color};
    return s.sel ? commit(next, s.marks.map(m => (m.id === s.sel ? {...m, color} : m))) : next;
  }
  function setWidth(s, width) {
    const next = {...s, width};
    return s.sel ? commit(next, s.marks.map(m => (m.id === s.sel ? {...m, width} : m))) : next;
  }

  function add(s, mark) {
    const m = {id: mark.id || newId(), color: s.color, width: s.width, ...mark};
    return commit(s, [...s.marks, m], m.id);
  }
  /** 改一条：默认进历史；拖动中的连续改动传 `{history: false}`，松手再 commit 一次。 */
  function update(s, id, patch, opts) {
    const marks = s.marks.map(m => (m.id === id ? {...m, ...patch} : m));
    return opts && opts.history === false ? {...s, marks} : commit(s, marks);
  }
  /** 拖动结束：拖的过程用 `{history: false}` 改过了，这里把拖前的那一版记进历史（没动就不记）。 */
  function finishDrag(s, id, orig) {
    const cur = s.marks.find(m => m.id === id);
    if (!cur || !orig || JSON.stringify(cur) === JSON.stringify(orig)) return s;
    return commit({...s, marks: s.marks.map(m => (m.id === id ? orig : m))}, s.marks, id);
  }
  const remove = (s, id) => (s.marks.some(m => m.id === id) ? commit(s, s.marks.filter(m => m.id !== id), null) : s);
  const clear = s => (s.marks.length ? commit(s, [], null) : s);
  const select = (s, id) => ({...s, sel: id != null && s.marks.some(m => m.id === id) ? id : null});
  const canUndo = s => s.past.length > 0;
  const canRedo = s => s.future.length > 0;
  function undo(s) {
    if (!canUndo(s)) return s;
    const marks = s.past[s.past.length - 1];
    return {...s, marks, past: s.past.slice(0, -1), future: [s.marks, ...s.future], sel: null};
  }
  function redo(s) {
    if (!canRedo(s)) return s;
    const marks = s.future[0];
    return {...s, marks, past: [...s.past, s.marks], future: s.future.slice(1), sel: null};
  }

  /** 能发出去的标记：没写字的文字标记与评论不算。 */
  const sendable = marks => (marks || []).filter(m => !NEEDS_TEXT[m.kind] || String(m.text || '').trim());
  /** 编号标记的序号：按加入顺序，从 1 起（撤销 / 删掉中间一枚后面的会重排）。 */
  function stepNumber(marks, id) {
    const steps = (marks || []).filter(m => m.kind === 'step');
    const i = steps.findIndex(m => m.id === id);
    return i < 0 ? null : i + 1;
  }

  /** 画面上的一次手势（像素）换成一条标记的几何：起点终点夹在画面内。 */
  function fromGesture(kind, from, to, frame, points) {
    const w = frame && frame.w > 0 ? frame.w : 1, h = frame && frame.h > 0 ? frame.h : 1;
    const a = {x: clamp01(from.x / w), y: clamp01(from.y / h)};
    const b = to ? {x: clamp01(to.x / w), y: clamp01(to.y / h)} : a;
    if (kind === 'rect' || kind === 'ellipse') {
      return {x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)), w: round(Math.abs(a.x - b.x)), h: round(Math.abs(a.y - b.y))};
    }
    if (kind === 'line' || kind === 'arrow') return {x: round(a.x), y: round(a.y), w: 0, h: 0, to: {x: round(b.x), y: round(b.y)}};
    if (kind === 'pen') {
      const pts = (points || [from]).map(p => ({x: round(clamp01(p.x / w)), y: round(clamp01(p.y / h))}));
      return {...bbox(pts), points: pts};
    }
    return {x: round(a.x), y: round(a.y), w: 0, h: 0};
  }
  function bbox(pts) {
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return {x: round(x0), y: round(y0), w: round(Math.max(...xs) - x0), h: round(Math.max(...ys) - y0)};
  }
  /** 外接框：直线 / 箭头按两端算，别的就是自己的框。 */
  function bounds(m) {
    if ((m.kind === 'line' || m.kind === 'arrow') && m.to) return bbox([{x: m.x, y: m.y}, m.to]);
    return {x: m.x, y: m.y, w: m.w || 0, h: m.h || 0};
  }

  /** 整条平移（归一化的 dx、dy），外接框不出画面。 */
  function move(m, dx, dy) {
    const b = bounds(m);
    const ddx = Math.min(1 - b.w - b.x, Math.max(-b.x, dx));
    const ddy = Math.min(1 - b.h - b.y, Math.max(-b.y, dy));
    const sh = p => ({x: round(p.x + ddx), y: round(p.y + ddy)});
    const next = {...m, ...sh(m)};
    if (m.to) next.to = sh(m.to);
    if (m.points) next.points = m.points.map(sh);
    return next;
  }

  /* 把手：矩形 / 圆八枚，直线 / 箭头两端；文字、编号、画笔、元素只能挪 */
  const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  function handles(m) {
    if (m.kind === 'rect' || m.kind === 'ellipse') {
      const cx = m.x + m.w / 2, cy = m.y + m.h / 2, r = m.x + m.w, bt = m.y + m.h;
      const at = {nw: [m.x, m.y], n: [cx, m.y], ne: [r, m.y], e: [r, cy], se: [r, bt], s: [cx, bt], sw: [m.x, bt], w: [m.x, cy]};
      return BOX_HANDLES.map(k => ({k, x: round(at[k][0]), y: round(at[k][1])}));
    }
    if ((m.kind === 'line' || m.kind === 'arrow') && m.to) return [{k: 'from', x: m.x, y: m.y}, {k: 'to', x: m.to.x, y: m.to.y}];
    return [];
  }
  /** 拖把手：矩形 / 圆按边改框（最小 1%，不出画面）；直线 / 箭头挪那一端。 */
  function resize(m, handle, dx, dy) {
    if (handle === 'from' || handle === 'to') {
      const p = handle === 'from' ? {x: m.x, y: m.y} : m.to;
      const q = {x: round(clamp01(p.x + dx)), y: round(clamp01(p.y + dy))};
      return handle === 'from' ? {...m, x: q.x, y: q.y} : {...m, to: q};
    }
    let x0 = m.x, y0 = m.y, x1 = m.x + m.w, y1 = m.y + m.h;
    if (handle.includes('w')) x0 = Math.min(clamp01(x0 + dx), x1 - MIN_SIZE);
    if (handle.includes('e')) x1 = Math.max(clamp01(x1 + dx), x0 + MIN_SIZE);
    if (handle.includes('n')) y0 = Math.min(clamp01(y0 + dy), y1 - MIN_SIZE);
    if (handle.includes('s')) y1 = Math.max(clamp01(y1 + dy), y0 + MIN_SIZE);
    return {...m, x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0)};
  }

  /* ---------- 选择元素 ---------- */
  const trim = (t, n = 24) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  /** 点中的舞台节点说成话。`info`：{kind: 'caption' | 'element' | 'html', id?, tag?, selector?, text?, name?, role?, w?, h?}。
      给人看的 `label`（跟界面语言）与给模型看的 `detail`（英文）分开，与幻灯片标注的 label / detail 同一分法。 */
  function elementLabel(info) {
    if (!info) return '';
    if (info.kind === 'caption') return `字幕${info.text ? ` · “${trim(info.text)}”` : ''}`;
    if (info.kind === 'element') return `元素${info.text ? ` · “${trim(info.text)}”` : info.id ? ` · ${info.id}` : ''}`;
    const size = info.w && info.h ? ` · ${Math.round(info.w)} × ${Math.round(info.h)}` : '';
    return `${info.selector || info.tag || 'HTML'}${size}`;
  }
  function elementDetail(info) {
    if (!info) return '';
    const text = info.text ? ` "${trim(info.text, 80)}"` : '';
    if (info.kind === 'caption') return `caption ${info.id || ''}${text}`.trim();
    if (info.kind === 'element') return `element ${info.id || ''}${text}`.trim();
    const bits = [`html ${info.selector || info.tag || ''}`.trim()];
    if (info.w && info.h) bits.push(`${Math.round(info.w)}×${Math.round(info.h)}`);
    if (info.name) bits.push(`name="${trim(info.name, 40)}"`);
    if (info.role) bits.push(`role=${info.role}`);
    if (text) bits.push(`text${text}`);
    return bits.join(' ');
  }

  /** 一条标记说成话（toast、列表）：「红色矩形」「编号 2」「字幕 · “…”」。 */
  function describe(m, marks) {
    if (m.kind === 'element') return elementLabel(m.element);
    if (m.kind === 'step') return `编号 ${stepNumber(marks || [m], m.id) || ''}`.trim();
    if (m.kind === 'text') return `文字 · “${trim(m.text)}”`;
    if (m.kind === 'comment') return `评论 · “${trim(m.text)}”`;
    const c = COLORS.find(x => x.k === m.color);
    return `${c ? c.label + '色' : ''}${KIND_LABELS[m.kind] || m.kind}`;
  }

  /* ---------- 换成视频标注 ---------- */
  const NOTE_KIND = {rect: 'box', step: 'pin'};
  /** 整组标记换成视频标注（model-stage-notes 的一条一条）：`base` 是这一帧共有的字段（video、revision、timeMs、segment、line），
      `labelOf(note)` 给每条起给人看的标签。文字标记与评论的内容进 `text`，别的 `text` 为空（说明写在对话里）；颜色与粗细进 `style`；
      评论另带 `shot`（截图：哪一帧、印章落在哪），正式版实现按它截那一帧并把印章画上去，作为消息的图片附件。 */
  function toNotes(marks, base, labelOf) {
    return sendable(marks).map(m => {
      const note = {id: m.id, ...base, kind: NOTE_KIND[m.kind] || m.kind, region: {x: m.x, y: m.y, w: m.w || 0, h: m.h || 0},
        style: {color: m.color, width: m.width}, text: NEEDS_TEXT[m.kind] ? String(m.text || '').trim() : ''};
      if (m.to) note.to = m.to;
      if (m.points) note.points = m.points;
      if (m.element) note.element = m.element;
      if (m.kind === 'comment') note.shot = {timeMs: base && base.timeMs != null ? base.timeMs : 0, stamp: {x: m.x, y: m.y}};
      if (labelOf) note.label = labelOf(note);
      return note;
    });
  }

  root.BC_MARKUP = {COLORS, WIDTHS, TOOLS, SHAPES, KIND_LABELS, BOX_HANDLES, init, setTool, setShape, setColor, setWidth, add, update, finishDrag, remove, clear, select,
    canUndo, canRedo, undo, redo, sendable, stepNumber, fromGesture, bounds, move, handles, resize, elementLabel, elementDetail, describe, toNotes};
})();
