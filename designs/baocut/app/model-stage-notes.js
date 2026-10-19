/* 视频标注（product-design §3.2.3「视频标注」、§5.3）：编辑器预览画面上框、箭头、文字与编号标记的草稿，composer 上的引用标签，
   多帧标注的候选区间，以及发送时拼给智能体的那段文字。window.BC_STAGE_NOTES。纯函数，无 React、无 DOM；只在 App 入口加载。

   做法与幻灯片、设计稿、设计系统标注（model-home-slides.js、model-home-design.js、model-home-design-system-notes.js）同一家，
   差别只有草稿的归属：那三种挂在会话上，这里按**视频**挂在 store 上（`videoNotes[videoId]`），因为编辑器的快聊会话常常还没建；
   composer 按会话的 `project` 读它，发送后随消息记入会话（`videoAnnotations`），草稿清空。编号与另外三种各自从 1 起。
   一条标注：{id, video, revision, timeMs, kind, region: {x, y, w, h}, to?: {x, y}, label, text}。
   `video` 在原型里是视频 id，正式版是 FileTarget；`revision` 是标注时视频的版本；`timeMs` 是标注时的播放头（时间线时间，毫秒）；
   `region` 相对画面归一化（0–1，左上为原点），文字与编号标记的 w、h 为 0；`to` 只有箭头有，是箭头的终点。
   语义：默认是「改源视频这个时刻附近」，区域只用来定位，不是「拿截图生成新片段」。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  /* 与另外三种标注同一组上限：每条消息至多 20 条，单条批注至多 2000 字。`near` 是画面上显示哪些标记的时间窗（毫秒）。 */
  const LIMITS = {notes: 20, text: 2000, near: 500};
  /* 四种标注：框、箭头、文字、编号标记（给人看的名字与给模型看的 kind 一致，kind 用英文）。
     轻量编辑器（docs/design/lite-editor §4）补三种：画笔（一串点）、直线（起点与终点，不带头）、圆（与框同一块矩形，画成椭圆）；
     标记工具条（stage-markup.jsx，两种视图同一条）列全部九种。 */
  const KINDS = [
    {kind: 'box', label: '框', hint: '拖出一个框'},
    {kind: 'arrow', label: '箭头', hint: '从起点拖到要指的地方'},
    {kind: 'text', label: '文字', hint: '点画面上的位置'},
    {kind: 'pin', label: '编号', hint: '点画面上的位置'},
    {kind: 'pen', label: '画笔', hint: '在画面上画一道'},
    {kind: 'line', label: '直线', hint: '从一头拖到另一头'},
    {kind: 'ellipse', label: '圆', hint: '拖出一个圆'},
    /* 标记工具（stage-markup.jsx）送来的两种：元素（点中的舞台节点，`element` 带它是谁）、评论（印章 + 一句话，另带印章截图 `shot`） */
    {kind: 'element', label: '元素', hint: '点画面上的元素'},
    {kind: 'comment', label: '评论', hint: '点画面上的位置或元素'},
  ];
  /* 没写字就不收的种类；别的标注从轻量编辑器的标记工具来时（带 `style`）可以不写批注，要说的话在对话里 */
  const NEEDS_TEXT = {text: true, comment: true};
  const kindLabel = kind => (KINDS.find(k => k.kind === kind) || KINDS[0]).label;

  const clamp01 = v => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  const round = v => Math.round(v * 1000) / 1000;

  /** 把画面上的一次手势（像素）换成归一化的区域：起点与终点都夹在画面内，框取两点围成的矩形，箭头记起点与终点，
      文字与编号只记一个点（w、h 为 0）。 */
  function normalize(kind, from, to, frame, points) {
    const w = frame?.w > 0 ? frame.w : 1, h = frame?.h > 0 ? frame.h : 1;
    const a = {x: clamp01(from.x / w), y: clamp01(from.y / h)};
    const b = to ? {x: clamp01(to.x / w), y: clamp01(to.y / h)} : a;
    if (kind === 'box' || kind === 'ellipse') {
      return {region: {x: round(Math.min(a.x, b.x)), y: round(Math.min(a.y, b.y)), w: round(Math.abs(a.x - b.x)), h: round(Math.abs(a.y - b.y))}};
    }
    if (kind === 'arrow' || kind === 'line') return {region: {x: round(a.x), y: round(a.y), w: 0, h: 0}, to: {x: round(b.x), y: round(b.y)}};
    if (kind === 'pen') {
      // 画笔：一串归一化的点；region 是它们的外接矩形，定位与九宫说法沿用
      const pts = (points || [from]).map(p => ({x: round(clamp01(p.x / w)), y: round(clamp01(p.y / h))}));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const x0 = Math.min(...xs), y0 = Math.min(...ys);
      return {region: {x: x0, y: y0, w: round(Math.max(...xs) - x0), h: round(Math.max(...ys) - y0)}, points: pts};
    }
    return {region: {x: round(a.x), y: round(a.y), w: 0, h: 0}};
  }

  /** 画面上的位置说成话：按中心点分九宫（左上 / 正中 / 右下…）。 */
  function place(region) {
    const cx = region.x + region.w / 2, cy = region.y + region.h / 2;
    const col = cx < 1 / 3 ? '左' : cx > 2 / 3 ? '右' : '中';
    const row = cy < 1 / 3 ? '上' : cy > 2 / 3 ? '下' : '中';
    if (row === '中' && col === '中') return '正中';
    if (row === '中') return `${col}侧`;
    if (col === '中') return `${row}方`;
    return `${col}${row}`;
  }
  const timecode = ms => (root.BC_TIME ? root.BC_TIME.timecode(ms / 1000) : (ms / 1000).toFixed(1) + 's');

  /** 给人看的位置：「00:42.3 · 框 · 画面右上」。 */
  function label(note) {
    return `${timecode(note.timeMs)} · ${kindLabel(note.kind)} · 画面${place(note.region)}`;
  }

  /** 新加一条：去掉首尾空白；空的、超长的、超过条数的都不收，返回给人看的原因。箭头没有终点、框没有面积的也不收。 */
  function add(notes, note) {
    const list = notes || [];
    const text = String(note?.text || '').trim();
    if (!text && (NEEDS_TEXT[note?.kind] || !note?.style)) return {notes: list, error: '先写下批注，再添加到对话'};
    if (text.length > LIMITS.text) return {notes: list, error: `一条批注最多 ${LIMITS.text} 字`};
    if (list.length >= LIMITS.notes) return {notes: list, error: `一条消息最多带 ${LIMITS.notes} 条视频标注，先把这些发出去`};
    if (note.kind === 'arrow' && !note.to) return {notes: list, error: '箭头要拖到它指的地方'};
    if (note.kind === 'box' && !(note.region.w > 0 && note.region.h > 0)) return {notes: list, error: '框要拖出一块面积'};
    if (note.kind === 'line' && !note.to) return {notes: list, error: '直线要拖到它的另一头'};
    if (note.kind === 'ellipse' && !(note.region.w > 0 && note.region.h > 0)) return {notes: list, error: '圆要拖出一块面积'};
    if (note.kind === 'pen' && !(note.points?.length >= 2)) return {notes: list, error: '画笔要画出一道线'};
    if (note.kind === 'element' && !note.element) return {notes: list, error: '先点中画面上的元素'};
    return {notes: [...list, {...note, text, label: note.label || label(note)}], error: null};
  }

  function remove(notes, id) {
    const list = notes || [];
    return list.some(n => n.id === id) ? list.filter(n => n.id !== id) : list;
  }

  /** composer 上与已发送消息里的那一行。 */
  function tokenLabel(notes) {
    return `视频标注 · ${(notes || []).length} 条`;
  }

  /** 画面上要画的标记：编号是在整份草稿里的序号，与 composer 列表里的一致；只画播放头附近（±near 毫秒）那一帧的，
      别的时刻的标注在 composer 的列表里，点一条跳过去。 */
  function pins(notes, videoId, playT, near = LIMITS.near) {
    const at = (playT || 0) * 1000;
    return (notes || []).map((n, i) => ({...n, n: i + 1}))
      .filter(n => n.video === videoId && Math.abs(n.timeMs - at) <= near);
  }

  /** 不在当前帧上的有几条（标注模式的状态行）。 */
  function elsewhere(notes, videoId, playT, near = LIMITS.near) {
    return (notes || []).filter(n => n.video === videoId && Math.abs(n.timeMs - (playT || 0) * 1000) > near).length;
  }

  /** 多帧标注的候选区间：同一视频两条以上时给出最早与最晚的时刻 `{fromMs, toMs}`，只有一条时为 null。
      它只是候选——智能体不自动把它当成要改的区间（SKILL「收到视频标注时的解读」）。 */
  function candidateBounds(notes, videoId) {
    const times = (notes || []).filter(n => videoId == null || n.video === videoId).map(n => n.timeMs);
    if (times.length < 2) return null;
    return {fromMs: Math.min(...times), toMs: Math.max(...times)};
  }

  const pct = v => `${Math.round(v * 100)}%`;
  /** 给模型看的区域：归一化坐标原样给，另说一句百分比方便读。 */
  function regionText(note) {
    const r = note.region;
    if (note.kind === 'arrow' || note.kind === 'line') return `from (${r.x}, ${r.y}) to (${note.to.x}, ${note.to.y})`;
    if (note.kind === 'pen') return `path ${(note.points || []).map(p => `(${p.x}, ${p.y})`).join(' → ')} within x=${r.x} y=${r.y} w=${r.w} h=${r.h}`;
    if (note.kind === 'box' || note.kind === 'ellipse' || note.kind === 'element') return `x=${r.x} y=${r.y} w=${r.w} h=${r.h} (${pct(r.x)}, ${pct(r.y)}, ${pct(r.w)} × ${pct(r.h)})`;
    return `at (${r.x}, ${r.y})`;
  }

  /** product-design §3.2.3、协议 `conversations`：Harness 追加在给智能体的文字后面的块，一部视频一块，排在设计系统标注段之后。
      `pathOf(videoId)` 给出视频相对会话工作目录的路径；`revision` 取这组标注里最大的（都是同一版本时就是那一个）。 */
  function promptText(notes, pathOf) {
    const groups = [];
    for (const n of notes || []) {
      let g = groups.find(x => x.video === n.video);
      if (!g) groups.push(g = {video: n.video, notes: []});
      g.notes.push(n);
    }
    return groups.map(g => {
      const revision = Math.max(...g.notes.map(n => n.revision || 0));
      const lines = g.notes.map((n, i) => {
        const body = String(n.text).split('\n').join('\n        ');
        /* 轻量编辑器（docs/design/lite-editor §4.3）：标注落在哪一段、哪一句随标注给出，智能体改「第 3 场第 2 句这里」而不只是一个时刻 */
        const where = n.segment ? `   segment: ${n.segment.id} (${n.segment.kind} #${n.segment.index + 1}${n.segment.title ? ' ' + n.segment.title : ''})`
          + (n.line ? ` · line ${n.line.index}: ${n.line.text}` : '') : null;
        /* 标记工具送来的：颜色与粗细、点中的元素（给模型看的 detail）、评论的印章截图（正式版作为图片附件随消息一起给） */
        const style = n.style ? `   style: ${n.style.color} ${n.style.width}px` : null;
        const element = n.element ? `   element: ${n.element.detail || n.element.label || ''}`.trimEnd() : null;
        const shot = n.shot ? `   screenshot: attached, frame at ${n.shot.timeMs} ms with the stamp at (${n.shot.stamp.x}, ${n.shot.stamp.y})` : null;
        return [`${i + 1}. ${timecode(n.timeMs)} (${n.timeMs} ms) · ${n.kind} · ${regionText(n)}`, style, element, where, shot, body ? `   批注：${body}` : null].filter(Boolean).join('\n');
      });
      const bounds = candidateBounds(g.notes);
      const tail = bounds ? `\ncandidateBoundsMs: ${bounds.fromMs}–${bounds.toMs}（候选范围，不是要改的区间）` : '';
      return `<baocut-video-annotations video="${pathOf ? pathOf(g.video) : g.video}" revision="${revision}">\n${lines.join('\n')}${tail}\n</baocut-video-annotations>`;
    }).join('\n');
  }

  /** 原型里带着标注发出去之后的模拟回复（store.jsx 的 sendAgent；正式版是真实智能体在回）：
      先说收到几条，看每个时刻的画面，在时间线上改那一处，最后说改了几处；两条以上时说明没有当成区间。 */
  function replyPlan(notes, titleOf) {
    const list = notes || [];
    const videos = [...new Set(list.map(n => n.video))];
    const bounds = videos.length === 1 ? candidateBounds(list) : null;
    return {
      kind: 'video', write: null, task: null,
      summary: `收到 ${list.length} 条视频标注，按时刻逐处改源视频的时间线${bounds ? '；几条标注的时刻不连成区间，各改各的' : ''}。`,
      reads: [
        ...videos.map(v => ({cmd: `videos_inspect ${titleOf ? titleOf(v) : v}`, tool: 'videos_inspect', args: {videoId: v}, out: `revision ${Math.max(...list.filter(n => n.video === v).map(n => n.revision || 0))}`})),
        ...list.map(n => ({cmd: `videos_frames ${timecode(n.timeMs)}`, tool: 'videos_frames', args: {videoId: n.video, atMs: n.timeMs}, out: '1 帧'})),
        ...list.map(n => ({cmd: `edits_apply · ${timecode(n.timeMs)}`, kind: 'edit', summary: `${timecode(n.timeMs)} ${n.text}`})),
      ],
      close: `改好了 ${list.length} 处，都在标注的时刻附近。哪里还不对，再标注一次。`,
    };
  }

  root.BC_STAGE_NOTES = {LIMITS, KINDS, kindLabel, normalize, place, label, add, remove, tokenLabel, pins, elsewhere, candidateBounds, regionText, promptText, replyPlan};
})();
