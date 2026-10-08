/* 工具 › 翻译字幕（product-design §2.7 表二「翻译字幕」、S02）：从 Space 里有文稿的视频或字幕条目，或一个本机 SRT / VTT 文件开始。
   视频：新增一份译文与目标语言的字幕层，可以双语显示，原文不动；同一种语言已有译文时新增一份、不覆盖。
   字幕条目与字幕文件：结果是保存位置里译好的字幕文件、Space 里的一个字幕条目，时间码不变，原文件不动。
   页面按统一骨架排（tool-frame.jsx）：输入 → 模型 → 选项 → 保存位置 → 开始；写进视频时不显示保存位置。
   文本模型都是在线服务：没同意过的，开始前在这一页说明要发什么、发给谁（当场授权）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const R = window.RSP;
  const D = window.BC_DATA;
  const L = window.BC_LLM_TOOLS;
  const RUNS = window.BC_TOOL_RUNS;
  const TT = window.BC_TOOL_TARGETS;
  const drafts = {st: null};
  const CHARS = () => D.cues.reduce((n, c) => n + c.text.length, 0);

  /** 文本模型一块：模型、连接状态；返回选中的模型与要发的数据 */
  function useTextModel(app, form, chars) {
    const catalog = L.models(app.cloudCatalog, app.cloudSaved);
    const id = form.model || (catalog.find((m) => m.id === app.cloudLlmDefault && m.ready) || catalog.find((m) => m.ready) || catalog[0] || {}).id;
    const model = catalog.find((m) => m.id === id) || null;
    const need = model ? RUNS.need({recipient: model.provider, data: 'transcript', chars}) : null;
    return {catalog, id, model, need, name: model ? `${model.provider} · ${model.name} · 在线` : ''};
  }
  /** 文本模型清单（都是在线服务），给模型行（tool-frame.jsx） */
  const textModels = (tm) => tm.catalog.map((m) => ({id: m.id, label: `${m.provider} · ${m.name}`, local: false, ok: !!m.ready}));
  /** 文本模型一行：没有连接的模型时给「去设置」；`what`：会发出去的内容 */
  function TextModelField({tm, onChange, what = '文稿文字'}) {
    return <window.ToolModelRow label="用哪个文本模型" models={textModels(tm)} value={tm.id || null} onChange={onChange} settings={{r: 'settings', sec: 'cloud', tab: 'llm'}}>
      {tm.model && tm.model.ready ? <span className="t-detail-xs">{`${tm.model.provider} · ${what}会发到这家服务`}</span> : null}
    </window.ToolModelRow>;
  }
  const textModelReason = (tm) => window.BC_TOOL_FRAME.modelReason(textModels(tm), tm.id, '文本模型');

  /** 字幕文件来源：导入 / 粘贴 / 示例，解析后显示条数（原来的文件流程） */
  function SubtitleFileField({form, set}) {
    const input = useRef(null);
    const [error, setError] = useState('');
    const parsed = L.parseSubtitles(form.input);
    const importFile = async (file) => {
      if (!file) return;
      if (!/\.(srt|vtt)$/i.test(file.name)) { setError('请选择 SRT 或 VTT 字幕文件'); return; }
      if (file.size > 1024 * 1024) { setError('请选择小于 1 MB 的字幕文件'); return; }
      try { set({input: await file.text(), file: file.name}); setError(''); } catch (e) { setError('读取文件失败，请重新选择'); }
    };
    return <div className="ttsw__sec">
      <div className="row gap8"><b className="grow">{form.file || '字幕内容'}</b>
        <Btn size="s" icon="upload" onClick={() => input.current.click()}>导入字幕</Btn>
        <Btn size="s" variant="quiet" onClick={() => set({input: L.SAMPLE, file: '分享示例.srt'})}>填入示例</Btn></div>
      <input hidden ref={input} type="file" accept=".srt,.vtt" onChange={(e) => { importFile(e.target.files[0]); e.target.value = ''; }} />
      <R.TextArea aria-label="字幕内容" value={form.input} onChange={(v) => set({input: v})} placeholder="粘贴 SRT / VTT 字幕，或导入文件" UNSAFE_className="tool-llm__input" />
      <span className="t-detail-xs">{form.input ? parsed.error || `${parsed.cues.length} 条字幕 · 保留时间码 · 输出 SRT` : '支持 SRT、WebVTT'}</span>
      {error && <p role="alert" className="ttsw__err">{error}</p>}
    </div>;
  }

  /** Space 字幕条目的 SRT 正文：有正文用正文，只有逐句时拼成 SRT，演示条目两样都没有时用示例 */
  const entrySrt = (e) => (e.text && /-->/.test(e.text) ? e.text : e.cues && e.cues.length ? L.srt(e.cues) : L.SAMPLE);

  function TranslateToolPage() {
    const app = useApp();
    const s = window.useToolRuns();
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const SI = window.BC_TOOL_SPACE_INPUT;
    const [st, setSt] = useState(() => Object.assign({source: 'space', entry: null, lang: null, bilingual: true, model: null, input: '', file: ''}, drafts.st || {}));
    const set = (patch) => setSt((x) => Object.assign({}, x, patch));
    /* 「接着用工具」/ Space 查看器带来的条目，或编辑器路由带来的视频 */
    window.BC_TOOL_FRAME.useToolPreset('translate', (p) => {
      if (p.params) set(Object.assign({}, p.params, {entry: p.entry}));
      else if (p.input) set({source: 'space', entry: p.entry});
      s.setView('translate', null);
    });
    const want = app.route.movie || null;
    useEffect(() => {
      const id = want || (!st.entry && st.source === 'space' ? window.BC_VIDEO_PICKER.initial(app, 'translate', null) : null);
      const e = id && (app.spaceItems || []).find((x) => x.kind === 'movie' && x.id === id);
      if (e) set({source: 'space', entry: e});
      if (want) s.setView('translate', null);
    }, [want]);
    useEffect(() => { drafts.st = st; }, [st]);
    const entry = st.source === 'space' ? st.entry : null;
    const video = !!entry && entry.kind === 'movie';
    const movie = video ? Object.assign({}, app.projById(entry.movie || entry.id), window.BC_TOOL_RUNNER.movieNow(entry.movie || entry.id)) : null;
    const f = movie ? TT.facts(movie) : null;
    const from = f && f.transcripts.length ? f.transcripts[f.transcripts.length - 1] : null;
    const only = TT.targetLangs(window.BC_LANGUAGES.translate, movie).map((l) => l.code);
    const lang = st.lang && (!from || st.lang !== from.lang) ? st.lang : (from && from.lang === 'en' ? 'zh' : 'en');
    const marks = {};
    if (f) f.translations.forEach((t) => { marks[t.lang] = '已有译文 · 会新增一份'; });
    const text = entry && !video ? entrySrt(entry) : st.input;
    const parsed = video ? null : L.parseSubtitles(text);
    const chars = video ? CHARS() : text.length;
    const tm = useTextModel(app, st, chars);
    const entryWhy = entry ? SI.reasonFor('translate', entry, {movie}) : null;
    const reason = (st.source === 'space' ? (!entry ? '先从 Space 里选一部视频或一个字幕' : entryWhy || (video && !from ? '这部视频还没有文稿，先转录' : null))
      : !st.input.trim() ? '先导入或粘贴字幕' : parsed.error || null) || textModelReason(tm);
    const pending = RUNS.grantNeeds([tm.need], s.granted);
    const spec = () => (video
      ? window.BC_TOOL_SPECS.translateVideo(app, {movie: movie.id, lang, bilingual: st.bilingual, model: tm.id, modelName: tm.name, from})
      : window.BC_TOOL_SPECS.translateFile(app, {file: st.file, entry, input: text, lang, model: tm.id, modelName: tm.name, saveDir: save.dir}));
    const go = () => window.BC_TOOL_RUNNER.start(app, spec());
    const agree = () => { window.BC_TOOL_RUNNER.grant(pending.map((n) => n.key)); go(); };
    const dup = movie ? TT.duplicateNote('translate', movie, {lang}) : null;
    return <window.ToolFrame tool="translate" title="翻译字幕" bar={<window.ToolStartBar reason={reason}>
      <Btn variant="accent" disabled={!!reason || pending.length > 0} onClick={go}>开始翻译</Btn></window.ToolStartBar>}>
      <p className="t-detail">{video ? '给转录过的视频加一份译文和目标语言的字幕层，原文不动。' : '翻译一份字幕，时间码不变；译好的字幕是保存位置里的一个新文件，也是 Space 里的一个条目。'}</p>
      <window.ToolSourceSwitch tool="translate" value={st.source} onChange={(source) => set({source})} />
      {st.source === 'space' && (entry
        ? <window.ToolSpaceChosen entry={entry} onClear={() => set({entry: null})}
          note={entryWhy || (video ? (from ? `从${TT.langLabel(from.lang)}文稿翻译，写进这部视频` : null) : parsed && !parsed.error ? `${parsed.cues.length} 条字幕` : null)} />
        : <window.ToolSpacePicker tool="translate" value={null} onChange={(e) => set({entry: e})} />)}
      {st.source === 'file' && <SubtitleFileField form={st} set={set} />}
      <TextModelField tm={tm} onChange={(model) => set({model})} what={video ? '文稿文字' : '字幕文字'} />
      <div className="ttsw__sec">
        <div className="ttsw__sechd"><b className="grow">翻译成</b></div>
        <LanguageCombobox value={lang} only={video ? only : null} marks={marks} onChange={(l) => set({lang: l})} />
        {video && <R.Switch isSelected={st.bilingual} onChange={(v) => set({bilingual: v})}>双语显示（原文与译文上下两行）</R.Switch>}
      </div>
      {dup && <R.InlineAlert variant="informative"><R.Heading>不覆盖原来的译文</R.Heading><R.Content>{dup}</R.Content></R.InlineAlert>}
      {!video && <window.ToolSaveDirRow save={save} />}
      <window.GrantCard needs={!reason ? pending : []} disabled={!!reason} onAgree={agree}
        hint="翻译只能用在线文本模型；不想发送就先不翻译，内容留在这台电脑上。" />
      <window.ToolDemo />
      <p className="t-detail-xs">交互原型：没有调用模型，译文用示例内容；英语、日语有示例译文，其他语言是明确标注的占位。</p>
    </window.ToolFrame>;
  }

  Object.assign(window, {TranslateToolPage, BC_TEXT_MODEL: {useTextModel, TextModelField, textModelReason}});
})();
