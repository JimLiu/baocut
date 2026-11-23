/* 作品标签（docs/design/artifacts §5）：功能区里打开一份 Open Artifact 作品。
   正式版标签里是一个 iframe，载入 Shell 页面带一次性视图票据的地址；原型没有 daemon，用一张按作品类型画的示意页代替那个 iframe，
   只演示宿主这一侧：正在打开、打不开 + 重试、页面经宿主桥要求的「打开会话」「新会话」，以及跟随明暗主题（示意页只用 token）。
   标签的名字与图标来自会话里的作品回执（BC_HOME_ARTIFACTS.find），见 home-workspace.jsx。
   演示：BC_DATA.artifactDemo.failOnce 里的作品第一次打开失败，点「重试」后打开（模拟 daemon 换了端口）。 */
(function () {
  const {useState, useEffect} = React;
  const ART = window.BC_HOME_ARTIFACTS;
  const failedOnce = new Set();

  /* 示意页内容：只为让几种类型看得出区别，不是 Open Artifact 的编辑器 */
  function ArtifactMock({info}) {
    const title = ART.tabTitle(info);
    if (info.type === 'slides') return <div className="hart__slide">
      <span className="hart__eyebrow">第 1 页 / 共 8 页</span>
      <strong>{title}</strong>
      <span>从一帧画面到一条成片：渲染为什么必须是确定的</span>
    </div>;
    if (info.type === 'docs') return <article className="hart__doc">
      <h2>{title}</h2>
      <p>目标：在两周内把功能区的作品标签做成和网页标签一样顺手——打开快、失败时说得清、评论能回到会话。</p>
      <h3>里程碑</h3>
      <p>第一周接上 daemon 与回执；第二周做标签、宿主桥与重试。每个里程碑结束时在这份文档里记一次评审结论。</p>
    </article>;
    if (info.type === 'sheets' || info.type === 'data') return <table className="hart__table">
      <caption>{title}</caption>
      <thead><tr><th scope="col">事项</th><th scope="col">负责人</th><th scope="col">状态</th></tr></thead>
      <tbody>
        <tr><td>接入 daemon</td><td>Runtime</td><td>已完成</td></tr>
        <tr><td>作品标签</td><td>界面</td><td>进行中</td></tr>
        <tr><td>评论回到会话</td><td>Runtime</td><td>待开始</td></tr>
      </tbody>
    </table>;
    return <div className="hart__boards" aria-label={title}>
      {['首屏', '功能介绍', '手机版'].map((name, i) => <figure key={name} className={cx('hart__board', i === 2 && 'hart__board--narrow')}>
        <span className="hart__board-art" aria-hidden="true" /><figcaption>{name}</figcaption>
      </figure>)}
    </div>;
  }

  function WorkspaceArtifact({item, active}) {
    const app = useApp();
    const R = window.RSP;
    const info = ART.find(app.sessions, item.id);
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState('opening');
    useEffect(() => {
      if (!info) { setState('unavailable'); return undefined; }
      setState('opening');
      const failOnce = (window.BC_DATA.artifactDemo?.failOnce || []).includes(item.id);
      const timer = setTimeout(() => {
        if (failOnce && !failedOnce.has(item.id)) { failedOnce.add(item.id); setState('failed'); } else setState('open');
      }, 400);
      return () => clearTimeout(timer);
    }, [item.id, attempt, !!info]);

    if (state === 'opening') return <div className="hart">
      <div className="home-browser__loading" role="status"><R.ProgressCircle aria-label={ART.COPY.opening} isIndeterminate size="S" /><span>{ART.COPY.opening}</span></div>
    </div>;
    if (state !== 'open') return <div className="hart">
      <div className="home-browser__start" role="alert"><R.Icons.AlertTriangle />
        <h2>{state === 'failed' ? ART.COPY.openFailed : ART.COPY.unavailable}</h2>
        <p>{state === 'failed' ? 'Open Artifact 没有回应，可能还在启动或换了端口。' : '这条会话里找不到这份作品。'}</p>
        <R.Button variant="secondary" onPress={() => setAttempt(n => n + 1)}>{ART.COPY.retry}</R.Button>
      </div>
    </div>;

    const title = ART.tabTitle(info);
    const Icon = R.Icons[ART.iconName(info.type)];
    /* 宿主桥上页面能要的两件事：切到拥有作品的会话；把页面上写的话放进新会话的输入框，由用户自己发 */
    const openSession = () => app.go({r: 'agent', id: info.session});
    const newSession = () => app.newProject({entry: 'agent', prompt: `关于作品「${title}」：`});
    return <div className="hart" aria-hidden={active ? undefined : true}>
      <div className="hart__page" role="document" aria-label={`作品「${title}」`}>
        <header className="home-resource__bar hart__shellbar">
          <span className="hart__icon"><Icon /></span>
          <span className="hart__title"><strong title={title}>{title}</strong><span>{ART.typeLabel(info.type)}</span></span>
          <R.ActionButton isQuiet onPress={openSession}><R.Text>打开会话</R.Text></R.ActionButton>
          <R.ActionButton isQuiet onPress={newSession}><R.Icons.Add /><R.Text>新会话</R.Text></R.ActionButton>
        </header>
        <div className="hart__body bc-scroll"><ArtifactMock info={info} /></div>
      </div>
      <footer className="home-resource__path">演示：正式版这里是 Open Artifact 的作品页面（iframe），页面上的评论直接回到这条会话。{info.url}</footer>
    </div>;
  }

  Object.assign(window, {WorkspaceArtifact});
})();
