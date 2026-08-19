// BaoCut Subtitle Studio — video stage.
// The media element decodes and owns the clock; Konva paints video frames and
// interactive subtitles into Canvas. Transport controls remain regular DOM UI.
(() => {
const { useState, useRef, useEffect, useCallback, useMemo } = React;
const { Ic, QBtn, Pop, Menu, useApp, usePlayer, useEsc, fmtT } = window;
const { KonvaPreview, CanvasTextEditor } = window.BCSCanvas;
const R = window.BCS_SUBTITLE;
const T = window.BCS_TIMELINE;
const TR = window.BCS_TRANSPORT;
const EG = window.BCS_ELEMENT_GEOMETRY;   // 叠加元素几何（render_plan.rs 孪生）
const EOPS = window.BCS_ELEMENT_OPS;

function StagePane() {
  const app = useApp();
  const { doc } = app;
  const player = usePlayer();   // 画布/媒体元素是逐帧真值的合法消费者
  const stageRef = useRef(null);
  const mediaElRef = useRef(null);
  const [mediaEl, setMediaEl] = useState(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [ratioOpen, setRatioOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [elementEditing, setElementEditing] = useState(null);   // 元素文本的内联编辑
  const [sourceAspect, setSourceAspect] = useState(null);
  const [fsIdle, setFsIdle] = useState(false);   // 全屏闲置：连指针一起隐藏
  const ratioRef = useRef(null), volRef = useRef(null);
  const clickCoordinatorRef = useRef(null);
  if (!clickCoordinatorRef.current) {
    clickCoordinatorRef.current = window.BCS_STAGE_CLICK.createCoordinator(() => performance.now());
  }

  const projection = doc.timelineProjection || null;
  const playbackPosition = projection && T
    ? T.timelineToSource(projection, player.t, 'following')
    : null;
  const mediaSourceId = playbackPosition ? playbackPosition.srcId : 'main';
  const mediaClipId = playbackPosition ? playbackPosition.clipId : 'c1';
  const projectedKind = projection && projection.views[mediaSourceId]
    ? projection.views[mediaSourceId].kind
    : null;
  const media = mediaSourceId === 'main'
    ? (doc.meta.media || null)
    : (projectedKind ? { kind: projectedKind } : null);
  const hasVideo = media && media.kind === 'video';
  const hasAudio = media && media.kind === 'audio';
  const setMediaSource = useCallback((el) => {
    mediaElRef.current = el;
    setMediaEl(el);
  }, []);

  // 全屏时画面顶满，不留常规的 32px 边距（原型 stage.jsx:317 同规则）。
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const inset = player.fullscreen ? 0 : 32;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      setBox((b) => Math.abs(b.w - (r.width - inset)) > 1 || Math.abs(b.h - (r.height - inset)) > 1
        ? { w: r.width - inset, h: r.height - inset } : b);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [player.fullscreen]);

  // 全屏：编辑器其余部分让位给舞台。main.jsx 的 vk-editor 根节点归 WP-C 所有，
  // 所以这里在 <body> 上打标记，由 editor.css 的 body.vk-stage-fullscreen 规则
  // 收起时间轴/右侧面板——效果与原型的 .vk-editor--full 一致。
  useEffect(() => {
    const on = !!player.fullscreen;
    document.body.classList.toggle('vk-stage-fullscreen', on);
    return () => document.body.classList.remove('vk-stage-fullscreen');
  }, [player.fullscreen]);

  // 浏览器自己退出全屏（Esc / 系统手势）时把 player 状态拉回来，否则舞台会
  // 停在"假全屏"：黑底铺满但已经不是全屏元素。
  useEffect(() => {
    const sync = () => {
      if (!document.fullscreenElement) app.setPlayer((p) => (p.fullscreen ? { ...p, fullscreen: false } : p));
    };
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, [app.setPlayer]);

  useEffect(() => { if (!player.fullscreen) setFsIdle(false); }, [player.fullscreen]);

  const exitFullscreen = useCallback(() => {
    app.setPlayer((p) => ({ ...p, fullscreen: false }));
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e) {}
  }, [app.setPlayer]);

  // Esc 退出全屏。fullscreenchange 只在浏览器真的进过全屏时才触发，所以这里也
  // 挂一层：requestFullscreen 被拒（无用户手势、权限策略）时 Esc 仍然能退出。
  // 走 Esc 栈 = 先关浮层再退全屏，与原型 editor.jsx 的 useEsc 同层级语义。
  useEsc(exitFullscreen, !!player.fullscreen);

  // Esc 取消字幕选中。全屏时让位给"退出全屏"：全屏是纯观看态，画面上不做选中，
  // 进全屏前留下的 sel 不该吞掉第一次 Esc（Esc 栈是后注册者优先，所以这里靠
  // active 条件互斥而不是靠注册顺序）。样式层自己也在栈上，且比舞台更靠后注册，
  // 所以层开着时 Esc 先关层、再按一次才清选中 —— 与原型的分层退出一致。
  useEsc(() => app.setSel(null), !!app.sel && !player.fullscreen);

  // requestFullscreen 必须留在用户手势里，所以 next 从渲染作用域的 player 读，
  // 不放进 setPlayer 的 updater（updater 可能被延后或重跑）。
  const toggleFullscreen = useCallback(() => {
    const next = !player.fullscreen;
    app.setPlayer((p) => ({ ...p, fullscreen: next }));
    try {
      if (next && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (!next && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (e) {}
  }, [app.setPlayer, player.fullscreen]);

  // The hidden media element remains the playback clock. Konva reads decoded
  // frames but never owns seeking, volume, or play/pause state.
  useEffect(() => {
    if (!mediaEl) return;
    app.attachMedia(mediaEl);
    const onPlay = () => app.setPlayer((p) => (p.playing ? p : { ...p, playing: true }));
    const onPause = () => app.setPlayer((p) => (p.playing ? { ...p, playing: false } : p));
    mediaEl.addEventListener('play', onPlay);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('ended', onPause);
    let raf;
    const tick = () => {
      const currentProjection = doc.timelineProjection;
      const step = currentProjection && T
        ? T.playbackStep(currentProjection, mediaEl.dataset.clipId, mediaEl.currentTime)
        : { timelineTime: mediaEl.currentTime };
      if (step) {
        if (step.seekSource != null && Math.abs(mediaEl.currentTime - step.seekSource) > 0.0005) {
          try { mediaEl.currentTime = step.seekSource; } catch (e) {}
        }
        app.setPlayer((p) => {
          const ended = step.timelineTime >= doc.meta.duration - 1e-9;
          return Math.abs(p.t - step.timelineTime) > 0.003 || (ended && p.playing)
            ? { ...p, t: step.timelineTime, playing: ended ? false : p.playing }
            : p;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      mediaEl.removeEventListener('play', onPlay);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('ended', onPause);
      app.attachMedia(null);
    };
  }, [mediaEl, mediaClipId, doc.timelineProjection]);

  useEffect(() => {
    if (!mediaEl || !hasVideo) {
      setSourceAspect(null);
      return;
    }
    const update = () => {
      const ratio = mediaEl.videoWidth > 0 && mediaEl.videoHeight > 0
        ? mediaEl.videoWidth / mediaEl.videoHeight
        : null;
      setSourceAspect((current) => current === ratio ? current : ratio);
    };
    update();
    mediaEl.addEventListener('loadedmetadata', update);
    mediaEl.addEventListener('resize', update);
    return () => {
      mediaEl.removeEventListener('loadedmetadata', update);
      mediaEl.removeEventListener('resize', update);
    };
  }, [mediaEl, hasVideo]);

  // 预设与顺序照抄 Mac StageTransportBar.swift:220（自定义比例按 §3.9 省略）。
  const ratios = {
    Original: sourceAspect || R.LANDSCAPE_ASPECT,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '3:4': 3 / 4,
    '2:1': 2,
    '2.35:1': 2.35,
    '1.85:1': 1.85,
  };
  const frame = R.fitFrame(box.w, box.h, ratios[player.ratio] || ratios.Original);
  const fw = frame.width, fh = frame.height, scale = frame.scale;

  const t = player.t;
  const timing = doc.style.displayTiming || R.DEFAULT_TIMING;
  const cueDisplay = R.activeTimedItem(doc.timelineCues || doc.cues || [], t, timing);
  const sentenceDisplay = R.activeTimedItem(doc.timelineSentences || doc.sentences || [], t, timing);
  const transDisplay = R.activeTimedItem(doc.timelineTransCues || doc.transCues || [], t, timing)
    || (() => {
      const sentence = sentenceDisplay && sentenceDisplay.item;
      return sentence && sentence.trans
        ? {
            ...sentenceDisplay,
            item: {
              ...sentence,
              sid: sentence.id,
              kind: 'sentence',
              sourceText: sentence.text || '',
              text: sentence.trans || '',
            },
          }
        : null;
    })();
  const subtitleCue = cueDisplay && cueDisplay.item;
  const tcue = transDisplay && transDisplay.item;
  const sourceLanguage = doc.meta.sourceLang && doc.meta.sourceLang.code;
  const targetLanguage = doc.meta.targetLang && doc.meta.targetLang.code;
  // 画布上的原文行永远跟随「当前源 Cue」，译文行跟随它自己的译片：两条互不收窄的
  // 独立时间流，与烧录端 render_plan.rs::active_layouts 同构。Translate tab 曾把
  // 译片的整段对齐词 span 合成一条假 Cue 当原文画，于是画面出现横跨数条 Cue 的
  // 超长行，而导出的视频里从来没有这一行。
  const cue = subtitleCue;
  const chapter = app.chapterOf(doc, t);
  const chapterIndex = doc.chapters.indexOf(chapter);
  const hue = [252, 152, 28, 200][chapterIndex % 4] || 252;
  // 画面排几行由「样式上下文」回答，不是由 style.mode 单独回答：Transcript /
  // Subtitle tab（ctx sub）编辑独立原文，画面恒为原文一行；Translate tab（ctx bi）
  // 才读 style.mode。判据在 R.stageMode（内核纯函数，与原型 modeOf / Mac
  // SubtitleStyleContexts.mode 同规则），样式层的样片与分区门控读同一个函数。
  const styleCtx = TR.styleCtx(app.tab);
  // 上下文不止决定行数，也决定**样式本身**：`style.voiceInkContexts` 是 Mac 的无损
  // 真相，两个上下文各有一整套字号/外观/几何。只读扁平根键的话，sub 上下文会拿到
  // 从 bi 上下文拍平的那一份（本项目里字号 29 vs 30）。解析顺序见 store.jsx 的
  // applyOverlays：data.json → contexts[ctx] → edits.json 覆盖层。
  const st = (doc.ctxStyle && doc.ctxStyle[styleCtx]) || doc.style;
  const styleOpen = !!app.styleOpen;
  const mode = R.stageMode(styleCtx, st.mode);
  const lines = R.resolveModeLines(mode, st.order);
  // 入场姿态取两条流里更早的那个：Translate tab 的原文行现在由 cueDisplay 驱动，
  // 只看 transDisplay 会让原文在译片边界上重新入场。
  const displayStart = Math.min(
    cueDisplay ? cueDisplay.displayStart : Number.POSITIVE_INFINITY,
    transDisplay ? transDisplay.displayStart : Number.POSITIVE_INFINITY,
  );
  const transcribing = doc.status.phase === 'transcribing';
  const selKey = subtitleCue ? (subtitleCue.sourceItemId || subtitleCue.id) : null;
  // 两种选中形态（约定见 subtitle-rendering.js）：
  //   { kind:'sub', line } 「字幕对象」——不绑 cue，只要画面上还有字幕行就算选中，
  //     播放头跨过 cue 边界后选中框与拖拽都留着（原型/Mac 的 sel.kind === 'sub'）。
  //     画布点选与舞台工具条按钮写的都是它。
  //   { cueId, line }      绑定具体 Cue —— 时间轴块写它（Mac 的 .seg），右侧面板
  //     只读它做高亮。
  const subObject = R.isSubObjectSel(app.sel);
  const selected = subObject
    ? !!(subtitleCue || tcue)
    : !!(selKey && app.sel && app.sel.cueId === selKey);
  // sel.line 缺失 = 整体选中；'orig' / 'trans' = 只选中该行。
  const selectedLine = selected ? R.selectedLineOf(app.sel) : null;
  // 叠加元素：可见集合来自 timeline 投影（窗口已求值为时间轴秒），画布层只消费它。
  // elementsKey 是「影响画面的字段」摘要：播放头每帧都变，但元素没变时画布层不该
  // 重建（一个平铺水印是几百个 Konva 节点）。
  const projectionTracks = (doc.timelineProjection || {}).tracks || [];
  const elements = EG ? EG.visibleElements(projectionTracks, t, doc.meta.duration || 0) : [];
  const elementsKey = JSON.stringify(elements.map((element) => [
    element.id, element.kind, element.role, element.text, element.srcId,
    element.place, element.style, element.tile, element.verticalAlign,
    element.mode, element.fit, element.bg,
  ]));
  const selectedElementId = app.sel && app.sel.kind === 'el' ? app.sel.id : null;
  // 水印是带 role 的普通 text 元素（§3.6）；工具条那颗按钮找的是它，全片元素在
  // 任何播放头位置都该能被选中，所以从所有轨道里找、不过滤可见性。
  const watermarkElement = useMemo(() => {
    for (const track of projectionTracks) {
      const found = (track.elements || []).find((element) => element.role === 'watermark');
      if (found) return found;
    }
    return null;
  }, [projectionTracks]);
  const cueRef = useRef(subtitleCue);
  const tcueRef = useRef(tcue);
  const tabRef = useRef(app.tab);
  const selRef = useRef(app.sel);
  const styleRef = useRef(st);
  cueRef.current = subtitleCue;
  tcueRef.current = tcue;
  tabRef.current = app.tab;
  selRef.current = app.sel;
  styleRef.current = st;

  useEffect(() => {
    setEditing(null);
  }, [cue && cue.id, tcue && tcue.id]);
  useEffect(() => {
    if (player.playing || player.fullscreen || app.sel) clickCoordinatorRef.current.reset();
  }, [player.playing, player.fullscreen, app.sel]);

  // 全屏时画面只管播放/暂停：选中与编辑都属于非全屏的编辑态
  // （stage-click-policy.js 的 fullscreen 分支直接给 fullscreenToggle）。
  const routeCanvasPress = useCallback((options) => {
    const action = clickCoordinatorRef.current.next({
      fullscreen: !!player.fullscreen,
      playing: !!player.playing,
      hasSelection: !!app.sel,
      hasTarget: !!options.hasTarget,
      targetSelected: !!options.targetSelected,
    });
    if (action === 'pauseAndArm' || action === 'pause') {
      if (mediaElRef.current) mediaElRef.current.pause();
      app.setPlayer((p) => ({ ...p, playing: false }));
    } else if (action === 'play' || action === 'fullscreenToggle') {
      app.togglePlay();
    } else if (action === 'select') {
      if (options.select) options.select();
    } else if (action === 'clearSelection') {
      app.setSel(null);
    }
    return action;
  }, [player.playing, player.fullscreen, app.sel, app.setPlayer, app.setSel, app.togglePlay]);

  // 画布点选 = 选中「画面上的这条字幕」（对象形态），不切 tab、不绑 cue。
  // Mac `EditorPageView.swift:130-141` 的 .sel 观察者接住这一形态并 openStyle，
  // 原型 `designs/baocut-mac/app/editor.jsx:203-214` 同款 —— 所以这里不再延时切
  // tab：M89 之后选中字幕开的是盖在当前 tab 之上的样式层，而不是把人拽走。
  const selectLine = useCallback((line, extend) => {
    const current = cueRef.current;
    const currentTrans = tcueRef.current;
    if (line === 'orig' && !current) return;
    if (line === 'trans' && !currentTrans) return;
    app.setSel(R.nextLineSelection(selRef.current, line, Boolean(extend)));
  }, [app.setSel]);

  const editLine = useCallback((line, rect, metrics) => {
    const current = cueRef.current;
    const currentTrans = tcueRef.current;
    if (line === 'orig' && !current) return;
    if (line === 'trans' && !currentTrans) return;
    // The Translate tab's original line IS the active Subtitle cue now, but it
    // stays read-only here: editing the original belongs to the Subtitle tab, so
    // move there (selecting the same line) rather than opening an editor on the
    // tab whose job is the translation.
    if (line === 'orig' && tabRef.current === 'translate') {
      app.setSel(R.nextLineSelection(selRef.current, line, false));
      app.setTab('subtitle');
      if (mediaElRef.current) mediaElRef.current.pause();
      app.setPlayer((p) => ({ ...p, playing: false }));
      return;
    }
    app.setTab(line === 'trans' ? 'translate' : 'subtitle');
    if (mediaElRef.current) mediaElRef.current.pause();
    app.setPlayer((p) => ({ ...p, playing: false }));
    setEditing({
      line,
      rect,
      metrics,
      value: line === 'trans' ? ((currentTrans && currentTrans.text) || '') : current.text,
    });
  }, []);

  const commitLine = useCallback((line, value) => {
    setEditing(null);
    if (!value) return;
    if (line === 'trans') {
      const currentTrans = tcueRef.current;
      if (currentTrans && value !== (currentTrans.text || '')) {
        app.editTrans(
          currentTrans.sourceItemId || currentTrans.id,
          currentTrans.kind,
          value,
          currentTrans.sourceId || 'main',
        );
        window.toast('译文已更新', { variant: 'positive' });
      }
      return;
    }
    const current = cueRef.current;
    if (current && value !== current.text) {
      app.editCue(
        current.sourceItemId || current.id,
        'text',
        value,
        current.sourceId || 'main',
      );
      window.toast('字幕已更新', { variant: 'positive' });
    }
  }, [app.editCue, app.editTrans]);

  // 整体拖拽写锚点位移。delta 先取到 0.1% 再加，行覆盖用同一个 delta 平移，
  // 保证多次拖拽后各行相对几何不漂移。行覆盖不再二次钳制到画面内边界，
  // 否则贴边的行会被拉回，破坏与锚点的相对关系。
  const moveSubtitleBy = useCallback((dx, dy) => {
    const style = styleRef.current || {};
    const round = (value) => Math.round(value * 10) / 10;
    app.setStyle({
      x: round((style.x == null ? 50 : style.x) + dx),
      y: round((style.y == null ? 86 : style.y) + dy),
      ...R.shiftLineOverrides(style, dx, dy),
    }, styleCtx);
  }, [app.setStyle, styleCtx]);

  const moveLine = useCallback((line, x, y) => {
    app.setStyle(R.lineStylePatch(styleRef.current || {}, line, { x, y }), styleCtx);
  }, [app.setStyle, styleCtx]);

  // ----- 方向键微调选中的字幕（Mac EditorPageInteraction.nudgeSelection:176-193
  // + SubtitleLinePlacement.nudgeStep：0.5% / 次，Shift 2%） -----
  // 渲染期写入的只读快照：键盘处理器要读「此刻选中的是什么」，但把这些值写进
  // 依赖数组会让 window 监听器随 cue 边界反复解绑重绑。
  const nudgeRef = useRef(null);
  nudgeRef.current = {
    // Mac 的判据是 `sel.isSubtitle`（只有 .sub / .subLine），时间轴块选中
    // （Web 的 { cueId } 形态 = Mac 的 .seg）不参与微调。
    active: subObject && selected && !!player.showSubs,
    line: selectedLine,
    lines,
    fullscreen: !!player.fullscreen,
  };

  // 写回走的是拖拽同一条路径、同一条判据：整体选中 → moveSubtitleBy（锚点位移，
  // 已有行覆盖同步平移），双语栈里的单行选中 → 行级覆盖。单行模式下「选中那一行」
  // 与整体等价，仍走整体（与工具条打开样式层时写 line: null 同一条理由）。
  const nudgeSubtitle = useCallback((dx, dy) => {
    const state = nudgeRef.current;
    const style = styleRef.current || {};
    const line = state.line;
    if (line && state.lines.length > 1) {
      const rank = state.lines.indexOf(line);
      const seam = R.seamAlign(rank < 0 ? 0 : rank, state.lines.length);
      const position = R.linePosition(style, line);
      if (position) {
        const next = TR.clampPlacement(position.x + dx, position.y + dy);
        if (next.x !== position.x || next.y !== position.y) moveLine(line, next.x, next.y);
        return;
      }
      // 还在堆栈里的行：第一次微调就是「脱离堆栈」（Mac 同一条 Clause 7 语义）。
      // 起点取画布留下的只读快照 BCS_LINE_CENTERS —— 与样式层「独立摆放」同一个
      // 入口，并把该行当时的接缝锚点一起落定，否则脱离瞬间画面会跳。
      const snap = (window.BCS_LINE_CENTERS || {})[line];
      const base = snap && Number.isFinite(snap.x) && Number.isFinite(snap.y)
        ? { x: snap.x, y: R.lineAnchorFromCenter(snap.y, snap.h, seam) }
        : { x: style.x == null ? 50 : style.x, y: style.y == null ? 86 : style.y };
      const next = TR.clampPlacement(base.x + dx, base.y + dy);
      app.setStyle(R.lineStylePatch(style, line, { ...next, verticalAlign: seam }), styleCtx);
      return;
    }
    const current = { x: style.x == null ? 50 : style.x, y: style.y == null ? 86 : style.y };
    const next = TR.clampPlacement(current.x + dx, current.y + dy);
    if (next.x === current.x && next.y === current.y) return;
    moveSubtitleBy(next.x - current.x, next.y - current.y);
  }, [app.setStyle, moveLine, moveSubtitleBy]);

  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const onKey = (e) => {
      const state = nudgeRef.current;
      // 全屏是纯观看态：那边方向键是 ±5s 与音量（stage-fullscreen.jsx），
      // 与 Mac 的 fullscreen 分支先于 nudge 返回同序。
      if (state.fullscreen || !state.active) return;
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
      const delta = TR.nudgeDelta(e.key, e.shiftKey);
      if (!delta) return;
      e.preventDefault();
      nudgeSubtitle(delta.dx, delta.dy);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudgeSubtitle]);

  // ----- 叠加元素的选中 / 拖动 / 双击编辑 -----
  const selectElement = useCallback((element) => {
    app.setSel({ kind: 'el', id: element.id });
  }, [app.setSel]);

  const moveElementBy = useCallback((element, dx, dy) => {
    if (!EG) return;
    const place = EG.movedPlace(element, { dx, dy, frameWidth: fw, frameHeight: fh });
    app.moveElement(element, place);
  }, [app.moveElement, fw, fh]);

  const editElement = useCallback((element, rect, metrics) => {
    if (mediaElRef.current) mediaElRef.current.pause();
    app.setPlayer((p) => ({ ...p, playing: false }));
    setElementEditing({
      id: element.id,
      rect,
      metrics,
      value: element.text == null ? '' : element.text,
      label: '编辑' + (EOPS ? EOPS.elementLabel(element) : '元素') + '文字',
    });
  }, [app.setPlayer]);

  const commitElementText = useCallback((value) => {
    const current = elementEditing;
    setElementEditing(null);
    if (!current) return;
    const element = app.findElement(current.id);
    if (!element || value === (element.text == null ? '' : element.text)) return;
    app.setElementText(element, value);
  }, [app.findElement, app.setElementText, elementEditing]);

  // 编辑中的元素被删掉/换选中时收起编辑框，别留一个悬空的输入框。
  useEffect(() => {
    if (elementEditing && selectedElementId !== elementEditing.id) setElementEditing(null);
  }, [selectedElementId, elementEditing]);

  // 工具条「水印」：已有水印就选中它（并在 K2 的水印层就绪后打开层），没有就新建
  // 一个覆盖整片的水印再选中 —— 与原型 stage.jsx 的 openWatermark 入口对齐。
  const watermarkPress = useCallback(() => {
    if (app.wmOpen && app.closeWatermark) { app.closeWatermark(); return; }
    if (watermarkElement) {
      app.setSel({ kind: 'el', id: watermarkElement.id });
      if (app.openWatermark) app.openWatermark();
      return;
    }
    app.addWatermark().then((id) => {
      if (id && app.openWatermark) app.openWatermark();
    });
  }, [app.addWatermark, app.setSel, app.openWatermark, app.closeWatermark, app.wmOpen, watermarkElement]);

  // live region 只播画面上真的有的那几行，顺序也跟着 lines：Transcript / Subtitle
  // tab 只画原文，把译文一起念出来就是在描述一个不存在的画面。
  const a11yText = lines.map((line) => (line === 'trans'
    ? tcue && R.projectPunctuation(tcue.text, targetLanguage, st.punct !== false)
    : cue && R.projectPunctuation(cue.text, sourceLanguage, st.punct !== false)
  )).filter(Boolean).join(' / ');

  return (
    <div className={'vk-stage' + (player.fullscreen ? ' vk-stage--full' : '') + (fsIdle ? ' vk-stage--idle' : '')}
      data-screen-label="Video stage">
      <div className="vk-stage__area" ref={stageRef}>
        <div className="vk-frame" style={{ width: fw, height: fh }}>
          {hasVideo ? (
            <video
              key={`video:${mediaSourceId}:${mediaClipId}`}
              className="bcs-media-source"
              ref={setMediaSource}
              src={T ? T.mediaURL(mediaSourceId) : '__bcut/media'}
              data-src-id={mediaSourceId}
              data-clip-id={mediaClipId}
              playsInline
              preload="auto"
            />
          ) : hasAudio ? (
            <audio
              key={`audio:${mediaSourceId}:${mediaClipId}`}
              className="bcs-media-source"
              ref={setMediaSource}
              src={T ? T.mediaURL(mediaSourceId) : '__bcut/media'}
              data-src-id={mediaSourceId}
              data-clip-id={mediaClipId}
              preload="auto"
            ></audio>
          ) : null}

          <KonvaPreview
            width={fw}
            height={fh}
            mediaEl={mediaEl}
            hasVideo={hasVideo}
            hasAudio={hasAudio}
            hue={hue}
            cue={cue}
            tcue={tcue}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            lines={lines}
            style={st}
            scale={scale}
            t={t}
            playing={player.playing}
            displayStart={Number.isFinite(displayStart) ? displayStart : t}
            selected={selected}
            selectedLine={selectedLine}
            showSubs={player.showSubs}
            transcribing={transcribing}
            editingLine={editing && editing.line}
            onCanvasPress={routeCanvasPress}
            onSelectLine={selectLine}
            onEditLine={editLine}
            onMoveBy={moveSubtitleBy}
            onMoveLine={moveLine}
            elements={elements}
            elementsKey={elementsKey}
            selectedElementId={selectedElementId}
            editingElementId={elementEditing && elementEditing.id}
            onElementSelect={selectElement}
            onElementMove={moveElementBy}
            onElementEdit={editElement}
          />

          {editing ? (
            <CanvasTextEditor
              edit={editing}
              frameWidth={fw}
              frameHeight={fh}
              onCommit={(value) => commitLine(editing.line, value)}
              onCancel={() => setEditing(null)}
            />
          ) : null}

          {elementEditing ? (
            <CanvasTextEditor
              edit={elementEditing}
              frameWidth={fw}
              frameHeight={fh}
              onCommit={commitElementText}
              onCancel={() => setElementEditing(null)}
            />
          ) : null}

          <span className="bcs-canvas-a11y" aria-live="polite">{a11yText}</span>

          {transcribing ? (
            <div className="bcs-stagebadge">
              <span className="vk-spin"></span>
              转录中 · {Math.round(doc.status.pct || 0)}%
            </div>
          ) : null}

          <div className="vk-frame__label vk-frame__label--overlay" style={{ fontSize: 13 * scale + 6 }}>
            <span className="vk-mono">{fmtT(t)}</span>
            {chapter ? <span className="vk-frame__chip">{chapter.title}</span> : null}
          </div>
        </div>
      </div>

      {player.fullscreen ? (
        <div className="vk-stage__fullscreen-click" role="button" aria-label="播放或暂停"
          onClick={() => routeCanvasPress({})}></div>
      ) : null}

      {player.fullscreen ? (
        <window.BCSFullscreenBar app={app} player={player} duration={doc.meta.duration || 0}
          onIdle={setFsIdle} onExit={exitFullscreen} />
      ) : null}

      {/* 传输条：浮层统一向上开（原型 §3.5） */}
      <div className="vk-stagebar" onClick={(e) => e.stopPropagation()}>
        {/* 与 pane 内的按钮不同，样式层打开后这颗仍然可见，所以需要 --on 态。 */}
        <button className={'vk-stagebar__btn' + (styleOpen ? ' vk-stagebar__btn--on' : '')}
          data-tip={TR.styleTip(styleCtx)} data-tip-dir="up"
          aria-label={TR.styleLabel(styleCtx)} aria-pressed={styleOpen}
          onClick={() => {
            if (styleOpen) { app.closeStyle(); return; }
            // 打开样式层的同时选中画面上的字幕（原型 stage.jsx 的
            // `app.setSel({kind:'sub', id: defaultLine(doc, ctx)})`、Mac
            // StageTransportBar.styleBtn 同样先写 sel）：不然"能改样式却不能拖字幕"，
            // 而画布的点击策略又要求先暂停再等窗口才给得到选中。
            // 一律 line: null（= 原型的 'both'）：整体选中在单行模式下与选中那一行
            // 画面等价，而"只选中一行"在单行模式下会把拖拽写进行级覆盖，而行级覆盖
            // 只有排两行时才生效（canvas-stage 的 detachable），字幕会拖不动。
            app.setSel({ kind: 'sub', line: null });
            app.openStyle(styleCtx);
          }}>
          <Ic name="color" size={14} />{TR.styleLabel(styleCtx)}
        </button>
        {/* 水印（原型 stage.jsx 同位）：本轮只做「新建 / 选中」，参数面板在 K2。 */}
        <button className={'vk-stagebar__btn' + (app.wmOpen ? ' vk-stagebar__btn--on' : '')}
          data-tip={watermarkElement ? '选中画面上的水印' : '添加覆盖整片的水印'} data-tip-dir="up"
          aria-label="水印" aria-pressed={app.wmOpen ? true : undefined}
          onClick={watermarkPress}>
          <Ic name="layers" size={14} />水印
        </button>
        <span className="vk-spacer"></span>
        <QBtn
          icon="captions"
          size="S"
          tip={player.showSubs ? '隐藏字幕' : '显示字幕'}
          tipDir="up"
          selected={player.showSubs}
          onClick={() => app.setPlayer((p) => ({ ...p, showSubs: !p.showSubs }))}
        />
        <QBtn
          refEl={volRef}
          icon={player.muted || player.vol === 0 ? 'volume-mute'
            : player.vol < 0.34 ? 'volume-low'
            : player.vol < 0.67 ? 'volume-med' : 'volume'}
          size="S"
          tip="音量"
          tipDir="up"
          onClick={() => setVolOpen(true)}
        />
        {volOpen ? (
          <Pop anchorRef={volRef} onClose={() => setVolOpen(false)} dir="up" width={210}>
            <div className="vk-row">
              <QBtn
                icon={player.muted ? 'volume-mute' : 'volume'}
                size="S"
                tip={player.muted ? '取消静音' : '静音'}
                onClick={() => app.setPlayer((p) => ({ ...p, muted: !p.muted }))}
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.muted ? 0 : player.vol}
                style={{ flex: 1 }}
                onChange={(e) => app.setPlayer((p) => ({ ...p, vol: parseFloat(e.target.value), muted: false }))}
                aria-label="音量"
              />
              <span className="vk-mono vk-dim" style={{ width: 28, textAlign: 'right', fontSize: 11 }}>
                {Math.round((player.muted ? 0 : player.vol) * 100)}
              </span>
            </div>
          </Pop>
        ) : null}
        <QBtn refEl={ratioRef} icon="ratio" size="S" tip="画面比例" tipDir="up" onClick={() => setRatioOpen(true)} />
        {ratioOpen ? (
          <Menu
            anchorRef={ratioRef}
            onClose={() => setRatioOpen(false)}
            dir="up"
            align="end"
            width={170}
            items={Object.keys(ratios).map((ratio) => ({
              label: ratio === 'Original' ? '原始比例' : ratio,
              suffix: player.ratio === ratio ? '✓' : undefined,
              onClick: () => app.setPlayer((p) => ({ ...p, ratio })),
            }))}
          />
        ) : null}
        <QBtn icon="maximize" size="S" tip={player.fullscreen ? '退出全屏（Esc）' : '全屏'} tipDir="up"
          onClick={toggleFullscreen} />
      </div>
    </div>
  );
}

window.StagePane = StagePane;
})();
