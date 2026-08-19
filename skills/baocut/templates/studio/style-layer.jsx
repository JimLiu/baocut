// BaoCut Subtitle Studio — 样式 slide-over（Mac `SubtitlePanel/Pane/StylePaneView`
// 与 `StylePaneSections` 的 Studio 孪生；Mac 自己照 designs/baocut-mac/app/
// style-panel.jsx 实现）。Style 不是第四个 tab，而是盖住整个右侧 pane 的层。
// 入口三处：舞台工具条的「字幕样式 / 译文样式」、各 pane 工具行的样式选择器
// 「编辑样式…」、深链 `/style`（store.jsx 解释）。
//
// 层的骨架（自上而下）与 Mac `StylePaneView.layout()` 逐项对应：
//   头部（图标 · 标题 · 关闭）→ 样片 → 样片来源条 → 面包屑 → tab 条 → 滚动区 → 底部条
//
// 两个上下文（ctx）：
//   sub  字幕样式 —— Transcript / Subtitle tab 进来，画面上只有原文（Mac 的 isMono）
//   bi   译文样式 —— Translate tab 进来，读 style.mode 排两行
//
// **目标行**（Mac M120 §8 决策 6）：控件在写哪一行由舞台选中决定（`app.sel.line`），
// 面板只陈述它（面包屑）并给一条回到两行的路。行级样式落进 `origStyle` /
// `transStyle` 局部覆盖 —— 内核 `nestedLineStyle` 与烧录端 `studio_export.rs` 读的
// 就是这两个键，所以"只改译文颜色"在预览和成片里是同一件事。
//
// 与 Mac 的结构差异（Studio 没有对应模型/写路径，直接省略而不是占位）：
//   · 没有样式库（保存/重命名/删除、Your styles 分组）：Studio 的样式是单份项目
//     覆盖层 bcs:style。底部条因此不是「保存为样式…」，而是当前预设名 + 恢复 Agent
//     样式（resetStyle 是这里唯一有意义的「回到某个基准」动作）。
//   · 「显示」分区只有标点：`wrapMode` / `charLimit` 在 Studio 的扁平样式模型里
//     没有任何消费方（内核与烧录端都只按字幕框宽度折行），做出来等于宣传一个不
//     存在的效果。
//   · 逐词动画的 Custom 配方、Designed Caption 与 Emphasis：内核没有对应实现。
//
// 控件只写 Studio 样式模型里已经有人消费的字段：预览内核（subtitle-rendering.js /
// canvas-stage.jsx）与 CLI 烧录端读同一份扁平样式。开关派生、颜色 alpha、效果
// 种子值与行级补丁统一在 style-fields.js（纯函数 + 单测）里，面板不自带第二份判据。
(() => {
const { useEffect, useState, useRef } = React;
const { Ic, QBtn, Segmented, useApp, usePlayer, useEsc, toast } = window;
const R = window.BCS_SUBTITLE;
if (!R) throw new Error('subtitle-rendering.js failed to load');
const F = window.BCS_STYLE_FIELDS;
if (!F) throw new Error('style-fields.js failed to load');
const SP = window.BCS_STYLE_PRESETS;
if (!SP) throw new Error('style-presets.js failed to load');
const FONT_CATALOG = window.BCS_FONT_CATALOG;
if (!FONT_CATALOG) throw new Error('font-catalog.js failed to load');
// 分区/行/滑块/色板/字体选择器与「文字·背景·描边·发光·阴影」五个分区都在
// text-style-controls.jsx —— 元素与水印的文本样式复用同一份（不复制两套判据）。
const TS = window.BCS_TEXT_STYLE;
if (!TS) throw new Error('text-style-controls.jsx failed to load');
const {
  SpSect, SpRow, SpSlider, SpSwitchRow,
  TextSect, BackgroundSect, StrokeSect, GlowSect, ShadowSect,
} = TS;

const PREVIEW_SOURCE_KEY = 'vk-sp-prevsrc';
// 「从原文复制样式」搬运的是**外观**，不含几何与摆放（Mac
// StylePaneSections.buildTransStyle：阴影丢掉、字号留给比例契约）。
const LOOK_KEYS = [
  'fontFamily', 'fontColor', 'bold', 'italic', 'underline', 'textTransform',
  'align', 'lineHeight', 'letterSpacing',
  'background', 'backgroundColor', 'backgroundPadding', 'backgroundStyle', 'borderRadius',
  'outline', 'textOutline', 'glow',
];

// ---------- 样片（层顶部的预览） ----------
// 走内核的 layoutMetrics / effectStyle，只是把画框换成一个 16:9 小框，
// referenceScale 会把字号、内边距、圆角一起缩到样片尺度 —— 面板不自己解释样式。
// 16:9、短边 648 = 1080 的 0.6：样片按 0.6 倍尺度显示（原型的样片是 0.5），
// 字号、内边距、圆角、字距全由 layoutMetrics 的 referenceScale 一起缩。
const SAMPLE_FRAME = { w: 1152, h: 648 };
// 参考帧：只用来把内核算出来的行字号换算回样式单位（metrics.fontSize /
// canvasScale = lineFontSize），面板因此不需要自己复制那套双语缩放。
const SIZE_FRAME = { w: 1920, h: 1080 };
const SAMPLE_TEXT = { orig: '样式实时生效，导出一致。', trans: '译文行就是这个样子。' };

function lineFontSize(st, line, compact) {
  const metrics = R.layoutMetrics(st, SIZE_FRAME.w, SIZE_FRAME.h, line === 'trans', compact);
  return Math.round(metrics.fontSize / metrics.canvasScale);
}

function SampleLine({ st, line, compact, shared, text, focus }) {
  const isTrans = line === 'trans';
  const metrics = R.layoutMetrics(st, SAMPLE_FRAME.w, SAMPLE_FRAME.h, isTrans, compact);
  const lineStyle = metrics.lineStyle;
  const fx = R.effectStyle(lineStyle);
  const bold = lineStyle.bold != null
    ? lineStyle.bold
    : ['bold', 'semibold', 'heavy'].includes(lineStyle.fontWeight);
  const shadowAngle = (fx.shadowRotation || 0) * Math.PI / 180;
  const shadowDistance = fx.shadowDistance * metrics.fontSize;
  const plate = !shared && R.hasRealBackground(metrics);
  const shown = R.projectPunctuation(
    R.transformText(text, lineStyle),
    null,
    st.punct !== false,
  );
  // 发光与阴影共用一个 CSS text-shadow 槽位，和内核 canvas-stage 的取舍一致：
  // 开着发光时阴影不画。
  const glow = fx.glowOn
    ? '0 0 ' + (fx.glowRange / 100 * metrics.fontSize * 0.9) + 'px '
      + R.colorWithAlpha(fx.glowColor, fx.glowIntensity / 100)
    : null;
  return (
    // 单行被选为目标时，另一行变淡 —— 这就是「现在只在写这一行」的样子
    // （Mac refreshPreview 的 editingLayer / 原型 .vk-spp__sub--dim）。
    <span className={'vk-spp__line'
      + (focus && focus === line ? ' vk-spp__line--editing' : '')
      + (focus && focus !== line ? ' vk-spp__line--dim' : '')} style={{
      fontFamily: FONT_CATALOG.stackFor(lineStyle.fontFamily || st.fontFamily),
      fontSize: metrics.fontSize,
      lineHeight: metrics.lineHeight,
      letterSpacing: metrics.letterSpacing,
      color: lineStyle.fontColor || '#FFFFFF',
      fontWeight: bold ? 800 : 500,
      fontStyle: lineStyle.italic ? 'italic' : undefined,
      textDecoration: lineStyle.underline ? 'underline' : undefined,
      textAlign: metrics.align,
      WebkitTextStroke: fx.outlineOn
        ? Math.max(0.4, metrics.fontSize * fx.outlineWidth / 400) + 'px ' + fx.outlineColor
        : undefined,
      paintOrder: 'stroke fill',
      textShadow: glow || (fx.shadowOn
        ? Math.cos(shadowAngle) * shadowDistance + 'px ' + Math.sin(shadowAngle) * shadowDistance + 'px '
          + fx.shadowBlur * metrics.fontSize + 'px ' + fx.shadowColor
        : undefined),
      background: plate ? (lineStyle.backgroundColor || '#000000CC') : undefined,
      padding: plate ? metrics.padV + 'px ' + metrics.padH + 'px' : undefined,
      borderRadius: plate ? metrics.borderRadius : undefined,
    }}>{shown}</span>
  );
}

function StyleSample({ st, ctx, hue, texts, focus }) {
  // 样片排几行跟舞台同一个判据（R.stageMode）：ctx sub 恒为原文一行，
  // ctx bi 才读 st.mode。样片不许自带第二份模式解释。
  const mode = R.stageMode(ctx, st.mode);
  const lines = R.resolveModeLines(mode, st.order);
  const compact = lines.length > 1;
  const shared = compact && st.backgroundMode === 'shared'
    && R.hasRealBackground(R.layoutMetrics(st, SAMPLE_FRAME.w, SAMPLE_FRAME.h, false, compact));
  const plate = R.sharedPlateLine(lines.map((line) => ({
    line, metrics: R.layoutMetrics(st, SAMPLE_FRAME.w, SAMPLE_FRAME.h, line === 'trans', compact),
  })));
  const plateMetrics = shared && plate ? plate.metrics : null;
  return (
    // 样片是"外观的图示"，里面的示例句子不是文档内容：给 role=img + 标签，
    // 让读屏知道这里有预览，而不是把一句假字幕念出来。
    <div className="vk-spp" role="img" aria-label="字幕样式样片预览" style={{
      background: 'linear-gradient(140deg, oklch(0.40 0.09 ' + hue + ') 0%, oklch(0.22 0.06 '
        + ((hue + 50) % 360) + ') 60%, oklch(0.15 0.04 ' + ((hue + 90) % 360) + ') 100%)',
    }}>
      <div className="vk-spp__stack" style={{
        gap: Math.max(0, Number(st.gap == null ? 6 : st.gap)) * 0.5,
        maxWidth: (st.width || 80) + '%',
        transform: st.rotation ? 'rotate(' + st.rotation + 'deg)' : undefined,
        background: plateMetrics ? (plateMetrics.lineStyle.backgroundColor || '#000000CC') : undefined,
        padding: plateMetrics ? plateMetrics.padV + 'px ' + plateMetrics.padH + 'px' : undefined,
        borderRadius: plateMetrics ? plateMetrics.borderRadius : undefined,
      }}>
        {lines.map((line) => (
          <SampleLine key={line} st={st} line={line} compact={compact} shared={!!plateMetrics}
            text={(texts && texts[line]) || SAMPLE_TEXT[line]} focus={focus} />
        ))}
      </div>
    </div>
  );
}

// 「来自视频」时样片跟着播放头走。单独一个组件是为了把 usePlayer 的每帧重渲染
// 关在这里：整个面板订阅播放时间会让每个滑块每帧重建（store.jsx 的告诫）。
function StyleSampleLive({ st, ctx, hue, focus, doc, cueAt, transCueAt }) {
  const { t } = usePlayer();
  const cue = cueAt(doc, t);
  const trans = transCueAt(doc, t);
  return (
    <StyleSample st={st} ctx={ctx} hue={hue} focus={focus} texts={{
      orig: (cue && cue.text) || SAMPLE_TEXT.orig,
      trans: (trans && trans.text) || SAMPLE_TEXT.trans,
    }} />
  );
}

// 样片来源条（Mac SpPreviewBarView / 原型 SpPreviewBar）：样片是安静的默认值，
// 切到「来自视频」用真实字幕对样式，不必去时间轴上拖播放头。
function SamplePreviewBar({ source, onSource, cueIdx, cueTotal, onStep }) {
  return (
    <div className="vk-spbar">
      <Segmented size="S" value={source} onChange={onSource} options={[
        { value: 'sample', label: '示例' },
        { value: 'video', label: '来自视频' },
      ]} />
      {source === 'video' ? (
        <div className="vk-spbar__step">
          <QBtn icon="chevron-left" size="S" tip="上一条字幕" disabled={!cueTotal} onClick={() => onStep(-1)} />
          <span className="vk-spbar__cue vk-mono">{cueTotal ? (cueIdx + 1) + ' / ' + cueTotal : '—'}</span>
          <QBtn icon="chevron-right" size="S" tip="下一条字幕" disabled={!cueTotal} onClick={() => onStep(1)} />
        </div>
      ) : <span className="vk-spbar__hint">样片固定不变 —— 实时效果看左侧画面。</span>}
    </div>
  );
}

// ---------- 路标（Mac 的 signpost / makeSpHint + 一个按钮） ----------
// 回答「其余的在哪」，并给一次点击就能过去的路。刻意**不**复制它指向的控件：
// 复制出来就又要回答"哪一份是真的"。
function Signpost({ text, actions }) {
  return (
    <div className="vk-sp__signpost">
      <span>{text}</span>
      <span className="vk-sp__signpost-acts">
        {(actions || []).filter(Boolean).map((action) => (
          <button key={action.label} className="s2-btn s2-btn--S s2-btn--secondary"
            disabled={action.disabled} onClick={action.onClick}>{action.label}</button>
        ))}
      </span>
    </div>
  );
}

// ---------- Style 分区 ----------
// 双语：只在 ctx bi 渲染（sub 上下文的模式钉死在原文）。行序与标签同 Mac
// StylePaneSections.buildBilingual：显示 → 顺序 → 间距 → 背景。
function BilingualSect({ st, set, mode, first }) {
  const desc = {
    bi: '视频上显示双语', trans: '仅译文', orig: '仅原文',
  }[mode] || '';
  return (
    <SpSect title="双语" first={first}>
      <SpRow label="显示" fill>
        <span className="vk-sp__rowsub">{desc}</span>
      </SpRow>
      <SpRow fill>
        <Segmented stretch size="S" value={mode} onChange={(v) => set({ mode: v })} options={[
          { value: 'bi', label: '双语' },
          { value: 'trans', label: '译文' },
          { value: 'orig', label: '原文' },
        ]} />
      </SpRow>
      {mode === 'bi' ? (
        <React.Fragment>
          <SpRow label="顺序" fill>
            <Segmented stretch size="S" value={st.order === 'orig' ? 'orig' : 'trans'}
              onChange={(v) => set({ order: v })}
              options={[{ value: 'orig', label: '原文在上' }, { value: 'trans', label: '译文在上' }]} />
          </SpRow>
          <SpSlider label="间距" value={Number(st.gap == null ? 6 : st.gap)} min={0} max={24}
            onChange={(v) => set({ gap: v })} fmtV={(v) => v + 'px'} />
          <SpRow label="背景" fill>
            <Segmented stretch size="S" value={st.backgroundMode === 'shared' ? 'shared' : 'separate'}
              onChange={(v) => set({ backgroundMode: v })}
              options={[{ value: 'shared', label: '单一背景块' }, { value: 'separate', label: '分开' }]} />
          </SpRow>
        </React.Fragment>
      ) : null}
    </SpSect>
  );
}

// 变换：缩放与旋转（Mac TransformSections.buildTransform），折行宽度是字幕自己的
// 变换，走 Mac 那个 extra 槽位，跟在同一分区里。
function TransformSect({ st, set }) {
  return (
    <SpSect title="变换">
      <SpSlider label="缩放" value={Math.round(Number(st.scale == null ? 1 : st.scale) * 100)}
        min={10} max={400} step={5}
        onChange={(v) => set({ scale: v / 100 })} fmtV={(v) => v + '%'} />
      <SpSlider label="旋转" value={Math.round(Number(st.rotation || 0))} min={-180} max={180}
        onChange={(v) => set({ rotation: v })} fmtV={(v) => v + '°'} />
      <SpSlider label="宽" value={Number(st.width || 80)} min={30} max={100}
        onChange={(v) => set({ width: v })} fmtV={(v) => v + '%'} />
      <div className="vk-sp__hint">宽度决定在哪里折行；在画面上拖手柄可以缩放和旋转。</div>
    </SpSect>
  );
}

// 块级位置 + 块级垂直锚点：y 钉住整栈的哪条边，也就是折行往哪边生长。
// 与 Mac TransformSections.buildPosition 的差异：Mac 的 X/Y 是对 1920 参考帧的
// 像素输入框 + 六格对齐，Studio 的字幕几何本来就是百分比（烧录端直接吃 x/y%），
// 这里保留百分比滑块 —— 元素检查器出于同一理由也显示百分比。
function PositionSect({ st, set }) {
  return (
    <SpSect title="位置">
      <SpSlider label="水平" value={Number(st.x == null ? 50 : st.x)} min={3} max={97} step={0.5}
        onChange={(v) => set({ x: v })} fmtV={(v) => v + '%'} />
      <SpSlider label="垂直" value={Number(st.y == null ? 86 : st.y)} min={4} max={96} step={0.5}
        onChange={(v) => set({ y: v })} fmtV={(v) => v + '%'} />
      <SpRow label="锚点" fill>
        <Segmented stretch size="S" value={F.blockAlign(st)} onChange={(v) => set({ verticalAlign: v })}
          options={[{ value: 'top', label: '顶部' }, { value: 'center', label: '居中' }, { value: 'bottom', label: '底部' }]} />
      </SpRow>
      <div className="vk-sp__hint">垂直位置钉住整块字幕的这条边，折行时往另一边生长。</div>
    </SpSect>
  );
}

// 单行摆放（Mac StylePaneSections.buildLinePosition）：只对**当前目标行**出现，
// 行自己的 x/y 与锚点只在它脱离堆栈之后才存在，所以摆放开关就在这里；堆叠状态下
// 三行控件仍然在位（只是禁用并显示它当前渲染用的值）。
function LinePositionSect({ st, set, line, label, stackOrder }) {
  const position = R.linePosition(st, line);
  const detached = !!position;
  const rank = stackOrder.indexOf(line);
  const seam = R.seamAlign(rank < 0 ? 0 : rank, stackOrder.length);
  const align = R.lineVerticalAlign(st, line) || seam;
  const blockX = Number(st.x == null ? 50 : st.x);
  const blockY = Number(st.y == null ? 86 : st.y);
  // 脱离瞬间画面要零跳动：中心点只有画布知道（BCS_LINE_CENTERS 是画布留下的只读
  // 快照），按目标锚点换算成锚边坐标后再写回。读不到时退回块级锚点。
  const detach = () => {
    const snap = (window.BCS_LINE_CENTERS || {})[line];
    const base = snap && Number.isFinite(snap.x) && Number.isFinite(snap.y)
      ? { x: snap.x, y: R.lineAnchorFromCenter(snap.y, snap.h, seam) }
      : { x: blockX, y: blockY };
    set(R.lineStylePatch(st, line, { ...base, verticalAlign: seam }));
    toast(label + '行已脱离堆栈，可单独摆放', { variant: 'positive' });
  };
  const move = (patch) => set(R.lineStylePatch(st, line, { ...position, ...patch }));
  return (
    <SpSect title="位置">
      <SpRow label="摆放" fill>
        <Segmented stretch size="S" value={detached ? 'free' : 'stack'}
          onChange={(v) => {
            if (v === 'free') { detach(); return; }
            set(R.lineStylePatch(st, line, null));
            toast(label + '行已恢复联动', { variant: 'neutral' });
          }}
          options={[{ value: 'stack', label: '跟随堆栈' }, { value: 'free', label: '独立' }]} />
      </SpRow>
      <SpSlider label="水平" value={position ? position.x : blockX} min={3} max={97} step={0.5}
        disabled={!detached} onChange={(v) => move({ x: v })} fmtV={(v) => v + '%'} />
      <SpSlider label="垂直" value={position ? position.y : blockY} min={4} max={96} step={0.5}
        disabled={!detached} onChange={(v) => move({ y: v })} fmtV={(v) => v + '%'} />
      <SpRow label="锚点" fill>
        <Segmented stretch size="S" value={align}
          onChange={(v) => move({ verticalAlign: v })}
          options={[
            { value: 'top', label: '顶部' },
            { value: 'center', label: '居中' },
            { value: 'bottom', label: '底部' },
          ].map((option) => ({ ...option, disabled: !detached }))} />
      </SpRow>
      <div className="vk-sp__hint">
        {detached
          ? '这一行的垂直位置钉住它自己的这条边，折行时往另一边生长。'
          : '跟随堆栈时锚点由两行之间的接缝决定：上行向上生长，下行向下生长。'}
      </div>
    </SpSect>
  );
}

// 显示：这个上下文的**投送策略**，原文与译文共用（Mac buildDisplay）。
// Mac 这里还有「换行 = 宽度 / 字符数」与字符数滑块；Studio 的扁平样式模型里
// `wrapMode` / `charLimit` 没有任何消费方（内核与烧录端都只按字幕框宽度折行），
// 所以那两个控件不做，改成一句说明指向真正管折行的那个控件。
function DisplaySect({ st, set, first }) {
  return (
    <SpSect title="显示" first={first}>
      <SpSwitchRow label="标点" sub="显示中文逗号与句号" checked={st.punct === false}
        tip="项目级开关，原文与译文同时生效"
        onChange={(shown) => set({ punct: !shown })} />
      <div className="vk-sp__hint">换行按「变换 › 宽」的字幕框宽度决定。</div>
    </SpSect>
  );
}

// ---------- Animate ----------
// 分区顺序同 Mac buildAnimate：过渡（整栈共用）→ 基础（逐词，只属于原文行）。
// Mac 的 Designed Caption 与 Emphasis 分区在 Studio 内核里没有实现，故不做。
function EntranceSect({ st, set }) {
  const config = R.transitionConfig(st);
  const transitionId = config.id;
  const speed = config.speed;
  const ms = (value) => Math.round(R.transitionDuration({
    transition: { transitionId, transitionSpeed: value },
  }) * 1000);
  const setTransition = (patch) => set({ transition: { transitionId, transitionSpeed: speed, ...patch } });
  return (
    <SpSect title="过渡" first>
      <div className="vk-sp__trgrid">
        {F.TRANSITIONS.map((tr) => (
          <button key={tr.id} className={'vk-sp__tr' + (transitionId === tr.id ? ' vk-sp__tr--on' : '')}
            aria-pressed={transitionId === tr.id}
            onClick={() => setTransition({ transitionId: tr.id })}>{tr.name}</button>
        ))}
      </div>
      {transitionId !== 'none' ? (
        <SpSlider label="速度" value={speed} min={0} max={100} step={5}
          onChange={(v) => setTransition({ transitionSpeed: v })} fmtV={(v) => ms(v) + ' ms'} />
      ) : null}
      <div className="vk-sp__hint">每条字幕出现时播放一次；整栈共用，不分行。</div>
    </SpSect>
  );
}

// 逐词动画不可用时的那一格：Mac buildNoWordAnim —— 说清楚**为什么**不可用，
// 比留一片空白更能教会人这里发生了什么。
function NoWordAnim({ reason }) {
  return (
    <SpSect title="逐词动画">
      <div className="vk-sp__hint">逐词动画跟着 Whisper 的词级时间戳走。{reason}</div>
    </SpSect>
  );
}

function WordAnimSect({ st, set, mono }) {
  const animation = R.normalizeWordAnimation(st);
  const wordName = animation.animationName;
  const bindings = F.ACCENTS[wordName] || [];
  return (
    <React.Fragment>
      <div className="vk-sp__hint vk-sp__hint--lead">
        {mono ? '动画播放在独立原文行上。' : '动画只播放在原文行；译文没有词级时间，保持静态。'}
      </div>
      <SpSect title="基础">
        <div className="vk-sp__chips">
          {F.WORD_ANIMATIONS.map((wa) => (
            <button key={wa.value} className={'vk-sp__chip' + (wordName === wa.value ? ' vk-sp__chip--on' : '')}
              aria-pressed={wordName === wa.value}
              onClick={() => set({ wordAnimation: { animationName: wa.value } })}>{wa.label}</button>
          ))}
        </div>
        {bindings.map((binding) => (
          <div className="vk-sp__row" key={binding.key}>
            <span className="vk-sp__lab">{binding.label}</span>
            <span className="vk-sp__swatches">
              {F.TEXT_COLORS.concat(['#18E1D6']).map((color) => {
                const on = F.accentColor(animation, binding).toUpperCase() === color.toUpperCase();
                return (
                  <button key={color} className={'vk-swatch' + (on ? ' vk-swatch--sel' : '')}
                    style={{ background: color }} data-tip={color}
                    aria-label={binding.label + ' ' + color} aria-pressed={on}
                    onClick={() => set(F.accentPatch(animation, binding, color))}></button>
                );
              })}
            </span>
          </div>
        ))}
        <div className="vk-sp__hint">跟着 Whisper 的词级时间戳播放。</div>
      </SpSect>
    </React.Fragment>
  );
}

// ---------- Presets ----------
// 分组画廊（Mac SpPresetGrid + StylePresetGridPlanner.orderedGroups）。
function PresetsTab({ st, apply, target, mono }) {
  const selected = SP.selectedId(st);
  return (
    <React.Fragment>
      <div className="vk-sp__presethint">
        {mono
          ? '这些预设作用在 Transcript / Subtitle tab 里的独立原文行。'
          : (target === 'trans' ? '这些预设会套用到译文行。' : '这些预设会套用到原文行；译文行的样式在「样式」tab 里改。')}
      </div>
      {SP.groups().map((group) => (
        <React.Fragment key={group.name}>
          <div className="vk-sp__grp">{group.name} · {group.presets.length}</div>
          <div className="vk-sp__grid">
            {group.presets.map((preset) => (
              <div key={preset.id} className={'vk-sp-preset' + (selected === preset.id ? ' vk-sp-preset--sel' : '')}>
                <button className="vk-sp-preset__btn" aria-pressed={selected === preset.id}
                  onClick={() => { apply(preset); }}>
                  <span className="vk-sp-preset__demo">
                    <span style={{
                      fontFamily: FONT_CATALOG.stackFor(preset.style.fontFamily), color: preset.style.fontColor,
                      fontWeight: preset.style.bold ? 800 : 500,
                      fontStyle: preset.style.italic ? 'italic' : undefined,
                      textTransform: preset.style.textTransform === 'none' ? undefined : preset.style.textTransform,
                      background: preset.style.background ? preset.style.backgroundColor : 'transparent',
                      padding: preset.style.background ? '1px 7px' : 0,
                      borderRadius: Math.min(10, preset.style.borderRadius || 0),
                      WebkitTextStroke: preset.style.outline ? '0.8px ' + preset.style.textOutline.color : undefined,
                      paintOrder: 'stroke fill', fontSize: 15,
                    }}>字幕 Aa</span>
                  </span>
                  <span className="vk-sp-preset__name">{preset.name}</span>
                </button>
              </div>
            ))}
          </div>
        </React.Fragment>
      ))}
      <div className="vk-sp__presethint">
        预设是一次点击换一整套外观；改动会留在项目的本地样式覆盖层里，Agent 重写样式时退位。
      </div>
    </React.Fragment>
  );
}

// ---------- 层壳 ----------
// 常挂载：CSS 过渡需要一个一直在场的对象，关着的时候靠 inert + pointer-events
// 退出交互与 tab 序。层内内容只在打开时渲染，关着的时候不订阅任何 doc 派生
// （子 tab 与滚动位置因此每次打开从头开始，与 Mac 同构）。
function StyleLayer() {
  const app = useApp();
  const open = !!app.styleOpen;
  const ctx = app.styleCtx === 'bi' ? 'bi' : 'sub';
  const meta = F.ctxMeta(ctx);
  const closeRef = useRef(null);
  useEsc(app.closeStyle, open);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  return (
    <div className={'vk-stylelayer' + (open ? ' vk-stylelayer--open' : '')}
      role="region" aria-label={meta.title} inert={open ? undefined : ''}
      data-screen-label="Style layer">
      <div className="vk-stylelayer__head">
        <Ic name={meta.icon} size={16} />
        <span className="vk-stylelayer__title">{meta.title}</span>
        {/* 关闭而不是返回：下面那个 tab 从没变过，关掉就露出来了 */}
        <QBtn refEl={closeRef} icon="close" size="S" tip="关闭（Esc）" onClick={app.closeStyle} />
      </div>
      {open ? <StylePane ctx={ctx} /> : null}
    </div>
  );
}

function StylePane({ ctx }) {
  const app = useApp();
  const { doc } = app;
  // 面板读的是**上下文样式**，和舞台同一份（stage.jsx 的 `doc.ctxStyle[styleCtx]`）：
  // `style.voiceInkContexts` 是 Mac 的无损真相，扁平根键只是最后被编辑的那个 set 的
  // 投影。写路径不变，仍然是 `app.setStyle` 的扁平补丁（store 的解析顺序里覆盖层最后盖）。
  const st = (doc.ctxStyle && doc.ctxStyle[ctx]) || doc.style;
  const [tab, setTab] = useState('style');
  const [source, setSource] = useState(() => {
    try { return localStorage.getItem(PREVIEW_SOURCE_KEY) || 'sample'; } catch { return 'sample'; }
  });
  const pickSource = (value) => {
    setSource(value);
    try { localStorage.setItem(PREVIEW_SOURCE_KEY, value); } catch { /* 无痕模式：不持久化就是了 */ }
  };
  // 样片背景跟当前章节走（与舞台同一套色相），让样片看起来是同一段视频。
  const chapter = app.chapterOf(doc, app.playerRef.current.t);
  const hue = [252, 152, 28, 200][doc.chapters.indexOf(chapter) % 4] || 252;
  // 行级控件的门控必须和渲染内核同源：内核按「当前模式排了几行」判定
  // （resolveModeLines），面板过去写死 st.mode === 'bi'，两处各写一份判据迟早分叉。
  const mode = R.stageMode(ctx, st.mode);
  const stackOrder = R.resolveModeLines(mode, st.order);
  const bilingual = stackOrder.length > 1;
  const mono = ctx !== 'bi';

  // 目标行 = 舞台选中钳制后的结果（Mac StylePaneView.target）。面板不另存一份。
  const target = F.clampTarget(ctx, mode, R.selectedLineOf(app.sel));
  const selectLine = (line) => app.setSel({ kind: 'sub', line });
  // ctx sub 只有一行，样式就是根样式（历史行为，也是 Studio 扁平模型的语义）；
  // ctx bi 里单行目标才落进 origStyle / transStyle 局部覆盖。
  const styleLine = mono || target === 'both' ? null : target;
  const view = F.lineView(st, styleLine);
  const setRoot = (patch) => app.setStyle(patch, ctx);
  // 第二个参数是必须落在根上的键（preset id 之类），行级补丁不吃它们。
  const set = (patch, rootPatch) => app.setStyle({ ...F.linePatch(st, styleLine, patch), ...rootPatch }, ctx);
  const fx = R.effectStyle(view);
  const sizeLine = styleLine || 'orig';
  const detached = ['orig', 'trans'].filter((line) => R.linePosition(st, line));

  // 应用预设（Mac StylePaneView.applyPreset）：外观是**某一行**的，逐词动画与
  // 入场是整栈的，preset id 是整份样式的出处 —— 所以外观按目标行落位，另外两个
  // 与 id 一起写根。行级 partial 里的 wordAnimation / transition 没有消费方，
  // 埋进去等于悄悄丢掉。
  const applyPreset = (preset) => {
    const { wordAnimation, transition, ...look } = preset.style;
    set(look, { preset: preset.id, wordAnimation, transition });
    toast('已应用「' + preset.name + '」', { variant: 'positive' });
  };

  // 「本地已改」= 覆盖层里有样式。比的必须是两份**扁平**样式（app.data 是 Agent
  // 文档，app.doc.style 已叠加覆盖层）—— 拿 ctxStyle 去比会把 voiceInkContexts 的
  // 投影当成本地改动。
  const overridden = !!app.data
    && JSON.stringify(app.data.style || {}) !== JSON.stringify(doc.style || {});

  // 样片来源条：来自视频时按 cue 步进（Mac stepCue）。
  const cues = doc.cues || [];
  const cueIdx = Math.max(0, cues.findIndex((cue) => {
    const t = app.playerRef.current.t;
    return t >= cue.start && t < cue.end;
  }));
  const stepCue = (dir) => {
    if (!cues.length) return;
    const next = Math.max(0, Math.min(cues.length - 1, cueIdx + dir));
    app.seek(cues[next].start + 0.01);
  };

  // 「从原文复制样式」：搬外观、不搬几何，阴影按 Mac 的做法丢掉，
  // 字号交还给双语比例契约（除非这一行已经有自己的显式字号）。
  const copyFromOriginal = () => {
    const origin = F.lineView(st, 'orig');
    const kept = st.transStyle && typeof st.transStyle === 'object' ? st.transStyle : {};
    const next = {};
    LOOK_KEYS.forEach((key) => { if (origin[key] !== undefined) next[key] = origin[key]; });
    next.dropShadow = { ...(origin.dropShadow || {}), on: false };
    ['fontSize', 'x', 'y', 'verticalAlign'].forEach((key) => {
      if (kept[key] !== undefined) next[key] = kept[key];
    });
    app.setStyle({ transStyle: next }, ctx);
    toast('译文行已套用原文的外观', { variant: 'positive' });
  };

  const effects = (
    <React.Fragment>
      <BackgroundSect st={view} set={set} />
      <StrokeSect st={view} set={set} fx={fx} />
      <GlowSect st={view} set={set} fx={fx} />
      <ShadowSect st={view} set={set} fx={fx} />
    </React.Fragment>
  );
  // 字号：滑块显示的是这一行**实际**渲染的字号（内核算的），写回也必须落在承担
  // 这个尺寸的那个旋钮上，而不是往行级 partial 里写一个显式 fontSize —— 显式行级
  // 字号会绕过 bilingualOrigScale / transScale 比例链，与烧录端 resolve_line_style
  // 分叉（`contextLinePartial` 也是刻意不产出 fontSize 的）。
  // 换算全部由内核当前值反推，面板不复制第二份缩放公式：
  //   原文行 → 根 fontSize 按同比例缩放；译文行 → transScale 按同比例缩放。
  const shownSize = lineFontSize(st, sizeLine, bilingual);
  const writeSize = (v) => {
    if (!(shownSize > 0)) return;
    if (sizeLine === 'trans') {
      const ratio = Math.max(0.1, Number.isFinite(st.transScale)
        ? st.transScale : R.DEFAULT_TRANSLATION_RATIO);
      setRoot({ transScale: ratio * v / shownSize });
      return;
    }
    const root = Math.max(1, Number.isFinite(st.fontSize) ? st.fontSize : 30);
    setRoot({ fontSize: v / (shownSize / root) });
  };
  const textAndEffects = (first) => (
    <React.Fragment>
      <TextSect st={view} set={set} first={first} sizeValue={shownSize} onSize={writeSize} />
      {effects}
    </React.Fragment>
  );

  const focus = ctx === 'bi' && bilingual && tab === 'style' && target !== 'both' ? target : null;
  const sampleProps = { st, ctx, hue, focus };

  return (
    <React.Fragment>
      {source === 'video'
        ? <StyleSampleLive {...sampleProps} doc={doc} cueAt={app.cueAt} transCueAt={app.transCueAt} />
        : <StyleSample {...sampleProps} />}
      <SamplePreviewBar source={source} onSource={pickSource}
        cueIdx={cueIdx} cueTotal={cues.length} onStep={stepCue} />
      {/* 面包屑（Mac M120 §8 决策 6）：陈述控件在写哪一行，并留一条回到两行的路。
          往下钻进某一行是舞台的活（点那一行），往上回来没有等价手势 —— 两行之间
          只有几个像素 —— 而「显示模式」又只在两行共用属性里，所以少了它
          「仅译文」会变成死路。钉在 tab 条上方：tab 的**内容**随目标变，它必须
          读起来是 tab 的上级，也不能被滚走。 */}
      {ctx === 'bi' ? (
        <div className="vk-sp__crumb">
          <span>{target === 'both'
            ? <React.Fragment>正在编辑<b>双语两行</b></React.Fragment>
            : <React.Fragment>正在编辑<b>{F.TARGET_LABEL[target]}</b>行</React.Fragment>}</span>
          {target !== 'both' ? (
            <button className="s2-btn s2-btn--S s2-btn--secondary vk-sp__crumb-up"
              onClick={() => selectLine(null)}>编辑双语两行</button>
          ) : null}
        </div>
      ) : null}
      <div className="vk-sp__tabs">
        <Segmented stretch value={tab} onChange={setTab} options={[
          { value: 'style', label: '样式' },
          { value: 'animate', label: '动画' },
          { value: 'presets', label: '预设' },
        ]} />
      </div>
      <div className="vk-sp__scroll">
        {tab === 'style' && mono ? (
          <React.Fragment>
            {/* 单语上下文只有一行，它的投送策略没有别处可放，所以「显示」领头
                （Mac buildStyle：`if sub, isMono { buildDisplay() }`）。 */}
            <DisplaySect st={st} set={setRoot} first />
            {textAndEffects(false)}
            <TransformSect st={st} set={setRoot} />
            <PositionSect st={st} set={setRoot} />
          </React.Fragment>
        ) : null}
        {tab === 'style' && !mono ? (
          <React.Fragment>
            <BilingualSect st={st} set={setRoot} mode={mode} first />
            {target === 'both' ? (
              <React.Fragment>
                {/* 两行都选中时没有"某一行"可写，控件就正好是两行**共用**的那些。 */}
                <TransformSect st={st} set={setRoot} />
                <PositionSect st={st} set={setRoot} />
                {detached.length ? (
                  <Signpost text="有行被拖出了堆栈，保留着自己的位置。顺序、间距与单一背景块只对还在堆栈里的行生效。"
                    actions={[{
                      label: '重新堆叠',
                      onClick: () => {
                        const patch = {};
                        detached.forEach((line) => Object.assign(patch, R.lineStylePatch(st, line, null)));
                        setRoot(patch);
                        toast('两行已恢复联动', { variant: 'neutral' });
                      },
                    }]} />
                ) : null}
                <DisplaySect st={st} set={setRoot} />
                <Signpost text="文字与效果按行设置。单一背景块用原文行的背景。"
                  actions={[
                    { label: '原文', onClick: () => selectLine('orig'), disabled: mode === 'trans' },
                    { label: '译文', onClick: () => selectLine('trans'), disabled: mode === 'orig' },
                  ]} />
              </React.Fragment>
            ) : (
              <React.Fragment>
                {textAndEffects(false)}
                {target === 'trans' ? (
                  <div className="vk-sp__foot">
                    <button className="s2-btn s2-btn--S s2-btn--secondary" onClick={copyFromOriginal}>
                      从原文复制样式
                    </button>
                  </div>
                ) : null}
                {bilingual ? (
                  <LinePositionSect st={st} set={setRoot} line={target}
                    label={F.TARGET_LABEL[target]} stackOrder={stackOrder} />
                ) : null}
                {/* 回到两行的路是顶部那条面包屑，这里只说明共用属性在哪 */}
                <Signpost text="位置、宽度、入场与显示策略由两行共用。"
                  actions={[{ label: '编辑共用属性', onClick: () => selectLine(null) }]} />
              </React.Fragment>
            )}
          </React.Fragment>
        ) : null}
        {tab === 'animate' ? (
          <React.Fragment>
            {/* 入场是整栈的：单行目标也看同一个控件，不必先回到「两行」去找。 */}
            <EntranceSect st={st} set={setRoot} />
            {ctx === 'bi' && target === 'both' ? (
              <React.Fragment>
                <NoWordAnim reason="两行都选中时没有某一行可以播放它。" />
                {mode !== 'trans' ? (
                  <Signpost text="逐词动画属于原文行。"
                    actions={[{ label: '选择原文', onClick: () => selectLine('orig') }]} />
                ) : null}
              </React.Fragment>
            ) : null}
            {target === 'trans' ? (
              <React.Fragment>
                <NoWordAnim reason="译文行没有词级时间戳 —— 它是每条字幕一整串文本。" />
                <Signpost text="位置、宽度、入场与显示策略由两行共用。"
                  actions={[{ label: '编辑共用属性', onClick: () => selectLine(null) }]} />
              </React.Fragment>
            ) : null}
            {target === 'orig' ? (
              <React.Fragment>
                <WordAnimSect st={st} set={setRoot} mono={mono} />
                {!mono ? (
                  <Signpost text="位置、宽度、入场与显示策略由两行共用。"
                    actions={[{ label: '编辑共用属性', onClick: () => selectLine(null) }]} />
                ) : null}
              </React.Fragment>
            ) : null}
          </React.Fragment>
        ) : null}
        {tab === 'presets' ? <PresetsTab st={st} apply={applyPreset} target={target} mono={mono} /> : null}
      </div>
      <div className="vk-sp__savebar">
        <span className="vk-sp__savebar__cur">
          <b>{SP.labelFor(st)}</b>{overridden ? <i> · 本地已改</i> : null}
        </span>
        <button className="s2-btn s2-btn--S s2-btn--secondary" disabled={!overridden}
          data-tip={overridden ? '丢弃本地样式改动，回到 Agent 写入的样式' : '当前就是 Agent 写入的样式'}
          onClick={() => { app.resetStyle(); toast('已恢复 Agent 样式', { variant: 'neutral' }); }}>
          <Ic name="undo" size={13} />恢复 Agent 样式
        </button>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { StyleLayer });
})();
