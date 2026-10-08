/* 工具页的统一骨架（product-design §2.7「页面」「结果与下一步」）：每个工具页从上到下是
   输入（来源切换 + Space 选择器）→ 模型 → 选项 → 保存位置 → 开始；这里放各工具共用的几行与结果页的产物行。
   - 模型行（`ToolModelRow`）：列出这项能力已配置的本机与云端模型；没有可用模型时这一行给「去设置」，
     开始按钮写明原因（`modelReason`），不用整张警告卡片挡住参数；
   - 保存位置行（`ToolSaveDirRow` + `useSaveDir`）：缺省是设置里的默认保存位置（BC_SAVE_DIR），「更改…」只改这一次；
     写进已有视频的运行不显示这一行；
   - 产物行（`ToolOutputRow` / `ToolOutputs`）：名字、种类、时长与规格（BC_SPACE.durationText / specText），以及在 Space 中查看、在文件夹中显示、
     交给 Agent、接着用工具（BC_TOOL_RUNS.followUps）。生成语音、生成图片、文本生成与视频文件工具的记录卡也用这一行。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const SD = window.BC_SAVE_DIR;
  const RUNS = window.BC_TOOL_RUNS;
  const SP = () => window.BC_SPACE;

  /* 原型里「更改…」模拟系统文件夹选择器：轮流给几个常见目录 */
  const DEMO_DIRS = ['~/Movies/BaoCut', '~/Desktop', '~/Documents/工具结果'];

  /** 这一页的保存位置：`override` 只活在这一页（不写回设置），`dir` 是这次实际用的目录 */
  function useSaveDir() {
    const app = useApp();
    const [override, setOverride] = useState(null);
    return {override, setOverride, dir: SD.current(app.prefs, override)};
  }

  /** 保存位置行：目录、是不是设置里的默认、「更改…」只改这一次 */
  function ToolSaveDirRow({save, note}) {
    const app = useApp();
    const pick = () => {
      const cur = SD.current(app.prefs, save.override);
      const next = DEMO_DIRS[(DEMO_DIRS.indexOf(cur) + 1) % DEMO_DIRS.length];
      save.setOverride(next);
      app.toast(`这次保存到 ${next} · 交互原型模拟系统文件夹选择器`);
    };
    return <div className="ttsw__sec tframe__save">
      <div className="ttsw__sechd">
        <R.Icons.Folder />
        <b className="grow">保存到 <span className="t-mono">{SD.label(save.dir)}</span></b>
        {save.override
          ? <Btn size="s" variant="quiet" onClick={() => save.setOverride(null)}>改回默认</Btn>
          : <span className="t-detail-xs">{SD.isDefault(app.prefs) ? '默认保存位置' : '设置里的保存位置'}</span>}
        <Btn size="s" variant="quiet" onClick={pick}>更改…</Btn>
      </div>
      <span className="t-detail-xs">{note || '结果作为 Space 条目出现，文件保存在这个目录；重名时加序号，不覆盖已有文件。'}
        {save.override ? '只改这一次，' : ''}默认位置在设置 › 通用里改。</span>
    </div>;
  }

  /**
   * 模型行。`models`：[{id, label, local: boolean, ok: boolean}]，本机与云端放在同一张单子里；
   * 没有一只能用时给「去设置」，开始按钮用 `modelReason` 说明原因。
   */
  function ToolModelRow({label, models, value, onChange, settings, children}) {
    const app = useApp();
    const usable = models.filter((m) => m.ok);
    const cur = models.find((m) => m.id === value) || null;
    const goSettings = () => app.go(settings || {r: 'models'});
    return <div className="ttsw__sec">
      <div className="ttsw__sechd"><b className="grow">{label}</b>
        <Btn size="s" variant="quiet" onClick={goSettings}>{usable.length ? '管理模型…' : '去设置'}</Btn></div>
      {usable.length ? <R.Picker aria-label={label} selectedKey={value} onSelectionChange={onChange} UNSAFE_className="tool-llm__field">
        {models.map((m) => <R.PickerItem key={m.id} id={m.id}>{`${m.local ? '本机' : '云端'} · ${m.label}${m.ok ? '' : m.local ? ' · 未安装' : ' · 未连接'}`}</R.PickerItem>)}
      </R.Picker> : <span className="t-detail">还没有可用的{label.replace(/^用哪个/, '')}：在设置里安装一个本机模型，或连接一家云端服务。</span>}
      {cur && !cur.ok && usable.length ? <span className="t-detail-xs tframe__warn">{cur.local ? `${cur.label} 还没安装，换一只已装的，或去设置下载` : `${cur.label} 还没连接，换一只能用的，或去设置连接`}</span> : null}
      {children}
    </div>;
  }
  /** 开始按钮旁的原因：选中的模型不能用时说为什么；能用 → null */
  function modelReason(models, value, label) {
    const cur = models.find((m) => m.id === value);
    if (!models.some((m) => m.ok)) return `还没有可用的${label}，先去设置`;
    if (!cur) return `先选一个${label}`;
    if (!cur.ok) return cur.local ? `${cur.label} 还没安装` : `${cur.label} 还没连接`;
    return null;
  }

  /**
   * 工具页挂载或预设变化时取走预设（store 的 takeToolPreset）：`apply({entry, params, rerun, input, retryOf})`。
   * `retryOf`：Space「重试转录…」带来的失败任务记录（product-design §4.4），工具页顶部据此说明上次为什么失败。
   * 预设来自 Space 查看器「用工具处理…」、结果页「接着用工具」（`{entry}`），或任务详情「再做一次 / 重试」（`{entry?, rerun: true, params}`）。
   * `params.entry` 只存了 id，按 id 在 Space 里找回；`input` 是 BC_TOOL_SPACE_INPUT.fromPreset 的判断（收不收、是不是附加材料）。
   */
  function useToolPreset(toolId, apply) {
    const app = useApp();
    React.useEffect(() => {
      const raw = app.takeToolPreset(toolId);
      if (!raw) return;
      const ref = raw.entry || (raw.params && raw.params.entry) || null;
      const found = ref && ref.id ? (app.spaceItems || []).find((x) => x.id === ref.id) || (raw.entry ? raw.entry : null) : null;
      const entry = found && !found.trashed ? found : null;
      apply({entry, params: raw.params || null, rerun: !!raw.rerun, input: window.BC_TOOL_SPACE_INPUT.fromPreset(toolId, entry ? {entry} : null),
        retryOf: raw.retryOf || null});
    }, [app.toolPreset]);
  }

  /** 页顶的开始一栏：开始不了时在按钮旁写明原因（缺输入、没有可用模型…），不整页挡住 */
  function ToolStartBar({reason, children}) {
    return <>{reason ? <span className="t-detail pagenav__note">{reason}</span> : null}{children}</>;
  }

  /* ---------- 结果：产物行 ---------- */
  /** 「以此新建视频」：音频、视频文件直接成为素材；字幕与文档要先配一份视频或音频（§2.7、§4.6） */
  function NewMovieFrom({entry}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    if (entry.kind === 'final' || entry.kind === 'image') {
      const make = () => {
        const Run = window.BC_TOOL_RUNNER;
        const mv = app.createProject(null, {entry: 'blank', dir: entry.dir || null, title: entry.name.replace(/\.[^.]+$/, ''), ratio: '16:9'});
        app.patchProject(mv.id, Object.assign(Run.mediaMovie({name: entry.name, path: entry.file, format: entry.kind === 'image' ? 'PNG' : 'MP4', res: entry.res || '', state: 'ok'},
          entry.dur || (entry.kind === 'image' ? 5 : window.BC_DATA.DUR || 206)), {status: 'complete', sourceOutput: entry.id}));
        app.openMovie(mv.id, {via: 'space'});
      };
      return <Btn size="s" icon="film" onClick={make}>以此新建视频</Btn>;
    }
    /* 文档按字幕的样子建视频（逐句成为字幕）；知道来源媒体的不用再选 */
    const asSub = Object.assign({}, entry, {kind: entry.kind === 'audio' ? 'audio' : 'subtitle'});
    if (entry.kind === 'audio' || entry.sourceName) return <Btn size="s" icon="film" onClick={() => app.createMovieFromOutput(asSub)}>以此新建视频</Btn>;
    if (!open) return <Btn size="s" icon="film" onClick={() => setOpen(true)}>以此新建视频</Btn>;
    return <div className="trun__media">
      <span className="t-detail">{entry.kind === 'doc' ? '文档' : '字幕'}要配一份视频或音频才能成为视频。素材留在原处，视频里只做链接。</span>
      <window.MediaPick label="选择视频或音频" onPick={(name) => app.createMovieFromOutput(asSub, name)} />
    </div>;
  }
  /** 「加到视频」：音频、图片、视频文件加进 Space 里的某部视频（视频选择器，不要求有文稿） */
  function AddToMovie({entry}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const [pick, setPick] = useState(null);
    if (!open) return <Btn size="s" icon="plus" onClick={() => setOpen(true)}>加到视频</Btn>;
    const add = () => {
      window.BC_TOOL_RUNNER.importToMovie(app, {movie: pick}, {name: entry.name, src: {name: entry.name, path: entry.file, format: (entry.name.split('.').pop() || '').toUpperCase(), res: entry.res || '', state: 'ok'}});
      app.toast(`已把 ${entry.name} 加进「${(app.projById(pick) || {}).title || '视频'}」`, 'positive');
      setOpen(false);
    };
    return <div className="trun__media">
      <window.VideoPicker tool="link" value={pick} onChange={setPick} />
      <div className="row gap8"><Btn variant="accent" size="s" disabled={!pick} onClick={add}>加进这部视频</Btn><Btn size="s" variant="quiet" onClick={() => setOpen(false)}>取消</Btn></div>
    </div>;
  }

  /** 交给 Agent（§4.7）：app.handoverToAgent 新开会话、带引用、预填缺省的一句说明（不传 intent），不自动发送；返回 null 时条目在回收站 */
  function handOver(app, entry) {
    if (typeof app.handoverToAgent !== 'function') { app.toast('交给 Agent：等待会话侧接入'); return; }
    if (!app.handoverToAgent(entry)) app.toast('这个条目在回收站里，先恢复再交给 Agent');
  }

  /**
   * 一个产物一行：名字、种类、时长与规格；在 Space 中查看、在文件夹中显示、交给 Agent、接着用工具。
   * `fromTool`：产出它的工具（写进视频的结果按它给下一步）；`compact`：记录卡里的窄版（操作收进一行小按钮）。
   */
  function ToolOutputRow({entry, fromTool, compact}) {
    const app = useApp();
    if (!entry) return null;
    const kind = (SP() && SP().KINDS[entry.kind]) || {label: entry.kind, icon: 'FileText'};
    const Icon = R.Icons[kind.icon] || R.Icons.FileText;
    const size = SP() ? [SP().durationText(entry), SP().specText(entry)].filter(Boolean).join(' · ') : '';
    const next = RUNS.followUps(entry, fromTool);
    const movie = entry.kind === 'movie';
    const act = (n) => {
      if (n.id === 'open-movie') app.openMovie(entry.movie || entry.id, {via: 'space'});
      else if (n.kind === 'tool') app.openToolWith(n.id, {entry});
    };
    const btn = (n) => {
      if (n.id === 'new-movie') return <NewMovieFrom key={n.id} entry={entry} />;
      if (n.id === 'add-to-movie') return <AddToMovie key={n.id} entry={entry} />;
      return <Btn key={n.id} size="s" variant={n.id === 'open-movie' ? 'accent' : 'secondary'} icon={n.id === 'open-movie' ? 'film' : null}
        onClick={() => act(n)}>{n.label}</Btn>;
    };
    return <div className={cx('tout', compact && 'tout--compact')}>
      <div className="tout__hd">
        <span className="tout__ic"><Icon /></span>
        <span className="tout__txt">
          <b className="t-truncate">{entry.name}</b>
          <span className="t-detail-xs">{[movie ? '写进的视频' : kind.label, size, !movie && entry.file ? SD.label(entry.file.replace(/\/[^/]*$/, '')) : null].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      <div className="tout__acts">
        {next.filter((n) => n.id === 'open-movie').map(btn)}
        {!movie && <Btn size="s" variant="quiet" onClick={() => (app.openSpaceEntry ? app.openSpaceEntry(entry.id) : app.go({r: 'projects', sec: entry.kind}))}>在 Space 中查看</Btn>}
        {!movie && <Btn size="s" variant="quiet" icon="folder" onClick={() => app.toast(`已在文件夹中显示 ${entry.file || entry.name} · 交互原型不打开系统文件夹`)}>在文件夹中显示</Btn>}
        <Btn size="s" variant="quiet" icon="agent" onClick={() => handOver(app, entry)}>交给 Agent</Btn>
      </div>
      {next.some((n) => n.id !== 'open-movie') && <div className="tout__next">
        <span className="t-detail-xs">接着用</span>
        {next.filter((n) => n.id !== 'open-movie').map(btn)}
      </div>}
    </div>;
  }
  /** 一次运行的全部产物；`saveDir` 给了就在头上写保存位置 */
  function ToolOutputs({entries, fromTool, saveDir}) {
    const list = (entries || []).filter(Boolean);
    if (!list.length) return null;
    return <div className="tout__list">
      <div className="row gap8"><span className="t-section grow">产物</span>{saveDir ? <span className="t-detail-xs">保存在 {SD.label(saveDir)}</span> : null}</div>
      {list.map((e) => <ToolOutputRow key={e.id} entry={e} fromTool={fromTool} />)}
    </div>;
  }

  /** 保存位置里的文件名：取标题或源文件名，重名时加序号（BC_VIDEO.uniqueName），不覆盖 */
  function savedName(app, base, ext) {
    const taken = (app.spaceItems || []).map((x) => x.name);
    const stem = String(base || '结果').replace(/\.[^./]+$/, '').replace(/[\\/:*?"<>|]/g, ' ').trim() || '结果';
    return window.BC_VIDEO.uniqueName(`${stem}${ext}`, taken);
  }

  Object.assign(window, {ToolSaveDirRow, ToolModelRow, ToolStartBar, ToolOutputRow, ToolOutputs,
    BC_TOOL_FRAME: {useSaveDir, useToolPreset, modelReason, savedName, handOver}});
})();
