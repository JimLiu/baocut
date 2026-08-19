// BaoCut Subtitle Studio — app root：视频导出动作 / 版本历史 / 编辑器布局
// （stage | tab 面板，时间轴在下）。标题栏与侧边栏在 studio/shell.jsx。
// Agent 拥有 studio/data.json；用户编辑经 __bcut/put 持久化到 studio/edits.json，
// 版本历史在 <项目>/.bcut/history/。
(() => {
const { useState, useRef, useEffect } = React;
const { QBtn, Pop, useApp, toast, ToastHost, AppStore } = window;
const ProgressStatus = window.BCS_PROGRESS;
if (!ProgressStatus) throw new Error('progress-status.js failed to load');
const P = window.BCS_PANELS;
if (!P) throw new Error('panels.js failed to load');

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

// 导出的 UI 在 studio/export-dialog.jsx（对话框，与 Mac ExportDialogView 同款）。
// 这里只留视频导出这条**动作**：它要跨对话框存活（关掉对话框仍在后台跑，进度回到
// 标题栏按钮上），所以不属于任何一个视图组件。

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

// 项目内容还没到位时代替编辑器的整页占位（原型 editor.jsx ProjectContentPlaceholder）。
function ProjectContentPlaceholder({ title, detail, failed }) {
  return (
    <div className="bcs-boot-page">
      <div className={'vk-project-loading' + (failed ? ' vk-project-loading--failed' : '')}
        role="status" aria-live="polite" aria-busy={!failed}
        data-screen-label={failed ? 'Project content load failed' : 'Project content loading'}>
        <div className="vk-project-loading__status">
          {!failed ? <span className="vk-project-loading__spin" aria-hidden="true"></span> : null}
          <strong>{title}</strong>
        </div>
        <p>{detail}</p>
        {!failed ? (
          <div className="vk-project-loading__list" aria-hidden="true">
            {[0.82, 0.66, 0.74, 0.59, 0.79, 0.63].map((width, i) => (
              <div className="vk-project-loading__row" key={i}>
                <span className="vk-project-loading__speaker"></span>
                <span className="vk-project-loading__line" style={{ width: (width * 100) + '%' }}></span>
                <span className="vk-project-loading__line vk-project-loading__line--short"></span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Editor() {
  const app = useApp();
  const { doc } = app;
  const { tab, setTab, panels, setPanel } = app;
  // 三个 slide-over 共用右侧 pane 的位置，任意一个在场都盖住 tab 栏与视图，
  // 所以 inert 判据是「有没有层」而不是「样式层开着吗」。
  const layerOpen = !!(app.styleOpen || app.inspectorOpen || app.wmOpen);
  const topRef = useRef(null);
  const editorRef = useRef(null);
  // 右侧 pane 宽度：null = 跟随 CSS 默认宽度（双击分割条即复位到这里）
  const [paneW, setPaneW] = useState(() => P.loadNumber(window.localStorage, P.RPANE_W_KEY, null));
  const [splitting, setSplitting] = useState(false);
  // 时间轴高度可拖（160–容器 80%），拖过下界自动隐藏面板
  const [timelineH, setTimelineH] = useState(() => P.loadNumber(window.localStorage, P.TIMELINE_H_KEY, P.TIMELINE.def));
  const [tlDrag, setTlDrag] = useState(false);
  // ⌘⇧P 的入队走的就是 Transcript 面板 AI 菜单「润色文稿」那一条：同一个
  // useAgentAction（agent.jsx）→ app.request(...) → 同一个「已发送给 Agent」
  // 对话框，没有第二条入队路径。
  const [runAgent, agentDialog] = window.useAgentAction();
  const runAgentRef = useRef(runAgent);
  runAgentRef.current = runAgent;
  const showStage = panels.stage, showRpane = panels.rpane, showTimeline = panels.timeline;
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
  //
  // 方向键**不在**这里：Mac（EditorPageInteraction.swift:195-217）只在全屏态把
  // ←/→ 绑成 ±5s（Web 同款在 stage-fullscreen.jsx），窗口态的方向键留给「微调
  // 选中字幕的画面位置」（stage.jsx 的 nudgeSubtitle）。
  useEffect(() => {
    const isTyping = () => {
      const el = document.activeElement;
      return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const h = (e) => {
      // ⌘/Ctrl+⇧+P = 润色文稿。与 Mac 一样排在输入框判据之前：这一条是全局
      // 命令，在 cue 里打字时也该响应（EditorPageInteraction.swift:128-133）。
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (e.repeat) return;
        runAgentRef.current('polish', '润色文稿');
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        if (isTyping()) return;
        e.preventDefault();
        if (e.repeat) return;
        if (e.shiftKey) app.redoDoc(); else app.undoDoc();
        return;
      }
      if (e.code === 'Space' && !isTyping() && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (!e.repeat) app.togglePlay(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [app.togglePlay, app.undoDoc, app.redoDoc]);

  // ----- 分割条拖拽（双击复位） -----
  const splitDown = (e) => {
    e.preventDefault();
    const rect = topRef.current.getBoundingClientRect();
    setSplitting(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    let last = paneW;
    const move = (ev) => {
      last = P.rpaneDrag(rect.right - ev.clientX, rect.width);
      setPaneW(last);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSplitting(false);
      if (last) P.saveNumber(window.localStorage, P.RPANE_W_KEY, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetSplit = () => {
    setPaneW(null);
    try { localStorage.removeItem(P.RPANE_W_KEY); } catch (e) { /* 隐私模式忽略 */ }
  };

  // ----- 时间轴高度拖拽（拖出下界自动隐藏） -----
  const tlDown = (e) => {
    e.preventDefault();
    const rect = editorRef.current.getBoundingClientRect();
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    setTlDrag(true);
    let last = timelineH;
    const move = (ev) => {
      const r = P.timelineDrag(rect.bottom - ev.clientY, rect.height);
      if (r.hide) { setPanel('timeline', false); done(); return; }
      last = r.height;
      setTimelineH(last);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      setTlDrag(false);
      P.saveNumber(window.localStorage, P.TIMELINE_H_KEY, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
  };

  const tabBtn = (value, label) => (
    <button role="tab" aria-selected={tab === value}
      className={'s2-tab' + (tab === value ? ' s2-tab--selected' : '')}
      onClick={() => setTab(value)}>{label}</button>
  );

  return (
    <div className={'vk-editor' + (showStage ? '' : ' vk-editor--no-stage') + (showRpane ? '' : ' vk-editor--no-rpane')}
      ref={editorRef} data-screen-label="Editor">
      <div className="vk-editor__top" ref={topRef}>
        {showStage ? <window.StagePane /> : null}
        {showStage && showRpane ? (
          <div className={'vk-rsplit' + (splitting ? ' vk-rsplit--drag' : '')}
            role="separator" aria-orientation="vertical" aria-label="调整面板宽度"
            data-tip="拖动调整宽度 · 双击复位"
            onPointerDown={splitDown} onDoubleClick={resetSplit}></div>
        ) : null}
        {showRpane ? (
        // --vk-style-drop：样式层要盖到 pane 下沿以外多少（把时间轴一起盖住）。
        // 就是时间轴当前高度，隐藏时为 0；层的 CSS 直接读它，不用测量。
        <aside className="vk-rpane" data-screen-label="Editor side pane"
          style={Object.assign({ '--vk-style-drop': (showTimeline ? timelineH : 0) + 'px' },
            showStage && paneW ? { width: paneW } : null)}>
          {/* 样式层连 tab 栏一起盖住：底下亮着「Transcript」而内容是样式，或者点另一个
              tab 要么关层要么偷偷换目标，都是自相矛盾。层在场时 tab 栏与视图 inert。 */}
          <div className="s2-tablist vk-rpane__tabs" role="tablist" inert={layerOpen ? '' : undefined}>
            {tabBtn('transcript', 'Transcript')}
            {tabBtn('subtitle', 'Subtitle')}
            {tabBtn('translate', 'Translate')}
            {/* 舞台显隐排在 tab 栏右端（原型 editor.jsx 同位） */}
            <span className="vk-rpane__tabs-actions">
              <QBtn icon={showStage ? 'video-expand' : 'video-collapse'} tip={showStage ? '隐藏视频' : '显示视频'}
                className={'vk-toggle' + (showStage ? '' : ' vk-toggle--on')} onClick={() => setPanel('stage', !showStage)} />
            </span>
          </div>
          {app.tasksLink !== 'open' ? (
            <div className="vk-dim" style={{ padding: '6px 12px', fontSize: 11.5 }}>
              {app.tasksLink === 'connecting' ? '任务状态连接中…' : '任务状态不可用'}
            </div>
          ) : null}
          <div className="vk-rpane__views" inert={layerOpen ? '' : undefined}>
            {/* 只挂载当前 tab：三个 Pane 同时在 DOM 里时，隐藏的两个仍会订阅
                播放时钟、参与布局与重排。滚动位置存在 app.paneScroll，切回来恢复。 */}
            {pipelineActive ? (
              <div className="bcs-pipeline-pane" data-screen-label="AI progress">
                <window.LiveHeader status={doc.status} title={phaseTitle} />
              </div>
            ) : transcribing ? <window.TranscribingPane /> : (
              <div className="vk-rpane__view">
                {tab === 'transcript' ? <window.TranscriptPane /> : null}
                {tab === 'subtitle' ? <window.SubtitlePane /> : null}
                {tab === 'translate' ? <window.TranslatePane /> : null}
              </div>
            )}
          </div>
          {/* 三个同位 slide-over（原型 M89 / M-transform / M105）：都常挂载，
              开合由 app.styleOpen / inspectorOpen / wmOpen 驱动，互斥由 store 保证。 */}
          <window.StyleLayer />
          <window.InspectorLayer />
          <window.WatermarkLayer />
        </aside>
        ) : null}
      </div>
      {showTimeline ? (
        <div className="vk-timeline-host" style={{ height: timelineH }}>
          <div className={'vk-timeline-resize' + (tlDrag ? ' vk-timeline-resize--drag' : '')}
            role="separator" aria-orientation="horizontal" aria-label="调整时间轴高度"
            data-tip="拖动调整高度 · 拖出边界可隐藏" onPointerDown={tlDown}></div>
          <window.TimelinePane />
        </div>
      ) : null}
      {/* ⌘⇧P 触发时的「已发送给 Agent」对话框 —— 快捷键在任意 tab 下都可用，
          所以它挂在编辑器根上，而不是 Transcript 面板里。 */}
      {agentDialog}
    </div>
  );
}

function App() {
  const app = useApp();
  if (app.err) {
    return <ProjectContentPlaceholder failed title="无法加载 studio/data.json"
      detail={app.err + ' — 请通过 `bcut serve` 访问本页（不要用 file://）。'} />;
  }
  if (!app.doc) return <ProjectContentPlaceholder title="载入项目…" detail="正在读取项目数据。" />;
  if (app.doc.status.phase === 'empty' || !app.doc.meta.duration) {
    return <ProjectContentPlaceholder title={app.doc.meta.title || 'BaoCut Subtitle Studio'}
      detail={app.doc.status.detail || '等待 CLI 同步项目数据…'} />;
  }
  return (
    <>
      <window.Shell><Editor /></window.Shell>
      <ToastHost />
    </>
  );
}

Object.assign(window, { HistoryPop, exportVideo });

// serve 把 /projects/ 与 /projects/<id>/ 都指向这一份 index.html，页面按 pathname
// 分流：列表页不进 AppStore（它没有单个项目的文档，也就不该去取 studio/data.json）。
const onProjectsRoute = window.BCS_PROJECTS.isProjectsRoute(location.pathname);
ReactDOM.createRoot(document.getElementById('root')).render(
  onProjectsRoute ? <window.ProjectsApp /> : <AppStore><App /></AppStore>
);
})();
