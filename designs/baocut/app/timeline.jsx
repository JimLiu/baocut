/* Timeline —— §12。章节进度条 · transport · 多轨 · 播放头贯穿标尺。
   横向几何一律走 BC_TL（纯模型，node --test 盯着）；这一层只负责画和接事件。

   元素行的手势与色板（第 39.2 轮补齐）：
     · 每类一套四色 `background / border / hover-border / text`，**选中边用的就是 hover 那档**
       ——选中的边直接取该类的 hover 边色，不是一个全局蓝；
     · 块宽 < 45px 只剩色块，不画图标与文字；
     · 两端裁剪手柄 ＋ 整条拖动，10px 吸附，吸中时出一条虚线参考线
       （播放头那条贯穿全高，元素缘那条只覆盖相关行）；
     · 入场 / 出场动画在条的头尾各占一小段色带，长度是 In/Out 的时长。
   前身画板把 trim / snapping / 多选一并记成「刻意不采纳」，理由是 `.dc.html` 不支持
   drag——换成 React 载体之后那条理由不存在了。 */
(function () {
  const {useState, useRef, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const TL = window.BC_TL;
  const T = window.BC_TIME;
  const S = window.BC_SUB;
  const SEL = window.BC_SELECT;
  /* 块与行在 `timeline-rows.jsx`（第 115 轮拆出去，这一份原本 671 行）——
     `BaoCut.html` 里它排在本文件之前，所以这里可以在 IIFE 顶上解构。 */
  const {ElementBlock, MemberBlock, SubsRow, AudioBlock, TemplateBlock} = window;
  /* 剪口带（空槽带 / 建议带，含拖两缘改范围）在 `timeline-cutbands.jsx`（2026-10-01 拆出），同样排在本文件之前 */
  const {CutBands} = window;
  const VE = window.BC_VIDEO_EDIT;
  const PL = window.BC_PLAYER;
  const PLAY_TIP = {play: '播放 · Space', pause: '暂停 · Space', replay: '重播'};

  /* ---------- 章节进度条（Mac ChapterScrubberView 形态） ---------- */
  /* 章节条按**成片时钟**画（第 197 轮）：章节区间与播放头都经 `tmap.fold` 折掉已剪段，
     点击反折回时间轴时钟；没传 `tmap` 时是恒等（Components 样本页等）。 */
  function ChapterBand({chapters, playT, seek, title, duration, tmap, clearSel}) {
    const [hover, setHover] = useState(-1);
    const ref = useRef(null);
    const fold = tmap ? tmap.fold : (t) => t, unfold = tmap ? tmap.unfold : (t) => t;
    const spans = TL.playbackSpans(chapters, duration, title)
      .map((c) => ({...c, start: fold(c.start), end: fold(c.end)})).filter((c) => c.end - c.start > 0.001);
    duration = fold(duration); playT = fold(playT);
    /* 章节条整条都是「舞台之外的空处」：按下即取消所有选中（第 215 轮），
       与标尺、轨道空白同一条规矩；段上的 seek 走 onClick，两者不冲突。 */
    return (
      <div className="chband" ref={ref} onMouseLeave={() => setHover(-1)}
        onMouseDown={() => { if (clearSel) clearSel(); }}>
        <div className="chbar">
          {spans.map((c, i) => {
            const span = c.end - c.start;
            const done = Math.max(0, Math.min(1, (playT - c.start) / span));
            return (
              <div key={c.id} className="chseg" style={{flex: span}}
                onMouseEnter={() => setHover(i)}
                onClick={(e) => {
                  if (!c.playbackOnly) { seek(unfold(c.start)); return; }
                  const r = e.currentTarget.getBoundingClientRect();
                  seek(unfold(((e.clientX - r.left) / Math.max(1, r.width)) * duration));
                }}>
                <div className="chseg__f" style={{width: done * 100 + '%'}} />
              </div>
            );
          })}
        </div>
        {hover >= 0 ? (() => {
          const c = spans[hover];
          const w = ref.current ? ref.current.clientWidth - 28 : 800;
          const mid = 14 + ((c.start + c.end) / 2 / Math.max(0.1, duration)) * w;
          const left = Math.max(8, Math.min((ref.current ? ref.current.clientWidth : 900) - 138, mid - 65));
          return (
            <div className="chprev" style={{left, top: 18}}>
              <div className="chprev__th" style={{background: `linear-gradient(135deg, oklch(0.7 0.1 ${spans[hover].start + 200}), oklch(0.5 0.12 ${spans[hover].end + 120}))`}} />
              <div className="chprev__m">
                <span className="t-mono t-detail-xs">{T.timecode(c.start, {decimals: 0})}</span>
                <span className="t-detail-xs t-truncate">{c.title}</span>
              </div>
            </div>
          );
        })() : null}
      </div>
    );
  }

  /* ---------- 缩放动作（菜单、± 钮与键盘共用这一处） ----------
     量泳道视口（`.tlbody` 的 clientWidth 减行头列）、把时间折到视图时钟，算式全在
     `BC_TL.zoomPlan`（纯模型，node --test 盯着）；这里只取数、写回、给提示。
     滚动偏移要等新的内容宽度渲染完才落得下去，所以走 `ctx.requestTlScroll`，
     由 `TimelineView` 的 layout effect 接。键盘入口读 ref 里的最新 ctx，在 editor-keys.jsx。 */
  function timelineZoom(ctx, k, toast) {
    const el = ctx.tlBodyRef && ctx.tlBodyRef.current;
    const viewportW = el ? el.clientWidth - TL.HEADS_W : 0;
    if (!(viewportW > TL.PAD * 2)) return;
    const view = ctx.tmap ? ctx.tmap.view : (t) => t;
    const st = {
      pxps: ctx.pxps, scroll: el.scrollLeft, viewportW, playVt: view(ctx.playT),
      viewDur: view(TL.displayDuration(ctx.duration, ctx.openEnded)),
    };
    if (k === 'fitclip') {
      /* 「适应当前片段」= 播放头下的那件视频元素（2026-09-16，没有主轨 clip 表） */
      const c = VE.splitTarget(ctx.elements, ctx.elDocs, ctx.playT, ctx.sel && ctx.sel.kind === 'element' ? ctx.sel.id : null);
      if (!c) return toast('把播放头移到一段视频内');
      st.span = {start: view(c.start), end: view(c.end)};
    } else if (k === 'fitsel') {
      /* 「适应所选」= 选中的那件元素的起止 */
      const c = ctx.sel && ctx.sel.kind === 'element' ? (ctx.elements || []).find((x) => x.id === ctx.sel.id) : null;
      if (!c) return toast('先在时间轴上选中一个元素');
      st.span = {start: view(c.start), end: view(c.end == null ? ctx.duration : c.end)};
    }
    const plan = TL.zoomPlan(k, st);
    if (!plan) return;
    ctx.setPxps(plan.pxps);
    ctx.requestTlScroll(plan.scroll);
  }

  /* ---------- transport（§12.3，W3 起在轨道之上） ---------- */
  function Transport({ctx, narrow}) {
    const app = useApp();
    const {playT, seek, playing, setPlaying, pxps, split, pop, setPop} = ctx;
    const toggle = (k) => setPop(pop === k ? null : k);
    const close = () => setPop(null);
    const zoom = (k) => { close(); timelineZoom(ctx, k, app.toast); };
    const out = ctx.tmap ? ctx.tmap.fold(playT) : playT;
    const play = PL.playButtonState({playing, out, dur: ctx.outDuration});
    return (
      <div className="tport">
        <div className="tport__side">
          {/* 第 115 轮接真栈：disabled 跟着 canUndo / canRedo 走（editor-history.jsx）。 */}
          <IconBtn icon="undo" size="s" className="ibtn--undo" tip="撤销 ⌘Z"
            disabled={!ctx.history.canUndo} onClick={() => ctx.history.undo()} />
          <IconBtn icon="redo" size="s" tip="重做 ⇧⌘Z"
            disabled={!ctx.history.canRedo} onClick={() => ctx.history.redo()} />
          <div className="vrule" style={{height: 18, margin: '0 4px'}} />
          {/* 分割切的是播放头下的视频元素（2026-09-16）：播放头下没有可切的视频就灰 */}
          <IconBtn icon="split" size="s" tip="在播放头分割 · S" disabled={!ctx.canSplit} onClick={() => split()} />
          {/* 删除走 Delete 键那一条（editor-keys.jsx `del`），灰不灰读同一份 `removeTarget`。
              文稿剪辑的选区与时间轴选中互斥（editor.jsx 一有选中就清掉 cutSel），所以只有
              剪辑选区时这里是灰的，剪字仍归文稿面板的「剪掉 ⌫」——不跨模式（product-design §5.7） */}
          <IconBtn icon="trash" size="s" tip="删除选中 · Delete" disabled={!SEL.removeTarget(ctx.sels, ctx.sel)}
            onClick={() => ctx.clipboard.remove()} />
        </div>

        <div className="tport__mid">
          <IconBtn icon="prev" size="s" tip="上一章" onClick={() => seek(TL.prevChapterStart(ctx.chapters, playT))} />
          {/* 播放键是这一条上唯一的主操作：S2 accent 36px 正圆钮，图标与其余按钮同为 16px（product-design §2.1）。
              三态判据与全屏播放器共用 `BC_PLAYER.playButtonState`，按成片时钟判片尾 */}
          <Tip label={PLAY_TIP[play]}>
            <window.RSP.Button variant="accent" size="M" aria-label={PLAY_TIP[play]} UNSAFE_className="tport__play"
              onPress={() => {
                if (play === 'replay') { seek(ctx.tmap ? ctx.tmap.unfold(0) : 0); setPlaying(true); }
                else setPlaying(!playing);
              }}>
              <Ic n={PL.PLAY_ICON[play]} />
            </window.RSP.Button>
          </Tip>
          <IconBtn icon="next" size="s" tip="下一章" onClick={() => seek(TL.nextChapterStart(ctx.chapters, playT))} />
        </div>

        <div className="tport__side tport__side--end">
          {narrow ? null : <>
            {/* 时间码报**成片时钟**（第 197 轮）：已剪段不占视频时间，播放头与总长都折掉它们；
                剪过东西时旁边多报一个源片长，提醒时间轴上还藏着缝（第 192 轮立，§12.6） */}
            <span className="t-mono t-detail tport__tc">{T.timecode(out)}<span className="tport__total"> / {T.timecode(ctx.outDuration)}</span></span>
            {ctx.outDuration < ctx.duration - 0.05
              ? <span className="t-detail tport__out">源片 {T.timecode(ctx.duration)}</span> : null}
            <div className="vrule" style={{height: 18, margin: '0 4px'}} />
          </>}
          {/* 第 200 轮的全局「剪辑」开关第 201 轮起挂在文稿面板头（panels.jsx::CutSwitch），
              transport 右簇不再放它；时间轴只读 ctx.cutMode 决定成片 / 源片形态。 */}
          <div style={{position: 'relative'}} className="row gap4">
            <IconBtn icon="zoomout" size="s" tip="缩小 ⌘−" onClick={() => zoom('out')} />
            {/* 标签宽度走 `.tport__zoomv`：100% 与 0.42% 之间按钮不跳 */}
            <BCAction className="stp__v tport__zoomv" style={{cursor: 'pointer'}} onClick={() => toggle('zoom')}>
              {TL.zoomLabel(pxps)}
            </BCAction>
            <IconBtn icon="zoomin" size="s" tip="放大 ⌘=" onClick={() => zoom('in')} />
            <Popover open={pop === 'zoom'} onClose={close} dir="up" align="right" width={210}>
              <Menu>
                {D.zoomMenu.map((z) => (
                  <MenuItem key={z.k} label={z.label} suffix={z.sk} onClick={() => zoom(z.k)} />
                ))}
              </Menu>
            </Popover>
          </div>
        </div>
      </div>
    );
  }


  /* ---------- 字幕行的行头菜单：拿下 / 放回（第 108 轮） ----------
     产品裁决：**文档只和 timeline 相关，timeline 上有什么字幕轨就显示什么**。所以
     「画面上是哪几条字幕」这件事的入口就该在这里——此前四个写入口（属性页页头那颗
     垃圾桶、字幕 / 翻译两个语言弹层、样式画廊的卡）没有一个在时间轴上，而时间轴是
     唯一把「现在有哪几条」一眼画全的地方：拿下一条，这一行当场就没了。

     行头只有 60px（`TL.HEADS_W`），所以菜单钮**平时不占位**：压在行名右端，
     hover 或菜单开着时才现身（`.thd__more`）。判据与 toast 走共用 hook
     （`subtrack.jsx`）——拒绝最后一条、放回第三条时问一次，与语言入口同一份。

     弹层不挂在行头里：`.tlbody` 是滚动区（`overflow: auto`），挂在里面的浮层会被
     裁成一条缝（实测只剩最下面那两行）。所以行头只报一个屏幕矩形上去，菜单由
     `TimelineView` 在 `.tl` 根上用一个 `position: fixed` 的 0 尺寸锚渲染。 */
  function SubsHead({row, open, onOpen, ctx}) {
    const track = row.track || {};
    /* 第 220 轮：转录中的行头挂一枚呼吸点——与文稿面板运行态头同一颗（`.livehd__dot` 的
       `bc-live`），告诉人「这条轨还在长」；百分比不写在 60px 的行头里，进 tip。 */
    const live = ctx.liveAt != null && ctx.liveJob;
    /* 第 243 轮：识别做完、进入保存阶段后不再呼吸（`BC_TX.liveSaving`；真实界面只在识别进行时画点）。 */
    const recognizing = live && !window.BC_TX.liveSaving(live);
    return (
      <>
        <Ic n="captions" className="ic--14" /><span className="thd__label" title={track.name || row.label}>{TL.headLabel(row)}</span>
        {recognizing ? <i className="thd__live" title={`转录中 ${Math.round(live.pct)}% · 已转录到 ${window.BC_TIME.timecode(ctx.liveAt, {decimals: 0})}`} /> : null}
        <LaneToggle row={row} ctx={ctx} className="thd__tog" />
        <IconBtn icon="more" size="xs" className="thd__more" on={open}
          tip={'「' + (track.name || '字幕') + '」这条轨'}
          onClick={(e) => {
            e.stopPropagation();
            if (open) { onOpen(null); return; }
            const r = e.currentTarget.closest('.trow__hd').getBoundingClientRect();
            onOpen({id: track.id, x: r.left, y: r.top, w: r.width, h: r.height});
          }} />
      </>
    );
  }

  /* 行头的启停开关（第 120 轮，§12.6）。字幕 / 元素行是一只眼睛，音频 / 音乐行是喇叭；
     hover 现身，关着的那一行**常显**——不然一条灰掉的行说不清是为什么灰的。
     真相不在这里：拧下去走 `ctx.setLaneOn`，字幕轨写 `track.hidden`、元素写
     `elDocs[id].hidden`、音频 / 音乐写两个 muted 位，导出弹层的清单读的是同一份。 */
  function LaneToggle({row, ctx, className}) {
    const sw = TL.laneSwitch(row);
    if (!sw || !ctx.setLaneOn) return null;
    const audio = sw.kind === 'audio' || sw.kind === 'music' || sw.kind === 'dub' || sw.kind === 'bed' || sw.kind === 'score';
    const icon = audio ? (row.off ? 'vol0' : 'vol2') : (row.off ? 'eyeoff' : 'eye');
    const name = TL.headLabel(row);
    /* 组里的背景声行（2026-09-14）：整组关着时它跟着灰，这只喇叭拧的是**组**——不然点亮了背景声、组还关着，
       什么都听不见。组开着时才拧它自己那一份 `bedOff[lang]`。 */
    const grp = row.grouped && row.groupOff ? {kind: 'dub', id: row.lang} : null;
    const tip = grp ? '整组已停用 · 启用「配音 · ' + ((row.dub || {}).langName || row.lang) + '」'
      : row.off ? '启用「' + name + '」'
      : '停用「' + name + '」 · ' + (sw.kind === 'dub' && row.group ? '连同它的背景声 · ' : '') + '画面与导出都跳过';
    /* 配乐轨的喇叭只在时间轴上关掉这一路，不改动画稿（剧情短片 §5.5）——说明挂在 tip 上 */
    const tipFull = sw.kind === 'score' ? tip + ' · ' + window.BC_SCORE.MUTE_NOTE : tip;
    return (
      <IconBtn icon={icon} size="xs" className={cx(className, row.off && 'is-off')}
        tip={tipFull}
        onClick={(e) => { e.stopPropagation(); ctx.setLaneOn(grp || sw, !!row.off); }} />
    );
  }

  function VideoMute({row, ctx}) {
    const list = TL.rowEls(row);
    const muted = list.length ? list.every((e) => !!e.muted) : !!ctx.muted;
    /* 有配音组时（2026-09-14）源片视频行不再带声音：它的原始声道整个剥到「原声」行去了（别的视频各有各的声音，不受影响），这里只留一枚说明性的
       静音标，拧不动——要听原声去原声行拨喇叭，要合回去就移除全部配音。判据是**元素绑着转录源**（`fromSource`），
       不是「主轨」——2026-09-16 起没有 clips 行。 */
    const isMain = list.some((e) => e.kind === 'video' && e.fromSource);
    if (isMain && (ctx.dubs || []).length) {
      return <Ic n="vol0" className="ic--12 thd__split" title="声音已剥离到「原声」行 · 移除全部配音就合回视频" />;
    }
    return <IconBtn icon={muted ? 'vol0' : 'vol2'} size="xs" className="thd__mute"
      on={muted} tip={muted ? '取消视频静音' : '视频静音'}
      onClick={(e) => { e.stopPropagation(); if (list.length) list.forEach((el) => ctx.setElDoc(el.id, {muted: !muted})); else ctx.setMuted(!muted); }} />;
  }

  /** 行头菜单本体。挂在滚动区外面，靠 `at`（行头的屏幕矩形）定位。 */
  function SubsHeadMenu({ctx, at, ops, onClose}) {
    if (!at) return null;
    const track = S.byId(ctx.subStyle, at.id) || {};
    const shelved = ctx.availableSubTracks ? ctx.availableSubTracks() : [];
    const off = !!track.hidden;
    const live = ctx.liveAt != null;
    return (
      <div className="tl__popanchor" style={{left: at.x, top: at.y, width: at.w, height: at.h}}>
        <Popover open onClose={onClose} align="left" dir="up" width={210}>
          <Menu>
            <MenuHead>{track.name}</MenuHead>
            {/* 停用 ≠ 拿下（第 120 轮）：停用的轨还在时间轴上，只是画面与导出跳过它；
                拿下是把它从轨集里请出去。两条并列，各说各的后果。 */}
            <MenuItem icon={off ? 'eye' : 'eyeoff'} label={off ? '启用这条轨' : '停用这条轨'}
              sub={off ? '回到画面与导出里' : '留在时间轴上 · 画面与导出都跳过'}
              onClick={() => { onClose(); ctx.setLaneOn({kind: 'subs', id: at.id}, off); }} />
            {/* 第 220 轮：转录中不动轨集——那条轨还在长，拿下 / 放回等它落盘（停用照旧可点，
                它只翻一位不碰数据） */}
            <MenuItem icon="trash" label="从画面上拿下" sub={live ? '转录完成后再拿下' : '不删数据 · 随时放回来'}
              disabled={live} onClick={() => { onClose(); ops.drop(at.id); }} />
            {shelved.length ? <MenuRule /> : null}
            {shelved.map((t) => (
              <MenuItem key={t.id} icon="plus" label={'放回「' + t.name + '」'}
                sub={live ? '转录完成后再放回' : t.role === 'source' ? '源语言' : '有译文，还没放上去'}
                disabled={live} onClick={() => { ops.put(t); onClose(); }} />
            ))}
          </Menu>
        </Popover>
      </div>
    );
  }

  function TimelineView({ctx, height}) {
    const {playT, seek, playing, pxps} = ctx;
    const narrow = ctx.geo.stageW < 520;
    const [snap, setSnap] = useState(null);            // 吸附参考线（拖动中才有）
    const [draft, setDraft] = useState(null);          // 拖动中的临时区间（成员行跟着读）
    /* 时间轴布局不读 `ctx.tab`（第 105 轮裁决）：右栏切到哪个 Tab、选中什么，
       这里有哪几行、每行什么状态都不变。字幕行恒展开逐条 cue，文本组成员泳道
       常开——第 39.3 轮那套随字幕 Tab 自动切换的两态就此退役。 */
    /* 停用位（第 120 轮）折进每一行的 `off`：元素读 `elDocs[id].hidden`、字幕轨读
       `track.hidden`、音频 / 音乐读两个 muted 位——行头开关与导出清单都从这里取数 */
    const hiddenEls = {};
    Object.keys(ctx.elDocs || {}).forEach((id) => { if (ctx.elDocs[id] && ctx.elDocs[id].hidden) hiddenEls[id] = true; });
    /* 折叠时钟（第 197 轮，§12.5 / §12.6；第 200 轮跟全局「剪辑」开关）：剪口是全局的、已剪段
       不占视频时间，所以开关关着时时间轴按**成片时钟**画——横向一切换算（块、刻度、播放头、选区、
       吸附线、框选）都过 `M.view`：`view = fold`，已剪段折掉、什么都不画；开关开着时 `view` 恒等，
       已剪段撑开成空槽带。刻度数字永远是成片时刻（`M.fold`），落进空槽带里的不标。 */
    const M = ctx.tmap || window.BC_CUT.foldMap(ctx.cuts || [], ctx.elements, {});
    const X = (t) => TL.px(M.view(t), pxps);
    const W = (a, b) => Math.max(2, (M.view(b) - M.view(a)) * pxps);
    /* 被盖住的视频（2026-09-11；2026-09-16 起每条视频行都算，没有「主视频」）：白板铺了纸的那几秒，
       下层视频画面整幅看不见——每件视频元素算一份 `coverSpans`，缩略带上压斜纹带（[timeline-whiteboard.jsx](timeline-whiteboard.jsx)）。 */
    const coverOf = (el) => TL.coverSpans(el, ctx.elements, ctx.elDocs, ctx.elStyleOf);
    const {rows, height: laneH} = TL.rows(ctx.elements,
      {subTracks: ctx.subStyle.tracks, textMembers: D.textGroup.members,
        audio: ctx.hasAudio, music: ctx.hasMusic, mainAudio: ctx.audioProject,
        hiddenEls, audioMuted: ctx.muted, musicMuted: ctx.musicMuted,
        dubs: ctx.dubs, dubOff: ctx.dubOff, bedOff: ctx.bedOff, score: ctx.score, scoreOff: ctx.scoreOff});
    /* 空白项目（第 216 轮）：零泳道——不预埋任何轨，第一条轨随第一个元素出现。
       零泳道时画一条 64px 的占位行（不是泳道：没有行头、不进 rows、不参与吸附），
       点它等于点空处：清选区并把播放头落过去。时长开放：标尺与滚动区在内容末端
       之外多画 `BLANK_TAIL` 秒，播放头能落到最后一个元素之后再添下一个。 */
    const blank = rows.length === 0 && ctx.openEnded;
    const rowsH = blank ? TL.BLANK_ROW_H : laneH;
    const dispDur = TL.displayDuration(ctx.duration, ctx.openEnded);
    const contentW = TL.contentWidth(M.view(dispDur), pxps);
    const ticks = TL.ticks(M.fold(dispDur), pxps);
    /* `.tlbody` 的 ref 由 editor.jsx 持有（`ctx.tlBodyRef`）：缩放要量它的视口宽度 */
    const ownBodyRef = useRef(null);
    const bodyRef = ctx.tlBodyRef || ownBodyRef;
    const [scrubbing, setScrubbing] = useState(false);
    /* 字幕行头菜单：`{id, x, y, w, h}`——哪一行开着，以及它行头的屏幕矩形。
       菜单与 hook 都挂在这一层而不是行里：`.tlbody` 是滚动区，挂在里面的浮层会被
       裁掉；软上限那句确认（`subOps.dialog`）更是必须在外面——`.scrim` 的
       `position: absolute` 会以那 60px 的行头为参照，遮罩只盖住一列。 */
    const [subMenu, setSubMenu] = useState(null);
    /* 配音行头菜单（timeline-dub.jsx）：`{lang, x, y, w, h}`——一种语言一条配音轨，记是哪条与它行头的屏幕矩形 */
    const [dubMenu, setDubMenu] = useState(null);
    /* 配音块的右键菜单：`{lang, x, y}`——作用于 ctx.dubSel 里选中的那几句（timeline-dub.jsx `DubBlockMenu`） */
    const [dubBlkMenu, setDubBlkMenu] = useState(null);
    /* 配乐轨行头菜单（timeline-score.jsx，只有 App 有）：`{bus, x, y, w, h}` */
    const [scoreMenu, setScoreMenu] = useState(null);
    const subOps = window.useSubTrackOps(ctx, subMenu && subMenu.id);
    /* 块的右键菜单：`{kind, id, name, x, y}`——鼠标那一点就是锚（timeline-menu.jsx）。 */
    const [blkMenu, setBlkMenu] = useState(null);
    /* 框选矩形（轨道区坐标系：含 60px 行头列与标尺高，与吸附参考线同一套原点）。 */
    const [box, setBox] = useState(null);
    const followRef = useRef({wasPlaying: false, startedAt: 0, startScreenX: 0, settled: false});

    /* 缩放动作带来的滚动偏移（`timelineZoom`）：与 pxps 同一拍写入，这里在新宽度提交后落下；
       重新挂载时不重放上一次的请求。 */
    const scrollReqSeen = useRef(ctx.tlScrollReq);
    useLayoutEffect(() => {
      const el = bodyRef.current, req = ctx.tlScrollReq;
      if (req === scrollReqSeen.current) return;
      scrollReqSeen.current = req;
      if (!el || !req) return;
      el.scrollLeft = TL.clampedScrollOffset(req.left, contentW, Math.max(1, el.clientWidth - TL.HEADS_W));
    }, [ctx.tlScrollReq]);

    // 播放入口保留播放头当下的屏幕位置：左侧先自己走到中线，右侧滚动追中；
    // 进入中线后才逐帧锁定。拖播放头时暂停自动滚动，避免时间轴和指针拔河。
    useLayoutEffect(() => {
      const el = bodyRef.current;
      const follow = followRef.current;
      if (!playing) { follow.wasPlaying = false; return; }
      if (!el || scrubbing) return;
      const viewportW = Math.max(1, el.clientWidth - TL.HEADS_W);
      const playheadX = X(playT);
      const now = performance.now();
      if (!follow.wasPlaying) {
        follow.wasPlaying = true;
        follow.startedAt = now;
        follow.startScreenX = playheadX - el.scrollLeft;
        follow.settled = false;
      }
      let want;
      if (follow.settled) {
        want = TL.centeredScrollOffset(playheadX, contentW, viewportW);
      } else {
        const result = TL.playbackFollowScrollOffset(
          playheadX, el.scrollLeft, contentW, viewportW, follow.startScreenX,
          (now - follow.startedAt) / TL.PLAYBACK_FOLLOW_ENTRY_MS,
        );
        want = result.scroll;
        follow.settled = result.settled;
      }
      if (Math.abs(el.scrollLeft - want) > 0.01) el.scrollLeft = want;
    }, [playing, playT, pxps, contentW, scrubbing]);

    /* 文稿里的拖选（第 193 轮，§13.1）同步到时间轴：选区按主视频元素的偏移折算到时间轴
       时间（BC_CUT.toTimeline，与剪口带同一套平移），画成一块贯穿所有行的高亮并标
       时长 + 起止时码；落定后不在可视区就把它滚到中间——拖选过程中不滚，免得跟手抖。 */
    const cutSel = ctx.cutSel && ctx.cutSel.start != null ? ctx.cutSel : null;
    const tsel = cutSel ? window.BC_CUT.toTimeline(ctx.elements, cutSel.start, cutSel.end) : null;
    useLayoutEffect(() => {
      const el = bodyRef.current;
      if (!el || !tsel || cutSel.live || playing) return;
      const viewportW = Math.max(1, el.clientWidth - TL.HEADS_W);
      const x0 = X(tsel.start), x1 = X(tsel.end);
      if (x0 >= el.scrollLeft && x1 <= el.scrollLeft + viewportW) return;
      el.scrollLeft = TL.centeredScrollOffset((x0 + x1) / 2, contentW, viewportW);
    }, [cutSel && cutSel.live, cutSel && cutSel.start, cutSel && cutSel.end]);

    /* 轨道区空白拖 = 框选（§7）。命中判据与舞台共用 `BC_SELECT.hitRect`，只是矩形
       不再来自 DOM（舞台那份查的是 `[data-el]` 节点），而是按「时间 × 行」现算——
       时间轴上一件元素的盒就是它的时段和它那一行，DOM 里量一遍反而绕。
       没拖起来（<4px）就是一次普通的点空白：清选中。 */
    const beginMarquee = (e) => {
      const el = bodyRef.current;
      if (e.button !== 0 || !el) return;
      const t = e.target;
      if (t.closest && t.closest('.tblk, .trow__hd, .ruler, .ph, .ph__flag, .pop, .tlcorner')) return;
      const r = el.getBoundingClientRect();
      const at = (ev) => ({x: ev.clientX - r.left + el.scrollLeft, y: ev.clientY - r.top + el.scrollTop});
      const p0 = at(e);
      const add = e.shiftKey || e.metaKey || e.ctrlKey;
      let live = null;
      const move = (ev) => {
        const m = SEL.marqueeRect(p0, at(ev));
        live = m.on ? m : null;
        setBox(live);
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        setBox(null);
        if (!live) { if (!add) { ctx.clearSel(); if (ctx.setCutSel) ctx.setCutSel(null); } return; }
        const rects = rows.flatMap((x) => TL.rowEls(x).map((el) => ({
          id: el.id,
          x: TL.HEADS_W + X(el.start),
          y: TL.RULER_H + x.y,
          w: W(el.start, el.end == null ? D.DUR : el.end),
          h: x.h,
        })));
        const hit = SEL.hitRect(rects, live);
        const byId = (id) => rows.flatMap(TL.rowEls).find((el) => el.id === id);
        const picks = hit.map((id) => ({kind: 'element', id, elKind: byId(id).kind}));
        ctx.pickMany(SEL.dedupe((add ? ctx.sels : []).concat(picks)));
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    // 行头列占住最左 60px，所以屏幕 x 换算成时间前先减掉它；再反折回时间轴时钟，
    // 落在已剪段里的（展开态点到空槽）推到段尾——播放头永远停在保留内容上
    const seekAtX = (clientX) => {
      const el = bodyRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      seek(M.skip(M.unview(TL.timeAt(clientX - r.left + el.scrollLeft - TL.HEADS_W, pxps))));
    };
    // 播放头竖线与小旗共用的横坐标（取整到设备像素，TL.devicePx）。
    const phX = TL.devicePx(TL.HEADS_W + X(playT), window.devicePixelRatio);

    return (
      <div className="tl" style={{height, '--tl-heads-w': TL.HEADS_W + 'px'}}>
        <ChapterBand chapters={ctx.chapters} playT={playT} seek={seek} title={ctx.proj.title} duration={ctx.duration} tmap={M} clearSel={ctx.clearSel} />
        <Transport ctx={ctx} narrow={narrow} />
        <div className="tlbody bc-scroll" ref={bodyRef}>
          <div className="tlinner" style={{width: TL.HEADS_W + contentW, height: TL.RULER_H + rowsH}}
            onMouseDown={beginMarquee}>
            <div className="tlcorner" />
            {/* 播放头小旗挂在一条贴顶的零高轨上：竖向滚动时留在标尺上沿，压过左上角；横坐标与竖线同一个取整值。 */}
            <div className="phrail">
              <div className="ph__flag" style={{left: phX}} onMouseDown={(e) => {
                e.preventDefault();
                setScrubbing(true);
                const move = (ev) => seekAtX(ev.clientX);
                const up = () => {
                  window.removeEventListener('mousemove', move);
                  window.removeEventListener('mouseup', up);
                  followRef.current.wasPlaying = false;
                  setScrubbing(false);
                };
                window.addEventListener('mousemove', move);
                window.addEventListener('mouseup', up);
              }} />
            </div>
            {/* 标尺被框选排除在外（它要连续 seek），所以取消选中在这儿单独来一次。 */}
            <div className="ruler" onMouseDown={() => ctx.clearSel()} onClick={(e) => seekAtX(e.clientX)}>
              {ticks.map((f) => (
                /* f 是成片时刻：折叠态位置就是它本身；展开态反折回时间轴时钟再定位——
                   反折总落在已剪段之后，所以空槽带里永远没有刻度，只有阴影 */
                <div key={f} className="tick" style={{left: TL.HEADS_W + X(M.unfold(f))}}>
                  {T.timecode(f, {decimals: 0})}
                </div>
              ))}
            </div>

            {rows.map((r) => (
              <div key={r.key} className={cx('trow', r.off && 'is-off', r.group && 'trow--grp', r.grouped && 'trow--grpmem')} style={{height: r.h, position: 'relative'}}>
                <div className={cx('trow__hd', r.indent && 'trow__hd--sub',
                  (r.group || r.grouped) && 'trow__hd--grp',
                  r.grouped && !r.groupOff && 'trow__hd--grpon',
                  r.kind === 'audio' && r.split && 'trow__hd--split',
                  r.kind === 'subs' && subMenu && subMenu.id === (r.track || {}).id && 'trow__hd--menu',
                  r.kind === 'dub' && dubMenu && dubMenu.lang === (r.dub || {}).lang && 'trow__hd--menu',
                  r.kind === 'score' && scoreMenu && scoreMenu.bus === r.bus && 'trow__hd--menu',
                  TL.isMediaKind(r.el?.kind) && 'trow__hd--video',
                  r.main && 'trow__hd--main')}
                  style={{height: r.h}}>
                  {r.kind === 'subs' ? (
                    <SubsHead row={r} ctx={ctx} onOpen={setSubMenu}
                      open={!!subMenu && subMenu.id === (r.track || {}).id} />
                  ) : r.kind === 'dub' ? (
                    <window.DubHead row={r} ctx={ctx} onOpen={setDubMenu} open={!!dubMenu && dubMenu.lang === (r.dub || {}).lang} />
                  ) : r.kind === 'score' ? (
                    <window.ScoreHead row={r} ctx={ctx} onOpen={setScoreMenu} open={!!scoreMenu && scoreMenu.bus === r.bus} />
                  ) : (
                    <>
                      {r.member ? <Ic n={r.member.icon} className="ic--14" />
                        : r.el ? <Ic n={r.el.icon} className="ic--14" />
                        /* 行头只放图标（2026-09-13 三改）：60px 放不下「背景声」「音频」的文字，改用一眼能认的形——
                           原声 mic、背景声 ambient（两道平缓波）、音乐 audio（音符）、视频 video；整名进 title */
                        : <Ic n={r.kind === 'bed' ? 'ambient' : r.kind === 'music' ? 'audio' : r.kind === 'audio' ? 'mic' : 'audio'} className="ic--14"
                            /* 音频行只在纯音频项目或有配音时出现（2026-09-16）：转录源文件名只当标题，它不是「主视频」 */
                            title={r.kind === 'audio' ? (r.split ? '原声 · ' + ctx.proj.src.name + ' · 已从时间轴上的视频剥离' + (r.off ? ' · 停用中，拨喇叭恢复' : '') : '音频 · ' + ctx.proj.src.name)
                              : r.kind === 'bed' ? r.label + ' · 这组配音自己分离的伴奏，不与别的语言共用' : r.label} />}
                      <span className="thd__label" title={r.label || r.el?.name}>{TL.headLabel(r)}</span>
                      {/* 模板行头：锁着画幅时挂一枚锁（第 218 轮）——不用等到点画幅钮才知道 */}
                      {r.kind === 'template' && ctx.ratioLock
                        ? <Ic n="lock" className="ic--12 thd__lock" title={ctx.ratioLock.note} /> : null}
                      <LaneToggle row={r} ctx={ctx} className="thd__tog" />
                      {r.el?.kind === 'video' ? <><span className="thd__audio-label">原声</span><VideoMute row={r} ctx={ctx} /></> : null}
                    </>
                  )}
                </div>
                <div className="trow__body" style={{left: 0}}>
                  {r.member ? (
                    <MemberBlock group={r.el} member={r.member} row={r} pxps={pxps} ctx={ctx} draft={draft} />
                  ) : r.kind === 'template' ? (
                    <TemplateBlock row={r} pxps={pxps} ctx={ctx} on={ctx.isSel('element', r.el.id)} onMenu={setBlkMenu} />
                  ) : r.el ? (
                    /* 同类共道（2026-09-11，§12.6）：一条元素行按道摆着一件或多件，逐件出块 */
                    TL.rowEls(r).map((el) => (
                      <React.Fragment key={el.id}>
                        <ElementBlock el={el} row={r} pxps={pxps} ctx={ctx}
                          on={ctx.isSel('element', el.id)}
                          onSnap={setSnap} onDraft={setDraft} onMenu={setBlkMenu} />
                        {el.kind === 'video'
                          ? <window.CoverBands row={r} ctx={ctx} pxps={pxps} spans={coverOf(el)} /> : null}
                      </React.Fragment>
                    ))
                  ) : r.kind === 'subs' ? (
                    <SubsRow ctx={ctx} row={r} pxps={pxps} />
                  ) : r.kind === 'music' ? (
                    <AudioBlock kind="music" name={D.sources.audio[0].name} ctx={ctx}
                      start={0} end={D.sources.audio[0].dur} pxps={pxps} h={r.h} muted={!!ctx.musicMuted} />
                  ) : r.kind === 'score' ? (
                    <AudioBlock kind="music" name={r.label + (r.stale ? ' · 已过期' : '')} ctx={ctx}
                      start={0} end={ctx.duration} pxps={pxps} h={r.h} muted={!!r.off} />
                  ) : r.kind === 'dub' ? (
                    <window.DubRow row={r} pxps={pxps} ctx={ctx} onMenu={setDubBlkMenu} />
                  ) : r.kind === 'bed' ? (
                    <AudioBlock kind="bed" name={r.label} ctx={ctx}
                      start={0} end={ctx.duration} pxps={pxps} h={r.h} muted={!!r.off} />
                  ) : (
                    <AudioBlock kind="audio" name={ctx.proj.src.name} ctx={ctx}
                      start={0} end={ctx.duration} pxps={pxps} h={r.h} muted={ctx.muted} ducked={!!r.ducked} />
                  )}
                </div>
              </div>
            ))}

            {blank ? (
              <div className="tlempty" style={{height: rowsH}}
                onMouseDown={(e) => { if (e.button !== 0) return; ctx.clearSel(); seekAtX(e.clientX); }}>
                <div className="tlempty__box">把素材拖进来，或从右侧面板添加</div>
              </div>
            ) : null}

            {snap ? (() => {
              // 播放头那条参考线（`full`）从标尺下沿贯穿到底，
              // 元素缘那条只覆盖它自己那一行——不然整屏都是竖线，看不出吸到了谁
              const r = snap.row ? TL.rowOfEl(rows, snap.row) : null;
              const top = snap.full || !r ? TL.RULER_H : TL.RULER_H + r.y;
              const h = snap.full || !r ? rowsH : r.h;
              return <div className="snapline" style={{left: TL.HEADS_W + X(snap.t), top, height: h}} />;
            })() : null}

            {box ? <div className="marquee"
              style={{left: box.x, top: box.y, width: box.w, height: box.h}} /> : null}

            <CutBands M={M} rowsH={rowsH} ctx={ctx} X={X} W={W} />

            {tsel ? <div className={'tlsel' + (cutSel.live ? ' is-live' : '')}
              style={{left: TL.HEADS_W + X(tsel.start), top: TL.RULER_H,
                width: W(tsel.start, tsel.end), height: rowsH}}>
              <span className="tlsel__l">
                {window.BC_CUT.label(cutSel.end - cutSel.start)} · {T.timecode(M.fold(tsel.start))} – {T.timecode(M.fold(tsel.end))}
              </span>
            </div> : null}

            <div className="ph" style={{left: phX}} />
          </div>
        </div>
        <SubsHeadMenu ctx={ctx} at={subMenu} ops={subOps} onClose={() => setSubMenu(null)} />
        <window.DubHeadMenu ctx={ctx} at={dubMenu} onClose={() => setDubMenu(null)} />
        <window.ScoreHeadMenu ctx={ctx} at={scoreMenu} onClose={() => setScoreMenu(null)} />
        <window.DubBlockMenu ctx={ctx} at={dubBlkMenu} onClose={() => setDubBlkMenu(null)} />
        <window.TimelineBlockMenu ctx={ctx} at={blkMenu} onClose={() => setBlkMenu(null)} />
        {subOps.dialog}
      </div>
    );
  }

  Object.assign(window, {LaneToggle, TimelineView, SubsHead, SubsHeadMenu, ChapterBand, Transport, timelineZoom});
})();
