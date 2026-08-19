// BaoCut Subtitle Studio — 水印 slide-over（原型 app/watermark.jsx 的 WmPane）。
//
// 入口两处：舞台工具条的「水印」按钮（stage.jsx）与时间轴「+ 添加 → 水印」之后。
// 层壳与样式层/检查器同款，三层互斥由 store 保证。
//
// 水印在 Studio 里不是独立模型：它是带 `role: 'watermark'` 的普通 text / image 元素
// （剪辑域设计 §3.6 决策 7/8），服务端因此把它放进 `wm` 轨。所以这一层 = 「wm 元素的
// 列表」+ 「选中项的编辑区」，而编辑区就是检查器那一份 ElementEditor —— 同一组控件，
// 不复制第二套（原型是两份控件树，Studio 合成一份，代价是水印这边多出「垂直锚点 /
// 填充」这类通用几何控件，收益是两个层永远不会分叉）。
//
// 有意省略（原型有、Studio 没有对应模型或写路径）：
//   · HTML 片段水印（`WmHtmlDialog`：一次性把 HTML 光栅成 PNG）—— 需要浏览器端
//     光栅 + 上传，且 `source: 'html'` 这条链路 CLI 侧还没有消费方；
//   · 跨项目的品牌预设库（Brand presets）—— Studio 没有跨项目存储层（决策 D16）；
//   · 文本样式库（保存/套用命名样式）—— 与样式层同一个原因，见 style-layer.jsx 注释。
(() => {
const { useEffect, useMemo, useRef } = React;
const { Ic, QBtn, useApp, useEsc } = window;
const TS = window.BCS_TEXT_STYLE;
if (!TS) throw new Error('text-style-controls.jsx failed to load');
const { SpSect } = TS;
const PANELS = window.BCS_ELEMENT_PANELS;
if (!PANELS) throw new Error('inspector-layer.jsx failed to load');
const ET = window.BCS_ELEMENT_TIME;
const T = window.BCS_TIMELINE;

// 列表里的称呼与时间片：与时间轴上的水印块同一套（timeline.jsx 的 elementBlockLabel）。
function watermarkName(element) {
  if (element.kind === 'image') return '图片';
  const text = String(element.text == null ? '' : element.text).trim();
  return text || '文本';
}

function WmRow({ element, selected, onSelect, onRemove, duration }) {
  const whole = ET.isWholeVideo(element, duration);
  const span = ET.windowOf(element, duration);
  const url = element.kind === 'image' && T && element.srcId ? T.mediaURL(element.srcId) : null;
  const color = ((element.style || {}).fontColor) || '#FFFFFF';
  return (
    <div className={'bcs-wmrow' + (selected ? ' bcs-wmrow--sel' : '')}
      role="button" tabIndex={0} aria-pressed={selected} aria-label={'水印 ' + watermarkName(element)}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); }
      }}>
      <span className="bcs-wmrow__thumb">
        {url ? <img src={url} alt="" /> : <span className="bcs-wmrow__aa" style={{ color }}>Aa</span>}
      </span>
      <span className="bcs-wmrow__name">{watermarkName(element)}</span>
      {element.tile && element.tile.on ? (
        <span className="bcs-wmrow__badge" data-tip="已平铺"><Ic name="apps" size={12} /></span>
      ) : null}
      <span className="bcs-wmrow__chip vk-mono">
        {whole ? '整片' : ET.formatTime(span.start) + '–' + ET.formatTime(span.end)}
      </span>
      <QBtn icon="delete" size="XS" tip="删除这个水印"
        onClick={(event) => { event.stopPropagation(); onRemove(); }} />
    </div>
  );
}

function WmPane() {
  const app = useApp();
  const fileRef = useRef(null);
  const duration = (app.doc && app.doc.meta && app.doc.meta.duration) || 0;
  // 水印可能落在任何轨道（服务端按 role 选 `wm`，但手写的 timeline.json 不保证），
  // 所以按 role 找而不是按轨道 id 找。
  const items = useMemo(() => {
    const tracks = ((app.doc || {}).timelineProjection || {}).tracks || [];
    const out = [];
    tracks.forEach((track) => {
      (track.elements || []).forEach((element) => {
        if (element && element.role === 'watermark') out.push({ ...element, trackId: track.id || null });
      });
    });
    return out;
  }, [app.doc && app.doc.timelineProjection]);
  const selectedId = app.sel && app.sel.kind === 'el' ? app.sel.id : null;
  const current = items.find((element) => element.id === selectedId) || null;

  return (
    <div className="vk-sp__scroll">
      <SpSect title="水印" first>
        {items.length ? items.map((element) => (
          <WmRow key={element.id} element={element} duration={duration}
            selected={element.id === selectedId}
            onSelect={() => app.setSel({ kind: 'el', id: element.id })}
            onRemove={() => { app.flushElementDraft(); app.removeElement(element); }} />
        )) : (
          <div className="bcs-wmempty">添加 logo 或署名 —— 会烧进导出的视频。</div>
        )}
        <div className="bcs-elp__addrow">
          <button type="button" className="s2-btn s2-btn--S s2-btn--secondary"
            onClick={() => app.addWatermark()}>
            <Ic name="edit" size={13} />文本
          </button>
          <button type="button" className="s2-btn s2-btn--S s2-btn--secondary"
            onClick={() => fileRef.current && fileRef.current.click()}>
            <Ic name="image" size={13} />图片…
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: 'none' }} aria-hidden="true" tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files && event.target.files[0];
              event.target.value = '';
              if (file) app.addImageElement(file, { role: 'watermark' });
            }} />
        </div>
      </SpSect>
      {current ? (
        <PANELS.ElementEditor element={current} />
      ) : (items.length ? (
        <div className="bcs-wmhint">在上面的列表里选一个水印，或者在画面上点它。</div>
      ) : null)}
    </div>
  );
}

function WatermarkLayer() {
  const app = useApp();
  const open = !!app.wmOpen;
  const closeRef = useRef(null);
  useEsc(app.closeWatermark, open);
  useEffect(() => { if (open && closeRef.current) closeRef.current.focus(); }, [open]);
  return (
    <div className={'vk-stylelayer' + (open ? ' vk-stylelayer--open' : '')}
      role="region" aria-label="水印" inert={open ? undefined : ''}
      data-screen-label="Watermark layer">
      <div className="vk-stylelayer__head">
        <Ic name="layers" size={16} />
        <span className="vk-stylelayer__title">水印</span>
        <QBtn refEl={closeRef} icon="close" size="S" tip="关闭（Esc）" onClick={app.closeWatermark} />
      </div>
      {open ? <WmPane /> : null}
    </div>
  );
}

window.WatermarkLayer = WatermarkLayer;
})();
