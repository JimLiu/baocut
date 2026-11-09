/* 设置 › 我的声音 · 云端克隆的进度与诊断（2026-11-08）。
   architecture-design §5.9：克隆是一次 voiceClone 任务（`library.createVoiceClone`），没有本人声明不上传，没有有效克隆的合成被拒。
   以前存好音色只存在本机，云端藏在 ⋯ →「上传到 X」，失败只有服务商的英文原话。现在：
   ① 采集页点「保存并上传到 X」就开始传（startVoiceClone），音色先落本机，上传在后台跑，离开这一页也接着跑；
   ② 回程条（VoiceHandoffBar）与行（VoiceCloneAlert）用 S2 InlineAlert 报同一件事：上传中（给个预期）→ 建好了 / 没建成；
   ③ 没建成是一次诊断：大白话的原因 → 照着做的办法 → 一个按钮直接去做，原话只当小字（判词在 model-voices.js cloneFailure）。
   原型里的上传是计时器，结果由演示挡位「下一次上传的结果」决定，用一次就回到「建好了」，好演示「照办法改完再传就过了」。 */
(function () {
  const {useState, useEffect} = React;
  const V = window.BC_VOICES;
  const C = window.BC_CLOUD_TTS;
  const R = window.RSP;
  const UPLOAD_MS = 3200;

  /* 模块级：离开设置页上传照样跑完。`grants` 是「同意把录音发给这家」的记录（原型只记在内存里） */
  const store = {demo: 'ok', subs: new Set(), timers: new Map(), grants: new Set(), watching: 0};
  const emit = () => store.subs.forEach((fn) => fn());
  function useCloneStore() {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      store.subs.add(fn);
      return () => { store.subs.delete(fn); };
    }, []);
    return {demo: store.demo, setDemo: (k) => { store.demo = k; emit(); }};
  }
  /** 我的声音这一页开着：结果直接画在页上；关着时结果用 toast 报 */
  function useCloneWatch() {
    useEffect(() => { store.watching += 1; return () => { store.watching -= 1; }; }, []);
  }
  const providerOf = (app, pid) => C.providerById(pid, app.cloudCustom) || {id: pid, name: pid, clone: {}};
  /* 回到模型页时滚回出发的那一行：模型页很长，落在顶上还得再找一遍。回程条记下 key，那一行挂上时取走 */
  let returnKey = null;
  const takeVoiceReturn = (key) => { if (returnKey !== key) return false; returnKey = null; return true; };

  /** 把音色 `v`（{id, name}）传给这几家建克隆：先标上传中，计时器到点按演示挡位落成建好或没建成 */
  function startVoiceClone(app, v, pids, opt) {
    const o = opt || {};
    (pids || []).forEach((pid) => {
      const key = v.id + ':' + pid;
      clearTimeout(store.timers.get(key));
      if (o.grant) store.grants.add(pid);
      const pick = V.CLONE_DEMO.find((x) => x.k === store.demo) || V.CLONE_DEMO[0];
      if (store.demo !== 'ok') { store.demo = 'ok'; emit(); }
      const error = pick.error && !(pick.error.code === 'GRANT_REQUIRED' && store.grants.has(pid)) ? pick.error : null;
      const setV = (fn) => app.setVoices((list) => list.map((x) => (x.id === v.id ? Object.assign({}, x, fn(x)) : x)));
      setV((x) => V.cloneAfter(x, pid, 'start'));
      store.timers.set(key, setTimeout(() => {
        store.timers.delete(key);
        setV((x) => (error ? V.cloneAfter(x, pid, 'fail', {error}) : V.cloneAfter(x, pid, 'ready')));
        if (store.watching) return;
        const p = providerOf(app, pid);
        if (error) {
          app.toast(`「${v.name}」没在 ${p.name} 建成 · ${V.cloneFailure(error, p).title}`, 'negative',
            {label: '看原因', run: () => app.go({r: 'settings', sec: 'voices'})});
        } else app.toast(`「${v.name}」在 ${p.name} 建好了`, 'positive');
      }, UPLOAD_MS));
    });
  }

  /* ---------- 一家的克隆状态：上传中 / 建好了 / 没建成 ----------
     `bar`：在回程条里（多一句「已存在本机」、按钮是回去）；否则在行里（按钮是「知道了」/「收起」）。
     `back` = {label, run}：回程条的回去按钮。`onAction(k)`：consent / sample / retry / grant / provider / dismiss。 */
  function VoiceCloneAlert({v, pid, onAction, bar, back}) {
    const app = useApp();
    const state = V.cloneState(v, pid);
    const p = providerOf(app, pid);
    if (!state) return null;
    const id = v.cloud && v.cloud[pid] ? v.cloud[pid].voiceId : '';
    if (state === 'uploading') {
      return (
        <R.InlineAlert variant="informative" UNSAFE_className="vclone">
          <R.Heading>{bar ? `「${v.name}」已存好，正在上传到 ${p.name}` : `正在上传到 ${p.name}`}</R.Heading>
          <R.Content>
            <span className="vclone__live">
              <R.ProgressCircle size="S" isIndeterminate aria-label={`正在上传到 ${p.name}`} />
              <span>{V.CLONE_ETA}{bar ? '。本机引擎现在就能用它；' : '；'}离开这一页也会接着传。</span>
            </span>
            {back ? <span className="vclone__acts"><Btn variant="secondary" size="s" onClick={back.run}>{back.label}</Btn></span> : null}
          </R.Content>
        </R.InlineAlert>
      );
    }
    if (state === 'ready') {
      if (!bar && !(v.cloneRun && v.cloneRun[pid])) return null;
      return (
        <R.InlineAlert variant="positive" UNSAFE_className="vclone">
          <R.Heading>{bar ? `「${v.name}」在 ${p.name} 建好了` : `在 ${p.name} 建好了`}</R.Heading>
          <R.Content>
            <span className="vclone__p">voice id <span className="t-mono">{id}</span> 记在这只音色上{bar && back ? `，${back.label}就能选它合成。` : `；用 ${p.name} 合成时选「${v.name}」就行。`}</span>
            <span className="vclone__acts">
              {back ? <Btn variant="accent" size="s" onClick={back.run}>{back.label}</Btn> : null}
              {!bar ? <Btn variant="quiet" size="s" onClick={() => onAction('dismiss')}>知道了</Btn> : null}
            </span>
          </R.Content>
        </R.InlineAlert>
      );
    }
    const run = v.cloneRun[pid];
    const d = V.cloneFailure(run.error, p);
    return (
      <R.InlineAlert variant="negative" UNSAFE_className="vclone">
        <R.Heading>{d.title}</R.Heading>
        <R.Content>
          <span className="vclone__p">{d.cause}</span>
          <ul className="vclone__advice">{d.advice.map((a) => <li key={a}>{a}</li>)}</ul>
          <span className="vclone__acts">
            <Btn variant="accent" size="s" onClick={() => onAction(d.action.k)}>{d.action.label}</Btn>
            {d.action.sub ? <span className="t-detail-xs">{d.action.sub}</span> : null}
            <span className="grow" />
            {back ? <Btn variant="quiet" size="s" onClick={back.run}>先{back.label}</Btn> : <Btn variant="quiet" size="s" onClick={() => onAction('dismiss')}>收起</Btn>}
          </span>
          {bar ? <span className="t-detail-xs vclone__note">「{v.name}」已存在这台电脑上，本机引擎照常能用；在 {p.name} 建好之前，用 {p.name} 合成时还用不了它。</span> : null}
          {d.raw ? <span className="t-detail-xs vclone__raw">{p.name} 的原话：<span className="t-mono">{d.raw}</span></span> : null}
        </R.Content>
      </R.InlineAlert>
    );
  }

  /** 回程条报的是哪只音色、哪一家：从某只云端模型过来报那一家；从别处过来报这只音色正在传的第一家 */
  function handoffCover(h, voices) {
    if (!h || !h.voiceId) return null;
    const v = (voices || []).find((x) => x.id === h.voiceId);
    if (!v) return null;
    const run = V.cloneRuns(v)[0];
    const pid = h.target && h.target.kind === 'cloud' ? h.target.id : run ? run.id : null;
    return {v, pid: pid && V.cloneState(v, pid) ? pid : null};
  }

  /* ---------- 回程条：从面板或模型页过来的 ---------- */
  function VoiceHandoffBar({onAction}) {
    const app = useApp();
    const h = app.voiceHandoff;
    if (!h) return null;
    const cover = handoffCover(h, app.voices);
    /* 模型页那一行不认领音色（它只列已绑定的），回去时顺手清掉回程，上传状态由模型页那一行自己报；
       条上已经报过「建好了」的，回去时收起，回来不在行上再报一遍 */
    const toModel = String(h.key || '').indexOf('model:') === 0;
    const leave = () => {
      if (toModel) { app.setVoiceHandoff(null); returnKey = h.key; }
      app.go(h.route);
    };
    const back = {label: `回到${h.from}`, run: () => {
      if (cover && cover.pid && V.cloneState(cover.v, cover.pid) === 'ready') onAction(cover.v, cover.pid, 'dismiss');
      leave();
    }};
    if (!h.voiceId) {
      const pname = h.target && h.target.kind === 'cloud' ? providerOf(app, h.target.id).name : '';
      /* 从选择器过来补一步（fixVoiceClone）又取消了：条上留一个回到那一步的按钮 */
      const tv = h.task && h.open ? (app.voices || []).find((x) => x.id === String(h.open).split(':')[1]) : null;
      const task = tv && pname ? {v: tv} : null;
      return (
        <R.InlineAlert variant="informative" UNSAFE_className="vlib-handoff">
          <R.Heading>从{h.from}过来</R.Heading>
          <R.Content>
            <span className="vclone__p">{h.task === 'consent' ? `补录好授权声明，就在 ${pname} 建这只音色，建好带你回去。`
              : h.task === 'sample' ? `换好样本，就在 ${pname} 建这只音色，建好带你回去。`
                : pname ? `录好样本存下，就在 ${pname} 建这只音色，建好带你回去。` : '录一段或从视频里取，存好后带你回去。'}</span>
            <span className="vclone__acts">
              {task ? <Btn variant="accent" size="s" onClick={() => onAction(task.v, h.target.id, h.task)}>{h.task === 'consent' ? '补录授权声明' : '换样本'}</Btn> : null}
              <Btn variant="quiet" size="s" onClick={() => { app.setVoiceHandoff(null); if (toModel) returnKey = h.key; app.go(h.route); }}>不了，回去</Btn>
            </span>
          </R.Content>
        </R.InlineAlert>
      );
    }
    if (!cover) return null;
    if (cover.pid) {
      return <div className="vlib-handoff"><VoiceCloneAlert v={cover.v} pid={cover.pid} bar back={back} onAction={(k) => onAction(cover.v, cover.pid, k)} /></div>;
    }
    return (
      <R.InlineAlert variant="positive" UNSAFE_className="vlib-handoff">
        <R.Heading>「{cover.v.name}」已存好</R.Heading>
        <R.Content>
          <span className="vclone__p">{back.label}，那里会直接选上这只音色。</span>
          <span className="vclone__acts"><Btn variant="accent" size="s" onClick={back.run}>回去用它</Btn></span>
        </R.Content>
      </R.InlineAlert>
    );
  }

  /* ---------- 保存前：每个模型落到哪（BC_VOICES.savePlan 的 rows） ---------- */
  function CloneLanding({rows}) {
    return (
      <div className="vlib-land">
        {rows.map((r) => (
          <div key={r.id} className="vlib-land__row">
            <span className="vlib-cap__lab">{r.name}</span>
            {r.chip ? <Chip tone={r.tone} icon="remote">{r.chip}</Chip> : null}
            <span className="t-detail-xs vlib-land__line">{r.line}</span>
          </div>
        ))}
      </div>
    );
  }

  /** 原型演示挡位（不属于产品 UI）：下一次上传的结果 */
  function CloneDemo() {
    const s = useCloneStore();
    return (
      <BCDisclosure className="import-demo" title={<> 云端克隆演示场景 </>}>
        <div className="vdemo">
          <label>下一次上传的结果
            <BCSelect aria-label="上传结果演示挡位" value={s.demo} onChange={(e) => s.setDemo(e.target.value)}>
              {V.CLONE_DEMO.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </BCSelect>
          </label>
          <span className="t-detail-xs vclone__demo">用一次就回到「建好了」：照着办法改完再传，就能看到过了的样子。</span>
        </div>
      </BCDisclosure>
    );
  }

  Object.assign(window, {startVoiceClone, VoiceCloneAlert, VoiceHandoffBar, CloneLanding, CloneDemo, useCloneWatch, voiceHandoffCover: handoffCover, takeVoiceReturn});
})();
