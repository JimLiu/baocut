/* 导出弹层里的画面预览 —— §17.1（第 120.1 轮）。
   ============================================================================
   弹层左栏那一小块画面：**导出出去会是什么样**，随「画面里有什么」的开关、分辨率
   之外的画幅裁切与自己的一条时间线一起动。它不是舞台的缩小版——舞台上的东西可点可拖，
   这里一件都不能碰；它只回答一个问题：这次导出的画面里有哪些东西、按目标画幅裁掉了哪一截。

   画什么：
     · 底：项目画面（演示装置的确定性渐变底），按 `X.cropRect` 在目标画幅的盒里做 cover——
       16:9 导成 9:16 就看得见两边被裁掉；
     · 元素：生效清单里开着、且此刻在时间段内的那些，按各自 `pose` 落在**项目画面**上
       （裁掉的那截跟着被裁），画的是色块 ＋ 图标的示意（元素的真身在舞台上，这里不重画
       贴纸 SVG 与图片滤镜——预览要回答的是「有没有、在不在裁切区里」，不是像素）；
     · 字幕：生效清单里开着的每条轨，画面与舞台**同一条 `paintCss` / `WordLine` 路**
       （涂装只有一份），按输出画面的 8% 安全区落位——字幕由导出管线对着输出尺寸排，
       不随裁切被切掉；
     · 模板 chrome：与舞台同一份 `TemplateLayers`，只读（不给 onPick / sel）。

   时间线是**弹层自己的**（初值取播放头）：拖它不动编辑器的播放头，弹层盖着半个舞台，
   来回联动只会让人搞不清哪个在动；播放是 10fps 的演示节奏，循环。第 239 轮起播放只走
   选中的**范围**（`span.runs`，X.stepIn）：勾了第 2、4 章就在这两章之间跳着循环，
   预览演的是导出出去那一段；此刻停在哪由 `onTime` 报给弹层——范围的「取此刻」按它。
   反方向是 `seek`（{t, n}，n 每次递增）：修剪条拖把手时暂停并停到那一头，拖到哪看到哪。
   ============================================================================ */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const X = window.BC_EXPORT;
  const L = window.BC_LAYOUT;
  const P = window.BC_POSE;

  /* 元素示意块的高宽比（没有真身时给个像样的形状）；核心里各类型有自己的量高法，
     预览只要「大致占多大一块」 */
  const ASPECT = {image: 0.62, sticker: 1, video: 0.56, shape: 0.6, progress: 0.05, wave: 0.3, count: 0.22};
  const aspectOf = (kind) => ASPECT[kind] || 0.22;

  const BOX_W = 330, BOX_H = 186;

  function ExportPreview({ctx, eff, ratio, span, onTime, seek}) {
    const [pt, setPt] = useState(() => Math.min(D.DUR, Math.max(0, ctx.playT || 0)));
    const [playing, setPlaying] = useState(false);
    /* runs 每次渲染都是新数组，走 ref 读——定时器只随 playing 建 / 拆，不跟着每帧重建 */
    const runsRef = useRef(null);
    runsRef.current = span && !span.whole && !span.empty ? span.runs : null;
    useEffect(() => {
      if (!playing) return;
      const id = setInterval(() => setPt((t) => {
        const runs = runsRef.current;
        if (runs) return X.stepIn(t, 0.1, runs);
        return t + 0.1 >= D.DUR ? 0 : +(t + 0.1).toFixed(1);
      }), 100);
      return () => clearInterval(id);
    }, [playing]);
    useEffect(() => { if (onTime) onTime(pt); }, [pt]);
    useEffect(() => {
      if (!seek) return;
      setPlaying(false);
      setPt(Math.min(D.DUR, Math.max(0, seek.t)));
    }, [seek && seek.n]);

    const srcR = L.ratioValue(ctx.ratio);
    const outR = L.ratioValue(ratio);
    const fit = X.fitBox(BOX_W, BOX_H, outR);
    const crop = X.cropRect(srcR, outR);
    const off = X.offKeys(eff);
    /* 字号跟输出画面宽走（20px @ 880，与舞台同口径），下限 6 —— 9:16 的盒只有 105px 宽 */
    const fz = Math.max(6, +(fit.w * (20 / 880)).toFixed(1));
    /* 项目画面在盒里的像素宽（cover 之后），元素与模板按它缩放 */
    const srcW = fit.w * crop.width / 100, srcH = fit.h * crop.height / 100;
    const k = srcW / 880;
    const cue = ctx.cues.find((c) => pt >= c.start && pt < c.end) || null;
    const doc = ctx.subStyle;
    /* 生效清单的 on 已经把「时间轴上停用」与「这次导出的覆盖」都算进去了，这里只看它 */
    const tracks = window.BC_SUB.tracks(doc).filter((t) => !off['subs:' + t.id]);

    const els = (ctx.elements || []).filter((e) => e.kind !== 'tpl' && !off['el:' + e.id]
      && pt >= (e.start || 0) && (e.end == null || pt <= e.end));
    const srcStyle = {left: crop.left + '%', top: crop.top + '%', width: crop.width + '%', height: crop.height + '%'};

    return (
      <div className="xpv">
        <div className="xpv__stage">
          <div className="xpv__box" style={{width: fit.w, height: fit.h}}>
            <div className="xpv__src" style={srcStyle}>
              <div className="frame__grid" />
              {els.map((e) => {
                const pose = P.poseOf(ctx.elDocs[e.id]);
                const w = pose.w * (pose.scale || 1);
                const hue = e.hue || 'blue';
                /* 铺满画面的那几类（覆盖层 / 取景框，w ≥ 90）只画一圈虚线框——实心涂上去
                   会把整幅画面盖住，预览就什么都看不见了 */
                const full = w >= 90;
                /* 写过显式高度的（`pose.h`，第 122 轮的四边缩放）按它画——`h` 与 `w`
                   同口径是**画面**百分比，所以在这块等价于画面的容器里直接就能用；
                   没写过的仍按逐类型宽高比从 `w` 推。 */
                const h = pose.h == null ? null : pose.h * (pose.scale || 1);
                const geo = full ? {height: '100%'}
                  : h != null ? {height: h + '%'}
                  : {paddingTop: (w * aspectOf(e.kind) * srcW / srcH) + '%'};
                return (
                  <div key={e.id} className={cx('xpv__el', full && 'xpv__el--full')}
                    style={Object.assign({left: pose.x + '%', top: pose.y + '%', width: w + '%',
                      transform: 'translate(-50%, -50%) rotate(' + (pose.rot || 0) + 'deg)',
                      color: 'var(--' + hue + '-1000)'},
                      full ? {borderColor: 'var(--' + hue + '-800)'}
                           : {background: 'var(--' + hue + '-200)', boxShadow: 'inset 0 0 0 1px var(--' + hue + '-800)'},
                      geo)}>
                    {w * k > 22 ? <Ic n={e.icon || 'layers'} className="ic--14 xpv__elic" /> : null}
                  </div>
                );
              })}
              {ctx.tplDoc ? (
                <window.TemplateLayers tpl={ctx.tplDoc} chapters={ctx.chapters} playT={pt} dur={D.DUR}
                  fw={srcW} fh={srcH} images={window.brandImages(ctx)} onSeek={() => {}}
                  sel={null} onPick={() => {}} extra={{title: ctx.proj ? ctx.proj.title : ''}} />
              ) : null}
            </div>
            {cue ? tracks.map((t) => {
              const ln = window.BC_SUB.line(doc, t.id, cue.id);
              const isSrc = t.role === 'source';
              const text = isSrc ? cue.text : cue.trans;
              if (!text) return null;
              const n = window.BC_WA.split(cue.text).length;
              const lift = ctx.tplDoc && ctx.tplDoc.subsAvoid !== false ? window.BC_TPL.subsBottom(ctx.tplDoc, 0) : 0;
              const y = lift ? Math.min(ln.y, 100 - lift) : ln.y;
              /* 可读下限只托底、不放大（2026-09-27 Shorts）：字号大于缺省的轨按真比例折算，
                 否则小窗口里 99 号的 Shorts 预设会被下限 × 3 撑出画面。缺省及更小的字号与此前逐像素相同。 */
              const fzBase = D.subtitle.trackDefaults.size || 32;
              const fzl = +(ln.size > fzBase ? Math.max(fz, fit.w * (20 / 880) * ln.size / fzBase) : fz * ln.size / fzBase).toFixed(1);
              const cap = isSrc ? ln.caption : null;
              return (
                <div key={t.id} className="xpv__sub"
                  style={Object.assign({top: y + '%', transform: 'translateY(' + P.subShift(ln.valign) + '%)'},
                    ln.width ? {left: (100 - ln.width) / 2 + '%', right: (100 - ln.width) / 2 + '%'} : null)}>
                  {cap ? (
                    <div className="subline subline--cap">
                      <window.CaptionCanvas presetK={cap} text={cue.text} fz={fz} loop={false}
                        t={pt - cue.start} dur={cue.end - cue.start} still={window.subReduced} />
                    </div>
                  ) : (
                    <div className={cx('subline', ln.mono && 't-mono')} style={window.paintCss(ln, fzl)}>
                      <window.WordLine text={text} anim={isSrc ? ln.wordAnim || 'none' : 'none'}
                        active={ln.activeColor} cur={window.BC_WA.at(pt, cue.start, cue.end, n)}
                        plate={window.plateCss(ln, fzl)} />
                    </div>
                  )}
                </div>
              );
            }) : null}
            {crop.cut ? <span className="xpv__cut">{crop.cut === 'sides' ? '两边裁掉' : '上下裁掉'}</span> : null}
          </div>
        </div>
        <div className="xpv__bar">
          <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '暂停预览' : '播放预览'}
            onClick={() => setPlaying((v) => !v)} />
          <Slider value={pt} min={0} max={D.DUR} step={0.1} onChange={(v) => { setPlaying(false); setPt(v); }} />
          <span className="xpv__t">{X.mmss(pt)} / {X.mmss(D.DUR)}</span>
        </div>
      </div>
    );
  }

  Object.assign(window, {ExportPreview});
})();
