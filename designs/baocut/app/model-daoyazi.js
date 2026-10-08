/* 倒鸭子字幕（跨句动态排版）的**纯模型** —— 无 DOM、无 I/O、无时间读取。
   对应设计稿 [docs/design/subtitle/bcut-daoyazi-caption-design.md](../../../docs/design/subtitle/bcut-daoyazi-caption-design.md) §6–§8：

     compile(input, opts)  → plan（分段 / 切行 / 列式世界排版 / 相机窗口，全部量化、确定性）
     sample(plan, t)       → frame（相机姿态、可见行与词、历史透明度、段间淡出）

   2026-09-18 对着 typeMonkey.js（nostarsnow 的网页移植，倒鸭子这一族里最还原 TypeMonkey 的
   一份）重做了排版与取景：**行**是最小单位（它的 `tm-row`），行在段里左对齐往下叠（它的
   `tm-block`），段与段在上一行的左下 / 右下角 90° 枢转（它的 `rotate: 'lb' | 'rb'`），镜头
   把**当前行**缩放到同一屏宽（它的 `conPercent`，最短两个字宽 `minWidthNum`），行从 0.3 倍
   以左中为原点弹入（它的 `zoomIn` + `transform-origin: left center`），停走档与弹入用 CSS
   `ease` 曲线。

   在 BaoCut 里它挂在**源语言轨的 `kinetic` 字段**上（model-substyle.js 的轨模型）：一份
   `kinetic` 就是设计稿 §5.3 的 `wordAnimation.caption.seed + options.daoyazi` 在原型里的
   形状（`defaults()`），画廊「倒鸭子」那张卡落下去时种下，套别的卡时清掉。词的起止在
   原型里是把 cue 时长按词均分出来的演示口径（`fromCues`，同 `BC_WA.at`），真实实现读
   transcript `words[]`。视图层（daoyazi-stage.jsx / panel-daoyazi.jsx）只做量宽、时钟与
   画；几何全部从这里出。 */
(function () {
  'use strict';

  const ALGORITHM_VERSION = 4; // 2026-09-18：防快闪并块 + 块内折行（v3 同列等宽 + 逐句换色 + 整行入场；v2 列式排版 + 逐行取景）
  const RECIPE_VERSION = 1;
  const SHORT_SIDE = 540;
  const QUANT = 64; // 世界坐标量化：1/64 参考单位
  const MIN_ROW_EM = 2;      // typeMonkey.js `minWidthNum`：一行最短按两个字宽取景
  const LINE_HEIGHT = 1.12;  // 行距收紧：同列等宽后行与行贴着才像一块字
  /* 同列等宽：一行的字号 = 基础字号 × rowScale，rowScale 把这一行撑到列宽（预算字数 × 基础字号）。 */
  const ROW_SCALE_MIN = 0.75, ROW_SCALE_MAX = 2, ROW_SCALE_HERO_MAX = 2.75, ROW_SCALE_QUANT = 64;
  /* 防「快闪」：一块字在镜头前至少停 MIN_BLOCK_DWELL_S（到下一块首词开口为止），不够的并进相邻块；
     并完一行装不下（超过预算 × LINE_OVERFLOW）就块内折行，最多 MERGE_MAX_LINES 行。 */
  const MIN_BLOCK_DWELL_S = 0.7, MERGE_MAX_LINES = 3, LINE_OVERFLOW = 1 / ROW_SCALE_MIN;
  const ZOOM_FONT_CAP = 0.30; // 当前行屏幕字号 ≤ 参考画布高的 30%（两个字的行也能占满屏宽）

  // ---------------------------------------------------------------- hashing / rng
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = (1n << 64n) - 1n;

  function fnv1a64(str) {
    let h = FNV_OFFSET;
    const bytes = new TextEncoder().encode(String(str));
    for (let i = 0; i < bytes.length; i++) {
      h ^= BigInt(bytes[i]);
      h = (h * FNV_PRIME) & MASK64;
    }
    return h;
  }

  function splitmix64(seed) {
    let state = BigInt.asUintN(64, seed);
    return {
      next() {
        state = (state + 0x9e3779b97f4a7c15n) & MASK64;
        let z = state;
        z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
        z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
        return z ^ (z >> 31n);
      },
      below(n) { return Number(this.next() % BigInt(n)); },
      unit() { return Number(this.next() >> 11n) / 9007199254740992; },
    };
  }

  // ---------------------------------------------------------------- defaults
  const LAYOUT_TOKENS = {
    wide: { viewport: [0.06, 0.08, 0.88, 0.72], density: 0.65, fit: 0.60 },
    square: { viewport: [0.06, 0.10, 0.88, 0.70], density: 0.60, fit: 0.62 },
    vertical: { viewport: [0.06, 0.14, 0.88, 0.62], density: 0.55, fit: 0.66 },
  };

  /* 镜头与入场的时间常数按 TypeMonkey（AE 脚本，倒鸭子这一族的源头）的 MonkeyCam 对过：
       - `motion: 'smooth'`  = 它的 Smooth：镜头在**相邻两个焦点的整段间隔**里用 ease 飞过去，
         到达时刻正好是新块首词的 onset（`ease(time, key(n).time, key(n+1).time, v1, v2)`）；
         我们再留 `dwell` 这一截停在旧块上（TypeMonkey 是 0），并把单次运动封在
         `[minTravelMs, maxTravelMs / speed]` 里，免得一句长白话让镜头爬两三秒。
       - `motion: 'stopAndGo'` = 它的 Stop and Go：`[onset − pre, onset − pre + dur]`，
         pre 0.167 s、dur 0.334 s（Fast 档），也就是这里的 `travelMs` × `anticipation`；
         typeMonkey.js 的口径是开口时起步、0.15–0.3 s 的 CSS `transition`，即 `anticipation: 0`。
       - 位置 / 角度 / 缩放三个通道用**同一条** ease：平滑档是 AE 的 `ease()`（首尾速度为零的
         Hermite），停走档是 CSS `ease`（typeMonkey.js 的 transition 曲线，起步快、落地软），
         不叠中途的「超调」鼓包——那一下正是看起来不顺的来源之一。
       - `history` 按**行**计：typeMonkey.js 念过的行全留在画面上，这里默认留 8 行、半透明。 */
  const DEFAULTS = {
    preset: 'standard',
    sequence: { maxDurationMs: 12000, maxBlocks: 16, maxWords: 48, pauseThresholdMs: 800, breakOnSourceCut: true, breakOnSpeakerChange: true, fadeMs: 200 },
    layout: { mode: 'column', density: null, turnEvery: 2 },
    camera: { motion: 'smooth', dwell: 0.25, minTravelMs: 120, maxTravelMs: 1600, travelMs: 300, anticipation: 0.5, maxTurnDeg: 90, fit: null, zoomLog: true },
    entrance: { durMs: 300, pre: 0.5 },
    reveal: 'block',
    presentation: { mode: 'overlay', viewport: null, background: '#00000000', history: { maxBlocks: 8, opacity: 1 }, ending: 'hold', translation: 'fixed' },
  };

  const PRESETS = {
    standard: {},
    light: { camera: { maxTurnDeg: 0, anticipation: 0.3, dwell: 0.35 }, intensityCap: 40 },
  };

  function deepMerge(base, over) {
    if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    for (const k of Object.keys(over)) {
      const v = over[k];
      if (v === undefined) continue;
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object') ? deepMerge(base[k], v) : v;
    }
    return out;
  }

  function aspectKind(w, h) {
    const r = w / h;
    if (r > 1.2) return 'wide';
    if (r < 0.85) return 'vertical';
    return 'square';
  }

  function refCanvas(aspect) {
    const r = aspect.w / aspect.h;
    if (r >= 1) return { w: Math.round(SHORT_SIDE * r), h: SHORT_SIDE };
    return { w: SHORT_SIDE, h: Math.round(SHORT_SIDE / r) };
  }

  function resolveOptions(opts) {
    const aspect = opts.aspect || { w: 16, h: 9 };
    const kind = aspectKind(aspect.w, aspect.h);
    const tokens = LAYOUT_TOKENS[kind];
    let o = deepMerge(DEFAULTS, opts.options || {});
    const preset = PRESETS[o.preset] || PRESETS.standard;
    o = deepMerge(o, { camera: preset.camera || {} });
    const ref = refCanvas(aspect);
    const vp = o.presentation.viewport || tokens.viewport;
    const viewport = { x: vp[0] * ref.w, y: vp[1] * ref.h, w: vp[2] * ref.w, h: vp[3] * ref.h };
    let intensity = clamp(opts.intensity == null ? 60 : opts.intensity, 0, 100);
    if (preset.intensityCap != null) intensity = Math.min(intensity, preset.intensityCap);
    return {
      ref, kind, viewport,
      density: o.layout.density == null ? tokens.density : o.layout.density,
      fit: o.camera.fit == null ? tokens.fit : o.camera.fit,
      options: o,
      intensity,
      speed: clamp(opts.speed == null ? 1 : opts.speed, 0.25, 4),
      seed: (opts.seed == null ? 137 : opts.seed) >>> 0,
      fontPx: opts.fontPx || 36,
      reveal: opts.reveal || o.reveal,
      sourceId: opts.sourceId || 'main',
      clipId: opts.clipId || 'clip-01',
    };
  }

  // ---------------------------------------------------------------- text helpers
  const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
  const LATIN = /[A-Za-z0-9]/;
  const END_PUNCT = /[，。！？；：、,.!?;:…—]$/;

  function units(text) {
    let u = 0;
    for (const ch of text) u += CJK.test(ch) ? 1 : (LATIN.test(ch) ? 0.55 : 0.5);
    return u;
  }
  function isLatinEdge(text, tail) {
    const ch = tail ? text[text.length - 1] : text[0];
    return ch != null && LATIN.test(ch);
  }
  function gapBetween(a, b) {
    if (isLatinEdge(a, true) && isLatinEdge(b, false)) return 0.28;
    if (isLatinEdge(a, true) !== isLatinEdge(b, false)) return 0.12;
    return 0;
  }

  function defaultMeasure(text, px) { return units(text) * px * 1.0; }

  // ---------------------------------------------------------------- rows（typeMonkey.js 的 tm-row）
  /* 一条 cue 切成若干**行**：行是排版与镜头的最小单位（typeMonkey.js 里一条歌词一行、镜头
     一行一停）。预算 `2.5 + 5 × density` 个 CJK 单位（density 0.65 → 5.75，中文四五个字、
     英文一两个词），句读处满四成预算就断；主角词独占一行。 */
  function chunkCue(cue, roles, density) {
    const budget = 2.5 + 5 * density;
    const blocks = [];
    let cur = [];
    let curUnits = 0;
    const flush = () => { if (cur.length) { blocks.push({ words: cur, hero: false }); cur = []; curUnits = 0; } };
    for (const w of cue.words) {
      const role = roles[w.id] || w.role || 'normal';
      if (role === 'hero') { flush(); blocks.push({ words: [w], hero: true }); continue; }
      const u = units(w.text);
      if (cur.length && curUnits + u > budget) flush();
      cur.push(w); curUnits += u;
      if (END_PUNCT.test(w.text) && curUnits >= budget * 0.4) flush();
    }
    flush();
    return blocks.map(b => ({ cueId: cue.id, speaker: cue.speaker, words: b.words, hero: b.hero }));
  }

  /* 一行的块内排版：词左对齐一路排过去（不折行、不居中——typeMonkey.js 的行是 `display: flex`，
     `transform-origin: left center`）。块宽 `w` 是**取景宽**：文字宽与最短两字宽取大（它的
     `rowWidth < fontSize × minWidthNum` 夹取），镜头按它居中，右下角枢转也按它；`textW` 是
     实际文字宽。 */
  function layoutBlock(block, R, measure, roles) {
    // 同列等宽：先按基础字号量自然宽，再把字号缩放到列宽——短句字大、长句字小，一列两边都齐。
    // 并过块（防快闪）的长块按字数均分折成几行，每行各自撑到列宽：看上去与几个单行块一样，
    // 只是一起入场、镜头只停一次。
    const budget = 2.5 + 5 * R.density;
    const colW = R.fontPx * budget;
    const us = block.words.map((w) => units(w.text));
    const total = us.reduce((a, b) => a + b, 0);
    const count = block.words.length;
    const lineCount = (block.hero || total <= budget * LINE_OVERFLOW) ? 1 : clamp(Math.ceil(total / budget), 1, Math.max(1, count));
    const ranges = [];
    let start = 0, acc = 0;
    for (let line = 1; line <= lineCount; line++) {
      if (line === lineCount) { ranges.push([start, count]); break; }
      const target = total * line / lineCount;
      let end = start;
      while (end < count - (lineCount - line) && (end === start || acc + us[end] / 2 <= target)) { acc += us[end]; end++; }
      ranges.push([start, end]);
      start = end;
    }
    const cap = block.hero ? ROW_SCALE_HERO_MAX : ROW_SCALE_MAX;
    const words = [];
    let y = 0, textW = 0, w = 0, font = Infinity;
    ranges.forEach(([a, b]) => {
      const line = block.words.slice(a, b);
      let natural = 0;
      line.forEach((wd, k) => {
        if (k) natural += gapBetween(line[k - 1].text, wd.text) * R.fontPx;
        natural += Math.max(0, measure(wd.text, R.fontPx));
      });
      const rowScale = natural > 1e-6 ? q(clamp(colW / natural, ROW_SCALE_MIN, cap), ROW_SCALE_QUANT) : 1;
      const base = R.fontPx * rowScale;
      const lineH = base * LINE_HEIGHT;
      let x = 0;
      line.forEach((wd, k) => {
        if (k) x += gapBetween(line[k - 1].text, wd.text) * base;
        const width = Math.max(0, measure(wd.text, base));
        words.push({
          id: wd.id, text: wd.text, start: wd.start, end: wd.end,
          role: roles[wd.id] || wd.role || 'normal',
          x: q(x), y, w: q(width), h: q(lineH), font: base,
        });
        x += width;
      });
      textW = Math.max(textW, q(x));
      // 行盒量化到 1/32：半宽 / 半高与段内累计高度都落在 1/64 网格上，行中心不用再四舍五入，
      // 枢转角与相邻行严丝合缝、AABB 不会因舍入而假重叠
      w = Math.max(w, q(Math.max(x, MIN_ROW_EM * base), 32));
      y += q(lineH, 32);
      font = Math.min(font, base);
    });
    return { w, h: y, textW, lines: ranges.length || 1, words, font: isFinite(font) ? font : R.fontPx };
  }

  /* 防「快闪」：停留不足 MIN_BLOCK_DWELL_S 的块并进相邻块。停留 = 下一块首词开口 − 本块首词开口
     （段尾块 = 末词收声 − 首词开口）。并块总是保住**较早**的入场时刻——字可以早一点出来，不能
     念完了才出来。邻块挑字数少的那个（一样多取前一块），一串都很短的块两两成对、不会滚成
     一大块。主角块不参与；换说话人不并；并完不超过 MERGE_MAX_LINES 行。 */
  function mergeFlashBlocks(blocks, budget) {
    const unitsOf = (b) => b.words.reduce((a, w) => a + units(w.text), 0);
    const first = (b) => b.words[0].start;
    let i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      const next = blocks[i + 1];
      const dwell = next ? first(next) - first(b) : b.words.reduce((m, w) => Math.max(m, w.end), first(b)) - first(b);
      if (b.hero || dwell >= MIN_BLOCK_DWELL_S) { i++; continue; }
      const fits = (o) => !!o && !o.hero && (o.speaker || null) === (b.speaker || null) && unitsOf(o) + unitsOf(b) <= budget * MERGE_MAX_LINES;
      const p = i > 0 && fits(blocks[i - 1]) ? blocks[i - 1] : null;
      const n = fits(next) ? next : null;
      if (!p && !n) { i++; continue; }
      const intoPrev = p && n ? unitsOf(p) <= unitsOf(n) : !!p;
      if (intoPrev) { p.words = p.words.concat(b.words); blocks.splice(i, 1); }
      else { b.words = b.words.concat(n.words); blocks.splice(i + 1, 1); }
    }
    return blocks;
  }

  // ---------------------------------------------------------------- sequences
  function segment(input, R) {
    const cues = input.cues;
    const S = R.options.sequence;
    const seqs = [];
    let cur = null;
    for (let ci = 0; ci < cues.length; ci++) {
      const cue = cues[ci];
      if (!cue.words || !cue.words.length) continue;
      const blocks = chunkCue(cue, input.roles || {}, R.density);
      const wordCount = cue.words.length;
      let breakHere = !cur;
      const reasons = [];
      if (cur) {
        const prev = cues[cur.cueIdxs[cur.cueIdxs.length - 1]];
        if (cue.breakBefore) { breakHere = true; reasons.push('manual'); }
        if (S.breakOnSpeakerChange && cue.speaker && prev.speaker && cue.speaker !== prev.speaker) { breakHere = true; reasons.push('speaker'); }
        if ((cue.start - prev.end) * 1000 >= S.pauseThresholdMs) { breakHere = true; reasons.push('pause'); }
        if ((cue.end - cur.start) * 1000 > S.maxDurationMs) { breakHere = true; reasons.push('duration'); }
        if (cur.blocks.length + blocks.length > S.maxBlocks) { breakHere = true; reasons.push('blocks'); }
        if (cur.wordCount + wordCount > S.maxWords) { breakHere = true; reasons.push('words'); }
      }
      if (breakHere) {
        cur = { id: 'seq-' + cue.words[0].id, cueIdxs: [], blocks: [], wordCount: 0, start: cue.start, end: cue.end, breakReasons: reasons };
        seqs.push(cur);
      }
      cur.cueIdxs.push(ci);
      cur.blocks.push(...blocks);
      cur.wordCount += wordCount;
      cur.end = Math.max(cur.end, cue.end);
    }
    const budget = 2.5 + 5 * R.density;
    seqs.forEach((sq) => mergeFlashBlocks(sq.blocks, budget));
    return seqs;
  }

  // ---------------------------------------------------------------- world layout（列 + 枢转）
  const SIDES = ['right', 'below', 'left', 'above'];

  function aabbOf(center, w, h, rot) {
    const sw = (rot % 180 === 90) ? h : w;
    const sh = (rot % 180 === 90) ? w : h;
    return { x0: center[0] - sw / 2, y0: center[1] - sh / 2, x1: center[0] + sw / 2, y1: center[1] + sh / 2, w: sw, h: sh };
  }
  function overlapArea(a, b, margin) {
    const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + margin;
    const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) + margin;
    return (ox > 0 && oy > 0) ? ox * oy : 0;
  }
  function unionBox(boxes) {
    const u = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const b of boxes) { u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0); u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1); }
    return u;
  }
  function normRot(r) { return ((r % 360) + 360) % 360; }

  /** 直角旋转一个向量（顺时针为正、y 向下），编译期不用三角函数。 */
  function rotVec(rot, v) {
    const r = normRot(rot);
    if (r === 90) return [0 - v[1], v[0]]; // `0 - x` 而不是 `-x`：不出 -0，量化后的坐标逐字节稳定
    if (r === 180) return [0 - v[0], 0 - v[1]];
    if (r === 270) return [v[1], 0 - v[0]];
    return [v[0], v[1]];
  }

  /* 「顺着走」的方向：段自己坐标系里的下方——行就是往这个方向叠的（typeMonkey.js 里不转
     的行一路往下叠，转了 90° 的往左叠）。 */
  function runSideOf(rotDeg) { return SIDES[(1 + Math.round(normRot(rotDeg) / 90)) % 4]; }

  /* 段（typeMonkey.js 的 tm-block）：若干行左对齐往下叠成一列，整段一个角度。`origin` 是段
     的局部原点（首行左上角）在世界里的位置，`height` 是已叠的高度。 */
  function paraOf(origin, rot) { return { origin: [origin[0], origin[1]], rot: normRot(rot), height: 0 }; }
  function rowCenterIn(para, b) {
    const r = rotVec(para.rot, [b.w / 2, para.height + b.h / 2]);
    return [para.origin[0] + r[0], para.origin[1] + r[1]];
  }
  function paraFromCenter(center, rot, b) {
    const r = rotVec(rot, [b.w / 2, b.h / 2]);
    return paraOf([center[0] - r[0], center[1] - r[1]], rot);
  }

  /* 枢转（typeMonkey.js 的 `rotate: 'lb' | 'rb'`）：新段绕上一行的一个下角转 90°——
       lb：绕**左下角**，新段顺时针转 90°，新首行的左下角就是那个角（它 `transform-origin: left bottom`、
           上一段 `rotate(-90deg)` 的逆）；
       rb：绕**右下角**，新段逆时针转 90°，新首行的右下角就是那个角（`originX × 100% bottom`、
           `rotate(90deg)` 的逆）。
     角取的是取景宽（`w`）的角，与它按夹取后的 `cur.width` 定位一致。 */
  function pivotPara(para, prevRow, b, dir) {
    const pivotLocal = dir === 'lb' ? [0, para.height] : [prevRow.w, para.height];
    const rot = normRot(para.rot + (dir === 'lb' ? 90 : -90));
    const anchor = dir === 'lb' ? [0, b.h] : [b.w, b.h];
    const pv = rotVec(para.rot, pivotLocal);
    const av = rotVec(rot, anchor);
    return paraOf([para.origin[0] + pv[0] - av[0], para.origin[1] + pv[1] - av[1]], rot);
  }

  /* 世界排版：行一行一行地进来——
       1. 固定行（pins）先登记，自动行绕开它；轮到它时按固定姿态另起一段；
       2. 平常顺着当前段往下叠；
       3. 上次转向之后至少隔了 `turnEvery` 行时，用行种子抽一次「转不转」：到句读或 cue 边界处
          概率 `0.55 × min(intensity / 60, 1.6)`，行中间 `0.2 × …`（`maxTurnDeg < 90` 恒否）——
          typeMonkey.js 的作者标转向不看句读，倒鸭子的味道就在「念几行就竖过来」；转的话方向先抽
          （70% 与上一次相反——typeMonkey.js 的作者也是 lb / rb 交替着标），撞到已有行就换另一边；
       4. 顺着叠会撞上别的段（同向连转三次会往里卷）时，节流允许就转，不允许就把新段**跳**到
          世界包围盒外顺着走的那一侧（隔 0.6 个视口），角度不变——不接受重叠。
     种子只在「转不转」「往哪转」两处进入；行的 `w` 是取景宽，AABB 按它算。 */
  function layoutWorld(seq, blocks, R, pins, seqSeed, startRot) {
    const L = R.options.layout;
    const canTurn = R.options.camera.maxTurnDeg >= 90;
    const placed = []; // {box, blockIdx}
    const diagnostics = [];
    let para = null;
    let paraIdx = -1;
    let sinceTurn = L.turnEvery; // 开头就允许转
    let lastDir = null;
    const other = (dir) => (dir === 'lb' ? 'rb' : 'lb');
    blocks.forEach((b, i) => {
      const pin = pins && pins[b.key];
      if (pin) placed.push({ box: aabbOf([q(pin.center[0]), q(pin.center[1])], b.w, b.h, normRot(pin.rotDeg || 0)), blockIdx: i, pinned: true });
    });
    const collides = (center, b, rot, selfIdx) => {
      const box = aabbOf(center, b.w, b.h, rot);
      return placed.some(p => p.blockIdx !== selfIdx && overlapArea(box, p.box, 0) > 0);
    };
    const commit = (i, center, rot, placement) => {
      const b = blocks[i];
      b.center = [q(center[0]), q(center[1])]; b.rotDeg = rot; b.placement = placement; b.para = paraIdx;
      if (placement !== 'pinned') placed.push({ box: aabbOf(b.center, b.w, b.h, rot), blockIdx: i });
      para.height += b.h;
    };
    let tone = 0;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const key = b.key;
      const pin = pins && pins[key];
      const rng = splitmix64(fnv1a64([RECIPE_VERSION, ALGORITHM_VERSION, R.seed, seqSeed == null ? '' : seqSeed, R.sourceId, R.clipId, key].join('|')));
      b.seedHex = rng.next().toString(16).padStart(16, '0');
      const turnRoll = rng.unit();
      const dirRoll = rng.unit();
      const toneRoll = rng.unit();
      // 逐句换色：一句的各行同色；主色占一半，两档强调色不连着出
      if (i === 0 || blocks[i - 1].cueId !== b.cueId) {
        const pick = toneRoll < 0.5 ? 0 : (toneRoll < 0.78 ? 1 : 2);
        tone = (i > 0 && pick === tone) ? 0 : pick;
      }
      b.tone = tone;
      if (pin) {
        const rot = normRot(pin.rotDeg || 0);
        para = paraFromCenter([q(pin.center[0]), q(pin.center[1])], rot, b); paraIdx++;
        commit(i, pin.center, rot, 'pinned');
        sinceTurn++;
        continue;
      }
      if (!para) {
        para = paraOf([0, 0], startRot || 0); paraIdx++;
        const c = rowCenterIn(para, b);
        if (!collides(c, b, para.rot, i)) { commit(i, c, para.rot, 'auto'); continue; }
      }
      const prevRow = blocks[i - 1];
      const boundary = !prevRow || prevRow.cueId !== b.cueId || END_PUNCT.test(prevRow.words[prevRow.words.length - 1].text);
      const wish = canTurn && sinceTurn >= L.turnEvery && turnRoll < (boundary ? 0.55 : 0.2) * clamp(R.intensity / 60, 0, 1.6);
      const straight = rowCenterIn(para, b);
      const straightOk = !collides(straight, b, para.rot, i);
      if (!wish && straightOk) { commit(i, straight, para.rot, 'auto'); sinceTurn++; continue; }
      let done = false;
      if (canTurn && sinceTurn >= L.turnEvery && prevRow) {
        const first = lastDir ? (dirRoll < 0.7 ? other(lastDir) : lastDir) : (dirRoll < 0.5 ? 'lb' : 'rb');
        for (const dir of [first, other(first)]) {
          const np = pivotPara(para, prevRow, b, dir);
          const c = rowCenterIn(np, b);
          if (collides(c, b, np.rot, i)) continue;
          para = np; paraIdx++;
          commit(i, c, np.rot, 'auto');
          sinceTurn = 0; lastDir = dir; done = true;
          break;
        }
      }
      if (done) continue;
      if (straightOk) { commit(i, straight, para.rot, 'auto'); sinceTurn++; continue; }
      // 跳到世界外：同角度另起一段，放在顺着走的那一侧
      const world = unionBox(placed.map(p => p.box));
      const zoom = focusFor(Object.assign({}, b, { center: [0, 0], rotDeg: para.rot }), R).zoom;
      const side = runSideOf(para.rot);
      const box0 = aabbOf([0, 0], b.w, b.h, para.rot);
      const gap = 0.6 * (side === 'right' || side === 'left' ? R.viewport.w : R.viewport.h) / zoom;
      const prevCenter = prevRow ? prevRow.center : [0, 0];
      let c;
      if (side === 'right') c = [world.x1 + gap + box0.w / 2, prevCenter[1]];
      else if (side === 'left') c = [world.x0 - gap - box0.w / 2, prevCenter[1]];
      else if (side === 'below') c = [prevCenter[0], world.y1 + gap + box0.h / 2];
      else c = [prevCenter[0], world.y0 - gap - box0.h / 2];
      diagnostics.push({ level: 'info', code: 'layout-jump', block: key });
      para = paraFromCenter([q(c[0]), q(c[1])], para.rot, b); paraIdx++;
      commit(i, c, para.rot, 'auto');
      sinceTurn++;
    }
    const world = unionBox(placed.map(p => p.box));
    const limit = 6;
    if ((world.x1 - world.x0) > R.ref.w * limit || (world.y1 - world.y0) > R.ref.h * limit) diagnostics.push({ level: 'warn', code: 'world-too-large', sequence: seq.id });
    const lastRot = blocks.length ? blocks[blocks.length - 1].rotDeg : 0;
    return { world, diagnostics, lastRot, lastSide: runSideOf(lastRot) };
  }

  /* 段与段之间：TypeMonkey 只有一张无限画布，镜头一路飞；我们的「动画段」是排版局部性的
     单位，不该变成一次硬切。所以每一段的世界先在自己的局部坐标里排好，再**接在上一段世界
     旁边**（顺着上一段最后的走向，隔开约 0.6 个视口），镜头从上一段的末姿态飞过去。
     返回的是这一段世界在全局坐标里的原点；块的 `center` 是全局值，`localCenter` 与 pins
     仍是局部值（重排上一段不该把这一段固定的块也挪走）。 */
  function placeWorld(local, seq, prevSeq, prevWorlds, R, runSide) {
    const first = seq.blocks[0];
    const prevLast = prevSeq.blocks[prevSeq.blocks.length - 1];
    const pw = prevSeq.world;
    const zoom = focusFor(first, R).zoom;
    const order = [runSide].concat(SIDES.filter(s => s !== runSide));
    for (let k = 1; k <= 4; k++) {
      for (const side of order) {
        const gapX = 0.6 * k * R.viewport.w / zoom, gapY = 0.6 * k * R.viewport.h / zoom;
        let ox, oy;
        if (side === 'right') { ox = pw.x1 + gapX - local.x0; oy = prevLast.center[1] - first.center[1]; }
        else if (side === 'left') { ox = pw.x0 - gapX - local.x1; oy = prevLast.center[1] - first.center[1]; }
        else if (side === 'below') { oy = pw.y1 + gapY - local.y0; ox = prevLast.center[0] - first.center[0]; }
        else { oy = pw.y0 - gapY - local.y1; ox = prevLast.center[0] - first.center[0]; }
        const box = { x0: local.x0 + ox, y0: local.y0 + oy, x1: local.x1 + ox, y1: local.y1 + oy };
        if (prevWorlds.every(w => overlapArea(box, w, 0) === 0)) return [ox, oy];
      }
    }
    const far = prevWorlds.reduce((m, w) => Math.max(m, w.x1), -Infinity);
    return [far + 3 * R.viewport.w / zoom - local.x0, prevLast.center[1] - first.center[1]];
  }

  // ---------------------------------------------------------------- camera
  /* 取景（typeMonkey.js 的 `scale = conWidth / rowWidth`）：镜头对着**当前行**，把它的取景宽
     （已按最短两字夹取）放成视口宽的 `fit`——短行大、长行小，每行都占同一屏宽；行盒居中。
     可读性区间：屏幕字号 ≥ 参考画布高 3.2%，≤ 30%，且单行高 ≤ 视口高 × fit。 */
  function focusFor(block, R) {
    const vp = R.viewport;
    let zoom = (vp.w * R.fit) / Math.max(block.w, 1e-6);
    // 这一行自己的字号：同列等宽之后各行字号不同，可读性区间按它算
    // 不从 h 反推：折行的块 h 是几行之和，镜头不转时传进来的 w / h 还是对调过的
    const font = Math.max(block.font || block.h / LINE_HEIGHT, 1e-6);
    const zoomMin = (0.032 * R.ref.h) / font;
    const zoomMax = Math.min((vp.h * R.fit) / Math.max(block.h, 1e-6), (ZOOM_FONT_CAP * R.ref.h) / font);
    zoom = clamp(zoom, Math.min(zoomMin, zoomMax), zoomMax);
    return { x: block.center[0], y: block.center[1], rot: block.rotDeg, zoom: q(zoom, 4096) };
  }

  function overviewFor(world, rot, R) {
    const vp = R.viewport;
    const cx = (world.x0 + world.x1) / 2, cy = (world.y0 + world.y1) / 2;
    const w = (world.x1 - world.x0) || 1, h = (world.y1 - world.y0) || 1;
    const sw = rot % 180 === 90 ? h : w, sh = rot % 180 === 90 ? w : h;
    const zoom = Math.min(vp.w * 0.9 / sw, vp.h * 0.9 / sh);
    return { x: q(cx), y: q(cy), rot, zoom: q(zoom, 4096) };
  }

  function turnDelta(from, to) {
    let d = normRot(to - from);
    if (d > 180) d -= 360;
    if (d === -180) d = 180; // 平局固定取 cw
    return d;
  }

  /* 相机段。`entry` 是上一段镜头静下来的时刻与姿态（第一段没有：硬切到首块）。
       smooth   ：t1 = onset_i；travel = clamp((1 − dwell) × 间隔, minTravel, maxTravel / speed)，
                  再不早于上一段镜头停下的时刻——镜头一直在飞、到达即开口，是 MonkeyCam Smooth。
       stopAndGo：travel = min(travelMs / speed, 0.45 × 到下一 onset)，lead = anticipation × travel，
                  窗口 `[onset − lead, onset − lead + travel]`，是 MonkeyCam Stop and Go。
     窗口短于 minTravel 时去掉转向（角度突变最刺眼），不推迟词时间。 */
  function planCamera(seq, blocks, R, nextSeqOnset, projectEnd, entry) {
    const C = R.options.camera;
    const smooth = C.motion !== 'stopAndGo';
    const minTravel = C.minTravelMs / 1000;
    const maxTravel = (C.maxTravelMs / 1000) / R.speed;
    const travelPref = (C.travelMs / 1000) / R.speed;
    const onsets = blocks.map(b => b.firstT);
    const segs = [];
    let prevPose = entry ? entry.pose : focusFor(blocks[0], R);
    for (let i = 0; i < blocks.length; i++) {
      const to = focusFor(blocks[i], R);
      if (i === 0 && !entry) {
        segs.push({ t0: onsets[0], t1: onsets[0], from: to, to, block: i, kind: 'cut', lead: 0 });
        prevPose = to; continue;
      }
      const prevEnd = i === 0 ? entry.t : segs[segs.length - 1].t1;   // 上一次镜头停下的时刻
      const prevRef = i === 0 ? entry.t : onsets[i - 1];              // 间隔从哪儿算
      const nextOnset = i + 1 < blocks.length ? onsets[i + 1] : Infinity;
      let t0, t1;
      if (smooth) {
        const interval = Math.max(0, onsets[i] - prevRef);
        let travel = clamp((1 - C.dwell) * interval, minTravel, maxTravel);
        travel = Math.min(travel, Math.max(0.05, onsets[i] - prevEnd));
        t1 = onsets[i]; t0 = t1 - travel;
      } else {
        let travel = Math.min(travelPref, 0.45 * (nextOnset - onsets[i]));
        let lead = Math.min(C.anticipation * travel, 0.3 * Math.max(0, onsets[i] - prevRef));
        t0 = onsets[i] - lead;
        if (t0 < prevEnd) { lead = Math.max(0, onsets[i] - prevEnd); t0 = onsets[i] - lead; }
        if (t0 + travel > nextOnset && isFinite(nextOnset)) travel = Math.max(0.05, nextOnset - t0);
        t1 = t0 + travel;
      }
      const travel = t1 - t0;
      const dRot = turnDelta(prevPose.rot, to.rot);
      const noTurn = travel < minTravel && dRot !== 0;
      const toAdj = noTurn ? Object.assign({}, to, { rot: prevPose.rot, zoom: focusFor(Object.assign({}, blocks[i], { rotDeg: prevPose.rot, w: blocks[i].rotDeg % 180 !== prevPose.rot % 180 ? blocks[i].h : blocks[i].w, h: blocks[i].rotDeg % 180 !== prevPose.rot % 180 ? blocks[i].w : blocks[i].h }), R).zoom }) : to;
      segs.push({ t0: q(t0, 1000), t1: q(t1, 1000), from: prevPose, to: toAdj, dRot: noTurn ? 0 : dRot, block: i, kind: i === 0 ? 'enter' : 'travel', lead: q(onsets[i] - t0, 1000) });
      prevPose = toAdj;
    }
    // 段尾
    const lastWordEnd = Math.max(...blocks.map(b => b.lastT));
    const cutAt = isFinite(nextSeqOnset) ? nextSeqOnset : projectEnd;
    const room = cutAt - lastWordEnd;
    let ending = { kind: 'hold', from: lastWordEnd, until: cutAt };
    if (R.options.presentation.ending === 'overviewIfRoom' && room >= 1.2) {
      const ov = overviewFor(seq.world, prevPose.rot, R);
      const t0 = lastWordEnd + 0.3;
      segs.push({ t0: q(t0, 1000), t1: q(t0 + 0.6, 1000), from: prevPose, to: ov, dRot: 0, block: -1, kind: 'overview', lead: 0 });
      ending = { kind: 'overview', from: t0, until: cutAt };
      prevPose = ov;
    }
    const last = segs[segs.length - 1];
    return { segments: segs, ending, endPose: prevPose, endT: last.t1 };
  }

  // ---------------------------------------------------------------- compile
  function compile(input, opts) {
    const R = resolveOptions(opts || {});
    const measure = (opts && opts.measure) || defaultMeasure;
    const roles = input.roles || {};
    const seqsRaw = segment(input, R);
    const sequences = [];
    const diagnostics = [];
    const projectEnd = input.duration || Math.max(...input.cues.map(c => c.end));
    // 先分块与本地排版
    for (const s of seqsRaw) {
      const blocks = s.blocks.map(b => {
        const lb = layoutBlock(b, R, measure, roles);
        return Object.assign({ key: b.words[0].id, cueId: b.cueId, hero: b.hero, firstT: b.words[0].start, lastT: b.words[b.words.length - 1].end }, lb);
      });
      sequences.push({ id: s.id, key: s.blocks[0].words[0].id, cueIdxs: s.cueIdxs, start: s.start, end: s.end, breakReasons: s.breakReasons, blocks });
    }
    // 世界排版（局部）→ 接到上一段旁边（全局）→ 相机（从上一段末姿态飞进来）
    const worlds = [];
    let entry = null;
    for (let si = 0; si < sequences.length; si++) {
      const seq = sequences[si];
      const seqSeed = input.seqSeeds ? input.seqSeeds[seq.key] : undefined;
      const prevSeq = sequences[si - 1];
      const prevLastRot = prevSeq ? prevSeq.blocks[prevSeq.blocks.length - 1].rotDeg : 0;
      const lw = layoutWorld(seq, seq.blocks, R, input.pins || {}, seqSeed, prevLastRot);
      seq.seqSeed = seqSeed == null ? null : seqSeed;
      diagnostics.push(...lw.diagnostics);
      const prev = sequences[si - 1];
      const origin = prev ? placeWorld(lw.world, seq, prev, worlds, R, runSideOf(prevLastRot)) : [0, 0];
      seq.origin = [q(origin[0]), q(origin[1])];
      for (const b of seq.blocks) { b.localCenter = b.center; b.center = [q(b.center[0] + seq.origin[0]), q(b.center[1] + seq.origin[1])]; }
      seq.world = { x0: q(lw.world.x0 + seq.origin[0]), y0: q(lw.world.y0 + seq.origin[1]), x1: q(lw.world.x1 + seq.origin[0]), y1: q(lw.world.y1 + seq.origin[1]) };
      worlds.push(seq.world);
      const next = sequences[si + 1];
      const cam = planCamera(seq, seq.blocks, R, next ? next.blocks[0].firstT : Infinity, projectEnd, entry);
      seq.segments = cam.segments;
      seq.ending = cam.ending;
      seq.cutAt = seq.segments[0].t0; // 镜头从这一刻起飞向本段（第一段：硬切）
      entry = { pose: cam.endPose, t: cam.endT };
    }
    for (let si = 0; si < sequences.length; si++) {
      const seq = sequences[si];
      const next = sequences[si + 1];
      seq.visibleUntil = next ? next.cutAt : projectEnd;
    }
    const E = R.options.entrance;
    const entranceDur = (E.durMs / 1000) / R.speed;
    return {
      version: { recipe: RECIPE_VERSION, algorithm: ALGORITHM_VERSION },
      seed: R.seed, ref: R.ref, aspectKind: R.kind, viewport: roundRect(R.viewport),
      fontPx: R.fontPx, density: R.density, fit: R.fit, intensity: R.intensity, speed: R.speed, reveal: R.reveal,
      entrance: { dur: q(entranceDur, 1000), pre: q(entranceDur * E.pre, 1000) },
      options: R.options, duration: projectEnd,
      sequences, diagnostics,
    };
  }

  // ---------------------------------------------------------------- sampling
  function ease(u) { // AE `ease()` 同款：首尾速度为零的 Hermite（smoothstep），单调
    u = clamp(u, 0, 1);
    return u * u * (3 - 2 * u);
  }
  /* CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1)：typeMonkey.js 的 transition / zoomIn 曲线，
     起步快、落地软。x(t) 用牛顿法反解（定步数，与内核逐位一致）。 */
  function bez(t, p1, p2) { const mt = 1 - t; return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t; }
  function bezD(t, p1, p2) { const mt = 1 - t; return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2); }
  function cssEase(u) {
    u = clamp(u, 0, 1);
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const x = bez(t, 0.25, 0.25) - u;
      if (Math.abs(x) < 1e-7) break;
      const dx = bezD(t, 0.25, 0.25);
      if (dx === 0) break;
      t -= x / dx;
    }
    t = clamp(t, 0, 1);
    return bez(t, 0.1, 1.0);
  }

  function poseAt(seq, t) {
    const segs = seq.segments;
    if (!segs.length) return { x: 0, y: 0, rot: 0, zoom: 1 };
    if (t < segs[0].t0) return segs[0].from;
    let cur = segs[0].to;
    for (const s of segs) {
      if (t < s.t0) break;
      if (t >= s.t1) { cur = s.to; continue; }
      const u = (t - s.t0) / Math.max(1e-6, s.t1 - s.t0);
      const e = (seq._ease || ease)(u);   // 三个通道同一条曲线：位置、角度、缩放同时起步、同时停下
      const z = seq._zoomLog === false ? lerp(s.from.zoom, s.to.zoom, e) : Math.exp(lerp(Math.log(s.from.zoom), Math.log(s.to.zoom), e));
      return { x: lerp(s.from.x, s.to.x, e), y: lerp(s.from.y, s.to.y, e), rot: s.from.rot + (s.dRot || 0) * e, zoom: z, segment: s };
    }
    return cur;
  }

  function sample(plan, t) {
    const seqs = plan.sequences;
    let si = -1;
    for (let i = 0; i < seqs.length; i++) if (t >= seqs[i].cutAt) si = i;
    const fadeS = plan.options.sequence.fadeMs / 1000;
    const frame = { t, seqIdx: si, camera: null, blocks: [], fading: null, viewport: plan.viewport, mode: plan.options.presentation.mode };
    if (si < 0) return frame;
    const seq = seqs[si];
    seq._zoomLog = plan.options.camera.zoomLog;
    seq._ease = plan.options.camera.motion === 'stopAndGo' ? cssEase : ease; // 停走档是 CSS transition 的曲线
    frame.camera = poseAt(seq, t);
    const hist = plan.options.presentation.history;
    const reveal = plan.reveal;
    const intensity = plan.intensity;
    /* 入场按 TypeMonkey 的口径：动画在 marker **之前** `pre` 就开始（它的 Fast Scale 是 pre 0.167 s、
       dur 0.333 s），到词真正念出来时已经站住大半——词不再「慢半拍」。形状按 typeMonkey.js 的
       `zoomIn`：从 `popFrom` 倍放大到 1，原点在**左中**（逐词时是词的左中，整块时是行的左中），
       CSS `ease`；动感 60 时从 0.3 倍起（它的 `scale(.3)`），动感 0 不缩放。 */
    const popDur = plan.entrance.dur;
    const pre = plan.entrance.pre;
    // 整行入场（默认）柔一些：从 0.7 倍起，也不标「正在说」——中文一词一字，逐字弹、逐字闪都太碎
    const popFrom = 1 - (reveal === 'word' ? 0.7 : 0.3) * clamp(intensity / 60, 0, 1);
    // 可见块与历史序
    const visible = seq.blocks.map((b, idx) => ({ idx, b })).filter(x => x.b.firstT - pre <= t);
    visible.sort((a, c) => c.b.firstT - a.b.firstT || c.idx - a.idx);
    visible.forEach((v, rank) => {
      const b = v.b;
      const opacity = rank === 0 ? 1 : (rank <= hist.maxBlocks ? hist.opacity : 0);
      if (opacity <= 0) return;
      const words = b.words.map((w, wi) => {
        const onset = reveal === 'word' ? w.start : b.firstT;
        const ox = reveal === 'word' ? w.x : 0;
        if (onset - pre > t) return { idx: wi, opacity: 0, scale: popFrom, ox, speaking: false };
        const k = clamp((t - (onset - pre)) / popDur, 0, 1);
        const e = cssEase(k);
        return { idx: wi, opacity: e, scale: popFrom + (1 - popFrom) * e, ox, speaking: reveal === 'word' && rank === 0 && w.start <= t && t < w.end };
      });
      frame.blocks.push({ idx: v.idx, rank, opacity, current: rank === 0, words });
    });
    /* 上一段：镜头飞过来的这一程里它还在画面上（同一台相机、同一张画布），到达后再用
       fadeMs 淡掉残余；alpha 从起飞到淡完走一条 ease。 */
    if (si > 0) {
      const fadeEnd = seq.segments[0].t1 + fadeS;
      if (t < fadeEnd) frame.fading = { seqIdx: si - 1, alpha: 1 - ease((t - seq.cutAt) / Math.max(1e-6, fadeEnd - seq.cutAt)), camera: null };
    }
    return frame;
  }

  // ---------------------------------------------------------------- matrices（列向量，[a,b,c,d,e,f]）
  function matMul(m, n) { // m ∘ n（先 n 后 m）
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }
  function matT(x, y) { return [1, 0, 0, 1, x, y]; }
  function matS(s) { return [s, 0, 0, s, 0, 0]; }
  function matR(deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; }
  function matInv(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
  }
  function apply(m, p) { return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]]; }

  function cameraMatrix(camera, viewport) {
    const vc = matT(viewport.x + viewport.w / 2, viewport.y + viewport.h / 2);
    return matMul(matMul(matMul(vc, matS(camera.zoom)), matR(-camera.rot)), matT(-camera.x, -camera.y));
  }
  function blockMatrix(block) {
    return matMul(matMul(matT(block.center[0], block.center[1]), matR(block.rotDeg)), matT(-block.w / 2, -block.h / 2));
  }

  // ---------------------------------------------------------------- utils
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function q(v, scale) { const s = scale || QUANT; return Math.round(v * s) / s; }
  function roundRect(r) { return { x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) }; }

  // ---------------------------------------------------------------- BaoCut 轨字段 `kinetic`
  /* 画面色板（设计稿 §3.3「配色」四档）。它们是**导出画面**的颜色，不是产品 UI 色，
     按文件登记在 `_ds_conformance.json`。`bg` 只在「纯色」背景（`presentation.mode = 'stage'`）
     时铺在字幕区域里。 */
  const PALETTES = [
    { id: 'classic', name: '经典', primary: '#FFFFFF', accent: '#FF9B42', secondary: '#59BAF2', bg: '#111214' },
    { id: 'neon', name: '荧光', primary: '#F4F4F4', accent: '#C6FF3D', secondary: '#FF4FD8', bg: '#0B0B12' },
    { id: 'paper', name: '暖纸', primary: '#F6EFE4', accent: '#FF6A3D', secondary: '#7FD1FF', bg: '#2A211C' },
    { id: 'ice', name: '冰蓝', primary: '#E8F4FF', accent: '#4CC9FF', secondary: '#FFD166', bg: '#0E1A26' },
  ];

  /* 字幕区域三档（§3.3「字幕区域」）：`null` = 按画幅档的 `layoutTokens.viewport`；
     双语时区域收一截，给固定在下沿的译文行让位（§3.6）。 */
  const VIEWPORTS = {
    center: { mono: null, bi: null },
    bottom: { mono: [0.06, 0.42, 0.88, 0.50], bi: [0.06, 0.40, 0.88, 0.42] },
    full: { mono: [0.03, 0.04, 0.94, 0.92], bi: [0.03, 0.04, 0.94, 0.78] },
  };

  /** 轨上 `kinetic` 字段的默认值——画廊那张卡落下去时种的就是这一份。
   *  `fit` / `density` 留 `null` 表示跟画幅档的 token 走（§7.1），属性页滑杆显示的是
   *  解出来的值，用户一动才写显式值。`heroes` / `breaks` / `pins` / `seqSeeds` 是阶段 C
   *  的实例记录（§5.4），键分别是 cue id、cue id、块键（首词 id）、段键（首词 id）。 */
  function defaults(demo) {
    return deepMerge({
      seed: 137, preset: 'standard', intensity: 60, speed: 1, paletteIdx: 0, reveal: 'block',
      fit: null, density: null,
      camera: { motion: 'smooth', dwell: 0.25, maxTurnDeg: 90, anticipation: 0.5 },
      presentation: { mode: 'overlay', history: { maxBlocks: 8, opacity: 1 }, ending: 'hold' },
      viewportMode: 'center',
      heroes: {}, breaks: [], pins: {}, seqSeeds: {},
    }, demo || {});
  }

  /** 「换一版」的下一枚种子：LCG 一步，确定性，与设计稿 §7.3 的「种子只是一个 u32」一致。 */
  function reseed(seed) { return ((seed >>> 0) * 1103515245 + 12345) % 2147483647; }

  /** 把 BaoCut 的 cue（`{id, start, end, sp, text}`）变成模型的输入：每个词一条
   *  `{id, text, start, end}`。词位是**把 cue 时长按词均分**的演示口径（同 `BC_WA.at`），
   *  真实实现读 transcript `words[]` 的起止。词 id 是 `cueId:idx`，`heroes` / `pins` 都按它记。 */
  function fromCues(cues, split, kin) {
    const breaks = (kin && kin.breaks) || [];
    return (cues || []).map((c) => {
      const words = split(c.text || '');
      const n = words.length || 1;
      const dur = Math.max(0, c.end - c.start);
      return {
        id: c.id, start: c.start, end: c.end, speaker: c.sp || null,
        breakBefore: breaks.indexOf(c.id) >= 0,
        words: words.map((w, i) => ({
          id: c.id + ':' + i, text: w,
          start: q(c.start + dur * i / n, 1000), end: q(c.start + dur * (i + 1) / n, 1000),
        })),
      };
    });
  }

  /** 词角色表：主角词来自 `kinetic.heroes`（cue id → 词下标），强调词来自源语言轨的
   *  强调词标记（`highlight.marks`，与属性页「强调词」那一段同一份，主角优先）。 */
  function rolesOf(kin, highlight) {
    const roles = {};
    const h = highlight && highlight.on ? highlight.marks || {} : {};
    Object.keys(h).forEach((cueId) => (h[cueId] || []).forEach((m) => { roles[cueId + ':' + m.index] = 'emphasis'; }));
    const heroes = (kin && kin.heroes) || {};
    Object.keys(heroes).forEach((cueId) => (heroes[cueId] || []).forEach((i) => { roles[cueId + ':' + i] = 'hero'; }));
    return roles;
  }

  /** 从一条轨的 `kinetic` 直接编译：把轨字段翻成 `compile` 的 input/opts。
   *  `env`：`aspect`（画幅）、`measure`（量宽）、`fontPx`、`bilingual`（译文行在不在画面上）、
   *  `highlight`（强调词标记）、`duration`。 */
  function planFor(cues, kin, env) {
    const k = kin || defaults();
    const e = env || {};
    const vp = (VIEWPORTS[k.viewportMode] || VIEWPORTS.center)[e.bilingual ? 'bi' : 'mono'];
    return compile({
      cues: fromCues(cues, e.split || ((t) => String(t).split(/\s+/).filter(Boolean)), k),
      roles: rolesOf(k, e.highlight), pins: k.pins || {}, seqSeeds: k.seqSeeds || {},
      duration: e.duration,
    }, {
      seed: k.seed, intensity: k.intensity, speed: k.speed, reveal: k.reveal,
      aspect: e.aspect || { w: 16, h: 9 }, measure: e.measure, fontPx: e.fontPx || 36,
      options: {
        preset: k.preset,
        layout: { density: k.density },
        camera: { motion: k.camera.motion, dwell: k.camera.dwell, maxTurnDeg: k.camera.maxTurnDeg, anticipation: k.camera.anticipation, fit: k.fit },
        presentation: { mode: k.presentation.mode, viewport: vp, history: k.presentation.history, ending: k.presentation.ending },
      },
    });
  }

  /** 播放头落在哪一段（按 `cutAt`，与 `sample` 同一判据）；没有就是 -1。 */
  function seqIndexAt(plan, t) {
    let si = -1;
    for (let i = 0; i < plan.sequences.length; i++) if (t >= plan.sequences[i].cutAt) si = i;
    return si;
  }

  window.BC_DZ = {
    ALGORITHM_VERSION, RECIPE_VERSION, SHORT_SIDE, MIN_ROW_EM, LINE_HEIGHT, MIN_BLOCK_DWELL_S, MERGE_MAX_LINES, mergeFlashBlocks, ZOOM_FONT_CAP, DEFAULTS, LAYOUT_TOKENS, PRESETS, PALETTES, VIEWPORTS,
    fnv1a64, splitmix64, deepMerge, resolveOptions, refCanvas, aspectKind,
    units, chunkCue, layoutBlock, segment, aabbOf, overlapArea, focusFor, overviewFor, turnDelta, runSideOf, rotVec, pivotPara,
    compile, sample, poseAt, ease, cssEase,
    matMul, matT, matS, matR, matInv, apply, cameraMatrix, blockMatrix,
    clamp, lerp, q,
    defaults, reseed, fromCues, rolesOf, planFor, seqIndexAt,
  };
})();
