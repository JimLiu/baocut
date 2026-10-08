/* 导出弹层的「范围」区 —— §17.1（第 239 轮重拾并放宽）。
   ============================================================================
   120.1 轮撤下的「只导一段」只认主轨上的一个 clip；这一轮按四档重画（2026-09-16 起没有主轨：
   「片段」= 时间轴上的每一件视频元素，`X.videoSegments`，按起点排、停用的不算）：

     整片 / 按章节 / 按片段 / 自定义

   · 按章节、按片段都是**多选**：一列勾选行（名字 + 起止），勾了两段以上再问一句
     「合成一份还是各出一份」——相邻的段本来就拼成一段，不相邻的按顺序拼接或各出。
   · 自定义是一对起止：预览时间线下面一条**修剪条**（QuickTime 那种两只把手夹住的
     亮区），拖把手、拖亮区整体平移；把手旁边有可输入的时间码，还能一键取预览
     此刻停的位置——拖着预览找到那一帧、点「取此刻」，比盯着数字猜准。
   · 章节 / 片段模式下修剪条也在：每段一格，点格子就是勾 / 取消，与下面的列表同一份状态。

   时间一律是**源时间线**的秒；已剪掉的段（§12.6）在范围内照旧被跳过，这里不重复画。
   算的都在 model-export.js（spanOf / clampCustom / parseT / fmtT），这里只画和接事件。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const X = window.BC_EXPORT;

  /* ---------- 修剪条 ---------- */
  function TrimStrip({dur, mode, options, ids, custom, onToggle, onCustom, pt}) {
    const ref = useRef(null);
    const pct = (t) => Math.min(100, Math.max(0, t / dur * 100));
    const tAt = (clientX) => {
      const r = ref.current.getBoundingClientRect();
      return Math.round(Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * dur * 10) / 10;
    };
    /* 把手与亮区的拖动：把手只动自己那一头，亮区整体平移；边界与最小长度交给 clampCustom。
       第三个参数告诉上面拖的是哪一头（亮区平移按起点），预览据此跟着停过去；按下就先停一次 */
    const drag = (e, which) => {
      e.preventDefault(); e.stopPropagation();
      const t0 = tAt(e.clientX);
      const c0 = {start: custom.start, end: custom.end};
      const edge = which === 'r' ? 'end' : 'start';
      onCustom(c0.start, c0.end, edge);
      const move = (ev) => {
        const t = tAt(ev.clientX);
        if (which === 'l') onCustom(Math.min(t, c0.end - 0.5), c0.end, edge);
        else if (which === 'r') onCustom(c0.start, Math.max(t, c0.start + 0.5), edge);
        else {
          const len = c0.end - c0.start;
          let s = c0.start + (t - t0);
          s = Math.max(0, Math.min(s, dur - len));
          onCustom(s, s + len, edge);
        }
      };
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    return (
      <div className={cx('xtrim', mode === 'custom' && 'xtrim--custom')} ref={ref}>
        {mode === 'custom' ? (
          <>
            <div className="xtrim__win" style={{left: pct(custom.start) + '%', width: (pct(custom.end) - pct(custom.start)) + '%'}}
              onMouseDown={(e) => drag(e, 'm')}>
              <BCAction type="button" className="xtrim__h xtrim__h--l" aria-label="拖动起点" onMouseDown={(e) => drag(e, 'l')} />
              <BCAction type="button" className="xtrim__h xtrim__h--r" aria-label="拖动终点" onMouseDown={(e) => drag(e, 'r')} />
            </div>
          </>
        ) : options.map((o) => (
          <BCAction key={o.id} type="button" className={cx('xtrim__seg', ids.indexOf(o.id) >= 0 && 'is-on')}
            style={{left: pct(o.start) + '%', width: (pct(o.end) - pct(o.start)) + '%'}}
            title={o.label} aria-label={o.label} onClick={() => onToggle(o.id)} />
        ))}
        <i className="xtrim__pt" style={{left: pct(pt) + '%'}} />
      </div>
    );
  }

  /* ---------- 时间码输入：失焦 / 回车才提交，非法就回退到原值 ---------- */
  function TimeField({value, onCommit, label}) {
    const [draft, setDraft] = useState(X.fmtT(value));
    useEffect(() => { setDraft(X.fmtT(value)); }, [value]);
    const commit = () => {
      const t = X.parseT(draft);
      if (t == null) { setDraft(X.fmtT(value)); return; }
      onCommit(t);
    };
    return <Field size="s" className="xtime t-mono" value={draft} aria-label={label}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } }} />;
  }

  /* ---------- 范围区 ----------
     range：{mode, chIds, clipIds, custom: {start, end}, each}；span 由弹层用 X.spanOf 算好传进来。
     pt 是预览此刻停的位置（export-preview 报上来的），「取此刻」按它。 */
  function ExportRange({ctx, range, setRange, span, pt, onSeek}) {
    const dur = ctx.duration;
    const mode = range.mode;
    const isCh = mode === 'chapters';
    const options = isCh ? X.chapterOptions(ctx.chapters)
      : mode === 'clips' ? X.rangeOptions(X.videoSegments(ctx.elements, ctx.elDocs)) : [];
    const ids = isCh ? range.chIds : range.clipIds;
    const idsKey = isCh ? 'chIds' : 'clipIds';
    const patch = (p) => setRange((r) => Object.assign({}, r, p));
    const toggle = (id) => patch({[idsKey]: X.toggleId(ids, id)});
    const setCustom = (s, e) => patch({custom: X.clampCustom(s, e, dur)});
    /* 修剪条拖动：改范围的同时把预览停到拖的那一头；终点停在终点前 0.1s（终点本身不在范围里） */
    const dragCustom = (s, e, edge) => {
      const c = X.clampCustom(s, e, dur);
      patch({custom: c});
      if (edge && onSeek) onSeek(edge === 'end' ? Math.max(c.start, +(c.end - 0.1).toFixed(1)) : c.start);
    };
    const multi = span.segs.length > 1;

    return (
      <>
        <div className="cpsec">范围</div>
        <Segmented size="s" value={mode} onChange={(k) => patch({mode: k})} items={X.RANGE_MODES} />
        {mode !== 'all' ? (
          <TrimStrip dur={dur} mode={mode} options={options} ids={ids} custom={range.custom} pt={pt}
            onToggle={toggle} onCustom={dragCustom} />
        ) : null}

        {mode === 'chapters' || mode === 'clips' ? (
          <>
            <div className="xlanes xlanes--pick">
              {options.map((o) => (
                <div key={o.id} className={cx('xlane xlane--pick', ids.indexOf(o.id) < 0 && 'is-off')}>
                  <Checkbox on={ids.indexOf(o.id) >= 0} onChange={() => toggle(o.id)} />
                  <div className="xlane__nm">
                    <b>{isCh ? o.title : '片段 ' + o.index}</b>
                    {!isCh && o.name ? <span className="t-detail t-truncate" title={o.name}>{o.name}</span> : null}
                  </div>
                  <span className="xlane__tm t-mono">{isCh ? o.time : X.mmss(o.start) + '–' + X.mmss(o.end)}</span>
                  <span className="xlane__dur t-mono">{X.mmss(o.dur)}</span>
                </div>
              ))}
            </div>
            <div className="xnote xnote--row">
              <span>{span.empty ? (isCh ? '勾几章，相邻的章会拼成一段' : '勾几段，相邻的段会拼成一段') : span.label}</span>
              <span>
                <BCAction type="button" className="xlink" onClick={() => patch({[idsKey]: options.map((o) => o.id)})}>全选</BCAction>
                <BCAction type="button" className="xlink" onClick={() => patch({[idsKey]: []})}>清空</BCAction>
              </span>
            </div>
          </>
        ) : mode === 'custom' ? (
          <div className="xcustom">
            <div className="xcustom__f">
              <span className="xquick__lb">起点</span>
              <TimeField value={range.custom.start} label="起点时间码" onCommit={(t) => setCustom(t, range.custom.end)} />
              <BCAction type="button" className="xlink" onClick={() => setCustom(pt, range.custom.end)}>取此刻</BCAction>
            </div>
            <div className="xcustom__f">
              <span className="xquick__lb">终点</span>
              <TimeField value={range.custom.end} label="终点时间码" onCommit={(t) => setCustom(range.custom.start, t)} />
              <BCAction type="button" className="xlink" onClick={() => setCustom(range.custom.start, pt)}>取此刻</BCAction>
            </div>
            <span className="xcustom__len t-mono">共 {X.mmss(span.dur)}</span>
          </div>
        ) : null}

        {multi ? (
          <div className="xquick xquick--tight">
            <div className="xquick__f">
              <span className="xquick__lb">多段</span>
              <Segmented size="s" value={range.each ? 'each' : 'one'} onChange={(k) => patch({each: k === 'each'})}
                items={[{k: 'one', label: '合成一份'}, {k: 'each', label: '各出一份'}]} />
            </div>
            <span className="xnote xnote--inline">
              {range.each ? '每段一个文件' : span.contiguous ? '相邻的段拼成一段' : '不相邻的段按顺序拼接'}
            </span>
          </div>
        ) : null}
      </>
    );
  }

  Object.assign(window, {ExportRange});
})();
