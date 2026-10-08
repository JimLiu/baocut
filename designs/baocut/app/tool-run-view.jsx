/* 按步骤跑的工具共用的几块界面（product-design §2.7）：步骤进度、当场授权卡、来源切换、项目选择、
   运行与结果页、本工具的运行记录，以及原型演示挡位。转录 / 翻译字幕 / 翻译配音 / 下载视频四页都用这一份。
   结果页每个产物一行（tool-frame.jsx 的 ToolOutputs）：在 Space 中查看、在文件夹中显示、交给 Agent、接着用工具；
   写进视频的结果是那部视频一行，带「打开编辑」。 */
(function () {
  const {useState, useRef} = React;
  const R = window.RSP;
  const T = window.BC_TOOLS;
  const RUNS = window.BC_TOOL_RUNS;
  const M = window.BC_MEDIA;
  const SAMPLE_MEDIA = 'kelang-ep42-master.mp4';

  /** 步骤表：做完的打勾、在跑的显示百分比、停住的标红，没到的只写序号 */
  function ToolSteps({steps}) {
    return <ol className="tsteps" aria-label="处理步骤">
      {steps.map((s, i) => <li key={s.id} className={cx('tsteps__row', `is-${s.status}`)}>
        <span className="tsteps__mark" aria-hidden="true">
          {s.status === 'done' ? <Ic n="check" className="ic--14" /> : s.status === 'failed' ? <Ic n="alert" className="ic--14" /> : i + 1}
        </span>
        <span className="tsteps__label">{s.label}</span>
        <span className="tsteps__st">{s.status === 'done' ? '完成' : s.status === 'failed' ? '停在这一步' : s.status === 'running' ? `${Math.round(s.pct)}%` : '等待'}</span>
      </li>)}
    </ol>;
  }

  /** 当场授权：要发什么、发给谁、预计多少钱；「同意并继续」= 记下同意并开始（§2.7「授权在当场完成」）。
   *  `hint`：不想发送时的去处（语音模型能换本机的，文本模型只有在线服务） */
  function GrantCard({needs, onAgree, disabled, hint}) {
    if (!needs || !needs.length) return null;
    return <div className="tgrant" role="group" aria-label="发送到在线服务前确认">
      <R.InlineAlert variant="notice">
        <R.Heading>这次要把数据发到在线服务</R.Heading>
        <R.Content>
          <ul className="tgrant__list">
            {needs.map((n) => <li key={n.key}>
              <b>发给 {n.recipient}</b>
              <span>内容：{n.what}</span>
              <span>预计费用：{n.cost}</span>
            </li>)}
          </ul>
          <span className="t-detail-xs">同意一次，同一家服务、同一种数据以后不再问。原型只记在内存里，刷新页面就忘了。</span>
        </R.Content>
      </R.InlineAlert>
      <div className="row gap8"><Btn variant="accent" disabled={disabled} onClick={onAgree}>同意并继续</Btn>
        <span className="t-detail-xs">{hint || '不想发送就换一个本机模型，本机模型不发送任何数据。'}</span></div>
    </div>;
  }

  /** 输入来源切换：选项来自工具目录声明的 inputs（model-tools.js），附加材料不算；只有一种来源时不出这一行 */
  function ToolSourceSwitch({tool, value, onChange}) {
    const opts = T.sourceOptions(tool);
    if (opts.length < 2) return null;
    return <R.SegmentedControl aria-label="从哪里开始" selectedKey={value} onSelectionChange={onChange}>
      {opts.map((o) => <R.SegmentedControlItem key={o.k} id={o.k}>{o.label}</R.SegmentedControlItem>)}
    </R.SegmentedControl>;
  }

  /** 新建的视频放进哪个项目：默认上一次用的那个 */
  function ToolProjectPicker({value, onChange}) {
    const app = useApp();
    return <R.Picker label="放进哪个项目" selectedKey={value} onSelectionChange={onChange} UNSAFE_className="tool-llm__field">
      {app.dirs.map((d) => <R.PickerItem key={d.id} id={d.id}>{d.name}</R.PickerItem>)}
    </R.Picker>;
  }
  /** 项目选择的缺省：上次用的项目还在就用它，否则第一个 */
  const defaultDir = (app, last) => (last && app.dirs.some((d) => d.id === last) ? last : (app.dirs[0] || {}).id || null);

  /** 选一份媒体文件（文件输入 + 示例素材）；`onPick(name)`。`accept`：工具目录声明的扩展名（缺省收视频与音频） */
  function MediaPick({label, onPick}) {
    const app = useApp();
    const input = useRef(null);
    const take = (file) => {
      if (!file) return;
      if (M.kindOf(file.name) === 'other') { app.toast('请选择视频或音频文件'); return; }
      onPick(file.name);
    };
    return <div className="row gap8">
      <Btn icon="upload" onClick={() => input.current.click()}>{label || '选择文件'}</Btn>
      <Btn variant="quiet" onClick={() => onPick(SAMPLE_MEDIA)}>使用示例素材</Btn>
      <input ref={input} hidden type="file" accept="video/*,audio/*" onChange={(e) => { take(e.target.files[0]); e.target.value = ''; }} />
    </div>;
  }

  /** 写进视频的结果：那部视频在 Space 里的条目（还没投影出来时按记录拼一个） */
  function movieEntry(app, run) {
    if (!run.movie) return null;
    const hit = (app.spaceItems || []).find((x) => x.kind === 'movie' && x.id === run.movie);
    const m = window.BC_TOOL_RUNNER.movieNow(run.movie);
    return hit || {id: run.movie, kind: 'movie', movie: run.movie, name: m.title || '视频', dur: m.duration || 0, dir: m.dir || null};
  }

  /** 运行与结果页：进度、步骤、失败时从那一步重试；完成后每个产物一行与它的下一步 */
  function ToolRunView({run, onBack}) {
    const app = useApp();
    const Run = window.BC_TOOL_RUNNER;
    const m = run.model;
    const done = m.status === 'done';
    const failed = m.status === 'failed';
    const intoMovie = RUNS.opensMovie(run.spec.tool, run.spec.input, run.spec.opts);
    const entries = (intoMovie ? [movieEntry(app, run)] : []).concat(run.outputs || []);
    return <section className="trun" aria-label={run.spec.title}>
      <div className="trun__hd">
        <b className="grow">{run.spec.title}</b>
        <span className="t-detail">{done ? '已完成' : RUNS.phase(m)}{m.attempt > 1 ? ` · 第 ${m.attempt} 次尝试` : ''}</span>
      </div>
      {run.spec.sub && <span className="t-detail-xs">{run.spec.sub}</span>}
      <Progress value={RUNS.pct(m)} label={`${run.spec.title}进度`} />
      <ToolSteps steps={m.steps} />
      {!done && !failed && <span className="t-detail-xs">这次运行也在任务中心里，离开这一页照样跑完。</span>}
      {failed && <>
        <R.InlineAlert variant="negative">
          <R.Heading>{RUNS.phase(m)}</R.Heading>
          <R.Content>{m.error}。已完成的步骤{run.spec.create && run.movie ? '与已经建好的视频' : ''}会保留，重试从这一步开始。</R.Content>
        </R.InlineAlert>
        <div className="row gap8"><Btn variant="accent" icon="refresh" onClick={() => Run.retry(app, run.id)}>从这一步重试</Btn></div>
      </>}
      {done && run.result && <div className="trun__result">
        <ul className="trun__lines">{run.result.lines.map((l, i) => <li key={i}><Ic n="ok" className="ic--14" /><span>{l}</span></li>)}</ul>
        {run.result.actions && run.result.actions.length ? <div className="row gap8">
          {run.result.actions.map((a) => <Btn key={a.label} variant="secondary" size="s" onClick={() => a.run(app)}>{a.label}</Btn>)}
        </div> : null}
        <window.ToolOutputs entries={entries} fromTool={run.spec.tool} saveDir={intoMovie ? null : m.saveDir} />
      </div>}
      <div className="row gap8">
        <Btn variant="quiet" onClick={onBack}>{done || failed ? '再做一次' : '回到设置'}</Btn>
        <Btn variant="quiet" onClick={() => app.go({r: 'task', id: run.taskId})}>在任务中心查看</Btn>
      </div>
    </section>;
  }

  /** 侧栏：这个工具的运行记录，点一条看它的进度与结果 */
  function ToolRunList({tool, onOpen, current}) {
    const s = window.useToolRuns();
    const list = s.runs.filter((r) => r.spec.tool === tool);
    return <aside className="ttsw__side">
      <div className="ttsw__sidehd"><b className="grow">运行记录</b></div>
      {list.length ? list.map((r) => <BCAction key={r.id} type="button" className={cx('trec', r.id === current && 'is-on')} onClick={() => onOpen(r.id)}>
        <b>{r.spec.title}</b>
        <span className="t-detail-xs">{r.model.status === 'done' ? '已完成' : RUNS.phase(r.model)}</span>
        {r.model.status === 'running' && <Progress value={RUNS.pct(r.model)} thin label={`${r.spec.title}进度`} />}
      </BCAction>) : <Empty icon={{transcribe: 'mic', translate: 'translate', link: 'link'}[tool] || 'wave'} title="还没有运行过">开始之后进度与结果都在这里，也在任务中心里。</Empty>}
      <span className="t-detail-xs ttsw__sidefoot">结果保存到默认保存位置，并作为条目出现在 Space 里；写进视频的结果在那部视频里。</span>
    </aside>;
  }

  /** 原型演示挡位：这次运行在第几步失败（不属于产品 UI） */
  function ToolDemo() {
    const s = window.useToolRuns();
    return <BCDisclosure className="import-demo" title={<> 原型演示场景 </>}>
      <div className="vdemo"><label>
        这次运行的结果
        <BCSelect aria-label="运行结果演示挡位" value={s.demo} onChange={(e) => s.setDemo(e.target.value)}>
          {window.BC_TOOL_RUNNER.DEMOS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
        </BCSelect>
      </label></div>
    </BCDisclosure>;
  }

  /** 任务中心里一次工具运行的详情：步骤、失败时从那一步重试、回到工具看结果 */
  function ToolTaskPanel({t}) {
    const app = useApp();
    const s = window.useToolRuns();
    const run = t.runId ? s.runById(t.runId) : null;
    const failed = t.status === 'error';
    return <div className="ttask">
      {t.steps ? <ToolSteps steps={t.steps} /> : null}
      {failed && <R.InlineAlert variant="negative">
        <R.Heading>{run ? RUNS.phase(run.model) : '运行停住了'}</R.Heading>
        <R.Content>{t.error}。已完成的步骤会保留，重试从这一步开始。</R.Content>
      </R.InlineAlert>}
      <div className="row gap8">
        {failed && run && <Btn variant="accent" icon="refresh" onClick={() => window.BC_TOOL_RUNNER.retry(app, run.id)}>从这一步重试</Btn>}
        {run && <Btn variant="secondary" onClick={() => { s.setView(t.tool, run.id); app.go({r: 'tools', id: t.tool}); }}>{t.status === 'done' ? '查看结果' : '回到工具'}</Btn>}
      </div>
    </div>;
  }

  /** 工具页的骨架：左边表单或运行页，右边运行记录 */
  function ToolFrame({tool, title, bar, children}) {
    const s = window.useToolRuns();
    const run = s.view(tool) ? s.runById(s.view(tool)) : null;
    return <window.Page wide title={title} bar={run ? null : bar}>
      <div className="ttsw">
        <div className="ttsw__main">
          {run ? <ToolRunView run={run} onBack={() => s.setView(tool, null)} /> : children}
        </div>
        <ToolRunList tool={tool} current={run && run.id} onOpen={(id) => s.setView(tool, id)} />
      </div>
    </window.Page>;
  }

  Object.assign(window, {ToolSteps, GrantCard, ToolSourceSwitch, ToolProjectPicker, MediaPick, ToolRunView, ToolRunList, ToolDemo, ToolFrame, ToolTaskPanel,
    BC_TOOL_VIEW: {defaultDir, SAMPLE_MEDIA}});
})();
