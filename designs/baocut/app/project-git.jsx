/* BaoCut 原型 — 项目设置里的 git 一节（2026-10-18，版本记录设计 §5.3–§5.4、§6）
   两个入口：App 的 Home 侧栏项目菜单「项目设置…」；两份原型的版本记录对话框底部那一条 git 状态（ProjectGitStrip）。
   能做什么按表面分（BC_SURFACE.localAdmin）：Web 看状态、「提交到 git」；自动提交、「初始化 git」、允许本地过滤器只在桌面应用，
   Web 上停用并写明去哪里改（与设置页 Web 只读的说法一致），也不显示本机路径与过滤器条目。
   状态与规则在 model-project-git.js；每个项目一份状态，原型开关「项目 git」换场景时是另一份。 */
(function () {
  const {useState, useEffect, useReducer} = React;
  const R = window.RSP;
  const D = window.BC_DATA;
  const G = window.BC_PROJECT_GIT;
  const VV = window.BC_VIDEO_VERSIONS;
  const SURF = window.BC_SURFACE;
  const COMMIT_MS = 700;   // 原型里「提交到 git」跑的那一下
  const WEB_NOTE = '浏览器里不能更改这项设置，请在 BaoCut 桌面应用里更改。';

  /* ---------- 每个项目一份状态 ---------- */
  const cache = {};
  const subs = new Set();
  const dirOf = (app, id) => (app.dirById && app.dirById(id)) || (D.agentProjects || []).find((d) => d.id === id) || null;
  function videosOf(app, dirId) {
    const scen = app.prefs.versionsDemo || 'normal';
    return app.projects.filter((p) => p.dir === dirId && !p.archived).map((p) => {
      const st = window.loadVideoVersions(p, scen);
      return {id: p.id, title: p.title, latest: st.versions[0] ? st.versions[0].n : 0};
    });
  }
  function useGit(dir, videos) {
    const app = useApp();
    const k = `${dir.id}:${app.prefs.gitDemo || 'ready'}`;
    const [, bump] = useReducer((x) => x + 1, 0);
    useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
    if (!cache[k]) cache[k] = G.seed(dir, videos, app.prefs.gitDemo || 'ready');
    const put = (next) => { cache[k] = next; subs.forEach((f) => f()); };
    return [cache[k], put, () => cache[k]];
  }
  const inRepo = (st) => st.state === 'ready' || st.state === 'paused' || st.state === 'error';
  const agoText = (m) => VV.agoText(m);

  /** 「提交到 git」：先写快照，只提交 BaoCut 的路径。结果交给 `onDone`（对话框是模态的，toast 落在遮罩下面，结果写在原地）。 */
  function useCommit(latest, put, videos, onDone) {
    const [busy, setBusy] = useState(false);
    const run = () => {
      setBusy(true);
      setTimeout(() => {
        setBusy(false);
        const r = G.commit(latest(), videos, 'manual');
        if (r.error) { onDone({tone: 'negative', title: '没有提交', text: r.error.message}); return; }
        put(r.state);
        const names = Object.fromEntries(videos.map((v) => [v.id, v.title]));
        onDone(r.result.committed
          ? {tone: 'positive', title: '已提交到 git', text: G.commitText(r.result, names), line: G.commitText(r.result, names)}
          : {tone: 'informative', title: '没有要提交的改动', text: 'BaoCut 的文件和上次提交时一样。', line: G.commitText(r.result)});
      }, COMMIT_MS);
    };
    return [busy, run];
  }

  /* ---------- git 一节 ---------- */

  function Row({title, desc, note, children}) {
    return <div className="pgit-row">
      <div className="pgit-row__text">
        <strong>{title}</strong>
        <span>{desc}</span>
        {note ? <span className="pgit-row__note"><R.Icons.InfoCircle />{note}</span> : null}
      </div>
      {children ? <div className="pgit-row__ctl">{children}</div> : null}
    </div>;
  }

  function LocalConfig({st, onAllow}) {
    const lc = st.pause.localConfig;
    return <R.InlineAlert variant="notice" UNSAFE_className="pgit-alert">
      <R.Heading>提交已暂停：{G.pauseLabel(st.pause)}</R.Heading>
      <R.Content>
        <span className="pgit-alert__p">{st.reason}</span>
        {lc.entries ? <>
          <table className="pgit-entries">
            <thead><tr><th>条目</th><th>要执行的命令或引入的文件</th></tr></thead>
            <tbody>{lc.entries.map((e) => <tr key={e.key}>
              <td className="pgit-mono">{e.key}</td>
              <td><span className="pgit-mono">{e.value}</span>{e.file ? <span className="pgit-entries__file">{e.file}</span> : null}</td>
            </tr>)}</tbody>
          </table>
          <span className="pgit-alert__p">允许后，BaoCut 运行 git 时照这些条目执行（例如 git-crypt 加密）。允许只记在这台电脑上，不写进项目；条目或引入的文件变了会再停下来。这不是信任这个文件夹：打开、编辑与智能体都不受影响。</span>
          <span className="pgit-alert__acts"><R.Button variant="accent" onPress={onAllow}>允许</R.Button></span>
        </> : <span className="pgit-alert__p">这些条目只在 BaoCut 桌面应用的项目设置里列出，也只能在那里允许（或用 baocut projects git-allow）。暂停期间，打开、编辑与版本记录都不受影响。</span>}
      </R.Content>
    </R.InlineAlert>;
  }

  function GitSection({dir, videos}) {
    const app = useApp();
    const [raw, put, latest] = useGit(dir, videos);
    const st = SURF.localAdmin ? raw : G.forWeb(raw);
    const [done, setDone] = useState(null);
    const [busy, commit] = useCommit(latest, put, videos, setDone);
    const l = G.light(st);
    const recheck = () => {
      const r = G.recheck(latest());
      if (r.same) { setDone({tone: 'informative', title: '状态没有变', text: st.remedy}); return; }
      put(r.state); setDone({tone: 'positive', title: '可以提交了', text: '占用仓库的程序已经用完。'});
    };
    const allow = () => {
      const r = G.allow(latest(), latest().pause.localConfig.digest);
      if (r.error) { setDone({tone: 'negative', title: '没有允许', text: r.error.message}); return; }
      put(r.state);
      setDone({tone: 'positive', title: '已允许这些本地过滤器', text: '允许记在这台电脑上，不写进项目。现在可以提交了。'});
    };
    const init = () => app.confirm({
      title: '在项目文件夹里初始化 git？',
      body: <>在 <span className="pgit-mono">{dir.path}</span> 里建一个 git 仓库，分支是 main。BaoCut 的忽略规则写在仓库自己的 .git/info/ 里，不改项目里的文件。不做第一次提交，也不推送。</>,
      confirmLabel: '初始化 git',
      run: () => {
        const r = G.init(latest(), dir);
        if (r.error) { setDone({tone: 'negative', title: '没有初始化', text: r.error.message}); return; }
        put(r.state);
        setDone({tone: 'positive', title: '已初始化 git', text: '还没有提交。点「提交到 git」做第一次提交。'});
      },
    });

    let block = null;
    if (st.state === 'paused' && st.pause.reason === 'local-config') block = <LocalConfig st={st} onAllow={allow} />;
    else if (st.state === 'paused') {
      block = <R.InlineAlert variant="notice" UNSAFE_className="pgit-alert">
        <R.Heading>提交已暂停：{G.pauseLabel(st.pause)}</R.Heading>
        <R.Content><span className="pgit-alert__p">{st.reason}{st.remedy}</span>
          <span className="pgit-alert__p">暂停期间自动提交与「提交到 git」都等着；打开、编辑与版本记录不受影响。</span></R.Content>
      </R.InlineAlert>;
    } else if (st.state === 'error' || st.state === 'unavailable') {
      block = <R.InlineAlert variant={st.state === 'error' ? 'negative' : 'neutral'} UNSAFE_className="pgit-alert">
        <R.Heading>{st.state === 'error' ? 'git 运行失败' : '没有找到 git'}</R.Heading>
        <R.Content><span className="pgit-alert__p">{st.reason}{st.remedy}</span>
          {st.lastError ? <span className="pgit-mono pgit-alert__p">{st.lastError.message}</span> : null}</R.Content>
      </R.InlineAlert>;
    }
    const canRecheck = (st.state === 'paused' && st.pause.reason !== 'local-config') || st.state === 'error';

    return <section className="pset-sec" aria-labelledby="pset-git">
      <h3 id="pset-git" className="pset-sec__h">git</h3>
      <p className="pset-sec__lead">BaoCut 可以把视频的工作区快照提交进项目所在的 git 仓库。版本记录不需要 git，不在仓库里也照常可用。</p>
      <div className="pgit-status">
        <R.StatusLight variant={l.tone} size="M">{l.label}</R.StatusLight>
        <span className="pgit-status__facts">
          {st.branch ? <span>分支 {st.branch}</span> : null}
          {st.gitVersion ? <span>git {st.gitVersion}</span> : null}
          {st.repoRoot ? <span className="pgit-mono" title={st.repoRoot}>{st.repoRoot}</span> : null}
        </span>
        <span className="grow" />
        {canRecheck ? <R.ActionButton size="S" isQuiet onPress={recheck}><R.Icons.Refresh /><R.Text>重新检查</R.Text></R.ActionButton> : null}
      </div>
      {block}
      {done ? <R.InlineAlert variant={done.tone} UNSAFE_className="pgit-alert">
        <R.Heading>{done.title}</R.Heading><R.Content>{done.text}</R.Content>
      </R.InlineAlert> : null}
      {inRepo(st) ? <>
        <Row title="提交到 git"
          desc="只提交 BaoCut 的文件：有改动的视频的工作区快照，和不超过 50 MiB 的素材。项目里的其他文件和你已经暂存的改动原样不动；BaoCut 不推送。"
          note={[G.lastCommitText(st.lastCommit, agoText), st.lastError && st.state !== 'error' ? `上次失败：${st.lastError.message}` : null].filter(Boolean).join(' · ') || null}>
          <R.Button variant="secondary" isDisabled={!G.canCommit(st)} isPending={busy} onPress={commit}>提交到 git</R.Button>
        </Row>
        <Row title="自动提交" desc="项目安静满 5 分钟、关闭项目或退出 BaoCut 时提交一次。这台电脑上的所有项目共用这一项。"
          note={SURF.localAdmin ? null : WEB_NOTE}>
          <R.Switch aria-label="自动提交" isSelected={!!app.prefs.gitAutoCommit} isDisabled={!SURF.localAdmin}
            onChange={(v) => app.setPref('gitAutoCommit', v)} />
        </Row>
      </> : null}
      {st.state === 'not-repo' ? (st.init && st.init.allowed
        ? <Row title="初始化 git" desc="在项目文件夹里建一个 git 仓库，之后可以把快照提交进去。"
          note={SURF.localAdmin ? null : '要在 Runtime 所在电脑的文件夹里建仓库，只能在 BaoCut 桌面应用或 CLI（baocut projects git-init）里做。'}>
          <R.Button variant="secondary" isDisabled={!SURF.localAdmin} onPress={init}>初始化 git</R.Button>
        </Row>
        : <Row title="初始化 git" desc={`这里不提供初始化：${st.remedy}`}
          note="需要的话，把视频放进一个单独的项目文件夹再初始化。" />) : null}
    </section>;
  }

  /* ---------- 项目外的素材（§2.5） ---------- */

  function OutsideSection({st}) {
    const list = st.outside || [];
    return <section className="pset-sec" aria-labelledby="pset-outside">
      <h3 id="pset-outside" className="pset-sec__h">项目外的素材</h3>
      <p className="pset-sec__lead">
        {list.length ? `这个项目有 ${list.length} 个素材在项目文件夹外。` : '现在没有项目外的素材。'}
        素材在项目文件夹外时，工作区快照记的是它的路径（主目录下的写成 ~/ 开头，其余写完整路径）：提交或推送之后，别人拿到的只有路径，没有文件。要连素材一起交给别人，用便携包。
      </p>
      {list.length && list[0].path ? <ul className="pgit-outside">{list.map((o) => <li key={o.path} className="pgit-mono">{o.path}</li>)}</ul> : null}
    </section>;
  }

  /* ---------- 对话框 ---------- */

  function SettingsBody({dirId, onClose}) {
    const app = useApp();
    const dir = dirOf(app, dirId);
    if (!dir) return null;
    const videos = videosOf(app, dir.id);
    return <BCModal onClose={onClose} labelledBy="pset-title" size="L" className="bc-psettings-dialog">
      <div className="pset">
        <header className="pset-head">
          <span className="pset-head__mark"><R.Icons.Settings /></span>
          <div className="pset-head__text">
            <h2 id="pset-title">项目设置</h2>
            <span className="pset-head__sub">{dir.name}{SURF.localAdmin ? ` · ${dir.path}` : ''}</span>
          </div>
          <span className="grow" />
          <IconBtn icon="close" tip="关闭项目设置" onClick={onClose} />
        </header>
        <div className="pset-body bc-scroll">
          <GitSection dir={dir} videos={videos} />
          <OutsideGit dir={dir} videos={videos} />
        </div>
        <footer className="pset-foot">
          <R.Button variant="accent" onPress={onClose}>完成</R.Button>
        </footer>
      </div>
    </BCModal>;
  }
  function OutsideGit({dir, videos}) {
    const [raw] = useGit(dir, videos);
    return <OutsideSection st={SURF.localAdmin ? raw : G.forWeb(raw)} />;
  }

  function ProjectSettingsDialog() {
    const app = useApp();
    const ps = app.psettings;
    if (!ps) return null;
    return <SettingsBody dirId={ps.dirId} onClose={app.closeProjectSettings} />;
  }

  /* ---------- 版本记录对话框底部的那一条 ---------- */

  function ProjectGitStrip({movie, onOpenSettings}) {
    const app = useApp();
    const dir = movie.dir ? dirOf(app, movie.dir) : null;
    if (!dir) return null;
    return <StripBody dir={dir} videos={videosOf(app, dir.id)} onOpenSettings={onOpenSettings} />;
  }
  function StripBody({dir, videos, onOpenSettings}) {
    const [st, put, latest] = useGit(dir, videos);
    const [done, setDone] = useState(null);
    const [busy, commit] = useCommit(latest, put, videos, setDone);
    const l = G.light(st);
    const line = done ? done.line || done.text : G.lastCommitText(st.lastCommit, agoText);
    return <div className="pgit-strip" aria-label="项目的 git">
      <span className="pgit-strip__k">git</span>
      <R.StatusLight variant={l.tone} size="S">{l.label}</R.StatusLight>
      {line ? <span className={cx('pgit-strip__line', done && done.tone === 'negative' && 'is-negative')}>{line}</span> : null}
      <span className="grow" />
      {inRepo(st) ? <R.ActionButton size="S" isQuiet isDisabled={!G.canCommit(st) || busy} onPress={commit}>
        {busy ? <R.ProgressCircle size="S" isIndeterminate aria-label="正在提交" /> : null}<R.Text>{busy ? '正在提交' : '提交到 git'}</R.Text>
      </R.ActionButton> : null}
      <R.ActionButton size="S" isQuiet onPress={onOpenSettings}><R.Icons.Settings /><R.Text>项目设置</R.Text></R.ActionButton>
    </div>;
  }

  Object.assign(window, {ProjectSettingsDialog, ProjectGitStrip});
})();
