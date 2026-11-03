/* 工具 › 生成音乐（2026-10-11，YuE2 / audio.cpp 技术方案；product-design §2.7 表「音乐」组）：不开项目也能生成一段配乐或歌曲。
   左栏：形式（纯音乐 / 带唱的歌）→ 风格（一句英文描述，芯片可填）→ 歌词（带唱时）→ 时长（目标与上限）→ 规划 → 模型 → 种子 → 保存位置。
   右栏：生成记录，一次一条（本机占重活槽）；慢是常态，卡上写阶段、进度与预计耗时。做好的 WAV 保存在保存位置、是 Space 里的音频条目，
   产物行给「在 Space 中查看 / 在文件夹中显示 / 交给 Agent / 以此新建视频 / 加到视频」。
   从编辑器 AI 工具「生成配乐」进来（openToolWith 的 params.movie）：时长按那部视频预填，顶上写明来处，做好后直接加进它的音乐轨。
   字段与 Runtime 的 GenerateMusicRequest 同名（model-music.js），真相在 BC_MUSIC，这里只画。 */
(function () {
  const {useState, useEffect} = React;
  const M = window.BC_MUSIC;
  const D = window.BC_DATA;
  const {useSound} = window.TtsForm;
  const DEMO_WAV = 'assets/cloud-test.wav';

  /* ---------- 生成记录：挂在模块上，离开这页照样跑完 ---------- */
  const jobs = {list: [], seq: 0, subs: new Set(), timer: null, draft: null};
  const emit = () => jobs.subs.forEach((fn) => fn(jobs.list));
  const patchRec = (id, p) => { jobs.list = jobs.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  const removeRec = (id) => { jobs.list = jobs.list.filter((r) => r.id !== id); emit(); };
  function useRecords() {
    const [list, setList] = useState(jobs.list);
    useEffect(() => {
      jobs.subs.add(setList);
      setList(jobs.list);
      return () => { jobs.subs.delete(setList); };
    }, []);
    return list;
  }
  const nextQueued = () => jobs.list.some((r) => r.status === 'running') ? null : jobs.list.filter((r) => r.status === 'queued').slice(-1)[0] || null;
  const aheadOf = (id) => jobs.list.filter((r) => r.status === 'queued' && r.id > id).length;

  /** 本机一次生成一条 */
  function pump(app) {
    const r = nextQueued();
    if (!r) return;
    const tid = app.addTask({kind: 'music', flow: 'music', tool: 'music', toolId: 'music', params: r.params || null, project: null,
      title: `生成音乐 · ${r.name}`, sub: `${r.modelName} · ${M.recordMeta(r)} · 本机`, phase: '加载模型', cancellable: true,
      ...window.BC_TOOL_RUNS.outputsPatch([], r.saveDir)});
    patchRec(r.id, {status: 'running', pct: 0, taskId: tid});
    // 演示节奏：30 秒的音乐几分钟——这里压成十几秒；直接生成略快
    const step = r.form.planning === 'off' ? 1.4 : 1;
    const t0 = Date.now();
    let p = 0;
    clearInterval(jobs.timer);
    jobs.timer = setInterval(() => {
      const cur = jobs.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(jobs.timer); return; }
      p = Math.min(100, p + step);
      const pct = Math.floor(p);
      patchRec(r.id, {pct});
      app.patchTask(tid, {pct, phase: M.phase(pct, r.form)});
      if (p < 100) return;
      clearInterval(jobs.timer);
      if (jobs.failNext) {
        const error = jobs.failNext;
        jobs.failNext = null;
        patchRec(r.id, {status: 'error', error});
        app.patchTask(tid, {status: 'error', outcome: 'error', pct, phase: null, error});
        pump(app);
        return;
      }
      // 演示：每第三条写到了上限（模型写长了），卡上提醒加长上限
      const dur = r.id % 3 === 0 ? M.maxOf(r.form) : Number(r.form.targetDurationSec);
      const entry = register(app, r, dur);
      patchRec(r.id, {status: 'done', ago: '刚刚', dur, elapsed: (Date.now() - t0) / 1000, entry, truncated: M.truncated(dur, r.form)});
      app.patchTask(tid, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, window.BC_TOOL_RUNS.outputsPatch([entry], r.saveDir)));
      if (r.movie) {
        const bed = addToMovie(app, r, entry, dur);
        patchRec(r.id, {bed});
        app.toast(`已生成 ${r.name} · 已加进「${r.movieTitle || '视频'}」的音乐轨 · ${bed}`, 'positive');
      } else {
        app.toast(`已生成 ${r.name} · 保存在 ${window.BC_SAVE_DIR.label(r.saveDir)}`, 'positive');
      }
      pump(app);
    }, 120);
  }
  /** 生成好的一条：保存位置里的 WAV、Space 里的音频条目（BC_HOME_TOOLS.output 的 `tool-audio-<id>`） */
  function register(app, r, dur) {
    return app.registerToolOutput('audio', {id: `music-${r.id}`, name: r.name, dur, sourceUrl: DEMO_WAV,
      file: `${r.saveDir || window.BC_SAVE_DIR.DEFAULT}/${r.name}`, toolId: 'music', task: r.taskId || null, params: r.params || null,
      note: `音乐 · ${M.recordMeta(r)} · 工具生成的结果 · 交互原型使用示例内容`});
  }
  /** 加到视频（product-design §2.7「生成配乐」）：按实际生成的时长循环铺满视频——接缝交叉淡化、片尾淡出，不拉伸。
   *  真实的写入是一笔 edits_apply：每段一个 addItem（role: music，交替两条音乐轨）加 setAudioMix 的 fadeIn / fadeOut；
   *  原型把铺法记在视频上（`musicBed`），素材记进 `linkedMedia`。返回一句说明。 */
  function addToMovie(app, r, entry, dur) {
    return layBed(app, r.movie, entry, dur, r.movieDuration).summary;
  }
  /** 结果行「加到视频」也走这里（product-design §2.7「结果与下一步」）：一部视频只留一床配乐，再铺换掉上一床；没有时长的视频放完整的一段。
   *  返回 `{summary, already, undo}`；这段音乐已经铺在这部视频上时 `already`，不再铺。 */
  function layBed(app, movieId, entry, dur, movieDuration) {
    const R = window.BC_TOOL_RUNNER;
    const m = R.movieNow(movieId, app);
    if (m.musicBed && m.musicBed.file === entry.file) return {summary: '', already: true, undo: () => {}};
    const before = {linkedMedia: m.linkedMedia, musicBed: m.musicBed};
    const total = Number(movieDuration || m.duration) || dur;
    const layout = M.loopLayout(dur, total);
    R.patchMovie(app, movieId, {linkedMedia: (m.linkedMedia || []).concat([{name: entry.name, path: entry.file}]),
      musicBed: {name: entry.name, file: entry.file, pieceSec: dur, layout}});
    return {summary: M.loopSummary(layout, total), already: false, undo: () => R.patchMovie(app, movieId, before)};
  }
  function enqueue(app, f, saveDir, model, movie) {
    jobs.seq += 1;
    const form = Object.assign({}, f, {maxDurationSec: M.maxOf(f)});
    /* params：这次的表单与来处，任务详情「再做一次」把它填回这一页 */
    const params = Object.assign({}, form, movie ? {movie: movie.id, movieTitle: movie.title, movieDuration: movie.duration} : {});
    const rec = {id: jobs.seq, name: M.nameFor(form, jobs.seq), form, modelName: model ? model.label : form.model, status: 'queued', pct: 0, saveDir, params,
      movie: movie ? movie.id : null, movieTitle: movie ? movie.title : null, movieDuration: movie ? movie.duration : null, request: M.request(form)};
    jobs.list = [rec].concat(jobs.list);
    emit();
    const ahead = aheadOf(rec.id);
    if (ahead) app.toast(`已排队 · 前面还有 ${ahead} 条，本机一次生成一条`);
    pump(app);
  }
  function cancelRec(app, r) {
    if (r.status === 'queued') { patchRec(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.taskId, {after: () => {
      clearInterval(jobs.timer);
      patchRec(r.id, {status: 'canceled', pct: 0});
      pump(app);
    }});
  }

  /* ---------- 播放：同一时刻只响一段（useSound 在 tool-tts-form.jsx） ---------- */
  function Player({r}) {
    const s = useSound(DEMO_WAV);
    const d = s.d || r.dur || 0;
    return (
      <div className="ttsp">
        <IconBtn icon={s.on ? 'pause' : 'play'} size="s" tip={s.on ? '暂停' : '播放'} onClick={s.toggle} />
        <span className="ttsp__bar ttsrec__bar"
          onClick={(e) => { const b = e.currentTarget.getBoundingClientRect(); s.seek((e.clientX - b.left) / b.width); }}>
          <i style={{width: (d ? Math.min(100, (s.t / d) * 100) : 0) + '%'}} />
        </span>
        <span className="t-mono t-detail-xs">{s.t.toFixed(1)} / {d.toFixed(1)} s</span>
        <RSP.LinkButton variant="secondary" size="S" href={DEMO_WAV} download={r.name}>下载</RSP.LinkButton>
      </div>
    );
  }

  /* ---------- 右栏：一条生成记录 ---------- */
  function RecordCard({r, onReuse}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const close = () => setPop(false);
    const state = {done: r.ago, running: '生成中', queued: '排队中', canceled: '已取消', error: '失败'}[r.status];
    return (
      <div className={cx('ttsrec', r.status === 'running' && 'is-running', r.status === 'canceled' && 'is-off')}>
        <div className="ttsrec__hd">
          <Ic n="music" className="ic--16 ttsrec__ic" />
          <b className="t-title-sm t-truncate grow">{r.name}</b>
          <span className="t-detail-xs">{state}</span>
          <div className="ttsrec__pop">
            <IconBtn icon="more" size="s" tip="更多" on={pop} onClick={() => setPop((v) => !v)} />
            <Popover open={pop} onClose={close} align="right" dir="down" width={220}>
              <Menu>
                <MenuItem icon="edit" label="带回左边再改一版" onClick={() => { close(); onReuse(r); }} />
                <MenuItem icon="copy" label="复制风格描述" onClick={() => { close(); copyToClipboard(r.form.style); app.toast('已复制风格描述'); }} />
                {r.taskId ? <MenuItem icon="tasks" label="在后台任务里查看" onClick={() => { close(); app.go({r: 'task', id: r.taskId}); }} /> : null}
                <MenuRule />
                <MenuItem icon="trash" label="删除这条记录" tone="negative" disabled={r.status === 'running'}
                  onClick={() => { close(); removeRec(r.id); app.toast(`已删除 ${r.name}`); }} />
              </Menu>
            </Popover>
          </div>
        </div>
        <p className="ttsrec__text">{r.form.style}{r.form.mode === 'song' && r.form.lyrics ? ` — ${r.form.lyrics.split('\n')[0]}…` : ''}</p>
        <span className="t-detail-xs">{M.recordMeta(r)}{r.movieTitle ? ` · 配给「${r.movieTitle}」` : ''}</span>
        {r.bed ? <span className="t-detail-xs">已加进音乐轨 · {r.bed}</span> : null}

        {r.status === 'running' ? (
          <div className="ttsrec__busy">
            <div className="row">
              <span className="t-detail-xs grow">{M.phase(r.pct, r.form)} · {r.pct}% · {M.etaText(r.form.targetDurationSec, {planning: r.form.planning})}</span>
              <Btn variant="quiet" size="s" onClick={() => cancelRec(app, r)}>取消</Btn>
            </div>
            <Progress value={r.pct} thin />
          </div>
        ) : null}
        {r.status === 'queued' ? (
          <div className="row">
            <span className="t-detail-xs grow">前面还有 {aheadOf(r.id)} 条 · 本机一次生成一条</span>
            <Btn variant="quiet" size="s" onClick={() => cancelRec(app, r)}>取消</Btn>
          </div>
        ) : null}
        {r.status === 'canceled' ? (
          <div className="row">
            <span className="t-detail-xs grow">没有生成文件</span>
            <Btn variant="quiet" size="s" icon="refresh" onClick={() => { patchRec(r.id, {status: 'queued', pct: 0}); pump(app); }}>重新排队</Btn>
          </div>
        ) : null}
        {r.status === 'error' ? (
          <div className="row">
            <span className="t-detail-xs grow ttsw__err">{r.error}</span>
            <Btn variant="quiet" size="s" icon="refresh" onClick={() => { patchRec(r.id, {status: 'queued', pct: 0, error: null}); pump(app); }}>重试</Btn>
          </div>
        ) : null}
        {r.status === 'done' ? (
          <>
            <Player r={r} />
            {r.truncated ? <span className="t-detail-xs">{M.maxOf(r.form) >= M.DURATION.max
              ? `写到了 ${M.DURATION.max} 秒的单次上限，结尾可能收得急${r.bed ? '；循环的接缝有交叉淡化' : ''}。`
              : `写到了 ${M.maxOf(r.form)} 秒的上限，结尾可能收得急；想让它自然收尾就把上限加长再生成。`}</span> : null}
            {r.entry ? <window.ToolOutputRow entry={r.entry} fromTool="music" compact /> : null}
          </>
        ) : null}
      </div>
    );
  }

  /* ---------- 左栏：表单 ---------- */
  function Section({title, aside, children}) {
    return (
      <div className="ttsw__sec">
        {title ? <div className="ttsw__sechd"><b className="grow">{title}</b>{aside}</div> : null}
        {children}
      </div>
    );
  }

  function MusicToolPage() {
    const app = useApp();
    const models = M.models(D.setModels, app.modelInstalled);
    const dflt = (app.prefs.localModelDefaults || {}).music;
    const [f, setF] = useState(() => jobs.draft || M.blank(M.preferred(models, dflt)));
    const set = (p) => setF((s) => Object.assign({}, s, p));
    const [movie, setMovie] = useState(null);   // 从编辑器「生成配乐」带来的那部视频
    const save = window.BC_TOOL_FRAME.useSaveDir();
    /* 任务详情「再做一次」与编辑器「生成配乐」都经 openToolWith 带 params 进来 */
    window.BC_TOOL_FRAME.useToolPreset('music', (p) => {
      if (!p.params) return;
      const {movie: mid, movieTitle, movieDuration, ...rest} = p.params;
      setF((cur) => Object.assign({}, cur, rest, models.some((m) => m.id === rest.model) ? {} : {model: cur.model}));
      const proj = mid ? app.projById(mid) || {} : null;
      setMovie(mid ? {id: mid, title: movieTitle || proj.title || '视频', duration: Number(movieDuration || proj.duration) || null} : null);
    });
    useEffect(() => { jobs.draft = f; }, [f]);
    const list = useRecords();
    const [tried, setTried] = useState(false);
    const [lyricsOpen, setLyricsOpen] = useState(false);
    const model = models.find((m) => m.id === f.model) || null;
    const bad = M.validate(f) || window.BC_TOOL_FRAME.modelReason(models, f.model, '用哪个音乐模型');
    const busy = list.filter((r) => r.status === 'running' || r.status === 'queued').length;
    const eta = M.etaText(f.targetDurationSec, {planning: f.planning});

    const generate = () => {
      setTried(true);
      if (bad) { app.toast(bad); return; }
      enqueue(app, f, save.dir, model, movie);
      if (movie) setMovie(null);
    };
    const again = (r) => { setF(Object.assign(M.blank(), r.form, {model: models.some((m) => m.id === r.form.model) ? r.form.model : M.preferred(models, dflt), seed: ''})); app.toast('已带回这一版的风格与设置 · 种子留空重新随机'); window.scrollTo({top: 0, behavior: 'smooth'}); };

    const bar = (
      <>
        <span className={cx('t-detail pagenav__note', tried && bad && 'ttsw__err')}>{tried && bad ? bad : `${M.tokens(M.maxOf(f))} 个语义 token · ${eta}`}</span>
        <span className="t-detail-xs t-mono pagenav__hint">⌘↵</span>
        <Btn variant="accent" icon="music" disabled={!model || !model.ok} onClick={generate}>生成音乐</Btn>
      </>
    );

    return (
      <window.Page wide title="生成音乐" bar={bar} actions={<Chip icon="music">{model && model.ok ? `${model.label} · 在本机生成 · 不联网` : '本机音乐模型'}</Chip>}>
        <div className="ttsw" onKeyDown={(ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); generate(); } }}>
          <div className="ttsw__main">
            {movie ? (
              <div className="aicard">
                <b>给「{movie.title}」配乐</b>
                {M.soundtrackFor(movie.duration).loop ? (
                  <span>{M.soundtrackFor(movie.duration).note}做好后直接加进它的音乐轨，接缝交叉淡化；也会留在 Space 里。</span>
                ) : (
                  <span>时长按这部视频预填成 {f.targetDurationSec} 秒；做好后直接加进它的音乐轨，也会留在 Space 里。</span>
                )}
                <div className="chiprow"><Btn size="s" variant="quiet" onClick={() => setMovie(null)}>只生成，不加到视频</Btn></div>
              </div>
            ) : null}

            <Section title="形式">
              <Segmented items={M.MODES.map((x) => ({k: x.k, label: x.label, tip: x.desc}))} value={f.mode} onChange={(k) => { set({mode: k}); if (k === 'song') setLyricsOpen(true); }} />
              <span className="t-detail-xs">{M.modeOf(f.mode).desc}。</span>
            </Section>

            <Section title="风格" aside={<span className="t-detail-xs">给模型的是英文描述，写清曲风、乐器、节奏与情绪</span>}>
              <Field area rows={3} value={f.style} aria-label="风格描述" placeholder="例如：calm solo piano, slow tempo, soft, cinematic" onChange={(ev) => set({style: ev.target.value})} />
              <div className="ttsw__chips">
                {M.STYLES.map((s) => <Chip key={s.k} pill on={f.style === s.style} onClick={() => set({style: s.style})}>{s.label}</Chip>)}
                {f.style ? <BCAction className="viewall" onClick={() => set({style: ''})}>清空</BCAction> : null}
              </div>
            </Section>

            {f.mode === 'song' ? (
              <Section title="歌词" aside={<span className="t-detail-xs">按段落分行；[verse] [chorus] 这样的段落标记模型认得</span>}>
                <Field area rows={6} value={f.lyrics} aria-label="歌词" placeholder={'[verse]\n第一段歌词…\n\n[chorus]\n副歌…'} onChange={(ev) => set({lyrics: ev.target.value})} />
              </Section>
            ) : null}

            <Section title="时长" aside={<span className="t-detail-xs">{eta}</span>}>
              <div className="ttsw__row">
                <span className="ttsw__lab">目标</span>
                <Slider className="grow" value={Number(f.targetDurationSec)} min={M.DURATION.min} max={M.DURATION.max} step={M.DURATION.step} label="目标时长"
                  onChange={(v) => set({targetDurationSec: v, maxDurationSec: f.maxDurationSec && f.maxDurationSec < v ? null : f.maxDurationSec})} />
                <span className="t-mono t-detail" style={{width: 56, textAlign: 'right'}}>{f.targetDurationSec} 秒</span>
              </div>
              <div className="ttsw__row">
                <span className="ttsw__lab">上限</span>
                <Slider className="grow" value={M.maxOf(f)} min={Number(f.targetDurationSec)} max={M.DURATION.max} step={M.DURATION.step} label="时长上限"
                  onChange={(v) => set({maxDurationSec: v})} />
                <span className="t-mono t-detail" style={{width: 56, textAlign: 'right'}}>{M.maxOf(f)} 秒</span>
                {f.maxDurationSec ? <BCAction className="viewall" onClick={() => set({maxDurationSec: null})}>跟着目标</BCAction> : null}
              </div>
              <span className="t-detail-xs">目标只是给模型的创作意图，不保证精确；写到上限就停，结尾可能收得急。上限决定预算：{M.tokens(M.maxOf(f))} 个语义 token（每秒 {M.TOKENS_PER_SEC} 个）。</span>
            </Section>

            <Section title="规划">
              <div className="ttsw__chips">
                {M.PLANNINGS.map((p) => <Chip key={p.k} pill on={f.planning === p.k} title={p.desc} onClick={() => set({planning: p.k})}>{p.label}</Chip>)}
              </div>
              <span className="t-detail-xs">{M.planningOf(f.planning).desc}。</span>
            </Section>

            <window.ToolModelRow label="用哪个音乐模型" models={models} value={f.model} onChange={(id) => set({model: id})} settings={{r: 'settings', sec: 'music'}}>
              <div className="ttsw__row">
                <span className="ttsw__lab">种子</span>
                <Field size="s" style={{width: 140}} value={f.seed} placeholder="留空随机" inputMode="numeric" onChange={(ev) => set({seed: ev.target.value.replace(/[^\d]/g, '')})} />
                <span className="t-detail-xs">同一种子、同一设置在同一台电脑上出同一段；想要变化就留空。</span>
              </div>
            </window.ToolModelRow>

            <window.ToolSaveDirRow save={save} note="每段音乐是保存位置里的一个 WAV、Space 里的一个音频条目，旁边一份 JSON 记模型、风格、歌词与种子；重名时加序号。" />
          </div>

          <aside className="ttsw__side">
            <div className="ttsw__sidehd">
              <span className="t-title-sm grow">生成记录</span>
              <Btn size="s" variant="quiet" onClick={() => app.go({r: 'projects', sec: 'audio'})}>在 Space 中查看</Btn>
              {busy ? <Chip tone="accent">{busy} 条进行中</Chip> : <span className="t-detail-xs">{list.filter((r) => r.status !== 'canceled').length} 条</span>}
              <BCAction className="viewall" title="演示：让下一条失败" onClick={() => { jobs.failNext = 'audio.cpp 引擎退出了（退出码 1）：内存不够，关掉别的大模型或把时长缩短再试'; app.toast('演示：下一条会失败'); }}>演示失败</BCAction>
            </div>
            {list.filter((r) => r.status !== 'canceled').length
              ? list.filter((r) => r.status !== 'canceled').map((r) => <RecordCard key={r.id} r={r} onReuse={again} />)
              : <Empty icon="music" title="还没有生成过">写一句风格、选好模型，按「生成音乐」。一段 30 秒的音乐在本机要几分钟，可以先去做别的。</Empty>}
            <div className="t-detail-xs ttsw__sidefoot">
              生成的 WAV 保存在保存位置，也显示在 Space 的「音频」中；「加到视频」把它铺上一部视频的音乐轨。全程在这台电脑上运行，不联网。
              YuE2 权重只许非商业用途。交互演示里播放的是示例音频。
            </div>
          </aside>
        </div>
      </window.Page>
    );
  }

  Object.assign(window, {MusicToolPage, BC_TOOL_MUSIC: {layBed}});
})();
