/* 设置 › 本地模型 › 模型目录 —— architecture-design §6.3（本地模型管理）。
   放在本地模型页的最顶上（各分类 Tab 共用，目录是整台机器的一个位置，不属于某一类模型）。
   判断全在 `BC_MODELSDIR`，这里只画：当前目录与用量、更改 / 恢复默认 / 在文件夹中显示、更改确认框。
   产品里「选文件夹」走系统面板；原型用 FOLDERS 里的几个演示文件夹代替（含空间小、只读、不存在的）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const MD = window.BC_MODELSDIR;
  const LM = window.BC_LOCALMODELS;
  const mb = LM.mb;
  /* 选过的目录和已装模型表一样只活在这次会话里（刷新回到默认）：两者必须一起重置，所以不进持久化的 prefs */
  let chosenNow = null;

  /* 更改确认框。`target` 给了就不再让选（恢复默认）。 */
  function ChangeDialog({models, comps, on, current, target, onClose, onApply}) {
    const R = window.RSP;
    const currentIds = MD.installedIn(models, on).map((m) => m.id);
    const currentMB = LM.disk(models, comps, MD.withoutBundled(on));
    const choices = target ? [MD.findFolder(target)] : MD.FOLDERS.concat(current === MD.DEFAULT_DIR ? [] : [MD.HOME]).filter((f) => f.path !== current);
    const [sel, setSel] = useState(target || null);
    const [mode, setMode] = useState('move');
    const folder = sel ? MD.findFolder(sel) : null;
    const plan = folder ? MD.plan(folder, models, currentMB, currentIds) : null;
    // 放不下时「移过去」不可选，默认落到「只切换位置」
    const picked = plan && plan.kind === 'choose' ? (plan.move.disabled ? 'switch' : mode) : 'direct';
    const ready = !!plan && plan.kind !== 'error';
    const label = picked === 'move' ? '移动并更改' : '更改位置';

    return (
      <Dialog open title={target ? '恢复默认位置' : '更改模型目录'} width={520} onClose={onClose}
        footer={<>
          <Btn variant="secondary" onClick={onClose}>取消</Btn>
          <Btn variant="accent" disabled={!ready} onClick={() => onApply({mode: picked, folder, plan})}>{label}</Btn>
        </>}>
        <div className="mdir-dlg">
          {target ? null : (
            <>
              <p className="t-detail-xs">产品里这一步是系统的文件夹面板；原型用下面几个位置代替。</p>
              <R.RadioGroup label="选择文件夹" value={sel} onChange={setSel}>
                {choices.map((f) => (
                  <R.Radio key={f.path} value={f.path} description={f.note}>
                    <span className="t-mono mdir-dlg__path" title={f.path}>{MD.shorten(f.path, 40)}</span>
                  </R.Radio>
                ))}
              </R.RadioGroup>
            </>
          )}
          {target ? (
            <p className="t-detail">
              把模型目录改回 <span className="t-mono" title={target}>{MD.shorten(target, 40)}</span>。
            </p>
          ) : null}

          {plan && plan.kind === 'error' ? (
            <R.InlineAlert variant="negative">
              <R.Heading>{plan.error.code === 'readonly' ? '这个文件夹不可写' : '找不到这个文件夹'}</R.Heading>
              <R.Content>{plan.error.text}</R.Content>
            </R.InlineAlert>
          ) : null}

          {plan && plan.kind !== 'error' ? (
            <p className="t-detail" role="status">
              {plan.found.count
                ? `发现 ${plan.found.count} 个已下载的模型（${mb(plan.found.sizeMB)}），可以直接使用。`
                : '这个文件夹里还没有模型，之后下载的模型会放在这里。'}
              {` 所在磁盘可用 ${mb(plan.free)}。`}
            </p>
          ) : null}

          {plan && plan.kind === 'choose' ? (
            <R.RadioGroup label="现有的模型怎么处理" value={picked} onChange={setMode}>
              <R.Radio value="move" isDisabled={plan.move.disabled}
                description={plan.move.disabled ? plan.move.why : `要移动 ${mb(plan.moveMB)}，移完后原位置不再保留这些文件。`}>
                把现有模型移过去
              </R.Radio>
              <R.Radio value="switch"
                description={`原位置的文件保留，不删除。只有新位置里已有的${plan.found.count ? ` ${plan.found.count} 个` : ''}模型可用，其余显示为未安装。`}>
                只切换位置
              </R.Radio>
            </R.RadioGroup>
          ) : null}
        </div>
      </Dialog>
    );
  }

  function ModelsDirCard({models, comps, on, setOn, work}) {
    const app = useApp();
    const [dlg, setDlg] = useState(null);   // null | {target?: string}
    const [moving, setMoving] = useState(null);   // null | {pct, to}
    const [chosen, setChosen] = useState(chosenNow);
    const timer = useRef(null);
    useEffect(() => () => clearInterval(timer.current), []);

    const env = app.prefs.modelsDirEnv || null;
    const eff = MD.effective(env, chosen);
    const installed = MD.installedIn(models, on);
    const used = LM.disk(models, comps, MD.withoutBundled(on));
    const free = MD.freeOf(eff.path);
    const names = (kind) => Object.keys(work).filter((id) => work[id] === kind).map((id) => (models.find((m) => m.id === id) || {}).name || id);
    const block = eff.locked ? null : MD.blocker(app.tasks, {downloading: names('downloading'), testing: names('testing')});
    const busy = !!moving;

    const commit = ({mode, folder, plan}) => {
      const before = installed.length;
      const ids = MD.installedAfter(mode, installed.map((m) => m.id), folder);
      let next = {};
      models.forEach((m) => { next[m.id] = MD.BUNDLED.indexOf(m.id) >= 0 ? !!on[m.id] : false; });
      comps.forEach((c) => { next[c.id] = false; });
      ids.forEach((id) => { const m = models.find((x) => x.id === id); if (m) next = LM.applyInstall(next, m); });
      models.forEach((m) => { if (!!next[m.id] !== !!on[m.id]) app.setModelInstalled(m.id, !!next[m.id]); });
      setOn(next);
      chosenNow = folder.path === MD.DEFAULT_DIR ? null : folder.path;
      setChosen(chosenNow);
      const where = MD.shorten(folder.path, 40);
      app.toast(mode === 'move' ? `已把模型移到 ${where}`
        : before ? `模型目录已改为 ${where} · 原位置的文件保留` : `模型目录已改为 ${where}`, 'positive');
    };
    const apply = (r) => {
      setDlg(null);
      if (r.mode !== 'move') { commit(r); return; }
      setMoving({pct: 0, to: r.folder.path});
      let p = 0;
      clearInterval(timer.current);
      timer.current = setInterval(() => {
        p += 8;
        if (p >= 100) { clearInterval(timer.current); setMoving(null); commit(r); } else setMoving({pct: p, to: r.folder.path});
      }, 120);
    };
    const reveal = () => app.toast(`已在文件夹中显示 ${eff.path}（演示）`);

    return (
      <section className="mdir" aria-label="模型目录">
        <div className="mdir__hd">
          <h2>模型目录</h2>
          {eff.source === 'default' ? <Chip>默认</Chip> : null}
          {eff.source === 'env' ? <Chip tone="notice">环境变量</Chip> : null}
        </div>
        <div className="mdir__path t-mono" title={eff.path}>
          <Ic n="folder" className="ic--16" />
          <span className="mdir__txt">{MD.shorten(eff.path, 48)}</span>
        </div>
        {busy ? (
          <div className="mdir__moving" role="status">
            <Progress value={moving.pct} label="正在移动模型" />
            <span className="t-detail-xs">正在移动 {mb(used)} 到 {MD.shorten(moving.to, 36)}… 期间请不要关闭 BaoCut</span>
          </div>
        ) : (
          <div className="mdir__stats t-detail">
            {MD.stats({usedMB: used, freeMB: free, count: installed.length, mb}).join(' · ')}
          </div>
        )}
        <div className="mdir__acts">
          {eff.locked ? null : <Btn variant="secondary" size="s" disabled={!!block || busy} onClick={() => setDlg({})}>更改…</Btn>}
          <Btn variant="secondary" size="s" icon="folder" disabled={busy} onClick={reveal}>在文件夹中显示</Btn>
          {eff.source === 'custom' ? <Btn variant="quiet" size="s" disabled={!!block || busy} onClick={() => setDlg({target: MD.DEFAULT_DIR})}>恢复默认</Btn> : null}
        </div>
        {eff.locked ? <p className="mdir__note t-detail-xs">{MD.sourceNote('env')}</p> : null}
        {block ? (
          <p className="mdir__note mdir__note--warn t-detail-xs" role="status">
            <Ic n="alert" className="ic--14" />
            <span>现在不能更改：{block.text}</span>
            {block.hasTasks ? <Btn variant="quiet" size="s" onClick={() => app.go({r: 'tasks'})}>查看任务</Btn> : null}
          </p>
        ) : null}
        <p className="mdir__note t-detail-xs">{MD.SHARE_HINT}</p>
        {dlg ? <ChangeDialog models={models} comps={comps} on={on} current={eff.path} target={dlg.target}
          onClose={() => setDlg(null)} onApply={apply} /> : null}
      </section>
    );
  }

  Object.assign(window, {ModelsDirCard});
})();
