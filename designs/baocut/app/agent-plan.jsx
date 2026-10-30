/* Agent 写好方案等你批准（产品设计 §6.6「批准方案」；只在 App 入口加载）。

   Agent 在「先给方案」里写完方案，停下来等你。卡片里是方案全文（限高滚动），下面一个下拉选实施时的访问模式
   （默认「自动接受修改」，只列四档，不含「先给方案」），「按方案实施」把会话切到这一档、Agent 接着按方案改；
   「继续改方案」按未批准结束，Agent 留在规划里问你要改哪里。直接在输入框发消息也算回复（store 的 sendAgent
   把卡片记成「已用消息回复」）。决定之后卡片收成一行记录，展开是方案全文。摘要与状态词在 model-agent-plan.js。

   回合结束、会话还在「先给方案」时，页脚下面挂一行「方案没问题？[模式] 按方案实施」（AgentPlanImplementRow）：
   有的编码 Agent 不会停下来请你批准，这一行让它们也能接着实施——切档，再替你发一句「按上面的方案实施。」。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const P = window.BC_AGENT_PLAN;
  const {AgentMarkdown} = window;
  /* 和 Electron 的方案卡同一个 S2 图标 */
  const FileText = window.RSP.Icons.FileText;

  /* 实施时的访问模式：和输入框的访问模式同一套图标与名字，菜单向上弹 */
  function PlanModePicker({value, onChange}) {
    const [pop, setPop] = useState(false);
    const modes = D.agent.modes;
    const cur = modes.find((m) => m.k === value) || modes[0];
    return (
      <Picker size="s" icon={cur.icon} label="实施时的访问模式" value={cur.label}
        open={pop} popWidth={288} popDir="up" popAlign="left"
        onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
        <Menu>
          {modes.map((m) => (
            <MenuItem key={m.k} icon={m.icon} label={m.label} wrap check={m.k === cur.k} sub={m.desc}
              onClick={() => { onChange(m.k); setPop(false); }} />
          ))}
        </Menu>
      </Picker>
    );
  }

  function AgentPlanMsg({m, sid}) {
    const app = useApp();
    const [mode, setMode] = useState(P.DEFAULT_MODE);
    if (m.state !== 'pending') {
      return (
        <BCDisclosure className="awork" title={<> <FileText UNSAFE_className="ic ic--14" /> {P.stateLabel(m, D.agent.modes)} · 方案 </>}>
          <AgentMarkdown text={m.plan} />
        </BCDisclosure>
      );
    }
    return (
      <div className="aplan" role="group" aria-label="Agent 写好了方案，等你批准">
        <div className="aplan__hd"><FileText UNSAFE_className="ic ic--16" /><b>Agent 写好了方案，等你批准</b></div>
        <div className="aplan__body"><AgentMarkdown text={m.plan} /></div>
        <div className="aplan__acts">
          <PlanModePicker value={mode} onChange={setMode} />
          <Btn variant="accent" size="s" onClick={() => app.answerPlan(sid, m.id, mode)}>按方案实施</Btn>
          <Btn variant="quiet" size="s" onClick={() => app.answerPlan(sid, m.id, null)}>继续改方案</Btn>
        </div>
        <p className="aplan__hint">也可以直接在输入框里说要改什么。</p>
      </div>
    );
  }

  function AgentPlanImplementRow({sid}) {
    const app = useApp();
    const [mode, setMode] = useState(P.DEFAULT_MODE);
    return (
      <div className="aplan-row" role="group" aria-label="按方案实施">
        <span>方案没问题？</span>
        <PlanModePicker value={mode} onChange={setMode} />
        <Btn variant="accent" size="s" onClick={() => app.implementPlan(sid, mode)}>按方案实施</Btn>
      </div>
    );
  }

  Object.assign(window, {AgentPlanMsg, AgentPlanImplementRow});
})();
