/* 图像生成的共用表单、结果格与生成队列 —— docs/design/image/bcut-image-generation-design.md §2.4 / §2.5（2026-09-25，原型先行）。
   图片 Tab 的「AI 生成」段（panel-image-gen.jsx）与工具 › 生成图片（tool-image.jsx）共用这里的东西：
   提示词框、模型一行（三组：云端 / Codex 画图 / 本机，各带连接卡 / 下载卡 / 就绪门）、画幅 chip（含「跟视频画布」）、
   数量、参考图、高级（质量 / 负向 / 种子 / 透明底 / 步数——只在模型认时出现）、生成按钮旁那句、结果格与每张的四个动作。
   生成是**任务**：每条记录落一条后台任务；云端并行、本机与 Codex 一次一条（本机占重活槽，Codex 全局一把锁）。
   记录挂在模块上（按项目 / 无项目分开），离开这页照样跑完。真相在 model-cloud-image.js（BC_CLOUD_IMAGE），这里只组合。 */
(function () {
  const {useState, useEffect, useMemo} = React;
  const IM = window.BC_CLOUD_IMAGE;
  const D = window.BC_DATA;
  const mb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB');
  // 缺省保留 Mac 演示；?platform=windows-x64 / linux-x64 可验收对应的可用状态与耗时提示。
  const PLATFORM = new URLSearchParams(window.location.search).get('platform') || 'macos-arm64';
  const SAMPLES = [
    'A paper crane on a wooden desk, soft morning light, shallow depth of field',
    '一间明亮的播客工作室，木质桌面上放着麦克风与一杯咖啡，插画风格，暖色',
    'Flat vector illustration of a cheerful robot holding a video camera, pastel palette, white background',
    '水墨风格的山间小路，晨雾，留白',
  ];

  /* ---------- 引擎清单（三族一张表）：store 的已连接集合 + Codex 探测 + 本地装没装 ---------- */
  function useImageEngines(app) {
    const codex = (app.harnessList || []).find((h) => h.id === 'codex') || null;
    return useMemo(() => IM.engines({saved: app.cloudSaved, codex: {h: codex, on: app.codexImageGen}, installed: app.modelInstalled, platform: PLATFORM}),
      [app.cloudSaved, codex, app.codexImageGen, app.modelInstalled]);
  }

  /* ---------- 生成队列：挂在模块上 ---------- */
  const jobs = {list: [], seq: 0, subs: new Set(), timers: {}, drafts: {}};
  const emit = () => jobs.subs.forEach((fn) => fn(jobs.list));
  const patchRec = (id, p) => { jobs.list = jobs.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  const removeRec = (id) => { clearInterval(jobs.timers[id]); jobs.list = jobs.list.filter((r) => r.id !== id); emit(); };
  /** scope：项目 id 或 null（工具页）。 */
  function useImageRecords(scope) {
    const [list, setList] = useState(jobs.list);
    useEffect(() => {
      jobs.subs.add(setList);
      setList(jobs.list);
      return () => { jobs.subs.delete(setList); };
    }, []);
    return list.filter((r) => (r.scope || null) === (scope || null));
  }
  /* 本机与 Codex 一次一条（各自一把锁）；云端并行 */
  const lane = (r) => (r.family === 'cloud' ? null : r.family);
  function pump(app) {
    const busy = {};
    jobs.list.forEach((r) => { if (r.status === 'running' && lane(r)) busy[lane(r)] = true; });
    jobs.list.filter((r) => r.status === 'queued').sort((a, b) => a.seq - b.seq).forEach((r) => {
      const l = lane(r);
      if (l && busy[l]) return;
      if (l) busy[l] = true;
      start(app, r);
    });
  }
  function start(app, r) {
    const tid = app.addTask({kind: 'image', flow: 'image', toolId: r.scope ? undefined : 'image', params: r.scope ? undefined : r.form || null, project: r.scope || null, title: `生成图片 · ${r.n > 1 ? `${r.n} 张` : r.images[0].name}`,
      sub: `${r.engineName}${r.size ? ` · ${r.size.join('×')}` : ''}${r.family === 'cloud' ? ' · 联网' : r.family === 'local' ? ' · 本机' : ' · Codex'}`,
      phase: IM.phase(r, 0), cancellable: true});
    patchRec(r.id, {status: 'running', pct: 0, taskId: tid});
    // 演示速度：云端约 2 秒、本机约 8 秒、Codex 约 5 秒（真实是 §6.2 / §5.2 的分钟级）
    const step = r.family === 'cloud' ? 4 : r.family === 'local' ? 1 : 1.6;
    const t0 = Date.now();
    let p = 0;
    clearInterval(jobs.timers[r.id]);
    jobs.timers[r.id] = setInterval(() => {
      const cur = jobs.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(jobs.timers[r.id]); return; }
      p = Math.min(100, p + step);
      patchRec(r.id, {pct: Math.round(p)});
      app.patchTask(tid, {pct: Math.round(p), phase: IM.phase(r, p)});
      if (p < 100) return;
      clearInterval(jobs.timers[r.id]);
      const fail = jobs.failNext;
      jobs.failNext = false;
      if (fail) {
        patchRec(r.id, {status: 'error', error: fail, ago: '刚刚'});
        app.patchTask(tid, {status: 'error', outcome: 'error', phase: null, error: fail});
        app.toast(`生成失败 · ${fail}`, 'negative');
      } else {
        patchRec(r.id, {status: 'done', ago: '刚刚', createdAt: new Date().toISOString(), elapsed: (Date.now() - t0) / 1000});
        /* 工具页（无项目）生成的图：保存位置里的 PNG、Space 里的图片条目；任务记录带 outputs 与 saveDir（product-design §2.7、model-tool-runs.js） */
        const outs = !r.scope && app.registerToolOutput ? r.images.map(img => app.registerToolOutput('image', {...img, res: r.size?.join('×'), model: r.model, prompt: r.form?.prompt,
          file: r.saveDir ? `${r.saveDir}/${img.name}` : undefined, toolId: 'image', task: tid, params: r.form || null})).filter(Boolean) : [];
        app.patchTask(tid, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, r.scope ? {} : window.BC_TOOL_RUNS.outputsPatch(outs, r.saveDir)));
        app.toast(`已生成 ${r.n > 1 ? `${r.n} 张` : r.images[0].name}${!r.scope ? ' · 已保存到 Space' : ''}`, 'positive');
      }
      pump(app);
    }, 80);
  }
  /** `saveDir`：工具页这次的保存位置（BC_SAVE_DIR.current）；图片 Tab 里生成的进视频素材，不给 */
  function enqueue(app, f, engines, scope, saveDir) {
    jobs.seq += 1;
    const rec = Object.assign(IM.makeRecord(f, jobs.seq, engines), {scope: scope || null, saveDir: scope ? null : saveDir || null});
    jobs.list = [rec].concat(jobs.list);
    emit();
    const ahead = jobs.list.filter((r) => r.id !== rec.id && (r.status === 'running' || r.status === 'queued') && lane(r) === lane(rec) && lane(rec)).length;
    if (ahead) app.toast(rec.family === 'local' ? `已排队 · 等本机的 ${ahead} 条跑完（本机一次出一张）` : `已排队 · Codex 一次只画一张，前面还有 ${ahead} 条`);
    pump(app);
    return rec;
  }
  function cancelRec(app, r) {
    if (r.status === 'queued') { patchRec(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.taskId, {after: () => {
      clearInterval(jobs.timers[r.id]);
      patchRec(r.id, {status: 'canceled', pct: 0});
      pump(app);
    }});
  }
  const requeue = (app, r) => { patchRec(r.id, {status: 'queued', pct: 0, error: null}); pump(app); };
  /** 演示：让下一条失败（工具页与面板的演示开关共用） */
  const setFailNext = (why) => { jobs.failNext = why || null; };

  /* ---------- 门：没连 / 没装 / Codex 没就绪 ---------- */
  function EngineGate({e, f, set, engines}) {
    const app = useApp();
    if (!e || e.ready) return null;
    const alt = IM.preferred(engines, null);
    const altBtn = alt ? <Btn variant="secondary" size="s" icon="image" onClick={() => set(IM.switchModel(f, alt))}>换用可用的 {IM.engineOf(engines, alt).name}</Btn> : null;
    if (e.family === 'cloud') {
      return <div className="aicard aicard--warn">
        <b>先连接 {e.name}</b>
        <span>在设置 › 模型 › API 提供方里给这家添加账号；同一把密钥给这家的全部能力共用。</span>
        <div className="row gap8" style={{marginTop: 4}}>
          <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'cloud', tab: 'image'})}>去连接</Btn>{altBtn}
        </div>
      </div>;
    }
    if (e.family === 'agent') {
      return <div className="aicard aicard--warn">
        <b>Codex 画图还不能用 · {e.why}</b>
        <span>不用密钥，用你装好并登录的 Codex（≥ {IM.CODEX_MIN_VER}）；在设置 › Agent 的 Codex 卡上打开「用 Codex 画图」。</span>
        <div className="row gap8" style={{marginTop: 4}}>
          <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'agent'})}>去设置 › Agent</Btn>{altBtn}
        </div>
      </div>;
    }
    const m = D.setModels.find((x) => x.id === e.id);
    const pct = app.modelDl[e.id];
    if (e.why && /平台/.test(e.why)) {
      return <div className="aicard aicard--warn"><b>{e.name} 在这台电脑上不可用</b><span>{e.why}。可以换用可用的云端模型。</span>
        <div className="row gap8" style={{marginTop: 4}}>{altBtn}</div></div>;
    }
    return <div className="aicard aicard--warn">
      <b>先下载 {e.name} · {mb(e.size)}</b>
      <span>{m ? m.note : e.desc}。下载不占任务队列，装好后这一页的主按钮就能按；生成时与本机语音模型共用同一个重活槽，一次只跑一只。</span>
      <div className="row gap8" style={{marginTop: 4}}>
        {pct == null
          ? <Btn variant="accent" size="s" icon="download" onClick={() => (window.withModelLicense
            ? window.withModelLicense(app, e.id, () => app.downloadModel(e.id)) : app.downloadModel(e.id))}>下载 {mb(e.size)}</Btn>
          : <><span className="mdlbar" style={{width: 120}}><i style={{width: pct + '%'}} /></span><span className="t-detail-xs">{pct}%</span></>}
        {altBtn}
        <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'image'})}>管理本地模型…</BCAction>
      </div>
    </div>;
  }

  /* ---------- 模型一行：三组 Picker ---------- */
  function ModelLine({f, set, engines}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const e = IM.engineOf(engines, f.model);
    const m = IM.modelIn(engines, f.model);
    const label = !e ? '选一只模型' : e.family === 'cloud' ? `${e.name} · ${m.model}` : e.name;
    const groups = [
      {k: 'cloud', label: '云端 · 联网计费', items: engines.filter((x) => x.family === 'cloud' && (x.ready || !x.custom))},
      {k: 'agent', label: 'Codex 画图 · 用订阅额度', items: engines.filter((x) => x.family === 'agent')},
      {k: 'local', label: '本机 · 不联网', items: engines.filter((x) => x.family === 'local')},
    ];
    return (
      <div className="ttsmodel imgen__model">
        <Picker size="s" value={label} open={open} popWidth={340} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)}>
          <Menu>
            {groups.filter(g => g.items.length).map((g) => (
              <React.Fragment key={g.k}>
                <MenuHead>{g.label}</MenuHead>
                {g.items.map((x) => x.family === 'cloud'
                  ? (x.ready ? x.models : x.models.slice(0, 1)).map((mm) => (
                    <MenuItem key={mm.id} label={x.ready ? mm.model : `${x.name} · 未连接`} sub={x.ready ? `${x.name} · ${mm.desc}` : '添加账号后可用 · 设置 › 模型 › API 提供方'} wrap on={mm.id === f.model}
                      suffix={mm.prev ? '上一代' : undefined} disabled={!x.ready} onClick={() => { setOpen(false); set(IM.switchModel(f, mm.id)); }} />))
                  : <MenuItem key={x.id} label={x.name} sub={x.ready ? x.desc : `${x.why} · ${x.family === 'agent' ? '设置 › Agent' : '设置 › 模型 › 图像生成'}`} wrap on={x.id === f.model}
                      onClick={() => { setOpen(false); set(IM.switchModel(f, x.id)); }} />)}
              </React.Fragment>
            ))}
            <MenuRule />
            <MenuItem icon="settings" label="管理 API 提供方…" sub="添加账号、添加模型 · 设置 › 模型 › API 提供方" wrap onClick={() => { setOpen(false); app.go({r: 'settings', sec: 'providers'}); }} />
            <MenuItem icon="settings" label="管理本地模型…" sub="下载 Qwen-Image-2.1 · 设置 › 模型 › 图像生成" wrap onClick={() => { setOpen(false); app.go({r: 'settings', sec: 'local', tab: 'image'}); }} />
          </Menu>
        </Picker>
        {e ? <span className={cx('ttseng__inst', e.ready && 'is-ok')}>{e.ready ? <><Ic n="ok" className="ic--12" />{e.family === 'cloud' ? '已连接' : e.family === 'agent' ? '已打开' : '已安装'}</> : e.why}</span> : null}
        {m ? <span className="ttsmodel__line t-detail grow">{e.family === 'cloud' ? m.desc : e.desc}</span> : null}
      </div>
    );
  }

  /* ---------- 在哪儿跑（远端算力 J1，2026-09-27）----------
     只对本机模型、且局域网里确有已配对节点开放「生成图片」并报得出这只模型时才画——一台都没有时它是废话。
     选了别的机器：权重在那台机器上，本机下载卡让开；出图在那边跑，PNG 经局域网传回，落盘与本机一样。 */
  const SV = window.BC_SERVICES;
  function imageNode(f, e) {
    return e && e.family === 'local' ? SV.nodeOn(D.remote.paired, f.node, 'image', f.model) : null;
  }
  function RunOnRow({f, set, e}) {
    const [open, setOpen] = useState(false);
    if (!e || e.family !== 'local') return null;
    const peers = SV.nodesFor(D.remote.paired, 'image', f.model);
    if (!peers.length) return null;
    const on = imageNode(f, e);
    return (
      <div className="ttsmodel imgen__model">
        <span className="t-detail">在哪儿跑</span>
        <Picker size="s" value={on ? on.name : '这台 Mac'} open={open} popWidth={280} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)}>
          <Menu>
            <MenuItem label="这台 Mac" sub="用装在本机的模型" on={!on} onClick={() => { setOpen(false); set({node: null}); }} />
            {peers.map((n) => (
              <MenuItem key={n.id} label={n.name} sub="局域网里的另一台电脑" on={!!on && n.id === on.id}
                onClick={() => { setOpen(false); set({node: n.id}); }} />
            ))}
          </Menu>
        </Picker>
        {on ? <span className="ttsmodel__line t-detail grow">在那台机器上出图，图片经局域网传回，本机不需要装这只模型</span> : null}
      </div>
    );
  }

  /* ---------- 画幅 chip：小方块示意 + 尺寸 ---------- */
  function AspectRow({f, set, cap, ctx}) {
    const fitted = ctx ? IM.fitAspect(ctx.ratio || '16:9', cap.aspects) : null;
    const pick = (a, fit) => set({aspect: a, fit: !!fit});
    const box = (a) => { const r = IM.ratioOf(a); return r >= 1 ? {width: 18, height: Math.max(6, Math.round(18 / r))} : {width: Math.max(6, Math.round(18 * r)), height: 18}; };
    const sizeOf = (a) => { const s = IM.resolveSize(cap, a, f.quality); return s ? s.join('×') : ''; };
    return (
      <BCChoiceGroup className="imgen__aspects" value={f.fit && fitted ? "fit" : f.aspect} onChange={key => pick(key === "fit" ? fitted : key, key === "fit")} aria-label="画幅">
        {fitted ? <BCAction type="button" choiceKey={"fit"}  className={cx('imgen__aspect', f.fit && 'is-on')} >
          <span className="imgen__box" style={box(fitted)} /><b>跟视频画布</b><span>{fitted}{cap.sizes !== 'fixed' ? ` · ${sizeOf(fitted)}` : ''}</span>
        </BCAction> : null}
        {cap.aspects.map((a) => (
          <BCAction key={a} type="button" choiceKey={a}  className={cx('imgen__aspect', (!f.fit || !fitted) && f.aspect === a && 'is-on')} >
            <span className="imgen__box" style={box(a)} /><b>{a}</b>{cap.sizes !== 'fixed' ? <span>{sizeOf(a)}</span> : null}
          </BCAction>
        ))}
        {cap.sizes === 'fixed' ? <span className="t-detail-xs">Codex 只认画幅，尺寸由它定</span> : null}
      </BCChoiceGroup>
    );
  }

  /* ---------- 参考图：从素材库挑 ---------- */
  /* 参考图一行（§2.4 第 5 条）：素材库里选（面板给了 sources 才有）、从文件选（真开文件选择器）、拖图片进来。
     选进来的文件登记在 IM.FILE_REFS（只留名字与预览 url，正式版是拷进素材库再引用）。认不认、上限几张看能力表。 */
  const ACCEPT = 'image/png,image/jpeg,image/webp';
  function RefsRow({f, set, cap, sources, engineName}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const [over, setOver] = useState(false);
    const fileRef = React.useRef(null);
    const lib = sources || [];
    const refs = f.refs || [];
    const pool = lib.filter((s) => refs.indexOf(s.id) < 0);
    const chosen = refs.map((id) => IM.refInfo(id, lib));
    const room = cap.refs ? Math.max(0, cap.refs - refs.length) : 0;
    const addFiles = (files) => {
      const imgs = Array.from(files || []).filter((x) => !x.type || /^image\//.test(x.type));
      if (!imgs.length) return;
      const take = imgs.slice(0, room);
      const ids = IM.addFileRefs(take.map((x) => ({name: x.name, size: Math.round(x.size / 1024), url: URL.createObjectURL(x)})));
      set({refs: refs.concat(ids)});
      if (imgs.length > take.length) app.toast(`最多 ${cap.refs} 张参考图 · 多出的 ${imgs.length - take.length} 张没加`, 'notice');
    };
    const pickFile = () => { if (fileRef.current) { fileRef.current.value = ''; fileRef.current.click(); } };
    return (
      <div className={cx('imgen__refs', over && 'is-over')}
        onDragOver={(ev) => { if (room) { ev.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(ev) => { ev.preventDefault(); setOver(false); if (room) addFiles(ev.dataTransfer.files); }}>
        <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden aria-hidden="true" tabIndex={-1} onChange={(ev) => addFiles(ev.target.files)} />
        <ComposerAttachments items={chosen.map((s, i) => ({...s, kind: 'image',
          isInvalid: !!s.missing || !!(cap.refs && i >= cap.refs),
          /* @ds-allow: 素材库缩略图保留素材本身的颜色 */
          preview: !s.url && s.grad ? <i className="imgen__ref-preview" style={{background: s.grad}} /> : null,
        }))} onRemove={i => set({refs: refs.filter(x => x !== chosen[i].id)})} />
        {sources ? (
            <Picker size="s" value={chosen.length ? '再加一张' : '选参考图'} icon="plus" disabled={!room} open={open && !!room} popWidth={260} onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)}>
              <Menu>
                <MenuItem icon="upload" label="从文件选…" sub="PNG / JPG / WEBP，可多选" onClick={() => { setOpen(false); pickFile(); }} />
                <MenuRule />
                {pool.length ? pool.map((s) => <MenuItem key={s.id} icon="image" label={s.name} sub={s.meta} onClick={() => { setOpen(false); set({refs: refs.concat([s.id])}); }} />)
                  : <MenuItem label="素材库里没有别的图片了" disabled />}
              </Menu>
            </Picker>
          ) : <Btn size="s" icon="plus" disabled={!room} onClick={pickFile}>选参考图</Btn>}
        <span className="t-detail-xs">{IM.refsNote(f, cap, engineName)}{room ? ' · 也可以把图片拖进来' : ''}</span>
      </div>
    );
  }

  /* ---------- 整张表单（不含主按钮）---------- */
  const ImageGenSection = ({title, aside, children, compact}) => (
    <section className={cx('ttsw__sec', compact && 'imgen__sec--compact')}>
      {title ? <div className="ttsw__sechd"><span className="t-section grow">{title}</span>{aside || null}</div> : null}
      {children}
    </section>
  );

  function ImageGenForm({f, set, engines, ctx, sources, compact}) {
    const app = useApp();
    const e = IM.engineOf(engines, f.model);
    const cap = IM.capabilities(f.model);
    const p = String(f.prompt || '');
    const hasAdvanced = cap.quality.length > 1 || cap.negative || cap.seed || cap.transparent || (e && e.family === 'local');
    return (
      <>
        <ImageGenSection compact={compact}>
          <PromptField inputProps={{rows: compact ? 4 : 5, value: f.prompt, 'aria-label': '要画的画面',
            placeholder: '描述你要的画面：主体、场景、风格、光线、构图。写得越具体越像。',
            onChange: (ev) => set({prompt: ev.target.value}),
          }} toolbar={<div className="imgen__promptrefs">
            <div className="row gap6">
              <span className="t-section">参考图</span>
              {f.model && cap.refs ? <span className={cx('t-detail-xs', (f.refs || []).length > cap.refs && 'ttsw__over')}>{(f.refs || []).length} / {cap.refs}</span> : null}
            </div>
            {f.model && cap.refs ? <RefsRow f={f} set={set} cap={cap} sources={sources} engineName={e ? e.name : null} />
              : <div className="imgen__refs imgen__refs--off">
                <Btn size="s" icon="plus" disabled>选参考图</Btn>
                <span className="t-detail-xs">{f.model ? IM.refsNote(f, cap, e ? e.name : null) : '先选一只模型'}</span>
                {(f.refs || []).length ? <BCAction className="viewall" onClick={() => set({refs: []})}>去掉</BCAction> : null}
              </div>}
          </div>} />
          <div className="ttsw__textft">
            <span className={cx('t-detail-xs grow', p.trim().length > cap.promptMax && 'ttsw__over')}>{p.trim().length} / {cap.promptMax} 字</span>
            {p ? <BCAction className="viewall" onClick={() => set({prompt: ''})}>清空</BCAction>
              : <BCAction className="viewall" onClick={() => set({prompt: SAMPLES[jobs.seq % SAMPLES.length]})}>填一句示例</BCAction>}
          </div>
        </ImageGenSection>

        <ImageGenSection compact={compact} title="模型" aside={<BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'cloud', tab: 'image'})}>管理生图模型…</BCAction>}>
          <ModelLine f={f} set={set} engines={engines} />
          <RunOnRow f={f} set={set} e={e} />
          {imageNode(f, e) ? null : <EngineGate e={e} f={f} set={set} engines={engines} />}
        </ImageGenSection>

        <ImageGenSection compact={compact} title="画幅">
          <AspectRow f={f} set={set} cap={cap} ctx={ctx} />
        </ImageGenSection>

        {cap.maxN > 1 ? (
          <ImageGenSection compact={compact} title="数量">
            <div className="ttsw__row">
              <Stepper value={f.n} decTip="少一张" incTip="多一张" disabledDec={f.n <= 1} disabledInc={f.n >= cap.maxN}
                onDec={() => set({n: f.n - 1})} onInc={() => set({n: f.n + 1})} />
              <span className="t-detail-xs">一次最多 {cap.maxN} 张 · 每张各自的种子</span>
            </div>
          </ImageGenSection>
        ) : null}

        {hasAdvanced ? (
          <ImageGenSection compact={compact} title="高级" aside={<BCAction className="viewall" onClick={() => set({advanced: !f.advanced})}>{f.advanced ? '收起' : '展开'}</BCAction>}>
            {f.advanced ? (
              <div className="imgen__adv">
                {cap.quality.length > 1 ? <div className="ttsw__row"><span className="ttsw__lab">质量</span>
                  <Segmented size="s" value={f.quality} onChange={(q) => set({quality: q})} items={[{k: 'normal', label: '标准 · 1K'}, {k: '2k', label: '高 · 2K'}]} />
                  <span className="t-detail-xs">2K 更贵、更慢</span></div> : null}
                {cap.negative ? <div className="ttsw__row"><span className="ttsw__lab">不要出现</span>
                  <Field size="s" className="grow" value={f.negative} placeholder="负向提示 · 例如 文字、水印、模糊" onChange={(ev) => set({negative: ev.target.value})} /></div> : null}
                {cap.seed ? <div className="ttsw__row"><span className="ttsw__lab">种子</span>
                  <Field size="s" style={{width: 140}} value={f.seed} placeholder="留空随机" inputMode="numeric" onChange={(ev) => set({seed: ev.target.value.replace(/[^\d]/g, '')})} />
                  <span className="t-detail-xs">{e && e.family === 'local' ? '同种子同权重可复现' : '云端不保证复现'}</span></div> : null}
                {cap.transparent ? <div className="ttsw__row"><Checkbox on={f.transparent} onChange={(v) => set({transparent: v})} label="透明底（RGBA PNG）" /></div> : null}
                {e && e.family === 'local' ? <div className="ttsw__row"><span className="ttsw__lab">步数</span>
                  <Stepper value={f.steps} decTip="少 4 步" incTip="多 4 步" disabledDec={f.steps <= 8} disabledInc={f.steps >= 40}
                    onDec={() => set({steps: f.steps - 4})} onInc={() => set({steps: f.steps + 4})} />
                  <span className="t-detail-xs">默认 20 · 越多越慢</span></div> : null}
              </div>
            ) : <span className="t-detail-xs">{[cap.quality.length > 1 ? '质量' : null, cap.negative ? '负向提示' : null, cap.seed ? '种子' : null, cap.transparent ? '透明底' : null, e && e.family === 'local' ? '步数' : null].filter(Boolean).join(' · ')}</span>}
          </ImageGenSection>
        ) : null}
      </>
    );
  }

  /* ---------- 结果格 ---------- */
  /** `extra(r, img)`：卡片下面再挂的一块（工具页挂产物行：在 Space 中查看、交给 Agent、接着用工具） */
  function ImageCard({r, img, onPlace, onKeep, onRef, onAgain, kept, extra}) {
    return (
      <div className={cx('imgen__card', kept && 'is-kept')}>
        {/* @ds-allow: 生成结果的缩略是素材本身 */}
        <span className={cx('imgen__thumb', r.transparent && 'checker')} style={{background: img.art, aspectRatio: r.size ? `${r.size[0]} / ${r.size[1]}` : '1 / 1'}}>
          <span className="imgen__acts">
            {onPlace ? <Btn variant="accent" size="s" icon="plus" onClick={() => onPlace(r, img)}>放到画布</Btn> : null}
            <Btn variant="secondary" size="s" icon="download" onClick={() => onKeep(r, img)}>{onPlace ? '收进素材库' : kept ? '已收进视频' : '加到视频…'}</Btn>
            <span className="row gap4">
              {onRef ? <Btn variant="quiet" size="s" icon="image" onClick={() => onRef(r, img)}>用作参考</Btn> : null}
              <Btn variant="quiet" size="s" icon="refresh" onClick={() => onAgain(r, img)}>再来一版</Btn>
            </span>
          </span>
          {kept ? <Chip className="imgen__kept" tone="positive">已收进素材库</Chip> : null}
        </span>
        <em className="t-truncate">{img.name}</em>
        <span className="t-detail-xs">{r.size ? r.size.join('×') : '尺寸由 Codex 定'} · 种子 {img.seed}</span>
        {extra ? extra(r, img) : null}
      </div>
    );
  }
  function RunningCard({r, list}) {
    const app = useApp();
    const ahead = list.filter((x) => x.id !== r.id && (x.status === 'running' || x.status === 'queued') && x.seq < r.seq && lane(x) === lane(r) && lane(r)).length;
    return (
      <div className="imgen__running">
        <div className="row gap8">
          <Ic n="image" className="ic--16" />
          <span className="t-detail grow t-truncate">{r.status === 'queued' ? (ahead ? `排队中 · 前面还有 ${ahead} 条` : '排队中') : `${IM.phase(r, r.pct)} · ${r.pct}%`} · {r.engineName}</span>
          <Btn variant="quiet" size="s" onClick={() => cancelRec(app, r)}>取消</Btn>
        </div>
        {r.status === 'running' ? <Progress value={r.pct} thin /> : null}
        <span className="t-detail-xs t-truncate">{r.prompt}</span>
      </div>
    );
  }
  function ErrorCard({r}) {
    const app = useApp();
    return (
      <div className="aicard aicard--warn imgen__error">
        <b>没生成出来 · {r.error}</b>
        <span className="t-truncate">{r.prompt}</span>
        <div className="row gap8" style={{marginTop: 4}}>
          <Btn variant="secondary" size="s" icon="refresh" onClick={() => requeue(app, r)}>再试一次</Btn>
          <Btn variant="quiet" size="s" icon="trash" onClick={() => removeRec(r.id)}>不要了</Btn>
        </div>
      </div>
    );
  }
  /** 结果区：最近几批；每批一个小标题（模型 · 尺寸 · 时间） */
  function ImageResults({list, keep, onPlace, onKeep, onRef, onAgain, batches, extra}) {
    const shown = list.slice(0, batches || 3);
    if (!shown.length) return null;
    return (
      <div className="imgen__results">
        {shown.map((r) => (
          <div key={r.id} className="imgen__batch">
            {r.status === 'done' ? <>
              <div className="imgen__batchhd"><span className="t-detail-xs grow t-truncate">{IM.recordMeta(r)}</span><span className="t-detail-xs">{r.ago}</span></div>
              <div className={cx('imgen__grid', r.images.length === 1 && 'imgen__grid--one')}>
                {r.images.map((img) => <ImageCard key={img.id} r={r} img={img} kept={!!(keep && keep[img.id])} onPlace={onPlace} onKeep={onKeep} onRef={onRef} onAgain={onAgain} extra={r.status === 'done' ? extra : null} />)}
              </div>
            </> : r.status === 'error' ? <ErrorCard r={r} /> : r.status === 'canceled' ? null : <RunningCard r={r} list={list} />}
          </div>
        ))}
      </div>
    );
  }

  /* ---------- 交给 Agent（§2.6）---------- */
  function ImageAgentSection({f, engines}) {
    const app = useApp();
    if (!window.BC_SURFACE.agent) return null;
    const prompt = IM.agentPrompt(f, engines);
    const ready = app.agentAvail.ready;
    return (
      <section className="ttsw__sec">
        <div className="ttsw__sechd"><span className="t-section grow">交给 Agent</span></div>
        <span className="t-detail">在 Agent 会话里说一句话也能生图：Agent 会调 bcut image，用设置里的默认模型（Codex 画图只在你点名或把它设成默认时用），生好放进视频素材库。</span>
        <pre className="ttsw__prompt">{prompt}</pre>
        <div className="ttsw__row">
          {ready
            ? <Btn variant="secondary" size="s" icon="agent" onClick={() => app.openAgent({prompt, send: true})}>交给 Agent</Btn>
            : <span className="t-detail-xs">还没连接编码 Agent · <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'agent'})}>设置 › Agent</BCAction></span>}
          <Btn variant="quiet" size="s" icon="copy" onClick={() => { copyToClipboard(prompt); app.toast('已复制 · 贴给任何装了 BaoCut skill 的 Agent', 'positive'); }}>复制提示词</Btn>
        </div>
      </section>
    );
  }

  /** 生成主按钮旁那句：门 → 校验 → 费用 / 估时 */
  function statusOf(f, engines, tried) {
    const e = IM.engineOf(engines, f.model);
    const cap = IM.capabilities(f.model);
    if (!e) return {text: '先选一只模型', bad: true};
    const node = imageNode(f, e);
    if (node) {
      const errs0 = IM.validate({...f, refs: IM.usedRefs(f, cap)}, cap);
      const err0 = errs0.find((x) => tried || x !== IM.EMPTY_PROMPT);
      return err0 ? {text: err0, bad: true} : {text: `在 ${node.name} 上出图 · 局域网 · 不联网`, bad: false};
    }
    if (!e.ready) return {text: e.family === 'cloud' ? `先连接 ${e.name}` : e.family === 'agent' ? `Codex 画图 · ${e.why}` : e.why === '未下载' ? `先下载 ${e.name}` : e.why, bad: true};
    const errs = IM.validate({...f, refs: IM.usedRefs(f, cap)}, cap);
    const err = errs.find((x) => tried || x !== IM.EMPTY_PROMPT);
    if (err) return {text: err, bad: true};
    return {text: IM.statusLine(f, engines, IM.resolveSize(cap, f.aspect, f.quality, f.size)), bad: false};
  }

  /* ---------- 生图测试对话框（设置 › 模型 › 云端模型「测试生图」与本地模型「试画」共用；§2.1 / §6.5）----------
     能改提示词、认参考图的模型能带参考图、512² 一张、看结果图、下载 PNG、复制提示词。
     engine: {family:'cloud'|'local', title, modelId, chip, price?, cap, note?}；onDone(result) 把判词回给调用方。
     本地是「试画」（用它），不是「检查」（模型健不健康）：notice 是上次检查没通过的提醒（BC_LOCALCHECK.tryNotice），
     失败用同一套「哪里不对 · 怎么办 · 按钮」；onCheck(k) 把「检查模型 / 修复…」交回那一行。 */
  const PROBE_SAMPLE = SAMPLES[0];
  const SCENARIOS = {
    cloud: [{k: 'ok', label: '成功'}, {k: 'auth', label: '鉴权失败'}, {k: 'timeout', label: '超时'}],
    local: [{k: 'ok', label: '成功'}, {k: 'oom', label: '内存不足'}, {k: 'modelError', label: '模型出错'}],
  };
  const FAIL_TEXT = {auth: '401 · 密钥无效或没有此模型的访问权限。', timeout: '请求超时 · 检查网络或服务地址后重试。'};
  function downloadArt(art, name) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
    const g = cv.getContext('2d');
    const colors = IM.artColors(art);
    const grad = g.createLinearGradient(0, 0, 512, 512);
    colors.forEach((c, i) => grad.addColorStop(colors.length > 1 ? i / (colors.length - 1) : 0, c));
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
    const a = document.createElement('a'); a.href = cv.toDataURL('image/png'); a.download = name; a.click();
  }
  function ImageProbeDialog({open, engine, onClose, onDone, notice, onCheck}) {
    const app = useApp();
    const cloud = engine.family === 'cloud';
    const cap = engine.cap || IM.capabilities(engine.modelId);
    const [f, setF] = useState(() => ({prompt: PROBE_SAMPLE, refs: []}));
    const set = (p) => setF((x) => Object.assign({}, x, p));
    const [state, setState] = useState('ready');
    const [scenario, setScenario] = useState('ok');
    const [res, setRes] = useState(null);
    const timer = React.useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const prompt = String(f.prompt || '').trim();
    const used = IM.usedRefs(f, cap);
    const stop = () => { clearTimeout(timer.current); onClose(); };
    const run = () => {
      if (!prompt) return;
      setState('running'); setRes(null);
      timer.current = setTimeout(() => {
        const time = cloud ? '8.4 s' : '46 s';
        const r = scenario === 'ok'
          ? {state: 'ok', time, art: IM.demoArt(prompt.length + used.length), name: `图片-${cloud ? '测试' : '试画'}-${engine.modelId.replace(/[^\w.-]+/g, '-')}.png`, prompt, refs: used.length}
          : {state: 'error', text: FAIL_TEXT[scenario] || '失败', kind: scenario === 'oom' ? 'noMemory' : 'modelError'};
        setRes(r); setState(r.state);
        if (onDone) onDone(r);
      }, cloud ? 1200 : 1800);
    };
    const priceLine = cloud ? (engine.price || '价格以服务商为准') : '不联网 · 占本机的重活槽';
    return (
      <Dialog open={open} title={cloud ? '测试图像生成' : `试画 · ${engine.title}`} onClose={stop} width={560}
        footer={<><Btn variant="secondary" onClick={stop}>{state === 'running' ? '停止等待' : '关闭'}</Btn>
          <Btn variant="accent" disabled={state === 'running' || !prompt} onClick={run}>{state === 'running' ? '生成中…' : state === 'ready' ? '开始生成' : '再生成一张'}</Btn></>}>
        <div className="cloud-probe imgen__probe">
          {/* 对话框开着时不会再检查：这里画成了就一定在那次检查之后，提醒撤掉 */}
          {!cloud && notice && !(res && res.state === 'ok') ? <window.ModelTryNote view={notice} onAction={(k) => onCheck && onCheck(k)} /> : null}
          <div className="row gap8"><b className="t-title-sm">{engine.title}</b><Chip tone="neutral">{engine.chip || (cloud ? 'Image' : 'MLX')}</Chip></div>
          <div className="t-mono t-detail">{engine.modelId}</div>
          <Card layer className="cloud-sample">
            <b className="t-title-sm">测试提示词 · 一张 512 × 512</b>
            <Field area className="imgen__text--compact" value={f.prompt} aria-label="测试提示词" placeholder="写要画的画面" onChange={(ev) => set({prompt: ev.target.value})} />
            <div className="ttsw__textft">
              <span className="t-detail-xs grow">{prompt.length} / {cap.promptMax} 字</span>
              <BCAction className="viewall" onClick={() => set({prompt: f.prompt === PROBE_SAMPLE ? SAMPLES[1] : PROBE_SAMPLE})}>换一句示例</BCAction>
            </div>
            {cap.refs ? <RefsRow f={f} set={set} cap={cap} engineName={engine.title} />
              : <span className="t-detail-xs">{IM.refsNote(f, cap, engine.title)}</span>}
            <p className="t-detail">画幅 1:1 · 尺寸 512 × 512{cloud ? '（不认的取这家最小一档）' : ` · ${engine.steps || 8} 步`} · 1 张{used.length ? ` · 带 ${used.length} 张参考图` : ''} · {priceLine}</p>
          </Card>
          <p className="t-detail">{cloud ? `把这句提示词${used.length ? '和参考图' : ''}发给所选模型生图，检查能否返回一张 PNG。按张计费，这次 ${priceLine}。提供方可能按用量计费。停止等待不会撤回已经发送的请求。`
            : '在这台电脑上画一张小图看看效果，不联网。会占重活槽，别的本地模型任务要等它跑完。'}</p>
          <Card className="cloud-result" role="status" aria-live="polite">
            <b className={cx('t-title-sm', state === 'error' && 't-negative')}>{({ready: '等待开始', running: cloud ? '正在发送提示词并等待图片…' : '正在画 512² · 8 步…', ok: `${cloud ? '测试通过' : '画好了'} · ${res && res.time} · 演示结果`, error: `${cloud ? '测试失败' : '没画出来'} · 演示结果`})[state]}</b>
            {state === 'running' ? <Progress value={cloud ? 60 : 35} thin /> : null}
            {res && res.state === 'error' && cloud ? <p className="t-body-sm">{res.text}</p> : null}
            {res && res.state === 'error' && !cloud ? <window.ModelTryNote view={window.BC_LOCALCHECK.tryFailure(res.kind, 'image')}
              onAction={(k) => (k === 'retry' ? run() : onCheck && onCheck(k))} /> : null}
            {res && res.state === 'ok' ? <div className="imgen__probe__res">
              {/* @ds-allow: 生成结果的缩略是素材本身 */}
              <span className="imgen__probe__thumb" role="img" aria-label="测试生成的图片" style={{background: res.art}} />
              <div className="imgen__probe__meta">
                <span className="t-detail">512 × 512 · PNG · {res.time}{res.refs ? ` · 带 ${res.refs} 张参考图` : ''}</span>
                <span className="t-detail-xs t-truncate">「{res.prompt}」</span>
                <span className="t-detail-xs">结果存在 image-preview/，不进视频</span>
                <div className="row gap8 imgen__probe__acts">
                  <Btn size="s" variant="secondary" icon="download" onClick={() => { downloadArt(res.art, res.name); app.toast(`已下载 ${res.name}`, 'positive'); }}>下载图片</Btn>
                  <Btn size="s" variant="quiet" icon="copy" onClick={() => { copyToClipboard(res.prompt); app.toast('已复制提示词'); }}>复制提示词</Btn>
                </div>
              </div>
            </div> : null}
          </Card>
          <div className="row gap8 cloud-demo-row"><span className="t-detail-xs grow">原型结果演示</span>
            <Segmented size="s" value={scenario} onChange={(x) => state !== 'running' && setScenario(x)} items={SCENARIOS[cloud ? 'cloud' : 'local']} /></div>
        </div>
      </Dialog>
    );
  }

  Object.assign(window, {
    useImageEngines, useImageRecords, ImageGenForm, ImageResults, ImageAgentSection, ImageCard, ImageProbeDialog, RefsRow,
    BC_IMAGE_JOBS: {enqueue, cancelRec, removeRec, requeue, setFailNext, statusOf, imageNode, drafts: jobs.drafts, jobs, SAMPLES, PLATFORM},
  });
})();
