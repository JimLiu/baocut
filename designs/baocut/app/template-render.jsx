/* 模板的画面渲染 —— §14.5（第 112 轮）。
   一份渲染器三处用：舞台上的模板 chrome（`TemplateChrome`）、目录 / 品牌库 / 向导里的
   缩略图（`TemplateThumb`）、版面编辑器的舞台（`TemplateStudioStage`，图层可拖可拉）。
   三处画的都是同一份 `BC_TPL` 文档，缩略图不另画一套「色块示意」。
   颜色全部来自文档（画进视频画面的内容色），这个文件不发明颜色。
   2026-09-14：台标层多了 `tile`（铺满盒子、斜排）与 `opacity`（整层不透明度）——水印并进模板后
   这两个参数就是「水印」与「台标」的全部区别。铺满整幅的平铺层在舞台上不吃点击
   （`.is-tile`），否则它会把视频、字幕、其它元素全盖住；版面编辑器里照常可选可拖。
   2026-09-15：台标层 `align` 决定字在徽章盒里靠哪边（底色照旧铺满盒子）；`{title}` 读项目的
   `title`（此前读的 `proj.name` / `D.projectTitle` 都不存在，标题层一直是空的）。
   同日文字层与文字台标认 `pad`（`TPL.layerPad`）：写了就用内联左右内边距盖掉 CSS 按字号推的 em 值，
   几层字号不同的字才能从同一条竖线起笔；图片台标整盒是图、平铺另有排法，都不看它。 */
(function () {
  const {useState, useRef, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const TPL = window.BC_TPL;
  const L = window.BC_LAYOUT;
  const G = window.BC_GEOM;

  /** 品牌库里的图片（内置演示 + 本次会话存进去的），台标层按 id 取。 */
  const brandImages = (ctx) => D.brand.media.concat((ctx && ctx.brandMedia) || [])
    .filter((m) => m.kind === 'image');
  /** 左 / 中 / 右 → flex 主轴对齐；文字层与台标层共用。 */
  const JUSTIFY = {left: 'flex-start', center: 'center', right: 'flex-end'};

  /* ---------- 一层怎么画 ---------- */
  function paintLayer(l, {segs, v, pct, fh, images, onSeek, editing}) {
    const px = (p) => Math.max(7, p / 100 * fh);          // 字号 = 画面高的百分比，下限 7px
    const pad = TPL.layerPad(l, fh);                       // null = 交给 CSS 按字号推
    const padStyle = pad == null ? null : {paddingLeft: pad, paddingRight: pad};
    if (l.kind === 'chapters') {
      const barH = Math.max(2, l.box.h / 100 * fh * 0.14);
      return (
        <div className="tplch" style={{background: l.bg, fontSize: px(l.size || 2.6)}}>
          {segs.map((s, i) => {
            const done = l.fill === 'dim' ? (s.state === 'done' ? l.accent
              : s.state === 'on' ? `linear-gradient(90deg, ${l.accent} ${s.done * 100}%, transparent ${s.done * 100}%)`
              : 'transparent') : null;
            const colorDone = l.colorDone || l.color;
            return (
              <span key={s.id} className={cx('tplch__seg', s.state === 'on' && 'is-on')}
                style={{flex: s.span, background: done, color: s.state === 'todo' ? l.color : colorDone,
                  borderLeft: l.divider && i ? `1px solid ${l.color}` : 'none'}}
                title={editing ? null : '跳到「' + s.title + '」'}
                onClick={editing || !onSeek ? null : (e) => { e.stopPropagation(); onSeek(s.start); }}>
                <span className="tplch__t">{s.title}</span>
                {l.fill === 'bar' ? (
                  <b className="tplch__bar" style={{width: s.done * 100 + '%', height: barH, background: l.accent}} />
                ) : null}
              </span>
            );
          })}
        </div>
      );
    }
    if (l.kind === 'progress') {
      return (
        <div className="tplpg" style={{background: l.track}}>
          <b style={{width: pct * 100 + '%', background: l.accent}} />
        </div>
      );
    }
    if (l.kind === 'logo') {
      const m = l.src !== 'text' ? images.find((x) => x.id === l.src) : null;
      /* 平铺（水印用）：同一枚台标在盒子里重复铺满、整体斜放；单元数固定 24，和盒子多大无关，
         盒子越小单元越挤——这是水印的常态（铺整幅），不是给小盒子准备的。 */
      if (l.tile) {
        const units = Array.from({length: 24}, (_, i) => i);
        return (
          <div className="tpllogo tpllogo--tile" style={{color: l.color, fontSize: px(l.size || 2.6)}}
            title={m ? m.name : null}>
            {units.map((i) => (l.src !== 'text'
              ? <i key={i} className="tpllogo__unit tpllogo__unit--img" style={{background: m ? m.grad : l.bg}} />
              : <span key={i} className="tpllogo__unit">{l.text}</span>))}
          </div>
        );
      }
      if (l.src !== 'text') {
        return <div className="tpllogo tpllogo--img" style={{background: m ? m.grad : l.bg}}
          title={m ? m.name : '品牌库里没有这张图'} />;
      }
      return (
        <div className={cx('tpllogo', l.shape === 'badge' && 'tpllogo--badge')}
          style={{background: l.bg, color: l.color, fontSize: px(l.size || 3),
            justifyContent: JUSTIFY[TPL.logoAlign(l)], ...padStyle}}>{l.text}</div>
      );
    }
    return (
      <div className={cx('tpltxt', l.mono && 't-mono')}
        style={{color: l.color, background: l.bg, fontSize: px(l.size || 2.8),
          fontWeight: l.weight || 700,
          justifyContent: JUSTIFY[l.align] || JUSTIFY.left, ...padStyle}}>
        {TPL.fill(l.text, v)}
      </div>
    );
  }

  /* ---------- 图层栈 ----------
     `fw` / `fh` 是画面框的像素尺寸：盒子按百分比落位，字号按画面高折算。
     编辑态（`editing`）下：关掉的层半透明地画出来（好点回去）、按下即拖、选中层四角 + 四边
     八枚把手（对边锚定，`TPL.resizeBoxFrom`）。拖动吸画布三线与其它开着的层的边线
     （与元素同一套 `BC_POSE.snapMove`，6px），按住 ⌥ 不吸；手势期间画导引线。 */
  function TemplateLayers({tpl, chapters, playT, dur, fw, fh, extra, images, onSeek,
                           sel, onPick, editing, onBox}) {
    const segs = TPL.segments(chapters, playT, dur);
    const v = TPL.vars(chapters, playT, dur, extra);
    const pct = TPL.progress(playT, dur);
    const frame = {w: fw, h: fh};
    const [guides, setGuides] = useState([]);

    /* 一次手势：按下记住起点盒，每一帧把像素位移交给纯层折算。handle 缺席 = 整层挪动。 */
    const gesture = (e, l, handle) => {
      if (!editing || e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const p0 = {x: e.clientX, y: e.clientY};
      const box0 = l.box;
      const others = tpl.layers.filter((o) => o.on && o.id !== l.id).map((o) => o.box);
      const move = (ev) => {
        const dx = ev.clientX - p0.x, dy = ev.clientY - p0.y;
        let next;
        if (handle) next = TPL.resizeBoxFrom(box0, handle, dx, dy, frame);
        else next = G.snapLayerMove(TPL.dragBox(box0, dx, dy, frame), others, frame, !ev.altKey).box;
        setGuides(G.layerGuides(next, others, frame));
        if (onBox) onBox(l.id, next);
      };
      const up = () => {
        setGuides([]);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };

    return (
      <div className={cx('tpll', editing && 'tpll--edit')}>
        {tpl.layers.map((l) => {
          if (!l.on && !editing) return null;
          const on = sel === l.id;
          return (
            <div key={l.id} className={cx('tpll__l', on && 'is-on', !l.on && 'is-off', l.tile && 'is-tile')}
              style={{left: l.box.x + '%', top: l.box.y + '%', width: l.box.w + '%', height: l.box.h + '%',
                opacity: !l.on ? 0.35 : TPL.layerOpacity(l)}}
              onMouseDown={(e) => {
                if (onPick) onPick(l.id);
                gesture(e, l, null);
              }}
              onClick={(e) => { e.stopPropagation(); if (!editing && onPick) onPick(l.id); }}>
              {paintLayer(l, {segs, v, pct, fh, images, onSeek, editing})}
              {editing && on ? TPL.HANDLES.map((h) => (
                <i key={h.k} className={'tpll__hnd tpll__hnd--' + h.k} style={{cursor: h.cursor}}
                  onMouseDown={(e) => gesture(e, l, h.k)} />
              )) : null}
            </div>
          );
        })}
        {guides.map((g, i) => (
          <i key={'g' + i} className={cx('gline', g.v ? 'gline--v' : 'gline--h')}
            style={g.v ? {left: g.p} : {top: g.p}} />
        ))}
      </div>
    );
  }

  /* ---------- 缩略图 ----------
     不是封面图，是这份文档在一张假画面上的真渲染：播放头停在 38%，章节读演示项目的四章。 */
  function TemplateThumb({tpl, h = 44, ctx, className}) {
    const ratio = L.ratioValue(tpl.canvas || '16:9');
    const w = Math.round(h * ratio);
    return (
      <div className={cx('tplthumb', className)} style={{width: w, height: h}} aria-hidden="true">
        <TemplateLayers tpl={tpl} chapters={D.chapters} playT={D.DUR * 0.38} dur={D.DUR}
          fw={w} fh={h} images={brandImages(ctx)} extra={{title: D.projectTitle || ''}} />
      </div>
    );
  }

  /* ---------- 舞台上的模板 chrome ----------
     选中 = 点画面上任何一层：这一层描蓝边，条子挂在它上方（贴顶的层挂下方），
     右栏切到模板属性页。整个模板是一个 `tpl` 元素（时间轴上一行），层是它的局部选中。 */
  function TemplateChrome({ctx, fw, fh}) {
    const tpl = ctx.tplDoc;
    if (!tpl) return null;
    const picked = ctx.sel && ctx.sel.kind === 'element' && ctx.sel.elKind === 'tpl';
    const selLayer = picked ? (TPL.layer(tpl, ctx.tplSel) || tpl.layers.find((l) => l.on)) : null;
    const pickLayer = (id) => {
      ctx.setTplSel(id);
      ctx.pick({kind: 'element', id: 'e-tpl', elKind: 'tpl'});
    };
    return (
      <>
        <TemplateLayers tpl={tpl} chapters={ctx.chapters} playT={ctx.playT} dur={D.DUR}
          fw={fw} fh={fh} images={brandImages(ctx)} onSeek={ctx.seek}
          sel={selLayer ? selLayer.id : null} onPick={pickLayer} extra={{title: ctx.proj ? ctx.proj.title : ''}} />
        {selLayer ? (
          <div className="selwrap tplsel" data-el="e-tpl"
            style={{left: selLayer.box.x + '%', top: selLayer.box.y + '%',
              width: selLayer.box.w + '%', height: selLayer.box.h + '%'}}>
            <div className="selbox is-on" style={{height: '100%'}} />
            <window.Toolbar kind="tpl" el={{id: 'e-tpl', kind: 'tpl'}} ctx={ctx}
              st={ctx.elStyle} set={ctx.setElStyle} below={selLayer.box.y < 25} />
          </div>
        ) : null}
      </>
    );
  }

  /* ---------- 版面编辑器的舞台 ----------
     替换掉正常舞台：同一块画面框、同一份底纹，但只有模板图层可点可拖；视频、字幕与
     其它元素这时都不可选（它们不是这一步要改的东西）。底部一条虚线标出字幕会落在哪。 */
  function TemplateStudioStage({ctx}) {
    const ref = useRef(null);
    const [box, setBox] = useState({w: 800, h: 450});
    useLayoutEffect(() => {
      const el = ref.current; if (!el) return;
      const ro = new ResizeObserver(([e]) => setBox({w: e.contentRect.width, h: e.contentRect.height}));
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    const s = ctx.tplStudio;
    if (!s) return null;
    const tpl = s.draft;
    const fit = L.fitStage(box.w, box.h, L.ratioValue(ctx.ratio));
    const subsAt = TPL.subsBottom(tpl, 0);
    const mismatch = tpl.canvas && tpl.canvas !== ctx.ratio;
    return (
      <div className="stage" ref={ref} onClick={() => ctx.studioSel(null)}>
        <div className="frame" style={{width: fit.w, height: fit.h}}>
          <div className="frame__bg" />
          <div className="frame__grid" />
          <div className="peekflag">
            <Ic n="edit" className="ic--14" />
            正在编辑版面 · 拖动图层挪位置（按住 ⌥ 不吸附），拉四角或四边改大小
            {mismatch ? ` · 这套版面是按 ${tpl.canvas} 画的` : ''}
          </div>
          {subsAt ? (
            <div className="tplguide" style={{bottom: subsAt + '%'}}><span>字幕落在这条线之上</span></div>
          ) : null}
          <TemplateLayers tpl={tpl} chapters={ctx.chapters} playT={ctx.playT} dur={D.DUR}
            fw={fit.w} fh={fit.h} images={brandImages(ctx)} editing
            sel={s.sel} onPick={ctx.studioSel} onBox={ctx.studioBox}
            extra={{title: ctx.proj ? ctx.proj.title : ''}} />
        </div>
      </div>
    );
  }

  Object.assign(window, {TemplateLayers, TemplateThumb, TemplateChrome, TemplateStudioStage, brandImages});
})();
