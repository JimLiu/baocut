/* 工具 › 转录（product-design §2.7 表二「转录」、S01）：从本机文件、Space 里的媒体或视频、一个链接开始。
   缺省不要求项目：文件、链接与 Space 里的媒体产出 `<源名>.txt` 与 `<源名>.srt` 两个条目，放在保存位置；
   「新建视频并放进项目」是可选的落点（与下载视频同一套目标）。Space 里的可编辑视频没有文稿时直接写进它；
   已有文稿时有「落点」一行（product-design §5.11、§2.7）：新建视频（默认，同项目、链接同一份素材）/ 取代这部视频的文稿
   （换用文稿，译文按原文配对结转，一笔可撤销）；用户改过原文时警告并默认新建视频。
   Space 的「重试转录…」带来失败那次的任务（§4.4）：顶部说明上次为什么失败，模型与语言等已预填。
   页面按统一骨架排（tool-frame.jsx）：输入 → 模型 → 选项 → 保存位置 → 开始。运行按步骤推进，是任务中心里的一条任务（tool-runs.jsx）。
   语音模型这一块（模型、语言、当场授权要发的数据、更多选项）重新转录也用（BC_ASR_FIELDS）。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const D = window.BC_DATA;
  const RUNS = window.BC_TOOL_RUNS;
  const TT = window.BC_TOOL_TARGETS;
  const SI = window.BC_TOOL_SPACE_INPUT;
  const drafts = {st: null};

  /** 选中的语音模型：是否在线、能不能用、名字，以及在线时要发的数据（交给当场授权） */
  function asrInfo(app, st, seconds) {
    const cloud = D.models.cloud.find((m) => m.id === st.model);
    const local = D.models.local.find((m) => m.id === st.model);
    const m = cloud || local;
    const provider = cloud ? window.BC_HOME_TOOLS.asrProvider(cloud) : null;
    const available = cloud ? app.cloudSaved.includes(provider) : !!local && app.modelInstalled(local.id);
    const modelName = m ? (cloud ? `${cloud.provider} · ${cloud.name} · 在线` : `${m.name} · 本机`) : '';
    const need = cloud ? RUNS.need({recipient: cloud.provider, data: 'audio', seconds: seconds || D.DUR || 206, price: cloud.price}) : null;
    return {m, cloud: !!cloud, available, modelName, need, lang: TT.langCode(st.lang) || 'zh'};
  }
  /** 语音模型清单：本机与云端放在同一张单子里（模型行，tool-frame.jsx） */
  const asrModels = (app) => D.models.local.map((m) => ({id: m.id, label: m.name, local: true, ok: app.modelInstalled(m.id)}))
    .concat(D.models.cloud.map((m) => ({id: m.id, label: `${m.provider} · ${m.name}`, local: false, ok: app.cloudSaved.includes(window.BC_HOME_TOOLS.asrProvider(m))})));

  /** 「识别说话人」此刻的样子（BC_TOOL_RUNS.speakerSwitch）；`pick` 是用户亲手拨的值，null = 没拨过 */
  const speakerState = (app, model, pick) => RUNS.speakerSwitch(model, pick, app.modelInstalled);

  /** 语音模型下面的「更多选项」：识别说话人。转录工具页与重新转录共用。
      模型自带区分（MOSS）开着锁住并写明「自带」；在线服务不区分的关着锁住；要「说话人区分」包的可拨，
      拨开了又没装就地给下载，下完就开着。折叠标题带当前状态，收起时也看得见为什么开始不了。 */
  function AsrMoreOptions({model, pick, onPick}) {
    const app = useApp();
    const s = speakerState(app, model, pick);
    const pack = D.setModels.find((x) => x.id === RUNS.DIARIZE_PACK);
    const copy = RUNS.speakerCopy(s, model ? model.name : '', pack);
    const pct = app.modelDl && app.modelDl[RUNS.DIARIZE_PACK];
    const downloading = pct !== undefined && pct < 100;
    return <BCDisclosure className="asrmore" title={<>更多选项 <span className="asrmore__sum">{copy.summary}</span></>}>
      <div className="asrmore__body">
        <Switch on={s.on} disabled={s.locked} onChange={onPick} label="识别说话人" />
        <span className="t-detail-xs">{copy.note}</span>
        {s.missing ? <div className="asrmore__gate t-detail-xs">
          <span className="grow">{downloading ? `正在下载「${pack.name}」· ${pct}%` : `${pack.name} · ${pack.size} MB`}</span>
          {downloading
            ? <Progress value={pct} thin className="asrmore__bar" />
            : <Btn variant="secondary" size="s" icon="download" onClick={() => app.downloadModel(RUNS.DIARIZE_PACK)}>下载</Btn>}
        </div> : null}
      </div>
    </BCDisclosure>;
  }

  /** 语音模型一行：本机与云端同一张单子、状态与要发的数据、转录语言、更多选项；没有可用模型时给「去设置」 */
  function AsrFields({st, set}) {
    const app = useApp();
    const info = asrInfo(app, st);
    return <window.ToolModelRow label="用哪个语音模型" models={asrModels(app)} value={st.model} onChange={(model) => set({model, lang: 'auto'})}
      settings={{r: 'models', sec: info.cloud ? 'cloud' : 'local', tab: 'stt'}}>
      {info.m && info.available && <span className="t-detail-xs">{info.cloud
        ? `${info.m.provider} · 音轨会发到这家服务${info.m.price ? ' · ' + info.m.price : ''}` : '在这台电脑上识别，不发送任何数据'}</span>}
      <span className="t-detail-xs">转录语言</span>
      <LanguageCombobox value={st.lang} asrModel={st.model} onChange={(lang) => set({lang})} />
      <AsrMoreOptions model={info.m} pick={st.speakers} onPick={(speakers) => set({speakers})} />
    </window.ToolModelRow>;
  }

  /** 新建视频落在哪：项目选择 + 素材怎么放（本机文件留在原处只做链接；链接下载到保存位置） */
  function CreateTarget({dir, onDir, link, transcribe = true}) {
    return <div className="tframe__sub">
      <window.ToolProjectPicker value={dir} onChange={onDir} />
      <span className="t-detail-xs">{link ? '媒体下载到保存位置，视频里链接它，不再复制一份。' : '素材留在原处，视频里只做链接，不复制文件。'}结果是这个项目里的一部新视频{link ? '，名字取页面标题' : ''}{transcribe ? '，带文稿和一条可编辑的字幕层' : '，下载的媒体放上时间线'}。</span>
    </div>;
  }

  /** 结果落点：缺省只生成文稿和字幕；可选新建视频并放进项目（BC_TOOLS.targetOptions） */
  function TargetField({st, set, dir}) {
    const opts = window.BC_TOOLS.targetOptions('transcribe');
    return <div className="ttsw__sec">
      <div className="ttsw__sechd"><b className="grow">结果</b></div>
      <R.RadioGroup aria-label="转录结果" value={st.target} onChange={(target) => set({target})}>
        {opts.map((o) => <R.Radio key={o.k} value={o.k}>{o.label}</R.Radio>)}
      </R.RadioGroup>
      {st.target === 'create'
        ? <CreateTarget dir={dir} onDir={(d) => set({dir: d})} link={st.source === 'link'} />
        : <span className="t-detail-xs">文稿（.txt）和字幕（.srt）保存在下面的位置，各是 Space 里的一个条目，以后可以拿去翻译、生成语音或新建视频。</span>}
    </div>;
  }

  /** 选「取代」时的影响预览（product-design §5.11）：每种译文一行、规则一句、pin 一行、配音一行、可以撤销 */
  function ReplaceImpact({movie}) {
    const im = TT.replaceImpact(movie);
    const row = (k, label, text) => <div className="ttx-impact__row" key={k}><span className="ttx-impact__k">{label}</span><span className="grow">{text}</span></div>;
    return <div className="ttx-impact">
      <b className="ttx-impact__hd">取代后会怎样</b>
      {im.translations.length ? im.translations.map((t) => row(`tr-${t.lang}`, '译文', t.line)) : row('tr', '译文', '这部视频没有译文')}
      {im.translations.length ? <span className="t-detail-xs">{im.rule}</span> : null}
      {im.pinLine ? row('pin', '字幕 pin', im.pinLine) : null}
      {im.dubs.map((d) => row(`dub-${d.lang}`, '配音', d.line))}
      <span className="t-detail-xs">{im.undo}</span>
    </div>;
  }

  /** 已有文稿的视频：落点单选（新建视频 / 取代这部视频的文稿），product-design §5.11 */
  function RetargetField({movie, rt, dest, onDest, name, onName}) {
    const app = useApp();
    const dirName = ((app.dirById && app.dirById(movie.dir)) || {}).name || '同一个项目';
    return <div className="ttsw__sec">
      <div className="ttsw__sechd"><b className="grow">落点</b></div>
      <R.RadioGroup aria-label="转录结果写到哪" value={dest} onChange={onDest}>
        {rt.options.map((o) => <R.Radio key={o.k} value={o.k}>{o.label}</R.Radio>)}
      </R.RadioGroup>
      {dest === 'new-video' ? <div className="tframe__sub">
        <R.TextField label="新视频的名字" value={name} onChange={onName} />
        <span className="t-detail-xs">新视频放在「{dirName}」里，链接同一份素材、不复制文件，带新文稿和一条可编辑的字幕层；「{movie.title}」和它的译文、字幕、配音不动。</span>
      </div> : <ReplaceImpact movie={movie} />}
    </div>;
  }

  /** 重试转录：上次失败的原因、上次用的模型与多久前（product-design §4.4） */
  function RetryAlert({task}) {
    const id = (task.params && task.params.model) || String(task.sub || '').split(' · ')[0];
    const m = D.models.local.concat(D.models.cloud).find((x) => x.id === id);
    return <R.InlineAlert variant="negative">
      <R.Heading>上次转录失败</R.Heading>
      <R.Content>{task.error || '没有记下失败原因'}。{['上次', m ? m.name : id, task.started].filter(Boolean).join(' · ')}。模型、语言和识别说话人已按上次填好，可以改了再开始。</R.Content>
    </R.InlineAlert>;
  }

  function TranscribeToolPage() {
    const app = useApp();
    const s = window.useToolRuns();
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const [st, setSt] = useState(() => Object.assign({source: 'file', file: null, url: '', entry: null, target: 'none', dir: null,
      lang: 'auto', model: 'moss-transcribe', speakers: null, retarget: null, newName: null, retryOf: null}, drafts.st || {}));
    const set = (patch) => setSt((x) => Object.assign({}, x, patch));
    /* 从 Space 查看器「用工具处理…」或结果页「接着用工具」带来的条目：切到 Space 并选好它 */
    /* 「再做一次 / 重试」带回的参数先填回表单 */
    /* 「重试转录…」带来失败的任务（retryOf）；「再做一次」带回的落点（new-video / replace）记回落点单选 */
    window.BC_TOOL_FRAME.useToolPreset('transcribe', (p) => {
      const eid = p.entry ? p.entry.movie || p.entry.id : null;
      if (p.params) {
        const q = Object.assign({}, p.params);
        const back = q.target === 'new-video' || q.target === 'replace' ? {id: eid, k: q.target} : null;
        if (back || q.target === 'first') q.target = 'none';
        set(Object.assign(q, {entry: p.entry, dir: p.params.dir || null, retarget: back, retryOf: p.retryOf || null}));
      }
      else if (p.input) set({source: 'space', entry: p.entry, retryOf: null});
      s.setView('transcribe', null);
    });
    /* 路由带来的视频（编辑器「转录」）：当作 Space 里的那部视频 */
    const want = app.route.movie || null;
    useEffect(() => {
      const e = want && (app.spaceItems || []).find((x) => x.kind === 'movie' && x.id === want);
      if (e) { set({source: 'space', entry: e, retryOf: null}); s.setView('transcribe', null); }
    }, [want]);
    useEffect(() => { drafts.st = st; }, [st]);
    const dir = st.dir || window.BC_TOOL_VIEW.defaultDir(app, s.lastDir);
    const entry = st.source === 'space' ? st.entry : null;
    const video = !!entry && SI.runInput(entry) === 'video';
    const movie = video ? app.projById(entry.movie || entry.id) : null;
    const info = asrInfo(app, st, movie ? movie.duration : entry ? entry.dur : null);
    const LINK = window.BC_LINK_TOOL;
    const entryWhy = entry ? SI.reasonFor('transcribe', entry, {movie}) : null;
    const inputOk = st.source === 'file' ? !!st.file : st.source === 'link' ? LINK.urlOk(st.url) : !!entry && !entryWhy;
    const sp = speakerState(app, info.m, st.speakers);
    const create = !video && st.target === 'create';
    const reason = !inputOk ? (entryWhy || {file: '先选一个视频或音频文件', link: '先粘贴一个视频链接', space: '先从 Space 里选一个条目'}[st.source])
      : window.BC_TOOL_FRAME.modelReason(asrModels(app), st.model, '语音模型') || (sp.missing ? '识别说话人要先下载说话人区分包' : null)
      || (create && !dir ? '先选新视频放进哪个项目' : null);
    const pending = RUNS.grantNeeds([info.need], s.granted);
    /* 落点（product-design §5.11）：已有文稿才有；用户在这部视频上选过就用选的，否则默认新建视频（改过原文也是） */
    const rt = movie ? TT.retargetOptions(movie) : null;
    const dest = rt ? (st.retarget && st.retarget.id === movie.id ? st.retarget.k : rt.value) : null;
    const newName = movie && st.newName && st.newName.id === movie.id ? st.newName.v : movie ? TT.newVideoName(movie) : '';
    const retryOf = st.retryOf && movie && st.retryOf.project === movie.id ? st.retryOf : null;
    const go = () => window.BC_TOOL_RUNNER.start(app, window.BC_TOOL_SPECS.transcribe(app, Object.assign({}, st, {dir, saveDir: save.dir, lang: info.lang,
      modelName: info.modelName, speakers: sp.on, diarize: sp.step, retryOf: undefined, retarget: undefined, newName: undefined},
      video ? {target: rt ? dest : 'first', translations: 'carry', name: dest === 'new-video' ? (newName.trim() || TT.newVideoName(movie)) : undefined} : {})));
    const agree = () => { window.BC_TOOL_RUNNER.grant(pending.map((n) => n.key)); go(); };
    const dup = movie ? TT.duplicateNote('transcribe', movie) : null;
    const chosenNote = !video ? entryWhy : !rt ? '写进这部视频' : dest === 'replace' ? '取代这部视频的文稿' : '结果放进一部新视频';
    return <window.ToolFrame tool="transcribe" title="转录" bar={<window.ToolStartBar reason={reason}>
      <Btn variant="accent" disabled={!!reason || pending.length > 0} onClick={go}>开始转录</Btn></window.ToolStartBar>}>
      {retryOf && <RetryAlert task={retryOf} />}
      <p className="t-detail">把视频或音频转成文稿和字幕。缺省得到一份文稿和一份字幕，放在保存位置；也可以新建一部视频，或写进 Space 里已有的视频。</p>
      <window.ToolSourceSwitch tool="transcribe" value={st.source} onChange={(source) => set({source})} />
      {st.source === 'file' && <div className="tool-transcribe__input" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) set({file: f.name}); }}>
        <Ic n="upload" className="ic--26" />
        <b>{st.file || '拖入视频或音频'}</b>
        <span className="t-detail-xs">MP4、MOV、MP3、WAV、M4A</span>
        <window.MediaPick label={st.file ? '更换文件' : '选择文件'} onPick={(file) => set({file})} />
      </div>}
      {st.source === 'link' && <LINK.LinkField value={st.url} onChange={(url) => set({url})} />}
      {st.source === 'space' && (entry
        ? <window.ToolSpaceChosen entry={entry} onClear={() => set({entry: null})} note={chosenNote} />
        : <window.ToolSpacePicker tool="transcribe" value={null} onChange={(e) => set({entry: e})} />)}
      {dup && <R.InlineAlert variant="informative"><R.Heading>已有文稿</R.Heading><R.Content>{dup}</R.Content></R.InlineAlert>}
      <AsrFields st={st} set={set} />
      {rt && rt.edited && <R.InlineAlert variant="notice"><R.Heading>你改过这部视频的文稿</R.Heading>
        <R.Content>改错字、润色、分段这些修改只在当前文稿里。取代会丢掉它们（撤销能回来），所以默认新建一部视频；仍要取代，在下面选「取代这部视频的文稿」。</R.Content></R.InlineAlert>}
      {rt && <RetargetField movie={movie} rt={rt} dest={dest} onDest={(k) => set({retarget: {id: movie.id, k}})}
        name={newName} onName={(v) => set({newName: {id: movie.id, v}})} />}
      {!video && <TargetField st={st} set={set} dir={dir} />}
      {!video && <window.ToolSaveDirRow save={save} />}
      <window.GrantCard needs={inputOk && info.available ? pending : []} disabled={!!reason} onAgree={agree} />
      <window.ToolDemo />
      <p className="t-detail-xs">交互原型：转录结果使用示例文稿，演示文稿与字幕、新建视频、写进视频与接着用工具的完整流程。</p>
    </window.ToolFrame>;
  }

  Object.assign(window, {TranscribeToolPage, BC_ASR_FIELDS: {asrInfo, asrModels, AsrFields, AsrMoreOptions, speakerState, CreateTarget}});
})();
