/* 视频属性 —— §13.6（第 84 轮）。
   整页分段：替换 · 播放（变速）· 声音（音量、淡入淡出）· 动画与转场 · 画面（不透明度、
   圆角、调整）· 旋转（含水平 / 垂直翻转、适应 / 填满画布）· 时长 · 分离音频。

   **视频此前根本没有属性页**：点画布上那块 B-roll、点时间轴那条，翻出来的是素材库
   ——与图片在第 58.2 轮之前的处境一模一样，一个只能看不能改的死胡同。

   这一份还被**动态贴纸**借去两段（`MediaSection`）：位图 / 动图贴纸能调的就是
   不透明度 / 圆角 / 调整，与视频这一页是同一批控件
   （用户：「动态贴纸本质也是视频」）。

   **这一页不做的**：
   · 按转写稿剪——这件事归转写稿页，不从这里开第二个口子；
   · 变速的自定义档是 0.25×…4×，但**变速不改时间轴长度**
     （核心的 speed 语义还没落到原型的时间轴上，登记在分歧台账）。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const E = window.BC_EL;
  const T = window.BC_TIME;

  const VID_ID = 'e-vid';                    // 画布上那块演示 B-roll

  /** 素材名 → 演示画面（与素材库缩略图同一份取色） */
  function sourceOf(name) {
    return D.sources.video.filter((s) => s.name === name)[0] || D.sources.video[1] || null;
  }

  /* ---------- 圆角四角 ----------
     开关 ＋ 四格输入 ＋ 中间一枚链条。属性页与画布 `···` 菜单的飞出共用这一份——
     两处各写一遍必然漂（第 58.2 轮图片那一份就是这个形状，那时只有属性页用）。 */
  function RoundCorners({v, set, head}) {
    const r = E.radiusOf(v);
    const lock = v.radiusLock !== false;
    const on = !!v.round;
    const cell = (key) => (
      <label key={key} className="rcell">
        <Field size="s" className="t-mono" value={r[key]} disabled={!on}
          onChange={(e) => set(E.setCorner(v, key, Math.max(0, Math.min(60, +e.target.value || 0))))} />
      </label>
    );
    return (
      <>
        {head ? (
          <div className="mval">圆角
            <div style={{marginLeft: 'auto'}}>
              <Switch on={on} onChange={(x) => set({round: x})} />
            </div>
          </div>
        ) : (
          <PRow label="圆角">
            <div className="push"><Switch on={on} onChange={(x) => set({round: x})} /></div>
          </PRow>
        )}
        {on ? (
          <div className="rgrid">
            {cell('radiusTL')}{cell('radiusTR')}
            <BCAction className={cx('rlock', lock && 'is-on')} onClick={() => set({radiusLock: !lock})}
              aria-label={lock ? '解除四角联动' : '四角联动'}>
              <Ic n={lock ? 'lock' : 'unlock'} className="ic--14" />
            </BCAction>
            {cell('radiusBL')}{cell('radiusBR')}
          </div>
        ) : null}
      </>
    );
  }

  /* ---------- 变速（四颗 chip ＋ 自定义） ----------
     「自定义」不是第五个档位，是**把一根滑杆放出来**——点它不改速度，只展开。
     所以「当前是不是自定义」由值本身决定（不在四档里就是），再加一个手动展开位。 */
  function SpeedRow({v, set}) {
    const rate = v.rate == null ? 1 : v.rate;
    const [open, setOpen] = useState(!E.isPresetSpeed(rate));
    const custom = open || !E.isPresetSpeed(rate);
    return (
      <>
        <div className="vrow">
          <span className="vbox grow">
            <Ic n="speed" className="ic--16" />变速
            <span className="vchips push">
              {E.SPEEDS.map((r) => (
                <BCAction key={r} className={cx('vchip', !custom && rate === r && 'is-on')}
                  onClick={() => { setOpen(false); set({rate: r}); }}>{r}×</BCAction>
              ))}
              <BCAction className={cx('vchip', custom && 'is-on')}
                onClick={() => setOpen(true)}>自定义</BCAction>
            </span>
          </span>
        </div>
        {custom ? (
          <div className="sec" style={{marginTop: 8}}>
            <ValueRow label="倍速" value={rate} min={E.SPEED_MIN} max={E.SPEED_MAX} step={0.05}
              unit="×" onChange={(x) => set({rate: x})} />
          </div>
        ) : null}
      </>
    );
  }

  /* 音量与淡入淡出 G11a 起并进共享的「声音」一组：
     panel-sound.jsx 的 `SoundSection`（加了音量 dB、音量包络只读、人声响起时压低）。 */

  /* ---------- 旋转 · 翻转 · 适应画布 ----------
     与元素属性页的 `RotateRow` 同形（第 83 轮那一件），末尾多一枚 `···`：
     适应画布 / 填满画布收在那里，条子的 `···` 菜单里也有同一对。 */
  function TransformRow({v, set}) {
    const app = useApp();
    const [draft, setDraft] = useState(null);
    const [more, setMore] = useState(false);
    const rot = v.rot || 0;
    const commit = () => {
      if (draft === null) return;
      const n = parseFloat(draft);
      setDraft(null);
      if (isFinite(n)) set({rot: Math.max(-180, Math.min(180, n))});
    };
    return (
      <div className="vrow">
        <span className="vbox grow">
          <Ic n="rotate" className="ic--16" />旋转
          <span className="push" style={{width: 56}}>
            <Field size="s" className="t-mono" value={draft === null ? rot + '°' : draft}
              onChange={(e) => setDraft(e.target.value)} onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { commit(); e.target.blur(); }
                if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
              }} />
          </span>
        </span>
        <span className="vbox vbox--sq">
          <IconBtn icon="fliph" size="s" tip="水平翻转" on={v.flipX} onClick={() => set({flipX: !v.flipX})} />
        </span>
        <span className="vbox vbox--sq">
          <IconBtn icon="flipv" size="s" tip="垂直翻转" on={v.flipY} onClick={() => set({flipY: !v.flipY})} />
        </span>
        <span className="vbox vbox--sq" style={{position: 'relative'}}>
          <IconBtn icon="more" size="s" tip="适应 / 填满画布" onClick={() => setMore((x) => !x)} />
          <Popover open={more} onClose={() => setMore(false)} align="right" dir="down" width={186}>
            <Menu>
              <MenuItem icon="expand" label="适应画布"
                onClick={() => { setMore(false); app.toast('已适应画布（长边贴齐，短边留边）', 'positive'); }} />
              <MenuItem icon="fullscreen" label="填满画布"
                onClick={() => { setMore(false); app.toast('已填满画布（短边贴齐，长边裁掉）', 'positive'); }} />
            </Menu>
          </Popover>
        </span>
      </div>
    );
  }

  /* ---------- 「画面」那一段：不透明度 ＋ 圆角 ＋ 调整钮 ----------
     视频与动态贴纸共用（两者本来就是同一批控件）。 */
  function MediaSection({v, set, onAdjust, onFilters}) {
    const adjOn = !E.fxIdentity(v);
    const fxOn = E.hasStack(v);
    return (
      <>
        <SecHead>画面</SecHead>
        <div className="sec">
          <RoundCorners v={v} set={set} />
          <ValueRow label="不透明度" value={v.opacity == null ? 100 : v.opacity} min={0} max={100}
            unit="%" onChange={(x) => set({opacity: x})} />
        </div>
        {onAdjust || onFilters ? (
          <div className="txrow" style={{marginTop: 8}}>
            {onFilters ? (
              <BCAction className="tbtn" onClick={onFilters}>
                <Ic n="filters" className="ic--16" />滤镜
                {fxOn ? <span className="tbtn__dot" /> : null}
              </BCAction>
            ) : null}
            {onAdjust ? (
              <BCAction className="tbtn" onClick={onAdjust}>
                <Ic n="tune" className="ic--16" />调整
                {adjOn ? <span className="tbtn__dot" /> : null}
              </BCAction>
            ) : null}
          </div>
        ) : null}
      </>
    );
  }

  /* ---------- 动态贴纸借走的那两件 ----------
     判据与画布条子同源（`BC_BAR.barKind`）：素材是 `.svg` 就是矢量贴纸（逐个填充色改），
     位图与动图没有颜色控件，能调的是不透明度 / 圆角 /
     调整。两处各判一遍必然漂，所以判据只有那一个纯函数。 */
  function stickerSrc(ctx, el) {
    const st = ctx.elStyleOf ? ctx.elStyleOf(el.id) : ctx.elStyle;
    return st.asset || (el && el.asset ? window.BC_SK.DIR + el.asset : null);
  }
  /* 判类型要连 `assetKind` 一起给（第 238 轮）：品牌库上传的源是 `blob:…`，扩展名没了，
     收件时按字节判出的结论落在样式袋里。 */
  function stickerSource(ctx, el) {
    const st = ctx.elStyleOf ? ctx.elStyleOf(el.id) : ctx.elStyle;
    return {src: stickerSrc(ctx, el), kind: st.assetKind || null};
  }
  const isMediaSticker = (ctx, el) =>
    window.BC_BAR.barKind('sticker', stickerSource(ctx, el)) === 'stickerimg';

  /** 贴纸的调整页：与图片 / 视频同一份控件，只换顶上那块预览（素材本身，铺棋盘格） */
  function StickerAdjust({v, set, src, backLabel, onBack}) {
    return (
      <window.ImageAdjust v={v} set={set} onBack={onBack} backLabel={backLabel}
        preview={
          <div className="imgprev fxwrap checker stkprev">
            <img src={src} alt="" draggable="false" style={{filter: E.fxCss(v) || null}} />
          </div>
        } />
    );
  }

  /* ---------- 顶上那块预览 ---------- */
  function Preview({v}) {
    const src = sourceOf(v.name) || {};
    return (
      <div className="imgprev fxwrap" style={{borderRadius: E.radiusCss(v, 1) || null,
        opacity: (v.opacity == null ? 100 : v.opacity) / 100}}>
        <span className="fxlayer" style={{background: src.grad || null, filter: E.fxCss(v) || null}} />
        {E.fxLayers(v).map((l) => (
          <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
            background: l.background, backgroundSize: l.backgroundSize}} />
        ))}
      </div>
    );
  }

  /* ---------- 整页 ---------- */
  function VideoProps({ctx, id, v, set, onBack, onDelete, onAnims, onTransitions, onAdjust, onFilters}) {
    const app = useApp();
    const animOn = !!(v.anim && (E.animSummary(v.anim) !== '未设置'
      || (v.anim.zoom || []).some((z) => z.k && z.k !== 'none')));
    return (
      <>
        {/* 页头与元素属性页同形（第 83 轮）：返回箭头 ＋ 左对齐标题，删除只在页脚 */}
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回素材库" onClick={onBack} />
          <span className="t-title-sm grow">编辑视频</span>
        </div>
        <div className="pscroll bc-scroll">
          <Preview v={v} />
          <div className="t-detail" style={{padding: '0 2px 2px'}}>{v.name}</div>

          {/* 素材动作（2026-09-16 二次修订）：和下面的动画 / 转场同一种瓦片，但自成一行贴在预览下——
              它们改的是「这段是什么视频」，动画 / 转场改的是「怎么动」，挪到播放段之后自成一段 */}
          <div className="txrow" style={{marginTop: 10}}>
            {window.BC_SURFACE.ai ? <BCAction className="tbtn" onClick={() => ctx.cropInstance(id)}>
              <Ic n="sparkle" className="ic--16" />智能裁剪
            </BCAction> : null}
            <BCAction className="tbtn" onClick={() => ctx.openVideoReplace(id)}>
              <Ic n="refresh" className="ic--16" />替换视频…
            </BCAction>
          </div>

          <SecHead>播放</SecHead>
          <SpeedRow v={v} set={set} />

          {/* 「声音」一组（G11a）：音量 + dB、音量包络、淡入淡出、人声响起时压低——此前三件挤在「播放」里 */}
          <window.SoundSection ctx={ctx} id={id || VID_ID} v={v} set={set} />
          {v.broll ? <div className="hint">
            B-roll 默认静音——它是盖在口播上的画面，不是第二条声音。要它出声就把音量拉起来。
          </div> : null}

          <SecHead>动画与转场</SecHead>
          <div className="txrow">
            <BCAction className="tbtn" onClick={onAnims}>
              <Ic n="anim" className="ic--16" />动画
              {animOn ? <span className="tbtn__dot" /> : null}
            </BCAction>
            <BCAction className="tbtn" onClick={onTransitions}>
              <Ic n="transitions" className="ic--16" />转场
            </BCAction>
          </div>

          <MediaSection v={v} set={set} onAdjust={onAdjust} onFilters={onFilters} />
          {/* 几何段（几何面板设计稿 §8.2）：旋转 · 翻转 · 适应画布那一行放到本段末行 */}
          {id ? (
            <window.ElementGeometry ctx={ctx} id={id} kind="video" pose={window.BC_POSE.poseOf(ctx.elDocs[id])}
              disabled={window.geometryReadOnly(ctx)}>
              <TransformRow v={v} set={set} />
            </window.ElementGeometry>
          ) : <TransformRow v={v} set={set} />}

          <SecHead aside={T.timecode(Math.max(0, v.tEnd - v.tStart))}>时长</SecHead>
          <div className="txtime">
            <Ic n="clock" className="ic--16" style={{color: 'var(--gray-600)'}} />
            <span className="txtime__l">开始</span>
            <TimeField value={v.tStart} playT={ctx.playT} onChange={(x) => set({tStart: x})} />
            <i className="txtime__sep" />
            <span className="txtime__l">结束</span>
            <TimeField value={v.tEnd} playT={ctx.playT} onChange={(x) => set({tEnd: x})} />
          </div>

          <Btn variant="secondary" icon="audio" style={{width: '100%', marginTop: 10}}
            onClick={() => app.toast('已把这一段的声音分离成独立音频轨', 'positive',
              {label: '撤销', undo: true, run: () => app.toast('已撤销')})}>分离音频</Btn>

          <BCAction className="danger" onClick={onDelete}>
            <Ic n="trash" className="ic--16" />删除视频
          </BCAction>
        </div>
      </>
    );
  }

  /* 面板的一笔改动 → 该写到哪儿去。三个去处：这一条元素自己的样式袋、元素文档的起止、
     `pose` 的旋转与镜像。视频第 84 轮起**逐元素持有样式**（与图片同一条）：不透明度
     这个键贴纸与视频都要用，共用一个袋子的话拉一下这边那边跟着动。 */
  function useVideoEdit(ctx, id) {
    const eid = id || VID_ID;
    const doc = ctx.elDocs[eid] || {};
    const rec = (ctx.elements || []).filter((e) => e.id === eid)[0] || {};
    const pose = Object.assign({rot: 0, flipX: false, flipY: false}, doc.pose);
    const st = ctx.elStyleOf(eid);
    const v = Object.assign({
      name: doc.asset || rec.asset || '',
      broll: !!rec.broll,
      anim: doc.anim,
      rot: pose.rot || 0, flipX: !!pose.flipX, flipY: !!pose.flipY,
      tStart: doc.start == null ? (rec.start || 0) : doc.start,
      tEnd: doc.end == null ? (rec.end == null ? D.DUR : rec.end) : doc.end,
    }, E.FX0, E.fromStage('video', st));
    const set = (patch) => {
      const shared = E.toStage('video', patch);
      if (Object.keys(shared).length) ctx.setElStyle(shared, eid);
      if (patch.tStart != null) ctx.setElDoc(eid, {start: patch.tStart});
      if (patch.tEnd != null) ctx.setElDoc(eid, {end: patch.tEnd});
      const pp = {};
      ['rot', 'flipX', 'flipY'].forEach((k) => { if (patch[k] != null) pp[k] = patch[k]; });
      if (Object.keys(pp).length) ctx.setElPose(eid, pp);
    };
    return {v, set};
  }

  Object.assign(window, {VideoProps, MediaSection, RoundCorners, SpeedRow,
    TransformRow, StickerAdjust, stickerSrc, stickerSource, isMediaSticker,
    useVideoEdit, VIDEO_ID: VID_ID, videoSourceOf: sourceOf});
})();
