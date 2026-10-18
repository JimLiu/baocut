/* BaoCut 原型 — 视频的版本记录（2026-10-17，视频格式规范 §9、版本记录设计 §6）
   视频栏右侧的「版本记录」按钮 ＋ 对话框：左边是这部视频的版本（新的在前），右边是选中版本的详情、动作与 diff。
   两份原型共用：Web 同样经 Runtime 列出版本、看 diff、保存与回到版本（版本记录设计 §6 的多端表）；
   会话只在有 Agent 的表面可以点开（BC_SURFACE.agent）。
   快照被外部改过（§9.8）：只有快照被改时导入成一个「外部变更」版本；两边都改了或快照读不出时，
   对话框与编辑器顶部那一条（VideoVersionsStrip）给出保留哪边的选择。
   数据与规则在 model-video-versions.js。每部视频一份状态，关掉对话框再打开还是刚才那样；原型开关「版本记录」换到一个场景时，那个场景从头开始。
   原型里回到版本、导入与选择只改版本记录，不改时间线上的内容。 */
(function () {
  const {useState, useEffect, useReducer, useMemo, useRef} = React;
  const R = window.RSP;
  const D = window.BC_DATA;
  const VV = window.BC_VIDEO_VERSIONS;
  const SURF = window.BC_SURFACE;

  /* ---------- 每部视频一份状态（组件卸载也留着） ---------- */
  const cache = {};
  const subs = new Set();
  const keyOf = (movie, scen) => `${movie.id}:${scen}`;
  /* 上一次用的场景。换到一个场景时它从头开始：「正在导入」这类会自己变的场景，换走再换回来还能再看一次 */
  let shown = null;
  function load(movie, scen) {
    if (scen !== shown) {
      Object.keys(cache).filter((k) => k.endsWith(`:${scen}`)).forEach((k) => { delete cache[k]; });
      shown = scen;
    }
    const k = keyOf(movie, scen);
    if (!cache[k]) cache[k] = VV.scenario(VV.normalize((D.videoVersions || {})[movie.id] || VV.seed(movie)), scen);
    return cache[k];
  }
  function useVersions(movie) {
    const app = useApp();
    const scen = app.prefs.versionsDemo || 'normal';
    const [, bump] = useReducer((x) => x + 1, 0);
    useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
    const put = (next) => { cache[keyOf(movie, scen)] = next; subs.forEach((f) => f()); };
    return [load(movie, scen), put, () => load(movie, scen)];
  }
  const agentNames = () => Object.fromEntries(((D.agent && D.agent.harnesses) || []).map((h) => [h.id, h.name]));
  const fileName = (n) => `history/${String(n).padStart(6, '0')}.patch`;

  const KIND_ICON = {segment: R.Icons.Edit, save: R.Icons.Bookmark, restore: R.Icons.Revert, external: R.Icons.Cloud, rebuild: R.Icons.Refresh};
  const ACTOR_ICON = {user: R.Icons.User, agent: R.Icons.AIMark, external: R.Icons.Cloud, system: R.Icons.Settings};

  /* 原型把导入放慢到几秒，好看清「正在导入外部改动」；真实的发现就导入，通常不到一秒（§9.8） */
  const IMPORT_MS = 5000;

  /* ---------- 冲突时的两个选择（对话框与编辑器顶部那一条共用） ---------- */

  /** 先确认（写明各自丢掉什么），再按 videos.versions.resolve 改状态。report.done 收结果说明（用磁盘上的带「撤销」），report.refuse 收拒绝。 */
  function askResolve(app, latest, put, keep, report) {
    app.confirm(Object.assign({}, VV.resolveAsk(latest(), keep), {run: () => {
      const r = VV.resolve(latest(), keep);
      put(r.state);
      if (r.error) { report.refuse(r.error); return; }
      if (r.noop) return;
      const note = Object.assign({version: r.version}, VV.resolvedNote(r));
      if (r.keep === 'snapshot') {
        note.undo = () => {
          const u = VV.undoImport(latest(), r.version);
          put(u);
          report.done(Object.assign({version: u.versions[0].n}, VV.undoImportNote));
        };
      }
      report.done(note);
    }}));
  }

  /* ---------- 视频栏的入口 ---------- */

  function VersionsButton({editor}) {
    const app = useApp();
    const movie = app.projects.find((p) => p.id === editor.projectId) || {id: editor.projectId, title: editor.title};
    const [st, put, latest] = useVersions(movie);
    const [open, setOpen] = useState(false);
    /* 对话框开着时导入的结果写进对话框（toast 落在遮罩下面），关着时弹 toast */
    const [imported, setImported] = useState(null);
    const openRef = useRef(open);
    openRef.current = open;
    const importing = st.inProject && st.state === 'external';
    useEffect(() => {
      if (!importing) return undefined;
      const t = setTimeout(() => {
        const r = VV.applyExternal(latest());
        if (r.noop) return;
        put(r.state);
        if (openRef.current) { setImported({n: r.version}); return; }
        app.toast(VV.importedNote(r.version).title, undefined, {label: '撤销', run: () => {
          put(VV.undoImport(latest(), r.version));
          app.toast(VV.undoImportNote.title);
        }});
      }, IMPORT_MS);
      return () => clearTimeout(t);
    }, [importing, movie.id]);
    const tip = VV.buttonTip(st);
    return <>
      <Tip label={tip}>
        <R.ActionButton isQuiet aria-label={tip} onPress={() => setOpen(true)} UNSAFE_className="vh-entry">
          <R.Icons.History />
          {st.inProject && st.state === 'conflict' ? <R.NotificationBadge size="S" UNSAFE_className="vh-entry__alert" /> : null}
        </R.ActionButton>
      </Tip>
      {open ? <VideoVersionsDialog movie={movie} imported={imported} onClose={() => { setOpen(false); setImported(null); }} /> : null}
    </>;
  }

  /* ---------- 编辑器顶部：快照冲突的那一条（版本记录设计 §6） ---------- */

  /** 与字体、子视频那两条同一个位置。「查看」打开版本记录看被改过的文件；对话框挂在这里，选完这一条消失时对话框还在。 */
  function VersionsStrip({movie}) {
    const app = useApp();
    const [st, put, latest] = useVersions(movie);
    const [open, setOpen] = useState(false);
    const report = {
      done: (note) => app.toast(note.title, note.tone, note.undo ? {label: '撤销', run: note.undo} : undefined),
      refuse: (err) => app.toast(err.message, 'negative'),
    };
    const choose = (keep) => askResolve(app, latest, put, keep, report);
    const invalid = st.conflict === 'invalid';
    return <>
      {st.inProject && st.state === 'conflict' ? <div className="vh-strip" role="status" aria-live="polite">
        <R.Icons.AlertTriangle />
        <span className="vh-strip__text">{invalid ? '快照文件读不出，BaoCut 没有导入它们' : '快照被外部改过，BaoCut 里也有新的修改：选一边保留'}</span>
        <R.ActionButton size="S" isQuiet onPress={() => setOpen(true)}><R.Text>查看</R.Text></R.ActionButton>
        <R.Button variant="secondary" size="S" onPress={() => choose('video')}>保留 BaoCut 里的</R.Button>
        {invalid ? null : <R.Button variant="secondary" size="S" onPress={() => choose('snapshot')}>用磁盘上的</R.Button>}
      </div> : null}
      {open ? <VideoVersionsDialog movie={movie} onClose={() => setOpen(false)} /> : null}
    </>;
  }

  /* ---------- 对话框里的快照提示 ---------- */

  const Paths = ({st}) => <span className="vh-paths">
    {st.changedPaths.map((p) => <span key={p}><span className="vh-mono">{p}</span>（{VV.fileLabel(p, st.docs)}）</span>)}
  </span>;

  /** 冲突：原因、被改过的文件、两个选择（快照读不出时只能保留 BaoCut 里的）。顺序同版本记录设计 §4.3。 */
  function ConflictAlert({st, onResolve}) {
    const invalid = st.conflict === 'invalid';
    return <R.InlineAlert variant="negative" UNSAFE_className="vh-alert">
      <R.Heading>{VV.stateOf(st).label}</R.Heading>
      <R.Content>
        {invalid ? '这些快照文件解析不了，可能有合并冲突标记、被截断或手改坏了：'
          : '这些快照文件被外部改过，可能来自 git pull、同步盘或手改；BaoCut 里也有还没写进快照的修改：'}
        <Paths st={st} />
        {invalid ? 'BaoCut 没有导入它们，视频照常编辑，但不能保存版本或回到版本。修好这些文件后 BaoCut 会重新检查；也可以保留 BaoCut 里的，用它覆盖这些文件。'
          : '选好保留哪边之前，BaoCut 不覆盖快照，视频照常编辑，但不能保存版本或回到版本。'}
        <span className="vh-choice">
          <R.Button variant="secondary" size="S" onPress={() => onResolve('video')}>保留 BaoCut 里的</R.Button>
          {invalid ? null : <R.Button variant="secondary" size="S" onPress={() => onResolve('snapshot')}>用磁盘上的</R.Button>}
        </span>
      </R.Content>
    </R.InlineAlert>;
  }

  /* ---------- 保存版本（按钮下的小表单） ---------- */

  function SaveVersion({disabled, onSave}) {
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [note, setNote] = useState('');
    const [touched, setTouched] = useState(false);
    const err = name.trim() ? null : '给这个版本起个名字';
    const reset = () => { setName(''); setNote(''); setTouched(false); };
    const submit = (e) => {
      e.preventDefault();
      setTouched(true);
      if (err) return;
      if (onSave({name, note}) !== false) { setOpen(false); reset(); }
    };
    return <R.DialogTrigger isOpen={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <R.Button variant="secondary" isDisabled={disabled} UNSAFE_className="vh-head__save"><R.Icons.Bookmark /><R.Text>保存版本</R.Text></R.Button>
      <R.Popover placement="bottom end" padding="none" aria-label="保存版本">
        <form className="vh-save" onSubmit={submit}>
          <h3 className="vh-save__h">保存版本</h3>
          <p className="vh-save__p">把现在的内容存成一个有名字的版本。保存的版本不会被自动清理，只能手动删除。</p>
          <R.TextField label="名字" value={name} autoFocus maxLength={200} placeholder="例如：发给周远审的版本"
            onChange={(v) => { setName(v); setTouched(true); }} isInvalid={touched && !!err} errorMessage={err} />
          <R.TextArea label="说明（可选）" value={note} maxLength={2000} onChange={setNote} />
          <div className="vh-save__acts">
            <R.Button variant="secondary" onPress={() => setOpen(false)}>取消</R.Button>
            <R.Button variant="accent" type="submit">保存</R.Button>
          </div>
        </form>
      </R.Popover>
    </R.DialogTrigger>;
  }

  /* ---------- diff ---------- */

  function DiffView({st, v, d}) {
    const app = useApp();
    const files = VV.diffOf(st, v);
    const head = <div className="vh-diff__bar">
      <h4 className="vh-sec">改动</h4>
      <span className="vh-diff__file-n">{fileName(v.n)} · {d.size}</span>
      <span className="grow" />
      {files.length ? <R.ActionButton size="S" isQuiet onPress={() => { copyToClipboard(VV.diffText(st, v)); app.toast('已复制这一版的 diff'); }}>
        <R.Icons.Copy /><R.Text>复制 diff</R.Text>
      </R.ActionButton> : null}
    </div>;
    if (!files.length) return <section className="vh-diff">{head}<p className="vh-muted">这一版的 diff 是空的：内容和上一版结束时一样。</p></section>;
    return <section className="vh-diff" aria-label={`版本 ${v.n} 的 diff`}>
      {head}
      {files.map((f) => <div key={f.path} className="vh-diff__file">
        <div className="vh-diff__fhead">
          <strong>{f.label}</strong>
          <span className="vh-diff__path">{f.path}</span>
          <span className="grow" />
          <span className="vh-diff__chg">{f.changeText}</span>
          <span className="vh-diff__stat"><span className="is-add">+{f.plus}</span><span className="is-del">−{f.minus}</span></span>
        </div>
        <pre className="vh-diff__code">{f.hunks.map((h, i) => <React.Fragment key={i}>
          <span className="vh-diff__ln is-hunk">{h.head}</span>
          {h.lines.map((l, j) => <span key={j} className={cx('vh-diff__ln', l[0] === '+' && 'is-add', l[0] === '-' && 'is-del')}>{l[0] + l[1]}</span>)}
        </React.Fragment>)}</pre>
      </div>)}
    </section>;
  }

  /* ---------- 选中版本的详情 ---------- */

  function Detail({st, n, names, writable, onRestore, onDelete, onConversation}) {
    const app = useApp();
    const d = VV.detail(st, n, names);
    if (!d) return null;
    if (d.unreadable) {
      return <div className="vh-detail bc-scroll">
        <div className="vh-eyebrow"><R.Icons.AlertTriangle />版本 {n}</div>
        <h3 className="vh-title">读不出这个版本文件</h3>
        <R.InlineAlert variant="notice">
          <R.Heading>{fileName(n)} 读不出来</R.Heading>
          <R.Content>版本文件的头部或 diff 坏了，可能被截断或手改过。{d.blocked}；比它新的版本不受影响。</R.Content>
        </R.InlineAlert>
      </div>;
    }
    const v = VV.find(st, n);
    const KindIcon = KIND_ICON[d.kind];
    const act = (a, before) => {
      if (!a) return null;
      return <R.Button variant="secondary" size="M" isDisabled={!writable || !a.ok} onPress={() => onRestore(n, before)}>
        {before ? null : <R.Icons.Revert />}<R.Text>{a.label}</R.Text>
      </R.Button>;
    };
    /* 回不去的写原因；回得去但就是当前状态的也先说一声（再点只提示，不提交、不出新版本，video-format-spec §9.5） */
    const noop = [[d.restoreEnd, false], [d.restoreBefore, true]].filter(([a]) => a && a.noop);
    const why = [...new Set([d.restoreEnd, d.restoreBefore].filter((a) => a && !a.ok && a.why).map((a) => a.why))]
      .concat(noop.length === 2 ? [`视频现在就是版本 ${n} 的状态（这一版前后内容一样），回到它不会有改动`]
        : noop.map(([, before]) => `视频现在就是${before ? `版本 ${n} 开始之前` : `版本 ${n} 结束时`}的状态，回到它不会有改动`));
    return <div className="vh-detail bc-scroll">
      <div className="vh-eyebrow"><KindIcon />版本 {n} · {d.kindLabel}{d.open ? <R.Badge variant="informative" size="S">还开着</R.Badge> : null}</div>
      <h3 className="vh-title">{d.title}</h3>
      {d.note ? <p className="vh-note">{d.note}</p> : null}
      <p className="vh-meta">{d.range} · {d.revsText}</p>
      {d.open ? <p className="vh-hint">{st.state === 'pending'
        ? '最新的一版还开着。刚才的修改正在写入，几秒内并进这一版。'
        : st.state === 'external'
          ? '最新的一版还开着。磁盘上的快照正在导入：这一版先收口，外部改动单独记成一版。'
          : st.state === 'conflict'
            ? '最新的一版还开着，但快照冲突处理好之前，新的修改不会写进版本记录。'
            : '最新的一版还开着：安静 5 分钟或满 30 分钟之前，接下来的修改都并进这一版。'}</p> : null}
      {d.kind === 'external' ? <p className="vh-hint">这一版来自 BaoCut 之外：快照文件被 git pull、同步盘或手改过，BaoCut 把它们导入成这一版。回到这个版本之前，就是导入前 BaoCut 里的内容。</p> : null}
      <div className="vh-acts">
        {act(d.restoreEnd, false)}
        {act(d.restoreBefore, true)}
        {d.canDelete ? <R.Button variant="secondary" fillStyle="outline" isDisabled={!writable} onPress={() => onDelete(n)}>
          <R.Icons.Delete /><R.Text>删除这个保存的版本</R.Text>
        </R.Button> : null}
      </div>
      {why.map((t) => <p key={t} className="vh-why"><R.Icons.InfoCircle />{t}</p>)}
      <dl className="vh-facts">
        <dt>谁改的</dt>
        <dd>{d.actors.length ? d.actors.map((g) => {
          const Icon = ACTOR_ICON[g.kind];
          return <div key={g.actor} className="vh-actor">
            <span className="vh-actor__who"><Icon />{g.label}</span>
            <span className="vh-actor__what">{g.items.map((i) => (i.count > 1 ? `${i.label} ×${i.count}` : i.label)).join('、')}</span>
          </div>;
        }) : <span className="vh-muted">BaoCut 从快照重建，没有修改内容</span>}
        {d.omitted ? <div className="vh-muted">另有 {d.omitted} 项修改只计了数</div> : null}</dd>
        {d.convs.length ? <>
          <dt>会话</dt>
          <dd>{d.convs.map((c) => {
            const here = SURF.agent && app.sessionById(c.id);
            return here
              ? <R.ActionButton key={c.id} size="S" isQuiet onPress={() => onConversation(c.id)} UNSAFE_className="vh-conv"><R.Icons.Comment /><R.Text>{c.title}</R.Text></R.ActionButton>
              : <span key={c.id} className="vh-conv-text"><R.Icons.Comment />{c.title}{SURF.agent ? <span className="vh-muted">（不在这台电脑上）</span> : null}</span>;
          })}</dd>
        </> : null}
        <dt>改了哪些</dt>
        <dd>{d.files.length ? d.files.map((f) => <div key={f.path} className="vh-file">
          <span>{f.label}</span><span className="vh-muted">{f.changeText}</span>
        </div>) : <span className="vh-muted">没有改动内容</span>}</dd>
        {d.checkpoint ? <><dt>检查点</dt><dd className="vh-mono">{d.checkpoint}</dd></> : null}
      </dl>
      <DiffView st={st} v={v} d={d} />
    </div>;
  }

  /* ---------- 对话框 ---------- */

  function VideoVersionsDialog({movie, imported, onClose}) {
    const app = useApp();
    const [st, put, latest] = useVersions(movie);
    const names = useMemo(agentNames, []);
    const rows = VV.rows(st, names).map((r) => Object.assign({id: r.n}, r));
    const [sel, setSel] = useState(rows[0] ? rows[0].n : null);
    const selN = rows.some((r) => r.n === sel) ? sel : rows[0] ? rows[0].n : null;
    /* 最近一次被拒绝的写操作：版本链对不上、快照冲突等。视频不变，提示留到下一次成功的操作 */
    const [refused, setRefused] = useState(null);
    /* 最近一次成功操作的结果。对话框是模态的，toast 落在遮罩下面点不到，所以结果（和「撤销」）写在对话框里 */
    const [done, setDone] = useState(null);
    const ok = (next) => { setRefused(null); setDone(next); };
    const no = (error) => { setDone(null); setRefused(error); };
    const state = VV.stateOf(st);
    /* 冲突时、正在导入时不能保存或回到版本 */
    const writable = st.inProject && st.state !== 'conflict' && st.state !== 'external';
    const report = {
      done: (note) => { ok(note); setSel(note.version != null ? note.version : latest().versions[0] ? latest().versions[0].n : null); },
      refuse: (error) => no(error),
    };
    useEffect(() => {
      if (!imported) return;
      report.done(Object.assign({version: imported.n, undo: () => {
        const u = VV.undoImport(latest(), imported.n);
        put(u);
        report.done(Object.assign({version: u.versions[0].n}, VV.undoImportNote));
      }}, VV.importedNote(imported.n)));
    }, [imported]);

    const save = ({name, note}) => {
      const r = VV.save(latest(), {name, note});
      if (r.error) { no(r.error); return false; }
      put(r.state); setSel(r.version);
      ok({tone: 'positive', title: `已保存为版本 ${r.version}「${name.trim()}」`, text: '保存的版本一直留着，不被保留规则清理。'});
      return true;
    };
    const restore = (n, before) => {
      const r = VV.restore(latest(), n, before);
      put(r.state);
      if (r.error) { no(r.error); setSel(n); return; }
      if (r.noop) {
        ok({tone: 'informative', title: '没有改动', text: `视频已经是${before ? `版本 ${n} 开始之前` : `版本 ${n} 结束时`}的状态，没有提交修改，也没有新版本。`});
        return;
      }
      setSel(r.version);
      const label = VV.restoreLabel(n, before);
      ok({tone: 'positive', title: `已${label}，记成版本 ${r.version}`, text: '这是一笔普通的修改：可以在这里撤销，关掉对话框后也可以在编辑器里撤销。',
        undo: () => {
          const u = VV.undoRestore(latest(), r.version);
          put(u); setSel(u.versions[0].n);
          ok({tone: 'informative', title: `已撤销：${label}`, text: '视频回到之前的内容；撤销本身也是一笔修改，记进最新的一版。'});
        }});
    };
    const moment = (min) => `${VV.dayLabel(min)} ${VV.clock(min)}`;
    const askRestore = (n, before) => {
      const v = VV.find(st, n);
      app.confirm({
        title: before ? `回到版本 ${n} 之前？` : `回到版本 ${n}？`,
        body: `视频的内容换成版本 ${n} ${before ? '开始之前' : '结束时'}（${moment(before ? v.start : v.end)}）的状态。这是一笔可以撤销的修改，会单独记成一个新版本；现有的版本都还在，检查点与保护不变。`,
        confirmLabel: before ? '回到这个版本之前' : '回到这个版本',
        run: () => restore(n, before),
      });
    };
    const askDelete = (n) => {
      const i = st.versions.findIndex((v) => v.n === n);
      const v = st.versions[i];
      const newer = st.versions[i - 1];
      app.confirm({
        title: `删除保存的版本「${v.name}」？`,
        body: newer
          ? `只删掉这个版本和它的检查点：它的修改并进紧接着的版本 ${newer.n}，视频内容不变。`
          : '只去掉名字、说明和检查点：这一版变回普通的一段，之后的修改会并进来。视频内容不变。',
        confirmLabel: '删除', tone: 'negative',
        run: () => {
          const r = VV.remove(latest(), n);
          put(r.state);
          if (r.error) { no(r.error); return; }
          ok({tone: 'informative', title: `已删除保存的版本「${v.name}」`, text: '视频内容没有变。'});
        },
      });
    };
    const conversation = (sid) => { onClose(); app.openSession(sid); };

    const body = !st.inProject ? (
      <div className="vh-empty">
        <R.IllustratedMessage>
          <R.Heading>这部视频不在项目里</R.Heading>
          <R.Content>只有项目里的视频才有版本记录；先把视频移进项目。</R.Content>
        </R.IllustratedMessage>
      </div>
    ) : <>
      {st.state === 'conflict' ? <ConflictAlert st={st} onResolve={(keep) => askResolve(app, latest, put, keep, report)} /> : null}
      {st.state === 'external' ? <R.InlineAlert variant="informative" UNSAFE_className="vh-alert">
        <R.Heading>正在导入外部改动</R.Heading>
        <R.Content>
          这些快照文件被外部改过，可能来自 git pull、同步盘或手改：
          <Paths st={st} />
          BaoCut 里没有还没写进快照的修改，所以直接导入，记成一个「外部变更」版本；导入后可以撤销。
        </R.Content>
      </R.InlineAlert> : null}
      {refused ? <R.InlineAlert variant={refused.code === 'VERSION_CHAIN_BROKEN' ? 'negative' : 'notice'} UNSAFE_className="vh-alert">
        <R.Heading>{refused.code === 'VERSION_CHAIN_BROKEN' ? '回不到这个版本' : '没有完成'}</R.Heading>
        <R.Content>{refused.message}。视频没有改变。</R.Content>
      </R.InlineAlert> : null}
      {done ? <R.InlineAlert variant={done.tone} UNSAFE_className="vh-alert">
        <R.Heading>{done.title}</R.Heading>
        <R.Content><span className="vh-done">
          <span>{done.text}</span>
          {done.undo ? <R.Button variant="secondary" size="S" onPress={done.undo}><R.Icons.Undo /><R.Text>撤销</R.Text></R.Button> : null}
        </span></R.Content>
      </R.InlineAlert> : null}
      {rows.length ? <div className="vh-body">
        <nav className="vh-list bc-scroll" aria-label="版本列表">
          <R.GridList aria-label="版本" items={rows} selectionMode="single" disallowEmptySelection
            selectedKeys={selN != null ? [selN] : []} dependencies={[st]}
            onSelectionChange={(keys) => { const k = [...keys][0]; if (k != null) setSel(Number(k)); }}>
            {(r) => {
              const Icon = r.unreadable ? R.Icons.AlertTriangle : KIND_ICON[r.kind];
              return <R.GridListItem id={r.id} textValue={`版本 ${r.n} ${r.title}`}
                className={cx('vh-row', r.kind && `is-${r.kind}`, r.unreadable && 'is-unreadable', r.blocked && 'is-blocked')}>
                <span className="vh-row__icon"><Icon /></span>
                <span className="vh-row__body">
                  <span className="vh-row__t">{r.title}</span>
                  <span className="vh-row__d">{[`版本 ${r.n}`, r.sub].filter(Boolean).join(' · ')}</span>
                </span>
                {r.open ? <R.Badge variant="informative" size="S">还开着</R.Badge>
                  : r.blocked && !r.unreadable ? <span className="vh-row__flag">回不去</span> : null}
              </R.GridListItem>;
            }}
          </R.GridList>
        </nav>
        <Detail st={st} n={selN} names={names} writable={writable}
          onRestore={askRestore} onDelete={askDelete} onConversation={conversation} />
      </div> : <div className="vh-empty">
        <R.IllustratedMessage>
          <R.Heading>还没有版本</R.Heading>
          <R.Content>工作区快照还没写下。之后的第一笔修改会成为版本 1，也可以现在保存一个版本。</R.Content>
        </R.IllustratedMessage>
      </div>}
    </>;

    return <BCModal onClose={onClose} labelledBy="vh-title" size="XL" className="bc-versions-dialog">
      <div className="vh">
        <header className="vh-head">
          <span className="vh-head__mark"><R.Icons.History /></span>
          <div className="vh-head__text">
            <h2 id="vh-title">版本记录</h2>
            <span className="vh-head__video">{movie.title}</span>
          </div>
          {state ? <span className="vh-head__state"><R.StatusLight variant={state.tone} size="S">{state.label}</R.StatusLight></span> : null}
          <span className="grow" />
          {st.inProject ? <SaveVersion disabled={!writable} onSave={save} /> : null}
          <IconBtn icon="close" tip="关闭版本记录" onClick={onClose} />
        </header>
        {body}
        {st.inProject ? <footer className="vh-foot">
          {state ? <span>{state.desc}</span> : null}
          <span>版本在视频目录的 .bcut-snapshot/history/ 里，不依赖 git；保留最近 {st.keep} 个未命名的版本，加上全部保存的版本。</span>
        </footer> : null}
      </div>
    </BCModal>;
  }

  Object.assign(window, {VideoVersionsButton: VersionsButton, VideoVersionsDialog, VideoVersionsStrip: VersionsStrip});
})();
