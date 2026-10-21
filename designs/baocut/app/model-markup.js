/* 轻量编辑器的标记（docs/design/lite-editor §4）：标注模式里画在画面上的一组标记——画笔、直线、箭头、矩形、圆、编号、文字，
   用「选择元素」点中的舞台元素（字幕、元素、HTML 动画里的节点），以及「评论」——点画面上任意位置落一枚印章、写一句话，点中了元素就连元素一起。
   window.BC_MARKUP。纯函数，无 React、无 DOM；App 与 Web 两个入口都加载。

   两种用法（docs/design/lite-editor §4.1、§8）：`agent`（App）最后「添加到对话」换成视频标注；`screenshot`（Web，没有会话可发）
   没有评论，最后把当前帧连同这一帧的标记复制或下载成图片（`toolsFor`、`shotName`），出了图就清掉这一帧的标记（`forgetFrame`）。
   画过标记的帧在时间线章节条上落印章、工具条上列书签（`markedFrames`、`stamps`、`stampTarget`）。

   与视频标注（model-stage-notes.js）的分工：这里是**画的过程**——一次标注会话里的标记、颜色与粗细、撤销重做、选中与改形；
   文字标记另带样式（`bold` / `italic` / `underline` / `size` / `font`，`textStyleOf`）。
   按「添加到对话」时整组换成视频标注（`toNotes`），进 `videoNotes[videoId]` 草稿，之后的事归 model-stage-notes。
   标记本身不带批注，要说的话写在对话里；文字标记的内容与评论的话才进批注。每条标记属于画它时的那一帧（`timeMs`），只在那一帧上显示；
   发出时每一帧带一张截图（`shot`：那一帧 + 画上去的标记，评论另记印章位置，正式版由实现截图合成）。
   几何一律相对画面归一化（0–1，左上为原点）：{x, y, w, h} 是外接框；直线 / 箭头另带 `to`（终点，起点是 x, y）；画笔带 `points[]`；
   文字与编号只有一个点（w、h 为 0）；元素标记的框是元素在画面上的位置。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 颜色是 token 名（CSS 里映射到 S2 的色阶），不是色值；粗细是像素。默认红、4px。 */
  const COLORS = [
    {k: 'red', label: '红'}, {k: 'blue', label: '蓝'}, {k: 'green', label: '绿'}, {k: 'black', label: '黑'}, {k: 'white', label: '白'},
  ];
  const WIDTHS = [2, 4, 8, 12];
  /* 工具条：选择元素 / 评论 / 画笔 / 形状（副工具条上一排：直线、箭头、矩形、圆、编号）/ 文字 */
  const TOOLS = [
    {k: 'element', label: '选择元素', sk: '⇧⌘S'}, {k: 'comment', label: '评论', sk: '⇧⌘C'}, {k: 'pen', label: '画笔'}, {k: 'shape', label: '形状'}, {k: 'text', label: '文字'},
  ];
  /* 截图模式（Web）没有评论（没有会话可发）：选择元素 / 画笔 / 形状 / 文字；元素框连它的标签一起画进图里（2026-10-21 用户定） */
  const SCREENSHOT_TOOLS = ['element', 'pen', 'shape', 'text'];
  /** 这件工具有没有粗细：文字按字号、评论是一枚印章，都没有描边。副工具条上粗细只给有描边的工具。 */
  const hasWidth = tool => tool !== 'text' && tool !== 'comment';
  /** 这种用法下工具条上有哪些工具（按工具条的顺序）。 */
  const toolsFor = mode => (mode === 'screenshot' ? TOOLS.filter(t => SCREENSHOT_TOOLS.indexOf(t.k) >= 0) : TOOLS);
  /** 截图模式下载的文件名：`<视频名>-00m12s400.png`（播放头那一帧），满一小时前面加 `1h`；视频名去掉文件名里不能用的字符。 */
  function shotName(videoName, timeMs) {
    const ms = Math.max(0, Math.round(timeMs || 0));
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const h = Math.floor(ms / 3600000);
    const stem = String(videoName || '').replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'video';
    return `${stem}-${h ? `${h}h` : ''}${pad(Math.floor(ms / 60000) % 60)}m${pad(Math.floor(ms / 1000) % 60)}s${pad(ms % 1000, 3)}.png`;
  }
  const SHAPES = [
    {k: 'line', label: '直线'}, {k: 'arrow', label: '箭头'}, {k: 'rect', label: '矩形'}, {k: 'ellipse', label: '圆'}, {k: 'step', label: '编号'},
  ];
  /* 文字标记的样式（2026-10-21 用户定）：粗体 / 斜体 / 下划线、字号（S2 字号阶梯）、字体（三种通用字族，不点名具体字体：中文缺字形时各端自己回退） */
  const FONT_SIZES = [16, 20, 28, 36, 48];
  const FONTS = [{k: 'sans', label: '无衬线'}, {k: 'serif', label: '衬线'}, {k: 'mono', label: '等宽'}];
  const TEXT_STYLE = {bold: true, italic: false, underline: false, size: 20, font: 'sans'};
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
    return {tool: 'pen', shape: 'rect', color: 'red', width: 4, textStyle: TEXT_STYLE, marks: [], past: [], future: [], sel: null, ask: false, ...over};
  }
  /** 重开一组时留下的：上次的工具、形状、颜色、粗细与文字样式（这个窗口里一直记着）。 */
  const keep = s => ({tool: s.tool, shape: s.shape, color: s.color, width: s.width, textStyle: s.textStyle || TEXT_STYLE});

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
  /** 文字样式（`{bold}` / `{size: 28}` …）：改之后写的字；选中的是文字标记就连它一起改（进历史）。 */
  function setTextStyle(s, patch) {
    const next = {...s, textStyle: {...(s.textStyle || TEXT_STYLE), ...patch}};
    const sel = s.sel && s.marks.find(m => m.id === s.sel);
    return sel && sel.kind === 'text' ? commit(next, s.marks.map(m => (m.id === s.sel ? {...m, ...patch} : m))) : next;
  }
  /** 一条文字标记的样式：自己的字段，没有的按默认（早先的文字没有这些字段，字号跟粗细档走）。 */
  const OLD_TEXT_SIZE = {2: 16, 4: 20, 8: 28, 12: 36};
  const textStyleOf = m => ({...TEXT_STYLE, size: OLD_TEXT_SIZE[m.width] || TEXT_STYLE.size,
    ...Object.fromEntries(Object.keys(TEXT_STYLE).filter(k => m[k] != null).map(k => [k, m[k]]))});

  /** 加一条：`timeMs` 是画它时的播放头（这条标记属于那一帧），没给的在画面上算 0、发出时用 `toNotes` 的 base。 */
  function add(s, mark) {
    const m = {id: mark.id || newId(), color: s.color, width: s.width, ...(mark.kind === 'text' ? s.textStyle || TEXT_STYLE : null), ...mark};
    return commit(s, [...s.marks, m], m.id);
  }
  /** 这一帧上的标记：时刻离播放头 `nowMs` 不超过 `near` 毫秒的（同草稿标注在画面上的时间窗）。 */
  function onFrame(marks, nowMs, near = 500) {
    return marks.filter(m => Math.abs((m.timeMs || 0) - nowMs) <= near);
  }
  /** 这组标记涉及的帧（毫秒，升序去重）：每一帧出一张截图。 */
  function frames(marks) {
    return [...new Set(marks.map(m => m.timeMs || 0))].sort((a, b) => a - b);
  }
  /** 标记帧的书签（docs/design/lite-editor §4.1）：画过标记的每一帧与这一帧上的条数，按先后；±near 内的几刻算同一帧（从最早的那一刻量起），没写字的不算。 */
  function markedFrames(marks, near = 500) {
    const out = [];
    for (const m of sendable(marks).slice().sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0))) {
      const t = m.timeMs || 0, last = out[out.length - 1];
      if (last && t - last.timeMs <= near) last.count += 1;
      else out.push({timeMs: t, count: 1});
    }
    return out;
  }
  /** 时间线上的印章：`pos(timeMs)` 给出在整条上的位置（0–1）；离这一枚的第一帧不到 `minGapPx` 像素的帧并进来，印章上写帧数。 */
  function stamps(list, pos, widthPx, minGapPx = 20) {
    const out = [];
    for (const f of list) {
      const at = Math.min(1, Math.max(0, pos(f.timeMs)));
      const last = out[out.length - 1];
      if (last && (at - last.at) * widthPx < minGapPx) last.frames.push(f);
      else out.push({timeMs: f.timeMs, at, frames: [f]});
    }
    return out;
  }
  /** 点一枚印章去哪（毫秒）：不在它的帧上去第一帧，在其中一帧上去下一帧，到头回第一帧。 */
  function stampTarget(stamp, nowMs, near = 500) {
    const i = stamp.frames.findIndex(f => Math.abs(f.timeMs - nowMs) <= near);
    return stamp.frames[(i + 1) % stamp.frames.length].timeMs;
  }
  /** 出过图的这一帧：它上面的标记从画面与整段历史里拿掉（撤销不再带回来），别的帧的留着。 */
  function forgetFrame(s, nowMs) {
    const gone = new Set(onFrame(s.marks, nowMs).map(m => m.id));
    if (!gone.size) return s;
    const keep = list => list.filter(m => !gone.has(m.id));
    return {...s, marks: keep(s.marks), past: s.past.map(keep), future: s.future.map(keep), sel: s.sel && gone.has(s.sel) ? null : s.sel};
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
  /** 整组标记换成视频标注（model-stage-notes 的一条一条）：`base` 是共有的字段（video、revision），每条的时刻是它自己的 `timeMs`
      （画它时的播放头），落点（segment、line）由 `whereAt(timeMs)` 按各自的时刻给；`labelOf(note)` 给每条起给人看的标签。
      文字标记与评论的内容进 `text`，别的 `text` 为空（说明写在对话里）；颜色与粗细进 `style`；每条都带 `shot`（哪一帧的截图：
      同一帧的标记共一张，画面加上这一帧的标记），评论的另记印章落在哪；正式版实现按它截那一帧并把标记画上去，作为消息的图片附件。 */
  function toNotes(marks, base, labelOf, whereAt) {
    return sendable(marks).map(m => {
      const timeMs = m.timeMs != null ? m.timeMs : (base && base.timeMs != null ? base.timeMs : 0);
      const where = whereAt ? whereAt(timeMs) : {};
      const note = {id: m.id, ...base, timeMs, ...where, kind: NOTE_KIND[m.kind] || m.kind, region: {x: m.x, y: m.y, w: m.w || 0, h: m.h || 0},
        style: m.kind === 'text' ? {color: m.color, width: m.width, ...textStyleOf(m)} : {color: m.color, width: m.width}, text: NEEDS_TEXT[m.kind] ? String(m.text || '').trim() : ''};
      if (m.to) note.to = m.to;
      if (m.points) note.points = m.points;
      if (m.element) note.element = m.element;
      /* 那一帧的截图随这条标注走（正式版是真图：画着这一帧的标记，评论画印章，发送时作为附件、`shot.attachment` 记它的附件 id） */
      note.shot = m.kind === 'comment' ? {timeMs, stamp: {x: m.x, y: m.y}, file: `frame-${timeMs}.png`} : {timeMs, file: `frame-${timeMs}.png`};
      if (labelOf) note.label = labelOf(note);
      return note;
    });
  }

  /** 已进草稿的标注画回画面上用的标记（stage-notes.jsx）：`toNotes` 的反向，只取画它要用的字段；没有 `style` 的按蓝色 2px。 */
  const MARK_KIND = Object.fromEntries(Object.entries(NOTE_KIND).map(([k, v]) => [v, k]));
  function fromNote(n) {
    const m = {id: n.id, timeMs: n.timeMs, kind: MARK_KIND[n.kind] || n.kind, color: n.style?.color || 'blue', width: n.style?.width || 2,
      x: n.region.x, y: n.region.y, w: n.region.w || 0, h: n.region.h || 0};
    if (n.to) m.to = n.to;
    if (n.points) m.points = n.points;
    if (n.text) m.text = n.text;
    if (n.element) m.element = n.element;
    if (n.kind === 'text' && n.style) for (const k of Object.keys(TEXT_STYLE)) if (n.style[k] != null) m[k] = n.style[k];
    return m;
  }

  root.BC_MARKUP = {COLORS, WIDTHS, TOOLS, toolsFor, hasWidth, FONT_SIZES, FONTS, TEXT_STYLE, keep, setTextStyle, textStyleOf, shotName, SHAPES, KIND_LABELS, BOX_HANDLES, init, setTool, setShape, setColor, setWidth, add, update, finishDrag, remove, clear, select,
    canUndo, canRedo, undo, redo, sendable, stepNumber, fromGesture, bounds, move, handles, resize, elementLabel, elementDetail, describe, toNotes, fromNote, onFrame, frames,
    markedFrames, stamps, stampTarget, forgetFrame};
})();
