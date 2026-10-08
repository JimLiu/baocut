/* Agent 会话线程的工具步骤行、工作记录折叠与回合页脚（只在 App 入口加载）。

   - 步骤行：固定的类别名（运行命令 / 读取文件 / 修改文件 / 搜索 / 其他工具）+ 次级摘要（命令、相对路径、查询词）；
     BaoCut 自己的工具按工具与参数另起类别名与图标（「转录 · moss-transcribe · 3 分 26 秒」，model-agent-tools.js），摘要用正文字体。
     运行中标签上一道扫光代替转圈，类别图标换成像素加载图形（PixelLoader，按类别轮换几个图）；折叠行右侧是非零退出码与耗时；失败换警示色图标，展开后多一段「错误」；
     合成语音 / 生成图片失败且有去处时，「错误」下面多一个去处按钮（去登录 / 去设置启用 / 重试）。
     运行中还没有输出时展开区是 3 行骨架，完成后才写「没有输出」；输出是 unified diff 时按行上色。
   - 工作记录：组头一句话（BC_AGENT.workSummary），折叠时正在跑的那一条露在下面；跑着时标题前是正在跑的那一步类别的第一个像素图，静止不动。
   - 回合页脚：运行中「正在工作 · 0:42」每秒跳（只有这个小组件自己计时，线程不跟着每秒重渲），前面一个通用序列的加载图形（与正文左边对齐，不进头像那一列），等你允许时不放；
     完成后「已工作 1:03」，hover 换成结束时刻；右侧复制这一轮的回复正文（Markdown 源码，不含工具与思考）。
   - 加载图形（product-design §3.2.2 的「进行状态」）：@react-spectrum/ai 的 PixelLoader。哪个类别用哪几个图只写在
     model-agent-loader.js（BC_AGENT_LOADER），这里按键把名字换成像素格并缓存——PixelLoader 拿到新的数组引用会从头播。
     一个会话里最多两处在动：正在跑的那一步与回合页脚；工作组标题（头像那一列）的图静止，会话输入框不放动画。 */
(function () {
  const {useState, useEffect} = React;
  const AG = window.BC_AGENT;
  const TURN = window.BC_AGENT_TURN;
  const A = window.RSP.AI;
  const {AgentCopyButton: CopyButton} = window;

  const KIND_ICON = {command: 'tools', read: 'folder', edit: 'edit', search: 'search', other: 'more'};

  /* 加载图形：'thinking' 是通用序列，其余是步骤类别。按键缓存，数组引用稳定；一个图都取不到时返回 undefined（PixelLoader 用默认图形）。 */
  const LOADER_CACHE = new Map();
  function agentLoader(key) {
    if (!LOADER_CACHE.has(key)) {
      const L = window.BC_AGENT_LOADER;
      const names = !L ? null : key === 'thinking' ? L.THINKING : L.forKind(key);
      LOADER_CACHE.set(key, (L && L.resolve(names, A.loader)) || undefined);
    }
    return LOADER_CACHE.get(key);
  }

  /* 静止用的单个图：序列里的第一个（单个图不起计时器，也不轮换）。 */
  const ICON_CACHE = new Map();
  function agentIcon(key) {
    if (!ICON_CACHE.has(key)) {
      const seq = agentLoader(key);
      ICON_CACHE.set(key, seq ? seq[0] : undefined);
    }
    return ICON_CACHE.get(key);
  }

  function DiffView({text}) {
    return <pre tabIndex={0} className="astep__diff">{TURN.diffLines(text).map((l, i) =>
      <span key={i} className={`astep__dl astep__dl--${l.type}`}>{l.text || ' '}{'\n'}</span>)}</pre>;
  }

  function Skeleton() {
    return <div className="astep__skel" aria-label="等待输出"><span /><span /><span /></div>;
  }

  /** 一次工具调用。跑着的写入任务的进度读任务记录（同源，不另存）。 */
  function ToolStep({m}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const step = TURN.toolStep(m);
    const status = TURN.toolStatus(m.status);
    const task = m.taskId ? app.tasks.find((t) => t.id === m.taskId) : null;
    const pct = status === 'run' && task && task.status === 'running' ? task.pct : null;
    const meta = TURN.stepMeta(m);
    if (pct != null) meta.unshift(`${pct}%`);
    const diff = m.out && (step.kind === 'edit' || TURN.looksLikeDiff(m.out));
    const input = m.cmd || (m.tool && window.BC_AGENT_TOOLS ? window.BC_AGENT_TOOLS.callText(m.tool, m.args) : null);
    /* 合成语音 / 生成图片失败不另出卡（视频卡与下载卡只收视频上的活）：去处按钮留在展开的步骤行里 */
    const CARDS = window.BC_AGENT_CARDS;
    const fix = status === 'failed' && task && CARDS && CARDS.CANDIDATE_KINDS[task.kind] && task.status === 'error' ? CARDS.remedy(task) : null;
    return <li className={cx('astep', `is-${status}`)}>
      <BCAction className="astep__row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {/* 14px 的像素图放进 16px 的图标画布（S2 图标的紧凑档），换图标时这一行不动 */}
        {status === 'run' ? <span className="astep__ic astep__loader"><A.PixelLoader icon={agentLoader(step.kind)} size={14} /></span>
          : <Ic n={status === 'failed' ? 'alert' : step.icon || KIND_ICON[step.kind]} className="ic--14 astep__ic" />}
        <span className={cx('astep__label', status === 'run' && 'is-shimmer')}>{step.label}</span>
        <span className={cx('astep__sum', step.icon && 'astep__sum--plain')}>{step.summary}</span>
        {meta.map((x) => <span key={x} className="astep__meta">{x}</span>)}
        <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14 astep__chev" />
      </BCAction>
      {open ? <div className="astep__detail">
        {pct != null ? <Progress value={pct} /> : null}
        {input ? <section className="astep__sec"><header>输入<CopyButton text={input} /></header><pre tabIndex={0}>{input}</pre></section> : null}
        {status === 'failed' ? <section className="astep__sec astep__sec--err"><header>错误</header>
          <pre tabIndex={0}>{m.error || (m.exitCode != null ? `命令以退出码 ${m.exitCode} 结束` : m.took || '这一步没有完成')}</pre></section> : null}
        {fix ? <div className="astep__fix"><Btn variant="secondary" size="s"
          onClick={() => (fix.k === 'retry' ? app.retryAgentTask(task.id) : app.go(fix.route))}>{fix.label}</Btn></div> : null}
        {m.out ? <section className="astep__sec"><header>输出<CopyButton text={m.out} /></header>
          {diff ? <DiffView text={m.out} /> : <pre tabIndex={0}>{m.out}</pre>}</section>
          : status === 'run' ? <Skeleton />
          : status === 'done' ? <p className="astep__none">没有输出</p> : null}
      </div> : null}
    </li>;
  }

  function ToolSteps({items}) {
    return <ol className="asteps">{items.map((a) => <ToolStep key={a.id} m={a} />)}</ol>;
  }

  function WorkMsg({m, live, stopped, className}) {
    const [open, setOpen] = useState(false);
    const failed = m.items.filter((a) => TURN.toolStatus(a.status) === 'failed').length;
    const current = live ? [...m.items].reverse().find((a) => TURN.toolStatus(a.status) === 'run') : null;
    const summary = [current ? `正在处理 · ${AG.workSummary(m.items)}` : AG.workSummary(m.items), failed ? `${failed} 项失败` : null].filter(Boolean).join(' · ');
    return <section className={cx('awork', className)}>
      <A.ResponseStatus status={stopped ? 'failed' : current ? 'pending' : 'success'} isExpanded={open} onExpandedChange={setOpen}>
        {/* 标题前的图形不动（agent-messages.css 停掉它的动画），只取这一步类别的第一个图：动画只留在正在跑的那一行 */}
        <A.ResponseStatusTitle pixelLoader={agentIcon(current ? TURN.toolStep(current).kind : 'thinking')}>{summary}</A.ResponseStatusTitle>
        <A.ResponseStatusPanel><ToolSteps items={m.items} /></A.ResponseStatusPanel>
      </A.ResponseStatus>
      {!open && current ? <ToolSteps items={[current]} /> : null}
    </section>;
  }

  /* ---------- 回合页脚 ---------- */
  function LiveClock({startedAt, waiting}) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    /* 加载图形是扫光文字的兄弟节点（扫光把文字色设成透明，放进去 currentColor 就没了）；等你允许时不放 */
    return <>
      {waiting ? null : <A.PixelLoader icon={agentLoader('thinking')} size={14} className="aturn__loader" />}
      <span className={cx('aturn__live', !waiting && 'is-shimmer')}>{TURN.footerLabel({live: true, waiting, startedAt, now})}</span>
    </>;
  }

  /* 完成后的时长；hover 换成结束时刻。隐藏的 sizer 占住两种文案里较长的宽度，换字时不抖。 */
  function DoneClock({startedAt, endedAt}) {
    const spent = TURN.footerLabel({startedAt, endedAt});
    if (!spent) return null;
    const at = TURN.clockLabel(endedAt);
    return <span className="aturn__time">
      <span className="aturn__sizer" aria-hidden="true">{spent.length >= at.length ? spent : at}</span>
      <span className="aturn__spent">{spent}</span>
      <span className="aturn__at" aria-hidden="true">{at}</span>
    </span>;
  }

  function TurnFooter({turn, live, waiting, className}) {
    const u = turn.user || {};
    return <div className={cx('aturn', className)}>
      {live ? <LiveClock startedAt={u.startedAt} waiting={waiting} /> : <DoneClock startedAt={u.startedAt} endedAt={u.endedAt} />}
      <span className="grow" />
      {!live && turn.text ? <CopyButton text={turn.text} label="复制" title="复制这一轮的回复" /> : null}
    </div>;
  }

  Object.assign(window, {AgentWorkMsg: WorkMsg, AgentToolSteps: ToolSteps, AgentTurnFooter: TurnFooter});
})();
