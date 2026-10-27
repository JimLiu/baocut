/* 工具 › 图片处理（2026-10-27，原型先行；规则在 model-image-edit.js，画布在 image-edit-canvas.jsx）。
   放大 / 去除物体 / 去水印 / 重绘 / 扩图共用一页：页顶 SegmentedControl 切换（同视频文件工具），左栏是来源 → 画布 → 选项 →
   保存位置，右栏是任务队列（五个工具共用，本机一次跑一条）。都是文件到文件：结果是保存位置里的一个 PNG、Space 里的一个图片条目，
   不动原图。选区与表单离开这一页还在（模块级草稿），换一个工具时来源图跟着走、选区不跟（各工具的选区意思不同）。
   - 放大：Real-ESRGAN 是受管外部工具，第一次用之前在这一页下载（显示来源、版本、大小与许可，用户点了才下）；
   - 去除物体、去水印：快速填充（本机 ffmpeg，不用模型）或 AI 修补（能改图的图像模型；只送选区周围的一块，回来只贴回选区）；
   - 重绘：AI 修补加一句「改成什么」；扩图：选比例与原图位置，新增的部分由图像模型画。
   演示挡位（页底）：Real-ESRGAN 装没装、下一条成功还是失败。交互演示不落真文件。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const E = window.BC_IMAGE_EDIT;
  const R = window.RSP;
  const ACCEPT = '.png,.jpg,.jpeg,.webp';

  /* ---------- 模块级状态：离开这一页任务照样跑完，草稿还在 ---------- */
  const store = {list: [], seq: 0, timer: null, subs: new Set(), drafts: {srcs: [], forms: {}, sels: {}},
    esrgan: 'missing', installPct: 0, installTimer: null, installFail: false, outcome: 'ok'};
  const emit = () => store.subs.forEach((fn) => fn());
  const patch = (id, p) => { store.list = store.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  function useStore() {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      store.subs.add(fn);
      return () => { store.subs.delete(fn); };
    }, []);
    return store;
  }
  const FAILS = {
    upscale: {title: 'Real-ESRGAN 没能放大这张图', line: '显卡内存不够：这张图太大。换小一点的倍数，或先把图缩小再放大。', code: 'UPSCALE_FAILED', evidence: 'vkAllocateMemory failed -2'},
    model: {title: '图像模型没有改这张图', line: '服务商拒绝了这次修改（安全策略）。换一个模型，或把选区改小一点再试。', code: 'MODEL_REQUEST_REJECTED', evidence: 'content_policy_violation'},
    fill: {title: '快速填充没有完成', line: '选区贴着画面边缘，四周没有能参照的像素。框小一点，或改用 AI 修补。', code: 'IMAGE_EDIT_FAILED', evidence: 'removelogo: mask touches the frame border'},
  };

  /* ---------- 队列 ---------- */
  function enqueue(app, form, srcs, sel, saveDir, engineLabel) {
    const taken = store.list.map((r) => r.name).concat((app.spaceItems || []).map((x) => x.name));
    const batch = form.op === 'watermark' || form.op === 'upscale' ? srcs : srcs.slice(0, 1);
    batch.forEach((src, i) => {
      store.seq += 1;
      const name = E.outputName(form.op, src.name, form, taken);
      taken.push(name);
      const up = form.op === 'upscale' ? E.upscaleSize(src, form.scale, form.model) : null;
      const plan = form.op === 'expand' ? E.expandPlan(src, form) : null;
      const out = up || plan || {width: src.width, height: src.height};
      // 批量去水印：框按第一张记，别的图按比例换算到自己的尺寸
      store.list = [{id: `ie-${store.seq}`, status: 'queued', pct: 0, name, form: Object.assign({}, form), source: src, sel: E.scaleSelection(sel, batch[0], src),
        out: {width: out.width, height: out.height}, index: i + 1, batch: batch.length, saveDir, engine: engineLabel}].concat(store.list);
    });
    emit();
    const ahead = store.list.filter((r) => r.status === 'running').length;
    if (ahead) app.toast('已排队 · 本机一次跑一条');
    pump(app);
  }
  function pump(app) {
    if (store.list.some((r) => r.status === 'running')) return;
    const r = store.list.slice().reverse().find((x) => x.status === 'queued');
    if (!r) return;
    const o = E.opById(r.form.op);
    const tid = app.addTask({kind: 'image', flow: 'tools', tool: r.form.op, toolId: r.form.op, project: null, title: `${o.name} · ${r.source.name}`,
      sub: E.jobMeta(r), phase: '读取', cancellable: true, params: {form: r.form, src: r.source}, ...window.BC_TOOL_RUNS.outputsPatch([], r.saveDir)});
    patch(r.id, {status: 'running', taskId: tid});
    const t0 = Date.now();
    let p = 0;
    clearInterval(store.timer);
    store.timer = setInterval(() => {
      const cur = store.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(store.timer); return; }
      p = Math.min(100, p + (r.form.method === 'fill' ? 20 : 5));
      const phase = p < 10 ? '读取' : p < 90 ? (r.form.op === 'upscale' ? '放大' : r.form.method === 'fill' ? '填充' : '生成') : '校验';
      if (store.outcome === 'fail' && p >= 40) {
        clearInterval(store.timer);
        store.outcome = 'ok';
        const fail = FAILS[r.form.op === 'upscale' ? 'upscale' : r.form.method];
        patch(r.id, {status: 'error', fail});
        app.patchTask(tid, {status: 'error', outcome: 'error', phase: null, error: fail.title, errorCode: fail.code});
        app.toast(fail.title, 'negative');
        emit();
        pump(app);
        return;
      }
      patch(r.id, {pct: p, phase});
      app.patchTask(tid, {pct: p, phase});
      if (p < 100) return;
      clearInterval(store.timer);
      const dir = r.saveDir || window.BC_SAVE_DIR.DEFAULT;
      const entry = app.registerToolOutput('image', {id: `${r.id}-${Date.now().toString(36)}`, name: r.name, file: `${dir}/${r.name}`,
        res: `${r.out.width}×${r.out.height}`, bytes: Math.round(r.out.width * r.out.height * 1.6), sourceName: r.source.name,
        toolId: r.form.op, tool: r.form.op, task: tid, params: {form: r.form, src: r.source}, note: '交互原型不落真文件'});
      patch(r.id, {status: 'done', pct: 100, elapsed: (Date.now() - t0) / 1000, entry});
      app.patchTask(tid, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, window.BC_TOOL_RUNS.outputsPatch([entry], r.saveDir)));
      app.toast(`已生成 ${r.name} · 保存在 ${window.BC_SAVE_DIR.label(dir)}`, 'positive');
      pump(app);
    }, 120);
  }
  function cancel(app, r) {
    if (r.status === 'queued') { patch(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.taskId, {after: () => { clearInterval(store.timer); patch(r.id, {status: 'canceled', pct: 0}); pump(app); }});
  }

  /* ---------- 来源 ---------- */
  /** 本机文件：真读像素尺寸 */
  function readFile(file) {
    return new Promise((done) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => done({name: file.name, url, width: img.naturalWidth, height: img.naturalHeight, bytes: file.size});
      img.onerror = () => done(null);
      img.src = url;
    });
  }
  /** Space 里的图片条目 → 源描述（按条目记的分辨率，没有时按 1600×1000） */
  function fromEntry(entry) {
    const res = String(entry.res || '').split(/[×x]/).map(Number);
    return {name: entry.name, url: null, width: res[0] || 1600, height: res[1] || 1000, bytes: entry.bytes || 0, entry: entry.id};
  }

  function Sources({op, srcs, setSrcs}) {
    const app = useApp();
    const input = useRef(null);
    const [space, setSpace] = useState(false);
    const [over, setOver] = useState(false);
    const many = op === 'watermark' || op === 'upscale';
    const take = (files) => Promise.all(Array.from(files || []).filter((f) => /^image\//.test(f.type)).map(readFile))
      .then((list) => { const ok = list.filter(Boolean); if (ok.length) setSrcs(many ? srcs.concat(ok).slice(0, 50) : ok.slice(0, 1)); else app.toast('只收 PNG、JPEG、WebP 图片'); });
    const picker = <input ref={input} type="file" accept={ACCEPT} multiple={many} hidden
      onChange={(e) => { const f = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; take(f); }} />;
    if (!srcs.length) {
      return <section className="vw__sec">
        <div className={cx('vdrop', over && 'is-over')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
          <Ic n="image" className="ic--26 vdrop__ic" />
          <b className="t-title-sm">{many ? '把图片拖进来' : '把一张图片拖进来'}</b>
          <span className="t-detail">PNG、JPEG、WebP。{many ? '可以一次放几张，按同样的设置逐张处理。' : ''}原图不会被改动。</span>
          <Btn variant="secondary" size="s" icon="folder" onClick={() => input.current.click()}>选择图片…</Btn>
        </div>
        {space ? <div className="vw__space">
          <window.ToolSpacePicker tool={op} value={null} onChange={(e) => { setSpace(false); setSrcs(many ? srcs.concat([fromEntry(e)]) : [fromEntry(e)]); }} />
          <BCAction className="viewall" onClick={() => setSpace(false)}>收起</BCAction>
        </div> : <BCAction className="viewall" onClick={() => setSpace(true)}>或者从 Space 里选一张图片…</BCAction>}
        {picker}
      </section>;
    }
    return <section className="vw__sec">
      <div className="ie__srcs">
        {srcs.map((s, i) => (
          <div key={i} className={cx('vsrc', i === 0 && srcs.length > 1 && 'is-first')}>
            <span className="vsrc__ic"><Ic n="image" className="ic--22" /></span>
            <span className="vsrc__txt">
              <b className="t-title-sm t-truncate">{s.name}</b>
              <span className="t-detail-xs">{s.width}×{s.height}{s.entry ? ' · Space' : ''}{i === 0 && srcs.length > 1 ? ' · 在下面的画布上设置' : ''}</span>
            </span>
            <IconBtn icon="close" size="s" tip="移出" onClick={() => setSrcs(srcs.filter((_, j) => j !== i))} />
          </div>
        ))}
      </div>
      <div className="row">
        <Btn variant="quiet" size="s" icon="plus" onClick={() => input.current.click()}>{many ? '再加几张' : '换一张'}</Btn>
        <span className="grow" />
        {srcs.length > 1 ? <span className="t-detail-xs">{srcs.length} 张 · 按同样的设置逐张处理</span> : null}
      </div>
      {picker}
    </section>;
  }

  /* ---------- 选项 ---------- */
  function EsrganCard() {
    const app = useApp();
    const s = useStore();
    if (s.esrgan === 'ready') return null;
    const install = () => {
      store.esrgan = 'installing';
      store.installPct = 0;
      emit();
      clearInterval(store.installTimer);
      store.installTimer = setInterval(() => {
        store.installPct = Math.min(100, store.installPct + 10);
        // 演示挡位「下载失败」：到一半时按校验不过失败
        if (store.installFail && store.installPct >= 50) { clearInterval(store.installTimer); store.esrgan = 'failed'; store.installFail = false; emit(); return; }
        if (store.installPct >= 100) { clearInterval(store.installTimer); store.esrgan = 'ready'; app.toast('Real-ESRGAN 已就绪 · v0.2.5.0', 'positive'); }
        emit();
      }, 150);
    };
    const stop = () => { clearInterval(store.installTimer); store.esrgan = 'missing'; emit(); };
    return <section className="vw__sec ie__tool">
      <div className="vw__sechd"><b className="grow">放大要用 Real-ESRGAN</b><Chip>第一次使用</Chip></div>
      <span className="t-detail">开源的超分辨率程序，在这台电脑的显卡上运行，不联网、不上传图片。BaoCut 下载一份放在自己的工具目录里，不改系统里的东西，以后在设置 › 外部工具里可以删除。</span>
      <dl className="ie__facts t-detail-xs">
        <dt>版本</dt><dd>v0.2.5.0（ncnn · Vulkan，macOS 走 Metal）</dd>
        <dt>大小</dt><dd>49.4 MB（含照片与动画两种模型）</dd>
        <dt>许可</dt><dd>BSD-3-Clause</dd>
        <dt>来源</dt><dd className="t-mono t-truncate">github.com/xinntao/Real-ESRGAN/releases</dd>
      </dl>
      {s.esrgan === 'failed' ? <div className="hint hint--warn">下载的文件和记录的 SHA-256 对不上，已经删掉，没有安装。可能是网络中途断了或被替换：再下一次，或在设置 › 外部工具里换下载镜像。</div> : null}
      {s.esrgan === 'installing'
        ? <div className="row"><span className="t-detail-xs grow">下载并校验中… {s.installPct}%</span><Progress value={s.installPct} thin /><Btn variant="quiet" size="s" onClick={stop}>取消</Btn></div>
        : <div className="row"><Btn variant="accent" size="s" icon="download" onClick={install}>{s.esrgan === 'failed' ? '重新下载' : '下载并安装'}</Btn><span className="t-detail-xs">下载后按 SHA-256 校验</span></div>}
    </section>;
  }

  function UpscaleOptions({f, set, src}) {
    return <section className="vw__sec">
      <div className="vw__sechd"><span className="t-section grow">画面是哪一类</span></div>
      <BCChoiceGroup className="vw__cards" value={f.model} onChange={(model) => set({model})} aria-label="画面类型">
        {E.UPSCALE_MODELS.map((m) => <BCAction key={m.k} type="button" choiceKey={m.k} className={cx('vcard', f.model === m.k && 'is-on')}>
          <b>{m.name}</b><span>{m.sub}</span>
        </BCAction>)}
      </BCChoiceGroup>
      <div className="vw__row">
        <span className="vw__lab">倍数</span>
        <Segmented size="s" value={String(f.scale)} onChange={(k) => set({scale: Number(k)})} items={E.SCALES.map((k) => ({k: String(k), label: `${k}×`}))} />
        {src ? <span className="t-detail-xs">{E.upscaleSize(src, f.scale, f.model).width}×{E.upscaleSize(src, f.scale, f.model).height}</span> : null}
      </div>
      <span className="t-detail-xs vw__indent">{E.needsResize(f.model, f.scale)
        ? `照片模型先放大 4 倍，再缩到 ${f.scale} 倍（Lanczos），细节比直接拉伸多。`
        : '模型原生就是这个倍数。'}超分是对细节的估计：文字和界面截图可能被「画」出不存在的笔画。</span>
    </section>;
  }

  /** 能改图的图像模型（生成图片里 `caps.edit` 的那几只），给 ToolModelRow 用 */
  function editModels(engines) {
    return engines.filter((e) => e.family !== 'agent').flatMap((e) => e.models.filter((m) => m.caps.edit).map((m) => ({
      id: m.id, label: e.family === 'local' ? e.name : `${e.name} · ${m.model}`, local: e.family === 'local', ok: e.ready})));
  }

  function MethodOptions({op, f, set, models}) {
    const o = E.opById(op);
    return <>
      {o.methods.length > 1 ? <section className="vw__sec">
        <div className="vw__sechd"><span className="t-section grow">怎么补</span></div>
        <BCChoiceGroup className="vw__cards" value={f.method} onChange={(method) => set({method})} aria-label="补法">
          {o.methods.map((k) => <BCAction key={k} type="button" choiceKey={k} className={cx('vcard', f.method === k && 'is-on')}>
            <b>{E.METHODS[k].name}</b><span>{E.METHODS[k].sub}</span>
          </BCAction>)}
        </BCChoiceGroup>
      </section> : null}
      {op === 'repaint' || op === 'expand' ? <section className="vw__sec">
        <div className="vw__sechd"><span className="t-section grow">{op === 'repaint' ? '改成什么' : '新增的部分画什么'}</span>
          {op === 'expand' ? <span className="t-detail-xs">可以不写</span> : null}</div>
        <Field area value={f.prompt} onChange={(e) => set({prompt: e.target.value})} aria-label={op === 'repaint' ? '改成什么' : '新增的部分画什么'}
          placeholder={op === 'repaint' ? '例如：换成一只趴着的橘猫；把天空改成黄昏' : '不写时接着原图的场景往外画；也可以写「左边加一扇窗」'} />
      </section> : null}
      {f.method === 'model' ? <window.ToolModelRow label="用哪个图像模型" models={models} value={f.engine} onChange={(engine) => set({engine})}
        settings={{r: 'models', sec: 'image'}}>
        <span className="t-detail-xs">{op === 'expand'
          ? '把原图放进新画布、新增的部分交给模型画，原图那一块原样贴回。'
          : '只把选区周围的一块送去修补，回来后只贴回选区，选区之外的像素保持原样。'}
          {(models.find((m) => m.id === f.engine) || {}).local ? '本机模型在这台电脑上运行，不上传。' : '云端模型会收到这一块画面，服务商可能留副本。'}</span>
      </window.ToolModelRow> : null}
    </>;
  }

  function ExpandOptions({f, set, src}) {
    const plan = src ? E.expandPlan(src, f) : null;
    const m = f.margins;
    return <section className="vw__sec">
      <div className="vw__sechd"><span className="t-section grow">扩到多大</span></div>
      <div className="vw__chips">
        {E.RATIOS.map((r) => <Chip key={r.k} pill on={f.ratio === r.k} onClick={() => set({ratio: r.k})}>{r.label}</Chip>)}
      </div>
      {f.ratio === 'free' ? <div className="ie__margins">
        {[['left', '左'], ['right', '右'], ['top', '上'], ['bottom', '下']].map(([k, label]) => (
          <span key={k} className="vw__row"><span className="vw__lab">{label}边</span>
            <NumField value={m[k]} onChange={(v) => set({margins: Object.assign({}, m, {[k]: v})})} min={0} max={100} step={5} digits={0} unit="%" label={`${label}边扩多少`} /></span>
        ))}
      </div> : <div className="vw__row">
        <span className="vw__lab">原图放在</span>
        <window.RSP.RadioGroup aria-label="原图放在哪" value={f.anchor} onChange={(a) => set({anchor: a})} UNSAFE_className="ie__anchors">
          {E.ANCHORS.map((a) => <window.RSP.Radio key={a} value={a} aria-label={E.ANCHOR_LABEL[a]} />)}
        </window.RSP.RadioGroup>
        <span className="t-detail-xs">只往缺的方向加，不裁原图</span>
      </div>}
      {plan && plan.staged ? <div className="hint hint--warn">一边扩出超过原图一倍：建筑线条、地平线容易接不上。可以先扩一半，看了结果再扩一次。</div> : null}
    </section>;
  }

  /* ---------- 任务队列 ---------- */
  function JobCard({r}) {
    const app = useApp();
    const o = E.opById(r.form.op);
    const state = {done: '刚刚', running: r.phase || '进行中', queued: '排队中', canceled: '已取消', error: '失败'}[r.status];
    return <div className={cx('vrec', r.status === 'running' && 'is-running', r.status === 'error' && 'is-bad', r.status === 'canceled' && 'is-off')}>
      <div className="vrec__hd">
        <Ic n="image" className="ic--16 vrec__ic" />
        <b className="t-title-sm t-truncate grow">{r.name}</b>
        <span className="t-detail-xs">{state}</span>
      </div>
      <span className="t-detail-xs">{o.name} · {E.jobMeta(r)}{r.engine ? ` · ${r.engine}` : ''}</span>
      {r.status === 'running' ? <div className="vrec__busy">
        <div className="row"><span className="t-detail-xs grow">{r.pct}%</span><Btn variant="quiet" size="s" onClick={() => cancel(app, r)}>取消</Btn></div>
        <Progress value={r.pct} thin />
      </div> : null}
      {r.status === 'queued' ? <div className="row"><span className="t-detail-xs grow">本机一次跑一条</span><Btn variant="quiet" size="s" onClick={() => cancel(app, r)}>取消</Btn></div> : null}
      {r.status === 'done' && r.entry ? <window.ToolOutputRow entry={r.entry} fromTool={r.form.op} compact /> : null}
      {r.status === 'error' ? <div className="vfail">
        <b className="t-title-sm">{r.fail.title}</b>
        <span className="t-detail">{r.fail.line}</span>
        <code className="vfail__ev t-mono">{r.fail.evidence}</code>
        <div className="vrec__acts">
          <Btn variant="accent" size="s" icon="refresh" onClick={() => { patch(r.id, {status: 'queued', pct: 0, fail: null}); pump(app); }}>再试一次</Btn>
          {r.form.method === 'model' && r.form.op !== 'upscale' ? <Btn variant="secondary" size="s"
            onClick={() => app.go({r: 'tools', id: r.form.op})}>换个模型</Btn> : null}
          <span className="t-detail-xs t-mono">{r.fail.code}</span>
        </div>
      </div> : null}
    </div>;
  }
  function JobList() {
    const s = useStore();
    const busy = s.list.filter((r) => r.status === 'running' || r.status === 'queued').length;
    return <aside className="vw__side">
      <div className="vw__sidehd">
        <span className="t-title-sm grow">任务队列</span>
        {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{s.list.length} 条</span>}
      </div>
      {s.list.length ? s.list.map((r) => <JobCard key={r.id} r={r} />)
        : <Empty icon="tasks" title="还没有处理过">选好图片、按下按钮，进度会出现在这里。</Empty>}
      <div className="t-detail-xs vw__sidefoot">每张结果是保存位置里的一个 PNG、Space 里的一个图片条目，原图不动；重名时加序号。五个图片工具共用一条队列，本机一次跑一条。交互演示不落真文件。</div>
    </aside>;
  }

  /* ---------- 页面 ---------- */
  function ImageEditPage({op}) {
    const app = useApp();
    const s = useStore();
    const o = E.opById(op);
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const engines = window.useImageEngines(app);
    const models = editModels(engines);
    const [srcs, setSrcsState] = useState(store.drafts.srcs);
    const [f, setF] = useState(() => store.drafts.forms[op] || E.blank(op, models.some((m) => m.ok)));
    const [sel, setSelState] = useState(() => store.drafts.sels[op] || {strokes: [], boxes: []});
    const [tried, setTried] = useState(false);
    const goRef = useRef(null);
    const set = (p) => setF((cur) => { const next = Object.assign({}, cur, p); store.drafts.forms[op] = next; return next; });
    // 单张的工具（去除、重绘、扩图）只取第一张；从批量工具切过来时多出来的留在草稿里，切回去还在
    const mine = E.opById(op).batch ? srcs : srcs.slice(0, 1);
    const setSrcs = (list) => { store.drafts.srcs = list; setSrcsState(list); setSelState({strokes: [], boxes: []}); store.drafts.sels[op] = null; };
    const setSel = (next) => { store.drafts.sels[op] = next; setSelState(next); };
    // 模型缺省取第一只就绪的
    useEffect(() => { if (!f.engine || !models.some((m) => m.id === f.engine)) { const m = models.find((x) => x.ok) || models[0]; if (m) set({engine: m.id}); } }, [models.length]);
    window.BC_TOOL_FRAME.useToolPreset(op, (p) => {
      if (p.params && p.params.form) { setF(Object.assign(E.blank(op), p.params.form)); if (p.params.src) setSrcs([p.params.src]); }
      else if (p.entry) setSrcs([fromEntry(p.entry)]);
      if (p.retryOf) app.toast(`上次没做完：${p.retryOf.error || '失败'}。设置已带回来，改一下再试。`);
    });
    const model = models.find((m) => m.id === f.engine) || null;
    const ctx = {esrgan: s.esrgan, taken: (app.spaceItems || []).map((x) => x.name),
      modelReason: f.method === 'model' ? window.BC_TOOL_FRAME.modelReason(models, f.engine, '能改图的图像模型') : null};
    const status = E.statusLine(f, mine, sel, ctx, tried);
    const errs = E.problems(f, mine, sel, ctx);
    const go = () => {
      setTried(true);
      if (errs.length) { app.toast(errs[0]); return; }
      enqueue(app, f, mine, sel, save.dir, f.op === 'upscale' ? 'Real-ESRGAN' : f.method === 'model' && model ? model.label : null);
      setTried(false);
    };
    goRef.current = go;
    useEffect(() => {
      const key = (ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); goRef.current(); } };
      window.addEventListener('keydown', key);
      return () => window.removeEventListener('keydown', key);
    }, []);
    const local = op === 'upscale' || f.method === 'fill' || (model && model.local);
    const chip = local ? '在这台电脑上处理 · 不上传'
      : !model ? '要选一个图像模型'
      : mine[0] && E.sendsWhole(op, sel, mine[0]) ? '整张图会发给云端模型' : '选区附近的一块会发给云端模型';
    const bar = <>
      <span className={cx('t-detail pagenav__note', status.bad && 'vw__err')} title={status.text}>{status.text}</span>
      <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
      <Btn variant="accent" icon="image" onClick={go}>{o.verb}</Btn>
    </>;
    return (
      <window.Page wide title={o.name} bar={bar} actions={<Chip icon={local ? 'lock' : 'web'}>{chip}</Chip>}>
        <div className="vw">
          <div className="vw__main">
            <R.SegmentedControl aria-label="图片工具" selectedKey={op} onSelectionChange={(id) => { if (id !== op) app.go({r: 'tools', id}); }}>
              {E.OPS.map((x) => <R.SegmentedControlItem key={x.id} id={x.id}>{x.label}</R.SegmentedControlItem>)}
            </R.SegmentedControl>
            <span className="t-detail ie__lede">{o.desc}。</span>
            {op === 'upscale' ? <EsrganCard /> : null}
            <Sources op={op} srcs={mine} setSrcs={setSrcs} />
            {mine[0] ? <section className="vw__sec"><window.ImageEditCanvas op={op} src={mine[0]} sel={sel} setSel={setSel} form={f} set={set} others={mine.slice(1)} /></section> : null}
            {op === 'upscale' ? <UpscaleOptions f={f} set={set} src={mine[0]} /> : null}
            {op === 'expand' ? <ExpandOptions f={f} set={set} src={mine[0]} /> : null}
            {op !== 'upscale' ? <MethodOptions op={op} f={f} set={set} models={models} /> : null}
            <window.ToolSaveDirRow save={save} note="每张结果是保存位置里的一个 PNG、Space 里的一个图片条目；原图不动，重名时加序号。" />
            <BCDisclosure className="import-demo" title={<> 原型演示场景 </>}>
              <div className="vdemo">
                <label>
                  Real-ESRGAN
                  <BCSelect aria-label="Real-ESRGAN 演示状态" value={s.esrgan === 'ready' ? 'ready' : 'missing'} onChange={(e) => { store.esrgan = e.target.value; emit(); }}>
                    <option value="missing">还没下载</option>
                    <option value="ready">已就绪 · v0.2.5.0</option>
                  </BCSelect>
                </label>
                <label>
                  下载 Real-ESRGAN
                  <BCSelect aria-label="下载演示挡位" value={s.installFail ? 'fail' : 'ok'} onChange={(e) => { store.installFail = e.target.value === 'fail'; emit(); }}>
                    <option value="ok">校验通过</option>
                    <option value="fail">校验不过</option>
                  </BCSelect>
                </label>
                <label>
                  下一条的结果
                  <BCSelect aria-label="运行结果演示挡位" value={s.outcome} onChange={(e) => { store.outcome = e.target.value; emit(); }}>
                    <option value="ok">成功</option>
                    <option value="fail">失败</option>
                  </BCSelect>
                </label>
              </div>
            </BCDisclosure>
          </div>
          <JobList />
        </div>
      </window.Page>
    );
  }

  Object.assign(window, {ImageEditPage, BC_IMAGE_EDIT_QUEUE: {store}});
})();
