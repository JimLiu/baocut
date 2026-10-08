/* 工具 › 生成图片（§2.5，2026-09-25；product-design §2.7 表二「生成图片」）：不开项目也能画一张图。
   左栏是共用表单（image-gen.jsx）加保存位置一行（tool-frame.jsx），右栏是生成记录；记录不属于任何项目（scope null），
   生成的 PNG 保存在保存位置、是 Space 里的图片条目；「加到视频…」把它加进 Space 里的某部视频。输入只收文字，不收 Space 参考图。 */
(function () {
  const {useState, useEffect} = React;
  const IM = window.BC_CLOUD_IMAGE;
  const J = window.BC_IMAGE_JOBS;

  function KeepDialog({open, img, r, onClose}) {
    const app = useApp();
    const [pid, setPid] = useState(null);
    const [pop, setPop] = useState(false);
    const list = app.projects || [];
    const cur = list.find((p) => p.id === pid) || list[0];
    const add = () => {
      window.BC_TOOL_RUNNER.importToMovie(app, {movie: cur.id}, {name: img.name, src: {name: img.name, path: r.saveDir ? `${r.saveDir}/${img.name}` : img.name, format: 'PNG', res: '', state: 'ok'}});
      app.toast(`已把 ${img.name} 加进「${cur.title}」`, 'positive');
      onClose(true);
    };
    return (
      <Dialog open={open} title="加到视频" onClose={onClose}
        footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" disabled={!cur} onClick={add}>加到视频</Btn></>}>
        <div className="col gap12">
          <span className="t-body">图片留在保存位置，视频里链接它；出处随文件一起记（模型、提示词、种子）。</span>
          <div className="row gap8">
            <span className="ttsw__lab">视频</span>
            <Picker size="s" value={cur ? cur.title : '还没有视频'} open={pop} popWidth={280} onClick={() => setPop((x) => !x)} onClose={() => setPop(false)}>
              <Menu>{list.map((p) => <MenuItem key={p.id} label={p.title} on={cur && p.id === cur.id} onClick={() => { setPid(p.id); setPop(false); }} />)}</Menu>
            </Picker>
          </div>
          <span className="t-detail-xs">{IM.recordMeta(r)}</span>
        </div>
      </Dialog>
    );
  }

  function ImageToolPage() {
    const app = useApp();
    const engines = useImageEngines(app).filter(e => e.family !== 'agent');
    const [f, setF] = useState(() => (J.drafts.tool && IM.engineOf(engines, J.drafts.tool.model) ? J.drafts.tool : null) || Object.assign(IM.blank(IM.preferred(engines, app.cloudImageDefault || (app.prefs.localModelDefaults || {}).image)), {fit: false}));
    const set = (p) => setF((s) => Object.assign({}, s, p));
    const save = window.BC_TOOL_FRAME.useSaveDir();
    /* 任务详情「再做一次」带回这次的表单（params）：填回这一页，引擎已不在时保留当前选择 */
    window.BC_TOOL_FRAME.useToolPreset('image', (p) => {
      if (p.params) setF((cur) => Object.assign({}, p.params, IM.engineOf(engines, p.params.model) ? {} : {model: cur.model}));
    });
    useEffect(() => { J.drafts.tool = f; }, [f]);
    const list = useImageRecords(null);
    const [tried, setTried] = useState(false);
    const [keep, setKeep] = useState(null);      // {r, img}
    const [kept, setKept] = useState({});
    const e = IM.engineOf(engines, f.model);
    const status = J.statusOf(f, engines, tried);
    const busy = list.filter((r) => r.status === 'running' || r.status === 'queued').length;

    const generate = () => {
      setTried(true);
      if (status.bad) { app.toast(status.text); return; }
      J.enqueue(app, f, engines, null, save.dir);
    };
    const again = (r) => { setF(Object.assign(IM.blank(), r.form, {model: IM.engineOf(engines, r.form.model) ? r.form.model : IM.preferred(engines), seed: ''})); app.toast('已带回这一版的提示词与设置 · 种子留空重新随机'); window.scrollTo({top: 0, behavior: 'smooth'}); };
    /* 生成好的图在 Space 里的条目（BC_HOME_TOOLS.output 的 id），挂产物行 */
    const extra = (r, img) => {
      const it = (app.spaceItems || []).find((x) => x.id === `tool-image-${img.id}`);
      return it ? <window.ToolOutputRow entry={it} fromTool="image" compact /> : null;
    };

    const bar = (
      <>
        <span className={cx('t-detail pagenav__note', status.bad && 'ttsw__err')} title={status.text}>{status.text}</span>
        <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
        <Btn variant="accent" icon="image" disabled={!e || !e.ready} onClick={generate}>生成图片</Btn>
      </>
    );
    const node = J.imageNode(f, e);
    const chip = node ? {icon: 'remote-compute', tone: undefined, text: `在 ${node.name} 上出图 · 局域网`} : IM.headerChip(f, engines);

    return (
      <window.Page wide title="生成图片" bar={bar} actions={<Chip icon={chip.icon} tone={chip.tone}>{chip.text}</Chip>}>
        <div className="ttsw" onKeyDown={(ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); generate(); } }}>
          <div className="ttsw__main">
            <ImageGenForm f={f} set={set} engines={engines} />
            <window.ToolSaveDirRow save={save} note="每张图是保存位置里的一个 PNG、Space 里的一个图片条目，旁边一份 JSON 记模型、提示词与种子；重名时加序号。" />
          </div>
          <aside className="ttsw__side">
            <div className="ttsw__sidehd">
              <span className="t-title-sm grow">生成记录</span>
              <Btn size="s" variant="quiet" onClick={() => app.go({r: 'projects', sec: 'image'})}>在 Space 中查看</Btn>
              {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{list.filter((r) => r.status !== 'canceled').length} 条</span>}
              {<BCAction className="viewall" title="演示：让下一条失败" onClick={() => { J.setFailNext('服务商拒绝了这条提示词（安全策略）'); app.toast('演示：下一条会失败'); }}>演示失败</BCAction>}
            </div>
            {list.filter((r) => r.status !== 'canceled').length
              ? <ImageResults list={list} keep={kept} batches={20} onKeep={(r, img) => setKeep({r, img})} onAgain={again} extra={extra} />
              : <Empty icon="image" title="还没有生成过">写好画面、选好模型，按「生成图片」。</Empty>}
            <div className="t-detail-xs ttsw__sidefoot">
              生成的 PNG 保存在保存位置，也显示在 Space 的「图片」中；「加到视频…」把它加进一部视频。云端生成的图服务商可能留副本；本机模型在这台电脑上运行。交互演示里的图是示例色块。
            </div>
          </aside>
        </div>
        {keep ? <KeepDialog open img={keep.img} r={keep.r} onClose={(ok) => { if (ok) setKept((k) => Object.assign({}, k, {[keep.img.id]: true})); setKeep(null); }} /> : null}
      </window.Page>
    );
  }

  Object.assign(window, {ImageToolPage});
})();
