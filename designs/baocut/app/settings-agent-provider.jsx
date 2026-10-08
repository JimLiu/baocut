/* Settings › Agent 的一家 provider（2026-09-18 重设计）。
   一行回答三件事：装没装、能不能用、开没开；有问题时问题条直接露在行下面，不用先点开。
   展开后是「日常会动的」四样：默认模型、版本与升级、账号、排查。未安装时展开的是安装面板。
   状态判断全在 model-agent-setup.js。安装 / 升级命令左边一枚 ▶，点了就在这里运行，命令下面出一个日志框滚动显示输出
   （2026-09-18 起取代「摆进系统终端」）；`curl … | bash` 这类官方脚本不给 ▶，只给复制（S.runnable）。登录要在 CLI 里交互，
   仍然摆进终端。原型里的输出是 S.demoRun 编的，跑完把结果写进 store 的探测补丁。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const S = window.BC_AGENT_SETUP;
  const C = window.BC_AGENT_CATALOG;

  function Diagnosis({h, onFix}) {
    const steps = S.diagnose(h);
    const v = S.verdict(steps);
    return <div className="agp-diag">
      <ol className="agp-checks">
        {steps.map((s) => <li key={s.k} className={'is-' + s.state}>
          <Ic n={s.state === 'ok' ? 'ok' : s.state === 'fail' ? 'alert' : 'clock'} className="ic--16" />
          <div className="grow"><b>{s.label}</b><p>{s.detail}</p></div>
          {s.fix ? <Btn size="s" onClick={() => onFix(s.fix.action)}>{s.fix.cta}</Btn> : null}
        </li>)}
      </ol>
      <p className={cx('agp-verdict', v.ok ? 'is-ok' : 'is-bad')} role="status">{v.text}</p>
    </div>;
  }

  /* 一条可运行的命令：[▶/■] 命令 [复制]，运行后下面是滚动日志与一行结果。运行状态由卡片持有（useCmdRun），
     问题条的「升级到 X」、排查里的对症按钮也能直接起跑。 */
  function useCmdRun(h, failNext) {
    const [run, setRun] = useState(null);   // {cmd, status: running | ok | fail | stopped, lines, code}
    const timers = useRef([]);
    useEffect(() => () => timers.current.forEach(clearTimeout), []);
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
    const start = (plan, upgrade, onDone) => {
      if (!S.runnable(plan) || (run && run.status === 'running')) return;
      clear();
      const out = S.demoRun(plan, h, upgrade, failNext);
      setRun({cmd: plan.cmd, status: 'running', lines: ['$ ' + plan.cmd], code: null});
      out.lines.forEach((line, i) => timers.current.push(setTimeout(() =>
        setRun((r) => r && {...r, lines: S.appendLog(r.lines, [line])}), 380 * (i + 1))));
      timers.current.push(setTimeout(() => {
        setRun((r) => r && {...r, status: out.code === 0 ? 'ok' : 'fail', code: out.code});
        onDone(out.code === 0);
      }, 380 * (out.lines.length + 1)));
    };
    const stop = () => { clear(); setRun((r) => r && {...r, status: 'stopped', lines: S.appendLog(r.lines, ['^C'])}); };
    return {run, running: !!run && run.status === 'running', start, stop};
  }

  function CmdRun({plan, runner, copyTip, onCopy, onRun}) {
    /* 前置条件（Homebrew / Node.js）紧跟命令，排在日志框前面。 */
    const app = useApp();
    const logRef = useRef(null);
    const run = runner.run && runner.run.cmd === plan.cmd ? runner.run : null;
    const running = !!run && run.status === 'running';
    useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [run && run.lines.length]);
    const can = S.runnable(plan);
    return <>
      <div className={cx('agset-code', can && 'has-run')}>
        {can ? <IconBtn icon={running ? 'stop' : 'play'} size="s" className="agset-code__run"
          tip={running ? '停止运行' : '运行这条命令'} disabled={runner.running && !running}
          onClick={running ? runner.stop : onRun} /> : null}
        <code>{plan.cmd}</code><IconBtn icon="copy" size="s" tip={copyTip} onClick={onCopy} />
      </div>
      {plan.needs ? <p className="agp-hint">需要这台电脑上已有 {plan.needs}。</p> : null}
      {run ? <div className={cx('agset-run', 'is-' + run.status)}>
        <pre ref={logRef} className="agset-run__log" role="log" aria-live="polite" tabIndex={0}>{run.lines.join('\n')}</pre>
        <div className="agset-run__status" role="status">
          {run.status === 'running' ? <><span className="agset-run__dot" /><span>正在运行…</span></>
            : run.status === 'ok' ? <><Ic n="ok" className="ic--16" /><span>已完成</span></>
            : run.status === 'stopped' ? <><Ic n="stop" className="ic--16" /><span>已停止。已经做了的那部分不会回退，可以再运行一次。</span></>
            : <><Ic n="alert" className="ic--16" /><span className="grow">没有成功（退出码 {run.code}）。上面的输出里写了原因；如果需要输入密码，请在终端里运行。</span>
              <Btn size="s" onClick={() => app.toast(`原型演示：正式版会打开终端并运行 ${plan.cmd}`)}>在终端里运行</Btn></>}
        </div>
      </div> : null}
    </>;
  }

  /* 用户添加的（目录或自定义命令，product-design §7.6）：BaoCut 没有它的安装命令，只知道怎么启动它。
     由 npx / uvx 现取现用的不用单独装；其余按它自己的说明装好，回来点检测。 */
  function AddedInstallPanel({h, onCopy, onDetect, busy}) {
    const app = useApp();
    return <div className="agp-install">
      <div className="agp-note"><Ic n="info" className="ic--16" /><span>{h.name} 经 ACP（Agent Client Protocol）接入。BaoCut 没有逐一验证过它：怎么安装、用哪个账号登录，以它自己的说明为准。</span></div>
      <ol className="agset-steps">
        {h.launcher ? <li><b>不用单独安装</b><p>BaoCut 启动它时由 {h.launcher} 自动下载 <code>{h.spec}</code>，需要这台电脑上已有 {h.launcherNeeds}。</p></li>
          : <li><b>按官方说明安装到这台电脑</b><p>装好后终端里应当能运行 <code>{h.cmd}</code>。</p>
            {h.docs ? <Btn size="s" icon="link" onClick={() => app.toast('原型演示：在浏览器中打开 ' + h.docs)}>打开官方说明</Btn> : null}</li>}
        <li><b>BaoCut 用这条命令启动它</b>
          <div className="agset-code"><code>{C.launchLine(h)}</code><IconBtn icon="copy" size="s" tip="复制启动命令" onClick={onCopy} /></div></li>
        <li><b>需要登录的话，在它自己那里登录</b><p>按它的说明在终端里完成。登录在它自己的窗口里进行，BaoCut 不经手你的账号和密码。</p></li>
        <li><b>检测</b><p>BaoCut 会启动它一次，确认能连上、是否需要登录，并取到它的模型列表。</p>
          <Btn size="s" disabled={busy} onClick={onDetect}>{busy ? '正在检测…' : '检测'}</Btn></li>
      </ol>
    </div>;
  }

  function InstallPanel({h, plan, method, setMethod, onInstall, onCopy, onRecheck, busy, runner}) {
    const app = useApp();
    return <div className="agp-install">
      <div className="agp-note"><Ic n="info" className="ic--16" /><span>{h.name} 是{h.by && h.by !== h.name ? ' ' + h.by + ' 的' : ''}命令行 AI 助手，装在你自己的电脑上，用你已有的 <b>{h.plan}</b> 登录。BaoCut 只是调用它，不另外收费，也不用在 BaoCut 里填 API key。</span></div>
      {h.caveat ? <div className="agp-note is-notice"><Ic n="alert" className="ic--16" /><span>{h.caveat}</span></div> : null}
      <ol className="agset-steps">
        {!plan ? <li><b>按官方说明安装到这台电脑</b><p>BaoCut 还没有一条可以稳妥替你运行的 {h.name} 安装命令。按{h.by ? ' ' + h.by + ' ' : '它'}官方的说明装好，装完终端里应当能运行 <code>{h.cmd}</code>。</p>
          {h.docs ? <Btn size="s" icon="link" onClick={() => app.toast('原型演示：在浏览器中打开 ' + h.docs)}>打开官方说明</Btn> : null}</li>
        : <li><b>安装到这台电脑</b><p>{S.runnable(plan) ? '点命令左边的 ▶ 直接运行，输出会显示在下面；也可以复制后在终端里自己运行。' : '复制下面这条命令，在终端里运行。'}</p>
          {S.installMethods(h, false).length > 1 ? <Segmented size="s" className="agp-methods" value={method} onChange={(k) => { if (!runner.running) setMethod(k); }}
            items={S.installMethods(h, false).map((m) => ({k: m.k, label: m.label}))} /> : null}
          <CmdRun plan={plan} runner={runner} copyTip="复制安装命令" onCopy={onCopy} onRun={onInstall} />
          {S.runnable(plan) ? null
            : <p className="agp-hint">这条命令会从官方网站下载并运行脚本。BaoCut 不替你运行来自网络的脚本：请复制后在终端里自己运行。</p>}
        </li>}
        <li><b>登录你的账号</b><p>{h.loginHint || <>装好后在终端里运行 <code>{h.cmd}</code>，按它的提示在浏览器里登录。</>}登录在它自己的窗口里完成，BaoCut 不经手你的账号和密码。</p></li>
        <li><b>回到这里</b><p>检测到安装并登录后，它会自动启用。</p>
          <Btn size="s" disabled={busy} onClick={onRecheck}>{busy ? '正在检测…' : '我已装好，重新检测'}</Btn></li>
      </ol>
      <BCDisclosure className="agset-disclosure" title={<> 已经装好，但检测不到？ </>}>
        <p>BaoCut 会查找 PATH 和常见安装位置（Homebrew、npm 全局目录、~/.local/bin）。用版本管理器（nvm、asdf、mise）装的有时不在这些位置里，可以手动指给 BaoCut。</p>
        <Btn size="s" onClick={() => app.toast('原型演示：正式版会打开可执行文件选择器')}>手动指定位置…</Btn></BCDisclosure>
    </div>;
  }

  function CodexImageRow({h}) {
    const app = useApp();
    const IM = window.BC_CLOUD_IMAGE;
    const can = IM.codexCanEnable(h);
    const st = IM.codexReady(h, app.codexImageGen);
    const on = can && app.codexImageGen;
    return <div className={cx('agp-imagegen', on && 'is-on')}>
      <Ic n="image" className="ic--16 agp-imagegen__ic" />
      <div className="grow">
        <div className="row gap8"><b>用 Codex 画图</b>{on ? <Chip tone="positive">已打开</Chip> : null}</div>
        <p>{can ? '不用密钥，用你的 Codex 订阅；一次一张、忽略尺寸与质量；比 API 慢 5–10 倍。打开后图片 Tab、工具页与 bcut image 里多一只「Codex 画图」；不会被替你挑中，想默认用它就去设置 › 模型 › 图像生成 › 云端模型把它设成默认。'
          : `${st.why} · 画图至少要 Codex ${IM.CODEX_MIN_VER} 并登录。`}</p>
      </div>
      <Switch on={on} disabled={!can} ariaLabel="用 Codex 画图"
        onChange={(v) => { app.setCodexImageGen(v); app.toast(v ? '已打开 Codex 画图 · 模型菜单里多了一只「Codex 画图」' : '已关闭 Codex 画图'); }} />
    </div>;
  }

  function AgentProviderCard({h, isDefault, open, onToggle, catalog, onRefreshModels, failRun, onRemove}) {
    const app = useApp();
    const state = S.health(h);
    const badge = S.badge(h);
    const problem = S.problem(h);
    const update = S.hasUpdate(h);
    /* 2026-09-29：CLI 能用，但它配置里的默认模型这一版不认得（defaultModelGate）。不算问题条（不挡、不跳过这一家），
       也不是普通的「有新版本」：只有选了「Agent 默认模型」的会话会撞上，所以单独一条 notice，展开详情时也留着。 */
    const gate = state === 'ready' ? S.defaultModelGate(h) : null;
    /* 用户点过的方式由卡片记着；没点过就跟着已装那一份的来源走（S.startMethod：升级时是认出来的那一种），
       换了检测结果也跟得上。 */
    const upgrading = state !== 'missing';
    const [picked, setMethod] = useState(null);
    const method = picked || S.startMethod(h, upgrading);
    const via = upgrading ? S.detected(h) : null;
    const [busy, setBusy] = useState(false);
    const [diag, setDiag] = useState(false);
    const [picking, setPicking] = useState(false);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const runner = useCmdRun(h, failRun);
    const plan = S.installPlan(h, method, upgrading);
    const copy = async (value, label) => {
      try { await navigator.clipboard.writeText(value); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
    /* 就地运行：跑完成功才写探测补丁（正式版是跑完自动重新检测）；失败留在日志框里，不弹 toast。
       命令跑不了（官方脚本）时只展开详情，让用户看到复制入口。 */
    const runPlan = (upgrading, done) => {
      if (!open) onToggle();
      if (plan && S.runnable(plan)) runner.start(plan, upgrading, (ok) => ok && done());
    };
    const install = () => runPlan(false, () => {
      app.patchHarness(h.id, {found: true, loggedIn: false});
      app.toast(`检测到 ${h.name} ${h.ver} · 还需要登录一次`, 'positive');
    });
    const upgrade = () => runPlan(true, () => {
      /* 正式版升级后重新检测，configModelKnown 由内核按新版本的模型表重算；原型把它当新版本认得配置里的模型，
         模型表换回 data.js 里的那一份（演示数据里它就是最新版 CLI 报的表）。 */
      const base = window.BC_DATA.agent.harnesses.find((x) => x.id === h.id);
      app.patchHarness(h.id, {ver: h.latest, runError: null,
        ...(h.configModelKnown === false ? {configModelKnown: true, models: (base && base.models) || h.models} : {})});
      onRefreshModels();   // 新版本常带新模型：升级落定顺带刷新这一家的模型列表
      app.toast(`${h.name} 现在是 ${h.latest} · 正在刷新它的模型列表`, 'positive');
    });
    const login = () => {
      setBusy(true);
      app.toast(`原型演示：正式版会打开终端并运行 ${S.loginCmd(h)}`);
      timer.current = setTimeout(() => {
        setBusy(false);
        app.patchHarness(h.id, {loggedIn: true});
        app.setHarnessOn(h.id, true);
        if (!app.harness) app.setHarnessPref(h.id);
        onRefreshModels();   // 能取到哪些模型跟账号走：登录落定后刷新这一家
        app.toast(`${h.name} 已登录，可以开始会话`, 'positive');
      }, 1200);
    };
    const recheck = () => { setBusy(true); timer.current = setTimeout(() => { setBusy(false); setDiag(true); }, 900); };
    /* 添加的那家的「检测」：正式版起一个临时进程做 initialize 与 session/new；原型直接落成「找到了、还要登录一次」。 */
    const detect = () => {
      setBusy(true);
      timer.current = setTimeout(() => {
        setBusy(false);
        app.patchHarness(h.id, C.detectedPatch());
        app.toast(`检测到 ${h.name} · 还需要登录一次`, 'positive');
      }, 900);
    };
    const act = (action) => {
      if (action === 'upgrade') upgrade();
      else if (action === 'login') login();
      else if (action === 'diagnose') { if (!open) onToggle(); recheck(); }
      else if (action === 'reinstall') runPlan(false, () => { app.patchHarness(h.id, {runError: null}); app.toast(`${h.name} 已重新安装`, 'positive'); });
      else if (action === 'install') install();
    };
    const choices = S.modelChoices(h, app.prefs.agentModels);
    const setModel = (id) => { app.setPref('agentModels', {...(app.prefs.agentModels || {}), [h.id]: id}); setPicking(false); };

    return <div className={cx('agset-provider', open && 'is-open')}>
      <div className="agset-provider__head">
        <span className={cx('agset-avatar', state === 'ready' && 'is-ready')}><window.AgentIcon h={h} /></span>
        <div className="grow">
          <div className="row gap8"><b>{h.name}</b>{isDefault ? <Chip tone="accent">默认</Chip> : null}<Chip tone={badge.tone}>{badge.label}</Chip>{h.added ? <Chip>你添加的</Chip> : null}</div>
          <p>{h.found ? (h.added ? `已检测到 · v${h.ver} · 经 ACP 接入` : `本机已安装 · v${h.ver} · ${String(h.account).split(' · ')[0]}`)
            : h.added ? (h.launcher ? `还没检测 · 启动时由 ${h.launcher} 下载，需要 ${h.launcherNeeds}` : `还没检测 · 未在这台电脑上找到 ${h.cmd}`)
            : `未在这台电脑上找到 ${h.cmd} · 用你已有的 ${h.plan} 即可`}</p>
        </div>
        {h.found ? <Switch on={h.enabled && !S.blocked(h)} disabled={S.blocked(h)} ariaLabel={'启用 ' + h.name}
          onChange={(v) => { app.setHarnessOn(h.id, v); app.toast(v ? `已启用 ${h.name}` : `已停用 ${h.name} · 新会话不再列出它`); }} /> : null}
        <Btn size="s" variant={h.found ? 'quiet' : 'secondary'} iconRight={open ? 'chevup' : 'chevdown'} aria-expanded={open}
          aria-controls={'agent-detail-' + h.id} onClick={onToggle}>{h.found ? '详情' : h.added ? '检测' : '安装'}</Btn>
        {h.added && onRemove ? <Btn size="s" variant="quiet" onClick={onRemove}>移除</Btn> : null}
      </div>
      {/* Codex 画图（2026-09-25 图像生成设计稿 §2.2）：不用密钥、用它的图像生成工具；只在找到 + 登录 + 版本 ≥ 0.130 时能打开。
          打开后图片 Tab / 工具页 / bcut image 的模型菜单里多一只「Codex 画图」。2026-09-27 用户裁决：隐式回落永远不落到它，
          用户在设置 › 模型 › 图像生成 › 云端模型把默认显式设成它时照用；那一页的 Codex CLI 卡读写的是同一个开关（codexImageGen）。 */}
      {h.id === 'codex' && h.found ? <CodexImageRow h={h} /> : null}

      {problem ? <div className={cx('agp-problem', problem.kind === 'login' ? 'is-notice' : 'is-negative')} role="alert">
        <Ic n="alert" className="ic--16" />
        <div className="grow"><b>{problem.title}</b><p>{problem.body}</p></div>
        <Btn size="s" variant="accent" disabled={busy || runner.running} onClick={() => act(problem.action)}>{busy ? '请稍候…' : problem.cta}</Btn>
      </div> : null}
      {!problem && gate ? <div className="agp-problem is-notice" role="status">
        <Ic n="alert" className="ic--16" />
        <div className="grow"><b>{h.name} 配置的默认模型 {gate.model} 需要更新的版本</b>
          <p>{`本机是 ${gate.ver}，这一版的模型列表里没有 ${gate.model}。选了「Agent 默认模型」的会话会按配置用它，发出去会被拒绝；指定了模型的会话不受影响。`}
            {gate.latest ? '升级只更新这个命令行工具，不影响你的账号和它自己的设置。' : '目前还没有可以升级到的新版本，可以先在会话里改选列表里的模型。'}</p></div>
        {gate.latest ? <Btn size="s" variant="accent" disabled={busy || runner.running} onClick={upgrade}>升级到 {gate.latest}</Btn> : null}
      </div> : null}
      {!problem && !gate && update && !open ? <div className="agp-update">
        <span>有新版本 {h.latest}（当前 {h.ver}）。不升级也能继续使用。</span>
        <Btn size="s" disabled={busy} onClick={() => { if (!open) onToggle(); }}>查看升级方式</Btn>
      </div> : null}

      {open ? <div className="agset-provider__detail" id={'agent-detail-' + h.id}>
        {!h.found && h.added ? <AddedInstallPanel h={h} busy={busy} onDetect={detect}
          onCopy={() => copy(C.launchLine(h), '启动命令')} />
        : !h.found ? <InstallPanel h={h} plan={plan} method={method} setMethod={setMethod} busy={busy} runner={runner}
          onInstall={install} onCopy={() => plan && copy(plan.cmd, '安装命令')} onRecheck={recheck} /> : <>
          {h.caveat ? <div className="agp-note is-notice"><Ic n="alert" className="ic--16" /><span>{h.caveat}</span></div> : null}
          <div className="agset-detailrow"><div><b>默认模型</b><p>新会话起手用它；每条会话仍可在输入框下方临时换。转录、翻译、剪辑这类活用「推荐」档就够，不需要最强的模型。</p></div>
            <Picker size="s" value={S.modelLabel(h, app.prefs.agentModels)} open={picking} popWidth={320} popAlign="right"
              onClick={() => setPicking((v) => !v)} onClose={() => setPicking(false)}>
              <Menu>{choices.map((c) => <MenuItem key={c.id} wrap check={c.on} disabled={c.gone}
                label={<>{c.name}{c.tag ? <span className="agp-tier">{c.tag}</span> : null}</>} sub={c.sub} onClick={() => setModel(c.id)} />)}</Menu>
            </Picker></div>
          <div className="agset-detailrow"><div><b>{h.name} 的模型 · {h.models.length} 个</b>
            <p className="agp-models">{h.models.map((m) => m.name).join(' / ')}</p>
            <p>{catalog && catalog.refreshing ? '正在向 ' + h.name + ' 询问可用模型…' : catalog && catalog.error ? '这次没有更新成功，继续使用上次的列表。' + catalog.error : catalog && catalog.updated ? '刚刚更新 · 已是最新' : '2 小时前更新'}{catalog && catalog.refreshing ? '' : ' 重新检测、升级或登录之后会自动刷新。'}</p></div>
            <Btn size="s" icon="refresh" disabled={(catalog && catalog.refreshing) || S.blocked(h)} onClick={onRefreshModels}>刷新模型</Btn></div>
          <div className="agset-detailrow is-stack"><div><b>版本 · v{h.ver}</b>
            <p>{h.added ? (h.launcher ? `启动命令钉住了 ${h.spec}。要换版本，移除后用自定义命令重新添加。` : '升级请按它自己的说明；升级后在这里重新检测。') : <>{update ? `可以升级到 ${h.latest}。` : ''}升级只更新这个命令行工具，不影响你的账号和它自己的设置。{S.needsReinstall(h)
              ? `这一份是 ${h.ver}（${h.reinstall.from}），原地升级到不了 ${h.minVer}，要改装 ${h.reinstall.pkg}。`
              : via
              ? `这一份是用「${S.installMethods(h, true).find((m) => m.k === via).label}」安装的，升级也要用它——别的方式升不到这一份，只会再装一份。`
              : '请用当初安装它的那种方式升级。'}</>}</p></div>
            {plan ? <>
              {S.installMethods(h, true).length > 1 ? <Segmented size="s" className="agp-methods" value={method} onChange={(k) => { if (!runner.running) setMethod(k); }}
                items={S.installMethods(h, true).map((m) => ({k: m.k, label: m.label}))} /> : null}
              <CmdRun plan={plan} runner={runner} copyTip="复制升级命令" onCopy={() => copy(plan.cmd, '升级命令')} onRun={upgrade} />
              {S.runnable(plan) ? null
                : <p className="agp-hint">这条命令会从官方网站下载并运行脚本，请复制后在终端里自己运行。</p>}
            </> : null}</div>
          <div className="agset-detailrow"><div><b>账号</b><p>{h.added ? `${h.loggedIn === false ? '未登录或登录已过期。' : ''}登录与计费都在 ${h.name} 自己那里，BaoCut 不经手你的账号，也不额外收费。`
              : `${h.loggedIn === false ? '未登录或登录已过期' : h.account}。用的是你自己的订阅，BaoCut 不额外收费。`}</p></div>
            <Btn size="s" disabled={busy} onClick={login}>{h.loggedIn === false ? '打开终端登录' : '换一个账号…'}</Btn></div>
          <div className="agset-detailrow"><div><b>安装位置</b><code className="agset-path">{h.bin}</code><p>BaoCut 直接调用你电脑上的这个程序，不会另装一份。</p></div>
            <IconBtn icon="copy" size="s" tip="复制路径" onClick={() => copy(h.bin, '路径')} /></div>
          {h.launch ? <div className="agset-detailrow"><div><b>启动命令</b><code className="agset-path">{C.launchLine(h)}</code>
            <p>BaoCut 经 ACP（Agent Client Protocol）用这条命令启动它。</p></div>
            <IconBtn icon="copy" size="s" tip="复制启动命令" onClick={() => copy(C.launchLine(h), '启动命令')} /></div> : null}
          <div className="agset-detailrow"><div><b>排查</b><p>逐项检查安装、版本、登录和模型列表，告诉你卡在哪一步。</p></div>
            <div className="row gap8">{!isDefault && state === 'ready' ? <Btn size="s" onClick={() => { app.setHarnessPref(h.id); app.toast(`新会话默认用 ${h.name}`, 'positive'); }}>设为默认</Btn> : null}
              <Btn size="s" disabled={busy} onClick={recheck}>{busy ? '正在检查…' : '运行排查'}</Btn></div></div>
        </>}
        {diag ? <Diagnosis h={h} onFix={act} /> : null}
      </div> : null}
    </div>;
  }
  Object.assign(window, {AgentProviderCard});
})();
