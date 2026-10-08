/* 新建视频的跨屏那一半（product-design §3.2.1）。由 useStore 挂载，三件事：
   ① **预置**：别处的「新建视频」（⌘N、Space 的「新建」、会话、导入失败「换个素材」、帮助中心）带着预置落到 Home 起始页
      （`newProject(preset)`）；页面读一次就清掉。预置只认 `dir`（落在哪个项目）、`entry`（media / blank / agent）、
      `goal`（media 入口要填哪条快捷开始的提示词）、`file`（挂成输入框的主素材），以及 `prompt` / `skill`
      （填进输入框的一句话与挂上的 skill token，skill 详情的「试一下」用），怎么用见 page-new.jsx。
   ② **记忆**：上次的画幅、时长与 Shorts 开关等，进 `bc-prefs-v1.newProject`。
   ③ **后续链**：建项时挂在转录任务上的后续（`options.chain`），转录一完成这里自动起下一条任务并跑完。
      起始页的固定流程表单退场后已经没有地方写 `options.chain`，这一段暂时留着。 */
(function () {
  const {useState, useCallback, useEffect, useRef} = React;
  const N = window.BC_NEW;

  function useNewProjectFlow({tasks, setTasks, addTask, prefs, setPref, go, toast}) {
    const [newPreset, setNewPreset] = useState(null);
    const seq = useRef(0);
    const newProject = useCallback((preset) => {
      setNewPreset({...(preset || {}), seq: ++seq.current});
      go({r: 'home'});
    }, [go]);
    const takeNewPreset = useCallback(() => setNewPreset(null), []);

    const newMem = prefs.newProject || null;
    const rememberNew = useCallback((run) => setPref('newProject', N.remember(prefs.newProject, run)), [prefs.newProject, setPref]);
    const forgetNew = useCallback(() => setPref('newProject', null), [setPref]);

    /* 转录完成 → 起后续；后续任务自己往前走。chained 记在 ref 里，任务对象上再落一个标记防重。 */
    const chained = useRef(new Set());
    useEffect(() => {
      tasks.forEach((t) => {
        const ch = t.options && t.options.chain;
        if (!ch || t.kind !== 'transcribe' || t.status !== 'done' || chained.current.has(t.id)) return;
        chained.current.add(t.id);
        const name = String(t.title || '').replace(/^转录 · /, '');
        addTask({kind: ch.kind, project: t.project, title: `${ch.title} · ${name}`, sub: `${ch.runner || 'AI'} · 转录完成后自动开始`,
          phase: ch.phases[0], cancellable: true, origin: 'chain', chain: ch});
        toast(`转录完成 · 已自动开始「${ch.title}」`, 'info', {label: '看任务', run: () => go({r: 'tasks'})});
      });
      const running = tasks.filter((t) => t.origin === 'chain' && t.status === 'running');
      if (!running.length) return undefined;
      const timer = setTimeout(() => {
        const done = [];
        setTasks((ts) => ts.map((t) => {
          if (t.origin !== 'chain' || t.status !== 'running') return t;
          const pct = Math.min(100, t.pct + 3);
          if (pct >= 100) { done.push(t); return {...t, pct, status: 'done', outcome: 'done', phase: null}; }
          const ph = t.chain.phases;
          return {...t, pct, phase: ph[Math.min(ph.length - 1, Math.floor(pct / (100 / ph.length)))]};
        }));
        done.forEach((t) => toast(t.chain.doneToast, 'positive', {label: '打开视频', run: () => go({r: 'editor', id: t.project})}));
      }, 260);
      return () => clearTimeout(timer);
    }, [tasks]);

    return {newPreset, newProject, takeNewPreset, newMem, rememberNew, forgetNew};
  }

  Object.assign(window, {useNewProjectFlow});
})();
