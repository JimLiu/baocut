/* 剪成短视频（§5.10）工具页：设置 → 进行中 → 结果（panel-aitools-shorts-result.jsx）。
   只交给 Agent，而且总是新开一条会话：在那里找片段、找到就创建成视频，要几支建几支，不停下来等人挑。
   人在设置页给的是要几支、每支多长（缺省都是「自动」：Agent 找出好话题，每个话题剪完整，几支、多长按话题定）、
   画幅与取景、字幕；结果页上逐支打开、改标题、删掉不要的。
   产物是项目不是成片：每支一部新视频，引用同一份原片，原视频和时间轴不动。
   会话在 store-shorts-cut.jsx，算出来的东西在 model-shorts-cut.js。
   会话挂在来源视频上：在一支子视频里打开，看见的是来源视频那一轮的结果页（`SC.hostId`，§5.10）。 */
(function () {
  const {useState} = React;
  const SC = window.BC_SHORTS_CUT;
  const C = window.BC_CROP;
  const AG = window.BC_AGENT;
  const P = window.BC_AIPROMPT;
  const {TOOLS, STEP, Job, sendToAgent} = window.BC_AIFLOWS;

  const NAME = TOOLS.shortscut.name;
  const AGENT_STAGES = ['读视频与文稿', '等你放行', '找片段', '创建视频'];
  const HINT = '新开一条会话，在那里找片段并创建视频；原视频和时间轴不动。';
  /* 会话挂在哪部视频上：子视频回到它的来源视频（找片段读的也是来源视频的整份文稿，两者共用）。 */
  const hostOf = (app, ctx) => app.projById(SC.hostId(ctx.proj)) || ctx.proj;
  const projectFacts = (ctx) => ({
    hasTrans: ctx.cues.some((c) => !!c.trans),
    speakers: new Set(ctx.cues.map((c) => c.sp).filter(Boolean)).size,
    portrait: C.sourceRatio(ctx.sources.video.find((v) => !v.crop)) < 1,
  });

  function OptionRow({o, on, disabled}) {
    return (
      <BCAction type="button" className={cx('cr-scene', on && 'is-on')} choiceKey={o.id} disabled={disabled}>
        <span className="cr-scene__t"><b>{o.name}</b><span>{disabled && o.off ? o.off : o.desc}</span></span>
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

  /* 切几支：自动（缺省，够格的话题有几个建几支）或 1–10 支。 */
  function CountPick({p, set}) {
    const [pop, setPop] = useState(false);
    const cur = SC.clampCount(p.count);
    return (
      <PRow label="切几支">
        <Picker size="s" value={SC.countName(cur)} open={pop} popWidth={200}
          onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
          <Menu>
            {SC.COUNTS.map((c) => (
              <MenuItem key={c.id} label={c.name} on={c.id === cur} onClick={() => { set({count: c.id}); setPop(false); }} />
            ))}
          </Menu>
        </Picker>
      </PRow>
    );
  }

  /* 每支多长：自动（缺省，长度就是话题的长度）、四档预设 + 自定义（两头各填秒数，1–600）。
     不设上限，平台时长只在导出前检查里说。 */
  function LengthPick({p, set}) {
    const [pop, setPop] = useState(false);
    const cur = SC.lengthRange(p);
    const preset = SC.lengthOf(p.length);
    return (
      <>
        <PRow label="每支多长">
          <Picker size="s" value={preset.name} open={pop} popWidth={200}
            onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
            <Menu>
              {SC.LENGTHS.map((l) => (
                <MenuItem key={l.id} label={l.name} on={l.id === preset.id}
                  onClick={() => {
                    /* 从自动切到自定义时没有眼下的区间，沿用上次填的两头 */
                    set(l.id === 'custom' ? {length: 'custom', lenMin: cur.min == null ? p.lenMin : cur.min, lenMax: cur.max == null ? p.lenMax : cur.max} : {length: l.id});
                    setPop(false);
                  }} />
              ))}
            </Menu>
          </Picker>
        </PRow>
        {preset.id === 'custom' ? (
          <PRow label="自定义">
            <NumField value={cur.min} digits={0} step={1} min={SC.CUSTOM.min} max={SC.CUSTOM.max} unit="秒" tip="最短" onChange={(v) => set({lenMin: v})} />
            <span className="t-detail">到</span>
            <NumField value={cur.max} digits={0} step={1} min={SC.CUSTOM.min} max={SC.CUSTOM.max} unit="秒" tip="最长" onChange={(v) => set({lenMax: v})} />
          </PRow>
        ) : null}
      </>
    );
  }

  /* ---------- 设置 ---------- */
  function ShortsCutSetup({ctx, s, onBack}) {
    const app = useApp();
    const host = hostOf(app, ctx);
    const proj = host.id;
    const p = s.params;
    const set = (x) => app.shortsCut.setParams(proj, x);
    const sentences = ctx.cues;
    const kids = SC.childrenOf(app.projects, proj);
    const [more, setMore] = useState(false);
    const [showKids, setShowKids] = useState(false);
    /* 提示词框里改过的话记在会话里：从结果页返回参数页时还在（§5.10）；null 表示没改过，跟着模板走 */
    const prompt = s.prompt == null ? null : s.prompt;
    const setPrompt = (v) => app.shortsCut.set(proj, {prompt: v});
    /* 「当前选区」：文稿里正选着一段，或宿主（Transcript 选区下的单）带着范围进来时才有这一项 */
    const selRange = ctx.cutSel && ctx.cutSel.end > ctx.cutSel.start ? ctx.cutSel : s.hostScope;
    const selOpt = selRange ? {k: 'sel', label: '当前选区', start: selRange.start, end: selRange.end,
      count: sentences.filter((c) => c.start >= selRange.start - 0.05 && c.end <= selRange.end + 0.05).length} : null;
    const [scopeOpt, setScopeOpt] = useState(() => (s.hostScope ? selOpt : null));
    const step = {...STEP.shortscut, count: sentences.length, unit: '句文稿里找片段并创建视频'};
    /* 只交给 Agent：「用」那一行不出现；这一页之前记着直接调模型的，也照样按 Agent 走 */
    const base = window.useToolRunner(step, 'shortscut');
    const agentItem = (base.groups.find((g) => g.kind === 'agent') || {items: []}).items[0];
    const cur = base.cur && base.cur.kind === 'agent' ? base.cur
      : (agentItem || {k: 'agent', kind: 'agent', label: app.harness ? app.harness.name : '编码 Agent', ready: false});
    const runner = {...base, cur, agent: true, apiModel: null};
    const chapter = scopeOpt && scopeOpt.k !== 'all' && scopeOpt.k !== 'sel' ? ctx.chapters.find((c) => c.id === scopeOpt.k) : null;
    const scope = chapter ? {k: chapter.id, label: chapter.title, start: chapter.start, end: chapter.end}
      : scopeOpt && scopeOpt.k === 'sel' ? {k: 'sel', label: `当前选区 ${SC.spanText(scopeOpt)}`, start: scopeOpt.start, end: scopeOpt.end} : null;
    const scopeName = chapter ? chapter.title.replace(/^第 \d+ 章 · /, '') : scope ? scope.label : null;
    const defaultText = P.template('shortscut', AG.intentPrompt({kind: 'shortscut', scope: scopeName}, host),
      {extra: SC.agentExtra(p, {children: kids.length}).concat(window.BC_WRTOPIC.shortsExtra(p.topic))});
    const showFocus = p.ratio !== 'source' && !(s.facts.portrait && p.ratio === '9:16');

    const start = (payload) => {
      /* 没有可用的编码 Agent：主按钮不置灰，按下时说清楚并带去设置（同 handToAgent） */
      if (!app.harness) { app.toast('还没有可用的编码 Agent · 连接后就能把这件事交给它'); app.go({r: 'settings', sec: 'agent'}); return; }
      /* 面板收起回到列表、新开的那条会话到眼前；进度从会话倒推，收据一到就建好、落到结果页 */
      const sess = sendToAgent(app, ctx, runner.cur, {text: payload.text}, onBack,
        {attachments: payload.attachments, mode: payload.mode, effort: payload.effort});
      app.shortsCut.findViaAgent(proj, {sid: sess ? sess.id : null, sentences, scope, runner: runner.cur.label});
    };

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
          <b>找出最值得单独发布的话题，各剪成一支完整的短视频</b>
          <span>交给 Agent 去找：每个话题从开头能抓人的那句剪到讲完，找到就直接创建。每支一部新视频，引用同一份原片。原视频不动。</span>
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

        <window.ToolSetup plan={{step}} runner={runner} agentOnly scope={scopeOpt} onScope={setScopeOpt} chapters={ctx.chapters}
          scopes={selOpt ? [selOpt] : null}>
          {kids.length ? (
            <window.ToolOption on={p.skipDone} onChange={(v) => set({skipDone: v})} label="已经切过的不再找"
              sub={p.skipDone ? `跳过那 ${kids.length} 支用到的区间` : '照找，可能和切过的几支重叠'} />
          ) : null}
          {/* 主题（embedding-integration §2.8）：可空；写了就先由本机圈出讲这件事的片段 */}
          <window.BC_WRTOPIC.ShortsTopicRow value={p.topic || ''} onChange={(v) => set({topic: v})} />
        </window.ToolSetup>

        <SecHead aside={SC.summaryLine(p)}>切成什么样</SecHead>
        <div className="sec">
          <CountPick p={p} set={set} />
          <LengthPick p={p} set={set} />
          {SC.autoHint(p) ? <div className="hint sc-flat">{SC.autoHint(p)}</div> : null}
          <PRow label="画幅">
            <Segmented size="s" value={p.ratio} onChange={(v) => set({ratio: v})} items={SC.RATIOS.map((r) => ({k: r.id, label: r.name}))} />
          </PRow>
        </div>

        {showFocus ? (
          <>
            <SecHead aside={`原画幅 → ${SC.ratioOf(p.ratio).name}`}>画面怎么取景</SecHead>
            <BCChoiceGroup className="sec cr-scenes" value={p.focus} onChange={(focus) => set({focus})} aria-label="画面怎么取景">
              {SC.FOCUS.map((f) => <OptionRow key={f.id} o={f} on={p.focus === f.id} disabled={!SC.focusOpen(f, s.facts)} />)}
            </BCChoiceGroup>
            {/* 多人全景时分屏（docs/design/shorts-framing §8.1）：自动与跟着说话的人才有，自己定的取景每支只有一个位置 */}
            {SC.splitApplies(p.focus) ? (
              <div className="sec">
                <window.ToolOption on={p.split} onChange={(v) => set({split: v})} label={SC.SPLIT.label}
                  sub={!p.split ? SC.SPLIT.off : p.focus === 'speaker' ? SC.SPLIT.speakerOn : SC.SPLIT.on} />
              </div>
            ) : null}
          </>
        ) : null}

        <SecHead>字幕</SecHead>
        <div className="sec">
          {s.facts.hasTrans ? (
            <PRow label="带哪几轨">
              <Segmented size="s" value={p.tracks} onChange={(v) => set({tracks: v})} items={SC.TRACKS.map((t) => ({k: t.id, label: t.name}))} />
            </PRow>
          ) : <div className="hint sc-flat">只有原文 · 这部视频还没有译文。</div>}
          <BCChoiceGroup className="cr-scenes" value={p.style} onChange={(style) => set({style})} aria-label="字幕样式">
            {SC.STYLES.map((t) => <OptionRow key={t.id} o={t} on={p.style === t.id} />)}
          </BCChoiceGroup>
        </div>

        <BCAction type="button" className="cr-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <Ic n={more ? 'chevdown' : 'chevright'} className="ic--14" /><span>更多设置</span>
          {!more ? <em>{p.hook ? '开头要抓人' : '开头不挑'} · {p.crossChapter ? '可以跨章' : '不跨章'}</em> : null}
        </BCAction>
        {more ? (
          <div className="sec sc-opts">
            <Checkbox on={p.hook} onChange={(v) => set({hook: v})} label="开头要抓人" />
            <div className="hint sc-flat">尽量从一句能单独成立的话起，不从半句话、不从「所以」起。</div>
            <Checkbox on={p.crossChapter} onChange={(v) => set({crossChapter: v})} label="可以跨章" />
            <div className="hint sc-flat">关着时一段不会跨过章节边界。</div>
          </div>
        ) : null}

        <window.ToolPrompt ctx={ctx} tool="shortscut" runner={runner} value={prompt} onChange={setPrompt} defaultText={defaultText}
          session={{k: 'new'}} hint={HINT} onStart={start} />
      </div>
    );
  }

  /* ---------- 进行中：找片段 → 创建视频，进度从那条会话倒推 ---------- */
  function ShortsCutRunning({ctx, s, onBack}) {
    const app = useApp();
    const host = hostOf(app, ctx);
    const proj = host.id;
    const chat = app.sessions.find((x) => x.id === s.sid) || null;
    const task = app.tasks.find((t) => t.id === (s.taskId || (chat && chat.taskId))) || null;
    const prog = chat ? AG.sessionProgress(chat, task) : null;
    const pct = prog ? prog.pct : s.pct || 0;
    const cur = prog ? prog.cur : SC.stageAt(AGENT_STAGES, pct);

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>{NAME}</b><Chip tone="accent">后台运行中</Chip></div>
        <div className="aicard">
          <b>已交给 {s.runner || 'Agent'}</b>
          <span>在新开的那条会话里进行。找到就直接创建，创建前会先问你一次。</span>
        </div>
        <Job title={s.stage === 'create' ? SC.creatingTitle(s.params.count) : `正在「${host.title}」里找片段…`} pct={pct}
          stages={AGENT_STAGES} cur={cur} activity={prog ? prog.note : task ? task.activity : null} />
        {prog && prog.waiting ? (
          <div className="aicard aicard--warn">
            <b>等你在会话里放行</b>
            <span>{SC.createNote(s.params.count)}</span>
            <div><Btn variant="accent" size="s" onClick={() => app.openSession(s.sid)}>去会话放行</Btn></div>
          </div>
        ) : null}
        <div className="aicard">
          <b>每支一部新视频</b>
          <span>{`${SC.summaryLine(s.params)}${s.scope ? ` · 只在「${s.scope.label}」里找` : ''}。做完直接落到结果页，逐支打开来看。`}</span>
        </div>
        <div className="signpost">可先切到别处 · 任务在后台跑，这里和后台任务页都能回来。</div>
        <div className="flowcta sc-row">
          {chat ? <Btn variant="secondary" icon="agent" onClick={() => app.openSession(s.sid)}>打开会话</Btn> : null}
          <Btn variant="secondary" onClick={() => app.shortsCut.cancel(proj)}>取消</Btn>
        </div>
      </div>
    );
  }

  function ShortsCutPanel({ctx, onBack}) {
    const app = useApp();
    const host = hostOf(app, ctx);
    const s = app.shortsCut.sessions[host.id];
    const back = () => { app.shortsCut.close(host.id); if (onBack) onBack(); };
    if (!s) return null;
    if (s.phase === 'running') return <ShortsCutRunning ctx={ctx} s={s} onBack={back} />;
    /* 结果页的「返回」回到参数页，设置与提示词保留（§5.10） */
    if (s.phase === 'result') return <window.ShortsCutResult ctx={ctx} s={s} host={host} onBack={() => app.shortsCut.toSetup(host.id)} />;
    return <ShortsCutSetup ctx={ctx} s={s} onBack={back} />;
  }

  /* AI 工具列表里那一行的副标题：会话没开着也能看见它到哪一步了。 */
  function shortsCutListStatus(app, projId, fallback) {
    const id = SC.hostId(app.projById(projId)) || projId;
    return SC.listStatus(app.shortsCut.sessions[id], fallback, SC.childrenOf(app.projects, id).length);
  }
  const openShortsCut = (app, ctx) => app.shortsCut.open(SC.hostId(ctx.proj), projectFacts(ctx));
  /* 视频 Tab「切出的短视频」那一组的两个入口（shorts-source.jsx，只在 App 调）：再切几支、调整后再生成。 */
  function shortsCutMore(app, ctx) {
    openShortsCut(app, ctx);
    ctx.requestAi('shortscut', null);
  }
  function shortsCutRedo(app, ctx, child) {
    const r = app.shortsCut.redo(ctx.proj.id, child, {...projectFacts(ctx), sentences: ctx.cues});
    if (r.busy) app.toast('正在剪成短视频 · 做完或取消之后再重做这一支', 'notice');
    else if (!r.ok) { app.toast('这部视频还没有文稿，先转录再重做', 'notice'); return r; }
    ctx.requestAi('shortscut', null);
    return r;
  }

  Object.assign(window, {ShortsCutPanel, shortsCutListStatus, openShortsCut, shortsCutMore, shortsCutRedo});
})();
