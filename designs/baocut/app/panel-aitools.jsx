/* AI 工具 Tab —— product-design §5.10（2026-10-09 起是 rail 第三格）。列表页在 panel-aitools-list.jsx；
   从对话的斜杠命令、别的面板的按钮进来时直接打开那一页，「返回」回列表。
   每个工具页设置态第一行「用」决定一切，缺省交给 Agent：主按钮「交给 Agent」，按下新开一条会话、把这部视频作为上下文
   （「会话」行可改成接着当前会话）；要对 Agent 说的话预填成模板，与会话输入框同一个控件（tool-prompt.jsx）；
   改选模型 → 三态 + 收据（设置 → 后台进度 → 完成即应用 + 收据，撤销 / 再跑一次 / 完成，没有应用前确认，
   唯一例外是识别说话人）。前置条件（章节要先润色）是勾选项，不是闸门，按钮永不置灰。
   共享层与两条独立 flow 在 panel-aitools-flows.jsx；写作与发布五个工具不落收据、没有撤销，
   页面在 panel-aitools-write.jsx / panel-aitools-cover.jsx。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const CUT = window.BC_CUT;
  const AICUT = window.BC_AICUT;
  const P = window.BC_AIPROMPT;
  const {TOOLS, UNDO_BODY, STEP, useAiTask, fakeRun, handToAgent, sendToAgent, RunCta, Job, ScopeBar,
    SpeakerFlow, TranslateFlow} = window.BC_AIFLOWS;

  /* ---------- 工具页：文稿类（润色 / 章节 / 重新转录 / 找可剪的口 / 刷新过期） ---------- */
  function DocFlow({id, ctx, scope, clearScope, onBack}) {
    const app = useApp();
    const t = TOOLS[id];
    const [phase, setPhase] = useState('setup');
    /* 前置条件是勾选项（第 111 轮）：章节按段落聚合，没润色过的文稿只有 1 段——
       默认勾上「先润色一遍」一起做；取消也允许，结果差但不是闸门。 */
    const [pre, setPre] = useState(!!t.needsPolish);
    const [pctLocal, setPct] = useState(0);
    const ai = useAiTask();
    const [rev, setRev] = useState({});
    const [fail, setFail] = useState(null);
    const [pop, setPop] = useState(false);
    const timer = useRef(null);
    const asr = id === 'retranscribe';
    /* 范围有两个来源：Transcript 按章 / 按段下单带来的 `scope`（prop），与设置态里自己挑的章。
       两者折成同一个受控值 `tscope` 交给 ToolSetup；挑回「整篇」时顺手把下单范围清掉。 */
    const [tscope, setTscope] = useState(scope && scope.k !== 'cut' ? {k: 'ordered', label: scope.label, count: scope.count} : null);
    const eff = tscope && tscope.k !== 'all' ? {label: tscope.label.replace(/^第 \d+ 章 · /, ''), count: tscope.count} : null;
    const pickScope = (o) => { setTscope(o); if (o.k !== 'ordered' && scope) clearScope(); };
    // 谁来做：全局记忆的那份（tool-setup.jsx::useToolRunner）；重新转录的第二组是「直接跑 · 本机」
    const runner = window.useToolRunner(STEP[id], id);
    /* 第 196 轮：找可剪的口——三类口各自可勾；刷新过期译文——两类来源各自可勾
       （原文改过的 / 原文被剪切的，后者按剪口覆盖层实数，从文稿剪辑条过来时只勾它）。 */
    const [opts, setOpts] = useState({fillers: true, pauses: true, repeats: true});
    /* 2026-09-20：润色顺手按术语库纠正专有名词（§15.10）。它不是独立工具——术语命中要和
       错字、标点一起看，逐条复核和撤销才在同一处；独立一遍等于让人把同一篇文稿读两次。 */
    const gl = window.useGlossary(ctx.proj.id, {kind: 'asr', from: D.srcLang.code});
    const [useTerms, setUseTerms] = useState(true);
    /* 2026-10-09：「自定义指令」并进提示词框——框里就是会发出去的那段话（模板 + 用户改动）。
       null = 没改过，一直显示最新模板；两条路都收这段话：直接调模型进 `--instructions`，交给 Agent 就是那条消息。 */
    const [prompt, setPrompt] = useState(null);
    const [session, setSession] = useState(null);
    /* 重新转录的识别提示：选哪几张转录术语表 + 自定义提示词，能不能用由语音模型说了算 */
    const [asrHint, setAsrHint] = useState({packs: null, prompt: ''});
    const termRows = id === 'polish' && useTerms ? gl.review() : [];
    const termSum = window.BC_GLOSSARY.reviewSummary(termRows);
    const [termKept, setTermKept] = useState({});
    const [stalePick, setStalePick] = useState({edited: !(scope && scope.k === 'cut'), cut: true});
    const staleIm = ctx.transImpact || {stale: [], whole: 0, partial: 0, trimmed: 0, fixed: 0};
    const si = AICUT.staleIntent(stalePick, 3, staleIm);
    // 跑起来那一刻的计数：跑完后覆盖层里的待处理项会被收掉，收据与结果卡不能跟着变成 0
    const [ran, setRan] = useState(null);
    const rs = ran || si;
    /* 交给 Agent 的两页（找可剪的口 / 刷新过期译文）不跳走：会话在左侧进行，这里按会话消息画进度。 */
    const [sid, setSid] = useState(null);
    const ag = AICUT.useAgentRun(app, sid);
    const job = ai.task || ag.task;
    // 进度以任务记录为准（重新打开工具页也读得到），本地那份只在记录还没建起来时用
    const pct = ai.task ? (ai.task.pct || 0) : pctLocal;
    const jobUndone = !!(job && job.undone);
    const setUndone = (v) => { if (job) app.patchTask(job.id, {undone: v}); };
    useEffect(() => { if (phase === 'agent' && ag.prog.done) setPhase('done'); }, [phase, ag.prog.done]);
    useEffect(() => { if (phase === 'run' && ai.task && ai.task.status === 'done') setPhase('done'); }, [phase, ai.task && ai.task.status]);
    /* 重新打开工具页时接上还在跑的那条（取最新一条）：Agent 源的接会话，直接调模型的接任务记录。 */
    useEffect(() => {
      const t = app.tasks.filter((x) => x.kind === id && x.project === ctx.proj.id && x.status === 'running').slice(-1)[0];
      if (!t) return;
      if (t.source === 'agent' && t.session) { setSid(t.session); setPhase('agent'); return; }
      ai.adopt(t.id); setPhase('run');
    }, []);
    // 语音模型选择是本页局部的：它和「谁来做」不是同一件事
    const [asrModel, setAsrModel] = useState(D.models.local[0]);
    const model = asr ? asrModel : (runner.apiModel || D.transModels[0]);
    const setModel = setAsrModel;
    /* 在下拉里点了一个未安装的模型 = 想用它，所以下完自动选中——
       否则下完还要重开下拉再点一次，等于把「下载」和「选中」拆成两件事。 */
    const [pendingModel, setPendingModel] = useState(null);
    useEffect(() => {
      if (!pendingModel || !app.modelInstalled(pendingModel.id)) return;
      setAsrModel(pendingModel);
      setPendingModel(null);
      app.toast(`${pendingModel.name} 已就绪 · 已选中`, 'positive');
    }, [pendingModel, app.modelInstalled(pendingModel ? pendingModel.id : '')]);
    /* 重新转录的「更多选项 › 识别说话人」（与转录工具页同一块，BC_ASR_FIELDS.AsrMoreOptions）。
       开着而「说话人区分」还没下载时按钮不置灰：写「下载模型并开始」，先下载，装好就接着跑（同配音的做法）。 */
    const RUNS = window.BC_TOOL_RUNS;
    const [spPick, setSpPick] = useState(null);
    const sp = asr ? RUNS.speakerSwitch(model, spPick, app.modelInstalled) : null;
    const [waitPack, setWaitPack] = useState(false);
    const packReady = app.modelInstalled(RUNS.DIARIZE_PACK);

    /* 第 196 轮：进度计时器**不随页面卸载清掉**——任务是后台的（顶栏胶囊、文稿剪辑条、后台任务页都在读
       同一条记录），切走工具页不能让它停在半路。回来时接上记录读进度（下面的接管效果），不再起第二个计时器。 */

    /* 模板：意图句（范围、勾选项折在里面）+ 几行固定约束，预填进提示词框 */
    const intentBase = {kind: id, scope: eff ? eff.label : null, edited: si.edited, cut: si.cut, extra: [
      id === 'chapters' && pre ? '先润色并分段，再生成章节' : null,
      asr ? `用 ${model.name}` : null,
      sp && sp.step ? '转写后识别说话人' : null,
      ...(id === 'cleanup' ? AICUT.cleanupExtra(opts) : []),
    ]};
    const defaultText = P.template(id, AG.intentPrompt(intentBase, ctx.proj), {lang: D.srcLang.name});
    const context = P.contextPack(id, {paras: eff ? eff.count : STEP[id].count, scope: eff ? eff.label : null,
      chapters: (ctx.chapters || []).length, stale: si.count});

    const start = (raw) => {
      // 收据上的「再跑一次」直接传点击事件进来：没有提示词框的 payload 就用当前模板
      const payload = raw && typeof raw.text === 'string' ? raw : null;
      if (sp && sp.missing && !runner.agent) {
        app.downloadModel(RUNS.DIARIZE_PACK);
        setWaitPack(true);
        app.toast('正在下载「说话人区分」· 下完接着重新转录');
        return;
      }
      setRan(si);
      if (runner.agent) {
        /* 发出去的就是框里那段话（payload.text）；会话、附件、家 · 模型、访问模式都来自提示词框 */
        const intent = {text: payload ? payload.text : defaultText};
        const o = payload ? {sid: session && session.k === 'current' ? session.sid : null, attachments: payload.attachments, mode: payload.mode} : null;
        // 剪口播两页留在原地画进度（§15.3）；其余页回列表，进度在顶栏胶囊与后台任务页
        if (id === 'cleanup' || id === 'stale') {
          const sess = sendToAgent(app, ctx, runner.cur, intent, null, o);
          setSid(sess.id); setPhase('agent');
          return;
        }
        return sendToAgent(app, ctx, runner.cur, intent, onBack, o);
      }
      setPhase('run');
      const tid = ai.begin({
        kind: id, flow: id, project: ctx.proj.id,
        title: `${t.name} · ${ctx.proj.title}`,
        sub: `${asr ? model.name : model.name + ' · ' + model.provider}${eff ? ' · 范围 ' + eff.label : ''}`,
        phase: t.name, cancellable: true, undoBody: UNDO_BODY[id],
        // 刷新过期译文：勾没勾「原文被剪切的」决定跑完后要不要收掉剪口覆盖层里的待处理项（editor.jsx）
        cutTrans: id === 'stale' ? !!stalePick.cut : undefined,
      });
      // 进度同时写进任务记录：顶栏胶囊、侧栏迷你条、后台任务页读的是同一条
      fakeRun(timer, (p) => { setPct(p); ai.progress(tid, p); }, 4, 90,
        () => ai.finish(tid, {undoable: true}));
    };
    useEffect(() => { if (waitPack && packReady) { setWaitPack(false); start(); } }, [waitPack, packReady]);

    const stages = id === 'chapters' ? ['读取', '聚合', '命名', '回写']
      : id === 'retranscribe' ? ['解码音频', '识别', '词级对齐'].concat(sp && sp.step ? ['识别说话人'] : [], ['回写'])
      : id === 'cleanup' ? AICUT.API_STAGES
      : ['读取', '处理', '校验', '回写'];
    const activity = id === 'cleanup' ? AICUT.cleanupActivity(pct, model.name)
      : `${model.name} · 在飞 2 · 正在处理第 ${Math.max(1, Math.floor(pct / 12))} 段…`;
    // 收据带范围：跑的是一章还是全篇，回执上必须能看出来，否则「已应用」是句空话。
    // 段数已经在各自的正文里报过一次，这里只补范围名，不重复计数。
    const span = eff ? eff.label : null;
    // 剪口建议按真实覆盖层计数（第 192 轮）：这一批写进 ctx.cuts 时带任务 id 作 batch
    const myCuts = (ctx.cuts || []).filter((c) => c.batch === (job || {}).id);
    const cutSum = CUT.summary(myCuts.length ? myCuts : D.cutSuggestions);
    // 谁做的就署谁：Agent 路径署会话用的 harness，直接调模型署模型名
    const by = runner.agent ? runner.cur.label : model.name;
    const staleParts = [
      rs.edited ? `${rs.edited} 句改过原文的译文` : null,
      rs.cut ? `${rs.cut} 句原文被剪切的译文` : null,
    ].filter(Boolean);
    /* 重新转录换用文稿之后的结转（product-design §5.11）：按章 / 范围局部重跑只对范围内的句子配对，数字按范围占全篇的比例 */
    const carry = asr ? window.BC_TOOL_TARGETS.carrySummary(ctx.proj, {share: eff ? Math.min(1, eff.count / STEP.retranscribe.count) : 1}) : null;
    const receipt = {
      polish:   `已应用 · 润色 ${eff ? eff.count : 42} 段、重新分段${termSum.hits ? `、按术语库纠正 ${termSum.hits} 处` : ''} · 12.4s · ${by}`,
      chapters: `已应用 · ${pre ? '润色 42 段、' : ''}2 章 → 3 章 · 8.1s · ${by}`,
      retranscribe: `已应用 · 重新转录 ${eff ? eff.count + ' 段' : '整篇 3 分 26 秒'}${sp && sp.on ? ` · ${Object.keys(D.speakers).length} 位说话人` : ''}`
        + `${carry && carry.lines.length ? ' · ' + carry.lines.join('；') : ''} · 41s · ${by}`,
      cleanup:  `已应用 · 写入 ${cutSum.n} 处剪辑建议 · 共 ${CUT.label(cutSum.secs)} · ${runner.agent ? '2.4s' : '6.7s'} · ${by}`,
      stale:    `已应用 · 重译 ${staleParts.join('、') || '0 句'} · ${runner.agent ? '5.3s' : '2.1s'} · ${by}`,
    }[id] + (span ? ` · 范围 ${span}` : '');

    const DIFFS = [
      {id: 'd0', para: '¶1 · 00:00', sp: '林澈',
       before: '欢迎回到码与远方我是林澈',
       after: <>欢迎回到<span className="ins">《</span>码与远方<span className="ins">》</span>，我是林澈<span className="ins">。</span></>},
      {id: 'd1', para: '¶2 · 00:07', sp: '周远',
       before: '嗯就是谢谢邀请我是周远',
       after: <><span className="del">嗯，就是，</span>谢谢邀请<span className="ins">，</span>我是周远<span className="ins">。</span></>},
      {id: 'd2', para: '¶3 · 00:16', sp: '周远',
       before: '我definately没准备好替客户做这个决定',
       after: <>我<span className="del">definately</span><span className="ins">还</span>没准备好替客户做这个决定<span className="ins">。</span></>},
    ];

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh">
          <IconBtn icon="back" size="s" tip="返回" onClick={onBack} />
          <b>{t.name}</b>
          {phase === 'run' ? <Chip tone="accent">后台运行中</Chip> : phase === 'agent' ? <Chip tone="accent">Agent 进行中</Chip> : null}
        </div>

        {phase === 'setup' ? (
          <>
            <div className="aicard">
              <b>{t.name}</b>
              {t.setup.map((l, i) => <span key={i}>{l}</span>)}
              <span className="ail__effect"><Ic n="info" className="ic--14" />{P.EFFECT[id]}</span>
            </div>
            {asr ? (
              <>
                {scope ? <ScopeBar scope={scope} onClear={clearScope} /> : null}
                <window.ToolSetup plan={{step: STEP[id]}} runner={runner} scope={tscope} onScope={pickScope} chapters={ctx.chapters}>
                  {/* 识别提示能不能用由这只语音模型说了算（§15.10 能力门）：选表 + 自定义提示词 */}
                  <window.AsrHintBlock model={model} lang={D.srcLang.code} value={asrHint} onChange={setAsrHint} />
                  {runner.agent ? <window.ToolSessionRow ctx={ctx} value={session && session.k} onChange={setSession} /> : null}
                </window.ToolSetup>
                <SecHead>语音模型</SecHead>
                <div className="sec">
                  <PRow>
                    <div style={{flex: 1, minWidth: 0}}>
                      {/* 重新转录挑的是语音模型，不是 LLM——两张表不同源，不走 ToolSetup 的云端下拉 */}
                  <Picker wide value={model.name + ' · ' + model.size} open={pop}
                    onClick={() => setPop((v) => !v)} onClose={() => setPop(false)} popWidth={280}>
                    <div className="menu__hd t-detail-xs" style={{textTransform: 'none', letterSpacing: 0}}>
                      与新建向导同一份语音模型列表
                    </div>
                    <Menu>
                      {/* 未安装的模型**不置灰**：置灰是个死胡同——它告诉你「不能用」，
                          却不给你任何把它变成能用的办法，用户只能自己猜要去设置里找。
                          这里当场给下载入口，下完自动选中（点它本来就是想用它）。 */}
                      {D.models.local.map((m) => {
                        const on = app.modelInstalled(m.id);
                        const pct = app.modelDl[m.id];
                        const dl = pct != null;
                        return (
                          <MenuItem key={m.id} label={m.name}
                            sub={dl ? `正在下载 · ${pct}%` : m.size + (on ? '' : ' · 未安装')}
                            on={m.id === model.id && on}
                            suffix={on ? null : dl
                              ? <span className="mdlbar"><i style={{width: pct + '%'}} /></span>
                              : <span className="mdlget">下载 {m.size}</span>}
                            onClick={() => {
                              if (on) { setModel(m); setPop(false); return; }
                              if (dl) return;
                              app.downloadModel(m.id);
                              setPendingModel(m);
                              app.toast(`正在下载 ${m.name} · ${m.size} · 下完自动选中`);
                            }} />
                        );
                      })}
                      <MenuRule />
                      <MenuItem icon="settings" label="管理本地模型…" sub="检查 · 依赖 · 删除 · 下载源"
                        onClick={() => { setPop(false); app.go({r: 'settings', sec: 'local'}); }} />
                    </Menu>
                  </Picker>
                    </div>
                  </PRow>
                  <window.BC_ASR_FIELDS.AsrMoreOptions model={model} pick={spPick} onPick={setSpPick} />
                </div>
              </>
            ) : (
              /* 设置态 = 放行卡正文：一句人话说清「这一步会用哪个模型对多大范围做什么」，
                 模型与范围就地可改。默认 API 直连，不需要装任何东西。 */
              <window.ToolSetup plan={{step: id === 'stale' ? {...STEP.stale, count: si.count} : STEP[id]}} runner={runner}
                pre={id === 'chapters' && pre ? '润色 42 段' : null}
                scope={tscope} onScope={pickScope} chapters={ctx.chapters}>
                {t.needsPolish ? (
                  <window.ToolOption on={pre} onChange={setPre} label="先润色一遍（自动分段）"
                    sub={pre ? '章节按段落聚合' : '还没润色过的文稿只有 1 段，章节会很粗'} />
                ) : null}
                {id === 'polish' ? (
                  <window.GlossaryOption gl={gl} on={useTerms} onChange={setUseTerms} kind="polish" />
                ) : null}
                {id === 'cleanup' ? <AICUT.CleanupOptions opts={opts} onChange={setOpts} /> : null}
                {id === 'stale' ? <AICUT.StaleOptions pick={stalePick} onChange={setStalePick} edited={3} impact={staleIm} /> : null}
                {runner.agent ? <window.ToolSessionRow ctx={ctx} value={session && session.k} onChange={setSession} /> : null}
              </window.ToolSetup>
            )}
            {/* 找可剪的口：两条路各自的引导——选谁来做之前先看清会发生什么（§15.3） */}
            {id === 'cleanup' ? <AICUT.CleanupGuide agent={runner.agent} runnerLabel={runner.cur && runner.cur.label} /> : null}
            {/* 提示词框（§5.10）：交给 Agent 时是会发出的那条消息；直接调模型时是指令，下面一行写清随它发出的上下文。
                重新转录直接跑的是本机语音模型，没有提示词，仍是一枚「开始」。 */}
            {asr && !runner.agent ? (
              <RunCta runner={runner} label={sp && sp.missing ? (waitPack ? '正在下载模型…' : '下载模型并开始') : '开始'} onStart={() => start(null)}
                hintApi="默认设置就能开始；完成后自动应用，随时可一键撤销。" />
            ) : (
              <window.ToolPrompt ctx={ctx} tool={id} runner={runner} value={prompt} onChange={setPrompt} defaultText={defaultText}
                session={session || {k: 'new'}} context={context} onStart={start}
                label={id === 'stale' ? `刷新 ${si.count} 句` : id === 'cleanup' ? '找可剪的口' : '开始'} />
            )}
          </>
        ) : null}

        {phase === 'run' ? (
          <>
            <Job title={t.name + '…'} pct={pct} stages={stages} cur={Math.min(stages.length - 1, Math.floor(pct / (104 / stages.length)))} activity={activity} />
            <div className="signpost">可先继续编辑 · 任务在后台运行，完成后自动应用并给出收据。</div>
            {fail === 'retry' ? (
              <div className="failc">
                <b>网络中断，正在自动重试（第 2 次）…</b>
                <span>重试由任务队列自动完成，不需要你操作。</span>
              </div>
            ) : null}
            {fail === 'cfg' ? (
              <div className="failc failc--cfg">
                <b>模型鉴权失败 · API Key 无效</b>
                <span>这类错误重试也不会好——去设置修一下配置。</span>
                <div><Btn variant="secondary" size="s" onClick={() => app.go({r: 'settings', sec: 'cloud'})}>去模型管理检查 API Key</Btn></div>
              </div>
            ) : null}
            <div className="hint">
              <BCAction className="stlink" onClick={() => setFail(fail === 'retry' ? 'cfg' : fail === 'cfg' ? null : 'retry')}>
                查看失败情形
              </BCAction> · 原型演示：点击在「自动重试 / 配置错误」两态间循环
            </div>
          </>
        ) : null}

        {phase === 'agent' ? (
          <AICUT.AgentRun sess={ag.sess} task={ag.task} runnerLabel={runner.cur ? runner.cur.label : 'Agent'} toolName={t.name}
            onOpen={() => app.openSession(sid)} onReset={() => { setSid(null); setPhase('setup'); }} />
        ) : null}

        {phase === 'done' ? (
          <>
            <Receipt text={jobUndone ? (id === 'cleanup' ? '已撤销 · 剪辑建议已移除 · 已接受的剪辑不受影响' : '已撤销 · 改动已还原') : receipt} undone={jobUndone}
              onUndo={() => setUndone(true)} onRedo={() => setUndone(false)}
              onAgain={start} onDone={onBack} />
            {jobUndone ? (
              <div className="aicard"><b>已撤销</b><span>「再跑一次」可重来——设置会保留，不用重新填。</span></div>
            ) : id === 'polish' ? (
              <>
                <div className="signpost">
                  逐段核对红删绿增——鼠标移到某段上可「还原本段」或直接编辑；全文已自动分成 9 段。
                </div>
                <window.GlossaryFixes rows={termRows} kept={termKept}
                  onToggle={(rid) => setTermKept((k) => ({...k, [rid]: k[rid] === false}))} />
                {DIFFS.map((d) => (
                  <div key={d.id} className={cx('difc', rev[d.id] && 'is-rev')}>
                    <div className="difh">
                      <b>{d.para}</b><span className="difsp">{d.sp}</span>
                      {rev[d.id] ? <Chip>已还原</Chip> : null}
                      <span className="spacer" />
                      <div className="difacts">
                        <BCAction className={cx('ccbtn', !rev[d.id] && 'ccbtn--revert')}
                          onClick={() => setRev((r) => ({...r, [d.id]: !r[d.id]}))}>
                          {rev[d.id] ? '重新应用' : '还原本段'}
                        </BCAction>
                        <BCAction className="ccbtn" onClick={() => app.toast('回文稿面板双击段落即可编辑')}>编辑</BCAction>
                      </div>
                    </div>
                    <div className="dift">{rev[d.id] ? d.before : d.after}</div>
                  </div>
                ))}
                {useTerms ? <window.GlossaryHarvest gl={gl} /> : null}
              </>
            ) : id === 'chapters' ? (
              <>
                <div className="signpost">点章节标题可直接改名——导出与分享页会用同一份章节。</div>
                {ctx.chapters.map((c) => (
                  <div className="chapc" key={c.id}>
                    {/* 与 Transcript 章节头共用 ChapterTitle：章节名只有一份真相 */}
                    <ChapterTitle chapter={c} size="sm" onRename={ctx.renameChapter} />
                    <span className="tm">{window.BC_TIME.timecode(c.start, {decimals: 0})}</span>
                  </div>
                ))}
                <SecHead>分布 · 旧 → 新</SecHead>
                <div className="distb"><i style={{flex: 42, background: 'var(--gray-400)'}} /><i style={{flex: 58, background: 'var(--gray-500)'}} /></div>
                <div className="distb"><i style={{flex: 35, background: 'var(--blue-900)'}} /><i style={{flex: 42, background: 'var(--blue-600)'}} /><i style={{flex: 23, background: 'var(--blue-400)'}} /></div>
                <div className="hint">2 章 → {ctx.chapters.length} 章 · 边界按段落话题重新聚合</div>
              </>
            ) : id === 'retranscribe' ? (
              <>
                {/* product-design §5.11：换用文稿——译文按原文配对结转，pin 按时间重锚，配音可能不一致；一笔可撤销 */}
                <div className="aicard">
                  <b>文稿已换成新版本</b>
                  <span>{eff ? `只重跑了${eff.label}的 ${eff.count} 段，只有范围内的句子参与配对；范围之外的词与句子一个没动。` : '整篇重跑，全部句子参与配对。'}</span>
                  {carry && carry.lines.map((l) => <span key={l}>{l}</span>)}
                </div>
                <div className="signpost">
                  原文没变的句子保留译文与审阅状态，对齐降为句级；原文变了或配不上的译文标为过期，用「刷新过期译文」重译。
                  字幕 pin 按时间重新锚定，锚不上的标 orphaned；保留下来的配音标「可能不一致」。撤销会把这些一起退回去。
                </div>
                {carry && carry.translations.some((t) => t.stale) && <div className="row gap6">
                  <Btn size="s" variant="secondary" onClick={() => ctx.requestAi('stale', null)}>刷新过期译文</Btn>
                </div>}
              </>
            ) : id === 'cleanup' ? (() => {
              // 建议只是覆盖层里的「待定」：接受前不影响播放和导出，所以这张卡随覆盖层现状走
              const sug = CUT.suggested(myCuts), act = CUT.active(myCuts);
              const toDoc = () => { ctx.setCutMode(true); ctx.setTab('transcript'); };
              return (
                <div className="aicard">
                  {sug.length ? <>
                    <b>建议剪掉 {sug.length} 处 · 共 {CUT.label(CUT.total(sug))}</b>
                    <span>{CUT.kindsText(sug)}。建议已以划线形态写进文稿与时间轴，接受前不影响播放和导出。</span>
                  </> : act.length ? <>
                    <b>已剪掉 {act.length} 处 · 共 {CUT.label(CUT.total(act))}</b>
                    <span>成片 {window.BC_TIME.timecode(ctx.outDuration, {decimals: 0})}。划掉的字点一下可以恢复。</span>
                  </> : <>
                    <b>这一批建议已处理完</b>
                    <span>没有留下待定的剪口。要再找一遍可以直接重跑。</span>
                  </>}
                  <div className="row gap6">
                    <Btn variant="secondary" size="s" onClick={toDoc}>去文稿逐条看</Btn>
                    {sug.length ? <Btn variant="accent" size="s" onClick={ctx.cutOps.acceptAll}>全部接受</Btn> : null}
                  </div>
                </div>
              );
            })() : (
              <div className="aicard">
                <b>{rs.count} 句译文已刷新</b>
                <span>{[
                  rs.edited ? `${rs.edited} 句原文改过的按新原文重译` : null,
                  rs.cut ? `${rs.cut} 句原文被剪切的按剪后原文重译${staleIm.whole && ran ? `，${staleIm.whole} 句整句剪掉的随句一起剪` : ''}` : null,
                ].filter(Boolean).join('；') || '没有需要重译的句子'}；其余一个字没动，对齐已自动重算。</span>
              </div>
            )}
            {/* 收据之下的第二出口：API 直连跑完，模型没把握的那几句交给 Agent 逐句斟酌——
                范围只带这几句，不重跑整篇。 */}
            {!jobUndone && !asr && !runner.agent && id !== 'cleanup' ? (
              <>
                <div className="aicard">
                  <b>有 3 句模型没把握</b>
                  <span>这几句按原样保留并在文稿里标了记号。可以自己改，也可以交给 Agent 逐句斟酌。</span>
                </div>
                <window.AgentHandoff lead="要逐句斟酌？" label="让 Agent 处理这 3 句"
                  onClick={() => handToAgent(app, ctx, {kind: id, scope: '模型没把握的那 3 句'})} />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    );
  }


  /* 工具页的宿主（product-design §5.10）。没有目录页：每个工具从对话的斜杠命令、所在面板的按钮
     或 Agent 的收尾话进来（ctx.requestAi），返回时回到发起它的那个 Tab（ctx.closeAi）。 */
  function AiToolsPanel({ctx}) {
    const app = useApp();
    const [open, setOpen] = useState(null);
    const [scope, setScope] = useState(null);
    const [landed, setLanded] = useState(false);
    const back = () => { setOpen(null); setScope(null); setLanded(false); };
    const cropOpen = !!app.crop.sessions[ctx.proj.id]?.open;
    const shortsOpen = !!app.shortsCut.sessions[ctx.proj.id]?.open;

    /* 接单：下单方与接单方是两个面板，中间靠编辑器状态传（ctx.aiReq），消费完立刻清掉。
       智能裁剪与剪成短视频有自己的会话面板，接到单就开会话。 */
    useEffect(() => {
      if (!ctx.aiReq) return;
      const {tool, scope: sc, agent} = ctx.aiReq;
      ctx.clearAiReq();
      /* `agent`：Agent 在会话里跑完了这件事，面板直接落在结果上（复核构图 / 挑候选 / 读成稿），不再从设置开始 */
      if (tool === 'crop') { if (!cropOpen || agent) ctx.openCrop(null, agent ? {planned: true} : {}); return; }
      if (tool === 'shortscut') {
        const at = app.shortsCut.sessions[ctx.proj.id];
        if (!shortsOpen) window.openShortsCut(app, ctx);
        if (agent && agent.sid && (!at || at.phase === 'setup')) app.shortsCut.findViaAgent(ctx.proj.id, {sid: agent.sid, sentences: ctx.cues, scope: null, runner: 'Agent'});
        return;
      }
      setOpen(TOOLS[tool] ? tool : null);
      setScope(sc);
      setLanded(!!agent);
    }, [ctx.aiReq]);
    if (cropOpen) return <window.CropPanel ctx={ctx} onBack={back} />;
    if (shortsOpen) return <window.ShortsCutPanel ctx={ctx} onBack={back} />;
    // 没打开哪一页就是列表（panel-aitools-list.jsx）；工具页的「返回」回这里
    if (!open) return <window.AiToolsList ctx={ctx} onOpen={(k) => { setOpen(k); setScope(null); setLanded(false); }} />;
    const t = TOOLS[open];
    const clearScope = () => setScope(null);
    if (t.kind === 'spk') return <div className="pview"><SpeakerFlow scope={scope} clearScope={clearScope} onBack={back} ctx={ctx} /></div>;
    if (t.kind === 'trans') return <div className="pview"><TranslateFlow onBack={back} ctx={ctx} /></div>;
    if (t.kind === 'dub') return <div className="pview"><window.DubFlow onBack={back} ctx={ctx} scope={scope} landed={landed} /></div>;
    // 写作与发布五个工具（§15.11）：写简介 / 做封面页首的「去起标题」直接换到起标题
    if (t.kind === 'wr') return <div className="pview"><window.BC_WRITEFLOWS.WriteFlow id={open} onBack={back} ctx={ctx} onOpenTool={setOpen} landed={landed} /></div>;
    return <div className="pview"><DocFlow id={open} ctx={ctx} scope={scope} clearScope={clearScope} onBack={back} /></div>;
  }

  Object.assign(window, {AiToolsPanel});
})();
