/* 音频正文卡：文件头、播放与菜单，底部一行进度及时间。产品设计 §3.3。 */
(function () {
  const R = window.RSP,
    IconButton = window.MediaIconButton,
    Seek = window.MediaSeek,
    clock = window.mediaClock,
    positions = new Map();
  function MediaAudioPreview({ file, active = true, inline = false }) {
    const app = useApp(),
      ref = React.useRef(null),
      scrub = React.useRef(null);
    const [state, setState] = React.useState({ time: 0, duration: 0, paused: true, ready: false }),
      [error, setError] = React.useState(null),
      [retry, setRetry] = React.useState(0);
    const path = window.BC_MEDIA_PREVIEW.filePath(file, app.dirById(file.dir)?.path);
    const read = () => {
      const media = ref.current;
      if (media)
        setState({
          time: media.currentTime,
          duration: Number.isFinite(media.duration) ? media.duration : 0,
          paused: media.paused,
          ready: media.readyState > 0
        });
    };
    React.useEffect(() => {
      if (!active) ref.current?.pause();
    }, [active]);
    React.useEffect(() => {
      const media = ref.current;
      return () => {
        if (media) {
          positions.set(file.id, media.currentTime);
          media.pause();
        }
      };
    }, [file.id, retry]);
    const toggle = () => {
      const media = ref.current;
      if (!media) return;
      media.paused ? media.play().catch(() => setError('无法播放音频，请重试。')) : media.pause();
    };
    const seek = (time) => {
      if (ref.current) {
        ref.current.currentTime = time;
        read();
      }
    };
    const start = () => {
      if (scrub.current === null && ref.current) {
        scrub.current = !ref.current.paused;
        ref.current.pause();
      }
    };
    const end = () => {
      const resume = scrub.current;
      scrub.current = null;
      if (resume && active) ref.current?.play().catch(() => setError('无法恢复播放，请重试。'));
    };
    const action = (id) => {
      if (id === 'copy')
        navigator.clipboard
          .writeText(path)
          .then(() => app.toast('已复制路径。'))
          .catch(() => app.toast('无法复制路径，请重试。', 'negative'));
      if (id === 'save') window.savePreviewMedia(file);
    };
    return (
      <span className={inline ? 'amd-media media-audio-inline' : 'media-audio-tab'}>
        <span className="media-audio" role="group" aria-label={`音频播放器：${file.name}`}>
          <span className="media-audio__head">
            <span className="media-audio__icon" aria-hidden="true">
              <R.Icons.AudioWave />
            </span>
            <span className="media-audio__meta">
              <strong title={file.name}>{file.name}</strong>
              <span>
                {error ? '音频不可用' : state.ready ? `${(file.file || file.name).split('.').pop().toUpperCase()} 音频` : '正在加载音频…'}
              </span>
            </span>
            <IconButton label={state.paused ? '播放音频' : '暂停音频'} isDisabled={!state.ready || !!error} onPress={toggle}>
              {state.paused ? <R.Icons.Play /> : <R.Icons.Pause />}
            </IconButton>
            <R.MenuTrigger align="end">
              <IconButton label="音频选项">
                <R.Icons.More />
              </IconButton>
              <R.Menu size="S" UNSAFE_className="media-options-menu" onAction={action} disabledKeys={error ? ['save'] : []}>
                <R.MenuItem id="copy">
                  <R.Icons.Copy />
                  <R.Text>复制路径</R.Text>
                </R.MenuItem>
                <R.MenuItem id="save">
                  <R.Icons.Download />
                  <R.Text>另存副本…</R.Text>
                </R.MenuItem>
              </R.Menu>
            </R.MenuTrigger>
          </span>
          {error ? (
            <span className="media-audio__error" role="status">
              {error}
              <R.ActionButton
                size="XS"
                isQuiet
                onPress={() => {
                  setError(null);
                  setState({ ...state, ready: false });
                  setRetry((n) => n + 1);
                }}
              >
                重试
              </R.ActionButton>
            </span>
          ) : (
            <span className="media-audio__footer">
              <Seek label="音频进度" time={state.time} duration={state.duration} onSeek={seek} onStart={start} onEnd={end} emphasized />
              <span className="media-control-time">
                {clock(state.time)} / {clock(state.duration)}
              </span>
            </span>
          )}
          <audio
            key={`${file.id}:${retry}`}
            ref={ref}
            src={file.previewSrc}
            preload="metadata"
            hidden
            data-bc-media-preview=""
            onLoadedMetadata={() => {
              const media = ref.current;
              media.currentTime = Math.min(positions.get(file.id) || 0, Number.isFinite(media.duration) ? media.duration : 0);
              read();
            }}
            onDurationChange={read}
            onTimeUpdate={read}
            onPause={read}
            onEnded={read}
            onPlay={(e) => {
              window.pausePreviewMediaExcept(e.currentTarget);
              read();
            }}
            onError={() => setError('音频未能加载，请重试。')}
          />
        </span>
      </span>
    );
  }
  window.MediaAudioPreview = MediaAudioPreview;
})();
