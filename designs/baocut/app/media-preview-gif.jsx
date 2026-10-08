/* GIF 解码、分帧与逐帧批注。产品设计 §3.3。 */
(function () {
  const R = window.RSP;
  function useMediaGif(file, active) {
    const app = useApp(),
      isGif = /\.gif(?:[?#]|$)/i.test(file.previewSrc),
      [data, setData] = React.useState(null),
      [error, setError] = React.useState(null),
      [retry, setRetry] = React.useState(0);
    const saved = app.workspaceMediaState.gifs?.[file.id] || { frame: 0, speed: 1, playing: false, view: 'single' };
    const current = React.useRef(saved);
    current.current = saved;
    const update = (patch) =>
      app.updateWorkspaceMediaState((old) => ({ ...old, gifs: { ...old.gifs, [file.id]: { ...saved, ...patch } } }));
    const callback = React.useRef(update);
    callback.current = update;
    React.useEffect(() => {
      setData(null);
      setError(null);
      if (!isGif) return;
      const abort = new AbortController();
      let loaded;
      window
        .decodeMediaGif(file.previewSrc, abort.signal)
        .then((result) => {
          if (abort.signal.aborted) {
            result.dispose();
            return;
          }
          loaded = result;
          setData(result);
        })
        .catch((error) => {
          if (!abort.signal.aborted) setError(error.message);
        });
      return () => {
        abort.abort();
        loaded?.dispose();
      };
    }, [file.id, file.previewSrc, isGif, retry]);
    React.useEffect(() => {
      if (!active || !data || !saved.playing) return;
      let tick,
        last = performance.now(),
        elapsed = 0;
      const advance = (now) => {
        elapsed += Math.min(1000, now - last) * current.current.speed;
        last = now;
        let frame = current.current.frame;
        while (elapsed >= data.frames[frame].duration) {
          elapsed -= data.frames[frame].duration;
          frame = (frame + 1) % data.frames.length;
        }
        if (frame !== current.current.frame) {
          current.current = { ...current.current, frame };
          callback.current({ frame });
        }
        tick = requestAnimationFrame(advance);
      };
      tick = requestAnimationFrame(advance);
      return () => cancelAnimationFrame(tick);
    }, [active, data, saved.playing, saved.speed]);
    React.useEffect(() => {
      if (!active && saved.playing) callback.current({ playing: false });
    }, [active]);
    return { isGif, data, error, ...saved, update, retry: () => setRetry((n) => n + 1) };
  }
  function MediaGifControls({ file, gif, onQueue, comments }) {
    const app = useApp(),
      [pending, setPending] = React.useState(false);
    if (gif.error)
      return (
        <div className="media-preview__notice" role="status">
          {gif.error}
          <R.ActionButton onPress={gif.retry}>重试分帧</R.ActionButton>
        </div>
      );
    if (!gif.data)
      return (
        <div className="media-preview__notice" role="status">
          正在读取 GIF 帧…
        </div>
      );
    const frame = gif.data.frames[gif.frame],
      count = Object.entries(comments)
        .filter(([key]) => key.startsWith(`${file.id}:frame:`))
        .reduce((n, [, items]) => n + items.length, 0);
    const queue = async () => {
      setPending(true);
      try {
        const sheet = await window.mediaGifSheet(gif.data);
        const instruction = gif.data.frames
          .map((_, i) => {
            const items = comments[`${file.id}:frame:${i}`] || [];
            return items.length
              ? `第 ${i + 1} 帧：\n${items.map((c) => `位置 ${Math.round(c.region.x * 100)}%, ${Math.round(c.region.y * 100)}%；区域 ${Math.round(c.region.width * 100)}% × ${Math.round(c.region.height * 100)}%：${c.text}`).join('\n')}`
              : null;
          })
          .filter(Boolean)
          .join('\n');
        onQueue(
          [
            { name: file.name, url: file.previewSrc },
            { name: 'GIF 分帧联系表.png', url: sheet }
          ],
          `请根据以下逐帧批注重新制作 GIF「${file.file}」，所有帧保持相同尺寸，以原速度的 ${gif.speed} 倍播放。生成新文件并保留原图。坐标相对每一帧：\n${instruction}`
        );
      } catch (error) {
        app.toast(error.message, 'negative');
      } finally {
        setPending(false);
      }
    };
    return (
      <div className="media-gif-controls">
        <div className="media-preview__toolbar">
          <R.ActionButton onPress={() => gif.update({ playing: !gif.playing, view: 'single' })}>
            {gif.playing ? '暂停动图' : '播放动图'}
          </R.ActionButton>
          <R.ActionButton isDisabled={gif.frame === 0} onPress={() => gif.update({ frame: gif.frame - 1, playing: false })}>
            上一帧
          </R.ActionButton>
          <span>
            第 {gif.frame + 1} / {gif.data.frames.length} 帧 · {Math.round(frame.duration / gif.speed)} ms
          </span>
          <R.ActionButton
            isDisabled={gif.frame === gif.data.frames.length - 1}
            onPress={() => gif.update({ frame: gif.frame + 1, playing: false })}
          >
            下一帧
          </R.ActionButton>
          <R.ToggleButton
            isSelected={gif.view === 'sheet'}
            onChange={(selected) => gif.update({ view: selected ? 'sheet' : 'single', playing: false })}
          >
            分帧网格
          </R.ToggleButton>
          <R.Picker
            aria-label="GIF 播放速度"
            selectedKey={String(gif.speed)}
            onSelectionChange={(speed) => gif.update({ speed: Number(speed) })}
          >
            {[0.25, 0.5, 1, 1.5, 2].map((speed) => (
              <R.PickerItem key={speed} id={String(speed)}>
                {speed}×
              </R.PickerItem>
            ))}
          </R.Picker>
          <R.ActionButton
            onPress={() =>
              window
                .copyMediaImage(frame.url)
                .then(() => app.toast('当前帧已复制。'))
                .catch((e) => app.toast(e.message, 'negative'))
            }
          >
            复制当前帧
          </R.ActionButton>
          <R.ActionButton onPress={() => window.downloadMedia(frame.blob, `frame-${gif.frame + 1}.png`)}>下载当前帧</R.ActionButton>
          <R.ActionButton
            onPress={() => {
              try {
                window.downloadMedia(new Blob([window.BC_MEDIA_GIF.retime(gif.data.bytes, gif.speed)], { type: 'image/gif' }), file.name);
              } catch (e) {
                app.toast(e.message, 'negative');
              }
            }}
          >
            下载变速 GIF
          </R.ActionButton>
          {window.BC_SURFACE.ai && (
            <R.Button variant="primary" isDisabled={!count || pending} onPress={queue}>
              逐帧批注加入草稿（{count}）
            </R.Button>
          )}
        </div>
        <R.Slider
          aria-label="GIF 帧"
          minValue={0}
          maxValue={gif.data.frames.length - 1 || 1}
          step={1}
          value={gif.frame}
          onChange={(frame) => gif.update({ frame, playing: false })}
        />
      </div>
    );
  }
  function MediaGifSheet({ gif }) {
    return (
      <div className="media-gif-sheet" role="group" aria-label="GIF 分帧网格">
        {gif.data.frames.map((frame, index) => (
          <R.ActionButton
            key={index}
            aria-label={`查看第 ${index + 1} 帧`}
            UNSAFE_className="media-gif-sheet__frame"
            onPress={() => gif.update({ frame: index, view: 'single', playing: false })}
          >
            <img src={frame.url} alt="" />
            <span>{index + 1}</span>
          </R.ActionButton>
        ))}
      </div>
    );
  }
  Object.assign(window, { useMediaGif, MediaGifControls, MediaGifSheet });
})();
