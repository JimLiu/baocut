/* AI 工具 · 写作与发布 —— §15.11（AI 工具重设计 §8，2026-09-28）。
   写作（给读的人）：写总结、写博客；发布（给发视频的人）：起标题、写简介（本文件）、做封面（panel-aitools-cover.jsx）。
   五个工具都不改文稿，所以**不落任务收据、没有撤销**（§15.1）；选用标题 / 封面是文件写入，取消选用就是反向操作。
   设置态沿用 ToolSetup 的「用 / 范围」两行（交给 Agent 时多一行「会话」）；篇幅、风格、语言、视角 2026-10-09 起不再是下拉——
   都写在提示词模板里（BC_AIPROMPT.template），用户直接改那段话；候选数与发到哪仍是行。
   交给 Agent 后留在这一页：Agent 跑的是同一条 `bcut ai …`，结果落进项目，这一页读出来（原型里按计时器演示）。
   已选用的标题、封面候选库放在模块级 store（按项目），写简介、做封面、工具列表读同一份。纯逻辑在 model-writing.js。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const W = window.BC_WRITING;
  const L = window.BC_LANGUAGES;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const {TOOLS, STEP, sendToAgent, RunCta, Job} = window.BC_AIFLOWS;
  const P = window.BC_AIPROMPT;

  /* ---------- 按项目的共享演示状态 ---------- */
  const store = {data: {}, subs: new Set()};
  const blank = () => ({titles: W.emptyTitles(), covers: W.emptyCovers(), frames: null, out: {}, coverRun: null, platform: ''});
  const getS = (pid) => store.data[pid] || (store.data[pid] = blank());
  function setS(pid, fn) {
    const cur = getS(pid);
    store.data[pid] = Object.assign({}, cur, fn(cur));
    store.subs.forEach((f) => f());
  }
  function useWriting(pid) {
    const [, tick] = useState(0);
    useEffect(() => {
      const f = () => tick((n) => n + 1);
      store.subs.add(f);
      return () => { store.subs.delete(f); };
    }, []);
    return [getS(pid), (fn) => setS(pid, fn)];
  }

  /* ---------- 语言：写作跟界面语言，发布跟要发布的那一版 / 文稿 ---------- */
  function langCtx(app) {
    const ui = window.BC_TPL ? window.BC_TPL.langOf(app.uiLang) : null;
    const src = D.srcLang ? D.srcLang.code : null;
    const trans = (D.transLangs || []).filter((l) => l.done >= 100 && l.code !== src).map((l) => l.code);
    return {ui, src, publish: null, trans, catalog: L.all};
  }
  const nameOf = (code) => (code ? L.native(code) || code : '—');

  function LangPick({value, onChange, why}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const [proj, other] = W.langOptions(langCtx(app));
    const row = (it) => (
      <MenuItem key={it.code} label={nameOf(it.code)} sub={it.tag || null} on={it.code === value}
        onClick={() => { onChange(it.code); setPop(false); }} />
    );
    return (
      <>
        <Picker size="s" value={nameOf(value)} open={pop} popWidth={240} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
          <div className="wrlang">
            <MenuHead>这部视频已有</MenuHead>
            <Menu>{proj.items.map(row)}</Menu>
            <MenuRule />
            <MenuHead>其他语言</MenuHead>
            <Menu>{other.items.map(row)}</Menu>
          </div>
        </Picker>
        {why ? <span className="wrsetup__note">{why}</span> : null}
      </>
    );
  }

  function StylePick({value, custom, onChange, onCustom}) {
    const [pop, setPop] = useState(false);
    const cur = W.STYLES.find((s) => s.k === value) || W.STYLES[0];
    return (
      <>
        <Picker size="s" value={cur.label} open={pop} popWidth={180} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
          <Menu>
            {W.STYLES.map((s) => <MenuItem key={s.k} label={s.label} on={s.k === cur.k} onClick={() => { onChange(s.k); setPop(false); }} />)}
          </Menu>
        </Picker>
        {cur.k === 'custom'
          ? <Field size="s" className="wrsetup__grow" placeholder="怎么写，用你自己的话说" value={custom} onChange={(e) => onCustom(e.target.value)} />
          : null}
      </>
    );
  }

  /** 设置态里的一行：左边标签、右边控件 */
  const Row = ({label, children}) => (
    <div className="tsetup__row"><span className="tsetup__lb">{label}</span>{children}</div>
  );

  /** 五个工具共用的设置状态；lang 缺省按分组定，用户改了就用用户的 */
  function useWrSettings(tool, ctx) {
    const app = useApp();
    const dl = W.defaultLang(tool, langCtx(app));
    const [length, setLength] = useState('medium');
    const [style, setStyle] = useState('plain');
    const [custom, setCustom] = useState('');
    const [lang, setLang] = useState(null);
    const [view, setView] = useState('auto');
    const [note, setNote] = useState('');
    /* 发到哪：起标题与写简介共用一个值，按项目记着 */
    const [ws, setWs] = useWriting(ctx.proj.id);
    const platform = ws.platform || '';
    const setPlatform = (v) => setWs(() => ({platform: v}));
    const [count, setCount] = useState(W.TITLE_COUNT.dflt);
    const code = lang || dl.code;
    const rv = W.resolveView(view, ctx.proj);
    return {length, setLength, style, setStyle, custom, setCustom, lang: code, langWhy: lang ? null : dl.why, setLang,
      view, setView, rv, note, setNote, platform, setPlatform, count, setCount,
      extra: (more) => W.intentExtra(tool, Object.assign({length, style, custom, lang: code, view: rv, platform}, more), {lang: nameOf(code)})};
  }

  function PlatformRow({s}) {
    return (
      <Row label="发到哪"><Field size="s" className="wrsetup__grow" placeholder="要发的平台，可空；按它的规定写，写完提醒你核对"
        value={s.platform} onChange={(e) => s.setPlatform(e.target.value)} /></Row>
    );
  }
  function PlatformNote({platform}) {
    const note = W.platformNote(platform);
    return note ? <div className="wrmeta"><span className="t-detail-xs">{note}</span></div> : null;
  }
  /* 2026-10-09：篇幅 / 风格 / 语言 / 视角四行撤了——都写在提示词模板里（BC_AIPROMPT.standing）；LangPick / StylePick 仍导出给别处用。 */

  function Head({t, onBack, busy}) {
    return (
      <div className="flowh">
        <IconBtn icon="back" size="s" tip="返回" onClick={onBack} />
        <b>{t.name}</b>
        {busy ? <Chip tone="accent">进行中</Chip> : null}
      </div>
    );
  }
  /** 写简介、做封面的页首：已选用的标题；没有就提示，不拦 */
  function PickedLine({pid, onOpenTool}) {
    const [st] = useWriting(pid);
    const t = W.pickedTitle(st.titles);
    return t
      ? <div className="wrpicked"><span className="wrpicked__k">标题</span><b className="wrpicked__v">{t}</b>
          <BCAction className="tsetup__lnk" onClick={() => onOpenTool('title')}>换一个</BCAction></div>
      : <div className="wrpicked wrpicked--none"><span>先起标题并选用一个，简介和封面会和它配合。</span>
          <BCAction className="tsetup__lnk" onClick={() => onOpenTool('title')}>去起标题</BCAction></div>;
  }

  /* ---------- 一次生成：直接调模型走进度条，交给 Agent 走会话 ---------- */
  function useGen(ctx) {
    const app = useApp();
    const [busy, setBusy] = useState(null);
    const [pct, setPct] = useState(0);
    const timer = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);
    /** runner：useToolRunner 的返回；intent：给 Agent 的意图；done：出结果 */
    const run = (runner, intent, done, opts) => {
      let sid = null;
      if (runner.agent) {
        const sess = sendToAgent(app, ctx, runner.cur, intent, null, opts);
        sid = sess ? sess.id : null;
      }
      setBusy({agent: runner.agent, label: runner.cur ? runner.cur.label : '', sid,
        model: runner.apiModel ? runner.apiModel.name : (D.transModels[0] || {}).name});
      setPct(0);
      let p = 0;
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        p = Math.min(100, p + (runner.agent ? 5 : 9));
        setPct(p);
        if (p >= 100) { clearInterval(timer.current); setBusy(null); done(); }
      }, 90);
    };
    return {busy, pct, run};
  }
  function GenJob({g, title}) {
    const app = useApp();
    if (!g.busy) return null;
    if (g.busy.agent) {
      return (
        <div className="ajob">
          <div className="ajhead"><b>{title}</b><span className="ajpct">{g.pct}%</span></div>
          <div className="wrrun">
            <span className="t-detail-xs">{`${g.busy.label} 在会话里跑，结果写回视频后出现在这里`}</span>
            {g.busy.sid ? <BCAction className="tsetup__lnk" onClick={() => app.openSession(g.busy.sid)}>在会话里看</BCAction> : null}
          </div>
        </div>
      );
    }
    return <Job title={title} pct={g.pct} stages={['读文稿', '写', '检查']} cur={g.pct < 30 ? 0 : g.pct < 85 ? 1 : 2}
      activity={`${g.busy.model} · 在飞 1`} />;
  }

  /** 演示只备了两份样张：选了别的语言时说清楚这里显示的是哪一份 */
  function DemoLangNote({code}) {
    const dl = W.demoLang(code, D.srcLang && D.srcLang.code);
    if (!dl.fallback) return null;
    return <div className="hint hint--tight">{`原型只备了 ${W.DEMO_LANGS.map(nameOf).join(' / ')} 两份样张，这里显示${nameOf(dl.code)}的；真产品按你选的${nameOf(code)}写。`}</div>;
  }

  /* ---------- Markdown 正文：点时间码跳播放头 ---------- */
  function Inline({text, onSeek}) {
    return W.mdInline(text).map((s, i) => (
      s.k === 'b' ? <b key={i}>{s.v}</b>
        : s.k === 'time' ? <BCAction key={i} className="wrtime" onClick={() => onSeek(s.s)}>{s.v}</BCAction>
          : <React.Fragment key={i}>{s.v}</React.Fragment>
    ));
  }
  function Md({text, onSeek}) {
    const blocks = W.mdBlocks(text);
    const out = [];
    let list = null;
    blocks.forEach((b, i) => {
      if (b.type === 'li') {
        if (!list) { list = []; out.push(<ul key={'ul' + i}>{list}</ul>); }
        list.push(<li key={i}><Inline text={b.text} onSeek={onSeek} /></li>);
        return;
      }
      list = null;
      const Tag = b.type === 'quote' ? 'blockquote' : b.type === 'p' ? 'p' : b.type;
      out.push(<Tag key={i}><Inline text={b.text} onSeek={onSeek} /></Tag>);
    });
    return <div className="wrmd">{out}</div>;
  }

  /* ---------- 结果下面那排：复制 / 追问微调 / 再写一版 ---------- */
  function Actions({copies, onRefine, onAgain, onSetup}) {
    const app = useApp();
    const [ask, setAsk] = useState(false);
    const [q, setQ] = useState('');
    const copy = (text, what) => copyToClipboard(text).then(() => app.toast(`已复制${what}`, 'positive'));
    return (
      <>
        <div className="chiprow wracts">
          {copies.map((c) => <BCAction key={c.label} className="ccbtn" onClick={() => copy(c.text, c.what || '')}>{c.label}</BCAction>)}
          <BCAction className={cx('ccbtn', ask && 'is-on')} onClick={() => setAsk((v) => !v)}>追问微调</BCAction>
          <BCAction className="ccbtn" onClick={onAgain}>再写一版</BCAction>
          <span className="spacer" />
          <BCAction className="tsetup__lnk" onClick={onSetup}>改设置</BCAction>
        </div>
        {ask ? (
          <div className="wrask">
            <Field area placeholder="哪里要改：比如开头更直接、少一点术语" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="chiprow"><span className="spacer" />
              <Btn size="s" variant="accent" disabled={!q.trim()} onClick={() => { onRefine(q.trim()); setQ(''); setAsk(false); }}>照这个改</Btn>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  const API_HINT = '基于视频文稿生成：结果给你读、挑、拷走，不写进文稿，所以没有收据和撤销。';

  /* ---------- 写总结 / 写博客 / 写简介：一份正文 ---------- */
  function ProseFlow({id, ctx, onBack, onOpenTool, landed}) {
    const app = useApp();
    const t = TOOLS[id];
    const pid = ctx.proj.id;
    const [st, set] = useWriting(pid);
    const s = useWrSettings(id, ctx);
    const runner = window.useToolRunner(STEP[id]);
    const [tsc, setTsc] = useState(null);
    const out = st.out[id] || null;
    const [phase, setPhase] = useState(out ? 'done' : 'setup');
    const g = useGen(ctx);
    const picked = W.pickedTitle(st.titles);
    const [prompt, setPrompt] = useState(null);
    const [session, setSession] = useState(null);
    /* 模板：意图句（范围、发到哪、已选用的标题折在里面）+ Markdown / 语言 / 篇幅等固定约束 */
    const extra = W.intentExtra(id, {platform: s.platform, picked: id === 'desc' ? picked : null});
    if (tsc && tsc.k !== 'all') extra.unshift(`只看${tsc.label.replace(/^第 \d+ 章 · /, '')}`);
    const defaultText = P.template(id, AG.intentPrompt({kind: id, extra}, ctx.proj), {lang: nameOf(s.lang)});
    const context = P.contextPack(id, {paras: tsc && tsc.k !== 'all' ? tsc.count : STEP[id].count, scope: tsc && tsc.k !== 'all' ? tsc.label : null,
      chapters: (ctx.chapters || []).length, words: 6200});
    const opts = (pl) => pl ? {sid: session && session.k === 'current' ? session.sid : null, attachments: pl.attachments, mode: pl.mode} : null;
    /** pl：提示词框的 payload（首次）；refine：结果页「再改一句」的话，接在上次那段话后面 */
    const start = (pl, refine) => {
      const base = pl ? pl.text : (prompt != null ? prompt : defaultText);
      const text = refine ? `${base}\n${refine}` : base;
      setPhase('done');
      g.run(runner, {text}, () => fill(refine), opts(pl));
    };
    /* 成稿写进这部视频的写作记录；Agent 在会话里写完的也落在同一处（landed）。 */
    const fill = (refine) => {
      const dl = W.demoLang(s.lang, D.srcLang && D.srcLang.code).code;
      const body = id === 'summary' ? W.demoSummary(dl, s.length)
        : id === 'blog' ? {text: W.demoBlog(dl, s.rv.view)}
          : W.demoDescription({lang: dl, view: s.rv.view, platform: s.platform, title: picked, chapters: ctx.chapters || D.chapters, length: s.length});
      set((cur) => ({out: Object.assign({}, cur.out, {[id]: Object.assign({lang: s.lang, view: s.rv, refine: refine || null, platform: id === 'desc' ? s.platform : null}, body)})}));
    };
    useEffect(() => { if (landed && !out) { fill(); setPhase('done'); } }, [landed]);
    const setup = (
      <>
        {id === 'desc' ? <PickedLine pid={pid} onOpenTool={onOpenTool} /> : null}
        <div className="aicard"><b>{t.name}</b><span>{t.desc}</span><span className="ail__effect"><Ic n="info" className="ic--14" />{P.EFFECT[id]}</span></div>
        <div className="wrsetup">
          <window.ToolSetup plan={{step: STEP[id]}} runner={runner} scope={tsc} onScope={setTsc} chapters={ctx.chapters}>
            {id === 'desc' ? <PlatformRow s={s} /> : null}
            {runner.agent ? <window.ToolSessionRow ctx={ctx} value={session && session.k} onChange={setSession} /> : null}
          </window.ToolSetup>
        </div>
        <window.ToolPrompt ctx={ctx} tool={id} runner={runner} value={prompt} onChange={setPrompt} defaultText={defaultText}
          session={session || {k: 'new'}} context={context} readonly onStart={(pl) => start(pl)}
          label={id === 'desc' ? '写简介' : id === 'blog' ? '写博客' : '写总结'} />
      </>
    );
    const seek = (sec) => ctx.seek(sec);
    return (
      <div className="pscroll bc-scroll">
        <Head t={t} onBack={onBack} busy={!!g.busy} />
        {phase === 'setup' ? setup : (
          <>
            <GenJob g={g} title={`${t.name}…`} />
            {!g.busy && out ? (
              <>
                {id === 'desc' ? <PickedLine pid={pid} onOpenTool={onOpenTool} /> : null}
                <DemoLangNote code={out.lang} />
                {out.refine ? <div className="wrmeta"><Chip>{`按「${out.refine}」改过`}</Chip></div> : null}
                {id === 'blog' ? (
                  <>
                    <div className="wrmeta"><Chip>{`${W.VIEW_NAME[out.view.view]}视角`}</Chip>
                      <span className="t-detail-xs">{out.view.auto ? `自动：${out.view.reason}` : '你选定的'}</span></div>
                    <div className="wrdoc"><Md text={out.text} onSeek={seek} /></div>
                  </>
                ) : null}
                {id === 'summary' ? (
                  <>
                    <div className="wrdoc"><Md text={out.body} onSeek={seek} /></div>
                    <SecHead aside="点时间跳到那里">要点</SecHead>
                    <div className="wrpts">
                      {out.points.map((p, i) => (
                        <BCAction key={i} className="wrpt" onClick={() => seek(p.t)}>
                          <span className="wrpt__t">{W.mmss(p.t)}</span><span className="wrpt__x">{p.text}</span>
                        </BCAction>
                      ))}
                    </div>
                  </>
                ) : null}
                {id === 'desc' ? (
                  <>
                    <div className="wrdoc wrdoc--plain">{out.text}</div>
                    <div className="chiprow wrtags">{out.tags.map((x) => <Chip key={x}>{'#' + x}</Chip>)}</div>
                    <PlatformNote platform={out.platform} />
                  </>
                ) : null}
                <Actions
                  copies={id === 'desc'
                    ? [{label: '复制全文', text: out.text, what: '全文'}, {label: '复制标签', text: out.tags.map((x) => '#' + x).join(' '), what: '标签'}]
                    : id === 'blog'
                      ? [{label: '复制 Markdown', text: out.text, what: ' Markdown'}]
                      : [{label: '复制全文', text: out.body + '\n\n' + out.points.map((p) => `${W.mmss(p.t)} ${p.text}`).join('\n'), what: '全文'}]}
                  onRefine={(q) => start(null, q)} onAgain={() => start(null)} onSetup={() => setPhase('setup')} />
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }

  /* ---------- 起标题：多候选 ---------- */
  function TitleCard({c, rec, picked, onPick, onLike, onCopy}) {
    return (
      <div className={cx('ttlc', picked && 'is-picked')}>
        <div className="ttlc__tags">
          {c.angle ? <Chip>{c.angle}</Chip> : null}
          {rec ? <Chip tone="accent">推荐</Chip> : null}
        </div>
        <div className="ttlc__t">{c.title}</div>
        {c.why ? <div className="ttlc__why">{c.why}</div> : null}
        <div className="ttlc__acts">
          <IconBtn icon="copy" size="s" tip="复制标题" onClick={onCopy} />
          <BCAction className="ccbtn" onClick={onLike}>照这个再来几个</BCAction>
          <span className="spacer" />
          <Btn size="s" variant={picked ? 'primary' : 'secondary'} icon={picked ? 'check' : null} onClick={onPick}>{picked ? '已选用' : '选用'}</Btn>
        </div>
      </div>
    );
  }

  function PickedEditor({st, set}) {
    const p = st.titles.picked;
    const [draft, setDraft] = useState(p ? p.text : '');
    useEffect(() => { setDraft(p ? p.text : ''); }, [p && p.id, p && p.text]);
    if (!p) return null;
    const commit = () => set((cur) => ({titles: W.editPicked(cur.titles, draft)}));
    return (
      <div className="wrpickbox">
        <div className="wrpickbox__h"><b>已选用</b>{p.edited ? <Chip>你改过</Chip> : null}<span className="spacer" />
          <BCAction className="tsetup__lnk" onClick={() => set((cur) => ({titles: W.clearPick(cur.titles)}))}>取消选用</BCAction></div>
        <Field value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); e.target.blur(); } }} />
        <div className="t-detail-xs">可以就地改字，改完存成你自己的版本；写简介、做封面会用它。</div>
      </div>
    );
  }

  function TitleFlow({ctx, onBack, landed}) {
    const app = useApp();
    const t = TOOLS.title;
    const pid = ctx.proj.id;
    const [st, set] = useWriting(pid);
    const s = useWrSettings('title', ctx);
    const step = Object.assign({}, STEP.title, {unit: `段文稿起 ${s.count} 个候选标题`});
    const runner = window.useToolRunner(step);
    const [tsc, setTsc] = useState(null);
    const [phase, setPhase] = useState(st.titles.batches.length ? 'done' : 'setup');
    const [more, setMore] = useState(false);
    const g = useGen(ctx);
    const cur = W.current(st.titles);
    const [prompt, setPrompt] = useState(null);
    const [session, setSession] = useState(null);
    const extra = W.intentExtra('title', {platform: s.platform});
    if (tsc && tsc.k !== 'all') extra.unshift(`只看${tsc.label.replace(/^第 \d+ 章 · /, '')}`);
    const defaultText = P.template('title', AG.intentPrompt({kind: 'title', count: s.count, extra}, ctx.proj), {lang: nameOf(s.lang)});
    const context = P.contextPack('title', {paras: tsc && tsc.k !== 'all' ? tsc.count : STEP.title.count, scope: tsc && tsc.k !== 'all' ? tsc.label : null,
      chapters: (ctx.chapters || []).length, words: 6200});
    /** kind：first（提示词框的 payload 在 pl 里）/ more / like——后两种接在上次那段话后面 */
    const gen = (kind, like, pl) => {
      const base = pl ? pl.text : (prompt != null ? prompt : defaultText);
      const tail = kind === 'more' ? '在已有候选之外再来一批，角度不与已有的重复。'
        : kind === 'like' ? `照「${W.findCand(st.titles, like).title}」这个方向再来几个。` : '';
      const o = pl ? {sid: session && session.k === 'current' ? session.sid : null, attachments: pl.attachments, mode: pl.mode} : null;
      setPhase('done');
      g.run(runner, {text: tail ? `${base}\n${tail}` : base}, () => fill(kind, like), o);
    };
    const fill = (kind, like) => {
      const platform = s.platform;
      set((c) => ({titles: W.addBatch(c.titles, Object.assign(W.demoTitles(c.titles, {lang: s.lang, src: D.srcLang && D.srcLang.code, count: s.count, kind, like}), {platform}))}));
    };
    useEffect(() => { if (landed && !st.titles.batches.length) { fill(); setPhase('done'); } }, [landed]);
    const copy = (text) => copyToClipboard(text).then(() => app.toast('已复制标题', 'positive'));
    const card = (c, b) => (
      <TitleCard key={c.id} c={c} rec={b.rec === c.id} picked={!!st.titles.picked && st.titles.picked.id === c.id}
        onPick={() => set((x) => ({titles: W.pickTitle(x.titles, c.id)}))} onLike={() => gen('like', c.id)} onCopy={() => copy(c.title)} />
    );
    return (
      <div className="pscroll bc-scroll">
        <Head t={t} onBack={onBack} busy={!!g.busy} />
        {phase === 'setup' ? (
          <>
            <div className="aicard"><b>{t.name}</b><span>{t.desc}</span><span className="ail__effect"><Ic n="info" className="ic--14" />{P.EFFECT.title}</span></div>
            <div className="wrsetup">
              <window.ToolSetup plan={{step}} runner={runner} scope={tsc} onScope={setTsc} chapters={ctx.chapters}>
                <Row label="候选数">
                  <Stepper value={s.count} onDec={() => s.setCount((n) => Math.max(W.TITLE_COUNT.min, n - 1))} onInc={() => s.setCount((n) => Math.min(W.TITLE_COUNT.max, n + 1))}
                    disabledDec={s.count <= W.TITLE_COUNT.min} disabledInc={s.count >= W.TITLE_COUNT.max} decTip="少一个" incTip="多一个" />
                  <span className="wrsetup__note">{`${W.TITLE_COUNT.min}–${W.TITLE_COUNT.max} 个，角度各不相同`}</span>
                </Row>
                <PlatformRow s={s} />
                {runner.agent ? <window.ToolSessionRow ctx={ctx} value={session && session.k} onChange={setSession} /> : null}
              </window.ToolSetup>
            </div>
            <window.ToolPrompt ctx={ctx} tool="title" runner={runner} value={prompt} onChange={setPrompt} defaultText={defaultText}
              session={session || {k: 'new'}} context={context} readonly onStart={(pl) => gen('first', null, pl)} label="起标题" />
          </>
        ) : (
          <>
            <PickedEditor st={st} set={set} />
            <GenJob g={g} title={`${t.name}…`} />
            {cur ? (
              <>
                <DemoLangNote code={cur.lang === s.lang ? s.lang : cur.lang} />
                <SecHead aside={cur.like ? `照「${(W.findCand(st.titles, cur.like) || {}).title || ''}」再来的` : cur.kind === 'more' ? '新的一批' : null}>
                  {`候选 · ${cur.cands.length} 个`}
                </SecHead>
                <PlatformNote platform={cur.platform} />
                {W.ordered(cur).map((c) => card(c, cur))}
                <div className="chiprow wracts">
                  <Btn size="s" variant="secondary" icon="refresh" disabled={!!g.busy} onClick={() => gen('more')}>再来一批</Btn>
                  <span className="spacer" />
                  <BCAction className="tsetup__lnk" onClick={() => setPhase('setup')}>改设置</BCAction>
                </div>
                {W.earlier(st.titles).length ? (
                  <>
                    <BCAction className="drill wrmore" onClick={() => setMore((v) => !v)}>
                      <span className="tt"><b>之前的候选</b><span>{`${W.earlier(st.titles).length} 批 · ${W.earlier(st.titles).reduce((n, b) => n + b.cands.length, 0)} 个`}</span></span>
                      <Ic n={more ? 'chevup' : 'chevdown'} className="ic--14" />
                    </BCAction>
                    {more ? W.earlier(st.titles).map((b) => (
                      <div key={b.id} className="wrbatch">{W.ordered(b).map((c) => card(c, b))}</div>
                    )) : null}
                  </>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    );
  }

  /** 写作与发布五个工具的路由（面板按 kind:'wr' 进这里） */
  function WriteFlow({id, ctx, onBack, onOpenTool, landed}) {
    if (id === 'title') return <TitleFlow ctx={ctx} onBack={onBack} landed={landed} />;
    if (id === 'cover') return <window.CoverFlow ctx={ctx} onBack={onBack} onOpenTool={onOpenTool} landed={landed} />;
    return <ProseFlow key={id} id={id} ctx={ctx} onBack={onBack} onOpenTool={onOpenTool} landed={landed} />;
  }

  /** 工具列表里那一行的状态说明（已选用的标题 / 封面候选数） */
  function listStatus(pid, id, desc) {
    const st = getS(pid);
    if (id === 'title' && st.titles.picked) return `已选用：${st.titles.picked.text}`;
    if (id === 'cover' && st.covers.items.length) return `${st.covers.items.length} 张候选${st.covers.picked ? ' · 已选用 1 张' : ''}`;
    return desc;
  }

  Object.assign(window, {BC_WRITEFLOWS: {WriteFlow, useWriting, setWriting: setS, getWriting: getS, listStatus, LangPick, StylePick, Row,
    useWrSettings, PickedLine, nameOf, langCtx}});
})();
