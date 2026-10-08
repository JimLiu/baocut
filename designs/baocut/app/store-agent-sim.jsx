/* Agent 会话里「放行之后的执行段」怎么演（从 store.jsx 搬出来，只在 App 入口加载）
   ============================================================================
   一条 tool 行 + 一条后台任务（同源）→ 收据 → 收尾话。任务进度写在任务记录上，
   会话里的工具行与视频卡只读它（`taskId`），不另存一份。

   计划上带 `sim` 的几件活（下载、转录、重新转录、翻译、导出；见 model-agent-sim.js）多三件事：
   - 工具行是 BaoCut 工具调用（`tool` + `args`），步骤行念它自己的类别名；
   - 每一拍把阶段键、计数、用时与剩余写进任务记录，视频卡上那一行与下载卡据此画；
   - 每一拍先看任务还在不在跑：卡上点了「取消」（app.cancelTask 把记录改成已取消），
     计时就停，工具行记成失败，Agent 回一句已取消，这一轮收掉。
   下载（product-design §4.2）：视频还没创建时是一张下载卡；下完用 BC_IMPORT.movieRecord 建视频、
   会话挂上它、接着起转录——同一个锚点换成视频卡，转录在卡上那一行跑，随时能打开编辑器。
   演示的失败链接在 34% 断一次（连接中断，可重试）；重试从断点接着下。
   预置的下载会话（`drive: 'on-view'`）打开那条会话时才开始走。
   边转边问（预置会话 s23）：转录还在跑时用户回话、又不是新的写入，这一轮调 `jobs_wait` 等它（runWait），跑完写收据、收尾。
   ============================================================================ */
(function () {
  const {useCallback, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const SIM = window.BC_AGENT_SIM;

  function useAgentSim({projects, prefs, tasks, addTask, patchTask, patchSession, appendMsg, setSessions, setProjects, sessionsRef,
    route, landTool, later, streamReply, endTurn}) {
    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;
    const projectsRef = useRef(projects);
    projectsRef.current = projects;

    /* 会话里的计划：BC_AGENT 的脚本 + 转录脚本与卡片字段（视频名、谁在做进参数摘要） */
    const planFor = useCallback((text, hasProject, sess) => {
      const proj = sess && sess.project ? projects.find((p) => p.id === sess.project) : null;
      const h = sess ? D.agent.harnesses.find((x) => x.id === sess.harness) : null;
      /* 回答「开始之前先确认一下」：上一句还留着待填项（`[目标语言]`），这一句短短一句就是答案——
         填进上一句，按补全后的话接着做（话里的链接这时才开始下载）。 */
      const said = String(text || '').trim();
      const prev = sess && [...(sess.messages || [])].reverse().find((m) => m.role === 'user');
      const missing = prev ? AG.missingSlots(prev.text) : [];
      const answer = missing.length && said && said.length <= 32 && !/^\s*\//.test(said) && !AG.missingSlots(said).length;
      text = answer ? String(prev.text).replace(`[${missing[0]}]`, said) : text;
      const plan = SIM.planFor(text, hasProject, {title: proj ? proj.title : null, agent: h ? AG.harnessLabel(h, sess.model, sess.activeModel) : null,
        noTranscriber: !!prefs.demoNoTranscriber});
      /* 边转边问：这条会话的转录还在跑，用户这句话又不是新的写入（回答 Agent 的问题），这一轮就等那件转录 */
      const live = sess && !plan.write && !/^\s*\//.test(String(text || '')) && tasksRef.current.find((t) => t.session === sess.id
        && (t.kind === 'transcribe' || t.kind === 'retranscribe') && (t.status === 'running' || t.status === 'queued'));
      return live ? SIM.waitPlan(live) : plan;
    }, [projects, prefs.demoNoTranscriber]);

    const agentLabel = (sess) => {
      const h = D.agent.harnesses.find((x) => x.id === sess.harness) || D.agent.harnesses[0];
      return AG.harnessLabel(h, sess.model, sess.activeModel);
    };
    /* 改这件活的工具行（`only` 过滤哪几条） */
    const markTool = (sid, tid, patch, only) => setSessions((ss) => ss.map((x) => (x.id !== sid ? x : {
      ...x, ago: 0,
      messages: x.messages.map((m) => (m.taskId === tid && m.role === 'tool' && (!only || only(m)) ? {...m, ...patch} : m)),
    })));
    const isRun = (m) => m.status === 'run';
    const notFailed = (m) => window.BC_AGENT_TURN.toolStatus(m.status) !== 'failed';

    /** 推进一件活：每一拍先看记录还在不在跑，再涨进度；下载的演示失败在这里断。 */
    const drive = (sid, tid, sim, from, h) => {
      let p = from || 0;
      const tick = () => {
        const cur = tasksRef.current.find((x) => x.id === tid);
        if (cur && cur.status !== 'running') { h.stopped(); return; }
        p = Math.min(100, p + SIM.pace(sim));
        if (sim.kind === 'download' && SIM.downloadFails(cur, p)) { h.failed(p); return; }
        patchTask(tid, SIM.progress(sim, p));
        if (p < 100) { later(sid, 220, tick); return; }
        h.done();
      };
      later(sid, 400, tick);
    };

    /* 卡上点了取消：停表、工具行记失败、回一句已取消、收掉这一轮 */
    const stoppedTurn = (sid, tid, sim) => {
      markTool(sid, tid, {status: 'failed', took: '已取消'}, isRun);
      patchSession(sid, {taskId: null});
      const end = streamReply(sid, SIM.stoppedText(sim), 300);
      later(sid, end, () => {
        endTurn(sid);
        patchSession(sid, {status: 'idle'});
      });
    };

    /* 转录跑完：视频记录从「转录中」落成「已转录」；失败落成「失败」 */
    const settleMovie = (movieId, status) => {
      if (!movieId) return;
      setProjects((ps) => ps.map((p) => (p.id === movieId && p.status !== 'complete' ? {...p, status, progress: null} : p)));
    };

    /** 一件转录 / 翻译 / 导出在后台走完（重试、下载之后接着起的转录）：不再说话，只改记录与工具行。 */
    const driveQuiet = (sid, tid, sim, from) => drive(sid, tid, sim, from, {
      stopped: () => markTool(sid, tid, {status: 'failed', took: '已取消'}, isRun),
      failed: () => {},
      done: () => {
        const cur = tasksRef.current.find((x) => x.id === tid) || {};
        patchTask(tid, {status: 'done', outcome: 'done', phase: null, undoable: sim.kind !== 'export', undone: false, ...SIM.done(sim)});
        markTool(sid, tid, {status: 'done', took: '2.4s', error: null});
        if (sim.kind === 'transcribe' || sim.kind === 'retranscribe') settleMovie(cur.project, 'complete');
      },
    });

    /** 起一件转录（下载完成后）：一条 tool 行 + 一条任务，后台走。 */
    const startTranscribe = (sid, sess, movie, sim) => {
      const tid = addTask({
        kind: 'transcribe', project: movie.id, title: `转录 · ${movie.title}`,
        sub: `${agentLabel(sess)} · 会话「${sess.title || '下载视频'}」`, cancellable: true, source: 'agent', session: sid,
        undoBody: '这一份文稿会被移除，视频回到没有文稿的状态。原片与时间轴不动。',
        ...sim.task, ...SIM.progress(sim, 0),
      });
      appendMsg(sid, {role: 'tool', tool: sim.tool, args: sim.args, status: 'run', taskId: tid});
      driveQuiet(sid, tid, sim, 0);
    };

    /** 下载完成：建视频（与链接导入同一个 movieRecord）、会话挂上它、接着转录、Agent 说一句。 */
    const finishDownload = (sid, tid, sim) => {
      const t = tasksRef.current.find((x) => x.id === tid) || {};
      const sess = sessionsRef.current.find((x) => x.id === sid) || {};
      /* 视频落在会话的项目里（会话的 `dir` 也可能是刚在起始页新建的项目，演示数据里查不到它，存放路径就留空）；
         会话不属于任何项目时视频也不属于项目，放在会话自己的文件夹里（§2.3），不另建项目。 */
      const dirRec = (D.agentProjects || []).find((d) => d.id === sess.dir) || null;
      const title = t.title || t.name || '下载的视频';
      const id = 'pd-' + tid + '-' + Date.now().toString(36);
      const movie = {...window.BC_IMPORT.movieRecord({id, title, name: t.name || `${title}.mp4`,
        saveDir: dirRec ? dirRec.path + title : null, duration: t.mediaSec, hue: t.hue,
        dir: sess.dir || null}), ctime: 0, mtime: 0, otime: 0};
      setProjects((ps) => [movie].concat(ps));
      patchTask(tid, {status: 'done', outcome: 'done', ...SIM.done(sim), project: id});
      markTool(sid, tid, {status: 'done', took: '48s', error: null});
      patchSession(sid, {project: id, taskId: null});
      const after = SIM.afterDownload(t);
      later(sid, 300, () => startTranscribe(sid, {...sess, project: id}, movie, after.transcribe));
      const end = streamReply(sid, after.close, 700, {movieId: id});
      later(sid, end, () => {
        endTurn(sid);
        patchSession(sid, {status: 'done'});
      });
    };

    /** 驱动一件下载：在 34% 断的演示链接、取消、完成三条路。 */
    const driveDownload = (sid, tid, sim, from) => drive(sid, tid, sim, from, {
      stopped: () => stoppedTurn(sid, tid, sim),
      failed: (p) => {
        const issue = window.BC_IMPORT.issues.network;
        patchTask(tid, {...SIM.progress(sim, p), status: 'error', outcome: 'error', issue: 'network', error: issue.title, phase: null});
        markTool(sid, tid, {status: 'failed', took: '16s', error: `${issue.title}（已下 ${p}%）`}, isRun);
        patchSession(sid, {taskId: null});
        const end = streamReply(sid, `下载在 ${p}% 断了：${issue.title}。检查网络后点下载卡上的「重试」，会从断点接着下。`, 300);
        later(sid, end, () => {
          endTurn(sid);
          patchSession(sid, {status: 'idle'});
        });
      },
      done: () => finishDownload(sid, tid, sim),
    });

    /* 放行之后的执行段：一条 tool 行 + 一条后台任务（同源）→ 收据 → 收尾话。 */
    const runWrite = useCallback((sid, plan, sess, opts) => {
      const o = opts || {};
      const proj = sess.project ? projects.find((p) => p.id === sess.project) : null;
      const sim = plan.sim || null;
      const tid = addTask({
        kind: plan.task.kind, project: sess.project,
        title: `${plan.task.title}${proj ? ' · ' + proj.title : ''}`,
        sub: `${agentLabel(sess)}${o.model ? ' · ' + o.model : ''}${o.scope ? ' · 范围 ' + o.scope : ''} · 会话「${sess.title || AG.sessionTitle(plan.summary)}」`,
        phase: '执行中', cancellable: true, source: 'agent', session: sid,
        target: plan.task.target || null,
        undoBody: plan.task.undoBody, undoable: false,
        ...(sim ? {...sim.task, ...SIM.progress(sim, 0)} : {}),
        ...(sim && sim.kind === 'download' ? {project: null, title: sim.task.title, phase: null} : {}),
      });
      patchSession(sid, {taskId: tid, status: 'running'});
      appendMsg(sid, sim
        ? {role: 'tool', tool: sim.tool, args: sim.args, status: 'run', taskId: tid}
        : {role: 'tool', kind: 'command', cmd: plan.write.cmd, status: 'run', taskId: tid});
      if (sim && sim.kind === 'download') { driveDownload(sid, tid, sim, 0); return; }
      const finish = () => {
        patchTask(tid, {status: 'done', outcome: 'done', pct: 100, phase: null, undoable: plan.task.kind !== 'export', undone: false, ...(sim ? SIM.done(sim) : {})});
        setSessions((ss) => ss.map((x) => (x.id !== sid ? x : {
          ...x, ago: 0,
          messages: x.messages.map((m) => (m.taskId === tid && m.role === 'tool' && notFailed(m) ? {...m, status: 'done', took: '2.4s'} : m))
            .concat([{id: 'r-' + tid, role: 'receipt', text: plan.receipt, taskId: tid, movieId: sess.project || null}]),
        })));
        if (sim && (sim.kind === 'transcribe' || sim.kind === 'retranscribe')) settleMovie(sess.project, 'complete');
        const end = plan.close ? streamReply(sid, plan.close, 500, {open: plan.open || null, movieId: sess.project || null}) : 500;
        later(sid, end, () => {
          landTool(sid, plan, sess);
          endTurn(sid);
          patchSession(sid, {status: 'done'});
        });
      };
      if (sim) { drive(sid, tid, sim, 0, {stopped: () => stoppedTurn(sid, tid, sim), failed: () => {}, done: finish}); return; }
      /* 没有 sim 的命令：老样子按固定步长走完 */
      let p = 0;
      const tick = () => {
        p = Math.min(100, p + 9);
        patchTask(tid, {pct: p});
        if (p < 100) { later(sid, 220, tick); return; }
        finish();
      };
      later(sid, 400, tick);
    }, [projects, addTask, patchTask, patchSession, appendMsg, landTool]);

    /** 卡上的「重试」（视频卡上失败的那一行、下载卡）：同一条记录重新跑，同一条工具行回到运行中。
       下载从断点接着下（演示里重试过的链接不再断）；其它从头来。 */
    const retryTask = useCallback((id) => {
      const t = tasksRef.current.find((x) => x.id === id);
      if (!t || !t.session || t.status === 'running') return;
      const sid = t.session;
      const sim = SIM.retrySim(t) || {kind: t.kind, task: {}, result: {}};
      const from = t.kind === 'download' ? t.pct || 0 : 0;
      patchTask(id, {status: 'running', outcome: null, error: null, errorCode: null, issue: null, canceled: false, retried: true,
        cancellable: true, attempts: (t.attempts || 0) + 1, ...SIM.progress(sim, from)});
      markTool(sid, id, {status: 'run', error: null, took: null});
      if (t.kind === 'download') {
        patchSession(sid, {taskId: id, status: 'running'});
        driveDownload(sid, id, sim, from);
        return;
      }
      driveQuiet(sid, id, sim, 0);
    }, [patchTask, patchSession]);

    /** 边转边问：用户回话时转录还在跑，这一轮调 `jobs_wait` 等它（工具行不带 `taskId`：等待不是提交，视频卡靠跟随规则过来），
       跑完（或被取消、失败）写收据与收尾话、收掉这一轮。 */
    const runWait = useCallback((sid, plan) => {
      const tid = plan.wait.taskId;
      const mid = 'jw-' + tid + '-' + Date.now().toString(36);
      patchSession(sid, {taskId: tid, status: 'running'});
      appendMsg(sid, {id: mid, role: 'tool', tool: plan.tool, args: plan.args, status: 'run', waitFor: tid});
      const poll = () => {
        const t = tasksRef.current.find((x) => x.id === tid);
        if (t && (t.status === 'running' || t.status === 'queued')) { later(sid, 400, poll); return; }
        const c = SIM.waitClose(t);
        setSessions((ss) => ss.map((x) => (x.id !== sid ? x : {
          ...x, ago: 0,
          messages: x.messages.map((m) => (m.id === mid ? {...m, status: 'done', took: '等到了'} : m))
            .concat(c.receipt ? [{id: 'r-' + tid, role: 'receipt', text: c.receipt, taskId: tid, movieId: t ? t.project : null}] : []),
        })));
        const end = streamReply(sid, c.close, 400, {movieId: t ? t.project : null});
        later(sid, end, () => {
          endTurn(sid);
          patchSession(sid, {status: 'done', taskId: null});
        });
      };
      later(sid, 600, poll);
    }, [patchSession, appendMsg]);

    /* 预置的下载会话：打开那条会话时才开始走，免得还没看就下完了 */
    useEffect(() => {
      if (!route || route.r !== 'agent' || !route.id) return;
      const t = tasks.find((x) => x.session === route.id && x.drive === 'on-view' && x.status === 'running');
      if (!t) return;
      patchTask(t.id, {drive: true});
      const sim = SIM.retrySim(t);
      if (t.kind === 'download') driveDownload(route.id, t.id, sim, t.pct || 0);
      else driveQuiet(route.id, t.id, sim, t.pct || 0);
    }, [route, tasks]);

    return {runWrite, planFor, retryTask, runWait};
  }

  Object.assign(window, {useAgentSim});
})();
