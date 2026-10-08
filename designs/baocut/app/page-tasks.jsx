/* 后台任务 —— §17.3。进行中 / 已完成两节 + 页内任务详情。
   红线（App v2 明确不做）：筛选 / 搜索 / 分组 / AI flow 重试 / 任务暂停。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const F = window.BC_TASK_FACTS;

  /* 每个 AI flow 一档，图标与 AI 工具面板那份 TOOLS 同源——
     任务卡上的图标要能一眼对上是哪个工具跑的。 */
  const KIND = {
    crop: {icon: 'video', label: '智能裁剪'},
    'shorts-cut': {icon: 'clip', label: '剪成短视频'},
    'dub-background-mix-render': {icon: 'wave', label: '配音背景混音'},
    import: {icon: 'download', label: '导入视频'},
    transcribe: {icon: 'mic', label: '转录'}, export: {icon: 'export', label: '导出'},
    translate: {icon: 'translate', label: '翻译'},
    polish: {icon: 'sparkle', label: '润色文稿'}, chapters: {icon: 'list', label: '生成章节'},
    speakers: {icon: 'mic', label: '识别说话人'}, retranscribe: {icon: 'redo', label: '重新转录'},
    cleanup: {icon: 'split', label: '找可剪的口'}, stale: {icon: 'redo', label: '刷新过期译文'},
    tts: {icon: 'wave', label: '生成语音'}, dub: {icon: 'translate', label: '翻译配音'},
    compress: {icon: 'video', label: '压缩视频'}, merge: {icon: 'layers', label: '合并视频'},
    image: {icon: 'image', label: '生成图片'}, link: {icon: 'link', label: '从链接导入'},
  };

  /* 跑完的 AI run 在这里也能撤销 / 恢复。
     撤销位存在**任务记录**上（`t.undone`），编辑器那条收据读的是同一个字段——
     两处各存一份，就会出现「任务页撤销了、编辑器还写着已应用」。
     只有 `t.undoable` 的任务出这一组：转录是一次成片的事务，没有「撤销转录」；
     导出产出的是一个文件，删它不叫撤销。
     **「再跑一次」不放这里**——AI flow 重试是 §17.3 的红线（App v2 明确不做）。 */
  function UndoActions({t, size = 's'}) {
    const app = useApp();
    if (!t.undoable || t.status !== 'done') return null;
    return t.undone
      ? <Btn variant="secondary" size={size}
          onClick={() => { app.patchTask(t.id, {undone: false}); app.toast('已恢复', 'positive'); }}>恢复</Btn>
      : <Btn variant="secondary" size={size} className="btn--undo"
          onClick={() => app.confirm({
            title: `撤销「${(KIND[t.kind] || {label: '这次运行'}).label}」？`,
            body: (t.undoBody || '这一跑写进视频的改动会被移除。') + '随时可以按「恢复」放回去，不用重跑。',
            tone: 'negative', confirmLabel: '撤销',
            run: () => { app.patchTask(t.id, {undone: true}); app.toast('已撤销'); },
          })}>撤销</Btn>;
  }

  function TaskCard({t, onOpen}) {
    const app = useApp();
    const k = KIND[t.kind] || KIND.transcribe;
    /* 取消过的任务（第 120 轮，`t.canceled`）留在「已完成」一节但念「已取消」，
       不叫失败——失败是链路坏了，取消是用户自己停的。 */
    const tone = t.canceled ? 'neutral' : t.status === 'error' ? 'negative' : t.status === 'done' ? 'positive'
               : t.status === 'queued' ? 'info' : 'accent';
    /* 「等人」只在任务还活着时成立：候选被丢掉或任务被取消之后，那一行念「已取消」，也不再给回去的按钮 */
    const review = t.stage === 'review' && t.status === 'queued' && !t.canceled;
    const label = t.stage === 'repair' ? '需要你确认' : review ? window.BC_EXPORT.reviewLabel(t.kind) : t.canceled ? '已取消' : t.status === 'error' ? '失败' : t.undone ? '已撤销' : t.status === 'done' ? '已完成'
                : t.status === 'queued' ? '排队中' : `${t.phase}${t.pct == null ? '' : ` · ${t.pct}%`}`;
    return (
      <Card layer className="task">
        <span className="kicon" style={{
          background: `var(--${tone === 'negative' ? 'red' : tone === 'positive' ? 'green' : tone === 'neutral' ? 'gray' : 'blue'}-200)`,
          color: `var(--${tone === 'negative' ? 'red' : tone === 'positive' ? 'green' : tone === 'neutral' ? 'gray' : 'blue'}-${tone === 'neutral' ? '800' : '1000'})`}}>
          {t.status === 'running' && !t.canceled && (t.kind === 'transcribe' || t.kind === 'retranscribe')
            ? <window.RSP.AI.PixelLoader icon={window.RSP.AI.microphone} size={16} />
            : <Ic n={k.icon} className="ic--16" />}
        </span>
        <div className="task__b">
          <div className="row gap6">
            <span className="task__t t-truncate">{F.taskTitle(t, k.label)}</span>
            <Chip tone={t.undone ? 'neutral' : tone}>{label}</Chip>
            {t.source === 'cli' ? <Chip tone="neutral">命令行</Chip> : null}
            {t.source === 'agent' ? <Chip tone="info" icon="agent">Agent</Chip> : null}
          </div>
          <div className="task__s">{[F.cardSub(t) || t.sub, t.started].filter(Boolean).join(' · ')}</div>
          {t.status === 'running' ? <div className="task__pg"><Progress value={t.pct || 0} indeterminate={t.pct == null} /></div> : null}
          {t.status === 'queued' && t.stage !== 'repair' && !review ? <div className="task__pg"><Progress indeterminate /></div> : null}
        </div>
        <UndoActions t={t} />
        {t.session ? <Btn variant="quiet" size="s" onClick={() => app.openSession(t.session)}>打开会话</Btn> : null}
        {/* 智能裁剪停在「检查构图」等人：这颗按钮把人带回编辑器里的检查页（§15.9） */}
        {t.kind === 'crop' && review ? <Btn variant="accent" size="s" onClick={() => app.crop.resume(t)}>去检查</Btn> : null}
        {/* 剪成短视频停在「挑片段」等人（§15.12）：回到来源项目的 AI 工具页 */}
        {t.kind === 'shorts-cut' && review ? <Btn variant="accent" size="s" onClick={() => app.shortsCut.resume(t)}>去挑片段</Btn> : null}
        {t.kind === 'shorts-cut' && t.status === 'done' && !t.canceled && t.project
          ? <Btn variant="quiet" size="s" onClick={() => app.go({r: 'projects', from: t.project})}>查看这几支</Btn> : null}
        <Btn variant="quiet" size="s" onClick={() => onOpen(t.id)}>详情</Btn>
        {/* 跑完的任务没有「取消」可言——cancellable 是那条记录的属性，
            但它只在还在跑的时候成立 */}
        {t.cancellable && (t.status === 'running' || t.status === 'queued')
          ? <Btn variant="quiet" size="s" onClick={() => t.origin === 'url' ? app.cancelImport(t.id) : app.cancelTask(t)}>取消</Btn>
          : null}
        {/* 失败或已取消的导入卡会一直钉在这页上，这是它们唯一的清除入口（第 221 轮）。
            只删这笔记账：已下载的视频和已创建的项目都不动。任务历史仍只有整节「清空历史」。 */}
        {t.origin === 'url' && t.status !== 'running' && t.status !== 'queued'
          ? <Btn variant="quiet" size="s" onClick={() => app.dismissImport(t.id)}>删除记录</Btn>
          : null}
      </Card>
    );
  }

  function TasksPage() {
    const app = useApp();
    const open = (id) => app.go({r: 'task', id});
    const [active, history] = window.BC_APP_IA.taskGroups(app.tasks);
    const live = active.items, past = history.items;
    return (
      <Page title="全部任务" actions={
        past.length
          ? <Btn variant="quiet" size="s" onClick={() => app.confirm({
              title: '清空任务历史？', body: '只清列表，产物文件不受影响。',
              tone: 'negative', confirmLabel: '清空',
              run: () => app.toast('已清空历史', 'positive'),
            })}>清空历史</Btn>
          : null
      }>
        <div className="t-section">进行中</div>
        {live.length
          ? <div className="tasks">{live.map((t) => <TaskCard key={t.id} t={t} onOpen={open} />)}</div>
          : <Empty title="没有在跑的任务">转录、翻译与导出都会出现在这里。</Empty>}

        <div className="t-section" style={{marginTop: 28}}>已完成</div>
        {past.length
          ? <div className="tasks">{past.map((t) => <TaskCard key={t.id} t={t} onOpen={open} />)}</div>
          : <Empty title="还没有完成的任务" />}
      </Page>
    );
  }

  /* 来源卡：这一跑是哪个视频、文件在哪、属于哪个项目。只有一个进度条的详情页
     回答不了「在转什么」——所以视频名、完整路径、项目入口排在详情格前面。
     不在视频库里的包（命令行建在临时目录）没有「打开视频」，只能到它所在的文件夹里找。 */
  function TaskSource({t, proj}) {
    const app = useApp();
    const s = F.source(t, proj);
    if (!s.media && !s.project) return null;
    return (
      <>
        <div className="t-section" style={{marginTop: 28}}>来源</div>
        <Card layer className="tsrc">
          {s.media ? (
            <div className="tsrc__row">
              <Ic n="film" className="ic--16 tsrc__ic" />
              <div className="tsrc__b">
                <div className="row gap6">
                  <span className="t-ui t-truncate">{s.media.name}</span>
                  {s.media.duration ? <span className="t-detail-xs t-mono">{F.clock(s.media.duration)}</span> : null}
                </div>
                {s.media.path ? <div className="tsrc__path t-mono">{s.media.path}</div> : null}
              </div>
              <Btn variant="quiet" size="s" onClick={() => app.toast('在文件夹中显示 · ' + s.media.name)}>在文件夹中显示</Btn>
            </div>
          ) : null}
          {s.project ? (
            <div className="tsrc__row">
              <Ic n="folder" className="ic--16 tsrc__ic" />
              <div className="tsrc__b">
                <div className="t-ui t-truncate">{s.project.title}</div>
                {s.project.path ? <div className="tsrc__path t-mono">{s.project.path}</div> : null}
                {s.project.registered ? null
                  : <div className="t-detail-xs tsrc__note">这部视频不在视频库里（命令行建的），没法从这里打开。</div>}
              </div>
              {s.project.registered
                ? <Btn variant="secondary" size="s" onClick={() => app.go({r: 'editor', id: s.project.id})}>打开视频</Btn>
                : <Btn variant="quiet" size="s" onClick={() => app.toast('在文件夹中显示 · ' + s.project.title)}>在文件夹中显示</Btn>}
            </div>
          ) : null}
        </Card>
      </>
    );
  }

  /* 已转录内容：转录还在跑时，jobs 帧里最近的实时分段按时间排出来。
     跑完就不显示——完整文稿在项目里，这里不是第二份文稿。 */
  function TaskTranscript({t, proj}) {
    const tr = F.transcript(t, proj ? proj.duration : t.media && t.media.duration);
    if (!tr) return null;
    return (
      <>
        <div className="row" style={{marginTop: 28}}>
          <span className="t-section grow">已转录内容</span>
          <span className="t-detail-xs t-mono">{F.transcriptSummary(tr)}</span>
        </div>
        <Card layer className="tlive" data-testid="task-live">
          {tr.segments.length
            ? tr.segments.map((s) => (
                <div className="tlive__seg" key={s.start}>
                  <span className="tlive__t t-mono">{F.clock(s.start)}</span>
                  <span className="tlive__x">{s.text}</span>
                </div>
              ))
            : <div className="t-detail">还没有识别出文字，第一段出来就显示在这里。</div>}
        </Card>
        {tr.segments.length
          ? <div className="t-detail-xs" style={{marginTop: 8}}>这里只留最近 {F.LIVE_SEGMENT_LIMIT} 段；转录完成后，完整文稿在视频里。</div>
          : null}
      </>
    );
  }

  /* 图片一节（§17.3，2026-09-27）：生图任务的每一行请求一张卡。数据是 jobs 帧的 `images[]`，
     跟任务一起进历史——跑完仍在，结果图与提示词只在这一页看得到。
     缩略图：已完成 = 第一张结果图（演示用 `BC_CLOUD_IMAGE.demoArt` 按行号挑渐变），多张右下角 `+N`；
     在画 = 灰底 + 已画秒数；排队 = 灰底「排队中」；失败 = 红色警示图标。 */
  function ImageThumb({it}) {
    if (it.status === 'done') {
      const CI = window.BC_CLOUD_IMAGE;
      const more = (it.paths || []).length - 1;
      return (
        <span className="timg__th" style={{background: CI ? CI.demoArt(it.line * 3) : undefined}}>
          {more > 0 ? <span className="timg__more">+{more}</span> : null}
        </span>
      );
    }
    if (it.status === 'error') return <span className="timg__th timg__th--err"><Ic n="alert" className="ic--22" /></span>;
    return (
      <span className="timg__th timg__th--wait">
        {it.status === 'running' ? <span className="t-mono">{Math.round((it.elapsedMs || 0) / 1000)} s</span>
          : it.status === 'queued' ? '排队中' : null}
      </span>
    );
  }

  function TaskImages({t}) {
    const app = useApp();
    const im = F.images(t);
    if (!im) return null;
    const copy = (it) => {
      /* 原型：剪贴板不可用（页面没焦点、非安全上下文）时只给 toast */
      try { const p = navigator.clipboard && navigator.clipboard.writeText(it.prompt); if (p && p.catch) p.catch(() => {}); } catch (e) { /* 同上 */ }
      app.toast(`已复制第 ${it.line} 行的提示词`);
    };
    return (
      <>
        <div className="row" style={{marginTop: 28}}>
          <span className="t-section grow">图片</span>
          <span className="t-detail-xs">{F.imagesSummary(im)}</span>
        </div>
        <Card layer className="timg" data-testid="task-images">
          {im.items.map((it) => {
            const st = F.imageStatus(it);
            return (
              <div className="timg__row" key={it.line}>
                <ImageThumb it={it} />
                <div className="timg__b">
                  <div className="row gap6">
                    <span className="t-mono t-detail-xs">{`#${it.line}`}</span>
                    <Chip tone={st.tone}>{st.label}</Chip>
                  </div>
                  <div className="timg__p t-clamp3">{it.prompt}</div>
                  <div className="t-detail-xs timg__m">{F.imageMeta(it)}</div>
                  {it.status === 'error' && it.error ? <div className="timg__err">{it.error}</div> : null}
                </div>
                <div className="timg__acts">
                  <Btn variant="quiet" size="s" icon="copy" onClick={() => copy(it)}>复制提示词</Btn>
                  {it.status === 'done'
                    ? <Btn variant="quiet" size="s" icon="folder"
                        onClick={() => app.toast('在文件夹中显示 · ' + F.fileName((it.paths || [])[0]))}>在文件夹中显示</Btn>
                    : null}
                </div>
              </div>
            );
          })}
        </Card>
        {im.total > im.items.length
          ? <div className="t-detail-xs" style={{marginTop: 8}}>这里只列前 {im.items.length} 行；这一批共 {im.total} 行。</div>
          : null}
      </>
    );
  }

  function TaskDetailPage({id}) {
    const app = useApp();
    const [open, setOpen] = useState(null);
    const t = app.tasks.find((x) => x.id === id);
    const act = D.modelActivity[id];
    if (!t) return <Page title="任务不存在"><Empty title="这个任务已经不在列表里了" /></Page>;
    if (t.origin === 'url') return <Page><window.ImportTask task={t} /></Page>;
    const k = KIND[t.kind] || KIND.transcribe;
    const proj = app.projById(t.project);
    return (
      <Page>
        <Btn variant="quiet" size="s" icon="back" onClick={() => app.go({r: 'tasks'})}
          style={{marginBottom: 12}}>后台任务</Btn>
        <div className="t-heading">{proj
          ? <BCAction className="task-project-link" onClick={() => app.go({r: 'editor', id: proj.id})}>{proj.title}</BCAction>
          : F.taskTitle(t, k.label)}</div>
        <div className="t-detail" style={{marginTop: 4}}>{[k.label, t.sub, t.started].filter(Boolean).join(' · ')}</div>

        {t.status === 'running' ? <div style={{maxWidth: 420, marginTop: 16}}><Progress value={t.pct} /></div> : null}
        {/* 执行方那一句 `detail`（「第 1 行 · Codex 正在画 · 15 秒」）：此前只在 jobs 帧里、界面不画。
            所有种类通用；没有 detail 时退回阶段短语。只在运行中写。 */}
        {t.status === 'running' && (t.detail || t.phase)
          ? <div className="t-detail" style={{marginTop: 6}}>{t.detail || t.phase}</div> : null}
        {/* 视频工具的运行（tool-runs.jsx）：按步骤显示进度，失败停在那一步、可以从那一步重试（product-design §2.7） */}
        {t.tool && window.ToolTaskPanel ? <window.ToolTaskPanel t={t} /> : null}
        {/* 工具运行的结果与操作、直接任务的重试（page-tasks-outputs.jsx，product-design §2.7「进度与失败」） */}
        {window.TaskOutputs ? <window.TaskOutputs t={t} /> : null}
        {t.cancellable && (t.status === 'running' || t.status === 'queued') ? (
          <div className="row gap8" style={{marginTop: 12}}>
            <Btn variant="negative" size="m" className="task-cancel-action" onClick={() => app.cancelTask(t)}>
              {t.kind === 'export' ? '取消导出' : '取消任务'}
            </Btn>
            {t.kind === 'export' ? <span className="t-detail">已写出的那部分文件会删掉，视频本身不受影响。</span> : null}
          </div>
        ) : null}
        {t.session ? (
          <div className="row gap8" style={{marginTop: 12}}>
            <Btn variant="secondary" size="s" icon="agent" onClick={() => app.openSession(t.session)}>打开会话</Btn>
            <span className="t-detail">这一跑是 Agent 会话里允许后执行的；对话与允许记录都在会话里。</span>
          </div>
        ) : null}

        {t.undoable && t.status === 'done' ? (
          <div className="row gap8" style={{marginTop: 16}}>
            <UndoActions t={t} size="m" />
            <span className="t-detail">
              {t.undone
                ? '这一跑已经撤销了——「恢复」把它放回去，不用重跑。'
                : t.undoBody || '这一跑写进了视频，可以整条撤销。'}
            </span>
          </div>
        ) : null}

        {t.canceled
          ? <Card layer style={{padding: 14, marginTop: 16}}>
              <div className="row gap8">
                <Ic n="info" className="ic--16" style={{color: 'var(--gray-700)'}} />
                <span className="t-title-sm grow">{t.kind === 'export' ? '已取消 · 半成品文件已删掉' : '已取消'}</span>
              </div>
              <div className="t-detail" style={{marginTop: 6}}>
                {t.kind === 'export' ? '视频本身不受影响；回到编辑器再点「导出」可以重新设置一遍。' : '视频本身不受影响。'}
              </div>
            </Card>
          : null}
        {t.status === 'error' && !t.canceled && !t.tool && !(window.BC_TASK_OUTPUTS && window.BC_TASK_OUTPUTS.retry(t))
          ? <Card style={{padding: 14, marginTop: 16, boxShadow: 'inset 0 0 0 1px var(--red-300)', background: 'var(--red-100)'}}>
              <div className="row gap8">
                <Ic n="alert" className="ic--16" style={{color: 'var(--red-900)'}} />
                <span className="t-title-sm t-negative grow">{t.error}</span>
              </div>
              <div className="t-detail" style={{marginTop: 6}}>
                这是配置问题，重试同一条链路不会好。先补上缺的组件，再跑一次。
              </div>
              <div className="row gap8" style={{marginTop: 12}}>
                <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'local'})}>去补装组件</Btn>
                <Btn variant="secondary" size="s" onClick={() => app.toast('换一个引擎重试：本轮为骨架')}>换个模型重试</Btn>
              </div>
            </Card>
          : null}

        <TaskSource t={t} proj={proj} />
        <TaskTranscript t={t} proj={proj} />
        <TaskImages t={t} />

        <div className="t-section" style={{marginTop: 28}}>详情</div>
        <Card layer style={{padding: 14, marginTop: 8}}>
          {F.details(t, k.label, Date.now()).map(([a, b]) => (
            <div className="row" key={a} style={{padding: '5px 0'}}>
              <span className="t-label" style={{width: 88}}>{a}</span>
              <span className="t-ui">{b}</span>
            </div>
          ))}
        </Card>

        {t.artifacts
          ? <>
              <div className="t-section" style={{marginTop: 28}}>产物</div>
              <Card layer style={{padding: 14, marginTop: 8}}>
                {t.artifacts.map((a) => (
                  <div className="row" key={a.name}>
                    <Ic n="film" className="ic--16" />
                    <span className="t-ui grow t-mono">{a.name}</span>
                    <span className="t-detail">{a.note}</span>
                    {t.kind === 'export'
                      ? <Btn variant="quiet" size="s" onClick={() => app.toast('在文件夹中显示 · ' + a.name)}>在文件夹中显示</Btn>
                      : null}
                  </div>
                ))}
              </Card>
            </>
          : null}

        {act ? (
          <>
            <div className="row" style={{marginTop: 28}}>
              <span className="t-section grow">模型活动</span>
              <span className="t-detail-xs t-mono">{act.summary}</span>
            </div>
            <Card layer style={{padding: 6, marginTop: 8}}>
              {act.calls.map((c) => (
                <div key={c.id}>
                  <BCAction className={cx('arow', c.req && 'arow--click')}
                    onClick={() => c.req && setOpen(open === c.id ? null : c.id)}>
                    <span className="t-mono t-detail-xs" style={{width: 42}}>#{c.id}</span>
                    <span className="grow t-detail">{c.what}</span>
                    <span className="t-mono t-detail-xs">{c.took}</span>
                    {c.req ? <Ic n={open === c.id ? 'chevup' : 'chevdown'} className="ic--14" /> : null}
                  </BCAction>
                  {open === c.id ? (
                    <div className="amono">
                      <div><b>Request</b>{'  '}{c.req}</div>
                      <div style={{marginTop: 4}}><b>Response</b>{'  '}{c.res}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </Card>
            <div className="t-detail-xs" style={{marginTop: 8}}>
              这一栏在 <code>apps/baocut</code> 里还没有数据通道——任务事件目前不带
              calls / retried 计数，登记在原型 README 的分歧台账。
            </div>
          </>
        ) : null}
      </Page>
    );
  }

  Object.assign(window, {TasksPage, TaskDetailPage, BC_TASK_KINDS: KIND});
})();
