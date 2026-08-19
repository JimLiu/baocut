// BaoCut Subtitle Studio — simplified timeline: chapter scrubber, transport,
// ruler, subtitle + translation tracks over a filmstrip band. Blocks seek and
// select (highlighting the matching card in the side pane). Overlay element
// tracks (text / image / watermark, one row per lane via timeline-lanes.js) sit
// between the subtitle tracks and the media band. No clip splitting / multi-clip
// arrangement yet.
//
// The filmstrip + waveform show REAL media via VK_MEDIA (media-cache.jsx):
// a whole-file sprite strip at fit zoom, per-frame thumbs past the strip's
// resolution, and BCW1 peak bins on a viewport-sized canvas. Tiles live on a
// global 84px grid and only the visible range (±400px overscan) is mounted,
// so a deeply zoomed track stays at ~20–40 DOM nodes. When the server lacks
// the endpoints (or ffmpeg), everything falls back to the chapter-hue
// gradient and the deterministic fake wave — same look as before.
(() => {
const { useState, useRef, useEffect, useMemo, useCallback } = React;
const { Ic, QBtn, Menu, useApp, usePlayer, fmt, fmtT } = window;
const SCE = window.BCS_SOURCE_CUE_EDIT;
const TR = window.BCS_TRANSPORT;
const LANES = window.BCS_TIMELINE_LANES;   // 重叠元素摊成显示行（timeline-lanes.js）
const ET = window.BCS_ELEMENT_TIME;        // 元素窗口钳制（element-time.js）

const THUMB_W = 84;    // filmstrip tile width (px) — global grid, gap-free
const OVERSCAN = 400;  // virtualization overscan (px) either side of the viewport
const CHAPTER_HUES = [252, 152, 28, 200];
// 标尺/轨道左右留白（原型 PAD = 24）：播放头停在 0 秒或片尾时不贴容器边。
// 时间→像素只走 TR.timeToX / TR.xToTime，seek 的反函数与画块的正函数同源。
const PAD = TR.PAD;

// Real waveform on ONE viewport-sized canvas (repositioned while scrolling)
// instead of a <span> per bar across the whole track. Bar geometry follows
// designs/baocut-mac ClipWave; amplitudes come from the BCW1 peak bins, or
// the old deterministic fake wave while loading/unavailable.
// 坐标全部是「片内相对」的：片本身从 PAD 开始，所以传进来的 viewLeft 已经减掉
// 了 PAD，contentW 是不含 PAD 的内容宽度。playedX 因此和 playT * pps 同源。
function WaveCanvas({ viewLeft, viewW, contentW, pps, playT, wave }) {
  const cvRef = useRef(null);
  const H = 13, STEP = 3.5, BAR_W = 2.2;
  const drawLeft = Math.max(0, viewLeft - OVERSCAN);
  const drawW = Math.max(1, Math.min(contentW - drawLeft, viewW + OVERSCAN * 2));
  // per-bar amplitude only recomputed on scroll/zoom/data change, not per tick
  const amps = useMemo(() => {
    const peaks = wave && wave.state === 'ready' ? wave.peaks : null;
    const bps = peaks ? wave.binsPerSec : 0;
    const n = Math.ceil(drawW / STEP);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const gx = drawLeft + k * STEP;
      if (peaks) {
        const b0 = Math.max(0, Math.floor((gx / pps) * bps));
        const b1 = Math.min(peaks.length, Math.max(b0 + 1, Math.ceil(((gx + STEP) / pps) * bps)));
        let m = 0;
        for (let b = b0; b < b1; b++) if (peaks[b] > m) m = peaks[b];
        out[k] = m / 255;
      } else {
        const i = gx / 4; // same fake shape as the old span waveform
        out[k] = 0.25 + 0.7 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.42));
      }
    }
    return out;
  }, [drawLeft, drawW, pps, wave]);
  useEffect(() => {
    const cv = cvRef.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(drawW);
    if (cv.width !== Math.round(W * dpr)) cv.width = Math.round(W * dpr);
    if (cv.height !== Math.round(H * dpr)) cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // canvas fillStyle can't parse light-dark() tokens — resolve via a probe span
    const cs = getComputedStyle(cv);
    const resolve = (val, fallback) => {
      if (!val) return fallback;
      const p = document.createElement('span');
      p.style.cssText = 'position:absolute;color:' + val;
      (cv.parentNode || document.body).appendChild(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c || fallback;
    };
    const cBase = resolve(cs.getPropertyValue('--wave-base').trim(), 'rgba(255,255,255,0.45)');
    const cPlayed = resolve(cs.getPropertyValue('--wave-played').trim(), '#5b7fff');
    const playedX = playT * pps - drawLeft;
    const mid = H / 2;
    for (let k = 0; k < amps.length; k++) {
      const x = k * STEP;
      const bh = Math.min(H * 0.9, Math.max(1.5, amps[k] * (H - 2)));
      ctx.fillStyle = x < playedX ? cPlayed : cBase;
      ctx.beginPath();
      ctx.roundRect(x, mid - bh / 2, BAR_W, bh, Math.min(BAR_W / 2, bh / 2));
      ctx.fill();
    }
  }, [amps, drawLeft, drawW, pps, playT]);
  return <canvas ref={cvRef} className="vk-clip__wave"
    style={{ position: 'absolute', left: drawLeft, top: 0, width: drawW, height: H }}></canvas>;
}

// 轨道头的静音开关（原型 timeline-multi.jsx 的 MuteToggle）。Studio 没有分轨
// 音频模型，视频轨这颗接的是全局 player.muted，和音量浮层里的静音是同一个真相。
function TlMuteToggle({ muted, onToggle, tip }) {
  return (
    <button className={'vk-thead__mute' + (muted ? ' vk-thead__mute--on' : '')}
      data-tip={muted ? '取消静音' : (tip || '静音')} aria-label={muted ? '取消静音' : '静音'}
      aria-pressed={muted}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onPointerDown={(e) => e.stopPropagation()}>
      <Ic name={muted ? 'volume-mute' : 'volume'} size={13} />
    </button>
  );
}

// ---------- 叠加元素块（原型 TrackBlock / WmBlock 的 Studio 版） ----------
// 块 = 元素窗口 [start, end)。拖块整体平移（保持时长）、两端把手裁边；都以**按下那一
// 刻的窗口**为基准加累计位移，否则一边写一边读会把位移叠成指数。写路径是
// `patchElementLive`（本地草稿即时跟手 + 400ms 合并成一条事务），所以一次拖动只占
// 一步撤销。
function ElementBlock({ element, x, w, h, selected, whole, label, icon, wm, onSelect, onSeek, onChange }) {
  const startGesture = (mode) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    const snapshot = { start: element.start, end: element.end };
    const x0 = event.clientX;
    let moved = false;
    const move = (moveEvent) => {
      const dx = moveEvent.clientX - x0;
      if (!moved && Math.abs(dx) < 2) return;    // 3px 以内当点击，别把选中变成微移
      moved = true;
      onChange(mode === 'move'
        ? ET.movedSpan(snapshot, dx / w.pps, w.dur)
        : ET.resizedSpan(snapshot, mode, dx / w.pps, w.dur));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) onSelect();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={'vk-block' + (wm ? ' vk-block--wm' : ' vk-block--text') + (selected ? ' vk-block--sel' : '')}
      style={{ left: x, width: Math.max(8, w.px), height: h, '--blk': wm ? 'oklch(0.6 0.11 180)' : 'oklch(0.6 0.12 300)' }}
      data-tip={whole ? label + ' · 整片' : label}
      onPointerDown={startGesture('move')}
      onDoubleClick={(event) => { event.stopPropagation(); onSeek(); }}>
      <span className="vk-block__handle vk-block__handle--l" onPointerDown={startGesture('l')}></span>
      <span className="vk-block__label">
        <Ic name={icon} size={10} />{label}{whole ? <span className="bcs-block__whole" aria-label="整片">∞</span> : null}
      </span>
      <span className="vk-block__handle vk-block__handle--r" onPointerDown={startGesture('r')}></span>
    </div>
  );
}

// 一行的图标与名字：一条逻辑轨里可能同时有文本和图片，所以按行里的元素判定
// （水印 → layers / 图片 → image / 文字 → text-lines / 混装 → properties）。
function elementRowMeta(elements) {
  const kinds = new Set(elements.map((element) => (element.role === 'watermark'
    ? 'wm'
    : (element.kind === 'image' ? 'image' : 'text'))));
  if (kinds.size === 1) {
    const only = kinds.values().next().value;
    if (only === 'wm') return { icon: 'layers', name: '水印' };
    if (only === 'image') return { icon: 'image', name: '图片' };
    return { icon: 'text-lines', name: '文字' };
  }
  return { icon: 'properties', name: '叠加元素' };
}

// 块上的名字：文本取前若干字，图片就叫「图片」（投影里没有文件名，只有 srcId）。
function elementBlockLabel(element) {
  if (element.kind === 'image') return element.name || '图片';
  const text = String(element.text == null ? '' : element.text).replace(/\s+/g, ' ').trim();
  if (!text) return '空文本';
  return text.length > 24 ? text.slice(0, 24) + '…' : text;
}

// ---------- 章节 scrubber ----------
// 原型 timeline.jsx ChapterScrubber 的 Studio 版：hover 出缩略图预览，点击定位。
// 缩略图走 VK_MEDIA（真实帧），拿不到时退回章节色相渐变。
function ChapterScrubber({ dur, playT, onSeek, chapters, hasVideoMedia, strip }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null);           // {x, t, title, hue}
  const [thumbT, setThumbT] = useState(null);
  // 快速划过会跨上百个 0.5s 关键帧：先让已生成的胶片跟手，指针稍稳再向 ffmpeg
  // 要那一帧的精确缩略图。
  const thumbKey = hover && hasVideoMedia
    ? Math.round(Math.max(0, Math.min(dur - 0.05, hover.t)) * 2) / 2
    : null;
  useEffect(() => {
    if (thumbKey == null) {
      setThumbT(null);
      return undefined;
    }
    const timer = setTimeout(() => setThumbT(thumbKey), 80);
    return () => clearTimeout(timer);
  }, [thumbKey]);
  const thumb = thumbT == null ? null : window.VK_MEDIA.thumb(thumbT);

  let previewStyle = null;
  if (hover) {
    if (thumbT === thumbKey && thumb && thumb.state === 'ready') {
      previewStyle = {
        backgroundImage: `url(${thumb.url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    } else if (strip.state === 'ready') {
      const idx = Math.max(0, Math.min(strip.cells - 1, Math.floor((hover.t / dur) * strip.cells)));
      const pos = strip.cells > 1 ? (idx / (strip.cells - 1)) * 100 : 0;
      previewStyle = {
        backgroundImage: `url(${strip.url})`,
        backgroundSize: `${strip.cells * 100}% 100%`,
        backgroundPosition: `${pos}% center`,
        backgroundRepeat: 'no-repeat',
      };
    } else {
      previewStyle = {
        background: `linear-gradient(140deg, oklch(0.42 0.10 ${hover.hue}), oklch(0.22 0.06 ${(hover.hue + 60) % 360}))`,
      };
    }
  }

  return (
    <div className="vk-scrub" ref={ref} onPointerLeave={() => setHover(null)}>
      {chapters.map((c, i) => {
        const w = ((c.end - c.start) / dur) * 100;
        const fill = playT <= c.start ? 0
          : playT >= c.end ? 100
          : ((playT - c.start) / (c.end - c.start)) * 100;
        return (
          <div key={c.id} className="vk-scrub__seg" style={{ width: w + '%' }}
            onPointerMove={(e) => {
              // 模态浮层拥有交互：不要让 scrubber 的 hover 预览浮到对话框之上。
              if (document.querySelector('.vk-overlay')) { setHover(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
              const box = ref.current ? ref.current.getBoundingClientRect() : null;
              setHover({
                x: box ? e.clientX - box.left : e.clientX,
                title: c.title,
                t: c.start + frac * (c.end - c.start),
                hue: CHAPTER_HUES[i % CHAPTER_HUES.length],
              });
            }}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
              onSeek(c.start + frac * (c.end - c.start));
            }}>
            <div className="vk-scrub__fill" style={{ width: fill + '%', opacity: hover ? 0.55 : 1 }}></div>
          </div>
        );
      })}
      {hover ? (
        <div className="vk-scrub__preview"
          style={{ left: Math.max(70, Math.min(hover.x, (ref.current ? ref.current.offsetWidth : 600) - 70)) }}>
          <div className="vk-scrub__thumb" style={previewStyle}>
            <span className="vk-mono">{fmt(hover.t)}</span>
          </div>
          <div className="vk-scrub__name">{hover.title}</div>
        </div>
      ) : null}
    </div>
  );
}

function TimelinePane() {
  const app = useApp();
  const { doc } = app;
  const player = usePlayer();   // 播放头/走带需要连续时间
  const dur = Math.max(1, doc.meta.duration || 0);
  const tracksRef = useRef(null);
  const [trackW, setTrackW] = useState(900);
  const [zoom, setZoom] = useState(0);        // 0 = fit; otherwise px/sec
  const [dragging, setDragging] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const speedRef = useRef(null);
  const addRef = useRef(null);
  const fileRef = useRef(null);
  // viewport state — the base of filmstrip/wave virtualization. rAF-throttled;
  // the playhead auto-follow below writes scrollLeft and funnels through here.
  const [view, setView] = useState({ left: 0, w: 900 });

  useEffect(() => {
    const el = tracksRef.current; if (!el) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      setTrackW(el.getBoundingClientRect().width);
      setView({ left: el.scrollLeft, w: el.clientWidth });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(sync); };
    sync();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // fit 缩放要扣掉左右两侧的 PAD，否则末尾会被挤出可视区。
  const fitPps = Math.max(0.2, (trackW - PAD * 2) / dur);
  const pps = zoom > 0 ? zoom : fitPps;
  const contentW = dur * pps;                       // 不含 PAD 的内容宽度
  const width = Math.max(trackW - 8, TR.contentWidth(dur, pps));
  const x = (t) => TR.timeToX(t, pps);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = tracksRef.current; if (!el || !player.playing) return;
    const px = x(player.t);
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, px - el.clientWidth * 0.3);
    }
  }, [Math.floor(player.t * 2), player.playing]);

  // ruler ticks（步长与目标间距都取原型的 90px 档表）
  const step = TR.rulerStep(pps);
  const ticks = TR.rulerTicks(dur, step);
  const selectedCue = useMemo(
    () => SCE ? SCE.selectedCue(doc, app.sel) : null,
    [doc.timelineCues, doc.cues, app.sel],
  );
  // 选中的叠加元素（`sel {kind:'el', id}`，与 Cue 选中互斥）。
  const selectedElement = useMemo(
    () => (app.sel && app.sel.kind === 'el' ? app.findElement(app.sel.id) : null),
    [app.sel, app.findElement, doc.timelineProjection],
  );
  // 叠加元素的显示行：一条逻辑轨（timeline.json 的 tracks[]）里的元素可以时间重叠，
  // 用 first-fit 摊成互不重叠的行（timeline-lanes.js，与原型/Mac 同源）。
  // 顺序：轨道数组倒序（最后一条轨 = 最上面一行，与合成序一致），轨内 lane 0 贴近
  // 字幕轨、更高的 lane 往上长。空轨不占行。
  //
  // 与原型的一处差异：原型把图片/B-roll 轨画在字幕轨**下面**（它的 B-roll 垫在字幕
  // 之下），Studio 的元素层整体盖在字幕层之上（§3.6 合成序，见 elements-stage.jsx），
  // 所以所有元素行都在字幕轨上方 —— 时间轴的上下顺序仍然如实反映 z 序。
  const elementRows = useMemo(() => {
    if (!LANES) return [];
    const tracks = ((doc.timelineProjection || {}).tracks || []);
    const rows = [];
    [...tracks].reverse().forEach((track) => {
      if (!track || track.hidden === true) return;
      const elements = (track.elements || []).filter((element) => element
        && (element.kind === 'text' || element.kind === 'image'));
      if (!elements.length) return;
      const plan = LANES.plan(elements, dur);
      [...plan.lanes].reverse().forEach((lane) => {
        rows.push({
          key: (track.id || 'track') + '@' + lane.index,
          lane: lane.index,
          laneCount: plan.lanes.length,
          elements: lane.elements,
          meta: elementRowMeta(lane.elements),
        });
      });
    });
    return rows;
  }, [doc.timelineProjection, dur]);

  const deleteSelected = useCallback(() => {
    if (selectedElement) { app.removeElement(selectedElement); return; }
    if (selectedCue) app.deleteOriginalCue(selectedCue);
  }, [selectedElement, selectedCue, app.removeElement, app.deleteOriginalCue]);

  // Mac TimelinePaneView.deleteSelected：文本输入之外，⌫/⌦ 删除选中的原文 Cue
  // 或选中的叠加元素。
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!selectedCue && !selectedElement) return;
      if (!['Backspace', 'Delete'].includes(event.key)) return;
      if (SCE && SCE.isTextInput(document.activeElement)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      event.preventDefault();
      if (!event.repeat) deleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedCue, selectedElement, deleteSelected]);

  const seekFromEvent = useCallback((e) => {
    const el = tracksRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    app.seek(TR.xToTime(e.clientX - r.left + el.scrollLeft, pps, dur));
  }, [pps, dur]);
  const rulerDown = (e) => {
    e.preventDefault();
    seekFromEvent(e);
    setDragging(true);
    const move = (ev) => seekFromEvent(ev);
    const up = () => { setDragging(false); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  const pickCue = (c) => {
    if (!c.sourceId || c.sourceId === 'main') app.setSel({ cueId: c.sourceItemId || c.id });
    app.seek(c.start + 0.01);
  };

  // real filmstrip + waveform via VK_MEDIA; re-renders on cache progress
  window.useMediaResource();
  const media = doc.meta.media || null;
  const hasVideoMedia = !!(media && media.kind === 'video');
  const strip = hasVideoMedia ? window.VK_MEDIA.strip(dur) : { state: 'unavailable' };
  const wave = media ? window.VK_MEDIA.wave() : { state: 'unavailable' };

  // visible tiles on the global 84px grid (placeholder gradient = old look)
  const cellHue = (t) => {
    const ci = Math.max(0, doc.chapters.findIndex((c) => t >= c.start && t < c.end));
    return CHAPTER_HUES[ci < 0 ? 0 : ci % CHAPTER_HUES.length];
  };
  const fallbackBg = (i, t) => {
    const l = 0.34 + 0.1 * Math.abs(Math.sin(i * 2.7));
    const hue = cellHue(t);
    return `linear-gradient(140deg, oklch(${l} 0.09 ${hue}), oklch(${l - 0.12} 0.06 ${(hue + 40) % 360}))`;
  };
  // 片从 PAD 开始，所以虚拟化窗口先换算成片内坐标再切格子。
  const viewLeftInClip = view.left - PAD;
  const tileI0 = Math.max(0, Math.floor((viewLeftInClip - OVERSCAN) / THUMB_W));
  const tileI1 = Math.min(Math.ceil(contentW / THUMB_W), Math.ceil((viewLeftInClip + view.w + OVERSCAN) / THUMB_W));
  const tiles = [];
  const tileSpan = THUMB_W / pps;                                  // seconds per tile
  const stripSpan = strip.state === 'ready' ? dur / strip.cells : Infinity;
  // per-frame thumbs once zoomed past the strip's resolution; while the strip
  // is still building the placeholder holds (avoids double ffmpeg work upfront)
  const wantSingle = hasVideoMedia
    && ((strip.state === 'ready' && tileSpan < stripSpan) || strip.state === 'unavailable');
  for (let i = tileI0; i < tileI1; i++) {
    const t = Math.max(0, Math.min(dur - 0.05, ((i + 0.5) * THUMB_W) / pps));
    let style = null;
    if (strip.state === 'ready') {
      const idx = Math.max(0, Math.min(strip.cells - 1, Math.floor((t / dur) * strip.cells)));
      style = {
        backgroundImage: `url(${strip.url})`,
        backgroundSize: `${strip.cells * THUMB_W}px 100%`,
        backgroundPositionX: `${-idx * THUMB_W}px`,
        backgroundRepeat: 'no-repeat',
      };
    }
    if (wantSingle) {
      const th = window.VK_MEDIA.thumb(t);
      if (th && th.state === 'ready') {
        style = { backgroundImage: `url(${th.url})`, backgroundSize: 'cover', backgroundPosition: 'center' };
      }
    }
    if (!style) style = { background: fallbackBg(i, t) };
    tiles.push(
      <div key={i} className="vk-clip__cell" style={{
        left: i * THUMB_W, width: THUMB_W, ...style,
        borderRight: '1px solid rgba(0,0,0,0.35)',
      }}></div>
    );
  }

  const cues = doc.timelineCues || doc.cues || [];
  // 时间轴数据是否就绪：只有"转录中且还没有任何 Cue"这一段窗口才画骨架，
  // 真正空的项目（有时长、没字幕）不能永远显示占位。
  const contentReady = cues.length > 0 || doc.status.phase !== 'transcribing';
  const replay = TR.isReplay(player.playing, player.t, dur);
  const rate = TR.normalizeRate(player.rate);

  return (
    <div className="vk-timeline" data-screen-label="Timeline">
      {/* chapter scrubber */}
      {contentReady ? (
        <ChapterScrubber dur={dur} playT={player.t} onSeek={app.seek} chapters={doc.chapters}
          hasVideoMedia={hasVideoMedia} strip={strip} />
      ) : (
        <div className="vk-scrub vk-scrub--loading" aria-hidden="true"><span></span></div>
      )}

      {/* transport */}
      <div className="vk-transport">
        <div className="vk-transport__side vk-transport__side--l">
          {/* 撤销/重做在传输条最左侧（原型 app/timeline.jsx 同位） */}
          <QBtn icon="undo" size="S" tip="撤销（⌘Z）" tipDir="up" disabled={!app.history.canUndo} onClick={app.undoDoc} />
          <QBtn icon="redo" size="S" tip="重做（⇧⌘Z）" tipDir="up" disabled={!app.history.canRedo} onClick={app.redoDoc} />
          <span className="vk-fmtbar__sep"></span>
          <QBtn icon="delete" size="S" tip="删除所选（⌫）" tipDir="up"
            disabled={!selectedCue && !selectedElement} onClick={deleteSelected} />
          <span className="vk-fmtbar__sep"></span>
          {/* 添加叠加元素（原型 timeline.jsx 的 Add 菜单）。B-roll 的两个视频项
              本轮省略（决策 D16），所以这里只有文本 / 图片 / 水印。 */}
          <button ref={addRef} className="s2-btn s2-btn--S s2-btn--secondary"
            data-tip="在播放头处添加叠加元素" data-tip-dir="up" aria-label="添加元素"
            onClick={() => setAddOpen(true)}>
            <Ic name="add" size={13} />添加<Ic name="chevron-up" size={11} />
          </button>
          {addOpen ? (
            <Menu anchorRef={addRef} onClose={() => setAddOpen(false)} dir="up" align="start" width={200}
              items={[
                { icon: 'text-lines', label: '文本', onClick: () => app.addTextElement() },
                { icon: 'image', label: '图片…', onClick: () => fileRef.current && fileRef.current.click() },
                { icon: 'layers', label: '水印', onClick: () => app.addWatermark() },
              ]} />
          ) : null}
          {/* 图片走 <input type=file>：字节直传 __bcut/upload，服务端按魔数认类型。 */}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }} aria-hidden="true" tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (file) app.addImageElement(file);
            }} />
        </div>
        <div className="vk-transport__center">
          {/* 倍速按钮在右，左边同宽的占位块把播放按钮压在正中 */}
          <span className="vk-transport__ghost" aria-hidden="true"></span>
          <QBtn icon="skip-back" size="S" tip="上一句字幕" tipDir="up" disabled={!cues.length}
            onClick={() => app.seek(TR.prevCueStart(cues, player.t))} />
          <button className="vk-playbtn"
            aria-label={player.playing ? '暂停' : replay ? '从头重播' : '播放'}
            data-tip={player.playing ? '暂停（空格）' : replay ? '从头重播（空格）' : '播放（空格）'}
            data-tip-dir="up" onClick={app.togglePlay}>
            {player.playing
              ? <span className="vk-playbtn__pause"><span></span><span></span></span>
              : <Ic name={replay ? 'refresh' : 'play'} size={17}
                  style={{ color: '#fff', marginLeft: replay ? 0 : 2 }} />}
          </button>
          <QBtn icon="skip-forward" size="S" tip="下一句字幕" tipDir="up" disabled={!cues.length}
            onClick={() => app.seek(TR.nextCueStart(cues, player.t, dur))} />
          <button ref={speedRef} className="vk-stagebar__btn" data-tip="播放速度" data-tip-dir="up"
            aria-label="播放速度" onClick={() => setSpeedOpen(true)}>
            <Ic name="speed" size={14} />{TR.speedLabel(rate)}
          </button>
          {speedOpen ? (
            <Menu anchorRef={speedRef} onClose={() => setSpeedOpen(false)} dir="up" align="start" width={120}
              items={TR.RATES.map((r) => ({
                label: r + '×', suffix: rate === r ? '✓' : undefined,
                onClick: () => app.setPlayer((p) => ({ ...p, rate: r })),
              }))} />
          ) : null}
        </div>
        <div className="vk-transport__side vk-transport__side--r">
          <span className="vk-transport__time vk-mono" style={{ textAlign: 'right' }}>
            {fmtT(player.t)}<span className="vk-dim"> / {fmt(dur)}</span>
          </span>
          <span className="vk-fmtbar__sep"></span>
          <QBtn icon="zoom-out" size="S" tip="缩小" tipDir="up" disabled={(zoom || fitPps) <= fitPps}
            onClick={() => setZoom((z) => Math.max(fitPps, (z || fitPps) / 1.5))} />
          <input className="vk-zoom" type="range" min={Math.log(fitPps)} max={Math.log(24)} step="0.01"
            value={Math.log(zoom || fitPps)} aria-label="时间轴缩放" data-tip="时间轴缩放" data-tip-dir="up"
            onChange={(e) => setZoom(Math.exp(parseFloat(e.target.value)))} />
          <QBtn icon="zoom-in" size="S" tip="放大" tipDir="up" disabled={(zoom || fitPps) >= 24}
            onClick={() => setZoom((z) => Math.min(24, (z || fitPps) * 1.5))} />
          <button className="vk-stagebar__btn" data-tip="适应窗口" data-tip-dir="up"
            aria-label="时间轴适应窗口" onClick={() => setZoom(0)}>Fit</button>
        </div>
      </div>

      {/* tracks */}
      <div className="vk-tlbody">
        <div className="vk-theads">
          <div className="vk-thead vk-thead--ruler" style={{ height: 22 }}></div>
          {elementRows.map((row) => {
            const tip = row.laneCount > 1
              ? row.meta.name + '轨 · 第 ' + (row.lane + 1) + '/' + row.laneCount + ' 行'
              : row.meta.name + '轨';
            return (
              // 轨道有 5px 的 margin-top（editor.css .vk-track），轨道头因此要高 5px
              // 才能和它对齐 —— 与字幕轨那两行（28 + 5 = 33）同一套算法。
              <div key={row.key} className="vk-thead" style={{ height: 33 }}>
                <span className="vk-thead__ic" data-tip={tip} aria-label={tip}>
                  <Ic name={row.meta.icon} size={14} />
                </span>
              </div>
            );
          })}
          <div className="vk-thead" style={{ height: 33 }}>
            {/* Studio 没有多选模型，这里只保留按钮与 tip（原型的双击全选不接） */}
            <button className="vk-thead__btn" data-tip="原文字幕轨" aria-label="原文字幕轨">
              <Ic name="captions" size={15} />
            </button>
          </div>
          <div className="vk-thead" style={{ height: 33 }}>
            <span className="vk-thead__ic" data-tip="译文字幕轨" aria-label="译文字幕轨">
              <Ic name="comment" size={14} />
            </span>
          </div>
          <div className="vk-thead vk-thead--duo" style={{ height: 44 }}>
            <span className="vk-thead__ic" data-tip="视频轨" aria-label="视频轨"><Ic name="video" size={14} /></span>
            <TlMuteToggle muted={!!player.muted} tip="静音视频"
              onToggle={() => app.setPlayer((p) => ({ ...p, muted: !p.muted }))} />
          </div>
        </div>
        <div className="vk-tracks" ref={tracksRef}>
          <div className="vk-tracks__inner" style={{ width }}>
            <div className={'vk-ruler'} onPointerDown={rulerDown} style={{ cursor: dragging ? 'grabbing' : 'ew-resize' }}>
              {ticks.map((t) => (
                <span key={t} className="vk-ruler__tick" style={{ left: x(t) }}>
                  <span className="vk-ruler__label vk-mono">{fmt(t)}</span>
                </span>
              ))}
            </div>

            {/* 叠加元素轨（文字 / 图片 / 水印）：每条 lane 一行，空轨不占行。
                点块选中并打开检查器（store 的选中副作用），双击定位到它的开头。 */}
            {elementRows.map((row) => (
              <div key={row.key} className="vk-track vk-track--segs" style={{ height: 28 }}
                onPointerDown={(event) => { app.setSel(null); rulerDown(event); }}>
                {row.elements.map((element) => {
                  const whole = ET.isWholeVideo(element, dur);
                  const span = ET.windowOf(element, dur);
                  return (
                    <ElementBlock key={element.id} element={element}
                      x={x(span.start)}
                      w={{ px: x(span.end) - x(span.start) - 1.5, pps, dur }}
                      h={24}
                      selected={!!(app.sel && app.sel.kind === 'el' && app.sel.id === element.id)}
                      whole={whole} wm={element.role === 'watermark'}
                      icon={element.role === 'watermark' ? 'layers' : (element.kind === 'image' ? 'image' : 'text-lines')}
                      label={elementBlockLabel(element)}
                      onSelect={() => app.setSel({ kind: 'el', id: element.id })}
                      onSeek={() => app.seek(span.start + 0.01)}
                      onChange={(next) => app.patchElementLive(element, next, { label: '改元素窗口' })} />
                  );
                })}
              </div>
            ))}

            {/* subtitle (original) track */}
            <div className="vk-track" style={{ height: 28, '--blk': 'oklch(0.62 0.13 250)' }}>
              {!contentReady ? (
                <div className="vk-timeline-skeleton" aria-hidden="true">
                  {[16, 11, 20, 13, 18, 12].map((w, i) => <span key={i} style={{ width: w + '%' }}></span>)}
                </div>
              ) : cues.map((c) => (
                <div key={c.id}
                  className={'vk-block' + (app.sel && app.sel.cueId === (c.sourceItemId || c.id) ? ' vk-block--sel' : '')}
                  style={{ left: x(c.start), width: Math.max(3, x(c.end) - x(c.start) - 1.5), height: 24, '--blk': 'oklch(0.62 0.13 250)' }}
                  onClick={() => pickCue(c)}>
                  <span className="vk-block__label">{c.text}</span>
                </div>
              ))}
            </div>

            {/* translation track — 译文自己的展示流（片/整句上屏；与源 Cue 边界可不同） */}
            <div className="vk-track" style={{ height: 28 }}>
              {!contentReady ? (
                <div className="vk-timeline-skeleton" aria-hidden="true">
                  {[13, 18, 12, 16, 11, 20].map((w, i) => <span key={i} style={{ width: w + '%' }}></span>)}
                </div>
              ) : (doc.timelineTransCues || doc.transCues || []).length
                ? (doc.timelineTransCues || doc.transCues || []).map((tc) => (
                  <div key={tc.id}
                    className={'vk-block vk-block--trans' + (tc.kind === 'sentence' ? ' vk-block--transwhole' : '')}
                    style={{ left: x(tc.start), width: Math.max(3, x(tc.end) - x(tc.start) - 1.5), height: 24, '--blk': 'oklch(0.62 0.12 150)' }}
                    onClick={() => app.seek(tc.start)}>
                    <span className="vk-block__label" lang="zh">{tc.text}</span>
                  </div>
                ))
                : cues.map((c) => (
                  <div key={c.id} className="vk-block vk-block--trans vk-block--transempty"
                    style={{ left: x(c.start), width: Math.max(3, x(c.end) - x(c.start) - 1.5), height: 24, '--blk': 'oklch(0.62 0.12 150)' }}
                    onClick={() => pickCue(c)}>
                    <span className="vk-block__label" lang="zh">未翻译</span>
                  </div>
                ))}
            </div>

            {/* filmstrip + waveform (one fused main-video block) */}
            <div className="vk-track" style={{ height: 40 }}>
              {!contentReady ? (
                <div className="vk-timeline-skeleton vk-timeline-skeleton--media" aria-hidden="true"
                  style={{ left: PAD, right: PAD }}></div>
              ) : (
                <div className="vk-clip" style={{ left: PAD, width: contentW, height: 40, cursor: 'default' }}>
                  <div className="vk-clip__film">{tiles}</div>
                  <div className="vk-clip__waveband" style={{ height: 13 }}>
                    <WaveCanvas viewLeft={viewLeftInClip} viewW={view.w} contentW={contentW}
                      pps={pps} playT={player.t} wave={wave} />
                  </div>
                </div>
              )}
            </div>

            {/* playhead */}
            <div className="vk-playhead" style={{ left: x(player.t) }}>
              <div className="vk-playhead__grab" onPointerDown={rulerDown}></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.TimelinePane = TimelinePane;
})();
