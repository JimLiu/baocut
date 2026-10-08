/* 远程示例视频：媒体时间跟随编辑器时间轴；暂停、定位、倍速、静音复用现有控件。
   仅预览，不把浏览器播放冒充 bcut render 或导出。 */
(function () {
  function RemoteVideo({source, el, ctx, style, fillH}) {
    const ref = React.useRef(null);
    const [ready, setReady] = React.useState(false);
    const [error, setError] = React.useState(false);
    const desired = window.BC_VIDEO_EDIT.sourceTime(el, ctx.playT);
    const sync = () => {
      const video = ref.current;
      if (!video || !video.readyState) return;
      const target = Math.min(desired, video.duration || desired);
      if (Math.abs(video.currentTime - target) > (ctx.playing ? 0.35 : 0.02)) video.currentTime = target;
      video.playbackRate = ctx.speed;
      video.volume = Math.min(1, Math.max(0, ctx.vol / 100 * (style.vol == null ? 1 : style.vol / 100)));
      video.muted = !!(ctx.muted || el.muted || style.muted || style.vol === 0);
    };
    React.useEffect(sync, [desired, ready, ctx.playing, ctx.speed, ctx.vol, ctx.muted, el.muted, style.vol, style.muted]);
    React.useEffect(() => {
      const video = ref.current;
      if (!video || !ready) return;
      let cancelled = false;
      if (ctx.playing) video.play().catch(() => {
        if (!cancelled) {
          ctx.setPlaying(false);
          setError(true);
        }
      });
      else video.pause();
      return () => { cancelled = true; video.pause(); };
    }, [ctx.playing, ready, source.url]);
    return <span style={{display: 'block', position: 'relative', width: '100%', height: fillH ? '100%' : null}}>
      <video ref={ref} src={source.url} poster={source.poster} preload="auto" playsInline
        aria-label={source.name} onLoadedMetadata={() => {setReady(true); setError(false);}}
        onError={() => {setError(true); ctx.setPlaying(false);}}
        style={{display: 'block', width: '100%', height: fillH ? '100%' : 'auto',
          objectFit: 'contain', filter: window.BC_EL.fxCss(style) || null}} />
      {error ? <span className="signpost" role="alert">视频加载或播放失败，请检查网络后重新打开视频。</span> : null}
    </span>;
  }
  window.RemoteVideo = RemoteVideo;
})();
