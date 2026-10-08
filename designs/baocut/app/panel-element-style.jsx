/* Elements 面板 · 属性页的「颜色」与「样式」两大段（§14.2；第 122 轮 WP-E 从
   [panel-element-edit.jsx](panel-element-edit.jsx) 拆出来——那个文件到了 660 行，
   过了本目录 ~600 行的上限）。

   拆的边界是属性页的段序，不是行数凑出来的：**颜色是属性页的第二段**
   （`动画 → 颜色 → 旋转 → 时长 → 删除`），而计时 / 文字 / 形状 / 样式目录 /
   滑杆 / 区间 / 说话人 / 占位留言那些段排在这四段之后。
   所以这里是两个组件：`ColorSection`（段序里的那一段）与
   `StyleSection`（其余段）。两者都只读写传进来的 `v` / `set`，页容器在原文件里。

   颜色这一段有三支，按类型互斥：
     · 声波 / 进度 → 主色 ＋ 副色，**张数与标题跟着样式走**（核心的 numColors /
       colorLabels）；
     · 贴纸 → 素材自己解析出来的色卡（`BC_SVGFILL` 的分组，见
       [sticker-fills.jsx](sticker-fills.jsx)）；
     · 形状 / 标注 / 取景框 → `spec.colors` 那一张张卡。 */
(function () {
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const T = window.BC_TIME;
  const B = window.BC_BAR;

  /* ---------- 颜色段（属性页段序里的第二段） ---------- */
  function ColorSection({v, set, spec, el, pop, setPop, ctx}) {
    const cat = spec.catalog === 'wave' ? E.WAVES : spec.catalog === 'progress' ? E.PROGRESS : null;
    const curStyle = cat ? (cat.filter((x) => x.k === v.style)[0] || cat[0]) : null;
    const colorRow = (k, label, clearLabel) => (
      <PRow label={label} key={k}>
        <ColorField value={v[k]} scope={label} open={pop === k} clearLabel={clearLabel}
          onToggle={() => setPop(pop === k ? null : k)}
          onPick={(x, live) => { set({[k]: x}); if (!live) setPop(null); }} inline />
      </PRow>
    );
    return (
      <>
        {/* 颜色。声波与进度的色板**个数与标题都跟着样式走**（核心的 numColors /
            colorLabels）：段头不论一张两张都叫「颜色」，
            一张都没有时整段收走并说明为什么。此前进度这一支恒出「主色 ＋ 轨道」两行——彩虹边框
            上那两行写下去不会有任何画面变化，游走彩虹的那一张也不叫轨道。 */}
        {cat ? (
          curStyle.colors === 0
            ? <div className="hint">「{curStyle.name}」没有颜色控件——它的配色由素材本身决定。</div>
            : <>
                <SecHead>颜色</SecHead>
                <div className="sec">
                  {colorRow('main', curStyle.labels[0] || '主色')}
                  {curStyle.colors === 2 ? colorRow('second', curStyle.labels[1] || '副色') : null}
                </div>
              </>
        ) : null}

        {/* 贴纸的颜色由**素材本身**决定（第 122 轮，判据在 `model-svgfill.js`）：
            素材里有几个填充色分组就出几张卡、最多 5 张，逐张改只换那一组。所以它没有
            写死的 `colors`，整行画在 [sticker-fills.jsx](sticker-fills.jsx) 里，与画布
            浮动条上那一排是同一份状态（`elDocs[id].fillList`）。 */}
        {spec.fills ? <window.StickerFillRow ctx={ctx} el={el} pop={pop} setPop={setPop} /> : null}

        {spec.colors ? (
          <>
            <SecHead>颜色</SecHead>
            {/* 一色一张卡（第 43 轮）：卡头是色名 ＋ 色钮，卡身是
                不透明度，带 `w` 的那一色再多一档粗细。此前是一段平铺的行，
                「这一档不透明度是填充的还是描边的」得数行数才知道。
                第 83.1 轮拆掉卡下面那一排 8 格快捷色：它只写 `colors[0]`（填充），
                却摆在两张卡**下面**，读起来像是两张卡共用的；现在那两张卡就是全部，
                颜色一律从卡上的色钮进取色面板。声波 / 进度那一支同理。 */}
            {spec.colors.map((c) => (
              <div className="stcard stcard--open" key={c.k}>
                <div className="hd">{c.label}
                  <ColorField value={v[c.k]} scope={c.label} open={pop === c.k} clearLabel={c.clear}
                    onToggle={() => setPop(pop === c.k ? null : c.k)}
                    onPick={(x, live) => { set({[c.k]: x}); if (!live) setPop(null); }} inline />
                </div>
                <div className="bd">
                  <ValueRow label="不透明度" value={v[c.k + 'A']} min={0} max={100} unit="%"
                    onChange={(x) => set({[c.k + 'A']: x})} />
                  {c.w ? (() => {
                    const sl = (spec.sliders || []).filter((x) => x.k === c.w)[0];
                    return sl ? <ValueRow label={sl.label} value={v[sl.k]} min={sl.min} max={sl.max}
                      unit={sl.unit} onChange={(x) => set({[sl.k]: x})} /> : null;
                  })() : null}
                </div>
              </div>
            ))}
          </>
        ) : null}
      </>
    );
  }

  /* ---------- 样式段（按类型；颜色以外的那几段） ---------- */
  function StyleSection({v, set, spec, pop, setPop, onCatalog, ctx}) {
    const app = useApp();
    const cat = spec.catalog === 'wave' ? E.WAVES : spec.catalog === 'progress' ? E.PROGRESS : null;
    const curStyle = cat ? (cat.filter((x) => x.k === v.style)[0] || cat[0]) : null;
    // 被颜色卡认领的滑杆（`colors[].w`），下面那一段就不再画它
    const claimed = {};
    (spec.colors || []).forEach((c) => { if (c.w) claimed[c.w] = true; });
    return (
      <>
        {/* 计时段（第 88 轮，`docs/design/elements/bcut-counter-element-design.md`）。**内容在前、外观在后**：
            这一段回答「读数从哪来」，下面的颜色 / 字号回答「读数长什么样」。
            两个封闭枚举各一条 Segmented（模式二值、钟面三值，设计稿 §3），再加一行
            **活的读数**——计时的全部争议都在边界上（换值锚在哪一端、半开区间、
            非整秒的零头落在哪一格），静态截图说不清，跟着播放头走一遍就看明白了。 */}
        {spec.counter ? (() => {
          const mode = v.mode || E.COUNTERS[0].k;
          const fmt = v.format || E.COUNT_FORMATS[1].k;
          const t = (ctx && ctx.playT) || 0;
          const read = E.counterText(mode, fmt, t, v.tStart, v.tEnd);
          const next = E.counterNextChange(mode, t, v.tStart, v.tEnd);
          return (
            <>
              <SecHead>计时</SecHead>
              <Segmented size="s" value={mode} onChange={(x) => set({mode: x})}
                items={E.COUNTERS.map((c) => ({k: c.k, label: c.name}))} />
              <SecHead aside={'例 ' + E.COUNT_FORMATS.filter((f) => f.k === fmt)[0].sample}>钟面</SecHead>
              <Segmented size="s" value={fmt} onChange={(x) => set({format: x})}
                items={E.COUNT_FORMATS.map((f) => ({k: f.k, label: f.name}))} />
              <div className="cntpv">
                <b className="t-mono">{read == null ? '—' : read}</b>
                <span>
                  {read == null
                    ? '播放头 ' + T.timecode(t) + ' 不在这条的时间窗里'
                    : '播放头 ' + T.timecode(t) + ' · '
                      + (next == null ? '这是最后一格，之后元素消失'
                         : '下一次换值 ' + T.timecode(next))}
                </span>
              </div>
            </>
          );
        })() : null}

        {/* 文字样式（第 88 轮）：计时**就是一条文字元素**（ADR-CT01），所以这一段与
            Text 面板的「样式」那一行是同一批控件、同一个共用件（`FontPicker` /
            `B.SIZES` / `ColorPanel`），只是写的键错开（`SHARED.counter`，见那里的说明）。
            **对齐三档第 89.1 轮补上**（用户裁决），与 Text 面板那一行同一颗 Segmented、
            同一组词表；默认居中。它成立的前提是同轮给的宽度柄——盒子恒等于内容宽时，
            左中右画出来是同一张图。 */}
        {spec.textStyle ? (
          <>
            <SecHead>文字</SecHead>
            <div className="txrow">
              <div style={{flex: '1 1 auto', minWidth: 0, position: 'relative'}}>
                <Picker wide value={String(v.font).split(' ')[0]} open={pop === 'font'}
                  onClick={() => setPop(pop === 'font' ? null : 'font')} />
                {pop === 'font' ? (
                  <FontPicker inline value={v.font}
                    onPick={(n) => { set({font: n}); setPop(null); }} />
                ) : null}
              </div>
              <div style={{flex: 'none', position: 'relative'}}>
                <Picker value={v.size + 'px'} open={pop === 'size'}
                  onClick={() => setPop(pop === 'size' ? null : 'size')} />
                <Popover open={pop === 'size'} onClose={() => setPop(null)} align="right" dir="down" width={132}>
                  {B.SIZES.indexOf(v.size) < 0
                    ? <div className="mdi is-on"><span className="nm">{v.size}px</span><Ic n="check" className="ic--14" /></div>
                    : null}
                  {B.SIZES.map((sz) => (
                    <BCAction size="M" key={sz} className={cx('mdi', v.size === sz && 'is-on')}
                      onClick={() => { set({size: sz}); setPop(null); }}>
                      <span className="nm">{sz}px</span>
                      {v.size === sz ? <Ic n="check" className="ic--14" /> : null}
                    </BCAction>
                  ))}
                </Popover>
              </div>
              {/* 全项目同一颗 `ColorField`（第 89.3 轮），与 Text 面板那一行是同一颗 */}
              <ColorField value={v.color} scope="读数" open={pop === 'color'}
                onToggle={() => setPop(pop === 'color' ? null : 'color')}
                onPick={(c, live) => { set({color: c}); if (!live) setPop(null); }} inline />
            </div>
            <div className="txrow" style={{marginTop: 8}}>
              <div className="seg">
                <BCAction className={cx('seg__b', v.bold && 'is-on')} style={{fontWeight: 800}}
                  onClick={() => set({bold: !v.bold})}>B</BCAction>
                <BCAction className={cx('seg__b', v.italic && 'is-on')} style={{fontStyle: 'italic'}}
                  onClick={() => set({italic: !v.italic})}>I</BCAction>
              </div>
              <Segmented value={v.align || 'center'} onChange={(x) => set({align: x})}
                items={E.ALIGNS} />
            </div>
            {/* 容器宽的数字在本页上面的几何段里（「宽」，画幅宽 %，panel-geometry.jsx）；
                这里不再摆第二个入口。画布上拉宽容器仍是拖两侧的竖胶囊。 */}
            <div className="hint hint--tight">对齐对的是读数与容器之间那段留白——容器拉宽了才看得出来（拖元素两侧的竖胶囊）。</div>
          </>
        ) : null}

        {cat ? (
          <>
            <SecHead>样式</SecHead>
            <BCAction className="drill" onClick={onCatalog}>
              <span className="ic2 ic2--viz"><window.VizGlyph it={curStyle} /></span>
              <span className="tt"><b>{curStyle.name}</b><span>{cat.length} 种 · 点开选</span></span>
              <NavChevron style={{color: 'var(--gray-500)'}} />
            </BCAction>
          </>
        ) : null}

        {spec.shape ? (
          <>
            <SecHead>形状</SecHead>
            <div className="stgrid stgrid--shape stgrid--inline">
              {E.SHAPES.map((s) => (
                <window.ShapeTile key={'sh' + s.i} tile={s} on={v.shapeI === s.i}
                  onAdd={() => set({shapeI: s.i, fill: s.fill, outline: s.outline,
                                    corner: s.r ? 10 : 0})} />
              ))}
            </div>
          </>
        ) : null}

        {spec.style ? (
          <>
            <SecHead>{spec.style.label}</SecHead>
            <Picker wide field value={spec.style.value}
              onClick={() => app.toast('样式选择器：抽屉里是同一份缩略图')} />
          </>
        ) : null}

        {/* 已经画进颜色卡里的那几档（`colors[].w`）不再重复出一行 */}
        {spec.sliders && spec.sliders.some((s) => !claimed[s.k]) ? (
          <>
            <SecHead>{spec.shape ? '圆角' : '控制'}</SecHead>
            <div className="sec">
              {spec.sliders.map((s) => (
                claimed[s.k] || (spec.catalog === 'wave' && !curStyle.db && (s.k === 'mindb' || s.k === 'maxdb'))
                  ? null
                  : <ValueRow key={s.k} label={s.label} value={v[s.k]} min={s.min} max={s.max}
                      unit={s.unit} onChange={(x) => set({[s.k]: x})} />
              ))}
            </div>
          </>
        ) : null}

        {spec.range ? (
          <>
            <SecHead aside="反向区间 = 倒计条">区间</SecHead>
            <div className="sec">
              <ValueRow label="起点" value={v.start} min={0} max={100} unit="%" step={5} onChange={(x) => set({start: x})} />
              <ValueRow label="终点" value={v.end} min={0} max={100} unit="%" step={5} onChange={(x) => set({end: x})} />
            </div>
          </>
        ) : null}

        {spec.speaker ? (
          <>
            <SecHead>说话人</SecHead>
            <Segmented size="s" value={v.spk || 'all'} onChange={(x) => set({spk: x})}
              items={[{k: 'all', label: '全部音频'}].concat(
                Object.keys(D.speakers).slice(0, 2).map((id) => ({k: id, label: D.speakers[id].name})))} />
            <div className="sec" style={{marginTop: 8}}>
              <PRow><span className="lab" style={{width: 'auto'}}>始终显示</span>
                <div className="push"><Switch on={v.always !== false} onChange={(x) => set({always: x})} /></div>
              </PRow>
            </div>
          </>
        ) : null}

        {spec.endBehavior ? (
          <>
            <SecHead>结束行为</SecHead>
            <Segmented size="s" value={String(v.endBehavior)} onChange={(x) => set({endBehavior: +x})}
              items={spec.endBehavior.map((b, i) => ({k: String(i), label: b}))} />
          </>
        ) : null}

        {spec.hint ? <div className="hint">{spec.hint}</div> : null}
      </>
    );
  }

  Object.assign(window, {ColorSection, StyleSection});
})();
