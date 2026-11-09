/* 设置 › 我的声音 › 克隆新音色（2026-10-14 重做采集流程，同日二轮；2026-11-08 存好就上传）。
   先选模型，再按选中的模型走：① 选模型（本机引擎 + 能克隆的云端提供方，没连密钥的也能先选；云端只预选入口那一家）
   → ② 录样本（30 秒左右最好，不在 30 秒停，最长 3 分钟，只在最后 10 秒倒数；麦克风或上传二选一；
      比某家的上限长时明说「Google Gemini 用前 30 秒」）
   → ③ 授权声明（只有选中的模型里有要第二段录音的——Gemini——才有这一步：同一个人念一句固定声明，
      官方 30 个地区语言任选，英文最稳；表外的可以自定义一句，但 Google 只认表里的原文）
   → ④ 保存（名字、本人声明、每只本机引擎一颗种子、每个模型落到哪）。主按钮说会发生什么（「保存并上传到 Google Gemini」），
      按钮旁一句外发说明；点了就存本机并开始上传（architecture-design §5.9 voiceClone 任务，进度与诊断在 settings-voice-clone.jsx）。
   从某只云端模型的「克隆一只」过来直接进「录样本」。`base` 是给已有音色录新样本（没建成时「录新样本」）：沿用名字、声明与授权声明。
   `ConsentCapture` 是从行卡 ⋯ 或诊断里「重录授权声明」进来的单步版，存好可一并上传。
   麦克风在原型里是计时器模拟，试听放的是随包录音；门槛、台词、步骤、种子、落地都在 model-voices.js。
   2026-11-08 音质自查与同一只麦克风：一段录音（ClipRecorder）拆到 settings-voice-take.jsx，录音中一行当场提示、停下一句判词；
   麦克风由这里统一拿着，进「授权声明」时换回录样本的那只，换了别的就提醒；保存时两段有爆音、底噪或不是同一只麦克风，
   在上传按钮上面提醒一次，不拦（门槛在 model-voice-take.js）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const TTS = window.BC_TTS;
  const V = window.BC_VOICES;
  const C = window.BC_CLOUD_TTS;
  const R = window.RSP;

  const ClipRecorder = window.VoiceClipRecorder;

  /* ---------- ① 选模型：这只音色要给谁用 ---------- */
  function ModelsStep({targets, picked, onToggle}) {
    const local = targets.filter((t) => t.kind === 'local');
    const cloud = targets.filter((t) => t.kind === 'cloud');
    const on = (t) => picked.indexOf(t.id) >= 0;
    return (
      <>
        <p className="vlib-cap__lede">先挑这只音色要给哪些模型用：本机引擎只要一段样本，靠种子认人；云端在保存时把样本传给对方建克隆、记下 voice id；
          Google Gemini 还要本人再念一句授权声明——没选它就不用录那段。以后随时能在音色的 ⋯ 里补。</p>
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">本机</span>
          <div className="vlib-cap__chips">
            {local.map((t) => <Chip key={t.id} pill on={on(t)} onClick={() => onToggle(t.id)}>{t.name}</Chip>)}
          </div>
        </div>
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">云端</span>
          <div className="vlib-cap__chips">
            {cloud.map((t) => (
              <Chip key={t.id} pill icon="remote" on={on(t)} onClick={() => onToggle(t.id)}
                title={t.consent ? '要本人念一句授权声明' : ''}>
                {t.name}{t.consent ? ' · 要授权声明' : ''}{t.connected ? '' : ' · 未连接'}
              </Chip>
            ))}
            {!cloud.length ? <span className="t-detail-xs">没有能克隆的 API 提供方</span> : null}
          </div>
        </div>
        <p className="t-detail-xs">云端不替你勾：勾上的那家，保存时会收到这段录音。没连密钥的也能先选，样本与声明先存着，连上后在音色的 ⋯ 里上传。一只都不选也能存，只给本机引擎用。</p>
      </>
    );
  }

  /* ---------- ② 样本 ---------- */
  function SampleStep({lang, setLang, onClip, clip, providers, mic, onMic}) {
    const langs = TTS.sampleLangs('indextts2');
    const script = V.sampleScript(lang);
    const verdict = clip ? V.sampleVerdict(clip.dur, providers) : null;
    return (
      <>
        <p className="vlib-cap__lede">一段 {V.SAMPLE.target} 秒左右、一个人说话、周围安静的录音。{V.SAMPLE.min} 秒就能存，{V.SAMPLE.good} 秒以上云端才收；
          过了 {V.SAMPLE.target} 秒不会停，话没说完就接着说，最长 {V.secLabel(V.SAMPLE.max)}。</p>
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">念哪种</span>
          <div className="vlib-cap__chips">
            {langs.map((l) => <Chip key={l.code} pill on={lang === l.code} onClick={() => setLang(l.code)}>{l.label}</Chip>)}
          </div>
        </div>
        <blockquote className="vlib-script vlib-script--long">
          {script.lines.map((t, i) => <span key={i} className="vlib-script__line">{t}</span>)}
          <span className="vlib-script__tail t-detail-xs">念完这几句可以接着随便说——介绍一下自己、今天在做什么——说到 {V.SAMPLE.target} 秒左右就够了。</span>
        </blockquote>
        <ClipRecorder key={lang} spec={V.SAMPLE} label="怎么给" onClip={onClip} clip={clip} mic={mic} onMic={onMic}
          demo={{file: TTS.defaultBuiltin(lang, '').file, dur: 46.2, name: 'reference_speaker.wav'}}
          hint={verdict ? (verdict.problem || `${verdict.line} · 听一遍，不满意就重录`) : '照着念，或上传一段现成的。'} />
        {verdict && verdict.problem ? <div className="hint hint--warn">{verdict.problem}</div> : null}
        {verdict && !verdict.problem && verdict.short.length ? <div className="hint hint--warn">能存，但 {verdict.short.join('、')}——要给它们用就再录长一点。</div> : null}
      </>
    );
  }

  /* ---------- ③ 授权声明（Gemini 要的第二段）：语言 = 常用两种芯片 + 更多语言（官方 30 个地区）+ 自定义一句 ---------- */
  function ConsentStep({needed, phraseLang, setPhraseLang, custom, setCustom, onClip, clip, sample, mic, onMic}) {
    const [more, setMore] = useState(false);
    const phrase = V.consentPhrase(phraseLang, custom);
    const problem = clip ? V.consentProblem(clip.dur) : null;
    const moreOn = V.CONSENT_COMMON.indexOf(phraseLang) < 0 && phraseLang !== 'custom';
    const pick = (code) => { setPhraseLang(code); onClip(null); setMore(false); };
    return (
      <>
        <p className="vlib-cap__lede">
          {needed.length
            ? `${needed.join(' / ')} 要本人再念一句固定的授权声明，对方会核对这段和样本是不是同一个人。`
            : '想以后给 Google Gemini 用就先录下来，也可以稍后补。'}
          用同一只麦克风、同一个房间录，更容易通过。
        </p>
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">念哪种</span>
          <div className="vlib-cap__chips">
            {V.CONSENT_COMMON.map((code) => { const c = V.consentPhrase(code); return (
              <Chip key={code} pill on={phraseLang === code} onClick={() => pick(code)}>{c.label}{c.recommended ? ' · 推荐' : ''}</Chip>
            ); })}
            <Picker size="s" value={moreOn ? V.phraseLabel(phrase) : '更多语言'} open={more} popWidth={260}
              onClick={() => setMore((x) => !x)} onClose={() => setMore(false)}>
              <Menu>
                <MenuHead>官方支持的其余 {V.consentMore().length} 种</MenuHead>
                {V.consentMore().map((o) => <MenuItem key={o.code} label={o.label} sub={o.sub} on={phraseLang === o.code} onClick={() => pick(o.code)} />)}
              </Menu>
            </Picker>
            <Chip pill icon="edit" on={phraseLang === 'custom'} onClick={() => pick('custom')}>自定义一句</Chip>
          </div>
        </div>
        {phraseLang === 'custom' ? (
          <>
            <Field area rows={2} aria-label="自定义授权声明" value={custom} placeholder="写一句本人授权的话，录的时候照着念"
              onChange={(e) => { setCustom(e.target.value); onClip(null); }} />
            <div className="hint hint--warn">Google Gemini 只认官方表里的原文，自定义的它验不过；留给别家或将来接入的提供方。</div>
          </>
        ) : <blockquote className="vlib-script">{phrase.text}</blockquote>}
        {phrase.note ? <div className="hint hint--warn">{phrase.note}</div> : null}
        {!phrase.custom && !phrase.verified && !phrase.note ? <p className="t-detail-xs">官方支持 · 没实测过能不能验过；不急就念英文。</p> : null}
        <ClipRecorder key={phraseLang} spec={V.CONSENT_REC} label="怎么给" onClip={onClip} clip={clip}
          mic={mic} onMic={onMic} sample={sample} needed={needed}
          demo={{file: phraseLang === 'zh-CN' ? 'tts-voice-zh-male.wav' : 'tts-voice-en-male.wav', dur: 7.9, name: 'speaker_consent.wav'}}
          hint={problem || (clip ? '听一遍，念清楚整句就行' : '一口气把整句念完，不用赶')} />
        {problem ? <div className="hint hint--warn">{problem}</div> : null}
      </>
    );
  }

  /* ---------- ④ 保存：名字、本人声明、每只引擎一颗种子、每个模型落到哪（BC_VOICES.savePlan 的 rows） ---------- */
  function SaveStep({rows, targets, name, setName, consent, setConsent, seeds, onReseed}) {
    const local = targets.filter((t) => t.kind === 'local');
    return (
      <div className="vlib-save">
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">叫什么</span>
          <Field size="s" value={name} aria-label="音色名字" onChange={(e) => setName(e.target.value)} placeholder="我的声音" />
        </div>
        {local.map((t) => (
          <div key={t.id} className="vlib-cap__row">
            <span className="vlib-cap__lab">{t.name}</span>
            <span className="t-detail-xs">种子</span>
            <span className="t-mono">{seeds[t.id]}</span>
            <Btn variant="quiet" size="s" icon="refresh" onClick={() => onReseed(t.id)}>换一颗</Btn>
          </div>
        ))}
        <p className="t-detail-xs">本机引擎没有 voice id，靠同一段参考 + 这颗种子每次都出同一个人，每只引擎一颗；云端（Gemini / ElevenLabs / MiniMax）记对方给的 voice id。</p>
        <Checkbox on={consent} onChange={setConsent} label="这是我自己的声音，或已获本人许可" />
        <window.CloneLanding rows={rows} />
      </div>
    );
  }

  /* ---------- 四步串起来 ----------
     `entry`：从哪只模型过来（云端那家预选、直接进「录样本」）；不给就看回程里的 target。
     `base`：给已有音色录新样本——沿用名字、本人声明、种子与授权声明（有就跳过那一步）。
     存好时 `onDone(draft, uploads)`：uploads 是点保存就要上传的提供方。 */
  function VoiceCapture({onDone, onCancel, base, entry}) {
    const app = useApp();
    const allProviders = C.providers(app.cloudCustom);
    const targets = V.cloneTargets(V.engineChips(), allProviders, app.cloudSaved);
    const entryId = entry || (app.voiceHandoff && app.voiceHandoff.target ? app.voiceHandoff.target.id : null);
    const [picked, setPicked] = useState(() => V.initialPicks(targets, entryId));
    const chosen = targets.filter((t) => picked.indexOf(t.id) >= 0);
    const keepClip = base && C.hasConsentClip(base) ? base.consentClip : null;
    const steps = V.cloneSteps(chosen).filter((s) => !(keepClip && s.k === 'consent'));
    const [cur, setCur] = useState(() => V.startStep(targets, entryId));
    const langs = TTS.sampleLangs('indextts2');
    const [lang, setLang] = useState(base && langs.some((l) => l.code === base.lang) ? base.lang : langs[0].code);
    const [sample, setSample] = useState(null);
    const [phraseLang, setPhraseLang] = useState(keepClip ? keepClip.lang : 'en-US');
    const [custom, setCustom] = useState(keepClip && keepClip.text ? keepClip.text : '');
    const [consentClip, setConsentClip] = useState(keepClip ? {dur: keepClip.dur, file: keepClip.file} : null);
    /* 麦克风两步共用：进「授权声明」时还没录就换回录样本的那只（Gemini 核对两段是不是同一个人，同一只麦克风最稳） */
    const [mic, setMic] = useState(window.VOICE_MICS[0].id);
    const [name, setName] = useState(() => (base ? base.name : V.defaultVoiceName(app.voices)));
    const [consent, setConsent] = useState(!!base && base.consent !== 'unspecified');
    const [seeds, setSeeds] = useState(() => { const o = {}; targets.filter((t) => t.kind === 'local').forEach((t) => { o[t.id] = (base && base.seeds && base.seeds[t.id]) || V.randomSeed(); }); return o; });
    const providers = chosen.filter((t) => t.kind === 'cloud').map((t) => allProviders.find((p) => p.id === t.id)).filter(Boolean);
    const script = V.sampleScript(lang);
    const verdict = sample ? V.sampleVerdict(sample.dur, providers) : null;
    const ref = sample ? V.referenceFromSample(sample.dur, sample.via === 'mic' ? script.first : '') : null;
    const pickedSeeds = {};
    chosen.filter((t) => t.kind === 'local').forEach((t) => { pickedSeeds[t.id] = seeds[t.id]; });
    const draft = sample ? V.makeVoice({
      name, lang, dur: ref.dur, text: ref.text, textSource: ref.textSource, sourceDur: sample.dur, seeds: pickedSeeds,
      source: {kind: sample.via, at: '刚刚', name: sample.name}, file: sample.file,
      consent: consent ? (base && base.consent !== 'unspecified' ? base.consent : 'self') : 'unspecified',
      consentClip: consentClip ? Object.assign({lang: phraseLang, dur: consentClip.dur, file: consentClip.file, at: keepClip ? keepClip.at : '刚刚'}, phraseLang === 'custom' ? {text: custom.trim()} : {}) : null,
    }) : null;
    const plan = sample ? V.savePlan(chosen, {declared: consent, sampleDur: sample.dur, refDur: ref.dur, consentClip,
      consentCustom: phraseLang === 'custom', providers: allProviders}) : null;
    const step = steps[Math.min(cur, steps.length - 1)];
    const last = cur >= steps.length - 1;
    const canNext = step.k === 'models' ? true
      : step.k === 'sample' ? !!(sample && !verdict.problem)
      : step.k === 'consent' ? !!(consentClip && !V.consentProblem(consentClip.dur) && (phraseLang !== 'custom' || custom.trim()))
      : false;
    const needed = step.needed || [];
    const goTo = (i) => {
      const to = steps[Math.max(0, Math.min(i, steps.length - 1))];
      if (to.k === 'consent' && !consentClip && sample && sample.via === 'mic') setMic(sample.mic);
      setCur(i);
    };
    const uploadRows = plan ? plan.rows.filter((r) => r.k === 'upload') : [];
    const uploadTo = uploadRows.map((r) => r.name);
    /* 授权声明这次没人要（没传给要它的那家）就不拿它提醒：本机引擎只用样本 */
    const consentUp = uploadRows.some((r) => chosen.some((t) => t.id === r.id && t.consent));
    const foot = step.k === 'models' ? (chosen.length ? `给 ${chosen.map((t) => t.name).join(' / ')} 用` : '一只都不选也能存，只给本机引擎用')
      : step.k === 'sample' ? (sample ? `样本 ${sample.dur.toFixed(1)} 秒` : '样本是这只音色的底：云端拿它建克隆，本地引擎截前面几秒当参考')
      : step.k === 'consent' ? `跳过也能存，只是这次不上传到 ${needed.join(' / ')}`
      : plan.outflow;
    return (
      <div className="vlib-cap" data-screen-label={`我的声音 · ${base ? '录新样本' : '克隆新音色'} · ${step.label}`}>
        <div className="vlib-cap__hd">
          <Btn variant="quiet" size="s" icon="back" onClick={onCancel}>我的声音</Btn>
        </div>
        <h2 className="t-title-sm">{base ? `录新样本 · ${base.name}` : '克隆新音色'}</h2>
        <Steps items={steps} cur={cur} label="克隆步骤" />
        {step.k === 'models' ? <ModelsStep targets={targets} picked={picked} onToggle={(id) => setPicked((p) => (p.indexOf(id) >= 0 ? p.filter((x) => x !== id) : p.concat(id)))} /> : null}
        {step.k === 'sample' ? <SampleStep lang={lang} setLang={(l) => { setLang(l); setSample(null); }} clip={sample} onClip={setSample} providers={providers} mic={mic} onMic={setMic} /> : null}
        {step.k === 'consent' ? <ConsentStep needed={needed} phraseLang={phraseLang} setPhraseLang={setPhraseLang} custom={custom} setCustom={setCustom} clip={consentClip} onClip={setConsentClip}
          sample={sample} mic={mic} onMic={setMic} /> : null}
        {step.k === 'save' ? <SaveStep rows={plan.rows} targets={chosen} name={name} setName={setName} consent={consent} setConsent={setConsent} seeds={seeds} onReseed={(id) => setSeeds((s) => Object.assign({}, s, {[id]: V.randomSeed()}))} /> : null}
        {step.k === 'save' ? <window.VoiceSaveTakeWarning clips={{sample, consent: consentUp ? consentClip : null}} uploadTo={uploadTo}
          onRedo={(k) => goTo(steps.findIndex((s) => s.k === k))} /> : null}
        <div className="vlib-save__acts">
          {cur > 0 ? <Btn variant="secondary" size="s" icon="back" onClick={() => goTo(cur - 1)}>上一步</Btn> : null}
          {!last ? <Btn variant="accent" size="s" disabled={!canNext} onClick={() => goTo(cur + 1)}>下一步</Btn> : null}
          {step.k === 'consent' ? <Btn variant="quiet" size="s" onClick={() => { setConsentClip(null); goTo(cur + 1); }}>稍后补，先存</Btn> : null}
          {last ? <Btn variant="accent" size="s" disabled={!name.trim()} onClick={() => onDone(draft, plan.uploads)}>{plan.button}</Btn> : null}
          <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
          <span className="t-detail-xs grow">{foot}</span>
        </div>
        <p className="t-detail-xs vlib-foot">交互演示 · 没有真的开麦克风，试听放的是随包录音；上传不会读文件内容，云端建克隆是计时器模拟。</p>
        <window.VoiceTakeDemo />
        <window.CloneDemo />
      </div>
    );
  }

  /* ---------- 单步：给已有音色补录 / 重录授权声明 ----------
     存好时能一并上传给要它的那家（还没在那家建好、也没在传的）：主按钮写「存好并上传到 X」，另给「只存，先不上传」。
     `onDone(clip, uploads)`。 */
  function ConsentCapture({v, onDone, onCancel}) {
    const app = useApp();
    const needed = C.consentProviders(app.cloudSaved, app.cloudCustom);
    const [phraseLang, setPhraseLang] = useState(v.consentClip ? v.consentClip.lang : 'en-US');
    const [custom, setCustom] = useState(v.consentClip && v.consentClip.text ? v.consentClip.text : '');
    const [clip, setClip] = useState(null);
    const ok = clip && !V.consentProblem(clip.dur) && (phraseLang !== 'custom' || custom.trim());
    const targets = needed.filter((p) => ['ready', 'uploading'].indexOf(V.cloneState(v, p.id)) < 0)
      .map((p) => ({kind: 'cloud', id: p.id, name: p.name, consent: true, connected: true}));
    const plan = ok ? V.savePlan(targets, {declared: v.consent !== 'unspecified', sampleDur: Math.max(+v.sourceDur || 0, +v.dur || 0),
      consentClip: clip, consentCustom: phraseLang === 'custom', providers: C.providers(app.cloudCustom)}) : null;
    const names = plan ? plan.rows.filter((r) => r.k === 'upload').map((r) => r.name) : [];
    const made = () => Object.assign({lang: phraseLang, dur: clip.dur, file: clip.file, at: '刚刚'}, phraseLang === 'custom' ? {text: custom.trim()} : {});
    return (
      <div className="vlib-cap" data-screen-label="我的声音 · 补录授权声明">
        <div className="vlib-cap__hd">
          <Btn variant="quiet" size="s" icon="back" onClick={onCancel}>我的声音</Btn>
        </div>
        <h2 className="t-title-sm">{v.consentClip ? '重录' : '补录'}授权声明 · {v.name}</h2>
        <ConsentStep needed={needed.map((p) => p.name)} phraseLang={phraseLang} setPhraseLang={setPhraseLang} custom={custom} setCustom={setCustom} clip={clip} onClip={setClip} />
        {plan && plan.rows.length ? <window.CloneLanding rows={plan.rows} /> : null}
        <window.VoiceSaveTakeWarning clips={{consent: names.length ? clip : null}} uploadTo={names} />
        <div className="vlib-save__acts">
          {names.length ? (
            <>
              <Btn variant="accent" size="s" onClick={() => onDone(made(), plan.uploads)}>存好并上传到 {names.join('、')}</Btn>
              <Btn variant="secondary" size="s" onClick={() => onDone(made(), [])}>只存，先不上传</Btn>
            </>
          ) : <Btn variant="accent" size="s" disabled={!ok} onClick={() => onDone(made(), [])}>存这段</Btn>}
          <Btn variant="quiet" size="s" onClick={onCancel}>取消</Btn>
          <span className="t-detail-xs grow">{names.length ? plan.outflow : `要跟样本是同一个人；样本是从视频里取的就得本人来录这段，否则用不了 ${needed.map((p) => p.name).join(' / ') || 'Google Gemini'}。`}</span>
        </div>
        <p className="t-detail-xs vlib-foot">交互演示 · 没有真的开麦克风，试听放的是随包录音。</p>
        <window.VoiceTakeDemo />
      </div>
    );
  }

  /* ---------- 模型页那一行（设置 › 语音合成 › 模型）：绑在这只模型上的音色 + 克隆入口 ----------
     `target` 是 {kind: 'local', id: <engine>} 或 {kind: 'cloud', id: <provider>}；本机引擎列每只音色与它的种子，云端列建过 voice id 的，
     外加正在这家建的（转圈）和没建成的（点开去我的声音看原因）——从这里出发、回来的人不用猜结果。
     「克隆新音色」带着 target 去我的声音：采集页预选这只模型、云端直接进「录样本」，存好后回来。 */
  function ModelVoicesLine({target, from}) {
    const app = useApp();
    const bound = V.voicesBoundTo(app.voices, target);
    const pending = target.kind === 'cloud' ? app.voices.filter((v) => ['uploading', 'failed'].indexOf(V.cloneState(v, target.id)) >= 0) : [];
    const ref = useRef(null);
    /* 从我的声音回来：滚回这一行（等页面自己的滚动复位做完再滚） */
    useEffect(() => {
      if (!window.takeVoiceReturn('model:' + target.id)) return undefined;
      const raf = requestAnimationFrame(() => { if (ref.current) ref.current.scrollIntoView({block: 'center'}); });
      return () => cancelAnimationFrame(raf);
    }, []);
    const go = () => {
      app.setVoiceHandoff({key: 'model:' + target.id, from, route: app.route, target, open: 'mic'});
      app.go({r: 'settings', sec: 'voices'});
    };
    return (
      <div ref={ref} className="mvl t-detail-xs">
        <span className="mvl__lab">克隆音色</span>
        {bound.map((b) => <span key={b.v.id} className="mvl__item"><b>{b.v.name}</b><span className="t-mono">{b.value}</span></span>)}
        {pending.map((v) => (V.cloneState(v, target.id) === 'uploading'
          ? <span key={v.id} className="mvl__item mvl__item--busy"><R.ProgressCircle size="S" isIndeterminate aria-label={`「${v.name}」正在上传`} /><b>{v.name}</b>上传中</span>
          : <BCAction key={v.id} className="viewall mvl__fail" onClick={() => app.go({r: 'settings', sec: 'voices'})}><Ic n="alert" className="ic--14" />「{v.name}」没建成 · 看原因</BCAction>))}
        {!bound.length && !pending.length ? <span className="mvl__none">{target.kind === 'cloud' ? '还没在这家建过' : '还没有'}</span> : null}
        <BCAction className="viewall mvl__go" onClick={go}>{bound.length || pending.length ? '克隆新音色' : '克隆一只'}<Ic n="chevright" className="ic--14" /></BCAction>
      </div>
    );
  }

  Object.assign(window, {VoiceCapture, ConsentCapture, ModelVoicesLine});
})();
