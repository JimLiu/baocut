/* 设置 › 音乐生成 › 「试听」（2026-10-11，YuE2 技术方案）：点行上的「试听」只展开面板，不生成。
   只挑风格（几枚芯片）、纯音乐 / 带唱二选一，固定 10 秒、少步数、不编排——试的是「这只模型 + audio.cpp 引擎能不能出声」，
   不是作品。慢是常态：面板里先写预计耗时，生成中给阶段与进度，做好了给播放与下载。
   失败与「上次检查没通过」的提醒走 BC_LOCALCHECK 同一套说法（ModelTryNote）。算法与文案在 model-music.js（BC_MUSIC）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const M = window.BC_MUSIC;
  const DEMO_WAV = 'assets/cloud-test.wav';
  const drafts = new Map();   // 模型 id → 面板状态，收起再展开不丢

  function MusicQuickTest({m, check, onCheck}) {
    const app = useApp();
    const CK = window.BC_LOCALCHECK;
    const saved = drafts.get(m.id) || {};
    const [pick, setPick] = useState(saved.pick || M.quickDefaults());
    const [result, setResult] = useState(saved.result || null);
    const [pct, setPct] = useState(-1);   // -1 = 没在生成
    const [fail, setFail] = useState(null);
    const timer = useRef(null);
    const job = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    useEffect(() => { drafts.set(m.id, {pick, result}); }, [pick, result]);

    const form = M.quickForm(pick, m.id);
    const key = M.quickKey(form);
    const stale = !!result && result.key !== key;
    const busy = pct >= 0;
    useEffect(() => { setFail(null); }, [key]);

    const run = () => {
      const bad = M.validate(form);
      if (bad) { setFail({kind: 'invalid', msg: bad}); return; }
      setFail(null);
      // 结果由原型开关「下次试听的结果」决定（shell.jsx TweaksPanel）；录音读不出只属语音合成，这里按成功算
      job.current = {form, pick, t0: Date.now(), outcome: CK.tryOutcome(app.prefs.modelTryDemo, false, 'music')};
      setPct(0);
      clearInterval(timer.current);
      timer.current = setInterval(() => setPct((x) => {
        const n = Math.min(100, x + 2);
        if (n >= 100) clearInterval(timer.current);
        return n;
      }), 60);
    };
    useEffect(() => {
      const j = job.current;
      if (!j) return;
      const failAt = j.outcome === 'ok' ? 101 : 55;
      if (pct >= failAt) {
        clearInterval(timer.current);
        job.current = null;
        setPct(-1);
        setFail({kind: j.outcome});
        return;
      }
      if (pct < 100) return;
      job.current = null;
      setPct(-1);
      setResult({key: M.quickKey(j.form), summary: M.quickSummary(j.pick, (Date.now() - j.t0) / 1000 * 12), at: Date.now()});
    }, [pct]);

    const choose = (patch) => { if (!busy) setPick(Object.assign({}, pick, patch)); };
    const onNote = (k) => {
      if (k === 'retry') run();
      else if (onCheck) { setFail(null); onCheck(k); }
    };
    const notice = CK.tryNotice(check, 'music', result && result.at);
    const failView = fail ? CK.tryFailure(fail.kind, 'music', fail) : null;

    return (
      <div className="ttst">
        {notice ? <window.ModelTryNote view={notice} onAction={onNote} /> : null}
        <div className="ttst__row">
          <span className="ttst__lab">风格</span>
          <div className="ttst__chips">
            {M.STYLES.map((s) => (
              <Chip key={s.k} pill on={pick.style === s.k} title={s.style} onClick={() => choose({style: s.k})}>{s.label}</Chip>
            ))}
          </div>
        </div>
        <div className="ttst__row">
          <span className="ttst__lab">形式</span>
          <div className="ttst__chips">
            {M.MODES.map((x) => (
              <Chip key={x.k} pill on={(pick.mode || 'instrumental') === x.k} title={x.desc} onClick={() => choose({mode: x.k})}>{x.label}</Chip>
            ))}
          </div>
        </div>
        <p className="ttst__note t-detail-xs">
          试听固定 {M.QUICK.seconds} 秒、{M.QUICK.steps} 步、不先编排，只看这只模型和它的引擎能不能出声；{M.etaText(M.QUICK.seconds, {planning: 'off'})}。
          {pick.mode === 'song' ? ' 带唱的歌用一句自带的示例歌词。' : ''}要正式做配乐去工具 › 生成音乐。
        </p>

        <div className="ttst__go">
          {busy ? (
            <div className="ttst__busy">
              <span className="t-detail-xs">正在生成 · {M.phase(pct, form)} · {pct}%</span>
              <Progress value={pct} thin />
            </div>
          ) : result && !stale ? (
            <Btn variant="secondary" size="s" icon="refresh" onClick={run}>再生成一次</Btn>
          ) : (
            <Btn variant="accent" size="s" icon="play" onClick={run}>生成试听</Btn>
          )}
          {busy ? <Btn variant="quiet" size="s" onClick={() => { clearInterval(timer.current); job.current = null; setPct(-1); }}>取消</Btn> : null}
        </div>
        {failView ? <window.ModelTryNote view={failView} onAction={onNote} className="ttst__fail" /> : null}

        {result ? (
          <div className={'ttst__out' + (stale ? ' is-stale' : '')}>
            <div className="ttst__row">
              <span className="t-detail-xs grow">{stale ? '上一次 · ' : ''}{result.summary}</span>
              <RSP.LinkButton variant="secondary" size="S" href={DEMO_WAV} download="music-preview-demo.wav">下载</RSP.LinkButton>
            </div>
            <audio controls preload="metadata" src={DEMO_WAV} aria-label="试听结果" />
            {stale ? <p className="t-detail-xs">这段是上一次的选择生成的；换了风格或形式后，点「生成试听」听新的。</p> : null}
            <p className="t-detail-xs">交互演示 · 播放的是示例音频，真实生成在桌面 App。</p>
          </div>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {MusicQuickTest});
})();
