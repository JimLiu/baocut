/* 剪成短视频（§5.10）跨屏状态：每个来源项目一份会话（设置 → 进行中 → 结果）。
   只交给 Agent、每次新开一条会话；找到就创建，没有人挑这一步。进度从那条会话的消息倒推，
   收据一到就按找到的片段直接建好子视频（引用同一份原片），会话落到结果页。
   任务记录（app.tasks）是顶栏胶囊 / 后台任务页的唯一真相，这里只多记「参数与这一轮的几支」。
   会话挂在来源视频上（`sessions[来源 id]`）；从来源视频、任何一支子视频、会话里那支视频的卡片都回到同一页结果
   （product-design §5.10）。结果页只改标题（写回那一支）、不要哪一支就移入回收站（可撤销）；
   起止不在这里调——打开那一支，在文稿里恢复或再剪，就是普通的视频编辑（§4.6）；入口是子视频横幅的「去文稿调整」
   与结果页「正在看」那张卡的「调起止」（editor.jsx openCutEntry）。 */
(function () {
  const {useState, useRef, useCallback, useEffect} = React;
  const SC = window.BC_SHORTS_CUT;
  const AG = window.BC_AGENT;

  /* 会话进度 → 这一页的阶段与百分比：放行之前在找片段，放行之后的写入就是创建视频。 */
  function progressOf(chat, task) {
    const pr = AG.sessionProgress(chat, task);
    const creating = pr.cur >= 2;
    const pct = pr.done ? 100 : creating ? 50 + Math.round((pr.pct || 0) / 2) : pr.cur === 1 ? 40 : 15;
    return {stage: creating ? 'create' : 'find', pct, waiting: pr.waiting, note: pr.note, done: pr.done};
  }
  /* 结果页的一支：找到的那一段 + 它建成的子视频 id（`id` 就是子视频 id）。 */
  const itemOf = (seg, child) => ({...seg, id: child.id, cand: seg.id, title: child.title, on: true, made: true});
  /* 结果页上能改的只有标题：写回那一支的记录（视频文件夹名不跟着改）。 */
  const childPatch = (p, it) => ({...p, title: it.title});
  const SYNC = ['title'];
  const changed = (a, b) => SYNC.some((k) => a[k] !== b[k]);
  const newId = (n) => 'sc' + Date.now().toString(36) + n;

  function useShortsCutStore({addTask, patchTask, tasks, sessions: chats, stopAgent, projects, setProjects, archiveProject, go, toast}) {
    const [sessions, setSessions] = useState({});
    const seq = useRef(0);
    const landed = useRef({});   // taskId → 已建的子视频 id：同一次运行只建一次
    const live = useRef(sessions); live.current = sessions;
    const projRef = useRef(projects); projRef.current = projects;
    const taskRef = useRef(tasks); taskRef.current = tasks;

    const patch = useCallback((proj, p) => setSessions((all) => {
      const cur = all[proj] || {};
      return {...all, [proj]: {...cur, ...(typeof p === 'function' ? p(cur) : p)}};
    }), []);
    /* 之前切过的（不含这一轮结果页上的几支）：「已切过」与「不再找」按它判 */
    const kids = (proj, s) => {
      const mine = new Set(((s && s.list) || []).map((x) => x.id));
      return SC.childrenOf(projRef.current, proj).filter((k) => !mine.has(k.id));
    };
    const fresh = (proj, params, facts, extra) => ({proj, open: true, phase: 'setup', params, facts, scope: null,
      list: [], sel: null, taskId: null, sid: null, pct: 0, stage: 'find', ...extra});

    /* 打开工具：有会话就回到会话原地；没有就按这个项目的现状起一份设置。 */
    const open = useCallback((proj, info) => {
      const cur = live.current[proj];
      if (cur) { patch(proj, {open: true}); return {ok: true, resumed: true}; }
      const o = info || {};
      const facts = {hasTrans: !!o.hasTrans, portrait: !!o.portrait, speakers: o.speakers || 0, children: kids(proj).length};
      setSessions((all) => ({...all, [proj]: fresh(proj, SC.normalize({}, facts), facts)}));
      return {ok: true};
    }, [patch]);
    const close = useCallback((proj) => patch(proj, {open: false}), [patch]);
    const setParams = useCallback((proj, p) => patch(proj, (s) => ({params: SC.normalize({...s.params, ...p}, s.facts)})), [patch]);
    const set = useCallback((proj, p) => patch(proj, p), [patch]);

    /* 已经建过的那一次（任务页「查看结果」、会话里的「查看这几支」再点一次）：把那几支摆回结果页，不再建。 */
    const showTask = useCallback((proj, taskId, sentences) => {
      const task = taskRef.current.find((t) => t.id === taskId);
      const ids = landed.current[taskId] || (task && task.artifacts ? task.artifacts.map((a) => a.project).filter(Boolean) : []);
      const cur = live.current[proj];
      const sents = sentences || (cur && cur.sentences) || window.BC_DATA.cues || [];
      const list = ids.map((id) => projRef.current.find((p) => p.id === id)).filter((p) => p && !p.archived && SC.isChild(p))
        .map((p) => {
          const r = SC.usedRanges(p)[0] || {start: p.origin.in, end: p.origin.out};
          const from = sents.length ? SC.indexAt(sents, r.start) : 0;
          const to = sents.length ? Math.max(from, SC.indexAt(sents, r.end - 0.04)) : 0;
          return {id: p.id, cand: p.id, title: p.title, start: r.start, end: r.end, from, to, on: true, made: true,
            focusX: p.cut ? p.cut.focusX : null, reason: '', loose: {start: false, end: false}};
        });
      const facts = cur ? cur.facts : {hasTrans: true, portrait: false, children: 0};
      setSessions((all) => ({...all, [proj]: {...(all[proj] || fresh(proj, SC.normalize({}, facts), facts)), open: true, phase: 'result',
        list, sentences: sents, sel: list[0] ? list[0].id : null, taskId, stage: 'done', pct: 100}}));
    }, []);

    /* 收据到了：按找到的片段直接建子视频，任务记成「已完成」并列出这几支，会话落到结果页。 */
    const land = useCallback((proj, chat) => {
      const s = live.current[proj];
      const parent = projRef.current.find((p) => p.id === proj);
      if (!s || !parent) return;
      const taskId = chat.taskId || null;
      const was = taskId && taskRef.current.find((t) => t.id === taskId);
      if (taskId && (landed.current[taskId] || (was && was.artifacts && was.artifacts.length))) { showTask(proj, taskId); return; }
      const receipt = (chat.messages || []).filter((m) => m.role === 'receipt').slice(-1)[0];
      const segs = SC.demoCandidates(s.sentences || [], s.params, {scope: s.scope, children: kids(proj, null)});
      const taken = projRef.current.map((x) => x.title);
      const made = segs.map((seg) => {
        const title = SC.childTitle(seg.title, taken);
        taken.push(title);
        return SC.childProject({id: newId(++seq.current), parent, seg, title, params: s.params,
          session: chat.id, messageId: receipt ? receipt.id : null});
      });
      if (taskId) landed.current[taskId] = made.map((m) => m.id);
      setProjects((ps) => made.concat(ps));
      const list = segs.map((seg, i) => itemOf(seg, made[i]));
      const total = SC.totalSec(list);
      patch(proj, {phase: 'result', list, sel: list[0] ? list[0].id : null, pct: 100, stage: 'done', taskId});
      if (taskId) patchTask(taskId, {kind: 'shorts-cut', flow: 'shorts-cut', stage: 'done', status: 'done', outcome: 'done', pct: 100,
        phase: null, activity: null, undoable: false,
        sub: `已创建 ${SC.countLabel(made.length)} · 合计 ${SC.mmss(total)} · ${SC.frameLine(s.params)}`,
        artifacts: made.map((m) => ({name: m.title, note: `${SC.mmss(m.origin.in)} – ${SC.mmss(m.origin.out)} · ${SC.secs(m.duration)}`, project: m.id}))});
    }, [patch, patchTask, setProjects, showTask]);

    /* 交给 Agent：会话已经发出去了（新开的那一条），这里记下是哪一条，进度从会话消息倒推。 */
    const findViaAgent = useCallback((proj, o) => {
      patch(proj, {phase: 'running', sid: o.sid, taskId: null, pct: 0, stage: 'find', sentences: o.sentences, scope: o.scope || null,
        runner: o.runner, list: [], sel: null});
    }, [patch]);
    useEffect(() => {
      Object.keys(sessions).forEach((proj) => {
        const s = sessions[proj];
        if (s.phase !== 'running') return;
        const chat = (chats || []).find((x) => x.id === s.sid);
        if (!chat) return;
        const task = chat.taskId ? tasks.find((t) => t.id === chat.taskId) : null;
        const pr = progressOf(chat, task);
        if (pr.done) {
          if ((chat.messages || []).some((m) => m.role === 'receipt')) land(proj, chat);
          else patch(proj, {phase: 'setup', sid: null, taskId: null, pct: 0});
          return;
        }
        if (pr.stage !== s.stage || pr.pct !== s.pct || (chat.taskId || null) !== s.taskId) patch(proj, {stage: pr.stage, pct: pr.pct, taskId: chat.taskId || null});
        if (task && task.kind === 'shorts-cut' && task.status === 'running' && task.stage !== pr.stage) patchTask(task.id, {stage: pr.stage});
      });
    }, [sessions, chats, tasks, land, patch, patchTask]);

    /* 任务从顶栏胶囊或后台任务页被取消：会话退回设置（设置都在）。 */
    useEffect(() => {
      Object.keys(sessions).forEach((proj) => {
        const s = sessions[proj];
        if (s.phase !== 'running' || !s.taskId) return;
        const task = tasks.find((t) => t.id === s.taskId);
        if (task && task.canceled) patch(proj, {phase: 'setup', taskId: null, sid: null, pct: 0});
      });
    }, [sessions, tasks, patch]);

    /* 进行中页的「取消」：会话那头也停下，回设置。 */
    const cancel = useCallback((proj) => {
      const s = live.current[proj];
      if (!s) return;
      const chat = (chats || []).find((x) => x.id === s.sid);
      const tid = s.taskId || (chat && chat.taskId);
      if (tid) patchTask(tid, {status: 'error', outcome: 'canceled', phase: null, activity: null, error: '已取消', canceled: true});
      if (chat && stopAgent) stopAgent(chat.id);
      patch(proj, {phase: 'setup', taskId: null, sid: null, pct: 0});
      if (toast) toast('已取消剪成短视频 · 设置保留', 'notice');
    }, [patchTask, patch, toast, chats, stopAgent]);

    /* ---- 结果页：每一处改动同时写回那一支的记录 ---- */
    const commit = useCallback((proj, fn) => {
      const s = live.current[proj];
      if (!s) return;
      const next = fn(s) || {};
      if (!Object.keys(next).length) return;
      patch(proj, next);
      if (!next.list) return;
      const diff = next.list.filter((it) => { const was = s.list.find((x) => x.id === it.id); return was && changed(was, it); });
      if (diff.length) setProjects((ps) => ps.map((p) => { const it = diff.find((x) => x.id === p.id); return it ? childPatch(p, it) : p; }));
    }, [patch, setProjects]);
    const edit = useCallback((proj, id, fn) => commit(proj, (s) => {
      const before = s.list.find((c) => c.id === id); if (!before) return {};
      const after = {...before, ...(typeof fn === 'function' ? fn(before) : fn)};
      return {list: s.list.map((c) => (c.id === id ? after : c))};
    }), [commit]);
    const select = useCallback((proj, id) => patch(proj, (s) => (s.list && s.list.some((x) => x.id === id) ? {sel: id} : {})), [patch]);

    /* 打开一支子视频（结果页卡、‹ ›、会话里的视频卡）：结果页在来源视频的会话里，有它就亮这一张卡、摆到前面；
       会话不在内存里（换过页面）就按建它的那次任务把这一轮摆回来。 */
    const resultTaskOf = (child) => (child && child.session
      ? taskRef.current.find((t) => t.kind === 'shorts-cut' && (t.artifacts || []).some((a) => a.project === child.id)) : null);
    const hasResult = useCallback((childId) => {
      const child = projRef.current.find((p) => p.id === childId);
      if (!SC.isChild(child)) return false;
      const cur = live.current[child.origin.project];
      return !!(cur && cur.phase === 'result' && cur.list.some((x) => x.id === childId)) || !!resultTaskOf(child);
    }, []);
    const focusChild = useCallback((childId) => {
      const child = projRef.current.find((p) => p.id === childId);
      if (!SC.isChild(child)) return false;
      const host = child.origin.project;
      const cur = live.current[host];
      if (cur && cur.phase === 'result' && cur.list.some((x) => x.id === childId)) { patch(host, {sel: childId, open: true}); return true; }
      const task = resultTaskOf(child);
      if (!task) return false;
      showTask(host, task.id);
      patch(host, {sel: childId});
      return true;
    }, [patch, showTask]);

    /* 「不要这支」：移入回收站（可恢复），结果页上撤下；toast 里能撤销。 */
    const remove = useCallback((proj, id) => {
      const s = live.current[proj], it = s && s.list.find((x) => x.id === id);
      if (!it) return;
      archiveProject(id, true);
      patch(proj, (cur) => {
        const list = cur.list.map((x) => (x.id === id ? {...x, removed: true} : x));
        const next = SC.visible(list)[0];
        return {list, sel: cur.sel === id ? (next ? next.id : null) : cur.sel};
      });
      if (toast) toast(`已把「${it.title}」移入回收站`, null, {label: '撤销', run: () => {
        archiveProject(id, false);
        patch(proj, (cur) => ({list: cur.list.map((x) => (x.id === id ? {...x, removed: false} : x)), sel: id}));
      }});
    }, [archiveProject, patch, toast]);

    /* 结果页的「返回」回到参数页（§5.10）：设置与提示词框里改过的话都留着；这一轮的几支已经是项目库里的视频了。
       「再切几支」同样回参数页，另把「已经切过的不再找」勾上。 */
    const toSetup = useCallback((proj, extra) => patch(proj, (s) => {
      const facts = {...s.facts, children: SC.childrenOf(projRef.current, proj).length};
      return {phase: 'setup', list: [], sel: null, taskId: null, sid: null, pct: 0, stage: 'find', facts,
        params: SC.normalize({...s.params, ...(extra || {})}, facts)};
    }), [patch]);
    const again = useCallback((proj) => toSetup(proj, {skipDone: true}), [toSetup]);

    /* 视频 Tab「切出的短视频」里的「调整后再生成」：不找片段，按那一支的起止与设置直接另建一支，落在结果页
       （结果页开着就接在后面）。正在进行时不打断，只把工具页摆到前面。那一支不动。 */
    const redo = useCallback((proj, child, info) => {
      const cur = live.current[proj];
      const parent = projRef.current.find((p) => p.id === proj);
      const o = info || {};
      const plan = SC.redoPlan(cur);
      if (plan === 'busy') { patch(proj, {open: true}); return {ok: false, busy: cur.phase}; }
      const sentences = (cur && cur.sentences && cur.sentences.length ? cur.sentences : o.sentences) || [];
      const c = SC.redoCandidate(sentences, child, projRef.current.map((x) => x.title));
      if (!c || !parent) return {ok: false};
      const facts = {hasTrans: !!o.hasTrans, portrait: !!o.portrait, speakers: o.speakers || 0, children: kids(proj).length};
      const params = SC.redoParams(child, cur ? cur.params : {}, facts);
      const made = SC.childProject({id: newId(++seq.current), parent, seg: c, title: c.title, params});
      setProjects((ps) => [made].concat(ps));
      const it = itemOf(c, made);
      if (plan === 'append') {
        patch(proj, (s) => ({open: true, list: s.list.concat([it]), sel: it.id}));
      } else {
        setSessions((all) => ({...all, [proj]: fresh(proj, params, facts, {phase: 'result', sentences, list: [it], sel: it.id})}));
      }
      if (toast) toast(`已另建「${made.title}」· 原来那支不动`, 'positive');
      return {ok: true, plan, id: made.id};
    }, [patch, setProjects, toast]);

    /* 从任务页「查看结果」/ 顶栏胶囊回来：打开来源项目，结果页摆到前面。 */
    const resume = useCallback((task) => {
      if (!task || !task.project) return;
      const cur = live.current[task.project];
      if (task.status === 'done' && (!cur || cur.taskId !== task.id || cur.phase !== 'result')) showTask(task.project, task.id);
      else if (cur) patch(task.project, {open: true});
      go({r: 'editor', id: task.project});
    }, [patch, go, showTask]);

    return {sessions, open, close, set, setParams, findViaAgent, cancel, edit, select, remove,
      toSetup, again, resume, redo, showTask, hasResult, focusChild};
  }
  Object.assign(window, {useShortsCutStore});
})();
