/* 轻量编辑器（docs/design/lite-editor/lite-editor-design.md）：同一部视频的另一种看法。
   画面居中，底下是章节进度条（与时间线视图同一条 ChapterBand：悬停看那一刻的画面）、播放条与**按段分格的片条**（段名、时长、点一片跳过去、当前片高亮），
   右边一块可收起的侧栏放当前段的脚本与逐句台词（点一句跳到它的开头）。画面下沿是与时间线视图同一条的舞台工具条（标记、音量、全屏、侧栏开关）。
   它渲染在 EditorPage 里（editor.jsx 按 `ctx.view` 换掉 `.edrow` 的内容），所以播放头、播放态、字幕开关、标注草稿
   与时间线视图是同一份状态；这里没有自己的 store。段的折法、默认视图与标注落点都在 model-lite.js。
   标记工具在 stage-markup.jsx（只在 App 入口）：画面底上一条浮动工具条，标记层铺在画面上；这里只放开关与挂载点。 */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const L = window.BC_LITE;
  const T = window.BC_TIME;
  const SURF = window.BC_SURFACE;

  /** 片式段条（照代码动画引擎的宿主时间线：一段一片、播放头是一根跨片的线、片的右边能拖）：
      - 片宽按时长比例，片里写段名，放宽了再写时长；当前片加深，播放头线落在当前片上并伸出上下沿；
      - 在片上按下并拖 = 刷洗（按指针位置连续 seek，跨片也行），悬停 = 预读那一刻（播放条的时码跟着显示）；
      - 片的右边是一枚把手：拖它改这一段的时长（场景：后面的场景整体推开、总长跟着变；章节：只挪与下一章的边界），
        拖的过程中片按新长度预览、把手上方浮出新时长与差值，松手才写回（editor.jsx 的 resizeSegment，进撤销）；
        把手也吃键盘：← / → 各 1 秒，⇧ 是 0.1 秒。 */
  function LiteSegBar({ctx, segs, hoverT, setHoverT, zoom, setZoom, api}) {
    const {playT, seek, duration} = ctx;
    const barRef = useRef(null);
    const scrollRef = useRef(null);
    const pendingScroll = useRef(null);   // 缩放后要落到的滚动位置（让指针下的那一刻不动）

    /* ⌘ / Ctrl + 滚轮（触控板捏合）连续缩放，围绕指针；普通滚轮交给容器横向滚。React 的 onWheel 是 passive 的，拦不住浏览器缩放页面，所以挂原生监听 */
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const onWheel = e => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const next = L.clampZoom(zoom * Math.exp(-e.deltaY * 0.01));
        if (next === zoom) return;
        pendingScroll.current = (el.scrollLeft + x) * (next / zoom) - x;
        setZoom(next);
      };
      el.addEventListener('wheel', onWheel, {passive: false});
      return () => el.removeEventListener('wheel', onWheel);
    }, [zoom]);
    useLayoutEffect(() => {
      if (pendingScroll.current != null && scrollRef.current) { scrollRef.current.scrollLeft = pendingScroll.current; pendingScroll.current = null; }
    }, [zoom]);
    /* 播放头在整条上的横坐标（按滚动前的几何） */
    const headAt = el => {
      const head = el.querySelector('.lt-chip__head');
      const r = el.getBoundingClientRect();
      return head ? head.getBoundingClientRect().left - r.left + el.scrollLeft : el.scrollLeft;
    };
    /* 按钮缩放围绕播放头：缩放后把头留在视野的 `at` 处（默认 1/3） */
    const zoomTo = (next, at = 1 / 3) => {
      const el = scrollRef.current;
      if (el && (next !== zoom || at !== 1 / 3)) {
        const r = el.getBoundingClientRect();
        pendingScroll.current = Math.max(0, headAt(el) * (next / zoom) - r.width * at);
      }
      setZoom(next);
    };
    /* 播放条上的缩放菜单（model-lite 的 ZOOM_MENU）走这里：放大 / 缩小 / 铺满 / 适应当前段（段头贴到视野左边）/ 缩放到播放头（头居中；铺满时先放大一档） */
    const zoomAction = k => {
      const el = scrollRef.current;
      if (k === 'in') zoomTo(L.zoomIn(zoom));
      else if (k === 'out') zoomTo(L.zoomOut(zoom));
      else if (k === 'fit') zoomTo(1);
      else if (k === 'playhead') zoomTo(zoom <= 1 ? L.zoomIn(zoom) : zoom, 1 / 2);
      else if (k === 'segment' && el) {
        const seg = L.segmentAt(segs, playT) || segs[0];
        const next = L.fitZoom(seg, duration);
        const r = el.getBoundingClientRect();
        const x = seg && duration > 0 ? (seg.start / duration) * r.width * next : 0;
        pendingScroll.current = Math.max(0, x);
        setZoom(next);
      }
    };
    useEffect(() => { if (api) api.current = {zoomTo, zoomAction}; });
    const [drag, setDrag] = useState(null);   // {kind: 'scrub'} | {kind: 'resize', index, end0, x0, pxPerSec, end}
    const preview = drag?.kind === 'resize' ? {index: drag.index, end: drag.end} : null;
    const chips = L.chipSpans(segs, playT, duration, drag ? null : hoverT, preview);
    const canResize = !!ctx.resizeSegment;

    /* 指针横坐标 → 时间：按片的实际几何算（片之间有空隙，不能按整条宽度线性换），落在空隙里归右边那片的开头 */
    const timeAtX = x => {
      const nodes = barRef.current ? [...barRef.current.querySelectorAll('.lt-chip')] : [];
      for (let i = 0; i < nodes.length; i++) {
        const r = nodes[i].getBoundingClientRect(), c = chips[i];
        if (!c) continue;
        if (x < r.left) return c.start;
        if (x <= r.right) return c.start + (r.width > 0 ? (x - r.left) / r.width : 0) * c.span;
      }
      return chips.length ? chips[chips.length - 1].end : 0;
    };

    useEffect(() => {
      if (!drag) return;
      const move = e => {
        if (drag.kind === 'scrub') seek(timeAtX(e.clientX));
        else setDrag(d => ({...d, end: Math.max(d.bounds.min, Math.min(d.bounds.max, d.end0 + (e.clientX - d.x0) / d.pxPerSec))}));
      };
      const up = e => {
        if (drag.kind === 'resize') ctx.resizeSegment(segs[drag.index], drag.end0 + (e.clientX - drag.x0) / drag.pxPerSec);
        setDrag(null);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, {once: true});
      return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    }, [drag?.kind, drag?.index]);

    /* 把手上的 ← / →：±1 秒，⇧ ±0.1 秒。拦住冒泡，别再让编辑器的全局方向键去挪播放头。 */
    const nudge = (seg, e) => {
      const step = e.shiftKey ? 0.1 : 1;
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); ctx.resizeSegment(seg, seg.end + step); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); ctx.resizeSegment(seg, seg.end - step); }
    };

    /* 放大后播放头出了视野就滚过去（拖播放头的时候不抢） */
    useEffect(() => {
      const el = scrollRef.current;
      if (!el || zoom <= 1 || drag) return;
      const head = el.querySelector('.lt-chip__head');
      if (!head) return;
      const r = el.getBoundingClientRect();
      const to = L.keepInView(head.getBoundingClientRect().left - r.left + el.scrollLeft, el.scrollLeft, r.width);
      if (to != null) el.scrollLeft = to;
    }, [playT, zoom]);

    return <div className="lt-strip">
    <div className={cx('lt-strip__scroll', zoom > 1 && 'is-zoomed')} ref={scrollRef}>
    <div className={cx('lt-chips', drag && `is-${drag.kind}`)} ref={barRef} role="group" aria-label="按段的进度" style={{width: `${zoom * 100}%`}}
      onPointerLeave={() => setHoverT(null)}>
      {chips.map((c, i) => {
        const seg = segs[i];
        const resizing = preview && preview.index === i;
        const delta = resizing ? c.span - (seg.end - seg.start) : 0;
        return <div key={c.id} className={cx('lt-chip', c.current && 'is-current', resizing && 'is-resizing')} style={{flex: `${Math.max(c.flex, 0.02)} 1 0`}}>
          <Tip label={`${c.title} · ${T.timecode(c.start)} – ${T.timecode(c.end)} · ${c.label}${seg.lines?.[0] ? ` · ${seg.lines[0].text}` : ''}`}>
            <BCAction type="button" className="lt-chip__body" aria-label={`${c.title} · ${c.label}${c.current ? ' · 正在播放' : ''}`} aria-current={c.current ? 'true' : undefined}
              onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); seek(timeAtX(e.clientX)); setDrag({kind: 'scrub'}); }}
              onPointerMove={e => { if (!drag) setHoverT(timeAtX(e.clientX)); }}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); seek(c.start); } }}>
              <span className="lt-chip__title t-truncate">{c.title}</span>
            </BCAction>
          </Tip>
          {c.head != null ? <span className="lt-chip__head" style={{left: `${c.head * 100}%`}} aria-hidden="true" /> : null}
          {c.hover != null ? <span className="lt-chip__hover" style={{left: `${c.hover * 100}%`}} aria-hidden="true" /> : null}
          {canResize && c.resizable ? <button type="button" className="lt-chip__edge" aria-label={`拖动改「${c.title}」的时长 · 现在 ${c.label}`}
            title={seg.kind === 'scene' ? '拖动改这一场的时长' : '拖动挪与下一章的边界'}
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault(); e.stopPropagation();
              const r = e.currentTarget.parentElement.getBoundingClientRect();
              const bounds = L.resizeBounds(segs, i) || {min: seg.start + 0.1, max: Infinity};
              setDrag({kind: 'resize', index: i, end0: seg.end, end: seg.end, x0: e.clientX, bounds, pxPerSec: Math.max(0.5, r.width / Math.max(0.1, seg.end - seg.start))});
            }}
            onKeyDown={e => nudge(seg, e)} /> : null}
          {resizing ? <span className="lt-chip__bubble t-mono" role="status">{c.label}<span className="lt-chip__delta">{delta >= 0 ? ' +' : ' −'}{Math.abs(delta).toFixed(1)}s</span></span> : null}
        </div>;
      })}
    </div>
    </div>
    </div>;
  }

  /* 循环键的三枚图标（20 网格、1.5 笔宽、只吃 currentColor，由 spectrum.css 按紧凑档显示 16px）：整片是首尾相接的两枚箭头，
     当前段在中间加一个「1」，不循环加一道斜杠。路径与 packages/ui 的 transport-icons.tsx 逐字一致（icon-sync.test.js 核对）。 */
  const LOOP_PATHS = {
    base: ['M4 9V8a3 3 0 0 1 3-3h8.5', 'M13.5 2.5 16 5l-2.5 2.5', 'M16 11v1a3 3 0 0 1-3 3H4.5', 'M7 17.5 4.5 15 7 12.5'],
    whole: [],
    segment: ['M8.8 8.8 10.4 7.6v4.8'],
    off: ['M3 3l14 14'],
  };
  const LoopGlyph = window.RSP.createIcon(({mode, ...props}) => <svg {...props} viewBox="0 0 20 20" className={cx(props.className, 'lt-tport__glyph')}>
    {[...LOOP_PATHS.base, ...(LOOP_PATHS[mode] || [])].map(d => <path key={d} d={d} />)}
  </svg>);

  /** 播放条（轻量编辑器设计 §3「走带」）：与时间线视图的播放条同一副骨架（timeline.jsx 的 Transport：两侧等分、播放键居中）。
      左边循环方式与时钟；中间上一段 · 播放 · 下一段；右边片条的缩放（缩小 · 百分比菜单 · 放大，与时间线播放条右端同一组）。 */
  function LiteTransport({ctx, segs, hoverT, zoom, strip}) {
    const R = window.RSP;
    const {playT, seek, playing, setPlaying, pop, setPop} = ctx;
    const [loop, setLoop] = useState(L.LOOP_DEFAULT);   // 这个窗口的观看态，不进视频
    const play = window.BC_PLAYER.playButtonState({playing, out: playT, dur: ctx.duration});
    const loopLabel = L.LOOP_MODES.find(m => m.k === loop).label;
    const single = segs.length <= 1;
    /* 循环：当前段循环在播过段尾时跳回段首（loopJump 只认往前、不比真实经过的时间走得快的一步，拖动、点片不算）；
       播到片尾（播放钮变成「重放」）时，整片回到 0、当前段回到最后一段的段首，接着放 */
    const last = useRef({t: playT, at: performance.now()});
    useEffect(() => {
      const prev = last.current, at = performance.now();
      last.current = {t: playT, at};
      const jump = playing ? L.loopJump(segs, loop, prev.t, playT, ctx.duration, L.loopMaxStep((at - prev.at) / 1000, ctx.speed || 1)) : null;
      if (jump != null) seek(jump);
    }, [playT]);
    useEffect(() => {
      if (play !== 'replay') return;
      const r = L.loopRange(segs, loop, playT, ctx.duration);
      if (r) { seek(r.start); setPlaying(true); }
    }, [play]);   // 只在播到头的那一下接着放；停在片尾时再改循环方式不自动开播
    const zoomTo = next => strip.current?.zoomTo(next);
    const zoomAction = k => { setPop(null); strip.current?.zoomAction(k); };
    return <div className="lt-tport">
      <div className="tport__side">
        <div className="lt-tport__loop">
          <IconBtn size="s" tip={loopLabel} aria-haspopup="menu" aria-expanded={pop === 'ltloop'}
            onClick={() => setPop(pop === 'ltloop' ? null : 'ltloop')}>
            <LoopGlyph mode={loop} />
          </IconBtn>
          <Popover open={pop === 'ltloop'} onClose={() => setPop(null)} dir="up" align="left" width={180} label="循环方式">
            <Menu>
              {L.LOOP_MODES.map(m => <MenuItem key={m.k} icon={<LoopGlyph mode={m.k} />} label={m.label} on={m.k === loop}
                disabled={m.k === 'segment' && single} onClick={() => { setLoop(m.k); setPop(null); }} />)}
            </Menu>
          </Popover>
        </div>
        {/* 悬停在片条上时先显示那一刻（淡一点），移开回到播放头 */}
        <span className={cx('t-mono t-detail lt-tport__tc', hoverT != null && 'is-hover')} aria-live="off">{L.fmtClock(hoverT != null ? hoverT : playT)}<span className="lt-tport__total"> / {L.fmtClock(ctx.duration)}</span></span>
      </div>
      <div className="tport__mid">
        <IconBtn icon="prev" size="s" tip="上一段" disabled={single} onClick={() => seek(L.prevStart(segs, playT))} />
        <Tip label={play === 'replay' ? '重放' : playing ? '暂停' : '播放'}>
          <R.Button variant="accent" size="M" aria-label={play === 'replay' ? '重放' : playing ? '暂停' : '播放'} UNSAFE_className="tport__play"
            onPress={() => { if (play === 'replay') { seek(0); setPlaying(true); } else setPlaying(!playing); }}>
            <Ic n={window.BC_PLAYER.PLAY_ICON[play]} />
          </R.Button>
        </Tip>
        <IconBtn icon="next" size="s" tip="下一段" disabled={single} onClick={() => { const t = L.nextStart(segs, playT); if (t != null) seek(t); }} />
      </div>
      {/* 片条缩放：与时间线播放条右端同一组（timeline.jsx 的 Transport）——缩小、可点开的百分比、放大；百分比钮弹出菜单。
          不标 ⌘= / ⌘− 快捷键：那组键今天还归时间线的缩放（editor-keys.jsx）。 */}
      <div className="tport__side tport__side--end lt-tport__zoom" role="group" aria-label="片条缩放">
        <IconBtn icon="zoomout" size="s" tip={zoom > 1 ? '缩小' : '已铺满'} disabled={zoom <= 1} onClick={() => zoomTo(L.zoomOut(zoom))} />
        <BCAction className="stp__v tport__zoomv" style={{cursor: 'pointer'}} aria-label={`片条缩放 ${L.zoomLabel(zoom)}，点开选项`} aria-haspopup="menu" aria-expanded={pop === 'ltzoom'}
          onClick={() => setPop(pop === 'ltzoom' ? null : 'ltzoom')}>
          {L.zoomLabel(zoom)}
        </BCAction>
        <IconBtn icon="zoomin" size="s" tip={zoom < L.ZOOM_MAX ? '放大' : '已到最大'} disabled={zoom >= L.ZOOM_MAX} onClick={() => zoomTo(L.zoomIn(zoom))} />
        <Popover open={pop === 'ltzoom'} onClose={() => setPop(null)} dir="up" align="right" width={180} label="片条缩放">
          <Menu>
            {L.ZOOM_MENU.map(z => <MenuItem key={z.k} label={z.label} on={z.k === 'fit' && zoom <= 1}
              disabled={(z.k === 'in' && zoom >= L.ZOOM_MAX) || ((z.k === 'out' || z.k === 'fit') && zoom <= 1)} onClick={() => zoomAction(z.k)} />)}
          </Menu>
        </Popover>
      </div>
    </div>;
  }

  /* 脚本正文：App 入口按回复正文渲染（AgentMarkdown），Web 入口没有 Markdown 渲染，退成去掉记号的段落 */
  function ScriptBody({text}) {
    if (window.AgentMarkdown) return <window.AgentMarkdown text={text} streaming={false} />;
    const paras = String(text || '').split(/\n{2,}/).map(p => p.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/^- /gm, '· ').trim()).filter(Boolean);
    return <>{paras.map((p, i) => <p key={i}>{p}</p>)}</>;
  }

  const ASSET_ICON = {bundle: 'Code', audio: 'AudioWave', footage: 'Filmstrip', image: 'Image'};
  const STATUS = {placed: null, stale: {label: '脚本已改，画面还没重做', tone: 'notice'}, pending: {label: '还没生成', tone: 'neutral'}};

  /** 右侧栏：当前段的头、脚本、逐句台词、素材。 */
  function LiteSide({ctx, segs, seg}) {
    const R = window.RSP;
    const {playT, seek} = ctx;
    const listRef = useRef(null);
    const cur = seg ? L.lineAt(seg.lines, playT) : null;
    // 播放时当前句滚进视野
    useEffect(() => { listRef.current?.querySelector('.is-current')?.scrollIntoView({block: 'nearest'}); }, [cur?.id]);
    if (!seg) return <Empty icon="transcript" title="这部视频还没有可以分段的内容" />;
    const src = L.SOURCES[seg.source];
    const status = STATUS[seg.status];
    return <div className="lt-side__body bc-scroll" ref={listRef}>
      <header className="lt-side__head">
        <div className="lt-side__kicker t-detail">{seg.kind === 'scene' ? '场景' : '章节'} {seg.index + 1} / {segs.length} · {src.label}</div>
        <h3 className="lt-side__title">{seg.title}</h3>
        <div className="t-detail t-mono">{T.timecode(seg.start)} – {T.timecode(seg.end)} · {L.fmtDur(seg.end - seg.start)}</div>
        {status ? <R.Badge variant={status.tone} fillStyle="subtle" UNSAFE_className="lt-side__status">{status.label}</R.Badge> : null}
      </header>
      {seg.script ? <R.Disclosure defaultExpanded UNSAFE_className="lt-side__disc">
        <R.DisclosureTitle>脚本</R.DisclosureTitle>
        <R.DisclosurePanel><div className="lt-script">
          <ScriptBody text={seg.script} />
          {SURF.agent ? <p className="lt-script__hint t-detail">改脚本在会话里说，或在画面上标记给智能体；这里只读</p> : null}
        </div></R.DisclosurePanel>
      </R.Disclosure> : null}
      <section className="lt-lines" aria-label="台词">
        <h4 className="lt-side__h4">{seg.kind === 'scene' ? '旁白' : '字幕'}<span className="t-detail"> · {seg.lines.length} 句</span></h4>
        {seg.lines.length ? <ol className="lt-lines__list">
          {seg.lines.map((l, i) => <li key={l.id}>
            <BCAction type="button" className={cx('lt-line', cur?.id === l.id && 'is-current')} aria-current={cur?.id === l.id ? 'true' : undefined}
              aria-label={`第 ${i + 1} 句 ${T.timecode(l.start)} ${l.text}`} onClick={() => seek(l.start)}>
              <span className="lt-line__n t-mono">{i + 1}</span>
              <span className="lt-line__body"><span className="lt-line__text">{l.text}</span>{l.trans ? <span className="lt-line__trans t-detail">{l.trans}</span> : null}</span>
              <span className="lt-line__tc t-mono t-detail">{T.timecode(l.start)}</span>
            </BCAction>
          </li>)}
        </ol> : <p className="t-detail lt-lines__empty">这一段没有台词</p>}
      </section>
      {seg.assets.length ? <R.Disclosure UNSAFE_className="lt-side__disc">
        <R.DisclosureTitle>素材 · {seg.assets.length}</R.DisclosureTitle>
        <R.DisclosurePanel><ul className="lt-assets">
          {seg.assets.map((a, i) => { const I = R.Icons[ASSET_ICON[a.kind]] || R.Icons.File; return <li key={a.id || i} className="lt-asset">
            <I /><span className="lt-asset__body"><span className="lt-asset__name t-truncate">{a.name}</span><span className="t-detail">{a.label}{a.detail ? ` · ${a.detail}` : ''}</span></span>
            {a.at != null ? <BCAction type="button" className="lt-asset__jump t-mono t-detail" aria-label={`跳到 ${T.timecode(a.at)}`} onClick={() => seek(a.at)}>{T.timecode(a.at)}</BCAction> : null}
          </li>; })}
        </ul></R.DisclosurePanel>
      </R.Disclosure> : null}
    </div>;
  }

  /** 画面上按图层开关出的几枚贴片：实拍覆盖（这一刻盖在画面上的那条）、来源标注与水印，演示用，正式版这些是真实轨道 */
  function LiteOverlays({ctx, seg}) {
    const on = k => ctx.liteLayerOn(k);
    const clip = seg?.footage?.find(f => ctx.playT >= f.at && ctx.playT < f.at + f.dur);
    return <>
      {clip && on('footage') ? <div className="lt-ov lt-ov--footage"><window.RSP.Icons.Filmstrip /><span>{clip.label}</span>{on('source-labels') ? <span className="lt-ov__src">{clip.src}</span> : null}</div> : null}
      {on('watermark') && ctx.liteLayerSpec?.watermark ? <div className="lt-ov lt-ov--mark">{ctx.proj.title.split(' · ')[0]}</div> : null}
    </>;
  }

  function EditorLite({ctx}) {
    const app = useApp();
    const segs = ctx.segments || [];
    const seg = L.segmentAt(segs, ctx.playT) || segs[0] || null;
    const side = app.prefs.liteSide !== false;
    const setSide = v => app.setPref('liteSide', v);
    const [hoverT, setHoverT] = useState(null);   // 片条上悬停的那一刻（播放条的时码预读它）
    const [zoom, setZoom] = useState(1);          // 片条的缩放（这个窗口的观看态，1 = 铺满）
    const strip = useRef(null);                   // 片条暴露的缩放动作（围绕播放头滚），播放条的缩放钮与菜单经它调
    /* toast 默认贴在窗口底上 34px，正好盖住片条；轻量视图在的时候把它抬到播放条上方（editor-lite.css 的 body.is-lite-view .toasts） */
    useEffect(() => { document.body.classList.add('is-lite-view'); return () => document.body.classList.remove('is-lite-view'); }, []);
    return <div className={cx('lt', ctx.annotating && 'is-annotating')} data-view="lite">
      <div className="lt__main">
        {/* 开场提示与时间线视图同一条、同一份状态：这里不画的话，切到时间线才第一次冒出来 */}
        {ctx.opening ? (
          <div className="opentoast" onClick={ctx.clearOpening}>
            <Ic n="info" className="ic--16" />
            <span className="grow">{ctx.opening}</span>
            <Ic n="close" className="ic--14" />
          </div>
        ) : null}
        <div className="lt__stage">
          <div className="lt__canvas">
            <window.StageView ctx={ctx} />
            <LiteOverlays ctx={ctx} seg={seg} />
          </div>
          {/* 舞台条：与时间线视图同一条（stage.jsx 的 StageBar，lite 档去掉画幅、倍速与字幕钮，加侧栏开关）；标记工具条由 StageView 挂 */}
          <window.StageBar ctx={ctx} lite side={side} setSide={setSide} />
        </div>
        <div className="lt__player">
          {/* 章节进度条：照搬时间线视图的那一条（timeline.jsx 的 ChapterBand，悬停出那一刻的画面与段名，点一下跳过去），放在播放条上面；段就是这里的段 */}
          {window.ChapterBand ? <div className="lt-band"><window.ChapterBand chapters={segs} playT={ctx.playT} seek={ctx.seek} title={ctx.proj.title} duration={ctx.duration} tmap={ctx.tmap} markup={ctx.annotating ? ctx.markup : null} /></div> : null}
          <LiteTransport ctx={ctx} segs={segs} hoverT={hoverT} zoom={zoom} strip={strip} />
          <LiteSegBar ctx={ctx} segs={segs} hoverT={hoverT} setHoverT={setHoverT} zoom={zoom} setZoom={setZoom} api={strip} />
        </div>
      </div>
      {/* 侧栏顶上是「台词 / 脚本」与「字幕样式」（editor-lite-script.jsx）；台词页就是下面这块 */}
      {side ? <aside className="lt__side" aria-label="当前段的脚本与台词"><window.LiteSidePane ctx={ctx} seg={seg} lines={<LiteSide ctx={ctx} segs={segs} seg={seg} />} /></aside> : null}
    </div>;
  }

  Object.assign(window, {EditorLite, LiteSegBar});
})();
