/* 剪成短视频（§15.12）跨屏状态：每个来源项目一份会话（设置 → 找片段 → 挑片段 → 创建 → 完成）。
   计时器住在这里：面板卸载（切 Tab、去后台任务页、换项目）不打断进度；任务记录（app.tasks）是
   顶栏胶囊 / 后台任务页的唯一真相，会话只多记「参数与候选」这一层。
   两条路（直接调模型 / 交给 Agent）都停在「挑片段」：Agent 那条路的进度从会话消息倒推，
   收据一到就把候选摆出来，任务记录改成「等你挑」。创建项目由这里做，不回会话里再问。 */
(function () {
  const {useState, useRef, useCallback, useEffect} = React;
  const SC = window.BC_SHORTS_CUT;
  const AG = window.BC_AGENT;
  const FIND_MS = 6500, CREATE_MS = 5200, TICK = 120;

  const findActivity = (pct, n) => (pct < 34 ? `读 ${n} 句文稿与章节` : pct < 72 ? '按话题找能单独成立的片段' : '把起止吸附到句子边界');
  const createActivity = (pct, segs, focus) => {
    const i = Math.min(segs.length - 1, Math.floor(pct / 100 * segs.length));
    const st = SC.CREATE_STAGES[SC.stageAt(SC.CREATE_STAGES, (pct / 100 * segs.length - i) * 100)];
    return `第 ${i + 1} / ${segs.length} 支 · ${st}${st === '取景' ? ` · ${SC.focusOf(focus).name}` : ''} · ${segs[i].title}`;
  };

  function useShortsCutStore({addTask, patchTask, tasks, sessions: chats, stopAgent, projects, setProjects, go, toast}) {
    const [sessions, setSessions] = useState({});
    const timers = useRef({});
    const seq = useRef(0);
    const live = useRef(sessions); live.current = sessions;
    const projRef = useRef(projects); projRef.current = projects;

    const patch = useCallback((proj, p) => setSessions((all) => {
      const cur = all[proj] || {};
      return {...all, [proj]: {...cur, ...(typeof p === 'function' ? p(cur) : p)}};
    }), []);
    const stop = (proj) => { clearInterval(timers.current[proj]); delete timers.current[proj]; };
    const kids = (proj) => SC.childrenOf(projRef.current, proj);

    /* 打开工具：有会话就回到会话原地；没有就按这个项目的现状起一份设置。 */
    const open = useCallback((proj, info) => {
      const cur = live.current[proj];
      if (cur) { patch(proj, {open: true}); return {ok: true, resumed: true}; }
      const o = info || {};
      const ctx = {hasTrans: !!o.hasTrans, portrait: !!o.portrait, children: kids(proj).length};
      const params = SC.normalize({}, ctx);
      setSessions((all) => ({...all, [proj]: {proj, open: true, phase: 'setup', params, facts: ctx, scope: null,
        list: [], sel: null, expand: null, t: 0, taskId: null, sid: null, via: null, pct: 0, made: [], preselected: true}}));
      return {ok: true};
    }, [patch]);
    const close = useCallback((proj) => patch(proj, {open: false}), [patch]);
    const setParams = useCallback((proj, p) => patch(proj, (s) => ({params: SC.normalize({...s.params, ...p}, s.facts)})), [patch]);
    const set = useCallback((proj, p) => patch(proj, p), [patch]);

    /* 找完：候选进会话，任务停在「等你挑」。 */
    const land = useCallback((proj, taskId) => {
      const s = live.current[proj];
      if (!s) return;
      const list = SC.demoCandidates(s.sentences, s.params, {scope: s.scope, children: kids(proj)});
      const first = SC.chosen(list)[0] || list[0] || null;
      patch(proj, {phase: 'review', list, preselected: true, sel: first ? first.id : null, expand: null,
        t: first ? first.start : 0, pct: 100, taskId});
      if (taskId) patchTask(taskId, {kind: 'shorts-cut', flow: 'shorts-cut', status: 'queued', outcome: null, stage: 'review', pct: 100, phase: null,
        activity: null, undoable: false, cancellable: true, sub: `找到 ${list.length} 段 · 等你挑`});
    }, [patch, patchTask]);

    /* 直接调模型：一条后台任务，结束时不创建项目。 */
    const find = useCallback((proj, o) => {
      const s = live.current[proj];
      if (!s) return;
      const title = SC.taskTitle(o.title);
      const id = addTask({kind: 'shorts-cut', flow: 'shorts-cut', project: proj, title, stage: 'find', pct: 0,
        sub: `${o.runner} · ${SC.summaryLine(s.params)}${o.scope ? ' · 范围 ' + o.scope.label : ''}`,
        phase: SC.FIND_STAGES[0], cancellable: true, undoable: false});
      patch(proj, {phase: 'finding', via: 'api', sid: null, taskId: id, pct: 0, sentences: o.sentences, scope: o.scope || null, runner: o.runner});
      stop(proj);
      let p = 0;
      const step = 100 / (FIND_MS / TICK);
      timers.current[proj] = setInterval(() => {
        p = Math.min(100, p + step * (0.7 + Math.abs(Math.sin(p / 9)) * 0.6));
        const pct = Math.round(p);
        if (p < 100) {
          patch(proj, {pct});
          patchTask(id, {pct, phase: SC.FIND_STAGES[SC.stageAt(SC.FIND_STAGES, pct)], activity: findActivity(pct, o.sentences.length)});
          return;
        }
        stop(proj);
        land(proj, id);
      }, TICK);
    }, [addTask, patchTask, patch, land]);

    /* 交给 Agent：会话已经发出去了，这里只记下是哪一条，进度从会话消息倒推。 */
    const findViaAgent = useCallback((proj, o) => {
      patch(proj, {phase: 'finding', via: 'agent', sid: o.sid, taskId: null, pct: 0, sentences: o.sentences, scope: o.scope || null, runner: o.runner});
    }, [patch]);
    useEffect(() => {
      Object.keys(sessions).forEach((proj) => {
        const s = sessions[proj];
        if (s.phase !== 'finding' || s.via !== 'agent') return;
        const chat = (chats || []).find((x) => x.id === s.sid);
        if (!chat) return;
        const task = chat.taskId ? tasks.find((t) => t.id === chat.taskId) : null;
        if (AG.sessionProgress(chat, task).done) land(proj, chat.taskId || null);
      });
    }, [sessions, chats, tasks, land]);

    /* 任务从顶栏胶囊或后台任务页被取消：计时器停下，会话退回上一步；候选已经摆出来的留着。 */
    useEffect(() => {
      Object.keys(sessions).forEach((proj) => {
        const s = sessions[proj];
        if (!s.taskId || s.phase === 'setup' || s.phase === 'done') return;
        const task = tasks.find((t) => t.id === s.taskId);
        if (!task || !task.canceled) return;
        stop(proj);
        if (s.phase === 'review') patchTask(s.taskId, {sub: `找到 ${s.list.length} 段 · 候选留在「剪成短视频」面板`});
        patch(proj, {phase: s.phase === 'finding' ? 'setup' : 'review', taskId: null, sid: null, pct: 0, playing: false});
      });
    }, [sessions, tasks, patch, patchTask]);

    /* 取消：找片段中回设置（设置都在），创建中回挑片段（候选都在）。 */
    const cancel = useCallback((proj) => {
      const s = live.current[proj];
      if (!s) return;
      stop(proj);
      const chat = s.via === 'agent' && s.phase === 'finding' ? (chats || []).find((x) => x.id === s.sid) : null;
      const tid = s.taskId || (chat && chat.taskId);
      if (tid) patchTask(tid, {status: 'error', outcome: 'canceled', phase: null, activity: null, error: '已取消', canceled: true});
      /* 会话那头也停下：不然它还挂着「等你允许」，放行了也没有地方接候选 */
      if (chat && stopAgent) stopAgent(chat.id);
      patch(proj, {phase: s.phase === 'creating' ? 'review' : 'setup', taskId: null, sid: null, pct: 0});
      if (toast) toast(s.phase === 'creating' ? '已取消创建 · 候选保留' : '已取消找片段 · 设置保留', 'notice');
    }, [patchTask, patch, toast, chats, stopAgent]);

    /* ---- 挑片段：勾选、改标题、调起止、移走、放回 ---- */
    const edit = useCallback((proj, id, fn) => patch(proj, (s) => {
      const before = s.list.find((c) => c.id === id); if (!before) return {};
      const after = {...before, ...(typeof fn === 'function' ? fn(before) : fn)};
      return {preselected: false, list: s.list.map((c) => c.id === id ? after : c),
        ...(s.reviewGesture ? {} : SC.reviewRecord(s, before, after))};
    }), [patch]);
    const beginEdit = useCallback((proj, id) => patch(proj, s => ({reviewGesture: {id, before: s.list.find(c => c.id === id)}, playing: false})), [patch]);
    const endEdit = useCallback((proj) => patch(proj, s => {
      const g=s.reviewGesture, after=g && s.list.find(c=>c.id===g.id);
      return {reviewGesture:null, ...(g && g.before && after ? SC.reviewRecord(s,g.before,after) : {})};
    }), [patch]);
    const undoRange = useCallback((proj, redo=false) => patch(proj, s => {
      const g=s.reviewGesture;
      if (g) return {reviewGesture:null, list:s.list.map(c=>c.id===g.id ? g.before : c), playing:false};
      return SC.reviewStep(s,redo);
    }), [patch]);
    const setBound = useCallback((proj,id,edge,raw,duration) => {
      const time=window.BC_TIME.parse(raw);
      const s=live.current[proj], c=s && s.list.find(c=>c.id===id);
      const next=c && time!=null && SC.setReviewEdge(s.sentences,c,edge,time,duration);
      if (!next) { toast('请输入原片范围内的有效时间，起点必须早于终点'); return; }
      edit(proj,id,next); patch(proj,{t:edge==='start'?next.start:Math.max(next.start,next.end-3),playing:false});
    }, [edit,patch,toast]);
    const select = useCallback((proj, id, opts) => patch(proj, (s) => {
      const c = s.list.find((x) => x.id === id);
      if (!c) return {};
      const p = {sel: id};
      if (!(opts && opts.keepT) || s.t < c.start || s.t > c.end) p.t = c.start;
      return p;
    }), [patch]);
    const seek = useCallback((proj, t) => patch(proj, {t: Math.max(0, t)}), [patch]);
    const nudge = useCallback((proj, id, edge, dir) => patch(proj, (s) => {
      const c = s.list.find((x) => x.id === id);
      if (!c) return {};
      const n = SC.nudge(s.sentences, c, edge, dir);
      return {preselected: false, list: s.list.map((x) => (x.id === id ? n : x)), sel: id, t: edge === 'start' ? n.start : Math.max(n.start, n.end - 3), ...SC.reviewRecord(s,c,n)};
    }), [patch]);
    const drag = useCallback((proj, id, edge, t) => patch(proj, (s) => ({
      preselected: false, list: s.list.map((x) => (x.id === id ? SC.dragEdge(s.sentences, x, edge, t) : x)),
    })), [patch]);
    const more = useCallback((proj, note) => {
      const s = live.current[proj];
      if (!s) return 0;
      const add = SC.demoMore(s.sentences, {...s.params, note: note || s.params.note}, s.list, {scope: s.scope, children: kids(proj)});
      if (add.length) patch(proj, (cur) => ({list: cur.list.concat(add), sel: add[0].id, t: add[0].start}));
      return add.length;
    }, [patch]);
    const addManual = useCallback((proj, o) => {
      const s = live.current[proj];
      if (!s) return null;
      const c = SC.manualCandidate(s.sentences, {...o, params: s.params, id: 'sc-m' + (++seq.current)});
      patch(proj, (cur) => ({preselected: false, list: cur.list.concat([c]), sel: c.id, expand: c.id, t: c.start}));
      return c;
    }, [patch]);
    /* 「重新设置」：回设置页，候选丢弃（用户确认过）。任务记录留在任务页，写成已取消。 */
    const restart = useCallback((proj) => {
      const s = live.current[proj];
      if (s && s.taskId && s.phase === 'review') patchTask(s.taskId, {status: 'error', outcome: 'canceled', phase: null, activity: null, error: '已重新设置', canceled: true,
        sub: '已重新设置 · 这一批候选没有保留'});
      patch(proj, (cur) => ({phase: 'setup', list: [], undoHistory: [], redoHistory: [], reviewGesture: null, sel: null, expand: null, taskId: null, sid: null, via: null, made: [],
        params: SC.normalize(cur.params, {...cur.facts, children: kids(proj).length}), facts: {...cur.facts, children: kids(proj).length}}));
    }, [patch, patchTask]);

    /* ---- 创建：同一条任务记录接着跑，逐支建项目 ---- */
    const create = useCallback((proj, o) => {
      const s = live.current[proj];
      const parent = projRef.current.find((p) => p.id === proj);
      if (!s || !parent) return;
      const segs = SC.chosen(s.list);
      if (!segs.length) return;
      const total = SC.totalSec(s.list);
      const spec = {status: 'running', stage: 'create', pct: 0, phase: SC.CREATE_STAGES[0], activity: null, cancellable: true,
        sub: `${SC.countLabel(segs.length)} · 合计 ${SC.mmss(total)} · ${SC.focusOf(s.params.focus).name}`};
      let id = s.taskId;
      if (id && tasks.find((t) => t.id === id && !t.canceled)) patchTask(id, spec);
      else id = addTask({kind: 'shorts-cut', flow: 'shorts-cut', project: proj, title: SC.taskTitle(parent.title), undoable: false, ...spec});
      patch(proj, {phase: 'creating', taskId: id, pct: 0, making: segs.length});
      stop(proj);
      let p = 0;
      const ms = CREATE_MS + (s.params.focus === 'speaker' ? 900 : 0) * segs.length;
      const step = 100 / (ms / TICK);
      timers.current[proj] = setInterval(() => {
        p = Math.min(100, p + step * (0.75 + Math.abs(Math.cos(p / 7)) * 0.5));
        const pct = Math.round(p);
        if (p < 100) {
          patch(proj, {pct});
          const i = Math.min(segs.length - 1, Math.floor(p / 100 * segs.length));
          patchTask(id, {pct, phase: SC.CREATE_STAGES[SC.stageAt(SC.CREATE_STAGES, (p / 100 * segs.length - i) * 100)],
            activity: createActivity(p, segs, s.params.focus)});
          return;
        }
        stop(proj);
        const taken = projRef.current.map((x) => x.title);
        const made = segs.map((seg) => {
          const title = SC.childTitle(seg.title, taken);
          taken.push(title);
          return SC.childProject({id: 'sc' + (++seq.current), parent, seg, title, params: s.params, speakers: (o && o.speakers) || 1});
        });
        setProjects((ps) => made.concat(ps));
        patch(proj, (cur) => ({phase: 'done', pct: 100, made: made.map((m) => m.id), madeTotal: total,
          list: cur.list.map((c) => (segs.some((x) => x.id === c.id) ? {...c, on: false, made: true} : c))}));
        patchTask(id, {status: 'done', outcome: 'done', stage: 'done', pct: 100, phase: null, activity: null,
          sub: `已创建 ${SC.countLabel(made.length)} · 合计 ${SC.mmss(total)}`,
          artifacts: made.map((m) => ({name: m.title, note: `${SC.mmss(m.origin.in)} – ${SC.mmss(m.origin.out)} · ${SC.secs(m.duration)}`, project: m.id})),
          elapsedMs: Math.round(total * 0.4 + 6) * 1000});
        if (toast) toast(`已创建 ${SC.countLabel(made.length)} · 在 Space 里`, 'positive');
      }, TICK);
    }, [addTask, patchTask, patch, tasks, setProjects, toast]);

    /* 视频 Tab「切出的短视频」里的「调整后再生成」：不找片段，把那一支的起止当一条候选摆进挑片段页。
       正在找 / 正在创建时不打断，只把工具页摆到前面；手里还有没创建的候选就接在后面
       （别的都没勾时设置跟这一支走，有勾上的就不动）；否则单起一页，取景与字幕沿用那一支创建时的选择。
       创建的是新项目，那一支不动。 */
    const redo = useCallback((proj, child, info) => {
      const cur = live.current[proj];
      const o = info || {};
      const plan = SC.redoPlan(cur);
      if (plan === 'busy') { patch(proj, {open: true}); return {ok: false, busy: cur.phase}; }
      const sentences = plan === 'append' ? cur.sentences : o.sentences;
      const c = SC.redoCandidate(sentences, child, projRef.current.map((x) => x.title));
      if (!c) return {ok: false};
      if (plan === 'append') {
        const next = SC.redoAppend(cur, child, c);
        patch(proj, (s) => ({open: true, phase: 'review', preselected: false, taskId: s.phase === 'done' ? null : s.taskId,
          list: next.list, params: next.params, sel: c.id, expand: c.id, t: c.start, playing: false}));
        return {ok: true, plan, kept: next.kept};
      }
      const facts = {hasTrans: !!o.hasTrans, portrait: !!o.portrait, children: kids(proj).length};
      const params = SC.redoParams(child, cur ? cur.params : {}, facts);
      setSessions((all) => ({...all, [proj]: {proj, open: true, phase: 'review', params, facts, scope: null, sentences,
        list: [c], sel: c.id, expand: c.id, t: c.start, taskId: null, sid: null, via: null, pct: 0, made: [], preselected: false}}));
      return {ok: true, plan};
    }, [patch]);

    /* 完成页「再切几支」：回挑片段，上次没勾的候选还在，刚创建的会标「已切过」。 */
    const again = useCallback((proj) => patch(proj, (s) => {
      const first = SC.visible(s.list)[0];
      return {phase: 'review', taskId: null, preselected: false, sel: first ? first.id : null, t: first ? first.start : 0, expand: null};
    }), [patch]);

    /* 从任务页 / 顶栏胶囊回来：打开来源项目并把工具摆到前面。 */
    const resume = useCallback((task) => {
      if (!task || !task.project) return;
      if (live.current[task.project]) patch(task.project, {open: true});
      go({r: 'editor', id: task.project});
    }, [patch, go]);

    return {sessions, open, close, set, setParams, find, findViaAgent, cancel, edit, select, seek, nudge, drag, more, addManual,
      restart, create, again, resume, redo, beginEdit, endEdit, undoRange, setBound};
  }
  Object.assign(window, {useShortsCutStore});
})();
