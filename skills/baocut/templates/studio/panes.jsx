// BaoCut Subtitle Studio — the three text panes (Transcript / Subtitle /
// Translate). Editing model (MVP):
//   · Subtitle tab  — per-cue text editing：点击处落光标，Enter 在光标处拆分，
//                     行首 ⌫ 并入上一条 / 行尾 ⌦ 合并下一条（都与未提交文本合成
//                     一个事务，撤销时是一步），外加时间码编辑与逐句播放。
//   · Translate tab — per-cue translation editing, untranslated / out-of-date
//                     chips, AI actions routed to the Agent.
//   · Transcript tab — paragraph projection with whole-paragraph editing;
//                     Enter splits, edge ⌫/⌦ merges, and live text rides in the
//                     same sourceParagraph transaction.
(() => {
const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;
const { Ic, QBtn, Menu, useApp, usePlayer, useActive, fmt, toast, EditableText, TimecodeChip, LiveHeader, spHue } = window;
const V = window.BCS_VLIST;
const F = window.BCS_FIND;
if (!F) throw new Error('find-replace.js failed to load');
const TP = window.BCS_TRANSLATE_PANE;
if (!TP) throw new Error('translate-pane.js failed to load');

const fmtRange = (a, b) => fmt(a) + '–' + fmt(b);

// 三面板共用播放跟随：每个稳定 item 变更时居中；Transcript 还可传入词级
// focusSelector/focusKey，让同一段落只在当前词跨换行时再次居中。
function usePlaybackFollow(scrollRef, attr, activeId, playing, virtualHandle, focusSelector, focusKey, clock) {
  const [following, setFollowing] = useState(true);
  const [offDir, setOffDir] = useState(null);
  const followingRef = useRef(true); followingRef.current = following;
  const playingRef = useRef(playing); playingRef.current = playing;
  const wasPlaying = useRef(false);
  const lastClock = useRef(clock);
  const lastTarget = useRef(null);

  const activeElement = useCallback(() => {
    const c = scrollRef.current;
    if (!c || !activeId || !attr) return null;
    const row = c.querySelector('[' + attr + '="' + activeId + '"]');
    return row && focusSelector ? (row.querySelector(focusSelector) || row) : row;
  }, [scrollRef, attr, activeId, focusSelector]);

  const center = useCallback((smooth) => {
    if (!activeId) return false;
    const handle = virtualHandle && virtualHandle.current;
    if (handle && handle.centerKey) return handle.centerKey(activeId, smooth);
    const c = scrollRef.current, el = activeElement();
    if (!c || !el) return false;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    const target = c.scrollTop + (er.top - cr.top) - cr.height / 2 + er.height / 2;
    const maximum = Math.max(0, c.scrollHeight - c.clientHeight);
    const clamped = Math.floor(Math.max(0, Math.min(maximum, target)));
    // 当前词在同一视觉换行内时 target 不变；不要每个词都重启动 CSS smooth。
    if (smooth && lastTarget.current != null && Math.abs(lastTarget.current - clamped) < 1) return true;
    lastTarget.current = clamped;
    c.scrollTo({ top: clamped, behavior: smooth ? 'smooth' : 'auto' });
    return true;
  }, [scrollRef, virtualHandle, activeId, activeElement]);

  const recompute = useCallback(() => {
    if (!activeId) { setOffDir(null); return; }
    const handle = virtualHandle && virtualHandle.current;
    if (handle && handle.directionForKey) {
      setOffDir(handle.directionForKey(activeId, 12));
      return;
    }
    const c = scrollRef.current, el = activeElement();
    if (!c || !el) { setOffDir(null); return; }
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.bottom <= cr.top + 12) setOffDir('up');
    else if (er.top >= cr.bottom - 12) setOffDir('down');
    else setOffDir(null);
  }, [scrollRef, virtualHandle, activeId, activeElement]);

  useEffect(() => {
    if (playing && !wasPlaying.current) {
      followingRef.current = true;
      setFollowing(true);
      lastTarget.current = null;
    }
    wasPlaying.current = playing;
  }, [playing]);

  useEffect(() => {
    const previous = lastClock.current;
    lastClock.current = clock;
    if (!playing || clock == null || previous == null) return;
    const delta = clock - previous;
    if (delta >= 0 && delta <= 0.75) return;
    followingRef.current = true;
    setFollowing(true);
    lastTarget.current = null;
  }, [clock, playing]);

  useEffect(() => {
    if (!playing || !followingRef.current || !activeId) return;
    center(true);
    const raf = requestAnimationFrame(recompute);
    return () => cancelAnimationFrame(raf);
  }, [activeId, focusKey, playing, following, center, recompute]);

  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    const onUserScroll = () => {
      if (!playingRef.current || !followingRef.current) return;
      followingRef.current = false;
      setFollowing(false);
    };
    c.addEventListener('scroll', onScroll, { passive: true });
    c.addEventListener('wheel', onUserScroll, { passive: true });
    c.addEventListener('touchmove', onUserScroll, { passive: true });
    return () => {
      c.removeEventListener('scroll', onScroll);
      c.removeEventListener('wheel', onUserScroll);
      c.removeEventListener('touchmove', onUserScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef, recompute]);

  useEffect(() => { recompute(); }, [activeId, focusKey, playing, recompute]);

  const jumpToCurrent = useCallback(() => {
    followingRef.current = true;
    setFollowing(true);
    center(false);
    setOffDir(null);
  }, [center]);

  return { following, offDir, jumpToCurrent };
}

function FollowPill({ direction, title, onClick, top }) {
  if (!direction) return null;
  return (
    <button className={'vk-followpill' + (top ? ' vk-followpill--top' : '')}
      onClick={onClick} aria-label={title}>
      <Ic name={direction === 'up' ? 'chevron-up' : 'chevron-down'} size={16} />
      {title}
    </button>
  );
}

// ---------- shared: find & replace（原型 transcript/subtitle/translate 三面板同款） ----------
// 一份匹配列表同时驱动计数、导航、高亮与替换（纯逻辑在 studio/find-replace.js）。
// 替换走的仍是各面板既有写路径：editParagraph / editCue / editTrans —— 查找栏
// 不新开第二条文本真相，也不碰派生投影。
const NO_MARKS = [];

function Highlight({ text, matches, curStart }) {
  const body = String(text == null ? '' : text);
  if (!matches || !matches.length) return body;
  const out = [];
  let last = 0;
  matches.forEach((m) => {
    if (m.start > last) out.push(body.slice(last, m.start));
    const isCur = curStart === m.start;
    out.push(
      <mark key={m.start} className={'vk-mark' + (isCur ? ' vk-mark--cur' : '')}
        data-match-cur={isCur ? '1' : undefined}>{body.slice(m.start, m.end)}</mark>,
    );
    last = m.end;
  });
  if (last < body.length) out.push(body.slice(last));
  return out;
}

// items 必须由调用方 memo 住（[{ key, text, …自带字段 }]）。
function useFind(items) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rq, setRq] = useState('');
  const [opts, setOpts] = useState(F.DEFAULT_OPTS);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);
  const query = open ? q.trim() : '';
  const matches = useMemo(() => F.collect(items, query, opts), [items, query, opts]);
  const byKey = useMemo(() => F.groupByKey(matches), [matches]);
  const cur = F.currentOf(matches, idx);
  useEffect(() => { setIdx(0); }, [query, opts]);
  useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open]);
  const close = useCallback(() => setOpen(false), []);
  const goto = useCallback((dir) => setIdx((i) => F.cycle(i, matches.length, dir)), [matches.length]);
  return {
    open, setOpen, close, toggle: () => setOpen((v) => !v), goto, inputRef,
    q, setQ, rq, setRq, opts, setOpts, idx, query,
    matches, byKey, cur,
    marksFor: (key) => byKey.get(key) || NO_MARKS,
    curStartIn: (key) => (cur && cur.key === key ? cur.start : null),
    // 当前匹配的稳定标识：面板拿它做滚动依赖，光标停在同一处就不重复滚。
    curKey: cur ? cur.key + ':' + cur.start : null,
  };
}

// apply(entry) 把一条 replacePlan 结果写回（entry.item 带着调用方塞进 items 的字段）。
function useReplace(find, apply) {
  const run = (matches, single) => {
    const plan = F.replacePlan(matches, find.rq);
    if (!plan.length) { toast('没有可替换的内容', { variant: 'neutral' }); return; }
    const hits = plan.reduce((sum, entry) => sum + entry.changed, 0);
    plan.forEach(apply);
    // 每条目一次编辑事务：整批替换在版本历史里是 plan.length 步，不是一步。
    toast(single ? '已替换 1 处'
      : '已替换 ' + hits + ' 处' + (plan.length > 1 ? '（' + plan.length + ' 条，可逐条撤销）' : ''),
      { variant: 'positive' });
  };
  return [
    () => { if (find.cur) run([find.cur], true); },
    () => run(find.matches, false),
  ];
}

// accessory：Translate 面板把「替换范围」选择器装在第二行（Mac
// `FindReplaceBarView.accessory` + `layoutWithAccessory`，位置在替换框与
// Aa/W/.* 之间）。其它面板没有这个控件，保持原来的两行布局。
function FindBar({ find, placeholder, onReplace, onReplaceAll, accessory }) {
  const { matches, opts, setOpts } = find;
  const opt = (key, label, tip) => (
    <button className={'vk-findbar__opt' + (opts[key] ? ' vk-findbar__opt--on' : '')}
      data-tip={tip} aria-label={tip} aria-pressed={!!opts[key]}
      onClick={() => setOpts((o) => ({ ...o, [key]: !o[key] }))}>{label}</button>
  );
  const replaceInput = (className, style) => (
    <input className={className} style={style} placeholder="替换为"
      value={find.rq} aria-label="替换为" onChange={(e) => find.setRq(e.target.value)}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); find.close(); } }} />
  );
  const optButtons = (
    <>
      {opt('caseSens', 'Aa', '区分大小写')}
      {opt('word', 'W', '全词匹配')}
      {opt('regex', '.*', '正则表达式')}
    </>
  );
  const actions = (
    <>
      <button className="s2-btn s2-btn--S s2-btn--secondary" disabled={!find.cur} onClick={onReplace}>替换</button>
      <button className="s2-btn s2-btn--S s2-btn--secondary" disabled={!matches.length} onClick={onReplaceAll}>全部</button>
    </>
  );
  return (
    <div className={'vk-findbar' + (accessory ? ' tr-findbar' : '')} data-screen-label="Find and replace">
      <div className="vk-row">
        <div className="vk-search" style={{ flex: 1 }}>
          <Ic name="search" size={13} />
          <input ref={find.inputRef} className="vk-input" style={{ height: 26 }} placeholder={placeholder}
            value={find.q} aria-label="查找" onChange={(e) => find.setQ(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); find.goto(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { e.preventDefault(); find.close(); }
            }} />
        </div>
        <span className="vk-findbar__count vk-mono">{F.countLabel(find.query, matches, find.idx)}</span>
        <QBtn icon="chevron-up" size="S" tip="上一个匹配" disabled={!matches.length} onClick={() => find.goto(-1)} />
        <QBtn icon="chevron-down" size="S" tip="下一个匹配" disabled={!matches.length} onClick={() => find.goto(1)} />
        <QBtn icon="close" size="S" tip="关闭查找" onClick={find.close} />
      </div>
      {accessory ? (
        <div className="tr-findbar__replace">
          {replaceInput('vk-input tr-findbar__replacebox', { height: 26 })}
          {accessory}
          <div className="tr-findbar__opts">{optButtons}</div>
          <div className="tr-findbar__actions">{actions}</div>
        </div>
      ) : (
        <div className="vk-row" style={{ marginTop: 6 }}>
          {replaceInput('vk-input', { height: 26, flex: 1 })}
          {optButtons}
          {actions}
        </div>
      )}
    </div>
  );
}

// Translate 专属：查找栏里的「替换范围」选择器（Mac
// `TranslatePaneFindBar.openScopeMenu()`；原型 translate.jsx 的 `tr-findscope`）。
function ScopePicker({ scope, onPick }) {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  const info = TP.scopeInfo(scope);
  const tip = info.tip;
  return (
    <>
      <button ref={btn} className="vk-input vk-pickerbtn tr-findscope" data-tip={tip} aria-label={tip}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <span>{info.short}</span><Ic name="chevron-down" size={12} />
      </button>
      {open ? (
        <Menu anchorRef={btn} onClose={() => setOpen(false)} align="start" width={258}
          items={TP.SCOPES.map((it) => ({
            label: it.label,
            suffix: it.id === scope ? '已选' : undefined, suffixAccent: it.id === scope,
            onClick: () => onPick(it.id),
          }))} />
      ) : null}
    </>
  );
}

// 把当前匹配滚进视口中央（虚拟列表先把目标行滚出来，再对准 <mark> 本身）。
function centerMatch(scrollRef, virtualHandle, cur) {
  if (!cur) return;
  const handle = virtualHandle && virtualHandle.current;
  if (handle && handle.centerKey) handle.centerKey(cur.key, true);
  requestAnimationFrame(() => {
    const c = scrollRef.current;
    if (!c) return;
    const el = c.querySelector('[data-match-cur]');
    if (!el) return;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top >= cr.top + 8 && er.bottom <= cr.bottom - 8) return;   // 已经在视口里
    const target = c.scrollTop + (er.top - cr.top) - cr.height / 2 + er.height / 2;
    const maximum = Math.max(0, c.scrollHeight - c.clientHeight);
    c.scrollTo({ top: Math.floor(Math.max(0, Math.min(maximum, target))), behavior: 'smooth' });
  });
}

// 版本历史入口（原型 transcript.jsx 工具行的 clock 按钮 = Versions & branches）。
function HistoryBtn() {
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  return (
    <>
      <QBtn icon="clock" size="S" tip="版本历史" selected={open} refEl={btn} onClick={() => setOpen(true)} />
      {open ? <window.HistoryPop anchorRef={btn} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

// AI 工具（原型工具行右端的方形 accent 按钮）。Studio 的 AI 动作一律由 Agent
// 执行：点菜单项 = 往 edits.json 的 requests[] 入队并弹说明对话框（agent.jsx 的
// useAgentAction），标题栏的 AgentQueue 随后显示待处理请求、可撤回。
// 只列 Studio 有对应 Agent/CLI 流程的动作；item.tab 会先把面板切过去，让请求的
// 结果落在用户正看着的 tab 上。
// 例外：带 item.onClick 的项是纯前端动作（目前只有「复制全部译文」，Mac
// `TranslatePaneActions.copyAll()` 同样不经 AI 流程），点它不入队、不弹说明框。
function AiMenuBtn({ items, run, disabled }) {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const btn = useRef(null);
  return (
    <>
      <button ref={btn} className="s2-btn s2-btn--S s2-btn--accent bcs-aibtn" disabled={disabled}
        data-tip="AI 工具" aria-label="AI 工具" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(true)}>
        <Ic name="ai-sparkle" size={16} />
      </button>
      {open ? (
        <Menu anchorRef={btn} onClose={() => setOpen(false)} width={248}
          items={items.map((it) => (it === '-' ? '-' : {
            icon: it.icon, label: it.label, disabled: it.disabled,
            onClick: () => {
              if (it.onClick) { it.onClick(); return; }
              if (it.tab) app.setTab(it.tab);
              run(it.action, it.label, it.params);
            },
          }))} />
      ) : null}
    </>
  );
}

// Pane 现在按 tab 条件挂载，切走即卸载。滚动位置存在 store 的可变对象里，
// 切回来恢复视口（不是状态，不触发渲染）。
function usePaneScroll(ref, key) {
  const store = useApp().paneScroll;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (store[key]) el.scrollTop = store[key];
    return () => { store[key] = el.scrollTop; };
  }, []);
}

// ---------- shared: editable text block (contentEditable, commit on blur) ----------
// 进入编辑时光标有三种落点，优先级从高到低：
//   1) caretAt —— 外部交接的归一化偏移（拆/合之后把光标放回缝上）；
//   2) 鼠标命中点 —— 点哪儿光标就在哪儿（caretPositionFromPoint / WebKit 回退）；
//   3) 行尾 —— 命中点算不出来或不在本编辑器内时的兜底。
// onKeyOps 的处理函数返回 true 表示"结构事务已发出"，此时才取消 blur 提交
// （文本已经作为同一事务的第一个 op 一起发走了）；返回 false 表示没做动作，
// 编辑框原样留着，用户输入不丢。
function EditableBlock({ value, viewValue, placeholder, className, lang, onCommit, onKeyOps, caretAt, onCaretDone, onEditingChange }) {
  const [editing, setEditing] = useState(false);
  const [caretSeq, setCaretSeq] = useState(0);
  const ref = useRef(null), cancel = useRef(false);
  // 谁在编辑要让列表知道（虚拟化时钉住这一行不回收）。放在 effect 里上报有两层
  // 意义：进入编辑时钉得够早（这一行此刻必然可见），退出编辑时"解钉"被推迟到
  // blur→commit 的同步链完全展开之后——在 commit 里同步触发父级 setState，
  // 正是 Mac 端 NSTableView 那条重入链的形状（设计文档 §2）。
  useEffect(() => { if (onEditingChange) onEditingChange(editing); }, [editing]);
  const point = useRef(null);   // 进入编辑时的鼠标视口坐标
  const goal = useRef(null);    // 进入编辑时的归一化目标偏移

  useEffect(() => {
    if (caretAt == null) return;
    point.current = null;
    goal.current = caretAt;
    setEditing(true);
    setCaretSeq((n) => n + 1);   // 已在编辑中时也要重新放一次光标
    if (onCaretDone) onCaretDone();
  }, [caretAt]);

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    // 先按坐标算命中点再 focus——focus 可能滚动容器，把坐标算歪。
    let r = null;
    if (goal.current != null) r = window.vkCaretRangeAt(el, goal.current);
    else if (point.current) r = window.vkCaretRangeAtPoint(el, point.current.x, point.current.y);
    if (!r) { r = document.createRange(); r.selectNodeContents(el); r.collapse(false); }
    try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
    window.vkPlaceCaret(r);
    point.current = null; goal.current = null;
  }, [editing, caretSeq]);

  const commit = () => {
    if (!ref.current) return;
    const full = ref.current.innerText.replace(/\s+/g, ' ').trim();
    setEditing(false);
    if (!cancel.current && full !== value) onCommit(full);
    cancel.current = false;
  };
  // 结构操作真的发出去了才丢弃编辑框；throw 也不能把 cancel 留成 true。
  const runOp = (fn, c) => {
    let issued = false;
    try { issued = fn(c) === true; } finally {
      if (issued) { cancel.current = true; if (ref.current) ref.current.blur(); }
    }
  };
  // 两个分支给不同 key：退出编辑时强制换掉 DOM 节点。否则 value 没变、React 不会
  // 重画文本节点，用户在 contentEditable 里改过又撤销/被拒的内容会一直留在屏幕上，
  // 还会污染下一次 vkCaretOffset 读到的 baseText。
  if (editing) {
    return <div key="edit" ref={ref} className={className} lang={lang} contentEditable suppressContentEditableWarning spellCheck={false}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        // 输入法组字期间的 Enter/Backspace 属于候选框，不能拿去拆合。
        if (e.nativeEvent && (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)) return;
        if (e.key === 'Escape') { cancel.current = true; ref.current.blur(); e.preventDefault(); return; }
        if (e.key !== 'Enter' && e.key !== 'Backspace' && e.key !== 'Delete') return;
        const c = window.vkCaretOffset(ref.current);
        if (!c) { if (e.key === 'Enter') { e.preventDefault(); ref.current.blur(); } return; }
        if (e.key === 'Enter') {
          e.preventDefault();
          const canSplit = onKeyOps && onKeyOps.split && c.offset > 0 && c.offset < c.text.length;
          if (!canSplit) { ref.current.blur(); return; }
          runOp(onKeyOps.split, c);
          return;
        }
        if (!c.collapsed || !onKeyOps) return;
        if (e.key === 'Backspace' && c.offset === 0 && onKeyOps.mergeUp) {
          e.preventDefault(); runOp(onKeyOps.mergeUp, c);
        }
        if (e.key === 'Delete' && c.offset >= c.text.length && onKeyOps.mergeDown) {
          e.preventDefault(); runOp(onKeyOps.mergeDown, c);
        }
      }}>{value}</div>;
  }
  const empty = !value;
  return (
    <div key="view" className={className + (empty ? ' tg-trans--empty' : '')} data-ph={placeholder} lang={lang}
      onMouseDown={(e) => { point.current = { x: e.clientX, y: e.clientY }; }}
      onClick={() => setEditing(true)}>
      {viewValue == null ? value : viewValue}
    </div>
  );
}

// karaoke projection of a cue while it plays
// 逐帧重渲染的只有这一个组件：它自己订阅时钟，不靠父级把 t 传下来。
function Karaoke({ cue }) {
  const M = window;
  const { t } = usePlayer();
  const wt = M.vkWordTimes({ text: cue.text, start: cue.start, end: cue.end });
  const cur = M.vkWordIdxAt(wt, t);
  return (
    <div className="sb-text sb-text--karaoke">
      {wt.map((w, i) => (
        <React.Fragment key={i}>{i ? ' ' : ''}
          <span className={'tr-w' + (i < cur ? ' tr-w--spoken' : i === cur ? ' tr-w--cur' : '')}>{w.w}</span>
        </React.Fragment>
      ))}
    </div>
  );
}

// active/playing 由调用方给：这个按钮出现在每一行里，自己订阅时钟等于
// 整张表每帧重渲染。
function PlayCueBtn({ cue, active, playing }) {
  const app = useApp();
  return (
    <button className={'vk-seg__play sb__play' + (active && playing ? ' vk-seg__play--on' : '')}
      data-tip={active && playing ? '暂停' : '播放此句'} aria-label="播放"
      onClick={(e) => {
        e.stopPropagation();
        if (active && playing) app.setPlayer((p) => ({ ...p, playing: false }));
        else { app.seekSource('main', cue.start + 0.01); app.setPlayer((p) => ({ ...p, playing: true })); }
      }}>
      {active && playing ? <span className="vk-seg__pause"><span></span><span></span></span> : <Ic name="play" size={12} />}
    </button>
  );
}

function CpsChip({ text, dur, lang }) {
  const app = useApp();
  const level = app.cpsLevel(text, dur, lang);
  const v = Math.round(app.cps(text, dur));
  return (
    <span className={'tr-chip tr-chip--cps' + (level === 'warn' ? ' tr-chip--warn' : level === 'bad' ? ' tr-chip--bad' : '')}
      data-tip={'阅读速度 · 每秒 ' + v + ' 字符'}><b>{v}</b><i>cps</i></span>
  );
}

// chapters → rows helper
// rows 与 chapters 都按时间升序，单趟双指针即可（原实现每行一次 findIndex，
// 5000 行 × 几十章就是几十万次比较）。落在章节之间的行沿用旧语义：归最后一章。
function byChapter(doc, rows, startOf) {
  const chs = doc.chapters || [];
  if (!chs.length) return [];
  const last = chs.length - 1;
  const out = chs.map((ch, ci) => ({ ch, ci, rows: [] }));
  let i = 0;
  for (const r of rows) {
    const t = startOf(r);
    while (i < chs.length && t >= chs[i].end) i++;
    out[i < chs.length && t >= chs[i].start ? i : last].rows.push(r);
  }
  return out.filter((c) => c.rows.length);
}

// Normal transcript body: neutral cue zebra + durable cut-word strikes. The
// edit branch remains plain text, so display-only attributes never leak into
// sourceParagraph commits.
function TranscriptRichText({ paragraph, cuts }) {
  const TW = window.BCS_TRANSCRIPT_WORDS;
  return paragraph.cues.map((cue, cueIndex) => (
    <React.Fragment key={cue.id}>
      {cueIndex ? ' ' : ''}
      <span className={'vk-cue' + (cueIndex % 2 ? ' vk-cue--alt' : '')}>
        {TW.cueRuns(cue, cuts).map((run, runIndex) => (
          run.wordId ? (
            <span key={run.wordId} className={run.cut ? 'vk-cutword' : undefined}>{run.text}</span>
          ) : <React.Fragment key={'raw-' + runIndex}>{run.text}</React.Fragment>
        ))}
      </span>
    </React.Fragment>
  ));
}

// ===================== Transcript =====================
function TranscriptPane() {
  const app = useApp();
  const { doc } = app;
  const scrollRef = useRef(null);
  const player = usePlayer();   // Transcript 是词级卡拉 OK，本来就要逐帧
  usePaneScroll(scrollRef, 'transcript');
  const paras = useMemo(() => app.paragraphs(doc), [doc]);
  const cuts = useMemo(() => (((doc.timeline || {}).views || {}).main || {}).cuts || [], [doc]);
  const paraIndex = useMemo(
    () => new Map(paras.map((paragraph, index) => [paragraph.id, index])),
    [paras],
  );
  const active = paras.find((p) => player.t >= p.start && player.t < p.end);
  let activeWordKey = active && active.id;
  if (active) {
    for (let cueIndex = 0; cueIndex < active.cues.length; cueIndex++) {
      const cue = active.cues[cueIndex];
      if (player.t < cue.start || player.t >= cue.end) continue;
      const words = window.vkWordTimes(cue);
      activeWordKey = cue.id + ':' + window.vkWordIdxAt(words, player.t);
      break;
    }
  }
  const follow = usePlaybackFollow(
    scrollRef, 'data-para', active && active.id, player.playing, null,
    '.vk-w--cur', activeWordKey, player.t,
  );

  // 查找与替换：段落是转写的编辑单位，替换整段落文本走 editParagraph。
  const findItems = useMemo(() => paras.map((p) => ({ key: p.id, text: p.text, para: p })), [paras]);
  const find = useFind(findItems);
  const [replaceOne, replaceAll] = useReplace(find, (entry) => app.editParagraph(entry.item.para, entry.text));
  useEffect(() => { centerMatch(scrollRef, null, find.cur); }, [find.curKey]);
  const [runAgent, agentDialog] = window.useAgentAction();
  // M69：还没识别过说话人的文档，这条流程的文案是"第一次识别"。Mac 读
  // `doc.speakersIdentified`，其真实投影就是"说话人多于一个"
  // （Adapters/ShellProjectAdapter.swift:2722 `speakersIdentified: speakers.count > 1`），
  // 而 studio/data.json 的 `speakers` 表正是同一份数据，所以判据直接照搬。
  const speakersIdentified = Object.keys(doc.speakers || {}).length > 1;

  return (
    <div className="vk-transcript" data-screen-label="Transcript">
      <div className="vk-transcript__toolbar">
        <QBtn icon="search" size="S" tip="查找和替换" selected={find.open} onClick={find.toggle} />
        <HistoryBtn />
        <span className="vk-spacer"></span>
        <window.StylePicker ctx="sub" />
        {/* 顺序对齐 Mac TranscriptPaneToolbar.swift:46-87：语义分段（最基础的
            那一段坐在 AI 组最上面）→ 润色文稿 → 生成章节标题 → 识别说话人 →
            分隔线 → 翻译字幕。Mac 在分隔线前还有「清理音频 / 建议 B-roll」，
            Studio 没有对应流程，按 §3.9 直接省略而不是留占位项。 */}
        <AiMenuBtn items={[
          { icon: 'text-lines', label: '语义分段', action: 'segment' },
          { icon: 'edit', label: '润色文稿', action: 'polish' },
          { icon: 'bookmark', label: '生成章节标题', action: 'chapters' },
          { icon: 'user-group', label: speakersIdentified ? '重新识别说话人' : '识别说话人', action: 'speakers' },
          '-',
          { icon: 'comment', label: '翻译字幕', action: 'translate', tab: 'translate' },
        ]} run={runAgent} />
      </div>
      {find.open ? (
        <FindBar find={find} placeholder="在转写中查找" onReplace={replaceOne} onReplaceAll={replaceAll} />
      ) : null}
      {agentDialog}
      <div className="vk-transcript__scroll" ref={scrollRef}>
        {byChapter(doc, paras, (p) => p.start).map((c) => (
          <section className="vk-chapter" key={c.ci}>
            <ChapterHead ch={c.ch} />
            {c.rows.map((p) => {
              const sp = doc.speakers[p.sp] || { name: p.sp, hue: 240 };
              const isActive = player.t >= p.start && player.t < p.end;
              const index = paraIndex.get(p.id);
              const previous = index > 0 ? paras[index - 1] : null;
              const next = index + 1 < paras.length ? paras[index + 1] : null;
              const mergeUp = previous && previous.sp === p.sp && previous.ch === p.ch
                ? (caret) => app.mergeParagraph(p, caret.text, -1) : null;
              const mergeDown = next && next.sp === p.sp && next.ch === p.ch
                ? (caret) => app.mergeParagraph(p, caret.text, 1) : null;
              // 命中的段落让位给高亮视图：卡拉 OK 与 cue 斑马纹此刻都让路，
              // 否则 <mark> 会被逐词 span 切碎（原型 ParaBody §8.6 同序）。
              const marks = find.marksFor(p.id);
              return (
                <div key={p.id} data-para={p.id} className={'vk-group vk-para' + (isActive ? ' vk-para--active' : '')}
                  style={{ borderLeftColor: spHue(sp.hue) }}>
                  <div className="vk-group__head">
                    <span className="vk-group__sp" style={{ color: `oklch(0.5 0.14 ${sp.hue})` }}>
                      <EditableText value={sp.name} onCommit={(value) => app.editSpeaker(p.sp, value)}
                        className="vk-group__sp-name" placeholder={p.sp} />
                    </span>
                    <button className="vk-group__time vk-mono" data-tip="跳转到此处" onClick={() => app.seekSource('main', p.start)}>{fmtRange(p.start, p.end)}</button>
                    <PlayCueBtn cue={p} active={isActive} playing={player.playing} />
                  </div>
                  {player.playing && isActive && !marks.length ? (
                    <div className="vk-segtext vk-segtext--ro vk-segtext--words">
                      {p.cues.map((cue, ci2) => {
                        const wt = window.vkWordTimes({ text: cue.text, start: cue.start, end: cue.end });
                        const playing = player.playing && player.t >= cue.start && player.t < cue.end;
                        const cur = playing ? window.vkWordIdxAt(wt, player.t) : -1;
                        return (
                          <React.Fragment key={cue.id}>
                            {ci2 ? ' ' : ''}
                            {wt.map((w, i) => (
                              <React.Fragment key={i}>{i ? ' ' : ''}
                                <span className={'vk-w'
                                  + (cur >= 0 ? (i < cur ? ' vk-w--spoken' : i === cur ? ' vk-w--cur' : '') : ' vk-w--spoken')
                                  + (window.BCS_TRANSCRIPT_WORDS.wordIsCut(w, cuts) ? ' vk-cutword' : '')}
                                  onClick={() => app.seekSource('main', w.start)}>{w.w}</span>
                              </React.Fragment>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </div>
                  ) : (
                    <EditableBlock value={p.text} placeholder="输入转写段落…"
                      className="vk-segtext vk-segtext--words"
                      viewValue={marks.length
                        ? <Highlight text={p.text} matches={marks} curStart={find.curStartIn(p.id)} />
                        : <TranscriptRichText paragraph={p} cuts={cuts} />}
                      onCommit={(value) => app.editParagraph(p, value)}
                      onKeyOps={{
                        split: (caret) => app.splitParagraphAtCaret(p, caret.text, caret.offset),
                        mergeUp,
                        mergeDown,
                      }} />
                  )}
                </div>
              );
            })}
          </section>
        ))}
        <div style={{ height: 60 }}></div>
      </div>
      {!follow.following && player.playing ? (
        <FollowPill direction={follow.offDir} title="Jump to current word"
          onClick={follow.jumpToCurrent} />
      ) : null}
    </div>
  );
}

// ===================== Subtitle =====================
// React.memo：字幕表是全应用最长的列表，doc 不变时 cue 引用稳定（store 的 doc
// 是 useMemo 出来的），所以只有 active 真的翻转的那一两张卡会重渲染。
const CueCard = React.memo(function CueCard({ cue, num, prev, next, active, playing, caretAt, onCaretDone, onEditingChange, marks = NO_MARKS, curStart = null }) {
  const app = useApp();
  const { doc } = app;
  const sp = doc.speakers[cue.sp] || { name: cue.sp, hue: 240 };
  const dur = Math.max(0.1, cue.end - cue.start);
  const selected = app.sel && app.sel.cueId === cue.id;
  const canMergeUp = !!prev && prev.sp === cue.sp;
  const canMergeDown = !!next && next.sp === cue.sp;
  // 把 cue.id 绑在子组件这一侧：父级下发的回调保持同一个引用，memo 才不会失效。
  const editingChange = useCallback((on) => { if (onEditingChange) onEditingChange(cue.id, on); }, [onEditingChange, cue.id]);

  // c 是编辑框里的实时文本+光标（键盘入口）；按钮入口没有 c，走当前已保存文本。
  const split = (c) => {
    if (!app.splitCueAtCaret(cue, c.text, c.offset)) return false;
    toast('已拆分字幕（译文切分由 Agent 应用后重派生）', { variant: 'neutral' });
    return true;
  };
  // 成功文案交给 store 在应答后发：这里的同说话人守卫拦不住段落分隔等派生抵消，
  // 成败要等后端复跑派生才知道。乐观弹提示会和随后的"无法合并"并排挂着自相
  // 矛盾——toast 是堆叠的，后发的不覆盖先发的。
  const mergeUp = (c) => {
    if (!canMergeUp) return false;
    app.mergeCues(prev, cue, cue.id, c && c.text, '已并入上一条字幕');
    return true;
  };
  // 后端 merge 语义是"这一条并入上一条"，所以向下合并提交的是下一条的 id。
  const mergeDown = (c) => {
    if (!canMergeDown) return false;
    app.mergeCues(cue, next, cue.id, c && c.text, '已合并下一条字幕');
    return true;
  };

  return (
    <div className={'sb' + (active ? ' sb--active' : '') + (cue.paraStart ? ' sb--para-start' : '')} data-sb={cue.id} data-screen-label={'Subtitle · #' + num}
      style={{ borderLeftColor: spHue(sp.hue), outline: selected && !active ? '2px solid var(--accent-color-400)' : undefined }}>
      {canMergeUp ? (
        <button className="tg-mergeup" data-tip="并入上一条字幕" aria-label="向上合并" onClick={mergeUp}>
          <Ic name="merge-lines" size={12} />向上合并
        </button>
      ) : null}
      <div className="sb__head">
        <span className="sb__num vk-mono">{num}</span>
        <span className="sb__sp" style={{ color: `oklch(0.5 0.14 ${sp.hue})` }}>{sp.name}</span>
        <PlayCueBtn cue={cue} active={active} playing={playing} />
        <TimecodeChip start={cue.start} end={cue.end} onApply={(s, e) => { app.retimeCue(cue.id, s, e); toast('已更新时间码', { variant: 'positive' }); }} />
        {cue._edited ? <span className="bcs-editchip" data-tip="本地修改，待 Agent 应用">已编辑</span> : null}
        <span className="vk-spacer"></span>
        <CpsChip text={cue.text} dur={dur} lang={(doc.meta.sourceLang || {}).code} />
      </div>
      {/* 命中的字幕让位给高亮视图（原型：查找期读态高亮压过卡拉 OK） */}
      {playing && active && !marks.length ? <Karaoke cue={cue} /> : (
        <EditableBlock value={cue.text} placeholder="输入字幕文本…" className="sb-text"
          viewValue={marks.length ? <Highlight text={cue.text} matches={marks} curStart={curStart} /> : undefined}
          caretAt={caretAt} onCaretDone={onCaretDone} onEditingChange={editingChange}
          onCommit={(v) => { app.editCue(cue.id, 'text', v); toast('字幕已更新', { variant: 'positive' }); }}
          onKeyOps={{ split, mergeUp, mergeDown }} />
      )}
    </div>
  );
});

// 章节头。标题缺省时（Agent 还没写过标题）本章第一句站位上屏，斜体表示"这不是
// 正式标题"，旁边给一条把 chapters 流程交给 Agent 的链接（原型 transcript.jsx §9.3）。
function ChapterHead({ ch }) {
  const app = useApp();
  const { doc } = app;
  const [runAgent, agentDialog] = window.useAgentAction();
  const titled = !!String(ch.title || '').trim();
  const standIn = useMemo(() => {
    if (titled) return '';
    const cues = doc.cues || [];
    const first = cues.find((c) => c.start >= ch.start && c.start < ch.end)
      || cues.find((c) => c.end > ch.start);
    const text = String((first && first.text) || '').trim();
    return text.length > 48 ? text.slice(0, 48) + '…' : text;
  }, [titled, doc.cues, ch.start, ch.end]);
  return (
    <div className="vk-chapter__head">
      <EditableText value={ch.title} placeholder={standIn || '未命名章节'}
        className={'vk-chapter__title' + (titled ? '' : ' vk-chapter__title--placeholder')}
        onCommit={(value) => app.editChapter(ch.id, value)} />
      <span className="vk-mono vk-dim vk-chapter__range">{fmtRange(ch.start, ch.end)}</span>
      {!titled ? (
        <button className="vk-linkbtn vk-chapter__writetitles" data-tip="让 Agent 为所有章节生成标题"
          aria-label="用 AI 写章节标题" onClick={() => runAgent('chapters', '生成章节标题')}>用 AI 写标题</button>
      ) : null}
      {agentDialog}
    </div>
  );
}

const subtitleRowClass = (row) => (row.kind === 'head' ? 'vk-vrow--head'
  : row.item.cue.paraStart ? 'vk-vrow--para' : '');

function SubtitlePane() {
  const app = useApp();
  const { doc } = app;
  const scrollRef = useRef(null);
  const listRef = useRef(null);
  const cues = doc.cues;
  const srcLang = (doc.meta.sourceLang || {}).code;
  usePaneScroll(scrollRef, 'subtitle');
  const fastCount = useMemo(() => cues.reduce((a, c) =>
    a + (app.cpsLevel(c.text, Math.max(0.1, c.end - c.start), srcLang) !== 'ok' ? 1 : 0), 0), [cues]);
  // 订阅"当前是哪一条"而不是时钟本身：这个值只在跨越 cue 边界时变，
  // 一秒变几次，而不是六十次。
  const { cueId: activeId, playing } = useActive();

  // 拆合后的光标交接：按时间锚点在新文档里找目标 cue（id 由首词派生，拆合后会变）。
  // 播放中该 cue 渲染的是 Karaoke 而不是编辑框，交接接不住，直接放弃。
  const pc = app.pendingCaret;
  const caretReady = !!pc && doc.rev >= pc.rev;
  const caretCue = caretReady && !playing ? app.cueAt(doc, pc.anchorTime) : null;
  const caretKey = caretCue ? caretCue.id : null;
  const { clearPendingCaret } = app;
  useEffect(() => {
    if (caretReady && !caretCue) clearPendingCaret();
  }, [caretReady, caretCue, clearPendingCaret]);

  // 谁在编辑：编辑态本来只活在 EditableBlock 里，虚拟化后列表必须知道，
  // 否则这一行滚出窗口就被回收 → 强制 blur → 提交 → 同步重排（设计文档 §2）。
  // lastEditKey 让刚编辑完的那一行多钉一会儿，避免"解钉"与提交挤在同一帧。
  const [editKey, setEditKey] = useState(null);
  const [lastEditKey, setLastEditKey] = useState(null);
  const onEditingChange = useCallback((key, on) => {
    setEditKey((cur) => (on ? key : cur === key ? null : cur));
    if (on) setLastEditKey(key);
  }, []);
  useEffect(() => { setLastEditKey(null); }, [cues]);

  // 查找与替换：字幕的编辑单位就是 cue，替换整条文本走 editCue。
  const findItems = useMemo(() => cues.map((cue) => ({ key: cue.id, text: cue.text })), [cues]);
  const find = useFind(findItems);
  const [replaceOne, replaceAll] = useReplace(find, (entry) => app.editCue(entry.key, 'text', entry.text));
  // 当前匹配所在的行必须钉住：虚拟列表回收它就滚不到、也高亮不出来。
  const pinned = useMemo(
    () => [editKey, lastEditKey, caretKey, find.cur && find.cur.key].filter(Boolean),
    [editKey, lastEditKey, caretKey, find.cur],
  );

  const rows = useMemo(() => cues.map((cue, i) => ({ cue, i })), [cues]);
  const vrows = useMemo(
    () => V.flatten(byChapter(doc, rows, (r) => r.cue.start), (r) => r.cue.id),
    [doc.chapters, rows],
  );

  // 播放/选中跟随：不能再靠 querySelector 找 DOM（目标很可能根本没渲染），
  // 改成问虚拟列表要它的偏移。
  const selectedKey = app.sel && app.sel.cueId;
  useEffect(() => {
    if (!playing && selectedKey && listRef.current) listRef.current.scrollToKey(selectedKey);
  }, [selectedKey, playing]);
  const follow = usePlaybackFollow(scrollRef, null, activeId, playing, listRef);
  useEffect(() => { centerMatch(scrollRef, listRef, find.cur); }, [find.curKey]);

  const renderRow = useCallback((row) => {
    if (row.kind === 'head') return <ChapterHead ch={row.ch} />;
    const { cue, i } = row.item;
    return (
      <CueCard cue={cue} num={i + 1} prev={cues[i - 1]} next={cues[i + 1]}
        active={cue.id === activeId} playing={playing}
        caretAt={caretKey === cue.id ? pc.offset : null}
        marks={find.marksFor(cue.id)} curStart={find.curStartIn(cue.id)}
        onCaretDone={clearPendingCaret} onEditingChange={onEditingChange} />
    );
  }, [cues, activeId, playing, caretKey, pc, clearPendingCaret, onEditingChange, find.byKey, find.curKey]);

  return (
    <div className="vk-subtitle" data-screen-label="Subtitle">
      <div className="vk-transcript__toolbar">
        <QBtn icon="search" size="S" tip="查找和替换" selected={find.open} onClick={find.toggle} />
        <span className="vk-spacer"></span>
        <window.StylePicker ctx="sub" />
      </div>
      {find.open ? (
        <FindBar find={find} placeholder="在字幕中查找" onReplace={replaceOne} onReplaceAll={replaceAll} />
      ) : null}
      {/* tr-statbar 是 Studio 独有的统计条（原型没有 cps/本地编辑计数），保留 */}
      <div className="tr-statbar">
        <div className="tr-statbar__stats">
          <span className="tr-stat"><b>{cues.length}</b> 条字幕</span>
          {fastCount ? <span className="tr-stat tr-stat--warn" data-tip="超出舒适阅读速度的字幕"><b>{fastCount}</b> 条语速过快</span> : null}
          {doc._pendingEdits ? <span className="tr-stat" data-tip="本地编辑待 Agent 应用到数据"><b>{doc._pendingEdits}</b> 处本地编辑</span> : null}
        </div>
      </div>
      <window.VirtualList className="vk-subtitle__scroll" scrollRef={scrollRef} handle={listRef}
        rows={vrows} estimate={V.estimateSubtitleRow} fingerprint={V.subtitleFingerprint}
        rowClass={subtitleRowClass} pinnedKeys={pinned} renderRow={renderRow} />
      {!follow.following && playing ? (
        <FollowPill direction={follow.offDir} title="Jump to current cue"
          onClick={follow.jumpToCurrent} />
      ) : null}
    </div>
  );
}

// ===================== Translate =====================
// v0.3：翻译的单位是句（sentence）——源句 1:1 译句；句内展示切分（pieces）
// 是 transAlign 覆盖层。整句改写走 sentence 通道（改写后降级整句上屏，由
// Agent 重切）；逐行微调走 piece 通道（拼接不变量由 store 维护）。
// 一句译文的展示形态由 transCues 决定：没有切分片（或只有一片 sentence 片）时
// 整句上屏，否则逐片配对。查找栏与卡片共用这两个投影，免得两处各判一次。
const sentencePiecesOf = (doc, sentenceId) => TP.sentencePieces(doc.transCues, sentenceId);
const sentenceIsWhole = TP.sentenceIsWhole;

function SentenceCard({ s, num, prev, next, find, srcIndex }) {
  const app = useApp();
  const { doc } = app;
  const first = srcIndex.cueById.get((s.cueIds || [])[0]) || {};
  const sp = doc.speakers[first.sp] || { name: first.sp || '', hue: 240 };
  const { t, playing } = usePlayer();
  const active = t >= s.start && t < s.end;
  const dur = Math.max(0.1, s.end - s.start);
  const empty = !(s.trans || '').trim();
  const translating = doc.status.phase === 'translating';
  const pieces = sentencePiecesOf(doc, s.id);
  const whole = sentenceIsWhole(s, pieces);
  // 对齐块层（对齐块设计 §7）：`correspondence: sentence` → 「整句对应」芯片；
  // `textBasis: display` → 「已为字幕改写」芯片，可展开看自然译句 `trans`；
  // 有 `blocks` 时每个配对行下画块刻度（片内块边界 = 合法拆分点）。
  const AB = window.BCS_ALIGN_BLOCKS;
  const chips = AB ? AB.cardChips(s) : { sentenceLevel: !!s.crossing, rewritten: false };
  const hasBlocks = !!(AB && AB.hasBlocks(s));
  const orderedPieces = AB ? AB.sentencePieces(doc.transCues, s.id) : pieces;
  const [showNatural, setShowNatural] = useState(false);
  const canSplitWhole = !empty && Array.isArray(s.sourceWordIds) && s.sourceWordIds.length >= 2;
  // 原文侧的查找条目键是 cue（源文本的编辑单位），见 translate-pane.js。
  const sourceCues = (s.cueIds || []).map((id) => srcIndex.cueById.get(id)).filter(Boolean);
  const srcMarksFor = useCallback((cueId) => find.marksFor(TP.sourceKey(cueId)), [find.byKey]);
  const srcCurFor = useCallback((cueId) => find.curStartIn(TP.sourceKey(cueId)), [find.curKey]);
  const srcHighlight = (text, words) => (find.query
    ? TP.lineHighlight(text, words, srcIndex.wordCue, srcMarksFor, srcCurFor) : null);
  const canMergePrev = app.canMergeTransParagraph(prev, s);
  const canMergeNext = app.canMergeTransParagraph(s, next);
  const mergeParagraph = (up, reference, caret) => {
    const upper = up ? prev : s, lower = up ? s : next;
    if (!app.mergeTransParagraph(upper, lower, s.id, reference, caret && caret.text)) return false;
    toast(up ? '已与上一句译文合并' : '已与下一句译文合并', { variant: 'neutral' });
    return true;
  };

  return (
    <div className={'tg' + (active ? ' tg--active' : '') + (empty ? ' tg--untrans' : '') + (s.stale ? ' tg--stale' : '') + (s.paraStart ? ' tg--para-start' : '')}
      data-tg={s.id} data-screen-label={'Translate · #' + num}
      style={{ borderLeftColor: spHue(sp.hue), '--rail': spHue(sp.hue) }}>
      {canMergePrev ? (
        <button className="tg-mergeup tg-mergeup--card" data-tip="移除段落边界并与上一句译文合并"
          aria-label="向上合并译文句" onClick={() => mergeParagraph(true, null, null)}>
          <Ic name="merge-lines" size={12} />向上合并
        </button>
      ) : null}
      <div className="tg__head">
        <span className="tg__sp" style={{ color: `oklch(0.5 0.14 ${sp.hue})` }}>{sp.name}</span>
        <PlayCueBtn cue={{ start: s.start, end: s.end }} active={active} playing={playing} />
        <span className="tg__time vk-mono">{fmtRange(s.start, s.end)}</span>
        {s._editedTrans ? <span className="bcs-editchip" data-tip="本地修改，待 Agent 应用">已编辑</span> : null}
        {!empty && whole && !s.aligned
          ? <span className="tr-chip tr-chip--warn" data-tip="译文切法缺失或失效，当前临时整句显示；请 Agent 定向重对齐">对齐待修</span> : null}
        {!empty && !whole && chips.sentenceLevel
          ? <span className="tr-chip" data-tip="整句对应：源、译共用整句时窗，不宣称逐行一一对应（语序交叉或低置信对齐时的稳妥显示），这不是对齐错误">整句对应</span> : null}
        {!empty && chips.rewritten
          ? <button type="button" className={'tr-chip tr-chip--btn' + (showNatural ? ' tr-chip--on' : '')}
              data-tip={showNatural ? '收起自然译句' : '为满足字幕行长按原文语序改写了译文；点击查看自然译句'}
              aria-pressed={showNatural} onClick={() => setShowNatural((v) => !v)}>已为字幕改写</button> : null}
        <span className="vk-spacer"></span>
        {empty
          ? (translating ? <span className="tr-chip tr-chip--warn"><span className="vk-spin"></span>翻译中…</span> : <span className="tr-chip tr-chip--untrans">未翻译</span>)
          : s.stale
          ? <span className="tr-chip tr-chip--warn" data-tip="原文在翻译后被修改过 — 请 Agent 重新翻译此句">已过期</span>
          : <CpsChip text={s.trans} dur={dur} lang={(doc.meta.targetLang || {}).code} />}
      </div>
      {chips.rewritten && showNatural ? (
        <div className="tg-natural" data-screen-label="Natural translation">
          <span className="tg-natural__label">自然译句</span>
          <span className="tg-natural__text" lang="zh">{s.trans}</span>
        </div>
      ) : null}
      {whole ? (
        <div className="tg-body">
          <div className="tg-orig">
            <div className={'tg-orig__line' + (playing && active ? ' tg-orig__line--active' : '')} onClick={() => app.seekSource('main', s.start)}>
              {/* 查找命中原文时让位给逐 cue 高亮视图：整句文本就是本句各 cue
                  文本按空格拼起来的，逐条画出来与直接画 s.text 同形，但每条的
                  偏移正好是 editCue 的口径。没命中就还是一整段文本。 */}
              {sourceCues.some((cue) => find.marksFor(TP.sourceKey(cue.id)).length)
                ? sourceCues.map((cue, index) => (
                    <React.Fragment key={cue.id}>{index ? ' ' : ''}
                      <Highlight text={cue.text} matches={find.marksFor(TP.sourceKey(cue.id))}
                        curStart={find.curStartIn(TP.sourceKey(cue.id))} />
                    </React.Fragment>
                  ))
                : s.text}
            </div>
          </div>
          <div className="tg-transcol">
            <EditableBlock value={s.trans || ''} placeholder="添加翻译…" className="tg-trans" lang="zh"
              viewValue={find.marksFor(s.id).length
                ? <Highlight text={s.trans || ''} matches={find.marksFor(s.id)} curStart={find.curStartIn(s.id)} />
                : undefined}
              onCommit={(v) => { app.editTrans(s.id, 'sentence', v); toast('翻译已更新', { variant: 'positive' }); }}
              onKeyOps={(canSplitWhole || canMergePrev || canMergeNext) ? {
                split: canSplitWhole ? (c) => {
                  if (!app.splitTransPieceAtCaret(s.id, c.offset, c.text)) return false;
                  toast('已从光标处分割译文', { variant: 'neutral' });
                  return true;
                } : null,
                mergeUp: canMergePrev ? (caret) => mergeParagraph(true, s.id, caret) : null,
                mergeDown: canMergeNext ? (caret) => mergeParagraph(false, s.id, caret) : null,
              } : null} />
          </div>
        </div>
      ) : (
        <div className="tg-pairs">
          {pieces.map((tc, pieceIndex) => {
            const rowActive = playing && t >= tc.start && t < tc.end;
            const sourceLang = (doc.meta.sourceLang || {}).code || doc.meta.sourceLang || doc.lang || 'en';
            // 一片译文的源词区间常跨多条源字幕：源侧按 cue 边界分组成子行，
            // 「多对一」才看得见。分组是渲染期投影，不写回 transAlign，也不
            // 参与对齐决策；拿不到 cue 词表时自动退回纯宽度折行。
            // M122：≤2 词的碎片子行会并进相邻子行（mergeShortRuns），因此一个
            // part 可能跨 cue 边界——data-cue-id 取其首个 cue，纯展示用途。
            const sourceParts = window.BCS_SUBTITLE.sourceCueParts(tc, doc.cues, sourceLang, 42);
            const multiCue = sourceParts.length > 1;
            const rowDur = Math.max(0.1, tc.end - tc.start);
            const rowLang = (doc.meta.targetLang || {}).code;
            const rowCpsLevel = app.cpsLevel(tc.text, rowDur, rowLang);
            const canStructure = s.mode === 'manyToOne'
              && Number.isInteger(tc.wordFrom) && Number.isInteger(tc.wordTo);
            const segments = hasBlocks && canStructure ? AB.pieceSegments(s, orderedPieces, tc) : [];
            const mergeUp = (caret) => {
              if (pieceIndex === 0) return canMergePrev
                ? mergeParagraph(true, tc.id, caret) : false;
              if (!app.mergeTransPieces(pieces[pieceIndex - 1], tc)) return false;
              toast('已与上一译文片合并', { variant: 'neutral' });
              return true;
            };
            const mergeDown = pieceIndex + 1 === pieces.length && canMergeNext
              ? (caret) => mergeParagraph(false, tc.id, caret) : null;
            return (
              <div key={tc.id} className={'tg-pair' + (rowActive ? ' tg-pair--active' : '')}>
                {canStructure && pieceIndex > 0 ? (
                  <button className="tg-mergeup tg-mergeup--piece" data-tip="与上一译文片合并"
                    data-piece-id={tc.id} data-word-from={tc.wordFrom} data-word-to={tc.wordTo}
                    aria-label="向上合并译文片" onClick={mergeUp}>
                    <Ic name="merge-lines" size={12} />向上合并
                  </button>
                ) : null}
                <div className="tg-orig">
                  <div className={'tg-orig__line tg-orig__line--segmented'
                    + (multiCue ? ' tg-orig__line--multicue' : '')
                    + (rowActive ? ' tg-orig__line--active' : '')}>
                    {sourceParts.length ? sourceParts.map((part) => (
                      <div className="tg-orig__part" key={`${tc.id}:${part.key}`}
                        data-cue-id={part.cueId || undefined}
                        data-tip={fmtRange(part.start, part.end)}
                        onClick={() => app.seekSource('main', part.start)}>
                        {/* 原文侧的匹配偏移是相对整条 cue.text 的，这里画的却是
                            M122 的词区间子行（还可能跨 cue）——lineHighlight 逐词
                            把偏移换算过来，换算不成立就退回纯文本，绝不画错位置
                            的 <mark>。 */}
                        {part.lines.map((line, index) => {
                          const hl = srcHighlight(line.text, line.words);
                          return (
                            <span className="tg-orig__subline" key={`${tc.id}:${part.key}:${index}`}>
                              {hl ? <Highlight text={line.text} matches={hl.marks} curStart={hl.curStart} /> : line.text}
                            </span>
                          );
                        })}
                      </div>
                    )) : <div className="tg-orig__part tg-orig__part--empty">—</div>}
                  </div>
                </div>
                <div className="tg-transcol">
                  {rowCpsLevel !== 'ok'
                    ? <span className="tg-pair__cps"><CpsChip text={tc.text} dur={rowDur} lang={rowLang} /></span>
                    : null}
                  <EditableBlock value={tc.text} placeholder="…" className="tg-trans" lang="zh"
                    viewValue={find.marksFor(tc.id).length
                      ? <Highlight text={tc.text} matches={find.marksFor(tc.id)} curStart={find.curStartIn(tc.id)} />
                      : undefined}
                    onCommit={(v) => { app.editTrans(tc.id, 'piece', v); toast('译文行已更新', { variant: 'positive' }); }}
                    onKeyOps={(canStructure || (pieceIndex === 0 && canMergePrev) || mergeDown) ? {
                      // 跨句合并会把未提交文本折进整卡 value；句内结构合并仍沿用
                      // translationStructure 的逐片 CAS。
                      split: canStructure ? (c) => {
                        if (!app.splitTransPieceAtCaret(tc.id, c.offset, c.text)) {
                          if (segments.length === 1) toast('这一片只有一个对齐块，不能再拆', { variant: 'neutral' });
                          return false;
                        }
                        toast(hasBlocks ? '已在最近的对齐块边界分割译文' : '已从光标处分割译文', { variant: 'neutral' });
                        return true;
                      } : null,
                      mergeUp: pieceIndex > 0 || canMergePrev ? mergeUp : null,
                      mergeDown,
                    } : null} />
                  {segments.length ? (
                    <div className="tg-blockstrip" aria-hidden="true"
                      data-tip={segments.length > 1 ? '对齐块刻度：Enter 拆分会吸附到刻度间隙' : '对齐块刻度：这一片是一个整块'}>
                      {segments.map((seg) => (
                        <span key={seg.key}
                          className={'tg-blockstrip__seg'
                            + (seg.flags.includes('weak') ? ' tg-blockstrip__seg--weak' : '')
                            + (seg.flags.includes('local-reorder') ? ' tg-blockstrip__seg--reorder' : '')}
                          style={{ flexGrow: Math.max(1, seg.chars) }}>
                          {seg.flags.includes('local-reorder')
                            ? <i className="tg-blockstrip__flag" title="块内局部换序">换序</i> : null}
                          {seg.flags.includes('weak')
                            ? <i className="tg-blockstrip__flag" title="仅软对齐边支撑，置信度低">弱</i> : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 外壳只分发（不带条件 hooks）：无翻译目标时空态引导，有则渲染正体。
function TranslatePane() {
  const app = useApp();
  if (!app.doc.meta.targetLang) {
    return (
      <div className="vk-translate" data-screen-label="Translate">
        <div className="bcs-empty">
          <Ic name="comment" size={28} />
          <b>还没有译文</b>
          <span className="vk-dim">在 Agent 对话里说「翻译成中文」即可 —— 翻译进度和结果会实时出现在这里。</span>
        </div>
      </div>
    );
  }
  return <TranslateBody />;
}

function TranslateBody() {
  const app = useApp();
  const { doc } = app;
  const scrollRef = useRef(null);
  usePaneScroll(scrollRef, 'translate');
  const [langOpen, setLangOpen] = useState(false);
  const langBtn = useRef(null);
  const src = doc.meta.sourceLang || { code: 'und', name: '—', short: '—' };
  const dst = doc.meta.targetLang;
  const sentences = doc.sentences || [];
  const done = sentences.filter((s) => (s.trans || '').trim()).length;
  const untrans = sentences.length - done;
  const stale = sentences.filter((s) => s.stale).length;
  const pct = Math.round((done / Math.max(1, sentences.length)) * 100);
  const translating = doc.status.phase === 'translating';
  const player = usePlayer();
  const active = app.sentenceAt(doc, player.t);
  const follow = usePlaybackFollow(
    scrollRef, 'data-tg', active && active.id, player.playing, null,
    null, null, player.t,
  );

  // cue 表 + 词 id → cue 的索引：卡片用它取说话人、画原文行、换算原文高亮偏移。
  const srcIndex = useMemo(() => TP.sourceIndex(doc.cues), [doc.cues]);

  // 查找与替换：这一栏两侧都能搜（Mac TranslatePaneFindBar.swift:22-40 的
  // `TrReplaceScope`）。范围在一次扫描里是不变量，所以在建条目时就裁掉；
  // 译文条目的键是 editTrans 的 key（整句 / 逐行片），原文条目的键是 cue
  // （源文本的编辑单位，写路径 editCue），两个命名空间靠 `src:` 前缀分开。
  const [scope, setScope] = useState(TP.DEFAULT_SCOPE);
  const findItems = useMemo(() => TP.findItems(doc, scope),
    [sentences, doc.transCues, doc.cues, scope]);
  const find = useFind(findItems);
  const [replaceOne, replaceAll] = useReplace(find, (entry) => {
    if (entry.item.kind === 'cue') app.editCue(entry.item.cueId, 'text', entry.text);
    else app.editTrans(entry.key, entry.item.kind, entry.text);
  });
  useEffect(() => { centerMatch(scrollRef, null, find.cur); }, [find.curKey]);
  const [runAgent, agentDialog] = window.useAgentAction();

  // 「复制全部译文」是纯前端动作，不入 Agent 队列（Mac
  // TranslatePaneActions.swift:94-106 的 copyAll：一行一个投递片，空行丢掉）。
  const copyLines = TP.deliveryLines(doc);
  const copyAll = () => {
    window.writeClipboard(copyLines.join('\n')).then((ok) =>
      toast(ok ? '已复制 ' + copyLines.length + ' 行' + dst.native : '无法复制 — 请检查剪贴板权限',
        { variant: ok ? 'positive' : 'negative' }));
  };

  const rows = sentences.map((s, i) => ({ s, i }));
  return (
    <div className="vk-translate" data-screen-label="Translate">
      <div className="vk-transcript__toolbar">
        <button ref={langBtn} className="tr-langbtn" onClick={() => setLangOpen(true)} aria-label="目标语言" data-tip="切换目标语言">
          <span className="tr-langbtn__src">{src.short}</span>
          <Ic name="chevron-right" size={12} />
          <span className="tr-langbtn__chip">{dst.chip}</span>
          <span className="tr-langbtn__name">{dst.native}</span>
          <Ic name="chevron-down" size={12} />
        </button>
        {langOpen ? (
          <Menu anchorRef={langBtn} onClose={() => setLangOpen(false)} align="start" width={240} items={[
            { label: dst.native, sub: dst.name, suffix: '✓', onClick: () => {} },
          ]} />
        ) : null}
        <QBtn icon="search" size="S" tip="查找和替换" selected={find.open} onClick={find.toggle} />
        <span className="vk-spacer"></span>
        <window.StylePicker ctx="bi" />
        {/* Mac TranslatePaneActions.swift:38-63 的 AI 菜单是「翻译新语言… /
            重新翻译 X… / 重新对齐 X 行… / 分隔线 / 复制全部译文」。「翻译新
            语言…」在 Web 不做：入队协议（§6 的 requests[]）里 params 是自由
            对象，没有目标语言字段，data.json 也只投影单一 meta.targetLang，
            没有可选语言表能撑起选择器；剩下三项与 Web 现有两项一一对应。 */}
        <AiMenuBtn items={[
          { icon: 'comment', label: '翻译字幕', action: 'translate' },
          { icon: 'split-lines', label: '重新对齐双语字幕', action: 'align' },
          '-',
          { icon: 'copy', label: '复制全部译文', disabled: !copyLines.length, onClick: copyAll },
        ]} run={runAgent} />
      </div>

      {find.open ? (
        <FindBar find={find} placeholder="在原文或译文中查找"
          accessory={<ScopePicker scope={scope} onPick={setScope} />}
          onReplace={replaceOne} onReplaceAll={replaceAll} />
      ) : null}
      {agentDialog}

      <div className="tr-statbar">
        <div className="tr-statbar__stats">
          <span className="tr-stat"><b>{sentences.length}</b> 句</span>
          <span className="tr-stat"><b>{done}</b> 已翻译</span>
          {untrans ? <span className="tr-stat tr-stat--warn"><b>{untrans}</b> 未翻译</span> : null}
          {stale ? <span className="tr-stat tr-stat--warn" data-tip="原文在翻译后被修改过 — 由 Agent 重译刷新"><b>{stale}</b> 已过期</span> : null}
        </div>
        {done === sentences.length ? (
          <span className="tr-prog tr-prog--done" data-tip="全部翻译完成"><Ic name="checkmark" size={14} /></span>
        ) : (
          <span className="tr-prog">
            <span className="tr-prog__track"><span className="tr-prog__fill" style={{ width: Math.min(pct, 99) + '%' }}></span></span>
            <span className="tr-prog__pct vk-mono">{Math.min(pct, 99)}%</span>
          </span>
        )}
      </div>

      <div className="vk-translate__scroll" ref={scrollRef}>
        <div className="tr-colhead">
          <span className="tr-colhead__o">原文 · {src.name}</span>
          <span className="tr-colhead__t">译文 · {dst.native}</span>
        </div>
        {byChapter(doc, rows, (r) => r.s.start).map((c) => (
          <section className="vk-chapter" key={c.ci}>
            <ChapterHead ch={c.ch} />
            {c.rows.map(({ s, i }) => <SentenceCard key={s.id} s={s} num={i + 1}
              prev={sentences[i - 1]} next={sentences[i + 1]} find={find} srcIndex={srcIndex} />)}
          </section>
        ))}
        <div style={{ height: 60 }}></div>
      </div>
      {!follow.following && player.playing ? (
        <FollowPill direction={follow.offDir} title="Jump to current line"
          onClick={follow.jumpToCurrent} top={follow.offDir === 'up'} />
      ) : null}
    </div>
  );
}

Object.assign(window, { TranscriptPane, SubtitlePane, TranslatePane });
})();
