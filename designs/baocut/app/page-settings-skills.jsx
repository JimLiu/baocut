/* 把 BaoCut 的 skill 装进终端或其他应用里的 Agent（2026-09-17 从「Agent Skill & MCP」拆出；2026-10-18 重排）。
   在 Skills 页最上面，默认折叠（page-skills.jsx）；#/skills?tab=external 打开时展开。
   折叠着也要看得出两件事：装在哪（全局给了哪几个 Agent、几个目录），版本是不是最新——有可更新的直接给「全部更新」。
   展开后：一句说明 → App 自带的三样（skill 本体、命令行 baocut、MCP 服务，各带版本 / 路径 / 状态）→
   全局 / 指定目录两块安装位置（settings-skill-install.jsx）→ 安装方式、能做什么、怎么确认、命令参考。
   skill 与命令行都随 App 打包发布，默认安装都是指向 App 内那份的软链接（symlink），不复制（model-skill-install.js）。
   内置 Agent 自己使用的 skills 是另一件事，见 model-agent-skills.js。UI 提案，不碰磁盘。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const M = window.BC_SKILL_INSTALL;

  /** 折叠行上的一句状态与按钮：none 没装 / ok 都最新 / update 可更新或可修 / attention 有 BaoCut 不碰的占用 */
  function summaryOf(ov, ver) {
    const where = M.whereLine(ov);
    if (ov.kind === 'none') return {tone: undefined, chip: '尚未安装', line: '装上之后，Claude Code、Codex 等 Agent 就知道怎么用 BaoCut 转录、翻译、剪辑和导出。'};
    if (ov.kind === 'update') {
      const n = ov.fixable.length;
      return {tone: 'notice', chip: ov.stale.length ? `${n} 处可更新` : `${n} 处要修复`,
        line: [where, ov.stale.length ? `有 v${ov.oldest} 的旧副本 · App 自带 v${ver}` : '有软链接失效'].filter(Boolean).join(' · '),
        cta: ov.stale.length ? `全部更新到 v${ver}` : '全部修复'};
    }
    if (ov.kind === 'attention') return {tone: 'notice', chip: `${ov.foreign.length} 处被占用`, line: [where, `v${ver}`].filter(Boolean).join(' · ')};
    return {tone: 'positive', chip: `v${ver} · 最新`, line: where};
  }

  /** App 自带的三样：skill 本体、命令行、MCP。都跟 App 一起发布，这里只说在哪、什么版本、开没开。 */
  function BundledRows({cli, setCli, appPath}) {
    const app = useApp();
    const ver = D.app.skillVersion;
    const cs = M.cliState(cli, D.app.version);
    const mcpOn = !!(app.svcStates && app.svcStates.mcp && app.svcStates.mcp.on);
    const reveal = (p) => app.toast('原型演示：在文件夹中显示 ' + p);
    const installCli = () => { setCli({path: M.cliPath, target: M.cliSource}); app.toast(`已把 baocut 软链接到 ${M.cliPath}（演示）· 新开终端后可用`, 'positive'); };
    return <div className="ags-location ags-location--first">
      <h3 className="t-title-sm">BaoCut 自带</h3>
      <p>skill 和命令行都在 App 里，跟 App 一起发布、一起更新。下面的安装默认只是在 Agent 找得到的位置放一个指向它们的软链接，不复制文件。</p>
      <div className="ags-link-row">
        <div className="grow"><span className="ags-reader">baocut skill</span><code>{appPath}</code>
          <span className="ags-link-state">{`v${ver} · 随 BaoCut ${D.app.version} 发布`}</span></div>
        <IconBtn size="s" icon="folder" tip="在文件夹中显示" onClick={() => reveal(appPath)} />
      </div>
      <div className="ags-link-row">
        <div className="grow"><span className="ags-reader">命令行 baocut</span>
          {cli ? <code>{cli.path}{cli.target ? ' → ' + cli.target : ''}</code> : null}
          <span className={cx('ags-link-state', cs.tone && 'is-' + cs.tone)}>{cs.text}</span></div>
        {cs.cta ? <Btn size="s" onClick={installCli}>{cs.cta}</Btn>
          : <IconBtn size="s" icon="folder" tip="在文件夹中显示" onClick={() => reveal(cli.path)} />}
      </div>
      {cs.kind === 'other' ? <p className="hint">{`终端里的 baocut 会用这一个。想换成 App 自带的，先移除它，再回到这里安装命令行。`}</p> : null}
      <div className="ags-link-row">
        <div className="grow"><span className="ags-reader">MCP 服务</span>
          <span className="t-detail">不装 skill 也行：让其他 AI 应用直接连接 BaoCut，调用它的工具。</span>
          <span className={cx('ags-link-state', mcpOn && 'is-positive')}>{mcpOn ? '运行中' : '未启动'}</span></div>
        <Btn size="s" onClick={() => app.go({r: 'services', id: 'mcp'})}>打开 MCP 服务</Btn>
      </div>
    </div>;
  }

  function ExternalAgentsCard({open, onOpenChange}) {
    const app = useApp();
    const [mode, setMode] = useState('link');
    const [scenario, setScenario] = useState('default');
    const [cli, setCli] = useState(() => M.scenarioCli('default'));
    const appPath = M.scenarioAppPath(scenario);
    const warn = M.sourceWarning(appPath);
    const ver = D.app.skillVersion;
    const ov = M.overview(app.skillInstalls, ver);
    const sum = summaryOf(ov, ver);
    const copy = async (text, label) => {
      try { await navigator.clipboard.writeText(text); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
    const updateAll = () => {
      app.setSkillInstalls((m) => M.repairAll(m, ov.fixable, ver));
      app.toast(`已把 ${ov.fixable.length} 处更新到 v${ver}（演示）· 新开 Agent 会话后生效`, 'positive');
    };
    return <Card layer className={cx('skp-ext', open && 'is-open')} data-screen-label="外部 Agent">
      <div className="skp-ext__bar">
        <BCAction type="button" className="skp-ext__toggle" aria-expanded={!!open} onClick={() => onOpenChange(!open)}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--16" />
          <span className={cx('svc__mark', ov.kind === 'ok' && 'is-on')}><Ic n="skill" className="ic--16" /></span>
          <span className="skp-ext__text">
            <b>在终端或其他应用的 Agent 里使用 BaoCut</b>
            <span>{sum.line}</span>
          </span>
        </BCAction>
        <Chip tone={sum.tone}>{sum.chip}</Chip>
        {sum.cta ? <Btn size="s" variant="accent" onClick={updateAll}>{sum.cta}</Btn> : null}
        {ov.kind === 'none' && !open ? <Btn size="s" onClick={() => onOpenChange(true)}>安装…</Btn> : null}
      </div>
      {open ? <div className="skp-ext__body agent-settings">
        <p className="agset-lede">这份 skill 是给 Claude Code、Codex 这类 Agent 看的使用说明书。装上之后，在终端里说一句「用 BaoCut 给这个视频加字幕」，它就知道该怎么做。在 BaoCut 里用 Agent 不用装，会话会自动带上。</p>
        <BundledRows cli={cli} setCli={setCli} appPath={appPath} />
        {warn ? <div className="agp-problem is-notice ags-warn" role="note"><Ic n="alert" className="ic--16" />
          <div className="grow"><b>{warn.title}</b><p>{warn.body}</p></div></div> : null}
        {ov.foreign.length ? <div className="agp-problem is-notice ags-warn" role="note"><Ic n="alert" className="ic--16" />
          <div className="grow"><b>有位置被占用</b><p>那里已有一个不是 BaoCut 装的 baocut。BaoCut 不会替换它；把它移走或改名后再回来安装。</p></div></div> : null}
        <window.SkillInstallSection mode={mode} />

        <Card layer className="agset-advanced ags-context">
          <BCDisclosure className="agset-disclosure" title={<> 安装方式 <span>{M.modeLabel(mode)}</span> </>}>
            <p>对之后的每一次安装生效；已经装好的位置可以在各自的菜单里单独切换。</p>
            <BCChoiceGroup className="ags-modes" value={mode} onChange={setMode} aria-label="安装方式">
              {M.MODES.map((m) => <BCAction key={m.k} type="button" choiceKey={m.k} className={cx('agm-access__option', mode === m.k && 'is-on')}>
                <span><b>{m.label}{m.tag ? <span className="agp-tier">{m.tag}</span> : null}</b><span>{m.desc}</span></span>
              </BCAction>)}
            </BCChoiceGroup>
          </BCDisclosure>
          {/* 2026-10-01 baocut skill 能做什么：App 从装着的 skill 的 workflows.json 现读，这里用 data.js 的演示副本 */}
          {D.skill.catalog && D.skill.catalog.length ? <BCDisclosure className="agset-disclosure" title={<> baocut skill 能做什么 <span>{`${D.skill.catalog.length} 类`}</span> </>}>
            <ul className="ags-catalog__grid">
              {D.skill.catalog.map((c) => <li key={c.id}><b>{c.name}</b>{c.desc ? <p>{c.desc}</p> : null}</li>)}
            </ul>
          </BCDisclosure> : null}
          <BCDisclosure className="agset-disclosure" title={<> 怎么确认装好了？ </>}>
            <p>在终端里新开一个 Agent 会话，问它「你会用 BaoCut 吗」，或输入 <code>/skills</code> 查看已加载的 skill，列表里有 baocut 就是装好了。已经开着的会话要重开才会读到新版本。</p>
          </BCDisclosure>
          <BCDisclosure className="agset-disclosure" title={<> 用命令行安装 </>}>
            <p>和这里的按钮做同样的事。不带 --dir 装全局，--dir 可以是任意文件夹；默认是软链接，加 --copy 复制一份。</p>
            {['baocut skill install', 'baocut skill install --dir ~/Projects/video', 'baocut skill status'].map((cmd) =>
              <div className="agset-command" key={cmd}><code className="agset-path">{cmd}</code><IconBtn icon="copy" size="s" tip={'复制 ' + cmd} onClick={() => copy(cmd, '命令')} /></div>)}
          </BCDisclosure>
        </Card>

        <div className="agset-demo" aria-label="原型演示场景">
          <b>原型演示 · 切换磁盘上的情况</b>
          <div className="agset-rulelist">{M.SCENARIOS.map((sc) => <Chip key={sc.k} on={scenario === sc.k}
            onClick={() => { setScenario(sc.k); setCli(M.scenarioCli(sc.k)); app.setSkillInstalls(M.scenarioInstalls(sc.k)); }}>{sc.label}</Chip>)}</div>
        </div>
      </div> : null}
    </Card>;
  }
  Object.assign(window, {ExternalAgentsCard});
})();
