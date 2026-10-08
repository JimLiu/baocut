/* 紧凑媒体控件。播放布局参考 Codex ref，控件与无障碍语义使用 React Spectrum S2。 */
(function () {
  const R = window.RSP;
  const clock = (value) => {
    const n = Number.isFinite(value) ? Math.max(0, value) : 0;
    return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
  };
  function MediaIconButton({ label, children, ...props }) {
    return (
      <R.ActionButton size="XS" isQuiet aria-label={label} title={label} UNSAFE_className="media-control-button" {...props}>
        {children}
      </R.ActionButton>
    );
  }
  function MediaSeek({ label, time, duration, onSeek, onStart, onEnd, emphasized = false, disabled = false }) {
    return (
      <div
        className="media-control-seek"
        onPointerDownCapture={onStart}
        onPointerUp={onEnd}
        onPointerCancel={onEnd}
        onLostPointerCapture={onEnd}
      >
        <R.Slider
          size="S"
          aria-label={label}
          minValue={0}
          maxValue={duration || 1}
          step={0.1}
          value={Math.min(time, duration || 1)}
          isDisabled={disabled || !duration}
          isEmphasized={emphasized}
          formatOptions={{ style: 'unit', unit: 'second' }}
          UNSAFE_className="media-control-slider"
          onChange={onSeek}
          onChangeEnd={onEnd}
        />
      </div>
    );
  }
  function saveMedia(file) {
    const anchor = document.createElement('a');
    anchor.href = file.previewSrc;
    anchor.download = file.name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }
  function pauseMediaExcept(current) {
    document.querySelectorAll('video[data-bc-media-preview], audio[data-bc-media-preview]').forEach((media) => {
      if (media !== current) media.pause();
    });
  }
  Object.assign(window, {
    MediaIconButton,
    MediaSeek,
    mediaClock: clock,
    savePreviewMedia: saveMedia,
    pausePreviewMediaExcept: pauseMediaExcept
  });
})();
