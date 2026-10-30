/* BaoCut 原型 — 定时任务（产品设计 §6.1「定时任务」，2026-10-30）。
   建立：会话标题栏 ⋯ 菜单「定时运行…」。按频率（每小时 / 每天 / 每周 / 自定义 cron）把一段话发给这条会话，或每次在它的项目里新开一条会话；
   可设最多运行次数。访问模式不替你改：不是「完全访问」时写一行提示，没人看着时遇到要你允许或回答的事会停在那里等你回来。
   列表：后台任务侧栏的「定时」一段；详情页 {r:'schedule', id}：状态、设置、运行记录，暂停 / 继续、立即运行一次、编辑、删除。
   到点时的规则（跳过 / 等会话空下来 / 暂停 / 跑满）在 model-agent-schedule.js 的 fire；原型不起计时器，「立即运行一次」走同一条路。
   store 那一层（useAgentSchedules）由 main.jsx 盖在共享 store 上。 */
(function () {
  const {useState, useEffect, useCallback, useRef} = React;
  const SC = window.BC_AGENT_SCHEDULE;
  const AG = window.BC_AGENT;
  const D = window.BC_DATA;

  const busy = (s) => s && (s.status === 'running' || s.status === 'waiting');
  const lastFailed = (s) => { const a = [...(s.messages || [])].reverse().find((m) => m.role === 'assistant'); return !!(a && a.error); };
  const runAt = (r) => r.at || Date.now() - (r.ago || 0) * 60000;

  /* ---------- store ---------- */
  function useAgentSchedules(base) {
    const [schedules, setSchedules] = useState(() => (D.agent.schedules || []).map((s) => ({...s, runs: (s.runs || []).slice()})));
    const seq = useRef(0);
    // 「建好后立即运行一次」在建立的同一下点击里排到下一拍：从 ref 读最新的列表，不吃旧闭包
    const latest = useRef(schedules);
    latest.current = schedules;
    const patchSchedule = useCallback((id, patch) => setSchedules((ss) => ss.map((s) => (s.id === id ? {...s, ...patch} : s))), []);
    const addRun = useCallback((id, run) => setSchedules((ss) => ss.map((s) => (s.id === id ? {...s, runs: [run].concat(s.runs)} : s))), []);
    const deleteSchedule = useCallback((id) => setSchedules((ss) => ss.filter((s) => s.id !== id)), []);

    /** 起一轮：发给目标会话，或在项目里新开一条（用建立时那条会话的访问模式）。 */
    const start = useCallback((s, target) => {
      if (s.target.type === 'session') { base.sendAgent(target.id, s.prompt); return target.id; }
      const n = base.newSession({dir: s.target.dir, mode: s.mode});
      base.patchSession(n.id, {scheduleId: s.id});
      base.sendAgent(n.id, s.prompt, n);
      return n.id;
    }, [base.sendAgent, base.newSession, base.patchSession]);

    /** 到点（或「立即运行一次」）：按 fire 的决定起一轮、排队、跳过、暂停或标完成。返回决定。 */
    const runSchedule = useCallback((id) => {
      const s = latest.current.find((x) => x.id === id);
      if (!s) return null;
      const target = s.target.type === 'session' ? base.sessionById(s.target.id) : undefined;
      const f = SC.fire(s, target);
      if (!f) return null;
      if (f.k === 'pause') patchSchedule(id, {status: 'paused', pauseReason: f.reason});
      else if (f.k === 'complete') patchSchedule(id, {status: 'completed'});
      else if (f.k === 'skip') addRun(id, {status: 'skipped', at: Date.now()});
      else if (f.k === 'queue') addRun(id, {status: 'queued', at: Date.now(), sessionId: target.id});
      else addRun(id, {status: 'running', at: Date.now(), sessionId: start(s, target)});
      return f;
    }, [base.sessionById, patchSchedule, addRun, start]);

    const createSchedule = useCallback((d) => {
      const id = `sc_new${++seq.current}`;
      setSchedules((ss) => [{id, status: 'active', runs: [], ...d}].concat(ss));
      return id;
    }, []);

    /* 会话停下来时把运行记录收尾（完成 / 失败），跑满就标完成；等会话空下来的那一轮在会话空下来时起 */
    useEffect(() => {
      let changed = false;
      const next = schedules.map((s) => {
        let runs = s.runs.map((r) => {
          if (r.status !== 'running' || !r.sessionId) return r;
          const ss = base.sessionById(r.sessionId);
          if (busy(ss)) return r;
          changed = true;
          return {...r, status: ss && lastFailed(ss) ? 'failed' : 'done', took: Math.max(1, Math.round((Date.now() - r.at) / 1000))};
        });
        const q = runs.find((r) => r.status === 'queued');
        if (q && s.status === 'active') {
          const ss = base.sessionById(q.sessionId);
          if (ss && !busy(ss) && !ss.archived) {
            changed = true;
            base.sendAgent(ss.id, s.prompt);
            runs = runs.map((r) => (r === q ? {...r, status: 'running', at: Date.now()} : r));
          }
        }
        const done = s.status === 'active' && s.maxRuns && SC.countedRuns({runs}) >= s.maxRuns;
        if (done) changed = true;
        return runs === s.runs && !done ? s : {...s, runs, ...(done ? {status: 'completed'} : {})};
      });
      if (changed) setSchedules(next);
    }, [base.sessions]);

    return {schedules, createSchedule, patchSchedule, deleteSchedule, runSchedule};
  }

  /* ---------- 建立 / 编辑 ---------- */
  const CADENCES = [{k: 'hourly', label: '每小时'}, {k: 'daily', label: '每天'}, {k: 'weekly', label: '每周'}, {k: 'cron', label: '自定义'}];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function draftOf(s, sess) {
    if (s) return {name: s.name, prompt: s.prompt, cadence: {...s.cadence}, target: s.target, limit: !!s.maxRuns, maxRuns: s.maxRuns || 5, runNow: false};
    return {name: sess.title || '', prompt: '', cadence: {type: 'daily', time: '09:00'}, target: {type: 'session', id: sess.id}, limit: false, maxRuns: 5, runNow: false};
  }

  /** 建立或编辑：`sess` 是从哪条会话建的（编辑时可以没有）；`edit` 是要改的定时任务。 */
  function ScheduleDialog({sess, edit, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const [d, setD] = useState(() => draftOf(edit, sess));
    const set = (patch) => setD((x) => ({...x, ...patch}));
    const setC = (patch) => setD((x) => ({...x, cadence: {...x.cadence, ...patch}}));
    const origin = sess || (edit && edit.target.type === 'session' ? app.sessionById(edit.target.id) : null);
    const dirId = origin ? window.BC_AGENT_PROJECTS.dirOf(origin, app.projects) : edit && edit.target.dir;
    const dir = dirId ? app.dirById(dirId) : null;
    const pick = (type) => {
      const c = type === 'hourly' ? {type, minute: 0} : type === 'weekly' ? {type, days: [1], time: d.cadence.time || '09:00'}
        : type === 'cron' ? {type, expr: SC.toCron(d.cadence)} : {type, time: d.cadence.time || '09:00'};
      set({cadence: c});
    };
    const data = {prompt: d.prompt, cadence: d.cadence, maxRuns: d.limit ? d.maxRuns : null};
    const error = SC.validate(data);
    const next = !SC.validate({...data, prompt: 'x'}) ? SC.nextRun(d.cadence, new Date()) : null;
    const mode = d.target.type === 'session' ? (origin && origin.mode) : (edit ? edit.mode : sess && sess.mode);
    const hint = SC.accessHint(AG.normalizeMode(mode), D.agent.modes);
    const save = () => {
      const fields = {name: d.name.trim() || d.prompt.trim().slice(0, 24), prompt: d.prompt.trim(), cadence: d.cadence, target: d.target,
        maxRuns: d.limit ? d.maxRuns : null, ...(d.target.type === 'new' ? {mode: AG.normalizeMode(mode)} : {})};
      if (edit) { app.patchSchedule(edit.id, fields); onClose(); app.toast('已保存定时任务', 'positive'); return; }
      const id = app.createSchedule(fields);
      onClose();
      app.toast(`已建立「${fields.name}」· ${SC.describe(d.cadence)}`, 'positive', {label: '查看', run: () => app.go({r: 'schedule', id})});
      if (d.runNow) setTimeout(() => app.runSchedule(id), 0);
    };
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">{edit ? '编辑定时任务' : '定时运行'}</R.Heading>
          <R.Content>
            <div className="asch-form">
              <R.TextField label="名称" value={d.name} onChange={(v) => set({name: v})} />
              <R.TextArea label="每次发的话" value={d.prompt} onChange={(v) => set({prompt: v})} isRequired
                description="到点时原样发给 Agent，和你在输入框里发一样" />
              <div className="asch-field">
                <span className="asch-label">频率</span>
                <R.SegmentedControl aria-label="频率" selectedKey={d.cadence.type} onSelectionChange={(k) => pick(String(k))}>
                  {CADENCES.map((c) => <R.SegmentedControlItem key={c.k} id={c.k}>{c.label}</R.SegmentedControlItem>)}
                </R.SegmentedControl>
                <div className="asch-cadence">
                  {d.cadence.type === 'hourly' ? <R.NumberField label="第几分" minValue={0} maxValue={59} value={d.cadence.minute} onChange={(v) => setC({minute: v || 0})} /> : null}
                  {d.cadence.type === 'weekly' ? <R.ToggleButtonGroup aria-label="星期几" selectionMode="multiple" size="S"
                    selectedKeys={(d.cadence.days || []).map(String)} onSelectionChange={(keys) => setC({days: [...keys].map(Number)})}>
                    {WEEK_ORDER.map((n) => <R.ToggleButton key={n} id={String(n)}>{`周${SC.WEEKDAYS[n]}`}</R.ToggleButton>)}
                  </R.ToggleButtonGroup> : null}
                  {d.cadence.type === 'daily' || d.cadence.type === 'weekly'
                    ? <R.TextField label="时刻" value={d.cadence.time} onChange={(v) => setC({time: v})} UNSAFE_className="asch-time" /> : null}
                  {d.cadence.type === 'cron' ? <R.TextField label="cron 表达式" value={d.cadence.expr} onChange={(v) => setC({expr: v})}
                    description="五段：分 时 日 月 周，按本机时区" UNSAFE_className="asch-cron" /> : null}
                </div>
                <p className="t-detail">{next ? `${SC.describe(d.cadence)} · 下一次：${SC.whenLabel(next, new Date())}` : error && error !== '写一段每次要发的话' ? error : '没有下一次'}</p>
              </div>
              <R.RadioGroup label="发给" value={d.target.type} onChange={(v) => set({target: v === 'new' ? {type: 'new', dir: dirId} : {type: 'session', id: origin.id}})}>
                <R.Radio value="session" isDisabled={!origin}>{origin ? `这条会话「${origin.title || '新会话'}」` : '原来那条会话'}</R.Radio>
                <R.Radio value="new" isDisabled={!dir}>{dir ? `每次在项目「${dir.name}」里新开一条会话` : '每次新开一条会话（这条会话不在项目里）'}</R.Radio>
              </R.RadioGroup>
              <div className="asch-limit">
                <R.Checkbox isSelected={d.limit} onChange={(v) => set({limit: v})}>跑满次数就停</R.Checkbox>
                {d.limit ? <R.NumberField aria-label="最多运行次数" minValue={1} value={d.maxRuns} onChange={(v) => set({maxRuns: v})} UNSAFE_className="asch-max" /> : null}
              </div>
              <p className="asch-note t-detail">BaoCut 开着才会跑；没开着时错过的不补跑，运行记录里记一条「错过」。上一次还没跑完时这次跳过；会话正忙时等它空下来。</p>
              {hint ? <p className="asch-hint"><R.Icons.InfoCircle />{hint}</p> : null}
              {!edit ? <R.Checkbox isSelected={d.runNow} onChange={(v) => set({runNow: v})}>建好后立即运行一次</R.Checkbox> : null}
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" isDisabled={!!error} onPress={save}>{edit ? '保存' : '建立'}</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /* ---------- 详情页 ---------- */
  function ScheduleDetailPage({id}) {
    const app = useApp();
    const R = window.RSP;
    const [editing, setEditing] = useState(false);
    const s = app.schedules.find((x) => x.id === id);
    if (!s) return <Page title="定时任务不存在"><Empty title="这个定时任务已经删掉了" /></Page>;
    const now = new Date();
    const st = SC.statusOf(s, now);
    const target = s.target.type === 'session' ? app.sessionById(s.target.id) : null;
    const dir = s.target.type === 'new' ? app.dirById(s.target.dir) : null;
    const mode = AG.normalizeMode(target ? target.mode : s.mode);
    const hint = SC.accessHint(mode, D.agent.modes);
    const counted = SC.countedRuns(s);
    const run = () => {
      const f = app.runSchedule(s.id);
      if (!f) return;
      app.toast(f.k === 'run' ? '已开始运行' : f.k === 'queue' ? '会话正忙，等它空下来再发' : f.k === 'skip' ? '上一次还在跑，这次跳过'
        : f.k === 'pause' ? `已暂停：${f.reason}` : '已经跑满，标为完成', f.k === 'run' ? 'positive' : undefined);
    };
    const remove = () => app.confirm({title: `删除「${s.name}」？`, body: '只删定时任务本身；它跑过的会话与运行结果都留着。', tone: 'negative', confirmLabel: '删除',
      run: () => { app.deleteSchedule(s.id); app.go({r: 'tasks'}); }});
    const toggle = () => app.patchSchedule(s.id, s.status === 'active' ? {status: 'paused', pauseReason: null} : {status: 'active', pauseReason: null});
    const canResume = s.status !== 'active' && !(target && target.archived) && !(s.target.type === 'session' && !target)
      && !(s.maxRuns && counted >= s.maxRuns);
    return <Page>
      <Btn variant="quiet" size="s" icon="back" onClick={() => app.go({r: 'tasks'})} style={{marginBottom: 12}}>后台任务</Btn>
      <div className="asch-head">
        <div className="asch-head__t">
          <div className="t-heading">{s.name}</div>
          <R.StatusLight variant={st.tone} size="S">{st.label}</R.StatusLight>
        </div>
        <div className="asch-head__acts">
          <R.Button variant="secondary" size="S" isDisabled={s.status !== 'active'} onPress={run}><R.Icons.Play /><R.Text>立即运行一次</R.Text></R.Button>
          {s.status === 'active' ? <R.Button variant="secondary" size="S" onPress={toggle}><R.Icons.Pause /><R.Text>暂停</R.Text></R.Button>
            : <R.Button variant="secondary" size="S" isDisabled={!canResume} onPress={toggle}><R.Icons.Play /><R.Text>继续</R.Text></R.Button>}
          <R.ActionMenu aria-label="定时任务的操作" isQuiet onAction={(k) => { if (k === 'edit') setEditing(true); else if (k === 'delete') remove(); }}>
            <R.MenuItem id="edit" textValue="编辑"><R.Icons.Edit /><R.Text>编辑…</R.Text></R.MenuItem>
            <R.MenuItem id="delete" textValue="删除"><R.Icons.Delete /><R.Text>删除…</R.Text></R.MenuItem>
          </R.ActionMenu>
        </div>
      </div>
      {s.status === 'paused' && s.pauseReason && !canResume ? <p className="t-detail asch-why">
        {s.pauseReason === '目标会话已归档' ? '把那条会话从「已归档会话」里恢复，或编辑定时任务换成每次新开一条，才能继续。' : '编辑定时任务换一个目标，才能继续。'}</p> : null}

      <dl className="asch-props">
        <dt>频率</dt><dd>{SC.describe(s.cadence)}<span className="t-detail"> · 按本机时区</span></dd>
        <dt>发给</dt><dd>{target ? <R.Link variant="secondary" onPress={() => app.go({r: 'agent', id: target.id})}>{target.title || '新会话'}</R.Link>
          : s.target.type === 'session' ? '（会话已删除）' : `每次在项目「${dir ? dir.name : '已移除的项目'}」里新开一条会话`}</dd>
        <dt>次数</dt><dd>{s.maxRuns ? `最多 ${s.maxRuns} 次 · 已跑 ${counted} 次` : `不限 · 已跑 ${counted} 次`}</dd>
        <dt>每次发的话</dt><dd className="asch-prompt">{s.prompt}</dd>
      </dl>
      {hint ? <p className="asch-hint"><R.Icons.InfoCircle />{hint}</p> : null}

      <h3 className="asch-sub">运行记录</h3>
      {s.runs.length ? <ul className="asch-runs" aria-label="运行记录">
        {s.runs.map((r, i) => {
          const tone = (SC.RUN_STATUS[r.status] || {}).tone || 'neutral';
          const sess = r.sessionId ? app.sessionById(r.sessionId) : null;
          return <li key={i} className="asch-run">
            <span className="asch-run__at">{SC.whenLabel(new Date(runAt(r)), now).replace(/^(\d+) 月 (\d+) 日/, '$1/$2')}</span>
            <R.StatusLight variant={tone} size="S">{SC.runLabel(r)}</R.StatusLight>
            {r.took ? <span className="t-detail">{tookLabel(r.took)}</span> : null}
            <span className="grow" />
            {sess ? <R.Link variant="secondary" UNSAFE_className="asch-run__sess" onPress={() => app.go({r: 'agent', id: sess.id})}>{sess.title || '打开会话'}</R.Link> : null}
          </li>;
        })}
      </ul> : <p className="t-detail">还没跑过。{s.status === 'active' ? `下一次在${SC.whenLabel(SC.nextRun(s.cadence, now), now)}。` : ''}</p>}
      {editing ? <ScheduleDialog edit={s} onClose={() => setEditing(false)} /> : null}
    </Page>;
  }

  /** 用了多久：秒数写成「用时 41 秒」「用时 3 分 32 秒」。 */
  function tookLabel(secs) {
    return secs < 60 ? `用时 ${secs} 秒` : `用时 ${Math.floor(secs / 60)} 分${secs % 60 ? ` ${secs % 60} 秒` : ''}`;
  }

  /** 后台任务侧栏的「定时」一段：一行一个，尾巴是状态点。`row` 是侧栏自己的行画法。 */
  function scheduleRows(app, row) {
    return app.schedules.map((s) => {
      const st = SC.statusOf(s, new Date());
      const icon = s.status === 'paused' ? 'Pause' : s.status === 'completed' ? 'CheckmarkCircle' : 'ClockPending';
      return row(s.id, s.name, {r: 'schedule', id: s.id}, icon, null, `${s.name} · ${SC.describe(s.cadence)} · ${st.label}`);
    });
  }

  Object.assign(window, {useAgentSchedules, ScheduleDialog, ScheduleDetailPage, scheduleRows});
})();
