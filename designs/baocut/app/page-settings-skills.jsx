/* 把 BaoCut 的 skill 装进终端或其他应用里的 Agent（2026-09-17 从「Agent Skill & MCP」拆出；2026-09-18 重设计）。
   现在不是单独的页签：收在 设置 › Skills 页底的折叠区里（settings-agent-skills.jsx）。
   内置 Agent 自己使用的 skills 是另一件事，见 model-agent-skills.js。
   新手要先弄懂三件事，页面就按这个顺序排：
   ① skill 是什么——一份给编码 Agent 看的说明书，装上之后它才知道怎么调用 BaoCut；
   ② 我需不需要装——在 BaoCut 里用 Agent 不用装，在终端或别的应用里用才要装；
   ③ 怎么装、装在哪——默认软链接到 App 内置的那一份，也可以复制一份（settings-skill-install.jsx）。
   页顶状态卡一个按钮装齐 / 修好；异常（副本过期、链接失效、位置被占用、App 不在「应用程序」）各有说明与修法。
   UI 提案，不碰磁盘。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const M = window.BC_SKILL_INSTALL;

  /* embedded：嵌在 Skills 页的折叠区里，标题由外面画 */
  function AgentSkillsSection({embedded}) {
    const app = useApp();
    const [mode, setMode] = useState('link');
    const [scenario, setScenario] = useState('default');
    const ver = D.app.skillVersion;
    const ov = M.overview(app.skillInstalls, ver);
    const appPath = M.scenarioAppPath(scenario);
    const warn = M.sourceWarning(appPath);
    const copy = async (text, label) => {
      try { await navigator.clipboard.writeText(text); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
    const installAll = () => {
      app.setSkillInstalls((m) => ov.missing.reduce((acc, p) => M.put(acc, p, mode, ver), m));
      app.toast(`已用${M.modeLabel(mode)}安装到 ${ov.missing.length} 个位置（演示）`, 'positive');
    };
    const fixAll = () => {
      app.setSkillInstalls((m) => M.repairAll(m, ov.fixable, ver));
      app.toast(`已修复 ${ov.fixable.length} 处（演示）`, 'positive');
    };
    const hero = {
      all: {title: 'baocut skill 已安装，终端里的 Agent 可以直接使用 BaoCut', sub: `v${ver} · 共 ${ov.count} 处`},
      partial: {title: `baocut skill 已安装到 ${ov.n} / ${ov.total} 个全局位置`, sub: `v${ver} · 没装的那个 Agent 还不知道怎么使用 BaoCut`, cta: '装齐全局位置', run: installAll},
      none: {title: 'baocut skill 尚未安装', sub: '终端里的 Agent 还不知道怎么使用 BaoCut。一键安装到 Claude Code、Codex 等 Agent 的全局位置。', cta: '安装到全部 Agent', run: installAll},
      attention: {title: `${ov.issues.length} 处安装需要处理`, sub: ov.fixable.length ? '副本过期或链接失效，一键就能修好；你的文件不会被删除。' : '有位置被不是 BaoCut 创建的文件夹占用。BaoCut 不会替换它，见下方。',
        cta: ov.fixable.length ? '全部修复' : null, run: fixAll},
    }[ov.kind];

    return <div className="agent-settings" data-screen-label="Agent Skills 设置">
      {embedded ? null : <h1 className="t-heading-sm">Agent Skills</h1>}
      <p className="agset-lede">Skill 是一份给 AI 编码助手看的「使用说明书」。装上之后，你在终端里对 Claude Code 或 Codex 说一句「用 BaoCut 给这个视频加字幕」，它就知道该怎么转录、翻译、剪辑和导出。</p>

      <div className="ags-when" aria-label="什么时候需要安装">
        <div className="ags-when__i"><Ic n="ok" className="ic--16" /><div><b>在 BaoCut 里用 Agent</b><p>不用安装。每条会话开始时，BaoCut 自动带上这份 skill 和内置指令。</p></div></div>
        <div className="ags-when__i is-here"><Ic n="skill" className="ic--16" /><div><b>在终端或其他应用里用 Agent</b><p>在这里安装。装一次，之后一直可用，没有开关也不占后台。</p></div></div>
      </div>

      <Card layer className={cx('ags-hero', 'is-' + ov.kind)}>
        <span className={cx('svc__mark', ov.kind === 'attention' ? 'is-error' : ov.kind !== 'none' && 'is-on')}><Ic n={ov.kind === 'attention' ? 'alert' : 'skill'} className="ic--16" /></span>
        <span className="grow svc__txt"><b className="t-title-sm">{hero.title}</b><span className="t-detail">{hero.sub}</span></span>
        {hero.cta ? <Btn variant="accent" onClick={hero.run}>{hero.cta}</Btn> : ov.kind === 'all' ? <Chip tone="positive">已就绪</Chip> : null}
      </Card>
      {warn ? <div className="agp-problem is-notice ags-warn" role="alert"><Ic n="alert" className="ic--16" />
        <div className="grow"><b>{warn.title}</b><p>{warn.body}</p></div>
        {mode === 'link' ? <Btn size="s" onClick={() => setMode('copy')}>改用复制</Btn> : null}</div> : null}

      {/* 2026-10-01 baocut skill 能做什么：App 从装着的 skill 的 workflows.json 现读，这里用 data.js 的演示副本 */}
      {D.skill.catalog && D.skill.catalog.length ? <Card layer className="ags-catalog">
        <b className="t-title-sm">baocut skill 能做什么</b>
        <p className="t-detail">从 BaoCut 自带的这份 skill 里读出的 {D.skill.catalog.length} 类。直接说你想做什么，Agent 会自己找到对应的那一类。</p>
        <ul className="ags-catalog__grid">
          {D.skill.catalog.map((c) => <li key={c.id}><b>{c.name}</b>{c.desc ? <p>{c.desc}</p> : null}
            {c.commands.length ? <code>{c.commands.slice(0, 4).map((x) => 'bcut ' + x).join(' · ')}{c.commands.length > 4 ? ' · +' + (c.commands.length - 4) : ''}</code> : null}</li>)}
        </ul>
      </Card> : null}

      <window.SkillInstallSection mode={mode} setMode={setMode} />

      <Card layer className="agset-advanced ags-context">
        <BCDisclosure className="agset-disclosure" title={<> 怎么确认装好了？ </>}>
          <p>在终端里打开你的 Agent，问它「你会用 BaoCut 吗」，或输入 <code>/skills</code> 查看已加载的 skill，列表里有 baocut 就是装好了。刚装完需要新开一个 Agent 会话才会读到。</p></BCDisclosure>
        <BCDisclosure className="agset-disclosure" title={<> Skill 来源 <span>BaoCut App 内置目录 · v{ver}</span> </>}>
          <code className="agset-path">{appPath}</code>
          <p>软链接的安装位置都指向这里，所以 App 更新后读到的就是新版本；复制的副本是装的那一刻的内容。</p>
          <div className="row gap8"><Btn size="s" icon="copy" onClick={() => copy(appPath, '源路径')}>复制源路径</Btn><Btn size="s" onClick={() => app.toast('原型演示：在文件夹中显示 ' + appPath)}>在文件夹中显示</Btn></div></BCDisclosure>
        <BCDisclosure className="agset-disclosure" title={<> 内置指令与工作目录 <span>BaoCut 自动管理</span> </>}>
          <p>BaoCut 里的会话开始前，会自动准备内置指令与 skill 链接。这个工作目录独立于视频包。</p>
          <code className="agset-path">{D.skill.agentDir}</code>
          <div className="row gap8"><Btn size="s" onClick={() => copy(D.skill.contextDoc, '内置指令')}>复制内置指令</Btn><Btn size="s" onClick={() => app.toast('原型演示：在文件夹中显示 ' + D.skill.agentDir)}>在文件夹中显示</Btn></div>
        </BCDisclosure>
        <BCDisclosure className="agset-disclosure" title={<> 终端命令参考 </>}>
          {D.skill.commands.map((c) => <div className="agset-command" key={c.cmd}><div><b>{c.desc}</b><code className="agset-path">{c.cmd}</code></div><IconBtn icon="copy" size="s" tip={'复制 ' + c.cmd} onClick={() => copy(c.cmd, '命令')} /></div>)}
        </BCDisclosure>
      </Card>

      <Card layer className="ags-related">
        <Ic n="link" className="ic--16" />
        <span className="grow svc__txt"><b className="t-title-sm">想让其他 AI 应用直接连接 BaoCut？</b><span className="t-detail">那是 MCP 服务，在侧栏的「服务」里，和远端算力、Web 服务一起管理。</span></span>
        <Btn size="s" onClick={() => app.go({r: 'services', id: 'mcp'})}>打开 MCP 服务</Btn>
      </Card>

      <div className="agset-demo" aria-label="原型演示场景">
        <b>原型演示 · 切换磁盘上的情况</b>
        <div className="agset-rulelist">{M.SCENARIOS.map((sc) => <Chip key={sc.k} on={scenario === sc.k}
          onClick={() => { setScenario(sc.k); app.setSkillInstalls(M.scenarioInstalls(sc.k)); app.setSkillRoots([]); }}>{sc.label}</Chip>)}</div>
      </div>
      <p className="agset-prototype-note">原型演示 · 安装操作使用示例状态，不会在磁盘上创建链接或复制文件。</p>
    </div>;
  }
  Object.assign(window, {AgentSkillsSection});
})();
