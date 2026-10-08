/* 时间轴配乐轨（剧情短片 §5.5，2026-09-24）。
   动画项目的配乐由 `bcut score render` 按总线拆成几路 stem，一路一条手动轨 `score:<bus>`
   （音乐 / 环境声 / 音效）。这一份画三样东西，算的都在 `model-score.js`：

     · 行头：音符图标 ＋ 总线短名牌子（`.tlang`，与配音行的语言牌同一枚）＋ 过期时一颗黄点
       （改过哪几个输入进 tip）＋ 喇叭 ＋ ⋯。喇叭只在时间轴上关掉这一路——**不写回动画稿**，
       这句话挂在喇叭 tip 与菜单里（台账 2026-09-24-233210）。
     · 轨菜单（⋯）：启用 / 停用、「重新生成这一路」「重新生成全部配乐」、静音说明。
       重新生成是起任务的入口，按 §22.4 只有 App 有：整个 ⋯ 用 `BC_SURFACE.ai` 包住，
       Web 行头只剩牌子、黄点与喇叭（台账 2026-09-24-233220）。
     · `useScoreStore`：编辑器里的配乐轨表、停用位与「正在重新生成」那一条。演示里重新生成
       约 2.4 秒后落定、清掉对应的过期位；真机上是 Runtime 的 `Command::ScoreRender`
       （等价 `bcut score render --only <bus>`），跑的时候别的音频任务得等。 */
(function () {
  const {useState, useRef, useEffect, useCallback} = React;
  const SC = window.BC_SCORE;
  const DEMO_MS = 2400;

  function useScoreStore({app, initial}) {
    const [score, setScore] = useState(initial || []);
    const [scoreOff, setScoreOff] = useState({});
    const [scoreJob, setScoreJob] = useState(null);     // {bus|null}：正在重新生成的那一路（null = 全部）
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const regenScore = useCallback((bus) => {
      if (scoreJob) { app.toast(SC.BUSY_SUB); return; }
      const one = bus != null;
      setScoreJob({bus: one ? bus : null});
      app.toast(one ? '正在重新生成' + SC.laneName(bus) + '…' : '正在重新生成全部配乐…');
      timer.current = setTimeout(() => {
        setScore((cur) => SC.markFresh(cur, one ? bus : null));
        setScoreJob(null);
        app.toast(one ? SC.laneName(bus) + '已重新生成' : '全部配乐已重新生成', 'positive');
      }, DEMO_MS);
    }, [app, scoreJob]);
    return {score, scoreOff, setScoreOff, scoreJob, regenScore};
  }

  /** 行头：音符 ＋ 总线牌子 ＋ 过期点 ＋ 喇叭 ＋ ⋯（⋯ 只有 App 有） */
  function ScoreHead({row, ctx, open, onOpen}) {
    const t = row.score || {bus: row.bus};
    const tip = SC.staleTip(t);
    return (
      <>
        <Ic n="audio" className="ic--14" />
        <span className="thd__label" title={SC.headTip(t)}>{row.label}</span>
        {tip ? <i className="thd__stale" title={tip} /> : null}
        <window.LaneToggle row={row} ctx={ctx} className="thd__tog" />
        {window.BC_SURFACE.ai ? (
          <IconBtn icon="more" size="xs" className="thd__more" on={open}
            tip={'「' + row.label + '」这条轨'}
            onClick={(e) => {
              e.stopPropagation();
              if (open) { onOpen(null); return; }
              const r = e.currentTarget.closest('.trow__hd').getBoundingClientRect();
              onOpen({bus: row.bus, x: r.left, y: r.top, w: r.width, h: r.height});
            }} />
        ) : null}
      </>
    );
  }

  function ScoreHeadMenu({ctx, at, onClose}) {
    const t = at && (ctx.score || []).find((x) => x.bus === at.bus);
    if (!t) return null;
    const busy = !!ctx.scoreJob;
    const off = !!(ctx.scoreOff || {})[t.bus];
    const stale = SC.staleCount(ctx.score);
    return (
      <div className="tl__popanchor" style={{left: at.x, top: at.y, width: at.w, height: at.h}}>
        <Popover open onClose={onClose} align="left" dir="up" width={260}>
          <Menu>
            <MenuHead>{SC.laneName(t.bus)}</MenuHead>
            <MenuItem icon={off ? 'vol2' : 'vol0'} label={off ? '启用这一路' : '停用这一路'}
              sub={off ? '回到播放与导出里' : '留在时间轴上 · 播放与导出都跳过'}
              onClick={() => { onClose(); ctx.setLaneOn({kind: 'score', id: t.bus}, off); }} />
            <MenuRule />
            <MenuItem icon="refresh" label="重新生成这一路" disabled={busy} sub={SC.regenSub(t, busy)}
              onClick={() => { onClose(); ctx.regenScore(t.bus); }} />
            <MenuItem icon="refresh" label="重新生成全部配乐" disabled={busy}
              sub={busy ? SC.BUSY_SUB : stale ? stale + ' 路已过期 · 按总谱全部重渲' : '全部已是最新 · 按总谱全部重渲'}
              onClick={() => { onClose(); ctx.regenScore(null); }} />
            <MenuRule />
            <MenuItem icon="info" label="静音不改动画稿" wrap disabled
              sub="只在时间轴上关掉这一路；要从作品里去掉，请让 Agent 改稿" />
          </Menu>
        </Popover>
      </div>
    );
  }

  Object.assign(window, {useScoreStore, ScoreHead, ScoreHeadMenu});
})();
