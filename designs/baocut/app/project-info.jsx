/* BaoCut 原型 — 项目详情框（§8.1 / §17.3，第 233 轮）
   两个入口共用这一个框：编辑器顶栏点标题旁的 ⓘ，视频卡 ⋯ 菜单选「视频详情…」。
   行的装配全在 [model-project-info.js](model-project-info.js)，这一层只负责铺。

   上半只读、下半可编辑，是因为这两半的真相来源不同：只读那些是媒体与转录**已经
   发生**的事实（路径、时长、分辨率、模型、说话人数），改不了；可编辑那四项是用户
   自己写在项目上的字，随手改随手存。中间不放分隔线也不放分区标题——两半的排版差别
   （label/值 vs 输入框）已经说清了它们不是一类东西。

   「复制全部」复制的是**屏幕上这些行**，一字不多一字不少（`copyText`）：用户要把
   一段视频的来龙去脉贴进工单、贴给同事、贴回 Agent 会话，逐行手抄是最没道理的事。
   唯一的例外是 hero 那行的文件名——屏幕上它可能中间省略，复制走完整值。

   红线（App v2 明确不做，这里也不画）：在文件夹中显示 / 重新关联媒体…。
   前者是文件管理器的活，后者是项目卡 ⋯ 菜单里那条已有入口，详情框不做第二个门。 */
(function () {
  const {useMemo} = React;
  const T = window.BC_TIME;
  const PI = window.BC_PINFO;

  function Row({r}) {
    return (
      <div className="pinfo__row">
        <span className="pinfo__k">{r.label}</span>
        <span className={cx('pinfo__v', r.mono && 't-mono')}>{r.value}</span>
      </div>
    );
  }

  function Section({s}) {
    return (
      <div className="pinfo__sec">
        <div className="pinfo__st">{s.title}</div>
        {s.rows.map((r, i) => <Row key={s.title + i} r={r} />)}
      </div>
    );
  }

  function EditRow({label, value, area, onChange}) {
    return (
      <label className="pinfo__fld">
        <span className="pinfo__fl">{label}</span>
        <Field size="s" area={area} value={value || ''} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }

  function ProjectInfoDialog() {
    const app = useApp();
    const info = app.pinfo;
    const p = info ? app.projById(info.id) : null;
    const extras = (info && info.extras) || [];
    const secs = useMemo(() => (p ? PI.sections(p, T.duration(p.duration), extras) : []),
      [p, extras]);
    if (!p) return null;
    const heroName = PI.elideMiddle((p.src && p.src.name) || '', PI.HERO_NAME_MAX);
    const copy = () => {
      const list = secs.concat(PI.detailsSection(p.url, p.desc, p.notes) || []);
      const text = PI.copyText(p.title, PI.heroLine(p), list);
      if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
      app.toast('已复制视频详情', 'positive');
    };
    return (
      <Dialog open title="视频详情" width={500} onClose={app.closeProjectInfo}
        footer={[
          <span key="s" className="grow" />,
          <Btn key="c" variant="secondary" onClick={copy}>复制全部</Btn>,
          <Btn key="k" variant="accent" onClick={app.closeProjectInfo}>完成</Btn>,
        ]}>
        <div className="pinfo__hero">
          {window.Thumb ? <window.Thumb p={p} className="pinfo__th" /> : null}
          <div className="grow">
            <div className="pinfo__name t-clamp2">{p.title}</div>
            <div className="t-detail t-truncate" style={{marginTop: 2}}>
              {PI.srcTypeLabel(p)}{heroName ? ' · ' + heroName : ''}
            </div>
          </div>
        </div>
        {secs.map((s) => <Section key={s.title} s={s} />)}
        <div className="pinfo__form">
          <EditRow label="标题" value={p.title} onChange={(v) => app.patchProject(p.id, {title: v})} />
          <EditRow label="网址" value={p.url} onChange={(v) => app.patchProject(p.id, {url: v})} />
          <EditRow label="简介" area value={p.desc} onChange={(v) => app.patchProject(p.id, {desc: v})} />
          <EditRow label="备注" area value={p.notes} onChange={(v) => app.patchProject(p.id, {notes: v})} />
        </div>
      </Dialog>
    );
  }

  Object.assign(window, {ProjectInfoDialog});
})();
