// BaoCut Subtitle Studio — video stage.
// The media element decodes and owns the clock; Konva paints video frames and
// interactive subtitles into Canvas. Transport controls remain regular DOM UI.
(() => {
const { useState, useRef, useEffect, useCallback } = React;
const { Ic, QBtn, Pop, Menu, useApp, usePlayer, fmtT } = window;
const { KonvaPreview, CanvasTextEditor } = window.BCSCanvas;
const R = window.BCS_SUBTITLE;
const T = window.BCS_TIMELINE;

function StagePane() {
  const app = useApp();
  const { doc } = app;
  const player = usePlayer();   // 画布/媒体元素是逐帧真值的合法消费者
  const stageRef = useRef(null);
  const mediaElRef = useRef(null);
  const [mediaEl, setMediaEl] = useState(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [ratioOpen, setRatioOpen] = useState(false);
  const [volOpen, setVolOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [sourceAspect, setSourceAspect] = useState(null);
  const ratioRef = useRef(null), volRef = useRef(null);
  const selectTimerRef = useRef(null);
  const clickCoordinatorRef = useRef(null);
  if (!clickCoordinatorRef.current) {
    clickCoordinatorRef.current = window.BCS_STAGE_CLICK.createCoordinator(() => performance.now());
  }

  const projection = doc.timelineProjection || null;
  const playbackPosition = projection && T
    ? T.timelineToSource(projection, player.t, 'following')
    : null;
  const mediaSourceId = playbackPosition ? playbackPosition.srcId : 'main';
  const mediaClipId = playbackPosition ? playbackPosition.clipId : 'c1';
  const projectedKind = projection && projection.views[mediaSourceId]
    ? projection.views[mediaSourceId].kind
    : null;
  const media = mediaSourceId === 'main'
    ? (doc.meta.media || null)
    : (projectedKind ? { kind: projectedKind } : null);
  const hasVideo = media && media.kind === 'video';
  const hasAudio = media && media.kind === 'audio';
  const setMediaSource = useCallback((el) => {
    mediaElRef.current = el;
    setMediaEl(el);
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      setBox((b) => Math.abs(b.w - (r.width - 32)) > 1 || Math.abs(b.h - (r.height - 32)) > 1
        ? { w: r.width - 32, h: r.height - 32 } : b);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The hidden media element remains the playback clock. Konva reads decoded
  // frames but never owns seeking, volume, or play/pause state.
  useEffect(() => {
    if (!mediaEl) return;
    app.attachMedia(mediaEl);
    const onPlay = () => app.setPlayer((p) => (p.playing ? p : { ...p, playing: true }));
    const onPause = () => app.setPlayer((p) => (p.playing ? { ...p, playing: false } : p));
    mediaEl.addEventListener('play', onPlay);
    mediaEl.addEventListener('pause', onPause);
    mediaEl.addEventListener('ended', onPause);
    let raf;
    const tick = () => {
      const currentProjection = doc.timelineProjection;
      const step = currentProjection && T
        ? T.playbackStep(currentProjection, mediaEl.dataset.clipId, mediaEl.currentTime)
        : { timelineTime: mediaEl.currentTime };
      if (step) {
        if (step.seekSource != null && Math.abs(mediaEl.currentTime - step.seekSource) > 0.0005) {
          try { mediaEl.currentTime = step.seekSource; } catch (e) {}
        }
        app.setPlayer((p) => {
          const ended = step.timelineTime >= doc.meta.duration - 1e-9;
          return Math.abs(p.t - step.timelineTime) > 0.003 || (ended && p.playing)
            ? { ...p, t: step.timelineTime, playing: ended ? false : p.playing }
            : p;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      mediaEl.removeEventListener('play', onPlay);
      mediaEl.removeEventListener('pause', onPause);
      mediaEl.removeEventListener('ended', onPause);
      app.attachMedia(null);
    };
  }, [mediaEl, mediaClipId, doc.timelineProjection]);

  useEffect(() => {
    if (!mediaEl || !hasVideo) {
      setSourceAspect(null);
      return;
    }
    const update = () => {
      const ratio = mediaEl.videoWidth > 0 && mediaEl.videoHeight > 0
        ? mediaEl.videoWidth / mediaEl.videoHeight
        : null;
      setSourceAspect((current) => current === ratio ? current : ratio);
    };
    update();
    mediaEl.addEventListener('loadedmetadata', update);
    mediaEl.addEventListener('resize', update);
    return () => {
      mediaEl.removeEventListener('loadedmetadata', update);
      mediaEl.removeEventListener('resize', update);
    };
  }, [mediaEl, hasVideo]);

  const ratios = {
    Original: sourceAspect || R.LANDSCAPE_ASPECT,
    '16:9': 16 / 9,
    '9:16': 9 / 16,
    '1:1': 1,
    '4:3': 4 / 3,
    '2.35:1': 2.35,
  };
  const frame = R.fitFrame(box.w, box.h, ratios[player.ratio] || ratios.Original);
  const fw = frame.width, fh = frame.height, scale = frame.scale;

  const t = player.t;
  const timing = doc.style.displayTiming || R.DEFAULT_TIMING;
  const cueDisplay = R.activeTimedItem(doc.timelineCues || doc.cues || [], t, timing);
  const sentenceDisplay = R.activeTimedItem(doc.timelineSentences || doc.sentences || [], t, timing);
  const transDisplay = R.activeTimedItem(doc.timelineTransCues || doc.transCues || [], t, timing)
    || (() => {
      const sentence = sentenceDisplay && sentenceDisplay.item;
      return sentence && sentence.trans
        ? {
            ...sentenceDisplay,
            item: {
              ...sentence,
              sid: sentence.id,
              kind: 'sentence',
              sourceText: sentence.text || '',
              text: sentence.trans || '',
            },
          }
        : null;
    })();
  const subtitleCue = cueDisplay && cueDisplay.item;
  const tcue = transDisplay && transDisplay.item;
  const sourceLanguage = doc.meta.sourceLang && doc.meta.sourceLang.code;
  const targetLanguage = doc.meta.targetLang && doc.meta.targetLang.code;
  const cue = app.tab === 'translate'
    ? R.translationSourceCue(tcue, subtitleCue, sourceLanguage)
    : subtitleCue;
  const chapter = app.chapterOf(doc, t);
  const chapterIndex = doc.chapters.indexOf(chapter);
  const hue = [252, 152, 28, 200][chapterIndex % 4] || 252;
  const st = doc.style;
  const mode = app.tab === 'translate' ? 'bi' : st.mode;
  const lines = R.resolveModeLines(mode, st.order);
  const displayStart = app.tab === 'translate'
    ? (transDisplay ? transDisplay.displayStart : Number.POSITIVE_INFINITY)
    : Math.min(
        cueDisplay ? cueDisplay.displayStart : Number.POSITIVE_INFINITY,
        transDisplay ? transDisplay.displayStart : Number.POSITIVE_INFINITY,
      );
  const transcribing = doc.status.phase === 'transcribing';
  const selected = !!(subtitleCue && app.sel
    && app.sel.cueId === (subtitleCue.sourceItemId || subtitleCue.id));
  const cueRef = useRef(subtitleCue);
  const tcueRef = useRef(tcue);
  const tabRef = useRef(app.tab);
  cueRef.current = subtitleCue;
  tcueRef.current = tcue;
  tabRef.current = app.tab;

  useEffect(() => {
    setEditing(null);
  }, [cue && cue.id, tcue && tcue.id]);
  useEffect(() => () => clearTimeout(selectTimerRef.current), []);
  useEffect(() => {
    if (player.playing || app.sel) clickCoordinatorRef.current.reset();
  }, [player.playing, app.sel]);

  const routeCanvasPress = useCallback((options) => {
    const action = clickCoordinatorRef.current.next({
      fullscreen: false,
      playing: !!player.playing,
      hasSelection: !!app.sel,
      hasTarget: !!options.hasTarget,
      targetSelected: !!options.targetSelected,
    });
    if (action === 'pauseAndArm' || action === 'pause') {
      if (mediaElRef.current) mediaElRef.current.pause();
      app.setPlayer((p) => ({ ...p, playing: false }));
    } else if (action === 'play') {
      app.togglePlay();
    } else if (action === 'select') {
      if (options.select) options.select();
    } else if (action === 'clearSelection') {
      app.setSel(null);
    }
    return action;
  }, [player.playing, app.sel, app.setPlayer, app.setSel, app.togglePlay]);

  const selectLine = useCallback((line) => {
    const current = cueRef.current;
    const currentTrans = tcueRef.current;
    if (line === 'orig' && !current) return;
    if (line === 'trans' && !currentTrans) return;
    if (current && (!current.sourceId || current.sourceId === 'main')) {
      app.setSel({ cueId: current.sourceItemId || current.id });
    }
    // Delay the panel switch until the double-click window closes. Switching
    // from translated-only to bilingual preview would otherwise rebuild the
    // Canvas node between the first and second click.
    clearTimeout(selectTimerRef.current);
    selectTimerRef.current = setTimeout(() => {
      app.setTab(line === 'trans' ? 'translate' : 'subtitle');
    }, 350);
  }, [app.setSel, app.setTab]);

  const editLine = useCallback((line, rect, metrics) => {
    const current = cueRef.current;
    const currentTrans = tcueRef.current;
    if (line === 'orig' && !current) return;
    if (line === 'trans' && !currentTrans) return;
    clearTimeout(selectTimerRef.current);
    // The Translate source line is a read-only projection of aligned words,
    // not a Subtitle cue. Move to Subtitle before editing so a double-click
    // can never write the visibly different cue that merely overlaps in time.
    if (line === 'orig' && tabRef.current === 'translate') {
      if (!current.sourceId || current.sourceId === 'main') {
        app.setSel({ cueId: current.sourceItemId || current.id });
      }
      app.setTab('subtitle');
      if (mediaElRef.current) mediaElRef.current.pause();
      app.setPlayer((p) => ({ ...p, playing: false }));
      return;
    }
    app.setTab(line === 'trans' ? 'translate' : 'subtitle');
    if (mediaElRef.current) mediaElRef.current.pause();
    app.setPlayer((p) => ({ ...p, playing: false }));
    setEditing({
      line,
      rect,
      metrics,
      value: line === 'trans' ? ((currentTrans && currentTrans.text) || '') : current.text,
    });
  }, []);

  const commitLine = useCallback((line, value) => {
    setEditing(null);
    if (!value) return;
    if (line === 'trans') {
      const currentTrans = tcueRef.current;
      if (currentTrans && value !== (currentTrans.text || '')) {
        app.editTrans(
          currentTrans.sourceItemId || currentTrans.id,
          currentTrans.kind,
          value,
          currentTrans.sourceId || 'main',
        );
        window.toast('译文已更新', { variant: 'positive' });
      }
      return;
    }
    const current = cueRef.current;
    if (current && value !== current.text) {
      app.editCue(
        current.sourceItemId || current.id,
        'text',
        value,
        current.sourceId || 'main',
      );
      window.toast('字幕已更新', { variant: 'positive' });
    }
  }, [app.editCue, app.editTrans]);

  const moveSubtitle = useCallback((x, y) => {
    app.setStyle({ x, y });
  }, [app.setStyle]);

  const a11yText = [
    tcue && R.projectPunctuation(tcue.text, targetLanguage, st.punct !== false),
    cue && R.projectPunctuation(cue.text, sourceLanguage, st.punct !== false),
  ].filter(Boolean).join(' / ');

  return (
    <div className="vk-stage" data-screen-label="Video stage">
      <div className="vk-stage__area" ref={stageRef}>
        <div className="vk-frame" style={{ width: fw, height: fh }}>
          {hasVideo ? (
            <video
              key={`video:${mediaSourceId}:${mediaClipId}`}
              className="bcs-media-source"
              ref={setMediaSource}
              src={T ? T.mediaURL(mediaSourceId) : '__bcut/media'}
              data-src-id={mediaSourceId}
              data-clip-id={mediaClipId}
              playsInline
              preload="auto"
            />
          ) : hasAudio ? (
            <audio
              key={`audio:${mediaSourceId}:${mediaClipId}`}
              className="bcs-media-source"
              ref={setMediaSource}
              src={T ? T.mediaURL(mediaSourceId) : '__bcut/media'}
              data-src-id={mediaSourceId}
              data-clip-id={mediaClipId}
              preload="auto"
            ></audio>
          ) : null}

          <KonvaPreview
            width={fw}
            height={fh}
            mediaEl={mediaEl}
            hasVideo={hasVideo}
            hasAudio={hasAudio}
            hue={hue}
            cue={cue}
            tcue={tcue}
            sourceLanguage={sourceLanguage}
            targetLanguage={targetLanguage}
            lines={lines}
            style={st}
            scale={scale}
            t={t}
            playing={player.playing}
            displayStart={Number.isFinite(displayStart) ? displayStart : t}
            selected={selected}
            showSubs={player.showSubs}
            transcribing={transcribing}
            editingLine={editing && editing.line}
            onCanvasPress={routeCanvasPress}
            onSelectLine={selectLine}
            onEditLine={editLine}
            onMove={moveSubtitle}
          />

          {editing ? (
            <CanvasTextEditor
              edit={editing}
              frameWidth={fw}
              frameHeight={fh}
              onCommit={(value) => commitLine(editing.line, value)}
              onCancel={() => setEditing(null)}
            />
          ) : null}

          <span className="bcs-canvas-a11y" aria-live="polite">{a11yText}</span>

          {transcribing ? (
            <div className="bcs-stagebadge">
              <span className="vk-spin"></span>
              转录中 · {Math.round(doc.status.pct || 0)}%
            </div>
          ) : null}

          <div className="vk-frame__label vk-frame__label--overlay" style={{ fontSize: 13 * scale + 6 }}>
            <span className="vk-mono">{fmtT(t)}</span>
            {chapter ? <span className="vk-frame__chip">{chapter.title}</span> : null}
          </div>
        </div>
      </div>

      <div className="vk-stagebar">
        <span className="bcs-stagebar__hint vk-dim">Canvas 预览 · 单击画面播放/暂停 · 暂停后选中字幕 · 选中后可拖拽或双击编辑</span>
        <span className="vk-spacer"></span>
        <QBtn
          icon="captions"
          size="S"
          tip={player.showSubs ? '隐藏字幕' : '显示字幕'}
          tipDir="up"
          selected={player.showSubs}
          onClick={() => app.setPlayer((p) => ({ ...p, showSubs: !p.showSubs }))}
        />
        <QBtn
          refEl={volRef}
          icon={player.muted || player.vol === 0 ? 'volume-mute' : player.vol < 0.5 ? 'volume-low' : 'volume'}
          size="S"
          tip="音量"
          tipDir="up"
          onClick={() => setVolOpen(true)}
        />
        {volOpen ? (
          <Pop anchorRef={volRef} onClose={() => setVolOpen(false)} dir="up" width={210}>
            <div className="vk-row">
              <QBtn
                icon={player.muted ? 'volume-mute' : 'volume'}
                size="S"
                tip={player.muted ? '取消静音' : '静音'}
                onClick={() => app.setPlayer((p) => ({ ...p, muted: !p.muted }))}
              />
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={player.muted ? 0 : player.vol}
                style={{ flex: 1 }}
                onChange={(e) => app.setPlayer((p) => ({ ...p, vol: parseFloat(e.target.value), muted: false }))}
                aria-label="音量"
              />
              <span className="vk-mono vk-dim" style={{ width: 28, textAlign: 'right', fontSize: 11 }}>
                {Math.round((player.muted ? 0 : player.vol) * 100)}
              </span>
            </div>
          </Pop>
        ) : null}
        <QBtn refEl={ratioRef} icon="ratio" size="S" tip="画幅比例" tipDir="up" onClick={() => setRatioOpen(true)} />
        {ratioOpen ? (
          <Menu
            anchorRef={ratioRef}
            onClose={() => setRatioOpen(false)}
            dir="up"
            align="end"
            width={150}
            items={Object.keys(ratios).map((ratio) => ({
              label: ratio === 'Original' ? '原始比例' : ratio,
              suffix: player.ratio === ratio ? '✓' : undefined,
              onClick: () => app.setPlayer((p) => ({ ...p, ratio })),
            }))}
          />
        ) : null}
      </div>
    </div>
  );
}

window.StagePane = StagePane;
})();
