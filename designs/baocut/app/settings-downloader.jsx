/* 设置 › 视频下载（product-design §2.7「下载视频」）：yt-dlp 的状态与维护，以及网站登录（浏览器 Cookie）。
   下载视频工具、从链接转录与智能体从链接下载都按这里的网站登录下载；默认带 Cookie，用所有检测到的浏览器
   （取值与存法在 model-tool-cookies.js）。下载视频工具页只摘要这两项，并链接到这里。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const U = window.BC_TOOL_UPDATE;
  const CK = window.BC_TOOL_COOKIES;
  const NEXT_VERSION = '2026.09.30';
  const updateTimer = {id: null};
  /* 演示挡位里的 Runtime 所在主机：更新命令的写法、判断不了时列的常见做法、检测到的浏览器与 Cookie 的系统提示都看它，不看界面跑在哪 */
  const hostOf = (d) => (d && d.demoHost) || 'darwin';
  const plansFor = (d) => U.demoPlan(hostOf(d), d.demoMethod);
  /* 演示的检测结果；真实客户端里打开页面与点「重新检测浏览器」时调 externalTools.cookieBrowsers */
  const detectedOf = (d) => CK.demoDetected(hostOf(d), (d && d.demoBrowsers) || 'several');
  /** 这一次下载按顺序试的浏览器：设置的值按当前检测结果展开。 */
  const cookieList = (app) => CK.resolve(CK.setting(app.prefs), detectedOf(app.downloader));
  /* 完全磁盘访问权限（macOS，product-design §2.7，architecture §7.9）：`externalTools.cookieBrowsers` 带回 Runtime 所在主机的
     `fullDiskAccess`（`granted` / `missing`，只有 macOS 主机有）。能直接带去系统设置的只有桌面端、Runtime 在这台电脑上的情形；
     原型是桌面端，演示挡位决定它是 `missing` 还是 `granted`。 */
  const accessOf = (d) => (hostOf(d) === 'darwin' ? (d && d.fullDisk) || 'missing' : null);
  /** 这一次下载要用、却没有授权的浏览器。 */
  const needsOf = (app, list) => CK.fullDiskNeeds(list, hostOf(app.downloader), detectedOf(app.downloader), accessOf(app.downloader));
  /** 点「打开系统设置」：宿主直接打开系统设置里的完全磁盘访问权限（桌面端用 `x-apple.systempreferences:` 地址）；之后卡片改成等用户启用。 */
  const openFullDisk = (app) => {
    app.setDownloader((s) => ({...s, fullDiskStep: 'opened'}));
    app.toast('已打开系统设置 › 完全磁盘访问权限（演示）', 'neutral');
  };
  /** 点「重新启动 BaoCut」：经过退出确认重启，重启后重新检测，授权生效。 */
  const restartApp = (app) => {
    app.setDownloader((s) => ({...s, fullDisk: 'granted', fullDiskStep: null}));
    app.toast('BaoCut 已重新启动，完全磁盘访问权限已生效（演示）', 'positive');
  };
  /** 授权卡：说清为什么要、点一下直接去系统设置；去过之后改成「启用后重新启动」。回到应用时自动重新检测，授权生效后卡片自己消失。 */
  function FullDiskNotice({ids}) {
    const app = useApp();
    const step = app.downloader.fullDiskStep === 'opened' ? 'opened' : 'idle';
    const c = CK.fullDiskCopy(ids, step);
    return <div className="setdl__access" role="group" aria-label="完全磁盘访问权限">
      <R.Icons.Lock UNSAFE_className="setdl__access-ic" />
      <div className="setdl__access-body">
        <b>{c.title}</b>
        <span className="t-detail-xs">{c.body}</span>
        <div className="row gap8">
          <Btn size="s" variant="accent" onClick={() => (step === 'opened' ? restartApp(app) : openFullDisk(app))}>{c.primary}</Btn>
          {c.secondary && <Btn size="s" variant="quiet" onClick={() => openFullDisk(app)}>{c.secondary}</Btn>}
        </div>
      </div>
    </div>;
  }
  /** 设置 › 隐私与权限里的常驻一行（macOS 主机、桌面端）：随时可以先授权，不必等某个功能失败。别的主机不显示。 */
  function FullDiskRow() {
    const app = useApp();
    const d = app.downloader || {};
    const access = accessOf(d);
    if (!access) return null;
    const granted = access === 'granted';
    const opened = d.fullDiskStep === 'opened';
    const Row = window.ShellRow;
    return <Row label="完全磁盘访问权限" desc={`${granted ? '已允许。' : '未允许。'}macOS 默认限制应用读取外置硬盘、桌面、文稿、下载等位置的文件，以及 Safari 的 Cookie。允许后，BaoCut 读这些位置时不会再因权限失败；只在你选的素材、保存位置与勾选的浏览器上读取。`}>
      {!granted && opened && <Btn size="s" variant="accent" className="setdl__nowrap" onClick={() => restartApp(app)}>重新启动 BaoCut</Btn>}
      {!granted && <Btn size="s" variant={opened ? 'secondary' : 'accent'} className="setdl__nowrap" onClick={() => openFullDisk(app)}>{opened ? '再次打开系统设置' : '打开系统设置'}</Btn>}
    </Row>;
  }
  /** yt-dlp 的状态词：已就绪、正在更新、需要处理。 */
  const statusOf = (d) => (d.state === 'ready' ? '已就绪' : d.state === 'updating' ? '正在更新' : '需要处理');
  const copyCommand = async (app, text) => app.toast(await copyToClipboard(text) ? '已复制命令' : '复制失败，请选择文字后复制', 'neutral');
  /* 演示的更新任务：逐行吐出输出，结束后按结果「重新检测」。真实客户端里是 Runtime 的 toolUpdate 任务，界面离开也照常跑。 */
  function startUpdate(app, plan) {
    const d = app.downloader;
    const outcome = d.demoOutcome || 'updated';
    const lines = U.demoOutput(plan.method, outcome, d.version, NEXT_VERSION, hostOf(d));
    clearInterval(updateTimer.id);
    app.setDownloader((s) => ({...s, state: 'updating', update: {status: 'running', method: plan.method, command: plan.command, lines: [], exitCode: null, cancelled: false, before: s.version, after: null, open: true}}));
    let i = 0;
    updateTimer.id = setInterval(() => {
      if (i < lines.length) {
        const line = lines[i++];
        app.setDownloader((s) => s.update && s.update.status === 'running' ? {...s, update: {...s.update, lines: [...s.update.lines, line]}} : s);
        return;
      }
      clearInterval(updateTimer.id);
      /* winget 没有可升级的版本时不以 0 退出（U.WINGET_NO_UPDATE），仍算成功 */
      const exitCode = outcome === 'failed' ? 1 : outcome === 'current' && plan.method === 'winget' ? U.WINGET_NO_UPDATE : 0;
      const ok = U.succeeded(plan.method, exitCode);
      const after = outcome === 'updated' ? NEXT_VERSION : d.version;
      const sum = U.summary({method: plan.method, exitCode, before: d.version, after});
      app.setDownloader((s) => s.update && s.update.status === 'running' ? {...s, state: 'ready', checked: true, version: after,
        update: {...s.update, status: 'done', exitCode, after, open: !ok}} : s);
      app.toast(sum.title, sum.tone === 'positive' ? 'positive' : sum.tone === 'negative' ? 'negative' : 'neutral');
    }, 600);
  }
  function stopUpdate(app) {
    clearInterval(updateTimer.id);
    app.setDownloader((s) => s.update && s.update.status === 'running' ? {...s, state: 'ready', update: {...s.update, status: 'done', cancelled: true, open: true}} : s);
  }
  /* 图标按钮 + 400ms 提示（S2 ActionButton 只放图标时，名字在 aria-label 与提示里） */
  function IconAction({label, onPress, children}) {
    return <R.TooltipTrigger delay={400}>
      <R.ActionButton isQuiet size="S" aria-label={label} onPress={onPress}>{children}</R.ActionButton>
      <R.Tooltip>{label}</R.Tooltip>
    </R.TooltipTrigger>;
  }
  /* 一行命令：等宽代码块，右边是执行（三角）与复制。看到的就是要执行的那一条，点执行即执行，不再弹确认；
     执行中三角换成停止。不能代为执行的（要管理员权限、判断不了）只有复制。 */
  function CommandRow({command, runnable, running, onRun, onStop}) {
    const app = useApp();
    return <div className="tool-update__cmdrow">
      <code className="tool-update__cmd">{command}</code>
      {runnable ? running
        ? <IconAction label="停止更新" onPress={onStop}><R.Icons.StopProcessing /></IconAction>
        : <IconAction label="执行这条命令" onPress={onRun}><R.Icons.Play /></IconAction> : null}
      <IconAction label="复制命令" onPress={() => copyCommand(app, command)}><R.Icons.Copy /></IconAction>
    </div>;
  }
  /* 命令下面的输出：执行中逐行追加并滚到最后；结束后一句结果，输出可收起 */
  function UpdateOutput({u}) {
    const app = useApp();
    const log = React.useRef(null);
    const running = u.status === 'running';
    useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [u.lines.length, u.open]);
    const sum = running ? null : U.summary(u);
    const set = (patch) => app.setDownloader((s) => ({...s, update: {...s.update, ...patch}}));
    return <div className="tool-update__out">
      {running ? <Progress indeterminate thin label="正在更新 yt-dlp" />
        : <R.InlineAlert variant={sum.tone}><R.Heading>{sum.title}</R.Heading>{sum.body ? <R.Content>{sum.body}</R.Content> : null}</R.InlineAlert>}
      {u.open ? <pre ref={log} className="tool-update__log" role="log" aria-label="更新输出" tabIndex={0}>{`${u.lines.join('\n') || '…'}${running ? '' : u.cancelled ? '\n（已停止）' : `\n（退出码 ${U.exitCodeText(u.exitCode)}）`}`}</pre> : null}
      {running ? null : <div className="row gap8">
        <Btn size="s" variant="quiet" aria-expanded={!!u.open} onClick={() => set({open: !u.open})}>{u.open ? '收起输出' : '显示输出'}</Btn>
        <Btn size="s" variant="quiet" onClick={() => app.setDownloader((s) => ({...s, update: null}))}>关闭</Btn>
      </div>}
    </div>;
  }
  /* 卡片里的「更新」：按探测出的安装方式给一行命令；判断不了时按 Runtime 所在主机列常用的几条，只能复制 */
  function UpdateSection({plan, d}) {
    const app = useApp();
    const copy = U.sectionCopy(plan);
    const running = !!(d.update && d.update.status === 'running');
    return <div className="tool-update" aria-label="更新 yt-dlp">
      <span className="t-detail-xs">{copy.label}</span>
      {plan ? <CommandRow command={plan.command} runnable={plan.runnable} running={running} onRun={() => startUpdate(app, plan)} onStop={() => stopUpdate(app)} />
        : U.manual(hostOf(d)).map((m) => <div key={m.label} className="tool-update__manual"><span className="t-detail-xs">{m.label}</span>
          <CommandRow command={m.command} /></div>)}
      {copy.hint ? <span className="t-detail-xs">{copy.hint}</span> : null}
      {d.update ? <UpdateOutput u={d.update} /> : null}
    </div>;
  }
  /* 演示的换版本：BaoCut 下载的那一份没有更新命令，下载、校验、试运行内置清单里的版本（真实客户端里是 toolInstall 任务）。
     没成功时原来那一份还在。 */
  function startManagedUpdate(app) {
    const failed = (app.downloader.demoOutcome || 'updated') === 'failed';
    clearTimeout(updateTimer.id);
    app.setDownloader((s) => ({...s, state: 'updating', update: null}));
    updateTimer.id = setTimeout(() => {
      app.setDownloader((s) => ({...s, state: 'ready', checked: true, version: failed ? s.version : NEXT_VERSION}));
      app.toast(failed ? '更新没有完成，现在这一份还能用' : `已更新到 ${NEXT_VERSION}`, failed ? 'negative' : 'positive');
    }, 1500);
  }
  /* BaoCut 下载的那一份有新版本（product-design §2.7）：照常能用，写出新版本的来源、大小与许可，点了才换 */
  function ManagedUpdate({d}) {
    const app = useApp();
    if (d.state === 'updating') return <Progress indeterminate thin label="正在准备下载工具" />;
    if (d.version === NEXT_VERSION) return null;
    return <div className="tool-update" aria-label="更新 yt-dlp">
      <span className="t-detail">有新版本 {NEXT_VERSION} 可用。更新之前可以继续用现在这一份。</span>
      <span className="t-detail-xs">版本 {NEXT_VERSION} · 约 36 MB · 从 github.com 下载 · Unlicense（源码），独立可执行文件整体按 GPLv3+ 许可</span>
      <div className="row gap8"><Btn size="s" variant="accent" onClick={() => startManagedUpdate(app)}>更新到 {NEXT_VERSION}</Btn></div>
    </div>;
  }
  /* 下载工具：检测到的版本、安装方式与位置，重新检测、准备下载工具，按原安装方式更新；BaoCut 下载的那一份换成清单里的新版本 */
  function DownloadSetup() {
    const app = useApp();
    const d = app.downloader || {};
    const demo = plansFor(d);
    const method = U.methodLabel(demo.plan);
    const updating = d.state === 'updating';
    return <div className="setpage__card setdl__card">
      <div className="row gap8"><R.Icons.Download /><b className="grow">yt-dlp</b>
        <Chip tone={d.state === 'ready' ? 'positive' : updating ? 'info' : 'notice'}>{statusOf(d)}</Chip></div>
      <span className="t-detail-xs">{d.version || '未安装'} · {demo.managed ? 'BaoCut 下载的' : method ? `${method} 安装` : '安装方式未知'}{d.checked && !updating ? ' · 已检测（演示）' : ''}</span>
      <span className="t-detail-xs">{demo.managed ? demo.path.replace('2026.07.04', d.version) : demo.path}</span>
      <div className="row gap8">
        <Btn size="s" variant="quiet" disabled={updating} onClick={() => { app.setDownloader((s) => ({...s, checked: true})); app.toast('检测完成（演示）'); }}>重新检测</Btn>
        {d.state !== 'ready' && !updating && <Btn size="s" onClick={() => app.updateDownloader()}>准备下载工具</Btn>}
      </div>
      {!d.version ? null : demo.managed ? <ManagedUpdate d={d} /> : <UpdateSection plan={demo.plan} d={d} />}
    </div>;
  }
  /* 网站登录（product-design §2.7）：只列出检测到的浏览器（最近用过的在前），一组复选框横排、放不下自然换行，
     「所有浏览器」在最前面（全选 / 半选）；默认全选，都不勾是匿名下载。下面按勾选写清楚怎么试、读了什么、要什么系统授权。 */
  function CookieSection() {
    const app = useApp();
    const detected = detectedOf(app.downloader);
    const list = cookieList(app);
    const all = CK.allState(list, detected);
    const access = accessOf(app.downloader);
    const needs = needsOf(app, list);
    const change = (next) => app.setPref('cookieBrowsers', CK.save(next, detected));
    const [busy, setBusy] = useState(false);
    const redetect = () => {
      setBusy(true);
      setTimeout(() => { setBusy(false); app.toast(detected.length ? `检测到 ${detected.length} 个浏览器（演示）` : '没有找到浏览器的 Cookie（演示）', 'neutral'); }, 600);
    };
    return <section className="setpage__group" aria-label="网站登录">
      <div className="setdl__head"><h2 className="grow">网站登录</h2>
        <Btn size="s" variant="quiet" disabled={busy} onClick={redetect}>{busy ? '正在检测…' : '重新检测浏览器'}</Btn></div>
      <div className="setpage__card setdl__card">
        <span className="t-detail">下载时带上你在浏览器里的登录状态，要登录才能看的视频也能下载。默认用所有检测到的浏览器。</span>
        {detected.length === 0 ? <span className="t-detail-xs">{CK.EMPTY}</span> : <>
          <div className="tool-link__browsers" role="group" aria-label="读取哪些浏览器的 Cookie">
            <Checkbox on={all.selected} isIndeterminate={all.indeterminate} onChange={() => change(CK.toggleAll(list, detected))} label="所有浏览器" />
            {detected.map((b) => <Checkbox key={b.id} on={list.indexOf(b.id) >= 0} onChange={(on) => change(CK.toggle(list, b.id, on, detected))} label={b.label} />)}
          </div>
          {/* 系统提示按运行下载的主机（Runtime 所在主机）的平台，原型取演示挡位 */}
          {needs.length > 0 && <FullDiskNotice ids={needs} />}
          {CK.notes(list, hostOf(app.downloader), detected, access).map((line) => <span key={line} className="t-detail-xs">{line}</span>)}
        </>}
      </div>
    </section>;
  }
  function UpdateDemo() {
    const app = useApp();
    const d = app.downloader || {};
    const set = (patch) => app.setDownloader((s) => ({...s, ...patch}));
    const host = hostOf(d);
    const methods = U.DEMO_METHODS[host];
    const method = methods.some((x) => x.k === d.demoMethod) ? d.demoMethod : methods[0].k;
    /* 换主机或安装方式时收起上一次的结果；正在跑的更新照常跑完 */
    const keepRunning = (s) => (s.update && s.update.status === 'running' ? s.update : null);
    return <BCDisclosure className="import-demo" title={<> 下载工具与浏览器演示场景 </>}>
      <div className="vdemo">
        <label>Runtime 所在主机<BCSelect aria-label="Runtime 主机演示挡位" value={host} onChange={(e) => app.setDownloader((s) => ({...s, demoHost: e.target.value,
          demoMethod: U.DEMO_METHODS[e.target.value][0].k, update: keepRunning(s)}))}>
          {U.DEMO_HOSTS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</BCSelect></label>
        <label>yt-dlp 的安装方式<BCSelect aria-label="安装方式演示挡位" value={method} onChange={(e) => app.setDownloader((s) => ({...s, demoMethod: e.target.value,
          update: keepRunning(s)}))}>
          {methods.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</BCSelect></label>
        <label>更新的结果<BCSelect aria-label="更新结果演示挡位" value={d.demoOutcome || 'updated'} onChange={(e) => set({demoOutcome: e.target.value})}>
          {U.DEMO_OUTCOMES.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</BCSelect></label>
        {host === 'darwin' && <label>完全磁盘访问权限<BCSelect aria-label="完全磁盘访问权限演示挡位" value={d.fullDisk || 'missing'} onChange={(e) => set({fullDisk: e.target.value, fullDiskStep: null})}>
          <option value="missing">未授权</option><option value="granted">已授权</option></BCSelect></label>}
        <label>本机浏览器<BCSelect aria-label="浏览器检测演示挡位" value={d.demoBrowsers || 'several'} onChange={(e) => set({demoBrowsers: e.target.value})}>
          {CK.demoScenes(host).map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</BCSelect></label>
      </div>
    </BCDisclosure>;
  }
  function DownloaderSection() {
    return <>
      <h1 className="setpage__title">视频下载</h1>
      <p className="t-detail setdl__lead">从链接下载视频用 yt-dlp。下载视频工具、从链接转录和智能体都按这里的设置下载。</p>
      <section className="setpage__group" aria-label="下载工具">
        <h2>下载工具</h2>
        <DownloadSetup />
      </section>
      <CookieSection />
      <UpdateDemo />
      <p className="t-detail-xs">交互原型：模拟检测与更新，不执行命令，不检测或读取真实浏览器的 Cookie。</p>
    </>;
  }
  Object.assign(window, {DownloaderSection, FullDiskNotice, FullDiskRow, BC_DOWNLOADER: {hostOf, detectedOf, cookieList, statusOf, plansFor, accessOf, needsOf, openFullDisk, restartApp}});
})();
