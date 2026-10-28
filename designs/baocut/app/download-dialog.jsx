/* 下载确认框（2026-10-13 设计稿；product-design「本地模型由用户安装」：先显示大小与来源，确认后才下载）。
   所有模型下载都过这一个框：设置 › 本地模型的「下载 / 补齐」、公共组件、语义索引、面板与工具页的「下载模型」、我的声音。
   · 这次要下的部分按来源种类分组（模型仓库 / 工具与运行库），每组一个来源选择器，就地换来源；换的是 设置 › 通用 › 下载来源 里的「在用」，
     以后的下载也用它。每个部分写出按当前来源拼的地址。
   · 语义搜索用一个列表，每项单独选本次下载来源；文字、多模态与共享运行时只确认一次，不改默认来源。
   · 几个部分合成一次下载，按顺序下，下好一个存一个；哪一部分没下成，前面的留着，补齐时只下缺的那一部分（可以先换来源）。
   · 已在盘上的部分写「已下好 · 不动」，不计入大小；全都下好了只说一句、不给下载。
   · 不许商用的模型把许可写在框里，确认按钮写「我知道了，下载 …」（替掉原来单独弹的许可确认）。
   · 存放位置（2026-10-15 设计稿，待确认）：默认是模型目录，「更改…」只为这一次下载换文件夹，模型目录不变；
     下好的部分记下在哪（`places`，只活在这次会话），设置 › 本地模型的模型行与模型目录卡片写明它们在别处。
     只管模型仓库下的部分，工具与运行库装在工具目录。环境变量锁住模型目录时不能换。判断在 BC_MODELSDIR。
   原型开关「下次下载的结果」可以让某一种来源下不成（BC_DLSRC.simulate），演示补齐。只在 App。 */
(function () {
  const {useState, useEffect} = React;
  const DS = window.BC_DLSRC;
  const D = window.BC_DATA;
  const MD = window.BC_MODELSDIR;
  const mb = (n) => window.BC_LOCALMODELS.mb(n);
  /* 模型目录之外的存放位置：id → 下载时选的文件夹（BC_MODELSDIR.placeAfter）；和选过的模型目录一样只活在这次会话里 */
  let places = {};

  const hub = {ask: null, subs: new Set()};
  const emit = () => hub.subs.forEach((f) => f());
  function useAsk() {
    const [, tick] = useState(0);
    useEffect(() => {
      const f = () => tick((n) => n + 1);
      hub.subs.add(f);
      return () => { hub.subs.delete(f); };
    }, []);
    return hub.ask;
  }

  /**
   * 打开确认框。spec：
   *   name      标题里的名字；parts [{id, name, size(MB), repo | release}]；on：id → 已在盘上
   *   perPart   用列表按部分选本次下载来源，不改全局设置
   *   licenses  [{name, lic}] 不许商用的；licenseUse 许可末尾那一句
   *   run(outcome, plan)  确认后调用；outcome = {done: [id], failed: {id, name, host} | null}
   */
  function openDownload(spec) { hub.ask = spec; emit(); }
  function closeDownload() { hub.ask = null; emit(); }

  /** 一只本地模型（D.setModels）的部分：权重 + 它用的组件。几只一起下时权重行写模型名 */
  function modelParts(m, many) {
    const comps = D.setComponents;
    return [{id: m.id, name: many ? m.name : '模型权重', size: m.size, repo: m.repo}]
      .concat((m.uses || []).map((id) => comps.find((c) => c.id === id)).filter(Boolean)
        .map((c) => ({id: c.id, name: c.name, size: c.size, repo: c.repo, release: c.release})));
  }

  /**
   * 下载一只或几只本地模型前确认（替掉原来的 withModelLicense）。`opts.on` 是调用方自己的安装表（设置 › 本地模型），
   * 没给时按 store 的模型安装位与演示数据里组件的安装位算。几只一起下只确认一次。
   */
  function askModelDownload(app, ids, run, opts) {
    const o = opts || {};
    const ms = [].concat(ids || []).map((id) => D.setModels.find((m) => m.id === id)).filter(Boolean);
    if (!ms.length) { run({done: [], failed: null}); return; }
    let on = o.on;
    if (!on) {
      on = {};
      D.setComponents.forEach((c) => { if (c.installed) on[c.id] = true; });
      ms.forEach((m) => { if (app.modelInstalled(m.id)) on[m.id] = true; });
    }
    const seen = {};
    const parts = [];
    ms.forEach((m) => modelParts(m, ms.length > 1).forEach((p) => { if (!seen[p.id]) { seen[p.id] = true; parts.push(p); } }));
    const licOf = window.ttsLicenseOf || (() => null);
    // 许可只在要下权重时写；权重已在、只补齐组件时不再写
    const licenses = ms.filter((m) => !on[m.id]).map((m) => ({name: m.name, lic: licOf(m.id), cat: m.cat})).filter((x) => x.lic);
    openDownload({
      name: ms.map((m) => m.name).join('、'), parts, on, licenses,
      // 添加的 audio.cpp 模型（issue 113）：校验值是添加时从仓库的文件列表记下的，不是随应用内置的
      added: ms.some((m) => m.added),
      licenseUse: licenses.length && window.ttsLicenseUse ? window.ttsLicenseUse(licenses[0].cat) : null,
      run,
    });
  }

  /** 存放位置：路径（中间省略，留盘名与末段）+ 来源 chip + 「更改…」；选了别处时下面一句说只管这一次。
      产品里「更改…」是系统的文件夹面板，原型就地列几个演示位置 */
  function Where({target, choosing, onChoose, onPick, onReset, current, problem, notes}) {
    const R = window.RSP;
    return (
      <div className="dldlg__where" role="group" aria-label="存放位置">
        <div className="dldlg__wh">
          <span className="t-detail-xs">存放位置</span>
          <span className="dldlg__wpath t-mono" title={target.path}>
            <Ic n="folder" className="ic--16" />
            <span className="dldlg__wtxt">{MD.shorten(target.path, 30)}</span>
          </span>
          {target.source === 'default' ? <Chip>模型目录</Chip> : null}
          {target.source === 'env' ? <Chip tone="notice">环境变量</Chip> : null}
          {target.locked ? null : <Btn variant="secondary" size="s" onClick={onChoose}>更改…</Btn>}
        </div>
        {choosing ? (
          <div className="dldlg__pick">
            <p className="t-detail-xs">产品里这一步是系统的文件夹面板；原型用下面几个位置代替。</p>
            <R.RadioGroup label="选择文件夹" value={target.path} onChange={onPick}>
              {MD.targetChoices(current).map((f) => (
                <R.Radio key={f.path} value={f.path} description={f.note}>
                  <span className="t-mono dldlg__wopt" title={f.path}>{MD.shorten(f.path, 48)}</span>
                </R.Radio>
              ))}
            </R.RadioGroup>
          </div>
        ) : null}
        {problem ? (
          <R.InlineAlert variant="negative">
            <R.Heading>{problem.code === 'space' ? '放不下' : problem.code === 'readonly' ? '这个文件夹不可写' : '找不到这个文件夹'}</R.Heading>
            <R.Content>{problem.text}</R.Content>
          </R.InlineAlert>
        ) : null}
        {notes.length || target.source === 'picked' ? (
          <p className="t-detail-xs dldlg__note">
            {notes.join('')}
            {target.source === 'picked' ? <BCAction className="tsetup__lnk dldlg__lnk" onClick={onReset}>改回模型目录</BCAction> : null}
          </p>
        ) : null}
      </div>
    );
  }

  /** 框里的一组：种类名 + 来源选择器；下面是这一组的部分 */
  function Group({g, srcOf}) {
    return (
      <div className="dldlg__grp" role="group" aria-label={g.title}>
        <div className="dldlg__gh">
          <span className="dldlg__gt">{g.title}</span>
          <span className="grow" />
          {g.need ? <>
            <span className="t-detail-xs">来源</span>
            <window.DownloadSourcePicker k={g.k} label={`${g.title}的下载来源`} />
          </> : <span className="t-detail-xs">这一组已下好</span>}
        </div>
        {g.parts.map((p) => (
          <div key={p.id} className={cx('dldlg__part', p.keep && 'is-keep')}>
            <div className="dldlg__pl">
              <span className="dldlg__pn">{p.name}</span>
              <span className="dldlg__ps">{p.keep ? '已下好 · 不动' : mb(p.size)}</span>
            </div>
            {p.keep ? null : <span className="dldlg__url t-mono">{DS.partUrl(srcOf(g.k), p)}</span>}
          </div>
        ))}
      </div>
    );
  }

  function ModelDownloadDialog() {
    const app = useApp();
    const ask = useAsk();
    const [sources, , activeOf] = window.useDlSources();
    // 每次打开框重新起步：本次的来源选择、存放位置与是否在选文件夹，都跟着这一个 ask
    const [selection, setSelection] = useState({ask: null, choices: {}, pick: null, choosing: false});
    if (!ask) return null;
    const plan = DS.plan(ask.parts, ask.on);
    const sel = selection.ask === ask ? selection : {ask, choices: {}, pick: null, choosing: false};
    const update = (patch) => setSelection({...sel, ...patch, ask});
    const choices = sel.choices;
    const sourceFor = (p) => DS.partSource(sources, p, choices[p.id], activeOf(DS.kindOfPart(p)));
    const srcOf = (k, p) => ask.perPart && p ? sourceFor(p).src : activeOf(k).src;
    const choose = (p, id) => update({choices: {...choices, [p.id]: id}});
    const completing = plan.kept > 0;
    const lic = ask.licenses && ask.licenses.length ? ask.licenses : null;
    // 存放位置只管模型仓库那一组；工具与运行库装在工具目录
    const hubNeed = plan.groups.filter((g) => g.k === 'models').reduce((n, g) => n + g.need, 0);
    const toolsNeed = plan.groups.some((g) => g.k !== 'models' && g.need > 0);
    const dir = window.modelsDirNow ? window.modelsDirNow(app) : MD.effective(app.prefs.modelsDirEnv || null, null);
    const target = MD.downloadTarget(app.prefs.modelsDirEnv || null, dir.path, sel.pick);
    const problem = hubNeed > 0 ? MD.targetProblem(target.path, hubNeed) : null;
    const confirm = () => {
      const outcome = DS.simulate(plan, srcOf, app.prefs.dlFailDemo || null);
      const hubIds = plan.groups.filter((g) => g.k === 'models').flatMap((g) => g.parts).map((p) => p.id);
      places = MD.placeAfter(places, outcome.done.filter((id) => hubIds.indexOf(id) >= 0), target);
      closeDownload();
      ask.run(outcome, plan);
    };
    const manage = () => { closeDownload(); app.go({r: 'settings', sec: 'general'}); };
    const footer = plan.upToDate ? [<Btn key="c" variant="secondary" onClick={closeDownload}>关闭</Btn>] : [
      <Btn key="c" variant="secondary" onClick={closeDownload}>取消</Btn>,
      <Btn key="k" variant="accent" disabled={!!problem} onClick={confirm}>{lic ? `我知道了，下载 ${mb(plan.need)}` : `下载 ${mb(plan.need)}`}</Btn>,
    ];
    return (
      <Dialog open title={completing ? `补齐「${ask.name}」` : `下载「${ask.name}」`} width={560} onClose={closeDownload} footer={footer}>
        {plan.upToDate ? <p className="t-body">都已经下好了，不用再下载。</p> : (
          <div className="dldlg">
            <p className="dldlg__lead"><b>共 {mb(plan.need)}</b><span className="t-detail"> · 磁盘还剩 {mb(MD.freeOf(target.path))}</span></p>
            {completing ? <p className="t-detail">已下好的部分不动，只下缺的。</p> : null}
            {hubNeed > 0 ? (
              <Where target={target} current={dir.path} choosing={sel.choosing} problem={problem}
                notes={MD.targetNotes(target, toolsNeed)}
                onChoose={() => update({choosing: !sel.choosing})}
                onPick={(path) => update({pick: path, choosing: false})}
                onReset={() => update({pick: null, choosing: false})} />
            ) : null}
            {ask.perPart ? (
              <ul className="dldlg__items" aria-label="下载内容与来源">
                {plan.groups.flatMap((g) => g.parts).map((p) => {
                  const current = sourceFor(p);
                  return (
                    <li key={p.id} className={cx('dldlg__part', 'dldlg__item', p.keep && 'is-keep')}>
                      <div className="dldlg__pl">
                        <b className="dldlg__pn">{p.name}</b>
                        <span className="dldlg__ps">{p.keep ? '已安装 · 保留' : mb(p.size)}</span>
                      </div>
                      {p.keep ? null : <>
                        <div className="dldlg__source">
                          <span className="t-detail-xs">下载来源</span>
                          <window.DownloadSourcePicker k={DS.kindOfPart(p)} label={`${p.name}的下载来源`}
                            selection={current} onSelect={(id) => choose(p, id)} />
                        </div>
                        <span className="dldlg__url t-mono">{DS.partUrl(current.src, p)}</span>
                        {current.locked ? <span className="t-detail-xs">由环境变量 {DS.kindOf(DS.kindOfPart(p)).env} 指定</span> : null}
                      </>}
                    </li>
                  );
                })}
              </ul>
            ) : plan.groups.map((g) => <Group key={g.k} g={g} srcOf={srcOf} />)}
            <p className="t-detail-xs dldlg__note">
              {plan.groups.filter((g) => g.need).length > 1 ? '几个部分依次下载，下好一个存一个；哪一部分没下成，补齐时只下那一部分。' : ''}
              {ask.perPart ? '每项可分别选择来源，仅用于本次下载。' : '在这里换来源，以后的下载也用它。'}{ask.added ? '每个文件都按添加时记下的校验值核对。' : '每个文件都按内置的校验值核对。'}
              <BCAction className="tsetup__lnk dldlg__lnk" onClick={manage}>管理下载来源…</BCAction>
            </p>
            {lic ? (
              <div className="ttslic dldlg__lic" role="note" aria-label="许可">
                {lic.map((x) => (
                  <div key={x.name} className="ttslic__item">
                    <b>许可 · {x.name}</b>
                    <span>{window.ttsLicenseBrief(x.lic)}</span>
                    <span className="t-detail-xs">{x.lic.url}</span>
                  </div>
                ))}
                {ask.licenseUse ? <span className="t-detail">{ask.licenseUse}</span> : null}
              </div>
            ) : null}
          </div>
        )}
      </Dialog>
    );
  }

  Object.assign(window, {ModelDownloadDialog, askModelDownload,
    BC_DLASK: {open: openDownload, close: closeDownload, places: () => places}});
})();
