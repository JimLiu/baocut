/* 图片属性 —— §13.6（第 58.2 轮重做）。
   整页分段：替换 · 动画 · 调整 · 圆角 · 不透明度 · 旋转（含水平 / 垂直翻转）·
   起止 · 删除图片；画布浮动条的 `···` 菜单里也有圆角 · 不透明度 · 替换图片三件。

   **图片此前根本没有属性页**：点画布上那张图、点时间轴那条、点素材库里的卡片，
   翻出来的都是素材库本身——一个只能看不能改的死胡同。

   两个宿主共用这一份控件（`ImageBody`）：图片栏的整页与文本组里的图片成员页。
   成员那一份少了「时间」（起止归组）与「层级」，其余一样。

   **这一页不做的**：
   · 图生视频——BaoCut 没有这条 AI 链路，画一个按钮就是空承诺；
   · 调整里的对比度 / 曝光 / 色相 / 饱和度 / 噪点 / 锐化 / 暗角——核心 `Fx` 只有
     `brightness` / `blur` / `grayscale` 三个字段（`bcut-timeline/src/effects.rs`），
     其余旋钮转到底也没有东西消费。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const T = window.BC_TIME;

  /** 素材名 → 演示画面（缩略图与画布共用同一份取色，没有第二处编演示图） */
  function sourceOf(name) {
    return D.sources.image.filter((s) => s.name === name)[0] || null;
  }

  /** 属性页顶上那块预览：与画面走同一份换算（`fxCss` / `fxLayers` / `radiusCss`），
      带透明通道的素材铺棋盘格，与素材库的缩略图同一件 */
  function Preview({v}) {
    const src = v.source || sourceOf(v.name) || {};
    return (
      <div className="imgprev fxwrap" style={{borderRadius: E.radiusCss(v, 1) || null,
        opacity: (v.opacity == null ? 100 : v.opacity) / 100}}>
        <span className={cx('fxlayer', src.alpha && 'checker')}
          style={{background: src.grad || null, filter: E.fxCss(v) || null}} />
        {E.fxLayers(v).map((l) => (
          <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
            background: l.background, backgroundSize: l.backgroundSize}} />
        ))}
      </div>
    );
  }

  /* ---------- 替换（一枚带下拉的钮） ---------- */
  function ReplaceRow({name, onReplace}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    return (
      <div className="txrow" style={{marginTop: 10, position: 'relative'}}>
        <Btn variant="secondary" icon="refresh" style={{flex: 1}} onClick={() => setOpen(!open)}>
          替换素材
        </Btn>
        <Popover open={open} onClose={() => setOpen(false)} align="right" dir="down" width={230}>
          {D.sources.image.map((s) => (
            <BCAction size="M" key={s.id} className={cx('mdi', s.name === name && 'is-on')}
              onClick={() => { setOpen(false); if (s.name !== name) onReplace(s.name); }}>
              <span className="nm">{s.name}</span>
              {s.name === name ? <Ic n="check" className="ic--14" /> : null}
            </BCAction>
          ))}
          <BCAction size="M" className="mdi" onClick={() => { setOpen(false); app.toast('从磁盘选文件 · 导入后自动替换'); }}>
            <span className="nm">导入文件…</span>
          </BCAction>
        </Popover>
      </div>
    );
  }

  /* ---------- 调整（两张卡九项 ＋ 全部重置） ---------- */
  function FxCard({title, list, v, set, app}) {
    return (
      <>
        <SecHead>{title}</SecHead>
        <div className="sec">
          {list.map((f) => (
            <ValueRow key={f.k} label={f.label} value={v[f.k]} min={f.min} max={f.max}
              unit={f.k === 'hue' ? '°' : null}
              onChange={(x) => set({[f.k]: x})} />
          ))}
        </div>
        {app && app.coreMarks ? (
          <div className="hint">
            核心 <code>Fx</code> 今天只认 {list.filter((f) => E.FX_CORE[f.k]).map((f) => f.label).join(' / ') || '（这一组一项都不认）'}。
          </div>
        ) : null}
      </>
    );
  }

  /* 视频与动态贴纸借的也是这一页（第 84 轮）——调整本来就是
     一份控件，图片与视频之间只是返回目标不同。
     `preview` 由调用方给：图片给自己的画面，视频给 B-roll 的画面，贴纸给那张素材。 */
  function ImageAdjust({v, set, onBack, backLabel, preview}) {
    const app = useApp();
    const off = E.fxIdentity(v);
    return (
      <>
        <window.PanelHead title="调整" onBack={onBack} backTip={`返回${backLabel || '编辑图片'}`} />
        <div className="pscroll bc-scroll">
          {preview === undefined
            ? <Preview v={Object.assign({}, v, {opacity: 100, round: false})} />
            : preview}
          <FxCard title="颜色校正" list={E.FX_COLOR} v={v} set={set} app={app} />
          <FxCard title="效果" list={E.FX_EFFECT} v={v} set={set} app={app} />
          <Btn variant="secondary" style={{width: '100%', marginTop: 10}} disabled={off}
            onClick={() => set(Object.assign({}, E.FX0))}>全部重置</Btn>
        </div>
      </>
    );
  }

  /* ---------- 两个宿主共用的那一段 ---------- */
  function ImageBody({v, set, onAnims, onAdjust, onReplace, geomRot}) {
    const adjOn = !E.fxIdentity(v);
    const animOn = !!(v.anim && (window.BC_EL.animSummary(v.anim) !== '未设置'
      || (v.anim.zoom || []).some((z) => z.k && z.k !== 'none')));
    return (
      <>
        <ReplaceRow name={v.name} onReplace={onReplace} />

        {/* 两枚大按钮与文字面板的「样式 / 动画」是同一件 */}
        <div className="txrow" style={{marginTop: 8}}>
          <BCAction className="tbtn" onClick={onAnims}>
            <Ic n="anim" className="ic--16" />动画
            {animOn ? <span className="tbtn__dot" /> : null}
          </BCAction>
          <BCAction className="tbtn" onClick={onAdjust}>
            <Ic n="tune" className="ic--16" />调整
            {adjOn ? <span className="tbtn__dot" /> : null}
          </BCAction>
        </div>

        <SecHead>外观</SecHead>
        <div className="sec">
          <PRow label="圆角">
            <div className="push"><Switch on={!!v.round} onChange={(on) => set({round: on})} /></div>
          </PRow>
          {/* 打开后是**四角各一格 ＋ 中间一枚链条**：
              锁上四角同改，解开各自为政 */}
          {v.round ? (() => {
            const r = E.radiusOf(v);
            const lock = v.radiusLock !== false;
            const cell = (key) => (
              <label key={key} className="rcell">
                <Field size="s" className="t-mono" value={r[key]}
                  onChange={(e) => set(E.setCorner(v, key, Math.max(0, Math.min(60, +e.target.value || 0))))} />
              </label>
            );
            return (
              <div className="rgrid">
                {cell('radiusTL')}{cell('radiusTR')}
                <BCAction className={cx('rlock', lock && 'is-on')} onClick={() => set({radiusLock: !lock})}
                  aria-label={lock ? '解除四角联动' : '四角联动'}>
                  <Ic n={lock ? 'lock' : 'unlock'} className="ic--14" />
                </BCAction>
                {cell('radiusBL')}{cell('radiusBR')}
              </div>
            );
          })() : null}
          <ValueRow label="不透明度" value={v.opacity} min={0} max={100} unit="%" onChange={(x) => set({opacity: x})} />
          {/* 整页宿主把旋转 · 翻转放进几何段末行（`geomRot`）；文本组里的图片成员没有几何段，留在这里 */}
          {geomRot ? null : <>
            <ValueRow label="旋转" value={v.rot} min={-180} max={180} unit="°" onChange={(x) => set({rot: x})} />
            <PRow label="翻转">
              <div className="row gap6 push">
                <IconBtn icon="fliph" size="s" tip="水平翻转" on={v.flipX} onClick={() => set({flipX: !v.flipX})} />
                <IconBtn icon="flipv" size="s" tip="垂直翻转" on={v.flipY} onClick={() => set({flipY: !v.flipY})} />
              </div>
            </PRow>
          </>}
        </div>
      </>
    );
  }

  /* ---------- 整页（图片栏的宿主） ---------- */
  function ImageProps({ctx, id, v, set, onBack, onDelete, onAnims, onAdjust, onReplace}) {
    return (
      <>
        {/* 页头与「编辑视频」同形（2026-09-24 页头规则，§13）：删除只在页脚 */}
        <window.PanelHead title="编辑图片" onBack={onBack} backTip="返回图片" />
        <div className="pscroll bc-scroll">
          <Preview v={v} />
          <div className="t-detail" style={{padding: '0 2px 2px'}}>{v.name}</div>

          <ImageBody v={v} set={set} onAnims={onAnims} onAdjust={onAdjust} onReplace={onReplace} geomRot />

          {/* 几何段（几何面板设计稿 §8.2）：位置与宽高与画布把手写同一份 pose；
              旋转 · 翻转从「外观」挪到本段末行，与元素属性页同形 */}
          <window.ElementGeometry ctx={ctx} id={id} kind="image" pose={window.BC_POSE.poseOf(ctx.elDocs[id])}
            disabled={window.geometryReadOnly(ctx)}>
            <window.RotateRow v={v} set={set} />
          </window.ElementGeometry>

          <SecHead aside={T.timecode(v.tEnd - v.tStart)}>时间</SecHead>
          <div className="txtime">
            <Ic n="clock" className="ic--16" style={{color: 'var(--gray-600)'}} />
            <span className="txtime__l">开始</span>
            <TimeField value={v.tStart} playT={ctx.playT} onChange={(x) => set({tStart: x})} />
            <i className="txtime__sep" />
            <span className="txtime__l">结束</span>
            <TimeField value={v.tEnd} playT={ctx.playT} onChange={(x) => set({tEnd: x})} />
          </div>

          <BCAction className="danger" onClick={onDelete}><Ic n="trash" className="ic--16" />删除图片</BCAction>
        </div>
      </>
    );
  }

  /* 面板的一笔改动 → 该写到哪儿去。三个去处：画布样式袋（逐元素）、元素文档的
     起止、`pose` 的旋转与镜像。两个宿主都用这一份，免得各写一遍写歪。 */
  function useImageEdit(ctx, id, extra) {
    const doc = ctx.elDocs[id] || {};
    // 素材名的真相在投影里（演示元素的初值在 `D.elements[].asset`，换过之后在文档上）
    const rec = (ctx.elements || []).filter((e) => e.id === id)[0] || {};
    const pose = Object.assign({rot: 0, flipX: false, flipY: false}, doc.pose);
    const st = ctx.elStyleOf(id);
    const v = Object.assign({
      name: doc.asset || rec.asset || doc.text || rec.text || '',
      source: ctx.sources.image.find(s => s.name === (doc.asset || rec.asset)),
      anim: doc.anim,
      rot: pose.rot || 0, flipX: !!pose.flipX, flipY: !!pose.flipY,
      tStart: doc.start == null ? 0 : doc.start,
      tEnd: doc.end == null ? D.DUR : doc.end,
    }, E.FX0, E.fromStage('image', st), extra);
    const set = (patch) => {
      const shared = E.toStage('image', patch);
      if (Object.keys(shared).length) ctx.setElStyle(shared, id);
      if (patch.tStart != null) ctx.setElDoc(id, {start: patch.tStart});
      if (patch.tEnd != null) ctx.setElDoc(id, {end: patch.tEnd});
      const pp = {};
      ['rot', 'flipX', 'flipY'].forEach((k) => { if (patch[k] != null) pp[k] = patch[k]; });
      if (Object.keys(pp).length) ctx.setElPose(id, pp);
    };
    return {v, set};
  }

  Object.assign(window, {ImageProps, ImageBody, ImageAdjust, ImagePreview: Preview,
    useImageEdit, imageSourceOf: sourceOf});
})();
