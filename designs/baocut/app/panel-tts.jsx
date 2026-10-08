/* 音频 Tab 的「生成语音」/「克隆声音」子页 —— §13.6。
   同一张表单两个入口：「生成语音」默认预设音色，「克隆声音」默认参考音频。引擎七选一
   （Qwen3-TTS 0.6B / Qwen3-TTS 1.7B / IndexTTS2 / IndexTTS 2.5 / GPT-SoVITS / VoxCPM2 / OmniVoice）：两只 Qwen3-TTS 都有
   Qwen3-TTS 的 9 个预设音色与克隆，1.7B 再多一档「描述」（VoiceDesign，一句自由描述）；OmniVoice 克隆或「描述」
   （按类挑项，不是自由文字）；其余引擎只能克隆。情绪只 IndexTTS 两只有，风格指令在 CustomVoice 的预设档与
   VoxCPM2 的克隆档（可控克隆），语言 Picker 只列引擎会念的。IndexTTS 2.5 / VoxCPM2 / OmniVoice 多一个「高级」折叠放数值旋钮
   （2026-09-26，panel-tts-local.jsx）。音色方式换的是要装的那只模型，
   模型没装时表单下方挂一张下载卡（与 AI 工具的模型下拉同一
   套 `mdlbar` / `mdlget`），装好后主按钮才亮。生成是**任务**（§15.1：进度卡 + 任务记录），
   跑完落成一张素材卡（来源章「TTS」）收进素材库，放到时间轴仍是另一步。
   文字框下的「注音」钮（2026-09-23，readings-chips.jsx `TextReadings`）标出多音字，按下的读音随表单走，
   合成与「按句放到时间轴」都用带注记的文字（`BC_READINGS.formText`）。
   云端引擎（2026-09-24 云端语音合成设计稿 §2.2 / §2.5）：引擎 Picker 多一组「云端」——设置里连了密钥的 API 提供方；选中后
   多一行「模型」，音色改走共享选择器（默认 / 我的声音 / 提供方音色 / 临时用一段），风格只在收指令的模型上出现，
   语速滑杆按各家区间（没有数值语速的 API 提供方——Gemini——不出这一行，快慢写进风格）；模型下载卡换成「先连接 X」的连接卡；
   合成是联网任务，计费口径按 API 提供方（多数按字符，Gemini 按 token）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const T = window.BC_TIME;
  const C = window.BC_CLOUD_TTS;
  const mb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : n + ' MB');

  const SAMPLE = '欢迎使用 BaoCut！转录、翻译、配音、剪辑，全都在你自己的电脑上完成，素材一步都不用上传。';

  function blank(clone) {
    return {text: '', engine: 'qwen3', mode: clone ? 'clone' : 'preset', preset: 'Serena', ref: null, refText: '',
      lang: 'auto', emotion: 'none', emoRef: null, emoLevel: 60, style: '', instruct: '',
      knobs: {}, omni: Object.assign({}, TTS.OMNI_PRESETS[0].sel),
      cloudModel: null, cloudVoice: {kind: 'default'}, speed: 1, pitch: 0, volume: 1, stability: 0.5, similarity: 0.75, styleStrength: 0, cloudEmotion: 'none'};
  }
  /* 名字给收据 / 运行态用：本地查 MODELS，云端拼「ElevenLabs · eleven_v3」 */
  const modelName = (f, mid) => TTS.engineOf(f.engine).cloud ? `${TTS.engineOf(f.engine).name} · ${(C.parse(mid) || {}).model}` : TTS.MODELS[mid].name;

  /** 表单下的模型下载卡：没装 → 下载按钮；在下 → 细进度条；装好即消失。 */
  /** `extra`：调用方再塞一个按钮（工具页的「换用已装的 X」），不给就只有下载与管理。 */
  function ModelGate({id, extra}) {
    const app = useApp();
    const m = D.setModels.find((x) => x.id === id);
    if (!m || app.modelInstalled(id)) return null;
    const pct = app.modelDl[id];
    // 不许商用的权重（OmniVoice）：卡上写许可提要，点下载先弹「许可」确认（panel-tts-local.jsx）
    const lic = window.ttsLicenseOf(id);
    return (
      <div className="aicard aicard--warn">
        <b>先下载 {m.name} · {mb(m.size)}</b>
        <span>{m.note}。下载不占任务队列，装好后这一页的主按钮就能按。</span>
        {lic ? <span>{window.ttsLicenseBrief(lic)}。</span> : null}
        {/* 工作台窄栏里「换用已装的 X」较长，按钮行放不下就折到下一行，不把「管理本地模型…」挤成竖排 */}
        <div className="row gap8" style={{marginTop: 4, flexWrap: 'wrap'}}>
          {pct == null
            ? <Btn variant="accent" size="s" icon="download" onClick={() => window.withModelLicense(app, id, () => app.downloadModel(id))}>下载 {mb(m.size)}</Btn>
            : <><span className="mdlbar" style={{width: 120}}><i style={{width: pct + '%'}} /></span><span className="t-detail-xs">{pct}%</span></>}
          {extra || null}
          <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'tts'})}>管理本地模型…</BCAction>
        </div>
      </div>
    );
  }

  /** 云端引擎没连密钥时表单下的连接卡（与本地的下载卡同一块位置、同一套 aicard） */
  function CloudGate({engine, extra}) {
    const app = useApp();
    const e = TTS.engineOf(engine);
    if (!e.cloud || app.modelInstalled(e.models.preset)) return null;
    const p = C.providerById(e.provider, app.cloudCustom) || e.provider;
    return (
      <div className="aicard aicard--warn">
        <b>先在设置 › 模型 › API 提供方给 {e.name} 添加账号</b>
        <span>连上密钥后这一页的主按钮就能按；合成走 {e.name} 的服务，{C.billing(p)}{C.capabilities(p).clone ? '，参考段克隆会上传给它' : ''}。</span>
        <div className="row gap8" style={{marginTop: 4}}>
          <Btn variant="accent" size="s" icon="remote" onClick={() => app.go({r: 'settings', sec: 'cloud', tab: 'tts'})}>去连接</Btn>
          {extra || null}
        </div>
      </div>
    );
  }

  /** 云端引擎的那几行：模型 / 音色 / 风格 / 语速 / 各家滑杆 / 语言 / 情绪 · 音高 · 音量 */
  function CloudRows({f, set, pop, setPop, clone}) {
    const app = useApp();
    const V = window.BC_VOICES;
    const TL = window.BC_TOOLS;
    const e = TTS.engineOf(f.engine);
    const mid = TL.modelOf(f);
    const [moreLangs, setMoreLangs] = useState(false);
    const cap = C.capabilities(C.providerById(e.provider, app.cloudCustom) || e.provider, (C.parse(mid) || {}).model);
    // 没有数值语速的 API 提供方（Gemini）不画语速行，不给一个假区间
    const speed = cap.speed;
    const langs = TL.langOptions(f.engine, moreLangs, mid);
    const allLangs = TL.langOptions(f.engine, true, mid);
    const emo = cap.emotions ? (f.cloudEmotion === 'none' ? '不设' : (cap.emotions.find((x) => x.id === f.cloudEmotion) || {}).name) : null;
    return (
      <>
        <window.PRow label="模型">
          <Picker size="s" value={(C.parse(mid) || {}).model} open={pop === 'm'} popWidth={300}
            onClick={() => setPop(pop === 'm' ? null : 'm')} onClose={() => setPop(null)}>
            <Menu>
              {e.cloudModels.map((m) => (
                <MenuItem key={m.id} label={m.model} sub={m.desc} wrap on={m.id === mid} suffix={m.prev ? '上一代' : undefined}
                  onClick={() => { set(TL.switchCloudModel(f, m.id)); setPop(null); }} />
              ))}
              {/* 这家的模型在设置里加 / 音色目录在设置里刷：选模型的时候就能过去，不用自己找 */}
              <MenuRule />
              <MenuItem icon="settings" label="管理这家的模型…" sub="添加模型、测试 · 设置 › 模型 › API 提供方" wrap
                onClick={() => { setPop(null); app.go({r: 'settings', sec: 'cloud', tab: 'tts'}); }} />
            </Menu>
          </Picker>
        </window.PRow>
        <window.PRow label="音色">
          <window.VoicePicker engine={f.engine} value={f.cloudVoice} lang={f.lang} popAlign="right" popWidth={320}
            pickKey="panel-tts" from={clone ? '「克隆声音」面板' : '「生成语音」面板'} reopen={{tab: 'audio', paneView: clone ? 'tts-clone' : 'tts'}}
            onChange={(val) => set(V.applyToForm(f, val, app.voices))} />
        </window.PRow>
        <window.VoiceLine engine={f.engine} value={f.cloudVoice} lang={f.lang} text={f.text} />
        {cap.instruct ? (
          <window.PRow label="风格">
            <Field size="s" value={f.style} onChange={(e) => set({style: e.target.value})}
              placeholder="可选 · 一句话，例如：像深夜电台一样慢一点" style={{flex: 1}} />
          </window.PRow>
        ) : null}
        {cap.instruct && !speed ? <div className="hint hint--tight">{e.name} 没有数值语速 · 快慢写进风格里</div> : null}
        {speed ? (
          <window.PRow label="语速">
            <Slider value={f.speed} min={speed.min} max={speed.max} step={speed.step} onChange={(v) => set({speed: v})} />
            <span className="t-mono t-detail-xs" style={{width: 44, textAlign: 'right'}}>{(+f.speed).toFixed(2)}×</span>
          </window.PRow>
        ) : null}
        {cap.sliders.map((sl) => (
          <window.PRow key={sl.k} label={sl.label}>
            <Slider value={f[sl.k]} min={0} max={1} step={0.05} onChange={(v) => set({[sl.k]: v})} />
            <span className="t-mono t-detail-xs" style={{width: 44, textAlign: 'right'}}>{(+f[sl.k]).toFixed(2)}</span>
          </window.PRow>
        ))}
        <window.PRow label="语言">
          <Picker size="s" value={(allLangs.find((l) => l.code === f.lang) || allLangs[0]).name} open={pop === 'l'} popWidth={180}
            onClick={() => setPop(pop === 'l' ? null : 'l')} onClose={() => { setPop(null); setMoreLangs(false); }}>
            <Menu>
              {langs.map((l) => (
                <MenuItem key={l.code} label={l.name} on={l.code === f.lang} onClick={() => { set({lang: l.code}); setPop(null); }} />
              ))}
              {!moreLangs && allLangs.length > langs.length ? <><MenuRule /><MenuItem label="更多语言…" sub={`还有 ${allLangs.length - langs.length} 种`} onClick={() => setMoreLangs(true)} /></> : null}
            </Menu>
          </Picker>
        </window.PRow>
        {cap.emotions ? (
          <window.PRow label="情绪">
            <Picker size="s" value={emo} open={pop === 'ce'} popWidth={200}
              onClick={() => setPop(pop === 'ce' ? null : 'ce')} onClose={() => setPop(null)}>
              <Menu>
                <MenuItem label="不设" sub="由模型按文字判断" on={f.cloudEmotion === 'none'} onClick={() => { set({cloudEmotion: 'none'}); setPop(null); }} />
                <MenuRule />
                {cap.emotions.map((x) => <MenuItem key={x.id} label={x.name} sub={x.id} on={x.id === f.cloudEmotion} onClick={() => { set({cloudEmotion: x.id}); setPop(null); }} />)}
              </Menu>
            </Picker>
          </window.PRow>
        ) : null}
        {cap.pitch ? (
          <window.PRow label="音高">
            <Slider value={f.pitch} min={cap.pitch.min} max={cap.pitch.max} step={1} onChange={(v) => set({pitch: v})} />
            <span className="t-mono t-detail-xs" style={{width: 44, textAlign: 'right'}}>{f.pitch > 0 ? '+' : ''}{f.pitch}</span>
          </window.PRow>
        ) : null}
        {cap.volume ? (
          <window.PRow label="音量">
            <Slider value={f.volume} min={cap.volume.min} max={cap.volume.max} step={0.5} onChange={(v) => set({volume: v})} />
            <span className="t-mono t-detail-xs" style={{width: 44, textAlign: 'right'}}>{(+f.volume).toFixed(1)}</span>
          </window.PRow>
        ) : null}
      </>
    );
  }

  function TtsForm({f, set, clone, project}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const V = window.BC_VOICES;
    const cloud = !!TTS.engineOf(f.engine).cloud;
    const cloudEngines = C.engines(app.cloudSaved, app.cloudCustom);
    const modes = TTS.voiceModes(f.engine);
    // 换引擎那一瞬间 f.mode 可能还是上一只引擎的方式，按它自己的第一种算
    const mode = modes.includes(f.mode) ? f.mode : modes[0];
    const langs = TTS.formLangs(f.engine);
    /* 换引擎：音色方式不合法就落到它唯一的那种；语言不在新表里退回「自动」；
       旋钮回到「按模型默认」（各引擎区间不同），OmniVoice 的挑项只留新语言下还生效的 */
    const pickEngine = (k) => {
      if (TTS.engineOf(k).cloud) { set(window.BC_TOOLS.switchEngine(f, k)); return; }   // 云端：模型落到这家缺省、音色退回默认、语速回 1（model-tools.js）
      const lang = TTS.formLangs(k).some((l) => l.code === f.lang) ? f.lang : 'auto';
      set({engine: k, mode: TTS.voiceModes(k).includes(f.mode) ? f.mode : TTS.voiceModes(k)[0], lang,
        knobs: {}, omni: TTS.omniFit(f.omni, lang)});
    };
    const setLang = (code) => set({lang: code, omni: TTS.omniFit(f.omni, code)});
    const RefChip = window.TtsRefChip;
    const emoName = f.emotion === 'none' ? '不设' : f.emotion === 'ref' ? '跟参考音频' : f.emotion === 'ref2' ? '另给一段音频'
      : (TTS.EMOTIONS.find((e) => e.id === f.emotion) || {}).name;
    return (
      <>
        <Field area size="s" value={f.text} onChange={(e) => set({text: e.target.value})}
          placeholder={clone ? '要用这个声音说的话…' : '要合成的文字，按句号 / 换行分段…'} style={{minHeight: 96}} />
        <div className="ttsq__row">
          <span className="t-detail-xs grow">{f.text.trim() ? `${TTS.segments(f.text).length} 段 · 约 ${TTS.estimateDuration(f.text).toFixed(1)} 秒${cloud ? ` · ${C.charsLabel(f.text)}` : ''}` : `最多 ${window.BC_TOOLS.maxChars(f)} 字`}</span>
          {!f.text.trim() ? <BCAction className="viewall" onClick={() => set({text: SAMPLE})}>填一段示例</BCAction> : null}
        </div>
        {/* 注音（2026-09-23，readings 设计稿 §5.2）：文字含中文才出现，就地出 chip 行 */}
        <window.TextReadings f={f} set={set} engine={f.engine} project={project} />

        <window.PRow label="引擎">
          <Picker size="s" value={TTS.engineName(f.engine)} open={pop === 'g'} popWidth={280}
            onClick={() => setPop(pop === 'g' ? null : 'g')} onClose={() => setPop(null)}>
            <Menu>
              {TTS.ENGINES.filter((e) => !e.dubOnly).map((e) => (
                <MenuItem key={e.id} label={e.name} sub={e.desc} wrap on={e.id === f.engine} onClick={() => { pickEngine(e.id); setPop(null); }} />
              ))}
              {/* 选模型的时候就能去添加模型（2026-09-24）：本机一组末尾一条去本地模型页，云端一组末尾一条去云端模型页，
                 两条常在——不只在缺模型 / 一家没连的时候才出现。跳过去落到语音那一档。 */}
              <MenuItem icon="settings" label="管理本地模型…" sub="下载、删除本机语音模型 · 设置 › 模型 › 语音合成"
                onClick={() => { setPop(null); app.go({r: 'settings', sec: 'local', tab: 'tts'}); }} />
              {/* 云端：只列设置里连了密钥的；一家都没连时组里只剩这条去设置的路 */}
              <MenuRule /><MenuHead>云端 · 联网计费</MenuHead>
              {cloudEngines.map((e) => (
                <MenuItem key={e.id} icon="remote" label={e.name} sub={e.desc} wrap on={e.id === f.engine} onClick={() => { pickEngine(e.id); setPop(null); }} />
              ))}
              <MenuItem icon="plus" label={cloudEngines.length ? '添加 API 提供方…' : '还没连接能合成语音的 API 提供方'}
                sub={cloudEngines.length ? '连接 MiniMax / OpenAI / ElevenLabs / Google Gemini 或自建 · 设置 › 模型 › API 提供方' : '添加 API 提供方 · 设置 › 模型 › API 提供方'} wrap
                onClick={() => { setPop(null); app.go({r: 'settings', sec: 'cloud', tab: 'tts'}); }} />
            </Menu>
          </Picker>
        </window.PRow>
        <div className="hint hint--tight">{TTS.engineOf(f.engine).desc}{cloud ? ` · 联网合成，${C.billing(C.providerById(TTS.engineOf(f.engine).provider, app.cloudCustom) || TTS.engineOf(f.engine).provider)}` : ''}</div>

        {cloud ? <CloudRows f={f} set={set} pop={pop} setPop={setPop} clone={clone} /> : <>
        <window.PRow label="音色">
          {modes.length > 1
            ? <Segmented size="s" value={mode} items={TTS.VOICE_MODES.filter((m) => modes.includes(m.k))} onChange={(k) => set({mode: k})} />
            : <span className="t-detail-xs">参考音频克隆</span>}
        </window.PRow>
        {mode === 'describe' && TTS.describeByVocab(f.engine) ? (
          /* OmniVoice：描述是按类挑项，不是一句自由文字（2026-09-26） */
          <window.OmniDescribe sel={f.omni} lang={f.lang} onChange={(omni) => set({omni})} />
        ) : mode === 'describe' ? (
          <window.PRow label="声音描述">
            <Field size="s" value={f.instruct} onChange={(e) => set({instruct: e.target.value})}
              placeholder="一句话，例如：温暖、亲切的成年女声，语速适中" style={{flex: 1}} />
          </window.PRow>
        ) : mode === 'preset' ? (
          <window.PRow label="预设">
            <Picker size="s" value={f.preset} open={pop === 'p'} popWidth={220}
              onClick={() => setPop(pop === 'p' ? null : 'p')} onClose={() => setPop(null)}>
              <Menu>
                {TTS.PRESETS.map((p) => (
                  <MenuItem key={p.id} label={p.id} sub={p.sub} on={p.id === f.preset} onClick={() => { set({preset: p.id}); setPop(null); }} />
                ))}
              </Menu>
            </Picker>
          </window.PRow>
        ) : (
          <>
            {/* 音色选择器（voice-library 设计稿 §2.3）：默认 / 我的声音 + 克隆新音色… / 内置音色 / 临时用一段；
                预设那一档由上面的「音色」分段管，这里不重复 */}
            <window.PRow label="参考音频">
              <window.VoicePicker engine={f.engine} value={V.valueOfForm(f)} preset={false} popAlign="right" popWidth={300}
                pickKey="panel-tts" from={clone ? '「克隆声音」面板' : '「生成语音」面板'} reopen={{tab: 'audio', paneView: clone ? 'tts-clone' : 'tts'}}
                onChange={(val) => set(V.applyToForm(f, val, app.voices))} />
            </window.PRow>
            <window.VoiceLine engine={f.engine} value={V.valueOfForm(f)} lang={f.lang} text={f.text} />
            <window.PRow label="参考文本">
              <Field size="s" value={f.refText} onChange={(e) => set({refText: e.target.value})} placeholder={TTS.refTextRequired(f.engine) ? '必填 · 参考音频说的是什么（不写会吞掉开头）' : '可选 · 参考音频说的是什么'} style={{flex: 1}} />
            </window.PRow>
          </>
        )}

        <window.PRow label="语言">
          <Picker size="s" value={(TTS.LANGS.find((l) => l.code === f.lang) || TTS.LANGS[0]).name} open={pop === 'l'} popWidth={160}
            onClick={() => setPop(pop === 'l' ? null : 'l')} onClose={() => setPop(null)}>
            <Menu>
              {langs.map((l) => (
                <MenuItem key={l.code} label={l.name} on={l.code === f.lang} onClick={() => { setLang(l.code); setPop(null); }} />
              ))}
            </Menu>
          </Picker>
        </window.PRow>

        {TTS.hasEmotion(f.engine) ? (
          <>
            <window.PRow label="情绪">
              <Picker size="s" value={emoName} open={pop === 'e'} popWidth={200}
                onClick={() => setPop(pop === 'e' ? null : 'e')} onClose={() => setPop(null)}>
                <Menu>
                  <MenuItem label="不设" on={f.emotion === 'none'} onClick={() => { set({emotion: 'none'}); setPop(null); }} />
                  <MenuItem label="跟参考音频" sub="用参考音频本身的情绪" on={f.emotion === 'ref'} onClick={() => { set({emotion: 'ref'}); setPop(null); }} />
                  <MenuItem label="另给一段音频" sub="音色来自参考音频，情绪来自这一段" on={f.emotion === 'ref2'} onClick={() => { set({emotion: 'ref2'}); setPop(null); }} />
                  <MenuRule />
                  {TTS.EMOTIONS.map((e) => (
                    <MenuItem key={e.id} label={e.name} sub={e.id} on={e.id === f.emotion} onClick={() => { set({emotion: e.id}); setPop(null); }} />
                  ))}
                </Menu>
              </Picker>
            </window.PRow>
            {f.emotion === 'ref2' ? (
              <window.PRow label="情绪音频">
                <RefChip file={f.emoRef} label="选情绪音频…" onPick={() => set({emoRef: {name: 'excited-take.wav', dur: 4.8}})} onClear={() => set({emoRef: null})} />
              </window.PRow>
            ) : null}
            {TTS.EMOTIONS.some((e) => e.id === f.emotion) ? (
              <window.PRow label="强度">
                <Slider value={f.emoLevel} min={0} max={100} step={5} onChange={(v) => set({emoLevel: v})} />
                <span className="t-mono t-detail-xs" style={{width: 32, textAlign: 'right'}}>{f.emoLevel}</span>
              </window.PRow>
            ) : null}
          </>
        ) : null}

        {/* 风格：CustomVoice 在预设那一档；VoxCPM2 在克隆那一档——写了风格就只取参考的音色（可控克隆），不再用参考文本 */}
        {TTS.styleOn(f.engine, mode) ? (
          <window.PRow label="风格">
            <Field size="s" value={f.style} onChange={(e) => set({style: e.target.value})}
              placeholder="可选 · 一句话，例如：像深夜电台一样慢一点" style={{flex: 1}} />
          </window.PRow>
        ) : null}
        {TTS.styleOn(f.engine, mode) && mode === 'clone' && f.style.trim() && f.refText.trim()
          ? <div className="hint hint--tight">写了风格就只取参考音频的音色，参考文本这次不用</div> : null}

        {/* 数值旋钮：只 IndexTTS 2.5 / VoxCPM2 / OmniVoice 有，默认收起，没拨过的不传 */}
        <window.TtsKnobs engine={f.engine} knobs={f.knobs} onChange={(knobs) => set({knobs})} />
        </>}
      </>
    );
  }

  function TtsPanel({ctx, clone}) {
    const app = useApp();
    const {useAiTask, fakeRun, Job} = window.BC_AIFLOWS;
    // 「重新生成」从素材卡的 ⋯ 菜单带着上一次的表单过来（panel-media.jsx 写 BC_TTS_DRAFT）
    const [f, setF] = useState(() => {
      const d = window.BC_TTS_DRAFT; window.BC_TTS_DRAFT = null;
      if (d) return Object.assign(blank(clone), d);
      const id = app.cloudTtsDefault || (app.prefs.localModelDefaults || {}).tts;
      const chosen = window.BC_TOOLS.preferredForm(app.modelInstalled, id);
      if (TTS.engineOf(chosen.engine).dubOnly) return blank(clone);
      if (clone && !TTS.voiceModes(chosen.engine).includes('clone')) return blank(clone);
      return Object.assign(blank(clone), {engine: chosen.engine, mode: clone ? 'clone' : chosen.mode,
        cloudModel: chosen.cloudModel || null});
    });
    const set = (p) => setF((s) => ({...s, ...p}));
    const [phase, setPhase] = useState('setup');   // setup | run | done
    const [pct, setPct] = useState(0);
    const [result, setResult] = useState(null);
    const [placed, setPlaced] = useState(false);
    const ai = useAiTask();
    const timer = useRef(null);
    const t0 = useRef(0);
    useEffect(() => () => clearInterval(timer.current), []);

    const cloud = !!TTS.engineOf(f.engine).cloud;
    const errs = cloud ? window.BC_TOOLS.validate(f, {voices: app.voices, saved: app.cloudSaved, extra: app.cloudCustom}) : TTS.validate(f);
    const mid = cloud ? window.BC_TOOLS.modelOf(f) : TTS.modelFor(f.engine, f.mode);
    const installed = app.modelInstalled(mid);
    const segs = TTS.segments(f.text);
    const ph = TTS.genPhase(pct, segs.length, cloud ? TTS.engineOf(f.engine).name : null);
    const title = clone ? '克隆声音' : '生成语音';
    const back = () => ctx.setPaneView(null);

    const start = () => {
      if (errs.length) { app.toast(errs[0]); return; }
      setPhase('run'); t0.current = Date.now();
      const tid = ai.begin({
        kind: 'tts', flow: 'tts', project: ctx.proj.id,
        title: `${title} · ${ctx.proj.title}`, sub: TTS.genSub(Object.assign({}, f, {voices: app.voices})), phase: title, cancellable: true,
      });
      fakeRun(timer, (p) => { setPct(p); ai.progress(tid, p); }, 3, 70, () => {
        const elapsed = ((Date.now() - t0.current) / 1000).toFixed(1) + ' 秒';
        const src = TTS.asSource(f, ctx.nextSeq(), elapsed);
        ctx.addSource('audio', src);
        ai.finish(tid, {undoable: false});
        setResult(src); setPhase('done');
        app.toast(`已生成 ${src.name} · 收进素材库`, 'positive');
      });
    };
    const cancel = () => app.cancelTask(ai.task, {after: () => { clearInterval(timer.current); setPhase('setup'); }});
    const Card = window.MediaFileCard;

    return (
      <>
        {/* 页头规则（2026-09-24，§13）：返回图标钮 ＋ 左对齐标题；右侧只挂运行态 chip（与其它工具页同） */}
        <window.PanelHead title={title} onBack={back} backTip="返回音频">
          {phase === 'run' ? <Chip tone="accent">后台运行中</Chip> : null}
        </window.PanelHead>
        <div className="pscroll bc-scroll">
          {phase === 'setup' ? (
            <>
              <TtsForm f={f} set={set} clone={clone} project={ctx.dubReadings || []} />
              {cloud ? <CloudGate engine={f.engine} /> : <ModelGate id={mid} />}
              <div className="flowcta">
                <Btn variant="accent" style={{width: '100%'}} disabled={!installed} onClick={start}>{clone ? '用这个声音生成' : '生成'}</Btn>
              </div>
              <div className="hint">{errs.length ? errs[0] : cloud
                ? `联网发给 ${TTS.engineOf(f.engine).name} 合成，${C.billing(C.providerById(TTS.engineOf(f.engine).provider, app.cloudCustom) || TTS.engineOf(f.engine).provider)}；进度在顶栏与后台任务页，完成后落成一张素材卡。停止等待不会撤回已发送的请求。`
                : '在本机合成，进度在顶栏与后台任务页；完成后落成一张素材卡，放到时间轴是另一步。'}</div>
            </>
          ) : null}

          {phase === 'run' ? (
            <>
              <Job title={`${title}…`} pct={pct} stages={TTS.genStages(cloud)} cur={ph.cur}
                activity={`${modelName(f, mid)} · ${ph.activity}`} />
              <div className="signpost">可先继续编辑 · 合成在后台运行，完成后自动收进素材库。</div>
              <div className="flowcta"><Btn variant="secondary" onClick={cancel}>取消</Btn></div>
            </>
          ) : null}

          {phase === 'done' && result ? (
            <>
              <div className="aplbar">
                <div className="aplbar__msg"><Ic n="ok" className="ic--16" style={{color: 'var(--green-1100)'}} /><b>已生成 · {result.meta}</b></div>
                <div className="aplbar__acts">
                  {/* 按句放到时间轴（2026-09-23）：这段文字按句落成一条旁白轨，每句可看属性、换版、进归档——与翻译配音同一套 */}
                  {segs.length > 1 && !placed ? <BCAction className="ccbtn" onClick={() => {
                    const g = window.BC_DUB.narrationGroup(result.tts, ctx.nextSeq(), {at: ctx.playT, title: result.name.replace(/\.wav$/, '')});
                    ctx.applyDub(g); setPlaced(true);
                    app.toast(`已按 ${g.blocks.length} 句放到时间轴 · 「${g.langName}」这一行`, 'positive');
                  }}>按 {segs.length} 句放到时间轴</BCAction> : null}
                  <BCAction className="ccbtn" onClick={() => { setPlaced(false); setPhase('setup'); }}>再生成一段</BCAction>
                  <Btn variant="accent" size="s" onClick={back}>回到音频</Btn>
                </div>
              </div>
              {Card ? <Card src={result} kind="audio" ctx={ctx} /> : null}
              <window.TtsInlinePlayer dur={result.dur} />
              <div className="signpost">素材卡的 ⋯ 里有「加到时间轴」「下载 WAV」「重新生成」；重新生成会带着这一次的文字与音色回到表单。</div>
            </>
          ) : null}
        </div>
      </>
    );
  }

  Object.assign(window, {TtsPanel, TtsModelGate: ModelGate, TtsCloudGate: CloudGate});
})();
