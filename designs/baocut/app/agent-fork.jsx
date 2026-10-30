/* BaoCut 原型 — 从某一轮分叉、把视频回到那时（产品设计 §3.2.2「分叉」，2026-10-30）。
   回合页脚「复制」左边一枚分叉按钮（只在已结束的回合上）：菜单第一项「在新会话中接着做」直接分叉；
   第二项「接着做，并把视频回到那时…」只在这条会话改过的视频在那一轮之后又有改动时出现，打开对话框逐部选择，回不去的变灰并写原因。
   新会话在同一个项目（无项目会话用同一个文件夹）、同一个 Agent、同一档访问模式里开，顶上一条分隔线「分叉自「标题」· 截至第 N 轮」，
   带进去的记录点开能看。不分叉原生会话。规则与文字在 model-agent-fork.js；导入外部会话的分隔线也画在这里（AgentMarker）。 */
(function () {
  const {useState, useMemo} = React;
  const F = window.BC_AGENT_FORK;
  const AP = window.BC_AGENT_PROJECTS;

  /** 这一轮的分叉：要回的视频、菜单第二项的状态、真正分叉的动作。 */
  function useFork(sess, turn) {
    const app = useApp();
    const dirId = AP.dirOf(sess, app.projects);
    const d = dirId ? app.dirById(dirId) : null;
    const scen = app.prefs.versionsDemo || 'normal';
    const endedAt = turn && turn.user && turn.user.endedAt;
    const rows = useMemo(() => {
      // 无项目会话的视频没有版本记录；这一轮没有结束时刻（旧记录）时也不提供
      if (!d || !endedAt || !window.loadVideoVersions) return [];
      const movies = app.projects.filter((p) => p.dir === d.id);
      const states = Object.fromEntries(movies.map((m) => [m.id, window.loadVideoVersions(m, scen)]));
      return F.restoreRows(sess.id, movies, states, (Date.now() - endedAt) / 60000);
    }, [d, endedAt, app.projects, sess.id, scen]);
    const fork = (ids) => {
      const n = F.turnNumber(sess.messages, turn.start);
      const ctx = F.context(sess.messages, turn.end, {title: sess.title, folder: d ? d.path : null});
      const next = app.newSession({project: sess.project, dir: dirId, harness: sess.harness, model: sess.model, effort: sess.effort, mode: sess.mode});
      app.patchSession(next.id, {title: `${sess.title || '新会话'}（分叉）`, forkedFrom: {id: sess.id, title: sess.title, turn: n},
        messages: [{id: 'fork', role: 'marker', kind: 'fork', text: F.refLabel(sess.title, n), from: sess.id, context: ctx}]});
      let restored = 0;
      (ids || []).forEach((id) => {
        const row = rows.find((r) => r.id === id);
        const movie = app.projects.find((p) => p.id === id);
        if (!row || row.state.k !== 'ok' || !movie) return;
        const r = window.restoreVideoVersion(movie, scen, row.state.target);
        if (!r.error) restored++;
      });
      app.go({r: 'agent', id: next.id});
      app.toast(F.doneText(restored), 'positive');
    };
    return {rows, item: F.restoreItem(rows), fork};
  }

  /** 回合页脚上的分叉按钮。 */
  function AgentForkButton({sess, turn}) {
    const R = window.RSP;
    const {rows, item, fork} = useFork(sess, turn);
    const [asking, setAsking] = useState(false);
    return <>
      <R.MenuTrigger>
        <R.ActionButton isQuiet size="S" aria-label="从这一轮分叉" UNSAFE_className="aturn__fork"><Ic n="fork" /></R.ActionButton>
        <R.Menu aria-label="从这一轮分叉" disabledKeys={item && item.disabled ? ['restore'] : []}
          onAction={(k) => { if (k === 'fork') fork([]); else if (k === 'restore') setAsking(true); }}>
          <R.MenuItem id="fork" textValue="在新会话中接着做"><Ic n="fork" /><R.Text slot="label">在新会话中接着做</R.Text>
            <R.Text slot="description">带上到这一轮为止的对话</R.Text></R.MenuItem>
          {item ? <R.MenuItem id="restore" textValue="接着做，并把视频回到那时"><R.Icons.Revert /><R.Text slot="label">接着做，并把视频回到那时…</R.Text>
            <R.Text slot="description">{item.note}</R.Text></R.MenuItem> : null}
        </R.Menu>
      </R.MenuTrigger>
      {asking ? <ForkRestoreDialog rows={rows} n={F.turnNumber(sess.messages, turn.start)} onClose={() => setAsking(false)}
        onFork={(ids) => { setAsking(false); fork(ids); }} /> : null}
    </>;
  }

  /** 选哪几部视频回到那时：只有一部时不放勾选，直接写它会怎样。 */
  function ForkRestoreDialog({rows, n, onClose, onFork}) {
    const R = window.RSP;
    const [picked, setPicked] = useState(() => rows.filter((r) => r.checked).map((r) => r.id));
    const single = rows.length === 1;
    const toggle = (id, on) => setPicked((p) => (on ? p.concat([id]) : p.filter((x) => x !== id)));
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">分叉，并把视频回到那时</R.Heading>
          <R.Content>
            <div className="afork">
              <p className="afork__lead">新会话带上到第 {n} 轮为止的对话。下面的视频回到那一轮结束时；回到本身记成新的一版，在版本记录里可以再回来。</p>
              <ul className="afork__list" aria-label="要回到那时的视频">
                {rows.map((r) => <li key={r.id} className={cx('afork__row', r.disabled && 'is-disabled')}>
                  {single ? <span className="afork__name"><R.Icons.Video />{r.title}</span>
                    : <R.Checkbox isSelected={picked.includes(r.id)} isDisabled={r.disabled} onChange={(on) => toggle(r.id, on)}>{r.title}</R.Checkbox>}
                  <span className="afork__note">{r.note}</span>
                </li>)}
              </ul>
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" isDisabled={!picked.length} onPress={() => onFork(picked)}>分叉并回到那时</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /** 线程里的分隔线：分叉自哪条会话（点开看带进去的记录）、导入自哪家。 */
  function AgentMarker({m}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    if (m.kind === 'fork') {
      const src = app.sessionById(m.from);
      const ctx = m.context || {};
      return <div className="amark-wrap">
        <div className="amark" role="note">
          <span className="amark__rule" aria-hidden="true" />
          <span className="amark__text"><Ic n="fork" className="ic--14" />
            {src ? <BCAction className="amark__link" onClick={() => app.go({r: 'agent', id: src.id})}>{m.text}</BCAction> : <span>{m.text}（原会话已删除）</span>}
            <BCAction className="amark__link" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? '收起记录' : `带进去的记录 · ${ctx.turns || 0} 轮${ctx.omitted ? `（更早的 ${ctx.omitted} 轮略去）` : ''}`}</BCAction>
          </span>
          <span className="amark__rule" aria-hidden="true" />
        </div>
        {open ? <pre className="amark__context bc-scroll">{ctx.text}</pre> : null}
      </div>;
    }
    return <div className="amark" role="note">
      <span className="amark__rule" aria-hidden="true" />
      <span className="amark__text">{m.kind === 'imported' ? <window.RSP.Icons.Import /> : null}{m.text}</span>
      <span className="amark__rule" aria-hidden="true" />
    </div>;
  }

  Object.assign(window, {AgentForkButton, AgentMarker});
})();
