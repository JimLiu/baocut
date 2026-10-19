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

  /* ---------- 段条（片）与拖动改时长 ---------- */
  /** 片式段条的每一片：占比（flex）、播放头在片里的位置（0–1，不在这片上为 null）、悬停位置；`preview` 是拖边时还没落定的新长度
      `{index, end}`，片按它显示。场景改长会把后面的片一起推开（总长跟着变）；章节只挪边界，总长不变。 */
  function chipSpans(segs, playT, duration, hoverT, preview) {
    const list = (segs || []).map((s, i) => {
      let start = s.start, end = s.end;
      if (preview && s.kind === 'scene') {
        if (i === preview.index) end = preview.end;
        else if (i > preview.index) { const d = preview.end - segs[preview.index].end; start += d; end += d; }
      } else if (preview && s.kind !== 'scene') {
        if (i === preview.index) end = preview.end;
        else if (i === preview.index + 1) start = preview.end;
      }
      return {seg: s, start, end};
    });
    const last = list[list.length - 1];
    const total = Math.max(last ? last.end : 0, duration > 0 && !(preview && last?.seg.kind === 'scene') ? duration : 0, 0.001);
    const frac = (t, a, b) => (t == null || t < a || t > b || b <= a) ? null : Math.max(0, Math.min(1, (t - a) / (b - a)));
    const at = segmentAt(list.map(x => ({...x.seg, start: x.start, end: x.end})), playT);
    return list.map(({seg, start, end}, i) => {
      const span = Math.max(0, end - start);
      return {id: seg.id, index: i, title: seg.title, start, end, span, flex: span / total, label: fmtDur(span),
        current: at?.id === seg.id, head: at?.id === seg.id ? frac(playT, start, end) : null,
        hover: frac(hoverT, start, end), resizable: seg.kind === 'scene' || i < list.length - 1};
    });
  }

  /** 讲解片的章长归旁白（动画片设计 §2.3）：拖短不能短过旁白末句 + tail；没有旁白的最短 1 秒。相对场景开头。 */
  const TAIL = 0.4;
  function minSceneLength(sc) {
    const lines = sc.lines || [];
    return lines.length ? round3(lines[lines.length - 1].end + TAIL) : 1;
  }

  /** 拖场景的右边 = 改这一场的 `duration`（归属改为 `user`，动画片设计 §3.1）：后面的场景整体推开，总长跟着变。
      返回 {scenes, delta}；没变化或拖不动时回 null。场景表里句子与实拍的时间都相对场景开头，所以不用改。 */
  function retimeScene(scenes, index, newEnd) {
    const sc = scenes?.[index];
    if (!sc) return null;
    const end = round3(Math.max(sc.start + minSceneLength(sc), newEnd));
    const delta = round3(end - sc.end);
    if (Math.abs(delta) < 0.001) return null;
    const next = scenes.map((s, i) => i < index ? s : i === index ? {...s, end, durationOwner: 'user'} : {...s, start: round3(s.start + delta), end: round3(s.end + delta)});
    return {scenes: next, delta};
  }

  /** 场景表 → 章节标记（时间线顶部的章节条与文稿页读它），与 data.js 的 projectSetup 同一换法。 */
  const chaptersOf = scenes => (scenes || []).map(s => ({id: s.id, title: s.title, start: s.start, end: s.end}));

  /** 场景推开之后，落在边界之后的字幕 cue 一起平移（边界之前的不动）。 */
  const shiftAfter = (cues, from, delta) => (cues || []).map(c => c.start >= from - 0.001 ? {...c, start: round3(c.start + delta), end: round3(c.end + delta)} : c);

  /** 拖章节的右边 = 挪它与下一章的边界：总长不变，两边各至少留 `min` 秒；末章的右边是片尾，拖不动。返回新章节表或 null。 */
  function moveChapterBoundary(chapters, index, t, min = 1) {
    const a = chapters?.[index], b = chapters?.[index + 1];
    if (!a || !b) return null;
    const end = round3(Math.max(a.start + min, Math.min(b.end - min, t)));
    if (Math.abs(end - a.end) < 0.001) return null;
    return chapters.map((c, i) => i === index ? {...c, end} : i === index + 1 ? {...c, start: end} : c);
  }

  /** 拖边能到的范围，给拖动中的预览夹住（松手时 retimeScene / moveChapterBoundary 用同一规则）：
      场景最短到旁白末句 + tail、没有上限；章节在与下一章之间各留 `min` 秒；末章拖不动，回 null。
      段里的句子已换成序列时间，所以场景的最短点就是末句的 end + TAIL。 */
  function resizeBounds(segs, index, min = 1) {
    const s = segs?.[index];
    if (!s) return null;
    if (s.kind === 'scene') {
      const lines = s.lines || [];
      return {min: round3(lines.length ? lines[lines.length - 1].end + TAIL : s.start + min), max: Infinity};
    }
    const b = segs[index + 1];
    return b ? {min: round3(s.start + min), max: round3(b.end - min)} : null;
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
  /** 这部视频按种类默认开哪种：智能体做的（有场景表、或在会话里新建的）与转录 / 翻译的开轻量；
      元素实验、纯素材（只有一条片子）、综合制作开时间线。 */
  function defaultViewByKind(proj) {
    if (!proj) return 'timeline';
    if (proj.scenes?.length || proj.origin === 'session') return 'lite';
    if (proj.focus) return 'timeline';
    if (proj.preview) return 'timeline';
    if (proj.entry === 'trans' || proj.entry === 'clean' || proj.entry === 'captions') return 'lite';
    return 'timeline';
  }
  /** 打开时用哪种：URL 显式的 > 这部视频上次的选择 > 用户的全局默认（设置里「总是…」）> 按种类。 */
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
    TAIL, minSceneLength, retimeScene, chaptersOf, shiftAfter, moveChapterBoundary, resizeBounds,
    ZOOM_MAX, ZOOM_MENU, clampZoom, zoomIn, zoomOut, zoomLabel, fitZoom, keepInView,
    defaultViewByKind, viewFor, remember, noteContext, contextLabel}});
})();
