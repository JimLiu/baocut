/* 剪口覆盖层的编辑器状态 —— 第 192 轮（§12.6「剪口覆盖层」/ §13.1「剪辑模式」）。
   editor.jsx 只拿它的返回值组进 ctx；纯计算全在 model-cut.js（BC_CUT，有单测）。

   四件事住在这里：
     1. `cuts` 表与 `cutMode` 位（第 200 轮起是全局「剪辑」开关，第 201 轮挂在文稿面板头：同时决定文稿
        改字 / 剪辑态与时间轴成片 / 源片视图），入口切换一起重置；
     2. `cutSel`——文稿里拖出来的那段字（第 193 轮上提到这里）：`{para, a, b, start, end,
        text, live}`，token 下标归面板、时间归时间轴（画选段 + 标时间），两边都能清它；
        `live` 是「还在拖」，松手才落定，浮动菜单只在落定后出现；
     3. 所有写操作先 `history.mark('cuts')`，与 cue 改写表同一撤销栈——⌘Z 撤得回一刀；
     4. 监听任务记录：`kind:'cleanup'` 的任务（AI Tools 或 Agent 都产出它）跑完，
        把这一批建议写进表；收据上「撤销 / 重做」翻 `undone` 位，这里整批撤走 / 放回。
        任务记录是进度的唯一真相（§15.1），所以两条路径都不直接调用这里——
        它们只改任务，这里只看任务。 */
(function () {
  const {useState, useRef, useCallback, useEffect} = React;
  const D = window.BC_DATA;
  const CUT = window.BC_CUT;

  /** @param o `{app, proj, ent, initiallyEmpty, cutsRef, setTab, setPaneHidden, setPeek}` */
  function useCutStore(o) {
    const {app, proj, initiallyEmpty} = o;
    const seed = (by, batch) => CUT.suggest([], D.cutSuggestions, by, batch);
    // 实验项目（proj.bare）不预埋建议：从「找可剪的口」到批量接受整条链留给用户自己跑
    const preset = (empty, e) => !empty && !!e.review && !proj.bare;
    const [cuts, setCuts] = useState(() => (preset(initiallyEmpty, o.ent) ? seed('ai') : []));
    const [cutMode, setCutMode] = useState(!initiallyEmpty && !!o.ent.review);
    const [cutSel, setCutSel] = useState(null);
    const cutsRef = o.cutsRef;   // editor.jsx 持有：rAF 跳播每帧读它
    cutsRef.current = cuts;
    /* history 在 editor.jsx 里建得比这里晚（它要 cuts 才能拍快照），经 ref 回填 */
    const historyRef = useRef(null);
    const undo = () => ({label: '撤销', undo: true, run: () => historyRef.current && historyRef.current.undo()});
    const write = useCallback((fn) => {
      if (historyRef.current) historyRef.current.mark('cuts');
      setCuts((prev) => fn(prev));
    }, []);
    const byId = (id) => cutsRef.current.find((c) => c.id === id);

    const ops = {
      /** 手动剪一段（文稿里拖选后按 ⌫，或时间轴上框出来）。 */
      add: (cut) => {
        write((prev) => CUT.add(prev, cut));
        app.toast(`已剪掉 · ${CUT.label(cut.end - cut.start)}`, 'positive', undo());
      },
      accept: (id) => {
        const c = byId(id); if (!c) return;
        write((prev) => CUT.accept(prev, id));
        app.toast(`已剪掉${CUT.kindLabel(c.kind)} · ${CUT.label(c.end - c.start)}`, 'positive', undo());
      },
      reject: (id) => {
        write((prev) => CUT.remove(prev, id));
        app.toast('已忽略这一条建议', undefined, undo());
      },
      restore: (id) => {
        const c = byId(id); if (!c) return;
        write((prev) => CUT.remove(prev, id));
        app.toast(`已恢复 · ${CUT.label(c.end - c.start)} 放回成片`, 'positive', undo());
      },
      /** 拖空槽带边缘改剪切范围（2026-10-01，内核 op `retimeCut`）：一次原子写、一步撤销，
          id 与来源（AI 建议 / 手动）不变；区间没变不写、不出 toast。 */
      retime: (id, start, end) => {
        const c = byId(id); if (!c) return;
        const next = CUT.retime(cutsRef.current, id, start, end);
        if (next === cutsRef.current) return;
        write(() => next);
        app.toast(`已改剪切范围 · ${CUT.label(c.end - c.start)} → ${CUT.label(end - start)}`, 'positive', undo());
      },
      /** 恢复一整条剪缝（文稿改字态里那条虚线，§13.1）：缝盖住的剪口一起放回。
          剪口跨到缝外时整条放回——恢复的单位是剪口本身，不能只放回它的一半。 */
      restoreMany: (ids, paras) => {
        const list = (ids || []).map(byId).filter(Boolean);
        if (!list.length) return;
        const s = CUT.summary(list);
        write((prev) => CUT.remove(prev, list.map((c) => c.id)));
        app.toast(`已恢复 ${paras > 1 ? paras + ' 段 · ' : ''}${CUT.label(s.secs)} 放回成片`, 'positive', undo());
      },
      acceptAll: () => {
        const s = CUT.summary(CUT.suggested(cutsRef.current)); if (!s.n) return;
        write((prev) => CUT.acceptAll(prev));
        app.toast(`已剪掉 ${s.n} 处 · 共 ${CUT.label(s.secs)}`, 'positive', undo());
      },
      rejectAll: () => {
        const n = CUT.suggested(cutsRef.current).length; if (!n) return;
        write((prev) => CUT.rejectAll(prev));
        app.toast(`已忽略 ${n} 条建议`, undefined, undo());
      },
      restoreAll: () => {
        const s = CUT.summary(CUT.active(cutsRef.current)); if (!s.n) return;
        write((prev) => CUT.restoreAll(prev));
        app.toast(`已恢复 ${s.n} 处 · ${CUT.label(s.secs)} 放回成片`, 'positive', undo());
      },
      /** 试听一处：借悬停预览的 once 窗口真播一遍（播放中的跳播对预览窗口不生效）。 */
      audition: (cut) => {
        o.setPeek({kind: 'cut', apply: (d) => d, once: true,
          win: {t0: Math.max(0, cut.start - 0.6), t1: cut.end + 0.4}});
      },
    };

    /* ---- 任务 → 建议 ----
       首次挂载只记下现状（演示里 ag1 是「执行中」，不能一进编辑器就当成刚跑完）。
       新一轮扫描**替换**尚未处理的建议，已剪的不动、与已剪重叠的跳过。 */
    const seen = useRef(null);
    useEffect(() => {
      const list = app.tasks.filter((t) => t.kind === 'cleanup' && t.project === proj.id);
      const now = new Map(list.map((t) => [t.id, {status: t.status, undone: !!t.undone}]));
      if (!seen.current) { seen.current = now; return; }
      list.forEach((t) => {
        const prev = seen.current.get(t.id);
        const cur = now.get(t.id);
        const by = t.source === 'agent' ? 'agent' : 'ai';
        if (prev && prev.status !== 'done' && t.status === 'done' && t.outcome === 'done') {
          // 先算好再写：函数式 setState 在 React 里延到渲染时才跑，toast 读不到里面的计数
          const next = CUT.suggest(CUT.rejectAll(cutsRef.current), D.cutSuggestions, by, t.id);
          const n = next.filter((c) => c.batch === t.id).length;
          write(() => next);
          setCutMode(true);
          app.toast(`已写入 ${n} 处剪辑建议 · 去文稿逐条接受`, 'positive',
            {label: '去文稿', run: () => { o.setTab('transcript'); o.setPaneHidden(false); }});
        } else if (prev && prev.status === 'done' && cur && prev.undone !== cur.undone) {
          write((p) => (cur.undone
            ? CUT.withoutBatch(p, t.id)
            : CUT.suggest(p, D.cutSuggestions, by, t.id)));
        }
      });
      seen.current = now;
    }, [app.tasks]);

    /** 入口切换（editor.jsx 的 setEntry）：clean 入口带 AI 建议进来，其余入口清空。 */
    const reset = useCallback((empty, e) => {
      setCuts(preset(empty, e) ? seed('ai') : []);
      setCutMode(!empty && !!e.review);
      setCutSel(null);
    }, []);
    // 切回改字态选区作废
    useEffect(() => { if (!cutMode) setCutSel(null); }, [cutMode]);

    return {cuts, setCuts, cutsRef, cutMode, setCutMode, cutSel, setCutSel, cutOps: ops, historyRef, reset};
  }

  Object.assign(window, {useCutStore});
})();
