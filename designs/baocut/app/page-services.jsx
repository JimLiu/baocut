/* 服务页 —— §17.6（2026-09-17）。
   侧栏「服务」段的三行各进一页：MCP 服务（从 设置 › Agent Skill & MCP 搬出）、
   远端算力（从「工具」搬出，页面本体仍在 page-shell.jsx）、Web 服务（App 里原在 设置 › 通用 的一块）。
   三页顶上是同一张服务卡（`ServiceCard`）：状态块 + 标题 / 副行 + 一个起停按钮 + 页脚；
   起停与状态都走 store 的 `svcStates / flipService`，和 App rail「服务」格的出错角标（apprail.jsx）、总览标题旁的状态灯是同一份。
   原型不监听任何端口：地址、令牌、客户端与请求记录都是示例。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const SV = window.BC_SERVICES;
  const MT = window.BC_MCPTOOLS;
  const Row = window.ShellRow;

  // product-design §2.1：服务标识与侧栏保持一致，MCP 使用协议专用标识。
  function ServiceIcon({id, error}) {
    if (error) return <Ic n="alert" className="ic--16" />;
    if (id === 'mcp') return <Ic n="mcp" className="ic--16" />;
    const Icon = window.RSP.Icons[id === 'remote' ? 'DeviceMultiscreen' : 'GlobeGrid'];
    return <Icon />;
  }

  /* ---------- 三页共用的服务卡 ---------- */
  /** `title / sub` 由各页按自己的话术给；`blocked` = 现在起不了的原因（按钮置灰）；
   *  `foot` = 细线下那一行（自动启动勾选 + 右侧小字）；`children` = 出错时卡内的补救行。 */
  function ServiceCard({id, st, title, sub, subMono, blocked, foot, children}) {
    const app = useApp();
    const svc = SV.byId(id);
    const k = SV.stateOf(st);
    const busy = k === 'starting' || k === 'stopping';
    return (
      <Card layer className="svc">
        <div className="row gap12">
          <span className={cx('svc__mark', k === 'on' && 'is-on', k === 'error' && 'is-error')}>
            <ServiceIcon id={svc.id} error={k === 'error'} />
          </span>
          <span className="grow svc__txt">
            <b className="t-title-sm">{title}</b>
            <span className={cx('t-detail', subMono && 't-mono')}>{sub}</span>
          </span>
          {busy ? (
            <Btn variant="secondary" disabled>{k === 'starting' ? svc.starting : svc.stopping}</Btn>
          ) : k === 'on' ? (
            <Btn variant="secondary" icon="stop" onClick={() => app.flipService(id, false)}>{svc.stop}</Btn>
          ) : (
            <Btn variant="accent" icon="play" disabled={!!blocked} title={blocked || undefined}
              onClick={() => app.flipService(id, true)}>{k === 'error' ? '重新' + svc.start : svc.start}</Btn>
          )}
        </div>
        {children}
        {foot ? <div className="svc__foot">{foot}</div> : null}
      </Card>
    );
  }

  const useCopy = () => {
    const app = useApp();
    return async (text, label) => {
      try { await navigator.clipboard.writeText(text); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
  };

  function Lede({children}) {
    return <div className="t-body-sm t-subdued svc__lede">{children}</div>;
  }

  /* ================= MCP 服务 ================= */
  /* 固定端口 24351（被占用才退回随机端口，2026-09-27）；令牌默认不要。 */
  const ENDPOINT = SV.mcpUrl();
  const CLIENT = D.services.mcp.clients[0].name;
  const DEMO_TOKEN = 'baocut-demo-only-not-a-real-token';

  function McpServicePage() {
    const app = useApp();
    const {mcp, setMcp} = app;
    const st = app.svcStates.mcp;
    const live = SV.stateOf(st) === 'on';
    const locked = SV.stateOf(st) !== 'off';
    const titleOf = (id) => (app.projById(id) || {}).title || id;
    const scope = SV.mcpScope(mcp.projects, app.projects.length, titleOf);
    /* 演示调用落在哪个项目上：收窄过就取范围里的第一个，否则取列表第一个。 */
    const demoProject = mcp.projects[0] || (app.projects[0] || {}).id || 'p1';
    const copy = useCopy();
    const [picker, setPicker] = useState(false);
    const [checking, setChecking] = useState(false);
    const [verdict, setVerdict] = useState('');
    /* 演示：启动两秒后有一个客户端连进来；「修改前询问」时再过两秒来一条等确认的写请求。 */
    const [joined, setJoined] = useState(false);
    const [pending, setPending] = useState(null);
    const [log, setLog] = useState([]);
    const timers = useRef([]);
    useEffect(() => {
      timers.current.forEach(clearTimeout); timers.current = [];
      if (!live) { setJoined(false); setPending(null); setLog([]); setVerdict(''); return undefined; }
      timers.current.push(setTimeout(() => { setJoined(true); setLog(MT.DEMO.requests.map((r) => ({id: r.id, call: r.tool ? MT.callLine(r.tool, MT.withProject(r.args, demoProject)) : r.method, client: CLIENT, ago: '刚刚'}))); }, 2000));
      if (mcp.access === 'ask') timers.current.push(setTimeout(() => setPending(Object.assign({}, MT.DEMO.pending, {client: CLIENT, project: demoProject,
        call: MT.callLine(MT.DEMO.pending.tool, MT.withProject(MT.DEMO.pending.args, demoProject))})), 4000));
      /* 直接放行：同一条写入不等确认，直接落进最近请求。 */
      if (mcp.access === 'auto') timers.current.push(setTimeout(() => setLog((l) => [{id: 'w-auto', client: CLIENT, ago: '刚刚', result: '已执行',
        call: MT.callLine(MT.DEMO.pending.tool, MT.withProject(MT.DEMO.pending.args, demoProject))}].concat(l)), 4000));
      return () => timers.current.forEach(clearTimeout);
    }, [live, mcp.access]);
    const needToken = !!mcp.requireToken;
    const check = () => {
      setChecking(true); setVerdict('');
      timers.current.push(setTimeout(() => { setChecking(false); setVerdict('检查通过 · 服务可响应（演示）'); }, 700));
    };
    /* 等确认的那个工具被关掉、或权限不再是「修改前询问」，这条请求就不成立了。 */
    useEffect(() => {
      if (pending && MT.gate(MT.byName(pending.tool), mcp.access, mcp.off) !== 'ask') setPending(null);
    }, [pending, mcp.access, mcp.off]);
    const toggleTool = (name) => setMcp((s) => ({...s, off: s.off.indexOf(name) >= 0 ? s.off.filter((n) => n !== name) : s.off.concat(name)}));
    const decide = (ok) => {
      setLog((l) => [{id: 'w' + Date.now(), call: pending.call, client: pending.client, ago: '刚刚', result: ok ? '已允许' : '已拒绝'}].concat(l));
      setPending(null);
      app.toast(ok ? '已允许这一次写入（演示）' : '已拒绝 · 客户端会收到失败', ok ? 'positive' : null);
    };

    return (
      <window.Page title="MCP 服务" actions={<Chip>仅本机</Chip>}>
        <Lede>BaoCut 作为 MCP 服务端，向其他 AI 应用的 Agent 提供一套工具：读视频、改文稿和译文、剪片段、启动转录 / 翻译 / 导出，以及用这台电脑上的模型合成语音、生成图片。默认关闭；默认开放所有视频，也可以只开放其中几个。</Lede>

        <ServiceCard id="mcp" st={st} blocked={SV.startBlock('mcp')}
          title={live ? 'MCP 服务运行中' : st.phase ? SV.stateLabel('mcp', st) : 'MCP 服务未启动'}
          sub={SV.mcpSub(st, scope, mcp.access, needToken)}
          foot={<span className="t-detail-xs">{needToken ? '每次启动都会换新的访问令牌。退出 BaoCut 时服务一起停止。' : '只接受本机连接。退出 BaoCut 时服务一起停止。'}</span>} />

        {live ? (
          <>
            {pending ? (
              <Card layer className="svc__ask" role="status">
                <div className="row gap12">
                  <Ic n="alert" className="ic--16 svc__ask-ic" />
                  <span className="grow svc__txt">
                    <b className="t-title-sm">{pending.client} 想调用「{MT.byName(pending.tool).title}」</b>
                    <span className="t-detail">视频「{titleOf(pending.project)}」 · {pending.summary}</span>
                    <code className="svc__call">{pending.call}</code>
                    <BCDisclosure className="svc__approval-details" title={<> 详情 </>}>
                      <pre>{JSON.stringify(MT.withProject(pending.args, demoProject), null, 2)}</pre>
                      <Btn size="s" variant="quiet" icon="copy" onClick={() => copy(JSON.stringify(MT.withProject(pending.args, demoProject), null, 2), '完整参数')}>复制完整参数</Btn>
                    </BCDisclosure>
                  </span>
                  <Btn size="s" onClick={() => decide(false)}>拒绝</Btn>
                  <Btn size="s" variant="accent" onClick={() => decide(true)}>允许</Btn>
                </div>
              </Card>
            ) : null}

            <div className="t-section svc__sec">连接</div>
            <Card layer className="svc__panel">
              <div className="t-detail">{needToken
                ? '在支持本机 HTTP MCP 的客户端中添加服务，填入地址与访问令牌。'
                : '在支持本机 HTTP MCP 的客户端中添加服务，填入地址即可，不需要令牌。地址固定，下次启动不用重新配置。'}</div>
              <div className="agset-code"><code>{ENDPOINT}</code><IconBtn icon="copy" size="s" tip="复制 MCP 地址" onClick={() => copy(ENDPOINT, 'MCP 地址')} /></div>
              {needToken ? <div className="agm-token"><span>访问令牌 <code>••••••••••••</code></span><Btn size="s" variant="quiet" icon="copy" onClick={() => copy(DEMO_TOKEN, '示例令牌')}>复制令牌</Btn></div> : null}
              <div className="row gap8">
                <Btn size="s" onClick={() => copy(SV.mcpClientConfig(ENDPOINT, needToken ? DEMO_TOKEN : ''), '客户端配置')}>复制连接信息</Btn>
                <Btn size="s" variant="quiet" icon="refresh" disabled={checking} onClick={check}>{checking ? '正在检查…' : '检查服务'}</Btn>
                {verdict ? <span className="t-detail" role="status">{verdict}</span> : null}
              </div>
            </Card>

            <div className="t-section svc__sec">已连接的客户端</div>
            <Card layer className="svc__panel">
              {joined ? D.services.mcp.clients.map((c) => (
                <div className="svc__line" key={c.id}>
                  <span className="sidedot svc__dot is-on" />
                  <span className="grow"><b>{c.name}</b><span className="t-detail-xs"> · {c.since}连接 · {c.calls} 次请求</span></span>
                </div>
              )) : <div className="svc__empty"><Ic n="link" className="ic--16" />尚无客户端连接</div>}
            </Card>

            <div className="t-section svc__sec">最近请求</div>
            <Card layer className="svc__panel">
              {log.length ? log.map((r) => (
                <div className="svc__line" key={r.id}>
                  <code className="grow svc__call">{r.call}</code>
                  <span className="t-detail-xs">{r.client} · {r.ago}{r.result ? ' · ' + r.result : ''}</span>
                </div>
              )) : <div className="svc__empty">还没有请求</div>}
            </Card>
          </>
        ) : null}

        <div className="t-section svc__sec">开放范围</div>
        <Card layer className="svc__panel">
          <div className="agm-label svc__first"><b>可访问的视频</b><p className="t-detail">默认开放所有视频，Agent 用 <code>list_projects</code> 找到要处理的那个。也可以只勾选其中几个，范围外的视频对客户端不存在。</p></div>
          <Picker value={scope} disabled={locked} open={picker} popWidth={360}
            onClick={() => !locked && setPicker((v) => !v)} onClose={() => setPicker(false)}>
            <Menu>
              <MenuItem label="所有视频" sub={'包括以后新建的 · 现有 ' + app.projects.length + ' 部'} check={!mcp.projects.length}
                onClick={() => { setMcp((s) => ({...s, projects: []})); setPicker(false); }} />
              <MenuRule />
              <MenuHead>只开放勾选的视频</MenuHead>
              {app.projects.map((p) => <MenuItem key={p.id} label={p.title} check={mcp.projects.indexOf(p.id) >= 0}
                onClick={() => setMcp((s) => ({...s, projects: SV.mcpToggleProject(s.projects, p.id, app.projects.length)}))} />)}
            </Menu>
          </Picker>
          <div className="agm-label"><b>允许的操作</b><p className="t-detail">这项权限只作用于外部 MCP 客户端，与内置 Agent 的访问模式无关。</p></div>
          <BCChoiceGroup className="agm-access svc__access3" value={mcp.access} disabled={locked} onChange={access => setMcp(s => ({...s, access}))} aria-label="MCP 访问权限">
            {SV.MCP_ACCESS.map((a, i) => (
              <BCAction type="button" key={a.k} choiceKey={a.k}  disabled={locked}

                className={cx('agm-access__option', mcp.access === a.k && 'is-on')}

                >
                                <span><b>{a.title}</b><span>{a.desc}</span></span>
              </BCAction>
            ))}
          </BCChoiceGroup>
          <Row label="需要访问令牌" desc="打开后，客户端要带上 BaoCut 给的令牌才能连接，每次启动换新的。这台电脑上有你不信任的程序时打开。关着时只接受本机、非网页来源的连接。">
            <Switch on={needToken} disabled={locked} onChange={(v) => setMcp((s) => ({...s, requireToken: v}))} ariaLabel="需要访问令牌" />
          </Row>
          {locked ? <p className="t-detail svc__note">要更换视频、权限或令牌设置，请先停止服务。</p> : null}
        </Card>

        <window.McpToolsSection access={mcp.access} off={mcp.off} onToggle={toggleTool} live={live} copy={copy} />

        <div className="t-detail svc__related">
          想让终端里的 Claude Code、Codex 学会 BaoCut 的工作流？给它们安装 baocut skill 即可，不需要启动服务。
          <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'skills', tab: 'external'})}>设置 › Skills › 在终端里使用 BaoCut</BCAction>
        </div>
        <p className="t-detail-xs svc__proto">原型演示 · 不会真正启动 MCP 服务；地址、令牌、客户端与请求记录都是示例。</p>
      </window.Page>
    );
  }

  /* ================= Web 服务 ================= */
  function WebServicePage() {
    const app = useApp();
    const st = app.svcStates.web;
    const k = SV.stateOf(st);
    const live = k === 'on';
    const url = SV.webUrl(app.webPort);
    const copy = useCopy();
    const [draft, setDraft] = useState(String(app.webPort));
    const [portErr, setPortErr] = useState('');
    useEffect(() => { setDraft(String(app.webPort)); }, [app.webPort]);
    const commit = () => {
      const p = SV.parsePort(draft);
      if (p.error) { setPortErr(p.error); return; }
      setPortErr('');
      if (p.port !== app.webPort) app.setPref('webPort', p.port);
    };
    return (
      <window.Page title="Web 服务" actions={<Chip>仅本机</Chip>}>
        <Lede>在这台 Mac 的浏览器里打开 BaoCut Web，编辑同一批视频。服务只监听本机地址，局域网里的其他设备访问不到。</Lede>

        <ServiceCard id="web" st={st} subMono={live}
          title={live ? 'Web 服务运行中' : k === 'error' ? 'Web 服务启动失败' : st.phase ? SV.stateLabel('web', st) : 'Web 服务未启动'}
          sub={live ? url : k === 'error' ? st.error : st.phase ? `端口 ${app.webPort}` : '启动后可以在浏览器里打开 BaoCut Web。'}
          foot={<>
            <Checkbox on={!!app.prefs.webAutoStart} onChange={(v) => app.setPref('webAutoStart', v)} label="打开 BaoCut 时自动启动" />
            <span className="t-detail-xs">退出 BaoCut 时服务会一起停止。</span>
          </>}>
          {k === 'error' ? (
            <div className="svc__fix">
              <span className="t-detail grow">换一个端口再试，或先关掉占用它的程序。</span>
              <Btn size="s" variant="quiet" onClick={() => { app.setPref('webPort', SV.WEB_DEFAULT_PORT); app.toast(`端口已换回默认的 ${SV.WEB_DEFAULT_PORT}`); }}>换回默认端口</Btn>
            </div>
          ) : live ? (
            <div className="row gap8 svc__actions">
              <Btn size="s" variant="accent" icon="export" onClick={() => app.toast('原型演示：在默认浏览器中打开 ' + url)}>在浏览器中打开</Btn>
              <Btn size="s" icon="copy" onClick={() => copy(url, '地址')}>复制地址</Btn>
            </div>
          ) : null}
        </ServiceCard>

        {live ? (
          <>
            <div className="t-section svc__sec">打开的浏览器会话</div>
            <Card layer className="svc__panel">
              {D.services.web.sessions.map((s) => (
                <div className="svc__line" key={s.id}>
                  <span className="sidedot svc__dot is-on" />
                  <span className="grow"><b>{s.browser}</b><span className="t-detail-xs"> · {s.page}</span></span>
                  <span className="t-detail-xs">{s.ago}活跃</span>
                </div>
              ))}
            </Card>
          </>
        ) : null}

        <div className="t-section svc__sec">设置</div>
        <Card layer className="svc__panel svc__rows">
          <Row label="端口" desc={portErr || (k === 'off' || k === 'error' ? `默认 ${SV.WEB_DEFAULT_PORT}。被占用时换一个。` : '要更换端口，请先停止服务。')}>
            <div className="svc__port">
              <Field size="s" inputMode="numeric" aria-label="Web 服务端口" value={draft} invalid={!!portErr}
                disabled={k === 'on' || !!st.phase}
                onChange={(e) => { setDraft(e.target.value); setPortErr(''); }}
                onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
            </div>
          </Row>
        </Card>
        <window.ApiSection live={live} />
        <p className="t-detail-xs svc__proto">原型演示 · 不会真正监听端口；把端口改成 8080 再启动，可以看到启动失败的样子。API key 是示例；端点详情页的「发送请求」返回演示响应。</p>
      </window.Page>
    );
  }

  /* ================= 总览 ================= */
  /* 总览里的一行：状态块 + 名称 / 状态 + 就地起停 + 进详情。起停不用进详情页。 */
  function ServiceItem({svc}) {
    const app = useApp();
    const st = app.svcStates[svc.id];
    const k = SV.stateOf(st);
    const quick = SV.quickAction(svc.id, st);
    const open = () => app.go({r: 'services', id: svc.id});
    const scope = SV.mcpScope(app.mcp.projects, app.projects.length, (id) => (app.projById(id) || {}).title || id);
    const share = D.remote.share;
    const detail = k === 'error' ? st.error
      : svc.id === 'mcp' ? SV.mcpSub(st, scope, app.mcp.access, app.mcp.requireToken)
      : svc.id === 'remote' ? (k === 'on' ? `${share.nodeName} · ${share.addr}` : svc.desc)
      : (k === 'on' ? SV.webUrl(app.webPort) : svc.desc);
    return (
      <div className="svcitem">
        <BCAction type="button" className="svcitem__main" onClick={open}>
          <span className={cx('svc__mark', k === 'on' && 'is-on', k === 'error' && 'is-error')}>
            <ServiceIcon id={svc.id} error={k === 'error'} />
          </span>
          <span className="svcitem__txt">
            <span className="svcitem__nm"><b>{svc.name}</b><Chip>{svc.scope}</Chip></span>
            <span className="svcitem__st">
              <span className={cx('svclight', 'is-' + SV.dotTone(st), (k === 'starting' || k === 'stopping') && 'is-busy')} />
              <span className="svcitem__lbl">{SV.stateLabel(svc.id, st)}</span><span className="svcitem__sep">·</span><span className="svcitem__detail">{detail}</span>
            </span>
          </span>
        </BCAction>
        {quick && quick.kind !== 'open' ? (
          <Btn size="s" variant={quick.kind === 'start' ? 'accent' : 'secondary'} icon={quick.icon}
            onClick={() => app.flipService(svc.id, quick.kind === 'start')}>{quick.tip}</Btn>
        ) : quick ? (
          <Btn size="s" variant="secondary" onClick={open}>去设置…</Btn>
        ) : (
          <Btn size="s" variant="secondary" disabled>{k === 'starting' ? svc.starting : svc.stopping}</Btn>
        )}
        <IconBtn size="s" tip={`打开${svc.name}`} onClick={open}><NavChevron /></IconBtn>
      </div>
    );
  }

  function ServicesOverview() {
    const app = useApp();
    const sum = SV.summary(app.svcStates);
    return (
      <window.Page title="服务" actions={<>
        {/* 整排灯（原 Home 侧栏「服务」行尾那三颗，2026-10-02 服务搬上 rail 后放这里；rail 上只有出错角标） */}
        <window.SvcLights />
        {sum ? <Chip tone={sum.tone === 'error' ? 'notice' : 'positive'}>{sum.text}</Chip> : <Chip>全部未启动</Chip>}
      </>}>
        <Lede>这台 Mac 上由 BaoCut 提供、等别的应用或设备连进来的服务。都默认关闭；退出 BaoCut 时一起停止。</Lede>
        <Card layer className="svclist">
          {SV.SERVICES.map((svc) => <ServiceItem key={svc.id} svc={svc} />)}
        </Card>
      </window.Page>
    );
  }

  /** 路由 `{r:'services'}` 是总览，`{r:'services', id, tab?}` 是某一项；旧的远端算力链接也落到这里（`BC_SERVICES.resolve`）。
   *  `{r:'services', id:'web', tab:'<能力>.<端点>'}` 是 OpenAI 兼容 API 某条端点的详情页（page-services-api.jsx）；端点不认识回 Web 服务页。 */
  function ServicesPage({id, tab}) {
    if (id === 'remote') return <window.RemotePage tab={tab} />;
    if (id === 'web' && tab && window.BC_OPENAI_API.resolveEp(tab)) return <window.ApiEndpointPage key={tab} epId={tab} />;
    if (id === 'web') return <WebServicePage />;
    if (id === 'mcp') return <McpServicePage />;
    return <ServicesOverview />;
  }

  Object.assign(window, {ServicesPage, ServiceCard});
})();
