/* 设置 › 本地模型 › 语音合成：试听（快捷音色 + 示例语言 + 可选自定义文本 → 点「生成试听」→ 结果）。
   选择按模型保留于本次页面会话。示例 WAV 只验证播放/下载，真实合成在桌面 App。
   RefChip / InlinePlayer 仍供音频 Tab 的生成与配音面板使用。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const TTS = window.BC_TTS;

  const drafts = new Map();

  /** 参考音频的一行：文件名 · 时长 · 换一段 / 去掉 */
  function RefChip({file, onPick, onClear, label}) {
    if (!file) {
      return <Btn variant="secondary" size="s" icon="upload" onClick={onPick}>{label || '选参考音频…'}</Btn>;
    }
    return (
      <span className="refchip">
        <Ic n="wave" className="ic--14" />
        <b>{file.name}</b>
        <span>{file.dur ? file.dur + ' 秒' : '已选择'}</span>
        <IconBtn icon="close" size="xs" tip="去掉" onClick={onClear} />
      </span>
    );
  }

  /** 行内播放器：播放 / 暂停 + 进度 + 时长。原型里进度按时长匀速走。 */
  function InlinePlayer({dur, name}) {
    const [playing, setPlaying] = useState(false);
    const [t, setT] = useState(0);
    const timer = useRef(null);
    useEffect(() => {
      clearInterval(timer.current);
      if (!playing) return undefined;
      timer.current = setInterval(() => setT((x) => {
        if (x + 0.1 >= dur) { setPlaying(false); return 0; }
        return x + 0.1;
      }), 100);
      return () => clearInterval(timer.current);
    }, [playing, dur]);
    const pct = dur ? Math.min(100, (t / dur) * 100) : 0;
    return (
      <div className="ttsp">
        <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '暂停' : '播放'} onClick={() => setPlaying((v) => !v)} />
        <span className="ttsp__bar"><i style={{width: pct + '%'}} /></span>
        <span className="t-mono t-detail-xs">{t.toFixed(1)} / {dur.toFixed(1)} s</span>
        {name ? <span className="t-detail-xs ttsp__nm">{name}</span> : null}
      </div>
    );
  }

  /** 内置参考录音的一行：播放 / 暂停 + 名称 · 时长 + 原文。放的是真 WAV（CMU ARCTIC），不是示例音频。
      克隆块里拿它当「示例录音」的试听钮用，那时只写一行 note——听过才知道克隆的是什么。 */
  function RefPreview({r, note}) {
    const [playing, setPlaying] = useState(false);
    const audio = useRef(null);
    useEffect(() => {
      const a = new Audio('assets/' + r.file);
      a.onended = () => setPlaying(false);
      audio.current = a;
      setPlaying(false);
      return () => { a.pause(); a.onended = null; };
    }, [r.file]);
    const toggle = () => {
      const a = audio.current;
      if (playing) { a.pause(); a.currentTime = 0; setPlaying(false); return; }
      a.play().then(() => setPlaying(true), () => setPlaying(false));
    };
    return (
      <div className="ttst__ref">
        <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '停止' : '听参考录音'} onClick={toggle} />
        <span className="grow ttst__reftxt">
          <span className="t-detail-xs">{note || `参考录音 · ${r.name} · ${r.dur} 秒 · 原文自动带上`}</span>
          {note ? null : <span className="t-detail-xs ttst__refline">{r.text}</span>}
        </span>
      </div>
    );
  }

  /* 试听（2026-09-14 三轮）：点行上的「试听」只展开面板，不合成。音色、念什么都是芯片，点了只改选择；
     选好后点「生成试听」才合成。结果带着自己的身份（quickKey）——选择一变，旧结果就标成「上一次」，
     不让芯片看起来像是在切换已经念好的音频。Qwen3-TTS 1.7B VoiceDesign 只能按描述造声音（bcut tts --instruct）。 */
  function TtsQuickTest({m, initialVoice, check, onCheck}) {
    const app = useApp();
    const CK = window.BC_LOCALCHECK;
    const saved = drafts.get(m.id) || {};
    const [pick, setPick] = useState(() => Object.assign({}, saved.pick || TTS.quickDefaults(m.id), initialVoice ? {voice: initialVoice} : {}));
    const [file, setFile] = useState(saved.file || null);
    // 「用示例录音」放进来的随包录音（内置音色 id），不是用户自己选的文件
    const [sampleRef, setSampleRef] = useState(saved.sampleRef || null);
    const [editing, setEditing] = useState(!!saved.editing);
    const [draft, setDraft] = useState(saved.draft || '');
    const [result, setResult] = useState(saved.result || null);
    const [pct, setPct] = useState(-1);          // -1 = 没在合成
    const [more, setMore] = useState(false);
    // 这次试听没成：{kind, file?, msg?}，说法在 BC_LOCALCHECK.tryFailure；选择一变就清掉
    const [fail, setFail] = useState(null);
    const fileInput = useRef(null);
    const timer = useRef(null);
    const job = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    useEffect(() => { drafts.set(m.id, {pick, file, sampleRef, editing, draft, result}); }, [pick, file, sampleRef, editing, draft, result]);
    // 「试听克隆」从我的声音那一行点进来：换一只音色再点，选上的要跟着换（drafts 记的是上一只）
    useEffect(() => { if (initialVoice) setPick((p) => Object.assign({}, p, {voice: initialVoice})); }, [initialVoice]);
    // 「克隆新音色…」的回程：设置页存好后带着 voiceId 回来，这只试听认领
    const handoff = app.voiceHandoff;
    useEffect(() => {
      if (handoff && handoff.key === 'quick:' + m.id && handoff.voiceId) {
        setPick((p) => Object.assign({}, p, {voice: 'my:' + handoff.voiceId}));
        app.setVoiceHandoff(null);
      }
    }, [handoff]);

    const spec = TTS.MODELS[m.id] || {};
    const preset = spec.mode === 'preset';
    const voices = TTS.quickVoices(m.id, app.voices);
    const langs = TTS.sampleLangs(m.id);
    const kinds = TTS.sampleKinds(pick.lang);
    const tones = TTS.quickTones(m.id);
    const slow = TTS.quickSlow(m.id);
    const busy = pct >= 0;
    const eff = Object.assign({}, pick, {custom: editing ? draft : ''});
    const form = TTS.quickForm(m.id, eff, file, app.voices);
    const formKey = TTS.quickKey(form);
    const stale = !!result && result.key !== formKey;
    useEffect(() => { setFail(null); }, [formKey]);
    const ownFile = pick.voice === 'file' && !!file && !sampleRef;

    const run = () => {
      const errs = TTS.validatePreview(form);
      if (errs.length) { setFail({kind: 'invalid', msg: errs[0]}); return; }
      setFail(null);
      // 结果由原型开关「下次试听的结果」决定（shell.jsx TweaksPanel）
      job.current = {form, pick: eff, t0: Date.now(), outcome: CK.tryOutcome(app.prefs.modelTryDemo, ownFile), file: file && file.name};
      setPct(0);
      clearInterval(timer.current);
      timer.current = setInterval(() => setPct((x) => {
        const n = Math.min(100, x + (slow ? 2 : 5));
        if (n >= 100) clearInterval(timer.current);
        return n;
      }), 60);
    };
    useEffect(() => {
      const j0 = job.current;
      // 失败在读参考录音时（一开始）或合成到一半时出现，留在面板里，不弹 toast
      const failAt = !j0 || j0.outcome === 'ok' ? 101 : j0.outcome === 'refUnreadable' ? 15 : 60;
      if (j0 && pct >= failAt) {
        clearInterval(timer.current);
        job.current = null;
        setPct(-1);
        setFail({kind: j0.outcome, file: j0.file});
        return;
      }
      if (pct < 100 || !job.current) return;
      const j = job.current;
      job.current = null;
      setPct(-1);
      setResult({key: TTS.quickKey(j.form), summary: TTS.quickSummary(j.form, j.pick, (Date.now() - j.t0) / 1000), builtin: !!(j.form.ref && j.form.ref.builtin), at: Date.now()});
    }, [pct]);

    /* 只改选择。选「克隆我的声音」**不当场弹文件框**（2026-09-21）：那一下把人推去
       翻硬盘，找不到就只能退出来，克隆这条路也就没人走过。改成先摊开下面那一块，
       说清要什么样的录音，再给「选录音…」与「用示例录音」两个明确的去处。 */
    const choose = (patch) => {
      if (busy) return;
      setPick(Object.assign({}, pick, patch));
    };
    const useSample = () => {
      if (busy) return;
      const b = TTS.defaultBuiltin(pick.lang, '');
      setFile({name: b.name, dur: b.dur});
      setSampleRef(b.id);
      setPick(Object.assign({}, pick, {voice: 'file'}));
    };
    const onNote = (k) => {
      if (k === 'pickRef') { if (!busy) fileInput.current.click(); }
      else if (k === 'useSample') useSample();
      else if (k === 'retry') run();
      else if (onCheck) { setFail(null); onCheck(k); }   // check / recheck / repair 回到这一行
    };
    const notice = CK.tryNotice(check, 'tts', result && result.at);
    const failRaw = fail ? CK.tryFailure(fail.kind, 'tts', fail) : null;
    // 别处（设置 › 我的声音）借这块面板时没有那一行可回，「检查模型」改成说去哪儿检查
    const failView = failRaw && !onCheck && failRaw.actions.some((a) => a.k === 'check')
      ? Object.assign({}, failRaw, {todo: '到设置 › 本地模型 › 语音合成，在这只模型的 ⋯ 里检查它。', actions: failRaw.actions.filter((a) => a.k !== 'check')})
      : failRaw;
    const line = TTS.sampleLine(pick.lang, pick.kind);
    /* 「更多音色」：预设模型收其余五只预设，其余收快捷四只之外的四只内置音色
       （日 / 西男女）。两种都长成 {id, label, sub}，Picker 一份写法。 */
    const rest = preset
      ? TTS.PRESETS.filter((p) => TTS.QUICK_PRESETS.indexOf(p.id) < 0).map((p) => ({id: p.id, label: p.sub, sub: p.id}))
      : TTS.moreBuiltins().map((r) => ({id: r.id, label: r.label, sub: `${r.dur} 秒 · ${r.text.slice(0, 14)}…`}));
    const restOn = rest.find((p) => p.id === pick.voice);
    const refOn = spec.mode !== 'describe' && TTS.builtinRef(pick.voice);
    const describedOn = spec.mode === 'describe' && TTS.builtinRef(pick.voice);
    const describeOn = TTS.DESCRIBE_VOICES.find((v) => v.k === pick.voice);
    const myOn = String(pick.voice || '').indexOf('my:') === 0 ? app.voices.find((v) => 'my:' + v.id === pick.voice) : null;
    const canClone = spec.mode !== 'preset' && spec.mode !== 'describe';
    const goClone = () => {
      app.setVoiceHandoff({key: 'quick:' + m.id, from: `「${m.name}」的试听`, route: app.route});
      app.go({r: 'settings', sec: 'voices'});
    };

    return (
      <div className="ttst">
        {notice ? <window.ModelTryNote view={notice} onAction={onNote} /> : null}
        <div className="ttst__row">
          <span className="ttst__lab">音色</span>
          <div className="ttst__chips">
            {voices.map((v) => (
              <Chip key={v.k} pill on={pick.voice === v.k} title={v.sub} onClick={() => choose({voice: v.k})}>
                {v.k === 'file' ? (file ? (sampleRef ? `示例 · ${file.name}` : file.name) : '临时用一段') : v.label}
              </Chip>
            ))}
            {canClone ? <Chip pill icon="plus" onClick={goClone}>克隆新音色…</Chip> : null}
            {rest.length ? (
              <Picker size="s" value={restOn ? restOn.label : '更多音色'} open={more} popWidth={240}
                onClick={() => { if (!busy) setMore((x) => !x); }} onClose={() => setMore(false)}>
                <Menu>
                  {rest.map((p) => (
                    <MenuItem key={p.id} label={p.label} sub={p.sub} on={p.id === pick.voice}
                      onClick={() => { setMore(false); choose({voice: p.id}); }} />
                  ))}
                </Menu>
              </Picker>
            ) : null}
          </div>
        </div>
        {refOn ? <RefPreview r={refOn} /> : null}
        {spec.mode === 'preset' && app.voices.length ? (
          <p className="t-detail-xs ttst__note">这只模型只有自带的说话人 · 「我的声音」要在能克隆的模型上试：
            {(() => { const on = window.BC_VOICES.CLONE_MODELS.filter((id) => app.modelInstalled(id)).map((id) => (window.BC_DATA.setModels.find((x) => x.id === id) || {}).name).filter(Boolean); return on.length ? on.join(' / ') + '（各自那一行的试听）' : 'IndexTTS2 / Qwen3-TTS Base / GPT-SoVITS，先下载一只'; })()}
          </p>
        ) : null}
        {myOn ? (
          <div className="ttst__ref">
            <window.VoicePlay v={myOn} />
            <span className="grow ttst__reftxt">
              <span className="t-detail-xs">我的声音 · {myOn.name} · {window.BC_VOICES.metaLine(myOn)} · {window.BC_VOICES.profileFor(spec.engine).line}</span>
              {myOn.text ? <span className="t-detail-xs ttst__refline">{myOn.text}</span> : null}
            </span>
          </div>
        ) : null}
        {/* VoiceDesign 接不了参考音频：同一只内置音色在它身上是这句英文描述 */}
        {describedOn ? <p className="t-detail-xs ttst__note">按描述造声 · {describedOn.describe}</p> : null}
        {describeOn ? <p className="t-detail-xs ttst__note">描述：{describeOn.instruct}</p> : null}
        {pick.voice === 'file' ? (
          <div className="ttst__clone">
            {sampleRef ? (
              <RefPreview r={TTS.builtinRef(sampleRef)} note={`示例录音 · ${file.name} · 随 BaoCut 自带，不用去找文件`} />
            ) : (
              <p className="t-detail-xs">
                {file ? `你的录音 · ${file.name}`
                  : '给一段 5–15 秒的干净人声：一个人说话、没有背景音乐。WAV / MP3 / M4A / FLAC 或视频文件都行。'}
              </p>
            )}
            <div className="ttst__clonego">
              <Btn variant="secondary" size="s" icon="upload" onClick={() => { if (!busy) fileInput.current.click(); }}>
                {file ? '换一段…' : '选录音…'}
              </Btn>
              <Btn variant="secondary" size="s" icon="wave" onClick={useSample}>用示例录音</Btn>
              <span className="t-detail-xs grow">跨语言也行：中文录音照样能念英文。</span>
            </div>
          </div>
        ) : null}
        {pick.voice === 'describe' ? (
          <div className="ttst__custom">
            <Field area rows={2} disabled={busy} aria-label="声音描述" value={pick.describe || ''}
              placeholder="例如：低沉、慢条斯理的老年男声" onChange={(e) => setPick(Object.assign({}, pick, {describe: e.target.value}))} />
          </div>
        ) : null}
        <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (!f) return;
          setFile({name: f.name});
          setSampleRef(null);
          setPick(Object.assign({}, pick, {voice: 'file'}));
        }} />
        {tones.length ? (
          <div className="ttst__row">
            <span className="ttst__lab">语气</span>
            <div className="ttst__chips">
              {tones.map((t) => (
                <Chip key={t.k} pill on={pick.tone === t.k} title={t.instruct || ''}
                  onClick={() => choose({tone: t.k})}>{t.label}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="ttst__row">
          <span className="ttst__lab">念什么</span>
          <div className="ttst__chips">
            {langs.map((l) => (
              <Chip key={l.code} pill on={!editing && pick.lang === l.code}
                onClick={() => {
                  if (busy) return;
                  setEditing(false);
                  // 换语言是想听同一句话换种语言念，台词种类留着；这门语言没有才落回第一句
                  choose({lang: l.code, kind: TTS.sampleLine(l.code, pick.kind).kind});
                }}>{l.label}</Chip>
            ))}
            <Chip pill icon="edit" on={editing} onClick={() => { if (!busy) setEditing(true); }}>自己写一句</Chip>
          </div>
        </div>
        {!editing && kinds.length > 1 ? (
          <div className="ttst__row">
            <span className="ttst__lab">台词</span>
            <div className="ttst__chips">
              {kinds.map((k) => (
                <Chip key={k.k} pill on={pick.kind === k.k} onClick={() => choose({kind: k.k})}>{k.label}</Chip>
              ))}
            </div>
          </div>
        ) : null}
        {editing ? (
          <div className="ttst__custom">
            <Field area rows={2} disabled={busy} aria-label="试听文本" value={draft} placeholder="输入想听的句子"
              onChange={(e) => setDraft(e.target.value)} />
          </div>
        ) : <p className="ttst__line">「{line.text}」</p>}

        <div className="ttst__go">
          {busy ? (
            <div className="ttst__busy">
              <span className="t-detail-xs">正在合成 · {TTS.genPhase(pct, 1).label}</span>
              <Progress value={pct} thin />
            </div>
          ) : result && !stale ? (
            <Btn variant="secondary" size="s" icon="refresh" onClick={run}>再生成一次</Btn>
          ) : (
            <Btn variant="accent" size="s" icon="play" onClick={run}>生成试听</Btn>
          )}
          {slow && !busy ? <span className="t-detail-xs grow">{slow}</span> : null}
        </div>
        {failView ? <window.ModelTryNote view={failView} onAction={onNote} className="ttst__fail" /> : null}

        {result ? (
          <div className={'ttst__out' + (stale ? ' is-stale' : '')}>
            <div className="ttst__row">
              <span className="t-detail-xs grow">{stale ? '上一次 · ' : ''}{result.summary}</span>
              <RSP.LinkButton variant="secondary" size="S" href="assets/cloud-test.wav" download="tts-preview-demo.wav">下载</RSP.LinkButton>
            </div>
            <audio controls preload="metadata" src="assets/cloud-test.wav" aria-label="试听结果" />
            {stale ? <p className="t-detail-xs">这段是上一次的选择念的；换了音色或内容后，点「生成试听」听新的。</p> : null}
            <p className="t-detail-xs">交互演示 · 播放的是示例音频，真实合成在桌面 App。{result.builtin ? ' 内置音色录音：' + TTS.REF_CREDIT : ''}</p>
          </div>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {TtsQuickTest, TtsRefChip: RefChip, TtsInlinePlayer: InlinePlayer});
})();
