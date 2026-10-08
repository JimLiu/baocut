/* 文稿面板的剪辑模式 —— 第 192 轮（§13.1「剪辑模式」/ §12.6「剪口覆盖层」）。
   panels.jsx 的 TranscriptPanel 在「改字 / 剪辑」两态间切：改字态是第 154 轮起的就地
   编辑（EditableText），剪辑态换成这里的三件：

     CutBar   顶部汇总条——有建议：条数 / 时长 / 分类 + 忽略全部 / 接受全部；
              没建议但剪过：已剪条数 / 成片时长 + 全部恢复 / 再找一遍；都没有：怎么剪。
     CutText  段落正文按 token 铺开（中文逐字、英文按词，BC_CUT.tokens）：
              已剪的划掉、建议的虚线下划、停顿是行内一枚小标；拖选一段字 = 选区；
              点已剪 / 建议的字出菜单。单击普通字仍是跳播。
     CutFloat 选区落定后浮在它上方的一条工具条（第 193 轮）：时长 + 起止时间码、
              「剪掉 ⌫」「试听」「取消 Esc」。选区真相在 ctx.cutSel（editor-cuts.jsx），
              时间轴同步画出这一段并标时间（timeline.jsx 的 .tlsel）。
     CutMenu  那枚菜单：建议 → 接受 · 忽略 · 试听；已剪 → 恢复 · 试听。

   词级时间戳原型里没有，token 的时间按 cue 内字符比例近似（BC_CUT.rangeTime）；
   真实产品这一步读 words[]。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const CUT = window.BC_CUT;
  const D = window.BC_DATA;
  const TX = window.BC_TX;
  const T = window.BC_TIME;

  /* ---------- 汇总条 ---------- */
  function CutBar({ctx}) {
    const app = useApp();
    const sug = CUT.suggested(ctx.cuts);
    const act = CUT.active(ctx.cuts);
    /* 第 196 轮：找口的任务在跑时（Agent 会话或直接调模型，落成同一种任务记录），
       这里给一条迷你进度替代「再找一遍」——点它回工具页看阶段。 */
    const running = app.tasks.filter((t) => t.kind === 'cleanup' && t.project === ctx.proj.id && t.status === 'running').slice(-1)[0] || null;
    /* Web 表面（model-surface.js）：找口从 Agent 或 App 发起——这里不给按钮；别处起的那一跑
       在跑时仍然看得到迷你进度，建议落下来照常接受 / 忽略。 */
    const AI = window.BC_SURFACE.ai;
    const findBtn = (label) => running
      ? <>
          <span className="cutbar__bar" title={`找可剪的口 · ${running.pct || 0}%`}><i style={{width: (running.pct || 0) + '%'}} /></span>
          {AI ? <Btn variant="quiet" size="s" onClick={() => ctx.requestAi('cleanup', null)}>看进度</Btn> : null}
        </>
      : !AI ? null
      : <Btn variant="secondary" size="s" icon="sparkle" onClick={() => ctx.requestAi('cleanup', null)}>{label}</Btn>;
    /* 剪到句中的原文，译文还是剪前的（§13.1）：这里只报数与给入口，处理在 AI 工具页「刷新过期译文」。 */
    const trN = ctx.transImpact ? ctx.transImpact.stale.length : 0;
    const transRow = trN ? (
      <div className="cutbar__tr">
        <Ic n="translate" className="ic--14" />
        <span className="grow">{trN} 句译文的原文被剪切，译文还是剪前的{ctx.transImpact.whole ? ` · ${ctx.transImpact.whole} 句整句已剪` : ''}</span>
        {AI ? <Btn variant="secondary" size="s" onClick={() => ctx.requestAi('stale', {k: 'cut', label: `原文被剪切的 ${trN} 句`, count: trN})}>处理译文</Btn> : null}
      </div>
    ) : null;
    if (sug.length) {
      const s = CUT.summary(sug);
      return (
        <div className="cutbar cutbar--sug">
          <Ic n="sparkle" className="ic--16" />
          <div className="cutbar__t">
            <b>{s.n} 处建议 · 共 {CUT.label(s.secs)}</b>
            <span>{CUT.kindsText(sug)}{act.length ? ` · 另有 ${act.length} 处已剪` : ''}</span>
          </div>
          <Btn variant="quiet" size="s" onClick={ctx.cutOps.rejectAll}>忽略全部</Btn>
          <Btn variant="accent" size="s" onClick={ctx.cutOps.acceptAll}>接受全部</Btn>
        </div>
      );
    }
    if (act.length) {
      const s = CUT.summary(act);
      return (
        <>
        <div className="cutbar">
          <Ic n="split" className="ic--16" />
          <div className="cutbar__t">
            <b>已剪掉 {s.n} 处 · 成片 {T.timecode(ctx.outDuration, {decimals: 0})}</b>
            <span>省下 {CUT.label(s.secs)} · 划掉的字点一下可以恢复</span>
          </div>
          <Btn variant="quiet" size="s" onClick={ctx.cutOps.restoreAll}>全部恢复</Btn>
          {findBtn('再找一遍')}
        </div>
        {transRow}
        </>
      );
    }
    return (
      <div className="cutbar">
        <Ic n="info" className="ic--16" />
        <div className="cutbar__t">
          <b>拖选一段文字，按 ⌫ 剪掉</b>
          <span>{AI ? '剪掉的字划线保留，点它可以恢复；也可以让 AI 先把口癖和停顿找出来' : '剪掉的字划线保留，点它可以恢复'}</span>
        </div>
        {findBtn('找可剪的口')}
      </div>
    );
  }

  /* ---------- 段落正文（token 视图） ---------- */
  /** @param view 面板级共享：`{cuts, cueOf, onMenu, ctx}`；选区读写 ctx.cutSel
      @param words 播放跟随（BC_FOLLOW.paraWords，同一串字、同一份 tokens，下标对得上）；
             只给留着的字（含建议）加当前 / 已念，已剪的字维持划线不叠加 */
  function CutText({p, text, spans, view, words}) {
    const {cuts, cueOf, onMenu, ctx} = view;
    const sel = ctx.cutSel, setSel = ctx.setCutSel;
    const toks = CUT.tokens(text);
    const mine = sel && sel.para === p.id ? sel : null;
    const lo = mine ? Math.min(mine.a, mine.b) : -1;
    const hi = mine ? Math.max(mine.a, mine.b) : -1;
    // 这一段涉及的剪口：有字的按时间盖住 token；停顿没有字，按 cue 尾部算出插入点
    const inPara = cuts.filter((c) => c.start < p.end && c.end > p.start);
    const textCuts = inPara.filter((c) => c.kind !== 'pause');
    const pauses = inPara.filter((c) => c.kind === 'pause')
      .map((c) => ({cut: c, at: CUT.charsOf(spans, cueOf, c)})).filter((x) => x.at);
    const timeOf = (t) => CUT.rangeTime(spans, cueOf, t.s, t.e);
    const cutOf = (t) => {
      const r = timeOf(t); if (!r) return null;
      const mid = (r.start + r.end) / 2;
      return textCuts.find((c) => mid >= c.start && mid < c.end) || null;
    };
    const drag = useRef(null);
    const selRef = useRef(null); selRef.current = mine;
    /* 松手落在哪都算拖选结束：选区落定（live → false）、播放头跳到选区起点（画面与时间轴
       都停在这一段上）；click 紧跟 mouseup 同步派发，所以延一拍再清，让 click 还能看到 moved */
    useEffect(() => {
      const up = () => {
        if (!drag.current) return;
        const s = selRef.current;
        if (drag.current.moved && s && s.live) { setSel({...s, live: false}); ctx.seek(s.start); }
        setTimeout(() => { drag.current = null; }, 0);
      };
      window.addEventListener('mouseup', up);
      return () => window.removeEventListener('mouseup', up);
    }, []);
    const begin = (i) => (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      drag.current = {a: i, moved: false};
      setSel(null);
    };
    // 选区带时间一起写：token 下标给面板画高亮，start / end / text 给时间轴与浮动菜单
    const enter = (i) => () => {
      if (!drag.current) return;
      drag.current.moved = true;
      const a = drag.current.a, lo = Math.min(a, i), hi = Math.max(a, i);
      const r = CUT.rangeTime(spans, cueOf, toks[lo].s, toks[hi].e);
      setSel({para: p.id, a, b: i, live: true, ...(r || {}), text: text.slice(toks[lo].s, toks[hi].e)});
    };
    const click = (i, t, cut) => (e) => {
      e.stopPropagation();
      const d = drag.current; drag.current = null;
      if (d && d.moved) return;                 // 拖选结束的那一下松手，不算点击
      if (cut) { onMenu(cut, e); return; }
      const r = timeOf(t); if (r) ctx.seek(r.start);
    };
    const out = [];
    toks.forEach((t, i) => {
      const cut = cutOf(t);
      const on = i >= lo && i <= hi;
      const kept = !!words && (!cut || cut.state === 'suggested');
      out.push(
        <span key={i} data-i={i}
          className={cx('ctok', cut && 'cutx', cut && cut.state === 'suggested' && 'cutx--sug', on && 'is-sel',
            kept && 'para__w', kept && i === words.now && 'is-now', kept && i < words.played && 'is-played')}
          title={cut ? `${CUT.kindLabel(cut.kind)} · ${CUT.label(cut.end - cut.start)}${cut.state === 'suggested' ? ' · 建议' : ' · 已剪'}` : undefined}
          onMouseDown={begin(i)} onMouseEnter={enter(i)} onClick={click(i, t, cut)}>
          {text.slice(t.s, t.e)}
        </span>);
      pauses.filter((x) => x.at.e === t.e).forEach((x) => {
        out.push(
          <BCAction key={'p' + x.cut.id}
            className={cx('cutx cutx--pause', x.cut.state === 'suggested' && 'cutx--sug')}
            title={`${x.cut.state === 'suggested' ? '建议剪掉' : '已剪掉'}停顿 · ${CUT.label(x.cut.end - x.cut.start)}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onMenu(x.cut, e); }}>
            <Ic n="clock" className="ic--14" />{CUT.label(x.cut.end - x.cut.start)}
          </BCAction>);
      });
    });
    return (
      <div className="para__b ctxt">
        {out}
      </div>
    );
  }

  /* ---------- 剪缝：改字态里整段剪光的那几段（§13.1） ----------
     此前这里画的是一张**和在场段落同形的卡片**（说话人色带 + 名字 + 时间 + 四颗动作钮），
     只有正文换成一句「整段已剪掉 · 切到剪辑态可以恢复」——扫一眼分不出哪段还在成片里，
     连着剪掉两段时更像中间插了两条普通字幕。

     改成一条**剪缝**：不是卡片、没有说话人色带、没有段落动作钮，高 24 的一条虚线，
     左端一枚剪口标写着少掉多少秒。相邻剪光的段合成一条（BC_CUT.seamRows）。点它展开
     看被剪掉的字（只读、划掉），右端「恢复」直接放回成片——不必先切到剪辑态。
     指向时整条转成 red 调：红是剪口的色，和剪辑态划掉的字同族。 */
  function CutSeam({seam, ctx}) {
    const [open, setOpen] = useState(false);
    const n = seam.paras.length;
    const spColor = (sp) => `oklch(0.5 0.14 ${D.speakers[sp].hue})`;
    const who = D.speakers[seam.paras[0].sp];
    const sub = n > 1 ? `${n} 段` : who ? who.name : '';
    const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
    const toggle = () => setOpen((v) => !v);
    return (
      <div className={cx('cseam', open && 'is-open')}>
        <div className="cseam__hd" role="button" tabIndex={0}
          title={open ? '收起被剪掉的文字' : '展开看被剪掉的文字'}
          onClick={toggle}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
          <Ic n="split" className="ic--14" />
          <span className="cseam__t">剪掉 {CUT.label(seam.secs)}{sub ? ` · ${sub}` : ''}</span>
          <i className="cseam__line" />
          <span className="cseam__acts">
            <BCAction className="cseam__b" title="试听被剪掉的这一段"
              onClick={stop(() => ctx.cutOps.audition({start: seam.start, end: seam.end}))}>
              <Ic n="play" className="ic--12" />试听
            </BCAction>
            <BCAction className="cseam__b" title="把这一段放回成片"
              onClick={stop(() => ctx.cutOps.restoreMany(seam.cutIds, n))}>
              <Ic n="undo" className="ic--12" />恢复
            </BCAction>
          </span>
          <Ic n={open ? 'chevup' : 'chevdown'} className="ic--12 cseam__cv" />
        </div>
        {open ? (
          <div className="cseam__body">
            {seam.paras.map((p) => (
              <div className="cseam__p" key={p.id}>
                <BCAction className="cseam__pt" title="跳到这里"
                  onClick={stop(() => ctx.seek(p.start))}>{T.timecode(p.start, {decimals: 0})}</BCAction>
                <span className="cseam__psp" style={{color: spColor(p.sp)}}>{D.speakers[p.sp].name}</span>
                <span className="cseam__px">{p.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- 浮动工具条：贴在选区第一行的上方 ----------
     位置从 DOM 量（`.ctok.is-sel` 的并集矩形），面板滚动 / 窗口变化时重量；
     拖选进行中（sel.live）不出，免得跟着鼠标跳。mousedown 截停：别让它把选区清掉。 */
  function CutFloat({ctx, scrollRef}) {
    const sel = ctx.cutSel;
    const [box, setBox] = useState(null);
    useEffect(() => {
      if (!sel || sel.live || sel.start == null) { setBox(null); return; }
      const host = scrollRef.current;
      const measure = () => {
        const toks = host ? host.querySelectorAll('.ctok.is-sel') : [];
        if (!toks.length) { setBox(null); return; }
        let l = Infinity, r = -Infinity, t = Infinity;
        toks.forEach((n) => { const b = n.getBoundingClientRect(); l = Math.min(l, b.left); r = Math.max(r, b.right); t = Math.min(t, b.top); });
        const hb = host.getBoundingClientRect();
        // 选区第一行滚出面板可视区就藏起来，不能飘在别的段上
        setBox(t < hb.top || t > hb.bottom ? null : {l, r, t});
      };
      measure();
      if (host) host.addEventListener('scroll', measure);
      window.addEventListener('resize', measure);
      return () => { if (host) host.removeEventListener('scroll', measure); window.removeEventListener('resize', measure); };
    }, [sel]);
    if (!sel || !box) return null;
    const w = 276, h = 36;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, (box.l + box.r) / 2 - w / 2));
    const top = Math.max(8, box.t - h - 8);
    const cut = () => { ctx.cutOps.add({start: sel.start, end: sel.end, text: sel.text, kind: 'manual', by: 'you'}); ctx.setCutSel(null); };
    return (
      <div className="pop cutfloat" style={{left, top, width: w}} onMouseDown={(e) => e.stopPropagation()}>
        <span className="cutfloat__t">
          <b>{CUT.label(sel.end - sel.start)}</b>
          <span className="t-mono">{T.timecode(sel.start)} – {T.timecode(sel.end)}</span>
        </span>
        <Btn variant="accent" size="s" onClick={cut}>剪掉 <kbd>⌫</kbd></Btn>
        <IconBtn icon="play" size="s" tip="试听这一段" onClick={() => ctx.cutOps.audition(sel)} />
        <IconBtn icon="close" size="s" tip="取消选区 · Esc" onClick={() => ctx.setCutSel(null)} />
      </div>
    );
  }

  /* ---------- 菜单：固定定位在点击处 ---------- */
  function CutMenu({menu, ctx, onClose}) {
    const anchor = useRef(null);
    if (!menu) return null;
    const {cut} = menu;
    const live = ctx.cuts.find((c) => c.id === cut.id) || cut;
    const sug = live.state === 'suggested';
    const w = 224;
    const left = Math.min(menu.x, window.innerWidth - w - 8);
    const top = Math.min(menu.y + 6, window.innerHeight - 160);
    const run = (fn) => () => { fn(); onClose(); };
    return (
      <><span ref={anchor} className="bc-context-anchor" style={{left, top}} aria-hidden="true" />
      <Popover open onClose={onClose} anchorRef={anchor} width={w} label="剪辑操作">
        <Menu>
          <MenuHead>{CUT.kindLabel(live.kind)} · {CUT.label(live.end - live.start)}{live.why && live.why !== CUT.kindLabel(live.kind) ? ` · ${live.why}` : ''}</MenuHead>
          {sug ? <MenuItem icon="check" label="接受 · 剪掉" onClick={run(() => ctx.cutOps.accept(live.id))} /> : null}
          {sug ? <MenuItem icon="close" label="忽略这一条" onClick={run(() => ctx.cutOps.reject(live.id))} /> : null}
          {!sug ? <MenuItem icon="undo" label="恢复这一段" onClick={run(() => ctx.cutOps.restore(live.id))} /> : null}
          <MenuRule />
          <MenuItem icon="play" label="试听这一处" sub={`${T.timecode(live.start)} – ${T.timecode(live.end)}`}
            onClick={run(() => ctx.cutOps.audition(live))} />
        </Menu>
      </Popover></>
    );
  }

  /* ---------- 面板级：选区的 ⌫ / Esc ----------
     选区本身住在 ctx.cutSel（editor-cuts.jsx）；这里只接键盘。键盘在 window 的**捕获**
     阶段接：editor-keys.jsx 的 ⌫ 是删元素，挂在冒泡阶段；剪辑模式下有文字选区时
     这一枪归剪辑，没选区就放行给它。 */
  function useCutSelection(ctx) {
    const ref = useRef(null);
    ref.current = ctx;
    useEffect(() => {
      const onKey = (e) => {
        const ctx = ref.current, sel = ctx.cutSel;
        if (!ctx.cutMode) return;
        const tgt = e.target;
        if (tgt && (tgt.isContentEditable || /^(INPUT|TEXTAREA)$/.test(tgt.tagName))) return;
        if (e.key === 'Escape' && sel) { e.stopPropagation(); ctx.setCutSel(null); return; }
        if ((e.key === 'Backspace' || e.key === 'Delete') && sel) {
          e.preventDefault(); e.stopPropagation();
          if (sel.start != null) ctx.cutOps.add({start: sel.start, end: sel.end, text: sel.text, kind: 'manual', by: 'you'});
          ctx.setCutSel(null);
        }
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    }, []);
  }

  Object.assign(window, {CutBar, CutText, CutSeam, CutFloat, CutMenu, useCutSelection});
})();
