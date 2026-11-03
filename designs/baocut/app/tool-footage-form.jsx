/* 工具 › 素材处理的表单块（product-design §2.7「页面」的骨架：输入 → 选项 → 保存位置 → 开始；规则在 model-footage.js）：
   - `FootageSources`：拖进来、选文件或从 Space 里选，1–20 个，按同样的设置逐个处理；
   - `FootageRange`：只处理一段（同流程的 start、end，每个文件取同一段；图片不收，分轨没有）；
   - `FootageOptions`：五种处理与分轨各自的参数（FootageParams、SeparateAudioParams）；
   - `FootageToolCard`：受管工具第一次用的下载同意（来源、版本、大小、许可，点了才下；IS-Net 先确认许可）；
   - `FootageLoad`：这一次多少帧、要多久、占多少磁盘，长素材时提醒只处理用到的一段。 */
(function () {
  const {useState, useRef} = React;
  const F = window.BC_FOOTAGE;
  const Q = window.BC_FOOTAGE_QUEUE;
  const D = window.BC_DATA;

  const ACCEPT = {video: 'video/*,.mkv,.m2ts,.mts,.ts,.flv,.wmv', image: '.png,.jpg,.jpeg,.webp', audio: 'audio/*'};
  const SOURCE_IC = {video: 'film', image: 'image', audio: 'wave'};

  /** 本机文件 → 输入的描述：图片真读像素，音视频真读时长与尺寸（帧率浏览器给不出，按 30 fps 记，真实页面走 ffprobe） */
  function readFile(file) {
    if (/^image\//.test(file.type)) {
      return new Promise((done) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => done({kind: 'image', name: file.name, path: file.name, url, width: img.naturalWidth, height: img.naturalHeight, bytes: file.size});
        img.onerror = () => done(null);
        img.src = url;
      });
    }
    const audio = /^audio\//.test(file.type) || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
    return window.videoProbeFile(file).then((s) => Object.assign(s, {kind: audio ? 'audio' : 'video', width: s.width || 1920, height: s.height || 1080}));
  }

  /* ---------- 输入 ---------- */
  function FootageSources({id, f, srcs, setSrcs}) {
    const app = useApp();
    const o = F.opById(id);
    const input = useRef(null);
    const [space, setSpace] = useState(false);
    const [over, setOver] = useState(false);
    const accept = o.accepts.map((k) => ACCEPT[k]).join(',');
    const add = (list) => {
      const room = F.MAX_INPUTS - srcs.length;
      if (list.length > room) app.toast(`一次最多 ${F.MAX_INPUTS} 个，多出来的没有加进来`);
      if (room > 0) setSrcs(srcs.concat(list.slice(0, room)));
    };
    const take = (files) => Promise.all(Array.from(files || []).map(readFile)).then((list) => {
      const ok = list.filter((s) => s && o.accepts.indexOf(s.kind) >= 0);
      if (ok.length < list.length) app.toast(`这个工具只收${F.acceptText(o)}`);
      if (ok.length) add(ok);
    });
    const picker = <input ref={input} type="file" accept={accept} multiple hidden
      onChange={(e) => { const list = Array.prototype.slice.call(e.target.files || []); e.target.value = ''; take(list); }} />;
    const spaceRow = space ? <div className="vw__space">
      <window.ToolSpacePicker tool={id} value={null} onChange={(entry) => { setSpace(false); add([F.fromEntry(entry)]); }} />
      <BCAction className="viewall" onClick={() => setSpace(false)}>收起</BCAction>
    </div> : <BCAction className="viewall" onClick={() => setSpace(true)}>从 Space 里选…</BCAction>;
    if (!srcs.length) {
      return <section className="vw__sec">
        <div className={cx('vdrop', over && 'is-over')} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
          <Ic n={o.ic} className="ic--26 vdrop__ic" />
          <b className="t-title-sm">{`把${F.acceptText(o)}拖进来`}</b>
          <span className="t-detail">一次最多 {F.MAX_INPUTS} 个，按同样的设置逐个处理。原文件不会被改动。</span>
          <Btn variant="secondary" size="s" icon="folder" onClick={() => input.current.click()}>选择文件…</Btn>
        </div>
        {spaceRow}
        <BCAction className="viewall" onClick={() => add([F.samplesFor(id)[0].src])}>用示例素材试试（原型演示）</BCAction>
        {picker}
      </section>;
    }
    return <section className="vw__sec">
      <div className="fg__srcs bc-scroll">
        {srcs.map((s, i) => <div key={`${s.name}-${i}`} className="vsrc">
          <span className="vsrc__ic"><Ic n={SOURCE_IC[s.kind] || 'film'} className="ic--22" /></span>
          <span className="vsrc__txt">
            <b className="t-title-sm t-truncate">{s.name}</b>
            <span className="t-detail-xs">{F.sourceLine(f, s)}</span>
          </span>
          <IconBtn icon="close" size="s" tip="移出" onClick={() => setSrcs(srcs.filter((_, j) => j !== i))} />
        </div>)}
      </div>
      <div className="row gap8">
        <Btn variant="quiet" size="s" icon="plus" onClick={() => input.current.click()}>再加几个</Btn>
        <span className="grow" />
        {srcs.length > 1 ? <span className="t-detail-xs">{srcs.length} 个 · 按同样的设置逐个处理</span> : null}
      </div>
      {spaceRow}
      {picker}
    </section>;
  }

  /* ---------- 只处理一段 ---------- */
  const QUICK = [{k: 10, label: '前 10 秒'}, {k: 60, label: '前 1 分钟'}, {k: 300, label: '前 5 分钟'}];
  function FootageRange({f, set, srcs}) {
    const videos = srcs.filter((s) => s.kind === 'video');
    if (!videos.length) return null;
    const on = !!f.ranged;
    const one = videos.length === 1 ? F.planOf(f, videos[0]) : null;
    const pick = (k) => set(k === 'part' ? {ranged: true} : {ranged: false});
    return <section className="vw__sec">
      <div className="vw__sechd"><span className="t-section grow">处理哪一段</span>
        <Segmented size="s" value={on ? 'part' : 'all'} onChange={pick} items={[{k: 'all', label: '整段'}, {k: 'part', label: '其中一段'}]} /></div>
      {on ? <>
        <div className="vw__row">
          <span className="vw__lab">从</span>
          <NumField value={f.start} onChange={(v) => set({start: v})} min={0} step={1} digits={1} unit="秒" tip="从第几秒开始" />
          <span className="vw__lab fg__to">到</span>
          <NumField value={f.end} onChange={(v) => set({end: v})} min={0} step={1} digits={1} unit="秒" tip="到第几秒结束" />
          <div className="vw__chips">{QUICK.map((q) => <Chip key={q.k} pill on={f.start === 0 && f.end === q.k} onClick={() => set({start: 0, end: q.k})}>{q.label}</Chip>)}</div>
        </div>
        <span className="t-detail-xs vw__indent">{videos.length > 1 ? '每个文件都取同一段。' : `${F.timecode(one.seconds)} · ${F.count(one.frames)} 帧。`}时间是源文件里的秒，结束晚于文件时截到末尾。</span>
      </> : <span className="t-detail">整段处理。一个文件里有几个镜头、或者时间线上只用到一部分时，只处理用到的那一段。</span>}
    </section>;
  }

  /* ---------- 卡片式单选 ---------- */
  function Cards({label, items, value, onChange, two}) {
    return <BCChoiceGroup className={cx('vw__cards', two && 'fg__cards--two')} value={value} onChange={onChange} aria-label={label}>
      {items.map((x) => <BCAction key={x.k} type="button" choiceKey={x.k} className={cx('vcard', value === x.k && 'is-on')}><b>{x.name}</b><span>{x.sub}</span></BCAction>)}
    </BCChoiceGroup>;
  }
  const Sec = ({title, aside, children}) => <section className="vw__sec">
    <div className="vw__sechd"><span className="t-section grow">{title}</span>{aside}</div>
    {children}
  </section>;

  /* ---------- 五种处理与分轨的参数 ---------- */
  function StabilizeOptions({f, set}) {
    const s = Q.useStore();
    return <Sec title="去抖强度">
      <div className="vw__row">
        <span className="vw__lab">强度</span>
        <Segmented size="s" value={f.strength} onChange={(k) => set({strength: k})} items={F.STRENGTHS} />
      </div>
      <span className="t-detail-xs vw__indent">越强越稳，裁掉的画面也越多。声音保留。</span>
      {s.vidstab ? <span className="t-detail-xs vw__indent">这个 ffmpeg 带 vid.stab：先检测、再变换，走两遍。</span>
        : <div className="hint hint--warn">{F.DESHAKE_BEFORE}</div>}
    </Sec>;
  }

  function UpscaleOptions({f, set, srcs}) {
    const video = srcs.find((s) => s.kind === 'video');
    const p = video ? F.planOf(f, video) : null;
    return <Sec title="放大多少">
      <div className="vw__row">
        <span className="vw__lab">倍数</span>
        <Segmented size="s" value={String(f.scale)} onChange={(k) => set({scale: Number(k)})} items={F.SCALES.map((k) => ({k: String(k), label: `${k}×`}))} />
        {p ? <span className="t-detail-xs">{p.outWidth}×{p.outHeight}</span> : null}
      </div>
      <Cards label="权重" items={F.UPSCALE_MODELS} value={f.model} onChange={(model) => set({model})} />
      <span className="t-detail-xs">{F.upscaleNote(f)}超分是对细节的估计，不能找回真实细节：文字和人脸可能变形。声音照搬，输出 H.264。</span>
    </Sec>;
  }

  function InterpolateOptions({f, set, srcs}) {
    const video = srcs.find((s) => s.kind === 'video');
    const p = video ? F.planOf(f, video) : null;
    return <Sec title="插成什么">
      <Cards label="方式" items={F.MODES} value={f.mode} onChange={(mode) => set({mode})} />
      <div className="vw__row">
        <span className="vw__lab">倍数</span>
        <Segmented size="s" value={String(f.factor)} onChange={(k) => set({factor: Number(k)})} items={F.FACTORS.map((k) => ({k: String(k), label: `${k}×`}))} />
        {p ? <span className="t-detail-xs">{f.mode === 'slowmo' ? `${p.outFps} fps · ${F.timecode(p.seconds)} → ${F.timecode(p.outSeconds)}` : `${p.fps} → ${p.outFps} fps · 时长不变`}</span> : null}
      </div>
      <span className="t-detail-xs">跨硬切的两帧会被插出重影：一个文件里有几个镜头时，按镜头分别处理。</span>
    </Sec>;
  }

  /** 统一色调的参考：图片或视频；可以直接用上面选的素材之一 */
  function MatchColorOptions({f, set, srcs}) {
    const input = useRef(null);
    const [space, setSpace] = useState(false);
    const ref = f.reference;
    const others = srcs.filter((s) => !ref || s.name !== ref.name).slice(0, 4);
    const pick = (src) => { setSpace(false); set({reference: src, referenceAt: null}); };
    return <>
      <Sec title="对齐到哪一张参考" aside={<span className="t-detail-xs">必选</span>}>
        {ref ? <div className="vsrc">
          <span className="vsrc__ic"><Ic n={SOURCE_IC[ref.kind] || 'film'} className="ic--22" /></span>
          <span className="vsrc__txt">
            <b className="t-title-sm t-truncate">{ref.name}</b>
            <span className="t-detail-xs">{ref.kind === 'image' ? `图片 · ${ref.width}×${ref.height}` : `视频文件 · ${F.timecode(ref.seconds)} · ${ref.width}×${ref.height}`}</span>
          </span>
          <Btn variant="quiet" size="s" onClick={() => input.current.click()}>换一个</Btn>
          <IconBtn icon="close" size="s" tip="移出" onClick={() => set({reference: null, referenceAt: null})} />
        </div> : <div className="row gap8">
          <Btn variant="secondary" size="s" icon="folder" onClick={() => input.current.click()}>选择参考…</Btn>
          <BCAction className="viewall" onClick={() => setSpace((v) => !v)}>{space ? '收起' : '从 Space 里选…'}</BCAction>
        </div>}
        {space ? <div className="vw__space"><window.ToolSpacePicker tool="match-color" label="选一张参考" value={null} onChange={(entry) => pick(F.fromEntry(entry))} /></div> : null}
        {!ref && others.length ? <div className="vw__chips"><span className="t-detail-xs">用这几个里的一个：</span>{others.map((s) => <Chip key={s.name} pill onClick={() => pick(s)}>{s.name}</Chip>)}</div> : null}
        {ref && ref.kind === 'video' ? <div className="vw__row">
          <span className="vw__lab">取哪一刻</span>
          <NumField value={f.referenceAt} onChange={(v) => set({referenceAt: v})} onEmpty={() => set({referenceAt: null})} min={0} max={ref.seconds || undefined} step={1} digits={1} unit="秒" placeholder={(ref.seconds / 2).toFixed(1)} tip="参考是视频时取哪一秒" />
          <span className="t-detail-xs">不填时取中点。</span>
        </div> : null}
        <input ref={input} type="file" accept={`${ACCEPT.video},${ACCEPT.image}`} hidden
          onChange={(e) => { const file = e.target.files[0]; e.target.value = ''; if (file) readFile(file).then((s) => { if (s) pick(s); }); }} />
      </Sec>
      <Sec title="怎么对齐">
        <Cards label="方法" two items={F.METHODS} value={f.method} onChange={(method) => set({method})} />
        <div className="vw__row">
          <span className="vw__lab">强度</span>
          <Slider className="grow" value={f.amount} min={0} max={1} step={0.05} formatOptions={{style: 'percent'}} onChange={(amount) => set({amount})} label="和原色的混合比例" />
        </div>
        <span className="t-detail-xs vw__indent">效果过头时降到 50–80%。这是烧进新文件的处理，不是时间线上可调的效果；只调颜色，不修曝光不足丢掉的细节。一个文件里有几个镜头时按镜头分别处理，否则取样会把几个镜头混在一起。</span>
      </Sec>
    </>;
  }

  function RemoveBackgroundOptions({f, set, srcs}) {
    Q.useStore();
    const hasVideo = srcs.some((s) => s.kind === 'video') || !srcs.length;
    // 许可说明：还没下载时写在下载卡上，装好之后写在这里，不重复
    const licensed = f.matteModel === 'general' && Q.toolStates()[F.MATTE_ISNET] === 'ready';
    return <Sec title="用哪套权重">
      <Cards label="抠像权重" items={F.MATTE_MODELS} value={f.matteModel} onChange={(matteModel) => set({matteModel})} />
      {licensed ? <div className="hint hint--warn">{F.LICENSE_NOTE}</div> : null}
      {hasVideo ? <div className="vw__row">
        <span className="vw__lab">压住闪烁</span>
        <Slider className="grow" value={f.temporal} min={0} max={0.95} step={0.05} formatOptions={{style: 'percent'}} onChange={(temporal) => set({temporal})} label="和上一帧混合的比例" />
      </div> : null}
      {hasVideo ? <span className="t-detail-xs vw__indent">和上一帧混合的比例，边缘闪烁时调高；图片不用。</span> : null}
      <span className="t-detail-xs">不用绿幕，但只认显著的主体。只在 CPU 上推理。视频输出带透明的 ProRes 4444 MOV，文件很大；图片输出 PNG。</span>
    </Sec>;
  }

  /** 分轨的模型：有装好的就是平常的模型行；一只都没有时就地下载（走本机模型的下载确认框） */
  function SeparateOptions({f, set, models}) {
    const app = useApp();
    const usable = models.filter((m) => m.ok);
    const first = D.setModels.find((m) => m.cat === 'sep');
    const pct = first ? app.modelDl[first.id] : null;
    const cur = models.find((m) => m.id === f.sepModel) || null;
    const four = f.stems === 'four' && cur && cur.ok && !F.canFourStems(cur);
    return <>
      {usable.length ? <window.ToolModelRow label="用哪个分离模型" models={models} value={f.sepModel} onChange={(sepModel) => set({sepModel})} settings={{r: 'models', sec: 'sep'}}>
        <span className="t-detail-xs">本机模型在这台电脑上运行，不上传。</span>
      </window.ToolModelRow> : first ? <section className="vw__sec fg__tool">
        <div className="vw__sechd"><b className="grow">要先下载 {first.name}</b><Chip>第一次使用</Chip></div>
        <span className="t-detail">{first.note}，翻译配音用的也是它。{(first.license && first.license.summary) || ''}。</span>
        <div className="row gap8">
          {pct == null ? <Btn variant="accent" size="s" icon="download" onClick={() => window.withModelLicense(app, first.id, () => app.downloadModel(first.id))}>下载 {first.size} MB</Btn>
            : <><span className="t-detail-xs grow">下载中… {pct}%</span><Progress value={pct} thin /></>}
          <BCAction className="viewall" onClick={() => app.go({r: 'models', sec: 'sep'})}>管理分离模型…</BCAction>
        </div>
      </section> : null}
      <Sec title="拆成几轨">
        <Cards label="拆成几轨" items={F.STEMS} value={f.stems} onChange={(stems) => set({stems})} />
        {four ? <div className="hint hint--warn">{cur.label} 只能把人声和其余部分分开；要鼓、贝斯与其他请选 HTDemucs 模型。</div> : null}
        <span className="t-detail-xs">只取第一条音轨。翻译配音已经自带分离，不用先分轨；按鼓点剪时对 -drums.wav 分析节拍，比分析混音更准。</span>
      </Sec>
    </>;
  }

  function FootageOptions({id, f, set, srcs, models}) {
    const op = F.opById(id).op;
    if (op === 'stabilize') return <StabilizeOptions f={f} set={set} />;
    if (op === 'upscale') return <UpscaleOptions f={f} set={set} srcs={srcs} />;
    if (op === 'interpolate') return <InterpolateOptions f={f} set={set} srcs={srcs} />;
    if (op === 'match-color') return <MatchColorOptions f={f} set={set} srcs={srcs} />;
    if (op === 'remove-background') return <RemoveBackgroundOptions f={f} set={set} srcs={srcs} />;
    return <SeparateOptions f={f} set={set} models={models} />;
  }

  /* ---------- 第一次用：下载同意 ---------- */
  /** 这一次要的受管工具没装好时的卡：用户点了才下。`name` 变了（换了权重）确认要重新勾 */
  function FootageToolCard({f, set}) {
    const app = useApp();
    Q.useStore();
    const states = Q.toolStates();
    const name = F.toolsFor(f).find((t) => states[t] !== 'ready');
    const [agreed, setAgreed] = useState(null);
    if (!name) return null;
    const t = F.MANAGED[name];
    const state = states[name];
    const offline = app.prefs.strictOffline === true;
    const ok = !t.nonCommercial || agreed === name;
    return <section className={cx('vw__sec', 'fg__tool', t.nonCommercial && 'is-notice')}>
      <div className="vw__sechd"><b className="grow">要先下载 {t.name}</b><Chip>第一次使用</Chip></div>
      <span className="t-detail">{t.body}BaoCut 把它放在自己的工具目录里，不改系统里的东西，以后在设置 › 外部工具里可以删除。</span>
      <dl className="fg__facts t-detail-xs">
        <dt>版本</dt><dd>{t.version}</dd>
        <dt>大小</dt><dd>{t.size}</dd>
        <dt>许可</dt><dd>{t.license}</dd>
        <dt>来源</dt><dd className="t-mono t-truncate">{t.source}</dd>
        <dt>下载自</dt><dd><window.DownloadSourcePicker k="releases" label="工具的下载来源" /></dd>
      </dl>
      {state === 'failed' ? <div className="hint hint--warn">下载的文件和记录的 SHA-256 对不上，已经删掉，没有安装。可能是网络中途断了或被替换：再下一次，或者换一个下载来源。</div> : null}
      {t.nonCommercial && state !== 'installing' ? <>
        <div className="hint hint--warn">{F.LICENSE_NOTE}</div>
        <Checkbox on={agreed === name} onChange={(v) => setAgreed(v ? name : null)} label="我知道这套权重只能用于非商业的研究与教育" />
      </> : null}
      {offline ? <div className="row gap8"><span className="t-detail grow">严格离线打开着，不下载外部工具。</span><Btn variant="secondary" size="s" onClick={() => app.go({r: 'settings', sec: 'general'})}>去设置</Btn></div>
        : state === 'installing' ? <div className="fg__progress">
          <div className="row gap8">
            <span className="t-detail-xs grow">下载并校验中… {Q.installPct(name)}% · {Math.round((t.mb * Q.installPct(name)) / 100)} / {t.mb} MB · 离开这一页也会继续</span>
            <Btn variant="quiet" size="s" onClick={() => Q.stopInstall(app, name)}>取消</Btn>
          </div>
          <Progress value={Q.installPct(name)} thin />
        </div> : <div className="row gap8">
          <Btn variant="accent" size="s" icon="download" disabled={!ok} onClick={() => Q.install(app, name)}>{state === 'failed' ? '重新下载' : `下载并安装（${t.short}）`}</Btn>
          <span className="t-detail-xs grow">下载后按 SHA-256 校验</span>
          {t.nonCommercial ? <Btn variant="quiet" size="s" onClick={() => set({matteModel: 'fast'})}>换回「快」</Btn> : null}
          <BCAction className="viewall" onClick={() => Q.pickOwn(app, name)}>{t.pick}</BCAction>
        </div>}
    </section>;
  }

  /* ---------- 这一次要多久 ---------- */
  function FootageLoad({id, f, set, srcs}) {
    const s = Q.useStore();
    if (!srcs.length) return null;
    const o = F.opById(id);
    const w = F.workload(f, srcs, {vidstab: s.vidstab});
    const separate = o.op === 'separate';
    const video = w.hasVideo && !separate;
    const long = w.level !== 'ok';
    const canTry = long && video && !(f.ranged && f.start === 0 && f.end === 10);
    const first = w.plans.find((p) => p.kind === 'video' && !p.audioOnly) || null;
    const differs = o.op === 'interpolate' || o.op === 'upscale';
    return <section className={cx('vw__sec', long && 'fg__load--long')}>
      <div className="vw__sechd"><span className="t-section grow">这一次要多久</span>
        {canTry ? <Btn variant="secondary" size="s" onClick={() => set({ranged: true, start: 0, end: 10})}>先试 10 秒</Btn> : null}</div>
      <dl className="fg__stats">
        {separate ? <div className="fg__stat"><dt>要处理</dt><dd>{F.timecode(w.audioSeconds)}</dd><span className="t-detail-xs">{srcs.length} 个文件 · 得到 {srcs.length * F.stemsOf(f.stems).tracks.length} 个 WAV</span></div>
          : video ? <div className="fg__stat"><dt>要处理</dt><dd>{F.count(w.frames)} 帧</dd><span className="t-detail-xs">{srcs.length > 1 ? `${srcs.length} 个文件` : first ? `${F.timecode(first.seconds)} · ${first.fps} fps` : ''}</span></div>
            : <div className="fg__stat"><dt>要处理</dt><dd>{srcs.length} 张图片</dd></div>}
        {differs && first ? <div className="fg__stat"><dt>输出</dt><dd>{F.count(w.outFrames)} 帧</dd><span className="t-detail-xs">{first.outWidth}×{first.outHeight} · {first.outFps} fps · {F.timecode(w.outSeconds)}</span></div> : null}
        <div className="fg__stat"><dt>预计耗时</dt><dd className={long ? 'vw__err' : null}>{F.etaText(w.seconds)}</dd></div>
      </dl>
      <span className="t-detail-xs">结果约 {F.bytesText(w.outBytes)}，处理时另占约 {F.bytesText(w.scratch)} 临时空间。</span>
      {long ? <div className="hint hint--warn">{w.level === 'veryLong' ? '这一次要很久，电脑要一直开着才跑得完。' : '这一次要等一阵子。'}只处理真正用到的那一段，或者先试 10 秒看看效果。</div> : null}
      <span className="t-detail-xs">{o.op === 'remove-background' ? '按实测的每帧速度粗算，只在 CPU 上跑，别的电脑可能慢几倍。' : separate ? '按实测的分离速度粗算，别的电脑可能慢几倍。' : '这是粗算，不同的电脑可能差几倍。'}{separate ? '' : '开始后按实际速度更新；'}任务一次跑一条，离开这一页不中断。</span>
    </section>;
  }

  Object.assign(window, {FootageSources, FootageRange, FootageOptions, FootageToolCard, FootageLoad});
})();
