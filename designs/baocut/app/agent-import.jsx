/* BaoCut 原型 — 导入 Claude Code / Codex 的本机会话（产品设计 §3.1「导入外部会话」，2026-10-30）。
   入口两个：侧栏「项目」段的 ⋯ 菜单「导入 Claude Code / Codex 会话…」（全部目录），项目行菜单「导入这个目录的会话…」（只列那个目录的）。
   列表按 Agent 分段（只列本机找到的那几家），搜第一句与目录；选中一条后写明落在哪：已是项目就落进去，不是就默认把目录接成项目，
   目录不在了不能导入。已经导入过的那条改成「打开」，不重复导入。底下两行说明照写：终端里还在用会各写各的、BaoCut 的说明从下一轮起生效。
   导入后记录复制进 BaoCut 的会话（之后能查找、能分叉），线程里一条「以上导入自 …」；Agent 固定是来源那一家。
   规则与文字在 model-agent-import.js；挂在 App 根上（main.jsx），开关是 store 的 importing。 */
(function () {
  const {useState, useMemo} = React;
  const IM = window.BC_AGENT_IMPORT;
  const AG = window.BC_AGENT;
  const D = window.BC_DATA;

  function AgentImportDialog() {
    const app = useApp();
    const req = app.importing;
    if (!req) return null;
    return <ImportBody key={req.dir || 'all'} dirId={req.dir || null} onClose={app.closeImport} />;
  }

  function ImportBody({dirId, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const srcs = IM.sources(app.harnessList);
    const scope = dirId ? app.dirById(dirId) : null;
    const all = D.agent.externalSessions || [];
    const [agent, setAgent] = useState(srcs[0] ? srcs[0].id : null);
    const [q, setQ] = useState('');
    const list = useMemo(() => IM.filter(all, {agent, q, dir: scope ? scope.path : null}), [all, agent, q, scope]);
    const [picked, setPicked] = useState(null);
    const item = list.find((x) => x.nativeId === picked) || null;
    const [adopt, setAdopt] = useState(true);
    const land = item ? IM.landing(item, app.dirs) : null;
    const done = item ? IM.importedAs(item, app.sessions) : null;
    const src = IM.SOURCES.find((s) => s.id === agent);

    const run = () => {
      if (done) { onClose(); app.go({r: 'agent', id: done.id}); return; }
      if (!item || !land || land.k === 'missing') return;
      let dir = land.k === 'project' ? land.dir : null;
      if (land.k === 'adopt' && adopt) { const r = app.openDir({path: land.path, name: land.name}); dir = r ? r.dir : null; }
      const s = app.newSession({dir: dir ? dir.id : null, harness: item.agent});
      app.patchSession(s.id, {title: item.title, importedFrom: {agent: item.agent, nativeId: item.nativeId}, status: 'done',
        ...(dir ? {} : {cwd: item.cwd}), messages: IM.toRows(item, src ? src.name : item.agent, '刚刚')});
      onClose();
      app.go({r: 'agent', id: s.id});
      app.toast(dir ? `已导入到项目「${dir.name}」` : '已导入为无项目会话', 'positive');
    };

    const title = scope ? `导入「${scope.name}」目录的会话` : '导入 Claude Code / Codex 会话';
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="L">
        {({close}) => <>
          <R.Heading slot="title">{title}</R.Heading>
          <R.Content>
            {!srcs.length ? <p className="aimp__empty">这台电脑上没找到 Claude Code 或 Codex。装好之后，它们在终端里的会话会列在这里。</p> : <div className="aimp">
              <div className="aimp__bar">
                {srcs.length > 1 ? <R.SegmentedControl aria-label="从哪家导入" selectedKey={agent} onSelectionChange={(k) => { setAgent(String(k)); setPicked(null); }}>
                  {srcs.map((s) => <R.SegmentedControlItem key={s.id} id={s.id}>{s.name}</R.SegmentedControlItem>)}
                </R.SegmentedControl> : <span className="aimp__src">{srcs[0].name}</span>}
                <R.SearchField aria-label="搜索会话" placeholder="搜第一句或目录" size="S" value={q} onChange={setQ} UNSAFE_className="aimp__search" />
              </div>
              <p className="aimp__where t-detail">读自 {src ? src.where : ''}{scope ? ` · 只列 ${scope.path} 里的` : ''}</p>
              {list.length ? <div className="aimp__list bc-scroll">
                <R.GridList aria-label="本机的会话" items={list.map((x) => Object.assign({id: x.nativeId}, x))} selectionMode="single"
                  selectedKeys={picked ? [picked] : []} onSelectionChange={(keys) => { const k = [...keys][0]; setPicked(k == null ? null : String(k)); setAdopt(true); }}>
                  {(x) => <R.GridListItem id={x.id} textValue={x.title} className="aimp__row">
                    <span className="aimp__body">
                      <span className="aimp__t">{x.title}</span>
                      <span className="aimp__d">{IM.meta(x, AG.agoLabel)}</span>
                    </span>
                    {IM.importedAs(x, app.sessions) ? <R.Badge variant="neutral" size="S">已导入</R.Badge> : null}
                  </R.GridListItem>}
                </R.GridList>
              </div> : <p className="aimp__empty">{q ? '没有对得上的会话' : scope ? '这个目录里没有找到会话' : '没有找到会话'}</p>}
              {item ? <div className="aimp__land" aria-live="polite">
                {done ? <p>已经导入过，在「{done.title}」里接着做。</p>
                  : land.k === 'project' ? <p>导入到项目「{land.dir.name}」。</p>
                  : land.k === 'missing' ? <p className="aimp__warn"><R.Icons.AlertTriangle />这个目录不在了，不能导入：原会话要在原来的目录里接着跑。</p>
                  : <R.Checkbox isSelected={adopt} onChange={setAdopt}>把 {land.path} 接成项目「{land.name}」</R.Checkbox>}
                {land.k === 'adopt' && !adopt && !done ? <p className="t-detail">不接就作为无项目会话，工作目录仍是这个目录。</p> : null}
              </div> : null}
              <ul className="aimp__notes t-detail">{IM.NOTES.map((n) => <li key={n}>{n}</li>)}</ul>
            </div>}
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" isDisabled={!item || (!done && land.k === 'missing')} onPress={run}>{done ? '打开' : '导入'}</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /** 开关挂在 App 根上（main.jsx 盖在共享 store 上）：`importing` 为 null 或 {dir}（项目菜单的入口只列那个目录的）。 */
  function useAgentImport() {
    const [importing, setImporting] = useState(null);
    const openImport = React.useCallback((dir) => setImporting({dir: dir || null}), []);
    const closeImport = React.useCallback(() => setImporting(null), []);
    return {importing, openImport, closeImport};
  }

  Object.assign(window, {AgentImportDialog, useAgentImport});
})();
