// BaoCut Subtitle Studio — 共享文本样式控件（原型 app/text-style.jsx 的 Studio 版）。
//
// 一份控件树，三个调用方共用：字幕样式层（style-layer.jsx，写 doc.style）、文本
// 叠加元素与文本水印的检查器（inspector-layer.jsx / watermark-layer.jsx，写
// `patchElement set:{style:{…}}`）。抽出来的理由和原型一样：文本就是文本，
// 「字幕的字体大小」和「水印的字体大小」不该是两套控件、两套开关派生。
//
// 契约极简：`st` 是扁平样式对象，`set(patch)` 把补丁合并进它 —— 补丁去哪里由调用方
// 决定（项目样式覆盖层 / 某个元素的 style）。分区里出现的每个字段都必须是
// subtitle-rendering.js 与 CLI 烧录端已经在消费的字段；开关派生、颜色 alpha 与效果
// 种子值一律走 style-fields.js，面板不自带第二份判据。
//
// 本文件同时是 slide-over 面板的基础控件库（SpSect / TsSect / SpRow / SpSlider /
// SpSwatches / SpSwitchRow / FontPicker），元素检查器和水印层直接复用，不再各写一份。
(() => {
const { useEffect, useState, useRef } = React;
const { Ic, QBtn, Segmented, Pop, toast } = window;
const R = window.BCS_SUBTITLE;
if (!R) throw new Error('subtitle-rendering.js failed to load');
const F = window.BCS_STYLE_FIELDS;
if (!F) throw new Error('style-fields.js failed to load');
const FONT_CATALOG = window.BCS_FONT_CATALOG;
if (!FONT_CATALOG) throw new Error('font-catalog.js failed to load');

// ---------- 分区与行（类名与原型 app/style-panel.css 同源） ----------
function SpSect({ title, first, children, aside }) {
  return (
    <div className={'vk-sp__sec' + (first ? ' vk-sp__sec--first' : '')}>
      {title ? (
        <div className="vk-sp__sechead">
          {title}{aside ? <span className="vk-sp__sechead-aside">{aside}</span> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// 效果分区：标题行自带开关与「重置本区」，关掉只是跳过效果、数值留着，
// 所以关着的时候正文变淡而不是消失（原型 TsSect）。
function TsSect({ title, on, onToggle, onReset, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="vk-sp__sec">
      <div className="vk-sp__sechead vk-ts__head">
        <label className="s2-checkbox s2-checkbox--emphasized vk-ts__chk" data-tip={on ? '关闭' + title : '开启' + title}>
          <input type="checkbox" checked={!!on} aria-label={title + (on ? ' · 已开启' : ' · 已关闭')}
            onChange={(e) => onToggle(e.target.checked)} />
          <span className="s2-checkbox__box"><span className="s2-checkbox__check s2-icon--checkmark"></span></span>
        </label>
        <button type="button" className="vk-ts__ttl" onClick={() => setOpen((o) => !o)}>{title}</button>
        <span className="vk-ts__acts">
          {onReset ? <QBtn icon="undo" size="XS" tip={'重置' + title} onClick={onReset} /> : null}
          <QBtn icon={open ? 'chevron-up' : 'chevron-down'} size="XS" tip={open ? '收起' : '展开'}
            onClick={() => setOpen((o) => !o)} />
        </span>
      </div>
      {open ? <div className={on ? 'vk-ts__body' : 'vk-ts__body vk-ts__body--off'}>{children}</div> : null}
    </div>
  );
}

function SpRow({ label, children, fill }) {
  return (
    <div className="vk-sp__row">
      {label ? <span className="vk-sp__lab">{label}</span> : null}
      {fill ? <span className="vk-sp__rowfill">{children}</span> : children}
    </div>
  );
}

// 滑块 + 可编辑数值：滑块给粗调，数值框给精确值（↑/↓ 步进，Esc 还原）。
function SpSlider({ label, value, min, max, step = 1, onChange, fmtV, disabled, hint }) {
  const [draft, setDraft] = useState(null);
  const escaped = useRef(false);
  const clamp = (n) => Math.max(min, Math.min(max, n));
  const commit = () => {
    if (draft == null) return;
    if (escaped.current) { escaped.current = false; setDraft(null); return; }
    const parsed = parseFloat(draft.replace(',', '.').replace(/[^0-9.+-]/g, ''));
    setDraft(null);
    if (!Number.isNaN(parsed) && clamp(parsed) !== value) onChange(clamp(parsed));
  };
  const nudge = (dir) => {
    const base = draft != null && !Number.isNaN(parseFloat(draft)) ? clamp(parseFloat(draft)) : value;
    setDraft(null);
    const next = clamp(Math.round((base + dir * step) / step) * step);
    if (next !== value) onChange(next);
  };
  const shown = fmtV ? fmtV(value) : String(value);
  return (
    <div className="vk-sp__row">
      <span className="vk-sp__lab">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        disabled={disabled} data-tip={hint}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      <input className="vk-sp__valin vk-mono" value={draft != null ? draft : shown}
        aria-label={label + '（数值）'} spellCheck={false} disabled={disabled}
        onFocus={() => setDraft(String(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') e.target.blur();
          else if (e.key === 'Escape') { escaped.current = true; e.target.blur(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); }
        }} />
    </div>
  );
}

// 色板行。Studio 没有取色器（原型的 SpColorPop 依赖它自己的一整套 HSV 组件），
// 给的是模型里在用的那几个颜色；「有没有底板/描边/阴影」由分区开关回答，
// 所以色板里不再重复一个「无」。
function SpSwatches({ label, value, colors, onChange }) {
  const current = String(value || '').toUpperCase();
  const none = F.isTransparent(value);
  return (
    <div className="vk-sp__row">
      <span className="vk-sp__lab">{label}</span>
      <span className="vk-sp__swatches">
        {colors.map((color) => (
          <button key={color} className={'vk-swatch' + (!none && current === color.toUpperCase() ? ' vk-swatch--sel' : '')}
            style={{ background: color }} data-tip={color} aria-label={label + ' ' + color}
            aria-pressed={!none && current === color.toUpperCase()}
            onClick={() => onChange(color)}></button>
        ))}
      </span>
    </div>
  );
}

function SpSwitchRow({ label, sub, checked, onChange, tip }) {
  return (
    <div className="vk-sp__row">
      <span className="vk-sp__lab">{label}</span>
      <span className="vk-sp__rowfill"><span className="vk-sp__rowsub">{sub}</span></span>
      {/* aria-label 要挂在 input 上：读屏念的是控件本身，<label> 上的 aria-label
          不会成为这个 checkbox 的名字（可见文案在左边那一列，它自己没有 for）。 */}
      <label className="s2-switch s2-switch--emphasized vk-sp__sw" data-tip={tip}>
        <input type="checkbox" checked={!!checked} aria-label={label}
          onChange={(e) => onChange(e.target.checked)} />
        <span className="s2-switch__track"><span className="s2-switch__handle"></span></span>
      </label>
    </div>
  );
}

// ---------- 字体选择器（弹出层里搜索 / 读系统字体 / 直接按名字用） ----------
function FontChoice({ family, label, selected, note, onPick }) {
  return (
    <button type="button" className={'bcs-fontpick__row' + (selected ? ' bcs-fontpick__row--selected' : '')}
      role="option" aria-selected={selected} onClick={() => onPick(family)}>
      <span className="bcs-fontpick__sample" style={{ fontFamily: FONT_CATALOG.stackFor(family) }}>Aa</span>
      <span className="bcs-fontpick__name">{label || family}</span>
      {note ? <span className="bcs-fontpick__note">{note}</span> : null}
      {selected ? <Ic name="checkmark" size={14} /> : <span className="bcs-fontpick__checkspace"></span>}
    </button>
  );
}

function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [systemFonts, setSystemFonts] = useState(() => FONT_CATALOG.systemFamilies());
  const [loading, setLoading] = useState(false);
  const btnRef = useRef(null);
  const searchRef = useRef(null);
  const builtIns = FONT_CATALOG.builtIns();
  const rawValue = value && typeof value === 'object' ? value.fontFamily : String(value || '');
  const matches = (family) => !query.trim()
    || family.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const visibleBuiltIns = builtIns.filter((font) => matches(font.family));
  const visibleSystemFonts = systemFonts.filter(matches);
  const currentKnown = builtIns.some((font) => FONT_CATALOG.sameFamily(value, font.family))
    || systemFonts.some((family) => FONT_CATALOG.sameFamily(value, family));
  const manualFamily = query.trim();
  const manualIsKnown = builtIns.some((font) => FONT_CATALOG.sameFamily(manualFamily, font.family))
    || systemFonts.some((family) => FONT_CATALOG.sameFamily(manualFamily, family));

  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => searchRef.current && searchRef.current.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const pick = (family) => {
    onChange(family);
    setOpen(false);
    setQuery('');
  };

  const loadSystemFonts = async () => {
    setLoading(true);
    const result = await FONT_CATALOG.requestSystemFonts();
    setLoading(false);
    setSystemFonts(result.families);
    if (result.status === 'ready') {
      toast('已读取 ' + result.families.length + ' 个系统字体', { variant: 'positive' });
    } else if (result.status === 'unsupported') {
      toast('当前浏览器不能列出系统字体，可输入字体名称使用', { variant: 'neutral' });
    } else if (result.status === 'denied') {
      toast('未授权读取系统字体，可输入字体名称使用', { variant: 'neutral' });
    } else {
      toast('系统字体读取失败，可输入字体名称使用', { variant: 'negative' });
    }
  };

  return (
    <div className="vk-sp__row">
      <span className="vk-sp__lab">字体</span>
      <button ref={btnRef} type="button"
        className={'bcs-fontpick__button' + (open ? ' bcs-fontpick__button--open' : '')}
        aria-haspopup="listbox" aria-expanded={open} aria-label="字体"
        onClick={() => { setQuery(''); setOpen(true); }}>
        <span className="bcs-fontpick__sample" style={{ fontFamily: FONT_CATALOG.stackFor(value) }}>Aa</span>
        <span className="bcs-fontpick__value">{FONT_CATALOG.displayName(value)}</span>
        <Ic name="chevron-down" size={14} />
      </button>
      {open ? (
        <Pop anchorRef={btnRef} onClose={() => setOpen(false)} width={290} align="end" className="bcs-fontpick__pop">
          <div className="bcs-fontpick__searchbox">
            <input ref={searchRef} className="bcs-fontpick__search" type="search" value={query}
              placeholder="搜索或输入系统字体名称" aria-label="搜索字体"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter' && manualFamily && !manualIsKnown) {
                  event.preventDefault(); pick(manualFamily);
                }
              }} />
          </div>
          <div className="bcs-fontpick__list" role="listbox" aria-label="可用字体">
            {!currentKnown && rawValue && matches(FONT_CATALOG.displayName(value)) ? (
              <React.Fragment>
                <div className="bcs-fontpick__group">当前项目</div>
                <FontChoice family={rawValue} label={FONT_CATALOG.displayName(value)} selected note="兼容样式" onPick={pick} />
              </React.Fragment>
            ) : null}
            {visibleBuiltIns.length ? (
              <React.Fragment>
                <div className="bcs-fontpick__group">Mac App 内置 · {builtIns.length}</div>
                {visibleBuiltIns.map((font) => (
                  <FontChoice key={font.family} family={font.family}
                    selected={FONT_CATALOG.sameFamily(value, font.family)} onPick={pick} />
                ))}
              </React.Fragment>
            ) : null}
            {visibleSystemFonts.length ? (
              <React.Fragment>
                <div className="bcs-fontpick__group">系统字体 · {systemFonts.length}</div>
                {visibleSystemFonts.map((family) => (
                  <FontChoice key={family} family={family}
                    selected={FONT_CATALOG.sameFamily(value, family)} onPick={pick} />
                ))}
              </React.Fragment>
            ) : null}
            {manualFamily && !manualIsKnown ? (
              <React.Fragment>
                <div className="bcs-fontpick__group">按名称使用</div>
                <FontChoice family={manualFamily} label={'使用“' + manualFamily + '”'} note="系统字体" onPick={pick} />
              </React.Fragment>
            ) : null}
            {!visibleBuiltIns.length && !visibleSystemFonts.length && (!manualFamily || manualIsKnown) ? (
              <div className="bcs-fontpick__empty">没有匹配的字体</div>
            ) : null}
          </div>
          <div className="bcs-fontpick__footer">
            <button type="button" className="s2-btn s2-btn--S s2-btn--secondary" disabled={loading}
              onClick={loadSystemFonts}>{loading ? '正在读取…' : (systemFonts.length ? '刷新系统字体' : '读取系统字体')}</button>
            <span>浏览器会请求本机字体访问权限；不支持时可直接输入名称。</span>
          </div>
        </Pop>
      ) : null}
    </div>
  );
}

// ---------- 文本分区 ----------
// 行、标签与顺序照 Mac TextStyleSections.buildText：字体 → 大小 → 样式(B/I/U) →
// 大小写 → 颜色 → 字距 → 行距 → 对齐。
//
// `sizeValue` / `onSize`：双语堆栈里一行的**实际**字号不是 `st.fontSize` —— 内核
// 的 lineFontSize 会按 bilingualOrigScale / transScale 缩放它。调用方（字幕样式层）
// 因此可以把内核算出来的实际值传进来，面板不自己算第二份缩放。
function TextSect({ st, set, first, sizeMin = 16, sizeMax = 72, sizeValue, onSize }) {
  const caseBtn = (value, label, tip) => (
    <button className={'vk-sp__fmtbtn' + (st.textTransform === value ? ' vk-sp__fmtbtn--on' : '')}
      data-tip={tip} aria-label={tip} aria-pressed={st.textTransform === value}
      style={value === 'lowercase' ? { textTransform: 'lowercase' } : undefined}
      onClick={() => set({ textTransform: st.textTransform === value ? 'none' : value })}>{label}</button>
  );
  const fmtBtn = (on) => 'vk-sp__fmtbtn' + (on ? ' vk-sp__fmtbtn--on' : '');
  return (
    <SpSect title="文字" first={first}>
      <FontPicker value={st.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
      <SpSlider label="大小"
        value={Number(sizeValue != null ? sizeValue : (st.fontSize == null ? sizeMin : st.fontSize))}
        min={sizeMin} max={sizeMax}
        onChange={(v) => (onSize ? onSize(v) : set({ fontSize: v }))} />
      <div className="vk-sp__row">
        <span className="vk-sp__lab">样式</span>
        <div className="vk-sp__fmt">
          <button className={fmtBtn(st.bold)} style={{ fontWeight: 800 }} data-tip="加粗" aria-label="加粗"
            aria-pressed={!!st.bold} onClick={() => set({ bold: !st.bold })}>B</button>
          <button className={fmtBtn(st.italic)} style={{ fontStyle: 'italic' }} data-tip="斜体" aria-label="斜体"
            aria-pressed={!!st.italic} onClick={() => set({ italic: !st.italic })}>I</button>
          <button className={fmtBtn(st.underline)} style={{ textDecoration: 'underline' }} data-tip="下划线"
            aria-label="下划线" aria-pressed={!!st.underline} onClick={() => set({ underline: !st.underline })}>U</button>
        </div>
      </div>
      <div className="vk-sp__row">
        <span className="vk-sp__lab">大小写</span>
        <div className="vk-sp__fmt">
          {caseBtn('uppercase', 'TT', '全大写')}
          {caseBtn('lowercase', 'tt', '全小写')}
        </div>
      </div>
      <SpSwatches label="颜色" value={st.fontColor} colors={F.TEXT_COLORS}
        onChange={(fontColor) => set({ fontColor })} />
      <SpSlider label="字距" value={Number(st.letterSpacing || 0)} min={0} max={20} step={0.5}
        onChange={(v) => set({ letterSpacing: v })} fmtV={(v) => v + 'px'} />
      <SpSlider label="行距" value={Number(st.lineHeight == null ? 1.2 : st.lineHeight)} min={1} max={2} step={0.05}
        onChange={(v) => set({ lineHeight: v })} fmtV={(v) => v.toFixed(2)} />
      <SpRow label="对齐" fill>
        <Segmented stretch size="S" value={st.align || 'center'} onChange={(v) => set({ align: v })}
          options={[{ value: 'left', label: '左' }, { value: 'center', label: '居中' }, { value: 'right', label: '右' }]} />
      </SpRow>
    </SpSect>
  );
}

// 效果分区的标题与行标签同 Mac TextStyleSections：背景（颜色 / 不透明度 / 内边距 /
// 圆角）→ 描边（颜色 / 粗细）→ 发光（颜色 / 强度 / 范围）→ 阴影（颜色 / 不透明度 /
// 距离 / 模糊 / 角度）。
function BackgroundSect({ st, set }) {
  const on = F.backgroundOn(st);
  const alpha = Math.round(F.alphaOf(st.backgroundColor) * 100);
  return (
    <TsSect title="背景" on={on} onToggle={(v) => set(F.backgroundToggle(st, v))}
      onReset={() => set({ ...F.DEF.background, background: on })}>
      <SpSwatches label="颜色" value={st.backgroundColor} colors={F.PLATE_COLORS}
        onChange={(color) => set({ background: true, backgroundColor: F.withRgb(st.backgroundColor, color) })} />
      <SpSlider label="不透明度" value={alpha} min={0} max={100} step={5}
        onChange={(v) => set({ background: true, backgroundColor: F.withAlpha(st.backgroundColor, v / 100) })}
        fmtV={(v) => v + '%'} />
      <SpSlider label="内边距" value={Number(st.backgroundPadding == null ? 10 : st.backgroundPadding)} min={0} max={50}
        onChange={(v) => set({ backgroundPadding: v })} />
      <SpSlider label="圆角" value={Number(st.borderRadius == null ? 15 : st.borderRadius)} min={0} max={50}
        onChange={(v) => set({ borderRadius: v })} />
      <SpRow label="形状" fill>
        <Segmented stretch size="S" value={st.backgroundStyle === 'block' ? 'block' : 'wrap'}
          onChange={(v) => set({ backgroundStyle: v })}
          options={[{ value: 'wrap', label: '贴合文字' }, { value: 'block', label: '整条色块' }]} />
      </SpRow>
    </TsSect>
  );
}

// 描边与阴影的**显示值**一律取内核解析后的结果（R.effectStyle）：项目样式里这两
// 个对象常常整个缺席，缺省值在内核那边（描边 14、阴影模糊/距离随描边而变），面板
// 若直接读 st.textOutline.width 会显示 0 而画面上明明有描边。
function StrokeSect({ st, set, fx }) {
  const on = F.outlineOn(st);
  return (
    <TsSect title="描边" on={on} onToggle={(v) => set(F.outlineToggle(st, v))}
      onReset={() => set(F.outlinePatch(st, { ...F.DEF.outline, on }))}>
      <SpSwatches label="颜色" value={(st.textOutline || {}).color || F.DEF.outline.color} colors={F.INK_COLORS}
        onChange={(color) => set(F.outlinePatch(st, { color }))} />
      <SpSlider label="粗细" value={Math.round(fx.outlineWidth)} min={0} max={50}
        onChange={(v) => set(F.outlinePatch(st, { width: v }))}
        hint="占字号的百分比，与烧录端同一口径" />
    </TsSect>
  );
}

// 发光：内核 effectStyle 与烧录端 studio_export.rs 都在读 `glow`，Mac 也有这个分区。
// 显示值同样走内核解析结果（fx），因为 style 里常常整个没有 glow 对象。
// 已知取舍（与烧录端一致，不是面板的选择）：发光与阴影共用同一个 effect 槽位，
// 开着发光时阴影不参与绘制 —— 所以这里在两个分区都开着时说明一句。
function GlowSect({ st, set, fx }) {
  const on = F.glowOn(st);
  const glow = st.glow || {};
  return (
    <TsSect title="发光" on={on} onToggle={(v) => set(F.glowToggle(st, v))}
      onReset={() => set({ glow: { ...F.DEF.glow, on } })}>
      <SpSwatches label="颜色" value={glow.color || F.DEF.glow.color} colors={F.GLOW_COLORS}
        onChange={(color) => set(F.glowPatch(st, { color }))} />
      <SpSlider label="强度" value={Math.round(fx.glowIntensity)} min={0} max={100} step={5}
        onChange={(v) => set(F.glowPatch(st, { intensity: v }))} fmtV={(v) => v + '%'} />
      <SpSlider label="范围" value={Math.round(fx.glowRange)} min={0} max={100} step={5}
        onChange={(v) => set(F.glowPatch(st, { range: v }))} fmtV={(v) => v + '%'} />
      {on && F.shadowOn(st) ? (
        <div className="vk-sp__hint">发光与阴影共用同一个效果槽位：开着发光时阴影不参与绘制（预览与烧录端一致）。</div>
      ) : null}
    </TsSect>
  );
}

function ShadowSect({ st, set, fx }) {
  const on = F.shadowOn(st);
  const shadow = st.dropShadow || {};
  return (
    <TsSect title="阴影" on={on} onToggle={(v) => set(F.shadowToggle(st, v))}
      onReset={() => set({ dropShadow: { ...F.DEF.shadow, on } })}>
      <SpSwatches label="颜色" value={shadow.color || F.DEF.shadow.color} colors={F.INK_COLORS}
        onChange={(color) => set(F.shadowPatch(st, { color }))} />
      <SpSlider label="不透明度" value={Math.round(F.shadowOpacity(st) * 100)}
        min={0} max={100} step={5} onChange={(v) => set(F.shadowPatch(st, { opacity: v / 100 }))}
        fmtV={(v) => v + '%'} />
      <SpSlider label="距离" value={Number(fx.shadowDistance.toFixed(2))} min={0} max={0.3} step={0.01}
        onChange={(v) => set(F.shadowPatch(st, { distance: v }))} fmtV={(v) => v.toFixed(2)} />
      <SpSlider label="模糊" value={Number(fx.shadowBlur.toFixed(2))} min={0} max={0.5} step={0.01}
        onChange={(v) => set(F.shadowPatch(st, { blur: v }))} fmtV={(v) => v.toFixed(2)} />
      <SpSlider label="角度" value={Math.round(fx.shadowRotation)} min={0} max={360} step={5}
        onChange={(v) => set(F.shadowPatch(st, { rotation: v }))} fmtV={(v) => v + '°'} />
    </TsSect>
  );
}

// ---------- 一份共享控件集 ----------
// 顺序照 Mac TextStyleSections.buildText + buildEffects：文字 → 背景 → 描边 →
// 发光 → 阴影。字幕样式层单独摆放这五个分区（它中间还要插自己的双语/变换/位置
// 分区），元素与水印直接用这个组合。fx 走内核解析结果，与字幕同源。
function TextStyleControls({ st, set, first = false, sizeMin = 16, sizeMax = 72 }) {
  const fx = R.effectStyle(st || {});
  return (
    <React.Fragment>
      <TextSect st={st} set={set} first={first} sizeMin={sizeMin} sizeMax={sizeMax} />
      <BackgroundSect st={st} set={set} />
      <StrokeSect st={st} set={set} fx={fx} />
      <GlowSect st={st} set={set} fx={fx} />
      <ShadowSect st={st} set={set} fx={fx} />
    </React.Fragment>
  );
}

window.BCS_TEXT_STYLE = {
  SpSect, TsSect, SpRow, SpSlider, SpSwatches, SpSwitchRow, FontChoice, FontPicker,
  TextSect, BackgroundSect, StrokeSect, GlowSect, ShadowSect, TextStyleControls,
};
})();
