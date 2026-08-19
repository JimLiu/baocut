// BaoCut Subtitle Studio — 导出对话框（标题栏「导出」按钮）。
//
// 与 Mac 的 apps/mac/Sources/VoiceInk/Export/（ExportDialogView / ExportDialogPane /
// ExportVideoPreviewView / ExportDialogActions）以及原型
// designs/baocut-mac/app/export.jsx + export.css 同构：
//   左侧类别列（视频 / 转录稿 / 字幕）· 中央预览 · 右侧选项 · 底部文件名 + 取消/导出。
//
// 只放**有后端支撑**的选项。`POST __bcut/export/video` 只收 mode / document /
// patchRanges（docs/bcut-cli-server-reference.md），所以 Mac 视频面板上的画面比例、
// 分辨率、质量、字幕样式、烧录字幕开关、文字叠加/水印/B-roll 开关在 Web 一律不出现
// —— 端点收不到的选项做出来只会是假承诺。「可编辑项目」类别同理整块省略。
(() => {
const { useState, useRef, useEffect, useMemo, useCallback } = React;
const { Ic, QBtn, Overlay, Segmented, CopyBtn, ProgressCluster, useApp, fmt, toast } = window;
const { KonvaPreview } = window.BCSCanvas;
const R = window.BCS_SUBTITLE;
const T = window.BCS_TIMELINE;
const EG = window.BCS_ELEMENT_GEOMETRY;
const X = window.BCS_EXPORT_TEXT;
if (!X) throw new Error('export-text.js failed to load');

const CONTENT_OPTIONS = [
  { value: 'orig', label: '原文' },
  { value: 'trans', label: '译文' },
  { value: 'bi', label: '双语' },
];

// ---------- 设置行（原型 ExpRow / ExpSegRow，复用 .vk-set__row） ----------
function ExpSwitchRow({ name, desc, on, onChange, disabled }) {
  return (
    <div className={'vk-set__row' + (disabled ? ' vk-exp-row--off' : '')}>
      <div>
        <div className="vk-set__name">{name}</div>
        {desc ? <div className="vk-set__desc">{desc}</div> : null}
      </div>
      <label className="s2-switch s2-switch--emphasized" style={{ position: 'relative' }}>
        <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="s2-switch__track"><span className="s2-switch__handle"></span></span>
      </label>
    </div>
  );
}

function ExpSegRow({ name, desc, options, value, onChange }) {
  return (
    <div className="vk-set__row">
      <div>
        <div className="vk-set__name">{name}</div>
        {desc ? <div className="vk-set__desc">{desc}</div> : null}
      </div>
      <Segmented size="S" options={options} value={value} onChange={onChange} />
    </div>
  );
}

// ---------- 视频预览 ----------
// Mac 的 ExportVideoPreviewView 借用编辑器的播放器，在导出专用的画幅里跑同一套呈现
// 模型。Web 这里挂一个**独立**的静音 <video>（不碰 app.attachMedia，主舞台照常播），
// 画面仍交给 canvas-stage.jsx 的 KonvaPreview —— 预览与画布共用同一个字幕呈现内核，
// 不做第二套近似渲染。
function ExportVideoPreview({ doc, content }) {
  const [box, setBox] = useState({ w: 560, h: 212 });
  const [mediaEl, setMediaEl] = useState(null);
  const [sourceAspect, setSourceAspect] = useState(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const wellRef = useRef(null);
  const mediaRef = useRef(null);
  // 稳定的 ref 回调：内联箭头函数每次渲染身份都变，React 会先用 null 再用元素回调一遍，
  // mediaEl 每帧 null→元素地翻一次，Konva 的媒体层就跟着重建一次。
  const setMediaSource = useCallback((el) => {
    mediaRef.current = el;
    setMediaEl(el);
  }, []);

  const duration = doc.meta.duration || 0;
  const projection = doc.timelineProjection || null;
  const position = projection && T ? T.timelineToSource(projection, t, 'following') : null;
  const mediaSourceId = position ? position.srcId : 'main';
  const mediaClipId = position ? position.clipId : 'c1';
  const projectedKind = projection && projection.views && projection.views[mediaSourceId]
    ? projection.views[mediaSourceId].kind : null;
  const media = mediaSourceId === 'main' ? (doc.meta.media || null)
    : (projectedKind ? { kind: projectedKind } : null);
  const hasVideo = !!(media && media.kind === 'video');
  const hasAudio = !!(media && media.kind === 'audio');

  useEffect(() => {
    const el = wellRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: Math.max(160, rect.width - 24), h: Math.max(120, rect.height - 24) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!mediaEl || !hasVideo) { setSourceAspect(null); return undefined; }
    const update = () => {
      const ratio = mediaEl.videoWidth > 0 && mediaEl.videoHeight > 0
        ? mediaEl.videoWidth / mediaEl.videoHeight : null;
      setSourceAspect((current) => (current === ratio ? current : ratio));
    };
    update();
    mediaEl.addEventListener('loadedmetadata', update);
    return () => mediaEl.removeEventListener('loadedmetadata', update);
  }, [mediaEl, hasVideo]);

  // 播放时跟随媒体元素自己的时钟，并按投影跨接缝跳段 —— 与 stage.jsx 的 tick 同构。
  useEffect(() => {
    const el = mediaEl;
    if (!el) return undefined;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('ended', onPause);
    let raf;
    const tick = () => {
      if (!el.paused) {
        const step = projection && T
          ? T.playbackStep(projection, el.dataset.clipId, el.currentTime)
          : { timelineTime: el.currentTime };
        if (step) {
          if (step.seekSource != null && Math.abs(el.currentTime - step.seekSource) > 0.0005) {
            try { el.currentTime = step.seekSource; } catch (e) { /* 尚未 seekable */ }
          }
          if (step.timelineTime >= duration - 1e-9) el.pause();
          setT((prev) => (Math.abs(prev - step.timelineTime) > 0.003 ? step.timelineTime : prev));
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('ended', onPause);
      el.pause();
    };
  }, [mediaEl, projection, duration]);

  const seek = useCallback((next) => {
    const clamped = Math.max(0, Math.min(duration, Number(next) || 0));
    setT(clamped);
    const el = mediaRef.current;
    if (!el) return;
    const at = projection && T ? T.timelineToSource(projection, clamped, 'following') : null;
    const target = at ? at.sourceTime : clamped;
    if (Math.abs(el.currentTime - target) > 0.02) {
      try { el.currentTime = target; } catch (e) { /* 尚未 seekable */ }
    }
  }, [duration, projection]);

  const togglePlay = useCallback(() => {
    const el = mediaRef.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => {}); else el.pause();
  }, []);

  const frame = R.fitFrame(box.w, box.h, sourceAspect || R.LANDSCAPE_ASPECT);
  const st = doc.style;
  const timing = st.displayTiming || R.DEFAULT_TIMING;
  const cueDisplay = R.activeTimedItem(doc.timelineCues || doc.cues || [], t, timing);
  const sentenceDisplay = R.activeTimedItem(doc.timelineSentences || doc.sentences || [], t, timing);
  // 译文行的时间流：优先译文展示片，句级译文还没切片时退回句子本身 —— 与
  // stage.jsx 同一条兜底，也和 hasTrans 的判据同源。
  const transDisplay = R.activeTimedItem(doc.timelineTransCues || doc.transCues || [], t, timing)
    || (() => {
      const sentence = sentenceDisplay && sentenceDisplay.item;
      return sentence && sentence.trans
        ? { ...sentenceDisplay, item: { ...sentence, sid: sentence.id, kind: 'sentence', text: sentence.trans } }
        : null;
    })();
  const cue = cueDisplay && cueDisplay.item;
  const tcue = transDisplay && transDisplay.item;
  const displayStart = Math.min(
    cueDisplay ? cueDisplay.displayStart : Number.POSITIVE_INFINITY,
    transDisplay ? transDisplay.displayStart : Number.POSITIVE_INFINITY,
  );
  // 预览排哪几行由**导出内容**回答，不看编辑器当前 tab：这张画面代表的是烧录结果。
  const lines = R.resolveModeLines(content, st.order);
  const tracks = (doc.timelineProjection || {}).tracks || [];
  const elements = EG ? EG.visibleElements(tracks, t, duration) : [];
  const elementsKey = JSON.stringify(elements.map((el) => [el.id, el.kind, el.text, el.style, el.place]));

  return (
    <div className="vk-exp-video">
      <div className="vk-exp-video__well" ref={wellRef}>
        <div className="vk-exp-video__frame" style={{ width: frame.width, height: frame.height }}>
          {hasVideo || hasAudio ? React.createElement(hasVideo ? 'video' : 'audio', {
            key: 'media:' + mediaSourceId,
            className: 'bcs-media-source',
            ref: setMediaSource,
            src: T ? T.mediaURL(mediaSourceId) : '__bcut/media',
            'data-clip-id': mediaClipId,
            muted: true,
            playsInline: true,
            preload: 'auto',
          }) : null}
          <KonvaPreview
            width={frame.width} height={frame.height}
            mediaEl={mediaEl} hasVideo={hasVideo} hasAudio={hasAudio} hue={252}
            cue={cue} tcue={tcue}
            sourceLanguage={doc.meta.sourceLang && doc.meta.sourceLang.code}
            targetLanguage={doc.meta.targetLang && doc.meta.targetLang.code}
            lines={lines} style={st} scale={frame.scale} t={t} playing={playing}
            displayStart={Number.isFinite(displayStart) ? displayStart : t}
            selected={false} selectedLine={null} showSubs transcribing={false} editingLine={null}
            onCanvasPress={() => null} onSelectLine={() => {}} onEditLine={() => {}}
            onMoveBy={() => {}} onMoveLine={() => {}}
            elements={elements} elementsKey={elementsKey} selectedElementId={null}
            editingElementId={null} onElementSelect={() => {}} onElementMove={() => {}}
            onElementEdit={() => {}}
          />
          <span className="vk-exp-video__timecode">{fmt(t)}</span>
        </div>
      </div>
      <div className="vk-exp-video__controls">
        <QBtn icon={playing ? 'pause' : 'play'} size="S" tip={playing ? '暂停' : '播放'} onClick={togglePlay} />
        <input className="vk-exp-video__scrubber" type="range" min={0} max={Math.max(0.1, duration)}
          step={0.05} value={t} aria-label="预览进度"
          onChange={(e) => seek(parseFloat(e.target.value))} />
        <span className="vk-exp-video__time">{fmt(t)} / {fmt(duration)}</span>
      </div>
    </div>
  );
}

// ---------- 光速修正行（原型 flashfix.jsx FlashFixRow） ----------
function FlashFixRow({ delta, baselineName, duration, onFix }) {
  if (!delta) return null;
  if (delta.upToDate) {
    return (
      <div className="vk-ffrow vk-ffrow--clean">
        <Ic name="checkmark-circle" size={15} />
        <span>{baselineName || '已导出的文件'}与当前字幕一致。</span>
      </div>
    );
  }
  return (
    <div className="vk-ffrow">
      <Ic name="flash" size={15} />
      <span className="vk-ffrow__text">
        <b>光速修正</b> —— 上次导出后有 {delta.count} 处字幕改动。只重渲{' '}
        {fmt(Math.max(1, delta.seconds))} 并拼接回去，不必重跑整片 {fmt(duration)}。
      </span>
      <button className="s2-btn s2-btn--S s2-btn--accent" onClick={onFix}>
        <Ic name="flash" size={13} style={{ color: 'white' }} />光速修正
      </button>
    </div>
  );
}

// ---------- 预览区（转录稿 / 字幕） ----------
function TextPreview({ text, count }) {
  return (
    <>
      <div className="vk-exp-prevhead">
        <span className="vk-aisec" style={{ margin: 0 }}>预览</span>
        <span className="vk-exp-prevhead__n">{count}</span>
        <span className="vk-spacer"></span>
        <CopyBtn quiet size="S" tip="复制到剪贴板" getText={() => text} note="已复制到剪贴板" />
      </div>
      <pre className="vk-exp-preview">{text}</pre>
    </>
  );
}

// ---------- 对话框 ----------
const TYPES = [
  { id: 'video', icon: 'video', name: '视频', sub: 'MP4，字幕烧录进画面' },
  { id: 'transcript', icon: 'text-lines', name: '转录稿', sub: 'Markdown 文档' },
  { id: 'subtitles', icon: 'captions', name: '字幕', sub: 'SRT 或 VTT 文件' },
];

function download(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function ExportDialog({ onClose }) {
  const app = useApp();
  const { doc } = app;
  const [type, setType] = useState('video');
  const [progress, setProgress] = useState(null);
  // 三个类别各自记住自己的内容轴（Mac 每个面板都有独立的 content 状态）。
  // 编辑器当前 tab 只提供初值：Translate tab 上打开导出，默认就是双语。
  const initialContent = app.tab === 'translate' ? 'bi' : 'orig';
  const [vContent, setVContent] = useState(initialContent);
  const [tContent, setTContent] = useState(initialContent);
  const [sContent, setSContent] = useState(initialContent);
  const [sFormat, setSFormat] = useState('srt');
  const [sSpeakers, setSSpeakers] = useState(false);
  const [tSpeakers, setTSpeakers] = useState(true);
  const [tTimestamps, setTTimestamps] = useState(true);
  const [tChapters, setTChapters] = useState(true);

  // Esc 由 Overlay 统一挂在 Esc 栈上，这里不再重复注册。
  useEffect(() => {
    const update = (event) => setProgress(event.detail);
    window.addEventListener('bcut-video-export', update);
    return () => window.removeEventListener('bcut-video-export', update);
  }, []);
  // 导出跑完（进度回到 idle）就收起对话框：文件已经由浏览器下载，toast 报结果，
  // 留一个只剩「取消/导出」的旧对话框没有意义。
  const startedRef = useRef(false);
  useEffect(() => {
    if (progress != null) { startedRef.current = true; return; }
    if (startedRef.current) onClose();
  }, [progress, onClose]);

  const title = doc.meta.title || 'subtitles';
  const srcCode = (doc.meta.sourceLang || {}).code || '';
  const dstCode = (doc.meta.targetLang || {}).code || '';
  // 有没有译文可导：与原导出菜单同一判据（时间轴投影优先，再兜一层句级译文）。
  const hasTrans = (doc.timelineTransCues || doc.transCues || []).some((tc) => (tc.text || '').trim())
    || (doc.sentences || []).some((s) => (s.trans || '').trim());
  const speakerCount = Object.keys(doc.speakers || {}).length;
  const chapterCount = (doc.chapters || []).length;

  const contentOptions = CONTENT_OPTIONS.map((option) => ({
    ...option, disabled: option.value !== 'orig' && !hasTrans,
  }));
  const nativeTarget = (doc.meta.targetLang || {}).native || (doc.meta.targetLang || {}).name || '译文';
  const contentDesc = (value, biCopy, transCopy) => {
    if (!hasTrans) return '项目还没有译文，只能导出原文。';
    if (value === 'bi') return biCopy;
    if (value === 'trans') return transCopy;
    return '只导出原文。';
  };
  // 没有译文时把内容轴钉回原文：样式面板可以在翻译之前就切到双语，选中一个导不出
  // 东西的模式只会让人以为导出坏了。
  const pick = (value) => (value !== 'orig' && !hasTrans ? 'orig' : value);
  const videoContent = pick(vContent);
  const transcriptContent = pick(tContent);
  const subtitleContent = pick(sContent);

  const paras = useMemo(() => app.paragraphs(doc), [doc]);
  const markdown = useMemo(() => X.markdown(doc, paras, {
    title, content: transcriptContent, speakers: tSpeakers,
    timestamps: tTimestamps, chapters: tChapters && chapterCount >= 2,
  }), [doc, paras, title, transcriptContent, tSpeakers, tTimestamps, tChapters, chapterCount]);
  const subtitleText = useMemo(() => X.subtitles(doc, {
    content: subtitleContent, format: sFormat, speakers: sSpeakers,
  }), [doc, subtitleContent, sFormat, sSpeakers]);
  const subtitleCount = useMemo(() =>
    X.subtitleEvents(doc, { content: subtitleContent }).length, [doc, subtitleContent]);
  const missing = X.missingTranslations(doc, subtitleContent);

  const stemFor = (content) => {
    const tag = X.languageTag(content, srcCode, dstCode);
    return X.slug(title) + (tag ? ' ' + tag : '');
  };
  const filename = type === 'video' ? stemFor(videoContent) + '.mp4'
    : type === 'transcript' ? X.filename(title, X.languageTag(transcriptContent, srcCode, dstCode), 'md')
    : X.filename(title, X.languageTag(subtitleContent, srcCode, dstCode), sFormat);

  // 导出基线记下这次烧进画面的字幕模式：光速修正必须沿用它，服务端的区间重渲基线
  // 按 mode 指纹存放，模式一变就不是同一份可直通的成品了。
  const stamp = (mode) => (exportedDoc, name) => app.stampExport(exportedDoc, { filename: name, mode });
  const delta = app.exportDelta;
  const baseline = app.exportBaseline || {};
  const baselineArtifact = baseline.artifact || {};

  const start = () => {
    if (type === 'video') {
      window.exportVideo(stemFor(videoContent), doc,
        { mode: videoContent, onDone: stamp(videoContent) });
      return;
    }
    if (type === 'transcript') {
      download(filename, markdown, 'text/markdown');
      toast('转录稿已下载', { variant: 'positive' });
    } else {
      download(filename, subtitleText, 'text/plain');
      toast((sFormat === 'vtt' ? 'VTT' : 'SRT') + ' 已下载', { variant: 'positive' });
    }
    onClose();
  };

  const flashFix = () => {
    // 光速修正不跟随面板里的模式选择：它是在既有导出基线上打补丁，模式语义只能
    // 来自那次导出。升级前盖章的基线没有 mode，取到 undefined 就退回「不发 mode」。
    const mode = baselineArtifact.mode;
    const stem = String(baselineArtifact.filename || '').replace(/\.mp4$/i, '') || stemFor(mode || 'orig');
    window.exportVideo(stem, doc, { patch: delta, mode, onDone: stamp(mode) });
  };

  const busy = progress != null;
  const pct = busy ? Math.max(0, Math.min(100, Math.round(progress))) : 0;

  return (
    <Overlay onClose={onClose}>
      <div className="vk-aidlg vk-export" style={{ width: 700 }}
        onPointerDown={(e) => e.stopPropagation()} data-screen-label="Export dialog">
        <div className="vk-aidlg__head">
          <div className="vk-aidlg__title">导出
            <span className="vk-exp-meta">{title} · {fmt(doc.meta.duration)}</span>
          </div>
          <QBtn icon="close" tip="关闭" onClick={onClose} />
        </div>

        <div className={'vk-export__body' + (busy ? ' vk-export__body--busy' : '')}>
          <div className="vk-export__types" role="tablist" aria-label="导出类型">
            {TYPES.map((x) => (
              <button key={x.id} role="tab" aria-selected={type === x.id}
                className={'vk-exptype' + (type === x.id ? ' vk-exptype--on' : '')}
                onClick={() => !busy && setType(x.id)}>
                <span className="vk-exptype__ic"><Ic name={x.icon} size={16} /></span>
                <span className="vk-exptype__main">
                  <span className="vk-exptype__name">{x.name}</span>
                  <span className="vk-exptype__sub">{x.sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="vk-export__pane">
            {type === 'video' ? (
              <>
                <ExportVideoPreview doc={doc} content={videoContent} />
                <FlashFixRow delta={delta} duration={doc.meta.duration || 0}
                  baselineName={baselineArtifact.filename} onFix={flashFix} />
                <ExpSegRow name="字幕内容"
                  desc={contentDesc(videoContent,
                    '原文 + ' + nativeTarget + '，两者都烧录到画面上。',
                    '只把 ' + nativeTarget + ' 译文烧录到画面上。')}
                  options={contentOptions} value={videoContent} onChange={setVContent} />
                <div className="vk-exp-hint">
                  <Ic name="info-circle" size={13} />
                  <span>画面比例、分辨率、字幕样式与叠加开关由项目本身决定：导出端点
                    按当前项目投影渲染，这里不另设一套导出期覆盖。</span>
                </div>
              </>
            ) : type === 'transcript' ? (
              <>
                <ExpSegRow name="内容"
                  desc={contentDesc(transcriptContent,
                    '原文 + ' + nativeTarget + '，一段接一段。',
                    '只导出 ' + nativeTarget + ' 译文。')}
                  options={contentOptions} value={transcriptContent} onChange={setTContent} />
                {speakerCount >= 2 ? (
                  <ExpSwitchRow name="说话人姓名" desc="每段开头加粗的说话人名字。"
                    on={tSpeakers} onChange={setTSpeakers} />
                ) : null}
                <ExpSwitchRow name="时间戳" desc="每段开头的起始时间。"
                  on={tTimestamps} onChange={setTTimestamps} />
                {chapterCount >= 2 ? (
                  <ExpSwitchRow name="章节标题" desc="每章开头的一个标题。"
                    on={tChapters} onChange={setTChapters} />
                ) : null}
                <TextPreview text={markdown} count={X.wordCount(doc) + ' 个词'} />
              </>
            ) : (
              <>
                <ExpSegRow name="格式"
                  desc={sFormat === 'vtt' ? 'WebVTT —— 网页播放器、YouTube 与 HTML5 视频。'
                    : '纯文本字幕 —— 几乎所有播放器都支持。'}
                  options={[{ value: 'srt', label: 'SRT' }, { value: 'vtt', label: 'VTT' }]}
                  value={sFormat} onChange={setSFormat} />
                <ExpSegRow name="内容"
                  desc={contentDesc(subtitleContent,
                    '原文 + ' + nativeTarget + '，按源 Cue 时间配对。',
                    '只导出 ' + nativeTarget + ' 译文，一条译片一事件。')}
                  options={contentOptions} value={subtitleContent} onChange={setSContent} />
                {speakerCount >= 2 ? (
                  <ExpSwitchRow name="说话人标签" desc="每条字幕前加上说话人的名字。"
                    on={sSpeakers} onChange={setSSpeakers} />
                ) : null}
                <TextPreview text={subtitleText}
                  count={subtitleCount + ' 条字幕'
                    + (missing ? ' · ' + missing + (subtitleContent === 'bi' ? ' 条缺译文' : ' 条留空') : '')} />
              </>
            )}
          </div>
        </div>

        <div className="vk-aidlg__footer">
          {busy ? (
            <>
              <span className="vk-exp-phase">正在导出带字幕视频…</span>
              <span className="vk-spacer"></span>
              <button className="s2-btn s2-btn--M s2-btn--secondary" onClick={onClose}>在后台运行</button>
              <ProgressCluster pct={pct} />
            </>
          ) : (
            <>
              <span className="vk-exp-file">
                <Ic name="download" size={15} />
                <span className="vk-mono">{filename}</span>
              </span>
              <span className="vk-spacer"></span>
              <button className="s2-btn s2-btn--M s2-btn--secondary" onClick={onClose}>取消</button>
              <button className="s2-btn s2-btn--M s2-btn--accent" onClick={start}>导出</button>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

Object.assign(window, { ExportDialog, ExportVideoPreview, ExpSwitchRow, ExpSegRow });
})();
