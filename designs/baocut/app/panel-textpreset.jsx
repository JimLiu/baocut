/* Text 预设库 —— §13.5（第 59 轮从 panel-text.jsx 拆出来，整表换成 51 条）。
   四个分类（简单 13 / 标题 10 / 下三分 20 / 其它 8），目录格有两种版式：
   `size: 'half'` 那批是**字样卡**（两列，卡上就是那几行字本身），其余是**场景卡**。

   场景卡若放渲染好的整帧画面，下三分在画面左下角只占三成宽，缩到目录格里字只有
   一两像素。所以场景卡**按预设数据现画，并裁到这一组的包围盒**：看到的是这张卡的
   构图本身，字也读得出来。代价是丢了「它在整帧里的位置」，所以下三分那批仍然三列排、卡片比例照整帧的 16:9，位置信息
   由分区标题和构图本身承担。 */
(function () {
  const D = window.BC_DATA;
  const TP = window.BC_TP;

  /** 字样卡：一列居中的几行字，字号取预设的预览字号 `pv` */
  function StackPreview({p}) {
    return (
      <div className="tpm">
        {p.els.map((e, j) => {
          const k = (e.pv || 12) / (e.size || 24);
          return <span key={j} style={Object.assign({display: 'block'}, TP.textCss(e, k))}>{e.t}</span>;
        })}
      </div>
    );
  }

  /* 场景卡：裁到包围盒的那一小块画面。放大倍数由包围盒宽定——盒子越小裁得越紧，
     所以标题那种占满画面的与下三分那种缩在角落的，落到格子里字号是同一量级的。 */
  const CROP = 1.35;
  function ScenePreview({p, w}) {
    const bx = p.box;
    const cw = Math.min(100, Math.max(bx.w * CROP, 20));
    const innerW = w * (100 / cw);
    const innerH = innerW * 495 / 880;
    const h = w * 9 / 16;
    const k = innerW / 880;
    const dx = -(bx.x / 100 * innerW - w / 2);
    const dy = -(bx.y / 100 * innerH - h / 2);
    return (
      <div className="tpm tpm--scene" style={{height: h}}>
        <div style={{position: 'absolute', left: dx, top: dy, width: innerW, height: innerH}}>
          {p.els.map((e, j) => {
            const box = {position: 'absolute', left: e.x + '%', top: e.y + '%',
              transform: 'translate(-50%, -50%)' + (e.rot ? ' rotate(' + e.rot + 'deg)' : ''),
              width: e.w == null ? 'auto' : (e.w + '%'),
              whiteSpace: e.w == null ? 'pre' : null};
            if (e.k !== 'text') {
              const sh = TP.shapeCss(e, k);
              sh.width = '100%';
              sh.paddingTop = (e.h * 495 / (e.w * 880) * 100) + '%';
              return <span key={j} style={box}><span style={Object.assign({display: 'block'}, sh)} /></span>;
            }
            return <span key={j} style={box}>
              <span style={Object.assign({display: 'block'}, TP.textCss(e, k))}>{e.t}</span>
            </span>;
          })}
        </div>
      </div>
    );
  }

  /** 一格。`w` 是这一格的像素宽，场景卡要靠它算放大倍数。 */
  function PresetTile({p, onAdd, w}) {
    return (
      <Card className={cx('tpc', p.lay === 'scene' && 'tpc--scene')} onClick={() => onAdd(p)}>
        {p.lay === 'scene' ? <ScenePreview p={p} w={w} /> : <StackPreview p={p} />}
        {p.n > 1 ? <span className="tpb"><Ic n="elements" className="ic--14" />{p.n}</span> : null}
        {p.anim ? <span className="tpb tpb--anim"><Ic n="sparkle" className="ic--14" /></span> : null}
      </Card>
    );
  }

  /* 目录本体。分类芯片是全部 / 简单 / 标题 / 下三分 / 其它，「全部」那一档
     每个分区只出前六格、多的走「查看全部」。 */
  function TextAddView({onAdd, cat, setCat}) {
    const secs = cat === 'all' ? D.textCats.slice(1) : D.textCats.filter((c) => c.k === cat);
    const ref = React.useRef(null);
    const [w, setW] = React.useState(360);
    React.useLayoutEffect(() => {
      const el = ref.current; if (!el) return;
      const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    // 格宽 = （栏宽 − 左右内距 − 格间距）÷ 列数；场景卡三列、字样卡两列
    const cellW = (cols) => Math.max(60, (w - 24 - (cols - 1) * 8) / cols);
    return (
      <>
        <PanelHead title="文字" />
        <div className="chiprow" style={{padding: '10px 12px 0'}}>
          {D.textCats.map((c) => <Chip key={c.k} pill on={cat === c.k} onClick={() => setCat(c.k)}>{c.label}</Chip>)}
        </div>
        <div className="pscroll bc-scroll" ref={ref}>
          {cat === 'all' ? (
            <BCAction className="addtile" onClick={() => onAdd(null)}>
              <Ic n="plus" className="ic--16" />添加文本框
            </BCAction>
          ) : null}
          {secs.map((c, i) => {
            const all = D.textPresets.filter((p) => p.cat === c.k);
            const list = cat === 'all' ? all.slice(0, 6) : all;
            return (
              <React.Fragment key={c.k}>
                <SecHead first={i === 0 && cat !== 'all'} aside={all.length + ' 条'}
                  action={cat === 'all' && all.length > 6
                    ? <BCAction className="viewall" onClick={() => setCat(c.k)}>
                        查看全部<NavChevron />
                      </BCAction> : null}>
                  {c.label}
                </SecHead>
                <div className="tpgrid">
                  {list.map((p) => (
                    <PresetTile key={p.id} p={p} onAdd={onAdd}
                      w={cellW(p.lay === 'scene' ? 3 : 2)} />
                  ))}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </>
    );
  }

  Object.assign(window, {TextAddView, PresetTile});
})();
