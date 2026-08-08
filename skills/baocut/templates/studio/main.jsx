// BaoCut Subtitle Studio — app shell：标题栏（历史 / 导出）、编辑器布局
// （stage | tab 面板，时间轴在下）。Agent 拥有 studio/data.json；用户编辑经
// __bcut/put 持久化到 studio/edits.json，版本历史在 <项目>/.bcut/history/。
(() => {
const { useState, useRef, useEffect } = React;
const { Ic, QBtn, Menu, Pop, useApp, fmt, toast, ToastHost, AppStore, AgentQueue } = window;
const ProgressStatus = window.BCS_PROGRESS;
if (!ProgressStatus) throw new Error('progress-status.js failed to load');

let videoExportRunning = false;
const reportVideoExport = (progress) => window.dispatchEvent(new CustomEvent('bcut-video-export', { detail: progress }));

// opts.patch = store 的 exportDelta（光速修正：只有受影响的时间窗需要重渲；
// patchRanges 随请求下发，供服务端做区间重渲+拼接，旧服务端忽略该字段并全片
// 重渲，产物一致只是更慢）。opts.onDone(doc, filename) 在成功后回调 —— 用来
// 盖章新的导出基线。
// opts.mode = 烧进画面的字幕（'orig' | 'trans' | 'bi'）。省略时不发该字段，
// 服务端按项目 style.mode 渲染 —— 旧服务端本来就只有这一种语义，升级前盖章的
// 导出基线（没记模式）也正是按它渲出来的。
async function exportVideo(base, doc, opts) {
  const patch = opts && opts.patch;
  const mode = (opts && opts.mode) || null;
  if (videoExportRunning) {
    toast('已有视频正在导出', { variant: 'negative' });
    return;
  }
  videoExportRunning = true;
  try {
    reportVideoExport(0);
    toast(patch
      ? `正在光速修正导出视频 · ${patch.count} 处改动…`
      : '正在导出带字幕视频…');
    const payload = { document: doc };
    if (mode) payload.mode = mode;
    if (patch) payload.patchRanges = patch.windows;
    const started = await fetch('__bcut/export/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const start = await started.json().catch(() => ({}));
    if (!started.ok || !start.ok) throw new Error(start.error || `HTTP ${started.status}`);
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      const response = await fetch('__bcut/export/video/status', { cache: 'no-store' });
      const status = await response.json();
      if (!response.ok || !status.ok) throw new Error(status.error || `HTTP ${response.status}`);
      if (status.state === 'error') throw new Error(status.error || '视频导出失败');
      if (status.state === 'running' && status.total > 0) {
        reportVideoExport(Math.min(99, Math.round(status.done / status.total * 100)));
      }
      if (status.state !== 'done') continue;
      reportVideoExport(100);
      const a = document.createElement('a');
      a.href = '__bcut/export/video/file';
      a.download = base + '.mp4';
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(patch
        ? `已修正导出视频 · ${patch.count} 处改动`
        : '带字幕视频已导出', { variant: 'positive' });
      if (opts && opts.onDone) opts.onDone(doc, base + '.mp4');
      // Keep the completed bar visible long enough to register before returning
      // the titlebar button to its idle state.
      await new Promise((resolve) => setTimeout(resolve, 650));
      break;
    }
  } catch (error) {
    toast('视频导出失败：' + (error.message || error), { variant: 'negative' });
  } finally {
    videoExportRunning = false;
    reportVideoExport(null);
  }
}

function ExportMenu({ anchorRef, onClose }) {
  const app = useApp();
  const { doc } = app;
  const dl = (name, text) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const base = (doc.meta.title || 'subtitles').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
  const src = (doc.meta.sourceLang || {}).code || 'src';
  const dst = (doc.meta.targetLang || {}).code || 'trans';
  // 导出基线记下这次烧进画面的字幕模式：光速修正必须沿用它，服务端的区间重渲
  // 基线按 mode 指纹存放，模式一变就不是同一份可直通的成品了。
  const onDone = (mode) => (exportedDoc, filename) => app.stampExport(exportedDoc, { filename, mode });
  const delta = app.exportDelta;
  const fixable = delta && !delta.upToDate;
  // 光速修正不跟随菜单里的模式选择，也不跟随 Style tab：它是在既有导出基线上
  // 打补丁，模式语义只能来自那次导出。升级前盖章的基线没有 mode，取到 undefined
  // 就退回"不发 mode"，与它当初的渲染语义一致，直通路径不会失效。
  const baselineMode = ((app.exportBaseline || {}).artifact || {}).mode;
  const styleMode = (doc.style || {}).mode;
  // 有没有译文可烧：取和 exportSRT 同一个投影（时间轴投影优先），再兜一层
  // sentences.trans —— 句级译文已写、还没切成 transCues 时也算有译文，宁可放行
  // 也不误禁。没有译文时 译文/双语 两项置灰，不让用户导出一段空字幕的视频。
  const hasTrans = (doc.timelineTransCues || doc.transCues || []).some((tc) => (tc.text || '').trim())
    || (doc.sentences || []).some((s) => (s.trans || '').trim());
  const videoItem = (mode, label) => {
    // 置灰项不打"当前"标记：Style tab 可以在翻译之前就切到双语，那时这项既是当前
    // 显示模式又导不出来，两个信号一起出现只会让人以为菜单坏了。
    const usable = mode === 'orig' || hasTrans;
    return {
      icon: 'video', label,
      suffix: usable && mode === styleMode ? '当前' : undefined,
      disabled: !usable,
      onClick: () => exportVideo(base, doc, { mode, onDone: onDone(mode) }),
    };
  };
  return (
    <Menu anchorRef={anchorRef} onClose={onClose} width={fixable ? 300 : 262} items={[
      ...(fixable ? [
        // 光速修正：只重渲基线之后被编辑覆盖的时间窗并拼接回已导出的文件
        { icon: 'video', label: `光速修正 · ${delta.count} 处改动（约 ${Math.max(1, Math.round(delta.seconds))} 秒画面）`,
          onClick: () => exportVideo(base, doc, { patch: delta, mode: baselineMode, onDone: onDone(baselineMode) }) },
      ] : []),
      videoItem('orig', '导出视频 · 原文'),
      videoItem('trans', '导出视频 · 译文'),
      videoItem('bi', '导出视频 · 双语'),
      '-',
      { icon: 'captions', label: '下载 SRT · 原文', onClick: () => { dl(base + '.' + src + '.srt', app.exportSRT(doc, 'orig')); toast('SRT 已下载', { variant: 'positive' }); } },
      { icon: 'comment', label: '下载 SRT · 译文', onClick: () => { dl(base + '.' + dst + '.srt', app.exportSRT(doc, 'trans')); toast('SRT 已下载', { variant: 'positive' }); } },
      { icon: 'text-lines', label: '下载 SRT · 双语', onClick: () => { dl(base + '.bi.srt', app.exportSRT(doc, 'bi')); toast('SRT 已下载', { variant: 'positive' }); } },
      '-',
      { icon: 'copy', label: '复制 SRT · 双语', onClick: () => { navigator.clipboard.writeText(app.exportSRT(doc, 'bi')); toast('SRT 已复制', { variant: 'positive' }); } },
    ]} />
  );
}

// 版本历史（bcut serve 的 .bcut/history/ 持久化版本库）：列出每次写入，
// 支持恢复到任一版本（非破坏性 —— 恢复本身作为新版本追加）。
function HistoryPop({ anchorRef, onClose }) {
  const [hist, setHist] = useState(null);
  const load = async () => {
    try {
      const r = await fetch('__bcut/history', { cache: 'no-store' });
      setHist(await r.json());
    } catch (e) { setHist({ ok: false, error: String(e) }); }
  };
  useEffect(() => { load(); }, []);
  const restore = async (seq) => {
    try {
      const r = await fetch('__bcut/restore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seq }),
      });
      const j = await r.json();
      if (j.ok) { toast('已恢复：' + j.label, { variant: 'positive' }); load(); }
      else toast('恢复失败：' + (j.error || j.reason), { variant: 'negative' });
    } catch (e) { toast('恢复失败：' + e, { variant: 'negative' }); }
  };
  const fmtTs = (ts) => {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const KIND = { edit: '编辑', external: 'Agent', undo: '撤销', redo: '重做', restore: '恢复' };
  return (
    <Pop anchorRef={anchorRef} onClose={onClose} align="end" width={380}>
      <div className="vk-pop__title">版本历史 <span className="vk-dim" style={{ fontWeight: 400 }}>· 持久化于项目 .bcut/history/</span></div>
      <div className="bcs-hist">
        {!hist ? <div className="vk-dim" style={{ padding: 12 }}><span className="vk-spin"></span> 载入…</div>
          : !hist.ok ? <div className="vk-dim" style={{ padding: 12 }}>历史不可用（需要 bcut serve）：{hist.error}</div>
          : !hist.entries.length ? <div className="vk-dim" style={{ padding: 12 }}>还没有版本 —— 第一次编辑后出现。</div>
          : hist.entries.map((e) => (
            <div key={e.seq} className={'bcs-hist__row' + (e.current ? ' bcs-hist__row--cur' : '')}>
              <span className="bcs-hist__seq vk-mono">#{e.seq}</span>
              <span className={'bcs-hist__kind bcs-hist__kind--' + e.kind}>{KIND[e.kind] || e.kind}</span>
              <span className="bcs-hist__label" title={e.file}>{e.label}</span>
              <span className="bcs-hist__ts vk-mono vk-dim">{fmtTs(e.ts)}</span>
              {e.current
                ? <span className="bcs-hist__now">当前</span>
                : <button className="s2-btn s2-btn--S s2-btn--secondary" onClick={() => restore(e.seq)}>恢复</button>}
            </div>
          ))}
      </div>
    </Pop>
  );
}

function Titlebar() {
  const app = useApp();
  const { doc } = app;
  const [expOpen, setExpOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [videoProgress, setVideoProgress] = useState(null);
  const expRef = useRef(null), histRef = useRef(null);
  const src = doc.meta.sourceLang, dst = doc.meta.targetLang;
  useEffect(() => {
    const update = (event) => setVideoProgress(event.detail);
    window.addEventListener('bcut-video-export', update);
    return () => window.removeEventListener('bcut-video-export', update);
  }, []);
  const metaBits = [fmt(doc.meta.duration), src && src.name, dst ? '→ ' + dst.native : null, doc.meta.model]
    .filter(Boolean).join(' · ');
  const exporting = videoProgress != null;
  const exportPct = exporting ? Math.max(0, Math.min(100, Math.round(videoProgress))) : 0;
  // 已导出视频落后于当前字幕 → 导出按钮挂琥珀徽标，菜单里出现"光速修正"
  const delta = app.exportDelta;
  const fixPending = !exporting && delta && !delta.upToDate;
  return (
    <div className="vk-titlebar" style={{ height: 52 }}>
      <div className="vk-titlebar__content" style={{ paddingLeft: 18 }}>
        <div className="vk-titlebar__stack">
          <span className="vk-titlebar__title">{doc.meta.title}</span>
          <span className="vk-titlebar__meta">{metaBits}</span>
        </div>
        <AgentQueue />
        <QBtn icon="undo" tip="撤销上一步项目修改" disabled={!app.history.canUndo} onClick={app.undoDoc} />
        <QBtn icon="redo" tip="重做" disabled={!app.history.canRedo} onClick={app.redoDoc} />
        <button ref={histRef} className="s2-btn s2-btn--M s2-btn--secondary" onClick={() => setHistOpen(true)}>
          <Ic name="clock" size={15} />历史
        </button>
        {histOpen ? <HistoryPop anchorRef={histRef} onClose={() => setHistOpen(false)} /> : null}
        <button
          ref={expRef}
          className={'s2-btn s2-btn--M s2-btn--accent bcs-export-btn' + (exporting ? ' bcs-export-btn--running' : '')}
          style={exporting ? { '--bcs-export-progress': exportPct + '%' } : null}
          disabled={exporting}
          aria-busy={exporting}
          aria-label={exporting ? `视频导出进度 ${exportPct}%` : '导出'}
          title={exporting ? `正在导出带字幕视频：${exportPct}%`
            : fixPending ? `已导出的视频落后 ${delta.count} 处字幕改动 — 打开菜单可光速修正` : undefined}
          onClick={() => setExpOpen(true)}>
          {exporting ? <span className="bcs-export-btn__fill" aria-hidden="true"></span> : null}
          <span className="bcs-export-btn__content">
            <Ic name="video" size={15} />{exporting ? `导出中 ${exportPct}%` : '导出'}
            {fixPending ? <span className="bcs-export-badge" aria-label={`${delta.count} 处待修正`}>{delta.count}</span> : null}
          </span>
        </button>
        {expOpen ? <ExportMenu anchorRef={expRef} onClose={() => setExpOpen(false)} /> : null}
      </div>
    </div>
  );
}

function Editor() {
  const app = useApp();
  const { doc } = app;
  const { tab, setTab } = app;
  // 任务是否在跑由 serve 通知中枢判定（心跳/pid/终态保留窗口都在那边），
  // 页面这里只读投影结果 —— 不再需要每秒重算过期窗口的时钟。
  const progressActive = ProgressStatus.isActive(doc.status);
  const transcribing = progressActive && doc.status.phase === 'transcribing';
  const pipelineActive = progressActive
    && !['ready', 'empty', 'transcribing'].includes(doc.status.phase);
  const phaseTitle = {
    polishing: '润色与语义分段',
    translating: '整句翻译',
    aligning: '拆分并对齐双语字幕',
    syncing: '正在同步字幕内容',
  }[doc.status.phase] || '处理字幕';

  // space toggles play (outside text editing)
  // ⌘/Ctrl+Z 是项目撤销的唯一入口：正在输入文本时直接让路给浏览器的原生文本撤销，
  // 其余情况才走项目历史（编辑框的 onKeyDown 另有 stopPropagation 兜底）。
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (isTyping()) return;
        e.preventDefault();
        if (e.repeat) return;
        if (e.shiftKey) app.redoDoc(); else app.undoDoc();
        return;
      }
      if (e.code === 'Space' && !isTyping() && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) app.togglePlay(); }
      // 从 ref 读当前时间：把 player.t 写进依赖数组会让这个 window 监听器
      // 在播放时每帧解绑重绑（≈60 次/秒）。
      if (e.key === 'ArrowLeft' && !isTyping()) { e.preventDefault(); app.seek(app.playerRef.current.t - 5); }
      if (e.key === 'ArrowRight' && !isTyping()) { e.preventDefault(); app.seek(app.playerRef.current.t + 5); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [app.togglePlay, app.seek, app.playerRef, app.undoDoc, app.redoDoc]);

  const tabBtn = (value, label) => (
    <button role="tab" aria-selected={tab === value}
      className={'s2-tab' + (tab === value ? ' s2-tab--selected' : '')}
      onClick={() => setTab(value)}>{label}</button>
  );

  return (
    <div className="vk-editor" data-screen-label="Editor">
      <div className="vk-editor__top">
        <window.StagePane />
        <div className="vk-rsplit" role="separator" aria-orientation="vertical"></div>
        <aside className="vk-rpane" data-screen-label="Editor side pane">
          <div className="s2-tablist vk-rpane__tabs" role="tablist">
            {tabBtn('transcript', 'Transcript')}
            {tabBtn('subtitle', 'Subtitle')}
            {tabBtn('translate', 'Translate')}
            {tabBtn('style', 'Style')}
          </div>
          {app.tasksLink !== 'open' ? (
            <div className="vk-dim" style={{ padding: '6px 12px', fontSize: 11.5 }}>
              {app.tasksLink === 'connecting' ? '任务状态连接中…' : '任务状态不可用'}
            </div>
          ) : null}
          {pipelineActive ? <window.LiveHeader status={doc.status} title={phaseTitle} /> : null}
          <div className="vk-rpane__views">
            {/* 只挂载当前 tab：四个 Pane 同时在 DOM 里时，隐藏的三个仍会订阅
                播放时钟、参与布局与重排。滚动位置存在 app.paneScroll，切回来恢复。 */}
            {transcribing ? <window.TranscribingPane /> : (
              <div className="vk-rpane__view">
                {tab === 'transcript' ? <window.TranscriptPane /> : null}
                {tab === 'subtitle' ? <window.SubtitlePane /> : null}
                {tab === 'translate' ? <window.TranslatePane /> : null}
                {tab === 'style' ? <window.StylePane /> : null}
              </div>
            )}
          </div>
        </aside>
      </div>
      <div className="vk-timeline-host" style={{ height: 236 }}>
        <window.TimelinePane />
      </div>
    </div>
  );
}

function App() {
  const app = useApp();
  if (app.err) {
    return <div className="bcs-boot"><b>无法加载 studio/data.json</b><span className="vk-dim">{app.err} — 请通过 `bcut serve` 访问本页（不要用 file://）。</span></div>;
  }
  if (!app.doc) return <div className="bcs-boot"><span className="vk-spin"></span>载入项目…</div>;
  if (app.doc.status.phase === 'empty' || !app.doc.meta.duration) {
    return (
      <div className="bcs-boot">
        <b>{app.doc.meta.title || 'BaoCut Subtitle Studio'}</b>
        <span className="vk-dim">{app.doc.status.detail || '等待 CLI 同步项目数据…'}</span>
        <span className="vk-spin"></span>
      </div>
    );
  }
  return (
    <div className="vk-app" style={{ minWidth: 1080 }}>
      <Titlebar />
      <div className="vk-main">
        <div className="vk-content vk-content--flush">
          <Editor />
        </div>
      </div>
      <ToastHost />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <AppStore><App /></AppStore>
);
})();
