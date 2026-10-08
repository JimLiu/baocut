/* 任务详情里工具运行的产物与操作（product-design §2.7「进度与失败」：任务详情里有同样的产物列表与结果操作，离开工具页也能回来处理）。
   只在 App 入口加载。读任务记录的 `outputs`（Space 条目 id）与 `saveDir`；没有这两样时整块不出。
   算法在 model-task-outputs.js（BC_TASK_OUTPUTS）；固定流程的步骤与「从那一步重试」由工具页的 ToolTaskPanel 画。 */
(function () {
  const TO = window.BC_TASK_OUTPUTS;
  const SURF = window.BC_SURFACE;

  /* 直接任务（生成语音 / 生成图片 / 文本生成）记了步骤时的简表：名字 + 状态词 */
  const STEP_WORD = {done: '完成', running: '进行中', error: '失败', queued: '等待', skipped: '跳过'};
  function DirectSteps({t}) {
    if (t.runId || !Array.isArray(t.steps) || !t.steps.length) return null;
    return (
      <Card layer className="tsrc">
        {t.steps.map((s, i) => (
          <div className="tsrc__row" key={s.id || i}>
            <span className="t-mono t-detail-xs">{i + 1}</span>
            <span className="t-ui grow">{s.label || s.name}</span>
            <Chip tone={s.status === 'error' ? 'negative' : s.status === 'done' ? 'positive' : s.status === 'running' ? 'info' : 'neutral'}>
              {STEP_WORD[s.status] || '等待'}
            </Chip>
          </div>
        ))}
      </Card>
    );
  }

  function OutputRow({row}) {
    const app = useApp();
    const R = window.RSP;
    const SP = window.BC_SPACE;
    const it = row.entry;
    if (!it) {
      return (
        <div className="tsrc__row">
          <Ic n="alert" className="ic--16 tsrc__ic" />
          <div className="tsrc__b"><div className="t-detail">这个结果已经不在 Space 里了。</div></div>
        </div>
      );
    }
    const k = SP.KINDS[it.kind] || SP.KINDS.doc;
    const Icon = R.Icons[k.icon];
    const can = TO.entryActions(it);
    const meta = [k.label, SP.durationText(it), SP.specText(it), it.trashed ? '在回收站里' : SP.statusText(it)].filter(Boolean).join(' · ');
    return (
      <div className="tsrc__row">
        <span className="tsrc__ic"><Icon /></span>
        <div className="tsrc__b">
          <div className="t-ui t-truncate">{it.name}</div>
          <div className="t-detail-xs">{meta}</div>
          {it.file ? <div className="tsrc__path t-mono">{it.file}</div> : null}
        </div>
        {can.view ? <Btn variant="quiet" size="s" onClick={() => app.openSpaceEntry(it.id)}>在 Space 中查看</Btn> : null}
        {can.reveal ? <Btn variant="quiet" size="s" icon="folder" onClick={() => app.toast(`已在文件夹中显示 ${it.file || it.name}（演示）`)}>在文件夹中显示</Btn> : null}
        {/* 交给 Agent（§2.7「结果与下一步」、§4.7）：引用 + 预填一句草稿，由用户发送 */}
        {SURF.agent && can.handover ? <Btn variant="secondary" size="s" icon="agent" onClick={() => app.handoverToAgent(it)}>交给 Agent</Btn> : null}
      </div>
    );
  }

  function TaskOutputs({t}) {
    const app = useApp();
    const SAVE = window.BC_SAVE_DIR;
    const again = SURF.pages ? TO.retry(t) : null;
    const rows = TO.resolve(t, app.spaceItems);
    if (!TO.hasBlock(t) && !again && !(Array.isArray(t.steps) && !t.runId)) return null;
    return (
      <>
        <DirectSteps t={t} />
        {/* 失败的直接任务：任务页原来的配置错误卡片让给这里的「重试」，失败原因在这里照样写出来 */}
        {again && t.status === 'error' && t.error ? (
          <div className="row gap8" style={{marginTop: 16}}>
            <Ic n="alert" className="ic--16" style={{color: 'var(--red-900)'}} />
            <span className="t-ui t-negative grow">{t.error}</span>
          </div>
        ) : null}
        {again ? (
          <div className="row gap8" style={{marginTop: 12}}>
            <Btn variant={t.status === 'error' ? 'accent' : 'secondary'} size="s" icon="redo"
              onClick={() => app.openToolWith(again.toolId, again.preset)}>{again.label}</Btn>
            <span className="t-detail">回到工具页，参数已经填好；改不改都由你。</span>
          </div>
        ) : null}
        {TO.hasBlock(t) ? (
          <>
            <div className="row" style={{marginTop: 28}}>
              <span className="t-section grow">结果</span>
              {t.saveDir ? <span className="t-detail-xs" title={t.saveDir}>保存到 {SAVE.label(t.saveDir)}</span> : null}
            </div>
            <Card layer className="tsrc">
              {rows.length ? rows.map((row) => <OutputRow key={row.id} row={row} />)
                : <div className="tsrc__row"><span className="t-detail">还没有结果；完成后会列在这里。</span></div>}
            </Card>
          </>
        ) : null}
      </>
    );
  }

  Object.assign(window, {TaskOutputs});
})();
