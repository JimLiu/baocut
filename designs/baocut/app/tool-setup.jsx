/* 工具设置态 —— §5 / §13.8 / §17.2（第 110 轮立、第 111 轮加「谁来做」）。
   AI 工具页的设置态与 Agent 放行卡是**同一个东西**：先用一句人话说清这一步
   （「这一步会用 gpt-4o 翻译 42 句」），下面可以改、然后才「开始」或「允许」。
   工具页第一行是「用」——本机编码 Agent 还是直接调模型，一个下拉两组候选，选哪一项
   决定摘要句、主按钮与按下之后发生的事；选择全局记忆（store `runner`）。
   放行卡里不选谁来做（已经在 Agent 会话里了），仍走「模型」那一行。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;

  /* 云端 LLM 下拉（放行卡用）：与新建向导 / 翻译面板同一份 provider 列表（D.transModels）。
     没连 key 的不置灰（置灰是死胡同）——照常可选，sub 上写清「未连接 key」，
     选中后由摘要行提示去云端设置连上。 */
  function ModelPick({value, onChange, size}) {
    const [pop, setPop] = useState(false);
    const cur = D.transModels.find((m) => m.id === value) || D.transModels.find((m) => m.dflt) || D.transModels[0];
    return (
      <Picker size={size || 's'} value={cur.name + ' · ' + cur.provider} open={pop} popWidth={264}
        onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
        <Menu>
          {D.transModels.map((m) => (
            <MenuItem key={m.id} label={m.name} sub={m.note ? `${m.provider} · ${m.note}` : m.provider} on={m.id === cur.id}
              onClick={() => { onChange(m); setPop(false); }} />
          ))}
        </Menu>
      </Picker>
    );
  }

  /* 「用」下拉（2026-09-20 改成两页）：第 186 轮把 Agent 组做成两级之后，一屏仍是「Agent 组在上、
     直接调模型在下」摞成一长条——装了五六家 Agent 的机器上，第二组被推到弹层底部，用户根本不知道
     还能直接调模型 API。现在弹层顶部是一枚两段开关「交给 Agent · N ／ 直接调模型 · N」，一次只看一组，
     段下一行说清这一组是什么；两组各自带一条去设置的尾项。打开时落在当前选中项所在的那一段。
     Agent 页仍是 agent-picker.jsx 的公共两级（每家一行 → 它的模型）；第二级时开关收起，返回行是唯一的出口。
     列表本身限高内滚——再多几家，开关也不会被顶出去。 */
  function RunnerPick({groups, value, onChange, size}) {
    const app = useApp();
    const lv = useAgentPickerLevels();
    const tabs = AG.runnerTabs(groups, value);
    const [tab, setTab] = useState(null);
    const curTab = tab || (tabs.find((t) => t.on) || tabs[0]).k;
    const grp = groups.find((g) => g.kind === curTab) || groups[0];
    const agents = groups[0].items;
    const sel = value && value.kind === 'agent' ? {harness: value.harness, model: value.model} : {};
    const cur = lv.level ? app.harnessList.find((x) => x.id === lv.level) : null;
    const close = () => { lv.close(); setTab(null); };
    const toggle = () => { setTab(null); lv.toggle(); };
    const goAgentSettings = () => { close(); app.go({r: 'settings', sec: 'agent'}); };
    const goCloudSettings = () => { close(); app.go({r: 'settings', sec: 'cloud'}); };
    const pickAgent = (h, id) => {
      const it = agents.find((i) => i.harness === h.id && i.model === id) || {k: id ? `agent:${h.id}:${id}` : `agent:${h.id}`};
      onChange(it); close();
    };
    const tabLabel = (t) => (t.count == null ? t.label : `${t.label} · ${t.count}`);
    return (
      <Picker size={size || 's'} icon={value ? (value.kind === 'agent' ? 'agent' : 'sparkle') : null}
        value={value ? value.label : '选一个'} open={lv.pop} popWidth={288}
        onClick={toggle} onClose={close}>
        {cur ? (
          <AgentModelLevel h={cur} sel={sel} onBack={() => lv.setLevel(null)} onPick={(id) => pickAgent(cur, id)} />
        ) : (
          <>
            <div className="rpick__tabs">
              {/* 弹层里的页签统一用 S2 SegmentedControl（与设置 › Skills 的来源页签同款） */}
              <window.RSP.SegmentedControl aria-label="谁来做" isJustified selectedKey={curTab} onSelectionChange={(k) => { setTab(String(k)); lv.setLevel(null); }}>
                {tabs.map((t) => <window.RSP.SegmentedControlItem key={t.k} id={t.k}><window.RSP.Text>{tabLabel(t)}</window.RSP.Text></window.RSP.SegmentedControlItem>)}
              </window.RSP.SegmentedControl>
            </div>
            <MenuHead>{grp.desc}</MenuHead>
            <div className="rpick__list">
              {grp.kind === 'agent' ? (
                agents.length
                  ? <AgentProviderLevel list={app.harnessList} sel={sel} noHead onEnter={lv.setLevel} onSettings={goAgentSettings} />
                  : <Menu>
                      <MenuItem icon="agent" label="还没有可用的编码 Agent" sub="连接 Claude Code 或 Codex CLI · 设置 › Agent" onClick={goAgentSettings} />
                    </Menu>
              ) : (
                <Menu>
                  {grp.items.length ? grp.items.map((it) => (
                    <MenuItem key={it.k} label={it.label} sub={it.sub} on={!!value && it.k === value.k}
                      onClick={() => { onChange(it); close(); }} />
                  )) : <MenuItem icon="sparkle" label="还没有可用的模型" sub="连接一个 provider 的 key · 设置 › 模型 › 云端模型" onClick={goCloudSettings} />}
                </Menu>
              )}
            </div>
            <MenuRule />
            <Menu>
              {grp.kind === 'agent'
                ? <MenuItem icon="settings" label="设置 › Agent…" sub="安装、启用、登录编码 Agent" onClick={goAgentSettings} />
                : grp.kind === 'api'
                  ? <MenuItem icon="settings" label="设置 › 模型 › 云端模型…" sub="连接 API key、添加 provider" onClick={goCloudSettings} />
                  : <MenuItem icon="settings" label="设置 › 模型 › 本地模型…" sub="下载与管理本机模型" onClick={() => { close(); app.go({r: 'settings', sec: 'local'}); }} />}
            </Menu>
          </>
        )}
      </Picker>
    );
  }

  function ScopePick({options, value, onChange, size}) {
    const [pop, setPop] = useState(false);
    const cur = options.find((o) => o.k === value) || options[0];
    return (
      <Picker size={size || 's'} value={cur.label} open={pop} popWidth={240}
        onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
        <Menu>
          {options.map((o) => (
            <MenuItem key={o.k} label={o.label} sub={o.k === 'all' ? null : `约 ${o.count} ${cur.unit || ''}`.trim()} on={o.k === cur.k}
              onClick={() => { onChange(o); setPop(false); }} />
          ))}
        </Menu>
      </Picker>
    );
  }

  /** 把「模型 · 范围」两个选择折成 stepSummary 需要的参数。 */
  function summaryOf(plan, model, scope, more) {
    return AG.stepSummary(plan, Object.assign({
      model: model ? model.name : null,
      scope: scope && scope.k !== 'all' ? scope.label.replace(/^第 \d+ 章 · /, '') : null,
      count: scope ? scope.count : null,
    }, more || {}));
  }

  /** 这一页的「谁来做」候选与当前选中项：LLM 工具第二组是云端模型，本机工具第二组是「直接跑」。
      返回 {groups, cur, pick}；pick 同时写回全局记忆。 */
  function useRunner(step, tool) {
    const app = useApp();
    const local = step && !step.llm ? {label: step.engine || '本机模型', sub: '不出本机'} : null;
    const groups = AG.runnerOptions({harnesses: app.harnessList, models: D.transModels, local});
    /* 第 196 轮：带 `tool` 的页有自己的记忆与偏好（STEP.prefer），没带的仍是全局那份。 */
    const raw = tool
      ? AG.preferredRunner(groups, {own: app.runnerBy[tool], prefer: step && step.prefer, global: app.runner})
      : AG.resolveRunner(app.runner, groups);
    /* 2026-09-21：落在编码 Agent 上时，家 · 模型听新会话默认档那一份（`prefs.harness` +
       `prefs.agentModels`，也就是输入框底栏那枚 chip 上写着的）——这一行记的只是「交给 Agent
       还是直接调模型」，具体哪家 · 哪个模型两处共用一份。 */
    const agent = {harness: app.harness ? app.harness.id : null,
      model: app.harness ? window.BC_AGENT_SETUP.defaultModel(app.harness, app.prefs.agentModels) : null};
    const cur = AG.syncAgent(raw, groups, agent);
    const apiModel = cur && cur.kind === 'api' ? D.transModels.find((m) => m.id === cur.model) : null;
    return {groups, cur, apiModel, agent: cur && cur.kind === 'agent',
      pick: (it) => {
        // 反方向：在这只下拉里选定编码 Agent，chip 跟着挪过去。
        if (it.kind === 'agent') app.setAgentDefault(it.harness, it.model);
        return tool ? app.setRunnerFor(tool, it.k) : app.setRunner(it.k);
      }};
  }

  /** 工具设置态。plan 只需要 `step`（见 model-agent.js PLANS）。
      工具页传 `runner`（useRunner 的返回）：第一行是「用」；放行卡不传，第一行是「模型」，
      model / scope 由宿主持有，宿主再把它们带进「开始」或「允许」。
      `pre` 是折进摘要句的前置步骤（「先润色 42 段，再…」），由宿主的勾选项决定。 */
  function ToolSetup({plan, runner, model, onModel, scope, onScope, chapters, children, compact, hint, pre}) {
    const app = useApp();
    const step = plan && plan.step;
    if (!step) return null;
    // 宿主带来的范围（Transcript 按章 / 按段下的单）不在标准选项里时，前置成第一项——
    // 回退到「整篇」会把用户刚下的单悄悄改掉。
    const base = AG.scopeOptions(step.count, chapters || D.chapters);
    const opts = (scope && !base.some((o) => o.k === scope.k) ? [scope, ...base] : base).map((o) => ({...o, unit: step.unit}));
    const sc = opts.find((o) => o.k === (scope ? scope.k : 'all')) || opts[0];
    const rn = runner && runner.cur;
    const mdl = runner
      ? runner.apiModel
      : (step.llm ? (model || D.transModels.find((m) => m.dflt) || D.transModels[0]) : null);
    const sum = summaryOf(plan, mdl, sc, {agent: rn && rn.kind === 'agent' ? rn.label : null, pre});
    // 没就绪的那一项选中后，行尾给去处：Agent 去 Settings › Agent，模型去连 key
    const fix = rn && !rn.ready
      ? (rn.kind === 'agent'
        ? {label: '去安装或启用', route: {r: 'settings', sec: 'agent'}}
        : {label: '去连接 key', route: {r: 'settings', sec: 'cloud'}})
      : (!runner && mdl && mdl.note === '未连接 key' ? {label: '去连接 key', route: {r: 'settings', sec: 'cloud'}} : null);
    return (
      <div className={cx('tsetup', compact && 'tsetup--compact')}>
        <div className="tsetup__sum">
          <Ic n={rn && rn.kind === 'agent' ? 'agent' : 'sparkle'} className="ic--16" />
          <span className="grow">{sum}</span>
        </div>
        <div className="tsetup__rows">
          <div className="tsetup__row">
            <span className="tsetup__lb">{runner ? '用' : (step.llm ? '模型' : '引擎')}</span>
            {runner
              ? <RunnerPick groups={runner.groups} value={rn} onChange={runner.pick} />
              : step.llm
                ? <ModelPick value={mdl.id} onChange={(m) => onModel && onModel(m)} />
                : <span className="t-body-sm">{step.engine || '本机模型'}<span className="t-detail-xs"> · 不出本机</span></span>}
            {fix ? <BCAction className="tsetup__lnk" onClick={() => app.go(fix.route)}>{fix.label}</BCAction> : null}
          </div>
          <div className="tsetup__row">
            <span className="tsetup__lb">范围</span>
            <ScopePick options={opts} value={sc.k} onChange={(o) => onScope && onScope(o)} />
          </div>
          {children}
        </div>
        {hint ? <div className="tsetup__hint">{hint}</div> : null}
      </div>
    );
  }

  /** 设置态里的一行勾选项（第 111 轮）：前置条件不再是闸门，而是一件可以顺手一起做的事。 */
  function ToolOption({on, onChange, label, sub}) {
    return (
      <div className="tsetup__row tsetup__row--opt">
        <Checkbox on={on} onChange={onChange} label={label} />
        {sub ? <span className="t-detail-xs tsetup__optsub">{sub}</span> : null}
      </div>
    );
  }

  /* 收据之下的二次处理入口：直接调模型跑完，模型没把握的那几句交给 Agent 逐句斟酌。
     第 111 轮起它只出现在收据下面——设置态里「谁来做」已经回答过一次，页脚不再有第二个入口。 */
  function AgentHandoff({onClick, label, lead}) {
    return (
      <div className="hand">
        <span className="t-detail-xs">{lead || '要逐句斟酌？'}</span>
        <BCAction className="hand__lnk" onClick={onClick}>
          <Ic n="agent" className="ic--14" />{label || '交给 Agent'}
        </BCAction>
      </div>
    );
  }

  Object.assign(window, {ToolSetup, ToolOption, AgentHandoff, ToolModelPick: ModelPick, toolSummary: summaryOf, useToolRunner: useRunner, ToolRunnerPick: RunnerPick});
})();
