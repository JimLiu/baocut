/* Elements 面板 · 彩纸属性页（第 231 轮；设计稿 docs/design/elements/bcut-confetti-element-design.md §5）。

   彩纸不再是一张 3 秒的 SVG，而是一条 `kind: "confetti"` 的算法元素：十款配方是
   起点，颜色 / 形状 / 粒子运动 / 发射 / 种子都归用户管，时长随时间轴那条走。这一页
   照 `ElementEdit` 的段序（动画钮 → 本类各段 → 时长 → 删除），本类多出来的六段是
   **款式 → 颜色 → 形状 → 粒子运动 → 发射 → 随机**。「粒子运动」原叫「运动」，2026-10-01 改名：
   §14.7.2 通用的「运动」组（整件元素的关键帧）也长在这一页的几何下面，一页两个同名段分不清。

   算法在 `model-confetti.js`（`BC_CONFETTI`，有单测）；这里只有画与写。写口子只有
   一个：`set({cf: next})` —— `ElementEdit` 把它经 `E.toStage('confetti', …)` 落到这一
   件自己的样式文档键 `confetti`，画布 `stage-elements.jsx` 从同一键读。 */
(function () {
  const {useState, useEffect} = React;
  const C = window.BC_CONFETTI;

  /** 参数行：倍率一律 0.05 步进、显示 ×；像素 / 角度 / 百分比按各自单位。 */
  const MUL = (label, k, cf, write, range) => (
    <ValueRow key={k} label={label} value={cf[k]} min={range[0]} max={range[1]} step={0.05} unit="×"
      onChange={(x) => write({[k]: Math.round(x * 100) / 100})} />
  );

  /** 款式抽屉：十格与目录里那十格同一颗 `ConfettiTile`（悬停即播，与目录同一份
      画法）。悬停预览走 `peekProps`，退场即撤（与 `CatalogView` 同一笔）。 */
  function StyleDrawer({ctx, cf, onPick, onBack}) {
    useEffect(() => () => ctx.setPeek(null), []);
    return (
      <>
        <window.PanelHead title="彩纸款式" onBack={onBack} />
        <div className="pscroll bc-scroll" onMouseLeave={() => ctx.setPeek(null)}>
          <div className="stgrid stgrid--anim">
            {C.STYLES.map((s) => (
              <span key={s.k}
                {...window.peekProps(ctx, 'el', (d) => Object.assign({}, d, {confetti: C.switchStyle(cf, s.k)}))}>
                <window.ConfettiTile style={s} on={cf.style === s.k}
                  onAdd={() => { ctx.setPeek(null); onPick(s.k); onBack(); }} />
              </span>
            ))}
          </div>
          <div className="hint">
            换款回到那一款的配方缺省（颜色、形状、粒子运动、发射一起换），只有种子留着——
            同一条元素换来换去，画面上的那一撮粒子仍是同一撮。
          </div>
        </div>
      </>
    );
  }

  function ConfettiEdit({ctx, el, v, set, anim, onOpenAnim, spec, onBack, onDelete, geometry, time}) {
    const cf = C.normalize(v.cf || C.defaults());
    const style = C.byStyle(cf.style);
    const [view, setView] = useState(null);
    const [pop, setPop] = useState(null);
    const write = (patch) => set({cf: C.normalize(Object.assign({}, cf, patch))});
    const writeEmit = (patch) => write({emit: Object.assign({}, cf.emit, patch)});
    const burst = cf.emit.mode === 'burst';
    const em = C.effectiveEmit(cf);
    const custom = !!cf.origin;
    const R = C.RANGES;
    const sameColors = cf.colors.join() === style.colors.join();
    const sameShapes = cf.shapes.join() === style.shapes.join();

    if (view === 'style') {
      return <StyleDrawer ctx={ctx} cf={cf} onBack={() => setView(null)}
        onPick={(k) => set({cf: C.switchStyle(cf, k)})} />;
    }

    return (
      <>
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回元素目录" onClick={onBack} />
          <span className="t-title-sm grow">{spec.title}</span>
        </div>
        <div className="pscroll bc-scroll">
          <AnimButton anim={anim} onOpen={onOpenAnim} />

          {/* 款式：当前那一格 ＋ 换款入口（抽屉里是十格） */}
          <SecHead aside={style.from}>款式</SecHead>
          <div className="cfstyle">
            <window.ConfettiTile style={style} on onAdd={() => setView('style')} />
            <div className="cfstyle__t">
              <b>{style.name}</b>
              <span className="t-detail-xs">{burst ? '爆发' : '连续'} · {C.SHAPE_NAMES[cf.shapes[0]]}{cf.shapes.length > 1 ? ` 等 ${cf.shapes.length} 种` : ''}</span>
              <Btn size="s" icon="elements" onClick={() => setView('style')}>更换款式</Btn>
            </div>
          </div>

          {/* 颜色：1–8 色，逐格可换、可删、可加；改过就露出「回配方」 */}
          <SecHead aside={`${cf.colors.length} / ${C.LIMITS.colors}`}
            action={sameColors ? null : <BCAction className="revert" onClick={() => write({colors: style.colors.slice()})}>回配方</BCAction>}>
            颜色
          </SecHead>
          {cf.colors.map((c, i) => (
            <PRow key={i} label={`色 ${i + 1}`}>
              <IconBtn icon="minus" size="s" tip="删掉这一色" disabled={cf.colors.length <= 1}
                onClick={() => write({colors: cf.colors.filter((_, j) => j !== i)})} />
              <ColorField value={c} scope={`彩纸色 ${i + 1}`} open={pop === i}
                onToggle={() => setPop(pop === i ? null : i)}
                onPick={(x, live) => {
                  const next = cf.colors.slice(); next[i] = x; write({colors: next});
                  if (!live) setPop(null);
                }} inline />
            </PRow>
          ))}
          {cf.colors.length < C.LIMITS.colors ? (
            <div className="prow2">
              <Btn size="s" icon="plus" onClick={() => write({colors: cf.colors.concat(cf.colors[cf.colors.length - 1])})}>加一色</Btn>
            </div>
          ) : null}
          <div className="hint hint--tight">粒子按种子从这几色里轮流取；删到只剩一色就是单色彩纸。</div>

          {/* 形状：12 种多选，至少留一种 */}
          <SecHead aside={`${cf.shapes.length} / ${C.SHAPES.length}`}
            action={sameShapes ? null : <BCAction className="revert" onClick={() => write({shapes: style.shapes.slice()})}>回配方</BCAction>}>
            形状
          </SecHead>
          <div className="chiprow chiprow--sub">
            {C.SHAPES.map((k) => {
              const on = cf.shapes.indexOf(k) >= 0;
              return (
                <Chip key={k} pill on={on} onClick={() => {
                  if (on && cf.shapes.length <= 1) return;
                  write({shapes: on ? cf.shapes.filter((x) => x !== k) : C.SHAPES.filter((x) => x === k || cf.shapes.indexOf(x) >= 0)});
                }}>{C.SHAPE_NAMES[k]}</Chip>
              );
            })}
          </div>

          {/* 粒子运动：倍率叠在配方的像素量上（1× = 配方原样） */}
          <SecHead aside="1× 是配方原样">粒子运动</SecHead>
          {burst
            ? <ValueRow label="每次数量" value={cf.emit.count} min={R.count[0]} max={R.count[1]} unit="枚"
                onChange={(x) => writeEmit({count: Math.round(x)})} />
            : <ValueRow label="密度" value={cf.emit.rate} min={R.rate[0]} max={R.rate[1]} unit="枚/s"
                onChange={(x) => writeEmit({rate: Math.round(x)})} />}
          {MUL('大小', 'size', cf, write, R.size)}
          {MUL('速度', 'speed', cf, write, R.speed)}
          {MUL('重力', 'gravity', cf, write, R.gravity)}
          <ValueRow label="风" value={cf.wind} min={R.wind[0]} max={R.wind[1]} step={10} unit="px/s²"
            onChange={(x) => write({wind: Math.round(x)})} />
          {MUL('漂移', 'drift', cf, write, R.drift)}
          {MUL('旋转', 'spin', cf, write, R.spin)}
          <ValueRow label="不透明度" value={Math.round(cf.opacity * 100)} min={0} max={100} unit="%"
            onChange={(x) => write({opacity: Math.round(x) / 100})} />

          {/* 发射：连续 / 爆发两种模式，起点默认跟配方 */}
          <SecHead aside={burst ? '第 b 次在 b × 间隔' : '每秒出生 = 密度'}>发射</SecHead>
          <PRow label="模式">
            <Segmented size="s" value={cf.emit.mode} onChange={(k) => writeEmit({mode: k})}
              items={[{k: 'continuous', label: '连续'}, {k: 'burst', label: '爆发'}]} />
          </PRow>
          {burst ? (
            <ValueRow label="间隔" value={cf.emit.interval} min={R.interval[0]} max={R.interval[1]} step={0.5} unit="s"
              onChange={(x) => writeEmit({interval: Math.round(x * 2) / 2})} />
          ) : null}
          {burst && cf.emit.interval === 0 ? <div className="hint hint--tight">间隔 0 = 只放一次，寿命过后画面就空了。</div> : null}
          <PRow label="结束前落尽">
            <Switch on={!!cf.emit.settle} onChange={(x) => writeEmit({settle: x})}
              label={cf.emit.settle ? '片尾前一个寿命不再出生' : '一直放到结束'} />
          </PRow>
          <PRow label="起点">
            <Switch on={custom} label={custom ? '自定' : (em.multi ? `跟配方 · ${style.recipe.emitters.length} 枚发射器` : '跟配方')}
              onChange={(x) => write(x
                ? {origin: {x: Math.round(em.x), y: Math.round(em.y)}, angle: Math.round(em.angle), spread: Math.round(em.spread)}
                : {origin: null, angle: null, spread: null})} />
          </PRow>
          {custom ? (
            <>
              <ValueRow label="起点 X" value={cf.origin.x} min={R.originX[0]} max={R.originX[1]} unit="%"
                onChange={(x) => write({origin: {x: Math.round(x), y: cf.origin.y}})} />
              <ValueRow label="起点 Y" value={cf.origin.y} min={R.originY[0]} max={R.originY[1]} unit="%"
                onChange={(x) => write({origin: {x: cf.origin.x, y: Math.round(x)}})} />
              <ValueRow label="方向" value={cf.angle} min={R.angle[0]} max={R.angle[1]} unit="°"
                onChange={(x) => write({angle: Math.round(x)})} />
              <ValueRow label="扇面" value={cf.spread} min={R.spread[0]} max={R.spread[1]} unit="°"
                onChange={(x) => write({spread: Math.round(x)})} />
              <div className="hint hint--tight">方向 −90° 是正上，0° 是正右；起点可以落在画面外（−20% … 120%）。</div>
            </>
          ) : null}

          {/* 随机：种子只读，「换一组」写一个新种子；同种子同画面（设计稿 §2.4） */}
          <SecHead aside="同一种子同一画面">随机</SecHead>
          <PRow label="种子">
            <span className="t-mono cfseed" title={String(cf.seed)}>{cf.seed}</span>
            <Btn size="s" icon="refresh" onClick={() => write({seed: C.randomSeed()})}>换一组</Btn>
          </PRow>

          {geometry}
          {time}
          <BCAction className="danger" onClick={onDelete}><Ic n="trash" className="ic--16" />{spec.del}</BCAction>
        </div>
      </>
    );
  }

  Object.assign(window, {ConfettiEdit});
})();
