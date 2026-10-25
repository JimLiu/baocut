/* 轻量编辑器（轻量编辑器设计 docs/design/lite-editor/lite-editor-design.md §2–§5）
   window.BC_LITE。纯函数，无 React、无 DOM。

   轻量视图与时间线视图看的是同一部视频，这里只做「怎么把它折成一串段」：
   - **段（segment）** 是轻量视图的唯一单位：智能体做的动画片按场景（章节表的一行 = 一个代码包实例 + 一个 chapter 标记），
     转录 / 翻译的视频按章节（序列上 `kind: 'chapter'` 的标记）；两者都没有时按旁白分段，再没有就整条一段。
   - 每段带：起止、标题、脚本（只有场景有）、逐句台词（场景的旁白句或章节里的字幕 cue）、素材清单。
   - 图层开关按视频里实际有的轨道生成（`layers`），没有的轨道不出开关。
   - 默认打开哪种视图、用户的选择怎么记住（`viewFor` / `remember`）。
   标注走已有的视频标注（model-stage-notes.js），这里只补「这一条标注落在哪一段、哪一句」。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 段的来源：给界面显示「场景 · 章节表」「章节」「按旁白分」「整条」，给智能体的是英文 key */
  const SOURCES = {
    scene: {key: 'scene', label: '场景', hint: '来自章节表与时间线上的代码包'},
    chapter: {key: 'chapter', label: '章节', hint: '来自序列上的章节标记'},
    speech: {key: 'speech', label: '段落', hint: '没有章节，按旁白的停顿分段'},
    whole: {key: 'whole', label: '整条', hint: '没有章节与旁白，整条视频是一段'},
  };
  /* 旁白分段：停顿超过这个秒数就断开；一段最长这么多秒（超过就在下一个句末断开） */
  const SPEECH_GAP = 1.8, SPEECH_MAX = 60;

  const round3 = v => Math.round(v * 1000) / 1000;

  /** 「17s」「1:05」：段条上的时长，整秒以下不显示小数。 */
  function fmtDur(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  const lineOf = (id, start, end, text, trans) => ({id, start: round3(start), end: round3(end), text: text || '', trans: trans || ''});

  /** 场景表 → 段：场景的句子时间相对场景开头，这里换成序列时间。素材按种类列出：代码包、旁白、实拍、图片。 */
  function fromScenes(scenes) {
    return scenes.map((sc, i) => {
      const lines = (sc.lines || []).map((l, j) => lineOf(`${sc.id}:l${j + 1}`, sc.start + l.start, sc.start + l.end, l.text, l.trans));
      const assets = [];
      if (sc.bundle) assets.push({kind: 'bundle', label: '代码包', name: sc.bundle, detail: sc.bundleVersion ? `版本 ${sc.bundleVersion}` : ''});
      if (sc.narration) assets.push({kind: 'audio', label: '旁白', name: sc.narration, detail: fmtDur(sc.end - sc.start)});
      (sc.footage || []).forEach((f, j) => assets.push({kind: 'footage', label: '实拍', name: f.src, detail: `${fmtDur(f.dur)} · 从 ${fmtDur(f.at)} 起`, at: sc.start + f.at, id: `${sc.id}:f${j + 1}`}));
      (sc.images || []).forEach((im, j) => assets.push({kind: 'image', label: '参考图', name: im, id: `${sc.id}:i${j + 1}`}));
      return {id: sc.id, index: i, kind: 'scene', source: SOURCES.scene.key, title: sc.title, start: sc.start, end: sc.end,
        script: sc.script || '', status: sc.status || 'placed', stale: sc.stale || [], lines, assets, footage: (sc.footage || []).map(f => ({...f, at: sc.start + f.at}))};
    });
  }

  const cuesIn = (cues, start, end) => (cues || []).filter(c => (c.start + c.end) / 2 >= start && (c.start + c.end) / 2 < end)
    .map(c => lineOf(c.id, c.start, c.end, c.text, c.trans));

  /** 章节 → 段：句子是落在这一章里的字幕 cue（按中点归章，与 model-chapters.js 的段落归章同一规则）。 */
  function fromChapters(chapters, cues) {
    return chapters.map((c, i) => ({id: c.id, index: i, kind: 'chapter', source: SOURCES.chapter.key, title: c.title, start: c.start, end: c.end,
      script: '', lines: cuesIn(cues, c.start, c.end), assets: []}));
  }

  /** 没有章节：按旁白的停顿分段（停顿 ≥ SPEECH_GAP，或一段满 SPEECH_MAX 秒后在句末断开），标题取段首句。 */
  function fromSpeech(cues, duration) {
    const groups = [];
    (cues || []).forEach(c => {
      const last = groups[groups.length - 1];
      if (last && c.start - last.end < SPEECH_GAP && c.end - last.start <= SPEECH_MAX) { last.end = c.end; last.cues.push(c); }
      else groups.push({start: c.start, end: c.end, cues: [c]});
    });
    return groups.map((g, i) => {
      const end = i + 1 < groups.length ? groups[i + 1].start : Math.max(g.end, duration || g.end);
      const start = i === 0 ? 0 : g.start;
      return {id: `speech-${i + 1}`, index: i, kind: 'chapter', source: SOURCES.speech.key,
        title: (g.cues[0].text || '').slice(0, 24), start, end, script: '', lines: g.cues.map(c => lineOf(c.id, c.start, c.end, c.text, c.trans)), assets: []};
    });
  }

  /** 一部视频折成一串段。优先级：场景表 → 章节标记 → 旁白分段 → 整条。 */
  function segments({scenes, chapters, cues, duration, title}) {
    if (scenes && scenes.length) return fromScenes(scenes);
    const ch = (chapters || []).filter(c => c.end > c.start);
    if (ch.length) return fromChapters(ch, cues);
    if (cues && cues.length) return fromSpeech(cues, duration);
    return [{id: 'whole', index: 0, kind: 'chapter', source: SOURCES.whole.key, title: title || '', start: 0, end: duration || 0, script: '', lines: [], assets: []}];
  }

  /** 播放头在哪一段：末段含右端点；都不在（负数、超长）回 null。 */
  function segmentAt(segs, t) {
    if (!segs || !segs.length) return null;
    const last = segs[segs.length - 1];
    if (t >= last.start && t <= last.end) return last;
    return segs.find(s => t >= s.start && t < s.end) || null;
  }

  /** 播放头落在哪一句：句与句之间的空隙算前一句（字幕的 tail 还显示着），段开头之前为 null。 */
  function lineAt(lines, t) {
    let hit = null;
    for (const l of lines || []) { if (t >= l.start) hit = l; else break; }
    return hit;
  }

  const prevStart = (segs, t) => { let best = 0; for (const s of segs || []) if (s.start < t - 0.05) best = s.start; return best; };
  const nextStart = (segs, t) => { for (const s of segs || []) if (s.start > t + 0.05) return s.start; return null; };

  /** 段条：每段占的比例（flex）、已播的比例，与时间线顶部的章节条同一算法。 */
  function barSpans(segs, playT, duration) {
    const total = duration > 0 ? duration : (segs.length ? segs[segs.length - 1].end : 1);
    return (segs || []).map(s => {
      const span = Math.max(0, s.end - s.start);
      return {id: s.id, title: s.title, span, flex: span / total, done: span > 0 ? Math.max(0, Math.min(1, (playT - s.start) / span)) : 0,
        current: segmentAt(segs, playT)?.id === s.id, label: fmtDur(span)};
    });
  }

  /** 图层开关：按视频里实际有的轨道生成。`spec` 由编辑器从当前视频读出：
      captions 每条字幕轨一个开关（原文 / 译文），footage 是实拍覆盖轨，watermark 是水印，sourceLabels 是来源标注，
      music 是配乐，overlays 是别的画面元素层（贴纸、文字组…按种类合并）。没有的不出开关。 */
  function layers(spec) {
    const out = [];
    (spec?.captions || []).forEach(c => out.push({key: `caption:${c.id}`, label: c.label || `字幕 · ${c.id}`, section: 'captions'}));
    if (spec?.footage) out.push({key: 'footage', label: '实拍覆盖', section: 'picture'});
    (spec?.overlays || []).forEach(o => out.push({key: `overlay:${o.id}`, label: o.label, section: 'picture'}));
    if (spec?.sourceLabels) out.push({key: 'source-labels', label: '来源标注', section: 'picture'});
    if (spec?.watermark) out.push({key: 'watermark', label: '水印', section: 'picture'});
    if (spec?.music) out.push({key: 'music', label: '配乐', section: 'sound'});
    return out;
  }
  const SECTION_LABELS = {captions: '字幕', picture: '画面', sound: '声音'};

  /* ---------- 段条（片） ---------- */
  /** 片式段条的每一片：占比（flex）、播放头在片里的位置（0–1，不在这片上为 null）、悬停位置。片只看不改，边不能拖（轻量编辑器设计 §3.2）。 */
  function chipSpans(segs, playT, duration, hoverT) {
    const list = segs || [];
    const last = list[list.length - 1];
    const total = Math.max(last ? last.end : 0, duration > 0 ? duration : 0, 0.001);
    const frac = (t, a, b) => (t == null || t < a || t > b || b <= a) ? null : Math.max(0, Math.min(1, (t - a) / (b - a)));
    const at = segmentAt(list, playT);
    return list.map((seg, i) => {
      const {start, end} = seg;
      const span = Math.max(0, end - start);
      return {id: seg.id, index: i, title: seg.title, start, end, span, flex: span / total, label: fmtDur(span),
        current: at?.id === seg.id, head: at?.id === seg.id ? frac(playT, start, end) : null,
        hover: frac(hoverT, start, end)};
    });
  }

  /** 片条的缩放：1 = 整条铺满播放条的宽度（默认），按钮每档 ×1.5、最大 8 倍；⌘ / Ctrl + 滚轮（触控板捏合）连续缩放。放大后横向滚动。 */
  const ZOOM_STEP = 1.5, ZOOM_MAX = 8;
  const clampZoom = z => Math.min(ZOOM_MAX, Math.max(1, Math.round((+z || 1) * 100) / 100));
  const zoomIn = z => clampZoom(z * ZOOM_STEP);
  const zoomOut = z => clampZoom(z / ZOOM_STEP);
  /** 播放条上的百分比标签：1 = 100%，与时间线的缩放标签同一写法（整数百分比）。 */
  const zoomLabel = z => Math.round(clampZoom(z) * 100) + '%';
  /** 让一段铺满视野的缩放：整条时长 ÷ 这段时长（夹在 1–8 倍之间）；没有可算的段回 1。 */
  function fitZoom(seg, duration) {
    const len = seg ? seg.end - seg.start : 0;
    return len > 0 && duration > 0 ? clampZoom(duration / len) : 1;
  }
  /** 缩放菜单（播放条百分比钮点开）：放大 / 缩小 / 铺满 / 适应当前段 / 缩放到播放头。 */
  const ZOOM_MENU = [
    {k: 'in', label: '放大'}, {k: 'out', label: '缩小'}, {k: 'fit', label: '铺满 · 100%'},
    {k: 'segment', label: '适应当前段'}, {k: 'playhead', label: '缩放到播放头'},
  ];
  /** 放大后让播放头留在视野里：头的横坐标（相对整条）出了 [滚动位置 + margin, 滚动位置 + 视宽 − margin] 就滚到让它落在视野的 1/3 处；不用滚回 null。 */
  function keepInView(headX, scrollLeft, viewW, margin = 24) {
    if (headX >= scrollLeft + margin && headX <= scrollLeft + viewW - margin) return null;
    return Math.max(0, Math.round(headX - viewW / 3));
  }

  /** 播放条的时钟写法：`0:29`、`3:00`、`1:02:03`——分不补零、秒不带小数（拖边的气泡与悬停仍用 fmtDur / 时码）。 */
  function fmtClock(sec) {
    let s = Math.max(0, Math.round(+sec || 0));
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  /* ---------- 默认视图与记忆 ---------- */
  const VIEWS = ['lite', 'timeline'];
  /** 没有 URL、没有按视频记过、全局默认是「自动」时开哪种：一律审片（轻量）。2026-10-21 起不再按种类分——
      要时间线的在「默认打开」里选「总是时间线」，切换过的视频按视频记。保留参数是为了调用处不改。 */
  function defaultViewByKind() {
    return 'lite';
  }
  /** 打开时用哪种：URL 显式的 > 这部视频上次的选择 > 用户的全局默认（「总是…」）> 审片。 */
  function viewFor(proj, prefs, routeView) {
    if (VIEWS.includes(routeView)) return routeView;
    const byVideo = prefs?.editorViewByVideo?.[proj?.id];
    if (VIEWS.includes(byVideo)) return byVideo;
    if (VIEWS.includes(prefs?.editorViewDefault)) return prefs.editorViewDefault;
    return defaultViewByKind(proj);
  }
  /** 切换后记住：按视频记一份；`asDefault` 时同时改全局默认（专业用户「以后都开时间线」）。返回要写回偏好的键值。 */
  function remember(prefs, videoId, view, asDefault) {
    const byVideo = {...(prefs?.editorViewByVideo || {}), [videoId]: view};
    const out = {editorViewByVideo: byVideo};
    if (asDefault) out.editorViewDefault = view;
    return out;
  }

  /* ---------- 循环 ---------- */
  /** 走带的循环方式（轻量编辑器设计 §3「走带」）：整片（默认）、当前段、不循环。只是这个窗口的观看态，不进视频。 */
  const LOOP_MODES = [
    {k: 'whole', label: '整片循环'},
    {k: 'segment', label: '当前段循环'},
    {k: 'off', label: '不循环'},
  ];
  const LOOP_DEFAULT = 'whole';
  /** 播放头在 t 时正在循环的那一截：整片是 [0, 片长]，当前段是 t 所在的段，不循环或找不到段时为 null。 */
  function loopRange(segs, mode, t, duration) {
    if (mode === 'whole') return {start: 0, end: Math.max(0, duration || 0)};
    if (mode !== 'segment') return null;
    const seg = segmentAt(segs, t);
    return seg ? {start: seg.start, end: seg.end} : null;
  }
  /** 判断「播过去」时给时钟留的余量（秒）：播放头一步最多走「经过的时间 × 倍速 + 余量」，更大的一步是拖动、点片或跳段。 */
  const LOOP_SLACK = 0.25;
  const loopMaxStep = (elapsedSec, rate) => Math.max(0, elapsedSec) * Math.max(0, rate) + LOOP_SLACK;
  /** 当前段循环：播放头从 from 走到 to 时要不要跳回段首（只认往前、不超过 maxStep 的一步跨过段尾；最后一段的段尾就是片尾，交给播到头的处理）。 */
  function loopJump(segs, mode, from, to, duration, maxStep) {
    if (mode !== 'segment' || !(to > from) || to - from > maxStep) return null;
    const r = loopRange(segs, mode, from, duration);
    return r && r.end < duration && to >= r.end ? r.start : null;
  }

  /* ---------- 标注 ---------- */
  /** 一条标注落在哪一段、哪一句：随标注交给智能体，让它知道「第 3 场第 4 句这里」而不只是一个时刻。 */
  function noteContext(segs, t) {
    const seg = segmentAt(segs, t);
    if (!seg) return {};
    const line = lineAt(seg.lines, t);
    const out = {segment: {id: seg.id, kind: seg.kind, index: seg.index, title: seg.title}};
    if (line) out.line = {id: line.id, index: seg.lines.indexOf(line) + 1, text: line.text};
    return out;
  }
  /** 给人看的落点：「s03 · 第 4 句」。 */
  function contextLabel(ctx) {
    if (!ctx?.segment) return '';
    return ctx.line ? `${ctx.segment.id} · 第 ${ctx.line.index} 句` : ctx.segment.id;
  }

  Object.assign(root, {BC_LITE: {SOURCES, SECTION_LABELS, VIEWS, SPEECH_GAP, SPEECH_MAX,
    fmtDur, fmtClock, segments, segmentAt, lineAt, prevStart, nextStart, barSpans, chipSpans, layers,
    ZOOM_MAX, ZOOM_MENU, clampZoom, zoomIn, zoomOut, zoomLabel, fitZoom, keepInView,
    LOOP_MODES, LOOP_DEFAULT, LOOP_SLACK, loopMaxStep, loopRange, loopJump,
    defaultViewByKind, viewFor, remember, noteContext, contextLabel}});
})();
