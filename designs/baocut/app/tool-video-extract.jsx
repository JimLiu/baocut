/* 工具 › 视频文件 › 提取音频（product-design §2.7 表二「提取音频」）。
   从本机或 Space 里的一个视频文件里取出声音：有音轨时去掉画面，能原样拷贝的编码不重新编码
   （AAC → .m4a、MP3 → .mp3、Opus → .ogg、FLAC → .flac），其余转成 AAC（.m4a）；没有音轨时失败，错误码 TRANSCODE_NO_AUDIO。
   结果是保存位置里的一个音频文件、Space 里的一个音频条目，可以接着新建视频或加到视频。
   规则与命令在 model-tool-extract.js（BC_TOOL_EXTRACT）；页面外壳、队列与保存位置在 tool-video.jsx（VideoToolShell）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = window.BC_VIDEO;
  const EX = window.BC_TOOL_EXTRACT;

  function ExtractToolPage() {
    const app = useApp();
    const s = window.useVideoStore();
    const Q = window.BC_VIDEO_QUEUE;
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const [src, setSrc] = useState(Q.store.drafts.extract || null);
    const input = useRef(null);
    const goRef = useRef(null);
    useEffect(() => { Q.store.drafts.extract = src; }, [src]);
    Q.useCmdEnter(goRef);
    /* 「接着用工具」/ Space 查看器带来的视频文件，或「再做一次」带回的源 */
    useEffect(() => {
      const p = app.takeToolPreset('extract');
      if (p && p.params && p.params.src) setSrc(p.params.src);
      else if (p && p.entry) setSrc(EX.fromEntry(p.entry));
    }, [app.toolPreset]);

    const st = V.ffmpegState(s.env);
    const ready = st.stage === 'ready' || st.stage === 'update';
    const gate = Q.ffmpegGate(st);
    const fmt = src ? EX.formatOf(src) : null;
    const name = src && fmt ? EX.outputName(src.name, fmt.ext) : null;
    const reason = gate || (!src ? '先选一个视频文件' : null);
    const pick = (files) => window.videoProbeFile(files[0]).then(setSrc);
    const go = () => {
      if (reason) { app.toast(reason); return; }
      window.videoEnqueue(app, 'extract', {src}, save.dir);
    };
    goRef.current = go;
    const status = reason || (fmt ? `${name} · ${fmt.copy ? '原样拷贝' : '转成 AAC'}` : `${src.name} 里没有音轨`);
    const bar = (<>
      <span className={cx('t-detail pagenav__note', gate ? 'vw__err' : null)} title={status}>{status}</span>
      <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
      <Btn variant="accent" icon="wave" disabled={!ready || !src} onClick={go}>提取音频</Btn>
    </>);
    const reuse = (r) => {
      if (r.kind !== 'extract') { app.go({r: 'tools', id: r.kind}); return; }
      setSrc(r.source);
      app.toast(`已带回 ${r.source.name}`);
    };
    const fix = (k, r) => {
      if (k === 'relocateInput') { setSrc(null); input.current.click(); return; }
      if (k === 'retry') { s.setOutcome('ok'); window.videoRequeue(app, r); return; }
      if (k === 'setupFfmpeg' || k === 'updateFfmpeg') { s.setEnv(k === 'setupFfmpeg' ? 'missing' : 'update'); app.toast('上面那张卡里可以装 / 升 ffmpeg'); return; }
      if (r.kind !== 'extract') { app.go({r: 'tools', id: r.kind}); return; }
      app.toast(V.FIXES[k].label + ' · 交互演示到这里');
    };

    return (
      <window.VideoToolShell tool="extract" title="提取音频" bar={bar} s={s} save={save} onReuse={reuse} onFix={fix}>
        <section className="vw__sec">
          {src ? (
            <div className="vsrc">
              <span className="vsrc__ic"><Ic n="film" className="ic--22" /></span>
              <span className="vsrc__txt">
                <b className="t-title-sm t-truncate">{src.name}</b>
                <span className="t-detail-xs">{V.sourceLine(src)}</span>
              </span>
              <Btn variant="quiet" size="s" onClick={() => input.current.click()}>换一个</Btn>
              <IconBtn icon="close" size="s" tip="移出" onClick={() => setSrc(null)} />
            </div>
          ) : <window.VideoDropZone onFiles={pick} icon="wave" title="把视频拖进来" sub="取出其中的声音，保存成一个音频文件。支持 mp4 / mov / mkv / webm 等常见格式。" />}
          {src ? null : <window.VideoSpacePick tool="extract" onPick={setSrc} label="或者从 Space 里选一个视频文件…" />}
          <input ref={input} type="file" accept={window.VIDEO_ACCEPT} hidden
            onChange={(e) => { const files = e.target.files; e.target.value = ''; if (files[0]) pick([files[0]]); }} />
        </section>

        <section className="vw__sec">
          <div className="vw__sechd"><span className="t-section grow">得到什么</span></div>
          {!src ? <span className="t-detail">一个音频文件：能原样拷贝的音轨不重新编码（AAC → .m4a、MP3 → .mp3、Opus → .ogg、FLAC → .flac），其余转成 AAC（.m4a）。</span>
            : fmt ? <>
              <span className="t-detail">{fmt.line}。</span>
              <span className="t-detail-xs">保存为 {name}；画面去掉，只取第一条音轨。{fmt.copy ? '没有重新编码，音质和原来一样，几秒就好。' : '转码在这台电脑上进行。'}</span>
            </> : <span className="t-detail vw__err">「{src.name}」里没有音轨，提取不出声音。换一个带声音的视频。</span>}
        </section>
      </window.VideoToolShell>
    );
  }

  Object.assign(window, {ExtractToolPage});
})();
