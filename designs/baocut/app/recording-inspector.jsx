/* 录制带来的视频元素在右栏的几段（屏幕录制设计 §5；product-design §5.9）。挂在「编辑视频」页的画面段之后。
     · 屏幕：「屏幕取景」（缩放列表 + 选中那一段的倍率、看哪里、进出过渡）、「跟随」、「光标」（光标录进画面时整组置灰
       并写明原因）、「重新生成」、「演示样式」。
     · 摄像头：「摄像头布局」五种预设，自己拖过就显示「自定义」。
   取景文档整份写回（BC_SV + useScreenViewStore），一次写一条历史；滑块连拖由历史栈按 tag 合并。App 与 Web 都加载。 */
(function () {
  const SV = window.BC_SV;

  const pct = (x) => Math.round(x * 100);
  const sec = (x) => Math.round(x * 10) / 10;

  function ZoomList({ctx, viewId, view, el}) {
    const sel = ctx.zoomSel && ctx.zoomSel.view === viewId ? ctx.zoomSel.id : null;
    const zooms = view.zooms || [];
    if (!zooms.length) return <div className="hint">还没有缩放。在时间线的「缩放」行上拖出一段来加。</div>;
    return <div className="scv-list" role="list" aria-label="缩放">
      {zooms.map((z) => {
        const seqT = SV.toSequence(el, z.t0);
        return <BCAction key={z.id} role="listitem" className={cx('scv-item', sel === z.id && 'is-on')}
          onClick={() => { ctx.setZoomSel(sel === z.id ? null : {view: viewId, id: z.id}); ctx.seek(Math.max(el.start, seqT)); }}>
          <i className={cx('scv-item__sw', 'scv-zoom--' + SV.originTone(z))} />
          <span className="scv-item__n">{SV.zoomName(view, z.id)}</span>
          <span className="scv-item__m">{SV.scaleLabel(z.scale)} · {window.BC_TIME.timecode(z.t0)}–{window.BC_TIME.timecode(z.t1)}</span>
          <span className={cx('scv-item__o', 'scv-item__o--' + SV.originTone(z))}>{SV.originLabel(z)}</span>
        </BCAction>;
      })}
    </div>;
  }

  function ZoomEditor({ctx, viewId, view, zoom}) {
    const put = (patch) => ctx.setScreenView(viewId, SV.patchZoom(view, zoom.id, patch));
    const point = zoom.focus && zoom.focus.kind === 'point';
    return <div className="scv-edit">
      <ValueRow label="倍率" value={zoom.scale} min={SV.ZOOM_MIN} max={SV.ZOOM_MAX} step={0.1} unit="×"
        onChange={(x) => put({scale: x})} />
      <PRow label="看哪里">
        <Segmented size="s" value={point ? 'point' : 'pointer'}
          items={[{k: 'pointer', label: '跟随鼠标'}, {k: 'point', label: '固定一点'}]}
          onChange={(k) => put({focus: k === 'point' ? {kind: 'point', x: 0.5, y: 0.5} : {kind: 'pointer'}})} />
      </PRow>
      {point ? <div className="hint">在舞台上拖动取景框，选看哪里。</div> : null}
      <ValueRow label="进入过渡" value={zoom.rampIn == null ? 0.4 : zoom.rampIn} min={0} max={SV.RAMP_MAX} step={0.1} unit="秒"
        onChange={(x) => put({rampIn: sec(x)})} />
      <ValueRow label="退出过渡" value={zoom.rampOut == null ? 0.4 : zoom.rampOut} min={0} max={SV.RAMP_MAX} step={0.1} unit="秒"
        onChange={(x) => put({rampOut: sec(x)})} />
      <BCAction className="danger" onClick={() => ctx.removeZoom(viewId, zoom.id)}>
        <Ic n="trash" className="ic--16" />删除这段缩放
      </BCAction>
    </div>;
  }

  function ScreenSections({ctx, el}) {
    const app = useApp();
    const viewId = el.screenView;
    const rec = ctx.recordingOfView(viewId);
    const view = ctx.screenView(viewId);
    const zoom = ctx.zoomSel && ctx.zoomSel.view === viewId ? (view.zooms || []).find((z) => z.id === ctx.zoomSel.id) : null;
    const mode = rec ? rec.pointer : 'separate';
    const note = SV.pointerNote(mode);
    const off = !!note;
    const regen = () => {
      const r = SV.regenerate(view, rec ? rec.clicks : [], {prefix: 'auto-' + Date.now().toString(36) + '-'});
      ctx.setScreenView(viewId, r.view);
      ctx.setZoomSel(null);
      app.toast(`已重新生成自动缩放 · ${r.added} 段${r.kept ? `，留下改过的与手动加的 ${r.kept} 段` : ''}`, 'positive',
        {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    const presentation = SV.presentationOf(el);
    const setPresentation = (k) => {
      const p = SV.presentationPatch(k, el);
      ctx.setElDoc(el.id, {pose: p.pose, style: p.style});
    };
    return <>
      <SecHead aside={(view.zooms || []).length ? `${view.zooms.length} 段缩放` : null}>屏幕取景</SecHead>
      <ZoomList ctx={ctx} viewId={viewId} view={view} el={el} />
      {zoom ? <ZoomEditor ctx={ctx} viewId={viewId} view={view} zoom={zoom} /> : null}
      <Tip label="按录到的点击重排自动缩放；改过的与手动加的留着">
        <Btn variant="secondary" size="s" icon="refresh" style={{marginTop: 8}} onClick={regen}>重新生成</Btn>
      </Tip>

      <SecHead>跟随</SecHead>
      <ValueRow label="安全区" value={pct(SV.followValue(view, 'safeArea'))} min={0} max={95} unit="%"
        onChange={(x) => ctx.setScreenView(viewId, SV.setFollow(view, 'safeArea', x / 100))} />
      <ValueRow label="平滑" value={pct(SV.followValue(view, 'smoothing'))} min={0} max={100} unit="%"
        onChange={(x) => ctx.setScreenView(viewId, SV.setFollow(view, 'smoothing', x / 100))} />

      <SecHead>光标</SecHead>
      <div className={cx('scv-group', off && 'is-off')} aria-disabled={off || undefined}>
        {off ? <div className="hint">{note}</div> : null}
        {off ? <>
          <PRow label="大小"><span className="t-detail">—</span></PRow>
          <PRow label="静止后隐去"><span className="t-detail">—</span></PRow>
        </> : <>
          <ValueRow label="大小" value={pct(SV.pointerValue(view, 'size'))} min={pct(SV.POINTER_SIZE_MIN)} max={pct(SV.POINTER_SIZE_MAX)} unit="%"
            onChange={(x) => ctx.setScreenView(viewId, SV.setPointer(view, 'size', x / 100))} />
          <ValueRow label="静止后隐去" value={SV.pointerValue(view, 'idleHide')} min={0} max={SV.IDLE_MAX} step={0.5} unit="秒"
            onChange={(x) => ctx.setScreenView(viewId, SV.setPointer(view, 'idleHide', x))} />
        </>}
        <PRow label="点击提示">
          <Switch on={!off && SV.pointerValue(view, 'ripple')} disabled={off}
            onChange={(on) => ctx.setScreenView(viewId, SV.setPointer(view, 'ripple', on))} />
        </PRow>
      </div>

      <SecHead>演示样式</SecHead>
      <PRow label="屏幕">
        <Segmented size="s" value={presentation || ''} items={SV.PRESENTATIONS} onChange={setPresentation} />
      </PRow>
      {presentation === 'inset' ? <div className="hint">留边露出画布底色。</div> : null}
    </>;
  }

  function CameraSections({ctx, el}) {
    const S = window.RSP;
    const layout = SV.cameraLayoutOf(el);
    const apply = (k) => {
      if (!k || k === 'custom') return;
      const screens = ctx.elements.filter((e) => e.recording === el.recording && e.role === 'screen');
      const ratio = window.BC_LAYOUT.ratioValue(ctx.ratio || '16:9');
      const patches = SV.cameraLayoutPatches(k, el, screens, ratio);
      ctx.history.begin();
      patches.forEach(({id, patch}) => ctx.setElDoc(id, patch));
      ctx.history.commit('camera-layout');
    };
    return <>
      <SecHead>摄像头布局</SecHead>
      <S.Picker aria-label="摄像头布局" size="S" selectedKey={layout || 'custom'} onSelectionChange={apply} UNSAFE_className="scv-picker">
        {SV.CAMERA_LAYOUTS.map((l) => <S.PickerItem id={l.k} key={l.k}>{l.label}</S.PickerItem>)}
        {layout ? null : <S.PickerItem id="custom" key="custom">自定义</S.PickerItem>}
      </S.Picker>
      <div className="hint">只想改某一段：先在那一段的两端拆分整组。</div>
    </>;
  }

  /** 「编辑视频」页里录制带来的那几段；不是录制元素时什么都不画。 */
  function ScreenViewSections({ctx, id}) {
    const el = (ctx.elements || []).find((e) => e.id === id);
    if (!el || !el.role) return null;
    if (el.role === 'screen' && el.screenView) return <ScreenSections ctx={ctx} el={el} />;
    if (el.role === 'camera') return <CameraSections ctx={ctx} el={el} />;
    return null;
  }

  Object.assign(window, {ScreenViewSections});
})();
