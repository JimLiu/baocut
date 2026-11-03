/* 工具 › 素材处理（product-design §2.7「素材处理」）：视频去抖、视频超分、视频插帧、统一色调、去除背景与音频分轨共用一页，
   六个工具各是侧栏里的一行，页内不切换（同视频文件、图片处理）。左栏是输入 → 这一段 → 选项 → 第一次用的下载 → 这一次要多久 → 保存位置，
   右栏是任务队列。都是文件到文件：结果是保存位置里的新文件、Space 里的条目，不动原文件、不建视频。
   输入跟着走：换一个工具时，它收的那几个文件还在。规则在 model-footage.js，表单块在 tool-footage-form.jsx，队列在 tool-footage-queue.jsx 与 tool-footage-jobs.jsx。
   演示挡位（页底）：受管工具装没装、下载校验过不过、ffmpeg 带不带 vid.stab、下一条的结果、示例素材。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const F = window.BC_FOOTAGE;
  const Q = window.BC_FOOTAGE_QUEUE;
  const V = window.BC_VIDEO;
  const D = window.BC_DATA;

  /* 演示用的第二只分离模型：audio.cpp 的 Mel-Band RoFormer 只能分两轨（SEP_OPEN，model-audiocpp.js） */
  const MEL_BAND = {id: 'audiocpp:mel_band_roformer', label: 'Mel-Band RoFormer', local: true, ok: true};
  const separationModels = (app, s) => F.sepModels(D.setModels, app.modelInstalled, s.melBand ? [MEL_BAND] : []);

  function DemoSwitch({id, srcs, setSrcs}) {
    const s = Q.useStore();
    const states = Q.toolStates();
    const op = F.opById(id).op;
    const flip = (k, v) => { Q.store[k] = v; Q.emit(); };
    return <BCDisclosure className="import-demo" title={<> 原型演示场景 </>}>
      <div className="vdemo">
        {op === 'stabilize' ? <label>
          这台电脑的 ffmpeg
          <BCSelect aria-label="ffmpeg 演示状态" value={s.vidstab ? 'vidstab' : 'deshake'} onChange={(e) => flip('vidstab', e.target.value === 'vidstab')}>
            <option value="vidstab">带 vid.stab</option>
            <option value="deshake">没有 vid.stab（退回 deshake）</option>
          </BCSelect>
        </label> : null}
        {F.toolsFor(F.blank(id)).concat(op === 'remove-background' ? [F.MATTE_ISNET] : []).map((name) => <label key={name}>
          {F.MANAGED[name].name}
          <BCSelect aria-label={`${F.MANAGED[name].name} 演示状态`} value={states[name] === 'ready' ? 'ready' : 'missing'} onChange={(e) => Q.setTool(name, e.target.value)}>
            <option value="missing">还没下载</option>
            <option value="ready">已就绪 · {F.MANAGED[name].version}</option>
          </BCSelect>
        </label>)}
        {F.toolsFor(F.blank(id)).length ? <label>
          下载外部工具
          <BCSelect aria-label="下载演示挡位" value={s.installFail ? 'fail' : 'ok'} onChange={(e) => flip('installFail', e.target.value === 'fail')}>
            <option value="ok">校验通过</option>
            <option value="fail">校验不过</option>
          </BCSelect>
        </label> : null}
        {op === 'separate' ? <label>
          多装一只分离模型
          <BCSelect aria-label="分离模型演示状态" value={s.melBand ? 'mel' : 'none'} onChange={(e) => flip('melBand', e.target.value === 'mel')}>
            <option value="none">不多装</option>
            <option value="mel">Mel-Band RoFormer（只能分两轨）</option>
          </BCSelect>
        </label> : null}
        <label>
          下一条的结果
          <BCSelect aria-label="运行结果演示挡位" value={s.outcome} onChange={(e) => flip('outcome', e.target.value)}>
            <option value="ok">成功</option>
            <option value="fail">失败</option>
            {op === 'remove-background' ? <option value="nosubject">没认出主体</option> : null}
          </BCSelect>
        </label>
      </div>
      <div className="vw__chips fg__samples">
        <span className="t-detail-xs">加一个示例素材：</span>
        {F.samplesFor(id).map((x) => <Chip key={x.k} pill onClick={() => setSrcs(srcs.concat([x.src]))}>{x.label}</Chip>)}
      </div>
    </BCDisclosure>;
  }

  function FootagePage({id}) {
    const app = useApp();
    const s = Q.useStore();
    const video = window.useVideoStore();
    const o = F.opById(id);
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const [f, setF] = useState(() => s.drafts.forms[id] || F.blank(id));
    const [all, setAll] = useState(s.drafts.srcs);
    const [tried, setTried] = useState(false);
    const goRef = useRef(null);
    const set = (p) => setF((cur) => { const next = Object.assign({}, cur, p); s.drafts.forms[id] = next; return next; });
    const mine = all.filter((x) => o.accepts.indexOf(x.kind) >= 0);
    const setSrcs = (list) => { const next = all.filter((x) => o.accepts.indexOf(x.kind) < 0).concat(list); s.drafts.srcs = next; setAll(next); };
    const models = separationModels(app, s);
    // 分离模型缺省取第一只装好的
    useEffect(() => {
      if (o.op !== 'separate') return;
      const cur = models.find((m) => m.id === f.sepModel);
      if (!cur || !cur.ok) { const m = models.find((x) => x.ok) || models[0]; if (m && m.id !== f.sepModel) set({sepModel: m.id}); }
    }, [models.length, models.filter((m) => m.ok).length]);
    /* 预设：任务记录的「再做一次」带表单与输入；Space 的「用工具处理…」带条目 */
    window.BC_TOOL_FRAME.useToolPreset(id, (p) => {
      if (p.params && p.params.form) { const form = Object.assign(F.blank(id), p.params.form); s.drafts.forms[id] = form; setF(form); }
      if (p.params && p.params.srcs) setSrcs(p.params.srcs);
      else if (p.entry) setSrcs([F.fromEntry(p.entry)]);
      if (p.retryOf) app.toast(`上次没做完：${p.retryOf.error || '失败'}。设置已带回来，改一下再试。`);
    });
    const st = V.ffmpegState(video.env);
    const gate = window.BC_VIDEO_QUEUE.ffmpegGate(st);
    const ctx = {tools: Q.toolStates(), sep: models, vidstab: s.vidstab, sepLabel: (models.find((m) => m.id === f.sepModel) || {}).label};
    const errs = F.problems(f, mine, ctx);
    const status = gate ? {bad: true, text: gate} : F.statusLine(f, mine, ctx, tried);
    const go = () => {
      setTried(true);
      if (gate) { app.toast(gate); return; }
      if (errs.length) { app.toast(errs[0]); return; }
      Q.enqueue(app, f, mine, save.dir, ctx);
      setTried(false);
    };
    goRef.current = go;
    window.BC_VIDEO_QUEUE.useCmdEnter(goRef);
    const bar = <>
      <span className={cx('t-detail pagenav__note', status.bad && 'vw__err')} title={status.text}>{status.text}</span>
      <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
      <Btn variant="accent" icon={o.ic} onClick={go}>{o.verb}</Btn>
    </>;
    return (
      <window.Page wide title={o.name} bar={bar} actions={<Chip icon="lock">在这台电脑上处理 · 不上传</Chip>}>
        <div className="vw">
          <div className="vw__main">
            <span className="t-detail ie__lede">{o.desc}。</span>
            {st.stage === 'ready' ? null : <window.VideoFfmpegCard st={Object.assign({}, st, {title: st.title.replace(/^这两个工具/, '这个工具')})} s={video} />}
            <window.FootageSources id={id} f={f} srcs={mine} setSrcs={setSrcs} />
            {o.op !== 'separate' ? <window.FootageRange f={f} set={set} srcs={mine} /> : null}
            <window.FootageOptions id={id} f={f} set={set} srcs={mine} models={models} />
            <window.FootageToolCard f={f} set={set} />
            <window.FootageLoad id={id} f={f} set={set} srcs={mine} />
            <window.ToolSaveDirRow save={save} note={F.saveNote(f)} />
            <DemoSwitch id={id} srcs={mine} setSrcs={setSrcs} />
          </div>
          <window.FootageJobList />
        </div>
      </window.Page>
    );
  }

  /** 工具目录卡片上的现状行 */
  const galleryStatus = (app, toolId) => F.toolStatus(toolId, {tools: Q.toolStates(), vidstab: Q.store.vidstab, sep: separationModels(app, Q.store)});

  Object.assign(window, {FootagePage, BC_FOOTAGE_PAGE: {galleryStatus}});
})();
