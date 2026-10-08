/* 智能裁剪（§15.9）检查构图：右侧面板这一页只管「这一刻」和「镜头列表」，画面在舞台上
   （stage-crop.jsx）。所有改动都是对构图计划的纯函数编辑（BC_CROP.*），会话记 dirty。 */
(function () {
  const {useMemo} = React;
  const C = window.BC_CROP;

  function CropReviewPanel({ctx, s, onBack}) {
    const app = useApp();
    const proj = ctx.proj.id;
    const plan = s.plan;
    const geom = {srcRatio: C.sourceRatio(s.source), dstRatio: app.crop.ratioValue(s), zoom: s.zoom};
    const t = s.t;
    const dur = s.range.end - s.range.start;
    const dstId = app.crop.ratioIdOf(s);
    const shots = useMemo(() => plan.shots.slice().sort((a, b) => a.start - b.start), [plan.shots]);
    const shot = C.shotAt(plan, t);
    const idx = shot ? shots.findIndex((x) => x.id === shot.id) : -1;
    const flags = useMemo(() => C.flags(plan, geom), [plan, geom.dstRatio, geom.zoom]);
    const kf = C.keyframeAt(plan, t);
    const sum = C.summary(plan);
    const edit = (fn) => app.crop.editPlan(proj, fn);
    const seek = (x) => app.crop.seek(proj, x);
    const persons = plan.subjects.filter((p) => p.kind === 'person');
    const follows = plan.subjects.map((sub) => ({k: sub.id, label: sub.name}))
      .concat(persons.length > 1 ? [{k: 'split', label: '同框'}] : []).concat([{k: 'manual', label: '手动'}]);
    const manualHere = shot ? C.manualCount(plan, shot.id) : 0;
    const restart = () => app.confirm({title: '重新分析？', body: '会回到设置页，这份构图和手动关键帧都会丢掉。', tone: 'negative', confirmLabel: '重新分析',
      run: () => app.crop.restart(proj)});

    return (
      <div className="pscroll bc-scroll">
        <div className="flowh"><IconBtn icon="back" size="s" tip="返回" onClick={onBack} /><b>智能裁剪</b><Chip tone="info">检查构图</Chip></div>
        <div className="aicard">
          <b>{C.summaryText(plan, dur)}</b>
          <span>{Object.keys(sum.follows).map((k) => `${C.followName(plan, k)} ${sum.follows[k]}`).join(' · ')}
            {s.editing ? ` · 在第 ${s.version} 版的构图上改` : ''}{sum.manual ? ` · ${sum.manual} 个手动关键帧` : ''}</span>
          <span>看一遍成片预览，不对的地方点镜头改「跟着谁」，或直接拖左边的取景框。满意就生成。</span>
        </div>
        {flags.length ? (
          <div className="aicard aicard--warn">
            <b>{flags.length} 处建议看一眼</b>
            {flags.map((f, i) => <BCAction key={i} className="cr-flag" onClick={() => seek(f.t + 0.05)}><span className="t-mono">{C.mmss(f.t)}</span><span>{f.text}</span><NavChevron /></BCAction>)}
          </div>
        ) : null}

        <SecHead aside={C.mmss(t)}>这一刻</SecHead>
        {shot ? (
          <div className="sec cr-cur">
            <div className="cr-cur__hd"><b>镜头 {idx + 1}</b><span className="t-mono t-detail">{C.mmss(shot.start)} – {C.mmss(shot.end)}</span>
              {shot.reason && !shot.edited ? <Chip tone="neutral">{shot.reason}</Chip> : shot.edited ? <Chip tone="info">改过</Chip> : null}</div>
            <PRow label="跟着">
              <Segmented value={shot.follow} items={follows} onChange={key => edit(p => C.setShotFollow(p, shot.id, key))} />
            </PRow>
            <PRow label="运动">
              <Segmented size="s" value={shot.motion} onChange={(v) => edit((p) => C.setShotMotion(p, shot.id, v))} items={C.MOTIONS.map((m) => ({k: m.id, label: m.name}))} />
            </PRow>
            <div className="cr-kfline">
              {kf ? <>
                <Ic n="star" className="ic--14" style={{color: 'var(--gray-900)'}} />
                <span className="grow">这一刻有手动关键帧 · 中心 {Math.round(kf.cx * 100)}%, {Math.round(kf.cy * 100)}%</span>
                <Btn variant="quiet" size="s" onClick={() => edit((p) => C.removeKeyframe(p, t))}>删除</Btn>
              </> : <>
                <Ic n="info" className="ic--14" style={{color: 'var(--gray-600)'}} />
                <span className="grow">拖左边的取景框就会在这一刻记下关键帧</span>
                <Btn variant="quiet" size="s" onClick={() => edit((p) => C.setKeyframe(p, t, {}))}>在这里记一帧</Btn>
              </>}
            </div>
            {kf ? (
              <PRow label="松紧">
                {/* 关键帧上的 zoom 是叠在整段「取景松紧」之上的倍数，这里给用户看的是实际放大量。 */}
                <Slider value={Math.round(s.zoom * (kf.zoom || 1) * 100)} min={100} max={150} step={5} onChange={(v) => edit((p) => C.setKeyframe(p, t, {zoom: v / 100 / s.zoom}))} />
                <span className="t-detail cr-num">{s.zoom * (kf.zoom || 1) <= 1.001 ? '不放大' : `放大 ${Math.round((s.zoom * (kf.zoom || 1) - 1) * 100)}%`}</span>
              </PRow>
            ) : null}
            <div className="cr-acts">
              <Btn variant="secondary" size="s" icon="split" onClick={() => edit((p) => C.splitShot(p, t))}>在这里切一刀</Btn>
              {idx < shots.length - 1 ? <Btn variant="quiet" size="s" onClick={() => edit((p) => C.mergeWithNext(p, shot.id))}>与下一段合并</Btn> : null}
              {manualHere ? <Btn variant="quiet" size="s" onClick={() => edit((p) => C.resetShot(p, shot.id))}>清掉 {manualHere} 个手动帧</Btn> : null}
            </div>
          </div>
        ) : null}

        <SecHead aside={`${shots.length} 个`}>镜头</SecHead>
        <div className="sec cr-shots" role="list">
          {shots.map((sh, i) => {
            const flag = flags.find((f) => f.shot === sh.id);
            const mc = C.manualCount(plan, sh.id);
            return (
              <BCAction key={sh.id} role="listitem" className={cx('cr-shotrow', shot && shot.id === sh.id && 'is-cur')} onClick={() => seek(sh.start + 0.05)}>
                <span className="cr-shotrow__n">{i + 1}</span>
                <span className="cr-shotrow__t"><b>{C.followName(plan, sh.follow)}</b><span className="t-mono">{C.mmss(sh.start)} – {C.mmss(sh.end)}{sh.motion === 'cut' ? ' · 定点' : ''}{mc ? ` · 手动 ${mc}` : ''}</span></span>
                {flag ? <Ic n="alert" className="ic--14" style={{color: 'var(--orange-900)'}} title={flag.text} /> : null}
              </BCAction>
            );
          })}
        </div>

        <div className="flowcta">
          <Btn variant="accent" style={{width: '100%'}} onClick={() => app.crop.render(proj)}>
            {s.editing ? `生成第 ${(s.version || 1) + 1} 版` : `生成 ${dstId} 视频`}
          </Btn>
        </div>
        <div className="hint">生成一份新素材放进 Video，原片不动。之后可以一步替换时间轴上用这段原片的视频。</div>
        <div className="cr-foot">
          {s.editing ? <Btn variant="quiet" size="s" onClick={() => app.crop.discard(proj)}>放弃改动</Btn> : null}
          <Btn variant="quiet" size="s" onClick={restart}>重新分析</Btn>
        </div>
      </div>
    );
  }

  Object.assign(window, {CropReviewPanel});
})();
