/* 时间轴块的右键菜单 —— 第 115 轮（§7）。
   ============================================================================
   此前时间轴上没有任何右键入口：删一个元素得先选中、再把手挪到右栏页脚那颗垃圾桶，
   或者记得 Delete 键。这一份把 §4 的剪贴板动作摆到块自己身上，走的是同一份
   `ctx.clipboard`（同一条历史、同一批 toast），不另起一套写路径。

   控件不新造：`Popover` + `Menu` + `MenuItem`（`suffix` 那个槽本来就是给快捷键字形的）。
   定位与字幕行头菜单同一招——`.tlbody` 是滚动区，浮层挂在里面会被裁成一条缝，所以
   菜单由 `TimelineView` 在 `.tl` 根上用一个 `position: fixed` 的 0 尺寸锚渲染，锚点
   就是鼠标那一点。

   视频元素另外多一条「在播放头分割」（2026-09-16 起切的是视频元素本身，没有主轨），
   播放头不在这一件里时是 disabled。
   ============================================================================ */
(function () {
  const TL = window.BC_TL;

  function TimelineBlockMenu({ctx, at, onClose}) {
    if (!at) return null;
    const cb = ctx.clipboard || {};
    const run = (fn) => () => { onClose(); if (fn) fn(); };
    const el = (ctx.elements || []).find((e) => e.id === at.id);
    const isVideo = !!(el && el.kind === 'video');
    const canSplit = isVideo && !!window.BC_VIDEO_EDIT.splitElementAt(ctx.elements, ctx.elDocs, at.id, ctx.playT);
    /* 停用位（第 120 轮）：元素块上也给一条，与行头那只眼睛写同一个字 */
    const off = !!((ctx.elDocs || {})[at.id] || {}).hidden;
    return (
      <div className="tl__popanchor" style={{left: at.x, top: at.y, width: 0, height: 0}}>
        <Popover open onClose={onClose} align="left" dir="up" width={210}>
          <Menu>
            <MenuHead>{at.name}</MenuHead>
            {isVideo ? (
              <>
                <MenuItem icon="split" label="在播放头分割" suffix="S" disabled={!canSplit}
                  sub={canSplit ? null : '播放头不在这一段里'} onClick={run(() => ctx.split(at.id))} />
                <MenuRule />
              </>
            ) : null}
            <MenuItem icon="copy" label="复制" suffix="⌘C" onClick={run(cb.copy)} />
            <MenuItem icon="split" label="剪切" suffix="⌘X" onClick={run(cb.cut)} />
            <MenuItem icon="attach" label="粘贴" suffix="⌘V" onClick={run(cb.paste)} />
            <MenuItem icon="layers" label="再制" suffix="⌘D" onClick={run(cb.duplicate)} />
            <MenuRule />
            <MenuItem icon={off ? 'eye' : 'eyeoff'} label={off ? '启用这条轨' : '停用这条轨'}
              sub={off ? '回到画面与导出里' : '留在时间轴上 · 画面与导出都跳过'}
              onClick={run(() => ctx.setLaneOn({kind: 'el', id: at.id}, off))} /><MenuRule />
            <MenuItem icon="trash" label="删除" suffix="⌫" tone="negative"
              onClick={run(cb.remove)} />
          </Menu>
        </Popover>
      </div>
    );
  }

  Object.assign(window, {TimelineBlockMenu});
})();
