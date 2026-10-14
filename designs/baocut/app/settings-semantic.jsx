/* 设置 › 语义索引（embedding-integration-design §2.11；retrieval-spec v0.1 §4.2、§4.4、§9.1、§13.2）。偏好设置一组。
   · 模型：「文字搜索」「多模态搜索」两个包与安装状态；多模态包含文字，装了它不必再装文字包；
     安装先过下载确认框（download-dialog.jsx）：模型文件（模型仓库）与 LiteRT-LM 运行时（GitHub 发布页）合成一次下载，各自可换来源；
     一部分没下成时下好的留着（st.half），卡片写哪一部分、连的哪里，「补齐」只下缺的（2026-10-13）；
   · 安装不等于扫描：装完只对已有文稿建轻量文字索引；画面在「索引」里打开（一个开关，跟着已索引的项目走），
     打开前写明要建多少帧、首次要多久、向量多大（indexStatus.estimates 的画面一项，2026-10-13）；
   · 索引：状态、缓存大小、暂停 / 恢复 / 清理、实际后端（自检后选的那一个）；
     在更新时写还要多久（按这台电脑量过的速度）；用电池、过热降频时自动停下，状态写原因，「用电池时暂停」可关（2026-10-13）；
   · 已索引的项目：每个项目按通道写完整性（「文字 2/3 部视频（1 部还在转录）」「画面 0/30 个素材完成」），画面没开时写范围，
     声音这一版没有；
   · 用到它的两项开关：翻译记忆、术语候选，缺省都开；
   · 这台电脑不支持时整页说明原因，精确文字搜索照常可用。
   状态在 semantic-state.jsx，规则与文案在 model-semantic.js。只在 App。 */
(function () {
  const {useState, useRef, useEffect} = React;
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

  function PackageCard({p, st, set, busy, onInstall}) {
    const app = useApp();
    const has = st.install === 'full' ? true : st.install === 'text' && p.id === 'sem-text';
    const half = st.half && st.half.pkg === p.id && !has ? st.half : null;
    const plan = window.BC_DLSRC.plan(p.parts, haveOf(p, st));
    const lack = half ? plan.groups.flatMap((g) => g.parts).filter((x) => !x.keep) : [];
    const covered = st.install === 'full' && p.id === 'sem-text';
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
          {busy === p.id ? <Chip tone="accent">正在安装</Chip>
            : covered ? <Chip>已含在多模态搜索里</Chip>
              : has ? <Chip tone="positive">已安装</Chip>
                : half && plan.kept ? <Chip tone="notice">缺 {lack.map((x) => x.name).join('、')}</Chip> : <Chip>未安装</Chip>}
        </div>
        <span className="t-detail-xs">{p.desc} · {p.model}</span>
        {half && busy !== p.id ? <p className="semset__fail" role="status"><Ic n="alert" className="ic--14" /><span>{half.note}</span></p> : null}
        {busy === p.id ? <Progress indeterminate thin label={`正在安装${p.name}`} /> : null}
        <div className="row gap8">
          {!has && !covered && busy !== p.id ? (
            half && plan.kept
              ? <Btn size="s" variant="accent" disabled={unsupported || !!busy} onClick={() => onInstall(p)}>{`补齐 · ${mbOf(plan.need)}`}</Btn>
              : <Btn size="s" variant={p.id === 'sem-text' ? 'accent' : 'secondary'} icon="download" disabled={unsupported || !!busy} onClick={() => onInstall(p)}>{`安装 · ${p.size}`}</Btn>
          ) : null}
          {has && !covered ? <Btn size="s" variant="quiet" onClick={remove}>移除</Btn> : null}
        </div>
      </div>
    );
  }

  /* 一个项目：文字与画面的完整性（画面开着时）；画面没开时写这个项目的范围；声音这一版没有。
     画面开关只有一个（在「索引」里，设置 semantic.channels，跟着「建索引的项目」走），项目里不另设开关。 */
  function ProjectRow({p, st}) {
    const app = useApp();
    const d = (app.dirs || []).find((x) => x.id === p.dir) || {name: p.dir};
    const visualOn = st.install === 'full' && st.visual;
    const scope = (k) => `${p[k].assets} 个素材 · ${p[k].minutes} 分钟`;
    const visual = visualOn ? {done: st.index === 'stale' ? 0 : p.visual.assets, total: p.visual.assets} : null;
    return (
      <div className="semset__proj">
        <div className="semset__projh">
          <b className="grow">{d.name}</b>
          <span className="t-detail-xs">{S.coverageLine(visual ? {text: p.text, visual} : {text: p.text})}</span>
        </div>
        <div className="semset__chs">
          {visualOn ? null : <span className="t-detail-xs">{`画面：${scope('visual')} · 没开`}</span>}
          <span className="t-detail-xs">{`声音：${scope('audio')} · 后续版本开放`}</span>
        </div>
      </div>
    );
  }

  function DemoStates({st, set}) {
    return (
      <BCDisclosure className="import-demo" title={<> 语义索引演示场景 </>}>
        <div className="vdemo">
          <label>安装的包<BCSelect aria-label="安装的包演示挡位" value={st.install} onChange={(e) => set({install: e.target.value})}>
            <option value="none">没装</option><option value="text">文字搜索</option><option value="full">多模态搜索</option></BCSelect></label>
          <label>这台电脑<BCSelect aria-label="平台演示挡位" value={st.platform} onChange={(e) => set({platform: e.target.value})}>
            <option value="ok">支持</option><option value="unsupported">不支持</option></BCSelect></label>
          <label>上次下载<BCSelect aria-label="上次下载演示挡位" value={st.half ? 'half' : 'ok'}
            onChange={(e) => set(e.target.value === 'half' ? {install: 'none', half: {pkg: 'sem-full', have: ['embedding'],
              note: window.BC_DLSRC.failLine({name: 'LiteRT-LM 运行时', host: 'github.com'}, ['模型文件'])}} : {half: null})}>
            <option value="ok">没出错</option><option value="half">多模态搜索缺运行库</option></BCSelect></label>
          <label>索引<BCSelect aria-label="索引演示挡位" value={st.index} onChange={(e) => set({index: e.target.value})}>
            <option value="ready">已跟上</option><option value="stale">正在更新</option></BCSelect></label>
          <label>供电<BCSelect aria-label="供电演示挡位" value={st.power || 'ac'} onChange={(e) => set({power: e.target.value})}>
            <option value="ac">接着电源</option><option value="battery">用电池</option><option value="thermal">过热降频</option></BCSelect></label>
        </div>
      </BCDisclosure>
    );
  }

  function SemanticSection() {
    const app = useApp();
    const [st, sem, set] = window.BC_SEMSTATE.useSemantic();
    const [busy, setBusy] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    // 安装 / 补齐都先过下载确认框；确认后按顺序下，outcome 说哪一部分没下成（原型开关「下次下载的结果」）
    const install = (p) => window.BC_DLASK.open({
      name: `${p.name} · ${p.model}`, parts: p.parts, on: haveOf(p, st),
      run: (outcome) => {
        setBusy(p.id);
        timer.current = setTimeout(() => {
          setBusy(null);
          const before = Object.keys(haveOf(p, st));
          if (outcome.failed) {
            const have = before.concat(outcome.done);
            const names = have.map((id) => p.parts.find((x) => x.id === id).name);
            set({half: {pkg: p.id, have, note: window.BC_DLSRC.failLine(outcome.failed, names)}});
            app.toast(`「${p.name}」没装完：${outcome.failed.name}没下成`, 'negative');
            return;
          }
          set((cur) => ({install: p.id === 'sem-full' ? 'full' : 'text', index: 'stale', half: cur.half && cur.half.pkg !== p.id ? cur.half : null}));
          app.toast(`已安装「${p.name}」：正在给已有文稿建文字索引（演示）`, 'positive');
        }, 1400);
      },
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
    const eta = S.etaLine(SEM.estimate.text);
    // 还要多久：讲话内容写在状态里，画面写在画面那一行（同 Electron / Web）
    const visualEta = visualOn ? S.etaLine(SEM.estimate.visualLeft) : null;
    const stateDesc = why === 'user' ? '暂停时不建新索引；已有的照常能搜，结果可能不含最近的修改。'
      : why ? S.POWER_NOTE[why] + '。'
        : st.index === 'stale' ? `${S.STALE_NOTE}。${eta ? eta + '。' : ''}`
          : visualOn ? '已有文稿的文字索引与画面索引都建好了。' : '所有已有文稿都建好了文字索引。';
    const cost = S.visualCostLine(SEM.estimate.visual);
    // 打开画面：先确认范围与开销（v0.1 §9.1），在后台建；关掉只是不再建新的
    const setVisual = (on) => {
      if (!on) { set({visual: false}); app.toast('已关闭画面索引：不再建新的画面索引（演示）', 'positive'); return; }
      app.confirm({
        title: '打开画面索引？',
        body: `给「已索引的项目」里的视频按内容找画面：${cost}。在后台用 CPU 建，随时可以暂停。`,
        confirmLabel: '打开',
        run: () => { set({visual: true, index: 'stale'}); app.toast('已打开画面索引，正在后台建（演示）', 'positive'); },
      });
    };
    const visualDesc = !full ? '按画面内容找镜头、给句子配画面。需要多模态搜索。'
      : visualOn ? `已索引的项目里的视频会按画面内容建立索引。关掉后不再建新的画面索引。${st.index === 'stale' && visualEta ? visualEta + '。' : ''}`
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
            {SEM.packages.map((p) => <PackageCard key={p.id} p={p} st={st} set={set} busy={busy} onInstall={install} />)}
            <div className="semnote"><Ic n="info" className="ic--14" /><span className="semnote__x">安装不等于扫描：装好后只给已有文稿建轻量的文字索引；画面要在下面打开，打开前写明范围与开销。</span></div>
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
              <Row label="画面" desc={visualDesc}>
                <Switch on={visualOn} disabled={!full} onChange={setVisual} ariaLabel="画面索引" />
              </Row>
              <Row label="用电池时暂停" desc="笔记本用电池时先不建，接上电源后接着建。电脑过热降频时总会暂停。">
                <Switch on={st.pauseOnBattery !== false} onChange={(v) => set({pauseOnBattery: v})} ariaLabel="用电池时暂停" />
              </Row>
              <Row label="缓存" desc="向量与索引，存在应用数据里，不进项目目录。">
                <span className="t-body-sm">{S.fmtBytes(SEM.cacheBytes)}</span>
                <Btn size="s" variant="quiet" onClick={clear}>清理</Btn>
              </Row>
              <Row label="运行在" desc={SEM.backend.note}>
                <span className="t-body-sm">{SEM.backend.label}</span>
              </Row>
            </div>
          </section>
        ) : null}
        {installed ? (
          <section className="setpage__group" aria-label="已索引的项目">
            <h2>已索引的项目</h2>
            <p className="t-detail-xs semset__sub">文字：有文稿的视频自动建；画面：在上面打开后，这些项目里的视频都建；声音：这一版还没有。</p>
            <div className="setpage__card semset__card">
              {SEM.projects.map((p) => <ProjectRow key={p.dir} p={p} st={st} />)}
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
