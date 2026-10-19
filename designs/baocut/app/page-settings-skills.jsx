/* 把 BaoCut 的 skill 装进终端或其他应用里的 Agent（2026-09-17 从「Agent Skill & MCP」拆出；2026-10-18 重排）。
   在 Skills 页最上面，默认折叠（page-skills.jsx）；#/skills?tab=external 打开时展开。
   折叠着也要看得出两件事：装在哪（全局给了哪几个 Agent、几个项目），版本是不是最新——有可更新的直接给「全部更新」。
   展开后：一句说明 → 全局 / 项目两块安装位置（settings-skill-install.jsx）→ 安装方式、能做什么、怎么确认、命令参考 → MCP 的指路。
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
        line: [where, ov.stale.length ? `有 v${ov.oldest} 的旧版本 · 当前 v${ver}` : '有链接失效'].filter(Boolean).join(' · '),
        cta: ov.stale.length ? `全部更新到 v${ver}` : '全部修复'};
    }
    if (ov.kind === 'attention') return {tone: 'notice', chip: `${ov.foreign.length} 处被占用`, line: [where, `v${ver}`].filter(Boolean).join(' · ')};
    return {tone: 'positive', chip: `v${ver} · 最新`, line: where};
  }

  function ExternalAgentsCard({open, onOpenChange}) {
    const app = useApp();
    const [mode, setMode] = useState('copy');
    const [scenario, setScenario] = useState('default');
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
            {['baocut skill install --agent claude-code', 'baocut skill install --agent codex --dir ~/Projects/video/.codex/skills', 'baocut skill status'].map((cmd) =>
              <div className="agset-command" key={cmd}><code className="agset-path">{cmd}</code><IconBtn icon="copy" size="s" tip={'复制 ' + cmd} onClick={() => copy(cmd, '命令')} /></div>)}
          </BCDisclosure>
        </Card>

        <Card layer className="ags-related">
          <Ic n="link" className="ic--16" />
          <span className="grow svc__txt"><b className="t-title-sm">想让其他 AI 应用直接连接 BaoCut？</b><span className="t-detail">那是 MCP 服务，在「服务」里，和远端算力、Web 服务一起管理。</span></span>
          <Btn size="s" onClick={() => app.go({r: 'services', id: 'mcp'})}>打开 MCP 服务</Btn>
        </Card>

        <div className="agset-demo" aria-label="原型演示场景">
          <b>原型演示 · 切换磁盘上的情况</b>
          <div className="agset-rulelist">{M.SCENARIOS.map((sc) => <Chip key={sc.k} on={scenario === sc.k}
            onClick={() => { setScenario(sc.k); app.setSkillInstalls(M.scenarioInstalls(sc.k, ver)); }}>{sc.label}</Chip>)}</div>
        </div>
      </div> : null}
    </Card>;
  }
  Object.assign(window, {ExternalAgentsCard});
})();
