// BaoCut Subtitle Studio — Style tab. Presets + controls write a local style
// override (bcs:style) applied live to the stage; the agent may also set
// doc.style in data.json (an agent write retires the local override).
(() => {
const { useState, useRef } = React;
const { Ic, Segmented, useApp, toast } = window;

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
const FONT_NAMES = { system: '系统黑体', montserrat: 'Montserrat', bebas: 'Bebas Neue', lexend: 'Lexend Deca', serif: '衬线 Serif' };
const COLORS = ['#FFFFFF', '#FFD43B', '#8CAAFF', '#7ADF93', '#FF8C7A', '#F5EFDC', '#111111'];

function Row({ label, children }) {
  return (
    <div className="bcs-strow">
      <span className="bcs-strow__label">{label}</span>
      <div className="bcs-strow__ctl">{children}</div>
    </div>
  );
}

function StylePane() {
  const app = useApp();
  const { doc } = app;
  const st = doc.style;
  const set = (patch) => app.setStyle(patch);

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
                  fontFamily: window.BCS_FONTS[p.style.fontFamily], color: p.style.fontColor,
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
          <Segmented stretch size="S" value={st.fontFamily} onChange={(v) => set({ fontFamily: v })}
            options={Object.entries(FONT_NAMES).map(([value, label]) => ({ value, label }))} />
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
