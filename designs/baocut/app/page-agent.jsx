/* Home 会话页（product-design §3.2–§3.3）。所有会话使用同一个 AgentThread；
   视频通过 route.movie 在右侧打开，Space 的快捷聊天提交后也落到这里。 */
(function () {
  const {useEffect} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const AP = window.BC_AGENT_PROJECTS;

  /* ---------- Agent 页：Home 主区的会话（2026-10-01 起承接全部会话） ---------- */
  function AgentPage({id, dir}) {
    const app = useApp();
    const sess = id ? app.sessionById(id) : null;
    // 第 185 轮：没有 id 的 Agent 页不再是「新会话」——首页就是；带 dir 的是「在这个项目里新建会话」
    useEffect(() => { if (!id && !(dir && app.dirById(dir))) app.replace({r: 'home'}); }, [id, dir]);
    // 打开过就不再「已完成未读」
    useEffect(() => { if (sess && sess.unread) app.markRead(sess.id); }, [sess && sess.id, sess && sess.unread]);
    // 第一句话建了会话之后把路由换成它（replace：新会话页不该留在历史里）；
    // 草稿里先开的标签页随会话带过去（home-workspace-store.jsx finishDraftWorkspace）
    const created = (s) => app.finishDraftWorkspace ? app.finishDraftWorkspace(s) : app.replace({r: 'agent', id: s.id});
    if (id && !sess) {
      return <window.Page title="会话不存在"><Empty icon="agent" title="这条会话已经不在列表里了" /></window.Page>;
    }
    return (
      <div className="agpage">
        <window.AgentThread key={sess ? sess.id : 'new:' + (dir || '')} sid={sess ? sess.id : null}
          project={null} dir={sess ? null : dir} onCreated={created} autoFocus />
      </div>
    );
  }

  /* ---------- 会话行（首页「进行中」用） ---------- */
  function SessionRow({s}) {
    const app = useApp();
    const dir = app.dirById(AP.dirOf(s, app.projects));
    const h = D.agent.harnesses.find((x) => x.id === s.harness);
    const last = s.messages.length ? s.messages[s.messages.length - 1] : null;
    const preview = last ? (last.role === 'user' || last.role === 'assistant' ? last.text
      : last.role === 'receipt' ? last.text : last.role === 'permission' ? `等你允许 · ${last.cmd}` : last.cmd) : '';
    return (
      <BCAction className="srow" onClick={() => app.openSession(s.id)}>
        <span className={cx('srow__ic', s.status === 'running' && 'is-run', s.status === 'waiting' && 'is-wait')}>
          <Ic n="agent" className="ic--16" />
        </span>
        <span className="srow__b">
          <span className="row gap6">
            <b className="srow__t t-truncate">{s.title || '新会话'}</b>
            <window.SessionStatus s={s} />
          </span>
          <span className="srow__p t-truncate">{preview}</span>
        </span>
        <span className="srow__meta">
          {dir ? <Chip icon="folder">{dir.name}</Chip> : <Chip tone="neutral">不属于任何项目</Chip>}
          <span className="t-detail-xs">{AG.harnessLabel(h, s.model, s.activeModel)}</span>
        </span>
      </BCAction>
    );
  }

  Object.assign(window, {AgentPage, SessionRow});
})();
