/* 剪成短视频（§15.12）工具页：设置 → 找片段 →（挑片段在 panel-aitools-shorts-pick.jsx）→ 创建中 → 完成。
   设计出发点是「人来拿主意」：切几支、每支多长、想要什么、画面怎么取景是人给的；找出来的只是候选，
   停在挑片段页等人勾选、调起止，确认了才创建。产物是项目不是成片，原项目与时间轴不动。
   会话与计时器在 store-shorts-cut.jsx，算出来的东西在 model-shorts-cut.js。 */
(function () {
  const {useState, useEffect} = React;
  const SC = window.BC_SHORTS_CUT;
  const C = window.BC_CROP;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const {TOOLS, STEP, Job, sendToAgent} = window.BC_AIFLOWS;

  const NAME = TOOLS.shortscut.name;
  const AGENT_STAGES = ['读视频与文稿', '等你放行', '找片段', '写候选库'];
  const modelSize = (id) => { const m = D.setModels.find((x) => x.id === id); return m ? m.size : 0; };
  const NO_NEED = {ok: true, list: [], missing: []};
  /* 跟着说话的人要的两只本机模型，与智能裁剪「多人对谈」是同一套 */
  const focusReady = (focus, installed) => (focus === 'speaker' ? C.readiness('podcast', 'switch', installed) : NO_NEED);
  const projectFacts = (ctx, installed) => ({
    hasTrans: ctx.cues.some((c) => !!c.trans),
    portrait: C.sourceRatio(ctx.sources.video.find((v) => !v.crop)) < 1,
  });

  function OptionRow({o, on, onClick}) {
    return (
      <BCAction type="button" className={cx('cr-scene', on && 'is-on')} choiceKey={o.id}  >

        <span className="cr-scene__t"><b>{o.name}</b><span>{o.desc}</span></span>
      </BCAction>
    );
  }

  /* 这个项目已经切出的那几支：标题、在原片里的起止、打开。 */
  function MadeList({list, onOpen}) {
    return (
      <div className="sc-made">
        {list.map((k) => (
          <div className="sc-made__row" key={k.id}>
            <span className="sc-made__t"><b className="t-truncate" title={k.title}>{k.title}</b>
              <span>{SC.usedRanges(k).map((r) => SC.spanText(r)).join('、')}</span></span>
            <Btn variant="quiet" size="s" onClick={() => onOpen(k.id)}>打开</Btn>
          </div>
        ))}
      </div>
    );
  }

  /* ---------- 设置 ---------- */
  function ShortsCutSetup({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const p = s.params;
    const set = (x) => app.shortsCut.setParams(proj, x);
    const sentences = ctx.cues;
    const kids = SC.childrenOf(app.projects, proj);
    const [more, setMore] = useState(false);
    const [showKids, setShowKids] = useState(false);
    const [pending, setPending] = useState(false);
    const [scopeOpt, setScopeOpt] = useState(null);
    const step = {...STEP.shortscut, count: sentences.length, unit: `句文稿里找 ${p.count + SC.SPARE} 段候选`};
    const runner = window.useToolRunner(step, 'shortscut');
    const ready = focusReady(p.focus, app.modelInstalled);
    const missingMb = ready.missing.reduce((a, m) => a + modelSize(m.id), 0);
    const downloading = ready.missing.some((m) => app.modelDl[m.id] != null);
    const chapter = scopeOpt && scopeOpt.k !== 'all' ? ctx.chapters.find((c) => c.id === scopeOpt.k) : null;
    const scope = chapter ? {k: chapter.id, label: chapter.title, start: chapter.start, end: chapter.end} : null;
    const lenNote = SC.lengthNote(p.length);

    const go = () => {
      if (runner.agent) {
        /* 交给 Agent（§5.10）：面板收起回到列表、那条会话到眼前；找片段在会话里进行，
           store 按会话进度倒推，找好后 Agent 收尾把人带回挑片段页 */
        const sess = sendToAgent(app, ctx, runner.cur, {kind: 'shortscut',
          extra: SC.agentExtra(p, {scopeName: scope ? scope.label : null, children: kids.length})});
        app.shortsCut.findViaAgent(proj, {sid: sess.id, sentences, scope, runner: runner.cur.label});
        onBack();
        return;
      }
      app.shortsCut.find(proj, {title: ctx.proj.title, sentences, scope, runner: runner.apiModel ? runner.apiModel.name : runner.cur.label});
    };
    const start = () => {
      if (ready.ok) { go(); return; }
      ready.missing.forEach((m) => app.downloadModel(m.id));
      setPending(true);
    };
    useEffect(() => { if (pending && ready.ok) { setPending(false); go(); } }, [pending, ready.ok]);

    if (!sentences.length) {
      return (
        <div className="pscroll bc-scroll">
          <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b></div>
          <div className="aicard aicard--warn">
            <b>先要有文稿才能找片段</b>
            <span>找片段读的是文稿：哪几句话连起来能单独成立。转录完再回到这里。</span>
          </div>
          <div className="flowcta"><Btn variant="accent" style={{width: '100%'}} onClick={() => ctx.requestAi('retranscribe', null)}>去转录</Btn></div>
        </div>
      );
    }

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b></div>
        <div className="aicard">
          <b>挑几段能单独成立的话，各做成一支短视频</b>
          <span>先给你看候选，你挑好了才创建。原视频不动。</span>
        </div>
        {kids.length ? (
          <>
            <BCAction type="button" className="cr-more sc-kids" onClick={() => setShowKids((v) => !v)} aria-expanded={showKids}>
              <Ic n={showKids ? 'chevdown' : 'chevright'} className="ic--14" /><span>已经切过 {kids.length} 支</span>
              {!showKids ? <em>查看</em> : null}
            </BCAction>
            {showKids ? <MadeList list={kids} onOpen={(id) => app.go({r: 'editor', id})} /> : null}
          </>
        ) : null}

        <window.ToolSetup plan={{step}} runner={runner} scope={scopeOpt} onScope={setScopeOpt} chapters={ctx.chapters}>
          {kids.length ? (
            <window.ToolOption on={p.skipDone} onChange={(v) => set({skipDone: v})} label="已经切过的不再找"
              sub={p.skipDone ? `跳过那 ${kids.length} 支用到的区间` : '照找，候选卡上标「已切过」'} />
          ) : null}
        </window.ToolSetup>

        <SecHead aside={SC.summaryLine(p)}>切成什么样</SecHead>
        <div className="sec">
          <PRow label="切几支">
            <Stepper value={p.count} onDec={() => set({count: p.count - 1})} onInc={() => set({count: p.count + 1})}
              disabledDec={p.count <= SC.COUNT.min} disabledInc={p.count >= SC.COUNT.max} decTip="少一支" incTip="多一支" />
            <span className="t-detail">会多找 {SC.SPARE} 段备选</span>
          </PRow>
          <PRow label="每支多长">
            <Segmented size="s" value={p.length} onChange={(v) => set({length: v})} items={SC.LENGTHS.map((l) => ({k: l.id, label: l.name}))} />
          </PRow>
          {lenNote ? <div className="hint">{lenNote}。</div> : null}
          <div className="sc-note">
            <span className="sc-note__lb">想要什么<em>可以不填</em></span>
            <Field area rows={2} value={p.note} placeholder="比如：只要讲成本的那几段；要有明确结论的"
              onChange={(e) => set({note: e.target.value})} />
          </div>
        </div>

        {s.facts.portrait ? null : (
          <>
            <SecHead aside="16:9 → 9:16">画面怎么取景</SecHead>
            <BCChoiceGroup className="sec cr-scenes" value={p.focus} onChange={focus => set({focus})} aria-label="画面怎么取景">
              {SC.FOCUS.map((f) => <OptionRow key={f.id} o={f} on={p.focus === f.id} onClick={() => set({focus: f.id})} />)}
            </BCChoiceGroup>
            {p.focus === 'speaker' ? (
              <div className="sec cr-models">
                {ready.list.map((m) => {
                  const pct = app.modelDl[m.id];
                  return (
                    <div className="cr-model" key={m.id}>
                      <Ic n={m.ok ? 'ok' : 'download'} className={cx('ic--14', m.ok ? 'is-ok' : 'is-need')} />
                      <span className="cr-model__t"><b>{m.name}</b><span>{m.what}</span></span>
                      {pct != null ? <span className="mdlbar"><i style={{width: pct + '%'}} /></span>
                        : <span className="t-detail t-mono">{m.ok ? '已就绪' : C.sizeText(modelSize(m.id))}</span>}
                    </div>
                  );
                })}
                <div className="hint">{ready.ok ? '认人在本机跑，视频不上传。' : `还缺 ${ready.missing.map((m) => m.name).join('、')}，先下载 ${C.sizeText(missingMb)}，之后离线可用。不想下载就选居中。`}
                  {' '}<BCAction className="stlink" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'vision'})}>管理本地模型</BCAction></div>
              </div>
            ) : null}
          </>
        )}

        <SecHead>字幕</SecHead>
        <div className="sec">
          {s.facts.hasTrans ? (
            <PRow label="带哪几轨">
              <Segmented size="s" value={p.tracks} onChange={(v) => set({tracks: v})} items={SC.TRACKS.map((t) => ({k: t.id, label: t.name}))} />
            </PRow>
          ) : <div className="hint sc-flat">只有原文 · 这部视频还没有译文。</div>}
          <BCChoiceGroup className="cr-scenes" value={p.style} onChange={style => set({style})} aria-label="字幕样式">
            {SC.STYLES.map((t) => <OptionRow key={t.id} o={t} on={p.style === t.id} onClick={() => set({style: t.id})} />)}
          </BCChoiceGroup>
        </div>

        <BCAction type="button" className="cr-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <Ic n={more ? 'chevdown' : 'chevright'} className="ic--14" /><span>更多设置</span>
          {!more ? <em>{p.hook ? '开头要抓人' : '开头不挑'} · {p.crossChapter ? '可以跨章' : '不跨章'}</em> : null}
        </BCAction>
        {more ? (
          <div className="sec sc-opts">
            <Checkbox on={p.hook} onChange={(v) => set({hook: v})} label="开头要抓人" />
            <div className="hint sc-flat">候选尽量从一句能单独成立的话起，不从半句话、不从「所以」起。</div>
            <Checkbox on={p.crossChapter} onChange={(v) => set({crossChapter: v})} label="可以跨章" />
            <div className="hint sc-flat">关着时一段不会跨过章节边界。</div>
          </div>
        ) : null}

        <div className="flowcta">
          <Btn variant="accent" style={{width: '100%'}} onClick={start} disabled={downloading || pending}>
            {downloading || pending ? '正在下载模型…' : !ready.ok ? `下载并开始 · ${C.sizeText(missingMb)}` : runner.agent ? '交给 Agent' : '开始找片段'}
          </Btn>
        </div>
        <div className="hint">{runner.agent ? '会在左侧会话里进行，这一页留在原地等候选。' : ''}先找片段、再让你挑，最后才创建视频。原视频和时间轴都不会动。</div>
      </div>
    );
  }

  /* ---------- 找片段中 / 创建中 ---------- */
  function ShortsCutRunning({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const finding = s.phase === 'finding';
    const chat = s.via === 'agent' && finding ? app.sessions.find((x) => x.id === s.sid) || null : null;
    const task = app.tasks.find((t) => t.id === (s.taskId || (chat && chat.taskId))) || null;
    const prog = chat ? AG.sessionProgress(chat, task) : null;
    const pct = prog ? prog.pct : task ? task.pct || 0 : s.pct || 0;
    const stages = prog ? AGENT_STAGES : finding ? SC.FIND_STAGES : SC.CREATE_STAGES;
    const n = s.making || SC.chosen(s.list).length;
    const per = finding ? 0 : ((pct || 0) / 100 * n) % 1 * 100;
    const cur = prog ? prog.cur : finding ? SC.stageAt(stages, pct) : SC.stageAt(stages, per);
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b><Chip tone="accent">后台运行中</Chip></div>
        {prog ? (
          <div className="aicard">
            <b>已交给 {s.runner}</b>
            <span>在左侧会话里进行。它只写候选库，写之前会先问你。</span>
          </div>
        ) : null}
        <Job title={finding ? `正在「${ctx.proj.title}」里找片段…` : `正在创建 ${SC.countLabel(n)}…`} pct={pct} stages={stages} cur={cur}
          activity={prog ? prog.note : task ? task.activity : null} />
        {prog && prog.waiting ? (
          <div className="aicard aicard--warn">
            <b>等你在会话里放行</b>
            <span>它只会写候选库，不创建视频。放行后候选会出现在这一页。</span>
            <div><Btn variant="accent" size="s" onClick={() => app.openSession(s.sid)}>去会话放行</Btn></div>
          </div>
        ) : null}
        <div className="aicard">
          <b>{finding ? '找完先给你挑' : '每支一部新视频'}</b>
          <span>{finding
            ? `${SC.summaryLine(s.params)}${s.scope ? ` · 只在「${s.scope.label}」里找` : ''}。找完停在「挑片段」，你确认后才创建视频。`
            : '每支引用同一份原片，不复制视频。创建期间可以继续剪辑，原视频不动。'}</span>
        </div>
        <div className="signpost">可先切到别处 · 任务在后台跑，这里和后台任务页都能回来。</div>
        <div className="flowcta sc-row">
          {chat ? <Btn variant="secondary" icon="agent" onClick={() => app.openSession(s.sid)}>打开会话</Btn> : null}
          <Btn variant="secondary" onClick={() => app.shortsCut.cancel(proj)}>{finding ? '取消' : '取消创建'}</Btn>
        </div>
      </div>
    );
  }

  /* ---------- 完成 ---------- */
  function ShortsCutDone({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const made = s.made.map((id) => app.projById(id)).filter(Boolean);
    const gone = s.made.length - made.length;
    const left = SC.visible(s.list).filter((c) => !SC.doneBy(c, made)).length;
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b><Chip tone="positive">已创建</Chip></div>
        <div className="aplbar">
          <div className="aplbar__msg"><Ic n="ok" className="ic--16" style={{color: 'var(--green-1000)'}} />
            <b>已创建 {s.made.length} 支短视频 · 合计 {SC.mmss(s.madeTotal)}</b></div>
        </div>
        <div className="sec sc-done">
          {made.map((m) => {
            const seg = {start: m.origin.in, end: m.origin.out};
            const chk = SC.checkLine(seg);
            return (
              <div className="sc-done__row" key={m.id}>
                <span className="sc-done__pic" aria-hidden="true"><Ic n="video" className="ic--14" /></span>
                <span className="sc-done__t">
                  <b className="t-truncate" title={m.title}>{m.title}</b>
                  <span>{SC.spanText(seg)}</span>
                  <span className={cx('sc-done__chk', `is-${chk.tone}`)}>发布前检查 · {chk.text}</span>
                </span>
                <Btn variant="secondary" size="s" onClick={() => app.go({r: 'editor', id: m.id})}>打开</Btn>
              </div>
            );
          })}
          {gone ? <div className="hint sc-flat">有 {gone} 支已经删掉了。</div> : null}
        </div>
        <div className="hint">原视频没有被改动。不要哪一支，在 Space 里把它移入回收站就行。</div>

        <SecHead>接下来</SecHead>
        <div className="sec cr-next">
          {made.length ? (
            <BCAction className="drill" onClick={() => app.go({r: 'editor', id: made[0].id})}>
              <span className="ic2"><Ic n="play" className="ic--16" /></span>
              <span className="tt"><b>打开第一支</b><span>{made[0].title} · 接着剪、改字幕、导出</span></span>
              <NavChevron style={{color: 'var(--gray-500)'}} />
            </BCAction>
          ) : null}
          <BCAction className="drill" onClick={() => app.go({r: 'projects', from: proj})}>
            <span className="ic2"><Ic n="folder" className="ic--16" /></span>
            <span className="tt"><b>在 Space 里看这几支</b><span>按来源筛好 ·「{ctx.proj.title}」切出的短视频</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
          <BCAction className="drill" onClick={() => app.shortsCut.again(proj)}>
            <span className="ic2"><Ic n="split" className="ic--16" /></span>
            <span className="tt"><b>再切几支</b><span>{left ? `还有 ${left} 段候选没用 · 刚创建的会标「已切过」` : '回到挑片段页，再找几段或自己加一段'}</span></span>
            <NavChevron style={{color: 'var(--gray-500)'}} />
          </BCAction>
        </div>
      </div>
    );
  }

  function ShortsCutPanel({ctx, onBack}) {
    const app = useApp();
    const s = app.shortsCut.sessions[ctx.proj.id];
    const back = () => { app.shortsCut.close(ctx.proj.id); if (onBack) onBack(); };
    if (!s) return null;
    if (s.phase === 'setup') return <ShortsCutSetup ctx={ctx} s={s} onBack={back} />;
    if (s.phase === 'finding' || s.phase === 'creating') return <ShortsCutRunning ctx={ctx} s={s} onBack={back} />;
    if (s.phase === 'review') return <window.ShortsCutPick ctx={ctx} s={s} onBack={back} />;
    return <ShortsCutDone ctx={ctx} s={s} onBack={back} />;
  }

  /* AI 工具列表里那一行的副标题：会话没开着也能看见它到哪一步了。 */
  function shortsCutListStatus(app, projId, fallback) {
    const s = app.shortsCut.sessions[projId];
    const task = s ? app.tasks.find((t) => t.id === s.taskId) : null;
    return SC.listStatus(s && task && (s.phase === 'finding' || s.phase === 'creating') ? {...s, pct: task.pct || 0} : s,
      fallback, SC.childrenOf(app.projects, projId).length);
  }
  const openShortsCut = (app, ctx) => app.shortsCut.open(ctx.proj.id, projectFacts(ctx, app.modelInstalled));
  /* 视频 Tab「切出的短视频」那一组的两个入口（shorts-source.jsx，只在 App 调）：再切几支、调整后再生成。 */
  function shortsCutMore(app, ctx) {
    openShortsCut(app, ctx);
    ctx.requestAi('shortscut', null);
  }
  function shortsCutRedo(app, ctx, child) {
    const r = app.shortsCut.redo(ctx.proj.id, child, {...projectFacts(ctx, app.modelInstalled), sentences: ctx.cues});
    if (r.busy) app.toast(r.busy === 'finding' ? '正在找片段 · 找完或取消之后再重做这一支' : '正在创建 · 创建完或取消之后再重做这一支', 'notice');
    else if (!r.ok) { app.toast('这部视频还没有文稿，先转录再重做', 'notice'); return r; }
    else if (r.plan === 'append') app.toast(r.kept ? `「${child.title}」已接在候选后面 · 取景和字幕跟勾上的几支用同一套` : `「${child.title}」已接在候选后面`, 'positive');
    ctx.requestAi('shortscut', null);
    return r;
  }

  Object.assign(window, {ShortsCutPanel, shortsCutListStatus, openShortsCut, shortsCutMore, shortsCutRedo, shortsCutFocusReady: focusReady, shortsCutModelSize: modelSize});
})();
