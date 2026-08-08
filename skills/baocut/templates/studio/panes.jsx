// BaoCut Subtitle Studio — the three text panes (Transcript / Subtitle /
// Translate). Editing model (MVP):
//   · Subtitle tab  — per-cue text editing：点击处落光标，Enter 在光标处拆分，
//                     行首 ⌫ 并入上一条 / 行尾 ⌦ 合并下一条（都与未提交文本合成
//                     一个事务，撤销时是一步），外加时间码编辑与逐句播放。
//   · Translate tab — per-cue translation editing, untranslated / out-of-date
//                     chips, AI actions routed to the Agent.
//   · Transcript tab — read & seek view (paragraph projection, karaoke follow);
//                     text edits live in the Subtitle tab.
(() => {
const { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } = React;
const { Ic, QBtn, Menu, useApp, usePlayer, useActive, fmt, toast, TimecodeChip, LiveHeader, spHue } = window;
const V = window.BCS_VLIST;

const fmtRange = (a, b) => fmt(a) + '–' + fmt(b);

// scroll the selected/active card into view inside a pane scroller
function useFollow(scrollRef, attr, activeId, deps) {
  useEffect(() => {
    const c = scrollRef.current;
    if (!c || !activeId) return;
    const el = c.querySelector('[' + attr + '="' + activeId + '"]');
    if (!el) return;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top < cr.top + 8 || er.bottom > cr.bottom - 8) {
      c.scrollTo({ top: c.scrollTop + (er.top - cr.top) - cr.height / 2 + er.height / 2, behavior: 'smooth' });
    }
  }, deps);
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
function EditableBlock({ value, placeholder, className, lang, onCommit, onKeyOps, caretAt, onCaretDone, onEditingChange }) {
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
      {value}
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

// ===================== Transcript =====================
function TranscriptPane() {
  const app = useApp();
  const { doc } = app;
  const scrollRef = useRef(null);
  const player = usePlayer();   // Transcript 是词级卡拉 OK，本来就要逐帧
  usePaneScroll(scrollRef, 'transcript');
  const paras = useMemo(() => app.paragraphs(doc), [doc]);
  const active = paras.find((p) => player.t >= p.start && player.t < p.end);
  useFollow(scrollRef, 'data-para', active && active.id, [active && active.id, player.playing]);

  return (
    <div className="vk-transcript" data-screen-label="Transcript">
      <div className="vk-transcript__toolbar">
        <span className="vk-dim" style={{ fontSize: 12 }}>逐句编辑在 Subtitle 标签 · 点击词语跳转</span>
      </div>
      <div className="vk-transcript__scroll" ref={scrollRef}>
        {byChapter(doc, paras, (p) => p.start).map((c) => (
          <section className="vk-chapter" key={c.ci}>
            <div className="vk-chapter__head">
              <span className="vk-chapter__title">{c.ch.title}</span>
              <span className="vk-mono vk-dim vk-chapter__range">{fmtRange(c.ch.start, c.ch.end)}</span>
            </div>
            {c.rows.map((p) => {
              const sp = doc.speakers[p.sp] || { name: p.sp, hue: 240 };
              const isActive = player.t >= p.start && player.t < p.end;
              return (
                <div key={p.id} data-para={p.id} className={'vk-group vk-para' + (isActive ? ' vk-para--active' : '')}
                  style={{ borderLeftColor: spHue(sp.hue) }}>
                  <div className="vk-group__head">
                    <span className="vk-group__sp" style={{ color: `oklch(0.5 0.14 ${sp.hue})` }}>{sp.name}</span>
                    <button className="vk-group__time vk-mono" data-tip="跳转到此处" onClick={() => app.seekSource('main', p.start)}>{fmtRange(p.start, p.end)}</button>
                    <PlayCueBtn cue={p} active={isActive} playing={player.playing} />
                  </div>
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
                              <span className={'vk-w' + (cur >= 0 ? (i < cur ? ' vk-w--spoken' : i === cur ? ' vk-w--cur' : '') : ' vk-w--spoken')}
                                onClick={() => app.seekSource('main', w.start)}>{w.w}</span>
                            </React.Fragment>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        ))}
        <div style={{ height: 60 }}></div>
      </div>
    </div>
  );
}

// ===================== Subtitle =====================
// React.memo：字幕表是全应用最长的列表，doc 不变时 cue 引用稳定（store 的 doc
// 是 useMemo 出来的），所以只有 active 真的翻转的那一两张卡会重渲染。
const CueCard = React.memo(function CueCard({ cue, num, prev, next, active, playing, caretAt, onCaretDone, onEditingChange }) {
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
      {playing && active ? <Karaoke cue={cue} /> : (
        <EditableBlock value={cue.text} placeholder="输入字幕文本…" className="sb-text"
          caretAt={caretAt} onCaretDone={onCaretDone} onEditingChange={editingChange}
          onCommit={(v) => { app.editCue(cue.id, 'text', v); toast('字幕已更新', { variant: 'positive' }); }}
          onKeyOps={{ split, mergeUp, mergeDown }} />
      )}
    </div>
  );
});

function ChapterHead({ ch }) {
  return (
    <div className="vk-chapter__head">
      <span className="vk-chapter__title">{ch.title}</span>
      <span className="vk-mono vk-dim vk-chapter__range">{fmtRange(ch.start, ch.end)}</span>
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
  const pinned = useMemo(
    () => [editKey, lastEditKey, caretKey].filter(Boolean),
    [editKey, lastEditKey, caretKey],
  );

  const rows = useMemo(() => cues.map((cue, i) => ({ cue, i })), [cues]);
  const vrows = useMemo(
    () => V.flatten(byChapter(doc, rows, (r) => r.cue.start), (r) => r.cue.id),
    [doc.chapters, rows],
  );

  // 播放/选中跟随：不能再靠 querySelector 找 DOM（目标很可能根本没渲染），
  // 改成问虚拟列表要它的偏移。
  const followKey = (app.sel && app.sel.cueId) || (playing && activeId) || null;
  useEffect(() => {
    if (followKey && listRef.current) listRef.current.scrollToKey(followKey);
  }, [followKey]);

  const renderRow = useCallback((row) => {
    if (row.kind === 'head') return <ChapterHead ch={row.ch} />;
    const { cue, i } = row.item;
    return (
      <CueCard cue={cue} num={i + 1} prev={cues[i - 1]} next={cues[i + 1]}
        active={cue.id === activeId} playing={playing}
        caretAt={caretKey === cue.id ? pc.offset : null}
        onCaretDone={clearPendingCaret} onEditingChange={onEditingChange} />
    );
  }, [cues, activeId, playing, caretKey, pc, clearPendingCaret, onEditingChange]);

  return (
    <div className="vk-subtitle" data-screen-label="Subtitle">
      <div className="vk-transcript__toolbar">
        <span className="vk-dim" style={{ fontSize: 12 }}>点击文本编辑 · Enter 拆分 · 行首 ⌫ / 行尾 ⌦ 合并</span>
      </div>
      <div className="tr-statbar">
        <span className="tr-stat"><b>{cues.length}</b> 条字幕</span>
        {fastCount ? <span className="tr-stat tr-stat--warn" data-tip="超出舒适阅读速度的字幕"><b>{fastCount}</b> 条语速过快</span> : null}
        {doc._pendingEdits ? <span className="tr-stat" data-tip="本地编辑待 Agent 应用到数据"><b>{doc._pendingEdits}</b> 处本地编辑</span> : null}
      </div>
      <window.VirtualList className="vk-subtitle__scroll" scrollRef={scrollRef} handle={listRef}
        rows={vrows} estimate={V.estimateSubtitleRow} fingerprint={V.subtitleFingerprint}
        rowClass={subtitleRowClass} pinnedKeys={pinned} renderRow={renderRow} />
    </div>
  );
}

// ===================== Translate =====================
// v0.3：翻译的单位是句（sentence）——源句 1:1 译句；句内展示切分（pieces）
// 是 transAlign 覆盖层。整句改写走 sentence 通道（改写后降级整句上屏，由
// Agent 重切）；逐行微调走 piece 通道（拼接不变量由 store 维护）。
function SentenceCard({ s, num }) {
  const app = useApp();
  const { doc } = app;
  const first = doc.cues.find((c) => c.id === (s.cueIds || [])[0]) || {};
  const sp = doc.speakers[first.sp] || { name: first.sp || '', hue: 240 };
  const { t, playing } = usePlayer();
  const active = t >= s.start && t < s.end;
  const dur = Math.max(0.1, s.end - s.start);
  const empty = !(s.trans || '').trim();
  const translating = doc.status.phase === 'translating';
  const pieces = (doc.transCues || []).filter((tc) => tc.sid === s.id);
  const whole = empty || !pieces.length || (pieces.length === 1 && pieces[0].kind === 'sentence');

  return (
    <div className={'tg' + (active ? ' tg--active' : '') + (empty ? ' tg--untrans' : '') + (s.stale ? ' tg--stale' : '') + (s.paraStart ? ' tg--para-start' : '')}
      data-tg={s.id} data-screen-label={'Translate · #' + num}
      style={{ borderLeftColor: spHue(sp.hue), '--rail': spHue(sp.hue) }}>
      <div className="tg__head">
        <span className="tg__sp" style={{ color: `oklch(0.5 0.14 ${sp.hue})` }}>{sp.name}</span>
        <PlayCueBtn cue={{ start: s.start, end: s.end }} active={active} playing={playing} />
        <span className="tg__time vk-mono">{fmtRange(s.start, s.end)}</span>
        {s._editedTrans ? <span className="bcs-editchip" data-tip="本地修改，待 Agent 应用">已编辑</span> : null}
        {!empty && whole && !s.aligned
          ? <span className="tr-chip tr-chip--warn" data-tip="译文切法缺失或失效，当前临时整句显示；请 Agent 定向重对齐">对齐待修</span> : null}
        {!empty && !whole && s.crossing
          ? <span className="tr-chip" data-tip="中英语序交叉：为保持译文自然，行间语义有意不一一对应，这不是对齐错误">语序交叉</span> : null}
        <span className="vk-spacer"></span>
        {empty
          ? (translating ? <span className="tr-chip tr-chip--warn"><span className="vk-spin"></span>翻译中…</span> : <span className="tr-chip tr-chip--untrans">未翻译</span>)
          : s.stale
          ? <span className="tr-chip tr-chip--warn" data-tip="原文在翻译后被修改过 — 请 Agent 重新翻译此句">已过期</span>
          : <CpsChip text={s.trans} dur={dur} lang={(doc.meta.targetLang || {}).code} />}
      </div>
      {whole ? (
        <div className="tg-body">
          <div className="tg-orig">
            <div className={'tg-orig__line' + (playing && active ? ' tg-orig__line--active' : '')} onClick={() => app.seekSource('main', s.start)}>
              {s.text}
            </div>
          </div>
          <div className="tg-transcol">
            <EditableBlock value={s.trans || ''} placeholder="添加翻译…" className="tg-trans" lang="zh"
              onCommit={(v) => { app.editTrans(s.id, 'sentence', v); toast('翻译已更新', { variant: 'positive' }); }} />
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
            const sourceParts = window.BCS_SUBTITLE.sourceCueParts(tc, doc.cues, sourceLang, 42);
            const multiCue = sourceParts.length > 1;
            const rowDur = Math.max(0.1, tc.end - tc.start);
            const rowLang = (doc.meta.targetLang || {}).code;
            const rowCpsLevel = app.cpsLevel(tc.text, rowDur, rowLang);
            const canStructure = s.mode === 'manyToOne'
              && Number.isInteger(tc.wordFrom) && Number.isInteger(tc.wordTo);
            const mergeUp = () => {
              if (!app.mergeTransPieces(pieces[pieceIndex - 1], tc)) return false;
              toast('已与上一译文片合并', { variant: 'neutral' });
              return true;
            };
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
                        {part.lines.map((line, index) => (
                          <span className="tg-orig__subline" key={`${tc.id}:${part.key}:${index}`}>{line.text}</span>
                        ))}
                      </div>
                    )) : <div className="tg-orig__part tg-orig__part--empty">—</div>}
                  </div>
                </div>
                <div className="tg-transcol">
                  {rowCpsLevel !== 'ok'
                    ? <span className="tg-pair__cps"><CpsChip text={tc.text} dur={rowDur} lang={rowLang} /></span>
                    : null}
                  <EditableBlock value={tc.text} placeholder="…" className="tg-trans" lang="zh"
                    onCommit={(v) => { app.editTrans(tc.id, 'piece', v); toast('译文行已更新', { variant: 'positive' }); }}
                    onKeyOps={canStructure ? {
                      // 译文片的拆合仍走单 op 事务：未提交文本会被丢弃（对齐覆盖层
                      // 的 baseText 语义与字幕不同，合并事务另议）。
                      split: (c) => {
                        if (!app.splitTransPieceAtCaret(tc.id, c.offset)) return false;
                        toast('已从光标处分割译文', { variant: 'neutral' });
                        return true;
                      },
                      mergeUp,
                    } : null} />
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
  useFollow(scrollRef, 'data-tg', (player.playing && active && active.id), [active && active.id, player.playing]);

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
        <span className="vk-spacer"></span>
        <span className="vk-dim" style={{ fontSize: 12 }}>点击译文可直接修改</span>
      </div>

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
            <div className="vk-chapter__head">
              <span className="vk-chapter__title">{c.ch.title}</span>
              <span className="vk-mono vk-dim vk-chapter__range">{fmtRange(c.ch.start, c.ch.end)}</span>
            </div>
            {c.rows.map(({ s, i }) => <SentenceCard key={s.id} s={s} num={i + 1} />)}
          </section>
        ))}
        <div style={{ height: 60 }}></div>
      </div>
    </div>
  );
}

Object.assign(window, { TranscriptPane, SubtitlePane, TranslatePane });
})();
