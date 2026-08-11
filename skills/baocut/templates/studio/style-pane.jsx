// BaoCut Subtitle Studio — Style tab. Presets + controls write a local style
// override (bcs:style) applied live to the stage; the agent may also set
// doc.style in data.json (an agent write retires the local override).
(() => {
const { useEffect, useState, useRef } = React;
const { Ic, Segmented, useApp, toast } = window;
const R = window.BCS_SUBTITLE;
const FONT_CATALOG = window.BCS_FONT_CATALOG;
if (!FONT_CATALOG) throw new Error('font-catalog.js failed to load');
const LINE_LABELS = [{ line: 'orig', label: '原文' }, { line: 'trans', label: '译文' }];

const PRESETS = [
  { id: 'classic', name: '经典描边', style: {
    fontFamily: 'system', fontColor: '#FFFFFF', bold: true, outline: true, background: false,
    wordAnimation: { animationName: 'Color', active: { color: '#18E1D6' } },
    transition: { transitionId: 'none', transitionSpeed: 50 },
  } },
  { id: 'clean', name: '简洁白', style: {
    fontFamily: 'lexend', fontColor: '#FFFFFF', bold: false, outline: false, background: false,
    wordAnimation: { animationName: 'None' },
    transition: { transitionId: 'magic-fade', transitionSpeed: 50 },
  } },
  { id: 'boxed', name: '黑底白字', style: {
    fontFamily: 'system', fontColor: '#FFFFFF', bold: true, outline: false,
    background: true, backgroundColor: '#000000B3',
    wordAnimation: { animationName: 'None' },
    transition: { transitionId: 'magic-flip', transitionSpeed: 50 },
  } },
  { id: 'pop', name: '醒目黄', style: {
    fontFamily: 'montserrat', fontColor: '#FFD43B', bold: true, outline: true, background: false,
    wordAnimation: { animationName: 'Highlight', active: { backgroundColor: '#18E1D6', color: '#0D0D0D' } },
    transition: { transitionId: 'magic-pop', transitionSpeed: 50 },
  } },
  { id: 'impact', name: '大标题', style: {
    fontFamily: 'bebas', fontColor: '#FFFFFF', bold: false, outline: true, background: false,
    wordAnimation: { animationName: 'Paint', spoken: { color: '#FFD43B', underline: true } },
    transition: { transitionId: 'magic-pop', transitionSpeed: 50 },
  } },
  { id: 'serif', name: '衬线纪录片', style: {
    fontFamily: 'serif', fontColor: '#F5EFDC', bold: false, outline: false,
    background: true, backgroundColor: '#00000080',
    wordAnimation: { animationName: 'Reveal' },
    transition: { transitionId: 'magic-fade', transitionSpeed: 50 },
  } },
];
const COLORS = ['#FFFFFF', '#FFD43B', '#8CAAFF', '#7ADF93', '#FF8C7A', '#F5EFDC', '#111111'];

function Row({ label, children }) {
  return (
    <div className="bcs-strow">
      <span className="bcs-strow__label">{label}</span>
      <div className="bcs-strow__ctl">{children}</div>
    </div>
  );
}

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
    const onKeyDown = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => { window.clearTimeout(timer); document.removeEventListener('keydown', onKeyDown); };
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
    <div className={'bcs-fontpick' + (open ? ' bcs-fontpick--open' : '')}>
      <button type="button" className="bcs-fontpick__button" aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}>
        <span className="bcs-fontpick__sample" style={{ fontFamily: FONT_CATALOG.stackFor(value) }}>Aa</span>
        <span className="bcs-fontpick__value">{FONT_CATALOG.displayName(value)}</span>
        <Ic name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="bcs-fontpick__panel">
          <div className="bcs-fontpick__searchbox">
            <input ref={searchRef} className="bcs-fontpick__search" type="search" value={query}
              placeholder="搜索或输入系统字体名称" aria-label="搜索字体"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
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
        </div>
      ) : null}
    </div>
  );
}

function StylePane() {
  const app = useApp();
  const { doc } = app;
  const st = doc.style;
  const set = (patch) => app.setStyle(patch);
  // 行级控件的门控必须和渲染内核同源：内核按"当前模式排了两行"判定
  // （resolveModeLines），面板过去写死 st.mode === 'bi'，两处各写一份判据迟早分叉。
  const stackOrder = R.resolveModeLines(st.mode, st.order);
  const bilingual = stackOrder.length > 1;
  // 脱离时的默认锚点按当时的行序：上行钉底边（向上生长）、下行钉顶边（向下
  // 生长），和堆叠里的接缝默认同构。行序看 st.order，不是 LINE_LABELS 的固定顺序。
  const detachAlign = (line) => (stackOrder[0] === line ? 'bottom' : 'top');
  // 行的推导中心依赖实测文本尺寸，只有画布知道；这里读画布留下的只读快照，
  // 让「独立摆放」从当前所见位置起步，读不到时退回锚点。中心要按目标锚点换算成
  // 锚边坐标，脱离瞬间画面才零跳动。
  const seedLinePosition = (line, align) => {
    const snap = (window.BCS_LINE_CENTERS || {})[line];
    const base = snap && Number.isFinite(snap.x) && Number.isFinite(snap.y)
      ? { x: snap.x, y: R.lineAnchorFromCenter(snap.y, snap.h, align) }
      : { x: st.x == null ? 50 : st.x, y: st.y == null ? 86 : st.y };
    return { ...base, verticalAlign: align };
  };

  return (
    <div className="vk-transcript bcs-style" data-screen-label="Style">
      <div className="vk-transcript__toolbar">
        <span className="vk-dim" style={{ fontSize: 12 }}>样式实时应用到左侧预览与导出</span>
        <span className="vk-spacer"></span>
        <button className="s2-btn s2-btn--S s2-btn--secondary" onClick={() => { app.resetStyle(); toast('已恢复 Agent 样式', { variant: 'neutral' }); }}>重置</button>
      </div>
      <div className="vk-transcript__scroll">
        <div className="bcs-stsec">预设</div>
        <div className="bcs-presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={'bcs-preset' + (st.preset === p.id ? ' bcs-preset--on' : '')}
              onClick={() => { set({ preset: p.id, ...p.style }); toast('已应用「' + p.name + '」', { variant: 'positive' }); }}>
              <span className="bcs-preset__demo">
                <span style={{
                  fontFamily: FONT_CATALOG.stackFor(p.style.fontFamily), color: p.style.fontColor,
                  fontWeight: p.style.bold ? 800 : 500,
                  background: p.style.background ? p.style.backgroundColor : 'transparent',
                  padding: p.style.background ? '1px 7px' : 0, borderRadius: 4,
                  WebkitTextStroke: p.style.outline ? '0.8px rgba(0,0,0,0.9)' : undefined,
                  paintOrder: 'stroke fill', fontSize: 15,
                }}>字幕 Aa</span>
              </span>
              <span className="bcs-preset__name">{p.name}</span>
            </button>
          ))}
        </div>

        <div className="bcs-stsec">显示</div>
        <Row label="字幕行">
          <Segmented stretch value={st.mode} onChange={(v) => set({ mode: v })} options={[
            { value: 'orig', label: '原文' },
            { value: 'trans', label: '译文' },
            { value: 'bi', label: '双语' },
          ]} />
        </Row>
        <Row label="逗号 / 句号">
          <Segmented stretch size="S" value={st.punct === false ? 'show' : 'hide'}
            onChange={(v) => set({ punct: v === 'hide' })}
            options={[{ value: 'hide', label: '隐藏' }, { value: 'show', label: '显示' }]} />
        </Row>

        <div className="bcs-stsec">文字</div>
        <Row label="字体">
          <FontPicker value={st.fontFamily} onChange={(fontFamily) => set({ fontFamily })} />
        </Row>
        <Row label={'字号 · ' + st.fontSize}>
          <input type="range" min="16" max="56" step="1" value={st.fontSize} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
            onChange={(e) => set({ fontSize: parseInt(e.target.value, 10) })} aria-label="字号" />
        </Row>
        <Row label="颜色">
          <div className="vk-swatches--row" style={{ display: 'flex', gap: 6 }}>
            {COLORS.map((c) => (
              <button key={c} className={'vk-swatch vk-swatch--lg' + (st.fontColor === c ? ' vk-swatch--sel' : '')}
                style={{ background: c }} aria-label={c} onClick={() => set({ fontColor: c })}></button>
            ))}
          </div>
        </Row>
        <Row label="粗细 / 描边">
          <div className="vk-row">
            <button className={'vk-findbar__opt' + (st.bold ? ' vk-findbar__opt--on' : '')} style={{ width: 40 }}
              data-tip="加粗" onClick={() => set({ bold: !st.bold })}>B</button>
            <button className={'vk-findbar__opt' + (st.outline ? ' vk-findbar__opt--on' : '')} style={{ width: 40 }}
              data-tip="黑色描边" onClick={() => set({ outline: !st.outline })}>描</button>
          </div>
        </Row>

        <div className="bcs-stsec">背景</div>
        <Row label="背景底板">
          <Segmented size="S" value={st.background ? 'on' : 'off'} onChange={(v) => set({ background: v === 'on' })}
            options={[{ value: 'off', label: '无' }, { value: 'on', label: '半透明底' }]} />
        </Row>
        {st.mode === 'bi' && st.background ? (
          <Row label="双语底板">
            <Segmented size="S" value={st.backgroundMode || 'separate'} onChange={(v) => set({ backgroundMode: v })}
              options={[{ value: 'separate', label: '分开' }, { value: 'shared', label: '整体' }]} />
          </Row>
        ) : null}

        <div className="bcs-stsec">位置</div>
        <Row label={'垂直位置 · ' + st.y + '%'}>
          <input type="range" min="8" max="94" step="1" value={st.y} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
            onChange={(e) => set({ y: parseInt(e.target.value, 10) })} aria-label="垂直位置" />
        </Row>
        <Row label={'字幕宽度 · ' + (st.width || 80) + '%'}>
          <input type="range" min="40" max="95" step="1" value={st.width || 80} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
            onChange={(e) => set({ width: parseInt(e.target.value, 10) })} aria-label="字幕宽度" />
        </Row>
        <Row label={'译文 / 原文字号 · ' + Number(st.transScale || 1.375).toFixed(2) + '×'}>
          <input type="range" min="0.8" max="1.6" step="0.025" value={st.transScale || 1.375} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
            onChange={(e) => set({ transScale: parseFloat(e.target.value) })} aria-label="译文字号倍率" />
        </Row>

        {bilingual ? LINE_LABELS.map(({ line, label }) => {
          const position = R.linePosition(st, line);
          if (!position) {
            return (
              <Row key={line} label={label + '行位置'}>
                <button className="s2-btn s2-btn--S s2-btn--secondary"
                  onClick={() => {
                    set(R.lineStylePatch(st, line, seedLinePosition(line, detachAlign(line))));
                    toast(label + '行已脱离堆栈，可单独摆放', { variant: 'positive' });
                  }}>独立摆放</button>
              </Row>
            );
          }
          const align = R.lineVerticalAlign(st, line) || 'center';
          const move = (patch) => set(R.lineStylePatch(st, line, { ...position, ...patch }));
          return (
            <React.Fragment key={line}>
              <Row label={label + '行位置 · 独立'}>
                <button className="s2-btn s2-btn--S s2-btn--secondary"
                  onClick={() => {
                    set(R.lineStylePatch(st, line, null));
                    toast(label + '行已恢复联动', { variant: 'neutral' });
                  }}>重置位置</button>
              </Row>
              <Row label={label + ' 水平 · ' + position.x + '%'}>
                <input type="range" min="3" max="97" step="0.5" value={position.x} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
                  onChange={(e) => move({ x: parseFloat(e.target.value) })}
                  aria-label={label + '行水平位置'} />
              </Row>
              <Row label={label + ' 垂直 · ' + position.y + '%'}>
                <input type="range" min="4" max="96" step="0.5" value={position.y} style={{ width: '100%', accentColor: 'var(--accent-color-900)' }}
                  onChange={(e) => move({ y: parseFloat(e.target.value) })}
                  aria-label={label + '行垂直位置'} />
              </Row>
              {/* 垂直锚点 = 上面这个 y 钉住文本块的哪条边，也就是这行折行时往哪
                  边生长：顶边→向下、中心→上下对半、底边→向上。 */}
              <Row label={label + ' 垂直锚点'}>
                <Segmented stretch size="S" value={align}
                  onChange={(v) => move({ verticalAlign: v })}
                  options={[
                    { value: 'top', label: '顶边' },
                    { value: 'center', label: '中心' },
                    { value: 'bottom', label: '底边' },
                  ]} />
              </Row>
            </React.Fragment>
          );
        }) : null}

        <div className="bcs-stsec">动画</div>
        <Row label="逐词动画">
          <Segmented size="S" value={(st.wordAnimation && st.wordAnimation.animationName) || 'Color'}
            onChange={(v) => set({ wordAnimation: { animationName: v } })}
            options={[
              { value: 'None', label: '无' },
              { value: 'Color', label: '变色' },
              { value: 'Highlight', label: '高亮' },
              { value: 'Reveal', label: '显现' },
            ]} />
        </Row>
        <Row label="入场动画">
          <Segmented size="S" value={(st.transition && st.transition.transitionId) || 'none'}
            onChange={(v) => set({ transition: {
              transitionId: v,
              transitionSpeed: (st.transition && st.transition.transitionSpeed) || 50,
            } })}
            options={[
              { value: 'none', label: '无' },
              { value: 'magic-fade', label: '淡入' },
              { value: 'magic-pop', label: '弹入' },
              { value: 'magic-flip', label: '翻入' },
            ]} />
        </Row>

        <div style={{ height: 40 }}></div>
      </div>
    </div>
  );
}

window.StylePane = StylePane;
})();
