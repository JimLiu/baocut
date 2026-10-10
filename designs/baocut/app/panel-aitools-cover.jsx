/* AI 工具 · 做封面 —— §15.11.5（AI 工具重设计 §7 / §8.3，2026-09-28）。
   设置态：要说的一件事、画幅、出几张、封面上的字、风格、可以用的路线、关键帧条。
   缺省交给 Agent（STEP.cover.prefer，同「找可剪的口」）：封面要看图、写合成代码，直接调模型做不了（裁决 D3 不做一键封面）；
   没有 Agent 的人在关键帧条上点「直接用这一帧」，登记成一张视频画面候选，不用模型。
   交给 Agent 后留在这一页：画廊里候选一张一张出现，上方一行写现在在哪一步（真产品靠监视 <项目>/cover/，原型用计时器演示）。
   画廊一行两张；选用同一时刻只有一张；照这张再改的新稿登记在原来那张旁边。画面由 panel-aitools-cover-art.jsx 用 SVG 画。 */
(function () {
  const {useState, useEffect} = React;
  const W = window.BC_WRITING;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const IM = window.BC_CLOUD_IMAGE;
  const {TOOLS, STEP, sendToAgent} = window.BC_AIFLOWS;
  const P = window.BC_AIPROMPT;
  const WF = window.BC_WRITEFLOWS;
  const {CoverArt, FrameArt} = window.BC_COVERART;

  /* 演示用的封面字（按封面语言；没有样张的语言回落，见 DemoLangNote） */
  const PHRASES = {
    zh: {text: ['本机更快', '语音不出门', '断网也能转', '不用上传'], sub: '科浪电台 · 第 42 期'},
    en: {text: ['Faster offline', 'Audio stays home', 'Works offline', 'No upload'], sub: 'Kelang · Ep. 42'},
  };
  const RATIO_LABEL = {project: '跟视频画布', '16:9': '16:9', '9:16': '9:16', '1:1': '1:1', '4:3': '4:3'};

  /* ---------- Agent 做封面的演示进程（挂在模块上，离开这一页也接着跑） ---------- */
  const timers = {};
  function startRun(pid, plan, sid) {
    const set = (fn) => WF.setWriting(pid, fn);
    clearTimeout(timers[pid]);
    let step = 0;
    let made = 0;
    set(() => ({coverRun: {step: 0, made: 0, total: plan.length, sid}}));
    const patch = (p) => set((c) => ({coverRun: Object.assign({}, c.coverRun, p)}));
    const tick = () => {
      if (step < 2) { step += 1; patch({step}); timers[pid] = setTimeout(tick, 700); return; }
      if (made < plan.length) {
        const c = plan[made];
        made += 1;
        set((cur) => ({covers: W.addCover(cur.covers, c), coverRun: Object.assign({}, cur.coverRun, {step: made % 2 ? 3 : 4, made})}));
        timers[pid] = setTimeout(tick, 1000);
        return;
      }
      patch({step: 5});
      timers[pid] = setTimeout(() => set(() => ({coverRun: null})), 900);
    };
    timers[pid] = setTimeout(tick, 600);
  }
  function startRevise(pid, id, note) {
    WF.setWriting(pid, (c) => ({revising: Object.assign({}, c.revising, {[id]: true})}));
    setTimeout(() => WF.setWriting(pid, (c) => ({covers: W.reviseCover(c.covers, id, note),
      revising: Object.assign({}, c.revising, {[id]: false})})), 1600);
  }

  /* ---------- 关键帧条 ---------- */
  function FrameStrip({frames, sel, onSel, onAddNow, onPin, onUse}) {
    const f = frames.find((x) => x.t === sel) || frames[0];
    return (
      <div className="cvframes">
        <div className="cvframes__strip bc-scroll">
          {frames.map((x) => (
            <BCAction key={x.t} className={cx('cvfr', x.t === f.t && 'is-sel', x.pinned && 'is-pinned')} onClick={() => onSel(x.t)}
              aria-label={`${W.mmss(x.t)}${x.pinned ? ' · 已钉住' : ''}`}>
              <FrameArt f={x} className="cvfr__img" />
              <span className="cvfr__t">{W.mmss(x.t)}</span>
              {x.pinned ? <span className="cvfr__pin"><Ic n="check" className="ic--14" /></span> : null}
            </BCAction>
          ))}
        </div>
        {f ? (
          <div className="cvframes__sel">
            <span className="t-detail-xs grow">{`${W.mmss(f.t)} · ${f.why}${f.people ? ` · ${f.people} 人` : ''}`}</span>
            <BCAction className="ccbtn" onClick={() => onPin(f.t)}>{f.pinned ? '取消钉住' : '钉住'}</BCAction>
            <BCAction className="ccbtn" onClick={() => onUse(f)}>直接用这一帧</BCAction>
          </div>
        ) : null}
        <div className="chiprow cvframes__foot">
          <BCAction className="ccbtn" onClick={onAddNow}>加上当前画面</BCAction>
          <span className="t-detail-xs">钉住的帧交给 Agent 优先用</span>
        </div>
      </div>
    );
  }

  /* ---------- 画廊里的一张 ---------- */
  function CoverCard({c, no, lang, picked, revising, onPick, onOpen, onRevise, onRemove}) {
    const app = useApp();
    const [edit, setEdit] = useState(false);
    const [note, setNote] = useState('');
    const [menu, setMenu] = useState(false);
    const r = W.ROUTE[c.base];
    return (
      <div className={cx('cvc', picked && 'is-picked')}>
        <BCAction className="cvc__img" onClick={onOpen} aria-label={`看原尺寸 · ${c.idea}`}>
          <CoverArt c={c} lang={lang} className="cvc__svg" />
          {picked ? <span className="cvc__badge"><Ic n="check" className="ic--14" />已选用</span> : null}
        </BCAction>
        <div className="cvc__idea">{c.idea}</div>
        <div className="cvc__meta">
          <Chip tone={r.model ? 'notice' : null}>{r.tag}</Chip>
          <span className="t-detail-xs">{`#${no}${c.model ? ` · ${c.model}` : ''}${c.by === 'user' ? ' · 你直接选的帧' : ''}`}</span>
        </div>
        {c.from ? <div className="cvc__from">{`照这张再改：${c.note}`}</div> : null}
        {revising ? <div className="cvc__from">Agent 在改…</div> : null}
        <div className="cvc__acts">
          <Btn size="s" variant={picked ? 'primary' : 'secondary'} onClick={onPick}>{picked ? '已选用' : '选用'}</Btn>
          <span className="spacer" />
          <IconBtn icon="edit" size="s" tip="照这张再改" on={edit} onClick={() => setEdit((v) => !v)} />
          <span className="cvc__morew">
            <IconBtn icon="more" size="s" tip="更多" onClick={() => setMenu((v) => !v)} />
            <Popover open={menu} onClose={() => setMenu(false)} align="right" width={180}>
              <Menu>
                <MenuItem icon="download" label="另存为…" onClick={() => { setMenu(false); app.toast('会弹出系统的存储框（原型不弹）'); }} />
                <MenuItem icon="folder" label="在文件夹中显示" onClick={() => { setMenu(false); app.toast(`cover/candidates/c${no}/cover.png`); }} />
                <MenuRule />
                <MenuItem icon="trash" label="删除" tone="negative" onClick={() => { setMenu(false); onRemove(); }} />
              </Menu>
            </Popover>
          </span>
        </div>
        {edit ? (
          <div className="cvc__rev">
            <Field area placeholder="怎么改：比如字再大一点、换成暖色" value={note} onChange={(e) => setNote(e.target.value)} />
            <Btn size="s" variant="accent" disabled={!note.trim()} onClick={() => { onRevise(note.trim()); setNote(''); setEdit(false); }}>交给 Agent 改</Btn>
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- 页面 ---------- */
  function CoverFlow({ctx, onBack, onOpenTool, landed}) {
    const app = useApp();
    const t = TOOLS.cover;
    const pid = ctx.proj.id;
    const [st, set] = WF.useWriting(pid);
    const picked = W.pickedTitle(st.titles);
    const [idea, setIdea] = useState(picked || '');
    useEffect(() => { if (picked && !idea) setIdea(picked); }, [picked]);
    const [ratio, setRatio] = useState('project');
    const [count, setCount] = useState(W.COVER_COUNT.dflt);
    const [textMode, setTextMode] = useState('phrase');
    const [ratioPop, setRatioPop] = useState(false);
    const [textPop, setTextPop] = useState(false);
    const engines = window.useImageEngines(app);
    const imgModel = IM.preferred(engines, app.cloudImageDefault || ((app.prefs && app.prefs.localModelDefaults) || {}).image);
    const imgEng = imgModel ? IM.engineOf(engines, imgModel) : null;
    const imgName = imgEng ? (imgEng.family === 'cloud' ? (IM.modelIn(engines, imgModel) || {}).model : imgEng.name) : null;
    const [routes, setRoutes] = useState(() => ['frame', 'drawn'].concat(imgModel ? ['generated'] : []));
    const view = W.resolveView('auto', ctx.proj);
    const frames = st.frames || W.autoFrames(ctx.chapters || D.chapters, ctx.duration || 206, 8);
    useEffect(() => { if (!st.frames) set(() => ({frames})); }, []);
    const [sel, setSel] = useState(frames[0] ? frames[0].t : null);
    const run = st.coverRun;
    const [phase, setPhase] = useState(st.covers.items.length || run ? 'gallery' : 'setup');
    const [scheme, setScheme] = useState(app.theme === 'dark' ? 'dark' : 'light');
    const [big, setBig] = useState(null);
    const [tsc, setTsc] = useState(null);
    const lang = W.demoLang(W.defaultLang('cover', WF.langCtx(app)).code, D.srcLang && D.srcLang.code).code;
    const realRatio = W.ratioOf(ratio, ctx.ratio);
    const step = Object.assign({}, STEP.cover, {count: ctx.duration ? Math.round(ctx.duration) : STEP.cover.count,
      unit: `秒的成片里挑关键帧，做 ${count} 张封面候选`});
    const runner = window.useToolRunner(step, 'cover');
    const agentItem = (runner.groups.find((g) => g.kind === 'agent') || {items: []}).items[0];
    const toggleRoute = (k) => setRoutes((rs) => (rs.indexOf(k) >= 0 ? rs.filter((x) => x !== k) : rs.concat([k])));

    const coverPlan = () => {
      const ph = PHRASES[lang];
      return W.planCovers({count, routes, frames, view: view.view, textMode, ratio: realRatio,
        phrase: ph.text[0], sub: ph.sub}).map((c, i) => Object.assign({}, c, {
        text: textMode === 'none' ? '' : ph.text[i % ph.text.length],
        model: W.ROUTE[c.base].model ? imgName : null, by: 'agent'}));
    };
    /* Agent 在会话里做完了（landed）：候选已经登记，直接落在候选页。 */
    useEffect(() => {
      if (!landed || st.covers.items.length || run) return;
      set((c) => ({covers: coverPlan().reduce((lib, x) => W.addCover(lib, x), c.covers)}));
      setPhase('gallery');
    }, [landed]);
    /* 提示词模板（§5.10）：意图句里折着要说的一件事、画幅、封面字、路线、钉住的帧；风格不再是下拉，直接改这段话 */
    const [prompt, setPrompt] = useState(null);
    const [session, setSession] = useState(null);
    const extra = W.intentExtra('cover', {idea: idea.trim() || null, ratio: realRatio, textMode, routes,
      pins: W.pinned(frames).map((f) => f.t), picked});
    if (tsc && tsc.k !== 'all') extra.unshift(`关键帧只从${tsc.label.replace(/^第 \d+ 章 · /, '')}里挑`);
    if (view.view === 'viewer') extra.push('这是别人的视频：只用真实画面，不重绘其中的人');
    const defaultText = P.template('cover', AG.intentPrompt({kind: 'cover', count, extra}, ctx.proj), {});
    const start = (pl) => {
      const plan = coverPlan();
      const o = {sid: session && session.k === 'current' ? session.sid : null, attachments: pl.attachments, mode: pl.mode, effort: pl.effort};
      const sess = sendToAgent(app, ctx, runner.cur, {text: pl.text}, null, o);
      startRun(pid, plan, sess ? sess.id : null);
      setPhase('gallery');
    };
    const takeFrame = (f) => {
      set((c) => ({covers: W.addCover(c.covers, W.frameCover(f, realRatio))}));
      app.toast('已登记成一张候选 · 视频画面', 'positive');
      setPhase('gallery');
    };
    const addNow = () => {
      const next = W.addFrame(frames, ctx.playT || 0, ctx.chapters || D.chapters);
      set(() => ({frames: next}));
      setSel(Math.round((ctx.playT || 0) * 10) / 10);
    };

    /* 谁来做：有 Agent 就交给它；只有模型时说清楚为什么要 Agent；都没有给配置引导 */
    const cta = (() => {
      if (runner.agent) {
        return (
          <window.ToolPrompt ctx={ctx} tool="cover" runner={runner} value={prompt} onChange={setPrompt} defaultText={defaultText}
            session={session || {k: 'new'}} readonly onStart={start} label="做封面" />
        );
      }
      if (app.harness && agentItem) {
        return (
          <div className="aicard aicard--warn">
            <b>封面要交给 Agent 做</b>
            <span>做封面要看图、写合成代码，直接调模型做不了。不想用 Agent，可以在上面的关键帧里点「直接用这一帧」。</span>
            <div className="chiprow"><Btn size="s" variant="accent" onClick={() => runner.pick(agentItem)}>{`改用 ${agentItem.label}`}</Btn></div>
          </div>
        );
      }
      const guide = AG.setupGuide(app.agentAvail);
      return (
        <BCAction className="atagent atagent--setup" onClick={() => (guide.state === 'off' ? app.enableAgent(guide.harness.id) : app.go({r: 'settings', sec: 'agent'}))}>
          <span className="ic2"><Ic n={guide.state === 'off' ? 'settings' : 'agent'} className="ic--16" /></span>
          <span className="tt"><b>封面要交给 Agent 做</b>
            <span>{guide.state === 'off' ? `${guide.cta} · 不用 Agent 也可以在关键帧里点「直接用这一帧」→` : '装 Claude Code 或 Codex CLI 就能做；不装也可以在关键帧里点「直接用这一帧」→'}</span></span>
        </BCAction>
      );
    })();

    const setup = (
      <>
        <WF.PickedLine pid={pid} onOpenTool={onOpenTool} />
        <div className="aicard"><b>{t.name}</b><span>{t.desc}</span><span className="ail__effect"><Ic n="info" className="ic--14" />{P.EFFECT.cover}</span></div>
        <SecHead>要说的一件事</SecHead>
        <Field placeholder="这支视频最想让人点开的那一点；可空，空着就让 Agent 从文稿里找" value={idea} onChange={(e) => setIdea(e.target.value)} />
        <div className="wrsetup">
          <window.ToolSetup plan={{step}} runner={runner} scope={tsc} onScope={setTsc} chapters={ctx.chapters}>
            <WF.Row label="画幅">
              <Picker size="s" value={ratio === 'project' ? `跟视频画布（${realRatio}）` : RATIO_LABEL[ratio]} open={ratioPop} popWidth={200}
                onClick={() => setRatioPop((v) => !v)} onClose={() => setRatioPop(false)}>
                <Menu>{W.RATIOS.map((k) => <MenuItem key={k} label={k === 'project' ? `跟视频画布（${W.ratioOf(k, ctx.ratio)}）` : RATIO_LABEL[k]} on={k === ratio}
                  onClick={() => { setRatio(k); setRatioPop(false); }} />)}</Menu>
              </Picker>
            </WF.Row>
            <WF.Row label="出几张">
              <Stepper value={count} onDec={() => setCount((n) => Math.max(W.COVER_COUNT.min, n - 1))} onInc={() => setCount((n) => Math.min(W.COVER_COUNT.max, n + 1))}
                disabledDec={count <= W.COVER_COUNT.min} disabledInc={count >= W.COVER_COUNT.max} decTip="少一张" incTip="多一张" />
            </WF.Row>
            <WF.Row label="封面字">
              <Picker size="s" value={W.TEXT_MODES.find((m) => m.k === textMode).label} open={textPop} popWidth={200}
                onClick={() => setTextPop((v) => !v)} onClose={() => setTextPop(false)}>
                <Menu>{W.TEXT_MODES.map((m) => <MenuItem key={m.k} label={m.label} on={m.k === textMode} onClick={() => { setTextMode(m.k); setTextPop(false); }} />)}</Menu>
              </Picker>
              <span className="wrsetup__note">字由代码排，跟文稿的语言</span>
            </WF.Row>
            {runner.agent ? <window.ToolSessionRow ctx={ctx} value={session && session.k} onChange={setSession} /> : null}
          </window.ToolSetup>
        </div>
        <SecHead aside="一次出的几张尽量走不同的路线">可以用的路线</SecHead>
        <div className="cvroutes">
          {W.ROUTES.map((r) => {
            const noModel = r.model && !imgModel;
            const sub = r.model
              ? (imgModel ? `${imgName} · ${IM.statusLine({model: imgModel, n: 1}, engines)}` : '还没有就绪的出图模型')
              : r.k === 'frame' ? '关键帧裁切、调色，不用模型' : '图表、数字、图形；不用出图模型';
            return (
              <div key={r.k} className="cvroute">
                <Checkbox on={routes.indexOf(r.k) >= 0 && !noModel} disabled={noModel} onChange={() => toggleRoute(r.k)} label={r.label} />
                <span className="t-detail-xs cvroute__sub">{sub}</span>
                {noModel ? <BCAction className="tsetup__lnk" onClick={() => app.go({r: 'settings', sec: 'cloud', tab: 'image'})}>去连接</BCAction> : null}
                {r.k === 'restyled' && view.view === 'viewer' ? <span className="t-detail-xs cvroute__sub">别人的视频：只重绘没有人的画面</span> : null}
              </div>
            );
          })}
        </div>
        <SecHead aside="进页面就在本机挑好，不用模型">关键帧</SecHead>
        <FrameStrip frames={frames} sel={sel} onSel={setSel} onAddNow={addNow} onUse={takeFrame}
          onPin={(tt) => set(() => ({frames: W.togglePin(frames, tt)}))} />
        {cta}
      </>
    );

    const items = st.covers.items;
    const noOf = (c) => Number(String(c.id).slice(1));
    const gallery = (
      <>
        <WF.PickedLine pid={pid} onOpenTool={onOpenTool} />
        {run ? (
          <div className="cvrun">
            <span className="cvrun__dot" />
            <span className="grow">{`${W.COVER_STEPS[run.step]} · 已出 ${run.made}/${run.total} 张`}</span>
            {run.sid ? <BCAction className="tsetup__lnk" onClick={() => app.openSession(run.sid)}>在会话里看</BCAction> : null}
          </div>
        ) : null}
        <SecHead action={<Segmented size="s" items={[{k: 'light', label: '浅色'}, {k: 'dark', label: '深色'}]} value={scheme} onChange={setScheme} />}>
          {`候选 · ${items.length} 张`}
        </SecHead>
        <div className={cx('cvgal', scheme === 'dark' ? 'cvgal--dark' : 'cvgal--light')}>
          {items.map((c) => (
            <CoverCard key={c.id} c={c} no={noOf(c)} lang={lang} picked={st.covers.picked === c.id} revising={!!(st.revising && st.revising[c.id])}
              onPick={() => set((x) => ({covers: W.pickCover(x.covers, c.id)}))} onOpen={() => setBig(c.id)}
              onRemove={() => { set((x) => ({covers: W.removeCover(x.covers, c.id)})); app.toast('已删除这张候选'); }}
              onRevise={(note) => {
                if (!app.harness) { app.toast('照这张再改要交给 Agent · 先去 设置 › Agent 连接一个'); return; }
                sendToAgent(app, ctx, agentItem || runner.cur, {kind: 'cover', count: 1, extra: [`照候选 #${noOf(c)}（${c.idea}）再改：${note}`, '新的一张登记在它旁边，原来那张留着']});
                startRevise(pid, c.id, note);
              }} />
          ))}
          {run && run.made < run.total ? <div className="cvc cvc--ghost"><span className="t-detail-xs">下一张在做…</span></div> : null}
        </div>
        {!items.length && !run ? <div className="hint">还没有候选。回到设置交给 Agent，或者在关键帧里点「直接用这一帧」。</div> : null}
        <div className="chiprow wracts">
          <Btn size="s" variant="secondary" icon="plus" onClick={() => setPhase('setup')}>再做几张</Btn>
          <span className="spacer" />
          <span className="t-detail-xs">选用的封面存在视频的候选库里</span>
        </div>
      </>
    );

    const bigC = big ? items.find((c) => c.id === big) : null;
    return (
      <div className="pscroll bc-scroll">
        <div className="flowh">
          <IconBtn icon="back" size="s" tip="返回" onClick={onBack} />
          <b>{t.name}</b>
          {run ? <Chip tone="accent">进行中</Chip> : null}
          <span className="spacer" />
          {phase === 'setup' && items.length ? <BCAction className="tsetup__lnk" onClick={() => setPhase('gallery')}>{`看候选（${items.length}）`}</BCAction> : null}
        </div>
        {phase === 'setup' ? setup : gallery}
        <Dialog open={!!bigC} title={bigC ? `候选 #${noOf(bigC)} · ${W.ROUTE[bigC.base].tag}` : ''} onClose={() => setBig(null)} width={720}
          footer={bigC ? [
            <Btn key="s" variant="secondary" icon="download" onClick={() => app.toast('会弹出系统的存储框（原型不弹）')}>另存为…</Btn>,
            <Btn key="p" variant={st.covers.picked === bigC.id ? 'primary' : 'accent'} onClick={() => set((x) => ({covers: W.pickCover(x.covers, bigC.id)}))}>
              {st.covers.picked === bigC.id ? '已选用' : '选用'}</Btn>,
            <Btn key="c" variant="secondary" onClick={() => setBig(null)}>关闭</Btn>,
          ] : null}>
          {bigC ? (
            <div className="cvbig">
              {/* 竖画幅按 60vh 限高，横画幅铺满对话框宽 */}
              <div className="cvbig__box" style={{width: `min(100%, calc(60vh * ${window.BC_COVERART.dims(bigC.ratio).w} / ${window.BC_COVERART.dims(bigC.ratio).h}))`}}>
                <CoverArt c={bigC} lang={lang} className="cvbig__svg" />
              </div>
              <div className="t-detail-xs">{bigC.idea}</div>
            </div>
          ) : null}
        </Dialog>
      </div>
    );
  }

  Object.assign(window, {CoverFlow});
})();
