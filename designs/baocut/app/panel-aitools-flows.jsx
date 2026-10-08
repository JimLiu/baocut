/* AI Tools 共享层 —— §15（第 110 轮从 panel-aitools.jsx 拆出）。
   工具表、撤销正文、任务记录 hook、进度模拟、阶段条与两条独立 flow
   （识别说话人 / 翻译）住在这里；写作与发布五个工具在 panel-aitools-write.jsx / panel-aitools-cover.jsx；文稿类 DocFlow 与面板本体留在 panel-aitools.jsx。
   第 110 轮撤掉「执行方式」Segmented；第 111 轮把「谁来做」收成工具设置态第一行「用」
   （tool-setup.jsx::useToolRunner）：选 Agent 主按钮是「交给 Agent」、按下直接发送到会话；
   选模型走三态 + 收据。前置条件是勾选项不是闸门，页脚不再有第二个 Agent 入口。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;

  const TOOLS = {
    crop: {group: '画面', icon: 'video', name: '智能裁剪', desc: '换一种画幅，把发言人、白板这些重点留在框里', kind: 'crop'},
    shortscut: {group: '画面', icon: 'clip', name: '剪成短视频', desc: '从这部视频里挑几段，各做成一支竖屏短视频', kind: 'shorts'},
    polish:  {group: '整理文稿', icon: 'sparkle', name: '润色文稿', desc: '修错字、补标点、自动分段——不改写你的话', kind: 'doc',
              setup: ['把明显的错字、缺失的标点补上，并按话题分段。', '不改写你的表达，也不删内容——只修可以确定是笔误的地方。']},
    chapters:{group: '整理文稿', icon: 'list', name: '生成章节', desc: '给长视频分出带标题的章节', kind: 'doc', needsPolish: true,
              setup: ['按段落话题聚合出章节，并给每一章起标题。', '导出与分享页会用同一份章节。']},
    speakers:{group: '整理文稿', icon: 'mic', name: '识别说话人', desc: '区分是谁在说话，字幕与文稿都会标上名字', kind: 'spk'},
    retranscribe:{group: '整理文稿', icon: 'redo', name: '重新转录', desc: '换一个模型重跑音频——可以只跑一章或一段', kind: 'doc',
              setup: ['用另一个语音模型重跑，替换掉这一范围的词级数据。', '范围之外的文稿、字幕与译文一个字不动。']},
    cleanup: {group: '整理文稿', icon: 'split', name: '找可剪的口', desc: '找出口癖、长停顿、坏拍，先看建议再剪', kind: 'doc',
              setup: ['扫一遍口癖、≥0.8s 的长停顿与重复起句。', '结果以划线形态进文稿与时间轴，逐条决定留还是剪；接受前不影响播放和导出。']},
    translate:{group: '翻译', icon: 'translate', name: '翻译字幕', desc: '逐句翻译并按词级数据自动对齐时间码', kind: 'trans'},
    stale:   {group: '翻译', icon: 'redo', name: '刷新过期译文', desc: '只重译原文改过或被剪切的那几句', kind: 'doc',
              setup: ['只重译原文变过的那几句：你改过原文的，和剪口播剪掉了半句的。', '按剪后的原文译；整句剪掉的译文随句一起剪。其余一个字不动，对齐跟着重算。']},
    dub:     {group: '翻译', icon: 'wave', name: '翻译配音', desc: '选一种语言，让视频用它开口；像本人或像母语，其余默认就能开始', kind: 'dub'},
    /* 2026-09-28（§15.11）：原「写作」组按受众拆成两组。写作给读的人，发布给发视频的人；五个工具在 panel-aitools-write.jsx / -cover.jsx。 */
    summary: {group: '写作', icon: 'transcript', name: '写总结', desc: '正文加带时间的要点，点时间跳到那里', kind: 'wr'},
    blog:    {group: '写作', icon: 'text', name: '写博客', desc: '改写成一篇文章，作者视角或观众视角', kind: 'wr'},
    title:   {group: '发布', icon: 'star', name: '起标题', desc: '一次出几个角度不同的候选，挑一个选用', kind: 'wr'},
    desc:    {group: '发布', icon: 'edit', name: '写简介', desc: '发布用的简介，带章节时间码和标签', kind: 'wr'},
    cover:   {group: '发布', icon: 'image', name: '做封面', desc: '从关键帧出发做几张封面候选，挑一张选用', kind: 'wr'},
  };
  const GROUPS = ['画面', '整理文稿', '翻译', '写作', '发布'];
  /* 分组下的一句副题：说清这一组给谁用 */
  const GROUP_SUB = {
    '写作': '给读的人：不看视频也能知道讲了什么',
    '发布': '给发视频的人：让人想点开，点开后内容对得上',
  };

  /* 撤销确认框的正文，逐 flow 写清**撤销会拿走什么**。
     一句通用的「改动会被移除」等于没说——用户要判断的是「我会失去哪一部分」。 */
  const UNDO_BODY = {
    polish:   '润色改过的错字、标点与分段会全部还原成原来的样子。词级时间不受影响。',
    chapters: '生成的章节会被移除，文稿回到没有章节的状态。段落本身不动。',
    speakers: '说话人标注会被移除，字幕与文稿回到不分说话人的样子。译文内容不变。',
    retranscribe: '这一范围的文稿、译文、字幕 pin 与配音都回到重跑之前的版本。范围之外一个字不动。',
    cleanup:  '粗剪建议会被清空。已经采纳并剪掉的片段不在这条撤销的范围内。',
    stale:    '这几句重译出来的译文会还原成重译之前的那一份。',
    translate: '这一门语言的译文会被移除。原文一个字不动。',
    dub:      window.BC_TTS.DUB_UNDO,
  };

  /* ---------- 一次 AI run 的任务记录 ----------
     跑完的**收据与撤销都挂在这条记录上**，不挂在面板的局部 state 里：
     局部 state 一离开这一页就没了，用户关掉绿横幅之后再也找不到反悔的地方；
     记录落进 jobs 那张表，后台任务页于是也能撤销 / 恢复（同一个 `undone` 字段）。
     写作与发布的五个工具不落记录——§15.1 / §15.11：它们不写文稿，没有「应用」，也就没有撤销。 */
  function useAiTask() {
    const app = useApp();
    const [id, setId] = useState(null);
    const task = id ? app.tasks.find((t) => t.id === id) || null : null;
    return {
      task,
      undone: !!(task && task.undone),
      begin: (spec) => { const n = app.addTask(spec); setId(n); return n; },
      // 第 196 轮：重新打开工具页时接上还在跑的那条记录（从文稿的进度条点过来）
      adopt: (n) => setId(n),
      progress: (n, pct) => app.patchTask(n, {pct}),
      finish: (n, patch) => app.patchTask(n,
        Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null, undone: false}, patch)),
      setUndone: (v) => { if (id) app.patchTask(id, {undone: v}); },
    };
  }

  /* 进度模拟：计数器挂在 interval 自己身上，**不塞进 setPct 的 updater 里**。
     updater 必须是纯函数——把「跑完了要干什么」写进去，在 StrictMode 的双调用下
     会跑两遍；而且一旦那件事要改上层状态（比如翻译跑完交接到翻译 Tab），
     React 会直接报「Cannot update a component while rendering a different one」。 */
  function fakeRun(timer, setPct, step, ms, done, from) {
    clearInterval(timer.current);
    let p = from || 0;
    setPct(p);
    timer.current = setInterval(() => {
      p = Math.min(100, p + step);
      setPct(p);
      if (p >= 100) { clearInterval(timer.current); if (done) done(); }
    }, ms);
  }

  /* 每个工具「这一步」的规模，供 ToolSetup 折成一句人话（与 model-agent.js PLANS 的 step 同形）。
     数字对着演示项目：42 段 / 42 句、206 秒、3 句过期译文、62 句。
     `llm: true` 的第二组候选是云端模型；本机工具（重新转录 / 识别说话人）带 `engine`，第二组是「直接跑」。 */
  const STEP = {
    polish:   {verb: '润色', count: 42, unit: '段', llm: true},
    chapters: {verb: '重新聚合', count: 9, unit: '段成章节', llm: true},
    // 第 196 轮：找可剪的口默认交给 Agent（`prefer`），见 model-agent.js::preferredRunner
    cleanup:  {verb: '扫描', count: 206, unit: '秒的词级时间', llm: true, prefer: 'agent'},
    stale:    {verb: '重译', count: 3, unit: '句过期译文', llm: true},
    translate:{verb: '翻译', count: 42, unit: '句', llm: true},
    speakers: {verb: '识别', count: 62, unit: '句的说话人', engine: '本机声纹模型'},
    retranscribe: {verb: '重新转录', count: 42, unit: '段', engine: '本机语音模型'},
    summary:  {verb: '从', count: 42, unit: '段文稿提炼要点总结', llm: true},
    blog:     {verb: '把', count: 42, unit: '段文稿改写成博客', llm: true},
    // 候选数 / 张数由工具页替换进 unit（panel-aitools-write.jsx / -cover.jsx）
    title:    {verb: '从', count: 42, unit: '段文稿起 6 个候选标题', llm: true},
    desc:     {verb: '从', count: 42, unit: '段文稿写发布简介', llm: true},
    // 封面要看图、写合成代码，缺省交给 Agent（同找可剪的口）
    cover:    {verb: '从', count: 206, unit: '秒的成片里挑关键帧，做 3 张封面候选', llm: true, prefer: 'agent'},
    // 剪成短视频（§15.12）：句数与要找几段由设置页按项目现状填进来
    shortscut: {verb: '从', count: 62, unit: '句文稿里找能单独成立的片段', llm: true, prefer: 'agent'},
  };

  /** 收据下的二次处理：把意图翻成一句**可改的草稿**开抽屉，不替用户发（§17.2）。 */
  function handToAgent(app, ctx, intent) {
    // 第 185 轮：没有可用编码 Agent 时不开抽屉——那里只有一条离线条；直接带去 Settings › Agent 并说清为什么
    if (!app.harness) { app.toast('还没有可用的编码 Agent · 连接后就能把这件事交给它'); app.go({r: 'settings', sec: 'agent'}); return; }
    app.openAgent({project: ctx.proj.id, prompt: window.BC_AGENT.intentPrompt(intent, ctx.proj)});
  }

  /** 工具页选了 Agent 之后按下主按钮：设置态就是确认，**直接发送**到这个项目的会话，
      抽屉打开、工具页回到列表。范围与勾选项折进 intent.extra。 */
  function sendToAgent(app, ctx, runner, intent, onBack) {
    const sess = app.openAgent({project: ctx.proj.id, send: true, harness: runner.harness, model: runner.model,
      prompt: window.BC_AGENT.intentPrompt(intent, ctx.proj)});
    app.toast(`已交给 ${runner.label} · 在会话里进行`);
    // 第 196 轮：不传 onBack 的页（找可剪的口）留在原地画进度卡，会话 id 交给调用方
    if (onBack) onBack();
    return sess;
  }

  /** 主按钮与它下面那行 hint 随「谁来做」变。 */
  function RunCta({runner, label, onStart, hintApi}) {
    const ag = runner.agent;
    return (
      <>
        <div className="flowcta">
          <Btn variant="accent" onClick={onStart} style={{width: '100%'}}>{ag ? '交给 Agent' : label}</Btn>
        </div>
        <div className="hint">{ag ? '会在这部视频的会话里进行；读完视频、写入前都会先问你。' : hintApi}</div>
      </>
    );
  }


  const Stages = ({stages, cur}) => (
    <div className="ajstg">
      {stages.map((s, i) => (
        <div key={s} className={cx('ajseg', i < cur && 'is-done', i === cur && 'is-cur')}>
          <i /><em>{s}</em>
        </div>
      ))}
    </div>
  );

  const Job = ({title, pct, stages, cur, activity}) => (
    <div className="ajob">
      <div className="ajhead"><b>{title}</b>{pct == null ? null : <span className="ajpct">{pct}%</span>}</div>
      <Stages stages={stages} cur={cur} />
      {activity ? <div className="ajact"><span className="k">MODEL ACTIVITY</span><span className="v">{activity}</span></div> : null}
    </div>
  );

  /* 范围条：从 Transcript 按章 / 按段下单时出现在设置页顶部。
     范围是 flow 的输入之一，不是装饰——所以它出现在设置页而不是提示条里，
     并且随时能改回整篇。 */
  const ScopeBar = ({scope, onClear}) => (
    <div className="scopebar">
      <Ic n="transcript" className="ic--16" />
      <b>范围 · {scope.label}</b>
      <span>{scope.count} 段</span>
      <BCAction className="ccbtn" onClick={onClear}>改为整篇</BCAction>
    </div>
  );

  function SpeakerFlow({scope, clearScope, onBack, ctx}) {
    const app = useApp();
    const runner = window.useToolRunner(STEP.speakers);
    const [phase, setPhase] = useState('setup');
    const [pct, setPct] = useState(0);
    const ai = useAiTask();
    const undone = ai.undone;
    const [play, setPlay] = useState({});
    const timer = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    const start = () => {
      if (runner.agent) return sendToAgent(app, ctx, runner.cur, {kind: 'speakers', scope: scope ? scope.label : null}, onBack);
      setPhase('run');
      const tid = ai.begin({
        kind: 'speakers', flow: 'speakers', project: ctx.proj.id,
        title: `识别说话人 · ${ctx.proj.title}`, sub: '本机声纹模型',
        phase: '识别说话人', cancellable: true, undoBody: UNDO_BODY.speakers,
      });
      /* 这一跑到「确认页」就停了——**还没写进项目**，所以记录先落成已完成但
         不可撤销；`undoable` 要等用户按下「应用」才成立（§15.3：产品唯一
         apply 前确认的 flow）。 */
      fakeRun(timer, (p) => { setPct(p); ai.progress(tid, p); }, 5, 80,
        () => { ai.finish(tid, {undoable: false}); setPhase('confirm'); });
    };
    const cards = [
      {id: 's1', n: 24, clips: ['00:00 · 欢迎回到…', '00:14 · 先从一个…', '00:33 · 这一段先…']},
      {id: 's2', n: 21, clips: ['00:07 · 嗯，就是…', '00:16 · 因为素材…', '00:47 · 所以时间轴…']},
      {id: 's3', n: 17, clips: ['00:10 · 大家好…', '00:24 · 而且模型…', '00:37 · 渲染这边…']},
    ];
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh">
          <IconBtn icon="back" size="s" tip="返回" onClick={onBack} />
          <b>识别说话人</b>
          {phase === 'run' ? <Chip tone="accent">后台运行中</Chip> : null}
        </div>

        {phase === 'setup' ? (
          <>
            {scope ? <ScopeBar scope={scope} onClear={clearScope} /> : null}
            <div className="aicard">
              <b>区分是谁在说话</b>
              <span>按声纹重新识别说话人，字幕与文稿都会标上名字；识别结果先给你确认，应用前不改任何数据。</span>
            </div>
            <window.ToolSetup plan={{step: STEP.speakers}} runner={runner} chapters={ctx.chapters}
              hint={runner.agent ? null : '本机声纹模型约 32 MB，首次运行会下载，此后离线可用。'} />
            <RunCta runner={runner} label="开始识别" onStart={start}
              hintApi="识别完成后进入确认页——这是唯一需要先确认再应用的工具。" />
          </>
        ) : null}

        {phase === 'run' ? (
          <>
            <Job title="正在识别说话人…" pct={pct} stages={['声纹', '聚类', '整理']} cur={Math.min(2, Math.floor(pct / 34))}
              activity="speaker-id · 本机声纹模型 · 正在聚类第 2 组…" />
            <div className="signpost">可先继续编辑 · 识别在后台运行，完成后先进确认页，不会直接改动文稿。</div>
          </>
        ) : null}

        {phase === 'confirm' ? (
          <>
            <div className="signpost">识别出 3 位说话人——试听片段确认身份，点名字可改名，确认后再应用。</div>
            {cards.map((c) => (
              <div className="spkc" key={c.id}>
                <div className="spkh">
                  <span className="spkdot" style={{background: `oklch(0.6 0.14 ${D.speakers[c.id].hue})`}} />
                  <b style={{fontSize: 14, fontWeight: 700}}>{D.speakers[c.id].name}</b>
                  <IconBtn icon="text" size="xs" tip="改名" onClick={() => app.toast('点名字可直接改名')} />
                  <span className="spacer" />
                  <Chip>{c.n} 句</Chip>
                </div>
                <div className="spkchips">
                  {c.clips.map((l, i) => (
                    <BCAction key={i} className={cx('spklc', play[c.id] === i && 'is-on')}
                      onClick={() => setPlay((p) => ({...p, [c.id]: p[c.id] === i ? -1 : i}))}>{l}</BCAction>
                  ))}
                </div>
              </div>
            ))}
            <div className="aicard">
              <b>3 条译文将重切，无需重译</b>
              <span>说话人边界变化只影响字幕行的切分——译文内容保持不变。</span>
            </div>
            <div className="flowcta">
              <Btn variant="accent" style={{width: '100%'}}
                onClick={() => {
                  if (ai.task) app.patchTask(ai.task.id, {undoable: true, undone: false});
                  setPhase('done');
                }}>应用</Btn>
            </div>
            <div className="hint">应用后随时可一键撤销。</div>
          </>
        ) : null}

        {phase === 'done' ? (
          <>
            <Receipt text={undone ? '已撤销 · 说话人标注已还原' : '已应用 · 识别出 3 位说话人 · 9.2s · 本机声纹模型'}
              undone={undone} onUndo={() => ai.setUndone(true)} onRedo={() => ai.setUndone(false)}
              onAgain={start} onDone={onBack} />
            {undone
              ? <div className="aicard"><b>已撤销</b><span>「再跑一次」可重来——识别设置会保留。</span></div>
              : <>
                  {cards.map((c) => (
                    <div className="chapc" key={c.id}>
                      <b>{D.speakers[c.id].name}</b><Chip tone="positive">{c.n} 句</Chip>
                    </div>
                  ))}
                  <div className="signpost">3 条译文已按新说话人边界重切——未触发重译。</div>
                </>}
          </>
        ) : null}
      </div>
    );
  }

  /* ---------- 翻译新语言：两阶段可见 + 可选确认卡点 ---------- */

  function TranslateFlow({onBack, ctx}) {
    const app = useApp();
    const runner = window.useToolRunner(STEP.translate);
    const model = runner.apiModel || D.transModels[0];
    const [phase, setPhase] = useState('setup');
    const [tsc, setTsc] = useState(null);
    const [target, setTarget] = useState('ja');
    const [bi, setBi] = useState(true);
    const [confirmGate, setConfirmGate] = useState(false);   // 默认关：整条流程无人值守
    /* 2026-09-20：翻译术语表（§15.10）。只有方向对得上的表参与（原文语言 → 目标语言），
       且只把**本篇命中的**条目交给模型；必须照用的条目编译成必现项，缺了那一页会重译。 */
    const gl = window.useGlossary(ctx.proj.id, {kind: 'trans', from: D.srcLang.code, to: target});
    const [useTerms, setUseTerms] = useState(true);
    const [pct, setPct] = useState(0);
    const timer = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);

    const run = (next) => fakeRun(timer, setPct, 4, 80, next);
    /* 跑完直接落到「翻译」Tab 的双语对照上——结果在哪儿，撤销的出口就在哪儿。
       这里不再自己出一屏 done：两处各摆一条收据，等于同一次 run 有两个撤销。 */
    const finish = () => {
      setPhase('setup');
      if (ctx && ctx.finishTranslate) ctx.finishTranslate(target);
      else app.toast('翻译完成');
    };
    const start = () => {
      if (runner.agent) {
        return sendToAgent(app, ctx, runner.cur, {kind: 'translate', lang: lang.name, extra: [
          tsc && tsc.k !== 'all' ? `只翻${tsc.label.replace(/^第 \d+ 章 · /, '')}` : null,
          '先润色原文再翻译',
          bi ? '翻完打开双语显示' : '只显示译文',
          useTerms && gl.hit.hit.length ? `翻译术语表里本篇命中的 ${gl.hit.hit.length} 条照着译（其中 ${gl.hit.locked} 条必须逐字照用）` : null,
          confirmGate ? '整句翻完先给我看，我确认后再拆分对齐' : null,
        ]}, onBack);
      }
      if (confirmGate) { setPhase('ph1'); run(() => setPhase('ph1wait')); }
      else { setPhase('auto'); run(finish); }
    };
    const PAIRS = [
      {o: 'So, we got to prepare some launch materials for the voice launch next week.',
       t: '所以，我们得为下周的语音发布准备一些发布材料。', ob: [3, 2, 65], tb: [3, 2, 19]},
      {o: 'Wait, there’s also a new bug report in the feedback channel.',
       t: '等等，反馈频道里还有一份新的 Bug 报告。', ob: [5, 53], tb: [3, 18], chip: 'Re-aligning…'},
      {o: 'It looks like we can get pretty far just inside the shader, since it already has the audio and phase.',
       t: '正在翻译…', dim: true, chip: 'Refreshing…'},
    ];
    const lang = BC_LANGUAGES.languages.find((l) => l.code === target);

    const Pair = ({p, showBlocks}) => (
      <div className="trpc">
        {p.chip ? <div className="trph"><Chip tone="notice">{p.chip}</Chip></div> : null}
        <div className="trpo">{p.o}</div>
        {showBlocks && p.ob ? <div className="blkbar">{p.ob.map((f, i) => <i key={i} className="blkseg is-on" style={{flex: f}} />)}</div> : null}
        <div className={cx('trpt', p.dim && 'is-dim')}>{p.t}</div>
        {showBlocks && p.tb ? <div className="blkbar">{p.tb.map((f, i) => <i key={i} className="blkseg is-on" style={{flex: f}} />)}</div> : null}
      </div>
    );

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh">
          <IconBtn icon="back" size="s" tip="返回" onClick={onBack} />
          <b>翻译新语言</b>
          {/^(auto|ph1|ph2)$/.test(phase) ? <Chip tone="accent">后台运行中</Chip> : null}
        </div>

        {phase === 'setup' ? (
          <>
            <SecHead first>目标语言</SecHead>
            <div className="translation-target"><LanguageCombobox value={target} onChange={setTarget} /></div>
            {/* 「首次翻译会先润色原文」不是选择，是这一步的一部分——写进摘要句，不另出说明卡 */}
            <window.ToolSetup plan={{step: STEP.translate}} runner={runner} pre="润色原文"
              scope={tsc} onScope={setTsc} chapters={ctx.chapters}>
              <window.GlossaryOption gl={gl} on={useTerms} onChange={setUseTerms} kind="translate" />
              {useTerms ? <window.GlossaryHits gl={gl} /> : null}
              <div className="tsetup__row">
                <Switch on={bi} onChange={setBi} label="双语显示" />
                <span className="t-detail-xs">翻译完成后原文 + 译文一起显示在画面上</span>
              </div>
              <div className="tsetup__row">
                <Switch on={confirmGate} onChange={setConfirmGate} label="拆分前先确认翻译结果" />
                <span className="t-detail-xs">默认自动完成整个流程</span>
              </div>
            </window.ToolSetup>
            <RunCta runner={runner} label={`翻译成 ${lang.native}`} onStart={start}
              hintApi="默认设置就能开始；完成后自动应用，随时可一键撤销。" />
          </>
        ) : null}

        {phase === 'auto' ? (
          <>
            <Job title="翻译 → 拆分对齐" pct={pct} stages={['翻译', '对齐']} cur={pct < 60 ? 0 : 1}
              activity={`${model.name} 翻第 3 句 · align-edges 拆第 2 句 · 在飞 2`} />
            <div className="signpost">整句翻译与拆分对齐自动衔接：译好的句子随即被切成最小单调块，全程不需要操作。</div>
            {PAIRS.map((p, i) => <Pair key={i} p={p} showBlocks={i === 0} />)}
            <div className="hint">两个阶段自动衔接；想中途检查，可在设置里开启「拆分前先确认翻译结果」。</div>
          </>
        ) : null}

        {phase === 'ph1' || phase === 'ph1wait' ? (
          <>
            <Job title="阶段 1 · 整体翻译" pct={phase === 'ph1wait' ? 100 : pct} stages={['翻译', '对齐']} cur={0}
              activity={`${model.name} · 在飞 2 · 正在翻第 3 句…`} />
            <div className="signpost">先整句翻译：每句原文对一句完整自然译文——此时整句上屏，还没有块刻度。</div>
            {PAIRS.map((p, i) => <Pair key={i} p={p} showBlocks={false} />)}
            {phase === 'ph1wait' ? (
              <>
                <div className="flowcta">
                  <Btn variant="accent" style={{width: '100%'}}
                    onClick={() => { setPhase('ph2'); run(finish); }}>确认翻译，继续拆分对齐</Btn>
                </div>
                <div className="hint">已开启「拆分前先确认」：检查译文没问题后再继续拆分对齐。</div>
              </>
            ) : null}
          </>
        ) : null}

        {phase === 'ph2' ? (
          <>
            <Job title="阶段 2 · 拆分对齐" pct={pct} stages={['翻译', '对齐']} cur={1}
              activity="align-edges · 在飞 1 · 正在拆分对齐第 3 句…" />
            <div className="signpost">
              正在把每句译文切成与原文一一对应的小块，好让字幕跟得上语音。
            </div>
            {PAIRS.map((p, i) => <Pair key={i} p={p} showBlocks={i < 2} />)}
          </>
        ) : null}

      </div>
    );
  }

  Object.assign(window, {BC_AIFLOWS: {TOOLS, GROUPS, GROUP_SUB, UNDO_BODY, STEP, useAiTask, fakeRun, handToAgent, sendToAgent,
    RunCta, Stages, Job, ScopeBar, SpeakerFlow, TranslateFlow}});
})();
