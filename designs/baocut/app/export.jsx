/* Export —— §17.1（第 120 轮重画）。顶栏「导出」→ 右对齐弹层。
   ============================================================================
   这一轮的三个裁决：

   1. **画面里有什么，由时间轴决定**，导出面板不再有「原文 / 译文 / 双语」这一档
      与轨集平行的设置（第 108 轮：轨集是唯一真相）。面板上那张清单——每条字幕轨、
      元素、音频、音乐——的初值就是时间轴上的启停位；你在这里拨动的开关是一层
      **只对这次导出生效**的覆盖，时间轴不动。想留下来，点「同步到时间轴」一次写回
      （走 `ctx.setLaneOn`，与行头那只眼睛同一条写路径，可撤销）。
   2. **导出就是一条任务记录**（`app.addTask`），进度由 `useExportRunner` 推进——
      弹层关了它照跑（所以没有「后台继续」按钮），顶栏「导出」按钮变成「导出中 · 31%」、
      后台任务页的进行中一节、任务详情页读的都是同一条记录；
      「取消导出」在弹层、顶栏、任务页三处都是 `app.cancelTask`，一句确认，一处文案。
   3. **预览与快捷设置**（第 120.1 轮改）：左栏一块小画面演的是**导出出去会是什么样**——
      随右栏的开关、画幅裁切与它自己的一条时间线动（export-preview.jsx）；分辨率与画幅比
      就在这一屏，每一档旁边写着预计耗时（§17.1 M122 的模型：帧数 × k × 输出百万像素）
      与体积。
   4. **范围与体积**（第 239 轮）：「只导一段」重拾并放宽成 整片 / 按章节 / 按片段 / 自定义
      （export-range.jsx，章节与片段多选、自定义走预览下的修剪条）；「体积」三档只缩放码率——
      改体积不改耗时，内核只写 H.264（HEVC 只读），所以没有编码器一档。
   5. **五页**：视频 / 音频 / 字幕 / 文稿 / 工程。文稿从字幕页拆出去（export-transcript.jsx）——
      字幕是带时间轴的行、文稿是按段落读的文章，语言轴与格式轴都不一样；字幕格式加 ASS。
   6. **音频（2026-09-20）**：把项目的声音单独写成 WAV / MP3 / M4A（export-audio.jsx）——
      不必先导一份 MP4 再去别处扒音轨。清单、覆盖表与范围都与视频页**共用同一份**，
      音频页只多「快速选择」「格式与音质」「人声分几份」三节；导出出去仍是一条任务。
   7. **工程（可编辑工程导出 v2，2026-09-24 拆出 export-project.jsx）**：七目标点一行就导出，
      加「算法元素」三选一（转成视频素材 / 连有损属性也转 / 放弃）与导出后的三档回执
      （原生 / 烘焙 / 放弃），扩展名与烘焙格式表下沉 `model-export.js` 的 `PROJECT_TARGETS`。
      见 docs/design/editor/bcut-editable-export-v2-design.md §3 / §8。

   算的东西全在 `model-export.js`（清单 / 覆盖 / 差异 / 范围 / 预估 / 命名 / 任务文案 /
   工程目标与三档回执），这里只画和接事件。 */
(function () {
  const {useState, useEffect, useMemo, useRef} = React;
  const D = window.BC_DATA;
  const X = window.BC_EXPORT;
  const DUB = window.BC_DUB;
  const TL = window.BC_TL;
  const T = window.BC_TIME;

  /* 演示口径：缺译的句数。真实实现从 transcript 的 `trans` 稀疏表现数（§17.1 M122：
     缺译回退到原文必须在导出前可见）。 */
  const TRANS_GAPS = 3;
  const DEMO_MIN_MS = 9000;   // 演示里一次导出至少跑这么久——不然「取消」根本来不及点

  /* ---------- 从编辑器状态派生导出清单（与时间轴同一次 `TL.rows`） ---------- */
  function lanesOf(ctx) {
    const hiddenEls = {};
    Object.keys(ctx.elDocs || {}).forEach((id) => { if (ctx.elDocs[id] && ctx.elDocs[id].hidden) hiddenEls[id] = true; });
    const {rows} = TL.rows(ctx.elements, {subTracks: ctx.subStyle.tracks, textMembers: D.textGroup.members,
      audio: ctx.hasAudio, music: ctx.hasMusic, mainAudio: ctx.audioProject,
      hiddenEls, audioMuted: ctx.muted, musicMuted: ctx.musicMuted,
      dubs: ctx.dubs, dubOff: ctx.dubOff, bedOff: ctx.bedOff, score: ctx.score, scoreOff: ctx.scoreOff});
    return X.lanes(rows, {hiddenEls, muted: ctx.muted, musicMuted: ctx.musicMuted, dubOff: ctx.dubOff, bedOff: ctx.bedOff});
  }
  const baseName = (proj) => String((proj.src && proj.src.name) || proj.title || 'export').replace(/\.[a-z0-9]+$/i, '');

  /* ---------- 推进器：导出任务的进度只存任务记录一份 ----------
     挂在 App 根上（main.jsx），不挂编辑器：离开编辑器去后台任务页看进度，它得照走。
     一次推进所有在跑的导出（不同项目可以各导各的）。Agent 会话里起的导出不归它推：那些由 store-agent-sim.jsx 推进。 */
  function useExportRunner(app) {
    const jobs = app.tasks.filter((t) => t.kind === 'export' && t.status === 'running' && t.pct < 100 && t.source !== 'agent');
    const key = jobs.map((j) => j.id).join(',');
    useEffect(() => {
      if (!jobs.length) return;
      const tick = 200;
      const id = setInterval(() => jobs.forEach((job) => {
        const t = app.tasks.find((x) => x.id === job.id);
        if (!t || t.status !== 'running') return;
        /* 下载字体（product-design §5.9）：视频用到的字体还在下载时先等；等完了（或没取到）照常准备，
           没取到的照回退字体画，记进任务（完成页与结果里各一句） */
        if (t.preparePhase === 'prepare-fonts') {
          const F = window.BC_FONTSTORE.get();
          const wait = (t.fontsWait || []).map((n) => F.byName[n]).filter((f) => f && f.state === 'downloading');
          if (wait.length) {
            const detail = wait[0].family + ' ' + window.BC_FONTLIB.progressText(wait[0].progress);
            app.patchTask(t.id, {prepareElapsedMs: (t.prepareElapsedMs || 0) + tick, prepareDetail: detail, phase: '下载字体 · ' + detail});
          } else {
            app.patchTask(t.id, {preparePhase: 'prepare-project', prepareElapsedMs: 0, prepareDetail: null,
              fontFallbacks: window.BC_FONTSTORE.exportFallbacks(t.project)});
          }
          return;
        }
        if (X.preparationView(t).active) {
          const elapsed = (t.prepareElapsedMs || 0) + tick;
          const phase = elapsed < 400 ? 'prepare-project' : elapsed < 700 ? 'prepare-media'
            : elapsed < 3500 ? 'prepare-timeline' : elapsed < 4000 ? 'prepare-overlays' : null;
          const preparing = X.preparationView({...t, preparePhase: phase, prepareElapsedMs: elapsed});
          app.patchTask(t.id, {preparePhase: phase, prepareElapsedMs: elapsed,
            phase: preparing.active ? preparing.label + ' · 已用 ' + preparing.seconds + ' 秒' : '编码中'});
          return;
        }
        const total = Math.max(DEMO_MIN_MS, t.etaMs || 0);
        // 从 pctFine 续算：pct 是取整给胶囊看的，27 秒的片子每 tick 只走 0.7%，用它续会卡在 0
        const cur = t.pctFine != null ? t.pctFine : (t.pct || 0);
        const next = Math.min(100, +(cur + 100 * tick / total).toFixed(1));
        const left = Math.max(0, total * (1 - next / 100));
        // 帧率按「已走帧数 / 已走秒数」现算：4K 慢、720p 快，与预估一致
        const fps = t.frames && !t.via ? Math.round(t.frames / (total / 1000)) : 0;   // 远端的帧率这边量不到，不编
        // 任务卡的芯片念「编码中 · 剩余 18 秒 · 230 fps · 31%」：速度与剩余两样都要，
        // 与导出弹层的读数行同一组数；音频没有帧，不写 fps
        // 远端导出（J4）：前一截是上传素材，之后是那台机器在编码
        const uploading = t.via && next < (t.uploadShare || 0) * 100;
        app.patchTask(t.id, {pct: Math.floor(next), pctFine: next, leftMs: left, fps,
          phase: uploading ? '上传素材到 ' + t.via + ' · 剩余 ' + X.fmtEta(left).replace('≈ ', '')
            : (t.via ? '在 ' + t.via + ' 上' : '') + (t.exportTab === 'audio' ? '混音中 · 剩余 ' : '编码中 · 剩余 ') + X.fmtEta(left).replace('≈ ', '')
            + (fps ? ' · ' + fps + ' fps' : '')});
        if (next >= 100) {
          app.patchTask(t.id, {pct: 100, pctFine: 100, status: 'done', outcome: 'done', phase: null, leftMs: 0,
            artifacts: [{name: t.file, note: t.size}]});
          app.toast('导出完成 · ' + t.file, 'positive', {label: '在文件夹中显示', run: () => {}});
        }
      }), tick);
      return () => clearInterval(id);
    }, [key, app.tasks]);
  }

  /* ---------- 清单一行 ---------- */
  function Lane({lane, eff, onToggle, expanded, onExpand, children}) {
    const icon = lane.kind === 'subs' ? 'captions' : lane.kind === 'els' ? 'layers'
      : lane.kind === 'music' || lane.kind === 'bed' || lane.kind === 'score' ? 'audio' : lane.kind === 'dub' ? 'wave' : 'vol2';
    const grp = lane.kind === 'els';
    const n = grp ? eff.items.filter((i) => i.on).length : 0;
    return (
      <>
        <div className={cx('xlane', !eff.on && 'is-off')}>
          {grp
            ? <BCAction type="button" className={cx('xlane__exp', expanded && 'is-open')} onClick={onExpand}
                aria-label={expanded ? '收起元素清单' : '展开元素清单'}>
                <Ic n="chevright" className="ic--14" />
              </BCAction>
            : <Ic n={icon} className="ic--16 xlane__ic" />}
          <div className="xlane__nm">
            <b>{lane.label}{grp ? <span className="xlane__cnt">{n}/{eff.items.length} 开</span> : null}</b>
            <span>{grp ? (expanded ? '逐件开关' : '贴纸 / 图片 / 文字等画面上的东西') : lane.sub}</span>
          </div>
          <Switch ariaLabel={lane.label} on={eff.on} onChange={(v) => onToggle(v)} />
        </div>
        {grp && expanded ? children : null}
      </>
    );
  }

  /* ---------- 弹层 ---------- */
  function ExportPopover({ctx, onClose}) {
    const app = useApp();
    const proj = ctx.proj;
    /* 重开弹层时落在正在跑的那条导出起自哪一页（没有在跑的就是视频页） */
    const [tab, setTab] = useState(() => {
      const t = app.taskFor(proj.id, 'export');
      return (t && t.exportTab) || 'video';
    });
    const [ov, setOv] = useState({});                       // 这次导出的覆盖表
    const [expanded, setExpanded] = useState(false);
    /* 分辨率：null = 还没挑过，跟着原始分辨率走（画幅一变源短边会缩，挑过的档也会跟着夹）。 */
    const [resPick, setResPick] = useState(null);
    const [resOpen, setResOpen] = useState(false);
    const [ratio, setRatio] = useState(ctx.ratio === 'Original' ? '16:9' : ctx.ratio);
    const [ratioOpen, setRatioOpen] = useState(false);
    const [quality, setQuality] = useState('standard');
    /* 用哪台电脑导出（远端任务 J4）：只在有远端算力的表面（App）、且有在线节点开放「导出视频」时才画 */
    const [viaPick, setViaPick] = useState(null);
    const [viaOpen, setViaOpen] = useState(false);
    /* 范围（第 239 轮）：初值整片；切到按章节时默认勾播放头所在的那一章，按片段默认勾
       选中的那段（没选就播放头所在的），自定义初值是整片——把手一拖就缩。
       「片段」= 时间轴上的视频元素（2026-09-16，`X.videoSegments`），没有主轨 clip 表。 */
    const segs = useMemo(() => X.videoSegments(ctx.elements, ctx.elDocs), [ctx.elements, ctx.elDocs]);
    const [range, setRange] = useState(() => ({
      mode: 'all', chIds: [X.defaultChapter(ctx.chapters, ctx.playT)].filter(Boolean),
      clipIds: [X.defaultRange(segs, ctx.sels, ctx.playT)].filter(Boolean),
      custom: {start: 0, end: ctx.duration}, each: false,
    }));
    const [pvT, setPvT] = useState(ctx.playT || 0);            // 预览此刻停在哪（范围的「取此刻」用）
    const [pvSeek, setPvSeek] = useState(null);                // 修剪条拖把手 → 预览停过去（只动预览）
    const [fmt, setFmt] = useState('srt');
    const [merge, setMerge] = useState(true);
    /* 配音声道（2026-09-13，§17.1）：有配音时多一档——「一条声道」把选中的那种语言混进主声道，
       「每种一条」按 MP4 多音轨写进去，原声第一条、各配音各一条，播放器里可切。
       null = 没挑过，跟着 `DUB.dubModeDefault`（一种语言默认一条声道，多种默认每种一条）。 */
    const [dubMode, setDubMode] = useState(null);
    const [dubPick, setDubPick] = useState(null);
    const [dubOpen, setDubOpen] = useState(false);
    /* 这一次弹层开着期间关心的那条任务：点「导出」时记下 id，跑完 / 取消后弹层
       跟着切到完成态；重开弹层时若项目里正有一条在跑，直接接管它并落在**起它的那个页签**。
       这条任务只属于起它的页签：页签栏始终在，进行 / 完成 / 取消态只替换那一页的正文，
       切到别的页仍是设置态，可以边导视频边导音频、字幕、文稿。 */
    const running = app.taskFor(proj.id, 'export');
    const [watch, setWatch] = useState(running ? running.id : null);
    const [watchTab, setWatchTab] = useState(running ? (running.exportTab || 'video') : 'video');
    const watched = watch ? app.tasks.find((t) => t.id === watch) : null;

    const lanes = useMemo(() => lanesOf(ctx), [ctx.elements, ctx.elDocs, ctx.subStyle, ctx.muted, ctx.musicMuted, ctx.dubs, ctx.dubOff, ctx.bedOff, ctx.score, ctx.scoreOff]);
    const eff = X.apply(lanes, ov);
    const diff = X.syncWrites(lanes, ov);
    const span = X.spanOf(range.mode, {chapters: ctx.chapters, clips: segs,
      ids: range.mode === 'chapters' ? range.chIds : range.clipIds, custom: range.custom, dur: ctx.duration});
    /* 原始分辨率 = 源短边，按**当前画幅裁完**再算（竖幅源导 16:9 的原始是 1080×608）。
       多个视频源取最高：转录源与时间轴上可见的视频元素各自裁完量短边取最大（2026-09-13；
       2026-09-16 起转录源尺寸未知也从视频元素取）。一个尺寸都探不到（纯音频项目）→ null：
       按 1080 兜底，也没有哪一项配得上「原始」那个标注。 */
    const videoRes = (ctx.elements || [])
      .filter((e) => e.kind === 'video' && e.res && !(ctx.elDocs && ctx.elDocs[e.id] && ctx.elDocs[e.id].hidden))
      .map((e) => e.res);
    const srcShort = ctx.audioProject ? null : X.exportShort(proj.src && proj.src.res, videoRes, ratio);
    const resList = X.resChoices(srcShort);
    const res = X.resolveShort(resPick, srcShort);
    const est = X.estimate(res, ratio, span.dur, quality);
    const dubLanes = DUB.dubLanes(eff);
    const dMode = dubMode || DUB.dubModeDefault(eff);
    const dPick = dubPick && dubLanes.some((l) => l.id === dubPick) ? dubPick : (dubLanes[0] ? dubLanes[0].id : null);
    const dubTracks = DUB.audioTracks(eff, dMode, dPick);
    const parts = X.summary(eff, {span, dims: est.dims}).map((p) => (/配音$/.test(p) ? DUB.dubExportPart(eff, dMode, dPick) : p));
    const base = baseName(proj);
    const files = X.spanFiles(base, eff, span, range.each);
    const file = files[0];
    const transOn = eff.some((l) => l.kind === 'subs' && l.role !== 'source' && l.on);
    const ratios = D.ratios.filter((r) => r !== 'Original');
    /* 响度标准化（剧情短片 §5.3，export-loudness.jsx）：视频页与音频页共用这一份，缺省关 */
    const [loud, setLoud] = useState(window.BC_LOUD.DEFAULT);
    /* 光速修正只在有它的表面（App）、且没开响度时走——响度要整片量一遍 */
    const SV = window.BC_SERVICES;
    const viaPeers = window.BC_SURFACE.remote ? SV.nodesOffering(D.remote.paired, 'export') : [];
    const via = viaPeers.length ? SV.nodeOffering(D.remote.paired, viaPick, 'export') : null;
    const rest = via ? X.remoteEstimate(est.ms, X.uploadBytes({duration: ctx.duration}), via.exportSpeed) : null;
    /* 光速修正只在本机：远端那边没有上一次的渲染缓存 */
    const flash = !via && !!window.BC_SURFACE.flashFix && window.BC_LOUD.allowsFlash(loud)
      && app.tasks.some((t) => t.kind === 'export' && t.project === proj.id && t.status === 'done' && t.id !== watch);

    const setLane = (key, on) => setOv((o) => Object.assign({}, o, {[key]: on}));

    /* ---- Shorts（2026-09-27，设计稿 bcut-shorts-design §5.6 / §6.3，export-shorts.jsx） ----
       发布前检查只在导出画幅是 9:16 或项目按 Shorts 交付时露出；「Shorts 快捷设置」视频页常驻。
       封面另存（第 0 帧 PNG）是这一套里唯一的新选项，按 Shorts 交付的项目缺省勾上。 */
    const SH = window.BC_SHORTS;
    const showCheck = SH.checkVisible(ratio, proj);
    const [cover, setCover] = useState(() => SH.isShorts(proj));
    const srcLane = eff.find((l) => l.kind === 'subs' && l.role === 'source') || eff.find((l) => l.kind === 'subs');
    const presetOn = SH.presetMatches({ratio, resPick, subsOn: !!(srcLane && srcLane.on), cover});
    const applyShorts = () => {
      setRatio(SH.EXPORT_PRESET.ratio);
      setResPick(SH.EXPORT_PRESET.short);
      setOv((o) => SH.presetOverrides(lanes, o));
      setCover(true);
    };
    const coverFile = showCheck && cover ? SH.coverName(base) : null;
    const lanesRef = useRef(null), loudRef = useRef(null), rangeRef = useRef(null);
    const reveal = (r) => { if (r.current) r.current.scrollIntoView({block: 'nearest', behavior: 'smooth'}); };
    /* 点一行跳到对应的地方：时间 → 预览停过去；画幅 → 打开画幅菜单；时长 → 范围；字幕烧入 → 右栏清单；
       响度 → 响度那一段；越界的字幕 / 文字 → 关掉弹层、选中它、开它的属性页（同舞台上点字幕那一下）。 */
    const jumpCheck = (row) => {
      const p = row.pointer || {};
      if (p.kind === 'time') setPvSeek((q) => ({t: p.t, n: (q ? q.n : 0) + 1}));
      else if (p.kind === 'ratio') setRatioOpen(true);
      else if (p.kind === 'range') reveal(rangeRef);
      else if (p.kind === 'lanes') reveal(lanesRef);
      else if (p.kind === 'loud') reveal(loudRef);
      else if (p.kind === 'subs') {
        onClose();
        ctx.pick({kind: 'subs', trackId: p.trackId});
        ctx.setTab('subtitle');
        ctx.setPaneHidden(false);
        ctx.setPaneView('subprops');
      } else if (p.kind === 'element') {
        const el = (ctx.elements || []).find((e) => e.id === p.id);
        onClose();
        if (row.at != null && ctx.seek) ctx.seek(row.at);
        if (el) ctx.pick({kind: 'element', id: el.id, elKind: el.kind});
      }
    };
    const syncBack = () => {
      const writes = diff.slice();
      writes.forEach((w) => ctx.setLaneOn({kind: w.kind, id: w.id}, w.on, {quiet: true}));
      setOv({});
      app.toast('已把这次的取舍写回时间轴 · ' + writes.length + ' 处', 'positive',
        {label: '撤销', undo: true, run: () => writes.forEach((w) => ctx.setLaneOn({kind: w.kind, id: w.id}, !w.on, {quiet: true}))});
    };

    const startVideo = () => {
      /* 字体（product-design §5.9）：在下载的导出先等，没下载的（自动下载开着）现在开始下；用到的下载字体钉住到导出结束 */
      const FS = window.BC_SURFACE.fontDownloads && !via ? window.BC_FONTSTORE : null;
      const fonts = FS ? FS.beginExport(proj.id) : {wait: [], pins: []};
      const id = app.addTask({
        kind: 'export', exportTab: 'video', project: proj.id, title: '导出 · ' + proj.title,
        sub: X.taskSub(eff, {span, dims: est.dims}) + (loud.on ? ' · 响度 ' + window.BC_LOUD.fmtDb(loud.lufs) + ' LUFS' : '') + (via ? ' · 在 ' + via.name + ' 上导出' : ''),
        phase: via ? '上传素材到 ' + via.name : '读取视频', cancellable: true, source: 'app',
        preparePhase: via ? null : fonts.wait.length ? 'prepare-fonts' : 'prepare-project', prepareElapsedMs: 0,
        fontsWait: fonts.wait, fontPins: fonts.pins, fontFallbacks: FS && !fonts.wait.length ? FS.exportFallbacks(proj.id) : [],
        etaMs: rest ? rest.totalMs : est.ms, frames: est.frames, file: files.length > 1 ? files.length + ' 个文件' : file, size: est.size, flash,
        via: via ? via.name : null, uploadShare: rest ? rest.uploadShare : 0,
        ...(coverFile ? {cover: coverFile} : {}),
      });
      setWatch(id);
      setWatchTab('video');
    };
    /* 音频导出走同一条路：一条 `export` 任务、同一处取消、同一个完成态；
       只是没有帧数与光速修正（没有画面可重渲），进度按音频自己的耗时估推。 */
    const startAudio = (spec) => {
      const id = app.addTask(Object.assign({
        kind: 'export', exportTab: 'audio', project: proj.id, title: '导出音频 · ' + proj.title,
        phase: '混音中', cancellable: true, source: 'app',
      }, spec));
      setWatch(id);
      setWatchTab('audio');
    };
    const startSubs = () => {
      const names = X.subtitleNames(base, eff, fmt, merge);
      if (!names.length) return;
      app.toast('已导出 ' + names.join('、'), 'positive', {label: '在文件夹中显示', run: () => {}});
      onClose();
    };

    /* ---- 运行态 / 完成态 / 取消态 ---- */
    const view = tab !== watchTab || !watched ? 'setup'
      : watched.status === 'running' || watched.status === 'queued' ? 'run'
      : watched.outcome === 'canceled' ? 'canceled' : 'done';

    return (
      <Popover open padding="none" label="导出" onClose={onClose} align="right" width={tab === 'video' ? 660 : 420}>
      <div className="xpop bc-export-popover">
        <div className="xhead">
          <b>导出</b>
          <Segmented size="s" value={tab} onChange={setTab} className="push"
            items={[{k: 'video', label: '视频'}, {k: 'audio', label: '音频'}, {k: 'subs', label: '字幕'},
              {k: 'tx', label: '文稿'}, {k: 'proj', label: '工程'}]} />
        </div>
        {view === 'run' ? (
          <>
            <div className="xhead">
              <b>{X.preparationView(watched).active ? '正在准备导出' : watched.via ? (watched.pctFine || 0) < (watched.uploadShare || 0) * 100 ? '正在上传素材到 ' + watched.via : '正在 ' + watched.via + ' 上导出' : '正在导出'}</b>
              <span className="t-detail t-truncate push">{watched.file}</span>
            </div>
            {X.preparationView(watched).active ? <Progress indeterminate thin />
              : <div className="xbar"><i style={{width: (watched.pctFine || watched.pct || 0) + '%'}} /></div>}
            <div className="xrun">
              {X.preparationView(watched).active
                ? <span>{X.preparationView(watched).label} · 已用 {X.preparationView(watched).seconds} 秒</span>
                : <>
              <b className="t-mono">{watched.pct}%</b>
              <span>剩余 {X.fmtEta(watched.leftMs || 0)}</span>
              {watched.fps ? <span className="t-mono">{watched.fps} fps</span> : null}
                </>}
            </div>
            {X.preparationView(watched).active ? <div className="xnote">导出已开始，准备完成后进入视频编码。</div> : null}
            <div className="xnote">{watched.sub}</div>
            {watched.flash
              ? <div className="xflash"><Ic n="sparkle" className="ic--14" />光速修正 · 只重渲改过的区间，其余直通</div>
              : null}
            {/* 没有「后台继续」这颗按钮：关掉弹层它本来就在后台跑，顶栏按钮与后台任务页
                都读同一条记录；这里只留一条去处和「取消」 */}
            <div className="xacts xacts--between">
              {/* Web 表面没有后台任务页（model-surface.js）：进度读顶栏那颗「导出中 · N%」 */}
              {window.BC_SURFACE.pages
                ? <span className="t-detail">关掉这个窗口也会继续导出 ·{' '}
                    <BCAction type="button" className="xlink" onClick={() => { onClose(); app.go({r: 'task', id: watched.id}); }}>去后台任务</BCAction>
                  </span>
                : <span className="t-detail">关掉这个窗口也会继续导出 · 顶栏的导出按钮会显示进度</span>}
              <Btn variant="negative" onClick={() => app.cancelTask(watched)}>取消导出</Btn>
            </div>
          </>
        ) : view === 'done' ? (
          <>
            <div className="xdone">
              <div className="ok"><Ic n="check" className="ic--22" /></div>
              <b>已导出</b>
              <span>{watched.file} · {watched.size}</span>
            </div>
            {watched.fontFallbacks && watched.fontFallbacks.length ? (
              <div className="xnote fontlib__xnote fontlib__xnote--notice">
                <Ic n="alert" className="ic--14" />
                <span className="grow">{watched.fontFallbacks.map((f) => '「' + f.family + '」用「' + f.fallback + '」代替 · ' + f.reason).join('；')}</span>
              </div>
            ) : null}
            <div className="xacts">
              <Btn variant="quiet" onClick={() => setWatch(null)}>再导一份</Btn>
              <Btn variant="secondary" onClick={() => app.toast('已在文件夹中显示')}>在文件夹中显示</Btn>
              <Btn variant="accent" onClick={onClose}>完成</Btn>
            </div>
          </>
        ) : view === 'canceled' ? (
          <>
            <div className="xdone xdone--off">
              <div className="ok"><Ic n="close" className="ic--22" /></div>
              <b>已取消导出</b>
              <span>半成品文件已删掉 · 视频不受影响</span>
            </div>
            <div className="xacts">
              <Btn variant="secondary" onClick={onClose}>关闭</Btn>
              <Btn variant="accent" onClick={() => setWatch(null)}>重新设置</Btn>
            </div>
          </>
        ) : (
          <>
            {tab === 'video' ? (
              <>
                {showCheck ? <window.ExportShortsCheck ctx={ctx} ratio={ratio} span={span} eff={eff} app={app} onJump={jumpCheck} /> : null}
                <window.ExportFontNote projectId={proj.id} />
                <div className="xcols">
                <div className="xcol xcol--l">
                {/* 导出出去是什么样（第 120.1 轮）：随右栏开关与画幅裁切一起动，见 export-preview.jsx */}
                <window.ExportPreview ctx={ctx} eff={eff} ratio={ratio} span={span} onTime={setPvT} seek={pvSeek} />
                <div ref={rangeRef} />
                <window.ExportRange ctx={ctx} range={range} setRange={setRange} span={span} pt={pvT}
                  onSeek={(t) => setPvSeek((q) => ({t, n: (q ? q.n : 0) + 1}))} />

                <div className="cpsec">画质与体积</div>
                <window.ExportShortsPreset matched={presetOn} onApply={applyShorts} res={res} />
                <div className="xquick">
                  <div className="xquick__f">
                    <span className="xquick__lb">分辨率</span>
                    <Picker size="s" value={X.resLabel(res) + ' · ' + est.dims.w + '×' + est.dims.h} open={resOpen}
                      onClick={() => setResOpen((v) => !v)} onClose={() => setResOpen(false)} popWidth={240}>
                      <Menu>
                        {resList.map((c) => {
                          const e = X.estimate(c.short, ratio, span.dur, quality);
                          return <MenuItem key={c.short} label={c.label + ' · ' + e.dims.w + '×' + e.dims.h} on={c.short === res}
                            sub={(c.source ? '原始分辨率 · ' : '') + e.eta + ' · 约 ' + e.size}
                            onClick={() => { setResPick(c.short); setResOpen(false); }} />;
                        })}
                      </Menu>
                    </Picker>
                  </div>
                  <div className="xquick__f">
                    <span className="xquick__lb">画幅</span>
                    <Picker size="s" value={ratio} open={ratioOpen} onClick={() => setRatioOpen((v) => !v)}
                      onClose={() => setRatioOpen(false)} popWidth={160} popAlign="right">
                      <Menu>
                        {ratios.map((r) => <MenuItem key={r} label={r} on={r === ratio}
                          sub={r === (ctx.ratio === 'Original' ? '16:9' : ctx.ratio) ? '视频当前画幅' : null}
                          onClick={() => { setRatio(r); setRatioOpen(false); }} />)}
                      </Menu>
                    </Picker>
                  </div>
                  <div className="xquick__f">
                    <span className="xquick__lb">体积</span>
                    <Segmented size="s" value={quality} onChange={setQuality}
                      items={X.QUALITY_KEYS.map((k) => ({k, label: X.QUALITY[k].label}))} />
                  </div>
                </div>
                {srcShort ? <div className="xnote">分辨率最高到原始 {X.resLabel(srcShort)} · 往上只是放大，画面不会更清楚</div> : null}
                <div className="xnote">{X.QUALITY[quality].note ? X.QUALITY[quality].note + ' · ' : ''}码率 {est.mbps} Mb/s · 只改体积不改耗时</div>
                {ratio !== (ctx.ratio === 'Original' ? '16:9' : ctx.ratio)
                  ? <div className="xnote">按 {ratio} 居中裁一版出去 · 视频里的画面不变{ctx.ratioLock ? ` · 模板「${ctx.ratioLock.name}」锁的是视频画幅，不管这里` : ''}</div>
                  : ctx.ratioLock
                    ? <div className="xnote">视频画幅由模板「{ctx.ratioLock.name}」锁定 · 这里换一档只是裁一版出去</div>
                    : null}

                {showCheck ? (
                  <Checkbox className="xcover" on={cover} onChange={setCover} label="另存封面（第 0 帧 PNG）" />
                ) : null}

                {viaPeers.length ? (
                  <>
                    <div className="xquick" style={{marginTop: 8}}>
                      <div className="xquick__f">
                        <span className="xquick__lb">用哪台电脑导出</span>
                        <Picker size="s" value={via ? via.name : '这台 Mac'} open={viaOpen} popWidth={280}
                          onClick={() => setViaOpen((v) => !v)} onClose={() => setViaOpen(false)}>
                          <Menu>
                            <MenuItem label="这台 Mac" sub={'本机导出 ' + est.eta} on={!via} onClick={() => { setViaPick(null); setViaOpen(false); }} />
                            {viaPeers.map((n) => {
                              const r = X.remoteEstimate(est.ms, X.uploadBytes({duration: ctx.duration}), n.exportSpeed);
                              return <MenuItem key={n.id} label={n.name} sub={'局域网里的另一台电脑 · 合计 ' + X.fmtEta(r.totalMs)} on={!!via && via.id === n.id}
                                onClick={() => { setViaPick(n.id); setViaOpen(false); }} />;
                            })}
                          </Menu>
                        </Picker>
                      </div>
                    </div>
                    {via ? <div className={cx('xnote', !rest.faster && 'xnote--warn')}>{X.remoteNote(via.name, rest, est.ms)}</div> : null}
                    {via ? <div className="xnote">素材按内容缓存在那台机器上 24 小时，再导一次只传改过的 · MP4 传回后存到同一个位置 · 远端导出没有光速修正</div> : null}
                  </>
                ) : null}

                <div ref={loudRef} />
                <window.ExportLoudness value={loud} onChange={setLoud} />

                <div className="xsum">
                  <div className="xsum__row"><span>将导出</span><b>{parts.concat(loud.on ? ['响度 ' + window.BC_LOUD.fmtDb(loud.lufs) + ' LUFS'] : []).join(' · ')}</b></div>
                  {files.map((f) => <div key={f} className="xsum__row"><span>文件</span><b className="t-mono">{f}</b></div>)}
                  {coverFile ? <div className="xsum__row"><span>封面</span><b className="t-mono">{coverFile}</b></div> : null}
                  <div className="xsum__row"><span>预计</span><b>{span.empty ? '—' : (rest ? X.fmtEta(rest.totalMs) + ' · 在 ' + via.name + ' 上' : est.eta) + ' · 约 ' + est.size}</b></div>
                </div>
                </div>
                <div className="xcol xcol--r">
                <div className="cpsec" ref={lanesRef}>画面里有什么</div>
                <div className="xlanes">
                  {lanes.map((l, n) => (
                    <Lane key={l.key} lane={l} eff={eff[n]} expanded={expanded} onExpand={() => setExpanded((v) => !v)}
                      onToggle={(v) => (l.kind === 'els' ? setOv((o) => X.setGroup(lanes, o, v)) : setLane(l.key, v))}>
                      {l.kind === 'els' ? l.items.map((it, k) => (
                        <div key={it.key} className={cx('xlane xlane--sub', !eff[n].items[k].on && 'is-off')}>
                          <Ic n={it.icon || 'layers'} className="ic--14 xlane__ic" />
                          <div className="xlane__nm"><b>{it.label}</b></div>
                          <Switch ariaLabel={it.label} on={eff[n].items[k].on} onChange={(v) => setLane(it.key, v)} />
                        </div>
                      )) : null}
                    </Lane>
                  ))}
                </div>
                {dubLanes.length ? (
                  <>
                    <div className="cpsec">配音声道</div>
                    <Segmented size="s" value={dMode} onChange={setDubMode}
                      items={[{k: 'one', label: '一条声道'}, {k: 'multi', label: '每种一条'}]} />
                    {dMode === 'one' && dubLanes.length > 1 ? (
                      <Picker label="混进主声道的" value={dubLanes.find((l) => l.id === dPick).label} size="s" open={dubOpen}
                        onClick={() => setDubOpen((v) => !v)} onClose={() => setDubOpen(false)} popWidth={220}>
                        {dubLanes.map((l) => <MenuItem key={l.id} label={l.label} check={l.id === dPick}
                          onClick={() => { setDubPick(l.id); setDubOpen(false); }} />)}
                      </Picker>
                    ) : null}
                    <div className="xdub">
                      {dubTracks.map((t, n) => (
                        <div key={t.key} className="xdub__i">
                          <span className="xdub__n">{dMode === 'multi' ? n + 1 : ''}</span>
                          <Ic n="wave" className="ic--14" />
                          <b className="grow t-truncate">{t.label}</b>
                          <span>{t.sub}</span>
                          {t.dflt ? <Chip>默认</Chip> : null}
                        </div>
                      ))}
                    </div>
                    <div className="xnote">{dMode === 'multi'
                      ? '写成 MP4 多音轨 · 播放器里按语言切 · 上面关掉的配音不进文件'
                      : '译文配音替掉原声人声混成一条 · 背景声照留 · 别的语言不进文件'}</div>
                  </>
                ) : null}
                {diff.length
                  ? <div className="xnote xnote--row">
                      <span>{diff.length} 处与时间轴不同 · 只对这次导出生效</span>
                      <BCAction type="button" className="xlink" onClick={syncBack}>同步到时间轴</BCAction>
                    </div>
                  : <div className="xnote">开关取自时间轴上的启停 · 这里改只对这次导出生效</div>}
                {transOn
                  ? <div className="xwarn"><Ic n="alert" className="ic--14" />
                      <span>译文还有 {TRANS_GAPS} 句没译 · 这几句会按原文烧进去，导出前可先补译</span></div>
                  : null}
                </div>
                </div>
                <div className="xacts">
                  <Btn variant="secondary" onClick={onClose}>取消</Btn>
                  <Btn variant="accent" icon="export" disabled={span.empty} onClick={startVideo}>导出 MP4</Btn>
                </div>
              </>
            ) : tab === 'audio' ? (
              <window.ExportAudio ctx={ctx} base={base} lanes={lanes} eff={eff} diff={diff} setLane={setLane}
                setOv={setOv} syncBack={syncBack} range={range} setRange={setRange} span={span}
                loud={loud} setLoud={setLoud} onClose={onClose} onStart={startAudio} />
            ) : tab === 'subs' ? (
              <>
                <div className="cpsec">导哪几条</div>
                <div className="xlanes">
                  {lanes.filter((l) => l.kind === 'subs').map((l) => {
                    const e = eff.find((x) => x.key === l.key);
                    return (
                      <div key={l.key} className={cx('xlane', !e.on && 'is-off')}>
                        <Ic n="captions" className="ic--16 xlane__ic" />
                        <div className="xlane__nm"><b>{l.label}</b><span>{l.sub}{l.on ? '' : ' · 时间轴上停用中'}</span></div>
                        <Switch ariaLabel={l.label} on={e.on} onChange={(v) => setLane(l.key, v)} />
                      </div>
                    );
                  })}
                </div>
                <div className="xquick">
                  <div className="xquick__f">
                    <span className="xquick__lb">格式</span>
                    <Segmented size="s" value={fmt} onChange={setFmt} items={X.SUB_FORMATS.map((f) => ({k: f.k, label: f.label}))} />
                  </div>
                  {eff.filter((l) => l.kind === 'subs' && l.on).length > 1 ? (
                    <div className="xquick__f">
                      <span className="xquick__lb">多轨</span>
                      <Segmented size="s" value={merge ? 'one' : 'each'} onChange={(k) => setMerge(k === 'one')}
                        items={[{k: 'one', label: '合成一份'}, {k: 'each', label: '各出一份'}]} />
                    </div>
                  ) : null}
                </div>
                <div className="xnote">{(X.SUB_FORMATS.find((f) => f.k === fmt) || X.SUB_FORMATS[0]).note}</div>
                <div className="xsum">
                  {X.subtitleNames(base, eff, fmt, merge).map((n) => (
                    <div key={n} className="xsum__row"><span>文件</span><b className="t-mono">{n}</b></div>
                  ))}
                  {!X.subtitleNames(base, eff, fmt, merge).length
                    ? <div className="xsum__row"><span>文件</span><b>至少开一条字幕轨</b></div> : null}
                </div>
                <div className="xacts">
                  <Btn variant="secondary" onClick={onClose}>取消</Btn>
                  <Btn variant="accent" icon="export" disabled={!X.subtitleNames(base, eff, fmt, merge).length}
                    onClick={startSubs}>导出字幕</Btn>
                </div>
              </>
            ) : tab === 'tx' ? (
              <window.ExportTranscript ctx={ctx} base={base} onClose={onClose} />
            ) : (
              <window.ExportProject ctx={ctx} onClose={onClose} />
            )}
          </>
        )}
      </div></Popover>
    );
  }

  Object.assign(window, {ExportPopover, useExportRunner});
})();
