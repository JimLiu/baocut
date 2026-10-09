/* 时间轴配音行（§12.6 / §15.6，2026-09-11 建、2026-09-13 改版）。
   一种语言一条轨（`dub:<lang>`），重跑、重试、重新生成都写回同一条——不再一次 run 一条。
   块是**淡的**：底色中性浅灰、左缘 3px 说话人色条、译文 10px（块够窄时只留色条）；只有几种状态跳出来——
   语速超过 1.35× 的块整块换橙（`.tdub--fast`，角标「1.62× · 过快」），没合成出来的句是橙色虚线空槽，
   静音的块压淡加删除线（`.tdub--muted`），正在重新生成的句是条纹「排队」块（`.tdub--queued`）。
   块能选：点选一句、⌘ 点追加、⇧ 点连选；右键（或选中后右键）弹块菜单：听这一句 / 静音 / 重新生成（快速）/
   改译文并重配… / 删除——都作用于选中的那几句（BC_DUB.pickIds / muteBlocks / deleteBlocks / queueRegen）。
   默认策略不截断：合成比槽位长就压语速、再长就盖到下一句前——块的右缘是实际结束，
   拖右缘能改这一句的播放时长（语速 = 合成时长 / 新时长，0.7–2.0×），只动这一块。
   行头：`配音 · English` ＋ 喇叭 ＋ ⋯ 菜单「听配音 / 听原声 / 两者都听 · 重新生成失败 / 过快的句 · 重新配音 · 移除」。
   不同语言的配音能并存，一次只开一种：行头菜单按语言切（舞台工具条的音量钮只管音量）。
   2026-09-14 起一种语言是一**组**：配音行是组头，它自己分离出来的背景声行缩进跟在下面（不与别的语言共用，
   再配一种语言就再拆一份）；行头喇叭关的是整组，⋯ 菜单里的「移除」连同这组的背景声一起拿掉。 */
(function () {
  const {useState, useRef} = React;
  const TL = window.BC_TL;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const T = window.BC_TIME;

  const vx = (ctx, t, pxps) => TL.px(ctx && ctx.tmap ? ctx.tmap.view(t) : t, pxps);
  const vw = (ctx, a, b, pxps) => (ctx && ctx.tmap ? ctx.tmap.view(b) - ctx.tmap.view(a) : b - a) * pxps;
  const selHas = (ctx, lang, id) => !!(ctx.dubSel && ctx.dubSel.lang === lang && ctx.dubSel.ids.indexOf(id) >= 0);

  /** 一块：淡底 + 说话人色条 + 译文；右缘拉伸把手；点选、右键菜单 */
  function DubBlock({b, row, pxps, ctx, draft, onDraft, onMenu}) {
    const lang = (row.dub || {}).lang;
    const failed = b.status === 'failed';
    const queued = b.status === 'queued';
    const live = draft && draft.id === b.id ? TTS.stretchBlock(b, draft.dur) : b;
    const w = Math.max(2, vw(ctx, live.start, live.end, pxps) - 1);
    const c = window.stops(b.hue);
    const label = TTS.rateLabel(live);
    const on = selHas(ctx, lang, b.id);
    const takes = DUB.takesOf(b, row.dub);
    const cur = DUB.activeTake(b, row.dub);
    const ver = takes.length > 1 && cur ? `第 ${cur.k} 版 · 种子 ${cur.seed}` : '';
    const tip = failed ? `${b.text} · 没合成出来，右键重新生成`
      : queued ? `${b.text} · 正在重新生成`
      : `${b.text}${label ? ' · ' + label : ''}${ver ? ' · ' + ver : ''}${b.muted ? ' · 已静音' : ''}${live.overrun ? ' · 盖到下一句前' : ''}${live.manual ? ' · 手动拉过' : ''} · 点开属性 · 拖右缘改时长 · 右键更多`;
    // 拖右缘时 mouseup 若落回块身，浏览器会给块补一次 click；这个标记让那次 click 不翻页
    const dragged = useRef(false);
    const beginStretch = (e) => {
      e.preventDefault(); e.stopPropagation();
      dragged.current = true;
      const x0 = e.clientX;
      const dur0 = live.end - live.start;
      let cur = dur0;
      const move = (ev) => {
        cur = Math.max(0.1, dur0 + (ev.clientX - x0) / pxps);
        onDraft({id: b.id, dur: cur});
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
        onDraft(null);
        if (Math.abs(cur - dur0) > 0.02 && ctx.stretchDub) ctx.stretchDub(lang, b.id, cur);
        setTimeout(() => { dragged.current = false; }, 0);   // 补出来的 click 在同一轮事件里，之后才放开
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    const openMenu = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!on) ctx.pickDub(lang, b.id, {});
      onMenu({lang, x: e.clientX, y: e.clientY});
    };
    return (
      <div className={cx('tblk', 'tdub', failed && 'is-failed', queued && 'tdub--queued', !failed && !queued && live.fast && 'tdub--fast',
          b.muted && 'tdub--muted', row.off && 'is-muted', on && 'is-on', draft && draft.id === b.id && 'is-drag')}
        style={{left: vx(ctx, live.start, pxps), width: w, top: 4, height: row.h - 8}}
        title={tip}
        onClick={(e) => {
          e.stopPropagation();
          if (dragged.current) return;
          const mod = {shift: e.shiftKey, meta: e.metaKey || e.ctrlKey};
          ctx.pickDub(lang, b.id, mod);
          // 单点一句 = 选中 + 音频 Tab 的「编辑配音句」（2026-09-23）；⌘ / ⇧ 多选只选不翻页
          if (!mod.shift && !mod.meta && ctx.openDubSentence) ctx.openDubSentence();
        }}
        onContextMenu={openMenu}>
        {!failed ? <i className="tdub__sp" style={{background: c.border}} /> : null}
        {!failed && w >= 28 ? <span className="t-truncate tdub__text">{queued ? '重新生成中…' : b.text}</span> : null}
        {!failed && !queued && label && w >= 84 ? <span className="tdub__rate">{label}</span> : null}
        {!failed && !queued && live.overrun && !live.fast ? <i className="tdub__over" /> : null}
        {!failed && !queued && w >= 24 ? (
          <div className="thnd thnd--r" style={{width: TL.blockEdgeZone(w), '--thnd-tint': c.border}}
            onMouseDown={beginStretch} onClick={(e) => e.stopPropagation()}>
            <i className="thnd__p" style={{background: c.border}} />
          </div>
        ) : null}
        {draft && draft.id === b.id ? <span className="ttip">{live.rate.toFixed(2)}× · {(live.end - live.start).toFixed(2)} s</span> : null}
      </div>
    );
  }

  function DubRow({row, pxps, ctx, onMenu}) {
    const d = row.dub || {};
    const blocks = d.blocks || [];
    const [draft, setDraft] = useState(null);
    return (
      <>
        {blocks.map((b) => <DubBlock key={b.id} b={b} row={row} pxps={pxps} ctx={ctx} draft={draft} onDraft={setDraft} onMenu={onMenu} />)}
      </>
    );
  }

  /** 行头：语言徽章 ＋ 喇叭 ＋ ⋯（菜单挂在滚动区外，见 timeline.jsx 的 `.tl__popanchor`） */
  function DubHead({row, tag, ctx, open, onOpen}) {
    const d = row.dub || {};
    const cnt = DUB.blockCounts(d.blocks || []);
    /* 行头写语言标签（2026-10-08，与字幕行头同一套 `TL.headTags`），「配音 · 英文」全名进悬停说明 */
    const title = `${row.label} · ${DUB.trackLine(d.blocks || [])}${d.bed ? ' · 下面是这组自己的背景声' : ''}`;
    return (
      <>
        <Ic n="wave" className="ic--14" title={title} />
        {tag ? <span className="thd__lang" title={title}>{tag}</span>
          : <span className="thd__label" title={title}>{TL.headLabel(row)}</span>}
        {cnt.fast || cnt.failed ? <i className="thd__fast" title={DUB.trackLine(d.blocks || [])} /> : null}
        <window.LaneToggle row={row} ctx={ctx} className="thd__tog" />
        <IconBtn icon="more" size="xs" className="thd__more" on={open}
          tip={'「' + row.label + '」这条轨'}
          onClick={(e) => {
            e.stopPropagation();
            if (open) { onOpen(null); return; }
            const r = e.currentTarget.closest('.trow__hd').getBoundingClientRect();
            onOpen({lang: d.lang, x: r.left, y: r.top, w: r.width, h: r.height});
          }} />
      </>
    );
  }

  function DubHeadMenu({ctx, at, onClose}) {
    const app = useApp();
    const d = at && (ctx.dubs || []).find((x) => x.lang === at.lang);
    if (!d) return null;
    const src = TTS.sourceOf({muted: ctx.muted, dubOff: ctx.dubOff, lang: d.lang, ducked: d.original === 'duck' && !ctx.muted});
    const cnt = DUB.blockCounts(d.blocks);
    const cands = DUB.regenCandidates(d.blocks);
    const pick = (t, text) => { onClose(); ctx.setDubSource(t, d.lang); app.toast(text); };
    const others = (ctx.dubs || []).length > 1;
    return (
      <div className="tl__popanchor" style={{left: at.x, top: at.y, width: at.w, height: at.h}}>
        <Popover open onClose={onClose} align="left" dir="up" width={250}>
          <Menu>
            <MenuHead>{'配音 · ' + (d.langName || '') + ' · ' + DUB.trackLine(d.blocks)}</MenuHead>
            <MenuItem icon="vol2" label="听配音" sub={'这组的配音' + (d.bed ? ' + 背景声' : '') + ' · ' + (d.original === 'duck' ? '原声压低到 −18 dB' : '原声静音') + (others ? ' · 别的语言关' : '')} on={src === 'dub'}
              onClick={() => pick('dub', `在听${d.langName || ''}配音 · 原声` + (d.original === 'duck' ? '压低' : '静音'))} />
            <MenuItem icon="audio" label="听原声" sub={'恢复视频里的原始声音 · ' + (others ? '所有配音组' : '这组') + '静音'} on={src === 'original'}
              onClick={() => pick('original', '在听原声 · 配音组已静音')} />
            <MenuItem icon="wave" label="两者都听" sub={'对照校听用 · ' + (d.bed ? '这组的背景声关' : '')} on={src === 'both'}
              onClick={() => pick('both', '原声与配音一起放')} />
            <MenuRule />
            {/* 重新合成是 AI 入口：Web 表面只留试听、静音与移除（model-surface.js） */}
            {window.BC_SURFACE.ai ? <MenuItem icon="refresh" label={cands.length ? `重新生成 ${cands.length} 句…` : '重新生成…'} disabled={!cands.length}
              sub={cands.length ? [cnt.failed ? `${cnt.failed} 句没合成` : '', cnt.fast ? `${cnt.fast} 句过快` : ''].filter(Boolean).join(' · ') + ' · 可先改译文' : '没有失败或过快的句'}
              onClick={() => { onClose(); ctx.requestAi('dub', {lang: d.lang, ids: cands}); }} /> : null}
            {window.BC_SURFACE.ai ? <MenuItem icon="redo" label="重新配音…" sub="换语言、换取向或声音，整条重来"
              onClick={() => { onClose(); ctx.requestAi('dub'); }} /> : null}
            <MenuItem icon="trash" label="移除这组配音" sub={(d.bed ? '连同它的背景声一起拿掉' : '只拿掉这一种语言') + (others ? '' : ' · 原声恢复')}
              onClick={() => { onClose(); ctx.clearDub(d.lang); app.toast(others ? `已移除「配音 · ${d.langName || d.lang}」` + (d.bed ? '与它的背景声' : '') : '已移除配音 · 原声恢复', 'notice'); }} />
          </Menu>
        </Popover>
      </div>
    );
  }

  /** 块的右键菜单：作用于选中的那几句 */
  function DubBlockMenu({ctx, at, onClose}) {
    const app = useApp();
    const d = at && (ctx.dubs || []).find((x) => x.lang === at.lang);
    if (!d) return null;
    const ids = ctx.dubSel && ctx.dubSel.lang === d.lang ? ctx.dubSel.ids : [];
    if (!ids.length) return null;
    const sel = d.blocks.filter((b) => ids.indexOf(b.id) >= 0);
    const allMuted = sel.every((b) => b.muted);
    const one = sel.length === 1 ? sel[0] : null;
    const n = sel.length;
    const cnt = n > 1 ? `这 ${n} 句` : '这一句';
    return (
      <div className="tl__popanchor" style={{left: at.x, top: at.y, width: 0, height: 0}}>
        <Popover open onClose={onClose} align="left" dir="up" width={240}>
          <Menu>
            <MenuHead>{DUB.selectionTitle(d.blocks, ids)}</MenuHead>
            {one ? (
              <MenuItem icon="play" label="听这一句" sub={`${T.timecode(one.start, {decimals: 0})} · ${(one.end - one.start).toFixed(1)} s${TTS.rateLabel(one) ? ' · ' + TTS.rateLabel(one) : ''}`}
                onClick={() => { onClose(); app.toast(`播放第 ${one.id.replace(/^g/, '')} 句配音`); }} />
            ) : null}
            <MenuItem icon={allMuted ? 'vol2' : 'vol0'} label={(allMuted ? '取消静音' : '静音') + cnt} sub={allMuted ? '恢复这几句的配音' : '这几句只放原声 · 导出也不带'}
              onClick={() => { onClose(); ctx.muteDubBlocks(d.lang, ids, !allMuted); app.toast(`${allMuted ? '已取消静音' : '已静音'} ${n} 句`); }} />
            <MenuRule />
            {window.BC_SURFACE.ai ? <>
              <MenuItem icon="refresh" label={'重新生成' + cnt} sub="同样的译文与声音再合成一次 · 换个种子"
                onClick={() => { onClose(); ctx.regenDubBlocks(d.lang, ids); }} />
              <MenuItem icon="edit" label="改译文并重配…" sub="先对比时长、改稿，再只重配这几句"
                onClick={() => { onClose(); ctx.requestAi('dub', {lang: d.lang, ids}); }} />
              <MenuRule />
            </> : null}
            <MenuItem icon="trash" label={'删除' + cnt} tone="negative" sub="轨上留空槽 · 这几句只放原声"
              onClick={() => { onClose(); ctx.deleteDubBlocks(d.lang, ids); app.toast(`已删除 ${n} 句配音 · 可撤销`, 'notice'); }} />
          </Menu>
        </Popover>
      </div>
    );
  }

  Object.assign(window, {DubRow, DubHead, DubHeadMenu, DubBlockMenu});
})();
