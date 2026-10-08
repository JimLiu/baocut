/* BaoCut 原型 — 顶栏任务胶囊 ＋ 悬停详情卡（§8 顶栏任务胶囊）。

   胶囊念表头那一条（`导出 · 37%`），多于一条时补一颗「+N」；鼠标停上去 250ms 弹出详情卡：
   单条时是那一条的详情（标题、阶段、进度、开始时间），多条时是「N 个后台任务」计数头 ＋ 每条一行。
   胶囊与卡片读同一张表（BC_TASKPILL.pillList），「+N」恒等于卡片里其余的行数。

   App 表面：只有一条时点胶囊去它的详情页、hover 出 × 取消；多条时点胶囊去任务页（不猜你要看哪条），
   卡片里每行点进各自的详情。
   Web 表面（没有任务页，§22.4）：胶囊与卡片都只读，只报这个项目的任务。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const P = window.BC_TASKPILL;
  const SURF = window.BC_SURFACE;
  const OPEN_MS = 250;
  const CLOSE_MS = 150;

  function PillRow({r, multi, onOpen}) {
    const body = (
      <>
        <div className="tpcard__top">
          <span className="tpcard__title">{r.title}</span>
          {r.state ? <span className="tpcard__state">{r.state}</span> : null}
        </div>
        {r.progress != null
          ? <Progress value={r.progress === 'indet' ? 0 : r.progress} indeterminate={r.progress === 'indet'} thin />
          : null}
        {r.detail ? <div className="tpcard__sub">{r.detail}</div> : null}
        {r.meta ? <div className="tpcard__meta">{r.meta}</div> : null}
      </>
    );
    const cls = cx('tpcard__row', multi && 'tpcard__row--multi');
    return onOpen
      ? <BCAction type="button" className={cx(cls, 'tpcard__row--go')} onClick={onOpen}>{body}</BCAction>
      : <div className={cls}>{body}</div>;
  }

  function TaskPill({list, projectId}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const timer = useRef(0);
    useEffect(() => () => clearTimeout(timer.current), []);
    const pill = P.pill(list);
    if (!pill) return null;
    const head = pill.head;
    /* Web 只报这部视频的任务，每行再说一遍「这部视频」是废话 */
    const card = P.card(list, SURF.pages ? projectId : null);
    const live = SURF.pages;
    const hover = (on) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOpen(on), on ? OPEN_MS : CLOSE_MS);
    };
    const face = <><span className="tpill__sp" />{pill.label}{pill.more ? <span className="tpill__more">+{pill.more}</span> : null}</>;
    const goTask = (t) => { setOpen(false); app.go({r: 'task', id: t.id}); };
    const goAll = () => { setOpen(false); app.go({r: 'tasks'}); };
    const cancel = (t) => (t.origin === 'url' ? app.cancelImport(t.id) : app.cancelTask(t));
    return (
      <span className="tpillw" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
        <span className={cx('tpill', !live && 'tpill--static')} data-testid="titlebar-task-pill">
          {/* Web 用 span 而不是 disabled 的 button：禁用控件在部分浏览器里收不到 hover，卡片就弹不出来 */}
          {live
            ? <BCAction className="tpill__go" onClick={() => (pill.more ? goAll() : goTask(head))}>{face}</BCAction>
            : <span className="tpill__go">{face}</span>}
          {/* 多条时 × 不出现：不知道它要取消的是哪一条 */}
          {live && !pill.more && head.cancellable
            ? <BCAction className="tpill__x" title={window.BC_EXPORT.cancelCopy(head.kind).confirmLabel}
                onClick={() => cancel(head)}><Ic n="close" className="ic--14" /></BCAction>
            : null}
        </span>
        {open ? (
          <Popover open={open} onClose={() => setOpen(false)} align="right" className={cx('tpcard', card.multi && 'tpcard--multi')}>
            {card.multi ? (
              <div className="tpcard__head">
                <span>{card.title}</span>
                {live ? <BCAction type="button" className="tpcard__all" onClick={goAll}>全部任务</BCAction> : null}
              </div>
            ) : null}
            {card.rows.map((r, i) => (
              <PillRow key={r.id} r={r} multi={card.multi} onOpen={live ? () => goTask(list[i]) : null} />
            ))}
            {card.overflow
              ? <div className="tpcard__more">还有 {card.overflow} 个任务{live ? ' · 在后台任务里看全部' : ''}</div>
              : null}
          </Popover>
        ) : null}
      </span>
    );
  }

  Object.assign(window, {TaskPill});
})();
