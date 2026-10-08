/* 时间轴的行头 —— 2026-10-08 从 timeline.jsx 拆出（那一份超过 600 行）。
   字幕行头（语言标签 + 菜单钮）、启停开关、视频行的「原声」喇叭，以及字幕行头菜单本体。
   `BaoCut.html` 里它排在 timeline.jsx 之前，`TimelineView` 渲染时从 window 取。 */
(function () {
  const TL = window.BC_TL;
  const S = window.BC_SUB;

  /* ---------- 字幕行的行头：语言标签（2026-10-08） ----------
     行头宽 144px（`TL.HEADS_W`），「字幕 · 简体中文」这类全名在别的界面语言里更长，放不下。
     所以行头写语言标签（`TL.headTags`：ZH、EN、PT-BR…），原文与译文靠图标分开——原文是
     字幕框、译文是翻译；全名与原文 / 译文进悬停说明。

     菜单钮**平时不占位**：压在标签右边，hover 或菜单开着时才现身（`.thd__more`）。
     判据与 toast 走共用 hook（`subtrack.jsx`）——拒绝最后一条、放回第三条时问一次，与语言入口同一份。

     弹层不挂在行头里：`.tlbody` 是滚动区（`overflow: auto`），挂在里面的浮层会被
     裁成一条缝。所以行头只报一个屏幕矩形上去，菜单由 `TimelineView` 在 `.tl` 根上
     用一个 `position: fixed` 的 0 尺寸锚渲染。 */
  function SubsHead({row, tag, open, onOpen, ctx}) {
    const track = row.track || {};
    const title = TL.headTitle(row);
    /* 转录中的行头挂一枚呼吸点——与文稿面板运行态头同一颗（`.livehd__dot` 的 `bc-live`），
       告诉人「这条轨还在长」；百分比不写在行头里，进 tip。识别做完、进入保存阶段后不再呼吸
       （`BC_TX.liveSaving`；真实界面只在识别进行时画点）。 */
    const live = ctx.liveAt != null && ctx.liveJob;
    const recognizing = live && !window.BC_TX.liveSaving(live);
    return (
      <>
        <Ic n={track.role === 'translation' ? 'translate' : 'captions'} className="ic--14" title={title} />
        {tag ? <span className="thd__lang" title={title}>{tag}</span>
          : <span className="thd__label" title={title}>{TL.headLabel(row)}</span>}
        {recognizing ? <i className="thd__live" title={`转录中 ${Math.round(live.pct)}% · 已转录到 ${window.BC_TIME.timecode(ctx.liveAt, {decimals: 0})}`} /> : null}
        <LaneToggle row={row} ctx={ctx} className="thd__tog" />
        <IconBtn icon="more" size="xs" className="thd__more" on={open}
          tip={'「' + title + '」这条轨'}
          onClick={(e) => {
            e.stopPropagation();
            if (open) { onOpen(null); return; }
            const r = e.currentTarget.closest('.trow__hd').getBoundingClientRect();
            onOpen({id: track.id, x: r.left, y: r.top, w: r.width, h: r.height});
          }} />
      </>
    );
  }

  /* 行头的启停开关。字幕 / 元素行是一只眼睛，音频 / 音乐行是喇叭；关着的那一行**常显**
     ——不然一条灰掉的行说不清是为什么灰的。真相不在这里：拧下去走 `ctx.setLaneOn`，
     字幕轨写 `track.hidden`、元素写 `elDocs[id].hidden`、音频 / 音乐写两个 muted 位，
     导出弹层的清单读的是同一份。 */
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

  /** 字幕行头菜单本体。挂在滚动区外面，靠 `at`（行头的屏幕矩形）定位。 */
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
            {/* 停用 ≠ 拿下：停用的轨还在时间轴上，只是画面与导出跳过它；拿下是把它从轨集里请出去。
                两条并列，各说各的后果。 */}
            <MenuItem icon={off ? 'eye' : 'eyeoff'} label={off ? '启用这条轨' : '停用这条轨'}
              sub={off ? '回到画面与导出里' : '留在时间轴上 · 画面与导出都跳过'}
              onClick={() => { onClose(); ctx.setLaneOn({kind: 'subs', id: at.id}, off); }} />
            {/* 转录中不动轨集——那条轨还在长，拿下 / 放回等它落盘（停用照旧可点，它只翻一位不碰数据） */}
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

  Object.assign(window, {LaneToggle, VideoMute, SubsHead, SubsHeadMenu});
})();
