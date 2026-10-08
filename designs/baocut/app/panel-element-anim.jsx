/* 动画选择器（§14.3；第 122 轮从 panel-element-edit.jsx 拆出）。

   拆出来的原因有两条：属性页那个文件到了 661 行（上限 ~600），以及**这四件本来就不
   属于属性页**——元素属性页、图片/视频面板、文字面板都在用同一个 `AnimSection`，
   工具条的动画下拉又要用同一套悬停载荷。放在属性页里，等于让三个调用点去一个第四方
   的文件里取控件。

   本轮真正的改动在**悬停预览**：`animPeekProps` 是四个入口（属性页动画子页、工具条
   动画下拉、文字动画页、图片/视频动画页）唯一的载荷装配处。 */
(function () {
  const {useState, useEffect} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const PV = window.BC_PREV;

  /* ---------- 悬停即预览 ---------- */

  /** 这一件在时间轴上的时间段（与 stage-elements 的 `spanOf` 同一套兜底顺序：
      逐元素文档 → 投影里的元素 → 演示数据 → 整片时长）。窗口要夹在它里面。 */
  function animSpanOf(ctx, id) {
    const group = ctx && ctx.groupOf && ctx.groupOf(id);
    const member = group && (group.members || []).find((m) => m.id === id);
    if (member) return window.BC_TL.memberSpan(group, member);
    const doc = ((ctx && ctx.elDocs) || {})[id] || {};
    const e = (((ctx && ctx.elements) || []).filter((x) => x.id === id)[0])
      || ((D.elements || []).filter((x) => x.id === id)[0]) || {};
    return {
      start: doc.start == null ? (e.start || 0) : doc.start,
      end: doc.end == null ? (e.end == null ? D.DUR : e.end) : doc.end,
    };
  }

  /** 悬停载荷。**四个入口共用这一处**，否则窗口规则会各写一遍，然后漂成两套。

      载荷里带 `win`：编辑器只对**带窗口的** peek 进预览播放态（样式画廊那一批
      `kind:'sub'` / `kind:'el'` 的悬停不带 `win`，仍然只是静态覆盖，不会把播放头拽走）。
      `apply` 拿的是 `{id, anim}` 这样一个小文档——`peekOf` 只按 kind 配对，元素身份
      只能从文档里认，不是这一件就原样返回。 */
  function animPeekProps(ctx, peekId, opt) {
    if (!ctx || !peekId || !ctx.setPeek) return null;
    const off = {onMouseEnter: () => ctx.setPeek(null), onMouseLeave: () => ctx.setPeek(null)};
    const o = opt || {};
    if (!o.k || o.k === 'none') return off;
    const slot = PV.normSlot(o.slot);
    const dur = o.dur || (slot === 'loop' ? PV.DEF_PERIOD : slot === 'zoom' ? PV.DEF_SPEED : PV.DEF_DUR);
    const targetId = o.targetId || peekId;
    const sp = animSpanOf(ctx, targetId);
    const win = PV.windowOf({slot, k: o.k, start: sp.start, end: sp.end, dur, period: dur});
    if (!win) return off;
    /* Zoom 预览只留被指的那一段：叠着的其余段会把这一档的推进吃掉，
       用户想看的是「这一档有多深」。 */
    const patch = slot === 'zoom'
      ? {zoom: [{k: o.k, speed: dur}]}
      : {[slot]: {k: o.k, dir: o.dir || null, dur}};
    const payload = {
      kind: 'anim', id: peekId, targetId, span: sp, patch,
      ...(o.local ? {localWin: win} : {win}), label: o.label, manual: !!o.manual,
      apply: (d) => (d && d.id === targetId
        ? {id: d.id, anim: Object.assign({}, d.anim, patch)} : d),
    };
    return {onMouseEnter: () => {
      if (o.local && ctx.playing) return;
      ctx.setPeek(payload);
    }, onMouseLeave: () => ctx.setPeek(null)};
  }

  /* ---------- 动画 ---------- */

  /* 动画格的示意图（第 58.3 轮）：**静止就看得出是哪一支**——主体 ＋ 残影 ＋ 箭头，
     图形数据是那 33 份示意图（`model-animicons.js`）。此前这里是一个只在
     hover 时才动起来的小方块：不把鼠标移上去，十三格长得一模一样。
     悬停预览是**第二层**信息：停上去画面里那个元素真的走一遍（第 122 轮起是真播放）。 */
  function svgNode(n, i) {
    const props = Object.assign({key: i}, n.a);
    return React.createElement(n.t, props, (n.c || []).map(svgNode));
  }
  function AnimGlyph({k, slot, fam}) {
    if (k === 'none') return <Ic n="ban" className="ic--22" />;
    const g = window.BC_ANIMICON.animIcon(slot, k, fam);
    /* 还没画到的那几支落到一个静止色块上——不是动画，只是「这里有一格」。 */
    if (!g) return <span className="apv" />;
    return (
      <svg className="aglyph" viewBox={window.BC_ANIMICON.VIEWBOX} fill="none" aria-hidden="true">
        {g.map(svgNode)}
      </svg>
    );
  }

  /* 鼠标停在一格上，画面里那个元素立刻把这支动效走一遍（第 58.2 轮）——与字幕样式
     画廊、元素样式目录同一条规矩（台账 #55：悬停即预览，临时覆盖、不进历史）。
     没有 `peekId` 的调用点（组件样本页）就只有格子自己动。 */
  function AnimTab({slot, pick, onPick, ctx, peekId, cat, fam}) {
    /* `cat` 让文字那一族用自己的目录（`BC_TP.ANIMS`）。两族键名有重叠但
       不是一回事，示意图也各画各的，所以连 `fam` 一起传下去。 */
    const C = cat || E.ANIMS;
    const list = C[slot];
    const cur = pick[slot] || {k: 'none'};
    const a = list.filter((x) => x.k === cur.k)[0] || list[0];
    const durOf = (k) => (cur.k === k ? cur.dur : null) || (slot === 'loop' ? 2 : 0.6);
    /* 点下去就退预览：这一支已经写进文档了，画面接着按它走的是**文档**而不是覆盖层。
       落笔与撤预览是同一下，所以只有一次跳变——先撤再落会多抖一次。 */
    const off = () => (ctx && ctx.setPeek ? ctx.setPeek(null) : null);
    const hover = (it) => animPeekProps(ctx, peekId, {
      slot, k: it.k, dur: durOf(it.k),
      dir: it.dirs ? (it.dirs === E.DIR2 ? 'cw' : it.dirs[0].k) : null,
    });
    return (
      <>
        <div className="agrid">
          {list.map((it) => (
            <BCAction key={it.k} className={cx('atile', cur.k === it.k && 'is-on')}
              {...hover(it)} title={it.core ? '核心 preset：' + it.core : '原型先行'}
              onClick={() => { off(); onPick({k: it.k, dir: it.dirs ? (it.dirs === E.DIR2 ? 'cw' : it.dirs[0].k) : null,
                                              dur: durOf(it.k)}); }}>
              <span className="atile__g"><AnimGlyph k={it.k} slot={slot} fam={fam} /></span>
              <em>{it.name}</em>
            </BCAction>
          ))}
        </div>
        {a.dirs ? (
          <>
            <SecHead>方向</SecHead>
            <Segmented size="s" value={cur.dir || a.dirs[0].k}
              onChange={(v) => onPick({...cur, dir: v})} items={a.dirs} />
          </>
        ) : null}
        {cur.k !== 'none' ? (
          <>
            <SecHead>时长</SecHead>
            <div className="sec">
              <ValueRow label={slot === 'loop' ? '一轮' : '时长'} value={cur.dur || (slot === 'loop' ? 2 : 0.6)}
                min={0.1} max={slot === 'loop' ? 6 : 3} step={0.1} unit="s"
                onChange={(v) => onPick({...cur, dur: v})} />
            </div>
          </>
        ) : null}
      </>
    );
  }

  /* 四个槽（第 58.2 轮补上 Zoom，凑成四个 tab）：In / Out / Loop 是一次性
     预设，**Zoom 是覆盖一段时长的运镜**，深度三档、可以叠好几段。 */
  function ZoomTab({pick, setPick, ctx, peekId}) {
    const list = pick.zoom && pick.zoom.length ? pick.zoom : [{k: 'none', speed: 1.2}];
    const write = (segs) => {
      if (ctx && ctx.setPeek) ctx.setPeek(null);   // 落笔即退预览（同上，只跳一次）
      setPick({...pick, zoom: segs});
    };
    return (
      <>
        {list.map((seg, i) => (
          <div className="zseg" key={i}>
            {list.length > 1 ? <span className="zseg__n">{i + 1}</span> : null}
            <div className="grow">
              <Segmented size="s" value={seg.k}
                onChange={(k) => write(list.map((x, j) => (j === i ? {...x, k} : x)))}
                items={E.ZOOMS.map((z) => ({
                  k: z.k, label: z.name,
                  hover: animPeekProps(ctx, peekId, {slot: 'zoom', k: z.k, dur: seg.speed}),
                }))} />
              {seg.k === 'none' ? null : (
                <ValueRow label="速度" value={seg.speed} min={0.4} max={4} step={0.1} unit="s"
                  onChange={(v) => write(list.map((x, j) => (j === i ? {...x, speed: v} : x)))} />
              )}
            </div>
            {list.length > 1 ? (
              <IconBtn icon="trash" size="s" tip="删掉这一段"
                onClick={() => write(list.filter((x, j) => j !== i))} />
            ) : null}
          </div>
        ))}
        <Btn variant="secondary" icon="plus" style={{width: '100%', marginTop: 4}}
          onClick={() => write(E.addZoom(list))}>再加一段缩放</Btn>
        <div className="hint">缩放铺满这一段的时长；叠几段就是依次推进，不是同时。</div>
      </>
    );
  }

  /* `cat` / `fam` 给文字那一族用（第 59 轮）：文字动画是**另一套目录**
     （In 19 / Out 16 / Loop 9），示意图也是另一族（字母在做那个动作，不是方片）。
     Zoom 那一档只有图片与视频有——文字面板传 `noZoom`。 */
  function AnimSection({pick, setPick, ctx, peekId, cat, fam, noZoom}) {
    const [slot, setSlot] = useState('in');
    const C = cat || E.ANIMS;
    const tabs = [{k: 'in', label: 'In ' + C.in.length}, {k: 'out', label: 'Out ' + C.out.length},
                  {k: 'loop', label: 'Loop ' + C.loop.length}]
      .concat(noZoom ? [] : [{k: 'zoom', label: 'Zoom'}]);
    /* 鼠标离开整段就退预览：格与格之间的空隙不该被读成「还停在上一格」，
       换 tab、滚出去也一样。卸载再兜一次——从格子上直接点「返回」、收起面板、切 rail
       都不经过 `onMouseLeave`，不兜的话画面就一直在那一段里循环着（第 102.1 轮
       在字幕动效页踩过同一个坑）。 */
    const off = ctx && ctx.setPeek ? {onMouseLeave: () => ctx.setPeek(null)} : null;
    useEffect(() => () => { if (ctx && ctx.setPeek) ctx.setPeek(null); }, []);
    return (
      <div {...off}>
        <div style={{padding: '10px 0 2px'}}>
          <Segmented size="s" value={slot} onChange={setSlot} items={tabs} />
        </div>
        {slot === 'zoom'
          ? <ZoomTab pick={pick} setPick={setPick} ctx={ctx} peekId={peekId} />
          : <AnimTab slot={slot} pick={pick} onPick={(v) => setPick({...pick, [slot]: v})}
              ctx={ctx} peekId={peekId} cat={cat} fam={fam} />}
      </div>
    );
  }

  /** 动画钮（整宽方框、图标 ＋ 文字居中、设过就右上角一枚点）。 */
  function AnimButton({anim, onOpen}) {
    const on = E.animSummary(anim) !== '未设置';
    return (
      <BCAction className="vbox vbox--btn" onClick={onOpen}>
        <Ic n="anim" className="ic--16" />
        <span>动画{on ? ' · ' + E.animSummary(anim) : ''}</span>
        {on ? <span className="mdot" /> : null}
      </BCAction>
    );
  }

  Object.assign(window, {AnimSection, AnimButton, AnimTab, ZoomTab, AnimGlyph, animPeekProps, animSpanOf});
})();
