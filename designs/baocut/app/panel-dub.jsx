/* 翻译配音 —— §15.6（2026-09-16 改版）。**家在 AI 工具**：唯一的启动入口是 AI 工具列表；音频 Tab
   只放产物（配音组）与一行指路，配音轨块右键「改译文并重配」、行头「重新生成失败 / 过快的句」、
   配音组菜单「重新配这种语言」都是带着范围回到这一页。
   骨架与其他 AI 工具相同（§15.1）：设置（panel-dub-setup.jsx）→（下载模型）→（翻译）→（时长对比，panel-dub-fit.jsx）
   →（注音，panel-dub-readings.jsx：只在配成中文且开着「合成前标注多音字」时）→ 过程（阶段条 + **逐句列表**：做完的、正在念的、排队的，失败的当场标红）→ 收据；头部一条步骤条
   （ui.jsx `Steps`）按这次要走的步数画，开始后就固定，不随中途的设置变。
   模型没装不是门：主按钮写「下载模型并…」，按下先下载再接着走（下载不是任务，§17.3）。
   `scope`（{lang, ids}）不为空就是**只重配这几句**：语言与引擎锁定为那条配音原来的，取向 / 声音 /
   时长策略可改；开始时把这几句在轨上标成「排队」，做完按句写回同一条轨，收据能撤回这几句。
   整条配音跑完写进时间轴：一种语言**一条**「配音」轨（`dub:<lang>`）与一条「背景声」轨；原声按选择
   静音或压低——收据的撤销把两条轨一起拿掉并恢复原声。多种语言的配音能并存，一次只听一种。
   克隆参考：每位说话人取连续几整句、5–10 秒连同原文当参考，全程同一段同一颗种子。
   失败是按句的：坏了几句就列几句，逐句重试、一键重试，或连过快的句一起交给「重新生成」。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const RD = window.BC_READINGS;
  const T = window.BC_TIME;

  const STATE_LABEL = {done: '已合成', running: '正在念', queued: '排队', failed: '没合成出来'};

  /** 逐句过程：正在念的那句居中，前几句已合成、后几句排队；失败的当场标红 */
  function RunLog({cues, pct, failed, separate}) {
    const log = DUB.runLog(cues, pct, {failed, separate});
    const head = log.stage === 'before' ? '还没轮到合成' : log.stage === 'synth' ? `正在念第 ${log.cur + 1}/${log.total} 句` : `${log.total} 句都念完了`;
    const bad = Object.keys(failed || {}).filter((id) => cues.some((c, i) => c.id === id && i < log.cur)).length;
    return (
      <div className="runlog">
        <div className="runlog__hd">
          <b>{head}</b>
          <span className="t-detail-xs">{log.done} 句已合成{bad ? ` · ${bad} 句失败，最后一并列出` : ''}</span>
        </div>
        {log.items.map((it) => {
          const sp = D.speakers[(cues[it.i] || {}).sp] || {};
          return (
            <div key={it.id} className={cx('runlog__i', 'is-' + it.state)}>
              <span className="t-mono t-detail-xs">{T.timecode(it.start, {decimals: 0})}</span>
              <span className="spkdot" style={{background: `oklch(0.6 0.14 ${sp.hue || 222})`}} />
              <span className="t-truncate grow">{it.text}</span>
              <span className="runlog__st">{STATE_LABEL[it.state]}</span>
            </div>
          );
        })}
        {log.stage === 'before' ? <div className="hint hint--tight">先翻译 / 分离人声，轮到合成时这里逐句滚动。</div> : null}
      </div>
    );
  }

  function DubFlow({ctx, onBack, scope, landed}) {
    const app = useApp();
    const {useAiTask, fakeRun, Job, UNDO_BODY} = window.BC_AIFLOWS;
    const langs = (ctx.subStyle.tracks || []).filter((t) => t.role === 'translation');
    const allCues = ctx.cues || [];
    /* 只重配几句：`lock` 记范围，那条配音还在才算锁住；「改为整条重配」把锁解掉 */
    const [lock, setLock] = useState(() => (scope && scope.lang && scope.ids && scope.ids.length ? scope : null));
    const prev = lock ? (ctx.dubs || []).find((d) => d.lang === lock.lang) || null : null;
    const locked = !!(lock && prev);
    const cues = locked ? allCues.filter((c) => lock.ids.indexOf(c.id) >= 0) : allCues;
    const spIds = Object.keys(D.speakers).filter((id) => cues.some((c) => c.sp === id));
    const countOf = (id) => cues.filter((c) => c.sp === id).length;

    const codes = window.BC_LANGUAGES.languages.map((l) => l.code);
    const translated = langs.map((t) => t.id);
    /* 能配的语言 = 所有本地引擎会念的语言之并；引擎按语言 × 取向自动选 */
    const only = codes.filter((c) => TTS.ENGINES.some((e) => TTS.ttsLangs(e.id, [c], D.srcLang.code).length));
    const [r, setR] = useState(() => {
      const priority = (prev && prev.priority) || 'voice';
      const lang = prev ? prev.lang : TTS.fallbackLang(langs[0] ? langs[0].id : '', only, translated);
      const id = (app.prefs.localModelDefaults || {}).tts;
      const chosen = window.BC_TOOLS.preferredForm(app.modelInstalled, id);
      const localDefault = id && app.modelInstalled(id) && TTS.engineSpeaks(chosen.engine, lang) ? chosen.engine : null;
      const engine = prev ? prev.engine : localDefault || DUB.pickEngine({lang, priority, installed: app.modelInstalled}).engine;
      return {
        lang, engine, engineAuto: !prev && !localDefault, priority,
        node: null,                                     // 在哪儿跑：null 是本机，否则是已配对节点的 id
        presets: (prev && prev.presets) || DUB.assignPresets(engine, lang, spIds),
        ref: null, separate: prev ? prev.bed !== false : true, fit: (prev && prev.fit) || 'compress',
        original: prev ? prev.original : 'mute', review: !prev,
        readings: true,                                 // 合成前标注多音字（只对要注音的语言有意义）
        llm: (D.transModels.find((m) => m.dflt) || D.transModels[0]).id,   // 翻译与整理译文用的云端模型
        style: (prev && prev.style) || '', emotion: (prev && prev.emotion) || 'follow',
      };
    });
    /* 换语言或取向：引擎是自动选的就按新答案重选（已装的优先）；手动选的只在它不会念新语言时才换。
       换语言或引擎时，「发音标准优先」的预设按新的母语表重新分配。 */
    const set = (p) => setR((s) => {
      const n = {...s, ...p};
      const asked = (p.lang && p.lang !== s.lang) || (p.priority && p.priority !== s.priority);
      if (asked && !locked && (n.engineAuto || !TTS.engineSpeaks(n.engine, n.lang))) {
        n.engine = DUB.pickEngine({lang: n.lang, priority: n.priority, installed: app.modelInstalled}).engine;
        n.engineAuto = true;
      }
      const moved = n.lang !== s.lang || n.engine !== s.engine;
      if (moved && n.priority === 'accent') n.presets = DUB.assignPresets(n.engine, n.lang, spIds);
      return n;
    });
    const [phase, setPhase] = useState('setup');      // setup | download | translate | compare | readings | run | done
    const stepsRef = useRef(null);                   // 开始后固定的步骤表，见 stepItems
    const [pct, setPct] = useState(0);
    const [script, setScript] = useState({});        // 整理过的配音稿（稀疏：只有改过的句）
    const [res, setRes] = useState(null);             // {blocks, elapsed, ...}
    const [retrying, setRetrying] = useState({});
    const [rdOpen, setRdOpen] = useState(false);     // 收据「注音」一行点开：哪几处引擎没按注音念
    const resRef = useRef(null); resRef.current = res;
    const failedRef = useRef({});                    // 这一次运行里演示的失败句
    const ai = useAiTask();
    const timer = useRef(null);
    const t0 = useRef(0);
    useEffect(() => () => clearInterval(timer.current), []);

    const track = langs.find((l) => l.id === r.lang) || null;
    const cat = window.BC_LANGUAGES.languages.find((l) => l.code === r.lang) || null;
    const langName = track ? track.name : cat ? cat.native : r.lang;
    const engName = (TTS.ENGINES.find((e) => e.id === r.engine) || {}).name || '';
    const engFamily = TTS.engineFamily(r.engine);    // 组头与重新生成的 sub / 回执：两只 Qwen3 都写 Qwen3-TTS
    const pickEngine = (k) => set({engine: k, engineAuto: false});
    const pickNode = (id) => set({node: id});
    const pickPriority = (p) => set({priority: p});
    const ln = /^[A-Za-z]/.test(langName) ? ' ' + langName : langName;   // 中英之间留一格
    const needTranslate = !track && !locked;
    const speaks = TTS.engineSpeaks(r.engine, r.lang);
    const strategy = DUB.strategyOf(r.priority, r.engine, r.lang);
    const ttsModel = TTS.modelFor(r.engine, strategy === 'preset' ? strategy : 'clone');
    const pace = TTS.paceFor(app.ttsPace, ttsModel, r.lang);
    const plan = needTranslate ? null : TTS.fitPlan(cues, {pace, lang: r.lang, script});
    /* 在哪儿跑：候选是此刻报得出这只模型的在线节点。选中的机器掉线、重扫后
       没了、或者换过引擎时 `nodeOn` 变 null，视图与开跑一起回落本机。跑在别人机器上
       就不查本机装没装——权重在那边，TTS 那只从模型门里让开；那台机器也开放人声分离时
       分离一并交过去（`sepRemote`，HTDemucs 也让开），否则分离留本机、照算。 */
    const peers = DUB.dubNodes(D.remote.paired, ttsModel);
    const nodeOn = r.node && DUB.nodeRunsModel(D.remote.paired, r.node, ttsModel) ? r.node : null;
    const nodeName = nodeOn ? (D.remote.paired.find((n) => n.id === nodeOn) || {}).name : null;
    const sepRemote = DUB.nodeSeparates(D.remote.paired, nodeOn);
    const missing = DUB.missingModels(r,
      {installed: app.modelInstalled, catalog: D.setModels, locked, remote: !!nodeOn, remoteSeparate: sepRemote});
    const alt = missing.list.length ? DUB.installedAlternative(r, app.modelInstalled) : null;
    const problem = DUB.startProblem(r, {count: cues.length, langName});
    const step = DUB.stepLine(r, {count: cues.length, speakers: spIds.length, langName, ln, needTranslate, locked});
    const cta = DUB.ctaLabel({locked, count: cues.length, ln, langName, needTranslate, review: r.review, download: !!missing.list.length});
    const llm = D.transModels.find((m) => m.id === r.llm) || D.transModels[0];
    const wantReadings = RD.needsReadings(r.lang) && r.readings !== false;
    const llmNeeded = needTranslate || r.review || wantReadings;
    const separate = locked ? false : r.separate;
    const stages = TTS.dubStages({separate});
    const ph = TTS.dubPhase(pct, {sentences: cues.length, duration: ctx.duration, separate, langName, sepAt: separate && sepRemote ? nodeName : null,
      speakerAt: (i) => (D.speakers[(cues[i] || {}).sp] || {}).name || ''});

    const elapsedOf = () => {
      const ms = Date.now() - t0.current;
      return ms >= 60000 ? `${Math.floor(ms / 60000)} 分 ${Math.round((ms % 60000) / 1000)} 秒` : `${(ms / 1000).toFixed(1)} 秒`;
    };
    const applyResult = (blocks) => {
      const d = {lang: r.lang, langName, engine: r.engine, engineName: engFamily, strategy, priority: r.priority, presets: r.presets,
        fit: r.fit, style: r.style, emotion: r.emotion, blocks, bed: r.separate, original: r.original,
        trackId: TTS.dubTrackId(r.lang), script};
      ctx.applyDub(d);
      return d;
    };

    /* Agent 在会话里配完了（landed）：这种语言的配音已经在时间轴上就直接看它，没有就按这一页的缺省写进去，
       落在完成页（时长对比与逐句处理都在这里）。 */
    useEffect(() => {
      if (!landed || locked) return;
      const had = (ctx.dubs || []).find((d) => d.lang === r.lang);
      const blocks = had ? had.blocks : TTS.dubBlocks(cues, {speakerOrder: spIds, failed: {}, fit: r.fit, script, engine: r.engine});
      if (!had) applyResult(blocks);
      setRes({blocks, elapsed: '31.4 秒', separate: r.separate, engine: r.engine});
      setPhase('done');
    }, [landed]);

    /* 整条：没译文先翻 → 要对比就进对比页 → 合成；写入时间轴 */
    const runWhole = (sc) => {
      setPhase('run'); t0.current = Date.now();
      failedRef.current = TTS.demoFailures(cues);
      const tid = ai.begin({
        kind: 'dub', flow: 'dub', project: ctx.proj.id,
        title: `翻译配音 · ${ctx.proj.title}`, sub: TTS.dubSub({...r, strategy}, langName), phase: '翻译配音',
        cancellable: true, undoBody: UNDO_BODY.dub,
      });
      const done = () => {
        const elapsed = elapsedOf();
        const blocks = TTS.dubBlocks(cues, {speakerOrder: spIds, failed: failedRef.current, fit: r.fit, script: sc, engine: r.engine});
        applyResult(blocks);
        // 语速库：这一轮实测「字数 / 合成秒数」记一次（产品里写 tts-pace.json）
        const ok = blocks.filter((b) => b.status !== 'failed');
        app.bumpPace(ttsModel, r.lang, {units: ok.reduce((n, b) => n + TTS.countUnits(b.text, r.lang), 0), seconds: ok.reduce((n, b) => n + b.synth, 0)});
        ai.finish(tid, {undoable: true});
        setRes({blocks, elapsed, separate: r.separate, engine: r.engine});
        setPhase('done');
        const bad = TTS.failedOf(blocks).length, fast = TTS.fastOf(blocks).length;
        app.toast(`配音已写进「配音 · ${langName}」轨 · ${bad ? bad + ' 句没合成出来' : '全部 ' + blocks.length + ' 句'}${fast ? ' · ' + fast + ' 句过快' : ''}`,
          bad || fast ? 'notice' : 'positive');
      };
      fakeRun(timer, (p) => { setPct(p); ai.progress(tid, p); }, 1, 55, done);
    };
    /* 只重配几句：轨上先标「排队」，做完按句写回同一条轨，其余句子不动 */
    const runScoped = (sc) => {
      const ids = lock.ids, prevBlocks = prev.blocks, prevScript = prev.script || {};
      setPhase('run'); t0.current = Date.now();
      failedRef.current = {};
      ctx.updateDub(lock.lang, {blocks: DUB.queueRegen(prevBlocks, ids)});
      const tid = ai.begin({
        kind: 'dub', flow: 'dub', project: ctx.proj.id,
        title: `重新生成 ${ids.length} 句 · ${ctx.proj.title}`, sub: `配音 · ${langName} · ${engFamily}`, phase: '翻译配音',
        cancellable: true, undoBody: '这几句退回重新生成前的版本，其余句子不受影响。',
      });
      fakeRun(timer, (p) => { setPct(p); ai.progress(tid, p); }, 2, 45, () => {
        const elapsed = elapsedOf();
        const merged = {...prevScript, ...sc};
        const blocks = DUB.regenerate(prevBlocks, ids, {fit: r.fit, script: merged, group: prev, take: {model: ttsModel, engine: r.engine}});
        ctx.updateDub(lock.lang, {blocks, script: merged, priority: r.priority, presets: r.presets, fit: r.fit, style: r.style, emotion: r.emotion});
        ai.finish(tid, {undoable: true});
        setRes({blocks, elapsed, separate: false, engine: r.engine, regen: {ids, prevBlocks, prevScript}});
        setPhase('done');
        app.toast(`已重新生成 ${ids.length} 句 · 写回「配音 · ${langName}」轨`, 'positive');
      });
    };
    const runDub = (sc) => (locked ? runScoped(sc) : runWhole(sc));
    /* 注音在对比时长之后、生成之前：要注音就先停在注音页，采用后带着注记的配音稿接着合成 */
    const toRun = (sc) => { if (wantReadings) { setScript(sc); setPhase('readings'); } else runDub(sc); };
    const afterTranslate = () => { if (r.review) setPhase('compare'); else toRun(script); };
    const afterModels = () => {
      if (!needTranslate) { afterTranslate(); return; }
      setPhase('translate'); setPct(0);
      fakeRun(timer, setPct, 2, 40, afterTranslate);
    };
    /* 开始：有阻碍就 toast 那一句（按钮永远不置灰，§15.2）；模型没装先下载，装好自动接着走 */
    const start = () => {
      if (problem) { app.toast(problem, 'notice'); return; }
      stepsRef.current = stepItems(!!missing.list.length);
      if (missing.list.length) {
        // 缺的里有不许商用的权重（OmniVoice）：先弹一次「许可」确认，确认了才开下（panel-tts-local.jsx）
        window.withModelLicense(app, missing.ids, () => {
          dlRef.current = missing.ids;
          missing.ids.forEach((id) => app.downloadModel(id));
          setPhase('download');
        });
        return;
      }
      afterModels();
    };
    const dlRef = useRef([]);
    useEffect(() => {
      if (phase !== 'download') return;
      if (dlRef.current.every((id) => app.modelInstalled(id))) afterModels();
    }, [phase, app.modelInstalled]);   // eslint-disable-line react-hooks/exhaustive-deps
    const dlPct = phase === 'download' && dlRef.current.length
      ? Math.round(dlRef.current.reduce((n, id) => n + (app.modelInstalled(id) ? 100 : app.modelDl[id] || 0), 0) / dlRef.current.length) : 0;
    const dlCur = dlRef.current.findIndex((id) => !app.modelInstalled(id));
    const dlName = (id) => (D.setModels.find((m) => m.id === id) || {name: id}).name;
    /* 步骤条：这次要走几步就画几步；开始后固定（stepsRef），设置页里改了勾选也不跳 */
    const stepItems = (download) => [
      {k: 'setup', label: '设置'},
      download ? {k: 'download', label: '下载模型'} : null,
      needTranslate ? {k: 'translate', label: '翻译'} : null,
      r.review ? {k: 'compare', label: '对比时长'} : null,
      wantReadings ? {k: 'readings', label: '注音'} : null,
      {k: 'run', label: '生成'},
    ].filter(Boolean);
    const steps = phase === 'setup' ? stepItems(!!missing.list.length) : stepsRef.current || stepItems(false);
    const stepIndex = phase === 'done' ? steps.length : Math.max(0, steps.findIndex((st) => st.k === phase));
    const cancel = () => app.cancelTask(ai.task, {after: () => {
      clearInterval(timer.current);
      if (locked) ctx.updateDub(lock.lang, {blocks: prev.blocks.map((b) => (b.status === 'queued' ? {...b, status: 'done'} : b))});
      setPhase('setup');
    }});

    const retry = (ids) => {
      const mark = {}; ids.forEach((id) => { mark[id] = true; });
      setRetrying((s) => ({...s, ...mark}));
      setTimeout(() => {
        // 不在 setRes 的更新函数里碰 ctx（那会在渲染期给 EditorPage 设状态）
        const cur = resRef.current;
        if (cur) {
          const blocks = TTS.retry(cur.blocks, ids);
          if (cur.regen) ctx.updateDub(r.lang, {blocks}); else applyResult(blocks);
          setRes({...cur, blocks});
        }
        setRetrying((s) => { const n = {...s}; ids.forEach((id) => { delete n[id]; }); return n; });
        app.toast(`已重试 ${ids.length} 句 · 写回同一条配音轨`, 'positive');
      }, 900);
    };
    /* 收据上的「重新生成失败 + 过快的句」：这一页原地切成只重配这几句 */
    const regenFrom = (ids) => { setLock({lang: r.lang, ids}); set({review: false}); setRes(null); setPhase('setup'); };

    const undo = () => {
      if (res && res.regen) {
        ctx.updateDub(r.lang, {blocks: res.regen.prevBlocks, script: res.regen.prevScript});
        ai.setUndone(true); app.toast(`已撤销 · ${res.regen.ids.length} 句退回原来的版本`, 'notice');
        return;
      }
      app.confirm({title: '撤销翻译配音？', body: UNDO_BODY.dub, tone: 'negative', confirmLabel: '撤销',
        run: () => {
          ctx.clearDub(r.lang);
          ai.setUndone(true);
          app.toast('已撤销 · 原声恢复', 'notice');
        }});
    };
    const redo = () => {
      if (!res) return;
      if (res.regen) ctx.updateDub(r.lang, {blocks: res.blocks, script: {...res.regen.prevScript, ...script}});
      else applyResult(res.blocks);
      ai.setUndone(false); app.toast('已恢复配音', 'positive');
    };

    const failed = res ? TTS.failedOf(res.blocks) : [];
    const fast = res ? TTS.fastOf(res.blocks) : [];
    const cands = res && !res.regen ? DUB.regenCandidates(res.blocks) : [];
    const receipt = res && res.regen
      ? `已重新生成 ${res.regen.ids.length} 句 · ${res.elapsed} · ${engFamily}`
      : res ? TTS.dubReceipt({blocks: res.blocks, engine: res.engine, elapsed: res.elapsed, separate: res.separate}) : '';
    /* 收据的注音一行：`注音 12 处 · 3 处引擎没按注音念`（只重配几句时只数这几句） */
    const rdBlocks = res ? (res.regen ? res.blocks.filter((b) => res.regen.ids.indexOf(b.id) >= 0) : res.blocks) : [];
    const rdTally = RD.tally(rdBlocks);
    const d = {cues, spIds, countOf, wantReadings, only, translated, langName, ln, engName, needTranslate, speaks, plan, ttsModel, pace,
      missing, alt, problem, step, cta, llmNeeded, scope: locked ? lock : null, pickEngine, pickPriority,
      peers, nodeOn, nodeName, pickNode, nodeHint: DUB.nodeHint({separate, remoteSeparate: sepRemote}),
      where: DUB.whereLine({nodeName, separate, remoteSeparate: sepRemote})};

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh">
          <IconBtn icon="back" size="s" tip="返回" onClick={phase === 'compare' || phase === 'readings' ? () => setPhase('setup') : onBack} />
          <b>{locked ? '重新生成配音' : '翻译配音'}</b>
          {phase === 'run' || phase === 'translate' ? <Chip tone="accent">后台运行中</Chip> : null}
          {phase === 'download' ? <Chip tone="notice">下载中</Chip> : null}
          {locked && phase === 'setup' ? <Chip>{lock.ids.length} 句</Chip> : null}
        </div>
        <div className="flowsteps"><Steps items={steps} cur={stepIndex} /></div>

        {phase === 'setup' ? (
          <window.DubSetup ctx={ctx} r={r} set={set} d={d} onStart={start} onWhole={() => { setLock(null); set({review: true}); }} />
        ) : null}

        {phase === 'download' ? (
          <>
            <Job title={`下载模型 · ${dlRef.current.map(dlName).join('、')}…`} pct={dlPct} stages={dlRef.current.map(dlName)} cur={Math.max(0, dlCur)}
              activity={dlCur >= 0 ? `${dlName(dlRef.current[dlCur])} · ${app.modelDl[dlRef.current[dlCur]] || 0}%` : '装好了，接着开始'} />
            <div className="signpost">装好自动接着{needTranslate ? '翻译' : r.review ? '对比时长' : wantReadings ? '注音' : '合成'}；下载不占任务队列，也能在设置 › 模型 › 语音合成里看。</div>
            <div className="flowcta"><Btn variant="secondary" onClick={() => setPhase('setup')}>先回设置</Btn></div>
          </>
        ) : null}

        {phase === 'translate' ? (
          <>
            <Job title={`翻译字幕 · ${langName}…`} pct={pct} stages={['翻译字幕']} cur={0}
              activity={`${llm.name} 翻成${langName} · 第 ${Math.max(1, Math.min(cues.length, Math.round(cues.length * pct / 100)))}/${cues.length} 句`} />
            <div className="signpost">译文会成为一条新的字幕轨；翻完{r.review ? '先对比时长再合成' : '直接合成'}。</div>
            <div className="flowcta"><Btn variant="secondary" onClick={() => { clearInterval(timer.current); setPhase('setup'); }}>取消</Btn></div>
          </>
        ) : null}

        {phase === 'compare' ? (
          <window.DubFitReview ctx={ctx} cues={cues} lang={r.lang} langName={langName} pace={pace} model={ttsModel} script={locked ? {...(prev.script || {}), ...script} : script}
            onApply={(sc) => { setScript(sc); toRun(sc); }} onSkip={() => toRun({})} />
        ) : null}

        {phase === 'readings' ? (
          <window.DubReadingsReview cues={cues} script={locked ? {...(prev.script || {}), ...script} : script} engine={r.engine} engineName={engFamily}
            llm={llm} project={ctx.dubReadings || []}
            onApply={(sc, remembered) => {
              const n = remembered.length - (ctx.dubReadings || []).length;
              if (ctx.setDubReadings) ctx.setDubReadings(remembered);
              if (n > 0) app.toast(`记住了 ${n} 个词的读音 · 这部视频以后配音与生成语音先用它`, 'positive');
              setScript(sc); runDub(sc);
            }}
            onSkip={() => runDub(Object.keys(script).reduce((o, id) => ({...o, [id]: RD.stripReadings(script[id])}), {}))} />
        ) : null}

        {phase === 'run' ? (
          <>
            <Job title={locked ? `重新生成 ${lock.ids.length} 句…` : '翻译配音…'} pct={pct} stages={stages} cur={ph.cur} activity={ph.activity} />
            <RunLog cues={cues} pct={pct} failed={failedRef.current} separate={separate} />
            <div className="signpost">{locked ? '做完的句子逐句写回同一条轨，其余句子不动。' : `可先继续编辑 · 合成完的句子会先落到「配音 · ${langName}」轨，最后一步才动原声。`}</div>
            <div className="flowcta"><Btn variant="secondary" onClick={cancel}>取消</Btn></div>
          </>
        ) : null}

        {phase === 'done' && res ? (
          <>
            <window.Receipt text={receipt} undone={ai.undone} onUndo={undo} onRedo={redo}
              onAgain={() => setPhase('setup')} onDone={onBack} />
            {rdTally.n && !ai.undone ? (
              <div className={cx('rdrcpt', rdTally.m && 'rdrcpt--warn')}>
                <span className="grow">{RD.receiptLine(rdTally.n, rdTally.m)}</span>
                {rdTally.m ? <BCAction className="viewall" onClick={() => setRdOpen((v) => !v)}>{rdOpen ? '收起' : '看是哪几处'}</BCAction> : null}
              </div>
            ) : null}
            {rdOpen && rdTally.m && !ai.undone ? (
              <div className="rdrlist">
                {rdBlocks.filter((b) => (b.readingsDropped || []).length).map((b) => (
                  <div key={b.id} className="dubfail">
                    <span className="t-mono t-detail-xs">{T.timecode(b.start, {decimals: 0})}</span>
                    <span className="t-truncate grow">{b.text}</span>
                    <span className="rdrlist__py">{b.readingsDropped.map((x) => `${x.surface} ${RD.toneMark(x.reading)}`).join('、')}</span>
                  </div>
                ))}
                <div className="hint hint--tight">{RD.dropReason(res.engine)}；这几处按原字念，句属性页的「读音」行也标橙。</div>
              </div>
            ) : null}
            {!ai.undone && !res.regen ? (
              <window.PRow label="现在听">
                <Segmented size="s" value={TTS.sourceOf({muted: ctx.muted, dubOff: ctx.dubOff, lang: r.lang, ducked: r.original === 'duck' && !ctx.muted})}
                  items={[{k: 'dub', label: '配音'}, {k: 'original', label: '原声'}, {k: 'both', label: '两者'}]}
                  onChange={(k) => { ctx.setDubSource(k, r.lang); app.toast('在听 ' + TTS.sourceLabel(k, langName)); }} />
                <span className="t-detail-xs">播放条的音量按钮与配音行头 ⋯ 也能切</span>
              </window.PRow>
            ) : null}
            {failed.length ? (
              <div className="failc">
                <b>{failed.length} 句没合成出来</b>
                <span>其余 {res.blocks.length - failed.length} 句已经在配音轨上；这几句在轨上是空槽，重试成功就补上。</span>
                {failed.map((b) => (
                  <div key={b.id} className="dubfail">
                    <span className="t-mono t-detail-xs">{T.timecode(b.start, {decimals: 0})}</span>
                    <span className="t-truncate grow">{b.text}</span>
                    <Btn variant="secondary" size="s" disabled={!!retrying[b.id]} onClick={() => retry([b.id])}>{retrying[b.id] ? '重试中…' : '重试'}</Btn>
                  </div>
                ))}
                <div className="row gap8" style={{marginTop: 4}}>
                  <Btn variant="accent" size="s" icon="redo" disabled={Object.keys(retrying).length > 0} onClick={() => retry(failed.map((b) => b.id))}>重试这 {failed.length} 句</Btn>
                </div>
              </div>
            ) : null}
            {fast.length ? (
              <div className="aicard aicard--warn">
                <b>{fast.length} 句过快</b>
                <span>译文比原句长太多，压到 1.35× 以上才装得下（轨上标橙）。可以拖块右缘放慢，或交给「重新生成」先缩短译文再配。</span>
              </div>
            ) : null}
            {cands.length && !ai.undone ? (
              <div className="row gap8">
                <Btn variant="secondary" size="s" icon="refresh" onClick={() => regenFrom(cands)}>重新生成{failed.length && fast.length ? '失败与过快的' : failed.length ? '失败的' : '过快的'} {cands.length} 句</Btn>
              </div>
            ) : null}
            <div className="signpost">{res.regen ? '轨上这几句已换成新版本；块上仍显示译文，右键能静音、删除或再改。'
              : '配音轨一句一块、块上显示译文；点选一句或框几句，右键能静音、删除、重新生成；拖块右缘改语速；行头 ⋯ 能切回原声或两者都听。'}</div>
          </>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {DubFlow, DubRunLog: RunLog});
})();
