// BaoCut Subtitle Studio — 主窗口外壳：标题栏 + 侧边栏 + 项目详情对话框。
// 与产品原型 designs/baocut-mac/app/shell.jsx 对齐；Web 版没有的部分（窗口红绿灯、
// 前进/后退、New transcription / Background tasks / Agent skill / Remote compute /
// Settings / 更新按钮）直接省略，不做占位。
(() => {
const { useState, useRef, useEffect, useCallback } = React;
const { Ic, QBtn, Overlay, useApp, fmt, toast, AgentQueue } = window;
const P = window.BCS_PANELS;
if (!P) throw new Error('panels.js failed to load');

// ---------- 暗色模式：跟随系统（无 UI 开关，见简报决策 4） ----------
(() => {
  if (!window.matchMedia) return;
  const q = window.matchMedia('(prefers-color-scheme: dark)');
  const sync = () => {
    document.documentElement.classList.toggle('spectrum-dark', q.matches);
    if (document.body) document.body.classList.toggle('vk-dark-pasteboard', q.matches);
  };
  sync();
  if (q.addEventListener) q.addEventListener('change', sync);
  else if (q.addListener) q.addListener(sync);
})();

// ---------- 服务级项目列表 ----------
// GET /__bcut/projects（WP-E）。404 或响应不合法时回退 healthz.projects[]（只有
// id/path，标题用 id）。null = 还在加载，[] = 加载完但没有项目。
// skip = true 时不发请求（调用方已经有同一份列表，例如项目列表页把它传给 Shell）。
function useProjects(skip) {
  const [list, setList] = useState(null);
  useEffect(() => {
    if (skip) return undefined;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/__bcut/projects', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          if (j && j.ok && Array.isArray(j.projects)) { if (alive) setList(j.projects); return; }
        }
      } catch (e) { /* 落到 healthz */ }
      try {
        const r = await fetch('/__bcut/healthz', { cache: 'no-store' });
        const j = await r.json();
        if (alive) setList(P.fromHealthz(j));
      } catch (e) { if (alive) setList([]); }
    })();
    return () => { alive = false; };
  }, [skip]);
  return list;
}

// ---------- 项目详情对话框 ----------
// 移植原型 project-info.jsx 的壳与分区。Studio 没有项目元数据写路径（标题、
// 描述、备注都归 Agent 的 transcript/project.json），所以这里全部只读 —— 不放
// 一个按不下去的"保存"。
const MEDIA_KIND_LABEL = { video: '视频', audio: '音频', image: '图片', project: '项目' };

function InfoRow({ label, value, mono, actions = [] }) {
  if (!value) return null;
  return (
    <div className="vk-inforow">
      <span className="vk-inforow__label">{label}</span>
      <span className={'vk-inforow__value' + (mono ? ' vk-mono' : '') + (actions.length ? ' vk-inforow__value--actions' : '')}>{value}</span>
      {actions.length ? (
        <span className="vk-inforow__actions">
          {actions.map((a) => <QBtn key={a.tip} icon={a.icon} size="S" tip={a.tip} onClick={a.onClick} />)}
        </span>
      ) : null}
    </div>
  );
}

// doc 可显式传入：项目列表页没有 AppStore，只能用 /__bcut/projects 的条目合成一份
// 最小 meta（标题/时长/媒体类型/路径），语言与模型要读项目文档才有，那里就不显示。
function ProjectInfoDialog({ onClose, entry, doc: docProp }) {
  const app = useApp();
  const doc = docProp || (app && app.doc) || {};
  const meta = doc.meta || {};
  const kind = (meta.media && meta.media.kind) || (entry && entry.mediaKind) || null;
  const src = meta.sourceLang, dst = meta.targetLang;
  const mediaLine = [fmt(meta.duration), MEDIA_KIND_LABEL[kind] || null].filter(Boolean).join(' · ');
  const langLine = [src && src.name, dst ? '→ ' + (dst.native || dst.name) : null].filter(Boolean).join(' ');
  const counts = [
    (doc.speakers || []).length ? (doc.speakers || []).length + ' 位说话人' : null,
    (doc.chapters || []).length ? (doc.chapters || []).length + ' 个章节' : null,
    (doc.cues || []).length ? (doc.cues || []).length + ' 条字幕' : null,
  ].filter(Boolean).join(' · ');
  const path = entry && entry.path;
  const pathActions = path ? [{
    icon: 'copy', tip: '复制完整路径',
    onClick: () => {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(path);
      toast('完整路径已复制', { variant: 'neutral' });
    },
  }] : [];
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <Overlay onClose={onClose}>
      <div className="vk-dialog vk-projinfo" style={{ width: 500 }}
        onPointerDown={(e) => e.stopPropagation()} data-screen-label="Project details">
        <div className="vk-projinfo__head">
          <div className="vk-dialog__title" style={{ marginBottom: 0 }}>项目详情</div>
          <QBtn icon="close" tip="关闭" onClick={onClose} />
        </div>
        <div className="vk-projinfo__body">
          <div className="vk-projinfo__hero">
            <span className="vk-thumb vk-thumb--kind vk-thumb--card" aria-hidden="true">
              <Ic name={P.mediaIcon(kind)} size={20} />
            </span>
            <div className="vk-projinfo__heromain">
              <div className="vk-projinfo__srctype">{MEDIA_KIND_LABEL[kind] || '项目'}</div>
              <div className="vk-projinfo__srcsub">{meta.title || '未命名项目'}</div>
            </div>
          </div>
          <div className="vk-projinfo__sec">源与媒体</div>
          <div className="vk-projinfo__rows">
            <InfoRow label="标题" value={meta.title} />
            <InfoRow label="媒体" value={mediaLine} />
            <InfoRow label="语言" value={langLine} />
            <InfoRow label="转录模型" value={meta.model} />
            <InfoRow label="内容" value={counts} />
            <InfoRow label="项目路径" value={path} mono actions={pathActions} />
          </div>
        </div>
        <div className="vk-dialog__footer vk-projinfo__footer">
          <button className="s2-btn s2-btn--M s2-btn--secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </Overlay>
  );
}

// ---------- 侧边栏 ----------
// Web 版只保留 My projects（/projects/ 项目列表页，见 projects.jsx）与 RECENT 列表；
// Background tasks / Agent skill / Remote compute / Settings 是 Mac App 的导航项。
function Sidebar({ open, width, dragging, projects, currentId, page }) {
  const list = projects || [];
  const onProjects = page === 'projects';
  return (
    <nav className={'vk-sidebar' + (open ? '' : ' vk-sidebar--closed')}
      style={open ? { width, transition: dragging ? 'none' : undefined } : undefined} aria-label="侧边栏">
      {/* 当前路由就是列表页时高亮它自己（原型 r.r === 'projects' 同判据）；
          尾斜杠直连页面，免掉 /projects → /projects/ 那一跳 302。 */}
      <a className={'vk-side-item' + (onProjects ? ' vk-side-item--on' : '')} href="/projects/"
        aria-current={onProjects ? 'page' : undefined}>
        <Ic name="folder" size={17} /><span className="vk-side-label">我的项目</span>
        {projects ? <span className="vk-side-suffix">{list.length}</span> : null}
      </a>
      <div className="vk-side-head">最近</div>
      <div className="vk-side-scroll">
        {!projects ? <div className="vk-side-empty vk-dim"><span className="vk-spin"></span>载入…</div>
          : !list.length ? <div className="vk-side-empty vk-dim">还没有项目</div>
          : list.map((p) => {
            const bits = [Number.isFinite(p.duration) && p.duration > 0 ? fmt(p.duration) : null,
              P.relativeTime(p.modifiedAt)].filter(Boolean).join(' · ');
            return (
              <a key={p.id} className={'vk-side-item vk-side-item--recent' + (p.id === currentId ? ' vk-side-item--on' : '')}
                href={'/projects/' + encodeURIComponent(p.id) + '/'} title={p.title || p.id}>
                <span className="vk-thumb vk-thumb--kind vk-thumb--mini vk-thumb--side" aria-hidden="true">
                  <Ic name={P.mediaIcon(p.mediaKind)} size={13} />
                </span>
                <span className="vk-side-body">
                  <span className="vk-side-title">{p.title || p.id}</span>
                  {bits ? <span className="vk-side-sub">{bits}</span> : null}
                </span>
              </a>
            );
          })}
      </div>
    </nav>
  );
}

// ---------- 标题栏 ----------
// 左侧固定簇：侧栏展开时镜像其宽度，标题始终贴着侧栏边缘（原型同款）。Web 没有
// 窗口红绿灯，也不需要前进/后退（浏览器自带），所以这一簇里只剩一个侧栏开关。
// 编辑器页与项目列表页共用它。
function TitlebarFixed({ sidebarOpen, setSidebarOpen, sidebarW, sideDrag }) {
  return (
    <div className="vk-titlebar__fixed"
      style={sidebarOpen ? { width: sidebarW, transition: sideDrag ? 'none' : undefined } : undefined}>
      <QBtn icon={sidebarOpen ? 'sidebar-collapse' : 'sidebar-expand'} tip={sidebarOpen ? '收起侧栏' : '展开侧栏'}
        className={'vk-toggle' + (sidebarOpen ? '' : ' vk-toggle--on')} onClick={() => setSidebarOpen(!sidebarOpen)} />
    </div>
  );
}

// 项目列表页的标题栏：只有标题。原型右侧的 New transcription 省略 —— Web 版没有
// 转录 UI（转录经 CLI / Mac App 发起），导出与面板开关都属于单个项目的编辑器。
function ProjectsTitlebar({ sidebarOpen, setSidebarOpen, sidebarW, sideDrag }) {
  return (
    <div className="vk-titlebar">
      <TitlebarFixed sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        sidebarW={sidebarW} sideDrag={sideDrag} />
      <div className="vk-titlebar__content">
        {/* 项目数在侧栏「我的项目」的 suffix 上（原型同位），标题栏不重复报一遍。 */}
        <span className="vk-titlebar__title">我的项目</span>
      </div>
    </div>
  );
}

function Titlebar({ sidebarOpen, setSidebarOpen, sidebarW, sideDrag, entry }) {
  const app = useApp();
  const { doc, panels, setPanel } = app;
  const [expOpen, setExpOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [videoProgress, setVideoProgress] = useState(null);
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
  // 已导出视频落后于当前字幕 → 导出按钮挂琥珀徽标，对话框里出现"光速修正"
  const delta = app.exportDelta;
  const fixPending = !exporting && delta && !delta.upToDate;
  const openInfo = () => setInfoOpen(true);
  return (
    <div className="vk-titlebar">
      <TitlebarFixed sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
        sidebarW={sidebarW} sideDrag={sideDrag} />
      <div className="vk-titlebar__content">
        <div className="vk-titlebar__stack">
          <span className="vk-titlebar__titlerow">
            <span className="vk-titlebar__title vk-titlebar__title--btn" role="button" tabIndex={0}
              data-tip="项目详情" onClick={openInfo}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openInfo(); } }}>{doc.meta.title}</span>
            <button className="vk-titlebar__info" data-tip="标题、媒体与来源信息" aria-label="项目详情"
              onClick={openInfo}><Ic name="info-circle" size={14} /></button>
          </span>
          <span className="vk-titlebar__meta">{metaBits}</span>
        </div>
        <AgentQueue />
        {/* 版本历史按钮在 Transcript 面板工具行（原型 transcript.jsx 同位），不在标题栏。 */}
      </div>
      <div className="vk-titlebar__actions">
        <button
          className={'s2-btn s2-btn--S s2-btn--accent vk-export-btn bcs-export-btn' + (exporting ? ' bcs-export-btn--running' : '')}
          style={exporting ? { '--bcs-export-progress': exportPct + '%' } : null}
          disabled={exporting}
          aria-busy={exporting}
          aria-label={exporting ? `视频导出进度 ${exportPct}%` : '导出'}
          title={exporting ? `正在导出带字幕视频：${exportPct}%`
            : fixPending ? `已导出的视频落后 ${delta.count} 处字幕改动 — 打开导出对话框可光速修正` : undefined}
          onClick={() => setExpOpen(true)}>
          {exporting ? <span className="bcs-export-btn__fill" aria-hidden="true"></span> : null}
          <span className="bcs-export-btn__content">
            <Ic name="export" size={14} />{exporting ? `导出中 ${exportPct}%` : '导出'}
            {fixPending ? <span className="bcs-export-badge" aria-label={`${delta.count} 处待修正`}>{delta.count}</span> : null}
          </span>
        </button>
        {/* 导出是对话框，不是下拉菜单（Mac ExportDialogView 同款）：类别列 + 预览 +
            选项 + 底部文件名，见 export-dialog.jsx。 */}
        {expOpen ? <window.ExportDialog onClose={() => setExpOpen(false)} /> : null}
        {/* 显隐开关排在导出右侧（原型同序）：时间轴 · 右侧面板 */}
        <QBtn icon={panels.timeline ? 'timeline-show' : 'timeline-hide'} tip={panels.timeline ? '隐藏时间轴' : '显示时间轴'}
          className={'vk-toggle' + (panels.timeline ? '' : ' vk-toggle--on')} onClick={() => setPanel('timeline', !panels.timeline)} />
        <QBtn icon={panels.rpane ? 'rpane-show' : 'rpane-hide'} tip={panels.rpane ? '隐藏侧边面板' : '显示侧边面板'}
          className={'vk-toggle' + (panels.rpane ? '' : ' vk-toggle--on')} onClick={() => setPanel('rpane', !panels.rpane)} />
      </div>
      {infoOpen ? <ProjectInfoDialog entry={entry} onClose={() => setInfoOpen(false)} /> : null}
    </div>
  );
}

// ---------- 外壳（标题栏 + 侧边栏 + 内容） ----------
// page = 'projects' 时渲染项目列表页的标题栏，并且完全不读 AppStore：列表页没有
// 单个项目的文档状态，面板开关与项目列表由调用方以 props 传入。
function Shell({ children, page, panels: panelsProp, setPanel: setPanelProp, projects: projectsProp }) {
  const app = useApp();
  const panels = panelsProp || (app && app.panels) || P.normalize(null);
  const setPanel = setPanelProp || (app && app.setPanel) || (() => {});
  const sidebarOpen = panels.sidebar;
  const setSidebarOpen = useCallback((on) => setPanel('sidebar', on), [setPanel]);
  // 调用方给了列表就不再自己取一遍（同一份 /__bcut/projects 请求两次没意义）。
  const fetched = useProjects(projectsProp !== undefined);
  const projects = projectsProp !== undefined ? projectsProp : fetched;
  const entry = P.currentProject(projects, location.pathname);
  const currentId = page === 'projects' ? null : (entry ? entry.id : null);

  const mainRef = useRef(null);
  const [sidebarW, setSidebarW] = useState(() => P.loadSidebarWidth(window.localStorage));
  const [sideDrag, setSideDrag] = useState(false);
  const sideDown = (e) => {
    e.preventDefault();
    const rect = mainRef.current.getBoundingClientRect();
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    setSideDrag(true);
    let last = sidebarW;
    const move = (ev) => {
      const r = P.sidebarDrag(ev.clientX - rect.left);
      if (r.hide) { setSidebarOpen(false); done(); return; }   // 拖过最小宽度一半 → 自动收起
      last = r.width;
      setSidebarW(last);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', done);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      setSideDrag(false);
      P.saveNumber(window.localStorage, P.SIDEBAR_W_KEY, last);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', done);
  };

  return (
    <div className="vk-app" style={{ minWidth: 1080 }}>
      {page === 'projects'
        ? <ProjectsTitlebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
            sidebarW={sidebarW} sideDrag={sideDrag} />
        : <Titlebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen}
            sidebarW={sidebarW} sideDrag={sideDrag} entry={entry} />}
      <div className="vk-main" ref={mainRef}>
        <Sidebar open={sidebarOpen} width={sidebarW} dragging={sideDrag}
          projects={projects} currentId={currentId} page={page} />
        {sidebarOpen ? (
          <div className={'vk-side-resize' + (sideDrag ? ' vk-side-resize--drag' : '')} style={{ left: sidebarW - 3 }}
            role="separator" aria-orientation="vertical" aria-label="调整侧栏宽度"
            data-tip="拖动调整宽度 · 拖出边界可收起" onPointerDown={sideDown}></div>
        ) : null}
        <div className={'vk-content' + (sidebarOpen ? '' : ' vk-content--flush')}>{children}</div>
      </div>
    </div>
  );
}

Object.assign(window, {
  Shell, Sidebar, Titlebar, ProjectsTitlebar, TitlebarFixed,
  ProjectInfoDialog, InfoRow, useProjects,
});
})();
