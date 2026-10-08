/* 设置 › 模型 › API 提供方（product-design §7.6）：一行一家 API 提供方，已连接的排前，底部「添加 API 提供方」；
   选一行进入它的详情（settings-provider-detail.jsx，路由 settings/<id>?sec=providers）。
   添加 API 提供方：顶部搜索，分模型厂商、中转平台、自建端点（OpenAI 兼容）三组；选一张卡进入它的详情并直接展开「添加账号」。
   目录里没有的提供方走自建端点：模型厂商网格末尾有一张「自建端点 · OpenAI 兼容」卡（搜 openai / 兼容 / 自建 / custom 也命中），
   点了滚到下面的表单并聚焦名称；能力页 ④ 末尾那行带 from=custom 进来时直接打开 sheet 并聚焦同一个输入。
   一把密钥对这家的全部能力生效；智能体登录（Codex、Claude）在「Agent」里，不是 API 提供方。数据都是演示，不发请求。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = () => window.BC_VENDORS;
  const C = () => window.BC_CLOUD_TTS;
  const IM = () => window.BC_CLOUD_IMAGE;
  const TONE_DOT = {ok: 'is-ok', warn: 'is-warn', missing: 'is-off', off: 'is-off'};

  /* 进入某家详情；add = 直接展开「添加账号」 */
  const detailRoute = (id, add) => Object.assign({r: 'settings', sec: 'providers', id}, add ? {from: 'add'} : {});

  function ProviderRow({row, onOpen}) {
    const v = row.vendor;
    return <window.BCAction className="prov-row" onClick={onOpen} aria-label={`${v.name} · ${row.state.label}`}>
      <window.VendorIcon id={row.id} name={v.name} />
      <span className="prov-row__nm">
        <b>{v.name}{v.kind === 'relay' ? <span className="prov-row__tag">中转</span> : v.kind === 'custom' ? <span className="prov-row__tag">自建</span> : null}</b>
        <span>{row.sub}</span>
      </span>
      <span className={cx('prov-row__acct t-detail', row.single && 't-mono')}>{row.summary === row.state.label ? '' : row.summary}</span>
      <span className={cx('prov-dot', TONE_DOT[row.state.k])} aria-hidden="true" />
      <span className="prov-row__st t-detail">{row.state.label}</span>
      <Ic n="chevright" className="ic--14 prov-row__chev" />
    </window.BCAction>;
  }

  /* 添加 API 提供方：搜索 + 三组。自建端点填名称、地址、协议、第一个模型 id 与它的能力；地址撞上已有的一家时提示添加到那一家 */
  /* focusCustom：打开时直接滚到自建端点并聚焦名称（能力页「添加 OpenAI 兼容端点」来的） */
  function AddProviderSheet({open, focusCustom, onClose}) {
    const app = useApp();
    const [q, setQ] = useState('');
    const [draft, setDraft] = useState({name: '', base: '', model: '', caps: ['text']});
    const nameRef = useRef(null);
    const set = (p) => setDraft((d) => Object.assign({}, d, p));
    const toCustom = () => {
      const el = nameRef.current;
      if (!el) return;
      const sec = el.closest('.prov-custom');
      (sec || el).scrollIntoView({block: 'start', behavior: 'smooth'});
      el.focus({preventScroll: true});
    };
    /* 对话框的内容在打开后一帧才挂上，等一帧再聚焦 */
    useEffect(() => {
      if (!open || !focusCustom) return undefined;
      let n = 0, raf = 0;
      const tick = () => { if (nameRef.current || n > 30) toCustom(); else { n += 1; raf = requestAnimationFrame(tick); } };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }, [open, focusCustom]);
    if (!open) return null;
    const settings = app.providerSettings;
    const cat = V().catalog(q, settings);
    const pick = (v) => {
      if (!settings[v.id]) app.patchProvider(v.id, {enabled: true});
      onClose();
      app.go(detailRoute(v.id, true));
    };
    const taken = V().findByBase(draft.base, settings);
    const okCustom = draft.name.trim() && V().validBase(draft.base) && draft.model.trim() && draft.caps.length && !taken;
    const addCustom = () => {
      const id = V().customId(draft.name, settings);
      const models = {};
      draft.caps.forEach((c) => { models[c] = [draft.model.trim()]; });
      const base = draft.base.trim();
      app.patchProvider(id, {enabled: true, custom: {name: draft.name.trim(), base, caps: draft.caps.slice()}, models});
      /* 合成与生图的工具页 / 面板读各自的表：自建端点的这两类模型登记过去（OpenAI 兼容形状） */
      if (draft.caps.includes('tts')) app.setCloudCustom((list) => [...list.filter((x) => x.id !== id), C().customProvider({id, name: draft.name.trim(), url: base, models: [draft.model.trim()], voices: ''})]);
      if (draft.caps.includes('image')) IM().customProvider({id, name: draft.name.trim(), url: base, models: [draft.model.trim()]});
      setDraft({name: '', base: '', model: '', caps: ['text']});
      onClose();
      app.go(detailRoute(id, true));
    };
    const card = (r) => <window.BCAction key={r.vendor.id} className="prov-card" onClick={() => pick(r.vendor)}>
      <window.VendorIcon id={r.vendor.id} name={r.vendor.name} />
      <span className="prov-card__nm"><b>{r.vendor.name}</b><span>{r.caps.map((c) => V().CAP_SHORT[c]).join(' / ')}{r.vendor.regions ? ' · 国际 / 中国' : ''}</span></span>
      {r.added ? <Chip tone="neutral">已添加</Chip> : null}
    </window.BCAction>;
    const customCard = <window.BCAction key="custom" className="prov-card prov-card--custom" onClick={toCustom}
      aria-label="自建端点 · OpenAI 兼容：填写名称与地址">
      <span className="prov-card__plus" aria-hidden="true"><Ic n="plus" className="ic--16" /></span>
      <span className="prov-card__nm"><b>自建端点</b><span>OpenAI 兼容 · 本机、网关或不在列表里的提供方</span></span>
    </window.BCAction>;
    const showVendors = cat.vendors.length || cat.custom;
    return <Dialog open title="添加 API 提供方" width={760} onClose={onClose}
      footer={<Btn variant="secondary" onClick={onClose}>关闭</Btn>}>
      <div className="prov-sheet">
        <Field icon="search" aria-label="搜索 API 提供方" placeholder="搜索提供方或能力" value={q} onChange={(e) => setQ(e.target.value)} />
        {showVendors ? <section aria-label="模型厂商"><h3 className="prov-sheet__h">模型厂商</h3>
          <div className="prov-grid">{cat.vendors.map(card)}{cat.custom ? customCard : null}</div></section> : null}
        {cat.relays.length ? <section aria-label="中转平台"><h3 className="prov-sheet__h">中转平台</h3>
          <p className="t-detail-xs prov-sheet__note">一把密钥调用多家的模型，按中转平台的价格计费。</p>
          <div className="prov-grid">{cat.relays.map(card)}</div></section> : null}
        {!cat.vendors.length && !cat.relays.length && !cat.custom ? <p className="t-detail">没有找到「{q.trim()}」。可以在下面把它添加为自建端点。</p> : null}
        <section aria-label="自建端点" className="prov-custom">
          <h3 className="prov-sheet__h">自建端点（OpenAI 兼容）</h3>
          <p className="t-detail-xs prov-sheet__note">本机或局域网里的服务、公司网关等。需支持 OpenAI 兼容的接口。</p>
          <div className="prov-custom__grid">
            <Field inputRef={nameRef} aria-label="名称" placeholder="名称，例如 本机 vLLM" value={draft.name} onChange={(e) => set({name: e.target.value})} />
            <Field aria-label="地址" placeholder="https://api.example.com/v1" value={draft.base} onChange={(e) => set({base: e.target.value})} />
            <Field aria-label="协议" value="协议 · OpenAI 兼容" readOnly />
            <Field aria-label="第一个模型 id" placeholder="第一个模型 id" value={draft.model} onChange={(e) => set({model: e.target.value})} />
          </div>
          <div className="prov-custom__caps" role="group" aria-label="这个模型的能力">
            {V().CAPS.map((c) => <Checkbox key={c} label={V().CAP_LABEL[c]} on={draft.caps.includes(c)}
              onChange={(x) => set({caps: x ? [...draft.caps, c] : draft.caps.filter((y) => y !== c)})} />)}
          </div>
          {taken ? <div className="prov-taken">
            <p className="t-detail">这个地址已经添加为「{taken.name}」。在它下面添加模型，就能沿用同一个账号。</p>
            <Btn size="s" variant="secondary" onClick={() => { onClose(); app.go(detailRoute(taken.id)); }}>添加到「{taken.name}」</Btn>
          </div> : null}
          {draft.base.trim() && !V().validBase(draft.base) ? <p className="t-detail t-negative">地址要以 http:// 或 https:// 开头。</p> : null}
          <div><Btn variant="accent" size="s" disabled={!okCustom} onClick={addCustom}>添加自建端点</Btn></div>
        </section>
      </div>
    </Dialog>;
  }

  function ProviderList({adding, setAdding, focusCustom}) {
    const app = useApp();
    const rows = V().list(app.providerSettings, app.providerAccounts, Date.now());
    return <div className="prov-page" data-screen-label="API 提供方">
      <header className="setpage__intro">
        <h1>API 提供方</h1>
        <p>一把密钥对这家提供方的全部能力生效：给 OpenAI 加一次，文本生成、语音识别、语音合成与图像生成都能用。智能体登录（Codex、Claude）在「Agent」里。</p>
      </header>
      {rows.length ? <Card layer className="prov-list" role="list" aria-label="已添加的 API 提供方">
        {rows.map((r) => <div role="listitem" key={r.id}><ProviderRow row={r} onOpen={() => app.go(detailRoute(r.id))} /></div>)}
      </Card> : <p className="t-detail">还没有添加 API 提供方。添加一家并填一把密钥，各能力页就能选它的模型。</p>}
      <div className="prov-foot">
        <Btn variant="secondary" size="s" icon="plus" onClick={() => setAdding(true)}>添加 API 提供方</Btn>
        <span className="t-detail-xs">交互演示 · 不保存真实密钥、不发送请求。</span>
      </div>
      <AddProviderSheet open={adding} focusCustom={focusCustom} onClose={() => setAdding(false)} />
    </div>;
  }

  /* id 有值进详情；from=add 表示从添加 API 提供方来，详情直接展开「添加账号」；在列表页 from=add 打开添加 API 提供方，
     from=custom 打开它并聚焦自建端点（OpenAI 兼容）的名称 */
  function ProvidersSection({id, from}) {
    const app = useApp();
    const wantSheet = !id && (from === 'add' || from === 'custom');
    const [adding, setAdding] = useState(wantSheet);
    /* 已经停在列表页时再从能力页点进来：组件不重挂，按 from 再打开一次 */
    useEffect(() => { if (wantSheet) setAdding(true); }, [id, from]);
    if (id && app.providerSettings[id]) return <window.ProviderDetail id={id} addOpen={from === 'add'} key={id} />;
    if (id) return <div className="prov-page"><header className="setpage__intro"><h1>API 提供方</h1><p>这家提供方已经移除，或者还没有添加。</p></header>
      <Btn variant="secondary" size="s" icon="chevleft" onClick={() => app.replace({r: 'settings', sec: 'providers'})}>回到 API 提供方</Btn></div>;
    return <ProviderList adding={adding} setAdding={setAdding} focusCustom={from === 'custom'} />;
  }

  Object.assign(window, {ProvidersSection, providerDetailRoute: detailRoute});
})();
