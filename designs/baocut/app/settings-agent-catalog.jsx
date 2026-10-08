/* 设置 › Agent「添加更多 Agent」（product-design §7.6）：内置九家之外，任何说 ACP（Agent Client Protocol）的命令行 Agent
   都能由用户添加。一块可搜索的目录（data.js 的 agent.catalog）每行一颗「添加」，另有「自定义命令…」对话框。
   添加之后它是一张普通的 provider 卡（settings-agent-provider.jsx），没检测到也留在主列表里、带「移除」；
   检测、登录、模型表与内置的一样，检测到才进会话选择器与工具页。
   单独成段、不并进「更多」：「更多」四家是 BaoCut 自带启动方式与安装说明的；目录里的没有逐家验证过，承诺不同。
   搜索、解析、校验与添加 / 移除的规则在 model-agent-catalog.js。 */
(function () {
  const {useState, useMemo} = React;
  const R = window.RSP;
  const C = window.BC_AGENT_CATALOG;

  const EMPTY = {id: '', name: '', command: '', env: ''};

  /** 自定义命令：id、名字、整行命令、可选的环境变量。第一次点「添加」之后错误就地显示，改到对为止。 */
  function AgentCustomDialog({takenIds, names, onClose, onAdd}) {
    const [form, setForm] = useState(EMPTY);
    const [tried, setTried] = useState(false);
    const err = tried ? C.validateCustom(form, takenIds, names) : {};
    const set = (k) => (v) => setForm((f) => ({...f, [k]: v}));
    const parts = C.splitCommand(form.command);
    const add = () => {
      setTried(true);
      if (C.hasErrors(C.validateCustom(form, takenIds, names))) return;
      onAdd(C.fromCustom(form));
    };
    return <Dialog open title="用自定义命令添加 Agent" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={add}>添加</Btn></>}>
      <form className="agcat-form" onSubmit={(e) => { e.preventDefault(); add(); }} noValidate>
        <p className="agcat-form__lede">填它在终端里以 ACP 方式启动的那条命令。BaoCut 直接启动这个程序，不经过终端。</p>
        <R.TextField label="名字" placeholder="例如 我的 Agent" value={form.name} autoFocus onChange={set('name')}
          isInvalid={!!err.name} errorMessage={err.name} UNSAFE_className="agcat-form__field" />
        <R.TextField label="id" placeholder="my-agent" value={form.id} onChange={set('id')}
          description="设置与诊断里用它区分这一家：小写字母开头，只用小写字母、数字和连字符。"
          isInvalid={!!err.id} errorMessage={err.id} UNSAFE_className="agcat-form__field" />
        <R.TextField label="命令" placeholder="my-agent --acp" value={form.command} onChange={set('command')}
          description={parts.length > 1 && !err.command ? `会这样启动：程序 ${parts[0]}，参数 ${parts.slice(1).join(' · ')}` : '按空格拆成程序和参数；参数里有空格时用引号括起来。'}
          isInvalid={!!err.command} errorMessage={err.command} UNSAFE_className="agcat-form__field agcat-form__mono" />
        <R.TextArea label="环境变量（可选）" placeholder={'MY_AGENT_TOKEN_FILE=~/.config/my-agent/token\nMY_AGENT_LOG=0'} value={form.env} onChange={set('env')}
          description="每行一个 KEY=VALUE，只在 BaoCut 启动它时附加。"
          isInvalid={!!err.env} errorMessage={err.env} UNSAFE_className="agcat-form__field agcat-form__mono" />
      </form>
      <p className="agcat-form__note" role="note"><Ic n="info" className="ic--16" /><span>添加之后 BaoCut 会检测它能不能启动、要不要登录、有哪些模型；检测到之后它才出现在会话里。</span></p>
    </Dialog>;
  }

  function CatalogRow({e, onAdd}) {
    return <li className="agcat__row">
      <div className="grow">
        <div className="row gap8"><b>{e.name}</b>{e.added ? <Chip tone="positive">已添加</Chip> : null}</div>
        <p>{e.desc}</p>
        <code className="agcat__cmd">{C.launchLine({launch: e.command, env: e.env})}</code>
      </div>
      {e.added ? null : <Btn size="s" icon="plus" onClick={() => onAdd(e)}>添加</Btn>}
    </li>;
  }

  /** 页上的整段：标题 + 自定义命令入口 + 可搜索的目录。`onAdded(id)` 让页面展开刚加的那张卡。 */
  function AgentCatalogSection({onAdded}) {
    const app = useApp();
    const D = window.BC_DATA;
    const catalog = D.agent.catalog || [];
    const [q, setQ] = useState('');
    const [custom, setCustom] = useState(false);
    const addedIds = app.addedHarnesses.map((h) => h.id);
    const rows = useMemo(() => C.searchCatalog(catalog, q, addedIds), [catalog, q, addedIds.join(',')]);
    const takenIds = app.harnessList.map((h) => h.id).concat(catalog.map((e) => e.id));
    const names = Object.fromEntries(app.harnessList.map((h) => [h.id, h.name]).concat(catalog.map((e) => [e.id, e.name])));
    const land = (h, how) => {
      app.addHarness(h);
      onAdded(h.id);
      app.toast(`已添加 ${h.name}${how} · 检测到之后就能在会话里用`, 'positive');
    };
    return <section className="agcat-section" aria-labelledby="agcat-title">
      <div className="agset-heading">
        <div><h2 className="t-title-sm" id="agcat-title">添加更多 Agent</h2>
          <p>其他支持 ACP（Agent Client Protocol）的命令行 Agent 也能接进来。它们没有经过 BaoCut 逐一验证，能不能用以检测结果为准。</p></div>
        <Btn size="s" variant="quiet" icon="plus" onClick={() => setCustom(true)}>自定义命令…</Btn>
      </div>
      <Card layer className="agcat">
        <div className="agcat__search">
          <R.SearchField aria-label="搜索可添加的 Agent" placeholder="搜索名字、介绍或命令" value={q} onChange={setQ} UNSAFE_className="agcat__field" />
          <span className="agcat__count">{q.trim() ? `找到 ${rows.length} 个` : `目录里有 ${catalog.length} 个`}</span>
        </div>
        {rows.length ? <ul className="agcat__list" aria-label="可添加的 Agent">
          {rows.map((e) => <CatalogRow key={e.id} e={e} onAdd={(x) => land(C.fromCatalog(x), '')} />)}
        </ul> : <div className="agcat__empty">
          <p>目录里没有「{q.trim()}」。不在目录里的 Agent，可以填它的启动命令添加。</p>
          <Btn size="s" icon="plus" onClick={() => setCustom(true)}>自定义命令…</Btn>
        </div>}
      </Card>
      {custom ? <AgentCustomDialog takenIds={takenIds} names={names} onClose={() => setCustom(false)}
        onAdd={(h) => { setCustom(false); land(h, '（自定义命令）'); }} /> : null}
    </section>;
  }

  Object.assign(window, {AgentCatalogSection, AgentCustomDialog});
})();
