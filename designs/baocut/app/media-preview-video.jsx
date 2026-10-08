/* 正文、标签与展开弹层共用一个播放器，移交完整播放状态。产品设计 §3.3。 */
(function () {
  const R = window.RSP,
    M = window.BC_MEDIA_PREVIEW,
    IconButton = window.MediaIconButton,
    Seek = window.MediaSeek,
    transfers = new Map(),
    positions = new Map();
  const rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const clock = (n) => `${Math.floor((n || 0) / 60)}:${String(Math.floor((n || 0) % 60)).padStart(2, '0')}`;
  function restore(media, state, resume = true) {
    if (!media || !state) return;
    media.volume = Math.max(0, Math.min(1, state.volume));
    media.muted = state.muted;
    media.playbackRate = state.rate;
    media.currentTime = Math.max(0, Math.min(state.time, Number.isFinite(media.duration) ? media.duration : state.time));
    if (resume && !state.paused) media.play().catch(() => {});
    else media.pause();
  }
  function VideoSurface({ file, active = true, initial, onExpand, onOpenTab, onElement, onPlaybackChange }) {
    const app = useApp(),
      ref = React.useRef(null),
      root = React.useRef(null),
      scrub = React.useRef(null);
    const [state, setState] = React.useState({ time: 0, duration: 0, paused: true, volume: 1, muted: false, rate: 1 }),
      [error, setError] = React.useState(null),
      [fullscreen, setFullscreen] = React.useState(false),
      [pictureInPicture, setPictureInPicture] = React.useState(false),
      [retry, setRetry] = React.useState(0);
    const portalContainer = React.useCallback(() => (fullscreen ? root.current : document.body), [fullscreen]);
    const read = () => {
      const e = ref.current;
      if (e) {
        const state = M.playback(e);
        setState({ ...state, duration: Number.isFinite(e.duration) ? e.duration : 0 });
        onPlaybackChange?.(state);
      }
    };
    React.useEffect(() => {
      const update = () => setFullscreen(document.fullscreenElement === root.current);
      document.addEventListener('fullscreenchange', update);
      return () => document.removeEventListener('fullscreenchange', update);
    }, []);
    React.useEffect(() => {
      const e = ref.current;
      if (!e) return;
      if (!active) {
        positions.set(file.id, { ...M.playback(e), paused: true });
        e.pause();
      } else if (e.readyState && transfers.has(file.id)) {
        restore(e, transfers.get(file.id));
        transfers.delete(file.id);
      }
    }, [active, file.id]);
    React.useEffect(() => {
      const e = ref.current;
      return () => {
        if (e) {
          positions.set(file.id, { ...M.playback(e), paused: true });
          e.pause();
        }
      };
    }, [file.id, retry]);
    React.useEffect(() => {
      const element = ref.current;
      if (!element) return;
      const entered = () => setPictureInPicture(true),
        left = () => setPictureInPicture(false);
      element.addEventListener('enterpictureinpicture', entered);
      element.addEventListener('leavepictureinpicture', left);
      return () => {
        element.removeEventListener('enterpictureinpicture', entered);
        element.removeEventListener('leavepictureinpicture', left);
      };
    }, [file.id, retry]);
    const toggle = () => {
      const e = ref.current;
      if (!e) return;
      e.paused ? e.play().catch(() => setError('无法开始播放，请重试。')) : e.pause();
    };
    const seek = (n) => {
      if (ref.current) {
        ref.current.currentTime = n;
        read();
      }
    };
    const enter = () => {
      if (!root.current.requestFullscreen) {
        app.toast('这个环境不支持全屏。', 'negative');
        return;
      }
      const promise = fullscreen ? document.exitFullscreen() : root.current.requestFullscreen();
      promise.catch((error) => {
        console.warn('Video fullscreen request failed', error);
        app.toast('无法切换全屏，请重试。', 'negative');
      });
    };
    const pip = () => {
      const e = ref.current;
      const promise = document.pictureInPictureElement === e ? document.exitPictureInPicture() : e.requestPictureInPicture();
      promise.catch(() => app.toast('无法打开画中画，请重试。', 'negative'));
    };
    const beginScrub = () => {
      const e = ref.current;
      if (scrub.current === null && e) {
        scrub.current = !e.paused;
        e.pause();
      }
    };
    const endScrub = () => {
      const resume = scrub.current;
      scrub.current = null;
      if (resume && active) ref.current?.play().catch(() => setError('无法恢复播放，请重试。'));
    };
    const metadata = () => {
      const e = ref.current,
        transfer = transfers.get(file.id);
      restore(e, transfer || initial || positions.get(file.id), active);
      if (transfer) transfers.delete(file.id);
      read();
      onElement?.(e);
    };
    return (
      <R.UNSAFE_PortalProvider getContainer={portalContainer}>
        <section ref={root} className="media-video" aria-label={`视频播放器：${file.name}`}>
          {error ? (
            <div className="media-preview__notice" role="alert">
              {error}
              <R.ActionButton
                onPress={() => {
                  setError(null);
                  setRetry((n) => n + 1);
                }}
              >
                重试
              </R.ActionButton>
            </div>
          ) : (
            <video
              key={`${file.id}:${retry}`}
              ref={ref}
              src={file.previewSrc}
              poster={file.poster}
              preload="metadata"
              playsInline
              data-bc-media-preview=""
              aria-label={file.name}
              tabIndex={0}
              onLoadedMetadata={metadata}
              onDurationChange={read}
              onTimeUpdate={read}
              onPause={read}
              onEnded={read}
              onVolumeChange={read}
              onRateChange={read}
              onClick={toggle}
              onPlay={(e) => {
                window.pausePreviewMediaExcept(e.currentTarget);
                read();
              }}
              onError={() => setError('视频未能加载，请重试或用默认应用打开。')}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  if (!e.repeat) toggle();
                } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  seek(Math.max(0, Math.min(state.duration, state.time + (e.key === 'ArrowRight' ? 5 : -5))));
                }
              }}
            />
          )}
          <div className="media-video__controls">
            <IconButton label={state.paused ? '播放视频' : '暂停视频'} onPress={toggle} isDisabled={!!error}>
              {state.paused ? <R.Icons.Play /> : <R.Icons.Pause />}
            </IconButton>
            <Seek
              label="视频进度"
              time={state.time}
              duration={state.duration}
              disabled={!!error}
              onSeek={seek}
              onStart={beginScrub}
              onEnd={endScrub}
            />
            <span className="media-control-time">
              {clock(state.time)} / {clock(state.duration)}
            </span>
            <R.DialogTrigger>
              <IconButton label="视频音量" isDisabled={!!error}>
                {state.muted || state.volume === 0 ? <R.Icons.VolumeOff /> : <R.Icons.VolumeTwo />}
              </IconButton>
              <R.Popover placement="top" hideArrow padding="none" aria-label="视频音量" UNSAFE_className="media-volume-popover">
                <IconButton
                  label={state.muted ? '取消静音' : '静音'}
                  onPress={() => {
                    ref.current.muted = !state.muted;
                  }}
                >
                  {state.muted || state.volume === 0 ? <R.Icons.VolumeOff /> : <R.Icons.VolumeTwo />}
                </IconButton>
                <R.Slider
                  size="S"
                  aria-label="音量"
                  minValue={0}
                  maxValue={1}
                  step={0.05}
                  value={state.muted ? 0 : state.volume}
                  formatOptions={{ style: 'percent' }}
                  UNSAFE_className="media-control-slider"
                  onChange={(value) => {
                    ref.current.volume = value;
                    ref.current.muted = false;
                  }}
                />
              </R.Popover>
            </R.DialogTrigger>
            <R.MenuTrigger align="end" direction="top">
              <IconButton label="视频选项">
                <R.Icons.More />
              </IconButton>
              <R.Menu
                size="S"
                UNSAFE_className="media-options-menu"
                disabledKeys={[
                  ...(!document.pictureInPictureEnabled || !HTMLVideoElement.prototype.requestPictureInPicture ? ['pip'] : []),
                  ...(error ? ['pip', 'expand', ...rates.map(String)] : [])
                ]}
                onAction={(key) => {
                  if (key === 'save') window.savePreviewMedia(file);
                  if (key === 'pip') pip();
                  if (key === 'expand') onExpand?.(ref.current);
                  if (key === 'tab') {
                    if (fullscreen)
                      document
                        .exitFullscreen()
                        .then(onOpenTab)
                        .catch(() => app.toast('无法退出全屏，请重试。', 'negative'));
                    else onOpenTab?.();
                  }
                }}
              >
                <R.MenuSection>
                  <R.MenuItem id="save">另存视频…</R.MenuItem>
                </R.MenuSection>
                <R.MenuSection
                  selectionMode="single"
                  selectedKeys={[String(state.rate)]}
                  onSelectionChange={(keys) => {
                    const rate = Number([...keys][0]);
                    if (rates.includes(rate) && ref.current) ref.current.playbackRate = rate;
                  }}
                >
                  <R.Header>播放速度</R.Header>
                  {rates.map((rate) => (
                    <R.MenuItem key={rate} id={String(rate)}>
                      <R.Text slot="label">{rate}×</R.Text>
                    </R.MenuItem>
                  ))}
                </R.MenuSection>
                <R.MenuSection>
                  <R.MenuItem id="pip">{pictureInPicture ? '退出画中画' : '画中画'}</R.MenuItem>
                  {onExpand && !fullscreen && !pictureInPicture && <R.MenuItem id="expand">展开预览</R.MenuItem>}
                  {onOpenTab && <R.MenuItem id="tab">在标签页打开</R.MenuItem>}
                </R.MenuSection>
              </R.Menu>
            </R.MenuTrigger>
            <IconButton label={fullscreen ? '退出全屏' : '全屏'} onPress={enter} isDisabled={pictureInPicture}>
              {fullscreen ? <R.Icons.FullScreenExit /> : <R.Icons.FullScreen />}
            </IconButton>
          </div>
        </section>
      </R.UNSAFE_PortalProvider>
    );
  }
  function MediaVideoPreview({ file, active = true, inline = false }) {
    const app = useApp(),
      ref = React.useRef(null),
      overlay = React.useRef(null),
      overlayPlayback = React.useRef(null),
      activeRef = React.useRef(active);
    const [expanded, setExpanded] = React.useState(null);
    activeRef.current = active;
    React.useEffect(() => {
      if (!active && expanded) {
        overlay.current?.pause();
        setExpanded(null);
      }
    }, [active]);
    const openTab = () => {
      const e = ref.current;
      if (e) {
        const state = M.playback(e);
        e.pause();
        transfers.set(file.id, state);
      }
      app.openWorkspaceFile(file.id);
    };
    const expand = (e) => {
      if (!e) return;
      const state = M.playback(e);
      e.pause();
      overlayPlayback.current = state;
      setExpanded(state);
    };
    const close = () => {
      const state = overlayPlayback.current || (overlay.current ? M.playback(overlay.current) : expanded);
      overlay.current?.pause();
      if (state && activeRef.current) transfers.set(file.id, state);
      setExpanded(null);
    };
    const content = (
      <VideoSurface
        file={file}
        active={active && !expanded}
        onElement={(e) => {
          ref.current = e;
        }}
        onExpand={expand}
        onOpenTab={inline ? openTab : undefined}
      />
    );
    return (
      <>
        <span className={inline ? 'amd-media media-video-inline' : 'media-video-tab'}>{content}</span>
        {expanded && (
          <BCModal title={`视频预览：${file.name}`} size="L" onClose={close}>
            <div className="media-video-dialog">
              <div className="media-preview__toolbar">
                <strong>{file.name}</strong>
                <R.ActionButton onPress={close}>关闭预览</R.ActionButton>
              </div>
              <VideoSurface
                file={file}
                active={active}
                initial={expanded}
                onPlaybackChange={(state) => {
                  overlayPlayback.current = state;
                }}
                onElement={(e) => {
                  overlay.current = e;
                }}
              />
            </div>
          </BCModal>
        )}
      </>
    );
  }
  window.MediaVideoPreview = MediaVideoPreview;
  /* 会话里的视频卡在卡里原地播（home-session.jsx）：只要播放器本身，不要展开与标签页。 */
  window.MediaVideoSurface = VideoSurface;
})();
