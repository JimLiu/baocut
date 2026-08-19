// BaoCut Subtitle Studio — My projects 项目列表页（/projects/）。
// 与产品原型 designs/baocut-mac/app/projects.jsx 对齐：工具行（搜索 + 网格/列表）、
// 网格卡片、列表表格、空态。
//
// 与原型的差异（Studio 没有对应模型/端点，直接省略，不做占位）：
//   · 全文搜索（转录/译文命中分组 .vk-results）—— 只有服务端才知道内容，Web 没有
//     检索端点；这里只搜标题/路径/id。
//   · 删除项目 / 重新转录 / Relink 媒体 / New transcription —— 没有写端点。
//   · 形态徽标 ShapeBadge（字幕/动画/混合）—— 需要模板能力位，Studio 项目不带。
//   · 缩略图的封面缓存与关键帧刮擦 —— serve 只提供单帧 __bcut/thumb。
//
// 列表页不进 AppStore（那是单个项目的文档状态），所以面板开关由本页自己用
// BCS_PANELS 维护，Shell 以 props 接收。
(() => {
const { useState, useRef, useEffect, useMemo, useCallback } = React;
const { Ic, QBtn, Menu, Segmented, ToastHost, fmtDur, toast, useProjects, ProjectInfoDialog } = window;
const P = window.BCS_PANELS;
const PJ = window.BCS_PROJECTS;
if (!P || !PJ) throw new Error('panels.js / projects.js failed to load');

// ---------- 缩略图 ----------
// 视频项目抽一帧（__bcut/thumb），其余按媒体类型放占位图标。抽帧失败（媒体文件
// 已不在原处、ffmpeg 不可用）就退回占位 —— 一个空的深色矩形比一张破图诚实。
function ProjectThumb({ p, className = '', width = 320, iconSize = 22 }) {
  const url = PJ.thumbUrl(p, width);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const art = url && !failed;
  const dur = Number(p.duration);
  return (
    <div className={'vk-thumb' + (art ? '' : ' vk-thumb--kind') + (className ? ' ' + className : '')}
      aria-hidden="true">
      {art
        ? <img className="vk-thumb__img" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
        : <Ic name={PJ.mediaIcon(p.mediaKind)} size={iconSize} />}
      {Number.isFinite(dur) && dur > 0 ? <span className="vk-thumb__dur">{fmtDur(dur)}</span> : null}
    </div>
  );
}

// ---------- 徽标 ----------
function StatusBadge({ p }) {
  const b = PJ.statusBadge(p);
  return <span className={'vk-badge ' + b.cls}>{b.label}</span>;
}

// 来源（挂载 / 当前项目 / 项目库）：第二套词汇，比状态更轻 —— 与原型 ShapeBadge
// 同一位置、同一层级（.vk-badge--shape 系列比状态填充安静）。
function SourceBadge({ p }) {
  const label = PJ.sourceLabel(p);
  if (!label) return null;
  return <span className="vk-badge vk-badge--shape vk-badge--shape-subtitle">{label}</span>;
}

// ---------- ⋯ 菜单 ----------
function DotMenu({ p, onInfo }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const items = [
    { icon: 'edit', label: '在编辑器中打开', onClick: () => { location.href = PJ.projectHref(p.id); } },
    { icon: 'info-circle', label: '项目详情…', onClick: () => onInfo(p) },
    '-',
    { icon: 'copy', label: '复制项目路径', disabled: !p.path,
      onClick: () => {
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(p.path);
        toast('项目路径已复制', { variant: 'neutral' });
      } },
  ];
  return (
    <>
      <QBtn refEl={ref} icon="more" size="S" tip="项目操作" onClick={() => setOpen(true)} />
      {open ? <Menu anchorRef={ref} onClose={() => setOpen(false)} items={items} /> : null}
    </>
  );
}

// ---------- 页面 ----------
function ProjectsPage({ projects }) {
  const [q, setQ] = useState('');
  const [view, setView] = useState(() => PJ.loadView(window.localStorage));
  const [info, setInfo] = useState(null);
  const setViewPersist = useCallback((v) => { setView(v); PJ.saveView(window.localStorage, v); }, []);
  // 相对时间只在列表刷新时重算：把 Date.now() 直接写进渲染会让"3 分钟前"随任意
  // 重渲染跳动。列表是整页跳转的页面，一次快照足够。
  const now = useMemo(() => Date.now(), [projects]);
  const list = useMemo(() => PJ.searchProjects(projects || [], q), [projects, q]);
  const searching = !!q.trim();

  const open = (p) => { location.href = PJ.projectHref(p.id); };
  const cardKey = (p) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(p); }
  };
  const stop = (e) => e.stopPropagation();

  const body = () => {
    if (projects === null) {
      return (
        <div className="vk-projects__empty" role="status" aria-live="polite">
          <span className="vk-spin"></span>
          <div>载入项目…</div>
        </div>
      );
    }
    if (!list.length) {
      return searching ? (
        <div className="vk-projects__empty">
          <Ic name="search" size={26} />
          <div>没有匹配“{q.trim()}”的项目</div>
        </div>
      ) : (
        <div className="vk-projects__empty">
          <Ic name="folder" size={26} />
          <div>还没有项目</div>
          <div className="vk-projects__hint">
            用 <code className="vk-mono">bcut transcribe</code> 或 <code className="vk-mono">bcut project create</code> 创建，
            或用 <code className="vk-mono">bcut serve --mount</code> 挂载。
          </div>
        </div>
      );
    }
    if (view === 'grid') {
      return (
        <div className="vk-grid">
          {list.map((p) => (
            <div key={p.id} className="vk-card" role="button" tabIndex={0}
              aria-label={'打开项目 ' + (p.title || p.id)}
              onClick={() => open(p)} onKeyDown={cardKey(p)}>
              <ProjectThumb p={p} />
              <div className="vk-card__info">
                <div className="vk-card__title" title={p.title || p.id}>{p.title || p.id}</div>
                <div className="vk-card__path" title={p.path}>{p.path}</div>
                <div className="vk-card__bottom">
                  <StatusBadge p={p} />
                  <SourceBadge p={p} />
                  <span className="vk-card__time">{PJ.relativeTime(p.modifiedAt, now)}</span>
                  <span className="vk-spacer"></span>
                  <span onClick={stop}><DotMenu p={p} onInfo={setInfo} /></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="vk-table">
        <div className="vk-table__head">
          <span>名称</span><span>位置</span><span>状态</span><span>时长</span><span>修改时间</span><span></span>
        </div>
        {list.map((p) => (
          <div key={p.id} className="vk-table__row" role="button" tabIndex={0}
            aria-label={'打开项目 ' + (p.title || p.id)}
            onClick={() => open(p)} onKeyDown={cardKey(p)}>
            <span className="vk-table__name">
              <ProjectThumb p={p} className="vk-thumb--mini" width={112} iconSize={13} />
              <span className="vk-table__title" title={p.title || p.id}>{p.title || p.id}</span>
              {/* 来源徽标紧跟名称（原型列表视图的 ShapeBadge 同位） */}
              <SourceBadge p={p} />
            </span>
            <span className="vk-table__path" title={p.path}>{p.path}</span>
            <span><StatusBadge p={p} /></span>
            <span className="vk-mono vk-dim">
              {Number.isFinite(Number(p.duration)) && Number(p.duration) > 0 ? fmtDur(Number(p.duration)) : '—'}
            </span>
            <span className="vk-dim">{PJ.relativeTime(p.modifiedAt, now)}</span>
            <span onClick={stop}><DotMenu p={p} onInfo={setInfo} /></span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="vk-projects" data-screen-label="My projects">
      <div className="vk-projects__toolbar">
        <div className="vk-search" style={{ width: 280 }}>
          <Ic name="search" size={15} />
          <input className="vk-input" placeholder="搜索标题或路径…" value={q} aria-label="搜索项目"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }} />
        </div>
        {searching && projects ? (
          <span className="vk-projects__count vk-dim">{list.length} / {projects.length}</span>
        ) : null}
        <div className="vk-spacer"></div>
        <Segmented value={view} onChange={setViewPersist} options={[
          { value: 'grid', icon: 'apps', label: '', tip: '网格视图' },
          { value: 'list', icon: 'properties', label: '', tip: '列表视图' },
        ]} />
      </div>
      {body()}
      {/* 详情对话框复用编辑器标题栏那一份；列表页没有 AppStore，doc 由条目合成
          （标题/时长/媒体类型/路径都在条目里，语言与模型要读项目文档才有）。 */}
      {info ? (
        <ProjectInfoDialog entry={info} onClose={() => setInfo(null)}
          doc={{ meta: {
            title: info.title || info.id,
            duration: Number.isFinite(Number(info.duration)) ? Number(info.duration) : null,
            media: { kind: info.mediaKind },
          } }} />
      ) : null}
    </div>
  );
}

// ---------- 页面根 ----------
// /projects/ 的挂载点：不进 AppStore（列表页没有单个项目的文档状态），面板开关
// 自己维护，项目集合取一次交给 Shell 与页面共用。
function ProjectsApp() {
  const projects = useProjects();
  const [panels, setPanels] = useState(() => P.loadPanels(window.localStorage));
  const setPanel = useCallback((name, on) => setPanels((cur) => {
    const next = P.setPanel(cur, name, on);
    P.savePanels(window.localStorage, next);
    return next;
  }), []);
  useEffect(() => { document.title = '我的项目 · BaoCut Subtitle Studio'; }, []);
  return (
    <>
      <window.Shell page="projects" panels={panels} setPanel={setPanel} projects={projects}>
        <ProjectsPage projects={projects} />
      </window.Shell>
      <ToastHost />
    </>
  );
}

Object.assign(window, { ProjectsApp, ProjectsPage, ProjectThumb });
})();
