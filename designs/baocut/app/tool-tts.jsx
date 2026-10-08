/* 工具 › 生成语音 —— §17.5（2026-09-15）。
   不依附项目的 TTS 工作台：左边写文字、选模型、选声音、调语言与情绪，右边是生成记录（试听 / 下载 WAV /
   加到项目 / 带回设置再改）。模型卡上直接写出每只模型能做什么——有没有预设音色、要不要参考录音、
   能不能调情绪、会念哪几种语言——表单按选中的模型换一套选项，不支持的选项不出现。
   开页先落到一只已经装好的模型，模型一栏平时收成一行；选中的模型没装时才摊开卡片，模型一节里的下载卡
   还给一枚「换用已装的 X」。「生成语音」在页顶吸顶导航栏的右侧（2026-09-24，Page 的 bar），滚到哪都按得到。
   风格给六张现成的念法卡（点一下连示例文字一起填），预设音色多一格「随机」；生成完只要还停在这一页、音频又不长，就自己响一次。
   生成排队在本机一次跑一条，每条落一条不属于任何项目的后台任务；记录挂在模块上，离开这页照样跑完。
   2026-09-26：模型格多 VoxCPM2（克隆 + 风格指令 → 可控克隆）与 OmniVoice（克隆或按类挑项描述，仅限非商用）；Qwen3-TTS 1.7B
   恢复「描述一个声音」（VoiceDesign）。IndexTTS 2.5 / VoxCPM2 / OmniVoice 在「语言与细节」末尾多一个「高级」折叠放数值旋钮。
   本地多语言引擎（VoxCPM2 31 种、OmniVoice 与转录同一张约 100 种的表）的语言菜单也只先列 12 种，其余折在「更多语言…」后面。
   引擎 / 预设 / 参考音频真相在 model-tts.js，工作台规则在 model-tools.js。表单各节在 tool-tts-form.jsx（window.TtsForm）。
   2026-10-06（product-design §2.7 表二「生成语音」）：要念的文字可以直接写，也可以取 Space 里的一份文档或字幕
   （BC_TOOL_SPACE_INPUT.textOf）；超过这只模型一次的字数上限时拒绝并报出字数与上限，不截断。
   结果是保存位置里的一个 WAV、Space 里的一个音频条目；任务记录带 outputs 与 saveDir（model-tool-runs.js）；
   记录卡的结果用产物行（在 Space 中查看、在文件夹中显示、交给 Agent、接着用工具）。
   云端（2026-09-24 云端语音合成设计稿 §2.2）：模型格多一组「云端」——设置里连了密钥的 API 提供方一家一张卡（OpenAI / ElevenLabs /
   MiniMax / Google Gemini / 自建），没连的淡着写「未连接」；选中云端引擎后模型一行里再挑这家的模型，页顶 chip 从「在这台电脑上合成 · 不联网」
   翻成「联网 · X · 按字符计费」（Gemini 是「按 token 计费」），音色走共享选择器（默认 / 我的声音 / 提供方音色 / 临时用一段），风格只在收指令的模型上出现，
   语速滑杆按各家区间（Gemini 没有数值语速，不出这一行），ElevenLabs 多稳定 / 相似 / 风格强度，MiniMax 多情绪 / 音高 / 音量，没有种子；没连密钥时下载卡换成连接卡。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const {useSound, ModelLine, EngineGrid, CloudVoiceSection, VoiceSection, OptionsSection, WORKBENCH_MODES} = window.TtsForm;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const T = window.BC_TOOLS;
  const C = window.BC_CLOUD_TTS;
  const DEMO_WAV = 'assets/cloud-test.wav';
  const EMPTY_TEXT = '先写要念的文字';
  /** 生成完自动试听的上限：长音频不自作主张地响 */
  const AUTOPLAY_MAX = 60;

  /* ---------- 生成记录：挂在模块上，离开这页也照样跑完 ---------- */
  function demoRecords() {
    const a = T.makeRecord(Object.assign(T.blank(), {lang: 'zh',
      text: '欢迎使用 BaoCut！转录、翻译、配音、剪辑，全都在你自己的电脑上完成，素材一步都不用上传。'}), 1);
    const b = T.makeRecord(Object.assign(T.blank(), {lang: 'en', preset: 'Eric', style: T.VIBES[1].style, text: TTS.sampleLine('en', 'intro').text}), 2);
    return [Object.assign(b, {status: 'done', pct: 100, ago: '2 小时前'}), Object.assign(a, {status: 'done', pct: 100, ago: '昨天'})];
  }
  const jobs = {list: demoRecords(), seq: 2, subs: new Set(), timer: null, draft: null, autoPlay: null};
  const emit = () => jobs.subs.forEach((fn) => fn(jobs.list));
  const patchRec = (id, p) => { jobs.list = jobs.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  const removeRec = (id) => { jobs.list = jobs.list.filter((r) => r.id !== id); emit(); };
  function useRecords() {
    const [list, setList] = useState(jobs.list);
    useEffect(() => {
      jobs.subs.add(setList);
      setList(jobs.list);
      return () => { jobs.subs.delete(setList); };
    }, []);
    return list;
  }
  /** 本机一次合成一条：没有在跑的就取最早排队的那条开跑。 */
  function pump(app) {
    const r = T.nextQueued(jobs.list);
    if (!r) return;
    const segs = TTS.segments(r.text).length;
    const tid = app.addTask({kind: 'tts', flow: 'tts', tool: 'tts', toolId: 'tts', params: r.params || null, project: null, title: `生成语音 · ${r.name}`,
      sub: `${r.engineName} · ${r.voice} · ${segs} 段${r.provider ? ` · ${r.chars} 字 · 联网` : ''}${r.fromName ? ` · 取自 ${r.fromName}` : ''}`,
      phase: r.provider ? `连接 ${r.provider}` : '加载模型', cancellable: true, ...window.BC_TOOL_RUNS.outputsPatch([], r.saveDir)});
    patchRec(r.id, {status: 'running', pct: 0, taskId: tid});
    // 云端没有「加载模型」那一段，按段发请求，比本机快
    // VoxCPM2 大约一倍实时、OmniVoice 32 步扩散：与 1.7B 同一档慢
    const step = r.provider ? 6 : ['qwen3-1.7b', 'voxcpm2'].includes(r.engine) ? 2 : r.engine === 'omnivoice' ? 3 : 4;
    const t0 = Date.now();
    let p = 0;
    clearInterval(jobs.timer);
    jobs.timer = setInterval(() => {
      const cur = jobs.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(jobs.timer); return; }
      p = Math.min(100, p + step);
      patchRec(r.id, {pct: p});
      app.patchTask(tid, {pct: p, phase: TTS.genPhase(p, segs, r.provider).label});
      if (p < 100) return;
      clearInterval(jobs.timer);
      // 停在这一页、又不算长的，直接响给用户听：省掉「生成完还要自己去右边按播放」。
      if (r.dur <= AUTOPLAY_MAX) jobs.autoPlay = r.id;
      const entry = register(app, r);
      patchRec(r.id, {status: 'done', ago: '刚刚', elapsed: (Date.now() - t0) / 1000, entry});
      app.patchTask(tid, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, window.BC_TOOL_RUNS.outputsPatch([entry], r.saveDir)));
      app.toast(`已生成 ${r.name} · 保存在 ${window.BC_SAVE_DIR.label(r.saveDir)}`, 'positive');
      pump(app);
    }, 80);
  }
  /** 生成好的一条：保存位置里的 WAV、Space 里的音频条目（BC_HOME_TOOLS.output 的 `tool-audio-<id>`） */
  function register(app, r) {
    const {entry, status, taskId, pct, params, ...rest} = r;
    return app.registerToolOutput('audio', Object.assign(rest, {sourceUrl: DEMO_WAV, file: `${r.saveDir || window.BC_SAVE_DIR.DEFAULT}/${r.name}`,
      toolId: 'tts', task: taskId || null, params: params || null}));
  }
  /** `saveDir`：这次的保存位置；`from`：文字取自的 Space 条目（记在记录上，只为说明出处） */
  function enqueue(app, f, saveDir, from) {
    jobs.seq += 1;
    /* params：这次的表单与文字来源，任务详情「再做一次」把它填回这一页（P2 接口：任务记录的 params） */
    const params = Object.assign({}, f, {entry: from ? {id: from.id, name: from.name, kind: from.kind} : null});
    const rec = Object.assign(T.makeRecord(f, jobs.seq, app.voices), {saveDir, fromName: from ? from.name : null, params});
    jobs.list = [rec].concat(jobs.list);
    emit();
    const ahead = T.aheadOf(jobs.list, rec.id);
    if (ahead) app.toast(`已排队 · 前面还有 ${ahead} 条，本机一次合成一条`);
    pump(app);
  }
  function cancelRec(app, r) {
    if (r.status === 'queued') { patchRec(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.taskId, {after: () => {
      clearInterval(jobs.timer);
      patchRec(r.id, {status: 'canceled', pct: 0});
      pump(app);
    }});
  }
  /* ---------- 播放：同一时刻只响一段（useSound 在 tool-tts-form.jsx） ---------- */
  function Player({r}) {
    const s = useSound(DEMO_WAV);
    const d = s.d || r.dur;
    // 刚跑完的那条：播放器一挂上就自己响一次（离开这页时没人挂，自然不响）。
    useEffect(() => {
      if (jobs.autoPlay !== r.id) return;
      jobs.autoPlay = null;
      s.toggle();
    }, []);
    return (
      <div className="ttsp">
        <IconBtn icon={s.on ? 'pause' : 'play'} size="s" tip={s.on ? '暂停' : '播放'} onClick={s.toggle} />
        <span className="ttsp__bar ttsrec__bar"
          onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); s.seek((e.clientX - b.left) / b.width); }}>
          <i style={{width: (d ? Math.min(100, (s.t / d) * 100) : 0) + '%'}} />
        </span>
        <span className="t-mono t-detail-xs">{s.t.toFixed(1)} / {d.toFixed(1)} s</span>
      </div>
    );
  }

  /* ---------- 右栏：一条生成记录 ---------- */
  function RecordCard({r, list, onReuse}) {
    const app = useApp();
    const [pop, setPop] = useState(null);   // 'more' | 'proj'
    const close = () => setPop(null);
    const flip = (k) => setPop(pop === k ? null : k);
    const state = {done: r.ago, running: '生成中', queued: '排队中', canceled: '已取消'}[r.status];
    return (
      <div className={cx('ttsrec', r.status === 'running' && 'is-running', r.status === 'canceled' && 'is-off')}>
        <div className="ttsrec__hd">
          <Ic n="wave" className="ic--16 ttsrec__ic" />
          <b className="t-title-sm t-truncate grow">{r.name}</b>
          <span className="t-detail-xs">{state}</span>
          <div className="ttsrec__pop">
            <IconBtn icon="more" size="s" tip="更多" on={pop === 'more'} onClick={() => flip('more')} />
            <Popover open={pop === 'more'} onClose={close} align="right" dir="down" width={220}>
              <Menu>
                <MenuItem icon="edit" label="带回左边再改一版" onClick={() => { close(); onReuse(r); }} />
                <MenuItem icon="copy" label="复制文字" onClick={() => { close(); copyToClipboard(r.surface || r.text); app.toast('已复制文字'); }} />
                {r.taskId ? <MenuItem icon="tasks" label="在后台任务里查看" onClick={() => { close(); app.go({r: 'task', id: r.taskId}); }} /> : null}
                <MenuRule />
                <MenuItem icon="trash" label="删除这条记录" tone="negative" disabled={r.status === 'running'}
                  onClick={() => { close(); removeRec(r.id); app.toast(`已删除 ${r.name}`); }} />
              </Menu>
            </Popover>
          </div>
        </div>
        <p className="ttsrec__text">{r.surface || r.text}</p>
        <span className="t-detail-xs">{T.recordMeta(r)}</span>

        {r.status === 'running' ? (
          <div className="ttsrec__busy">
            <div className="row">
              <span className="t-detail-xs grow">{TTS.genPhase(r.pct, TTS.segments(r.text).length, r.provider).label} · {r.pct}%</span>
              <Btn variant="quiet" size="s" onClick={() => cancelRec(app, r)}>取消</Btn>
            </div>
            <Progress value={r.pct} thin />
          </div>
        ) : null}
        {r.status === 'queued' ? (
          <div className="row">
            <span className="t-detail-xs grow">前面还有 {T.aheadOf(list, r.id)} 条 · 本机一次合成一条</span>
            <Btn variant="quiet" size="s" onClick={() => cancelRec(app, r)}>取消</Btn>
          </div>
        ) : null}
        {r.status === 'canceled' ? (
          <div className="row">
            <span className="t-detail-xs grow">没有生成文件</span>
            <Btn variant="quiet" size="s" icon="refresh" onClick={() => { patchRec(r.id, {status: 'queued', pct: 0}); pump(app); }}>重新排队</Btn>
          </div>
        ) : null}
        {r.status === 'done' ? (
          <>
            <Player r={r} />
            {r.entry ? <window.ToolOutputRow entry={r.entry} fromTool="tts" compact /> : null}
          </>
        ) : null}
      </div>
    );
  }

  /* ---------- 页面 ---------- */
  function TtsToolPage() {
    const app = useApp();
    // 头一回进来落到一只已经装好的模型：不让用户开页就撞上「先下载 …」。
    const [f, setF] = useState(() => jobs.draft || T.preferredForm(app.modelInstalled, app.cloudTtsDefault || (app.prefs.localModelDefaults || {}).tts));
    const set = (p) => setF((s) => Object.assign({}, s, p));
    useEffect(() => { jobs.draft = f; }, [f]);
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const SI = window.BC_TOOL_SPACE_INPUT;
    /* 文字从哪来：直接写（text）或 Space 里的文档 / 字幕（space）；选中的条目只活在这一页 */
    const [src, setSrc] = useState(() => jobs.src || {source: 'text', entry: null});
    useEffect(() => { jobs.src = src; }, [src]);
    window.BC_TOOL_FRAME.useToolPreset('tts', (p) => {
      if (p.params) { const {entry, ...form} = p.params; setF(Object.assign(T.blank(), form)); }
      if (p.input) setSrc({source: 'space', entry: p.entry});
      else if (p.params) setSrc({source: 'text', entry: null});
    });
    const list = useRecords();
    /* 演示记录（页面头一回打开时就有的两条）补进 Space：只补一次，新生成的在完成时注册 */
    useEffect(() => {
      jobs.list.filter((r) => r.status === 'done' && !r.entry).forEach((r) => patchRec(r.id, {entry: register(app, r)}));
    }, []);
    const [tried, setTried] = useState(false);
    // null = 还没表态：模型装好了就收起来，没装就摊开让人换一只。
    const [openModels, setOpenModels] = useState(null);
    const textRef = useRef(null);
    const cloudOpt = {voices: app.voices, saved: app.cloudSaved, extra: app.cloudCustom};
    const fromSpace = src.source === 'space';
    const maxChars0 = T.maxChars(f);
    /* Space 条目的文字：超过上限就拒绝（报出字数与上限），不截断 */
    const check = fromSpace && src.entry ? SI.textCheck(src.entry, maxChars0) : null;
    const fx = fromSpace ? Object.assign({}, f, {text: check && check.ok ? check.text : ''}) : f;
    const spaceErr = fromSpace ? (!src.entry ? '先从 Space 里选一份文档或字幕' : check.error || SI.reasonFor('tts', src.entry)) : null;
    const errs = spaceErr ? [spaceErr] : T.validate(fx, cloudOpt);
    const mid = T.modelOf(f);
    const eng = TTS.engineOf(f.engine);
    const cloud = !!eng.cloud;
    // 云端：模型名是「ElevenLabs · eleven_v3」，「装没装」= 那家连没连密钥
    const modelName = cloud ? `${eng.name} · ${(C.parse(mid) || {}).model}` : TTS.MODELS[mid].name;
    const installed = app.modelInstalled(mid);
    const alt = T.installedAlternative(f, app.modelInstalled);
    const maxChars = T.maxChars(f);
    const err = errs.find((e) => tried || e !== EMPTY_TEXT);
    const busy = list.filter((r) => r.status === 'running' || r.status === 'queued').length;
    const showModels = openModels == null ? !installed : openModels;

    const generate = () => {
      setTried(true);
      if (!installed) { app.toast(cloud ? `先在设置 › 模型 › 云端模型连接 ${eng.name}` : `先下载 ${modelName}`); return; }
      if (errs.length) { app.toast(errs[0]); return; }
      enqueue(app, fx, save.dir, fromSpace ? src.entry : null);
    };
    const reuse = (r) => {
      setF(Object.assign(T.blank(), r.form));
      if (textRef.current) textRef.current.focus();
      app.toast(`已带回 ${r.name} 的文字与设置`);
    };

    // 导航栏右侧：一行现状 + ⌘↵ + 主按钮。没装模型时先说要下载哪只（下载卡在模型一节里），
    // 其次是第一条校验错误，都没有就念一遍这次会用的模型、音色与时长。
    const status = !installed ? (cloud ? `先连接 ${eng.name}` : `先下载 ${modelName}`) : err
      || `${modelName} · ${T.voiceLabel(f, app.voices)}${fx.text.trim() ? ` · 约 ${TTS.estimateDuration(fx.text).toFixed(1)} 秒${cloud ? ` · ${C.charsLabel(fx.text)}` : ''}` : ''}`;
    const bar = (
      <>
        <span className={cx('t-detail pagenav__note', (!installed || err) && 'ttsw__err')} title={status}>{status}</span>
        <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
        <Btn variant="accent" icon="wave" disabled={!installed} onClick={generate}>生成语音</Btn>
      </>
    );

    return (
      <window.Page wide title="生成语音" bar={bar}
        actions={cloud ? <Chip icon="remote" tone="notice">{C.headerChip(C.providerById(eng.provider, app.cloudCustom) || eng.provider)}</Chip> : <Chip icon="lock">在这台电脑上合成 · 不联网</Chip>}>
        <div className="ttsw">
          <div className="ttsw__main">
            <window.ToolSourceSwitch tool="tts" value={src.source} onChange={(source) => setSrc({source, entry: src.entry})} />
            {fromSpace ? <section className="ttsw__sec">
              {src.entry
                ? <window.ToolSpaceChosen entry={src.entry} onClear={() => setSrc({source: 'space', entry: null})}
                  note={check ? `${check.chars} 字 · 一次最多 ${maxChars} 字` : null} />
                : <window.ToolSpacePicker tool="tts" value={null} onChange={(e) => setSrc({source: 'space', entry: e})} label="念哪份文档或字幕" />}
              {check && !check.ok ? <p role="alert" className="ttsw__err">{check.error}</p> : null}
              {check && check.ok ? <p className="ttsrec__text">{check.text}</p> : null}
              {check && check.ok ? <span className="t-detail-xs">念的是这份{src.entry.kind === 'subtitle' ? '字幕的正文（不念序号与时间码）' : '文档的全文'}，原条目不变。</span> : null}
            </section> : <section className="ttsw__sec">
              <Field area inputRef={textRef} className="ttsw__text" value={f.text} aria-label="要念的文字"
                placeholder={`输入要念的文字。按句号、问号或换行分段，一次最多 ${maxChars} 字。`}
                onChange={(e) => set({text: e.target.value})}
                onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); } }} />
              <div className="ttsw__textft">
                <span className={cx('t-detail-xs grow', f.text.trim().length > maxChars && 'ttsw__over')}>{T.textStats(f.text, maxChars)}</span>
                {f.text
                  ? <BCAction className="viewall" onClick={() => set({text: ''})}>清空</BCAction>
                  : <BCAction className="viewall" onClick={() => set({text: T.sampleText(f)})}>填一段示例</BCAction>}
              </div>
              <window.TextReadings f={f} set={set} engine={f.engine} project={[]} />
            </section>}

            <section className="ttsw__sec">
              <div className="ttsw__sechd">
                <span className="t-section grow">模型</span>
                <BCAction className="viewall" onClick={() => setOpenModels(!showModels)}>{showModels ? '收起' : '换一只模型'}</BCAction>
                <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'tts'})}>管理语音模型…</BCAction>
              </div>
              {cloud
                ? <window.TtsCloudGate engine={f.engine} extra={alt ? (
                  <Btn variant="secondary" size="s" icon="wave"
                    onClick={() => { set(T.switchEngine(Object.assign({}, f, {mode: alt.mode}), alt.engine)); setOpenModels(false); }}>
                    换用已装的 {alt.name}
                  </Btn>
                ) : null} />
                : <window.TtsModelGate id={mid} extra={alt ? (
                  <Btn variant="secondary" size="s" icon="wave"
                    onClick={() => { set(T.switchEngine(Object.assign({}, f, {mode: alt.mode}), alt.engine)); setOpenModels(false); }}>
                    换用已装的 {alt.name}{alt.switched ? ` · ${(WORKBENCH_MODES.find((m) => m.k === alt.mode) || {}).label}` : ''}
                  </Btn>
                ) : null} />}
              {showModels
                ? <EngineGrid f={f} set={(p) => { set(p); setOpenModels(false); }} />
                : <ModelLine f={f} set={set} />}
            </section>

            {cloud ? <CloudVoiceSection key={f.engine} f={f} set={set} /> : <VoiceSection key={f.engine} f={f} set={set} />}
            <OptionsSection f={f} set={set} />
            <window.ToolSaveDirRow save={save} note="生成的 WAV 保存在这个目录，也是 Space 里的一个音频条目；重名时加序号，不覆盖。" />
          </div>

          <aside className="ttsw__side">
            <div className="ttsw__sidehd">
              <span className="t-title-sm grow">生成记录</span>
              {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{list.length} 条</span>}
            </div>
            {list.length
              ? list.map((r) => <RecordCard key={r.id} r={r} list={list} onReuse={reuse} />)
              : <Empty icon="wave" title="还没有生成过">写好文字、选好声音，按「生成语音」。</Empty>}
            <div className="t-detail-xs ttsw__sidefoot">
              生成的 WAV 保存在保存位置，也显示在 Space 的「音频」中，可以接着新建视频或加到视频。云端合成的也一样落本地，服务商那边不留副本。交互演示播放的是示例音频。
            </div>
          </aside>
        </div>
      </window.Page>
    );
  }

  Object.assign(window, {TtsToolPage});
})();
