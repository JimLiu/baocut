/* 工具 › 翻译配音（product-design §2.7、S07）：选 Space 里有文稿的视频；有译文时直接选用，没有就先翻译。
   结果写进这部视频：新的一组配音，原来的配音保留。引擎能力行与「会不会念这种语言」用 model-dub.js / model-tts.js，
   编辑器里的完整配音向导（取向、音色、时长对比）不搬过来：这里只演示从工具发起的固定流程。
   页面按统一骨架排（tool-frame.jsx）：输入（Space 里的视频）→ 模型（配音引擎；先翻译时还有文本模型）→ 选项 → 开始；
   结果写进视频，所以没有保存位置这一行。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const D = window.BC_DATA;
  const T = window.BC_TOOLS;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const RUNS = window.BC_TOOL_RUNS;
  const TT = window.BC_TOOL_TARGETS;
  const drafts = {st: null};
  const NEW = '__new';
  const ORIGINAL = [{k: 'duck', label: '压低原声'}, {k: 'mute', label: '静音原声'}, {k: 'keep', label: '保留原声'}];

  /** 能用的引擎：本机装好的 + 已连接的在线服务；没装的也列出来但标「未安装」 */
  function engineRows(app) {
    return TTS.allEngines(app.cloudSaved).map((e) => {
      const ready = e.cloud ? true : T.modelsOf(e.id).some((id) => app.modelInstalled(id));
      return {id: e.id, name: e.cloud ? `${e.name} · 在线` : e.name, cloud: !!e.cloud, provider: e.provider || e.name, ready,
        line: e.cloud ? `在线服务 · 会念 ${T.langsShort(e.id)}` : DUB.capabilityLine(e.id)};
    });
  }

  function DubToolPage() {
    const app = useApp();
    const s = window.useToolRuns();
    const TM = window.BC_TEXT_MODEL;
    const [st, setSt] = useState(() => Object.assign({movie: null, pick: null, lang: 'en', engine: null, original: 'duck', model: null}, drafts.st || {}));
    const set = (patch) => setSt((x) => Object.assign({}, x, patch));
    const want = app.route.movie || null;
    useEffect(() => {
      if (!want && st.movie) return;
      set({movie: window.BC_VIDEO_PICKER.initial(app, 'dub', want || st.movie), pick: null});
      if (want) s.setView('dub', null);
    }, [want]);
    /* 「接着用工具」/ Space 查看器带来的视频 */
    window.BC_TOOL_FRAME.useToolPreset('dub', (p) => {
      if (p.params) set(Object.assign({}, p.params, {pick: null}));
      else if (p.input) set({movie: p.entry.movie || p.entry.id, pick: null});
      s.setView('dub', null);
    });
    useEffect(() => { drafts.st = st; }, [st]);
    const movie = st.movie ? Object.assign({}, app.projById(st.movie), window.BC_TOOL_RUNNER.movieNow(st.movie)) : null;
    const f = movie ? TT.facts(movie) : null;
    const src = f && f.transcripts.length ? f.transcripts[f.transcripts.length - 1].lang : null;
    const opts = TT.translationOptions(movie);
    const pick = st.pick && (st.pick === NEW || opts.some((o) => o.id === st.pick)) ? st.pick : (opts.length ? opts[opts.length - 1].id : NEW);
    const chosen = opts.find((o) => o.id === pick) || null;
    const lang = chosen ? chosen.lang : st.lang;
    const engines = engineRows(app);
    const engine = engines.find((e) => e.id === st.engine) || engines.find((e) => e.ready && TTS.engineSpeaks(e.id, lang)) || engines[0];
    const speaks = TTS.engineSpeaks(engine.id, lang);
    const chars = D.cues.reduce((n, c) => n + c.text.length, 0);
    const tm = TM.useTextModel(app, st, chars);
    const needs = [engine.cloud ? RUNS.need({recipient: engine.provider, data: 'transcript', chars}) : null, !chosen ? tm.need : null];
    const pending = RUNS.grantNeeds(needs, s.granted);
    const reason = !movie ? '先从 Space 里选一部视频' : !src ? '这部视频还没有文稿，先转录'
      : !engine.ready ? `${engine.name} 还没安装` : !speaks ? `${engine.name} 不会念${TT.langLabel(lang)}`
      : chosen ? null : !lang || lang === src ? '先选要翻译成哪种语言' : TM.textModelReason(tm);
    const ready = !reason;
    const go = () => window.BC_TOOL_RUNNER.start(app, window.BC_TOOL_SPECS.dub(app, {movie: st.movie, translation: chosen, lang, engine: engine.id,
      engineName: engine.name, original: st.original, model: tm.id}));
    const agree = () => { window.BC_TOOL_RUNNER.grant(pending.map((n) => n.key)); go(); };
    const dup = movie ? TT.duplicateNote('dub', movie, {lang}) : null;
    const engineModels = engines.map((e) => ({id: e.id, label: e.name.replace(/ · 在线$/, ''), local: !e.cloud, ok: e.ready}));
    return <window.ToolFrame tool="dub" title="翻译配音" bar={<window.ToolStartBar reason={reason}>
      <Btn variant="accent" disabled={!ready || pending.length > 0} onClick={go}>开始配音</Btn></window.ToolStartBar>}>
      <p className="t-detail">用译文给转录过的视频配一组新的声音。结果写进这部视频，原来的配音保留。</p>
      <window.VideoPicker tool="dub" value={st.movie} onChange={(m) => set({movie: m, pick: null})} />
      {movie && src && <div className="ttsw__sec">
        <R.RadioGroup label="用哪份译文" value={pick} onChange={(v) => set({pick: v})}>
          {opts.map((o) => <R.Radio key={o.id} value={o.id}>{o.label}{o.sub ? ` · ${o.sub}` : ''}</R.Radio>)}
          <R.Radio value={NEW}>先翻译成另一种语言</R.Radio>
        </R.RadioGroup>
        {!chosen && <>
          <span className="t-detail-xs">翻译成</span>
          <LanguageCombobox value={lang} only={TT.targetLangs(window.BC_LANGUAGES.translate, movie).map((l) => l.code)} onChange={(l) => set({lang: l})} />
        </>}
      </div>}
      {movie && src && !chosen && <TM.TextModelField tm={tm} onChange={(model) => set({model})} />}
      <window.ToolModelRow label="用哪个配音引擎" models={engineModels} value={engine.id} onChange={(id) => set({engine: id})} settings={{r: 'models', sec: 'local', tab: 'tts'}}>
        <span className="t-detail-xs">{engine.line}</span>
        {engine.ready && !speaks && <span className="t-detail-xs tframe__warn">{engine.name} 不会念{TT.langLabel(lang)}，换一只会念的引擎。</span>}
      </window.ToolModelRow>
      <div className="ttsw__sec">
        <div className="ttsw__sechd"><b className="grow">原声</b></div>
        <R.RadioGroup aria-label="原声" orientation="horizontal" value={st.original} onChange={(v) => set({original: v})}>
          {ORIGINAL.map((o) => <R.Radio key={o.k} value={o.k}>{o.label}</R.Radio>)}
        </R.RadioGroup>
      </div>
      {dup && <R.InlineAlert variant="informative"><R.Heading>不覆盖原来的配音</R.Heading><R.Content>{dup}</R.Content></R.InlineAlert>}
      <window.GrantCard needs={ready ? pending : []} onAgree={agree} hint="不想发送就选已有的译文、换一只本机配音引擎；翻译只能用在线文本模型。" />
      <window.ToolDemo />
      <p className="t-detail-xs">交互原型：不真的合成，演示步骤与写入。音色、时长对比与逐句管理在编辑器的翻译配音里。</p>
    </window.ToolFrame>;
  }

  Object.assign(window, {DubToolPage});
})();
