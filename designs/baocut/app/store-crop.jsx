/* 智能裁剪（§15.9）跨屏状态：每个项目一份会话（设置 → 分析 → 检查构图 → 生成 → 完成）
   与产物列表。计时器住在这里：面板卸载（切 Tab、去后台任务页、换项目）不打断进度；
   任务记录（app.tasks）是顶栏胶囊 / 后台任务页的唯一真相，会话只多记「构图」这层。 */
(function () {
  const {useState, useRef, useCallback} = React;
  const C = window.BC_CROP;
  const ANALYZE_MS = 7500, RENDER_MS = 6500, TICK = 120;

  /* 进检查页时把播放头放在用户刚才看的那一刻（编辑器播放头换算到原片），不在范围内就从头开始。 */
  const clampT = (range, at, fallback) => (typeof at === 'number' && at >= range.start && at <= range.end) ? at : fallback;

  function snapshot(src) {
    if (!src) return null;
    const {id, name, dur, grad, url, poster, meta, naturalW, naturalH} = src;
    return {id, name, dur, grad, url, poster, meta, naturalW, naturalH};
  }
  /* 默认画幅：项目画幅和原片不同就裁成项目画幅（最常见的动机），否则横片给竖屏、竖片给横屏。 */
  function defaultRatio(srcRatio, projectRatio) {
    if (projectRatio > 0 && Math.abs(projectRatio - srcRatio) > 0.0005) return C.ratioId(projectRatio);
    return srcRatio >= 1 ? '9:16' : '16:9';
  }

  function useCropStore({addTask, patchTask, tasks, go, toast}) {
    const [sessions, setSessions] = useState({});
    const [outputs, setOutputs] = useState({});
    const timers = useRef({});
    const seq = useRef(0);
    const live = useRef(sessions); live.current = sessions;

    const patch = useCallback((proj, p) => setSessions((all) => {
      const cur = all[proj] || {};
      return {...all, [proj]: {...cur, ...(typeof p === 'function' ? p(cur) : p)}};
    }), []);
    const stop = (proj) => { clearInterval(timers.current[proj]); delete timers.current[proj]; };

    /* 打开工具。带 source 是从素材 / 片段进来的；不带就是从 AI 工具列表进来的，
       有会话就回到会话原地，没有就用 sources[0] 起一份新设置。 */
    const open = useCallback((proj, opts) => {
      const o = opts || {};
      const cur = live.current[proj];
      if (o.output) {
        /* 从产物「再调整构图」进来：用产物里的构图开一份检查会话，生成时另存新版本。 */
        const crop = o.output.crop;
        const source = snapshot((o.sources || []).find((s) => s.id === crop.sourceId)) || {id: crop.sourceId, name: crop.sourceName, url: crop.sourceUrl, dur: crop.range.end};
        if (cur && (cur.phase === 'analyzing' || cur.phase === 'rendering')) return {ok: false, error: '这部视频里还有一份裁剪在处理，等它完成或取消后再调整'};
        setSessions((all) => ({...all, [proj]: {
          proj, open: true, phase: 'review', source, range: {...crop.range}, ratio: crop.ratioId, custom: null,
          scene: crop.scene, multi: crop.multi, motion: crop.motion, zoom: crop.zoom, fill: crop.fill,
          plan: crop.plan, t: clampT(crop.range, o.at, crop.range.start), taskId: cur ? cur.taskId : null, editing: o.output.id, version: crop.version,
          output: null, dirty: false, took: 0,
        }}));
        return {ok: true};
      }
      const src = snapshot(o.source);
      if (cur) {
        const busy = cur.phase === 'analyzing' || cur.phase === 'rendering';
        const same = !src || (cur.source && cur.source.id === src.id);
        if (busy && !same) return {ok: false, error: `正在裁 ${cur.source.name}，等它完成或取消后再裁这一段`};
        if ((same || busy) && !(o.planned && cur.phase === 'setup')) {
          const p = {open: true};
          if (src && o.range && cur.phase === 'setup') p.range = o.range;
          patch(proj, p);
          return {ok: true, resumed: true};
        }
      }
      const source = src || snapshot((o.sources || []).find((s) => !s.crop)) || null;
      if (!source) return {ok: false, error: '视频里还没有视频，先导入一段'};
      const srcRatio = C.sourceRatio(source);
      /* `planned`：构图方案已经由 Agent 在会话里排好了，直接落在「检查构图」。 */
      const whole = o.range || {start: 0, end: source.dur || 0};
      const planned = o.planned ? {phase: 'review', t: clampT(whole, o.at, whole.start), pct: 100,
        plan: C.demoPlan({scene: C.DEFAULTS.scene, multi: C.DEFAULTS.multi, motion: C.DEFAULTS.motion, start: whole.start, end: whole.end})} : null;
      setSessions((all) => ({...all, [proj]: {
        proj, open: true, phase: 'setup', source,
        range: o.range || {start: 0, end: source.dur || 0}, wholeRange: {start: 0, end: source.dur || 0},
        ratio: o.ratio || defaultRatio(srcRatio, o.projectRatio), custom: null,
        scene: C.DEFAULTS.scene, multi: C.DEFAULTS.multi, motion: C.DEFAULTS.motion, zoom: C.DEFAULTS.zoom, fill: C.DEFAULTS.fill,
        plan: null, t: 0, at: o.at, taskId: null, output: null, editing: null, version: 1, dirty: false, took: 0,
        ...planned,
      }}));
      return {ok: true};
    }, [patch]);

    const close = useCallback((proj) => patch(proj, {open: false}), [patch]);
    const set = useCallback((proj, p) => patch(proj, p), [patch]);
    const seek = useCallback((proj, t) => patch(proj, (s) => ({t: Math.max(s.range.start, Math.min(s.range.end, t))})), [patch]);

    const ratioValue = (s) => s.ratio === 'custom' ? (s.custom ? s.custom.w / s.custom.h : NaN) : C.parseRatio(s.ratio);
    const ratioIdOf = (s) => s.ratio === 'custom' ? C.ratioId(ratioValue(s)) : s.ratio;

    /* 分析：一次后台任务。结束时不生成视频，停在「检查构图」等用户。 */
    const analyze = useCallback((proj, info) => {
      const s = live.current[proj];
      if (!s || !(ratioValue(s) > 0)) return;
      const sceneName = (C.SCENES.find((x) => x.id === s.scene) || C.SCENES[0]).name;
      const id = addTask({
        kind: 'crop', flow: 'crop', project: proj, title: C.taskTitle(s.source.name, ratioIdOf(s)),
        sub: `${sceneName} · 本机模型 · ${C.mmss(s.range.end - s.range.start)}`, phase: C.ANALYSIS_STAGES[0], cancellable: true,
        pct: 0, stage: 'analyze', runsOn: '本机', undoable: false,
        crop: {ratio: ratioIdOf(s), scene: sceneName, source: s.source.name, range: s.range},
      });
      patch(proj, {phase: 'analyzing', taskId: id, pct: 0, error: null});
      stop(proj);
      let p = 0;
      const dur = s.range.end - s.range.start;
      const step = 100 / (ANALYZE_MS / TICK);
      timers.current[proj] = setInterval(() => {
        p = Math.min(100, p + step * (0.7 + Math.abs(Math.sin(p / 9)) * 0.6));
        const pct = Math.round(p);
        if (p < 100) {
          patch(proj, {pct});
          patchTask(id, {pct, phase: C.stageAt(C.ANALYSIS_STAGES, pct).name,
            activity: C.analysisActivity(pct, {dur, subjects: pct >= 34 ? C.subjectsText(C.demoPlan({scene: s.scene, multi: s.multi, start: 0, end: 10})) : '', shots: 11})});
          return;
        }
        stop(proj);
        const plan = C.demoPlan({scene: s.scene, multi: s.multi, motion: s.motion, start: s.range.start, end: s.range.end, names: info && info.names});
        patch(proj, {phase: 'review', plan, t: clampT(s.range, s.at, s.range.start), pct: 100, dirty: false});
        patchTask(id, {status: 'queued', stage: 'review', pct: 100, phase: null, activity: null,
          sub: `${C.summaryText(plan, dur)} · 等你检查构图`});
      }, TICK);
    }, [addTask, patchTask, patch]);

    /* 生成：同一条任务记录接着跑；完成后产物进 Video，会话留在「完成」页。 */
    const render = useCallback((proj) => {
      const s = live.current[proj];
      if (!s || !s.plan) return;
      const dur = s.range.end - s.range.start;
      const dims = C.dimensions(ratioValue(s));
      const version = s.editing ? (s.version || 1) + 1 : (s.version || 1);
      let id = s.taskId;
      const spec = {status: 'running', stage: 'render', pct: 0, phase: C.RENDER_STAGES[0], activity: null, cancellable: true,
        sub: `${dims.w} × ${dims.h} · ${C.mmss(dur)}${version > 1 ? ` · 第 ${version} 版` : ''}`};
      if (id && tasks.find((t) => t.id === id && !t.canceled)) patchTask(id, spec);
      else {
        id = addTask({kind: 'crop', flow: 'crop', project: proj, title: C.taskTitle(s.source.name, ratioIdOf(s)),
          runsOn: '本机', undoable: false, crop: {ratio: ratioIdOf(s), source: s.source.name, range: s.range}, ...spec});
      }
      patch(proj, {phase: 'rendering', taskId: id, pct: 0});
      stop(proj);
      let p = 0;
      const step = 100 / (RENDER_MS / TICK);
      timers.current[proj] = setInterval(() => {
        p = Math.min(100, p + step * (0.75 + Math.abs(Math.cos(p / 7)) * 0.5));
        const pct = Math.round(p);
        if (p < 100) {
          patch(proj, {pct});
          patchTask(id, {pct, phase: C.stageAt(C.RENDER_STAGES, pct).name, activity: C.renderActivity(pct, {dur, dims})});
          return;
        }
        stop(proj);
        const took = Math.round(dur * 0.5) + 8;
        const out = C.outputRecord({id: 'crop-' + (++seq.current), source: s.source, ratio: ratioValue(s), range: s.range, plan: s.plan,
          scene: s.scene, multi: s.multi, motion: s.motion, zoom: s.zoom, fill: s.fill, version, took});
        setOutputs((all) => ({...all, [proj]: (all[proj] || []).concat([out])}));
        patch(proj, {phase: 'done', output: out.id, version, editing: null, dirty: false, pct: 100, took});
        patchTask(id, {status: 'done', stage: 'done', pct: 100, phase: null, activity: null, sub: `${out.name} · 已进素材库`,
          artifacts: [{name: out.name, note: `${dims.w} × ${dims.h} · ${C.mmss(dur)}`}], elapsedMs: took * 1000});
      }, TICK);
    }, [addTask, patchTask, patch, tasks]);

    /* 取消：分析中回到设置（设置都在），生成中回到检查（构图都在）。任务记录留在任务页。 */
    const cancel = useCallback((proj) => {
      const s = live.current[proj];
      if (!s) return;
      stop(proj);
      if (s.taskId) patchTask(s.taskId, {status: 'error', outcome: 'canceled', phase: null, activity: null, error: '已取消', canceled: true});
      patch(proj, {phase: s.phase === 'rendering' ? 'review' : 'setup', taskId: null, pct: 0});
      if (toast) toast(s.phase === 'rendering' ? '已取消生成 · 构图保留' : '已取消分析 · 设置保留', 'notice');
    }, [patchTask, patch, toast]);

    const editPlan = useCallback((proj, fn) => patch(proj, (s) => s.plan ? {plan: fn(s.plan), dirty: true} : {}), [patch]);
    /* 从完成页回到检查：构图可以接着改，生成时另存一版。 */
    const revise = useCallback((proj) => patch(proj, (s) => ({phase: 'review', editing: s.output, dirty: false})), [patch]);
    const discard = useCallback((proj) => patch(proj, (s) => {
      const out = (outputs[proj] || []).find((o) => o.id === s.editing);
      return {phase: 'done', output: s.editing, editing: null, dirty: false, plan: out ? out.crop.plan : s.plan};
    }), [patch, outputs]);
    /* 检查页「重新分析」：回设置页，构图丢弃（用户确认过）。 */
    const restart = useCallback((proj) => patch(proj, {phase: 'setup', plan: null, taskId: null, editing: null, dirty: false}), [patch]);
    const removeOutput = useCallback((proj, id) => {
      setOutputs((all) => ({...all, [proj]: (all[proj] || []).filter((o) => o.id !== id)}));
      patch(proj, (s) => s.output === id ? {output: null, phase: s.phase === 'done' ? 'setup' : s.phase} : {});
    }, [patch]);
    /* 从任务页 / 顶栏胶囊回来：打开项目并把工具摆到前面。 */
    const resume = useCallback((task) => {
      if (!task || !task.project) return;
      patch(task.project, {open: true});
      go({r: 'editor', id: task.project});
    }, [patch, go]);

    return {sessions, outputs, open, close, set, seek, analyze, render, cancel, editPlan, revise, discard, restart, removeOutput, resume,
      ratioValue, ratioIdOf};
  }
  Object.assign(window, {useCropStore});
})();
