/* API 提供方详情（product-design §7.6）：页头（图标、名称、官网、启用开关、地区）、账号、能力与模型、用量，底部移除 API 提供方。
   账号有先后：调用总是用第一个启用且有密钥的账号，出错时不自动换下一个，先后由「设为首选」调整。
   「验证并保存」先向这家提供方验证一次，不通过不保存并用一句话说明原因（结果由演示分段决定）。密钥只存掩码，任何地方都不回显。
   端点按账号存（架构设计 §6.8 的 accounts[].endpoint）：添加账号时在折叠的「端点（高级）」里填，账号行的编辑态可改；
   空着用默认（所选地区的基址，没有地区就是这家的基址）。没有提供方级的端点设置。
   目录里有、BaoCut 还没接入的能力（架构设计 §6.4 标 P1）列出并标「尚未接入」，不能测试、不能设为默认。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = () => window.BC_VENDORS;
  const U = () => window.BC_USAGE;
  const C = () => window.BC_CLOUD_TTS;
  const Row = () => window.ShellRow;
  const VERIFY_FAIL = {
    auth: '密钥无效：这家提供方返回 401。检查是否复制完整，或者换一把。',
    timeout: '连不上这家提供方：请求超时。检查网络或端点地址后再试。',
  };
  /* 这家这个能力的默认值是不是这只模型（文本 'p/m'，其余 'cloud:p/m'） */
  const isDefault = (app, cap, pid, mid) => (cap === 'text' ? app.cloudLlmDefault === `${pid}/${mid}`
    : cap === 'transcribe' ? app.cloudAsrDefault === `cloud:${pid}/${mid}`
    : cap === 'tts' ? app.cloudTtsDefault === `cloud:${pid}/${mid}` : app.cloudImageDefault === `cloud:${pid}/${mid}`);
  const ago = (iso, now) => {
    if (!iso) return '';
    const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
    return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 60 * 24 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`;
  };

  /* ---------- 账号 ---------- */
  /* 端点地址的校验文案：空着合法（用默认），填了要像个 http(s) 地址 */
  const badEndpoint = (x) => !!String(x || '').trim() && !V().validBase(x);
  const BAD_ENDPOINT = '地址要以 http:// 或 https:// 开头。';

  /* defaultBase：这个账号不填端点时用的地址（编辑态的占位符） */
  function AccountRow({a, i, primary, region, defaultBase, onPatch, onPrimary, onRemove}) {
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState(a.label || '');
    const [ep, setEp] = useState(a.endpoint || '');
    const st = V().statusOf(a, Date.now());
    const open = () => { setName(a.label || ''); setEp(a.endpoint || ''); setEditing(true); };
    const save = () => {
      if (badEndpoint(ep)) return;
      onPatch({label: name.trim() || null, endpoint: ep.trim() || undefined});
      setEditing(false);
    };
    const keys = (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); };
    return <div className={cx('acct', a.enabled === false && 'is-off', editing && 'is-editing')} role="listitem">
      <Switch on={a.enabled !== false} ariaLabel={`启用账号 ${V().accountName(a)}`} onChange={(x) => onPatch({enabled: x})} />
      <span className="acct__nm">
        {editing ? <span className="acct__edit" role="group" aria-label={`编辑账号 ${V().accountName(a)}`}>
          <Field size="s" autoFocus aria-label="账号名称" placeholder={a.masked ? `名称（可选），不填显示 ${a.masked}` : '名称（可选）'} value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={keys} />
          <Field size="s" aria-label="端点地址" placeholder={defaultBase} value={ep} invalid={badEndpoint(ep)}
            onChange={(e) => setEp(e.target.value)} onKeyDown={keys} />
          {badEndpoint(ep) ? <span className="t-detail-xs t-negative">{BAD_ENDPOINT}</span>
            : <span className="t-detail-xs">端点空着用默认地址。改成你的代理或网关时，这把密钥会发给这个地址。</span>}
          <span className="row gap8">
            <Btn size="s" variant="accent" disabled={badEndpoint(ep)} onClick={save}>保存</Btn>
            <Btn size="s" variant="secondary" onClick={() => setEditing(false)}>取消</Btn>
          </span>
        </span>
          : <window.BCAction className="acct__name" onClick={open} aria-label={`编辑 ${V().accountName(a)}`}>
            <b>{V().accountName(a)}</b><Ic n="edit" className="ic--14" /></window.BCAction>}
        <span className="t-detail-xs">
          {a.label ? <span className="t-mono">{a.masked}</span> : null}
          {a.label ? ' · ' : ''}{a.lastUsedAt ? `上次使用 ${ago(a.lastUsedAt, Date.now())}` : '还没用过'}
          {region && a.region ? ` · ${a.region === 'cn' ? '中国' : '国际'}` : ''}
          {a.endpoint ? <>{' · '}<span className="t-mono" title={a.endpoint}>{V().hostOf(a.endpoint)}</span></> : null}
          {a.status && a.status.detail && st.tone !== 'positive' ? ` · ${a.status.detail}` : ''}
        </span>
      </span>
      {primary ? <Chip tone="accent">首选</Chip> : null}
      <Chip tone={st.tone}>{st.label}</Chip>
      {!primary && i > 0 ? <Btn size="s" variant="quiet" onClick={onPrimary}>设为首选</Btn> : null}
      <IconBtn icon="trash" size="s" tip="移除账号" onClick={onRemove} />
    </div>;
  }

  /* 字段顺序：名称、密钥、[地区]、折叠的「端点（高级）」。baseFor(region) = 这个地区不填端点时用的地址，做端点的占位符 */
  function AddAccountForm({vendor, settings, baseFor, onCancel, onSaved}) {
    const [label, setLabel] = useState('');
    const [key, setKey] = useState('');
    const [region, setRegion] = useState((settings && settings.region) || 'global');
    const [endpoint, setEndpoint] = useState('');
    const [scenario, setScenario] = useState('ok');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const bad = badEndpoint(endpoint);
    const verify = () => {
      setBusy(true); setErr('');
      timer.current = setTimeout(() => {
        setBusy(false);
        if (scenario !== 'ok') { setErr(VERIFY_FAIL[scenario]); return; }
        onSaved({label, key, region: vendor.regions ? region : undefined, endpoint: endpoint.trim() || undefined});
        setKey(''); setLabel(''); setEndpoint('');
      }, 900);
    };
    return <div className="acct-add" role="group" aria-label="添加账号">
      <div className="acct-add__grid">
        <Field aria-label="名称（可选）" placeholder="名称（可选），例如 团队" value={label} onChange={(e) => setLabel(e.target.value)} />
        <Field aria-label="密钥" type="password" placeholder="粘贴密钥" value={key} onChange={(e) => { setKey(e.target.value); setErr(''); }} />
      </div>
      {vendor.regions ? <div className="row gap8"><span className="t-detail grow">地区 · 国际站与中国站的密钥不通用</span>
        <Segmented size="s" value={region} onChange={setRegion} items={vendor.regions.map((r) => ({k: r.k, label: r.label}))} /></div> : null}
      <BCDisclosure title="端点（高级）" className="acct-add__ep">
        <div className="acct-add__eprow">
          <Field aria-label="端点地址" placeholder={baseFor(vendor.regions ? region : undefined)} value={endpoint} invalid={bad}
            onChange={(e) => { setEndpoint(e.target.value); setErr(''); }} />
          {bad ? <p className="t-detail-xs t-negative">{BAD_ENDPOINT}</p>
            : <p className="t-detail-xs">空着用默认地址。改成你的代理或网关时，这把密钥会发给这个地址；只对这个账号生效。</p>}
        </div>
      </BCDisclosure>
      {err ? <p className="t-detail t-negative" role="alert">{err}</p> : null}
      <p className="t-detail-xs">演示字段，请勿输入真实密钥。保存后只显示掩码，任何地方都不再显示原文。</p>
      <div className="row gap8">
        <Btn variant="accent" size="s" disabled={!key.trim() || bad || busy} onClick={verify}>{busy ? '正在验证…' : '验证并保存'}</Btn>
        <Btn variant="secondary" size="s" disabled={busy} onClick={onCancel}>取消</Btn>
        <span className="grow" />
        <span className="t-detail-xs">原型验证结果</span>
        <Segmented size="s" value={scenario} onChange={(x) => !busy && setScenario(x)}
          items={[{k: 'ok', label: '通过'}, {k: 'auth', label: '密钥无效'}, {k: 'timeout', label: '超时'}]} />
      </div>
    </div>;
  }

  /* ---------- 能力与模型 ---------- */
  function CapModels({id, vendor, connected}) {
    const app = useApp();
    const settings = app.providerSettings;
    const s = settings[id] || {};
    const [results, setResults] = useState({});
    const [probe, setProbe] = useState(null);
    const [adding, setAdding] = useState(null);   // {cap, id}
    const [refreshing, setRefreshing] = useState(null);
    const [checked, setChecked] = useState({});
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const refresh = (cap) => {
      setRefreshing(cap);
      timer.current = setTimeout(() => { setRefreshing(null); setChecked((x) => ({...x, [cap]: Date.now()})); }, 900);
    };
    const addModel = () => {
      const mid = adding.id.trim();
      const models = Object.assign({}, s.models || {});
      models[adding.cap] = [...(models[adding.cap] || []), mid];
      app.patchProvider(id, {models});
      if (vendor.kind === 'custom' && adding.cap === 'tts') app.setCloudCustom((list) => [...list.filter((x) => x.id !== id), C().customProvider({id, name: vendor.name, url: vendor.base, models: V().modelsOf(id, 'tts', settings).map((m) => m.id).concat(mid), voices: ''})]);
      if (vendor.kind === 'custom' && adding.cap === 'image') window.BC_CLOUD_IMAGE.customProvider({id, name: vendor.name, url: vendor.base, models: V().modelsOf(id, 'image', settings).map((m) => m.id).concat(mid)});
      setAdding(null);
    };
    const caps = V().capsOf(vendor);
    return <section className="setpage__group" aria-label="能力与模型">
      <h2>能力与模型</h2>
      <div className="setpage__card pdet-caps">
        {caps.map((cap) => {
          const p1 = V().isP1(id, cap, settings);
          const list = V().modelsOf(id, cap, settings);
          return <div className="pdet-cap" key={cap}>
            <div className="pdet-cap__head">
              <b>{V().CAP_LABEL[cap]}</b>
              {p1 ? <Chip tone="neutral">尚未接入</Chip> : null}
              <span className="t-detail-xs grow">{p1 ? 'BaoCut 还没接入这家的这项能力：先列出来，不能测试，也不能设为默认。'
                : refreshing === cap ? '正在刷新列表…' : checked[cap] ? `${list.length} 个模型 · 刚刚刷新` : `${list.length} 个模型`}</span>
              {!p1 && cap === 'text' ? <IconBtn icon="refresh" size="s" tip={connected ? '刷新列表' : '先添加账号'} disabled={!connected || !!refreshing} onClick={() => refresh(cap)} /> : null}
              {!p1 ? <IconBtn icon="plus" size="s" tip="添加模型 id" onClick={() => setAdding({cap, id: ''})} /> : null}
            </div>
            {list.map((m) => {
              const key = cap + '/' + m.id;
              const r = results[key];
              return <div className={cx('pdet-model', p1 && 'is-p1')} key={m.id}>
                <span className="pdet-model__nm"><b>{m.id}</b>{m.desc ? <span>{m.desc}</span> : null}</span>
                {r ? <span className={cx('pdet-model__verdict', r.state === 'error' && 't-negative')}>{window.probeVerdict(r)}</span> : null}
                {m.prev ? <Chip tone="neutral">上一代</Chip> : null}
                {m.added ? <Chip tone="neutral">手动添加</Chip> : null}
                {!p1 && isDefault(app, cap, id, m.id) ? <Chip tone="accent">默认</Chip> : null}
                {!p1 ? <Btn size="s" variant="quiet" disabled={!connected}
                  onClick={() => setProbe({providerId: id, providerName: vendor.name, modelId: m.id, cap})}>测试…</Btn> : null}
              </div>;
            })}
            {adding && adding.cap === cap ? <div className="pdet-model pdet-model--add">
              <Field size="s" autoFocus aria-label="模型 id" placeholder="模型 id" value={adding.id} onChange={(e) => setAdding({cap, id: e.target.value})} />
              <Btn size="s" variant="accent" disabled={!adding.id.trim() || list.some((m) => m.id === adding.id.trim())} onClick={addModel}>添加</Btn>
              <Btn size="s" variant="quiet" onClick={() => setAdding(null)}>取消</Btn>
            </div> : null}
          </div>;
        })}
        {!connected ? <p className="t-detail-xs pdet-caps__note">添加一个账号后可以测试这些模型。</p> : null}
      </div>
      <window.ModelProbeDialog probe={probe} onClose={() => setProbe(null)} onDone={(r) => setResults((x) => ({...x, [probe.cap + '/' + probe.modelId]: r}))} />
    </section>;
  }

  /* ---------- 用量卡 ---------- */
  function UsageCard({id, vendor}) {
    const app = useApp();
    const [bal, setBal] = useState(null);
    const now = Date.now();
    const recs = window.usageDemo();
    const month = U().report(recs, 'month', {now, providerId: id});
    const today = U().report(recs, 'today', {now, providerId: id});
    const cell = (label, r) => {
      const t = r.totals, money = U().fmtMoneyMap(t.cost.estimated);
      return <div className="pdet-use__cell">
        <span className="t-detail-xs">{label}</span>
        <b>{t.calls} 次调用</b>
        <span className="t-detail-xs">{[money ? `≈ ${money} · 按标价估算` : '', t.cost.reported ? `提供方报告 ${U().fmtMoneyMap(t.cost.reported)}` : '',
          t.cost.unknownCalls ? `${t.cost.unknownCalls} 次费用未知` : '', t.failed ? `${t.failed} 次失败` : ''].filter(Boolean).join(' · ') || '没有花费'}</span>
      </div>;
    };
    const canBalance = vendor.balance && V().BALANCE_DEMO[id];
    return <section className="setpage__group" aria-label="用量">
      <h2>用量</h2>
      <div className="setpage__card pdet-use">
        <div className="pdet-use__row">{cell('本月', month)}{cell('今天', today)}</div>
        <div className="row gap8 pdet-use__foot">
          <Btn size="s" variant="secondary" onClick={() => app.go({r: 'settings', sec: 'usage', id})}>查看用量</Btn>
          {canBalance ? <Btn size="s" variant="quiet" onClick={() => setBal(V().BALANCE_DEMO[id])}>查余额</Btn> : null}
          {bal ? <span className="t-detail">余额 {U().fmtMoney(bal.amount, bal.currency)} · 刚刚查询 · 演示</span> : null}
        </div>
      </div>
    </section>;
  }

  /* ---------- 详情 ---------- */
  function ProviderDetail({id, addOpen}) {
    const app = useApp();
    const settings = app.providerSettings;
    const s = settings[id] || {};
    const vendor = V().resolve(id, settings);
    const accounts = app.providerAccounts[id] || [];
    const primary = V().primaryAccount(accounts);
    const connected = V().connected(id, settings, app.providerAccounts);
    const [adding, setAdding] = useState(!!addOpen || !accounts.length);
    const setAcc = (fn) => app.setAccounts(id, fn);
    const removeAccount = (a) => app.confirm({
      title: `移除账号「${V().accountName(a)}」？`,
      body: `这把密钥会从这台电脑上删除。${accounts.length === 1 ? `这是 ${vendor.name} 唯一的账号：移除后这家提供方还在，只是没有可用的密钥，用到它的模型会不可用。` : '调用改用剩下的账号里排在最前、启用着的那一个。'}`,
      tone: 'negative', confirmLabel: '移除账号',
      run: () => { setAcc((list) => list.filter((x) => x.accountId !== a.accountId)); app.toast(`已移除账号「${V().accountName(a)}」`, 'positive'); },
    });
    const removeProvider = () => app.confirm({
      title: `移除 API 提供方「${vendor.name}」？`,
      body: `它的 ${accounts.length} 个账号（密钥）会一并从这台电脑上删除。指向它的默认模型会变成不可用、需要另选；「我的声音」在这家的克隆会标成无法同步。用量记录保留。`,
      tone: 'negative', confirmLabel: '移除 API 提供方',
      run: () => {
        app.setVoices((list) => list.map((v) => (v.cloud && v.cloud[id] ? {...v, cloud: C().bindAfter(v, id, 'orphan')} : v)));
        app.patchProvider(id, null);
        app.replace({r: 'settings', sec: 'providers'});
        app.toast(`已移除「${vendor.name}」`, 'positive');
      },
    });
    const R = Row();
    return <div className="prov-page pdet" data-screen-label={`API 提供方 · ${vendor.name}`}>
      <window.BCAction className="pdet__back" onClick={() => app.go({r: 'settings', sec: 'providers'})}><Ic n="chevleft" className="ic--14" />API 提供方</window.BCAction>
      <header className="pdet__head">
        <window.VendorIcon id={id} name={vendor.name} size={32} />
        <span className="pdet__title">
          <h1>{vendor.name}</h1>
          <span className="t-detail">{vendor.site ? <a href={vendor.site} target="_blank" rel="noreferrer">{V().hostOf(vendor.site)}</a> : <span className="t-mono">{V().hostOf(vendor.base)}</span>}
            {' · '}{V().capsOf(vendor).map((c) => V().CAP_SHORT[c]).join(' / ')}{vendor.kind === 'relay' ? ' · 中转平台' : vendor.kind === 'custom' ? ' · 自建端点 · OpenAI 兼容' : ''}</span>
        </span>
        <Switch on={s.enabled !== false} ariaLabel={`启用 ${vendor.name}`} onChange={(x) => app.patchProvider(id, {enabled: x})} />
      </header>
      {s.enabled === false ? <p className="t-detail pdet__off">已停用：这家的模型在各能力页里不可选，账号与设置都保留。</p> : null}
      {vendor.regions ? <div className="setpage__card pdet-region"><R label="地区" desc="国际站与中国站是两套服务，密钥不通用。切换后各模型要重新测试。">
        <Segmented size="s" value={s.region || 'global'} onChange={(x) => app.patchProvider(id, {region: x})} items={vendor.regions.map((r) => ({k: r.k, label: r.label}))} />
      </R></div> : null}

      <section className="setpage__group" aria-label="账号">
        <h2>账号</h2>
        <div className="setpage__card pdet-accts">
          {accounts.length ? <div role="list" aria-label={`${vendor.name} 的账号`}>
            {accounts.map((a, i) => <AccountRow key={a.accountId} a={a} i={i} primary={primary && primary.accountId === a.accountId} region={!!vendor.regions}
              defaultBase={V().accountBase(id, Object.assign({}, a, {endpoint: ''}), settings)}
              onPatch={(p) => setAcc((list) => list.map((x) => (x.accountId === a.accountId ? Object.assign({}, x, p) : x)))}
              onPrimary={() => setAcc((list) => V().makePrimary(list, a.accountId))}
              onRemove={() => removeAccount(a)} />)}
          </div> : <p className="t-detail pdet-accts__empty">还没有账号。添加一把密钥，这家的能力就都能用。</p>}
          {accounts.length > 1 ? <p className="t-detail-xs pdet-accts__note">调用总是用排在最前、启用着的账号；它出错时不会自动换下一个。用「设为首选」调整先后。</p> : null}
          {adding ? <AddAccountForm vendor={vendor} settings={s} baseFor={(r) => V().accountBase(id, {region: r}, settings)} onCancel={() => setAdding(false)}
            onSaved={(o) => {
              setAcc((list) => [...list, V().makeAccount(o, list, Date.now())]);
              if (o.region && !accounts.length) app.patchProvider(id, {region: o.region});
              setAdding(false);
              app.toast(`已验证并保存账号${o.label.trim() ? `「${o.label.trim()}」` : ''}`, 'positive');
            }} />
            : <div className="pdet-accts__add"><Btn size="s" variant="secondary" icon="plus" onClick={() => setAdding(true)}>添加账号</Btn></div>}
        </div>
      </section>

      <CapModels id={id} vendor={vendor} connected={connected} />

      <UsageCard id={id} vendor={vendor} />

      <div className="pdet__remove"><Btn size="s" variant="negative" icon="trash" onClick={removeProvider}>移除 API 提供方</Btn></div>
    </div>;
  }

  Object.assign(window, {ProviderDetail});
})();
