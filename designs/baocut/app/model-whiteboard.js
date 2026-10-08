/* model-whiteboard.js —— 白板手绘元素的纯模型（设计稿
   docs/design/video/bcut-whiteboard-animation-design.md §6.1）。

   核心里一条 `kind: "whiteboard"` 元素是**一张位图** ＋ 手绘揭示参数（hand / paper /
   draw / inkFirst / beats）：`bcut-render` 把图分析成墨线与色块的连通域，按笔顺
   逐段揭示，手在笔尖上跟着走。原型没有位图分析，这里用**内置的几份矢量示范笔画**
   代替那张图——同一套参数、同一条揭示曲线、同一只手，所以面板与画布的行为口径
   与核心一致，只是画的是示范而不是用户的图。

   两条硬约束（与核心同口径）：
   1. **逐帧确定**：`sample(props, t, box, dur)` 是 t 的纯函数，不积分、不存上一帧，
      拖播放头 / 倒放 / 暂停看到的就是那一帧。
   2. **画时 ≤ 元素时长**：`draw` 缺席 = min(0.8 × 时长, 自然画时)，任何情况都夹到
      时长以内；画完后手抬起，画面定格到元素结束。

   这一层不碰 DOM：`sample()` 给出一帧的笔画表，`paint()` 把这张表画到一个 2D
   上下文上（canvas 由视图层给）。

   2026-09-17 旁白同步（docs/design/video/bcut-whiteboard-narration-sync-design.md §5–§6，bcutTimeline 0.9）：
   `pace`（stretch = 组窗撑满 | natural = 按自然速度画完后定格）、`strict`（box 是硬遮罩，
   重叠归后拍、跨 box 的笔画按段切开）、`beats[].end`（组窗右缘，缺省 = 下一拍 at、末拍 = draw）、
   `beats[].label`（≤ 80 字，只展示）、`at / end` 可写词锚点串 `~main:w12:start`（核心查
   transcript 的 words[]，原型示范自带一小张旁白词表）。缺省画时公式一字不改。 */
(function () {
  const HANDS = [
    {k: 'marker', name: '记号笔'},
    {k: 'pen', name: '钢笔'},
    {k: 'none', name: '无'},
  ];
  const HAND_KEYS = HANDS.map((h) => h.k);
  /** 画时可调范围（秒）与节拍上限（核心 `WHITEBOARD_MAX_BEATS`）；`label` 上限（0.9） */
  const LIMITS = {draw: [0.5, 60], beats: 64, label: 80};
  /** 节奏（0.9）：stretch = 0.8 的行为，组窗撑满；natural = 每拍按自然速度画完后定格到组窗结束 */
  const PACES = [
    {k: 'stretch', name: '撑满节拍窗'},
    {k: 'natural', name: '画完定格'},
  ];
  const PACE_KEYS = PACES.map((p) => p.k);
  /** 词锚点串：`~<source>:w<n>:start|end`（与 bcutTimeline 的 TimeValue 同形） */
  const ANCHOR_RE = /^~([\w-]+):w(\d+):(start|end)$/;
  /** 属性页「节奏」徽标三档：时间真相从哪来 */
  const MODES = {narration: '跟随旁白', natural: '自然速度', manual: '手动'};
  /** 自然画时：路径长度（100 格坐标）÷ 速度 ＋ 每段笔画的起笔停顿，夹在 1–15 s */
  const SPEED = 60;
  const STROKE_PAUSE = 0.25;
  const NATURAL = [1, 15];
  const PAPER_DEFAULT = '#FFFFFF';

  /* ---------- 内置示范（三份；坐标是 0–100 的画面百分比） ----------
     `ink: true` 是墨线（黑），`ink: false` 是色块 / 高亮；`inkFirst` 时墨线整体先画。
     `beats` 是示范自带的节拍：`at` 秒起画 `box` 那块区域。 */
  /* @ds-allow: 示范笔画的墨色 / 高亮色与手 / 笔身颜色都是画进视频画面的内容，
     不是 S2 表面（明暗模式无关） */
  const INK = '#1F1F1F';
  const ACCENT = {orange: '#E4572E', blue: '#2E86AB', yellow: '#F4B942'};
  const HAND_SKIN = '#F2C7A5';
  const HAND_LINE = '#8A5A3C';
  const PEN_BODY = '#333333';

  const circle = (cx, cy, r, n) => {
    const pts = [];
    for (let i = 0; i <= (n || 24); i++) {
      const a = -Math.PI / 2 + (i / (n || 24)) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  };
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  const S = (pts, opts) => Object.assign({pts, w: 1.6, c: INK, ink: true}, opts || {});

  const DEMOS = [
    {
      k: 'idea', name: '灯泡 · 想法', note: '一只灯泡 ＋ 三道光',
      strokes: [
        S(circle(50, 40, 16)),
        S([[42, 55], [42, 64], [58, 64], [58, 55]]),
        S([[44, 68], [56, 68]]),
        S([[46, 72], [54, 72]]),
        S([[50, 12], [50, 18]]),
        S([[26, 22], [31, 26]]),
        S([[74, 22], [69, 26]]),
        S(circle(50, 40, 10, 16), {c: ACCENT.yellow, w: 5, ink: false}),
      ],
    },
    {
      k: 'flow', name: '流程 · 三步', note: '三个框、两支箭头',
      strokes: [
        S(rect(8, 38, 22, 20)),
        S(rect(39, 38, 22, 20)),
        S(rect(70, 38, 22, 20)),
        S([[30, 48], [38, 48]]), S([[35, 45], [38, 48], [35, 51]]),
        S([[61, 48], [69, 48]]), S([[66, 45], [69, 48], [66, 51]]),
        S([[12, 48], [26, 48]], {c: ACCENT.blue, w: 4, ink: false}),
        S([[43, 48], [57, 48]], {c: ACCENT.orange, w: 4, ink: false}),
        S([[74, 48], [88, 48]], {c: ACCENT.yellow, w: 4, ink: false}),
      ],
      /* 这一份是「过了 `bcut whiteboard sync` 的样子」：三拍的起止都是词锚点，各带一个标签。
         锚点在核心里查 transcript.json 的 words[]（减元素起点）；原型没有转录，示范自带一张
         元素本地秒的旁白词表 `narration`（三句话、十二个词，`~main:w1` … `~main:w12`）。 */
      narration: [
        ['w1', 0.0, 0.6, '第一步'], ['w2', 0.6, 1.3, '先把'], ['w3', 1.3, 2.0, '需求'], ['w4', 2.0, 2.8, '收齐'],
        ['w5', 3.2, 3.8, '第二步'], ['w6', 3.8, 4.5, '拆成'], ['w7', 4.5, 5.4, '几件'], ['w8', 5.4, 6.3, '任务'],
        ['w9', 6.4, 7.0, '第三步'], ['w10', 7.0, 7.7, '按拍'], ['w11', 7.7, 8.4, '交付'], ['w12', 8.4, 9.2, '结果'],
      ],
      beats: [
        {at: '~main:w1:start', end: '~main:w4:end', box: [0, 0, 34, 100], label: '第一步 · 收需求'},
        {at: '~main:w5:start', end: '~main:w8:end', box: [34, 0, 32, 100], label: '第二步 · 拆任务'},
        {at: '~main:w9:start', box: [66, 0, 34, 100], label: '第三步 · 交付'},
      ],
    },
    {
      k: 'chart', name: '增长曲线', note: '坐标轴 ＋ 一条上扬的线',
      strokes: [
        S([[14, 18], [14, 80], [88, 80]]),
        S([[11, 22], [14, 18], [17, 22]]),
        S([[84, 77], [88, 80], [84, 83]]),
        S([[20, 72], [32, 66], [44, 62], [56, 50], [68, 42], [80, 26]], {c: ACCENT.orange, w: 3}),
        S(circle(80, 26, 3, 12), {c: ACCENT.orange, w: 2.5, ink: false}),
        S([[20, 74], [80, 74]], {c: ACCENT.blue, w: 3.5, ink: false}),
      ],
    },
  ];
  const byDemo = (k) => DEMOS.find((d) => d.k === k) || DEMOS[0];

  /* ---------- props ---------- */
  const isHex = (s) => typeof s === 'string' && /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);

  /* ---------- TimeValue（0.9）：数字 = 元素本地秒；字符串 = 词锚点 ---------- */
  const isAnchor = (v) => typeof v === 'string' && ANCHOR_RE.test(v);
  /** 归一化一个 TimeValue：数字夹到 ≥ 0、锚点串原样留着、其它 → null */
  const tv = (v) => (num(v) != null ? Math.max(0, v) : isAnchor(v) ? v : null);
  /** 解析一个 TimeValue 成元素本地秒：锚点查示范的旁白词表，查不到 → null */
  function resolveTime(v, demo) {
    if (num(v) != null) return v;
    const m = isAnchor(v) ? ANCHOR_RE.exec(v) : null;
    if (!m) return null;
    const row = (byDemo(demo).narration || []).find((w) => w[0] === 'w' + m[2]);
    return row ? (m[3] === 'start' ? row[1] : row[2]) : null;
  }
  const cloneBeat = (b) => {
    const out = {at: b.at, box: b.box.slice()};
    if (b.end != null) out.end = b.end;
    if (b.label != null) out.label = b.label;
    return out;
  };

  /** 新建一条的缺省：示范 ＋ 记号笔 ＋ 白纸；`draw` 空 = 跟时长走；节奏 stretch、不严格 */
  function defaults(demo) {
    const d = byDemo(demo);
    return {demo: d.k, hand: 'marker', paper: PAPER_DEFAULT, draw: null, inkFirst: true,
      pace: 'stretch', strict: false, beats: (d.beats || []).map(cloneBeat)};
  }

  /** 把任何来路的 props 归成合法形状（换示范时节拍跟着示范走，见 `switchDemo`）。
      0.8 文档没有 `pace / strict / end / label`，读入即 0.9 语义（缺省值 = 老行为）。 */
  function normalize(p) {
    const src = p || {};
    const out = defaults(src.demo);
    if (HAND_KEYS.indexOf(src.hand) >= 0) out.hand = src.hand;
    out.paper = src.paper === null ? null : (isHex(src.paper) ? src.paper.toUpperCase() : PAPER_DEFAULT);
    const d = num(src.draw);
    out.draw = d == null ? null : clamp(d, LIMITS.draw[0], LIMITS.draw[1]);
    out.inkFirst = src.inkFirst == null ? true : !!src.inkFirst;
    out.pace = PACE_KEYS.indexOf(src.pace) >= 0 ? src.pace : 'stretch';
    out.strict = !!src.strict;
    if (Array.isArray(src.beats)) {
      out.beats = src.beats
        .filter((b) => b && tv(b.at) != null && Array.isArray(b.box) && b.box.length === 4)
        .slice(0, LIMITS.beats)
        .map((b) => {
          const o = {at: tv(b.at), box: b.box.map((x) => clamp(num(x) || 0, 0, 100))};
          if (tv(b.end) != null) o.end = tv(b.end);
          if (typeof b.label === 'string' && b.label.trim()) o.label = b.label.trim().slice(0, LIMITS.label);
          return o;
        });
      // 按解析后的起点排；解析不了的锚点排到最后（渲染时整拍降级为几何顺序）
      const key = (b) => { const t = resolveTime(b.at, out.demo); return t == null ? Infinity : t; };
      out.beats = out.beats.map((b, i) => ({b, i})).sort((x, y) => key(x.b) - key(y.b) || x.i - y.i).map((x) => x.b);
    }
    return out;
  }

  /** 换示范：笔画与节拍换成那一份的，手 / 纸 / 画时 / 墨线优先 / 节奏 / 严格都留着 */
  function switchDemo(p, demo) {
    const cur = normalize(p);
    const next = defaults(demo);
    return Object.assign(next, {hand: cur.hand, paper: cur.paper, draw: cur.draw, inkFirst: cur.inkFirst,
      pace: cur.pace, strict: cur.strict});
  }

  /** 解析后的节拍表：`[{i, at, end, label, box, anchored, ok, atRaw, endRaw}]`，秒是元素本地秒、未夹；
      `end` 缺省 = 下一拍 at（末拍 = null，由调用方补成 draw）；`ok` = 两个锚点都解析到了。 */
  function resolvedBeats(p) {
    const q = normalize(p);
    const list = q.beats.map((b, i) => {
      const at = resolveTime(b.at, q.demo);
      const end = b.end == null ? null : resolveTime(b.end, q.demo);
      return {i: i + 1, at, end, label: b.label || null, box: b.box, atRaw: b.at, endRaw: b.end == null ? null : b.end,
        anchored: isAnchor(b.at) || isAnchor(b.end), ok: at != null && (b.end == null || end != null)};
    });
    const ok = list.filter((b) => b.ok);
    ok.forEach((b, g) => { if (b.end == null && g + 1 < ok.length) b.end = ok[g + 1].at; });
    return list;
  }

  /** 「节奏」徽标：跟随旁白（节拍里有词锚点）> 自然速度（画时跟时长走）> 手动（手填了画时） */
  function mode(p) {
    const q = normalize(p);
    if (q.beats.some((b) => isAnchor(b.at) || isAnchor(b.end))) return 'narration';
    return q.draw == null ? 'natural' : 'manual';
  }

  /* ---------- 几何 ---------- */
  const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  function strokeLen(s) {
    let L = 0;
    for (let i = 1; i < s.pts.length; i++) L += segLen(s.pts[i - 1], s.pts[i]);
    return L;
  }
  function centroid(s) {
    let x = 0, y = 0;
    s.pts.forEach((p) => { x += p[0]; y += p[1]; });
    return [x / s.pts.length, y / s.pts.length];
  }
  const inBox = (pt, box) => pt[0] >= box[0] && pt[0] <= box[0] + box[2] && pt[1] >= box[1] && pt[1] <= box[1] + box[3];

  /** 自然画时（秒）：与核心 `whiteboard_analyze` 的公式同形，只是单位换成 100 格 */
  function natural(p) {
    const d = byDemo((p || {}).demo);
    const L = d.strokes.reduce((a, s) => a + strokeLen(s), 0);
    return clamp(L / SPEED + d.strokes.length * STROKE_PAUSE, NATURAL[0], NATURAL[1]);
  }

  /** 实际画时：显式值或 min(0.8 × 时长, 自然画时)，一律夹到时长以内 */
  function effectiveDraw(p, dur) {
    const D = Math.max(0, num(dur) == null ? 0 : dur);
    const want = p && num(p.draw) != null ? p.draw : Math.min(0.8 * D, natural(p));
    return clamp(want, 0, D);
  }

  /** `strict`：一条折线按 box 归属切成若干段（每段一个 owner；重叠处**后拍赢**，都不在 → boxes.length）。
      每条线段按 2 格一步采样、以采样段中点判归属，相邻同 owner 的并成一段——核心里是逐像素标 owner，
      这里是矢量示范的同形近似。 */
  function splitByBoxes(pts, boxes) {
    const ownerOf = (pt) => {
      let o = boxes.length;
      for (let b = 0; b < boxes.length; b++) if (inBox(pt, boxes[b])) o = b;
      return o;
    };
    const pieces = [];
    let cur = null;
    const push = (owner, a, b) => {
      if (cur && cur.owner === owner) { cur.pts.push(b); return; }
      cur = {owner, pts: [a, b]};
      pieces.push(cur);
    };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.max(1, Math.ceil(segLen(a, b) / 2));
      for (let k = 0; k < n; k++) {
        const p0 = [a[0] + (b[0] - a[0]) * (k / n), a[1] + (b[1] - a[1]) * (k / n)];
        const p1 = [a[0] + (b[0] - a[0]) * ((k + 1) / n), a[1] + (b[1] - a[1]) * ((k + 1) / n)];
        push(ownerOf([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]), p0, p1);
      }
    }
    return pieces.length ? pieces : [{owner: ownerOf(pts[0] || [0, 0]), pts: pts.slice()}];
  }

  /** 笔顺：先按节拍分组，组内墨线优先（`inkFirst`），再按原序。
      · 缺省（`strict:false`）：整笔按**质心**落在哪个 box，第一个命中的 box 赢；
      · `strict:true`：笔画按 box 切段，每段归它所在的 box，重叠归后拍（`splitByBoxes`）。
      解析不了锚点的拍不参与分组（整拍降级为几何顺序：它 box 里的笔画排到最后一拍之后）。
      返回 `[{stroke, i, part, group}]`；没有节拍时全部在第 0 组。 */
  function order(strokes, p) {
    const beats = resolvedBeats(p).filter((b) => b.ok);
    const boxes = beats.map((b) => b.box);
    const inkFirst = !p || p.inkFirst !== false;
    const strict = !!(p && p.strict);
    const list = [];
    strokes.forEach((s, i) => {
      if (strict && boxes.length) {
        splitByBoxes(s.pts, boxes).forEach((pc, part) => {
          list.push({stroke: Object.assign({}, s, {pts: pc.pts}), i, part, group: pc.owner});
        });
        return;
      }
      let group = boxes.length;
      const c = centroid(s);
      for (let b = 0; b < boxes.length; b++) if (inBox(c, boxes[b])) { group = b; break; }
      list.push({stroke: s, i, part: 0, group});
    });
    list.sort((a, b) => a.group - b.group
      || (inkFirst ? ((b.stroke.ink ? 1 : 0) - (a.stroke.ink ? 1 : 0)) : 0)
      || a.i - b.i || a.part - b.part);
    return list;
  }

  /** 各组的时间窗 `[a, b)`：第 g 组从 `at_g` 起到 `end_g`（缺省 = 下一拍 at，末拍 = draw）；
      落在所有 box 外的笔画排在最后一拍之后——末拍 `end` 早于画时就用 `[end_末, draw]`，否则与末拍同窗；
      没有（能解析的）节拍时整段就是一窗。窗都夹在 [0, draw]。 */
  function windows(p, draw) {
    const beats = resolvedBeats(p).filter((b) => b.ok);
    if (!beats.length) return [[0, draw]];
    const out = beats.map((b) => {
      const a = clamp(b.at, 0, draw);
      return [a, Math.max(a, clamp(b.end == null ? draw : b.end, 0, draw))];
    });
    const last = out[out.length - 1];
    out.push(draw - last[1] > 0.05 ? [last[1], draw] : last.slice());
    return out;
  }

  /** 一组的自然时长（秒，不夹）：Σ 路径长 ÷ 速度 ＋ 每笔起笔停顿——与 `natural()` 同口径 */
  const naturalGroup = (list) => list.reduce((a, o) => a + strokeLen(o.stroke), 0) / SPEED + list.length * STROKE_PAUSE;

  /** 揭示进度 0..1：整体已画路径长 ÷ 总路径长，随 t 单调不减 */
  function reveal(p, t, dur) {
    const f = sample(p, t, {w: 100, h: 100}, dur);
    const total = byDemo(normalize(p).demo).strokes.reduce((a, s) => a + strokeLen(s), 0) || 1;
    return f.strokes.reduce((a, s) => a + s.len * s.frac, 0) / total;
  }

  /** 截一条折线的前 `frac` 段；返回 `{pts, tip}`（tip 是笔尖所在点） */
  function cut(pts, frac) {
    if (frac >= 1) return {pts, tip: pts[pts.length - 1]};
    const L = strokeLen({pts}) * frac;
    const out = [pts[0]];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = segLen(pts[i - 1], pts[i]);
      if (acc + d >= L) {
        const k = d ? (L - acc) / d : 0;
        const tip = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
        out.push(tip);
        return {pts: out, tip};
      }
      acc += d;
      out.push(pts[i]);
    }
    return {pts, tip: pts[pts.length - 1]};
  }

  /** 一帧：`{paper, strokes: [{pts, w, c, frac, len, done}], hand: {x, y, kind} | null, drawing}`
      坐标已换算到 `box`（{w, h}）像素；`t` 是元素内秒；`dur` 是元素时长。 */
  function sample(p, t, box, dur) {
    const props = normalize(p);
    const d = byDemo(props.demo);
    const draw = effectiveDraw(props, dur);
    const tt = Math.max(0, num(t) == null ? 0 : t);
    const ord = order(d.strokes, props);
    const win = windows(props, draw);
    const sx = (box.w || 100) / 100, sy = (box.h || 100) / 100;
    const scale = Math.min(sx, sy);
    const strokes = new Array(ord.length);   // 与 `ord` 同序（strict 时一笔可能是几段）
    let hand = null;
    /* 每组：组内笔画按路径长（＋起笔停顿）在组的**画时** `dg` 里匀速走。
       stretch：`dg` = 组窗长（0.8 的公式一字不改）；natural：`dg` = min(自然时长, 组窗长)，
       画完停到组窗结束（hold）。每笔记下起笔 / 落墨 / 收笔的秒数，给闲着的手定位用。 */
    const groups = {};
    ord.forEach((o, k) => { (groups[o.group] = groups[o.group] || []).push({o, k}); });
    Object.keys(groups).forEach((g) => {
      const list = groups[g];
      const w = win[Math.min(+g, win.length - 1)];
      const span = Math.max(0, w[1] - w[0]);
      const dg = props.pace === 'natural' ? Math.min(naturalGroup(list.map((x) => x.o)), span) : span;
      const lens = list.map((x) => strokeLen(x.o.stroke));
      const total = lens.reduce((a, l) => a + l, 0) + list.length * STROKE_PAUSE * SPEED;
      const rate = dg > 0 ? total / dg : Infinity;   // 每秒走的「格」
      const prog = draw <= 0 || dg <= 0 ? (tt >= w[0] ? 1 : 0) : clamp((tt - w[0]) / dg, 0, 1);
      let cursor = prog * total, off = 0;
      list.forEach((x, j) => {
        const o = x.o;
        const need = lens[j] + STROKE_PAUSE * SPEED;
        let frac;
        if (cursor >= need) frac = 1;
        else if (cursor <= 0) frac = 0;
        else frac = clamp((cursor - STROKE_PAUSE * SPEED) / (lens[j] || 1), 0, 1);
        cursor -= need;
        const cutted = cut(o.stroke.pts, frac);
        const pts = cutted.pts.map((q) => [q[0] * sx, q[1] * sy]);
        if (frac > 0 && frac < 1 && !hand) hand = {x: cutted.tip[0] * sx, y: cutted.tip[1] * sy, kind: props.hand};
        const t0 = isFinite(rate) ? w[0] + off / rate : w[0];
        const t1 = isFinite(rate) ? w[0] + (off + STROKE_PAUSE * SPEED) / rate : w[0];
        const t2 = isFinite(rate) ? w[0] + (off + need) / rate : w[0];
        off += need;
        strokes[x.k] = {pts, w: o.stroke.w * scale, c: o.stroke.c, frac, len: lens[j], done: frac >= 1, order: o.i,
          part: o.part, group: o.group, t: [t0, t1, t2], holdTo: w[1]};
      });
    });
    const drawing = tt < draw;
    if (!drawing) hand = null;
    if (drawing && !hand) {
      /* 手闲着（起笔停顿、组内 hold、组与组之间）：
         · 上一笔收笔后先**静止**在它的笔尖上，直到它那组的窗结束（hold）；
         · 之后到下一笔落墨之间**线性挪**到下一笔的起点（抬笔阶段，只是显示，不改落墨时间）；
         · 一笔都没落时停在第一笔起点。 */
      let prev = null, next = null;
      strokes.forEach((s, k) => {
        if (s.frac >= 1 && s.t[2] <= tt + 1e-9 && (!prev || s.t[2] > prev.t[2])) prev = s;
        if (s.frac <= 0 && s.t[1] > tt - 1e-9 && (!next || s.t[1] < next.t[1])) next = s;
      });
      const start = next ? [ord[strokes.indexOf(next)].stroke.pts[0][0] * sx, ord[strokes.indexOf(next)].stroke.pts[0][1] * sy] : null;
      const tip = prev ? prev.pts[prev.pts.length - 1] : null;
      if (prev && next) {
        const from = Math.min(next.t[1], Math.max(prev.t[2], prev.group === next.group ? prev.t[2] : prev.holdTo));
        const k = next.t[1] - from > 1e-6 ? clamp((tt - from) / (next.t[1] - from), 0, 1) : 1;
        hand = {x: tip[0] + (start[0] - tip[0]) * k, y: tip[1] + (start[1] - tip[1]) * k, kind: props.hand};
      } else if (next) hand = {x: start[0], y: start[1], kind: props.hand};
    }
    if (hand && props.hand === 'none') hand = null;
    return {paper: props.paper, strokes: strokes.filter((s) => s.frac > 0), hand, drawing, draw, scale};
  }

  /* ---------- 画 ---------- */
  function paintHand(g, hand, scale) {
    // 手＋笔约占画面高的 15%（scale = 画面短边 / 100）——真白板视频里的手就这么大
    const s = Math.max(0.6, scale) * 0.62;
    g.save();
    g.translate(hand.x, hand.y);
    g.rotate(-Math.PI / 5);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 笔：从笔尖往右上延伸
    const len = 26 * s, wid = (hand.kind === 'pen' ? 3.2 : 5.5) * s;
    g.fillStyle = hand.kind === 'pen' ? PEN_BODY : ACCENT.blue;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(wid * 0.8, -6 * s);
    g.lineTo(wid * 0.8, -len);
    g.lineTo(-wid * 0.8, -len);
    g.lineTo(-wid * 0.8, -6 * s);
    g.closePath();
    g.fill();
    if (hand.kind === 'marker') {
      g.fillStyle = PEN_BODY;
      g.fillRect(-wid * 0.8, -len, wid * 1.6, 4 * s);
    }
    // 手：握在笔身中段的一块椭圆 ＋ 两根手指
    g.fillStyle = HAND_SKIN;
    g.strokeStyle = HAND_LINE;
    g.lineWidth = 1.2 * s;
    g.beginPath();
    g.ellipse(4 * s, -16 * s, 9 * s, 12 * s, -0.3, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.beginPath();
    g.ellipse(-2 * s, -9 * s, 3.2 * s, 5 * s, 0.4, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.beginPath();
    g.ellipse(6 * s, -6 * s, 3 * s, 4.5 * s, -0.2, 0, Math.PI * 2);
    g.fill(); g.stroke();
    g.restore();
  }

  /** 把一帧画到 2D 上下文：纸 → 笔画（圆头、按笔顺）→ 手 */
  function paint(g, frame) {
    const W = g.canvas ? g.canvas.width : 0, H = g.canvas ? g.canvas.height : 0;
    if (frame.paper) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = frame.paper;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    frame.strokes.forEach((s) => {
      if (s.pts.length < 2) return;
      g.strokeStyle = s.c;
      g.lineWidth = Math.max(0.75, s.w);
      g.beginPath();
      g.moveTo(s.pts[0][0], s.pts[0][1]);
      for (let i = 1; i < s.pts.length; i++) g.lineTo(s.pts[i][0], s.pts[i][1]);
      g.stroke();
    });
    if (frame.hand) paintHand(g, frame.hand, frame.scale || 1);
  }

  /* ---------- 时间轴上的白板条（2026-09-11） ----------
     条子分两层：上半是**画面带**——每一格按它那一秒调 `sample`，从左到右画面渐满、
     画完之后每一格都是整张；下半是**画时带**——条头到生效画时是手在画的那一段，
     之后到条尾是定格，节拍在带上打点。三个函数只算几何与秒数，画在
     `timeline-whiteboard.jsx`。 */

  /** 画时带：`{draw, hold, auto, mode, pace, strict, beats, issues}`，单位秒、自条头起算。
      `auto` = 跟时长走（`draw` 未手定）；`mode` 是「节奏」徽标三档（`MODES`）。
      每拍 `{i, at, end, drawEnd, idleTo, label, anchored, ok, box}`：`at / end` 是组窗（夹到时长、
      编号从 1 起）、`drawEnd` 是这一拍墨线画完的秒（natural 时可能早于 `end`）、`idleTo` 是下一拍
      起画（末拍 = 画时）——`[drawEnd, idleTo]` 就是带上要画成「定格」的那一截；解析不了锚点的拍
      `ok:false`，`at / end` 为 null。 */
  function lane(p, dur) {
    const q = normalize(p);
    const d = Math.max(0.1, num(dur) == null ? 0 : dur);
    const draw = effectiveDraw(q, d);
    const ord = order(byDemo(q.demo).strokes, q);
    const okWin = windows(q, draw);
    const okList = resolvedBeats(q).filter((b) => b.ok);
    const beats = resolvedBeats(q).map((b) => {
      if (!b.ok) return {i: b.i, at: null, end: null, drawEnd: null, idleTo: null, label: b.label, anchored: b.anchored, ok: false, box: b.box};
      const g = okList.indexOf(okList.find((x) => x.i === b.i));
      const w = okWin[g];
      const list = ord.filter((o) => o.group === g);
      const span = Math.max(0, w[1] - w[0]);
      const dg = q.pace === 'natural' ? Math.min(naturalGroup(list), span) : span;
      const idleTo = g + 1 < okList.length ? okWin[g + 1][0] : draw;
      return {i: b.i, at: Math.min(d, b.at), end: Math.min(d, w[1]), drawEnd: Math.min(d, w[0] + dg), idleTo: Math.min(d, idleTo),
        label: b.label, anchored: b.anchored, ok: true, box: b.box};
    });
    return {draw, hold: Math.max(0, d - draw), auto: q.draw == null, mode: mode(q), pace: q.pace, strict: q.strict,
      beats, issues: check(q, d)};
  }

  /** 校验（设计稿 §5 / §10 的诊断码，原型只做与节拍有关的几条）：`[{code, level, field, msg}]`。
      · `word-anchor-missing`（error）：锚点解析不到（该拍整拍降级为几何顺序）；
      · `whiteboard-beat-window`（error）：解析后要 `at_g < end_g ≤ at_{g+1}`；
      · `whiteboard-beat-after-draw`（error）：`end_末 > draw`；
      · `whiteboard-window-too-short`（warning，只在 natural）：某拍自然时长 > 组窗，被压缩；
      · `whiteboard-empty-box` / `whiteboard-unassigned-foreground`（warning，只在 strict）。 */
  function check(p, dur) {
    const q = normalize(p);
    const d = Math.max(0.1, num(dur) == null ? 0 : dur);
    const draw = effectiveDraw(q, d);
    const out = [];
    const all = resolvedBeats(q);
    all.forEach((b) => {
      if (b.at == null) out.push({code: 'word-anchor-missing', level: 'error', field: `beats[${b.i - 1}].at`, msg: `第 ${b.i} 拍的起点锚点 ${b.atRaw} 找不到词，这一拍按几何顺序画`});
      else if (b.endRaw != null && b.end == null) out.push({code: 'word-anchor-missing', level: 'error', field: `beats[${b.i - 1}].end`, msg: `第 ${b.i} 拍的终点锚点 ${b.endRaw} 找不到词，这一拍按几何顺序画`});
    });
    const ok = all.filter((b) => b.ok);
    ok.forEach((b, g) => {
      const end = b.end == null ? draw : b.end;
      const nextAt = g + 1 < ok.length ? ok[g + 1].at : null;
      if (!(b.at < end) || (nextAt != null && end > nextAt + 1e-9)) {
        out.push({code: 'whiteboard-beat-window', level: 'error', field: `beats[${b.i - 1}]`,
          msg: `第 ${b.i} 拍要满足 起 < 止 ≤ 下一拍起（${b.at.toFixed(1)} / ${end.toFixed(1)}${nextAt != null ? ` / ${nextAt.toFixed(1)}` : ''} s）`});
      }
    });
    const last = ok[ok.length - 1];
    if (last && last.end != null && last.end > draw + 1e-9) {
      out.push({code: 'whiteboard-beat-after-draw', level: 'error', field: `beats[${last.i - 1}].end`,
        msg: `末拍止于 ${last.end.toFixed(1)} s，晚于画时 ${draw.toFixed(1)} s`});
    }
    if (ok.length) {
      const ord = order(byDemo(q.demo).strokes, q);
      const win = windows(q, draw);
      ok.forEach((b, g) => {
        const list = ord.filter((o) => o.group === g);
        if (q.pace === 'natural' && list.length) {
          const nat = naturalGroup(list), span = Math.max(0, win[g][1] - win[g][0]);
          if (nat > span + 1e-9) out.push({code: 'whiteboard-window-too-short', level: 'warning', field: `beats[${b.i - 1}]`,
            msg: `第 ${b.i} 拍自然要画 ${nat.toFixed(1)} s，窗口只有 ${span.toFixed(1)} s，已压缩`});
        }
        if (q.strict && !list.length) out.push({code: 'whiteboard-empty-box', level: 'warning', field: `beats[${b.i - 1}].box`,
          msg: `第 ${b.i} 拍的区域被后面的拍扣空了，没有笔画`});
      });
      if (q.strict && ord.some((o) => o.group === ok.length)) {
        out.push({code: 'whiteboard-unassigned-foreground', level: 'warning', field: 'beats',
          msg: '有笔画不在任何一拍的区域里，排到末拍之后'});
      }
    }
    return out;
  }

  /** 拖画时带右缘落到 `t` 秒（自条头起）要写什么：夹到 `[LIMITS.draw[0], min(LIMITS.draw[1], dur)]`；
      离条尾不足 `snap` 秒就吸回条尾，写 `null` = 回到跟时长走。 */
  function dragDraw(t, dur, snap) {
    const d = Math.max(0.1, num(dur) == null ? 0 : dur);
    const s = num(snap) == null ? 0 : Math.max(0, snap);
    if (!(num(t) != null) || t >= d - s) return null;
    const hi = Math.min(LIMITS.draw[1], d);
    return +clamp(t, LIMITS.draw[0], hi).toFixed(1);
  }

  /** 画面带的格子：每格 `{left, width, t}`，`t` 是格**中点**对应的条内秒数（夹到时长）。
      末格按剩余宽度裁；块宽或缩放为 0 时没有格。 */
  function strip(dur, w, pxps, tw) {
    const width = tw || 46;
    const d = Math.max(0.1, num(dur) == null ? 0 : dur);
    if (!(w > 0) || !(pxps > 0)) return [];
    const n = Math.ceil(w / width);
    const out = [];
    for (let i = 0; i < n; i++) {
      const left = i * width, cw = Math.min(width, w - left);
      out.push({left, width: cw, t: Math.min(d, (left + cw / 2) / pxps)});
    }
    return out;
  }

  const handName = (k) => (HANDS.find((h) => h.k === k) || HANDS[0]).name;
  const paceName = (k) => (PACES.find((p) => p.k === k) || PACES[0]).name;
  const modeName = (k) => MODES[k] || MODES.natural;
  const fmtDraw = (p, dur) => `${effectiveDraw(p, dur).toFixed(1)} s`;
  /** 一拍的本地起止文案：`0.0 – 2.8 s`；解析不到锚点写「锚点失效」 */
  const fmtBeat = (b) => (b.ok ? `${b.at.toFixed(1)} – ${b.end.toFixed(1)} s` : '锚点失效');

  Object.assign(window, {BC_WHITEBOARD: {HANDS, PACES, MODES, LIMITS, DEMOS, PAPER_DEFAULT, byDemo, defaults, normalize,
    switchDemo, natural, effectiveDraw, order, windows, reveal, sample, paint, handName, paceName, modeName, fmtDraw,
    fmtBeat, strokeLen, lane, dragDraw, strip, isAnchor, resolveTime, resolvedBeats, mode, check, splitByBoxes}});
})();
