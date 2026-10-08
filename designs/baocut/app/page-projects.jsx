/* 我的项目 —— §8.1 / §17.3。搜索 · 网格/列表 · 归档/恢复 · 克隆 · 删除闭环。
   搜索是**两层**的（第 118 轮）：元信息层本地即时出，内容层（文稿 / 章节 / 说话人 /
   译文 / 画面文字）晚一拍到；判据全在 [model-project-search.js](model-project-search.js)，
   这一层只负责把它铺成「按项目分组的命中行」。搜索态下网格 / 列表切换收起来——
   命中行没有第二种排法。
   排序（2026-09-26）：搜索框右边一枚排序钮，四档与侧栏 ⋯ 同一张表（`BC_AGENT.TREE_SORTS`
   / `sortProjects`），默认最近打开；偏好另记 `pageSort`，不跟侧栏走。搜索态收起——
   命中行有自己的排法（§17.3）。
   红线（App v2 明确不做，这里也不画）：重命名快捷键 / 在文件夹中显示 /
   多选 / 右键菜单。 */
(function () {
  const {useState, useEffect, useMemo} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const PS = window.BC_PSEARCH;
  const LIB = window.BC_LIBRARY;
  const AG = window.BC_AGENT;
  const SC = window.BC_SHORTS_CUT;

  /** 排序钮：quiet 按钮写着当前档，点开是和侧栏 ⋯ 同一份菜单。 */
  function PageSortBtn({sort, onSort}) {
    const [open, setOpen] = useState(false);
    const cur = AG.TREE_SORTS.filter((s) => s.key === sort)[0];
    return (
      <div style={{position: 'relative'}}>
        <Btn variant="quiet" iconRight="chevdown" title="排序" aria-haspopup="menu" aria-expanded={open}
          onClick={() => setOpen((v) => !v)}>{cur ? cur.label : '排序'}</Btn>
        <Popover open={open} onClose={() => setOpen(false)} align="right" dir="down" width={180}>
          <window.SortMenuList sort={sort} onPick={(k) => { onSort(k); setOpen(false); }} />
        </Popover>
      </div>
    );
  }

  /** 缩略图：项目色相折算的确定性渐变——不是真帧，也不假装是 */
  function Thumb({p, className, style}) {
    const bg = `linear-gradient(135deg, oklch(0.72 0.10 ${p.hue}) 0%, oklch(0.52 0.13 ${(p.hue + 40) % 360}) 100%)`;
    return (
      <div className={className} style={{...(style || {}), background: bg, position: 'relative'}}>
        {p.preview && p.preview.poster ? <img src={p.preview.poster} alt="Sintel 预告片"
          style={{width: '100%', height: '100%', objectFit: 'cover', position: 'absolute', inset: 0}} /> : null}
        {p.src.state === 'missing'
          ? <div style={{position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(0,0,0,0.45)', color: 'var(--gray-25)'}}>
              <Ic n="alert" />
            </div>
          : null}
      </div>
    );
  }

  function StatusBadge({p}) {
    const app = useApp();
    const b = D.BADGE[p.status];
    if (!b) return null;
    const label = p.status === 'transcribing' ? `${b.label} ${app.projPct(p)}%`
                : p.status === 'queued' ? `${b.label} · 第 ${p.queuePos} 位`
                : b.label;
    return <Chip tone={b.tone}>{label}</Chip>;
  }

  function ProjectMenu({p, onClose}) {
    const app = useApp();
    const from = SC.originLabel(app.projects, p);
    const kids = SC.childrenOf(app.projects, p.id).length;
    const archive = () => {
      onClose();
      app.archiveProject(p.id, !p.archived);
      app.toast(p.archived ? '已恢复视频' : '已归档视频', 'positive', p.archived ? undefined
        : {label: '查看归档', run: () => app.go({r: 'projects', tab: 'archived'})});
    };
    const clone = () => {
      onClose();
      const copy = app.cloneProject(p.id);
      if (!copy) { app.toast('视频已不存在，无法克隆', 'negative'); return; }
      app.toast(`已克隆「${copy.title}」`, 'positive');
      app.go({r: 'editor', id: copy.id});
    };
    const del = () => {
      onClose();
      app.confirm({
        title: `删除「${p.title}」？`,
        /* 来源项目删了，切出的短视频还在（§15.12）：确认框里多说一句 */
        body: ['视频包与派生产物一并移除。媒体源文件不受影响。', SC.deleteNote(kids)].filter(Boolean).join(''),
        tone: 'negative',
        confirmLabel: '删除',
        run: () => { app.deleteProject(p.id); app.toast('已删除视频', 'positive'); },
      });
    };
    return (
      <Menu>
        <MenuItem icon="film" label="打开" onClick={() => { onClose(); app.go({r: 'editor', id: p.id}); }} />
        <MenuItem icon="export" label="导出…" onClick={() => { onClose(); app.toast('导出对话框：本轮为骨架'); }} />
        {/* 项目详情（第 233 轮）：与编辑器顶栏 ⓘ 同一个框。这条路没有已加载的文稿，
            所以不传 extras——「内容」「译文」两行在这边缺席，不画占位。 */}
        <MenuItem icon="info" label="视频详情…" onClick={() => { onClose(); app.openProjectInfo(p.id); }} />
        {from && !from.missing
          ? <MenuItem icon="link" label="打开来源视频" onClick={() => { onClose(); app.go({r: 'editor', id: from.parent.id, t: p.origin.in}); }} />
          : null}
        {kids
          ? <MenuItem icon="clip" label="查看切出的短视频" onClick={() => { onClose(); app.go({r: 'projects', from: p.id}); }} />
          : null}
        {p.src.state === 'missing'
          ? <MenuItem icon="link" label="重新关联媒体…" onClick={() => { onClose(); app.toast('重新关联：本轮为骨架'); }} />
          : null}
        <MenuRule />
        <MenuItem icon="copy" label="克隆视频" onClick={clone} />
        <MenuItem icon={p.archived ? 'refresh' : 'folder'} label={p.archived ? '恢复视频' : '归档视频'} onClick={archive} />
        <MenuRule />
        <MenuItem icon="trash" label="删除…" tone="negative" onClick={del} />
      </Menu>
    );
  }

  function ProjectCard({p}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    return (
      <div style={{position: 'relative'}}>
        <Card onClick={() => app.go({r: 'editor', id: p.id})} className="pcard">
          <Thumb p={p} className="pcard__th" />
          <div className="pcard__b">
            <div className="pcard__t t-clamp2">{p.title}</div>
            <div className="pcard__m">
              <StatusBadge p={p} />
              <span className="grow t-truncate">{p.modified}</span>
            </div>
            {SC.isChild(p) || SC.childrenOf(app.projects, p.id).length ? (
              <div className="pcard__m pcard__m--src">
                <window.ShortsOriginBadge p={p} /><window.ShortsCountBadge p={p} />
              </div>
            ) : null}
          </div>
        </Card>
        <div className="pcard__more">
          <IconBtn icon="more" size="s" tip="更多" onClick={(e) => { e.stopPropagation(); setPop((v) => !v); }} />
          <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={210}>
            <ProjectMenu p={p} onClose={() => setPop(false)} />
          </Popover>
        </div>
      </div>
    );
  }

  function ProjectRow({p}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    return (
      <div className="prow">
        <Thumb p={p} className="prow__th" />
        <BCAction className="grow" style={{textAlign: 'left', cursor: 'pointer'}}
          onClick={() => app.go({r: 'editor', id: p.id})}>
          <div className="pcard__t t-truncate">{p.title}</div>
          <div className={cx('t-detail-xs t-truncate', p.src.state === 'missing' && 'pmissing')}
            style={{marginTop: 2}}>{p.src.path}</div>
        </BCAction>
        {p.src.state === 'missing'
          ? <Btn variant="quiet" size="s" onClick={() => app.toast('重新关联：本轮为骨架')}>重新关联…</Btn>
          : null}
        <window.ShortsOriginBadge p={p} /><window.ShortsCountBadge p={p} />
        <span className="t-detail" style={{width: 96}}>{T.duration(p.duration)}</span>
        <StatusBadge p={p} />
        <span className="t-detail" style={{width: 72, textAlign: 'right'}}>{p.modified}</span>
        <div style={{position: 'relative'}}>
          <IconBtn icon="more" size="s" tip="更多" onClick={() => setPop((v) => !v)} />
          <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={210}>
            <ProjectMenu p={p} onClose={() => setPop(false)} />
          </Popover>
        </div>
      </div>
    );
  }

  /* ---------- 搜索结果（§17.3 两层） ----------
     结果按项目分组：一行项目头 + 若干条命中行。分组是产品语义——同一个项目里
     文稿命中十几条时，平铺会把别的项目整个挤出屏幕，「哪些项目里有这个词」
     才是这一屏要回答的问题。 */

  /** 一条命中行：字段 chip + 等宽时间码 + 带高亮的原文（长字段是取过窗的片段）。 */
  function HitRow({p, r}) {
    const app = useApp();
    const Hl = window.Hl;
    /* 带时间的命中行跳进编辑器并把播放头落在那一刻；没时间的（备注、路径、说话人）
       只能把项目打开——落点不存在，硬编一个 0 反而骗人。 */
    const open = () => app.go(r.t == null ? {r: 'editor', id: p.id} : {r: 'editor', id: p.id, t: r.t});
    return (
      <BCAction className="pshit" onClick={open}>
        <Chip tone="neutral" className="pshit__chip">{r.chip}</Chip>
        {r.t == null ? null : <span className="pshit__tc t-mono">{T.timecode(r.t)}</span>}
        <span className="pshit__x">
          {r.head ? '…' : null}<Hl text={r.text} ms={r.ranges} />{r.tail ? '…' : null}
        </span>
      </BCAction>
    );
  }

  /** 一个项目的一组命中。默认给十条，「再显示 N 条」每按一次再放十条。 */
  function HitGroup({g, shown, onMore}) {
    const app = useApp();
    const Hl = window.Hl;
    const p = g.project;
    const titleHit = g.rows.filter((r) => r.field === 'title')[0];
    const plan = PS.planRows(g.rows, shown);
    return (
      <section className="psgrp">
        <BCAction className="psgrp__hd" onClick={() => app.go({r: 'editor', id: p.id})}>
          <Thumb p={p} className="psgrp__th" />
          <span className="psgrp__t t-truncate">
            {titleHit ? <Hl text={titleHit.text} ms={titleHit.ranges} /> : p.title}
          </span>
          <StatusBadge p={p} />
          <span className="t-detail-xs">{p.modified}</span>
        </BCAction>
        <div className="pshits">{plan.rows.map((r, i) => <HitRow key={r.field + i} p={p} r={r} />)}</div>
        {plan.more
          ? <BCAction className="psmore" onClick={onMore}>再显示 {plan.more} 条</BCAction>
          : null}
      </section>
    );
  }

  function ProjectsPage() {
    const app = useApp();
    const [view, setView] = useState(app.prefs.pview || 'grid');
    const [q, setQ] = useState('');
    const archived = app.route.tab === 'archived';
    const sort = AG.TREE_SORTS.some((s) => s.key === app.prefs.pageSort) ? app.prefs.pageSort : 'opened';
    /* `from`：只看某个项目切出的短视频（§15.12）。来源项目已经不在了，筛选就作废 */
    const from = app.route.from ? app.projById(app.route.from) : null;
    const projects = useMemo(() => AG.sortProjects(LIB.visible(app.projects, archived)
      .filter((p) => !from || (SC.isChild(p) && p.origin.project === from.id)), sort),
      [app.projects, archived, sort, from && from.id]);
    const scopeControl = <Segmented value={archived ? 'archived' : 'active'}
      onChange={(scope) => app.replace({r: 'projects', tab: scope === 'archived' ? 'archived' : undefined, from: from ? from.id : undefined})}
      items={[{k: 'active', label: '当前视频'}, {k: 'archived', label: '已归档'}]} />;
    const setV = (v) => { setView(v); app.setPref('pview', v); };
    const query = q.trim();

    /* 两层是**两拍**（§17.3）：元信息本地即时出，内容要过内核的缓存索引。
       原型用一次 300ms 延时把这一拍演出来——真机上换成 `bcut project search` 的应答。
       `doneQ` 记的是「内容层已经搜完的那个词」，改词就得作废：不作废的话
       上一个词的文稿命中会在新词底下多留一帧，看起来像搜错了。 */
    const [doneQ, setDoneQ] = useState('');
    const [shown, setShown] = useState({});
    useEffect(() => {
      setDoneQ('');
      setShown({});
      if (!query) return undefined;
      const id = setTimeout(() => setDoneQ(query), 300);
      return () => clearTimeout(id);
    }, [query, archived]);

    const pending = !!query && doneQ !== query;
    const groups = useMemo(
      () => (query ? PS.search(projects, query, {content: !pending}) : []),
      [projects, query, pending]);

    if (query) {
      return (
        <Page fluid title="我的视频" actions={
          <>
            {scopeControl}
            <div className="psfield">
              <Field icon="search" placeholder="搜索视频 ID、标题、文稿…"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Btn variant="accent" icon="plus" onClick={() => app.newProject()}>新建视频</Btn>
          </>
        }>
          {/* 搜索态没有网格 / 列表之分——结果是命中行，不是卡片，切了也没有第二种样子 */}
          <div className="psearch">
            <div className="psearch__hd">
              <span className="t-detail">{PS.statusLabel(groups, query, pending)}</span>
              <span className="t-detail-xs psnote">Transcript search · bcut project search</span>
            </div>
            {groups.length
              ? groups.map((g) => (
                  <HitGroup key={g.id} g={g} shown={shown[g.id]}
                    onMore={() => setShown((s) => Object.assign({}, s,
                      {[g.id]: PS.planRows(g.rows, s[g.id]).next}))} />))
              : (pending ? null
                  : <Empty icon="search" title={`没有匹配「${query}」的视频`}>换个关键词，或按文件名搜。</Empty>)}
          </div>
        </Page>
      );
    }

    return (
      <Page fluid title="我的视频" actions={
        <>
          {scopeControl}
          <div className="psfield">
            <Field icon="search" placeholder="搜索视频 ID、标题、文稿…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <PageSortBtn sort={sort} onSort={(k) => app.setPref('pageSort', k)} />
          <Segmented value={view} onChange={setV}
            items={[{k: 'grid', icon: 'grid', tip: '网格'}, {k: 'list', icon: 'list', tip: '列表'}]} />
          <Btn variant="accent" icon="plus" onClick={() => app.newProject()}>新建视频</Btn>
        </>
      }>
        {from ? (
          <div className="ss-filter">
            <span className="t-truncate"><b>「{from.title}」</b>切出的短视频 · {projects.length}</span>
            <Btn size="s" variant="quiet" onClick={() => app.go({r: 'editor', id: from.id})}>打开来源视频</Btn>
            <Btn size="s" variant="quiet" onClick={() => app.replace({r: 'projects', tab: app.route.tab})}>清除筛选</Btn>
          </div>
        ) : null}
        {!projects.length && from
          ? <Empty icon="clip" title={archived ? '归档里没有它切出的短视频' : '它切出的短视频都不在了'}>清除筛选可以看到全部视频。</Empty>
          : !projects.length
          ? <Empty icon="folder" title={archived ? '还没有归档视频' : '还没有视频'}>{archived
              ? '在视频的更多菜单里选择「归档视频」，之后可以在这里恢复。' : '从「新建视频」开一部。'}</Empty>
          : view === 'grid'
            ? <div className="pgrid">{projects.map((p) => <ProjectCard key={p.id} p={p} />)}</div>
            : <div className="plist">{projects.map((p) => <ProjectRow key={p.id} p={p} />)}</div>}
      </Page>
    );
  }

  Object.assign(window, {ProjectsPage, ProjectCard, ProjectRow, Thumb, StatusBadge, HitRow, HitGroup});
})();
