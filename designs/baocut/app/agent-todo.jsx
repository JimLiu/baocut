/* 智能体的待办（产品设计 §3.2.3「智能体的待办」；只在 App 入口加载）。

   会话在跑、智能体给自己列了步骤清单时，输入框上方一行「已完成 / 总数 · 正在做的」，点开是整份清单，
   每项标出已完成、进行中、待做。默认收起，换会话时收起（输入框给它 key）。任务结束就不显示，清单不进消息流。
   数与那一行的算法在 model-agent-todo.js。 */
(function () {
  const T = window.BC_AGENT_TODO;

  function AgentTodoDock({sess}) {
    if (!T.visible(sess)) return null;
    return (
      <div className="atodo" role="region" aria-label="Agent 的待办">
        <BCDisclosure className="atodo__dis" title={<span className="atodo__sum">{T.line(sess.todo)}</span>}>
          <ol className="atodo__list">
            {sess.todo.map((t, i) => (
              <li key={i} className={cx('atodo__it', `is-${t.status}`)}>
                <span className="atodo__mk" role="img" aria-label={T.STATUS_LABELS[t.status]}>
                  {t.status === 'completed' ? <Ic n="check" className="ic--16" /> : null}
                </span>
                <span className="atodo__tx">{t.text}</span>
              </li>
            ))}
          </ol>
        </BCDisclosure>
      </div>
    );
  }

  Object.assign(window, {AgentTodoDock});
})();
