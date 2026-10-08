/* Settings › Agent（第 126 / 139 轮；2026-09-18 重设计连接页）。
   连接页自上而下：一句话说清 Agent 是什么 + 三条事实（用你装好的 CLI / 用你自己的订阅 / 写入前先问）→ 状态卡 →
   这台电脑上的 Agent（每家一张 settings-agent-provider.jsx 的卡）→ 添加更多 Agent（settings-agent-catalog.jsx）→ 常见问题 → 原型演示场景。
   provider 表（product-design §7.6）：内置九家里常驻的五家与检测到的直接列出，「更多」四家没检测到时收进一个折叠段；
   用户从目录或自定义命令添加的接在后面，没检测到也不折叠，带「移除」。
   模型列表跟着 Agent 走：没有全局的「刷新全部」，每家在自己的详情里刷新；重新检测、升级、登录之后那一家自动刷新一次。
   探测结果仍是演示数据；状态判断在 model-agent-setup.js，启用 / 默认 / 默认模型 / 允许规则走共享 store。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const D = window.BC_DATA;
  const Row = window.ShellRow;
  const S = window.BC_AGENT_SETUP;
  const FACTS = [
    {k: 'cli', icon: 'compute', title: '用你已经装好的', body: 'BaoCut 调用这台电脑上的命令行 Agent，不另装一套。'},
    {k: 'plan', icon: 'ok', title: '用你自己的订阅', body: '不用为 BaoCut 另外付费，也不用填 API key。'},
    {k: 'ask', icon: 'lock', title: '改动之前先问你', body: '写入视频前会停下来等你允许，随时可以撤销。'},
  ];
  /* 2026-10-05 Agent 在设置左栏自成一组：「Agent 提供方」（本页：连接 + 页底的高级与排障）与「Skills」（settings-agent-skills.jsx）各一项，
     不再有页签；访问权限搬到「隐私与权限」（AgentPermissionsSection，page-settings.jsx 里用）。 */
  const policyCopy = {
    read: {label: '读取视频内容', desc: '允许助手查看文稿与视频设置，不必每次确认。'},
    bcutro: {label: '查询视频与处理状态', desc: '允许查询信息和进度，这些命令不会修改视频。'},
    loop: {label: '回应进行中的 AI 任务', desc: '允许接收任务并提交回答，减少多步处理时的打断。'},
  };

  /* Agent 的访问权限：访问模式说明、减少重复询问的规则、「总是允许」的命令。显示在 设置 › 隐私与权限。 */
  function AgentPermissionsSection() {
    const app = useApp();
    return <div className="agent-settings" data-screen-label="Agent 权限">
          <h2 className="t-title-sm">由你决定，什么时候先问</h2>
          <p className="agset-description">在每条会话的输入框下方选择访问模式。首次使用默认为「监督」，之后的新会话沿用最近选择。</p>
          <Card layer className="agset-permissions">
            {D.agent.modes.map((m) => <div className="agset-mode" key={m.k}><Ic n={m.icon} className="ic--16" /><div><b>{m.label}</b><p>{m.desc}</p></div>{m.k === 'ask' ? <Chip>首次默认</Chip> : null}</div>)}
          </Card>
          <div className="agset-heading"><div><h2 className="t-title-sm">减少重复询问</h2><p>以下规则会自动允许对应操作；访问模式也会影响是否询问。</p></div></div>
          <Card layer className="agset-rows">
            {D.agent.policy.map((p) => <Row key={p.k} label={policyCopy[p.k].label} desc={policyCopy[p.k].desc}>
              <Switch on={app.policy[p.k]} ariaLabel={policyCopy[p.k].label} onChange={next => app.setPolicy(p.k, next)} />
            </Row>)}
          </Card>
          <BCDisclosure className="agset-disclosure" title={<> 总是允许的命令 · {app.autoAllow.length} 条 </>}>
            <p>{app.autoAllow.length ? '这些规则来自会话里的「总是允许」。移除后，该规则不再自动批准操作；访问模式与其他规则仍然生效。' : '还没有保存的规则。在会话的允许卡上选择「总是允许」，会显示在这里。'}</p>
            <div className="agset-rulelist">{app.autoAllow.map((r) => <Chip key={r} icon="close" aria-label={'移除规则 ' + r} onClick={() => { app.dropAutoAllow(r); app.toast('已移除规则 ' + r); }}>{r}</Chip>)}</div>
          </BCDisclosure>
    </div>;
  }

  function AgentSection() {
    const app = useApp();
    /* 深链 {r:'settings', sec:'agent', provider}（2026-09-29）：会话里「升级 X」点过来，直接展开那一家，升级命令就在详情里 */
    const linked = (app.route && app.route.provider) || null;
    const [expanded, setExpanded] = useState(linked);
    useEffect(() => { if (linked) setExpanded(linked); }, [linked]);
    const [scanning, setScanning] = useState(false);
    const [checked, setChecked] = useState(D.agent.checked);
    const [catalogs, setCatalogs] = useState({});
    const [scenario, setScenario] = useState('default');
    const [failNext, setFailNext] = useState(false);
    const [failRun, setFailRun] = useState(false);
    const [showMore, setShowMore] = useState(false);
    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);
    const later = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    const copy = async (value, label) => {
      try { await navigator.clipboard.writeText(value); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
    const current = app.harness;
    const hs = app.harnessList;
    const ov = S.overview(hs, current && current.id);
    const gr = S.groups(hs);
    /* 模型列表是每家 Agent 自己的事：点名一家就只刷新那一家（升级 / 登录刚落定时它在这一拍还不是「可用」，所以点名时不再看状态）；
       不点名 = 重新检测顺带把可用的几家各刷新一次，没有可用的就什么也不做。 */
    const refreshModels = (provider) => {
      const targets = provider ? [provider] : hs.filter((h) => S.health(h) === 'ready');
      if (!targets.length) return;
      setCatalogs((old) => ({...old, ...Object.fromEntries(targets.map((h) => [h.id, {refreshing: true}]))}));
      later(900, () => setCatalogs((old) => ({...old, ...Object.fromEntries(targets.map((h) => [h.id,
        failNext ? {error: '（它没有在 10 秒内回应）'} : {updated: true}]))})));
    };
    const rescan = () => {
      setScanning(true);
      later(900, () => {
        setScanning(false); setChecked('刚检查过');
        refreshModels(null);
        const n = hs.filter((x) => x.found).length;
        app.toast(n ? `检测完成 · 这台电脑上有 ${n} 个 Agent` : '检测完成 · 没有找到已安装的 Agent');
      });
    };
    const start = () => app.newProject({entry: 'agent'});   // 2026-09-17：落到新建项目页顶的 Agent 框，在那里选模型、发第一句话
    const heroAct = () => {
      if (ov.action === 'start') return start();
      if (ov.action === 'enable') return app.enableAgent(ov.harness.id);
      setExpanded(ov.harness.id);   // 其余都是某一家的问题：展开它，修法就在问题条上（出问题的一定是检测到的，在 main 里）
    };
    const applyScenario = (k) => {
      setScenario(k); setExpanded(null); setCatalogs({});
      app.patchHarness(null, S.scenarioPatch(k));
      app.setHarnessOn('claude', true);
      app.setHarnessOn('codex', k === 'both' || k === 'many' || k === 'modelGate');
    };
    /* 移除只对用户添加的生效；撤销把它连同移除前的探测结果一起放回来。 */
    const remove = (h) => {
      const before = {found: h.found, loggedIn: h.loggedIn, models: h.models};
      const was = app.addedHarnesses.find((x) => x.id === h.id);
      app.removeHarness(h.id);
      if (expanded === h.id) setExpanded(null);
      app.toast(`已移除 ${h.name}`, undefined, {label: '撤销', undo: true, run: () => {
        app.addHarness(was); app.patchHarness(h.id, before); app.toast(`已恢复 ${h.name}`);
      }});
    };
    const card = (h) => <window.AgentProviderCard key={h.id + scenario} h={h} isDefault={!!current && current.id === h.id}
      open={expanded === h.id} onToggle={() => setExpanded(expanded === h.id ? null : h.id)}
      catalog={catalogs[h.id]} onRefreshModels={() => refreshModels(h)} failRun={failRun}
      onRemove={h.added ? () => remove(h) : null} />;

    return <div className="agent-settings" data-screen-label="Agent 设置">
      <h1 className="t-heading-sm">Agent 提供方</h1>
      <p className="agset-lede">Agent 是装在你电脑上的 AI 编码助手，比如 Claude Code、Codex。BaoCut 直接调用它，让你用一句话完成转录、翻译和剪辑。</p>
      <ul className="agset-facts" aria-label="Agent 怎么工作">
        {FACTS.map((f) => <li key={f.k}><Ic n={f.icon} className="ic--16" /><div><b>{f.title}</b><p>{f.body}</p></div></li>)}
      </ul>
        <>
          <Card layer className={cx('agset-status', 'is-' + ov.state)}>
            <span className="agset-status__icon"><Ic n={ov.state === 'ready' ? 'ok' : ov.state === 'attention' ? 'alert' : 'skill'} /></span>
            <div className="grow">
              <h2 className="t-title-sm">{ov.title}</h2>
              <p>{ov.state === 'ready'
                ? `新会话默认用 ${ov.harness.name} · ${S.modelLabel(ov.harness, app.prefs.agentModels)}。用的是这台电脑上已经装好的 ${ov.harness.name} 和你自己的 ${String(ov.harness.account).split(' · ')[0]}，BaoCut 不另外收费。`
                : ov.body}</p>
            </div>
            {ov.cta ? <Btn variant="accent" onClick={heroAct}>{ov.state === 'attention' ? '查看问题' : ov.cta}</Btn> : null}
          </Card>

          <div className="agset-heading">
            <div><h2 className="t-title-sm">这台电脑上的 Agent</h2><p>BaoCut 会自动找出已经装好的。有一个可用就够，不需要全部安装；拿不准就选 Claude Code 或 Codex CLI。内置的只能停用，你添加的可以移除。</p></div>
            <Btn size="s" variant="quiet" icon="refresh" disabled={scanning} onClick={rescan}>{scanning ? '正在检测…' : '重新检测'}</Btn>
          </div>
          {scanning ? <Progress indeterminate thin className="agset-scan" /> : null}
          <Card layer className={cx('agset-providers', scanning && 'is-scanning')}>{gr.main.map(card)}</Card>
          {gr.more.length ? <>
            <BCAction type="button" className="agset-more" aria-expanded={showMore} aria-controls="agent-more-providers" onClick={() => setShowMore((v) => !v)}>
              <Ic n={showMore ? 'chevdown' : 'chevright'} className="ic--16" />
              <span className="grow"><b>其他支持的 Agent · {gr.more.length} 个</b><span>{S.moreSummary(gr.more)} · 这台电脑上都没有检测到</span></span>
              <span className="agset-more__act">{showMore ? '收起' : '展开'}</span>
            </BCAction>
            {showMore ? <Card layer id="agent-more-providers" className={cx('agset-providers', scanning && 'is-scanning')}>{gr.more.map(card)}</Card> : null}
          </> : null}
          <div className="agset-meta">{checked} · BaoCut 内置 {gr.total - gr.added} 个 Agent{gr.added ? `，你添加了 ${gr.added} 个` : ''}；这台电脑上检测到 {gr.found} 个</div>
          <window.AgentCatalogSection onAdded={(id) => setExpanded(id)} />

          <Card layer className="agset-advanced agset-faq">
            <BCDisclosure className="agset-disclosure" title={<> 需要为 BaoCut 另外付费或订阅吗？ </>}>
              <p>不需要。Agent 用的是你已经在用的 Claude 或 ChatGPT 订阅，费用和额度都算在那边；BaoCut 不自带模型，不代收密钥，也不做云端中转。没有这类订阅也可以不用 Agent，BaoCut 的其他功能照常可用。</p></BCDisclosure>
            <BCDisclosure className="agset-disclosure" title={<> BaoCut 会看到我的账号和密码吗？ </>}>
              <p>不会。登录在 Agent 自己的窗口里完成，BaoCut 只是启动你电脑上的那个程序，并把视频交给它处理。它要修改视频之前会先问你，规则在「权限与安全」里。</p></BCDisclosure>
            <BCDisclosure className="agset-disclosure" title={<> Agent 和「云端模型」有什么区别？ </>}>
              <p>Agent 使用你本机的编码助手与自己的订阅，能连续完成多步任务。「云端模型」用 API key 直接运行单项工具，按用量计费，两者分开设置。</p>
              <Btn size="s" variant="quiet" onClick={() => app.replace({r: 'settings', sec: 'cloud'})}>前往云端模型</Btn></BCDisclosure>
            <BCDisclosure className="agset-disclosure" title={<> 想在终端里直接用这些 Agent 操作 BaoCut？ </>}>
              <p>在 BaoCut 里开会话不需要额外准备。要在终端或其他应用里用，给它们装上 BaoCut 的 skill 即可。</p>
              <Btn size="s" variant="quiet" onClick={() => app.replace({r: 'settings', sec: 'skills', tab: 'external'})}>查看安装方法</Btn></BCDisclosure>
          </Card>

          <div className="agset-demo" aria-label="原型演示场景">
            <b>原型演示 · 切换检测结果</b>
            <div className="agset-rulelist">{S.SCENARIOS.map((sc) => <Chip key={sc.k} on={scenario === sc.k} onClick={() => applyScenario(sc.k)}>{sc.label}</Chip>)}</div>
            <Checkbox on={failNext} onChange={setFailNext} label="让下一次刷新模型失败" />
            <Checkbox on={failRun} onChange={setFailRun} label="让运行安装 / 升级命令失败" />
            <Checkbox on={!!app.prefs.demoNoTranscriber} onChange={(v) => app.setPref('demoNoTranscriber', v)}
              label="会话里没有可用的语音识别服务（说「转录」时回复带设置链接）" />
          </div>
        </>

        <>
          <h2 className="t-title-sm">高级与排障</h2>
          <p className="agset-description">连接正常时，无需调整这里的内容。</p>
          <Card layer className="agset-rows">
            <Row label="自动更新模型列表" desc="启动时和运行期间，定期为每个已启用的 Agent 更新它自己的模型列表。关闭后仍可在各 Agent 的详情里手动刷新。">
              <Switch on={app.prefs.agentModelAutoUpdate !== false} ariaLabel="自动更新模型列表"
                onChange={(v) => app.setPref('agentModelAutoUpdate', v)} />
            </Row>
          </Card>
          <Card layer className="agset-advanced">
            <BCDisclosure className="agset-disclosure" title={<> Agent 技术信息 <span>版本、路径与可用模型</span> </>}>
              {hs.map((h) => <div className="agset-tech" key={h.id}><b>{h.name} {h.found ? '· v' + h.ver : '· 未安装'}</b>
                {h.found ? <><code className="agset-path">{h.bin}</code><p>{h.models.map((m) => m.name).join(' / ')}</p></> : null}</div>)}
              <Btn size="s" icon="copy" onClick={() => copy(hs.map((h) => `${h.name}: ${S.health(h)}${h.found ? ` v${h.ver} ${h.bin}` : ''}`).join('\n'), '诊断信息')}>复制诊断信息</Btn>
            </BCDisclosure>
            <BCDisclosure className="agset-disclosure" title={<> 手动指定 Agent 的位置 <span>自动检测找不到时使用</span> </>}>
              <p>BaoCut 会查找 PATH 和常见安装位置。用版本管理器装的 Agent 有时不在其中，可以在这里直接指给 BaoCut。</p>
              <Btn size="s" onClick={() => app.toast('原型演示：正式版会打开可执行文件选择器')}>选择可执行文件…</Btn>
            </BCDisclosure>
          </Card>
        </>
      <p className="agset-prototype-note">原型演示 · 安装、升级、登录与检测使用示例状态，不会打开终端，也不会操作本机软件。</p>
    </div>;
  }
  Object.assign(window, {AgentSection, AgentPermissionsSection});
})();
