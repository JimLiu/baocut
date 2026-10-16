/* 设置 › 语义索引（embedding-integration-design §2.11；retrieval-spec v0.1 §4.2、§4.4、§9.1、§13.2）。偏好设置一组。
   · 模型：一个包「语义搜索」，文字模型与多模态模型一起装（2026-10-13 待确认，原来分文字 / 多模态两个包）；
     安装先过下载确认框（download-dialog.jsx）：文字模型、多模态模型与共享 LiteRT-LM 运行时列在一个对话框，各项单独选本次下载来源；
     一部分没下成时下好的留着（st.half），卡片写哪一部分、连的哪里，「补齐」只下缺的（2026-10-13）；
     确认后落一条后台任务（BC_SEMSTATE.install，与首次启动引导共用），离开设置页照样装完（2026-10-16）；
   · 安装不等于扫描整块磁盘：只给索引范围里的视频建；视频缺省按讲话内容与画面都建（画面是「索引」里一个开关，缺省开，
     2026-10-13 待确认）——安装前就写明画面要建多少帧、首次要多久、向量多大（indexStatus.estimates 的画面一项），
     装好后在后台建，可以随时关；关掉后再打开仍先确认开销；
   · 索引：状态、缓存大小、暂停 / 恢复 / 清理、位置（可以改到别的磁盘，settings-semantic-scope.jsx）、运行在哪个模型与设备（装了多模态模型时讲话内容也用它；文字能用 GPU 时用 GPU）；
     在更新时状态下面一根进度条，讲话内容与画面合在一起（画面等讲话内容建完再建），按路写计数与两路合起来还要多久（按这台电脑量过的速度，2026-10-14 已确认）；用电池、过热降频时自动停下，状态写原因，「用电池时暂停」可关（2026-10-13）；
   · 索引范围：缺省是所有 BaoCut 项目（一行合起来的完整性，不逐个列），可以排除项目；Space 里单独设了不索引的条目也列在这里；
     下面是项目之外加进来的索引文件夹（添加 / 在文件夹中显示 / 重新索引 / 移除）。都在 settings-semantic-scope.jsx；
   · 用到它的两项开关：翻译记忆、术语候选，缺省都开；
   · 这台电脑不支持时整页说明原因，精确文字搜索照常可用。
   状态在 semantic-state.jsx，规则与文案在 model-semantic.js。只在 App。 */
(function () {
  const R = window.RSP;
  const S = window.BC_SEMANTIC;
  const D = window.BC_DATA;
  const SEM = D.semantic;
  const Row = window.ShellRow;

  const mbOf = (n) => window.BC_LOCALMODELS.mb(n);
  /** 这个包盘上已有的部分（上次没下完时）：id → true */
  const haveOf = (p, st) => {
    const on = {};
    if (st.half && st.half.pkg === p.id) st.half.have.forEach((id) => { on[id] = true; });
    return on;
  };

  /* job：正在跑的那条安装任务（BC_SEMSTATE.install 落的，带 semPkg）；没有时 null */
  function PackageCard({p, st, set, job, onInstall}) {
    const app = useApp();
    const mine = job && job.semPkg === p.id ? job : null;
    const has = st.install !== 'none';
    const half = st.half && st.half.pkg === p.id && !has ? st.half : null;
    const plan = window.BC_DLSRC.plan(p.parts, haveOf(p, st));
    const lack = half ? plan.groups.flatMap((g) => g.parts).filter((x) => !x.keep) : [];
    const unsupported = st.platform === 'unsupported';
    const remove = () => app.confirm({
      title: `移除「${p.name}」？`,
      body: '模型文件与语义索引一起删掉，约释放 ' + p.size + ' 与 ' + S.fmtBytes(SEM.cacheBytes) + '。Space 搜索退回精确文字，写作的「按主题」置灰。重新安装后从已有文稿重建。',
      confirmLabel: '移除', tone: 'negative',
      run: () => { set({install: 'none', paused: false}); app.toast(`已移除「${p.name}」（演示）`, 'positive'); },
    });
    return (
      <div className="semset__pkg">
        <div className="row gap8">
          <b className="grow">{p.name}</b>
          <span className="t-detail-xs">{p.size}</span>
          {mine ? <Chip tone="accent">正在安装</Chip>
            : has ? <Chip tone="positive">已安装</Chip>
                : half && plan.kept ? <Chip tone="notice">缺 {lack.map((x) => x.name).join('、')}</Chip> : <Chip>未安装</Chip>}
        </div>
        <span className="t-detail-xs">{p.desc} · {p.model}</span>
        {half && !mine ? <p className="semset__fail" role="status"><Ic n="alert" className="ic--14" /><span>{half.note}</span></p> : null}
        {mine ? <Progress value={mine.pct || 0} thin label={`正在安装${p.name}`} /> : null}
        <div className="row gap8">
          {!has && !mine ? (
            half && plan.kept
              ? <Btn size="s" variant="accent" disabled={unsupported || !!job} onClick={() => onInstall(p)}>{`补齐 · ${mbOf(plan.need)}`}</Btn>
              : <Btn size="s" variant="accent" icon="download" disabled={unsupported || !!job} onClick={() => onInstall(p)}>{`安装 · ${p.size}`}</Btn>
          ) : null}
          {has ? <Btn size="s" variant="quiet" onClick={remove}>移除</Btn> : null}
        </div>
      </div>
    );
  }

  function DemoStates({st, set}) {
    return (
      <BCDisclosure className="import-demo" title={<> 语义索引演示场景 </>}>
        <div className="vdemo">
          <label>模型<BCSelect aria-label="模型演示挡位" value={st.install} onChange={(e) => set({install: e.target.value})}>
            <option value="none">没装</option><option value="full">已安装</option></BCSelect></label>
          <label>这台电脑<BCSelect aria-label="平台演示挡位" value={st.platform} onChange={(e) => set({platform: e.target.value})}>
            <option value="ok">支持</option><option value="unsupported">不支持</option></BCSelect></label>
          <label>上次下载<BCSelect aria-label="上次下载演示挡位" value={st.half ? 'half' : 'ok'}
            onChange={(e) => set(e.target.value === 'half' ? {install: 'none', half: {pkg: 'sem', have: ['embedding-text', 'embedding'],
              note: window.BC_DLSRC.failLine({name: 'LiteRT-LM 运行时', host: 'github.com'}, ['文字模型', '多模态模型'])}} : {half: null})}>
            <option value="ok">没出错</option><option value="half">缺运行库</option></BCSelect></label>
          <label>索引<BCSelect aria-label="索引演示挡位" value={st.index} onChange={(e) => set({index: e.target.value})}>
            <option value="ready">已跟上</option><option value="stale">正在更新</option></BCSelect></label>
          <label>建到<BCSelect aria-label="建到哪一路演示挡位" value={st.phase || 'text'} disabled={st.index !== 'stale'} onChange={(e) => set({phase: e.target.value})}>
            <option value="text">讲话内容（画面排在后面）</option><option value="visual">画面</option></BCSelect></label>
          <label>供电<BCSelect aria-label="供电演示挡位" value={st.power || 'ac'} onChange={(e) => set({power: e.target.value})}>
            <option value="ac">接着电源</option><option value="battery">用电池</option><option value="thermal">过热降频</option></BCSelect></label>
        </div>
      </BCDisclosure>
    );
  }

  function SemanticSection() {
    const app = useApp();
    const [st, sem, set] = window.BC_SEMSTATE.useSemantic();
    // 安装 / 补齐都先过下载确认框；确认后交给 BC_SEMSTATE.install：落一条后台任务，离开设置页照样装完。
    // outcome 说哪一部分没下成（原型开关「下次下载的结果」）
    const job = (app.tasks || []).find((t) => t.kind === 'model-install' && t.semPkg && t.status === 'running') || null;
    const install = (p) => window.BC_DLASK.open({
      name: p.name, parts: p.parts, on: haveOf(p, st), perPart: true,
      run: (outcome) => window.BC_SEMSTATE.install(app, p, {outcome, notify: true}),
    });
    const unsupported = st.platform === 'unsupported';
    const installed = st.install !== 'none' && !unsupported;
    const clear = () => app.confirm({
      title: '清理语义索引？',
      body: `删掉 ${S.fmtBytes(SEM.cacheBytes)} 的索引与缓存，模型保留。之后按已有文稿在后台重建；重建完成前，用到语义的入口会提示索引在更新。`,
      confirmLabel: '清理', tone: 'negative',
      run: () => { set({index: 'stale'}); app.toast('已清理，正在后台重建（演示）', 'positive'); },
    });
    const why = S.pauseReasonOf(st);
    const indexState = why ? '已暂停' : st.index === 'stale' ? '正在更新' : '已就绪';
    const full = st.install === 'full';
    const visualOn = full && st.visual;
    // 在建时两路合一根进度条，放在「状态」下面（2026-10-14 已确认）：讲话内容先建，画面等它建完；
    // 计数按路写、不写百分比，还要多久是两路合起来的（同 Electron / Web）。画面没开时只有讲话内容一路
    const ph = SEM.estimate.progress[visualOn && st.phase === 'visual' ? 'visual' : 'text'];
    const prog = st.index === 'stale' ? S.indexProgress(visualOn ? ph : {text: ph.text}, why) : null;
    const stateDesc = why === 'user' ? '暂停时不建新索引；已有的照常能搜，结果可能不含最近的修改。'
      : why ? S.POWER_NOTE[why] + '。'
        : st.index === 'stale' ? `${S.STALE_NOTE}。`
          : visualOn ? '已有文稿的文字索引与画面索引都建好了。' : '所有已有文稿都建好了文字索引。';
    const cost = S.visualCostLine(SEM.estimate.visual);
    // 打开画面：先确认范围与开销（v0.1 §9.1），在后台建；关掉只是不再建新的
    const setVisual = (on) => {
      if (!on) { set({visual: false}); app.toast('已关闭画面索引：不再建新的画面索引（演示）', 'positive'); return; }
      app.confirm({
        title: '打开画面索引？',
        body: `给索引范围里的视频与图片按内容找画面：${cost}。在后台用 CPU 建，随时可以暂停。`,
        confirmLabel: '打开',
        run: () => { set({visual: true, index: 'stale'}); app.toast('已打开画面索引，正在后台建（演示）', 'positive'); },
      });
    };
    const visualDesc = visualOn ? '索引范围里的视频与图片会按画面内容建立索引。关掉后不再建新的画面索引。'
      : `按画面内容找镜头、给句子配画面。打开后要建：${cost}。`;
    return (
      <>
        <h1 className="setpage__title">语义索引</h1>
        <p className="t-detail semset__lead">按意思找讲话内容：Space 搜索、写作按主题选材、术语候选、翻译记忆与重录候选都用它。模型与索引都在这台电脑上，不上传。</p>
        {unsupported ? (
          <R.InlineAlert variant="notice" UNSAFE_className="semset__alert">
            <R.Heading>这台电脑暂不支持本机语义模型</R.Heading>
            <R.Content>自检没有通过（处理器或系统不满足运行要求）。精确文字搜索、写作的整篇与章节范围、术语表的精确匹配照常可用。</R.Content>
          </R.InlineAlert>
        ) : null}
        <section className="setpage__group" aria-label="模型">
          <h2>模型</h2>
          <div className="setpage__card semset__card">
            {SEM.packages.map((p) => <PackageCard key={p.id} p={p} st={st} set={set} job={job} onInstall={install} />)}
            <div className="semnote"><Ic n="info" className="ic--14" /><span className="semnote__x">{`文字模型与多模态模型一起装。装好后给索引范围里的视频按讲话内容建索引，再按画面建：${cost}；用电池时先停下，不想要画面可以在下面关掉。`}</span></div>
          </div>
        </section>
        {installed ? (
          <section className="setpage__group" aria-label="索引">
            <h2>索引</h2>
            <div className="setpage__card">
              <Row label="状态" desc={stateDesc}>
                <Chip tone={why ? 'notice' : st.index === 'stale' ? 'accent' : 'positive'}>{indexState}</Chip>
                <Btn size="s" variant="secondary" onClick={() => set({paused: !st.paused})}>{st.paused ? '恢复' : '暂停'}</Btn>
              </Row>
              {prog ? (
                <div className="semset__bar">
                  {/* 停着时不画动：估不出时间又停着，只写那两行 */}
                  {prog.value !== null || !why ? (
                    <Progress value={prog.value} indeterminate={prog.value === null} thin className="semset__barp"
                      label={prog.value === null ? '索引进度' : `索引进度 ${Math.round(prog.value)}%`} />
                  ) : null}
                  <span className="t-detail-xs" role="status">{prog.line}</span>
                  <span className="t-detail-xs">{prog.eta}</span>
                </div>
              ) : null}
              <Row label="画面" desc={visualDesc}>
                <Switch on={visualOn} disabled={!full} onChange={setVisual} ariaLabel="画面索引" />
              </Row>
              <Row label="用电池时暂停" desc="笔记本用电池时先不建，接上电源后接着建。电脑过热降频时总会暂停。">
                <Switch on={st.pauseOnBattery !== false} onChange={(v) => set({pauseOnBattery: v})} ariaLabel="用电池时暂停" />
              </Row>
              <Row label="缓存" desc="向量与索引，不进项目目录。">
                <span className="t-body-sm">{S.fmtBytes(SEM.cacheBytes)}</span>
                <Btn size="s" variant="quiet" onClick={clear}>清理</Btn>
              </Row>
              <window.SemanticIndexLocationRow st={st} set={set} bytes={SEM.cacheBytes} />
              <Row label="运行在" desc={SEM.backend.note}>
                <span className="t-body-sm">{SEM.backend.label}</span>
              </Row>
            </div>
          </section>
        ) : null}
        {installed ? (
          <section className="setpage__group" aria-label="索引范围">
            <h2>索引范围</h2>
            <p className="t-detail-xs semset__sub">所有 BaoCut 项目里的视频都建：讲话内容与画面；声音这一版还没有。不想建的项目可以排除；项目之外的素材可以加文件夹；成片不另建，搜导出它的视频就能找到。</p>
            <div className="setpage__card semset__card">
              <window.SemanticIndexScope st={st} set={set} />
            </div>
          </section>
        ) : null}
        <section className="setpage__group" aria-label="用到语义索引的功能">
          <h2>用到语义索引的功能</h2>
          <div className="setpage__card">
            <Row label="翻译记忆" desc={installed ? '翻译时参考你已有的译文：原文几乎相同的句子沿用，字幕里标「沿用」；同一术语的不同译法列出来。' : '没装模型时只沿用原文完全相同的句子。'}>
              <Switch on={st.tm} onChange={(v) => set({tm: v})} />
            </Row>
            <Row label="术语候选" desc={installed ? '润色时按读音与意思找疑似误听的写法，列成候选给你勾选。' : '没装模型时只按术语表里记下的误听写法精确匹配。'}>
              <Switch on={st.terms} onChange={(v) => set({terms: v})} />
            </Row>
          </div>
        </section>
        <DemoStates st={st} set={set} />
        <p className="t-detail-xs">{`交互原型：不下载模型、不建索引。当前：${sem.usable ? '语义可用' : sem.reason === 'UNSUPPORTED' ? '平台不支持' : '没装模型'}。`}</p>
      </>
    );
  }

  Object.assign(window, {SemanticSection});
})();
