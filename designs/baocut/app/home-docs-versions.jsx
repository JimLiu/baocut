/* 协作文档的版本记录（版本记录设计 §13.2，三期方案待确认）：协作文档标签页顶上的「版本记录」打开它，
   右栏换成这个标签页的版本（新的在前），中间是选中那一版的正文，可以标出和前一版比改了哪几块，「回到这个版本」把正文换回去、记成新的一版。
   正式版是协作文档编辑器里移植来的版本面板（packages/docs-runtime/src/document-history/），改成列这一层版本；原型只画行为与说法。
   数据与规则在 model-home-docs-versions.js。每份协作文档一份状态（回到版本加出来的那几版），关掉再打开还在；不写 data.js。 */
(function () {
  const {useState, useEffect, useReducer} = React;
  const V = window.BC_HOME_DOCS_VERSIONS;

  /* ---------- 每份协作文档一份状态（组件卸载也留着） ---------- */
  const cache = {};
  const subs = new Set();
  /** [extra, put]：extra 是每个标签页回到版本后加出来的那几版，put 换掉它并通知所有用到这份文档的组件。 */
  function useDocVersions(doc) {
    const [, bump] = useReducer((x) => x + 1, 0);
    useEffect(() => { subs.add(bump); return () => { subs.delete(bump); }; }, []);
    const id = doc ? doc.id : null;
    const put = (next) => { cache[id] = next; subs.forEach((f) => f()); };
    return [id ? cache[id] || null : null, put];
  }

  const KIND_ICON = () => ({edit: window.RSP.Icons.Edit, restore: window.RSP.Icons.Revert});
  const CHANGE_TAG = {added: '新加', changed: '改过', removed: '删掉'};
  const clock = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  /* 选中那一版的正文。`marks` 时每块按和前一版比的结果包一层：新加、改过、删掉（删掉的块插回原来的位置） */
  function VersionPage({detail: d, marks, tabName, renderBlock}) {
    const items = marks ? d.changes : d.changes.filter((x) => x.status !== 'removed');
    return <article className="home-docs__page home-docs-ver__page" aria-label={`${tabName} · 版本 ${d.n}`}>
      {items.map((x) => {
        const on = marks && x.status !== 'same';
        return <div key={`${x.block.id}:${x.status}`} className={cx('home-docs-ver__blk', /^h[23]$/.test(x.block.type) && 'is-h', on && `is-${x.status}`)}>
          {on ? <span className="home-docs-ver__tag">{CHANGE_TAG[x.status]}</span> : null}
          {renderBlock(x.block)}
        </div>;
      })}
    </article>;
  }

  /* 版本栏：这是哪一版、谁什么时候改的、为什么在这里分开；「显示改动」「回到这个版本」「回到编辑」 */
  function VersionBar({detail: d, marks, setMarks, onRestore, onExit}) {
    const app = useApp();
    const R = window.RSP;
    const Icon = KIND_ICON()[d.kind] || R.Icons.Edit;
    const count = V.changeCount(d.changes);
    return <section className="home-docs-ver__bar" aria-label={`版本 ${d.n}`}>
      <div className="home-docs-ver__eyebrow"><Icon />版本 {d.n}{d.open ? <R.Badge variant="informative" size="S">还开着</R.Badge> : null}{d.latest ? <span className="home-docs-ver__now">· 现在的正文</span> : null}</div>
      <h2 className="home-docs-ver__title">{d.title}</h2>
      <p className="home-docs-ver__meta">
        <span>{d.range} · {d.by}</span>
        {d.sessions.map((sid) => {
          const s = app.sessionById(sid);
          return s ? <R.ActionButton key={sid} size="S" isQuiet onPress={() => app.openSession(sid)}><R.Icons.Comment /><R.Text>{s.title}</R.Text></R.ActionButton> : null;
        })}
      </p>
      {d.cut ? <p className="home-docs-ver__meta">{d.cut}，下一版从这里分开</p> : null}
      {d.open ? <p className="home-docs-ver__hint">这一版还开着：安静 5 分钟或满 30 分钟之前，接下来的修改都并进这一版；智能体开始新的一轮时也会分开。</p> : null}
      <div className="home-docs-ver__acts">
        <R.ToggleButton size="M" isSelected={marks && !d.first} isDisabled={d.first} onChange={setMarks}>
          <R.Icons.Compare /><R.Text>{d.first ? '第一版，没有可比的' : `显示改动 · ${count} 处`}</R.Text>
        </R.ToggleButton>
        <span className="grow" />
        <R.Button variant="secondary" size="M" isDisabled={!d.canRestore} onPress={onRestore}><R.Icons.Revert /><R.Text>回到这个版本</R.Text></R.Button>
        <R.Button variant="accent" size="M" onPress={onExit}><R.Text>回到编辑</R.Text></R.Button>
      </div>
      {d.why ? <p className="home-docs-ver__why"><R.Icons.InfoCircle />{d.why}</p> : null}
    </section>;
  }

  /** 版本记录打开时的正文区：左边（窄时在上面）是选中那一版，右边是版本列表。`renderBlock` 画一块只读的正文。 */
  function DocsVersions({doc, tab, renderBlock, onExit}) {
    const app = useApp();
    const R = window.RSP;
    const [extra, put] = useDocVersions(doc);
    const rows = V.rows(doc, tab.id, extra);
    const [sel, setSel] = useState(rows[0] ? rows[0].n : null);
    const [marks, setMarks] = useState(true);
    /* 谁改的只写「智能体」，会话另起一个按钮（可以点开） */
    const d = V.detail(doc, tab.id, extra, sel) || V.detail(doc, tab.id, extra, rows[0].n);
    const restore = () => {
      app.confirm({
        title: `回到版本 ${d.n}？`,
        body: `「${tab.name}」的正文换成版本 ${d.n}（${d.range}）的内容，单独记成一个新版本；现有的版本都还在，随时可以再回去。只换这个标签页的正文：别的标签页、标签页的名字与顺序、评论都不变。`,
        confirmLabel: '回到这个版本',
        run: () => {
          const r = V.restore(doc, tab.id, extra, d.n, clock());
          if (r.error) { app.toast(r.error, 'negative'); return; }
          if (r.noop) { app.toast(`标签页现在就是版本 ${d.n} 的正文，没有改动`); return; }
          put(r.extra);
          setSel(r.version);
          app.toast(`已回到版本 ${d.n}，记成版本 ${r.version}`, 'positive');
        },
      });
    };
    return <div className="home-docs__sheet home-docs-ver">
      <div className="home-docs-ver__main">
        <VersionBar detail={d} marks={marks} setMarks={setMarks} onRestore={restore} onExit={onExit} />
        <VersionPage detail={d} marks={marks && !d.first} tabName={tab.name} renderBlock={renderBlock} />
      </div>
      <aside className="home-docs__aside home-docs-ver__aside" aria-label="版本记录">
        <h2 className="home-docs__aside-title">版本记录<span>{tab.name} · {rows.length} 个</span></h2>
        <R.GridList aria-label={`${tab.name}的版本`} items={rows.map((r) => Object.assign({id: r.n}, r))} selectionMode="single" disallowEmptySelection
          selectedKeys={[d.n]} dependencies={[extra]}
          onSelectionChange={(keys) => { const k = [...keys][0]; if (k != null) setSel(Number(k)); }}>
          {(r) => {
            const Icon = KIND_ICON()[r.kind] || R.Icons.Edit;
            return <R.GridListItem id={r.id} textValue={`版本 ${r.n} ${r.title}`} className={cx('vh-row', `is-${r.kind}`)}>
              <span className="vh-row__icon"><Icon /></span>
              <span className="vh-row__body">
                <span className="vh-row__t">{r.title}</span>
                <span className="vh-row__d">{`版本 ${r.n} · ${r.sub}`}</span>
              </span>
              {r.open ? <R.Badge variant="informative" size="S">还开着</R.Badge> : null}
            </R.GridListItem>;
          }}
        </R.GridList>
        <p className="home-docs-ver__note">每个标签页的正文各自记版本，最多留 {V.KEEP} 个：安静 5 分钟、满 30 分钟或智能体开始新的一轮时分开。
          文档名、标签页的增删与顺序不记版本；删掉的标签页连同它的版本一起删掉，回不来。版本在协作文档目录的 tabs/ 里，不依赖 git。</p>
      </aside>
    </div>;
  }

  Object.assign(window, {DocsVersions, useDocVersions});
})();
