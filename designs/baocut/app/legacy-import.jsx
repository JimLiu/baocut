/* 旧版项目导入的启动询问（2026-10-08 用户要求；默认目录、回答的记录与规格差异见 model-legacy-import.js）。
   只在 App 入口挂（main.jsx），Web 不加载。三件事各一处：
   - 要不要导入：主按钮「导入」带焦点，Enter 直接导入；「跳过」与关掉对话框都是这次不导入、下次启动再问。
   - 导入到哪：默认是系统文稿 / 文档文件夹下的 BaoCut，「更改…」交给系统的文件夹选择器（原型轮换演示目录）。
   - 不再提醒：S2 Dialog 的 Footer 插槽里的勾选框，和按钮同一行；跳过时勾着它就记下，以后不再导入。
   清单只列旧标题与上次编辑，不在这里逐个挑选——要导入的就是 Runtime 发现的全部。
   点「导入」之后，导入是一条后台任务（legacy-import-task.jsx）：进度在顶栏胶囊与后台任务里，结果与没导入的原因在任务详情。 */
(function () {
  const {useState} = React;
  const S = window.RSP;
  const LI = window.BC_LEGACY_IMPORT;
  const LR = window.BC_LEGACY_IMPORT_RUN;

  /** 落一条导入任务，返回任务 id。Runtime 的导入不能中途取消，任务也就没有「取消」 */
  function addImportTask(app, legacy, extra) {
    return app.addTask(Object.assign({kind: 'legacy-import', title: '导入旧版项目', cancellable: false}, extra, LR.taskPatch(legacy)));
  }

  function LegacyImportAsk({app}) {
    const host = app.legacyHost;
    const found = LI.DEMO_FOUND;
    const [dest, setDest] = useState(() => LI.defaultDest(host));
    const [never, setNever] = useState(false);
    const shown = LI.label(dest, host);
    const answer = (action) => {
      const r = LI.decide(action, never, shown, found.length);
      if (r.record) app.setPref('legacyImport', r.record);
      app.setLegacyAsk(false);
      if (action !== 'import') { app.toast(r.toast, r.tone); return; }
      const id = addImportTask(app, LR.start(found, shown, host));
      app.toast(r.toast, r.tone, {label: '查看进度', run: () => app.go({r: 'task', id})});
    };
    const pick = () => {
      const next = LI.nextDemoDir(host, dest);
      setDest(next);
      app.toast(`导入到 ${LI.label(next, host)} · 交互原型模拟系统文件夹选择器`);
    };
    return (
      <S.DialogContainer onDismiss={() => answer('skip')}>
        <S.Dialog size="M" aria-label="导入旧版项目">
          <S.Heading slot="title">导入旧版项目？</S.Heading>
          <S.Content>
            <p className="lgi__lead">这台电脑上有 {found.length} 个旧版 BaoCut 的项目。导入后可以在新版里继续编辑，旧文件留在原处，不会改动。</p>
            <ul className="lgi__list bc-scroll" aria-label="发现的旧版项目">
              {found.map((f) => (
                <li key={f.title} className="lgi__item">
                  <span className="lgi__name">{f.title}</span>
                  <span className="lgi__when">{f.edited}</span>
                </li>
              ))}
            </ul>
            <div className="lgi__dest">
              <span className="lgi__lb">导入到</span>
              <div className="lgi__path">
                <S.Icons.Folder />
                <span className="lgi__dir t-mono" title={shown}>{shown}</span>
                {dest !== LI.defaultDest(host)
                  ? <Btn size="s" variant="quiet" onClick={() => setDest(LI.defaultDest(host))}>改回默认</Btn>
                  : null}
                <Btn size="s" variant="quiet" onClick={pick}>更改…</Btn>
              </div>
              <span className="lgi__note">这个目录会作为一个项目出现在 Home，每个旧版项目是其中的一个视频。</span>
            </div>
            <p className="lgi__note lgi__hint">跳过后，下次启动还会再问；勾选「不再提醒」后不再导入。</p>
          </S.Content>
          <S.Footer>
            <Checkbox on={never} onChange={setNever} label="不再提醒" />
          </S.Footer>
          <S.ButtonGroup>
            <Btn variant="secondary" onClick={() => answer('skip')}>跳过</Btn>
            <Btn variant="accent" autoFocus onClick={() => answer('import')}>导入</Btn>
          </S.ButtonGroup>
        </S.Dialog>
      </S.DialogContainer>
    );
  }

  /* 每次弹出都从默认值开始：关着的时候整个卸载，目录与勾选不跨次保留。
     演示的导入进程也挂在这里——它在外壳根上常驻，换页不打断导入。 */
  function LegacyImportDialog() {
    const app = useApp();
    return (
      <>
        {window.LegacyImportRunner ? <window.LegacyImportRunner /> : null}
        {app.legacyAsk ? <LegacyImportAsk app={app} /> : null}
      </>
    );
  }

  /* 原型开关里的一段（shell.jsx 委托到这里，不属于产品 UI）：演示哪个平台的路径、模拟一次启动、清掉记录；
     演示外接硬盘接没接上（重试时用），以及不等进度、直接落一条跑完的导入任务去看结果。
     模拟启动先收起原型开关（`onLaunch`），不然询问框会叠在它下面 */
  function LegacyImportTweaks({onLaunch}) {
    const app = useApp();
    const rec = app.prefs.legacyImport;
    const launch = () => {
      if (LI.shouldAsk(LI.DEMO_FOUND.length, rec)) { if (onLaunch) onLaunch(); app.setLegacyAsk(true); }
      else app.toast(`已有记录：${LI.recordText(rec, app.legacyHost)}，启动时不再问`);
    };
    const drive = LR.demoDrive(app.legacyHost);
    const result = () => {
      const legacy = LR.settle(LR.start(LI.DEMO_FOUND, LI.defaultDest(app.legacyHost), app.legacyHost),
        app.legacyDrive ? [drive.root] : []);
      const id = addImportTask(app, legacy, {started: '1 分钟前'});
      if (onLaunch) onLaunch();
      app.go({r: 'task', id});
    };
    return (
      <div className="tweaks__sec">
        <div className="tweaks__lb">旧版项目导入<em>发现旧版项目、又没有记录时，启动就问；地址带 ?legacy=1 打开即模拟一次启动。导入时素材在外接硬盘上的，硬盘没接上就导入不了。当前记录：{LI.recordText(rec, app.legacyHost)}</em></div>
        <div className="tweaks__rad">
          {LI.HOSTS.map(({k, label}) => (
            <BCAction key={k} className={cx('tweaks__opt', app.legacyHost === k && 'is-on')}
              onClick={() => app.setLegacyHost(k)}>{label} 路径</BCAction>
          ))}
        </div>
        <div className="tweaks__rad">
          <BCAction className="tweaks__opt" onClick={launch}>模拟启动</BCAction>
          <BCAction className="tweaks__opt" onClick={() => app.setPref('legacyImport', null)}>清除记录</BCAction>
        </div>
        <div className="tweaks__rad">
          {[[false, `「${drive.name}」没接上`], [true, `「${drive.name}」已接上`]].map(([on, label]) => (
            <BCAction key={label} className={cx('tweaks__opt', !!app.legacyDrive === on && 'is-on')}
              onClick={() => app.setLegacyDrive(on)}>{label}</BCAction>
          ))}
        </div>
        <div className="tweaks__rad">
          <BCAction className="tweaks__opt" onClick={result}>直接看导入结果</BCAction>
        </div>
      </div>
    );
  }

  Object.assign(window, {LegacyImportDialog, LegacyImportTweaks});
})();
