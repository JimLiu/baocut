// BaoCut Subtitle Studio — simplified timeline: chapter scrubber, transport,
// ruler, subtitle + translation tracks over a filmstrip band. Blocks seek and
// select (highlighting the matching card in the side pane). No clip splitting,
// no element tracks, no watermark lanes — subtitle MVP only.
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
const { Ic, QBtn, useApp, usePlayer, fmt, fmtT } = window;

const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300];
const THUMB_W = 84;    // filmstrip tile width (px) — global grid, gap-free
const OVERSCAN = 400;  // virtualization overscan (px) either side of the viewport
const CHAPTER_HUES = [252, 152, 28, 200];

// Real waveform on ONE viewport-sized canvas (repositioned while scrolling)
// instead of a <span> per bar across the whole track. Bar geometry follows
// designs/baocut-mac ClipWave; amplitudes come from the BCW1 peak bins, or
// the old deterministic fake wave while loading/unavailable.
function WaveCanvas({ view, width, pps, playT, wave }) {
  const cvRef = useRef(null);
  const H = 13, STEP = 3.5, BAR_W = 2.2;
  const drawLeft = Math.max(0, view.left - OVERSCAN);
  const drawW = Math.max(1, Math.min(width - drawLeft, view.w + OVERSCAN * 2));
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

function TimelinePane() {
  const app = useApp();
  const { doc } = app;
  const player = usePlayer();   // 播放头/走带需要连续时间
  const dur = Math.max(1, doc.meta.duration || 0);
  const tracksRef = useRef(null);
  const [trackW, setTrackW] = useState(900);
  const [zoom, setZoom] = useState(0);        // 0 = fit; otherwise px/sec
  const [dragging, setDragging] = useState(false);
  const [scrubPrev, setScrubPrev] = useState(null);
  const [scrubThumbT, setScrubThumbT] = useState(null);
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

  const fitPps = Math.max(0.2, (trackW - 8) / dur);
  const pps = zoom > 0 ? zoom : fitPps;
  const width = Math.max(trackW - 8, dur * pps);
  const x = (t) => t * pps;

  // keep the playhead in view while playing
  useEffect(() => {
    const el = tracksRef.current; if (!el || !player.playing) return;
    const px = x(player.t);
    if (px < el.scrollLeft + 40 || px > el.scrollLeft + el.clientWidth - 40) {
      el.scrollLeft = Math.max(0, px - el.clientWidth * 0.3);
    }
  }, [Math.floor(player.t * 2), player.playing]);

  // ruler ticks
  const step = RULER_STEPS.find((s) => s * pps >= 62) || 600;
  const ticks = [];
  for (let t = 0; t <= dur; t += step) ticks.push(t);

  const seekFromEvent = useCallback((e) => {
    const el = tracksRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(dur, (e.clientX - r.left + el.scrollLeft) / pps));
    app.seek(t);
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
  // A fast sweep can cross hundreds of 0.5s thumbnail keys. Keep the already
  // generated filmstrip tracking the pointer immediately, and only ask ffmpeg
  // for the exact frame once the pointer briefly settles.
  const scrubThumbKey = scrubPrev && hasVideoMedia
    ? Math.round(Math.max(0, Math.min(dur - 0.05, scrubPrev.t)) * 2) / 2
    : null;
  useEffect(() => {
    if (scrubThumbKey == null) {
      setScrubThumbT(null);
      return undefined;
    }
    const timer = setTimeout(() => setScrubThumbT(scrubThumbKey), 80);
    return () => clearTimeout(timer);
  }, [scrubThumbKey]);
  const scrubThumb = scrubThumbT == null ? null : window.VK_MEDIA.thumb(scrubThumbT);

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
  let scrubPreviewStyle = null;
  if (scrubPrev) {
    if (scrubThumbT === scrubThumbKey && scrubThumb && scrubThumb.state === 'ready') {
      scrubPreviewStyle = {
        backgroundImage: `url(${scrubThumb.url})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    } else if (strip.state === 'ready') {
      const idx = Math.max(0, Math.min(strip.cells - 1, Math.floor((scrubPrev.t / dur) * strip.cells)));
      const pos = strip.cells > 1 ? (idx / (strip.cells - 1)) * 100 : 0;
      scrubPreviewStyle = {
        backgroundImage: `url(${strip.url})`,
        backgroundSize: `${strip.cells * 100}% 100%`,
        backgroundPosition: `${pos}% center`,
        backgroundRepeat: 'no-repeat',
      };
    } else {
      scrubPreviewStyle = {
        background: `linear-gradient(140deg, oklch(0.42 0.10 ${scrubPrev.hue}), oklch(0.22 0.06 ${(scrubPrev.hue + 60) % 360}))`,
      };
    }
  }
  const tileI0 = Math.max(0, Math.floor((view.left - OVERSCAN) / THUMB_W));
  const tileI1 = Math.min(Math.ceil(width / THUMB_W), Math.ceil((view.left + view.w + OVERSCAN) / THUMB_W));
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

  const skipBy = (d) => app.seek(Math.max(0, Math.min(dur, player.t + d)));

  return (
    <div className="vk-timeline" data-screen-label="Timeline">
      {/* chapter scrubber */}
      <div className="vk-scrub" onPointerLeave={() => setScrubPrev(null)}>
        {doc.chapters.map((c, i) => {
          const w = ((c.end - c.start) / dur) * 100;
          const fill = player.t <= c.start ? 0 : player.t >= c.end ? 100 : ((player.t - c.start) / (c.end - c.start)) * 100;
          return (
            <div key={c.id} className="vk-scrub__seg" style={{ width: w + '%' }}
              onPointerMove={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                setScrubPrev({ x: e.clientX, title: c.title, t: c.start + frac * (c.end - c.start), hue: [252, 152, 28, 200][i % 4] });
              }}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
                app.seek(c.start + frac * (c.end - c.start));
              }}>
              <div className="vk-scrub__fill" style={{ width: fill + '%' }}></div>
            </div>
          );
        })}
        {scrubPrev ? (
          <div className="vk-scrub__preview" style={{ left: scrubPrev.x - (tracksRef.current ? tracksRef.current.getBoundingClientRect().left - 60 : 0), position: 'fixed', transform: 'translateX(-50%)', bottom: 'auto', top: 'auto', marginTop: -120 }}>
            <div className="vk-scrub__thumb" style={scrubPreviewStyle}>
              <span className="vk-mono">{fmt(scrubPrev.t)}</span>
            </div>
            <div className="vk-scrub__name">{scrubPrev.title}</div>
          </div>
        ) : null}
      </div>

      {/* transport */}
      <div className="vk-transport">
        <div className="vk-transport__side vk-transport__side--l">
          <span className="vk-transport__time vk-mono">{fmtT(player.t)} <span className="vk-dim">/ {fmt(dur)}</span></span>
        </div>
        <div className="vk-transport__center">
          <QBtn icon="skip-back" size="S" tip="后退 5 秒" onClick={() => skipBy(-5)} />
          <button className="vk-playbtn" aria-label={player.playing ? '暂停' : '播放'} onClick={app.togglePlay}>
            {player.playing
              ? <span className="vk-playbtn__pause"><span></span><span></span></span>
              : <Ic name="play" size={16} style={{ color: '#fff', marginLeft: 2 }} />}
          </button>
          <QBtn icon="skip-forward" size="S" tip="前进 5 秒" onClick={() => skipBy(5)} />
        </div>
        <div className="vk-transport__side vk-transport__side--r">
          <QBtn icon="zoom-out" size="S" tip="缩小" onClick={() => setZoom((z) => Math.max(fitPps, (z || fitPps) / 1.5))} />
          <input className="vk-zoom" type="range" min={Math.log(fitPps)} max={Math.log(24)} step="0.01"
            value={Math.log(zoom || fitPps)} aria-label="缩放"
            onChange={(e) => setZoom(Math.exp(parseFloat(e.target.value)))} />
          <QBtn icon="zoom-in" size="S" tip="放大" onClick={() => setZoom((z) => Math.min(24, (z || fitPps) * 1.5))} />
          <button className="vk-stagebar__btn" onClick={() => setZoom(0)}>Fit</button>
        </div>
      </div>

      {/* tracks */}
      <div className="vk-tlbody">
        <div className="vk-theads">
          <div className="vk-thead vk-thead--ruler" style={{ height: 22 }}></div>
          <div className="vk-thead" style={{ height: 33 }} data-tip="原文字幕轨"><Ic name="captions" size={15} /></div>
          <div className="vk-thead" style={{ height: 33 }} data-tip="译文字幕轨"><Ic name="comment" size={15} /></div>
          <div className="vk-thead" style={{ height: 44 }} data-tip="视频轨"><Ic name="video" size={15} /></div>
        </div>
        <div className="vk-tracks" ref={tracksRef}>
          <div className="vk-tracks__inner" style={{ width }}>
            <div className={'vk-ruler'} onPointerDown={rulerDown} style={{ cursor: dragging ? 'grabbing' : 'ew-resize' }}>
              {ticks.map((t) => (
                <React.Fragment key={t}>
                  <div className="vk-ruler__tick" style={{ left: x(t) }}></div>
                  <div className="vk-ruler__label" style={{ left: x(t) }}>{fmt(t)}</div>
                </React.Fragment>
              ))}
            </div>

            {/* subtitle (original) track */}
            <div className="vk-track" style={{ height: 28, '--blk': 'oklch(0.62 0.13 250)' }}>
              {(doc.timelineCues || doc.cues).map((c) => (
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
              {(doc.timelineTransCues || doc.transCues || []).length
                ? (doc.timelineTransCues || doc.transCues || []).map((tc) => (
                  <div key={tc.id}
                    className={'vk-block vk-block--trans' + (tc.kind === 'sentence' ? ' vk-block--transwhole' : '')}
                    style={{ left: x(tc.start), width: Math.max(3, x(tc.end) - x(tc.start) - 1.5), height: 24, '--blk': 'oklch(0.62 0.12 150)' }}
                    onClick={() => app.seek(tc.start)}>
                    <span className="vk-block__label" lang="zh">{tc.text}</span>
                  </div>
                ))
                : (doc.timelineCues || doc.cues).map((c) => (
                  <div key={c.id} className="vk-block vk-block--trans vk-block--transempty"
                    style={{ left: x(c.start), width: Math.max(3, x(c.end) - x(c.start) - 1.5), height: 24, '--blk': 'oklch(0.62 0.12 150)' }}
                    onClick={() => pickCue(c)}>
                    <span className="vk-block__label" lang="zh">未翻译</span>
                  </div>
                ))}
            </div>

            {/* filmstrip + waveform (one fused main-video block) */}
            <div className="vk-track" style={{ height: 40 }}>
              <div className="vk-clip" style={{ left: 0, width, height: 40, cursor: 'default' }}>
                <div className="vk-clip__film">{tiles}</div>
                <div className="vk-clip__waveband" style={{ height: 13 }}>
                  <WaveCanvas view={view} width={width} pps={pps} playT={player.t} wave={wave} />
                </div>
              </div>
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
