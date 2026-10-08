/* 编辑器 —— §10 三缝布局框架 + 舞台 + Timeline + rail。
   结构照 apps/baocut 的 W1 收口：.editcol │ .vseam │ .panelouter │ .rail
   （右面板与 rail 是整个编辑列的兄弟，从内容区顶边一直到窗底；时间轴只占左列）。 */
(function () {
  const {useState, useRef, useLayoutEffect, useCallback, useEffect, useMemo} = React;
  const D = window.BC_DATA;
  const L = window.BC_LAYOUT;
  const TL = window.BC_TL;
  const T = window.BC_TIME;
  const CH = window.BC_CH;
  const TX = window.BC_TX;
  const TR = window.BC_TRUN;
  const S = window.BC_SUB;
  const PREFS = window.BC_SUB_PREFS;
  const PV = window.BC_PREV;
  const CUT = window.BC_CUT;

  function EditorPage({projectId, startT, embedded = false, retainedUrls}) {
    const app = useApp();
    const proj = app.projById(projectId) || D.projects.find((p) => p.id === 'p1') || D.projects[0];
    const initiallyEmpty = proj.entry === 'blank';
    const setup = D.projectSetup(proj);
    /* 剪口播实验项目（第 193 轮）：画面上没有任何元素——元素表只装按 clip 拆出的源视频，
       没有 B-roll / 文字 / 贴纸，也没有音乐行；剪辑建议不预埋，留给用户自己跑 AI。 */
    const bare = !!proj.bare;
    const localMedia = useMemo(() => proj.origin === 'local' ? window.BC_MEDIA.projectMedia(proj) : null, [proj.id]);

    /* ---- 编辑器自己的状态：不进全局 store（只有这一屏用） ---- */
    /* 音频转视频的本地项目落在 Elements（声波已选中，§9 a2v 行）；其余本地 / URL 项目落在文稿 */
    /* 落点过一遍表面（Web 没有工具页，退回文稿；model-surface.js） */
    const [localTab, setLocalTab] = useState(() => window.BC_SURFACE.landingTab(app.crop.sessions[projectId]?.open || app.shortsCut.sessions[projectId]?.open ? 'aitools' : initiallyEmpty ? 'video'
      : localMedia ? (localMedia.audio && proj.entry === 'a2v' ? 'elements' : 'transcript')
      : proj.origin === 'url' ? 'transcript' : setup.tab));
    const routeTab = D.rail.some(item => item.k === app.route.tab) ? window.BC_SURFACE.landingTab(app.route.tab) : null;
    const tab = routeTab || localTab;
    /* 工具页不在 rail 上（product-design §5.10）：它盖在发起它的那个 Tab 上，返回时回到那里。 */
    const tabRef = useRef(tab);
    tabRef.current = tab;
    const aiFrom = useRef('transcript');
    const setTab = useCallback(next => {
      const value = window.BC_SURFACE.landingTab(next);
      if (value === 'aitools' && tabRef.current !== 'aitools') aiFrom.current = tabRef.current;
      setLocalTab(value);
      app.replace({...app.route, tab:value});
    }, [app.route, app.replace]);
    const closeAi = useCallback(() => setTab(aiFrom.current || 'transcript'), [setTab]);
    useEffect(() => {
      if (app.route.tab !== tab) app.replace({...app.route, tab});
    }, [app.route, tab, app.replace]);
    const [paneHidden, setPaneHidden] = useState(false);
    const [videoReplacement, setVideoReplacement] = useState(null);   // {expected, candidate}
    const [replaceAll, setReplaceAll] = useState(null);               // {candidate, group}：一份成片换整段视频
    // Retain local media through undo/redo; release it when this editor session ends.
    const localVideoUrls = useRef(retainedUrls || new Set());
    const retainLocalVideoUrl = useCallback(url => localVideoUrls.current.add(url), []);
    useEffect(() => () => {
      if (retainedUrls) return; // The workspace owns URLs until this tab is closed.
      localVideoUrls.current.forEach(url => URL.revokeObjectURL(url));
      localVideoUrls.current.clear();
    }, []);
    /* 起始播放头：路由带 `t` 就落在那一刻（项目搜索的命中行跳转，第 118 轮），
       否则用演示默认值。深链接的 t 变化时重新定位；普通播放由编辑器自己管理。 */
    const [playT, setPlayT] = useState(startT == null ? initiallyEmpty || localMedia ? 0 : 12.4 : startT);
    const [playing, setPlayingRaw] = useState(false);
    useLayoutEffect(() => () => { if (embedded) setPlayingRaw(false); }, [embedded]);
    const lastStartT = useRef(startT);
    useEffect(() => {
      if (startT != null && startT !== lastStartT.current) {
        setPlayT(Math.min(startT, proj.duration || setup.duration)); setPlayingRaw(false);
      }
      lastStartT.current = startT;
    }, [startT]);
    /* 悬停预览的两格（第 122 轮）：`win` 是正在循环的动画窗口，`snap` 是进预览之前的
       播放头 / 播放位 / 静音位。放在 ref 里而不是 state——rAF 每帧都要读 `win`，
       它进了 deps，循环就会在鼠标每挪一格时被拆了重建。真正的进出逻辑在
       [editor-preview.jsx](editor-preview.jsx)。 */
    const preview = useRef({win: null, snap: null});
    const durationRef = useRef(initiallyEmpty ? 0 : localMedia ? proj.duration : setup.duration);
    /* 播放头能落到的上限（第 216 轮）：有主素材时 = 时长；空白项目开放尾巴，比内容末端
       多 `TL.BLANK_TAIL` 秒，播放停止仍读 `durationRef`（内容末端）。 */
    const seekLimitRef = useRef(initiallyEmpty ? TL.BLANK_TAIL : durationRef.current);
    /* 剪口表的镜像：rAF 每帧读它做跳播（第 192 轮），真身在 editor-cuts.jsx */
    const cutsRef = useRef([]);

    const [pxps, setPxps] = useState(TL.PXPS_DEFAULT);
    /* 时间轴滚动区的 ref 与缩放带来的滚动请求：缩放要量视口宽度、也要在新宽度渲染后设滚动偏移
       （`timelineZoom` / `TimelineView`，timeline.jsx）。 */
    const tlBodyRef = useRef(null);
    const [tlScrollReq, setTlScrollReq] = useState(null);
    const [ratio, setRatio] = useState(proj.ratio || '16:9');
    /* 画布背景（G11a）：`main.background` ∈ blur | black | #RRGGBB，缺省 blur。原型只在会话里记，
       与画幅一样不进撤销栈；舞台铺底见 stage.jsx，控件在项目属性（panel-brand.jsx）。 */
    const [mainBg, setMainBg] = useState(proj.background || 'blur');
    const [vol, setVol] = useState(80);
    const [muted, setMuted] = useState(false);
    const [musicMuted, setMusicMuted] = useState(false);   // 音乐行的停用位（第 120 轮）
    /* 轨道换序（2026-10-08）：拖行头 / 画布「层级」换过的次序，按叠存模型序（`BC_TL.trackOrderAfterDrop`）：
       `picture` 是画面与字幕同一叠，`audio` 是声音。字幕轨彼此的上下仍以 `subStyle.tracks` 为准。 */
    const [trackOrder, setTrackOrder] = useState({});
    /* 翻译配音（§15.4 / §15.6；2026-09-14 改成一种语言一**组**）：`dubs` 是写进时间轴的结果，一种语言
       一组（语言、按句的块、有没有自己的背景声、原声处置），同语言重跑替换那一组；组的停用位
       `dubOff[lang]`（关了配音与它的背景声一起灰），背景声自己另有一份 `bedOff[lang]`——背景声不跨组共用，
       每组是自己那次分离拆出来的。新配上的那组开着、别的语言关掉——一次只听一种配音。
       应用时记住原声此前的静音位，全部移除时恢复：配音把原声静掉不是用户自己点的停用，撤销后不该
       留下一条被静音的原声轨。`dub` / `dubMuted` / `bedMuted` 是「最后配的那组」的派生，给只认一条的旧读者用。 */
    const [dubs, setDubs] = useState([]);
    /* 项目级读音（`project.dub.readings`，docs/design/speech/bcut-tts-readings-design.md §4.3）：只有多字表面词 {surface, reading}，
       注音页改过的人名 / 术语记在这里，之后配音与生成语音先查它 */
    const [dubReadings, setDubReadings] = useState([]);
    const [dubOff, setDubOff] = useState({});
    const [bedOff, setBedOff] = useState({});
    /* 配乐轨（剧情短片 §5.5，timeline-score.jsx）：轨表、停用位与正在重新生成的那一路 */
    const scoreStore = window.useScoreStore({app, initial: localMedia || initiallyEmpty ? [] : setup.score});
    const mutedBeforeDub = useRef(null);
    const dub = dubs.length ? dubs[dubs.length - 1] : null;
    const dubMuted = dub ? !!dubOff[dub.lang] : false;
    const bedMuted = dub ? !!(dubOff[dub.lang] || bedOff[dub.lang]) : false;
    const applyDub = useCallback((d, o) => {
      const clearPrev = !!(o && o.clearPrev);
      setDubs((cur) => (clearPrev ? [] : cur.filter((x) => x.lang !== d.lang)).concat([d]));
      // 旁白组（2026-09-23）：不是另一种语言的配音，加上去就开着、别的组不动、原声也不动
      if (d.role === 'narration') { setDubOff((cur) => ({...cur, [d.lang]: false})); setBedOff((cur) => ({...cur, [d.lang]: false})); return; }
      // 新配的这组开着（配音 + 它的背景声），别的组关
      const flip = (cur) => {
        const next = {};
        Object.keys(clearPrev ? {} : cur).forEach((l) => { next[l] = true; });
        next[d.lang] = false;
        return next;
      };
      setDubOff(flip);
      setBedOff(flip);
      setMuted((m) => { if (mutedBeforeDub.current == null) mutedBeforeDub.current = m; return d.original === 'mute' ? true : m; });
    }, []);
    /** 移除一种语言的配音；不给语言就全部移除。最后一条走了才恢复原声。 */
    const clearDub = useCallback((lang) => {
      const next = lang ? dubs.filter((x) => x.lang !== lang) : [];
      setDubs(next);
      const drop = (cur) => { if (!lang) return {}; const n = {...cur}; delete n[lang]; return n; };
      setDubOff(drop);
      setBedOff(drop);
      if (!next.length) {
        if (mutedBeforeDub.current != null) { setMuted(mutedBeforeDub.current); mutedBeforeDub.current = null; }
      }
    }, [dubs]);
    /** 撤销「删除之前的全部配音」：把那次拿掉的几条原样放回（放在前面，停用位保持关） */
    const restoreDubs = useCallback((list) => {
      if (!list || !list.length) return;
      setDubs((cur) => list.filter((d) => !cur.some((x) => x.lang === d.lang)).concat(cur));
      const shut = (cur) => { const n = {...cur}; list.forEach((d) => { if (!(d.lang in n)) n[d.lang] = true; }); return n; };
      setDubOff(shut);
      setBedOff(shut);
    }, []);
    /* 配音块拉伸（2026-09-11）：拖块右缘改这一句的播放时长，语速 = 合成时长 / 新时长，
       夹在 0.7–2.0×；只动这一块。音源切换（行头 ⋯、播放条音源按钮、配音收据）一次翻原声、
       各语言配音与背景声的停用位，规则在 `BC_TTS.switchSource`。 */
    const stretchDub = useCallback((lang, id, dur) => {
      setDubs((cur) => cur.map((d) => (d.lang !== lang ? d
        : {...d, blocks: d.blocks.map((b) => (b.id === id ? window.BC_TTS.stretchBlock(b, dur) : b))})));
    }, []);
    /* 配音块管理（2026-09-13）：选中真相 `dubSel = {lang, ids}`（一次只在一条配音轨上选），
       点选 / ⌘ 追加 / ⇧ 连选的规则在 BC_DUB.pickIds；静音、删除、快速重新生成都按句写回那条轨。
       快速重新生成 = 同样的译文与声音再合成一次：块先标「排队」，演示里 1.2 秒后换成新块。 */
    const [dubSel, setDubSel] = useState(null);
    const pickDub = useCallback((lang, id, mod) => {
      setDubSel((cur) => {
        const d = dubs.find((x) => x.lang === lang);
        const ids = window.BC_DUB.pickIds(cur && cur.lang === lang ? cur.ids : [], d ? d.blocks : [], id, mod || {});
        return ids.length ? {lang, ids} : null;
      });
    }, [dubs]);
    const clearDubSel = useCallback(() => setDubSel(null), []);
    const updateDub = useCallback((lang, patch) => {
      setDubs((cur) => cur.map((d) => (d.lang !== lang ? d : {...d, ...(typeof patch === 'function' ? patch(d) : patch)})));
    }, []);
    const muteDubBlocks = useCallback((lang, ids, on) => {
      updateDub(lang, (d) => ({blocks: window.BC_DUB.muteBlocks(d.blocks, ids, on)}));
    }, [updateDub]);
    const deleteDubBlocks = useCallback((lang, ids) => {
      updateDub(lang, (d) => ({blocks: window.BC_DUB.deleteBlocks(d.blocks, ids)}));
      setDubSel(null);
    }, [updateDub]);
    // 旁白轨（role: narration）每句槽位跟着合成时长走：换版 / 重新生成后把后面的句顺延
    const reflow = (d, blocks) => (d.role === 'narration' ? window.BC_DUB.reflowNarration(blocks) : blocks);
    /* 逐句的版（2026-09-23，docs/design/speech/bcut-tts-sentence-takes-design.md）：每次重新生成都是新的一版，上一版留在归档；
       `take` 是这一句这一版要用的参数 {model, engine, seed}（属性页改的），不给就沿用组的。换回一版只改指向、不合成。 */
    const regenDubBlocks = useCallback((lang, ids, take) => {
      updateDub(lang, (d) => ({blocks: window.BC_DUB.queueRegen(d.blocks, ids)}));
      setTimeout(() => {
        updateDub(lang, (d) => ({blocks: reflow(d, window.BC_DUB.regenerate(d.blocks, ids, {fit: d.fit, script: d.script, group: d, take, now: Date.now()}))}));
      }, 1200);
    }, [updateDub]);
    const restoreDubTake = useCallback((lang, id, k) => {
      updateDub(lang, (d) => ({blocks: reflow(d, window.BC_DUB.restoreTake(d.blocks, id, k, {fit: d.fit, group: d}))}));
    }, [updateDub]);
    const pruneDubArchive = useCallback((keep) => {
      setDubs((cur) => cur.map((d) => ({...d, blocks: window.BC_DUB.keepLatest(d.blocks, keep, d)})));
    }, []);
    const clearDubArchive = useCallback(() => {
      setDubs((cur) => cur.map((d) => ({...d, blocks: window.BC_DUB.clearArchive(d.blocks, d)})));
    }, []);
    const setDubSource = useCallback((target, lang) => {
      if (!dubs.length) return;
      const want = lang || window.BC_TTS.activeDubLang(dubs, dubOff) || dubs[dubs.length - 1].lang;
      const d = dubs.find((x) => x.lang === want) || dubs[dubs.length - 1];
      const f = window.BC_TTS.switchSource(target, {original: d.original, lang: d.lang, langs: dubs.map((x) => x.lang)});
      setMuted(f.muted); setDubOff(f.dubOff); setBedOff(f.bedOff);
    }, [dubs, dubOff]);
    const [speed, setSpeed] = useState(1);
    const [subsOn, setSubsOn] = useState(initiallyEmpty ? false : localMedia ? localMedia.subs : setup.transcript && setup.captions !== false);
    const [fs, setFs] = useState(false);
    /* 舞台的平台安全区（2026-09-27）：编辑态，不进文档；新建页按 Shorts 做的项目默认开着。 */
    const [safeArea, setSafeArea] = useState(window.BC_SHORTS.isShorts(proj));
    /* 选中真相住在 [editor-selection.jsx](editor-selection.jsx)（第 115 轮改成数组）：
       `sel` 仍是「最后一次点中的那件」，老面板照旧只读它。`stageRef` 是 ⌘A 的取数口。 */
    const stageRef = useRef({elements: [], playT: 0});
    const selection = window.useSelectionStore({onPick: () => { setPaneHidden(false); setPaneView(null); },
      onPickSub: () => setPaneHidden(false), stage: () => stageRef.current});
    const {sel, sels, pick, pickSub, clearSel, isSel} = selection;
    useEffect(() => { if (sels.length > 1) setTab('elements'); }, [sels]);
    /* 起播 = 退出编辑态 ＋ 清空选中 ＋ 收起手柄（§2，第 115 轮）。包在**这一层**，
       transport 上那颗按钮、空格键、文稿面板里的「播到这里」走的是同一条路——
       三处各写一遍这条规矩必然漂。迁移判据是纯模型 `BC_SELECT.playState`。 */
    const setPlaying = useCallback((v) => {
      const st = window.BC_SELECT.playState(
        {sels: selection.selsRef.current, editing: selection.editingRef.current}, v);
      if (v && !st.sels.length
          && (selection.selsRef.current.length || selection.editingRef.current)) clearSel();
      setPlayingRaw(v);
    }, [clearSel, selection.selsRef, selection.editingRef]);
    const [clips, setClips] = useState(initiallyEmpty ? [] : localMedia ? localMedia.clips : setup.clips);
    const [sources, setSources] = useState(initiallyEmpty ? {image: [], video: [], audio: []} : localMedia ? localMedia.sources : setup.sources);
    const sourceCommitRef = useRef(null);
    const addSource = useCallback((kind, source) => {
      if (sourceCommitRef.current) sourceCommitRef.current();
      setSources(s => ({...s, [kind]: s[kind].concat([source])}));
    }, []);
    const removeSource = useCallback((kind, id) => {
      if (sourceCommitRef.current) sourceCommitRef.current();
      setSources(s => ({...s, [kind]: s[kind].filter(x => x.id !== id)}));
    }, []);
    /* 章节是**编辑器状态**，不是 D.chapters 那张常量表：Transcript 里改名或挪边界，
       Timeline 章节条、舞台模板的 SegmentRail、Elements 的章节 chip 必须当场跟着变。
       三处读同一份真相，才不会出现「面板改了、时间轴还是旧标题」。 */
    const [chapters, setChapters] = useState(initiallyEmpty || localMedia ? [] : setup.chapters);
    /* 时间轴的底长（2026-10-08）：有主素材的项目，时长 = max(底长, 元素末端)。底长起初是素材时长，
       波纹删除（`ripple`，删空所有轨的那几段合拢 / 从所有轨道删除一段）每合拢一段就减去那段——
       总长跟着变短。它进撤销快照，撤销一步回到原长。空白项目不读它（时长 = 内容末端）。 */
    const [durBase, setDurBase] = useState(initiallyEmpty ? 0 : localMedia ? proj.duration : setup.duration);
    const [pop, setPop] = useState(null);          // 单值互斥的弹层键
    /* AI 下单意图：{tool, scope}。文稿面板按章/按段下单，AI Tools 面板接单——
       范围不塞进 AI Tools 的局部 state，是因为下单方是 Transcript，
       两个面板之间只能靠编辑器这一层传，否则又要在两处各存一份范围。 */
    const [aiReq, setAiReq] = useState(null);
    /* cue 表本身是编辑器的状态（第 155 轮）：第 153 轮起改写文本落在这里，第 155 轮起
       **拆条 / 并条也在这里**——cue 是唯一的写入单位，时间轴字幕行、画布、导出预览、
       文稿段落读的都是这一张表，拆并之后它们一起变。段落是投影（model-cueops.js 的
       parasOf 按 root 把拆出来的条归回原段、把并掉的条抹掉），不另存。 */
    const awaitingTranscript = !!localMedia && proj.status !== 'complete';
    const [cues, setCues] = useState(proj.initialCues || (initiallyEmpty || awaitingTranscript || !setup.transcript ? [] : D.cues));
    // 校对文档由编辑器拥有：切列表/语言不丢编辑，整份快照进入统一撤销栈。
    const [translations, setTranslations] = useState({});
    const paras = useMemo(() => window.BC_CUEOPS.parasOf(cues, D.paras), [cues]);
    /* 字幕轨的初始集跟着入口走（§9）：**转录完成默认落一条源语言轨**，
       **翻译完成默认是双语两条**。加字幕入口的项目还没翻过，所以只有一条。
       轨落下去就固定在 timeline 上——后面切 Tab、切语言下拉都不会把它拿走
       （Mac 版当前的毛病正是切 Tab 会换掉 timeline 上的轨）。 */
    /* 「有译文数据但此刻不在画面上」的候选：timeline 行头的「放回」与语言入口的
       「有译文，还没放上去」那一组读的是同一份（第 108 轮起样式卡不再读它——
       卡不补轨）。源语言恒在候选里——它被拿下来之后要放得回来。 */
    const availableSubTracks = (doc) => {
      if (!cues.length) return [];
      const seed = D.subtitle.defaults.tracks;
      return D.transLangs
        .filter((l) => l.done > 0 || l.code === D.srcLang.code)
        .map((l) => S.byId({tracks: seed}, l.code)
          || Object.assign({}, D.subtitle.trackDefaults,
            {id: l.code, lang: l.code, name: l.name, role: 'translation'}))
        .filter((t) => !S.byId(doc, t.id));
    };
    // 语言入口当下选中的那条轨；套样式要知道「仅译文」落在哪一条上
    const subEditId = useRef(null);

    /* 双语叠法的**声明**（第 74.1 轮）：画面上凑齐两条时真相是轨的锚线
       （`BC_SUB.stackOrder`），这一格只回答「还没凑齐时，画廊的双语缩略图该谁在上」。
       第 108 轮起它**只到缩略图为止**：补轨的入口在 timeline 上，样式卡不再补轨，
       所以没有「按这个声明落序」那一步了（此前 ref ＋ state 各存一份，是因为
       `stagePreset` 被闭包住读不到新 state；那条读者退役，state 一份就够）。 */
    const [biStackPrefState, setBiStackPrefState] = useState('transTop');
    const setBiStackPref = useCallback((v) => setBiStackPrefState(v), []);

    /* 单语时留下的是**源语言那条**，不是数组第一条——默认叠法是译文在上，
       数组第一条现在是译文轨。 */
    /* 第 151 轮起 `preset` 不再按轨数分形态：画廊只有一份（`screenCatalog`），
       缩略图画的是画面上现有的轨，所以单语 / 双语都挂同一张卡（`defaults.preset`）。 */
    /* 从「剪成短视频」切出来的项目（§15.12）带着创建时的选择 `cut`：留哪几轨、要不要按平台安全区落位。
       落位与 Shorts 内置预设同一份几何（`BC_SHORTS.captionLayout`）；别的项目 `cut` 缺席，原样。 */
    const cutTracks = (tracks) => window.BC_SHORTS_CUT.openTracks(proj.cut, tracks,
      (ts) => window.BC_SHORTS.captionLayout(ts, window.BC_LAYOUT.ratioValue(proj.ratio || '9:16')));
    const subtitlePrefKey = window.BC_SURFACE.storageKey(PREFS.KEY);
    const subtitlePrefs = useRef(null);
    if (subtitlePrefs.current === null) {
      try { subtitlePrefs.current = PREFS.load(window.localStorage, subtitlePrefKey); }
      catch { subtitlePrefs.current = PREFS.clean(null); }
    }
    const subDoc = (bilingual) => PREFS.apply(Object.assign({}, D.subtitle.defaults, {
      tracks: cutTracks(bilingual ? D.subtitle.defaults.tracks
        : D.subtitle.defaults.tracks.filter((t) => t.role === 'source')),
    }), subtitlePrefs.current);
    /* `captions: false`（2026-10-08）：转录过却没建字幕的视频——有文稿、零条字幕轨，时间轴画只读文稿行 */
    const [subStyle, setSubStyleState] = useState(() => initiallyEmpty || awaitingTranscript || !setup.transcript || setup.captions === false
      ? {...subDoc(false), tracks: []} : subDoc(setup.entry.canvas === 'bi'));
    const hadPendingTranscript = useRef(awaitingTranscript);
    useEffect(() => {
      if (!hadPendingTranscript.current || proj.status !== 'complete') return;
      hadPendingTranscript.current = false;
      setCues(D.cues);
      setSubStyleState(subDoc(false));
    }, [proj.status]);
    const subCommitRef = useRef(null);
    const subStyleRef = useRef(subStyle);
    subStyleRef.current = subStyle;
    const setSubStyleRaw = useCallback((update, tag) => {
      const before = subStyleRef.current;
      const next = typeof update === 'function' ? update(before) : update;
      if (JSON.stringify(before) === JSON.stringify(next)) return;
      if (subCommitRef.current) subCommitRef.current(tag);
      subStyleRef.current = next;
      subtitlePrefs.current = PREFS.remember(subtitlePrefs.current, before, next);
      try { window.localStorage.setItem(subtitlePrefKey, JSON.stringify(subtitlePrefs.current)); } catch {}
      setSubStyleState(next);
    }, []);
    const addSubTrack = useCallback((lang) => setSubStyleRaw((s) => Object.assign({}, s,
      {tracks: window.BC_SUB.addTrack(s, Object.assign({}, D.subtitle.trackDefaults,
        {id: lang.code, lang: lang.code, name: lang.name, role: 'translation'}, subtitlePrefs.current.roles.translation))})), []);
    /* 转录中：`liveJob` 是那条**任务记录**，不是一份私有进度。
       两条进入路径——顶栏「入口演示」切到「转录中」（= sub 入口交接的前一秒），
       或者直接打开一个正在转录的项目（演示里是 p2）。 */
    const [liveOn, setLiveOn] = useState(false);
    const [transOn, setTransOn] = useState(false);   // 翻译中（见下方 transJob）
    /* 跑完留下的**收据**：{target, undone}。一次 AI run 收尾必须留下可撤销的出口
       （§15.1 三态的第三态），只弹一条会自己消失的 toast 不算数——用户回头找不到
       任何地方可以反悔。收据挂在编辑器上而不是面板局部：切走 Tab 再回来它还在。 */
    const [transReceipt, setTransReceipt] = useState(null);
    const [exportOpen, setExportOpen] = useState(false);
    /* 六入口开场（§9）：入口切换是一次性重置——默认 tab、画布、Timeline 三处
       同时改，并清掉选中与弹层。原型用顶栏「入口演示」下拉切；真实产品由向导路由决定。 */
    const [entry, setEntryRaw] = useState(proj.entry || 'sub');
    const [opening, setOpening] = useState(initiallyEmpty ? null : localMedia
      ? (localMedia.audio
        ? (proj.entry === 'a2v' ? '音频已载入 · 声波已上画面 · 转录完成后字幕自动出现' : '音频已载入 · 主轨是音频波形 · 字幕内容使用示例文稿')
        : '媒体已载入 · 字幕内容使用示例文稿')
      : proj.origin === 'url' ? '视频已保存 · 正在演示转录，右侧文稿会逐段出现'
      : proj.toast || (D.entries.find((e) => e.k === proj.entry) || D.entries[0]).toast);
    const ent = D.entries.find((e) => e.k === entry) || D.entries[0];
    /* 模板 store 在 pick 之后才建（它要 pick），入口切换却定义在前：经 ref 转一手 */
    const tplReset = useRef(() => {});
    const entryReset = useRef(() => {});
    const setEntry = useCallback((k) => {
      const e = D.entries.find((x) => x.k === k) || D.entries[0];
      setEntryRaw(k);
      const empty = e.canvas === 'empty';
      setCues(empty ? [] : D.cues);
      setSources(empty ? {image: [], video: [], audio: []} : setup.sources);
      setPlayingRaw(false); setPlayT(empty ? 0 : 12.4);
      entryReset.current(empty, e);
      tplReset.current(!!e.tplOn);
      setTab(e.tab);
      pick(e.selectWave ? {kind: 'element', id: 'e-wav', elKind: 'wave'} : null);
      // 「翻译」入口开在译文轨上：字幕 Tab 的列表跟着轨条的选中走（第 152 轮）
      if (e.bilingual) pickSub(D.dstLang.code);
      setPop(null);
      setPaneHidden(false);
      setSubsOn(e.canvas !== 'empty' && e.canvas !== 'wave' ? true : e.canvas === 'wave');
      // 入口决定这个项目已经走到哪一步，也就决定 timeline 上有几条字幕轨
      setSubStyleState(empty ? {...subDoc(false), tracks: []} : subDoc(e.canvas === 'bi'));
      setTrackOrder({});
      setClips(empty ? [] : setup.clips);
      setChapters(empty ? [] : setup.chapters);
      setDurBase(empty ? 0 : setup.duration);
      setAiReq(null);
      setLiveOn(!!e.live);
      setTransOn(!!e.transLive);
      setTransReceipt(null);
      // 同 live：切进「翻译中」= 从头演一遍，把那条演示任务倒回起点
      if (e.transLive) {
        app.patchTask('j5', {project: proj.id, status: 'running', pct: 0, phase: '读文稿中', outcome: null, error: null});
      }
      // 切到「转录中」= 从头演一遍：把演示任务与项目状态一并倒回起点，
      // 否则第二次切进来只会看到一条已经跑完的任务
      if (e.live) {
        // `rerun`：重新转录——视频已有字幕，时间轴与画面不跟转录走，只有文稿面板切实时态（§5.7，第 243 轮）
        app.patchTask('j1', {status: 'running', pct: 0, phase: '解码音频中', outcome: null, error: null, rerun: !!e.rerun});
        app.patchProject('p2', {status: 'transcribing', progress: 0, error: null});
      }
      setOpening(e.toast);
    }, [app]);

    const boxRef = useRef(null);
    const [box, setBox] = useState({w: 1200, h: 700});
    useLayoutEffect(() => {
      const el = boxRef.current; if (!el) return;
      const ro = new ResizeObserver(([e]) => {
        const r = e.contentRect;
        setBox({w: Math.round(r.width), h: Math.round(r.height)});
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const compactPane = window.BC_SURFACE.appRail && box.w < L.RAIL_W + L.SPLITTER_W + L.STAGE_MIN_W + L.PANE_MIN;
    // 宽度首次不足时收起工具；用户仍可从右侧导航打开完整宽度的覆盖面板。
    useEffect(() => { if (compactPane) setPaneHidden(true); }, [compactPane]);
    const paneW = app.prefs.paneW == null ? L.PANE_DEFAULT : app.prefs.paneW;
    const tlH = app.prefs.timelineH == null ? L.TIMELINE_DEFAULT_H : app.prefs.timelineH;
    const geo = L.solve({
      contentWidth: box.w, contentHeight: box.h,
      paneWidth: paneW, paneHidden, paneLastWidth: app.prefs.paneLast || L.PANE_DEFAULT,
      timelineHeight: tlH, fullscreen: fs, overlayNarrow: window.BC_SURFACE.appRail,
    });

    /* 播放：真时钟。前身画板禁计时器，只能靠点击推进 */
    useEffect(() => {
      if (!playing) return;
      /* 撤掉退出预览时压住播放头的那一格（见下面 `hold` 的注释）。撤在**这一行**——
         `!playing` 那条早退之后：暂停期间那一格要一直压着，直到真的又开始播。 */
      preview.current.hold = null;
      let raf, last = performance.now();
      const step = (now) => {
        const dt = ((now - last) / 1000) * speed;
        last = now;
        setPlayT((t) => {
          /* 退出预览那一拍：还在飞的那一帧（下一次 commit 才取消得掉）不许再推，
             否则每退出一次播放头就往前漂 16ms，来回几次就看得出来了。 */
          if (preview.current.hold != null) return preview.current.hold;
          const nt = t + dt;
          /* 预览态下播放头在动画窗口里来回走（折返，不是停在末尾一帧）——
             用的是**真播放头**，所以时间轴的游标在动，其余元素、字幕、B-roll 同步。 */
          const w = preview.current.win;
          if (w) return preview.current.once ? Math.min(nt, w.t1) : PV.wrap(nt, w.t0, w.t1);
          /* 剪口跳播（§12.6，第 192 轮）：播放头进了已剪段就跳到段尾——画面、字幕、
             元素读的都是跳过之后的时间，所以「成片长什么样」在播放里直接能看到。 */
          const st = CUT.skip(cutsRef.current, nt);
          if (st >= durationRef.current) { setPlaying(false); return durationRef.current; }
          return st;
        });
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      return () => cancelAnimationFrame(raf);
    }, [playing, speed]);

    const seek = useCallback((t) => setPlayT(T.clamp(t, seekLimitRef.current)), []);
    /* 面板子页的交接位（第 42 轮）。画布上点「样式」/「动画」要能直接开到右面板的
       那一页，所以这一格状态归编辑器管，不归面板自己——面板各存各的，画布就够不着。
       值只有两个：`styles` / `anims`；面板里手动切页时清成 null，交回面板自己的 local。 */
    const [paneView, setPaneView] = useState(null);
    /** 点时间轴上一句配音 → 音频 Tab 的「编辑配音句」（2026-09-23）：选中已由 pickDub 记下，这里只把面板翻过去 */
    const openDubSentence = useCallback(() => { setTab('audio'); setPaneView(null); setPaneHidden(false); }, []);

    /* 存进品牌库的素材（第 84.1 轮）。画布 `···` 的「存到品牌库」写这里，品牌页的
       视频 / 图片两节读这里——两处不各存一份，否则「存了之后去哪看」这句话是假的。
       同名的不重复存：同一个素材在品牌库里只有一条。 */
    const [brandMedia, setBrandMedia] = useState([]);
    const saveToBrand = useCallback((item) => setBrandMedia((list) => {
      // 去重要连**演示数据里已经有的那几条**一起看，否则存两次就长出两行同名的
      const has = (x) => x.name === item.name && x.kind === item.kind;
      if (list.some(has) || D.brand.media.some(has)) return list;
      return list.concat([Object.assign({id: 'bm-' + (list.length + 1), added: true}, item)]);
    }), []);

    /* 品牌库里自己的贴纸（第 238 轮）。内置的五个动态分类是 Noto 的 Lottie，但
       「品牌」这件事本来就是「换成你自己的」——所以品牌页多一节「贴纸」，收
       Lottie / GIF / SVG / 图片，元素目录的贴纸与动态贴纸两处都多出一格「我的贴纸」
       读这里。收件规则（白名单、字节优先判类型、20 MiB 上限、重名追加）全在纯层
       [model-brand-stickers.js](model-brand-stickers.js)，这里只管存。 */
    const [brandStickers, setBrandStickers] = useState([]);
    const addBrandSticker = useCallback((item) => setBrandStickers((list) => list.concat([item])), []);
    const removeBrandSticker = useCallback((id) => setBrandStickers(
      (list) => list.filter((x) => x.id !== id)), []);
    /* 用出去一次就盖一个时间戳，「我的贴纸」按它倒序摆（第 239 轮）。真机上这一
       笔要写回 brand.json 的 `usedAt`，所以次序跨项目、跨重启都在。 */
    const touchBrandSticker = useCallback((id) => setBrandStickers(
      (list) => window.BC_BRAND_STICKERS.touch(list, id, Date.now())), []);

    /* ---------- 悬停预览（第 51 轮，全局一条） ----------
       鼠标移到一张样式卡上，**编辑器里立刻是那个样子**；移开就回来。它是一份**临时
       覆盖**，不进文档、不进历史、不发 toast——因为用户还没有做决定。

       只有一格状态（`{kind, apply}`），画布按 kind 取用：这样每多一种可悬停的东西
       只要多写一个 `apply`，不必各自再造一套预览通道。也因此**同一时刻只可能有一份
       预览**——两处同时亮着会让人分不清画面在回应哪一只手。 */
    const [peek, setPeekRaw] = useState(null);
    /* 倒鸭子「调整布局」（2026-09-17）：编辑态，不进文档也不进历史——`null` 关；
       `{selectedKey}` 开着并记着画面上选中的那一块。挂在编辑器上是因为画面（拖块）与
       属性页（旋转 / 固定 / 完成）两处要读写同一格。 */
    const [kineticEdit, setKineticEdit] = useState(null);
    const setPeek = useCallback((p) => setPeekRaw(p || null), []);
    /** 取用：这一类有预览就返回预览过的那一份，否则原样返回。 */
    const peekOf = (kind, doc) => (peek && peek.kind === kind ? peek.apply(doc) : doc);

    /* 动画格的悬停预览是**真播放**（第 122 轮），进出与快照在
       [editor-preview.jsx](editor-preview.jsx)。 */
    window.usePreviewPlayback(preview, {peek, playT, playing, muted,
      setPlayT, setMuted, setPlaying: setPlayingRaw, setPeek});
    /* 剪口覆盖层（§12.6 / §13.1，第 192 轮）：cuts 表、剪辑模式位、写操作与任务监听
       都在 [editor-cuts.jsx](editor-cuts.jsx)；这里只把它组进 ctx 与撤销栈。 */
    const cutStore = window.useCutStore({app, proj, ent, initiallyEmpty, cutsRef, setTab, setPaneHidden, setPeek});
    /* 文稿选区与元素选中互斥（第 193 轮；product-design §5.7 不跨模式删除）：两头各管一边。
       ① 点中舞台 / 时间轴上任何一件（`put` 每次都换新数组，所以看 `sels` 本身而不是长度——
       已选着一件时再选字、再点回同一件也要收），或者离开文稿 Tab（面板一换，选区的字都不在屏上了），
       文稿选区就收掉；② 文稿里选出字时，元素选中（连同就地编辑）一并清掉——否则 transport 的删除钮
       与 ⌫ 删的是那件元素，不是眼前这段字。只在真有选中时才清，拖选每过一个字都会调一次。 */
    useEffect(() => { if (sels.length || tab !== 'transcript') cutStore.setCutSel(null); }, [sels, tab]);
    const setCutSel = useCallback((s) => {
      if (s && (selection.selsRef.current.length || selection.editingRef.current)) clearSel();
      cutStore.setCutSel(s);
    }, [clearSel, cutStore.setCutSel, selection.selsRef, selection.editingRef]);
    /* 模板那一份状态（项目实例 / 品牌库定义 / 版面编辑器会话）住在
       [editor-template.jsx](editor-template.jsx)，§14.5（第 112 轮） */
    const tpl = window.useTemplateStore(app, pick, () => { setTab('elements'); setPaneHidden(false); }, {ratio, setRatio, template: proj.template});
    tplReset.current = tpl.resetTemplate;
    /* 画幅锁（第 218 轮）：模板锁着画幅时，ctx 里的 setRatio 只 toast 不改——舞台画幅钮、
       项目设置、快捷键都从这一道口子走，谁都改不了但谁都能看见「是模板锁的」和「去哪解」。 */
    const setRatioGuarded = useCallback((r) => {
      const lock = tpl.ratioLock;
      if (lock && r !== lock.ratio) {
        app.toast(lock.note, 'notice', {label: '去模板设置', run: tpl.openTplProps});
        return;
      }
      setRatio(r);
    }, [app, tpl.ratioLock, tpl.openTplProps, setRatio]);
    /* 章节改名（`patchTranscript.set.chapters` 整表替换，保 id 与边界）。
       toast 与撤销都在 updater 之外——updater 必须是纯函数，
       把副作用塞进去在 StrictMode 的双调用下会弹两次。 */
    const renameChapter = useCallback((id, title) => {
      const next = CH.renameChapter(chapters, id, title);
      if (!next) return;
      const was = chapters.find((c) => c.id === id);
      history.mark();   // 章节进了撤销快照（2026-10-08，波纹删除要一起撤）
      setChapters(next);
      app.toast('已改章节名 · 时间轴章节条与模板段已同步', 'positive',
        {label: '撤销', undo: true, run: () => { setChapters(chapters); app.toast(`已还原「${was.title}」`); }});
    }, [app, chapters]);

    /* 把一段挪到相邻章节：改的是章节边界，所以同侧的邻居必然一起走（见 model-chapters.js） */
    const moveParaChapter = useCallback((paraId, dir) => {
      const r = CH.moveParaToChapter(chapters, paras, paraId, dir);
      if (!r) return;
      const to = r.chapters[r.to];
      const b = dir < 0 ? to.end : to.start;
      const prev = chapters;
      history.mark();
      setChapters(r.chapters);
      app.toast(`已把 ${r.moved} 段移到「${to.title}」· 章节边界 → ${T.timecode(b, {decimals: 0})}`, 'positive',
        {label: '撤销', undo: true, run: () => { setChapters(prev); app.toast('已还原章节边界'); }});
    }, [app, chapters, paras]);

    /* 转录任务：优先认这个项目自己那条 running 任务；入口演示切到「转录中」时
       借演示项目 p2 的那条（原型只有一份文稿数据，见 README 分歧台账 #13）。 */
    const liveJob = proj.origin === 'url'
      ? app.tasks.find(t => t.project === proj.id && t.origin === 'url' && t.status !== 'done') || null
      : (liveOn || proj.status === 'transcribing')
      ? (app.taskFor(proj.id, 'transcribe') || (liveOn ? app.tasks.find((t) => t.id === 'j1' && t.status !== 'done') : null))
      : null;

    /* 真时钟推进任务记录本身：顶栏胶囊、侧栏迷你条、后台任务页读的都是它。
       前身画板禁计时器，这一态当年根本画不出来。 */
    const savingTicks = useRef(0);
    useEffect(() => {
      if (!liveJob || liveJob.origin === 'url' || liveJob.origin === 'local' || liveJob.status !== 'running' || liveJob.pct >= 100) return;
      const id = setInterval(() => {
        const t = app.tasks.find((x) => x.id === liveJob.id);
        if (!t || t.status !== 'running') return;
        /* 第 243 轮：识别到头（pct 到 `LIVE_SAVE_PCT`）后停几拍再收尾——这一步是「正在保存转写」，
           真实流程里识别做完到结果写进视频之间有这么一段，演示里不停就一闪而过 */
        if (t.pct >= TX.LIVE_SAVE_PCT) {
          if (++savingTicks.current < TX.LIVE_SAVE_TICKS) return;
          savingTicks.current = 0;
          app.patchTask(t.id, {pct: 100, status: 'done', outcome: 'done', phase: null});
          app.patchProject(t.project, {status: 'complete', progress: null});
          app.toast(`转录完成 · ${D.cues.length} 条字幕 · ${Object.keys(D.speakers).length} 位说话人`, 'positive');
          setLiveOn(false);
          return;
        }
        savingTicks.current = 0;
        // 整数推进：进度是要显示的数，别让顶栏胶囊出现 57.6%。
        // 解码那一段走得慢一格——它在真实管线里也是先啃音频再出字
        const next = Math.min(TX.LIVE_SAVE_PCT, t.pct + (t.pct < 10 ? 1 : 2));
        app.patchTask(t.id, {pct: next, phase: TX.LIVE_STAGES[TX.liveStage(next)] + '中'});
      }, 260);
      return () => clearInterval(id);
    }, [liveJob && liveJob.id, liveJob && liveJob.status, app.tasks]);

    /* 翻译任务：与 liveJob 同一条规矩——**进度只存任务记录一份**，
       运行态头、顶栏胶囊、侧栏迷你条、后台任务页读的都是它。
       行数 / 调用数 / 阶段不另存，都是从这条记录的 pct 现推（见 model-trans-run.js）。
       第 207 轮起不再认死演示任务 j5：**这个项目**正在跑 / 排队的翻译，不管是 AI 工具、
       命令行还是 Agent 会话开的，字幕面板都得看得见（`BC_TRUN.findJob`）。 */
    const transJob = TR.findJob(app.tasks, proj.id);

    /* 演示 ticker 只推本进程自己开的那条（AI 工具 / 入口演示）；Agent 会话开的任务由
       store 的 runWrite 自己推进度，命令行的在产品里由 jobs.json 心跳推。 */
    useEffect(() => {
      if (!transJob || transJob.pct >= 100 || transJob.session) return;
      const jid = transJob.id;
      const id = setInterval(() => {
        const t = app.tasks.find((x) => x.id === jid);
        if (!t || t.status !== 'running') return;
        const next = Math.min(100, t.pct + 1);
        app.patchTask(jid, {pct: next, phase: TR.TRANS_STAGES[TR.stage(next)] + '中'});
        if (next >= 100) {
          app.patchTask(jid, {pct: 100, status: 'done', outcome: 'done', phase: null});
          setTransReceipt({target: t.target});
          setTransOn(false);
        }
      }, 200);
      return () => clearInterval(id);
    }, [transJob && transJob.id, transJob && transJob.status, app.tasks]);

    /* Agent 会话开的翻译跑完：落轨 + 收据，与 AI 工具那条路（finishTranslate）同一个落点——
       结果在哪儿，撤销的出口就该在哪儿。轨已经在画面上（重翻）就只出收据。 */
    const lastAgentRun = useRef(null);
    useEffect(() => {
      if (transJob && transJob.session) { lastAgentRun.current = {id: transJob.id, target: transJob.target}; return; }
      const last = lastAgentRun.current;
      if (!last) return;
      const t = app.tasks.find((x) => x.id === last.id);
      if (!t || t.status === 'running' || t.status === 'queued') return;
      lastAgentRun.current = null;
      if (t.status !== 'done' || !last.target) return;
      const lang = D.transLangs.find((l) => l.code === last.target);
      if (lang && !window.BC_SUB.byId(subStyleRef.current, last.target)) addSubTrack(lang);
      setTransReceipt({target: last.target});
    }, [transJob && transJob.id, app.tasks]);

    /* AI 工具里翻完之后**直接落到双语对照上**，不再多一颗「去核对对齐」——
       那颗钮要用户为了看自己刚要来的东西再点一次，中间还隔着一屏说明卡。
       收据跟着搬到翻译 Tab：结果在哪儿，撤销的出口就该在哪儿。 */
    const finishTranslate = useCallback((code) => {
      app.patchTask('j5', {target: code, status: 'done', outcome: 'done', pct: 100, phase: null, undone: false});
      // 翻译完成 = timeline 上多一条译文轨。这一步在这里做而不是在面板里，
      // 因为轨是项目的东西：从后台任务页看完回来，它也该已经在时间轴上了。
      const lang = D.transLangs.find((l) => l.code === code);
      if (lang) addSubTrack(lang);
      setTransReceipt({target: code});
      setTransOn(false);
      /* 第 152 轮起只有一个「字幕」Tab：落到它上面，并把轨条的选中落在刚翻好的那门
         语言上——列表跟着选中的轨走，这样看到的就是这一门的双语对照与收据。
         正在钻着画廊 / 属性页时也回到主页：收据在主页上，藏在栈底就白翻了。 */
      pickSub(code);
      setPaneView(null);
      setTab('subtitle');
      setPaneHidden(false);
    }, [app, addSubTrack, pickSub]);

    /* 撤销位落在**任务记录**上，不在这个收据里：同一次 run 在后台任务页也能撤销，
       两处各存一份就会出现「任务页撤销了、编辑器还写着已应用」。 */
    const undoTrans = useCallback(() => {
      const l = D.transLangs.find((x) => x.code === (transReceipt && transReceipt.target));
      app.patchTask('j5', {undone: true});
      app.toast(`已撤销 · ${l ? l.name : '译文'}已移除`);
    }, [app, transReceipt]);
    /* 撤销的反向出口。它和「再跑一次」不是一件事：再跑一次要重新花时间和钱，
       恢复只是把已经算好的那份放回去——误点了撤销的人该走这条。 */
    const redoTrans = useCallback(() => {
      app.patchTask('j5', {undone: false});
      app.toast('已恢复译文', 'positive');
    }, [app]);

    const rerunTrans = useCallback(() => {
      const code = (transReceipt && transReceipt.target) || 'ja';
      setTransReceipt(null);
      app.patchTask('j5', {target: code, status: 'running', pct: 0, phase: '读文稿中', outcome: null, error: null, undone: false});
      setTransOn(true);
    }, [app, transReceipt]);
    const dismissTrans = useCallback(() => setTransReceipt(null), []);

    const cancelTrans = useCallback(() => {
      if (!transJob) return;
      app.confirm({
        title: '取消翻译？',
        body: '任务会停下。文稿一个字不会被改动——已经译出来的句子不落盘。',
        confirmLabel: '取消任务', tone: 'negative',
        run: () => {
          // Agent 会话开的：停那条会话（它会把任务记成已停止并收掉计时器）
          if (transJob.session) app.stopAgent(transJob.session);
          else app.patchTask(transJob.id, {status: 'error', outcome: 'canceled', phase: null, error: '用户取消'});
          setTransOn(false);
          app.toast('已取消翻译');
        },
      });
    }, [app, transJob]);

    const cancelLive = useCallback(() => {
      if (!liveJob) return;
      if (liveJob.origin === 'url') { app.cancelImport(liveJob.id); return; }
      app.confirm({
        title: '取消转录？',
        body: '已经识别出来的部分不会保留——转录是一次成片的事务，中途停下不落盘。',
        confirmLabel: '取消转录', tone: 'negative',
        run: () => {
          app.patchTask(liveJob.id, {status: 'error', outcome: 'canceled', phase: null, error: '用户取消'});
          app.patchProject(liveJob.project, {status: 'error', error: '转录被取消'});
          setLiveOn(false);
          app.toast('已取消转录');
        },
      });
    }, [app, liveJob]);

    /* 「克隆新音色…」的回程（voice-library 设计稿 §2.3）：面板的 Tab / 子页不在路由里，设置页只能把人送回项目；
       面板在出发时把 {tab, paneView | ai} 记进 store.voiceHandoff.reopen，这里在带着 voiceId 回来时把它翻开，
       选择器随后认领新音色并清掉交接位。 */
    const handoffBack = app.voiceHandoff && app.voiceHandoff.voiceId ? app.voiceHandoff : null;
    useEffect(() => {
      const re = handoffBack && handoffBack.reopen;
      if (!re) return;
      setTab(re.tab);
      setPaneHidden(false);
      if (re.ai) setAiReq({tool: re.ai, scope: null, n: Date.now()});
      setPaneView(re.paneView || null);
    }, [handoffBack]);

    const requestAi = useCallback((tool, scope, agent) => {
      /* Web 表面没有 AI 入口：各面板已经按 `BC_SURFACE.ai` 收掉了按钮，这里是兜底——
         万一漏了一处，也只是说清去处，不会切到一个不存在的 Tab。 */
      if (!window.BC_SURFACE.ai) { app.toast(window.BC_SURFACE.aiElsewhere('AI 操作')); return; }
      setAiReq({tool, scope, agent: agent || null, n: Date.now()});
      setTab('aitools');
      setPaneHidden(false);
    }, []);
    /* 会话下的单（store 的 toolReq）：Agent 跑完的结果在这个面板里看，`agent` 让面板直接落在结果上。 */
    useEffect(() => {
      const q = app.toolReq;
      if (!q || q.movie !== proj.id) return;
      app.clearToolReq();
      requestAi(q.tool, null, {sid: q.sid});
    }, [app.toolReq, proj.id]);

    const editorBar = {
      exportOpen, closeExport: () => setExportOpen(false), ctx: null,
      entry, setEntry, projectId: proj.id,
      title: proj.title,
      meta: '',
      onExport: () => setExportOpen((v) => !v),
    };

    /* cue 文本改写表：**cue 是唯一的写入单位**，段落正文是它们相接出来的投影
       （同 apps/baocut——`findbar.rs::replace` 按 cue 原文生成 `sourceText`）。
       所以这张表挂在编辑器上而不是各面板自己存一份：在字幕 Tab 改一条，
       回到文稿 Tab 必须看得见同一句话变了，否则两个 Tab 会各说各的。 */
    const cueText = (id) => (cues.find((c) => c.id === id) || {}).text || '';
    const commitCues = (next) => {
      const value = typeof next === 'function' ? next(cues) : next;
      if (value === cues) return;
      history.mark();
      setCues(value);
    };
    const putCueText = (patch) => {
      if (!cues.some(c => c.id in patch && patch[c.id] !== c.text)) return;
      commitCues(cues.map(c => c.id in patch ? {...c, text: patch[c.id]} : c));
    };
    const putTranslationDoc = (target, next) => {
      history.mark();
      setTranslations(previous => ({...previous, [target]: next}));
    };
    /* 译文受剪情况（第 196 轮，§13.1）：原文被剪切的 cue，译文先不动、只标「原文被剪切」；
       成批处理走 AI 工具的「刷新过期译文」（Agent 或直接调模型），跑完把这些 cue 记成
       已按这一版剪口处理（`transCutFix`）。翻译面板、字幕面板、时间轴译文块与剪辑工具条
       读的都是这一份统计。 */
    const transImpact = useMemo(() => CUT.transImpact(cutStore.cuts, cues), [cutStore.cuts, cues]);
    const fixCutTrans = () => {
      const r = CUT.fixTrans(cutStore.cuts, cues);
      if (r.ids.length) commitCues(r.cues);
      return r.ids;
    };
    // 刷新过期译文的任务跑完（Agent 会话或直接调模型都落成同一种任务记录）就把待处理项收掉
    const staleSeen = useRef({});
    useEffect(() => {
      app.tasks.forEach((t) => {
        if (t.kind !== 'stale' || t.project !== proj.id || t.status !== 'done' || t.cutTrans === false) return;
        if (staleSeen.current[t.id]) return;
        staleSeen.current[t.id] = true;
        const n = CUT.fixTrans(cutStore.cuts, cues).ids.length;
        if (n) { fixCutTrans(); app.toast(`${n} 句原文被剪切的译文已按剪后原文重译`, 'positive'); }
      });
    }, [app.tasks]);

    /* 字幕样式文档：**一个组 + 两个成员**，一份，两个 Tab 各写自己那一部位。
       组持有叠法（谁在上 / 行间距 / 底板 / 锚点 / 偏移），成员持有各自的样子。
       文档必须挂在编辑器上而不是各面板自存：在翻译 Tab 把行间距拉开，切回字幕
       Tab 预览条上那两行就该是新的间距，否则两个 Tab 会各自演一份样式。 */
    const setSubStyle = useCallback((patch) => setSubStyleRaw((s) => Object.assign({}, s, patch)), []);
    /** 真撤销：整份文档换回快照（第 106 轮）。**不能走 `setSubStyle`**——那一支是 patch
        合并，把快照并回去只会把轨集换回来、却留下这次操作新写的键（最典型的是
        `preset`：勾还挂在刚点的那张卡上，撤销撤了一半）。整份替换是三处撤销
        （套样式 / 倒转叠法 / 放回轨）的共同上界，漏不掉任何一个字段。 */
    const restoreSubStyle = useCallback((doc) => {
      if (!doc) return;
      setSubStyleRaw(doc);
      setPeekRaw(null);   /* 撤销之后画面归位，悬停那一份别再压着 */
    }, []);
    /** 写某一条轨。每条轨就是它自己那一份——第 49 轮去掉「跟随源语言」之后，这里
        不再有「顺手解开跟随」这一笔。 */
    const setSubTrack = useCallback((id, patch, tag) => setSubStyleRaw((s) => Object.assign({}, s,
      {tracks: s.tracks.map((t) => (t.id !== id ? t : Object.assign({}, t, patch)))}), tag), []);

    /* ---------- 样式作用域：全部字幕 / 仅这一条（第 102 轮） ----------
       语义是 Detach（一张 cue 级稀疏覆盖表），但不画成一颗链条钮——
       判断与落法写在 §16.3 与 `model-substyle.js` 的 `CUE_KEYS` 上面。

       作用域挂在编辑器上而不是属性页里：浮动工具条上那颗 chip 与属性页顶部那一排
       是**同一个开关**，各存一份必然分叉。切轨、切样式、隐藏字幕都把它收回「全部」
       ——那几件事之后「仅这一条」指的已经不是同一条轨或同一份样式了。 */
    const [subScope, setSubScopeRaw] = useState('all');
    const setSubScope = useCallback((v) => setSubScopeRaw(v === 'cue' ? 'cue' : 'all'), []);
    /** 画面上这一刻是哪一条 cue。三处（画布、属性页、工具条）读同一个纯函数。 */
    const curCue = S.cueAt(cues, playT);
    const setSubCue = useCallback((cueId, trackId, patch, tag) => setSubStyleRaw((s) =>
      Object.assign({}, s, {cueStyles: S.setCueStyle(s, cueId, trackId, patch)}), tag), []);
    /** `sec` 给了就只退这一段，不给就整条回到跟随。 */
    const clearSubCue = useCallback((cueId, trackId, sec) => setSubStyleRaw((s) =>
      Object.assign({}, s, {cueStyles: sec
        ? S.clearSection(s, cueId, trackId, sec)
        : S.clearCue(s, cueId, trackId)})), []);

    /* 轨的增删换位。**加一门语言 = 加一条轨**，而且是加在 timeline 上——
       它落下去就固定在那里，切 Tab、切语言下拉都不会把它拿走（Mac 版当前
       的毛病正是后者）。所以这三个写口子挂在编辑器上，不在面板里。 */
    const removeSubTrack = useCallback((id) => setSubStyleRaw((s) => Object.assign({}, s,
      {tracks: window.BC_SUB.removeTrack(s, id)})), []);
    /* 把拿下来的轨放回画面。插在哪一格由 `BC_SUB.place` 说了算（默认叠法：译文在上、
       原文在下），三个补轨的入口读同一条规矩，免得同一件事三处三种排法。 */
    /** 换一门语言：位次不动，只换这一格里装谁；长相留在原地（`BC_SUB.replaceTrack`）。 */
    const swapSubTrack = useCallback((outId, track) => setSubStyleRaw((s) => Object.assign({}, s,
      {tracks: window.BC_SUB.replaceTrack(s, outId, track)})), []);
    const addSubTrackBack = useCallback((track) => setSubStyleRaw((s) => {
      const list = window.BC_SUB.addTrack(s, track);
      return list === s.tracks ? s : Object.assign({}, s, {tracks: list});
    }), []);

    /* 套用画廊里的一份样式。

       **样式卡永不改轨集**（第 108 轮裁决：文档只和 timeline 相关，timeline 上有
       哪几条字幕轨就显示哪几条）。此前这里同时改两样东西——轨集与涂装：双语补一条
       译文轨、仅译文把源语言拿下来。那等于让一张缩略图替用户做了一次没打招呼的
       增删轨，而「画面上是哪几条」的真相在 timeline 上。现在卡只换涂装，落在当下
       这一份轨集上（`BC_SUB.applyTargets`）；增删轨的入口在 timeline 行头与语言
       入口（`addSubTrack` / `removeSubTrack` / `addSubTrackBack` / `swapSubTrack`）。

       涂装的折算与画廊缩略图同一份（panel-substyle.jsx 的 lookPaint），所以套用
       之后轨里装的就是缩略图画的那些值，两边不会分叉。

       返回**这一次实际给哪几条上了妆**，外加「双语卡落在单轨画面上」那一档
       （`short`）——缩略图画两行、画面上只有一行时得说清楚，不假装套上了。 */
    /* 套一份样式落成什么样，是一个**纯函数**：给一份文档与一张缩略图，算出新文档。
       抽出来是为了让「悬停预览」与「真的套上去」走同一段代码——预览要是自己算一遍，
       松开鼠标那一刻画面就会跳，而那一跳正好发生在用户判断「是不是我要的」的时候。 */
    /* `scopeId`（第 152 轮画廊「套到」）：指到一条轨时只给它上妆，落的是卡的**主涂装**
       `look`——单独给译文换样子时用户点的是这张卡本身，不是它给「第二行」配的那份
       `look2`。样式从这一轮起**按轨记**（`t.preset`），文档级 `preset` 只在整份一起套时
       写；入口卡与画廊的勾据此判「全部同一张」还是「混搭」（`S.currentCard` / `S.styleNames`）。 */
    /* Shorts 预设的落位要知道画面宽高比（块高按它折成画面高的百分比）；applyPreset 是 [] 依赖的
       useCallback，走 ref 读当下的画幅 */
    const ratioRef = useRef(ratio);
    ratioRef.current = ratio;
    const stagePreset = (s, p, scopeId) => {
      const targets = S.applyTargets(s, p.form, subEditId.current, scopeId);
      const ids = new Set(targets);
      const src = S.source(s);
      const scoped = !!(scopeId && S.byId(s, scopeId));
      const tracks = S.tracks(s).map((t) => {
        if (!ids.has(t.id)) return t;
        const isSrc = src && t.id === src.id;
        /* 动效字幕自带涂装（`effectiveDefaults`，见 model-motioncaption.js），
           所以落的是它自己那一份，不是画廊那 31 份里借一份——借来的那份会让属性页
           读到一套字体色号、画面上却是另一套。 */
        const paint = p.caption && isSrc ? window.captionPaint(p.caption)
          : window.lookPaint(isSrc || scoped ? p.look : (p.look2 || p.look));
        // 译文轨不带 activeColor / wordAnim——词级时间戳只有源语言轨有
        if (!isSrc) delete paint.activeColor;
        const out = Object.assign({}, t, paint, {preset: p.id});
        out.textMotion = paint.textMotion || null;
        out.wordBackground = paint.wordBackground || null;
        out.nativeStyle = paint.nativeStyle || null;
        /* 一份样式**同时**说清两件事：逐词动效是哪一种，以及是不是一份动效字幕配方。
           画廊里那 16 张动效字幕带 `caption`，落下去接管整条；其余的一律把 `caption`
           清掉——套了别的样子却还留着上一份配方，画面上就是配方说了算，那一笔等于没点。 */
        if (isSrc) { out.wordAnim = p.anim || 'none'; out.caption = p.caption || null; }
        /* 倒鸭子（`p.kinetic`，2026-09-17）：跨句动态排版落在源语言轨的 `kinetic` 字段上。
           再点同一张卡时保留用户已调过的那份（换一版 / 固定块都在里面），套别的卡一律清掉
           ——与 `caption` 同一条规矩：留着上一份配方，画面上就还是它说了算。 */
        if (isSrc) out.kinetic = p.kinetic ? (t.kinetic || window.BC_DZ.defaults(window.BC_DATA.subtitle.kineticDemo)) : null;
        return out;
      });
      /* Shorts 内置预设（`p.layout === 'shorts'`，契约 6）：涂装之外还要**落位**——字号约画宽 5.5%、
         水平居中（宽 60）、最下面一块下沿贴安全框底 y = 76 再让出描边投影，几条可见轨往上叠。落位按画面上所有
         可见轨一起算（`BC_SHORTS.captionLayout`，与发布前检查的字幕块同一份几何），只写给这次上妆的轨。 */
      if (p.layout === 'shorts') {
        const geo = window.BC_SHORTS.captionLayout(tracks, window.BC_LAYOUT.ratioValue(ratioRef.current));
        for (let n = 0; n < tracks.length; n++) {
          const t = tracks[n];
          if (ids.has(t.id) && geo[t.id]) tracks[n] = Object.assign({}, t, geo[t.id]);
        }
      } else {
        /* 套别的卡把 Shorts 落的宽度清掉（回到通栏）；锚线与字号是几何，用户可能已经调过，留着 */
        for (let n = 0; n < tracks.length; n++) {
          if (ids.has(tracks[n].id) && tracks[n].width) { const t = Object.assign({}, tracks[n]); delete t.width; tracks[n] = t; }
        }
      }
      /* 「谁在上」不在这里落了（第 108 轮）：画面上原本就有两条时以**它们自己的
         锚线**为准（样式是涂装，不搬字幕的家）；不足两条时也不会再有「这次补齐的
         那条按声明落序」——补轨的入口在 timeline 上，`biStackPref` 只剩缩略图那一档
         声明。轨集不变，`stackOrder` 套用前后必然相同，此前那段翻转判断已是死码。 */
      return {doc: Object.assign({}, s, scoped ? {tracks} : {preset: p.id, tracks}),
        painted: tracks.filter((t) => ids.has(t.id)),
        short: p.form === 'bi' && targets.length < 2};
    };

    const applyPreset = useCallback((p, scopeId) => {
      let outcome = {painted: [], short: false};
      setSubStyleRaw((s) => {
        const r = stagePreset(s, p, scopeId);
        outcome = {painted: r.painted, short: r.short};
        return r.doc;
      });
      setPeekRaw(null);            // 套上去了，悬停那一份让位给真的那一份
      return outcome;
    }, []);

    /* 画布元素的那一份状态（起止 / 动画 / 摆位 / 样式 / 新建与删除）住在
       [editor-elements.jsx](editor-elements.jsx)——编辑器这一支只把选中口子递进去。 */
    /* 本地项目的起始元素：视频 = 按 clip 拆开的源视频；音频 = 建项配置预埋的那条声波
       （`BC_MEDIA.projectMedia().elements`，第 225 轮）——它是真元素，可选可换样式可删。 */
    const mediaElements = useMemo(() => localMedia
      ? window.BC_VIDEO_EDIT.initial(localMedia.clips, proj.src.name).map(e => ({...e, name: proj.src.name}))
        .concat(localMedia.elements || [])
      : bare ? window.BC_VIDEO_EDIT.initial(setup.clips, proj.src.name).map(e => ({...e, name: proj.src.name})) : [], [proj.id]);
    const els = useElementStore(pick, initiallyEmpty || !!localMedia || bare, mediaElements, proj.src.name);
    /* 音频转视频项目打开时声波已选中（§9 a2v 行「wave 自动选中」）：右栏直接是它的属性页 */
    useEffect(() => {
      const wave = localMedia && proj.entry === 'a2v' ? (localMedia.elements || []).find(e => e.kind === 'wave') : null;
      if (wave) pick({kind: 'element', id: wave.id, elKind: 'wave'});
    }, []);
    /* 轨道停用 / 启用的总闸（第 120 轮，§12.6）。真相各在各家——字幕轨 `track.hidden`、
       元素 `elDocs[id].hidden`、音频 / 音乐两个 muted 位——这里只做派发 + 一条可撤销的
       toast。时间轴行头、行头菜单、块右键菜单、导出弹层的「同步到时间轴」都走这个口子。 */
    const setLaneOn = useCallback((sw, on, opts) => {
      if (!sw) return;
      const quiet = opts && opts.quiet;
      let name = '';
      if (sw.kind === 'subs') {
        name = (S.byId(subStyle, sw.id) || {}).name || '字幕';
        setSubTrack(sw.id, {hidden: !on});
      } else if (sw.kind === 'el') {
        /* 同类共道（2026-09-11）：行头那只眼睛拧的是整行，多件时 `sw.ids` 逐件写 */
        const ids = sw.ids && sw.ids.length ? sw.ids : [sw.id];
        const spec = window.BC_DATA.elementSpecs || {};
        const first = (els.elements || []).find((e) => e.id === ids[0]) || {};
        name = ids.length > 1 ? ((spec[first.kind] || {}).title || '元素') + '轨' : first.name || '元素';
        ids.forEach((id) => els.setElDoc(id, {hidden: !on}));
      } else if (sw.kind === 'audio') {
        name = '音频'; setMuted(!on);
      } else if (sw.kind === 'music') {
        name = '音乐'; setMusicMuted(!on);
      } else if (sw.kind === 'dub') {
        // 组的开关：配音行连同它的背景声行一起（背景声自己的停用位不动，组再开时它还是原样）
        const d = dubs.find((x) => x.lang === sw.id);
        name = (d && d.langName ? '配音 · ' + d.langName : '配音') + (d && d.bed ? '（连同背景声）' : '');
        setDubOff((cur) => ({...cur, [sw.id]: !on}));
      } else if (sw.kind === 'bed') {
        const d = dubs.find((x) => x.lang === sw.id);
        name = '背景声' + (d && d.langName ? ' · ' + d.langName : '');
        setBedOff((cur) => ({...cur, [sw.id]: !on}));
      } else if (sw.kind === 'score') {
        // 只在时间轴上关掉这一路：动画稿里的配乐不动（剧情短片 §5.5）
        name = window.BC_SCORE.laneName(sw.id);
        scoreStore.setScoreOff((cur) => ({...cur, [sw.id]: !on}));
      } else return;
      if (quiet) return;
      app.toast((on ? '已启用「' : '已停用「') + name + (on ? '」' : '」 · 画面与导出都会跳过它'),
        on ? 'positive' : undefined,
        {label: '撤销', undo: true, run: () => setLaneOn(sw, !on, {quiet: true})});
    }, [app, subStyle, setSubTrack, els.elements, els.setElDoc, dubs]);
    /* 撤销 / 重做（§3）：快照 = 元素状态层 + clips + 选中，组装在 editor-history.jsx。 */
    const history = useHistoryStore(els, clips, setClips, selection, {
      doc: subStyle, commitRef: subCommitRef,
      restore: (doc) => {setSubStyleState(doc); setPeekRaw(null);},
    }, {sources, commitRef: sourceCommitRef, restore: setSources}, {
      doc: {cues, translations, cuts: cutStore.cuts, chapters, durBase},
      restore: doc => {
        setCues(doc.cues); setTranslations(doc.translations); cutStore.setCuts(doc.cuts || []);
        if (doc.chapters) setChapters(doc.chapters);
        if (doc.durBase != null) setDurBase(doc.durBase);
      },
    }, {doc: {ratio}, restore: doc => setRatio(doc.ratio)});
    cutStore.historyRef.current = history;
    /* ---- 智能裁剪（§15.9）：会话在 store，编辑器只负责接线 ---- */
    const cropSession = app.crop.sessions[proj.id];
    const cropActive = tab === 'aitools' && cropSession?.open && cropSession.phase === 'review';
    /* ---- 剪成短视频（§15.12）：挑片段时舞台换成候选预览 ---- */
    const shortsCutSession = app.shortsCut.sessions[proj.id];
    const shortsCutActive = tab === 'aitools' && !cropActive && shortsCutSession?.open && shortsCutSession.phase === 'review';
    const cropOutputs = app.crop.outputs[proj.id];
    useEffect(() => {
      if (!cropOutputs?.length) return;
      setSources(all => {
        const added = cropOutputs.filter(a => !all.video.some(v => v.id === a.id));
        return added.length ? {...all, video: all.video.concat(added)} : all;
      });
    }, [cropOutputs]);
    /* 打开工具：source 为空就是从命令或菜单进来（回到会话原地或起一份新设置）；
       带 output 是对一份裁剪产物「再调整构图」。 */
    /* 进智能裁剪时带上「现在看到的那一刻」：播放头落在用这段原片的片段里，就换算成原片时间。 */
    const cropAt = (source) => {
      const VR = window.BC_VIDEO_REPLACE, VE = window.BC_VIDEO_EDIT;
      const hit = source && els.elements.find(e => {
        if (e.kind !== 'video') return false;
        const d = {...e, ...els.elDocs[e.id]};
        return VR.sameSource(d, source) && playT >= d.start && playT <= d.end;
      });
      return hit ? VE.sourceTime({...hit, ...els.elDocs[hit.id]}, playT) : undefined;
    };
    const openCrop = (source, opts = {}) => {
      const hintSrc = source || (opts.output ? sources.video.find(v => v.id === opts.output.crop?.sourceId) : sources.video.find(v => !v.crop));
      const at = opts.at !== undefined ? opts.at : cropAt(hintSrc);
      const opened = app.crop.open(proj.id, {...opts, at, source, sources: sources.video, projectRatio: window.BC_LAYOUT.ratioValue(ratio)});
      if (opened?.ok === false) { app.toast(opened.error, 'negative'); return; }
      setPlaying(false); setTab('aitools'); setPaneView(null); setPaneHidden(false);
    };
    /* 从时间轴上的片段进智能裁剪：范围就是这个片段消耗的原片区间；片段用的已经是裁剪产物时，
       直接打开那份产物的构图。 */
    const cropInstance = id => {
      const element = els.elements.find(e => e.id === id && e.kind === 'video');
      if (!element) return;
      const target = {...element, ...els.elDocs[id]};
      const VR = window.BC_VIDEO_REPLACE, C = window.BC_CROP;
      const source = sources.video.find(v => VR.sameSource(target, v));
      if (!source) { app.toast('这个片段的素材不在视频里，先在 Video 里导入', 'negative'); return; }
      if (source.crop) { openCrop(null, {output: source}); return; }
      openCrop(source, {range: C.rangeFromInstance(target), targetId: id});
    };
    const openVideoReplace = (id, opts = {}) => {
      const element = els.elements.find(e => e.id === id && e.kind === 'video');
      if (!element) return;
      const target = {...element, ...els.elDocs[id]};
      if (target.locked) { app.toast('请先解锁这个视频片段'); return; }
      setPlaying(false); setPop(null); setReplaceAll(null);
      setVideoReplacement({expected: window.BC_VIDEO_REPLACE.snapshot(target), candidate: opts.candidate || null});
    };
    /* 落一笔替换（2026-09-16 二次修订）：素材、片段长度、同轨 ripple 与可选的画幅同步进同一撤销步。
       patches：[{id, patch}]；ripple：[{id, start, end}]；ratioSync：要一起改成的项目画幅或 null。 */
    const applyReplacePlan = ({patches, ripple = [], ratioSync = null, message, before}) => {
      history.begin();
      if (before) before();
      patches.forEach(({id, patch}) => els.setElDoc(id, patch));
      ripple.forEach(r => els.setElDoc(r.id, {start: r.start, end: r.end}));
      if (ratioSync) setRatio(ratioSync);
      history.commit();
      app.toast(`${message}${ratioSync ? ` · 视频画幅改为 ${ratioSync}` : ''} · 可撤销`, 'positive', {label: '撤销', undo: true, run: () => history.undo()});
    };
    /* 一份裁剪产物换整段视频：用同一原片的片段（剪口拆出的几段也算）一起换、剪口不动。
       从完成页或素材菜单出发，先看一眼要换哪几段、可选是否一起改画幅，再确认。 */
    const replaceWithOutput = candidateId => {
      const candidate = sources.video.find(v => v.id === candidateId);
      if (!candidate) return;
      const group = window.BC_VIDEO_REPLACE.replaceGroup({elements: els.elements, docs: els.elDocs, sources: sources.video, output: candidate, canvasRatio: window.BC_LAYOUT.ratioValue(ratio)});
      if (!group.count) { app.toast('时间轴上没有用这段原片的视频，素材已在 Video 里', 'notice'); return; }
      if (!group.replaced.length) { app.toast('时间轴上的片段不在这份产物的处理范围里，或已锁定', 'notice'); return; }
      setPlaying(false); setPop(null); setVideoReplacement(null); setReplaceAll({candidate, group});
    };
    /* 改了画幅、铺满画幅的视频会留黑边：一条 toast 直接把人带进智能裁剪。 */
    const prevRatio = useRef(ratio);
    useEffect(() => {
      const was = prevRatio.current; prevRatio.current = ratio;
      if (was === ratio || app.crop.sessions[proj.id]?.open) return;
      const VR = window.BC_VIDEO_REPLACE, C = window.BC_CROP, canvas = window.BC_LAYOUT.ratioValue(ratio);
      const clip = els.elements.map(e => ({...e, ...els.elDocs[e.id]})).find(e => {
        if (e.kind !== 'video') return false;
        const src = sources.video.find(v => VR.sameSource(e, v));
        // 演示素材没有像素尺寸时按 16:9 看待，与裁剪模型同一口径
        return src && canvas > 0 && Math.abs(C.sourceRatio(src) - canvas) > .01 && VR.fullFrame(e, src, ratio);
      });
      if (!clip) return;
      app.toast(`画幅已改为 ${ratio} · 视频会留黑边`, 'notice', {label: '用智能裁剪裁满', run: () => cropInstance(clip.id)});
    }, [ratio]);
    entryReset.current = (empty, e) => {
      /* a2v 演示入口只装那条声波（第 225 轮）：此前画面上是画上去的示意波形、时间轴上却还是
         视频行——现在与本地音频项目同一条路：真声波元素 + 音频主轨，没有视频元素 */
      els.resetEntry(empty, e.canvas === 'wave' ? D.elements.filter(x => x.kind === 'wave') : bare ? mediaElements : null);
      history.clear(); setPeekRaw(null);
      setTranslations({});
      cutStore.reset(empty, e);
      preview.current = {win: null, snap: null};
    };
    const duration = entry === 'blank' ? Math.max(0, ...els.elements.map(e => e.end || 0))
      : Math.max(durBase, ...els.elements.map(e => e.end || 0));
    durationRef.current = duration;
    /* 空白项目开放式时长（第 216 轮）：时长 = 内容末端，随元素占用延长；新元素按
       完整默认长度落在播放头上（`filmEnd = Infinity`，永不裁短、永不回推）；播放头
       可落到内容末端之后 `BLANK_TAIL` 秒。有主素材的项目 `filmEnd = duration`，撞片尾裁短。 */
    const openEnded = entry === 'blank';
    const filmEnd = openEnded ? Infinity : duration;
    seekLimitRef.current = TL.displayDuration(duration, openEnded);
    // 成片时长 = 时间轴时长减去已剪段（transport 时间码与导出面板读它）
    const outDuration = CUT.outDuration(duration, cutStore.cuts);
    /* 折叠时钟（第 197 轮立、第 200 轮并进全局「剪辑」开关）：开关关着时时间轴按成片时钟画、
       已剪段折掉且**什么都不画**；开着时撑开成源片时钟、已剪段成空槽带。开关是 `cutStore.cutMode`
       ——文稿的改字 / 剪辑态与时间轴形态由同一位决定。它只关乎这一次打开的项目，不进文档。 */
    const tmap = useMemo(() => CUT.foldMap(cutStore.cuts, els.elements, {expanded: cutStore.cutMode}),
      [cutStore.cuts, els.elements, cutStore.cutMode]);
    const hasTrans = !localMedia && subStyle.tracks.some(t => t.role === 'translation');
    /* 短视频项目（§15.12）：元数据最前面写它从哪儿来 */
    const cutFrom = window.BC_SHORTS_CUT.originLabel(app.projects, proj);
    editorBar.meta = [cutFrom ? cutFrom.short : null, T.duration(duration), proj.lang
      ? proj.lang + (hasTrans ? ' → ' + D.dstLang.name : '') : null,
      proj.model].filter(Boolean).join(' · ');
    /* 顶栏 ⓘ 打开的详情框里，「内容」与「译文」两行只有这条路给得出（第 233 轮）：
       说话人 / 章节 / 段数来自已加载的文稿，目标语来自当前轨集——项目卡那条路手上
       只有项目记录，那两行在那边缺席，不补占位。判据与上面这行 meta 同一个。 */
    editorBar.infoExtras = window.BC_PINFO.editorExtras(
      {meta: proj.meta, tlang: hasTrans ? D.dstLang.name : null});
    /* 播放头处分割（2026-09-16，§12.6 / §19）：切的是**视频元素**，没有主轨 `clips`。
       目标 = 选中的视频元素压在播放头上就切它，否则播放头下最上层的视频元素（`BC_VIDEO_EDIT.splitTarget`）；
       右键菜单传 `id` 指定切哪一件。左半留 id 收尾到播放头，右半是新元素（`srcStart` 按倍速推进、
       摆位样式原样复制），两步记一条历史，切完选中右半。 */
    const VE = window.BC_VIDEO_EDIT;
    const splitTarget = (id) => (id ? (els.elements.find(e => e.id === id && VE.canSplit(e, playT)) || null)
      : VE.splitTarget(els.elements, els.elDocs, playT, sel && sel.kind === 'element' ? sel.id : null));
    const canSplit = !!splitTarget();
    const split = (id) => {
      const target = splitTarget(id);
      if (!target) { app.toast('把播放头移到一段视频内再分割'); return; }
      const r = VE.splitElementAt(els.elements, els.elDocs, target.id, playT, {id: target.id + '-s' + els.nextSeq()});
      if (!r) { app.toast('离片段边缘太近，切不出一段'); return; }
      history.begin();
      els.setElDoc(r.left.id, {end: r.left.end});
      els.addElement(r.right, {quiet: true});
      history.commit('split');
      pick({kind: 'element', id: r.right.id, elKind: 'video'});
      app.toast(`已在 ${T.timecode(playT)} 分割「${target.name || '视频'}」`, 'positive',
        {label: '撤销', undo: true, run: () => history.undo()});
    };

    /* 波纹删除（2026-10-08）：把 `spans` 这几段从所有轨道上拿掉、后面的内容前移、总长变短。
       算式在 model-ripple.js（与内核 `removeRange` 同一口径）；这里只把结果写回各份状态。
       `gone` 是同一下要删掉的元素 / 字幕（Delete）——必须在这里一起算：这一拍里的 `cues`、
       `els.elements` 还是删之前的，先删再波纹会被波纹的整表写入盖回去。`spans` 为空时只删。
       **不开自己的历史批**——调用方把它包进 `history.begin()` / `commit()`，撤销一步回到删除之前。 */
    const ripple = (spans, gone) => {
      const RP = window.BC_RIPPLE;
      const dropIds = (gone && gone.ids) || [];
      const dropCues = (gone && gone.cues) || [];
      const own = els.elements.filter((e) => e.kind !== 'tpl' && dropIds.indexOf(e.id) < 0)
        .map((e) => (e.end == null ? Object.assign({}, e, {end: duration}) : e));
      const kept = cues.filter((cu) => dropCues.indexOf(cu.id) < 0);
      const r = RP.removeSpans({elements: own, cues: kept, chapters}, spans || [],
        {splitId: (el) => el.id + '-r' + els.nextSeq()});
      const before = {};
      own.forEach((e) => { before[e.id] = e; });
      r.elements.forEach((e) => {
        const was = before[e.id];
        if (!was) {
          const right = Object.assign({}, e, {added: true});
          delete right.endAnchor; delete right.members;
          els.addElement(right, {quiet: true});
          return;
        }
        const patch = {};
        if (e.start !== was.start) patch.start = e.start;
        if (e.end !== was.end) patch.end = e.end;
        if (e.srcStart !== was.srcStart) patch.srcStart = e.srcStart;
        if (Object.keys(patch).length) els.setElDoc(e.id, patch);
      });
      const removed = dropIds.concat(r.removed);
      if (removed.length) els.removeElements(removed);
      if (dropCues.length || r.closed) setCues(r.cues);
      if (!r.closed) return 0;
      setChapters(r.chapters);
      setDurBase((d) => Math.max(0, Math.round((d - r.closed) * 1000) / 1000));
      // 播放头跟着内容走：落在拿掉的段里回到段首，段后的前移
      const at = RP.shiftTime(playT, spans);
      if (at !== playT) seek(at);
      return r.closed;
    };

    const ctx = {
      retainLocalVideoUrl,
      proj, tab, setTab, playT, seek, playing, setPlaying, pxps, setPxps, tlBodyRef, tlScrollReq, requestTlScroll: (left) => setTlScrollReq({left}), sources, addSource, removeSource, duration,
      openEnded, filmEnd,
      hasAudio: localMedia ? localMedia.audio : entry !== 'blank', hasMusic: !localMedia && setup.music && entry !== 'blank',
      /* 纯音频项目（第 225 轮）：时间轴主轨是音频行、画布有一层纯色底。本地音频项目不看入口
         （配「加字幕」也没有视频轨）；演示项目只在 a2v 入口下成立 */
      audioProject: localMedia ? localMedia.audio : ent.canvas === 'wave',
      canvasBg: window.BC_KF.bgFill(mainBg,
        localMedia ? localMedia.bg : ent.canvas === 'wave' ? window.BC_MEDIA.bgToken('gray') : null),
      mainBg, setMainBg,
      ratio, setRatio: setRatioGuarded, ratioLock: tpl.ratioLock, vol, setVol, muted, setMuted, musicMuted, setMusicMuted, trackOrder, setTrackOrder, setLaneOn, speed, setSpeed,
      score: scoreStore.score, scoreOff: scoreStore.scoreOff, scoreJob: scoreStore.scoreJob, regenScore: scoreStore.regenScore,
      dub, dubs, dubOff, bedOff, dubReadings, setDubReadings, applyDub, clearDub, restoreDubs, dubMuted, bedMuted, stretchDub, setDubSource,
      dubSel, pickDub, clearDubSel, updateDub, muteDubBlocks, deleteDubBlocks, regenDubBlocks, restoreDubTake, pruneDubArchive, clearDubArchive, openDubSentence,
      subsOn, setSubsOn, fs, setFs, safeArea, setSafeArea, clips, setClips, split, canSplit, ripple, pop, setPop,
      sel, sels, pick, pickSub, clearSel, isSel, selKeys: selection.selKeys,
      pickMany: selection.pickMany, selectAll: selection.selectAll, history,
      editing: selection.editing, startEdit: selection.startEdit, stopEdit: selection.stopEdit,
      paneHidden, setPaneHidden, paneView, setPaneView, geo, entry, ent, setEntry,
      brandMedia, saveToBrand,
      brandStickers, addBrandSticker, removeBrandSticker, touchBrandSticker,
      chapters, renameChapter, moveParaChapter,
      liveJob, cancelLive,
      /* 转录到了第几秒（第 220 轮）：字幕轨的待定带前缘、画面上字幕出现的边界、文稿面板
         流入的位置读的都是这一个数（`TX.liveAt`，与 `liveSlice` 同一定义）；不在转录 = null。 */
      liveAt: TX.liveAt(liveJob, duration),
      transJob, cancelTrans, undoTrans, redoTrans, rerunTrans, dismissTrans, finishTranslate,
      transReceipt: transReceipt
        ? {...transReceipt, undone: !!(app.tasks.find((t) => t.id === 'j5') || {}).undone}
        : null,
      cues, setCues: commitCues, paras, cueText, putCueText, translations, putTranslationDoc,
      cuts: cutStore.cuts, cutOps: cutStore.cutOps, cutMode: cutStore.cutMode, setCutMode: cutStore.setCutMode, outDuration,
      tmap,
      cutSel: cutStore.cutSel, setCutSel, transImpact, fixCutTrans,
      subStyle, setSubStyle, restoreSubStyle, setSubTrack, applyPreset, stagePreset,
      subScope, setSubScope, curCue, setSubCue, clearSubCue,
      biStackPref: biStackPrefState, setBiStackPref,
      peek, setPeek, peekOf,
      kineticEdit, setKineticEdit,
      availableSubTracks: () => availableSubTracks(subStyle), subEditId,
      addSubTrack, removeSubTrack, addSubTrackBack, swapSubTrack,
      ...els,
      ...tpl,
      elements: tpl.withTemplateRow(els.elements, els.elDocs),
      aiReq, requestAi, openCrop, cropInstance, openVideoReplace, replaceWithOutput, applyReplacePlan, clearAiReq: () => setAiReq(null), closeAi,
      clearOpening: () => setOpening(null),
    };
    /* ⌘A 读这一份（元素投影在 ctx 里才算齐）；键盘层与剪贴板见 editor-keys.jsx。 */
    stageRef.current = {elements: ctx.elements.filter(e => e.kind !== 'audio'), playT};
    const keys = window.useEditorKeys(ctx);
    window.useShortsUsed(ctx);   // 短视频项目：时间轴上用到原片的哪几段，写回项目记录（§15.12）
    ctx.clipboard = keys.clipboard;
    // Export 弹层与原型开关面板都挂在外壳上，需要拿到编辑器上下文
    editorBar.ctx = ctx;

    const Frame = embedded ? window.WorkspaceMovieFrame : window.Shell;
    return (
      <Frame editor={editorBar}>
        {keys.sheet}
        {videoReplacement ? <window.VideoReplaceDialog key={videoReplacement.expected.id} ctx={ctx} expected={videoReplacement.expected}
          candidate={videoReplacement.candidate} onClose={() => setVideoReplacement(null)} /> : null}
        {replaceAll ? <window.ReplaceAllDialog ctx={ctx} candidate={replaceAll.candidate} group={replaceAll.group} onClose={() => setReplaceAll(null)} /> : null}
        {/* 全屏播放器（§11.1，第 222 轮）：它自己是一层 `position: fixed` 的覆盖层 ＋
            向浏览器要真全屏，所以挂在这里而不是塞进 `.stagewrap`——舞台那格再怎么
            铺满也只是**内容区**，顶栏与侧边栏还在，这正是此前「点全屏只占一部分」的
            由来。编辑器这边同时不再画自己的舞台与工具条（下方 `fs ? null`），
            与 App 的 `bar.is_hidden = fullscreen` 同则。 */}
        {fs ? <window.PlayerOverlay ctx={ctx} /> : null}
        <div className="edrow" ref={boxRef}>
          <div className="editcol" style={{width: geo.stageW}}>
            {cropActive ? <window.CropStage ctx={ctx} /> : shortsCutActive ? <window.ShortsCutStage ctx={ctx} /> : <>
            <div className="stagewrap" style={{height: geo.stageH}}>
              {opening ? (
                <div className="opentoast" onClick={() => setOpening(null)}>
                  <Ic n="info" className="ic--16" />
                  <span className="grow">{opening}</span>
                  <Ic n="close" className="ic--14" />
                </div>
              ) : null}
              {/* 视频用到的字体还没下载时的那一条（product-design §5.9，font-downloads.jsx） */}
              {fs ? null : <window.FontOpenStrip projectId={proj.id} />}
              {fs ? null : (tpl.tplStudio ? <window.TemplateStudioStage ctx={ctx} /> : <window.StageView ctx={ctx} />)}
              {fs ? null : <window.StageBar ctx={ctx} />}
            </div>
            {fs ? null : (
              <window.Seam dir="h" onDrag={(y) => {
                const r = boxRef.current.getBoundingClientRect();
                app.setPref('timelineH', Math.round(r.bottom - y));
              }} />
            )}
            {fs ? null : <window.TimelineView ctx={ctx} height={geo.timelineH} />}
            </>}
          </div>
          {fs || geo.paneGhost || geo.paneOverlay ? null : (
            <window.Seam dir="v" onDrag={(x) => {
              const r = boxRef.current.getBoundingClientRect();
              const w = Math.round(r.right - L.RAIL_W - x);
              const p = L.pane(w, false, app.prefs.paneLast);
              /* 拖进 ghost 只翻 hidden 位，宽度偏好写回 p.last（模型专门为恢复
                 留的那一格）。曾经这里写 0——而 rail 展开只翻 hidden 不还原宽度，
                 pane() 看到 0 < 340 又判 ghost，面板从此永远出不来（第 104 轮修）。 */
              if (p.ghost) { setPaneHidden(true); app.setPref('paneW', p.last); }
              else { app.setPref('paneW', p.width); app.setPref('paneLast', p.width); }
            }} />
          )}
          {fs || geo.paneGhost ? null : (
            <div id="bc-panel" role="region" aria-label="当前编辑工具" className={cx("panelouter", geo.paneOverlay && "panelouter--overlay")} style={{width: geo.paneW}}>
              <window.PanelView ctx={ctx} />
            </div>
          )}
          {fs ? null : <window.Rail ctx={ctx} />}
        </div>
      </Frame>
    );
  }

  /* Shared editor tools (product-design §5.1): a floating, icon-only surface.
     Native S2 toggles own selection/focus; the user-revised selection indicator
     mirrors the app rail, on the right edge. */
  function Rail({ctx}) {
    const {tab, setTab, paneHidden, setPaneHidden} = ctx;
    const S = window.RSP;
    return <div className="rail">
      <S.ToggleButtonGroup orientation="vertical" selectionMode="single" isQuiet size="M" aria-label="视频编辑工具"
        selectedKeys={new Set(paneHidden ? [] : [tab])} onSelectionChange={keys => {
          const key = [...keys][0];
          if (key == null) setPaneHidden(true);
          else { setTab(key); setPaneHidden(false); }
        }} UNSAFE_className="editor-tools bc-scroll">
        {window.BC_SURFACE.rail(D.rail).map(r => <S.TooltipTrigger key={r.k}>
          <S.ToggleButton id={r.k} aria-label={r.label} UNSAFE_className="editor-tools__button">{r.k === 'transcript' ? <S.Icons.Transcript /> : <Ic n={r.icon} />}</S.ToggleButton>
          <S.Tooltip placement="left">{r.label}</S.Tooltip>
        </S.TooltipTrigger>)}
      </S.ToggleButtonGroup>
    </div>;
  }

  Object.assign(window, {EditorPage, Rail});
})();
