/* 设置 › 我的声音 › 克隆新音色 · 一段录音（2026-11-08 从 settings-voice-capture.jsx 拆出，加音质自查与同一只麦克风）。
   麦克风或上传二选一；录音中电平旁边一行当场提示（爆音、没声音、太小声、太吵），停下或选好文件后一句判词 + 具体办法；
   保存那一步上传按钮上面再提醒一次（只说会让对方认不准的：爆音、底噪、两段不是同一只麦克风），不拦。
   麦克风由父级（VoiceCapture）统一拿着，授权声明默认用录样本的那只；门槛与判词都在 model-voice-take.js。
   原型没有真麦克风：录音是按演示挡位合成的 PCM（BC_VOICE_TAKE.demoTake），读数与判词照真的算。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = window.BC_VOICES;
  const T = window.BC_VOICE_TAKE;
  const R = window.RSP;
  const SR = 8000;

  /** 演示用的两只麦克风；第一只是默认 */
  const MICS = [
    {id: 'builtin', label: 'MacBook Pro 麦克风'},
    {id: 'airpods', label: 'AirPods Pro', sub: '蓝牙耳机会压低音质，能用内置就用内置'},
  ];
  const micLabel = (id) => (MICS.find((m) => m.id === id) || MICS[0]).label;

  /* 演示挡位：下一段录音（或选的文件）的音质。用一次就回到「干净」：照着办法重录，就能看到过了的样子 */
  const demo = {kind: 'clean', subs: new Set()};
  const emit = () => demo.subs.forEach((fn) => fn());
  function useTakeDemo() {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      demo.subs.add(fn);
      return () => { demo.subs.delete(fn); };
    }, []);
    return {kind: demo.kind, setKind: (k) => { demo.kind = k; emit(); }};
  }
  const takeDemoKind = () => demo.kind;
  const takeDemoUsed = () => { if (demo.kind !== 'clean') { demo.kind = 'clean'; emit(); } };

  const concat = (chunks) => {
    const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    chunks.forEach((c) => { out.set(c, at); at += c.length; });
    return out;
  };
  /** 电平条：一帧的峰值按对数压一下（与 packages/ui 的 meterLevel 同一个式子） */
  const meterOf = (chunk) => {
    let peak = 0;
    for (let i = 0; i < chunk.length; i++) peak = Math.max(peak, Math.abs(chunk[i]));
    return peak > 0 ? Math.max(0, Math.min(1, 1 + Math.log10(peak) / 2)) : 0;
  };

  const clock = (s) => {
    const n = Math.max(0, +s || 0);
    const m = Math.floor(n / 60);
    const sec = n - m * 60;
    return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`;
  };

  function Meter({level, on}) {
    const bars = Array.from({length: 14}, (_, i) => i);
    return (
      <span className={cx('vlib-meter', on && 'is-on')} aria-hidden="true">
        {bars.map((i) => <i key={i} className={cx(level * 14 > i && 'is-lit')} />)}
      </span>
    );
  }

  /** 电平下面那一行：录音中是当场提示（`live`），停下后是判词（`analysis`）。一直占着一行，开录、停下时下面的东西不跳 */
  function TakeLine({live, analysis}) {
    if (live) {
      return (
        <div className={cx('vlib-take', 'is-' + live.tone)} role="status" aria-live="polite">
          {live.tone === 'notice' ? <Ic n="alert" className="ic--14" /> : live.tone === 'positive' ? <Ic n="check" className="ic--14" /> : <Ic n="mic" className="ic--14" />}
          <span>{live.text}</span>
        </div>
      );
    }
    if (!analysis) return null;
    const v = T.takeVerdict(analysis);
    return (
      <div className={cx('vlib-take', 'is-' + v.tone)}>
        <Ic n={v.tone === 'notice' ? 'alert' : 'check'} className="ic--14" />
        <span><b>{v.title}</b> · {v.fix}</span>
      </div>
    );
  }

  /* ---------- 一段录音：麦克风 / 上传 ----------
     `spec` = {min, target, max, countdown?}；有 `countdown` 的（样本）不显示「/ 上限」、进度条按目标填满，
     那一句由 BC_VOICES.liveHint 给；`demo` = {file, dur, name} 是上传那条路在原型里假装选中的文件；
     停下或选好文件后 `onClip({dur, file, via, name, mic, analysis})`，重录 / 换文件时 `onClip(null)`。
     `clip` 是父级已经拿着的那段（上一步 / 下一步回来时照它恢复，不然计时器回到 00:00 而下一步却亮着）。
     `mic` / `onMic`：父级拿着的麦克风（不给就自己记）。`sample` 是已经录好的样本（授权声明这一步给）：菜单里标出录它的那只，
     换了别的就在下面提醒，`needed` 是要核对两段的提供方名字。 */
  function ClipRecorder({spec, demo: file0, label, onClip, hint, clip, mic: micProp, onMic, sample, needed}) {
    const [via, setVia] = useState(clip ? clip.via : 'mic');
    const [phase, setPhase] = useState(clip ? 'done' : 'idle');     // idle | rec | done
    const [secs, setSecs] = useState(clip ? clip.dur : 0);
    const [level, setLevel] = useState(0);
    const [live, setLive] = useState(null);
    const [dev, setDev] = useState(false);
    const [ownMic, setOwnMic] = useState(MICS[0].id);
    const mic = micProp || ownMic;
    const setMic = onMic || setOwnMic;
    const [file, setFile] = useState(clip && clip.via === 'upload' ? {name: clip.name, dur: clip.dur} : null);
    const sampleMic = sample && sample.via === 'mic' ? sample.mic : null;
    const timer = useRef(null);
    const take = useRef(null);
    const fileInput = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    const finish = () => {
      clearInterval(timer.current); timer.current = null;
      const r = take.current;
      const analysis = T.analyzeTake(concat(r.chunks), SR);
      takeDemoUsed();
      setPhase('done'); setLevel(0); setLive(null);
      onClip({dur: +r.t.toFixed(1), file: file0.file, via: 'mic', mic: r.mic, analysis});
    };
    const start = () => {
      take.current = {kind: takeDemoKind(), mic, chunks: [], t: 0, heard: false, noise: null};
      setSecs(0); setPhase('rec'); setLive(T.liveTakeHint({seconds: 0, heard: false, noiseFloorDb: null, recent: null})); onClip(null);
      timer.current = setInterval(() => {
        const r = take.current;
        const n = +(r.t + 0.1).toFixed(1);
        const chunk = T.demoTake(r.kind, r.t, n, SR);
        r.t = n;
        r.chunks.push(chunk);
        if (!r.heard) r.heard = T.analyzeTake(chunk, SR).silenceRatio < 1;
        if (r.noise == null && n >= T.TAKE.noiseWindow) r.noise = T.analyzeTake(concat(r.chunks), SR).noiseFloorDb;
        const recent = T.analyzeTake(concat(r.chunks.slice(-Math.round(T.TAKE.liveWindow * 10))), SR);
        setSecs(n);
        setLevel(meterOf(chunk));
        setLive(T.liveTakeHint({seconds: n, heard: r.heard, noiseFloorDb: r.noise, recent}));
        if (n >= spec.max) finish();
      }, 100);
    };
    const switchVia = (k) => {
      if (phase === 'rec') return;
      setVia(k); setPhase('idle'); setSecs(0); setFile(null); onClip(null);
    };
    const pickFile = (f) => {
      const picked = {name: f ? f.name : file0.name, dur: file0.dur};
      const dur = +Math.min(spec.max, picked.dur).toFixed(1);
      const analysis = T.analyzeTake(T.demoTake(takeDemoKind(), 0, dur, SR), SR);
      takeDemoUsed();
      setFile(picked);
      onClip({dur, file: file0.file, via: 'upload', name: picked.name, mic: null, analysis});
    };
    const liveNote = V.liveHint(secs, spec);
    const total = spec.countdown ? '' : ` / ${clock(spec.max)}`;
    const maxLabel = V.secLabel(spec.max);
    return (
      <div className="vlib-clip">
        <div className="vlib-cap__row">
          <span className="vlib-cap__lab">{label || '怎么给'}</span>
          <Segmented size="s" value={via} onChange={switchVia}
            items={[{k: 'mic', label: '用麦克风录', icon: 'mic'}, {k: 'upload', label: '上传一段', icon: 'upload'}]} />
          {via === 'mic' ? (
            <>
              <Picker size="s" icon="mic" value={micLabel(mic)} open={dev} popWidth={260} disabled={phase === 'rec'}
                onClick={() => setDev((x) => !x)} onClose={() => setDev(false)}>
                <Menu>
                  {MICS.map((m) => (
                    <MenuItem key={m.id} label={m.label} on={mic === m.id}
                      sub={sampleMic && m.id === sampleMic ? '录样本用的这只' : m.sub}
                      onClick={() => { setDev(false); setMic(m.id); }} />
                  ))}
                </Menu>
              </Picker>
              <Meter level={level} on={phase === 'rec'} />
            </>
          ) : null}
        </div>
        {via === 'mic' ? (
          <>
            <div className="vlib-rec">
              {phase === 'idle' ? (
                <>
                  <Btn variant="accent" size="m" icon="mic" onClick={start}>开始录音</Btn>
                  <span className="vlib-rec__big t-mono">{clock(0)}{total}</span>
                  <span className="t-detail-xs grow">{hint}</span>
                </>
              ) : phase === 'rec' ? (
                <>
                  <Btn variant="negative" size="m" icon="stop" onClick={finish}>停止</Btn>
                  <span className="vlib-rec__big t-mono is-live" role="timer" aria-live="off">{clock(secs)}{total}</span>
                  <Progress value={liveNote.pct} thin className="grow" label="录音进度" />
                  <span className={cx('t-detail-xs vlib-rec__left', spec.countdown && spec.max - secs <= spec.countdown && 'is-ending')}>{liveNote.text}</span>
                </>
              ) : (
                <>
                  <window.VoicePlay v={{file: file0.file}} tip="听一遍刚录的" />
                  <span className="vlib-rec__big t-mono">{clock(secs)}</span>
                  <span className="t-detail-xs grow">{secs >= spec.max ? `到 ${maxLabel}自动停了 · 听一遍，不满意就重录` : hint || '听一遍：有没有噪音、有没有念错。不满意就重录。'}</span>
                  <Btn variant="secondary" size="s" icon="refresh" onClick={start}>重录</Btn>
                </>
              )}
            </div>
            <TakeLine live={phase === 'rec' ? live : null} analysis={phase === 'done' && clip ? clip.analysis : null} />
            {sample ? <MicMismatch sample={sample} clip={clip} mic={mic} onMic={setMic} needed={needed} busy={phase === 'rec'} /> : null}
          </>
        ) : (
          <>
            <div className="vlib-drop vlib-drop--tight" onClick={() => fileInput.current.click()} role="button" tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current.click(); } }}>
              <Ic n="upload" className="ic--26" />
              {file ? <b>{file.name}</b> : <b>拖一个音频文件到这里，或点一下选</b>}
              <span className="t-detail-xs">
                {file
                  ? `${V.fmtTime(file.dur)}${file.dur > spec.max ? ` · 超过 ${maxLabel}，会取前 ${maxLabel}` : ''} · 一个人说话、没有音乐`
                  : `WAV / MP3 / M4A / FLAC · ${spec.min} 秒起，${V.secLabel(spec.target)}最好${spec.countdown ? `，最长 ${maxLabel}` : ''} · 一个人说话、没有音乐`}
              </span>
            </div>
            <input ref={fileInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; pickFile(f || null); }} />
            {file ? (
              <>
                <div className="vlib-rec">
                  <window.VoicePlay v={{file: file0.file}} tip="听一遍" />
                  <span className="vlib-rec__big t-mono">{clock(Math.min(spec.max, file.dur))}</span>
                  <span className="t-detail-xs grow">{hint}</span>
                  <Btn variant="secondary" size="s" icon="refresh" onClick={() => { setFile(null); onClip(null); }}>换一个</Btn>
                </div>
                <TakeLine analysis={clip ? clip.analysis : null} />
              </>
            ) : <BCAction className="viewall vlib-demo" onClick={() => pickFile(null)}>用示例文件试试（{file0.name}）</BCAction>}
          </>
        )}
      </div>
    );
  }

  /** 授权声明这一步：麦克风和录样本的不是同一只。没在录就给「换回」；录好了说重录 */
  function MicMismatch({sample, clip, mic, onMic, needed, busy}) {
    const m = T.micMismatch(sample, clip, mic);
    if (!m) return null;
    const who = needed && needed.length ? needed.join(' / ') : 'Google Gemini';
    return (
      <div className="hint hint--warn vlib-takewarn">
        <span className="grow">
          样本是用「{micLabel(m.sample)}」录的，{clip ? '这段用' : '现在选'}的是「{micLabel(m.used)}」。换一只麦克风，{who} 可能认不出两段是同一个人{clip ? '，换回来重录一遍更稳' : ''}。
        </span>
        {!busy && mic !== m.sample ? <Btn variant="secondary" size="s" icon="mic" onClick={() => onMic(m.sample)}>换回 {micLabel(m.sample)}</Btn> : null}
      </div>
    );
  }

  /** 保存那一步、上传按钮上面：两段录音有会让对方认不准的毛病就提醒一次，不拦。`clips` = {sample, consent}；
   *  `uploadTo` 是这次要传的提供方名字；`onRedo(step)` 回到那一步重录 */
  function SaveTakeWarning({clips, uploadTo, onRedo}) {
    const text = T.saveWarningText(T.saveTakeWarnings(clips), uploadTo);
    if (!text) return null;
    const name = {sample: '重录样本', consent: '重录授权声明'};
    return (
      <R.InlineAlert variant="notice" UNSAFE_className="vclone">
        <R.Heading>{text.title}</R.Heading>
        <R.Content>
          <ul className="vclone__advice">{text.items.map((t) => <li key={t}>{t}</li>)}</ul>
          <span className="vclone__p">{text.body}</span>
          {onRedo ? (
            <span className="vclone__acts">
              {text.redo.map((k) => <Btn key={k} variant="secondary" size="s" icon="refresh" onClick={() => onRedo(k)}>{name[k]}</Btn>)}
            </span>
          ) : null}
        </R.Content>
      </R.InlineAlert>
    );
  }

  /** 原型演示挡位（不属于产品 UI）：下一段录音的音质 */
  function TakeDemo() {
    const s = useTakeDemo();
    return (
      <BCDisclosure className="import-demo" title={<> 录音音质演示场景 </>}>
        <div className="vdemo">
          <label>下一段录音的音质
            <BCSelect aria-label="录音音质演示挡位" value={s.kind} onChange={(e) => s.setKind(e.target.value)}>
              {T.TAKE_DEMO.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </BCSelect>
          </label>
          <span className="t-detail-xs vclone__demo">录音与上传都按它合成；用一次就回到「干净」：照着办法重录，就能看到过了的样子。</span>
        </div>
      </BCDisclosure>
    );
  }

  Object.assign(window, {VoiceClipRecorder: ClipRecorder, VoiceSaveTakeWarning: SaveTakeWarning, VoiceTakeDemo: TakeDemo,
    VoiceMeter: Meter, VOICE_MICS: MICS});
})();
