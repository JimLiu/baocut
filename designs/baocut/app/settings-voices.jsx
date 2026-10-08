/* 设置 › 我的声音（voice-library 设计稿 §2 / §9，2026-09-24 原型先行）。
   克隆音色以前不是一个功能，是四个地方各自的一枚「我的音频」芯片。这一页把它变成**用户级资产**：
   ① 列表：一只音色一行（名字 · 语言 · 时长 · 来源 · 原文 · 试听 · 试听克隆 · ⋯）；
   ② 用麦克风录一段：照着台词念，5 秒起、目标 8 秒、12 秒自动停，听一遍再存；
   ③ 从音频或视频里取：分离人声（可选）→ 识别说话人 → 每人一张卡、各给最多三段候选（带原文与质量），
      勾一人或几人一起存；
   ④ 回程：从面板的「克隆新音色…」过来时，存好后一键回去用它。
   麦克风、分离、分人在原型里都是计时器模拟，听到的是随包的内置录音；判词与候选算法在 model-voices.js。
   云端（2026-09-24 云端语音合成设计稿 §2.4 / §6）：行卡上多一组云端 chip（已上传 / 首次用时上传 / 参考不足 / 许可未说明 / 不能克隆），
   ⋯ 里多「上传到 X」「从 X 删除克隆」，试听克隆的模型 Picker 多一组云端；换参考段把已上传的绑定标成陈旧。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const V = window.BC_VOICES;
  const C = window.BC_CLOUD_TTS;
  const CLOUD_TONE = {uploaded: 'positive', first: 'neutral', stale: 'notice', orphan: 'notice', short: 'notice', consent: 'notice', unsupported: 'neutral'};

  /* 演示用：分人页每位说话人试听放哪段随包录音 */
  const LETTER_FILES = ['tts-voice-zh-female.wav', 'tts-voice-zh-male.wav', 'tts-voice-en-female.wav', 'tts-voice-en-male.wav'];
  const DEMO_MEDIA = {name: '第 13 期访谈.mp4', dur: 206, overlaps: [[52.8, 54.6], [16.4, 17.3]], music: [[0, 12]]};

  /* ---------- 回程条：从面板过来的 ---------- */

  function HandoffBar() {
    const app = useApp();
    const h = app.voiceHandoff;
    if (!h) return null;
    const back = () => app.go(h.route);
    return (
      <div className="vlib-handoff" role="status">
        <Ic n="info" className="ic--16" />
        <span className="grow">
          {h.voiceId ? `已存好 · 回到${h.from}，那里会直接选上这只音色` : `从${h.from}过来 · 录一段或从视频里取，存好后带你回去`}
        </span>
        {h.voiceId
          ? <Btn variant="accent" size="s" onClick={back}>回去用它</Btn>
          : <Btn variant="quiet" size="s" onClick={() => { app.setVoiceHandoff(null); back(); }}>不了，回去</Btn>}
      </div>
    );
  }

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
        if (st.k === 'first' || st.k === 'stale') onPatch({cloud: C.bindAfter(v, e.provider, 'upload', {at: '刚刚'})});
        setPhase('done');
      }, 1200);
    };
    const go = () => {
      if (!st.ok) { app.toast(st.line); return; }
      if (st.k === 'first' || st.k === 'stale') {
        app.confirm({title: `上传到 ${e.name}？`, body: C.uploadNotice(v, e.provider), confirmLabel: '上传并合成', run});
      } else run();
    };
    const sample = TTS.sampleLine(v.lang, 'intro').text;
    return (
      <div className="vlib-cloudtry">
        <p className="t-body-sm">{sample}</p>
        <div className="row gap8">
          <Btn variant="accent" size="s" icon="wave" disabled={phase === 'run' || !st.ok} onClick={go}>{phase === 'run' ? '合成中…' : phase === 'done' ? '再合成一次' : '合成并试听'}</Btn>
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
                return <MenuItem key={e.id} icon="remote" label={e.name} sub={st.line} wrap disabled={!st.ok} on={e.id === engine}
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

  function VoiceRow({v, onPatch, onDelete, onRetake}) {
    const app = useApp();
    const [menu, setMenu] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(v.name);
    const [audition, setAudition] = useState(false);
    const commit = () => { onPatch({name: name.trim() || v.name}); setRenaming(false); };
    const exportIt = () => copyToClipboard(V.exportBundle(v))
      .then(() => app.toast(`已复制 voice.json · 真机导出的是 ${V.bundleName(v)}（连参考录音一起）`, 'positive'));
    const uploaded = Object.keys(v.cloud || {}).filter((k) => v.cloud[k] && v.cloud[k].voiceId);
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
          onClick={() => { setMenu(false); onPatch({cloud: C.bindAfter(v, e.provider, 'delete')}); app.toast(st.k === 'orphan' ? `已清掉 ${e.name} 的绑定 · 对方账户里的旧克隆要自己删` : `已从 ${e.name} 删除克隆 · 下次用时再传`); }} />;
      }
      return <MenuItem key={e.id} icon="remote" label={`上传到 ${e.name}`} sub={st.line} wrap disabled={!st.ok}
        onClick={() => { setMenu(false); app.confirm({title: `上传到 ${e.name}？`, body: C.uploadNotice(v, p), confirmLabel: '上传', run: () => { onPatch({cloud: C.bindAfter(v, e.provider, 'upload', {at: '刚刚'})}); app.toast(`已上传到 ${e.name} · 交互演示`, 'positive'); }}); }} />;
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
                {uploaded.map((k) => { const st = C.cloneStatus(v, k, {saved: app.cloudSaved, extra: app.cloudCustom}); return <Chip key={k} tone={CLOUD_TONE[st.k]} icon="remote" title={st.line}>{st.chip}</Chip>; })}
              </span>
            )}
            <span className="t-detail-xs vlib-row__meta">{V.metaLine(v)}</span>
            {v.text ? <span className="t-detail-xs vlib-row__text">「{v.text}」</span> : null}
          </div>
          <Btn variant={audition ? 'primary' : 'secondary'} size="s" icon="wave" aria-expanded={audition} onClick={() => setAudition((x) => !x)}>试听克隆</Btn>
          <div className="vlib-row__more">
            <IconBtn icon="more" size="s" tip={`更多 · ${v.name}`} on={menu} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} />
            <Popover open={menu} onClose={() => setMenu(false)} align="right" dir="down" width={240}>
            <Menu>
              <MenuItem icon="edit" label="重命名" onClick={() => { setMenu(false); setRenaming(true); }} />
              <MenuItem icon="wave" label="换参考段" sub={v.source.kind === 'media' ? '回到分人页重挑一段' : '重新录一段'}
                onClick={() => { setMenu(false); onRetake(); }} />
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
        {audition ? <Audition v={v} onPatch={onPatch} /> : null}
      </div>
    );
  }

  /* ---------- 用麦克风录一段 ---------- */

  function Meter({level, on}) {
    const bars = Array.from({length: 14}, (_, i) => i);
    return (
      <span className={cx('vlib-meter', on && 'is-on')} aria-hidden="true">
        {bars.map((i) => <i key={i} className={cx(level * 14 > i && 'is-lit')} />)}
      </span>
    );
  }

  function MicCapture({onDone, onCancel}) {
    const app = useApp();
    const langs = TTS.sampleLangs('indextts2');
    const [lang, setLang] = useState(langs[0].code);
    const [kind, setKind] = useState('intro');
    const [phase, setPhase] = useState('idle');     // idle | rec | done
    const [secs, setSecs] = useState(0);
    const [level, setLevel] = useState(0);
    const [name, setName] = useState('我自己');
    const [consent, setConsent] = useState(false);
    const [dev, setDev] = useState(false);
    const timer = useRef(null);
    const line = TTS.sampleLine(lang, kind);
    const kinds = TTS.sampleKinds(lang);
    useEffect(() => () => clearInterval(timer.current), []);
    const stop = () => { clearInterval(timer.current); timer.current = null; setPhase('done'); setLevel(0); };
    const start = () => {
      setSecs(0); setPhase('rec');
      timer.current = setInterval(() => setSecs((s) => {
        const n = +(s + 0.1).toFixed(1);
        setLevel(0.3 + 0.5 * Math.abs(Math.sin(n * 5.3)) * (n % 3 < 2.4 ? 1 : 0.3));
        if (n >= V.REC.max) { clearInterval(timer.current); timer.current = null; setPhase('done'); setLevel(0); }
        return n;
      }), 100);
    };
    const problem = phase === 'done' ? V.takeProblem(secs) : null;
    const preview = {file: TTS.defaultBuiltin(lang, '').file};
    const save = () => {
      onDone(V.makeVoice({name, lang, dur: secs, text: line.text, textSource: 'script',
        source: {kind: 'mic', at: '刚刚'}, file: preview.file, consent: consent ? 'self' : 'unspecified'}));
    };
    return (
      <div className="vlib-cap" data-screen-label="我的声音 · 用麦克风录一段">
        <div className="vlib-cap__hd">
          <Btn variant="quiet" size="s" icon="back" onClick={onCancel}>我的声音</Btn>
        </div>
        <h2 className="t-title-sm">用麦克风录一段</h2>
        <p className="vlib-cap__lede">照着下面这句念，一个人说话、周围安静。{V.REC.min} 秒起，念到 {V.REC.target} 秒左右最好，{V.REC.max} 秒自动停。</p>

        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">麦克风</span>
          <Picker size="s" icon="mic" value="MacBook Pro 麦克风" open={dev} popWidth={240}
            onClick={() => setDev((x) => !x)} onClose={() => setDev(false)}>
            <Menu>
              <MenuItem label="MacBook Pro 麦克风" on onClick={() => setDev(false)} />
              <MenuItem label="AirPods Pro" sub="蓝牙耳机会压低音质，能用内置就用内置" onClick={() => { setDev(false); app.toast('交互演示 · 已换到 AirPods Pro'); }} />
            </Menu>
          </Picker>
          <Meter level={level} on={phase === 'rec'} />
        </div>
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">念哪句</span>
          <div className="vlib-cap__chips">
            {langs.map((l) => <Chip key={l.code} pill on={lang === l.code} onClick={() => { if (phase !== 'rec') { setLang(l.code); setKind(TTS.sampleLine(l.code, kind).kind); } }}>{l.label}</Chip>)}
            {kinds.length > 1 ? <span className="vlib-cap__sep" /> : null}
            {kinds.length > 1 ? kinds.map((k) => <Chip key={k.k} pill on={kind === k.k} onClick={() => { if (phase !== 'rec') setKind(k.k); }}>{k.label}</Chip>) : null}
          </div>
        </div>
        <blockquote className={cx('vlib-script', phase === 'rec' && 'is-live')}>{line.text}</blockquote>

        <div className="vlib-rec">
          {phase === 'idle' ? (
            <Btn variant="accent" size="m" icon="mic" onClick={start}>开始录音</Btn>
          ) : phase === 'rec' ? (
            <>
              <Btn variant="negative" size="m" icon="stop" onClick={stop}>停止</Btn>
              <span className="vlib-rec__time t-mono">{secs.toFixed(1)} s</span>
              <Progress value={Math.min(100, (secs / V.REC.max) * 100)} thin className="grow" />
              <span className="t-detail-xs">{secs < V.REC.min ? `还差 ${(V.REC.min - secs).toFixed(1)} 秒` : secs < V.REC.target ? '够了，念完这句就停' : '可以停了'}</span>
            </>
          ) : (
            <>
              <window.VoicePlay v={preview} tip="听一遍刚录的" />
              <span className="vlib-rec__time t-mono">{secs.toFixed(1)} s</span>
              <span className="t-detail-xs grow">{problem || '听一遍：有没有噪音、有没有念错。不满意就重录。'}</span>
              <Btn variant="secondary" size="s" icon="refresh" onClick={start}>重录</Btn>
            </>
          )}
        </div>
        {problem ? <div className="hint hint--warn">{problem}</div> : null}

        {phase === 'done' && !problem ? (
          <div className="vlib-save">
            <div className="vlib-cap__row">
              <span className="vlib-cap__lab">叫什么</span>
              <Field size="s" value={name} aria-label="音色名字" onChange={(e) => setName(e.target.value)} placeholder="我的声音" />
            </div>
            <Checkbox on={consent} onChange={setConsent} label="这是我自己的声音，或已获本人许可" />
            <div className="vlib-save__acts">
              <Btn variant="accent" size="s" disabled={!consent || !name.trim()} onClick={save}>存为音色</Btn>
              <Btn variant="secondary" size="s" onClick={onCancel}>取消</Btn>
              <span className="t-detail-xs grow">存的是这 {secs.toFixed(1)} 秒和这句台词，之后每部视频、每只能克隆的引擎都能选它。</span>
            </div>
          </div>
        ) : null}
        <p className="t-detail-xs vlib-foot">交互演示 · 没有真的开麦克风，试听放的是随包录音。</p>
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
    const [mode, setMode] = useState('list');   // list | mic | media
    const [addMenu, setAddMenu] = useState(false);
    const voices = app.voices;
    const patch = (id, p) => app.setVoices((list) => list.map((v) => (v.id === id ? {...v, ...p} : v)));
    const finish = (made) => {
      const list = Array.isArray(made) ? made : [made];
      app.addVoices(list);
      setMode('list');
      const h = app.voiceHandoff;
      if (h) {
        app.setVoiceHandoff({...h, voiceId: list[0].id});
        app.toast(list.length > 1 ? `已存 ${list.length} 只音色 · 「${list[0].name}」会带回${h.from}` : `已存「${list[0].name}」`, 'positive',
          {label: '回去用它', run: () => app.go(h.route)});
      } else {
        app.toast(list.length > 1 ? `已存 ${list.length} 只音色 · 生成语音、配音、试听里都能选` : `已存「${list[0].name}」 · 生成语音、配音、试听里都能选`, 'positive');
      }
    };
    if (mode === 'mic') return <div className="vlib"><MicCapture onDone={finish} onCancel={() => setMode('list')} /></div>;
    if (mode === 'media') return <div className="vlib"><MediaCapture onDone={finish} onCancel={() => setMode('list')} /></div>;

    const addBtn = (
      <Picker size="s" icon="plus" value="克隆新音色" open={addMenu} popWidth={280}
        onClick={() => setAddMenu((x) => !x)} onClose={() => setAddMenu(false)}>
        <Menu>
          <MenuItem icon="mic" label="用麦克风录一段" sub="照着一句台词念 5–12 秒" onClick={() => { setAddMenu(false); setMode('mic'); }} />
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
          录一段自己的声音，或从视频里取一个人的声音，存成音色。之后生成语音、克隆声音、翻译配音、试听里按名字选，
          每只能克隆的引擎都能用；参考录音留在这台电脑上。选云端引擎（ElevenLabs / MiniMax）时第一次用会先问一次，把参考段上传给它建克隆，随时可删。
        </p>
        <HandoffBar />
        {voices.length ? (
          <>
            <div className="vlib-list">
              {voices.map((v) => (
                <VoiceRow key={v.id} v={v} onPatch={(p) => patch(v.id, p)}
                  onDelete={() => { app.setVoices((list) => list.filter((x) => x.id !== v.id)); app.toast(`已删除「${v.name}」`); }}
                  onRetake={() => { if (Object.keys(v.cloud || {}).length) patch(v.id, {cloud: C.bindAfter(v, null, 'retake')}); setMode(v.source.kind === 'media' ? 'media' : 'mic'); }} />
              ))}
            </div>
            <div className="vlib-actions">{addBtn}</div>
          </>
        ) : (
          <div className="vlib-empty">
            <Empty icon="mic" title="还没有音色">录一段 5–12 秒，或从一段视频里取；存好后到处都能选。</Empty>
            <div className="vlib-empty__acts">
              <Btn variant="accent" size="s" icon="mic" onClick={() => setMode('mic')}>用麦克风录一段</Btn>
              <Btn variant="secondary" size="s" icon="upload" onClick={() => setMode('media')}>从音频或视频里取…</Btn>
            </div>
          </div>
        )}
        <div className="t-detail-xs vlib-foot vlib-foot--rule">
          一只音色 = 一段规整到 5–10 秒的参考录音 + 这段的原文 + 来源。导出的音色包（<span className="t-mono">名字.bcvoice</span>）
          带着录音与 <span className="t-mono">voice.json</span>，可以直接发给别人导入；CLI 用 <span className="t-mono">--voice my:名字</span> 选它。
          Qwen3-TTS CustomVoice 接不了参考音频，OpenAI 与 Google Gemini 的云端模型也不能克隆，选了会明说，不会偷偷换成别的声音。
          「未说明是否本人」的音色不会上传到任何第三方。
        </div>
      </div>
    );
  }

  Object.assign(window, {VoicesSection});
})();
