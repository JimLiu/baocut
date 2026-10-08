/* 设置 › Skills：BaoCut 内置 Agent 自己使用的 skills（语义见 model-agent-skills.js）。
   自上而下：一句导语（开关是什么意思）→ 工具条（搜索 / 按来源筛选 / 添加）→ 两列卡片 → 页底折叠区。
   点卡片开详情，开关在卡片右上角；详情、文件视图与两个添加对话框在 settings-agent-skill-detail.jsx。
   页底折叠区收的是另一件事——把 BaoCut 的 skill 装进终端或其他应用里的 Agent（page-settings-skills.jsx），默认收起；
   带着 {r:'settings', sec:'skills', tab:'external'} 过来时展开并滚到它。添加、导入、移除都是演示，不碰磁盘。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;

  function SkillCard({skill, onOpen, onToggle}) {
    return <div className={cx('skl-card', !skill.enabled && 'is-off')}>
      <BCAction type="button" className="skl-card__main" aria-label={'查看 ' + skill.name} onClick={onOpen}>
        <b className="skl-card__name">{skill.name}</b>
        <span className="skl-card__desc">{skill.description}</span>
        <span className="skl-card__meta">{K.metaLine(skill)}</span>
      </BCAction>
      <span className="skl-card__switch"><Switch on={skill.enabled} ariaLabel={'启用 ' + skill.name} onChange={onToggle} /></span>
    </div>;
  }

  function AgentSkillsManager() {
    const app = useApp();
    const list = app.agentSkills;
    const [query, setQuery] = useState('');
    const [tab, setTab] = useState('all');
    const [openId, setOpenId] = useState(null);
    const [adding, setAdding] = useState(null);   // null | 'folder' | 'github'
    const external = app.route && app.route.tab === 'external';
    const [extOpen, setExtOpen] = useState(!!external);
    const extRef = useRef(null);
    useEffect(() => {
      if (!external) return undefined;
      setExtOpen(true);
      const id = setTimeout(() => { if (extRef.current) extRef.current.scrollIntoView({block: 'start'}); }, 60);
      return () => clearTimeout(id);
    }, [external]);
    const rows = K.find(list, query, tab);
    const n = K.counts(list, query);
    const open = K.byId(list, openId);
    const toggle = (s, on) => {
      app.setAgentSkills((l) => K.toggle(l, s.id, on));
      app.toast(on ? `已打开「${s.name}」· Agent 觉得相关时会自己用它` : `已关闭「${s.name}」· 只在你从输入框「+」里选它时才用`);
    };
    return <div className="skl" data-screen-label="Skills 设置">
      <p className="agset-description">Skill 是一个文件夹（SKILL.md 加上可选的参考文件），教 Agent 按某种方法做事。开关开着，Agent 觉得相关时会自己用它；关着，只在你从输入框「+」里选它时才用。关闭不是删除，移除才是。</p>
      <div className="skl-bar">
        <R.SearchField aria-label="搜索 Skills" placeholder="搜索 Skills" value={query} onChange={setQuery} UNSAFE_className="skl-bar__search" />
        <R.SegmentedControl aria-label="按来源筛选" selectedKey={tab} onSelectionChange={(k) => setTab(String(k))}>
          {K.TABS.map((t) => <R.SegmentedControlItem key={t.k} id={t.k} aria-label={`${t.label}，${n[t.k]} 个`}><R.Text>{t.label} {n[t.k]}</R.Text></R.SegmentedControlItem>)}
        </R.SegmentedControl>
        <span className="spacer" />
        <R.MenuTrigger>
          <R.ActionButton aria-label="添加 Skill"><R.Icons.Add /><R.Text>添加 Skill</R.Text></R.ActionButton>
          <R.Menu aria-label="添加 Skill" onAction={(key) => setAdding(String(key))}>
            <R.MenuItem id="folder" textValue="从本地文件夹添加"><R.Icons.FolderOpen /><R.Text slot="label">从本地文件夹添加</R.Text></R.MenuItem>
            <R.MenuItem id="github" textValue="从 GitHub 导入"><R.Icons.Download /><R.Text slot="label">从 GitHub 导入</R.Text></R.MenuItem>
          </R.Menu>
        </R.MenuTrigger>
      </div>
      {rows.length ? <div className="skl-grid">
        {rows.map((s) => <SkillCard key={s.id} skill={s} onOpen={() => setOpenId(s.id)} onToggle={(on) => toggle(s, on)} />)}
      </div> : <div className="skl-empty" role="status">
        <b>{query.trim() ? `没有找到和「${query.trim()}」相关的 skill` : `还没有${tab === 'all' ? '' : K.sourceLabel(tab) + '的'} skill`}</b>
        <p>{query.trim() ? '换个词试试，或者切到「全部」。' : '点右上角的「添加 Skill」，从本地文件夹添加或从 GitHub 导入。'}</p>
      </div>}

      <div ref={extRef} className="skl-external">
        <Card layer className="agset-advanced">
          <BCDisclosure className="agset-disclosure" open={extOpen} onOpenChange={setExtOpen}
            title={<> 在终端或其他应用的 Agent 里使用 BaoCut <span>给它们安装 baocut skill</span> </>}>
            <window.AgentSkillsSection embedded />
          </BCDisclosure>
        </Card>
      </div>
      <p className="agset-prototype-note">原型演示 · 添加、导入与移除使用示例数据，不会读写磁盘，也不会访问网络。</p>

      {open ? <window.AgentSkillDetail skill={open} onToggle={(on) => toggle(open, on)} onClose={() => setOpenId(null)} /> : null}
      {adding === 'folder' ? <window.AgentSkillAddFolder onClose={() => setAdding(null)} onAdded={(s) => setOpenId(s.id)} /> : null}
      {adding === 'github' ? <window.AgentSkillAddGithub onClose={() => setAdding(null)} onAdded={(s) => setOpenId(s.id)} /> : null}
    </div>;
  }
  Object.assign(window, {AgentSkillsManager});
})();
