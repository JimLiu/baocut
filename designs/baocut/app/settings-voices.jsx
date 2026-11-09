/* 设置 › 我的声音（voice-library 设计稿 §2 / §9，2026-09-24 原型先行）。
   克隆音色以前不是一个功能，是四个地方各自的一枚「我的音频」芯片。这一页把它变成**用户级资产**：
   ① 列表：一只音色一行（名字 · 语言 · 时长 · 来源 · 原文 · 试听 · 试听克隆 · ⋯）；
   ② 克隆新音色（2026-10-14 重做，settings-voice-capture.jsx）：录样本（目标 30 秒，麦克风或上传）→ 授权声明（Gemini 要，可跳过）→ 保存；
   ③ 从音频或视频里取：分离人声（可选）→ 识别说话人 → 每人一张卡、各给最多三段候选（带原文与质量），
      勾一人或几人一起存；
   ④ 回程：从面板的「克隆新音色…」过来时，存好后一键回去用它。
   麦克风、分离、分人在原型里都是计时器模拟，听到的是随包的内置录音；判词与候选算法在 model-voices.js。
   云端（2026-09-24 云端语音合成设计稿 §2.4 / §6）：行卡上多一组云端 chip（已上传 / 未上传 / 参考不足 / 许可未说明 / 不能克隆），
   ⋯ 里多「上传到 X」「从 X 删除克隆」，试听克隆的模型 Picker 多一组云端；换参考段把已上传的绑定标成陈旧。
   2026-10-14：行上第三行写「凭什么认人」——每只本机引擎一颗种子、各家的 voice id、授权声明（可试听）；要授权录音的提供方（Gemini）
   连着而音色没有那段时亮一枚「缺授权录音」chip，⋯ 里「补录授权声明」走 ConsentCapture、「换种子」按引擎各一条。
   模型页（语音合成 › 模型）每只能克隆的模型下有一行 ModelVoicesLine：绑着的音色 + 「克隆新音色」，带着 voiceHandoff.target 过来直接进采集页。
   2026-11-08（architecture-design §5.9）：存好就上传到选中的云端，回程条与行用 InlineAlert 报上传中 / 建好了 / 没建成；
   没建成给诊断与一键去做（重录授权声明 / 录新样本 / 重试 / 同意外发 / 打开设置），⋯ 里的「上传到 X」也走同一条上传
   （settings-voice-clone.jsx）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const V = window.BC_VOICES;
  const C = window.BC_CLOUD_TTS;
  const CLOUD_TONE = {uploaded: 'positive', first: 'neutral', stale: 'notice', orphan: 'notice', uploading: 'accent', failed: 'negative', short: 'notice', consent: 'notice', authorize: 'notice', unsupported: 'neutral'};

  /* 演示用：分人页每位说话人试听放哪段随包录音 */
  const LETTER_FILES = ['tts-voice-zh-female.wav', 'tts-voice-zh-male.wav', 'tts-voice-en-female.wav', 'tts-voice-en-male.wav'];
  const DEMO_MEDIA = {name: '第 13 期访谈.mp4', dur: 206, overlaps: [[52.8, 54.6], [16.4, 17.3]], music: [[0, 12]]};

  /* 回程条（从面板或模型页过来的）在 settings-voice-clone.jsx：VoiceHandoffBar */

  /* ---------- 一只音色 ---------- */

  function EngineLine({v}) {
    const app = useApp();
    const chips = V.engineChips();
    const ok = chips.filter((c) => c.ok).map((c) => c.name);
    const no = chips.filter((c) => !c.ok);
    const cloud = v ? V.cloudChips(v, app.cloudSaved, {extra: app.cloudCustom}) : [];
    return (
      <div className="vlib-engines t-detail-xs">
        能用它的引擎：{ok.join(' / ')}
        {no.length ? <span> · {no.map((c) => `${c.name} ${V.profileFor(c.id).why.replace(/^[^ ]+ /, '')}`).join('；')}</span> : null}
        {cloud.length ? <span className="vlib-cloud">云端：{cloud.map((c) => <Chip key={c.id} tone={CLOUD_TONE[c.k]} title={c.line}>{c.chip}</Chip>)}</span> : null}
      </div>
    );
  }

  /* 云端试听：没有本地模型可装，「试听」= 发一句示例给这家合成；第一次用这只音色先问一次上传（§6.3） */
  function CloudAudition({v, engine, onPatch}) {
    const app = useApp();
    const e = TTS.engineOf(engine);
    const st = C.cloneStatus(v, e.provider, {saved: app.cloudSaved, extra: app.cloudCustom});
    const [phase, setPhase] = useState('idle');   // idle | run | done
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const run = () => {
      setPhase('run');
      timer.current = setTimeout(() => {
        if (st.fix === 'upload') onPatch({cloud: C.bindAfter(v, e.provider, 'upload', {at: '刚刚'})});
        setPhase('done');
      }, 1200);
    };
    const go = () => {
      if (!st.ok && st.fix !== 'upload') { app.toast(st.line); return; }
      if (st.fix === 'upload') {
        app.confirm({title: `上传到 ${e.name}？`, body: C.uploadNotice(v, e.provider), confirmLabel: '上传并合成', run});
      } else run();
    };
    const sample = TTS.sampleLine(v.lang, 'intro').text;
    return (
      <div className="vlib-cloudtry">
        <p className="t-body-sm">{sample}</p>
        <div className="row gap8">
          <Btn variant="accent" size="s" icon="wave" disabled={phase === 'run' || (!st.ok && st.fix !== 'upload')} onClick={go}>{phase === 'run' ? '合成中…' : phase === 'done' ? '再合成一次' : '合成并试听'}</Btn>
          <span className="t-detail-xs grow">{st.line} · {C.costLine(sample, C.providerById(e.provider, app.cloudCustom) || e.provider)}</span>
        </div>
        {phase === 'done' ? <window.TtsInlinePlayer dur={3.2} /> : null}
      </div>
    );
  }

  /* 试听克隆：模型在 D.setModels（本地模型页那一张表；D.models.local 只有转录模型，2026-09-24 之前查错了表，
     所以永远只显示「装一只能克隆的模型」的门）。引擎就地挑：已装的直接用，没装的显示下载门，装好即换成试听面板。 */
  const modelRow = (id) => D.setModels.find((x) => x.id === id);
  const mb = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + ' GB' : n + ' MB');
  function Audition({v, onPatch}) {
    const app = useApp();
    const [engine, setEngine] = useState(() => V.auditionModel(app.modelInstalled) || V.CLONE_MODELS[0]);
    const [open, setOpen] = useState(false);
    const cloud = C.isCloud(engine);
    const cloudEngines = C.engines(app.cloudSaved, app.cloudCustom).filter((e) => C.capabilities(C.providerById(e.provider, app.cloudCustom) || e.provider).clone);
    const m = cloud ? null : modelRow(engine);
    const ready = cloud || (!!m && app.modelInstalled(engine));
    const label = cloud ? `${TTS.engineOf(engine).name} · ${(C.parse(TTS.engineOf(engine).models.preset) || {}).model}` : m ? m.name : '选模型';
    return (
      <div className="vlib-audition">
        <EngineLine v={v} />
        <div className="vlib-audition__pick">
          <span className="t-detail-xs">用哪只模型念</span>
          <Picker size="s" value={label} open={open} popWidth={300}
            onClick={() => setOpen((x) => !x)} onClose={() => setOpen(false)}>
            <Menu>
              {cloudEngines.length ? <MenuHead>本机</MenuHead> : null}
              {V.CLONE_MODELS.map((id) => {
                const r = modelRow(id);
                if (!r) return null;
                const on = app.modelInstalled(id);
                return (
                  <MenuItem key={id} icon={on ? 'check' : 'download'} label={r.name} on={id === engine}
                    sub={on ? V.profileFor(TTS.MODELS[id].engine).line : `没装 · ${mb(r.size)} · 选它就地下载`}
                    onClick={() => { setOpen(false); setEngine(id); }} />
                );
              })}
              {cloudEngines.length ? <><MenuRule /><MenuHead>云端 · 联网计费</MenuHead></> : null}
              {cloudEngines.map((e) => {
                const st = C.cloneStatus(v, e.provider, {saved: app.cloudSaved, extra: app.cloudCustom});
                return <MenuItem key={e.id} icon="remote" label={e.name} sub={st.line} wrap disabled={!st.ok && st.fix !== 'upload'} on={e.id === engine}
                  onClick={() => { setOpen(false); setEngine(e.id); }} />;
              })}
            </Menu>
          </Picker>
          <span className="t-detail-xs">念一句听听像不像 · 换模型音色不变</span>
        </div>
        {cloud
          ? <CloudAudition key={engine} v={v} engine={engine} onPatch={onPatch} />
          : ready
            ? <window.TtsQuickTest key={engine} m={m} initialVoice={'my:' + v.id} />
            : <Gate id={engine} label="试听" />}
      </div>
    );
  }

  /* 云端克隆这次会话的状态：`covered` 是回程条已经在报的那一家（行上只留 chip，不重复报）；`onClone(pid, k)` 接诊断里的按钮 */
  const RUN_CHIP = {uploading: {tone: 'accent', text: '上传中'}, failed: {tone: 'negative', text: '没建成'}};
  function VoiceRow({v, onPatch, onDelete, onRetake, onConsent, covered, onClone}) {
    const app = useApp();
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(v.name);
    const [audition, setAudition] = useState(false);
    const commit = () => { onPatch({name: name.trim() || v.name}); setRenaming(false); };
    const exportIt = () => copyToClipboard(V.exportBundle(v))
      .then(() => app.toast(`已复制 voice.json · 真机导出的是 ${V.bundleName(v)}（连参考录音一起）`, 'positive'));
    const uploaded = Object.keys(v.cloud || {}).filter((k) => v.cloud[k] && v.cloud[k].voiceId);
    const runs = V.cloneRuns(v);
    const busy = runs.filter((r) => RUN_CHIP[r.state]);
    const pname = (k) => (C.providerById(k, app.cloudCustom) || {name: k}).name;
    /* 要授权录音的提供方（Gemini）连着、而这只音色没录那段：行上亮一枚 chip，不等到选它时才发现 */
    const missingConsent = C.consentProviders(app.cloudSaved, app.cloudCustom).filter((p) => !C.hasConsentClip(v) && !busy.some((r) => r.id === p.id));
    const del = () => app.confirm({
      title: `删除「${v.name}」？`,
      body: `用了它的视频下次生成时会退回默认音色；已经生成的配音不受影响。${uploaded.length ? `会一并删除 ${uploaded.map((k) => (C.providerById(k, app.cloudCustom) || {name: k}).name).join(' / ')} 上的克隆。` : ''}`,
      tone: 'negative', confirmLabel: '删除', run: onDelete,
    });
    /* ⋯ 里的云端项：能克隆的已连接 API 提供方一家一条——上传过的给「从 X 删除克隆」，没传的给「上传到 X」（不可用的置灰写原因） */
    const cloudItems = C.engines(app.cloudSaved, app.cloudCustom).map((e) => {
      const p = C.providerById(e.provider, app.cloudCustom) || e.provider;
      if (!C.capabilities(p).clone) return null;
      const st = C.cloneStatus(v, p, {saved: app.cloudSaved, extra: app.cloudCustom});
      if (st.k === 'uploaded' || st.k === 'stale' || st.k === 'orphan') {
        return <MenuItem key={e.id} icon="remote" label={`从 ${e.name} 删除克隆`} sub={st.k === 'orphan' ? '密钥已移除 · 只清本地绑定' : st.line} wrap
          onClick={() => { setMenu(false); onPatch({cloud: C.bindAfter(v, e.provider, 'delete')}); app.toast(st.k === 'orphan' ? `已清掉 ${e.name} 的绑定 · 对方账户里的旧克隆要自己删` : `已从 ${e.name} 删除克隆 · 要用时在这里再上传`); }} />;
      }
      if (V.cloneState(v, e.provider) === 'uploading') return <MenuItem key={e.id} icon="remote" label={`上传到 ${e.name}`} sub={`正在上传 · ${V.CLONE_ETA}`} wrap disabled />;
      return <MenuItem key={e.id} icon="remote" label={`上传到 ${e.name}`} sub={st.k === 'first' ? '上传样本建克隆 · 建好记下 voice id' : st.k === 'failed' ? `${st.line} · 再传一次` : st.line} wrap disabled={st.fix !== 'upload' && st.k !== 'failed'}
        onClick={() => { setMenu(false); app.confirm({title: `上传到 ${e.name}？`, body: C.uploadNotice(v, p), confirmLabel: '上传', run: () => window.startVoiceClone(app, v, [e.provider])}); }} />;
    }).filter(Boolean);
    return (
      <div className={cx('vlib-row', audition && 'is-open')}>
        <div className="vlib-row__hd">
          <window.VoicePlay v={v} />
          <div className="vlib-row__main">
            {renaming ? (
              <Field size="s" value={name} autoFocus aria-label="音色名字" onChange={(e) => setName(e.target.value)}
                onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setName(v.name); setRenaming(false); } }} />
            ) : (
              <span className="vlib-row__nm">
                <b className="t-title-sm">{v.name}</b>
                {v.emotion ? <Chip>带情绪片段</Chip> : null}
                {v.consent === 'unspecified' ? <Chip tone="neutral">未说明是否本人</Chip> : null}
                {(v.signal || []).map((k) => <Chip key={k} tone="notice">{V.issueLabel(k)}</Chip>)}
                {uploaded.filter((k) => !busy.some((r) => r.id === k)).map((k) => { const st = C.cloneStatus(v, k, {saved: app.cloudSaved, extra: app.cloudCustom}); return <Chip key={k} tone={CLOUD_TONE[st.k]} icon="remote" title={st.line}>{st.chip}</Chip>; })}
                {busy.map((r) => <Chip key={r.id} tone={RUN_CHIP[r.state].tone} icon="remote">{pname(r.id)} · {RUN_CHIP[r.state].text}</Chip>)}
                {missingConsent.map((p) => { const st = C.cloneStatus(v, p, {saved: app.cloudSaved, extra: app.cloudCustom}); return <Chip key={p.id} tone={CLOUD_TONE[st.k]} icon="remote" title={st.line}>{st.chip}</Chip>; })}
              </span>
            )}
            <span className="t-detail-xs vlib-row__meta">{V.metaLine(v)}</span>
            {v.text ? <span className="t-detail-xs vlib-row__text">「{v.text}」</span> : null}
            <span className="t-detail-xs vlib-row__ids">
              {V.idLine(v, C.providers(app.cloudCustom))}
              {v.consentClip && v.consentClip.dur > 0 ? <window.VoicePlay v={{file: v.consentClip.file}} size="xs" tip="听授权声明" /> : null}
            </span>
          </div>
          <Btn variant={audition ? 'primary' : 'secondary'} size="s" icon="wave" aria-expanded={audition} onClick={() => setAudition((x) => !x)}>试听克隆</Btn>
          <div className="vlib-row__more">
            <IconBtn icon="more" size="s" tip={`更多 · ${v.name}`} on={menu} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} />
            <Popover open={menu} onClose={() => setMenu(false)} align="right" dir="down" width={240}>
            <Menu>
              <MenuItem icon="edit" label="重命名" onClick={() => { setMenu(false); setRenaming(true); }} />
              <MenuItem icon="wave" label="换参考段" sub={v.source.kind === 'media' ? '回到分人页重挑一段' : '重新录一段'}
                onClick={() => { setMenu(false); onRetake(); }} />
              <MenuItem icon="mic" label={v.consentClip ? '重录授权声明' : '补录授权声明'} sub={v.consentClip ? `${V.phraseLabel(V.consentPhrase(v.consentClip.lang, v.consentClip.text))} · ${v.consentClip.dur.toFixed(1)} 秒 · Google Gemini 用` : 'Google Gemini 复刻要本人念一句，英文最稳'}
                onClick={() => { setMenu(false); onConsent(); }} />
              {V.bindings(v, C.providers(app.cloudCustom)).filter((b) => b.kind === 'seed').map((b) => (
                <MenuItem key={b.id} icon="refresh" label={`换种子 · ${b.name}`} sub={`现在是 ${b.value} · 这只引擎下次生成会变一点`}
                  onClick={() => { setMenu(false); onPatch(b.id === '*' ? {seed: V.randomSeed()} : {seeds: Object.assign({}, v.seeds, {[b.id]: V.randomSeed()})}); app.toast(`已换 ${b.name} 的种子 · 用了它的视频下次生成会略有不同`); }} />
              ))}
              <MenuItem icon="plus" label={v.emotion ? '换情绪片段' : '补一段情绪片段'} sub="IndexTTS 两代用；其他引擎不看"
                onClick={() => { setMenu(false); onPatch({emotion: v.emotion ? null : {dur: 4.2, file: v.file}}); app.toast(v.emotion ? '已去掉情绪片段' : '交互演示 · 已补一段 4.2 秒的情绪片段'); }} />
              {cloudItems.length ? <><MenuRule />{cloudItems}</> : null}
              <MenuRule />
              <MenuItem icon="export" label="导出音色包…" sub={V.bundleName(v)} onClick={() => { setMenu(false); exportIt(); }} />
              <MenuItem icon="trash" label="删除" tone="negative" onClick={() => { setMenu(false); del(); }} />
            </Menu>
            </Popover>
          </div>
        </div>
        {runs.filter((r) => r.id !== covered).map((r) => (
          <div key={r.id} className="vlib-row__clone"><window.VoiceCloneAlert v={v} pid={r.id} onAction={(k) => onClone(r.id, k)} /></div>
        ))}
        {audition ? <Audition v={v} onPatch={onPatch} /> : null}
      </div>
    );
  }

  /* ---------- 从音频或视频里取：分离 → 分人 → 挑段 ---------- */

  function Gate({id, label}) {
    const app = useApp();
    const m = modelRow(id);
    if (!m || app.modelInstalled(id)) return null;
    const pct = app.modelDl && app.modelDl[id];
    return (
      <span className="vlib-gate t-detail-xs">
        {label}要先下载 {m.name}（{mb(m.size)}）
        {pct !== undefined && pct < 100
          ? <Progress value={pct} thin className="vlib-gate__bar" />
          : <Btn variant="secondary" size="s" icon="download" onClick={() => window.withModelLicense(app, id, () => app.downloadModel(id))}>下载</Btn>}
      </span>
    );
  }

  function Candidate({w, on, letter, onPick}) {
    return (
      <div className={cx('vlib-cand', on && 'is-on')}>
        <window.RSP.Radio value={String(w.k)}>{V.candidateLine(w)}</window.RSP.Radio>
        <window.VoicePlay v={{file: LETTER_FILES[(letter.charCodeAt(0) - 65) % LETTER_FILES.length]}} size="xs" tip="听这一段" />
        {w.issues.map((k) => <Chip key={k} tone={k === 'short' ? 'negative' : 'notice'}>{V.issueLabel(k)}</Chip>)}
        <span className="vlib-cand__text t-detail-xs">{w.text || '（这一段没有可对上的原文）'}</span>
      </div>
    );
  }

  function SpeakerCard({card, pick, onPick}) {
    const on = !!pick.on;
    return (
      <div className={cx('vlib-spk', on && 'is-on')}>
        <div className="vlib-spk__hd">
          <Checkbox on={on} onChange={(x) => onPick({on: x})} label="" />
          <span className="spkdot" style={{background: `oklch(0.6 0.14 ${card.hue})`}} />
          <Field size="s" value={pick.name || ''} placeholder={`说话人 ${card.letter}`} aria-label={`说话人 ${card.letter} 的名字`}
            onChange={(e) => onPick({name: e.target.value, on: true})} className="vlib-spk__name" />
          <span className="t-detail-xs">{V.speakerLine(card)}</span>
        </div>
        <window.RSP.RadioGroup aria-label="参考片段" value={on ? String(pick.k || 0) : null} onChange={k => onPick({k: Number(k), on: true})} UNSAFE_className="vlib-spk__cands">
          {card.candidates.map((w) => (
            <Candidate key={w.k} w={w} letter={card.letter} on={(pick.k || 0) === w.k && on} onPick={() => onPick({k: w.k, on: true})} />
          ))}
          {!card.candidates.length ? <span className="t-detail-xs">这位没有凑得出 5 秒的整句，换一段媒体试试。</span> : null}
        </window.RSP.RadioGroup>
      </div>
    );
  }

  function MediaCapture({onDone, onCancel}) {
    const app = useApp();
    const [file, setFile] = useState(null);
    const [separate, setSeparate] = useState(true);
    const [phase, setPhase] = useState('pick');   // pick | work | split
    const [step, setStep] = useState(0);
    const [pct, setPct] = useState(0);
    const [picks, setPicks] = useState({});
    const timer = useRef(null);
    const fileInput = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    const steps = V.STEPS.filter((s) => separate || s.k !== 'separate');
    const start = () => {
      setPhase('work'); setStep(0); setPct(0);
      timer.current = setInterval(() => setPct((x) => {
        const n = x + 4;
        if (n >= 100) {
          setStep((s) => {
            if (s + 1 >= steps.length - 1) { clearInterval(timer.current); setPhase('split'); return s + 1; }
            return s + 1;
          });
          return 0;
        }
        return n;
      }), 60);
    };
    // 示例文稿跟着当前打开的项目走（可能是英文源），语言按文字判：有汉字就是中文
    const demoCues = D.cues.slice(0, 40);
    const demoLang = demoCues.some((c) => /[\u4e00-\u9fff]/.test(c.text || '')) ? 'zh' : 'en';
    const cards = phase === 'split'
      ? V.analyze(demoCues, D.speakers, {separated: separate, overlaps: DEMO_MEDIA.overlaps, music: DEMO_MEDIA.music})
      : [];
    const onPick = (id, patch) => setPicks((p) => ({...p, [id]: {...(p[id] || {}), ...patch}}));
    const chosen = cards.filter((c) => picks[c.id] && picks[c.id].on);
    const save = () => {
      const made = V.voicesFromPicks(cards, picks, {name: file.name, lang: demoLang, separated: separate});
      made.forEach((v) => { v.file = LETTER_FILES[(v.source.speaker.charCodeAt(0) - 65) % LETTER_FILES.length]; v.consent = 'permitted'; });
      onDone(made);
    };
    const pickDemo = (f) => setFile(f || {name: DEMO_MEDIA.name, dur: DEMO_MEDIA.dur});

    return (
      <div className="vlib-cap" data-screen-label={phase === 'split' ? '我的声音 · 分人页' : '我的声音 · 从音频或视频里取'}>
        <div className="vlib-cap__hd">
          <Btn variant="quiet" size="s" icon="back" onClick={onCancel}>我的声音</Btn>
        </div>
        <h2 className="t-title-sm">从音频或视频里取</h2>
        {phase === 'pick' ? (
          <>
            <p className="vlib-cap__lede">一段访谈、一期播客、一条口播都行。有几个人说话就分成几个人，每人挑一段最干净的存下来。</p>
            <div className="vlib-drop" onClick={() => fileInput.current.click()} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current.click(); } }}>
              <Ic n="upload" className="ic--26" />
              {file ? <b>{file.name}</b> : <b>拖一个音频或视频文件到这里，或点一下选</b>}
              <span className="t-detail-xs">{file ? `${V.fmtTime(file.dur)} · 分析在本机做，文件不上传` : 'MP4 / MOV / MP3 / M4A / WAV / FLAC'}</span>
            </div>
            <input ref={fileInput} type="file" accept="audio/*,video/*" hidden onChange={(e) => {
              const f = e.target.files[0]; e.target.value = ''; pickDemo(f ? {name: f.name, dur: DEMO_MEDIA.dur} : null);
            }} />
            {!file ? <BCAction className="viewall vlib-demo" onClick={() => pickDemo()}>用示例访谈试试（{DEMO_MEDIA.name}）</BCAction> : null}
            <div className="vlib-cap__row">
              <Switch on={separate} onChange={setSeparate} label="先分离人声" />
              <span className="t-detail-xs">有背景音乐或环境声就开；纯人声录音可以关，快很多</span>
            </div>
            <div className="vlib-gates">
              {separate ? <Gate id="htdemucs-ft" label="分离人声" /> : null}
              <Gate id="speaker-diarization" label="识别说话人" />
            </div>
            <div className="vlib-save__acts">
              <Btn variant="accent" size="s" disabled={!file} onClick={start}>开始分析</Btn>
              <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
            </div>
          </>
        ) : phase === 'work' ? (
          <>
            <p className="vlib-cap__lede">{file.name} · 正在{steps[step].label}…</p>
            <Steps items={steps} cur={step} />
            <Progress value={pct} />
            <div className="vlib-save__acts">
              <Btn variant="secondary" size="s" onClick={() => { clearInterval(timer.current); onCancel(); }}>取消</Btn>
            </div>
          </>
        ) : (
          <>
            <p className="vlib-cap__lede">
              {file.name} · 分出 {cards.length} 位说话人{separate ? ' · 已分离人声' : ''}。
              每位给了最多三段 5–10 秒的整句候选，带着这段的原文；勾谁、给个名字，就存成谁的音色。
            </p>
            <div className="vlib-spks">
              {cards.map((c) => <SpeakerCard key={c.id} card={c} pick={picks[c.id] || {}} onPick={(p) => onPick(c.id, p)} />)}
            </div>
            <div className="vlib-save__acts vlib-save__acts--sticky">
              <Btn variant="accent" size="s" disabled={!chosen.length} onClick={save}>{V.saveLabel(cards, picks)}</Btn>
              <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
              <span className="t-detail-xs grow">候选段互不重叠，都落在 5–10 秒里，每只引擎都合规；「有人插话」「有背景声」只是提醒，仍可选。</span>
            </div>
          </>
        )}
        <p className="t-detail-xs vlib-foot">交互演示 · 分离与分人是计时器模拟，用的是示例访谈的文稿；试听放的是随包录音。</p>
      </div>
    );
  }

  /* ---------- 列表 ---------- */

  function VoicesSection() {
    const app = useApp();
    const [mode, setMode] = useState('list');   // list | mic | media | consent:<voiceId> | retake:<voiceId>:<provider>
    const [addMenu, setAddMenu] = useState(false);
    window.useCloneWatch();
    /* 从模型页的「克隆新音色」过来：直接进采集页（预选那只模型） */
    const openAs = app.voiceHandoff && !app.voiceHandoff.voiceId ? app.voiceHandoff.open : null;
    useEffect(() => { if (openAs) setMode(openAs); }, [openAs]);
    const voices = app.voices;
    const patch = (id, p) => app.setVoices((list) => list.map((v) => (v.id === id ? {...v, ...p} : v)));
    const names = (ids) => ids.map((k) => (C.providerById(k, app.cloudCustom) || {name: k}).name).join('、');
    /* 从选择器过来补授权声明 / 换样本的（fixVoiceClone）：补好就把这只音色交给回程，条上报上传进度、带人回去 */
    const handBack = (id) => { const h = app.voiceHandoff; if (h && !h.voiceId) app.setVoiceHandoff({...h, voiceId: id}); };
    const finish = (made, uploads) => {
      const list = Array.isArray(made) ? made : [made];
      const up = uploads || [];
      app.addVoices(list);
      setMode('list');
      if (up.length) window.startVoiceClone(app, list[0], up);
      const h = app.voiceHandoff;
      if (h) {
        app.setVoiceHandoff({...h, voiceId: list[0].id});
        /* 回程条会接着报上传进度与「回去」；只有本地或不上传时才用 toast 提一句 */
        if (!up.length) {
          app.toast(list.length > 1 ? `已存 ${list.length} 只音色 · 「${list[0].name}」会带回${h.from}` : `已存「${list[0].name}」`, 'positive',
            {label: '回去用它', run: () => app.go(h.route)});
        }
      } else {
        app.toast(list.length > 1 ? `已存 ${list.length} 只音色 · 生成语音、配音、试听里都能选`
          : up.length ? `已存「${list[0].name}」 · 正在上传到 ${names(up)}` : `已存「${list[0].name}」 · 生成语音、配音、试听里都能选`, 'positive');
      }
    };
    /* 诊断里的一键去做（BC_VOICES.cloneFailure 的 action.k）与「知道了 / 收起」 */
    const onClone = (v, pid, k) => {
      if (k === 'consent') setMode('consent:' + v.id);
      else if (k === 'sample') setMode(`retake:${v.id}:${pid}`);
      else if (k === 'retry' || k === 'grant') window.startVoiceClone(app, v, [pid], {grant: k === 'grant'});
      else if (k === 'provider') app.go(window.providerDetailRoute(pid));
      else if (k === 'dismiss') app.setVoices((list) => list.map((x) => (x.id === v.id ? {...x, ...V.cloneAfter(x, pid, 'dismiss')} : x)));
    };
    if (mode === 'mic') return <div className="vlib"><window.VoiceCapture onDone={finish} onCancel={() => setMode('list')} /></div>;
    if (mode === 'media') return <div className="vlib"><MediaCapture onDone={finish} onCancel={() => setMode('list')} /></div>;
    if (String(mode).indexOf('consent:') === 0) {
      const target = voices.find((v) => v.id === mode.slice(8));
      if (target) {
        return <div className="vlib"><window.ConsentCapture v={target} onCancel={() => setMode('list')}
          onDone={(clip, up) => {
            patch(target.id, {consentClip: clip});
            setMode('list');
            handBack(target.id);
            if (up.length) window.startVoiceClone(app, target, up);
            if (!(app.voiceHandoff && up.length)) app.toast(up.length ? `已存「${target.name}」的授权声明 · 正在重新上传到 ${names(up)}` : `已存「${target.name}」的授权声明`, 'positive');
          }} /></div>;
      }
    }
    /* 没建成时「录新样本」：给这只音色换样本（不另起一只），存好按计划重新上传；别家的旧克隆标成参考已换 */
    if (String(mode).indexOf('retake:') === 0) {
      const [, id, pid] = mode.split(':');
      const target = voices.find((v) => v.id === id);
      if (target) {
        return <div className="vlib"><window.VoiceCapture base={target} entry={pid} onCancel={() => setMode('list')}
          onDone={(draft, up) => {
            patch(id, {...draft, id, cloud: C.bindAfter(target, null, 'retake'), cloneRun: V.cloneAfter(target, pid, 'dismiss').cloneRun});
            setMode('list');
            handBack(id);
            if (up.length) window.startVoiceClone(app, {id, name: draft.name}, up);
            if (!(app.voiceHandoff && up.length)) app.toast(up.length ? `已换上新样本 · 正在重新上传到 ${names(up)}` : `已给「${draft.name}」换上新样本`, 'positive');
          }} /></div>;
      }
    }
    const cover = window.voiceHandoffCover(app.voiceHandoff, voices);

    const addBtn = (
      <Picker size="s" icon="plus" value="克隆新音色" open={addMenu} popWidth={280}
        onClick={() => setAddMenu((x) => !x)} onClose={() => setAddMenu(false)}>
        <Menu>
          <MenuItem icon="mic" label="录或上传一段样本" sub="先选给哪些模型用；30 秒左右的样本；选了 Google Gemini 再念一句授权声明" onClick={() => { setAddMenu(false); setMode('mic'); }} />
          <MenuItem icon="upload" label="从音频或视频里取…" sub="多人说话会分开，每人挑一段" onClick={() => { setAddMenu(false); setMode('media'); }} />
          <MenuRule />
          <MenuItem icon="download" label="导入音色包…" sub="别人导出的 .bcvoice" onClick={() => { setAddMenu(false); app.toast('交互演示 · 选一个 .bcvoice 文件夹'); }} />
        </Menu>
      </Picker>
    );

    return (
      <div className="vlib" data-screen-label="我的声音">
        <h1 className="t-heading-sm">我的声音</h1>
        <p className="vlib-lede">
          录或上传一段 30 秒左右的样本，或从视频里取一个人的声音，存成音色。之后生成语音、克隆声音、翻译配音、试听里按名字选，
          每只能克隆的引擎都能用；录音留在这台电脑上。克隆时勾了云端模型（ElevenLabs / MiniMax / Google Gemini）的，保存时把样本上传给它建克隆、记下 voice id，随时可删；
          Google Gemini 还要本人念一句授权声明。
        </p>
        <window.VoiceHandoffBar onAction={onClone} />
        {voices.length ? (
          <>
            <div className="vlib-list">
              {voices.map((v) => (
                <VoiceRow key={v.id} v={v} onPatch={(p) => patch(v.id, p)}
                  covered={cover && cover.v.id === v.id ? cover.pid : null} onClone={(pid, k) => onClone(v, pid, k)}
                  onDelete={() => { app.setVoices((list) => list.filter((x) => x.id !== v.id)); app.toast(`已删除「${v.name}」`); }}
                  onRetake={() => { if (Object.keys(v.cloud || {}).length) patch(v.id, {cloud: C.bindAfter(v, null, 'retake')}); setMode(v.source.kind === 'media' ? 'media' : 'mic'); }}
                  onConsent={() => setMode('consent:' + v.id)} />
              ))}
            </div>
            <div className="vlib-actions">{addBtn}</div>
          </>
        ) : (
          <div className="vlib-empty">
            <Empty icon="mic" title="还没有音色">录或上传一段 30 秒左右的样本，或从一段视频里取；存好后到处都能选。</Empty>
            <div className="vlib-empty__acts">
              <Btn variant="accent" size="s" icon="mic" onClick={() => setMode('mic')}>录或上传一段样本</Btn>
              <Btn variant="secondary" size="s" icon="upload" onClick={() => setMode('media')}>从音频或视频里取…</Btn>
            </div>
          </div>
        )}
        <div className="t-detail-xs vlib-foot vlib-foot--rule">
          一只音色 = 一段 30 秒左右的样本 + 从它截出的 5–10 秒参考段（带原文）+ 来源 + 每只本机引擎一颗种子；给 Google Gemini 用的还带一段本人念的授权声明。
          本地引擎靠同一段参考 + 那只引擎的种子认人，云端靠对方给的 voice id（一家一只，记在这只音色上，删音色时一并删）。
          导出的音色包（<span className="t-mono">名字.bcvoice</span>）带着录音、授权声明、种子与 <span className="t-mono">voice.json</span>，可以直接发给别人导入，voice id 不随包走；
          CLI 用 <span className="t-mono">--voice my:名字</span> 选它。
          Qwen3-TTS CustomVoice 接不了参考音频，OpenAI 的云端模型不能克隆，选了会明说，不会偷偷换成别的声音。
          「未说明是否本人」的音色不会上传到任何第三方。
        </div>
        <window.CloneDemo />
      </div>
    );
  }

  Object.assign(window, {VoicesSection});
})();
