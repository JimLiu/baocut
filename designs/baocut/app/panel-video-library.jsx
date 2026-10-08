/* Video library: source previews are isolated from the project player.
   Keep rows quiet; editing/placement/replacement stay in the shared overflow menu. */
(function () {
  const {useState, useEffect, useRef, useMemo, useCallback} = React;
  const V = window.BC_VIDEO_LIBRARY;
  function VideoLibraryRow({src, ctx, used, active, menuOpen, onHover, onLeave, onToggle, onMenu, onStop, selected, onSelect}) {
    const video = useRef(null);
    const [status, setStatus] = useState('idle');
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const url = V.previewUrl(src);
    useEffect(() => { setStatus('idle'); }, [url]);
    useEffect(() => {
      const node = video.current;
      if (!active || !node || !url) return;
      let disposed = false;
      setStatus('loading'); setTime(0); setDuration(0);
      node.muted = true;
      node.play().catch(() => {
        if (!disposed) { setStatus('error'); onStop(src.id); }
      });
      return () => {
        disposed = true;
        node.pause(); node.removeAttribute('src'); node.load();
      };
    }, [active, url, src.id, onStop]);
    const failed = status === 'error';
    const label = active ? '停止静音预览' : failed ? '重试静音预览' : '静音预览';
    const pct = duration > 0 ? Math.min(100, time / duration * 100) : 0;
    return <article className={cx('vl-row', active && 'is-previewing', selected && 'is-selected')} aria-label={src.name}
      onClick={onSelect ? () => onSelect(src) : undefined}
      onKeyDown={e => {
        if (e.key === 'Escape') { onStop(src.id); e.stopPropagation(); }
        else if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button')) e.stopPropagation();
      }}
      onMouseEnter={() => onHover(src.id)} onMouseLeave={() => onLeave(src.id)}>
      <div className="vl-thumb">
        {src.poster ? <img src={src.poster} loading="lazy" alt="" /> : <Ic n="video" className="ic--20" />}
        {active && url ? <video ref={video} src={url} muted playsInline loop preload="none" aria-hidden="true"
          onPlaying={() => setStatus('playing')} onError={() => { setStatus('error'); onStop(src.id); }}
          onTimeUpdate={e => { setTime(e.currentTarget.currentTime); setDuration(e.currentTarget.duration); }} /> : null}
        {url ? <IconBtn icon={active ? 'pause' : 'play'} tip={`${label} · ${src.name}`} className="vl-play"
          onClick={e => { e.stopPropagation(); onToggle(src.id); }} onBlur={() => onLeave(src.id)} /> : null}
        <span className="vl-duration">{window.BC_TIME.timecode(active ? time : src.dur || 0, {decimals: 0})}</span>
        {active ? <span className="vl-progress"><i style={{width: pct + '%'}} /></span> : null}
      </div>
      <div className="vl-info">
        <b className="vl-name" title={src.name}>{src.name}
          {/* 转录源（2026-09-16）：不是「主视频」——字幕与文稿来自这个文件，所以不能移除；在不在时间轴上和别的素材一样看引用 */}
          {ctx.proj && ctx.proj.src && src.name === ctx.proj.src.name
            ? <Chip title="字幕与文稿来自这个文件，不能移除">转录源</Chip> : null}</b>
        <span className="vl-meta" title={src.meta}>{src.meta || '视频素材'}</span>
        <span className="vl-status">{active ? <><Ic n="vol0" className="ic--12" />{status === 'loading' ? '正在加载预览' : '静音预览'}</>
          : <>{used}{src.crop ? ` · 智能裁剪 ${src.crop.ratioId}${src.crop.version > 1 ? ` 第 ${src.crop.version} 版` : ''} · 来自 ${src.crop.sourceName}` : ''}{failed ? ' · 预览不可用' : !url ? ' · 暂无预览' : ''}</>}</span>
      </div>
      {onSelect ? <IconBtn icon={selected ? 'check' : 'plus'} tip={`选择 ${src.name}`} on={selected} aria-pressed={!!selected}
        onClick={e => { e.stopPropagation(); onSelect(src); }} /> : <div className="vl-menu" onMouseEnter={() => onLeave(src.id)} onFocus={() => onLeave(src.id)}>
        <IconBtn icon="more" tip={`更多 · ${src.name}`} on={menuOpen} aria-haspopup="menu" aria-expanded={menuOpen}
          onClick={() => onMenu(menuOpen ? null : src.id)} />
        <Popover open={menuOpen} onClose={() => onMenu(null)} align="right" dir="down" width={220}>
          <window.MediaSourceMenu src={src} kind="video" ctx={ctx} onClose={() => onMenu(null)} />
        </Popover>
      </div>}
    </article>;
  }
  function VideoLibrary({ctx, onImport, selection}) {
    const list = ctx.sources.video;
    const scroll = useRef(null), pending = useRef(null), motion = useRef(false);
    const [active, setActive] = useState(null), [menu, setMenu] = useState(null);
    const [over, setOver] = useState(false);
    const [viewport, setViewport] = useState({top: 0, height: 480});
    const stop = useCallback((id) => {
      clearTimeout(pending.current); pending.current = null;
      setActive(value => !id || value === id ? null : value);
    }, []);
    useEffect(() => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)');
      const change = () => { motion.current = query.matches; if (query.matches) stop(); };
      const hide = () => { if (document.hidden) stop(); };
      const blur = () => stop();
      change(); query.addEventListener('change', change);
      document.addEventListener('visibilitychange', hide); window.addEventListener('blur', blur);
      return () => {
        clearTimeout(pending.current);
        query.removeEventListener('change', change);
        document.removeEventListener('visibilitychange', hide); window.removeEventListener('blur', blur);
      };
    }, [stop]);
    useEffect(() => {
      const node = scroll.current;
      if (!node) return;
      const resize = new ResizeObserver(() => setViewport({top: node.scrollTop, height: node.clientHeight}));
      resize.observe(node); return () => resize.disconnect();
    }, []);
    useEffect(() => { stop(); setMenu(null); if (scroll.current) scroll.current.scrollTop = 0; }, [ctx.proj.id, list.length, stop]);
    // 带着预选进来（替换选择器 / 素材菜单）：把那一行滚到可见。
    useEffect(() => {
      const idx = selection?.focusId ? list.findIndex(s => s.id === selection.focusId) : -1;
      if (idx >= 0 && scroll.current) { scroll.current.scrollTop = Math.max(0, idx * V.ROW_HEIGHT - 8); setViewport({top: scroll.current.scrollTop, height: scroll.current.clientHeight}); }
    }, [selection?.focusId]);
    const index = useMemo(() => V.usageIndex(ctx.elements, ctx.elDocs), [ctx.elements, ctx.elDocs]);
    const visible = V.windowFor(list.length, viewport.top, viewport.height);
    const hover = id => {
      if (motion.current || menu || !V.previewUrl(list.find(s => s.id === id))) return;
      stop(); pending.current = setTimeout(() => { pending.current = null; setActive(id); }, 300);
    };
    const toggle = id => { clearTimeout(pending.current); setActive(value => value === id ? null : id); };
    const showMenu = id => { stop(); setMenu(id); };
    return <div className="vl-panel">
      {!selection ? <div className={cx('vl-import', over && 'is-over')} onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); onImport(); }}>
        <Ic n="upload" className="ic--20" /><div><b>添加视频</b><span>拖入文件，或选择本地视频</span></div>
        <Btn size="s" icon="plus" onClick={onImport}>导入</Btn>
      </div> : null}
      <div className="vl-heading"><b>视频视频</b><span>{list.length} 个文件</span></div>
      <div className="vl-hint">{selection ? '悬停静音预览 · 选择后点击确认替换' : '悬停静音预览 · 更多操作在「…」中'}</div>
      <div ref={scroll} className="vl-list bc-scroll" aria-label="视频视频列表"
        onScroll={e => { stop(); setMenu(null); setViewport({top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight}); }}>
        {!list.length ? <Empty icon="video" title="还没有视频">导入后可在这里预览和管理。</Empty>
          : <div className="vl-virtual" style={{height: visible.height}}>
            {list.slice(visible.start, visible.end).map((src, i) => <div className="vl-slot" key={src.id}
              style={{top: (visible.start + i) * V.ROW_HEIGHT}}>
              <VideoLibraryRow src={src} ctx={ctx} used={V.usage(src, index)} active={active === src.id} menuOpen={menu === src.id}
                selected={selection?.id === src.id} onSelect={selection?.onSelect}
                onHover={hover} onLeave={stop} onToggle={toggle} onMenu={showMenu} onStop={stop} />
            </div>)}
          </div>}
      </div>
      {!selection ? <p className="vl-footnote">导入后保留为素材，通过菜单添加到时间线。</p> : null}
    </div>;
  }
  window.VideoLibrary = VideoLibrary;
})();
