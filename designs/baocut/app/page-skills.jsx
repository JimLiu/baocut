/* Skills 页（App rail 上 Space 下面一格，2026-10-16；原来在设置 › Skills）。
   一个 skill 是一个文件夹：SKILL.md 加上参考文件和素材（logo、印章、片头音乐、字体……）。素材就是 skill 的一部分，
   上传 zip 或文件夹时一起进来，Agent 用这个 skill 时能把它们用进视频。
   路由：#/skills（列表）、#/skills/<id>（详情，?tab=files&file=<路径> 看文件）、#/skills?dir=<项目 id>（那个项目的 BRAND.md，
   page-project-brand.jsx）、#/skills?tab=external（页底「在终端或其他应用里用 BaoCut」展开）。
   列表自上而下：一句导语 → 「我的」（个人与从 GitHub 导入的）→ 「项目品牌」（各项目根目录的 BRAND.md）→ 「BaoCut 内置」→ 页底折叠区。
   每行：类别图标、名字与标记（新 / 类别 / 素材数 / GitHub）、作者与一句话、日期、开关、更多菜单；点行进详情。
   把 zip 或文件夹拖到页面上任何地方都打开上传。详情在 page-skill-detail.jsx，上传与新建在 page-skills-upload.jsx。
   添加、导入、编辑与移除都是演示，不碰磁盘、不访问网络。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_SKILL_PKG;

  function SkillIcon({skill, size}) {
    const Icon = skill.source === 'project' ? R.Icons.Folder : R.Icons[P.iconName(skill.category)] || R.Icons.Lightbulb;
    return <span className={cx('skp-icon', size === 'l' && 'skp-icon--l')} aria-hidden="true"><Icon /></span>;
  }

  /* 行和详情页共用的「更多」菜单：试一下 / 编辑 / 下载 / 在文件夹中显示 / 复制一份 / 移除 */
  function useSkillActions() {
    const app = useApp();
    const open = (skill, tab) => app.go({r: 'skills', id: skill.id, ...(tab ? {tab} : {})});
    return {
      tryIt(skill, prompt) { app.newProject({entry: 'agent', prompt: prompt || (skill.examples || [])[0] || '', skill: skill.id}); },
      download(skill) { app.toast(`原型演示：已把「${skill.name}」打包成 ${skill.id}.zip`, 'positive'); },
      reveal(skill) { app.toast(`原型演示：在文件夹中显示「${skill.name}」`); },
      duplicate(skill) {
        const r = P.duplicate(app.agentSkills, skill.id);
        app.setAgentSkills(() => r.list);
        app.toast(`已复制到「我的」· 可以改了`, 'positive');
        app.go({r: 'skills', id: r.id, tab: 'files'});
      },
      remove(skill, after) {
        const r = K.remove(app.agentSkills, skill.id);
        if (r.error) { app.toast(r.error); return; }
        app.setAgentSkills((l) => K.remove(l, skill.id).list);
        if (after) after();
        app.toast(`已移除「${skill.name}」（演示）`, null, {label: '撤销', run: () => app.setAgentSkills((l) => K.add(l, skill).list)});
      },
      open,
    };
  }

  function SkillMoreMenu({skill, onRemoved, label}) {
    const act = useSkillActions();
    const builtin = skill.source === 'builtin';
    const run = (key) => {
      if (key === 'try') act.tryIt(skill);
      else if (key === 'edit') act.open(skill, 'files');
      else if (key === 'download') act.download(skill);
      else if (key === 'reveal') act.reveal(skill);
      else if (key === 'duplicate') act.duplicate(skill);
      else if (key === 'remove') act.remove(skill, onRemoved);
    };
    return <R.MenuTrigger>
      <R.ActionButton isQuiet aria-label={label || `「${skill.name}」的更多操作`}><R.Icons.More /></R.ActionButton>
      <R.Menu aria-label="更多操作" onAction={(k) => run(String(k))} disabledKeys={builtin ? ['remove'] : []}>
        <R.MenuItem id="try" textValue="试一下"><R.Icons.Play /><R.Text slot="label">试一下</R.Text></R.MenuItem>
        {builtin ? null : <R.MenuItem id="edit" textValue="编辑"><R.Icons.Edit /><R.Text slot="label">编辑</R.Text></R.MenuItem>}
        <R.MenuItem id="download" textValue="下载"><R.Icons.Download /><R.Text slot="label">下载</R.Text>
          <R.Text slot="description">打包成 zip，带上全部文件与素材</R.Text></R.MenuItem>
        <R.MenuItem id="reveal" textValue="在文件夹中显示"><R.Icons.FolderOpen /><R.Text slot="label">在文件夹中显示</R.Text></R.MenuItem>
        <R.MenuItem id="duplicate" textValue="复制一份"><R.Icons.Duplicate /><R.Text slot="label">复制一份</R.Text>
          <R.Text slot="description">{builtin ? '内置的不能改，复制到「我的」再改' : '在「我的」里多一份，可以分开改'}</R.Text></R.MenuItem>
        <R.MenuItem id="remove" textValue="移除"><R.Icons.Delete /><R.Text slot="label">移除</R.Text>
          <R.Text slot="description">{builtin ? '内置 skill 不能移除，可以把它关掉' : '从 BaoCut 里移除，连同它的素材'}</R.Text></R.MenuItem>
      </R.Menu>
    </R.MenuTrigger>;
  }

  /* 标记：新（刚装或刚改）、类别、素材数、来自 GitHub */
  function SkillBadges({skill}) {
    const st = P.stats(skill);
    return <span className="skp-badges">
      {skill.fresh ? <R.Badge variant="accent" size="S">新</R.Badge> : null}
      <R.Badge variant="neutral" fillStyle="subtle" size="S">{skill.source === 'project' ? 'BRAND.md' : skill.category}</R.Badge>
      {st.assets.length ? <R.Badge variant="informative" fillStyle="subtle" size="S">{`素材 ${st.assets.length}`}</R.Badge> : null}
      {skill.source === 'third-party' ? <R.Badge variant="neutral" fillStyle="outline" size="S">GitHub</R.Badge> : null}
    </span>;
  }

  function SkillRow({skill, onToggle}) {
    const act = useSkillActions();
    return <div className={cx('skp-row', !skill.enabled && 'is-off')}>
      <BCAction type="button" className="skp-row__main" aria-label={'查看 ' + K.fullName(skill)} onClick={() => act.open(skill)}>
        <SkillIcon skill={skill} />
        <span className="skp-row__text">
          <span className="skp-row__title"><b>{K.fullName(skill)}</b><SkillBadges skill={skill} /></span>
          <span className="skp-row__sub">{P.byline(skill)} · {K.blurb(skill)}</span>
        </span>
        <span className="skp-row__date">{P.dateLabel(skill)}</span>
      </BCAction>
      <span className="skp-row__end">
        <Switch on={skill.enabled} ariaLabel={'启用 ' + skill.name} onChange={onToggle} />
        <SkillMoreMenu skill={skill} />
      </span>
    </div>;
  }

  function AddSkillMenu({onPick}) {
    return <R.MenuTrigger>
      <R.Button variant="accent"><R.Icons.Add /><R.Text>添加</R.Text></R.Button>
      <R.Menu aria-label="添加 Skill" onAction={(k) => onPick(String(k))}>
        <R.MenuItem id="upload" textValue="上传 zip 或文件夹"><R.Icons.Upload /><R.Text slot="label">上传 zip 或文件夹</R.Text>
          <R.Text slot="description">SKILL.md 和素材一起进来</R.Text></R.MenuItem>
        <R.MenuItem id="github" textValue="从 GitHub 导入"><R.Icons.Link /><R.Text slot="label">从 GitHub 导入</R.Text></R.MenuItem>
        <R.MenuItem id="blank" textValue="新建 skill"><R.Icons.Edit /><R.Text slot="label">新建 skill</R.Text>
          <R.Text slot="description">从一份 SKILL.md 模板开始写</R.Text></R.MenuItem>
        <R.MenuItem id="agent" textValue="用 Agent 创建"><R.Icons.AIMark /><R.Text slot="label">用 Agent 创建</R.Text>
          <R.Text slot="description">说说你的做法，Agent 帮你写成 skill</R.Text></R.MenuItem>
      </R.Menu>
    </R.MenuTrigger>;
  }

  function SkillsList({tab}) {
    const app = useApp();
    const [query, setQuery] = useState('');
    const [adding, setAdding] = useState(null);   // null | 'upload' | 'github' | 'blank'
    const [dropped, setDropped] = useState(null);   // 拖到页面上的 entry，交给上传对话框去读
    const [dragging, setDragging] = useState(false);
    const external = tab === 'external';
    const [extOpen, setExtOpen] = useState(external);
    const extRef = useRef(null);
    const depth = useRef(0);
    useEffect(() => {
      if (!external) return undefined;
      setExtOpen(true);
      const id = setTimeout(() => { if (extRef.current) extRef.current.scrollIntoView({block: 'start'}); }, 60);
      return () => clearTimeout(id);
    }, [external]);
    const toggle = (s, on) => {
      app.setAgentSkills((l) => K.toggle(l, s.id, on));
      app.toast(on ? `已打开「${s.name}」· Agent 觉得相关时会自己用它` : `已关闭「${s.name}」· 只在你从输入框「+」里选它时才用`);
    };
    const pick = (k) => {
      if (k === 'agent') { app.newProject({entry: 'agent', prompt: '帮我做一个 skill：每期视频都要用的 logo、印章、开场白和配音音色，我把要求和素材发给你。'}); return; }
      setDropped(null); setAdding(k);
    };
    const groups = P.sections(app.agentSkills, query);
    const q = query.trim();
    /* 拖进来：只看拖的是不是文件；松手就开上传，把拖进来的交给它读（原型不解压 zip，见上传对话框） */
    const isFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes('Files');
    const drag = {
      onDragEnter: (e) => { if (!isFiles(e)) return; depth.current++; setDragging(true); },
      onDragOver: (e) => { if (isFiles(e)) e.preventDefault(); },
      onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
      onDrop: (e) => { if (!isFiles(e)) return; e.preventDefault(); depth.current = 0; setDragging(false); setDropped(window.skillDropEntries(e.dataTransfer)); setAdding('upload'); },
    };
    return <div className="skp-drop" {...drag} data-screen-label="Skills">
      <window.Page title="Skills" actions={<>
        <R.SearchField aria-label="搜索 Skills" placeholder="搜索" value={query} onChange={setQuery} UNSAFE_className="skp-search" />
        <AddSkillMenu onPick={pick} />
      </>}>
        <p className="skp-lede">Skill 教 Agent 按你的方法做事：一份 SKILL.md，加上参考文件和素材（logo、印章、片头音乐、字体）。开着的，Agent 觉得相关时会自己用；关着的，只在你从输入框「+」里选它时才用。</p>
        {groups.map((g) => <React.Fragment key={g.k}>{g.k === 'builtin' ? <window.ProjectBrandsSection query={query} /> : null}<section className="skp-section" aria-label={g.label}>
          <h2 className="skp-section__hd">{g.label}<span>{g.items.length}</span></h2>
          {g.items.length ? <div className="skp-list">
            {g.items.map((s) => <SkillRow key={s.id} skill={s} onToggle={(on) => toggle(s, on)} />)}
          </div> : g.k === 'mine' && !q ? <div className="skp-empty">
            <b>还没有你自己的 skill</b>
            <p>把你的做法和素材打包成 skill：栏目名、口号、logo、印章、片头音乐、配音音色。上传后 Agent 每次都照着做。</p>
            <span className="skp-empty__acts">
              <Btn variant="accent" icon="upload" onClick={() => pick('upload')}>上传 zip 或文件夹</Btn>
              <Btn onClick={() => setAdding('blank')}>新建 skill</Btn>
            </span>
          </div> : <p className="skp-none">{q ? `没有和「${q}」相关的${g.label === '我的' ? '个人' : '内置'} skill` : '没有'}</p>}
        </section></React.Fragment>)}

        <div ref={extRef} className="skp-external">
          <Card layer className="agset-advanced">
            <BCDisclosure className="agset-disclosure" open={extOpen} onOpenChange={setExtOpen}
              title={<> 在终端或其他应用的 Agent 里使用 BaoCut <span>给它们安装 baocut skill</span> </>}>
              <window.AgentSkillsSection embedded />
            </BCDisclosure>
          </Card>
        </div>
        <p className="agset-prototype-note">原型演示 · 上传、导入、编辑与移除使用示例数据，不会读写磁盘，也不会访问网络。</p>
      </window.Page>
      {dragging ? <div className="skp-dropzone" aria-hidden="true"><span><R.Icons.Upload /><b>松开上传 skill</b><em>zip 或文件夹，根目录要有 SKILL.md</em></span></div> : null}
      {adding === 'upload' ? <window.SkillUploadDialog dropped={dropped} onClose={() => { setAdding(null); setDropped(null); }} /> : null}
      {adding === 'github' ? <window.SkillGithubDialog onClose={() => setAdding(null)} /> : null}
      {adding === 'blank' ? <window.SkillBlankDialog onClose={() => setAdding(null)} /> : null}
    </div>;
  }

  function SkillsPage({id, dir, tab, file}) {
    if (dir) return <window.ProjectBrandPage dir={dir} tab={tab} file={file} />;
    return id ? <window.SkillDetailPage id={id} tab={tab} file={file} /> : <SkillsList tab={tab} />;
  }

  Object.assign(window, {SkillsPage, SkillIcon, SkillBadges, SkillMoreMenu, useSkillActions});
})();
