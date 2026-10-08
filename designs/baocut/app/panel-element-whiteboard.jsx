/* Elements 面板 · 白板手绘属性页（设计稿 docs/design/video/bcut-whiteboard-animation-design.md §6.2）。

   白板手绘是一条 `kind: "whiteboard"` 的算法元素：一张图按笔顺逐段揭示，手跟着
   笔尖走；画时不超过条子时长，画完定格。这一页照 `ElementEdit` 的段序（动画钮 →
   本类各段 → 时长 → 删除），本类多出来的五段是 **示范 → 手 → 纸 → 画时 → 节拍**。

   原型没有位图分析，三份内置示范的笔画代替「那张图」；核心里这一格是选图（`bcut
   element add --kind whiteboard --file`）。算法在 `model-whiteboard.js`（`BC_WHITEBOARD`，
   有单测）；这里只有画与写。写口子只有一个：`set({wb: next})` —— `ElementEdit` 把它经
   `E.toStage('whiteboard', …)` 落到样式文档键 `whiteboard`，画布 `stage-elements.jsx`
   从同一键读。

   2026-09-17 旁白同步（docs/design/video/bcut-whiteboard-narration-sync-design.md §9）：画时段头一行是
   「节奏」三档只读徽标（跟随旁白 / 自然速度 / 手动 = 时间真相从哪来）；节拍段每拍写标签 ＋
   本地起止，拍下面是 0.9 的两个开关（每拍撑满窗 / 画完定格、严格分区）、校验结果与
   「按旁白重新对齐」钮（App 里调 `bcut whiteboard sync --element`，演示态只弹 toast）。 */
(function () {
  const {useState, useEffect} = React;
  const W = window.BC_WHITEBOARD;
  /** 「节奏」徽标的色与一句话 */
  const MODE_UI = {
    narration: {tone: 'accent', hint: '节拍的起止是旁白里的词，画到哪句说到哪句'},
    natural: {tone: 'positive', hint: '没有旁白锚点，画时跟时长走'},
    manual: {tone: 'neutral', hint: '画时是手填的，节拍不跟旁白'},
  };

  /** 示范抽屉：三格与目录里那三格同一颗 `WhiteboardTile`（悬停即播）。悬停预览走
      `peekProps`，退场即撤（与彩纸款式抽屉同一笔）。 */
  function DemoDrawer({ctx, wb, onPick, onBack}) {
    useEffect(() => () => ctx.setPeek(null), []);
    return (
      <>
        <window.PanelHead title="白板示范" onBack={onBack} />
        <div className="pscroll bc-scroll" onMouseLeave={() => ctx.setPeek(null)}>
          <div className="stgrid stgrid--anim">
            {W.DEMOS.map((d) => (
              <span key={d.k}
                {...window.peekProps(ctx, 'el', (s) => Object.assign({}, s, {whiteboard: W.switchDemo(wb, d.k)}))}>
                <window.WhiteboardTile demo={d} on={wb.demo === d.k}
                  onAdd={() => { ctx.setPeek(null); onPick(d.k); onBack(); }} />
              </span>
            ))}
          </div>
          <div className="hint">
            换示范换的是笔画与节拍；手、纸、画时、墨线优先都留着。App 里这一步是换一张图，
            笔顺由 `bcut` 从图里分析出来。
          </div>
        </div>
      </>
    );
  }

  function WhiteboardEdit({ctx, el, v, set, anim, onOpenAnim, spec, onBack, onDelete, geometry, time}) {
    const wb = W.normalize(v.wb || W.defaults());
    const demo = W.byDemo(wb.demo);
    const dur = Math.max(0.1, (v.tEnd || 0) - (v.tStart || 0));
    const [view, setView] = useState(null);
    const [pop, setPop] = useState(false);
    const write = (patch) => set({wb: W.normalize(Object.assign({}, wb, patch))});
    const app = useApp();
    const L = W.lane(wb, dur);            // 解析后的节拍（本地起止、标签）、徽标档、校验结果
    const modeUi = MODE_UI[L.mode] || MODE_UI.natural;
    const auto = wb.draw == null;
    const drawMax = Math.min(W.LIMITS.draw[1], Math.max(W.LIMITS.draw[0], Math.round(dur * 10) / 10));
    const transparent = wb.paper == null;

    if (view === 'demo') {
      return <DemoDrawer ctx={ctx} wb={wb} onBack={() => setView(null)}
        onPick={(k) => set({wb: W.switchDemo(wb, k)})} />;
    }

    return (
      <>
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回元素目录" onClick={onBack} />
          <span className="t-title-sm grow">{spec.title}</span>
        </div>
        <div className="pscroll bc-scroll">
          <AnimButton anim={anim} onOpen={onOpenAnim} />

          {/* 示范：当前那一格 ＋ 换示范入口（抽屉里是三格） */}
          <SecHead aside={`${demo.strokes.length} 笔`}>示范</SecHead>
          <div className="cfstyle">
            <window.WhiteboardTile demo={demo} on onAdd={() => setView('demo')} />
            <div className="cfstyle__t">
              <b>{demo.name}</b>
              <span className="t-detail-xs">自然画时 {W.natural(wb).toFixed(1)} s{wb.beats.length ? ` · ${wb.beats.length} 拍` : ''}</span>
              <Btn size="s" icon="elements" onClick={() => setView('demo')}>更换示范</Btn>
            </div>
          </div>
          <div className="hint hint--tight">{spec.hint}</div>

          {/* 手：记号笔 / 钢笔 / 无 */}
          <SecHead aside={W.handName(wb.hand)}>手</SecHead>
          <PRow label="手型">
            <Segmented size="s" value={wb.hand} onChange={(k) => write({hand: k})}
              items={W.HANDS.map((h) => ({k: h.k, label: h.name}))} />
          </PRow>
          {wb.hand === 'none' ? <div className="hint hint--tight">无手只剩笔迹逐段出现，适合叠在别的画面上。</div> : null}

          {/* 纸：白纸 / 自定色 / 透明 */}
          <SecHead aside={transparent ? '透明' : wb.paper}>纸</SecHead>
          <PRow label="铺纸">
            <Switch on={!transparent} label={transparent ? '透明 · 露出下层' : '铺一层纸色'}
              onChange={(x) => { write({paper: x ? W.PAPER_DEFAULT : null}); if (!x) setPop(false); }} />
          </PRow>
          {transparent ? null : (
            <PRow label="纸色">
              <ColorField value={wb.paper} scope="白板纸色" open={pop}
                onToggle={() => setPop(!pop)}
                onPick={(x, live) => { write({paper: x}); if (!live) setPop(false); }} inline />
            </PRow>
          )}

          {/* 画时：跟时长走（min(0.8×时长, 自然画时)）或手定；上限是条子时长 */}
          <SecHead aside={W.fmtDraw(wb, dur)}>画时</SecHead>
          <PRow label="节奏">
            <Chip tone={modeUi.tone} pill title={modeUi.hint}>{W.modeName(L.mode)}</Chip>
            <span className="cfseed" title={modeUi.hint}>{modeUi.hint}</span>
          </PRow>
          <PRow label="画时">
            <Switch on={auto} label={auto ? '跟时长走' : '手定'}
              onChange={(x) => write({draw: x ? null : Math.round(W.effectiveDraw(wb, dur) * 10) / 10})} />
          </PRow>
          {auto ? null : (
            <ValueRow label="秒数" value={wb.draw} min={W.LIMITS.draw[0]} max={drawMax} step={0.1} unit="s"
              onChange={(x) => write({draw: Math.round(x * 10) / 10})} />
          )}
          <div className="hint hint--tight">跟时长走 = 时长的 0.8 与自然画时取小；手定值也夹到时长以内，画完定格到条子结束。</div>
          <PRow label="墨线优先">
            <Switch on={wb.inkFirst} onChange={(x) => write({inkFirst: x})}
              label={wb.inkFirst ? '先勾线再上色' : '按原笔顺'} />
          </PRow>

          {/* 节拍：起止与区域只读（由 bcut whiteboard sync / plan 或 skill 写入，原型示范自带）；
              标签 ＋ 本地起止一拍一行，锚点解析不到写「锚点失效」。下面两个开关是 0.9 的
              `pace` / `strict`，再下面是校验结果与「按旁白重新对齐」。 */}
          <SecHead aside={wb.beats.length ? `${wb.beats.length} / ${W.LIMITS.beats}` : '无'}>节拍</SecHead>
          {L.beats.map((b) => (
            <PRow key={b.i} label={`第 ${b.i} 拍`}>
              <span className={cx('cfseed', !b.ok && 'wbbeat--bad')}
                title={`${b.anchored ? `${wb.beats[b.i - 1].at}${wb.beats[b.i - 1].end != null ? ` → ${wb.beats[b.i - 1].end}` : ''} · ` : ''}区域 ${b.box.map((n) => Math.round(n)).join(' / ')}`}>
                {b.label ? <b>{b.label}</b> : null}
                {b.label ? ' · ' : ''}
                <span className="t-mono">{W.fmtBeat(b)}</span>
              </span>
            </PRow>
          ))}
          {wb.beats.length ? (
            <>
              <PRow label="每拍">
                <Switch on={wb.pace === 'natural'} label={W.paceName(wb.pace)}
                  onChange={(x) => write({pace: x ? 'natural' : 'stretch'})} />
              </PRow>
              <PRow label="分区">
                <Switch on={wb.strict} label={wb.strict ? '硬遮罩 · 重叠归后拍' : '按笔画质心归组'}
                  onChange={(x) => write({strict: x})} />
              </PRow>
            </>
          ) : null}
          {L.issues.map((it, i) => (
            <div key={i} className="hint hint--tight hint--warn" title={`${it.code} · ${it.field}`}>{it.msg}</div>
          ))}
          <div className="hint hint--tight">
            节拍把画面分块、给每块一个起止，让笔迹跟旁白对上；起止与区域来自 `bcut whiteboard sync`
            （或 plan / 白板 skill），这一页只改节奏与分区。「画完定格」= 每拍按自然速度画完停到这拍结束；
            「撑满节拍窗」= 拉伸到整个窗。
          </div>
          <PRow label="">
            <Btn size="s" icon="refresh"
              onClick={() => app.toast('按旁白重新对齐：App 里调 bcut whiteboard sync --element 重写画时与节拍（演示）', 'notice')}>
              按旁白重新对齐
            </Btn>
          </PRow>

          {geometry}
          {time}
          <BCAction className="danger" onClick={onDelete}><Ic n="trash" className="ic--16" />{spec.del}</BCAction>
        </div>
      </>
    );
  }

  Object.assign(window, {WhiteboardEdit});
})();
