/* 下载视频（product-design §2.7）：文件下载与可选转录，不创建编辑视频。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const SAMPLE_URL = 'https://video.example.com/watch?v=kl39';
  const drafts = {st: null};
  const urlOk = (u) => window.BC_MEDIA.urlValid(u);
  function LinkField({value, onChange}) {
    return <div className="ttsw__sec">
      <R.TextField label="视频链接" value={value} onChange={onChange} placeholder="https://…" type="url"
        isInvalid={!!value && !urlOk(value)} errorMessage="链接要以 http:// 或 https:// 开头" UNSAFE_className="tool-link__url" />
      <div className="row gap8"><span className="t-detail-xs grow">支持单个视频页面与媒体直链。</span>
        <Btn size="s" variant="quiet" onClick={() => onChange(SAMPLE_URL)}>填入示例链接</Btn></div>
    </div>;
  }
  const U = window.BC_TOOL_UPDATE;
  const NEXT_VERSION = '2026.09.30';
  const updateTimer = {id: null};
  /* 演示挡位里的 Runtime 所在主机：更新命令的写法、判断不了时列的常见做法、检测到的浏览器与 Cookie 的系统提示都看它，不看界面跑在哪 */
  const hostOf = (d) => (d && d.demoHost) || 'darwin';
  const plansFor = (d) => U.demoPlan(hostOf(d), d.demoMethod);
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
  function DownloadSetup() {
    const app = useApp();
    const d = app.downloader || {};
    const demo = plansFor(d);
    const method = U.methodLabel(demo.plan);
    const updating = d.state === 'updating';
    return <div className="ttsw__sec">
      <div className="row gap8"><R.Icons.Download /><b className="grow">视频下载工具 · yt-dlp</b><span className="t-detail-xs">{d.state === 'ready' ? '已就绪' : updating ? '正在更新' : '需要处理'}</span></div>
      <span className="t-detail-xs">{d.version || '未安装'} · {method ? `${method} 安装` : '安装方式未知'}{d.checked && !updating ? ' · 已检测（演示）' : ''}</span>
      <span className="t-detail-xs">{demo.path}</span>
      <div className="row gap8">
        <Btn size="s" variant="quiet" disabled={updating} onClick={() => { app.setDownloader((s) => ({...s, checked: true})); app.toast('检测完成（演示）'); }}>重新检测</Btn>
        {d.state !== 'ready' && !updating && <Btn size="s" onClick={() => app.updateDownloader()}>准备下载工具</Btn>}
      </div>
      {d.version ? <UpdateSection plan={demo.plan} d={d} /> : null}
    </div>;
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
        <label>本机浏览器<BCSelect aria-label="浏览器检测演示挡位" value={d.demoBrowsers || 'several'} onChange={(e) => set({demoBrowsers: e.target.value})}>
          {CK.demoScenes(host).map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}</BCSelect></label>
      </div>
    </BCDisclosure>;
  }
  const CK = window.BC_TOOL_COOKIES;
  /* 演示的检测结果；真实客户端里打开页面与点「重新检测浏览器」时调 externalTools.cookieBrowsers */
  const detectedOf = (d) => CK.demoDetected(hostOf(d), (d && d.demoBrowsers) || 'several');
  /* 网站登录（product-design §2.7）：只列出检测到的浏览器（最近用过的在前），一组复选框横排、放不下自然换行，
     「所有浏览器」在最前面（全选 / 半选）；都不勾是匿名下载。下面按勾选写清楚怎么试、读了什么、要什么系统授权。 */
  function CookieSection({checked, onChange}) {
    const app = useApp();
    const detected = detectedOf(app.downloader);
    const list = CK.ordered(checked, detected);
    const all = CK.allState(list, detected);
    const [busy, setBusy] = useState(false);
    const titleId = React.useId();
    const redetect = () => {
      setBusy(true);
      setTimeout(() => { setBusy(false); app.toast(detected.length ? `检测到 ${detected.length} 个浏览器（演示）` : '没有找到浏览器的 Cookie（演示）', 'neutral'); }, 600);
    };
    return <div className="ttsw__sec" role="group" aria-labelledby={titleId}>
      <div className="row gap8"><R.Icons.User /><b className="grow" id={titleId}>网站登录</b>
        <Btn size="s" variant="quiet" disabled={busy} onClick={redetect}>{busy ? '正在检测…' : '重新检测浏览器'}</Btn></div>
      {detected.length === 0 ? <span className="t-detail-xs">{CK.EMPTY}</span> : <>
        <div className="tool-link__browsers" role="group" aria-label="读取哪些浏览器的 Cookie">
          <Checkbox on={all.selected} isIndeterminate={all.indeterminate} onChange={() => onChange(CK.toggleAll(list, detected))} label="所有浏览器" />
          {detected.map((b) => <Checkbox key={b.id} on={list.indexOf(b.id) >= 0} onChange={(on) => onChange(CK.toggle(list, b.id, on, detected))} label={b.label} />)}
        </div>
        {/* 系统提示按运行下载的主机（Runtime 所在主机）的平台，原型取演示挡位 */}
        {CK.notes(list, hostOf(app.downloader)).map((line) => <span key={line} className="t-detail-xs">{line}</span>)}
      </>}
    </div>;
  }
  function LinkToolPage() {
    const app = useApp();
    const s = window.useToolRuns();
    const [st, setSt] = useState(() => Object.assign({url: '', target: 'none', dir: null, transcribe: false, cookieBrowsers: [], saveDir: window.BC_SAVE_DIR.current(app.prefs, null)}, drafts.st || {}));
    const [changeDir, setChangeDir] = useState(false);
    const set = (patch) => setSt((x) => Object.assign({}, x, patch));
    useEffect(() => { drafts.st = st; }, [st]);
    const toolReady = !app.downloader || app.downloader.state === 'ready';
    const ready = urlOk(st.url) && toolReady && /^(~\/|\/|[a-zA-Z]:[\\/])/.test(st.saveDir);
    const go = () => window.BC_TOOL_RUNNER.start(app, window.BC_TOOL_SPECS.link(app, Object.assign({}, st, {target: 'none',
      cookieBrowsers: CK.ordered(st.cookieBrowsers, detectedOf(app.downloader))})));
    return <window.ToolFrame tool="link" title="下载视频" bar={<Btn variant="accent" disabled={!ready} onClick={go}>{st.transcribe ? '下载并转录' : '开始下载'}</Btn>}>
      <p className="t-detail">粘贴视频链接，下载到本机。需要文稿时，可以在下载完成后自动转录。</p>
      <LinkField value={st.url} onChange={(url) => set({url})} />
      <div className="ttsw__sec"><div className="row gap8"><R.Icons.Folder /><span className="grow t-detail">下载到 {st.saveDir}</span><Btn size="s" variant="quiet" onClick={() => setChangeDir(!changeDir)}>更改目录</Btn></div>
        {changeDir && <R.TextField label="下载目录（原型演示）" value={st.saveDir} onChange={(saveDir) => set({saveDir})} description="Electron 中使用系统文件夹选择器。" />}
      </div>
      <DownloadSetup />
      <CookieSection checked={st.cookieBrowsers} onChange={(cookieBrowsers) => set({cookieBrowsers})} />
      <div className="ttsw__sec">
        <R.Switch isSelected={st.transcribe} onChange={(transcribe) => set({transcribe})}>下载后转录</R.Switch>
        {st.transcribe && <>
          <span className="t-detail-xs">使用默认语音识别模型，自动检测语言，保存 TXT 文稿和 SRT 字幕。转录失败时已下载的视频仍保留。</span>
          <R.Picker label="转录结果放到项目（可选）" selectedKey={st.dir || 'none'} onSelectionChange={(dir) => set({dir: dir === 'none' ? null : dir})} UNSAFE_className="tool-llm__field">
            <R.PickerItem id="none">不放到项目</R.PickerItem>
            {app.dirs.map((d) => <R.PickerItem key={d.id} id={d.id}>{d.name}</R.PickerItem>)}
          </R.Picker>
          {st.dir && <span className="t-detail-xs">仅关联项目，文件仍保存在上方指定的目录。</span>}
        </>}
      </div>
      <window.ToolDemo />
      <UpdateDemo />
      <p className="t-detail-xs">交互原型：模拟下载、检测、更新和转录，不执行命令，不访问真实视频，不检测或读取真实浏览器的 Cookie。</p>
    </window.ToolFrame>;
  }
  Object.assign(window, {LinkToolPage, BC_LINK_TOOL: {LinkField, DownloadSetup, urlOk, SAMPLE_URL}});
})();
