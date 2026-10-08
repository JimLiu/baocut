/* 工具 › 生成语音的表单各节 —— 从 tool-tts.jsx 拆出（product-design §2.7；工作台细则见 tool-tts.jsx 头注释）。
   模型一行与模型格（ModelLine / EngineGrid）、云端音色（CloudVoiceSection）、参考录音（RefSample）、
   本机声音（VoiceSection 与 StyleRows、WORKBENCH_MODES）、语言与细节（OptionsSection），以及「同一时刻只响一段」的播放钩子 useSound。
   在 tool-tts.jsx 之前加载，挂到 window.TtsForm，由生成语音页取用。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const T = window.BC_TOOLS;
  const C = window.BC_CLOUD_TTS;
  const mb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB');
  const sizeOf = (id) => (D.setModels.find((m) => m.id === id) || {}).size || 0;

  /* ---------- 播放：同一时刻只响一段 ---------- */
  let sounding = null;
  function useSound(src) {
    const [on, setOn] = useState(false);
    const [t, setT] = useState(0);
    const [d, setD] = useState(0);
    const el = useRef(null);
    useEffect(() => () => { if (el.current) el.current.pause(); }, []);
    const toggle = () => {
      if (!el.current) {
        const a = new Audio(src);
        a.ontimeupdate = () => setT(a.currentTime);
        a.onloadedmetadata = () => setD(a.duration);
        a.onplay = () => setOn(true);
        a.onpause = () => setOn(false);
        a.onended = () => setT(0);
        el.current = a;
      }
      const a = el.current;
      if (!a.paused) { a.pause(); return; }
      if (sounding && sounding !== a) sounding.pause();
      sounding = a;
      a.play().catch(() => setOn(false));
    };
    const seek = (ratio) => { const a = el.current; if (a && isFinite(a.duration)) a.currentTime = ratio * a.duration; };
    return {on, t, d, toggle, seek};
  }
  /* ---------- 左栏：模型 ---------- */
  /** 收起时的一行：当前模型、装没装、它能做什么。要挑模型再按「换一只模型」把卡片摊开。 */
  function ModelLine({f, set}) {
    const app = useApp();
    const e = TTS.engineOf(f.engine);
    const [open, setOpen] = useState(false);
    if (e.cloud) {
      const on = app.modelInstalled(e.models.preset);
      const c = T.engineCard(f.engine, on);
      const mid = T.modelOf(f);
      return (
        <div className="ttsmodel">
          <b className="t-title-sm">{c.name}</b>
          <span className={cx('ttseng__inst', on && 'is-ok')}>{on ? <><Ic n="ok" className="ic--12" />已连接</> : '未连接'}</span>
          {/* 这家的模型在这里挑：能力按模型算（gpt-4o-mini-tts 收风格指令、eleven_v3 70+ 种语言） */}
          <Picker size="s" value={(C.parse(mid) || {}).model} open={open} popWidth={320}
            onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)}>
            <Menu>
              {e.cloudModels.map((m) => (
                <MenuItem key={m.id} label={m.model} sub={m.desc} wrap on={m.id === mid} suffix={m.prev ? '上一代' : undefined}
                  onClick={() => { setOpen(false); set(T.switchCloudModel(f, m.id)); }} />
              ))}
              {/* 与音频面板同一条：选模型的时候就能去设置添加模型 / 刷新音色目录 */}
              <MenuRule />
              <MenuItem icon="settings" label="管理这家的模型…" sub="添加模型、刷新音色目录 · 设置 › 模型 › 语音合成 › 云端模型" wrap
                onClick={() => { setOpen(false); app.go({r: 'settings', sec: 'cloud', tab: 'tts'}); }} />
            </Menu>
          </Picker>
          <span className="ttsmodel__line t-detail grow">{c.line}</span>
        </div>
      );
    }
    const c = T.engineCard(f.engine);
    const ids = T.modelsOf(f.engine);
    const have = ids.filter((id) => app.modelInstalled(id)).length;
    return (
      <div className="ttsmodel">
        <b className="t-title-sm">{c.name}</b>
        <span className={cx('ttseng__inst', have === ids.length && 'is-ok')}>
          {have === ids.length ? <><Ic n="ok" className="ic--12" />已安装</>
            : have ? '部分已安装' : mb(ids.reduce((s, id) => s + sizeOf(id), 0))}
        </span>
        <span className="ttsmodel__line t-detail grow">{c.line}</span>
      </div>
    );
  }

  function EngineGrid({f, set}) {
    const app = useApp();
    return (
      <BCChoiceGroup className="ttsw__engines" value={f.engine} onChange={engine => set(T.switchEngine(f, engine))} aria-label="模型">
        {TTS.ENGINES.map((e) => {
          const c = T.engineCard(e.id);
          const ids = T.modelsOf(e.id);
          const have = ids.filter((id) => app.modelInstalled(id)).length;
          const on = f.engine === e.id;
          return (
            <BCAction key={e.id} type="button" choiceKey={e.id}  className={cx('ttseng', on && 'is-on')}
              >
              <span className="ttseng__hd">
                <b>{c.name}</b>
                <span className={cx('ttseng__inst', have === ids.length && 'is-ok')}>
                  {have === ids.length ? <><Ic n="ok" className="ic--12" />已安装</>
                    : have ? '部分已安装' : mb(ids.reduce((s, id) => s + sizeOf(id), 0))}
                </span>
              </span>
              <span className="ttseng__line">{c.line}</span>
              <span className="ttseng__tags">{c.tags.map((t) => <Chip key={t.label} tone={t.tone}>{t.label}</Chip>)}</span>
            </BCAction>
          );
        })}
        {/* 云端：设置 › 模型 › 语音合成 › 云端模型里连了密钥的 API 提供方一家一张卡；没连的也列出来（淡一档、写「未连接」），选中后下方是连接卡 */}
        <span className="ttsw__grouphd">云端 · 联网计费 <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'tts'})}>设置 › 模型 › 语音合成</BCAction></span>
        {C.allEngines(app.cloudCustom).map((e) => {
          const on = f.engine === e.id;
          const connected = app.modelInstalled(e.models.preset);
          const c = T.engineCard(e.id, connected);
          return (
            <BCAction key={e.id} type="button" choiceKey={e.id}  className={cx('ttseng', on && 'is-on', !connected && 'is-off')}
              >
              <span className="ttseng__hd">
                <b>{c.name}</b>
                <span className={cx('ttseng__inst', connected && 'is-ok')}>
                  {connected ? <><Ic n="ok" className="ic--12" />已连接</> : '未连接'}
                </span>
              </span>
              <span className="ttseng__line">{c.line}</span>
              <span className="ttseng__tags">{c.tags.filter((t) => t.label !== '未连接').map((t) => <Chip key={t.label} tone={t.tone}>{t.label}</Chip>)}</span>
            </BCAction>
          );
        })}
      </BCChoiceGroup>
    );
  }

  /* ---------- 左栏：云端引擎的声音（§2.2 / §2.3）：共享选择器 + 风格（收指令的模型）+ 语速 + 各家的滑杆 ---------- */
  function CloudVoiceSection({f, set}) {
    const app = useApp();
    const V = window.BC_VOICES;
    const e = TTS.engineOf(f.engine);
    const cap = C.capabilities(C.providerById(e.provider, app.cloudCustom) || e.provider, (C.parse(T.modelOf(f)) || {}).model);
    // 没有数值语速的提供方（Gemini）不画语速行，不给一个假区间；快慢写进风格
    const speed = cap.speed;
    return (
      <section className="ttsw__sec">
        <div className="ttsw__sechd"><span className="t-section grow">声音</span></div>
        <div className="ttsw__row">
          <span className="ttsw__lab">音色</span>
          <window.VoicePicker engine={f.engine} value={f.cloudVoice} lang={f.lang} popWidth={340}
            pickKey="tool-tts" from="「生成语音」工作台" onChange={(val) => set(V.applyToForm(f, val, app.voices))} />
        </div>
        <window.VoiceLine engine={f.engine} value={f.cloudVoice} lang={f.lang} text={f.text} className="ttsw__indent" />
        {cap.instruct ? (
          <>
            <div className="ttsw__row">
              <span className="ttsw__lab">风格</span>
              <Field size="s" className="grow" value={f.style} aria-label="风格指令"
                placeholder="可选 · 一句话描述语气，例如：像深夜电台一样慢一点" onChange={(e) => set({style: e.target.value})} />
              <Btn variant="quiet" size="s" icon="refresh" onClick={() => set(T.rollVibe(f))}>换一句</Btn>
            </div>
            <div className="ttsw__vibes ttsw__indent">
              {T.VIBES.map((v) => (
                <BCAction key={v.k} type="button" className={cx('ttsvibe', f.style === v.style && 'is-on')}
                  aria-pressed={f.style === v.style} onClick={() => set(T.pickVibe(f, v.k))}>
                  <b>{v.name}</b>
                  <span>{v.style}</span>
                </BCAction>
              ))}
            </div>
          </>
        ) : null}
        {speed ? (
          <div className="ttsw__row">
            <span className="ttsw__lab">语速</span>
            <Slider className="ttsw__slider" value={f.speed} min={speed.min} max={speed.max} step={speed.step} onChange={(v) => set({speed: v})} />
            <span className="t-mono t-detail-xs">{(+f.speed).toFixed(2)}×</span>
            <span className="ttsw__range">{e.name} 收 {speed.min}–{speed.max}×{cap.instruct ? ' · 也可以写进风格里' : ''}</span>
          </div>
        ) : cap.instruct ? <div className="hint ttsw__indent">{e.name} 没有数值语速 · 快慢写进风格里</div> : null}
        {cap.sliders.map((sl) => (
          <div className="ttsw__row" key={sl.k}>
            <span className="ttsw__lab">{sl.label}</span>
            <Slider className="ttsw__slider" value={f[sl.k]} min={0} max={1} step={0.05} onChange={(v) => set({[sl.k]: v})} />
            <span className="t-mono t-detail-xs">{(+f[sl.k]).toFixed(2)}</span>
            <span className="ttsw__range">{sl.sub}</span>
          </div>
        ))}
      </section>
    );
  }

  /* ---------- 左栏：音色 ---------- */
  function RefSample({r}) {
    const s = useSound('assets/' + r.file);
    return <IconBtn icon={s.on ? 'pause' : 'play'} size="s" tip={s.on ? '暂停' : '听一下这段录音'} onClick={s.toggle} />;
  }

  /* 工作台里音色方式的标签比面板长一点（这里有地方写全） */
  const WORKBENCH_MODES = [
    {k: 'preset', label: '预设音色'}, {k: 'clone', label: '克隆一段录音'}, {k: 'describe', label: '描述一个声音'},
  ];

  /** 风格一行 + 六张念法卡：CustomVoice 在预设档，VoxCPM2 在克隆档（写了风格走可控克隆，录音原文这次不用） */
  function StyleRows({f, set}) {
    return (
      <>
        <div className="ttsw__row">
          <span className="ttsw__lab">风格</span>
          <Field size="s" className="grow" value={f.style} aria-label="风格指令"
            placeholder="可选 · 一句话描述语气，例如：像深夜电台一样慢一点" onChange={(e) => set({style: e.target.value})} />
          <Btn variant="quiet" size="s" icon="refresh" onClick={() => set(T.rollVibe(f))}>换一句</Btn>
        </div>
        {/* 现成的念法：点一下填进上面那一行；文字框还空着就顺手带一段示例，按下去立刻能听。 */}
        <div className="ttsw__vibes ttsw__indent">
          {T.VIBES.map((v) => (
            <BCAction key={v.k} type="button" className={cx('ttsvibe', f.style === v.style && 'is-on')}
              aria-pressed={f.style === v.style} onClick={() => set(T.pickVibe(f, v.k))}>
              <b>{v.name}</b>
              <span>{v.style}</span>
            </BCAction>
          ))}
        </div>
      </>
    );
  }

  function VoiceSection({f, set}) {
    const app = useApp();
    const fileInput = useRef(null);
    const [picking, setPicking] = useState(false);
    // 「更多音色」把八只都摊开（缺省只露快捷四只）
    const [more, setMore] = useState(false);
    const modes = T.voiceModes(f.engine);
    const source = TTS.refSourceOf(f.ref, picking);
    const builtin = f.ref && TTS.builtinRef(f.ref.builtin);
    const own = f.ref && !f.ref.builtin && !f.ref.my ? f.ref : null;
    const mine = f.ref && f.ref.my ? app.voices.find((v) => v.id === f.ref.my) : null;
    const profile = window.BC_VOICES.profileFor(f.engine);
    // 「克隆新音色…」去设置 › 模型 › 语音合成 › 我的声音，存好后回到工作台、这里认领
    const handoff = app.voiceHandoff;
    useEffect(() => {
      if (handoff && handoff.key === 'tool-tts' && handoff.voiceId) {
        set(Object.assign({mode: 'clone'}, TTS.pickRef(f, 'my:' + handoff.voiceId, null, app.voices)));
        app.setVoiceHandoff(null);
      }
    }, [handoff]);
    const goClone = () => {
      app.setVoiceHandoff({key: 'tool-tts', from: '「生成语音」工作台', route: app.route});
      app.go({r: 'settings', sec: 'voices'});
    };
    const refErr = TTS.refProblem(f);
    const pickSource = (k) => {
      setPicking(k === 'file');
      if (k !== 'file') { set(TTS.pickRef(f, k, null, app.voices)); return; }
      if (!own) { set(TTS.pickRef(f, 'file')); fileInput.current.click(); }
    };
    // 切到「克隆一段录音」不再强塞一段内置录音：不给参考就是按语言挑的默认音色
    const toMode = (k) => set({mode: k});
    return (
      <section className="ttsw__sec">
        <div className="ttsw__sechd">
          <span className="t-section grow">声音</span>
          {modes.length > 1 ? (
            <Segmented size="s" value={f.mode} onChange={toMode} items={WORKBENCH_MODES.filter((m) => modes.includes(m.k))} />
          ) : null}
        </div>

        {f.mode === 'preset' ? (
          <>
            <BCChoiceGroup className="ttsw__voices" value={f.preset} onChange={preset => set({preset})} aria-label="预设音色">
              {TTS.PRESETS.map((p) => (
                <BCAction key={p.id} type="button" choiceKey={p.id}
                  className={cx('ttsvoice', f.preset === p.id && 'is-on')} >
                  <b>{p.id}</b>
                  <span>{p.sub}</span>
                </BCAction>
              ))}
              <BCAction type="button" className="ttsvoice ttsvoice--roll" onClick={() => set({preset: T.rollPreset(f.preset)})}>
                <b><Ic n="refresh" className="ic--12" />随机</b>
                <span>换一个音色听听</span>
              </BCAction>
            </BCChoiceGroup>
            <StyleRows f={f} set={set} />
          </>
        ) : null}

        {f.mode === 'clone' ? (
          <>
            <div className="ttsw__row">
              <span className="ttsw__lab">参考录音</span>
              <div className="ttsw__chips">
                {TTS.refSources(f.engine, more, app.voices).map((s) => (
                  <Chip key={s.k} pill on={source === s.k} icon={s.my ? 'mic' : undefined} onClick={() => pickSource(s.k)}>
                    {s.k === 'file' && own ? own.name : s.label}
                  </Chip>
                ))}
                <Chip pill icon="plus" onClick={goClone}>克隆新音色…</Chip>
                {more ? null : <Chip pill onClick={() => setMore(true)}>更多音色…</Chip>}
              </div>
            </div>
            <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = '';
              if (file) set(TTS.pickRef(f, 'file', {name: file.name}));
            }} />
            <div className="ttsw__indent ttsw__ref">
              {source === 'none' ? (
                <span className="t-detail">不给录音就用按语言挑的内置音色（{TTS.defaultBuiltin(f.lang, f.text).label}）；给一段录音就按它克隆。</span>
              ) : null}
              {mine ? (
                <div className="ttsw__refrow">
                  <window.VoicePlay v={mine} />
                  <span className="grow">
                    <b className="t-title-sm">{mine.name}</b>
                    <span className="t-detail-xs ttsw__block">{window.BC_VOICES.metaLine(mine)} · {profile.ok ? profile.line + ' · ' + window.BC_VOICES.RUN_LINE : profile.why}</span>
                    {mine.text ? <span className="t-detail-xs ttsw__block">「{mine.text}」</span> : null}
                  </span>
                </div>
              ) : null}
              {builtin ? (
                <div className="ttsw__refrow">
                  <RefSample key={builtin.id} r={builtin} />
                  <span className="grow">
                    <b className="t-title-sm">{builtin.name}</b>
                    <span className="t-detail-xs ttsw__block">{builtin.dur} 秒 · {TTS.REF_CREDIT}</span>
                  </span>
                </div>
              ) : null}
              {source === 'file' ? (
                <div className="ttsw__refrow">
                  <Btn variant="secondary" size="s" icon="upload" onClick={() => fileInput.current.click()}>{own ? '换一段' : '选录音…'}</Btn>
                  <span className="t-detail-xs grow">用 3–15 秒、只有一个人在说话的清晰录音效果最好</span>
                </div>
              ) : null}
            </div>
            {source !== 'none' ? (
              <div className="ttsw__row">
                <span className="ttsw__lab">录音原文</span>
                <Field size="s" className="grow" value={f.refText} aria-label="录音原文" onChange={(e) => set({refText: e.target.value})}
                  placeholder={f.engine === 'gptsovits' ? '可选 · 给出原文会更像，这时录音要 3–10 秒' : TTS.refTextRequired(f.engine) ? '必填 · 录音里说的是什么（不写会吞掉开头）' : '可选 · 录音里说的是什么，给出会更像'} />
              </div>
            ) : null}
            {refErr ? <div className="hint hint--warn ttsw__indent">{refErr}</div> : null}
            {TTS.styleOn(f.engine, 'clone') ? (
              <>
                <StyleRows f={f} set={set} />
                <span className="t-detail-xs ttsw__indent">{f.style.trim()
                  ? '写了风格就只取录音的音色（可控克隆），录音原文这次不用'
                  : '不写风格：给了录音原文就接着录音往下念，最像本人'}</span>
              </>
            ) : null}
          </>
        ) : null}

        {f.mode === 'describe' && TTS.describeByVocab(f.engine) ? (
          /* OmniVoice：描述是按类挑项（性别 / 年龄 / 音高 / 风格，念英语多口音、念中文多方言），每类至多一项 */
          <>
            <window.OmniDescribe bench sel={f.omni} lang={f.lang} onChange={(omni) => set({omni})} />
            <span className="t-detail-xs">给了参考录音时听录音的：挑项只在「描述一个声音」这一档用。</span>
          </>
        ) : f.mode === 'describe' ? (
          <>
            <div className="ttsw__chips">
              {/* VoiceDesign 接不了参考音频：内置音色在它身上是一句英文描述，与其他引擎同名同挑法 */}
              {TTS.BUILTIN_REFS.map((r) => (
                <Chip key={r.id} pill on={f.instruct === r.describe} onClick={() => set({instruct: r.describe})}>{r.label}</Chip>
              ))}
              {TTS.DESCRIBE_VOICES.map((v) => (
                <Chip key={v.k} pill on={f.instruct === v.instruct} onClick={() => set({instruct: v.instruct})}>{v.label}</Chip>
              ))}
            </div>
            <Field area rows={2} value={f.instruct} aria-label="声音描述" placeholder="描述想要的声音，例如：低沉、慢条斯理的老年男声"
              onChange={(e) => set({instruct: e.target.value})} />
            <span className="t-detail-xs">声音完全由这句描述决定：换一句描述就是另一个人，没有预设音色可选。</span>
          </>
        ) : null}
      </section>
    );
  }

  /* ---------- 左栏：语言与细节 ---------- */
  function OptionsSection({f, set}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const [moreLangs, setMoreLangs] = useState(false);
    const flip = (k) => setPop(pop === k ? null : k);
    const pick = (patch) => { set(patch.lang ? Object.assign({omni: TTS.omniFit(f.omni, patch.lang)}, patch) : patch); setPop(null); };
    const e = TTS.engineOf(f.engine);
    const cap = e.cloud ? C.capabilities(C.providerById(e.provider, app.cloudCustom) || e.provider, (C.parse(T.modelOf(f)) || {}).model) : null;
    const langs = T.langOptions(f.engine, moreLangs, e.cloud ? T.modelOf(f) : null);
    const allLangs = T.langOptions(f.engine, true, e.cloud ? T.modelOf(f) : null);
    const cloudEmo = cap && cap.emotions ? (f.cloudEmotion === 'none' ? '不设' : (cap.emotions.find((x) => x.id === f.cloudEmotion) || {}).name) : null;
    const emoName = f.emotion === 'none' ? '不设' : f.emotion === 'ref' ? '跟参考录音' : f.emotion === 'ref2' ? '另给一段录音'
      : (TTS.EMOTIONS.find((e) => e.id === f.emotion) || {}).name;
    return (
      <section className="ttsw__sec">
        <div className="ttsw__sechd"><span className="t-section grow">语言与细节</span></div>
        <div className="ttsw__row">
          <span className="ttsw__lab">语言</span>
          <Picker size="s" value={(allLangs.find((l) => l.code === f.lang) || allLangs[0]).name} open={pop === 'l'} popWidth={180}
            onClick={() => flip('l')} onClose={() => { setPop(null); setMoreLangs(false); }}>
            <Menu>
              {langs.map((l) => <MenuItem key={l.code} label={l.name} on={l.code === f.lang} onClick={() => pick({lang: l.code})} />)}
              {/* 多语言引擎只列常用 12 种，其余折在「更多语言…」后面 */}
              {!moreLangs && allLangs.length > langs.length ? <><MenuRule /><MenuItem label="更多语言…" sub={`还有 ${allLangs.length - langs.length} 种`} onClick={() => setMoreLangs(true)} /></> : null}
              {e.cloud && cap && cap.langs === '*' && !moreLangs ? <><MenuRule /><MenuItem label="其他语言" sub="多语言模型会念常用表之外的语言 · 选「自动」按文字判断" disabled /></> : null}
            </Menu>
          </Picker>
          <span className="t-detail-xs grow">{TTS.engineName(f.engine)} 会念 {cap ? C.langsShort(C.providerById(cap.provider, app.cloudCustom) || cap.provider, cap.model) : T.langsShort(f.engine)}{f.lang === 'auto' ? ' · 自动时按文字判断' : ''}{cap && cap.api === 'minimax' ? ' · 发给 MiniMax 时映射成 language_boost' : ''}</span>
        </div>

        {cap && cap.emotions ? (
          <div className="ttsw__row">
            <span className="ttsw__lab">情绪</span>
            <Picker size="s" value={cloudEmo} open={pop === 'ce'} popWidth={200} onClick={() => flip('ce')} onClose={() => setPop(null)}>
              <Menu>
                <MenuItem label="不设" sub="由模型按文字判断" on={f.cloudEmotion === 'none'} onClick={() => pick({cloudEmotion: 'none'})} />
                <MenuRule />
                {cap.emotions.map((x) => <MenuItem key={x.id} label={x.name} sub={x.id} on={x.id === f.cloudEmotion} onClick={() => pick({cloudEmotion: x.id})} />)}
              </Menu>
            </Picker>
            <span className="t-detail-xs grow">{e.name} 的情绪是一组预设，不是强度</span>
          </div>
        ) : null}
        {cap && cap.pitch ? (
          <div className="ttsw__row">
            <span className="ttsw__lab">音高</span>
            <Slider className="ttsw__slider" value={f.pitch} min={cap.pitch.min} max={cap.pitch.max} step={1} onChange={(v) => set({pitch: v})} />
            <span className="t-mono t-detail-xs">{f.pitch > 0 ? '+' : ''}{f.pitch}</span>
            <span className="ttsw__range">半音 · {cap.pitch.min}…{cap.pitch.max}</span>
          </div>
        ) : null}
        {cap && cap.volume ? (
          <div className="ttsw__row">
            <span className="ttsw__lab">音量</span>
            <Slider className="ttsw__slider" value={f.volume} min={cap.volume.min} max={cap.volume.max} step={0.5} onChange={(v) => set({volume: v})} />
            <span className="t-mono t-detail-xs">{(+f.volume).toFixed(1)}</span>
            <span className="ttsw__range">{cap.volume.min}–{cap.volume.max} · 缺省 1</span>
          </div>
        ) : null}

        {TTS.hasEmotion(f.engine) ? (
          <>
            <div className="ttsw__row">
              <span className="ttsw__lab">情绪</span>
              <Picker size="s" value={emoName} open={pop === 'e'} popWidth={220} onClick={() => flip('e')} onClose={() => setPop(null)}>
                <Menu>
                  <MenuItem label="不设" on={f.emotion === 'none'} onClick={() => pick({emotion: 'none'})} />
                  <MenuItem label="跟参考录音" sub="用参考录音本身的情绪" on={f.emotion === 'ref'} onClick={() => pick({emotion: 'ref'})} />
                  <MenuItem label="另给一段录音" sub="声音来自参考录音，情绪来自这一段" on={f.emotion === 'ref2'} onClick={() => pick({emotion: 'ref2'})} />
                  <MenuRule />
                  {TTS.EMOTIONS.map((e) => <MenuItem key={e.id} label={e.name} on={e.id === f.emotion} onClick={() => pick({emotion: e.id})} />)}
                </Menu>
              </Picker>
              {TTS.EMOTIONS.some((e) => e.id === f.emotion) ? (
                <>
                  <span className="t-detail-xs">强度</span>
                  <Slider className="ttsw__slider" value={f.emoLevel} min={0} max={100} step={5} onChange={(v) => set({emoLevel: v})} />
                  <span className="t-mono t-detail-xs">{f.emoLevel}</span>
                </>
              ) : null}
            </div>
            {f.emotion === 'ref2' ? (
              <div className="ttsw__row ttsw__indent">
                <window.TtsRefChip file={f.emoRef} label="选情绪录音…"
                  onPick={() => set({emoRef: {name: 'excited-take.wav', dur: 4.8}})} onClear={() => set({emoRef: null})} />
              </div>
            ) : null}
          </>
        ) : null}

        {e.cloud ? (
          <div className="ttsw__row">
            <span className="ttsw__lab">种子</span>
            <span className="t-detail-xs">云端服务不保证复现，没有种子 · 同样的文字每次可能略有不同</span>
          </div>
        ) : (
          <div className="ttsw__row">
            <span className="ttsw__lab">种子</span>
            <Checkbox on={!!f.seed} onChange={(v) => set({seed: v})} label="固定随机种子 · 同样的文字和设置念出同样的声音" />
          </div>
        )}

        {/* 数值旋钮（2026-09-26）：IndexTTS 2.5 语速、VoxCPM2 / OmniVoice 引导强度与采样步数；默认收起，没拨过的不传 */}
        {e.cloud ? null : <window.TtsKnobs bench engine={f.engine} knobs={f.knobs} onChange={(knobs) => set({knobs})} />}
      </section>
    );
  }

  window.TtsForm = {useSound, ModelLine, EngineGrid, CloudVoiceSection, VoiceSection, OptionsSection, WORKBENCH_MODES};
})();
