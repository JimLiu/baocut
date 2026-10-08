/* Shorts 交付层的纯模型 —— 设计稿 docs/design/video/bcut-shorts-design.md（2026-09-27）。
   Shorts 不是一类片子，是一种交付格式：9:16、三四十秒、前 3 秒就有看点、首帧当封面、结尾接回开头、
   逐词字幕避开平台按钮。所以它是新建项目页上的一枚开关（与「做哪一类」正交：竖屏数学短视频仍走数学），
   外加舞台上的「平台安全区」参考线。

   这里算：
   - `SAFE`：竖屏平台 UI 遮住的地方，占画面的百分比。**唯一的数字来源**——模板平台款（抖音 / 小红书）
     2026-09-14 按这组数摆层，`model-shorts.test.js` 对拍它们都落在安全框里。平台自己的数字实测后再改。
     底部 2026-09-28 由 28 收到 24（1080×1920 下 461 px，公开的 Shorts 安全区模板给底部 350–450 px），字幕能再往下落。
   - `detect` / `effective`：从一句话里看出要不要按 Shorts 做；用户亲手拨过开关就听用户的。
   - `pipeline` / `promptLine` / `lengths`：打开后交给 Agent 的那一行话、流程条、可选时长。
   - `zones` / `inSafe`：舞台蒙层的几块矩形，以及一个盒子在不在安全框里。 */
(function () {
  const SAFE = {top: 8, right: 18, bottom: 24, side: 6};
  const RATIO = '9:16';
  /** Shorts 只给两档时长（BC_NEW.lengthSeconds 的预设键），缺省约 30 秒。 */
  const LENGTH_KEYS = ['s', 'm'];
  const DEFAULT_LENGTH = 's';

  /* 「短视频」会命中「竖屏数学短视频」——这正是要的：内容仍按数学走，格式按 Shorts。
     光说「竖屏」或「短片」不算（「竖屏倒计时开场」「剪贴簿风格的短片」都不是在说发平台）。 */
  const WORDS = /shorts?\b|短视频|竖屏短片|抖音|快手|视频号|reels?\b|tiktok/i;
  const detect = (text) => WORDS.test(String(text || ''));

  /** 生效值：`pick` 是用户亲手拨的（true / false），null 表示没拨过，按这句话猜。 */
  function effective(pick, text) {
    if (pick === true || pick === false) return {on: pick, by: 'pick'};
    return detect(text) ? {on: true, by: 'guess'} : {on: false, by: null};
  }

  const lengths = (all) => (all || []).filter((l) => LENGTH_KEYS.includes(l.k));
  const clampLength = (k) => (LENGTH_KEYS.includes(k) ? k : DEFAULT_LENGTH);

  /** 开关下那一行说明。 */
  const GRAMMAR = ['9:16', '前 3 秒是看点', '首帧当封面', '结尾接回开头', '逐词字幕避开平台按钮'];
  const grammarLine = () => GRAMMAR.join(' · ');

  /** 交给 Agent 的那一行：接在用户那句话后面，会话里看得见、改得了。 */
  function promptLine(lengthLabel) {
    return `按 Shorts 做：${RATIO}，${lengthLabel || '约 30 秒'}；前 3 秒就是看点，第一帧能当封面；`
      + '结尾落在看点上、画面接回开头，不加求关注的结尾；逐词字幕放在平台按钮挡不到的地方。';
  }

  /** 打开 Shorts 后的流程条（替换 BC_NEW.pipeline 里做新视频的那四步）。 */
  function pipeline(o) {
    const steps = [];
    if (o && o.attachments) steps.push({k: 'read', label: '读你给的材料', by: 'ai'});
    steps.push({k: 'script', label: '写钩子与脚本', by: 'ai'});
    steps.push({k: 'voice', label: '配音', by: 'ai'});
    steps.push({k: 'build', label: '制作画面', by: 'ai'});
    steps.push({k: 'sfx', label: '配音效', by: 'ai'});
    steps.push({k: 'check', label: '发布前检查', by: 'ai'});
    steps.push({k: 'review', label: '你来看成片', by: 'you'});
    return steps;
  }

  /* ---------- 舞台：平台安全区 ---------- */
  function parseRatio(r) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(r || ''));
    return m ? {w: +m[1], h: +m[2]} : null;
  }
  /** 只有竖幅（高大于宽）才有平台安全区。 */
  const isPortrait = (r) => { const p = parseRatio(r); return !!p && p.h > p.w; };

  /** 安全框：字和主体只放在这里面（百分比，x 6–82、y 8–76）。 */
  const safeBox = () => ({x: SAFE.side, y: SAFE.top, w: 100 - SAFE.side - SAFE.right, h: 100 - SAFE.top - SAFE.bottom});

  /** 三块遮挡区：顶部状态栏、右侧按钮列、底部文案与评论。右侧那一列夹在上下两块之间，不重叠。 */
  function zones() {
    return [
      {k: 'top',    label: '状态栏',            x: 0, y: 0, w: 100, h: SAFE.top},
      {k: 'right',  label: '点赞 · 评论 · 分享', x: 100 - SAFE.right, y: SAFE.top, w: SAFE.right, h: 100 - SAFE.top - SAFE.bottom},
      {k: 'bottom', label: '账号 · 文案 · 评论', x: 0, y: 100 - SAFE.bottom, w: 100, h: SAFE.bottom},
    ];
  }

  const EPS = 1e-6;
  /** 一个盒子（百分比 {x,y,w,h}）是否整个落在安全框里。 */
  function inSafe(b) {
    const s = safeBox();
    return !!b && b.x >= s.x - EPS && b.y >= s.y - EPS && b.x + b.w <= s.x + s.w + EPS && b.y + b.h <= s.y + s.h + EPS;
  }

  /* ---------- 项目级标记（契约 1） ----------
     `project.json` 顶层 `delivery: "shorts"`，缺席 = 常规。与 `ptype` 同一条规矩：不给就不写，
     客户端不猜、不回写。原型 2026-09-27 第一版写的是 `shorts: true`，已迁成这个键。 */
  const DELIVERY = 'shorts';
  const isShorts = (p) => !!p && p.delivery === DELIVERY;

  /* ---------- 字幕块几何：Shorts 预设落位与发布前检查共用这一份 ----------
     舞台字号口径（stage.jsx）：名义字号 32 ↔ 画面宽 880 时 20px，也就是 32 号字高约画宽的 2.27%。
     字幕块横向是通栏居中（舞台 left 8% / right 8%，宽 84），轨上写了 `width` 就按它居中。
     块高按两行估：字号 × 行高 × 行数，换成画面高的百分比要乘 宽/高。 */
  const NOMINAL_SIZE = 32;
  const BASE_PCT = 20 / 880 * 100;            // 名义字号在画宽里占的百分比
  const SUB_WIDTH = 84;                       // 没写 width 的轨：left 8% / right 8%
  const SUB_LINES = 2;                        // 估块高时按两行算（宁可保守）
  const fontPct = (size) => (size || NOMINAL_SIZE) / NOMINAL_SIZE * BASE_PCT;
  /** 字高占画宽 `pct`% 对应的名义字号：5.5% → 77。 */
  const sizeForWidth = (pct) => Math.round(pct / BASE_PCT * NOMINAL_SIZE);
  /** 居中摆放又不压右侧按钮列的最大宽度：2 × min(50 − 左边距, 右界 − 50) = 64。 */
  const centeredWidth = () => 2 * Math.min(50 - SAFE.side, (100 - SAFE.right) - 50);
  /** 一条字幕轨在输出画面上的块（百分比 {x,y,w,h}）。`aspect` = 输出画面 宽 / 高。 */
  function subBlock(t, aspect) {
    const a = aspect || 9 / 16;
    const w = t.width || SUB_WIDTH;
    const h = SUB_LINES * fontPct(t.size) * ((t.lh || 120) / 100) * a;
    const y = t.y == null ? 86 : t.y;
    const va = t.valign || 'bottom';
    const top = va === 'top' ? y : va === 'center' ? y - h / 2 : y - h;
    return {x: (100 - w) / 2, y: top, w, h};
  }

  /** Shorts 字幕预设的落位（契约 6）：粗体字约画宽 5.5%、水平居中、最下面一块的下沿贴安全框底再让出描边投影（y = 74）。
      画面上有几条可见轨就往上叠几块，块间留 1%；字号按原来的比例一起缩放，最大的那条到 5.5%。
      2026-09-28 由 7% 调小：7% 时一句译文常要折三行、压到人物胸口。
      返回 {轨 id: {y, valign, size, width}}，隐藏的轨不动。 */
  const CAPTION_WIDTH_PCT = 5.5;
  const CAPTION_GAP = 1;
  /* 描边与投影画在排版盒外面：core 渲染实测左右各外扩约 1%、往下约 0.4%（bcut-shorts.md 样式表），
     所以宽与锚线各再让出 2：宽 64 → 60，下沿 76 → 74。与 `bcut_editor_core::style_library::apply_shorts_caption` 同数。 */
  const CAPTION_INSET = 2;
  function captionLayout(tracks, aspect, lhOf) {
    const vis = (tracks || []).filter((t) => !t.hidden);
    if (!vis.length) return {};
    const top = Math.max.apply(null, vis.map((t) => t.size || NOMINAL_SIZE));
    const k = sizeForWidth(CAPTION_WIDTH_PCT) / top;
    const width = centeredWidth() - 2 * CAPTION_INSET;
    // 最下面的先落：按现在块的下沿从低到高排
    const order = vis.slice().sort((a, b) => {
      const ba = subBlock(a, aspect), bb = subBlock(b, aspect);
      return (bb.y + bb.h) - (ba.y + ba.h);
    });
    const out = {};
    let floor = 100 - SAFE.bottom - CAPTION_INSET;
    order.forEach((t) => {
      const size = Math.round((t.size || NOMINAL_SIZE) * k);
      const lh = lhOf ? lhOf(t) : t.lh;
      const b = subBlock({size, lh, width, y: floor, valign: 'bottom'}, aspect);
      out[t.id] = {y: +floor.toFixed(1), valign: 'bottom', size, width};
      floor = b.y - CAPTION_GAP;
    });
    return out;
  }

  /** 一个盒子压到了哪块遮挡区（按面积最大的那块），不压返回 null。 */
  function zoneHit(b) {
    let best = null, area = 0;
    zones().forEach((z) => {
      const w = Math.min(b.x + b.w, z.x + z.w) - Math.max(b.x, z.x);
      const h = Math.min(b.y + b.h, z.y + z.h) - Math.max(b.y, z.y);
      if (w > EPS && h > EPS && w * h > area) { area = w * h; best = z; }
    });
    return best;
  }

  /* ---------- 发布前检查（契约 3，导出弹层 §6.3） ----------
     行序与规则 id 与 `bcut shorts check` 同一份闭集；status 五态 ok / warn / error / info / skip。
     原型没有渲染器也量不了音频：首帧、循环要渲染才判得了，一律 skip 并说缺什么；
     响度只印**实测值**（D4：不定目标、不判对错），没有成片可量就 skip。 */
  const CHECK_RULES = ['aspect', 'duration', 'first-frame', 'hook-3s', 'safe-area', 'subtitles', 'loop', 'loudness', 'ending'];
  const CHECK_LABELS = {'aspect': '画幅', 'duration': '时长', 'first-frame': '首帧', 'hook-3s': '前 3 秒',
    'safe-area': '安全区', 'subtitles': '字幕', 'loop': '循环', 'loudness': '响度', 'ending': '结尾'};
  const CHECK_STATUS = ['ok', 'warn', 'error', 'info', 'skip'];
  const MAX_DURATION = 60;
  const HOOK_S = 3;
  const ENDING_S = 3;
  const CTA_WORDS = /关注|订阅|评论|点赞|下期|\b(?:subscribe|follow|like|comment)s?\b/i;

  const fmtSec = (s) => {
    const v = Math.max(0, +s || 0);
    if (v < 60) return (Math.round(v * 10) / 10) + ' 秒';
    const m = Math.floor(v / 60), r = Math.round(v - m * 60);
    return m + ' 分' + (r ? ' ' + r + ' 秒' : '');
  };
  const fmtDb = (v) => (v < 0 ? '−' + Math.abs(v).toFixed(1) : v.toFixed(1));

  /** 这块检查露不露出来：导出画幅是 9:16，或项目本身按 Shorts 交付。 */
  const checkVisible = (ratio, proj) => ratio === RATIO || isShorts(proj);

  /**
   * 一次检查的全部行，顺序即 `CHECK_RULES`。输入（都可缺）：
   *   ratio        导出画幅（'9:16' …）
   *   span         {start, end, dur}：这次导出的时间段（项目秒）
   *   cues         [{start, end, text, trans}]
   *   subTracks    [{id, name, role, y, valign, size, width, lh, on}]：`on` = 这次导出会烧进去
   *   texts        [{id, label, box: {x,y,w,h}（输出画面百分比）, start, end}]：可读文字元素
   *   loop         brief.loop 是否为 true
   *   loudness     {lufs, tp, file} 实测值；没有 → null
   * 行：{rule, label, status, message, value?, at?, pointer?, hits?}
   * pointer：{kind: 'time', t} / {kind: 'subs', trackId} / {kind: 'element', id} / {kind: 'ratio'} /
   *          {kind: 'range'} / {kind: 'lanes'} / {kind: 'loud'}
   */
  function checkRows(ps) {
    const p = ps || {};
    const ratio = p.ratio || '';
    const r = parseRatio(ratio);
    const aspect = r ? r.w / r.h : 9 / 16;
    const span = p.span || {start: 0, end: 0, dur: 0};
    const start = span.start || 0;
    const end = span.end == null ? start + (span.dur || 0) : span.end;
    const dur = span.dur == null ? end - start : span.dur;
    const cues = (p.cues || []).filter((c) => c.end > start && c.start < end);
    const subs = p.subTracks || [];
    const burned = subs.filter((t) => t.on);
    const row = (rule, status, message, extra) => Object.assign({rule, label: CHECK_LABELS[rule], status, message}, extra || null);
    const rows = [];

    rows.push(ratio === RATIO
      ? row('aspect', 'ok', '9:16 竖屏', {value: ratio})
      : row('aspect', 'error', `现在是 ${ratio || '未知画幅'}，Shorts 要 9:16`, {value: ratio, pointer: {kind: 'ratio'}}));

    rows.push(dur <= MAX_DURATION
      ? row('duration', 'ok', fmtSec(dur), {value: dur})
      : row('duration', 'warn', `${fmtSec(dur)} · 超过 60 秒，部分平台不按 Shorts 推`, {value: dur, pointer: {kind: 'range'}}));

    rows.push(row('first-frame', 'skip', '要渲染出第 0 帧才判得了 · 导出后再查', {pointer: {kind: 'time', t: start}}));

    const open = cues.find((c) => c.start < start + HOOK_S && (c.text || c.trans));
    rows.push(open
      ? row('hook-3s', 'ok', `${fmtSec(Math.max(0, open.start - start))}开口`, {value: Math.max(0, open.start - start)})
      : row('hook-3s', 'warn', '前 3 秒没有旁白或字幕', {pointer: {kind: 'time', t: start}}));

    const hits = [];
    if (cues.length) {
      burned.forEach((t) => {
        const b = subBlock(t, aspect);
        const z = inSafe(b) ? null : (zoneHit(b) || zones()[2]);
        const nm = t.name || '';
        if (z) hits.push({label: nm ? `${nm}${/^[\x20-\x7e]/.test(nm) ? ' ' : ''}字幕` : '字幕', zone: z.label, at: cues[0].start, pointer: {kind: 'subs', trackId: t.id}});
      });
    }
    (p.texts || []).forEach((e) => {
      if (e.end != null && e.end <= start) return;
      if (e.start != null && e.start >= end) return;
      const z = zoneHit(e.box || {x: 0, y: 0, w: 0, h: 0});
      if (z) hits.push({label: e.label, zone: z.label, at: Math.max(start, e.start || 0), pointer: {kind: 'element', id: e.id}});
    });
    hits.sort((a, b) => a.at - b.at);
    rows.push(hits.length
      ? row('safe-area', 'warn', `${hits[0].label}压到「${hits[0].zone}」${hits.length > 1 ? ` · 另有 ${hits.length - 1} 处` : ''}`,
        {at: hits[0].at, pointer: hits[0].pointer, hits})
      : row('safe-area', 'ok', '字幕与文字都在安全框里'));

    rows.push(!subs.length || !(p.cues || []).length
      ? row('subtitles', 'warn', '没有字幕轨', {pointer: {kind: 'lanes'}})
      : burned.length
        ? row('subtitles', 'ok', `烧入 ${burned.map((t) => t.name).join('、')}`)
        : row('subtitles', 'warn', '这次导出不烧入字幕', {pointer: {kind: 'lanes'}}));

    rows.push(p.loop
      ? row('loop', 'skip', '要渲染首末两帧才比得了 · 导出后再查')
      : row('loop', 'skip', '没要求结尾接回开头'));

    const L = p.loudness;
    rows.push(L && L.lufs != null
      ? row('loudness', 'info', `${L.file ? L.file + ' ' : ''}实测 ${fmtDb(L.lufs)} LUFS${L.tp != null ? ' · 真峰值 ' + fmtDb(L.tp) + ' dBTP' : ''}`,
        {value: {lufs: L.lufs, tp: L.tp == null ? null : L.tp}, pointer: {kind: 'loud'}})
      : row('loudness', 'skip', '还没有导出的成片可量'));

    let cta = null;
    cues.filter((c) => c.end > end - ENDING_S).some((c) => {
      const m = CTA_WORDS.exec(c.text || '') || CTA_WORDS.exec(c.trans || '');
      if (m) cta = {c, word: m[0]};
      return !!m;
    });
    rows.push(cta
      ? row('ending', 'warn', `最后 3 秒有「${cta.word}」· 结尾落在看点上更好`, {at: cta.c.start, pointer: {kind: 'time', t: cta.c.start}})
      : row('ending', 'ok', '结尾没有求关注的话'));
    return rows;
  }

  /** 状态点旁的读法（给读屏与悬停提示）。 */
  const CHECK_STATUS_LABEL = {ok: '通过', warn: '建议改', error: '不合格', info: '仅供参考', skip: '暂时查不了'};
  /** 清单标题右侧那一句：先说不合格，再说建议改，都没有就说过了；查不了的另起一句。 */
  function checkHeadline(sum) {
    const s = sum || {};
    const bad = [s.error ? `${s.error} 项不合格` : null, s.warn ? `${s.warn} 项建议改` : null].filter(Boolean);
    const head = bad.length ? bad.join(' · ') : '能查的都过了';
    return s.skip ? `${head} · ${s.skip} 项要成片才能查` : head;
  }

  function checkSummary(rows) {
    const s = {ok: 0, warn: 0, error: 0, info: 0, skip: 0};
    (rows || []).forEach((r) => { if (s[r.status] != null) s[r.status] += 1; });
    return s;
  }

  /* ---------- 导出「Shorts」快捷设置（§5.6） ----------
     只组合现有选项：画幅 9:16、分辨率 1080 档（1080×1920）、30 fps 与 H.264（导出缺省就是）、
     源语言字幕烧入，外加一张第 0 帧的 PNG 封面另存。源裁成竖屏不到 1080 时分辨率照旧落回原始档，不放大。 */
  const EXPORT_PRESET = {ratio: RATIO, short: 1080, fps: 30, codec: 'H.264', subs: 'burn', cover: {t: 0, fmt: 'png'}};
  const presetLine = () => '1080×1920 · 30 fps · H.264 · 字幕烧入 · 封面另存';
  /** 字幕烧入落在哪条：源语言轨；没有源语言轨就第一条字幕轨。译文轨不动（用户自己开着就留着）。 */
  function presetOverrides(lanes, ov) {
    const subs = (lanes || []).filter((l) => l.kind === 'subs');
    const pick = subs.find((l) => l.role === 'source') || subs[0];
    return pick ? Object.assign({}, ov, {[pick.key]: true}) : Object.assign({}, ov);
  }
  /** 当前设置是不是就是这份预设（按钮据此显示「已套用」）。 */
  function presetMatches(o) {
    const q = o || {};
    return q.ratio === RATIO && q.resPick === EXPORT_PRESET.short && !!q.subsOn && !!q.cover;
  }
  const coverName = (base) => `${base}-cover.png`;
  /** 分辨率被源夹住时（16:9 源裁成竖屏只有 608p）预设那一行补一句，不假装拿到了 1080×1920。 */
  const presetNote = (res) => (res && res < EXPORT_PRESET.short ? `源裁成竖屏最高 ${res}p，不放大` : '');

  /* ---------- 二期入口：长视频切 Shorts（§7，D5） ----------
     带着视频说「切成三条 Shorts」：同一枚开关，打开后流程条换成切片版，交给 Agent 的那一行
     写明一支一个新项目、记下它在原片里的起止。 */
  const CN_NUM = {一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10};
  /** 从一句话里读出要切几条：「三条」「3 支」「5 个」；读不出返回 null。 */
  function cutCount(text) {
    const m = /(\d{1,2}|[一两二三四五六七八九十])\s*(?:条|支|段|个)/.exec(String(text || ''));
    if (!m) return null;
    const n = /\d/.test(m[1]) ? +m[1] : CN_NUM[m[1]];
    return n > 0 ? n : null;
  }
  /** 带着视频打开开关后，开关下那一行说明。 */
  const CUT_GRAMMAR = ['每支一部新视频', RATIO, '不超过 60 秒', '从看点起', '记下来源片段'];
  const cutGrammarLine = () => CUT_GRAMMAR.join(' · ');
  /** 切片版流程条（接在「转录」之后；转录那一步由 BC_NEW.pipeline 的 ask 目标给）。 */
  function cutPipeline() {
    return [
      {k: 'read', label: '读转录', by: 'ai'},
      {k: 'hooks', label: '挑钩子段', by: 'ai'},
      {k: 'cut', label: '切段并换 9:16', by: 'ai'},
      {k: 'subs', label: '字幕与安全区', by: 'ai'},
      {k: 'check', label: '发布前检查', by: 'ai'},
      {k: 'pick', label: '你来挑', by: 'you'},
    ];
  }
  /** 切片版交给 Agent 的那一行。 */
  function cutPromptLine(n) {
    return `切成${n ? ' ' + n + ' ' : '几'}条 Shorts：每条 ${RATIO}、不超过 60 秒，从有看点的那一句起；`
      + '每支一部新视频，记下它在原片里的起止；逐词字幕放在平台按钮挡不到的地方，每支过一遍发布前检查，最后列给我挑。';
  }

  const API = {SAFE, RATIO, LENGTH_KEYS, DEFAULT_LENGTH, detect, effective, lengths, clampLength, GRAMMAR, grammarLine,
    promptLine, pipeline, isPortrait, safeBox, zones, inSafe,
    DELIVERY, isShorts, NOMINAL_SIZE, SUB_WIDTH, fontPct, sizeForWidth, centeredWidth, subBlock, captionLayout, zoneHit,
    CHECK_RULES, CHECK_LABELS, CHECK_STATUS, CHECK_STATUS_LABEL, CTA_WORDS, checkVisible, checkRows, checkSummary, checkHeadline,
    EXPORT_PRESET, presetLine, presetOverrides, presetMatches, coverName, presetNote,
    cutCount, cutPipeline, cutPromptLine, CUT_GRAMMAR, cutGrammarLine};
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof window !== 'undefined') Object.assign(window, {BC_SHORTS: API});
})();
