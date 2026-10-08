/* 旧版项目导入这条后台任务的界面（2026-10-08；进度、分组、原因与补救的文案都在 model-legacy-import-run.js）。只在 App 入口加载。
   - LegacyImportRunner：演示用的导入进程，挂在外壳根上的 LegacyImportDialog 里常驻。每一步落一个项目，跑完弹一条带去处的 toast。
   - LegacyImportBanner：Home 顶上一条。导入是全局的事，视频顶栏的任务胶囊只报这部视频的任务，不报它；
     Home 上只有 rail 的计数，看不出在导入——所以在跑时报进度，跑完留了没导入的报结果与原因，可以关掉。
   - LegacyImportCardNote：后台任务页卡片上的原因一句、怎么办一句，加「全部重试」「全部跳过」。
   - LegacyImportTaskPanel：任务详情里的计数、没导入的项目（按原因分组，每组写原因与怎么办，整组或逐个重试 / 跳过）、
     正在导入与排队的、已导入的、已跳过的（可以改为导入）。
   重试 / 跳过都是改这条任务记录的 `legacy`，状态、进度与副行由 `taskPatch` 推出来，顶栏胶囊与侧栏跟着变。 */
(function () {
  const {useEffect, useState} = React;
  const R = window.BC_LEGACY_IMPORT_RUN;
  const STEP_MS = 1100;
  /** 每一节先列这么多行，其余收起 */
  const FOLD = 5;

  function toastResult(app, id, legacy) {
    const r = R.finishToast(legacy);
    app.toast(r.text, r.tone, r.action === 'result'
      ? {label: '查看原因', run: () => app.go({r: 'task', id})}
      : {label: '在 Space 中查看', run: () => app.go({r: 'projects'})});
  }

  /* 只有一条在跑的导入任务。演示的「接上硬盘」在原型开关里（app.legacyDrive）。 */
  function LegacyImportRunner() {
    const app = useApp();
    const t = app.tasks.find((x) => x.kind === 'legacy-import' && x.status === 'running');
    const id = t ? t.id : null;
    const legacy = t ? t.legacy : null;
    useEffect(() => {
      if (!id) return undefined;
      const timer = setTimeout(() => {
        const next = R.step(legacy, app.legacyDrive ? [R.demoDrive(app.legacyHost).root] : []);
        const patch = R.taskPatch(next);
        app.patchTask(id, patch);
        if (patch.status !== 'running') toastResult(app, id, next);
      }, STEP_MS);
      return () => clearTimeout(timer);
    }, [id, legacy, app.legacyDrive]);
    return null;
  }

  /* 重试 / 跳过 / 撤销跳过。改的是 store 里最新那份记录（函数式 patch），不是这一帧画出来的那份。 */
  function useLegacyActions(t) {
    const app = useApp();
    /** 点到的、还没导入的项目（`paths` 缺省 = 全部没导入的） */
    const pendingOf = (paths) => t.legacy.items.filter((it) => (it.state === 'missing-media' || it.state === 'error')
      && (!paths || paths.includes(it.path))).map((it) => it.path);
    const retry = (paths) => {
      app.patchTask(t.id, (cur) => R.taskPatch(R.retry(cur.legacy, paths)));
      app.toast(`重新导入 ${paths ? paths.length : pendingOf().length} 个项目`, 'info');
    };
    const skip = (paths) => {
      const picked = pendingOf(paths);
      if (!picked.length) return;
      app.patchTask(t.id, (cur) => R.taskPatch(R.skip(cur.legacy, picked)));
      app.toast(`已跳过 ${picked.length} 个项目，以后不再自动导入`, 'neutral', {
        label: '撤销', run: () => app.patchTask(t.id, (cur) => R.taskPatch(R.unskip(cur.legacy, picked))),
      });
    };
    return {retry, skip};
  }

  /** 关掉过结果的那几条任务（这次打开原型内有效）：再有新的结果（重试跑完）会再出来 */
  const closed = new Map();

  function LegacyImportBanner() {
    const app = useApp();
    const [, redraw] = useState(0);
    const t = app.tasks.filter((x) => x.kind === 'legacy-import' && x.legacy).slice(-1)[0];
    const b = t ? R.banner(t.legacy) : null;
    if (!b || (b.state === 'result' && closed.get(t.id) === t.legacy)) return null;
    const open = () => app.go({r: 'task', id: t.id});
    return (
      <div className={cx('lgt-banner', `lgt-banner--${b.state}`)} data-testid="legacy-import-banner">
        <span className="lgt-banner__ic">
          {b.state === 'running' ? <span className="tpill__sp" /> : <Ic n="alert" className="ic--16" />}
        </span>
        <div className="lgt-banner__b">
          <div className="t-title-sm">{b.title}</div>
          <div className="t-detail lgt-banner__d">{b.detail}</div>
          {b.state === 'running' ? <div className="lgt-banner__pg"><Progress value={b.pct} thin /></div> : null}
        </div>
        <Btn variant="secondary" size="s" onClick={open}>{b.state === 'running' ? '查看进度' : '查看原因'}</Btn>
        {b.state === 'result'
          ? <IconBtn icon="close" size="s" tip="关闭" onClick={() => { closed.set(t.id, t.legacy); redraw((n) => n + 1); }} />
          : null}
      </div>
    );
  }

  function LegacyImportCardNote({t}) {
    const act = useLegacyActions(t);
    const note = R.cardNote(t.legacy);
    if (!note) return null;
    return (
      <div className="lgt-note">
        <div className="lgt-note__why"><Ic n="alert" className="ic--14" /><span>{note}</span></div>
        <div className="t-detail lgt-note__fix">{R.cardHint(t.legacy)}</div>
        <div className="row gap8 lgt-note__acts">
          <Btn variant="secondary" size="s" onClick={() => act.retry()}>全部重试</Btn>
          <Btn variant="quiet" size="s" onClick={() => act.skip()}>全部跳过</Btn>
        </div>
      </div>
    );
  }

  /** 一节里的行：先列 FOLD 行，其余一颗「展开」 */
  function Fold({rows, render}) {
    const [all, setAll] = useState(false);
    const shown = all ? rows : rows.slice(0, FOLD);
    return (
      <>
        {shown.map(render)}
        {rows.length > FOLD
          ? <div className="lgt-fold">
              <Btn variant="quiet" size="s" onClick={() => setAll(!all)}>{all ? '收起' : `展开其余 ${rows.length - FOLD} 个`}</Btn>
            </div>
          : null}
      </>
    );
  }

  function ProblemGroup({g, act}) {
    const app = useApp();
    const paths = g.items.map((it) => it.path);
    return (
      <Card layer className="lgt-group" data-kind={g.kind}>
        <div className="lgt-group__head">
          <Ic n="alert" className="ic--16 lgt-group__ic" />
          <div className="grow">
            <div className="t-title-sm">{g.title} · {g.items.length} 个</div>
            <div className="t-detail lgt-group__line">{g.why}</div>
            <div className="t-detail lgt-group__line"><b>怎么办：</b>{g.fix}</div>
          </div>
          {g.items.length > 1
            ? <div className="row gap8 lgt-group__acts">
                <Btn variant="secondary" size="s" onClick={() => act.retry(paths)}>全部重试</Btn>
                <Btn variant="quiet" size="s" onClick={() => act.skip(paths)}>全部跳过</Btn>
              </div>
            : null}
        </div>
        <Fold rows={g.items} render={(it) => (
          <div className="tsrc__row" key={it.path}>
            <Ic n="project" className="ic--16 tsrc__ic" />
            <div className="tsrc__b">
              <div className="row gap6">
                <span className="t-ui t-truncate">{it.title}</span>
                {it.edited ? <span className="t-detail-xs">{it.edited}</span> : null}
              </div>
              <div className={cx('tsrc__path', g.kind !== 'error' && 't-mono')}>{R.itemNote(it)}</div>
            </div>
            {g.kind === 'error'
              ? <Btn variant="quiet" size="s" icon="folder" onClick={() => app.toast('在文件夹中显示 · ' + it.path)}>在文件夹中显示</Btn>
              : null}
            <Btn variant="secondary" size="s" onClick={() => act.retry([it.path])}>重试</Btn>
            <Btn variant="quiet" size="s" onClick={() => act.skip([it.path])}>跳过</Btn>
          </div>
        )} />
      </Card>
    );
  }

  function Stat({n, label, tone}) {
    return (
      <div className={cx('lgt-stat', tone && `lgt-stat--${tone}`)}>
        <span className="lgt-stat__n t-mono">{n}</span>
        <span className="t-detail">{label}</span>
      </div>
    );
  }

  function LegacyImportTaskPanel({t}) {
    const app = useApp();
    const act = useLegacyActions(t);
    const l = t.legacy;
    const c = R.counts(l);
    const gs = R.groups(l);
    const live = l.items.filter((it) => it.state === 'running' || it.state === 'queued');
    const done = l.items.filter((it) => it.state === 'done');
    const skipped = l.items.filter((it) => it.state === 'skipped');
    return (
      <>
        <div className="lgt-stats">
          <Stat n={c.done} label="已导入" tone={c.done ? 'positive' : null} />
          <Stat n={c.pending} label="没导入" tone={c.pending ? 'notice' : null} />
          <Stat n={c.skipped} label="已跳过" />
          {c.live ? <Stat n={c.live} label="还没导入" /> : null}
        </div>

        {gs.length ? (
          <>
            <div className="row" style={{marginTop: 28}}>
              <span className="t-section grow">没导入的项目</span>
              <span className="t-detail-xs">不处理的话，下次启动会自动再试；跳过的不再导入</span>
            </div>
            {gs.map((g) => <ProblemGroup key={g.key} g={g} act={act} />)}
          </>
        ) : null}

        {live.length ? (
          <>
            <div className="t-section" style={{marginTop: 28}}>正在导入</div>
            <Card layer className="tsrc">
              <Fold rows={live} render={(it) => (
                <div className="tsrc__row" key={it.path}>
                  <Ic n="project" className="ic--16 tsrc__ic" />
                  <span className="t-ui grow t-truncate">{it.title}</span>
                  <Chip tone={it.state === 'running' ? 'accent' : 'neutral'}>{it.state === 'running' ? '正在导入' : '排队中'}</Chip>
                </div>
              )} />
            </Card>
          </>
        ) : null}

        {done.length ? (
          <>
            <div className="row" style={{marginTop: 28}}>
              <span className="t-section grow">已导入</span>
              <Btn variant="quiet" size="s" onClick={() => app.go({r: 'projects'})}>在 Space 中查看</Btn>
            </div>
            <Card layer className="tsrc">
              <Fold rows={done} render={(it) => (
                <div className="tsrc__row" key={it.path}>
                  <Ic n="check" className="ic--16 tsrc__ic lgt-ok" />
                  <span className="t-ui grow t-truncate">{it.title}</span>
                  {it.edited ? <span className="t-detail-xs">{it.edited}</span> : null}
                </div>
              )} />
            </Card>
          </>
        ) : null}

        {skipped.length ? (
          <>
            <div className="row" style={{marginTop: 28}}>
              <span className="t-section grow">已跳过</span>
              <span className="t-detail-xs">不会再自动导入；旧文件还在原处</span>
            </div>
            <Card layer className="tsrc">
              <Fold rows={skipped} render={(it) => (
                <div className="tsrc__row" key={it.path}>
                  <Ic n="project" className="ic--16 tsrc__ic" />
                  <span className="t-ui grow t-truncate">{it.title}</span>
                  <Btn variant="quiet" size="s" onClick={() => act.retry([it.path])}>改为导入</Btn>
                </div>
              )} />
            </Card>
          </>
        ) : null}
      </>
    );
  }

  Object.assign(window, {LegacyImportRunner, LegacyImportBanner, LegacyImportCardNote, LegacyImportTaskPanel});
})();
