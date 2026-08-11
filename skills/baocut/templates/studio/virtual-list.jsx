// BaoCut Subtitle Studio — 通用虚拟列表外壳（window.VirtualList）。
// 纯排版逻辑在 virtual-list.js（BCS_VLIST），这里只负责三件浏览器侧的事：
//   1) rAF 节流地读滚动位置/尺寸；2) 渲染后用真实盒子回填高度缓存，并在
//   视口上方的行变高变矮时补偿 scrollTop 防跳；3) 把窗外但必须活着的行
//   （正在编辑、光标交接目标）钉在渲染集合里——回收正在编辑的行会触发
//   "强制 blur → 提交 → 同步重排" 的重入链（见 docs 的编辑器升级设计 §2）。
// 行一律 position:absolute 定位：所有行的父节点相同、key 稳定，进出窗口之外
// 不会重建 DOM，contentEditable 的光标才不会被回收掉。
// 章节头因此失去原生 sticky，由 stickyAt 计算出的浮层复现。
(() => {
const { useState, useRef, useMemo, useEffect, useLayoutEffect, useCallback, useImperativeHandle } = React;
const V = window.BCS_VLIST;

const sameView = (a, b) => a.top === b.top && a.h === b.h && a.w === b.w;

function VirtualList({
  rows, estimate, fingerprint, renderRow, rowClass,
  pinnedKeys, overscan = 400, tailPad = 60,
  className, style, scrollRef, handle, children,
}) {
  const ownRef = useRef(null);
  const el = scrollRef || ownRef;
  const innerRef = useRef(null);
  const [view, setView] = useState({ top: 0, h: 0, w: 0 });
  const [gen, bump] = useState(0);

  const store = useRef(null);
  if (!store.current) store.current = V.createHeightStore({ estimate, fingerprint });
  store.current.setWidth(view.w);

  const byKey = useMemo(() => V.indexByKey(rows), [rows]);
  // gen 是实测回填的版本号：高度缓存是 ref，靠它把新高度带进这次渲染。
  const heights = useMemo(() => store.current.heights(rows), [rows, view.w, gen]);
  const offs = useMemo(() => V.offsets(heights), [heights]);
  const total = offs[offs.length - 1];

  // 首帧 clientHeight 还是 0，用一屏的保守值先铺出可见行，避免白屏。
  const viewH = view.h || 700;
  const range = V.visibleRange(offs, view.top, viewH, overscan);
  const plan = V.renderPlan(rows, range, pinnedKeys, byKey);
  const stick = V.stickyAt(rows, offs, view.top, heights);

  // ---- 滚动 / 尺寸：rAF 节流，且只在真的变了才 setState ----
  useEffect(() => {
    const sc = el.current;
    if (!sc) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const inner = innerRef.current;
      const next = { top: sc.scrollTop, h: sc.clientHeight, w: inner ? inner.clientWidth : sc.clientWidth };
      setView((v) => (sameView(v, next) ? v : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(read); };
    sc.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(sc);
    if (innerRef.current) ro.observe(innerRef.current);
    read();
    return () => { sc.removeEventListener('scroll', schedule); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [el]);

  // ---- 实测回填 + 滚动锚点补偿 ----
  useLayoutEffect(() => {
    const sc = el.current, inner = innerRef.current;
    if (!sc || !inner) return;
    const anchor = V.findIndexAt(offs, sc.scrollTop);
    const before = offs[anchor] || 0;
    let changed = false;
    const nodes = inner.querySelectorAll('[data-vrow]');
    for (let i = 0; i < nodes.length; i++) {
      const idx = byKey.get(nodes[i].getAttribute('data-vkey'));
      if (idx == null) continue;
      if (store.current.measure(rows[idx], nodes[i].getBoundingClientRect().height)) changed = true;
    }
    if (!changed) return;
    const next = V.offsets(store.current.heights(rows));
    const delta = (next[anchor] || 0) - before;
    if (delta) sc.scrollTop = sc.scrollTop + delta;
    bump((n) => n + 1);
  });

  useEffect(() => { store.current.prune(rows); }, [rows]);

  useImperativeHandle(handle, () => ({
    element: () => el.current,
    indexOf: (key) => { const i = byKey.get(key); return i == null ? -1 : i; },
    // 只在目标出视口时滚动。距离超过一屏时直接跳——估算高度还在被实测修正，
    // smooth 会追着一个不断变化的目标抖。
    scrollToKey(key) {
      const sc = el.current;
      const i = byKey.get(key);
      if (!sc || i == null) return false;
      const to = V.scrollTopFor(offs, i, sc.scrollTop, sc.clientHeight || viewH, 8);
      if (to == null) return false;
      const far = Math.abs(to - sc.scrollTop) > (sc.clientHeight || viewH);
      sc.scrollTo({ top: to, behavior: far ? 'auto' : 'smooth' });
      return true;
    },
  }), [byKey, offs, viewH, el]);

  return (
    <div className={className} style={style} ref={el}>
      <div className="vk-vlist" ref={innerRef} style={{ position: 'relative', height: total + tailPad }}>
        {plan.map((i) => (
          <div key={rows[i].key} data-vrow="" data-vkey={rows[i].key}
            className={'vk-vrow' + (rowClass ? ' ' + rowClass(rows[i]) : '')}
            style={{ position: 'absolute', top: offs[i], left: 0, right: 0 }}>
            {renderRow(rows[i], i)}
          </div>
        ))}
        {stick ? (
          <div className={'vk-vrow vk-vrow--stuck' + (rowClass ? ' ' + rowClass(rows[stick.index]) : '')}
            aria-hidden="true"
            style={{ position: 'absolute', top: stick.top, left: 0, right: 0, zIndex: 3 }}>
            {renderRow(rows[stick.index], stick.index)}
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

Object.assign(window, { VirtualList });
})();
