/* 工具 › 文本生成（product-design §2.7 表二「文本生成」）：一次模型请求，无 Harness、Agent 会话或工具调用循环。
   输入是一段要求，可以附一份 Space 里的文档或字幕当材料（BC_TOOL_SPACE_INPUT，attach）；结果是保存位置里的一份文档、
   Space 里的一个文档条目。页面按统一骨架排（tool-frame.jsx）：输入 → 模型 → 保存位置 → 开始；
   记录卡的结果用产物行（在 Space 中查看、在文件夹中显示、交给 Agent、接着用工具）。
   任务记录带 `outputs` 与 `saveDir`（字段形状见 model-tool-runs.js 头注释）。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const L = window.BC_LLM_TOOLS;
  const SI = window.BC_TOOL_SPACE_INPUT;
  const MAX = 16000;
  const jobs = {list: [], listeners: new Set(), timers: new Map(), drafts: {}, seq: 0};
  const emit = () => jobs.listeners.forEach(fn => fn([...jobs.list]));
  const patch = (id, change) => { jobs.list = jobs.list.map(r => r.id === id ? {...r, ...change} : r); emit(); };
  /** 发给模型的正文：要求在前，附上的材料在后，标明出处 */
  const promptOf = (form, material) => (material ? `${form.input.trim()}\n\n[材料：${material.name}]\n${SI.textOf(material)}` : form.input);

  function start(app, form, model, material, saveDir) {
    const req = {...form, input: promptOf(form, material)};
    L.request('text', req, model); // The eventual model adapter receives only this fixed request.
    const id = 'llm-' + (++jobs.seq);
    const title = '文本生成';
    const params = {input: form.input, model: form.model || model.id, entry: material ? {id: material.id, name: material.name, kind: material.kind} : null};
    const taskId = app.addTask({kind: 'write', tool: 'text', toolId: 'text', params, title, project: null, sub: model.name + (material ? ` · 附 ${material.name}` : ''),
      phase: '等待模型返回', cancellable: false, ...window.BC_TOOL_RUNS.outputsPatch([], saveDir)});
    const record = {id, title, model: model.id, modelName: model.name, taskId, status: 'running', material: material ? material.name : null, saveDir};
    jobs.list = [record, ...jobs.list]; emit();
    // The browser prototype has no model transport; explicitly marked example output.
    jobs.timers.set(id, setTimeout(() => {
      jobs.timers.delete(id);
      try {
        const result = L.demo('text', req);
        const name = window.BC_TOOL_FRAME.savedName(app, material ? `${material.name.replace(/\.[^.]+$/, '')}-改写` : '文本生成', '.md');
        const output = app.registerToolOutput('doc', {...result, id, name, file: `${saveDir}/${name}`, model: model.id, toolId: 'text', task: taskId, params,
          lines: result.lines || result.text.split('\n').length, note: '交互原型示例 · 未调用模型 API', demo: true});
        patch(id, {status: 'done', output});
        app.patchTask(taskId, {status: 'done', outcome: 'done', phase: null, pct: 100, ...window.BC_TOOL_RUNS.outputsPatch([output], saveDir)});
        app.toast(`${name} 已保存到 ${window.BC_SAVE_DIR.label(saveDir)}`, 'positive');
      } catch (e) {
        patch(id, {status: 'error', error: e.message});
        app.patchTask(taskId, {status: 'error', outcome: 'error', phase: null, error: e.message});
      }
    }, 900));
  }
  function cancel(app, record) {
    clearTimeout(jobs.timers.get(record.id)); jobs.timers.delete(record.id);
    patch(record.id, {status: 'canceled'});
    app.patchTask(record.taskId, {status: 'canceled', phase: null});
  }

  function LlmToolPage() {
    const app = useApp();
    const save = window.BC_TOOL_FRAME.useSaveDir();
    const TM = window.BC_TEXT_MODEL;
    const [form, setForm] = useState(() => jobs.drafts.text || {input: '', model: null, material: null, picking: false});
    const [records, setRecords] = useState(jobs.list);
    const [error, setError] = useState('');
    const set = p => { setForm(s => ({...s, ...p})); setError(''); };
    useEffect(() => { jobs.drafts.text = form; }, [form]);
    useEffect(() => { jobs.listeners.add(setRecords); return () => jobs.listeners.delete(setRecords); }, []);
    /* 「接着用工具」/ Space 查看器带来的文档或字幕：附成材料 */
    window.BC_TOOL_FRAME.useToolPreset('text', (p) => {
      if (p.params) set({input: p.params.input || '', model: p.params.model || null, material: p.entry, picking: false});
      else if (p.input) set({material: p.entry, picking: false});
    });
    const material = form.material;
    const total = promptOf(form, material).length;
    const tm = TM.useTextModel(app, form, total);
    const busy = records.some(r => r.status === 'running');
    const reason = busy ? '上一次还在等模型返回' : !form.input.trim() ? '先写下生成要求'
      : total > MAX ? `要求和材料一共 ${total.toLocaleString()} 字符，超过一次 ${MAX.toLocaleString()} 字符的上限` : TM.textModelReason(tm);
    const run = () => { if (reason) return; try { start(app, {...form}, tm.model, material, save.dir); setError(''); } catch (e) { setError(e.message); } };
    const sample = () => set({input: '写一段 30 秒的城市漫游视频旁白，语气自然，突出街道、咖啡馆和黄昏。'});
    return <window.Page wide title="文本生成" bar={<window.ToolStartBar reason={reason}>
      <Btn variant="accent" disabled={!!reason} onClick={run}>{busy ? '处理中…' : '生成文本'}</Btn></window.ToolStartBar>}>
      <div className="ttsw">
        <div className="ttsw__main tool-llm__form">
          <p className="t-detail">写下要求，直接调用文本模型；可以附一份 Space 里的文档或字幕当材料。结果是一份文档，保存在下面的位置，也是 Space 里的一个条目。</p>
          <div className="ttsw__sec">
            <div className="ttsw__sechd"><b className="grow">生成要求</b><Btn size="s" variant="quiet" onClick={sample}>填入示例</Btn></div>
            <R.TextArea aria-label="生成要求" value={form.input} onChange={value => set({input: value})} placeholder="描述要生成的内容，或说明要怎样改写、摘要附上的材料" UNSAFE_className="tool-llm__input" />
            <span className="t-detail-xs">{total.toLocaleString()} / {MAX.toLocaleString()} 字符{material ? '（含材料）' : ''}</span>
          </div>
          <div className="ttsw__sec">
            <div className="ttsw__sechd"><b className="grow">材料</b>
              {!material && <Btn size="s" variant="quiet" icon="plus" onClick={() => set({picking: !form.picking})}>{form.picking ? '收起' : '从 Space 附上…'}</Btn>}</div>
            {material ? <window.ToolSpaceChosen entry={material} onClear={() => set({material: null})} note="随要求一起发给模型" />
              : form.picking ? <window.ToolSpacePicker tool="text" attach value={null} onChange={(e) => set({material: e, picking: false})} label="附上一份文档或字幕" />
              : <span className="t-detail-xs">可选。附上的文档或字幕全文随要求发给模型，不改动原条目。</span>}
          </div>
          <TM.TextModelField tm={tm} onChange={model => set({model})} what={material ? '要求和材料' : '要求'} />
          <window.ToolSaveDirRow save={save} />
          {error && <p role="alert" className="ttsw__err">{error}</p>}
          <p className="t-detail-xs">交互原型：演示一次模型请求及结果保存，尚未调用模型 API。</p>
        </div>
        <aside className="ttsw__side"><div className="ttsw__sidehd"><b className="grow">生成记录</b></div>
          {records.map(r => <article className="ttsrec" key={r.id}>
            <b>{r.output?.name || r.title}</b><span className="t-detail-xs">{r.modelName}{r.material ? ` · 附 ${r.material}` : ''}</span>
            {r.status === 'running' ? <div className="row gap8"><R.ProgressCircle aria-label="等待模型返回" isIndeterminate size="S" /><span className="grow">等待模型返回…</span><Btn size="s" variant="quiet" onClick={() => cancel(app, r)}>取消</Btn></div>
              : r.status === 'done' ? <><pre className="tool-llm__result">{r.output.text}</pre>
                <div className="row gap8"><Btn size="s" variant="quiet" icon="copy" onClick={() => { copyToClipboard(r.output.text); app.toast('已复制'); }}>复制</Btn></div>
                <window.ToolOutputRow entry={r.output} fromTool="text" compact /></>
              : <p className="t-detail">{r.status === 'canceled' ? '已取消 · 未保存结果' : r.error}</p>}
          </article>)}
          {!records.length && <Empty icon="text" title="还没有生成结果">完成后保存到保存位置，并作为文档出现在 Space 里。</Empty>}
        </aside>
      </div>
    </window.Page>;
  }
  Object.assign(window, {LlmToolPage});
})();
