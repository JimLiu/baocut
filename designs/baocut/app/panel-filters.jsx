/* 滤镜面板 —— §13.6（第 84 轮）。
   两个 tab：调色 / 效果；每一款一张缩略图，效果那一侧每条还带强度。

   **这一版做的是分组、词表与交互，不是像素**：真正的调色走 LUT 贴图、效果走着色器
   文件，本仓库两批素材都没有，核心也没有 LUT 这条链路
   （`bcut-timeline` 的 `Fx` 只有 `{grayscale, blur, brightness}`）。所以每一款在这里
   写成一串 CSS filter 近似（`BC_EL.FILTERS` / `BC_EL.EFFECTS`），面板上明说这是近似。
   登记在分歧台账。

   BaoCut 只有一个面板栏，所以这里是**视频属性页的子页**（与「调整」同一层），从 `···` 菜单的「滤镜 / 效果」
   两行开进来，回上一层就是编辑视频那一页。 */
(function () {
  const E = window.BC_EL;

  /* 缩略图上那块**样片**：每一格画的不是你自己的画面，是一块固定的样片
     （同一族三档并排才看得出差别）。本仓库不放照片，用调色板那几个
     基色拼一块彩色样片——调色与效果的差别（偏冷 / 偏暖 / 掉饱和 / 反色）在它上面
     一眼可辨，在 B-roll 那块近黑的渐变上几乎看不出来。
     色值取自 `BC_EL.PALETTE`（那一份本来就是画进画面的填色，不是 S2 表面）。 */
  const P = window.BC_EL.PALETTE;
  const SAMPLE = 'linear-gradient(145deg, ' + P.blue.fill + ' 0%, ' + P.purple.fill + ' 32%, '
    + P.pink.fill + ' 58%, ' + P.orange.fill + ' 82%, ' + P.yellow.fill + ' 100%)';

  /** 一格：缩略图（把这一款真的套在演示画面上）＋ 名字 */
  function Tile({item, on, intensity, onPick}) {
    const css = E.presetCss(item, intensity);
    return (
      <BCAction className={cx('fltile', on && 'is-on')} onClick={onPick}>
        <span className="fltile__img" style={{background: SAMPLE, filter: css || null}}>
          {item.k === 'none' ? <Ic n="ban" className="ic--22" /> : null}
        </span>
        <em>{item.name}</em>
        {on && item.k !== 'none' && intensity != null
          ? <i className="fltile__pct t-mono">{Math.round(intensity * 100)}%</i> : null}
      </BCAction>
    );
  }

  /** 两个 tab 的公共页身。`tab` 与 `setTab` 提上去，是因为 `···` 菜单的两行
      （滤镜 / 效果）开的是**同一张页的不同 tab**，落点得由调用方给。 */
  function FiltersPage({v, set, tab, setTab, onBack}) {
    const isFx = tab === 'effects';
    const list = isFx ? E.EFFECTS : E.FILTERS;
    const cur = isFx ? (v.effect || 'none') : (v.filter || 'none');
    const inten = v.effectI == null ? 1 : v.effectI;
    return (
      <>
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回编辑视频" onClick={onBack} />
          <span className="t-title-sm grow">滤镜</span>
        </div>
        <div className="pscroll bc-scroll">
          <Segmented size="s" value={tab} onChange={setTab}
            items={[{k: 'grading', label: '调色'}, {k: 'effects', label: '效果'}]} />
          <div className="flgrid">
            {list.map((it) => (
              <Tile key={it.k} item={it} on={cur === it.k}
                intensity={isFx ? (it.k === cur ? inten : 1) : null}
                onPick={() => set(isFx ? {effect: it.k} : {filter: it.k})} />
            ))}
          </div>
          {/* 强度只有效果那一侧有——调色的 LUT 是整块换掉，没有一档强度 */}
          {isFx && cur !== 'none' ? (
            <div className="sec" style={{marginTop: 10}}>
              <ValueRow label="强度" value={Math.round(inten * 100)} min={0} max={100} unit="%"
                onChange={(x) => set({effectI: x / 100})} />
            </div>
          ) : null}
          <div className="hint">
            这一版是 CSS filter 近似：真正的调色走 LUT 贴图、效果走着色器，核心的
            <code>Fx</code> 今天只有亮度 / 模糊 / 去色三个字段，两条链路都还没有。
          </div>
        </div>
      </>
    );
  }

  Object.assign(window, {FiltersPage});
})();
