/* 下载确认框（2026-10-13 设计稿；product-design「本地模型由用户安装」：先显示大小与来源，确认后才下载）。
   所有模型下载都过这一个框：设置 › 本地模型的「下载 / 补齐」、公共组件、语义索引、面板与工具页的「下载模型」、我的声音。
   · 这次要下的部分按来源种类分组（模型仓库 / 工具与运行库），每组一个来源选择器，就地换来源；换的是 设置 › 通用 › 下载来源 里的「在用」，
     以后的下载也用它。每个部分写出按当前来源拼的地址。
   · 几个部分合成一次下载，按顺序下，下好一个存一个；哪一部分没下成，前面的留着，补齐时只下缺的那一部分（可以先换来源）。
   · 已在盘上的部分写「已下好 · 不动」，不计入大小；全都下好了只说一句、不给下载。
   · 不许商用的模型把许可写在框里，确认按钮写「我知道了，下载 …」（替掉原来单独弹的许可确认）。
   原型开关「下次下载的结果」可以让某一种来源下不成（BC_DLSRC.simulate），演示补齐。只在 App。 */
(function () {
  const {useState, useEffect} = React;
  const DS = window.BC_DLSRC;
  const D = window.BC_DATA;
  const mb = (n) => window.BC_LOCALMODELS.mb(n);
  const FREE = '269.5 GB';   // 演示：模型目录所在磁盘的剩余空间

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
      licenseUse: licenses.length && window.ttsLicenseUse ? window.ttsLicenseUse(licenses[0].cat) : null,
      run,
    });
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
    const [, , activeOf] = window.useDlSources();
    if (!ask) return null;
    const plan = DS.plan(ask.parts, ask.on);
    const srcOf = (k) => activeOf(k).src;
    const completing = plan.kept > 0;
    const lic = ask.licenses && ask.licenses.length ? ask.licenses : null;
    const confirm = () => {
      const outcome = DS.simulate(plan, srcOf, app.prefs.dlFailDemo || null);
      closeDownload();
      ask.run(outcome, plan);
    };
    const manage = () => { closeDownload(); app.go({r: 'settings', sec: 'general'}); };
    const footer = plan.upToDate ? [<Btn key="c" variant="secondary" onClick={closeDownload}>关闭</Btn>] : [
      <Btn key="c" variant="secondary" onClick={closeDownload}>取消</Btn>,
      <Btn key="k" variant="accent" onClick={confirm}>{lic ? `我知道了，下载 ${mb(plan.need)}` : `下载 ${mb(plan.need)}`}</Btn>,
    ];
    return (
      <Dialog open title={completing ? `补齐「${ask.name}」` : `下载「${ask.name}」`} width={560} onClose={closeDownload} footer={footer}>
        {plan.upToDate ? <p className="t-body">都已经下好了，不用再下载。</p> : (
          <div className="dldlg">
            <p className="dldlg__lead"><b>共 {mb(plan.need)}</b><span className="t-detail"> · 磁盘还剩 {FREE}</span></p>
            {completing ? <p className="t-detail">已下好的部分不动，只下缺的。</p> : null}
            {plan.groups.map((g) => <Group key={g.k} g={g} srcOf={srcOf} />)}
            <p className="t-detail-xs dldlg__note">
              {plan.groups.filter((g) => g.need).length > 1 ? '几个部分依次下载，下好一个存一个；哪一部分没下成，补齐时只下那一部分。' : ''}
              在这里换来源，以后的下载也用它。每个文件都按内置的校验值核对。
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

  Object.assign(window, {ModelDownloadDialog, askModelDownload, BC_DLASK: {open: openDownload, close: closeDownload}});
})();
