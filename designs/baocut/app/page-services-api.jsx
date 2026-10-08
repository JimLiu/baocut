/* Web 服务 › OpenAI 兼容 API —— §17.6（2026-09-27 第二版，设计稿 docs/design/cli/bcut-serve-openai-api-design.md）。
   两块：Web 服务页里的 `ApiSection`（开关 + key、地址、端点：模型组 + 一类能力一块、模型映射 `ApiModelMap`），
   与端点详情页 `ApiEndpointPage`（路由 `{r:'services', id:'web', tab:'asr.transcriptions'}`：参数说明 + 试一试）。
   路径与 OpenAI 相同；参数表按内核实际收的字段手写在 `BC_OPENAI_API.ENDPOINTS`，说明、表单、代码片段都从它生成。
   原型不监听端口：「发送请求」按表单值算一份演示响应（`demoResponse`），状态码与响应形状照设计稿。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const SV = window.BC_SERVICES;
  const A = window.BC_OPENAI_API;
  const Row = window.ShellRow;

  /* 原型里的 API key 是示例、不持久化（刷新 = 重启 App）；设置页与详情页共用这一份。 */
  const DEMO_KEY = 'bcs_3kQ9vX2mT7aLr8cN5pYw1dHs6uJe0bGf4zRi';
  const keyBox = {key: DEMO_KEY, subs: new Set()};
  function useApiKey() {
    const [key, setKey] = useState(keyBox.key);
    useEffect(() => { keyBox.subs.add(setKey); return () => keyBox.subs.delete(setKey); }, []);
    const regenerate = () => {
      keyBox.key = DEMO_KEY.slice(0, -8) + Math.random().toString(36).slice(2, 10);
      keyBox.subs.forEach((f) => f(keyBox.key));
    };
    return [key, regenerate];
  }
  const useCopy = () => {
    const app = useApp();
    return async (text, label) => {
      try { await navigator.clipboard.writeText(text); app.toast(label + '已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中文字后复制'); }
    };
  };

  /** 三类的模型现场（全部 / 已下载 / 默认 / 生效的映射），读 设置 › 本地模型 的安装态与默认值。 */
  function useApiCtx() {
    const app = useApp();
    const api = app.prefs.api || {};
    const ctx = A.ctxOf(D.setModels, app.modelInstalled, app.prefs.localModelDefaults, api);
    const capOn = (cap) => !cap || !(api.caps && api.caps[cap] === false);
    return {app, api, ctx, capOn};
  }
  const setApi = (app, patch) => app.setPref('api', {...(app.prefs.api || {}), ...patch});
  const GROUP_MODELS = {k: 'models', name: '模型', icon: 'layers', desc: '列出和查询能用的模型'};

  /* ================= Web 服务页里的一节 ================= */
  function ApiSection({live}) {
    const app = useApp();
    const copy = useCopy();
    const api = app.prefs.api || {};
    const [key, regenerate] = useApiKey();
    const base = A.apiBase(app.webPort);
    return (
      <>
        <div className="t-section svc__sec">OpenAI 兼容 API</div>
        <Card layer className="svc__panel svc__rows">
          <Row label="开放 API" desc="让支持 OpenAI 接口的工具用这台电脑上已下载的模型转录、合成语音和生成图片。只在本机可访问，数据不会离开这台电脑。">
            <Switch on={!!api.on} onChange={(v) => setApi(app, {on: v})} ariaLabel="开放 OpenAI 兼容 API" />
          </Row>
          {api.on ? (
            <Row label="需要 API key" desc="打开后，请求要带 Authorization: Bearer <key>。这台电脑上有你不信任的程序时打开。">
              <Switch on={!!api.requireKey} onChange={(v) => setApi(app, {requireKey: v})} ariaLabel="需要 API key" />
            </Row>
          ) : null}
          {api.on && api.requireKey ? (
            <div className="agm-token oai-key"><span>API key <code>{A.maskKey(key)}</code></span>
              <span className="row gap8">
                <Btn size="s" variant="quiet" icon="copy" onClick={() => copy(key, 'API key')}>复制 key</Btn>
                <Btn size="s" variant="quiet" icon="refresh" onClick={() => { regenerate(); app.toast('已换成新的 API key，旧的立刻失效', 'positive'); }}>换一把</Btn>
              </span>
            </div>
          ) : null}
        </Card>

        {api.on ? (
          <>
            <div className="t-section svc__sec">地址</div>
            <Card layer className="oai-addr">
              <div className="agset-code oai-base oai-base--main"><span className="oai-base__lbl">Base URL</span><code>{base}</code>
                <IconBtn icon="copy" size="s" tip="复制 Base URL" onClick={() => copy(base, 'Base URL')} /></div>
              <p className="t-detail oai-addr__lede">
                路径与 OpenAI 相同，只换主机和端口：把工具里的 Base URL 换成这个就行。<code>model</code> 写本机模型的 id，或下面「模型映射」里的名字。
                {api.requireKey ? '' : ' 没开 key 校验时，客户端的 key 一栏随便填。'}
                {live ? '' : ' 启动 Web 服务后才能访问，设置和说明现在就能看。'}
              </p>
            </Card>
            <div className="t-section svc__sec">端点</div>
            <p className="t-detail oai-lede">点一条端点看参数、直接试。每一类能单独关掉，也能再挂到一个独立端口上。</p>
            <Card layer className="oai-caps">
              <GroupBlock group={GROUP_MODELS} />
              {A.CAPS.map((c) => <CapBlock key={c.k} cap={c.k} />)}
            </Card>
            {window.ApiModelMap ? <window.ApiModelMap /> : null}
          </>
        ) : null}
      </>
    );
  }

  function EpRows({group}) {
    const app = useApp();
    return (
      <div className="oai-eps">
        {A.epsOf(group).map((e) => (
          <BCAction type="button" className="oai-ep" key={e.id} onClick={() => app.go({r: 'services', id: 'web', tab: e.id})}>
            <span className={cx('oai-method', e.method === 'GET' && 'is-get')}>{e.method}</span>
            <code className="oai-ep__path">/v1{e.path}</code>
            <span className="oai-ep__t">{e.title}</span>
            <NavChevron className="oai-ep__go" />
          </BCAction>
        ))}
      </div>
    );
  }

  /** 「模型」这一组：没有开关，总在。 */
  function GroupBlock({group}) {
    const {ctx} = useApiCtx();
    const n = A.listModels(ctx).length;
    return (
      <div className="oai-cap">
        <div className="row gap12">
          <span className="oai-cap__mark"><Ic n={group.icon} className="ic--16" /></span>
          <span className="grow oai-cap__txt">
            <b className="t-title-sm">{group.name}</b>
            <span className="t-detail">{n ? `现在能列出 ${n} 个名字 · 本机模型加映射名` : '还没有下载任何模型 · 列出来是空的'}</span>
          </span>
        </div>
        <EpRows group={group.k} />
      </div>
    );
  }

  /** 一类能力：头（图标、名字、模型数与默认、开关）、端点行、独立端口。 */
  function CapBlock({cap}) {
    const {app, api, ctx, capOn: isOn} = useApiCtx();
    const copy = useCopy();
    const c = A.capBy(cap);
    const ready = ctx.ready[cap];
    const def = ctx.dflt[cap];
    const capOn = isOn(cap);
    const port = (api.ports || {})[cap] || null;
    const [draft, setDraft] = useState(port ? String(port) : '');
    const [err, setErr] = useState('');
    const svcBusy = SV.stateOf(app.svcStates.web) !== 'off' && SV.stateOf(app.svcStates.web) !== 'error';
    const setPort = (p) => setApi(app, {ports: {...(api.ports || {}), [cap]: p}});
    const togglePort = (v) => {
      if (!v) { setPort(null); setErr(''); return; }
      const r = A.parseCapPort(String(A.suggestPort(cap, app.webPort)), cap, app.webPort, api.ports);
      setDraft(String(r.port || ''));
      if (r.port) setPort(r.port); else setErr(r.error);
    };
    const commit = () => {
      const r = A.parseCapPort(draft, cap, app.webPort, api.ports);
      if (r.error) { setErr(r.error); return; }
      setErr(''); setPort(r.port);
    };
    const sub = !ready.length ? `还没有下载${c.name}模型` : `${ready.length} 只已下载 · 默认 ${def.name}`;
    return (
      <div className={cx('oai-cap', !capOn && 'is-off')}>
        <div className="row gap12">
          <span className="oai-cap__mark"><Ic n={c.icon} className="ic--16" /></span>
          <span className="grow oai-cap__txt">
            <b className="t-title-sm">{c.name}</b>
            <span className="t-detail">{capOn ? sub : '已关闭 · 这一类的端点返回 404，/v1/models 里也不列'}</span>
          </span>
          <Switch on={capOn} onChange={(v) => setApi(app, {caps: {...(api.caps || {}), [cap]: v}})} ariaLabel={`提供${c.name}`} />
        </div>
        {capOn && !ready.length ? (
          <div className="svc__fix oai-cap__fix">
            <span className="t-detail grow">下载一只{c.name}模型后才能用；现在请求会得到 404。</span>
            <Btn size="s" variant="secondary" onClick={() => app.go({r: 'settings', sec: 'local', tab: c.cat})}>去下载</Btn>
          </div>
        ) : null}
        <EpRows group={cap} />
        {capOn ? (
          <div className="oai-cap__foot">
            <Checkbox on={!!port} disabled={svcBusy} onChange={togglePort} label="也在独立端口上提供" />
            {port ? (
              <span className="svc__port"><Field size="s" inputMode="numeric" aria-label={`${c.name}的独立端口`} value={draft} invalid={!!err}
                disabled={svcBusy} onChange={(e) => { setDraft(e.target.value); setErr(''); }}
                onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></span>
            ) : null}
            <span className="t-detail-xs grow">{err || (svcBusy ? '要改端口，请先停止服务。' : port ? '这个端口上只有这一类，/v1/models 也只列这一类。' : '给想把各类分开配的工具用：路径不变，只换端口。')}</span>
          </div>
        ) : null}
        {capOn && port ? (
          <div className="agset-code oai-base"><span className="oai-base__lbl">独立端口</span><code>{A.apiBase(port)}</code>
            <IconBtn icon="copy" size="s" tip="复制独立端口的 Base URL" onClick={() => copy(A.apiBase(port), 'Base URL')} /></div>
        ) : null}
      </div>
    );
  }

  /* ================= 端点详情页 ================= */
  function ApiEndpointPage({epId}) {
    const app = useApp();
    const copy = useCopy();
    const {api} = useApiCtx();
    const ep = A.epBy(epId);
    const c = ep.cap ? A.capBy(ep.cap) : GROUP_MODELS;
    const url = A.epUrl(A.apiBase(app.webPort), ep);
    const port = ep.cap ? (api.ports || {})[ep.cap] : null;
    const crumb = <Btn variant="quiet" size="s" icon="back" onClick={() => app.go({r: 'services', id: 'web'})}>Web 服务</Btn>;
    const live = ep.params.filter((p) => !p.ignored);
    const ignored = ep.params.filter((p) => p.ignored);
    const loc = ep.body || (live.some((p) => p.loc === 'path') ? '路径参数' : '');
    return (
      <window.Page wide crumb={crumb} title={ep.title} actions={<Chip>{c.name}</Chip>}>
        <div className="oai-url">
          <span className={cx('oai-method', ep.method === 'GET' && 'is-get')}>{ep.method}</span>
          <code className="grow">{url}</code>
          <IconBtn icon="copy" size="s" tip="复制地址" onClick={() => copy(url, '地址')} />
        </div>
        <p className="t-body-sm t-subdued oai-summary">{ep.summary}{port ? ` 也在独立端口 ${A.apiBase(port)} 上。` : ''}</p>
        <div className="oai-grid">
          <div className="oai-doc">
            <div className="row gap8 oai-doc__hd"><span className="t-section">参数</span>{loc ? <code className="oai-ctype">{loc}</code> : null}</div>
            {live.length ? (
              <div className="oai-params">{live.map((p) => <ParamDoc key={p.name} p={p} />)}</div>
            ) : <p className="t-detail oai-none">没有参数。</p>}
            {ignored.length ? (
              <div className="t-detail-xs oai-ignored">
                接受但忽略（写了不报错，好让 SDK 的默认请求照常能用）：
                {ignored.map((p) => <span key={p.name} className="oai-ign"><code>{p.name}</code>{p.note ? `（${p.note}）` : ''}</span>)}
              </div>
            ) : null}
            <div className="t-section oai-doc__hd">返回</div>
            <p className="t-detail oai-ret">{RETURNS[ep.resp]}</p>
            {ep.cap ? <p className="t-detail-xs oai-ret">响应头 <code>X-BaoCut-Model</code> 写着这次实际用的本机模型；用映射名请求时看它就知道落到了哪只。</p> : null}
            <div className="t-section oai-doc__hd">错误码</div>
            <div className="oai-errs">
              {ep.errors.map((code) => (
                <div className="oai-err" key={code}>
                  <code className="oai-err__st">{A.ERRORS[code][0]}</code><code className="oai-err__code">{code}</code>
                  <span className="t-detail-xs">{A.ERRORS[code][2]}</span>
                </div>
              ))}
            </div>
            <p className="t-detail-xs oai-ret">错误体与 OpenAI 同形：<code>{'{"error":{"message","type","param","code"}}'}</code>。</p>
            {ep.cap === 'image' ? <p className="t-detail-xs oai-ret">Qwen-Image-2.1 的权重只许非商业用途，响应里 <code>x_baocut.license</code> 写的是 non-commercial。</p> : null}
          </div>
          <TryIt ep={ep} key={ep.id} />
        </div>
      </window.Page>
    );
  }

  const RETURNS = {
    models: '{object:"list", data:[{id, object:"model", created, owned_by:"baocut", x_baocut}]}。本机模型的 x_baocut 是 {task, name, default}；映射名的是 {mapsTo:{asr:"…"}}，写着每一类落到哪只。',
    model: '一个 Model 对象，形状同上。',
    text: 'json 返回 {text}；verbose_json 返回 task、language、duration、text、segments，要了 word 时再带 words；text / srt / vtt 是纯文本。',
    audio: '音频字节，Content-Type 随 response_format（audio/mpeg、audio/wav…）。',
    image: '{created, data:[{b64_json}], output_format:"png", size, x_baocut:{model, seed, steps, elapsedMs, license}}。',
  };

  /** 收这个字段的模型（只列目录里的语音合成模型，按 TTS_SUPPORT）。 */
  const takersOf = (p) => D.setModels.filter((m) => m.cat === 'tts' && A.supports(p, m.id)).map((m) => m.name);

  function ParamDoc({p}) {
    const app = useApp();
    const type = {file: '文件', model: '字符串', voice: '字符串', text: '字符串', longtext: '字符串', enum: '字符串', multi: '数组', int: '数字'}[p.kind];
    const T = window.BC_TTS || {};
    return (
      <div className="oai-param">
        <div className="oai-param__hd">
          <code className="oai-param__nm">{p.name}</code>
          <span className="t-detail-xs">{p.kind === 'file' && p.loc === 'json' ? 'base64 字符串' : type}</span>
          {p.req ? <span className="oai-req">必填</span> : <span className="t-detail-xs">可选</span>}
          {p.ext ? <span className="oai-ext">BaoCut 扩展</span> : null}
        </div>
        <div className="t-detail oai-param__doc">{p.doc}</div>
        {p.values ? <div className="oai-vals">{p.values.map((v) => <code key={v} className={cx(v === p.dflt && 'is-dflt')}>{v}</code>)}{p.dflt !== undefined ? <span className="t-detail-xs">缺省 {String(p.dflt)}</span> : null}</div>
          : p.dflt !== undefined && p.kind !== 'longtext' ? <div className="oai-vals"><span className="t-detail-xs">缺省 {String(p.dflt)}</span></div> : null}
        {p.kind === 'voice' && T.PRESETS ? <div className="oai-vals"><span className="t-detail-xs">CustomVoice 的说话人</span>{T.PRESETS.map((x) => <code key={x.id}>{x.id}</code>)}</div> : null}
        {p.by && p.by !== 'voice' ? <div className="t-detail-xs oai-param__doc">收它的模型：{takersOf(p).join('、')}。</div> : null}
        {p.kind === 'model' ? (
          <div className="t-detail-xs oai-param__doc">名字到本机模型的对应关系在 Web 服务页的
            <BCAction type="button" className="oai-link" onClick={() => app.go({r: 'services', id: 'web'})}>模型映射</BCAction>里改。</div>
        ) : null}
      </div>
    );
  }

  /* ================= 试一试 ================= */
  const SAMPLE_FILES = [
    {name: 'interview-sample.m4a', size: '1.2 MB', dur: 42},
    {name: 'podcast-intro.mp3', size: '3.4 MB', dur: 128},
    {name: 'voice-ref.wav', size: '0.4 MB', dur: 6},
  ];

  function TryIt({ep}) {
    const {app, api, ctx, capOn} = useApiCtx();
    const copy = useCopy();
    const c = ep.cap ? A.capBy(ep.cap) : null;
    const [key] = useApiKey();
    const [values, setValues] = useState(() => A.initialValues(ep, ctx));
    const [more, setMore] = useState(false);
    const [run, setRun] = useState(null);       // {t0, ms, wait, steps?}
    const [resp, setResp] = useState(null);
    const [lang, setLang] = useState('curl');
    const [, setTick] = useState(0);
    const timer = useRef(null); // {to, iv}：浏览器里 setTimeout 返回数字，挂不了属性
    const stop = () => { if (timer.current) { clearTimeout(timer.current.to); clearInterval(timer.current.iv); timer.current = null; } };
    useEffect(() => stop, []);
    const set = (name, v) => setValues((o) => ({...o, [name]: v}));
    const svcOn = SV.stateOf(app.svcStates.web) === 'on';
    const block = A.blocker({cap: ep.cap, apiOn: !!api.on, capOn: capOn(ep.cap), svcOn});
    const base = A.apiBase(app.webPort);
    const usedKey = api.requireKey ? key : '';
    const groups = A.formGroups(ep);
    const mp = ep.params.find((p) => p.kind === 'model');
    const now = ep.cap ? A.resolveModel(values.model, ep.cap, ctx, !!(mp && mp.optionalModel)) : {};
    const modelNow = now.model || null;

    const unblock = () => {
      if (block.action === 'api') setApi(app, {on: true});
      else if (block.action === 'cap') setApi(app, {caps: {...(api.caps || {}), [ep.cap]: true}});
      else app.flipService('web', true);
    };
    const send = () => {
      const r = A.demoResponse(ep, values, ctx);
      const wait = Math.min(r.ms, ep.cap === 'image' ? 3200 : 1800);
      stop();
      const t0 = Date.now();
      setResp(null);
      setRun({t0, ms: r.ms, wait, steps: ep.cap === 'image' && r.status === 200 ? (Number(values.steps) || 20) : 0});
      const iv = setInterval(() => setTick((n) => n + 1), 100);
      const to = setTimeout(() => { clearInterval(iv); timer.current = null; setRun(null); setResp(r); }, wait);
      timer.current = {to, iv};
    };
    const cancel = () => {
      stop();
      setRun(null);
      app.toast('已取消 · 服务那头的任务一起停了');
    };
    const shown = A.snippet(lang, ep, base, values, usedKey ? A.maskKey(usedKey) : '');
    const real = A.snippet(lang, ep, base, values, usedKey);
    const elapsed = run ? Math.min(Date.now() - run.t0, run.wait) / run.wait : 0;
    const field = (p) => <FormField key={p.name} p={p} v={values[p.name]} set={set} ep={ep} ctx={ctx} modelNow={modelNow} />;

    return (
      <Card layer className="oai-try">
        <div className="row gap8"><b className="t-title-sm grow">试一试</b>
          {!block && api.requireKey ? <span className="t-detail-xs">会自动带上 API key</span> : null}</div>
        {block ? (
          <div className="svc__fix oai-block">
            <span className="t-detail grow">{block.text}</span>
            <Btn size="s" variant="accent" onClick={unblock}>{block.label}</Btn>
          </div>
        ) : c && !ctx.ready[ep.cap].length ? (
          <div className="svc__fix oai-block">
            <span className="t-detail grow">还没有下载{c.name}模型，发出去会得到 404。</span>
            <Btn size="s" variant="secondary" onClick={() => app.go({r: 'settings', sec: 'local', tab: c.cat})}>去下载</Btn>
          </div>
        ) : null}
        {groups.main.length ? <div className="oai-form">{groups.main.map(field)}</div> : null}
        {groups.more.length ? (
          <>
            <BCAction type="button" className="oai-more" onClick={() => setMore((x) => !x)}>
              <Ic n={more ? 'chevdown' : 'chevright'} className="ic--14" />更多参数（{groups.more.length}）
            </BCAction>
            {more ? <div className="oai-form">{groups.more.map(field)}</div> : null}
          </>
        ) : null}
        <div className="row gap8 oai-send">
          {run ? (
            <>
              <Btn variant="secondary" icon="stop" onClick={cancel}>取消</Btn>
              <span className="t-detail grow">{run.steps ? `正在画 · 第 ${Math.max(1, Math.ceil(elapsed * run.steps))} / ${run.steps} 步` : '正在等待响应…'} {A.fmtMs(Math.round(elapsed * run.ms))}</span>
            </>
          ) : (
            <>
              <Btn variant="accent" icon="play" disabled={!!block} onClick={send}>{resp ? '再发一次' : '发送请求'}</Btn>
              <Btn variant="quiet" onClick={() => { setValues(A.initialValues(ep, ctx)); setResp(null); }}>恢复缺省</Btn>
            </>
          )}
        </div>
        {run ? <Progress value={run.steps ? elapsed * 100 : undefined} indeterminate={!run.steps} thin className="oai-prog" /> : null}
        {resp ? <Response resp={resp} copy={copy} /> : null}
        <div className="oai-code">
          <div className="row gap8"><Segmented size="s" items={A.SNIPPETS} value={lang} onChange={setLang} />
            <span className="grow" /><Btn size="s" variant="quiet" icon="copy" onClick={() => copy(real, '代码')}>复制</Btn></div>
          <pre className="svcapi__pre oai-pre"><code>{shown}</code></pre>
          <div className="t-detail-xs">跟着上面的表单变{usedKey ? '；显示时 key 打码，复制的是完整的 key' : ''}。</div>
        </div>
      </Card>
    );
  }

  /** model：本机模型（没下载的也能选，好演示 404）、映射名、自己填。出图多一项「不写」。 */
  function ModelField({p, v, set, ep, ctx}) {
    const [open, setOpen] = useState(false);
    const [typing, setTyping] = useState(false);
    const ch = A.modelChoices(ep.cap, ctx);
    const pick = (x) => { set(p.name, x); setOpen(false); };
    if (typing) {
      return (
        <span className="row gap8">
          <span className="grow"><Field size="s" value={v} autoFocus placeholder="任何名字，认不出的会得到 404" aria-label={p.name} onChange={(e) => set(p.name, e.target.value)} /></span>
          <Btn size="s" variant="quiet" onClick={() => setTyping(false)}>从列表选</Btn>
        </span>
      );
    }
    const dflt = ep.cap && ctx.dflt[ep.cap];
    const label = !v ? `不写（用默认 ${dflt ? dflt.name : '—'}）` : v;
    return (
      <Picker size="s" wide field value={label} open={open} popWidth={320} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)} aria-label={p.name}>
        <Menu>
          {p.optionalModel ? <><MenuItem label="不写" sub={`用默认模型 · ${dflt ? dflt.name : '还没有下载'}`} check={!v} onClick={() => pick('')} /><MenuRule /></> : null}
          {ch.named.length ? <MenuHead>映射的名字</MenuHead> : null}
          {ch.named.map((x) => <MenuItem key={'n' + x.id} label={x.id} sub={x.sub} check={v === x.id} onClick={() => pick(x.id)} />)}
          {ch.named.length ? <MenuRule /> : null}
          <MenuHead>本机模型</MenuHead>
          {ch.local.map((x) => <MenuItem key={'l' + x.id} label={x.name} sub={x.sub} check={v === x.id} onClick={() => pick(x.id)} />)}
          <MenuRule />
          <MenuItem icon="edit" label="自己填…" sub="试试认不出的名字" onClick={() => { setOpen(false); setTyping(true); }} />
        </Menu>
      </Picker>
    );
  }

  function FormField({p, v, set, ep, ctx, modelNow}) {
    const [open, setOpen] = useState(false);
    const off = !!(p.by && modelNow && !A.supports(p, modelNow.id));
    const label = (
      <span className="oai-f__lbl"><code>{p.name}</code>{p.req ? <span className="oai-req">必填</span> : null}{p.ext ? <span className="oai-ext">扩展</span> : null}</span>
    );
    let ctl = null;
    if (off) {
      ctl = <span className="t-detail-xs oai-f__off">{modelNow.name} 不看这个字段{p.by === 'reference_audio' ? '，写了会返回 400' : '，写了也会被忽略'}。</span>;
    } else if (p.kind === 'file') {
      const pool = p.req ? SAMPLE_FILES : SAMPLE_FILES.slice(2);
      ctl = v ? (
        <span className="oai-file">
          <Ic n="audio" className="ic--14" /><span className="grow">{v.name}<span className="t-detail-xs"> · {v.size}</span></span>
          {pool.length > 1 ? <Btn size="s" variant="quiet" onClick={() => { const i = pool.findIndex((f) => f.name === v.name); set(p.name, pool[(i + 1) % pool.length]); }}>换一个文件…</Btn> : null}
          <IconBtn icon="close" size="s" tip="去掉" onClick={() => set(p.name, p.req ? null : '')} />
        </span>
      ) : <Btn size="s" icon="upload" onClick={() => set(p.name, pool[0])}>选择文件…</Btn>;
    } else if (p.kind === 'model') {
      ctl = <ModelField p={p} v={v} set={set} ep={ep} ctx={ctx} />;
    } else if (p.kind === 'voice') {
      const presets = ((window.BC_TTS || {}).PRESETS || []);
      ctl = (
        <Picker size="s" wide field value={v || '不写（默认音色）'} open={open} popWidth={280} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)} aria-label={p.name}>
          <Menu>
            <MenuItem label="不写" sub="用默认音色" check={!v} onClick={() => { set(p.name, ''); setOpen(false); }} />
            <MenuItem label="alloy" sub="OpenAI 音色名 · 按默认音色念" check={v === 'alloy'} onClick={() => { set(p.name, 'alloy'); setOpen(false); }} />
            <MenuRule />
            <MenuHead>模型自带的说话人</MenuHead>
            {presets.map((x) => <MenuItem key={x.id} label={x.id} sub={x.sub} check={v === x.id} onClick={() => { set(p.name, x.id); setOpen(false); }} />)}
          </Menu>
        </Picker>
      );
    } else if (p.kind === 'enum') {
      const vals = p.tryValues || p.values; // tryValues：试用区多给一个不合规的值，好演示报错
      ctl = vals.length === 1 ? <code className="oai-f__fixed">{vals[0]}</code>
        : vals.length <= 3 ? <Segmented size="s" items={vals} value={v} onChange={(x) => set(p.name, x)} /> : (
        <Picker size="s" wide field value={v} open={open} popWidth={220} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)} aria-label={p.name}>
          <Menu>{vals.map((x) => <MenuItem key={x} label={x} check={v === x} onClick={() => { set(p.name, x); setOpen(false); }} />)}</Menu>
        </Picker>
      );
    } else if (p.kind === 'multi') {
      ctl = <span className="row gap12">{p.values.map((x) => <Checkbox key={x} on={(v || []).indexOf(x) >= 0} label={x}
        onChange={(on) => set(p.name, on ? (v || []).concat(x) : (v || []).filter((y) => y !== x))} />)}</span>;
    } else if (p.kind === 'longtext') {
      ctl = <Field area size="s" rows={3} value={v} aria-label={p.name} onChange={(e) => set(p.name, e.target.value)} />;
    } else {
      ctl = <Field size="s" value={v} aria-label={p.name} inputMode={p.kind === 'int' ? 'numeric' : undefined} placeholder={p.placeholder || (p.dflt !== undefined ? String(p.dflt) : '')}
        onChange={(e) => set(p.name, e.target.value)} />;
    }
    return <div className={cx('oai-f', off && 'is-off')}>{label}{ctl}</div>;
  }

  const STATUS = {400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 413: 'Too Large', 500: 'Error', 503: 'Busy'};
  function Response({resp, copy}) {
    const app = useApp();
    const ok = resp.status < 400;
    const b = resp.body;
    const text = b.text != null ? b.text : b.json ? JSON.stringify(b.json, null, 2) : '';
    const art = b.image && window.BC_CLOUD_IMAGE ? window.BC_CLOUD_IMAGE.demoArt(b.image.seed) : null;
    return (
      <div className="oai-resp">
        <div className="row gap8 oai-resp__hd">
          <Chip tone={ok ? 'positive' : 'negative'}>{resp.status} {ok ? 'OK' : (STATUS[resp.status] || '')}</Chip>
          <span className="t-detail grow">{A.fmtMs(resp.ms)}{resp.model ? ' · ' : ''}{resp.alias ? <><code>{resp.alias}</code> → </> : null}{resp.model ? <code>{resp.model}</code> : null}</span>
          <span className="t-detail-xs t-mono">{b.type}</span>
        </div>
        {!ok ? <div className="t-detail oai-resp__why">{resp.hint || A.ERRORS[b.json.error.code][2]}</div> : null}
        {b.audio ? (
          <div className="oai-media"><audio controls preload="metadata" src="assets/cloud-test.wav" aria-label="试听返回的音频" /><span className="t-detail-xs">{resp.meta}</span></div>
        ) : null}
        {b.image ? (
          <div className="oai-media oai-media--img">
            <span className="oai-img" style={{background: art, aspectRatio: `${b.image.w} / ${b.image.h}`}} />
            <span className="grow"><span className="t-detail-xs">{resp.meta}</span>
              <Btn size="s" variant="quiet" icon="download" onClick={() => app.toast('原型演示：另存为 image.png')}>下载图片</Btn></span>
          </div>
        ) : null}
        {text ? (
          <div className="oai-body">
            <IconBtn icon="copy" size="s" tip="复制响应" className="oai-body__copy" onClick={() => copy(text, '响应')} />
            <pre className="svcapi__pre oai-pre oai-pre--resp"><code>{text}</code></pre>
          </div>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {ApiSection, ApiEndpointPage});
})();
