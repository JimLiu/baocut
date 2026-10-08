/* 能力页（product-design §7.6）：每种能力一页，本机模型与 API 提供方的模型在同一页，不分本地 / 云端两个 Tab。从上到下：
   ① 默认模型——一个选择器，按本机、各 API 提供方、智能体分组，不可用的项置灰并写明原因；
   ② 这种能力的参数（并发；文本生成另有推理强度）；
   ③ 本机模型（settings-local.jsx 的目录、安装、检查与试用，默认行交给 ①）；
   ④ API 提供方：目录里有这种能力的全部提供方（BC_VENDORS.capCatalog，含没添加的与自建端点），一家一组，带图标；
      顶部始终有搜索框；组可折叠，默认已连接的展开、其余收起，有查询词时命中的展开。已连接的组每行可以测试、显示默认标记；
      没连上的组表头给「配置」（与添加 sheet 的选卡同一路径：没添加先添加，再进详情并展开「添加账号」），展开后只读列模型。
      「管理 API 提供方」去 API 提供方页。默认模型选择器 ① 仍只列已添加的提供方。
      列表末尾一行「没有你用的提供方？添加 OpenAI 兼容端点」：去 API 提供方页、打开添加 sheet 并聚焦自建端点的名称（from=custom）。
   人声分离与视觉分析只有本机模型，只有 ③（默认行照旧由本机模型一节自己给）。目录里标 P1 的能力不出现在这一页。 */
(function () {
  const {useState} = React;
  const V = () => window.BC_VENDORS;
  const LM = () => window.BC_LOCALMODELS;
  const IM = () => window.BC_CLOUD_IMAGE;
  const D = window.BC_DATA;
  const NV = () => window.BC_SETTINGS_NAV;
  const PARAMS = {
    transcribe: {max: 8, desc: '同时发给 API 提供方的转录请求上限（1–8）。遇到限速就调低。'},
    tts: {max: 8, desc: '逐句配音、旁白时同时发出的合成请求上限（1–8）。遇到限速就调低。'},
    text: {max: 16, desc: '润色、翻译时同时发出的请求上限（1–16）。遇到限速就调低。'},
    image: {max: 4, desc: '批量生图时同一家同时发出的请求上限（1–4）。遇到限速就调低。'},
  };
  const AUTO_LABEL = {transcribe: '自动选择', text: '自动选择'};

  /* 当前默认：API 提供方的优先（四种能力各一个存法），否则本机 */
  function readDefault(app, cap, cat) {
    const cloud = cap === 'text' ? (app.cloudLlmDefault ? 'cloud:' + app.cloudLlmDefault : '')
      : cap === 'transcribe' ? app.cloudAsrDefault : cap === 'tts' ? app.cloudTtsDefault : app.cloudImageDefault;
    if (cloud) return cloud;
    const local = cat ? (app.prefs.localModelDefaults || {})[cat] : null;
    return local ? 'local:' + local : '';
  }
  /* 写默认：一种能力只有一个默认，选了本机就清掉 API 提供方的，反过来也一样 */
  function writeDefault(app, cap, cat, v) {
    const cloud = v.indexOf('cloud:') === 0 || v.indexOf('agent:') === 0 ? v : '';
    const local = v.indexOf('local:') === 0 ? v.slice(6) : null;
    if (cap === 'text') app.setCloudLlmDefault(cloud ? cloud.slice(6) : '');
    if (cap === 'transcribe') app.setCloudAsrDefault(cloud);
    if (cap === 'tts') app.setCloudTtsDefault(cloud);
    if (cap === 'image') app.setCloudImageDefault(cloud);
    if (cat) app.setPref('localModelDefaults', {...(app.prefs.localModelDefaults || {}), [cat]: local});
  }

  function DefaultPicker({cap, cat}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const now = Date.now();
    const cur = readDefault(app, cap, cat);
    /* 本机：装好的可选；没装的置灰写「未安装」 */
    const models = D.setModels, comps = D.setComponents;
    const on = (() => { let t = LM().initial(models, comps); models.forEach((m) => { if (app.modelInstalled(m.id) && !t[m.id]) t = LM().applyInstall(t, m); }); return t; })();
    const local = cat ? models.filter((m) => LM().catOf(m) === cat && !m.pack && m.supported !== false) : [];
    const ready = (m) => app.modelInstalled(m.id) && LM().ready(m, comps, on);
    const groups = V().choices(cap, app.providerSettings, app.providerAccounts, now);
    const codexH = (app.harnessList || []).find((h) => h.id === 'codex') || null;
    const codex = cap === 'image' ? IM().codexReady(codexH, app.codexImageGen) : null;
    const label = (() => {
      if (!cur) return AUTO_LABEL[cap] || (cat && LM().hasAuto(cat) ? '自动选择' : '未设置');
      if (cur.indexOf('local:') === 0) { const m = local.find((x) => x.id === cur.slice(6)); return m ? m.name : cur.slice(6); }
      if (cur.indexOf('agent:') === 0) return `Codex 画图${codex && codex.ready ? '' : '（不可用）'}`;
      const [pid, ...rest] = cur.slice(6).split('/');
      const g = groups.find((x) => x.vendor.id === pid);
      return `${g ? g.vendor.name : pid} · ${rest.join('/')}${g && g.ready ? '' : '（不可用）'}`;
    })();
    const pick = (v) => { writeDefault(app, cap, cat, v); setOpen(false); };
    const autoOk = AUTO_LABEL[cap] || (cat && LM().hasAuto(cat));
    const desc = cap === 'text' ? '润色、翻译、生成章节时用它。' : cat ? LM().DEFAULT_DESC[cat] : '';
    return <window.ShellRow label="默认模型" desc={`${desc} 不可用的项置灰并写明原因。`}>
      <Picker size="s" value={label} open={open} popAlign="right" popWidth={320} onClick={() => setOpen(!open)} onClose={() => setOpen(false)}>
        <Menu>
          {autoOk ? <MenuItem label={AUTO_LABEL[cap] || '自动选择'} sub={cap === 'text' ? '按任务挑一个能用的模型' : '按这台电脑与任务挑'} check={!cur} onClick={() => pick('')} /> : null}
          {local.length ? <><MenuRule /><MenuHead>本机</MenuHead></> : null}
          {local.map((m) => <MenuItem key={m.id} label={m.name} disabled={!ready(m)} sub={ready(m) ? '在这台电脑上运行 · 不联网' : '未安装 · 在下面的本机模型里下载'}
            check={cur === 'local:' + m.id} onClick={() => pick('local:' + m.id)} />)}
          {groups.map((g) => <React.Fragment key={g.vendor.id}>
            <MenuRule /><MenuHead>{g.vendor.name}</MenuHead>
            {g.ready ? g.models.map((m) => { const v = `cloud:${g.vendor.id}/${m.id}`;
              return <MenuItem key={m.id} label={m.id} sub={[m.desc, g.state.k === 'warn' ? `首选账号 ${g.state.label}` : ''].filter(Boolean).join(' · ') || undefined} check={cur === v} onClick={() => pick(v)} />; })
              : <MenuItem label={g.why} sub="在 API 提供方页添加账号或启用后可选" disabled />}
          </React.Fragment>)}
          {codex ? <><MenuRule /><MenuHead>智能体</MenuHead>
            <MenuItem label="Codex 画图" sub={codex.ready ? '用你的 Codex 订阅 · 一次一张 · 慢 5–10 倍' : codex.why} disabled={!codex.ready && cur !== IM().CODEX_ID}
              check={cur === IM().CODEX_ID} onClick={() => pick(IM().CODEX_ID)} /></> : null}
          {!groups.length && !local.length && !codex ? <><MenuRule /><MenuItem label="还没有能用的模型" sub="先在 API 提供方页添加一家" disabled /></> : null}
        </Menu>
      </Picker>
    </window.ShellRow>;
  }

  function Params({cap}) {
    const p = PARAMS[cap];
    const [n, setN] = useState(2);
    const [effort, setEffort] = useState('自动');
    return <>
      <window.ShellRow label="并发请求数" desc={p.desc}>
        <Stepper value={n} decTip="减少" incTip="增加" disabledDec={n === 1} disabledInc={n === p.max} onDec={() => setN(n - 1)} onInc={() => setN(n + 1)} />
      </window.ShellRow>
      {cap === 'text' ? <window.ShellRow label="推理强度" desc="只对支持推理的模型生效。">
        <Segmented size="s" value={effort} onChange={setEffort} items={['自动', '低', '中', '高'].map((x) => ({k: x, label: x}))} />
      </window.ShellRow> : null}
    </>;
  }

  /* ④ API 提供方：全目录、一家一组，可折叠、可搜索 */
  function ProviderModels({cap}) {
    const app = useApp();
    const [probe, setProbe] = useState(null);
    const [results, setResults] = useState({});
    const [q, setQ] = useState('');
    const [toggled, setToggled] = useState({});   // 用户手动翻过的组；换查询词时清空，回到默认的开合
    const rows = V().capCatalog(cap, app.providerSettings, app.providerAccounts, Date.now(), q);
    const cur = readDefault(app, cap, null);
    const codexH = (app.harnessList || []).find((h) => h.id === 'codex') || null;
    const codex = cap === 'image' ? IM().codexReady(codexH, app.codexImageGen) : null;
    const goProviders = (add) => app.go(Object.assign({r: 'settings', sec: 'providers'}, add ? {from: 'add'} : {}));
    /* 与添加 sheet 的 pick 同一路径：没添加的先添加，再进详情并直接展开「添加账号」 */
    const configure = (id) => {
      if (!app.providerSettings[id]) app.patchProvider(id, {enabled: true});
      app.go(window.providerDetailRoute(id, true));
    };
    const isOpen = (r) => (r.id in toggled ? toggled[r.id] : q.trim() ? true : r.ready);
    const meta = (r) => {
      const n = `${r.models.length} 个模型`;
      if (r.ready) return [r.state.k === 'warn' ? `首选账号 ${r.state.label}` : V().accountSummary(app.providerAccounts[r.id]), n].join(' · ');
      return [r.state.label, n].join(' · ');
    };
    const model = (r, m) => {
      const k = `${r.id}/${m.id}`;
      if (!r.ready) return <div className="capm__model" key={m.id}><b>{m.id}</b>{m.desc ? <span className="capm__desc">{m.desc}</span> : null}</div>;
      const res = results[k];
      return <div className="capm__model" key={m.id}>
        <b>{m.id}</b>{m.desc ? <span className="capm__desc">{m.desc}</span> : <span className="capm__desc" />}
        {res ? <span className={cx('capm__verdict', res.state === 'error' && 't-negative')}>{window.probeVerdict(res)}</span> : null}
        {m.prev ? <Chip tone="neutral">上一代</Chip> : null}
        {cur === 'cloud:' + k ? <Chip tone="accent">默认</Chip> : null}
        <Btn size="s" variant="quiet" onClick={() => setProbe({providerId: r.id, providerName: r.vendor.name, modelId: m.id, cap})}>测试…</Btn>
      </div>;
    };
    return <section className="setpage__group capm" aria-label="API 提供方">
      <div className="capm__head">
        <span className="capm__title"><h2>API 提供方</h2><span className="t-detail-xs">有这种能力的提供方；添加密钥后它的模型可选。</span></span>
        <window.BCAction className="capm__link" onClick={() => goProviders(false)}>管理 API 提供方<Ic n="chevright" className="ic--14" /></window.BCAction>
      </div>
      <Field icon="search" className="capm__search" aria-label="搜索提供方或模型" placeholder="搜索提供方或模型" value={q}
        onChange={(e) => { setQ(e.target.value); setToggled({}); }} />
      {rows.length ? <div className="setpage__card capm__card">
        {rows.map((r) => { const open = isOpen(r); const body = `capm-${cap}-${r.id.replace(/[^a-z0-9-]/gi, '-')}`;
          return <div className={cx('capm__grp', open && 'is-open')} key={r.id}>
            <div className="capm__row">
              <window.BCAction className="capm__toggle" aria-expanded={open} aria-controls={open ? body : undefined}
                onClick={() => setToggled((t) => ({...t, [r.id]: !open}))}>
                <window.VendorIcon id={r.id} name={r.vendor.name} />
                <span className="capm__nm">{r.vendor.name}</span>
                {r.kind === 'relay' ? <span className="capm__tag">中转</span> : r.kind === 'custom' ? <span className="capm__tag">自建</span> : null}
                <span className={cx('capm__meta', r.ready && r.state.k === 'warn' && 'is-warn')}>{meta(r)}</span>
                <Ic n="chevright" className="ic--14 capm__chev" />
              </window.BCAction>
              {r.ready ? null : <Btn size="s" variant="quiet" onClick={() => configure(r.id)} aria-label={`配置 ${r.vendor.name}`}>配置</Btn>}
            </div>
            {open ? <div className="capm__models" id={body}>
              {r.models.length ? r.models.map((m) => model(r, m)) : <p className="t-detail-xs capm__none">还没有模型。在详情里添加模型 id。</p>}
            </div> : null}
          </div>; })}
        <div className="capm__grp">
          <window.BCAction className="capm__custom" onClick={() => app.go({r: 'settings', sec: 'providers', from: 'custom'})}>
            <Ic n="plus" className="ic--16" /><span>没有你用的提供方？<b>添加 OpenAI 兼容端点</b></span>
          </window.BCAction>
        </div>
      </div> : <div className="setpage__card capm__empty">
        <p className="t-detail">没有找到「{q.trim()}」。可以在 API 提供方页把它添加为自建端点。</p>
        <Btn size="s" variant="secondary" icon="plus" onClick={() => goProviders(true)}>添加 API 提供方</Btn>
      </div>}
      {codex ? <div className="setpage__card capm__agent">
        <window.ShellRow label="Codex 画图" desc={codex.ready ? '智能体 · 用你的 Codex 订阅，不用密钥 · 一次一张 · 忽略尺寸 · 慢 5–10 倍' : `智能体 · ${codex.why}`}>
          {IM().codexCanEnable(codexH) ? <Switch on={!!app.codexImageGen} ariaLabel="用 Codex 画图" onChange={(v) => app.setCodexImageGen(v)} />
            : <Btn size="s" variant="quiet" onClick={() => app.go({r: 'settings', sec: 'agent'})}>去设置 › Agent</Btn>}
        </window.ShellRow>
      </div> : null}
      <window.ModelProbeDialog probe={probe} onClose={() => setProbe(null)} onDone={(r) => setResults((x) => ({...x, [probe.providerId + '/' + probe.modelId]: r}))} />
    </section>;
  }

  /** sec = 左栏的能力项（asr / tts / llm / image / sep / vision） */
  function CapabilitySection({sec}) {
    const n = NV().byKey(sec);
    const cap = n.cap || null, cat = n.local || null;
    return <div className="capage" data-screen-label={`${n.label}设置`}>
      {cap ? <section className="setpage__group" aria-label="默认与参数">
        <div className="setpage__card"><DefaultPicker cap={cap} cat={cat} /><Params cap={cap} /></div>
      </section> : null}
      {cat ? <section className="setpage__group" aria-label="本机模型">
        {cap ? <h2>本机模型</h2> : null}
        <window.LocalModelsSection tab={cat} hideDefault={!!cap} />
      </section> : null}
      {cap ? <ProviderModels cap={cap} /> : null}
    </div>;
  }

  Object.assign(window, {CapabilitySection});
})();
