/* 模板样式的调整页（caption-editor-redesign §9.3）——轨上带着一份模板（`track.scene`）时，
   字幕属性页整页换成这一段。

   这一页**只读场景摘要**（`BC_PACK.summary` → `BC_ADJ.describe`，§6），不碰场景本身：颜色、
   字体、能不能调位置、要不要出「关键词」与「换一版」，全都由摘要说了算。每一笔改的是
   `adjust`（§5，模板正文不动）或字幕实例的 `presentation`（关键词、seed，§11），落笔时
   连同由它们算出来的画法键（`BC_ADJ.toPaint`）一起写回轨上，画布与缩略图照画。

   原型的两处取舍（交付说明里列着）：
     · 一条轨就是一层字幕，所以 `presentation` 记在轨上；
     · 套用不搬字幕的家：模板的落位以套用时轨的锚点为准（记在 `home`），「位置」改的是
       `adjust.placement`，同时写回轨的 y / x / width，「还原」回到 `home`。
   模板不进 cue 级覆盖表（§11），所以这一页没有「仅这一条」。 */
(function () {
  const ADJ = window.BC_ADJ;
  const PACK = window.BC_PACK;

  const USE_NAME = {text: '字色', stroke: '描边', shadow: '阴影', glow: '发光', active: '当前词', read: '念过',
    unread: '未念', keyword: '关键词', plate: '底板', 'word-box': '逐词底块', material: '材质'};
  const LAYER_NAME = {fill: '填充', stroke: '描边', shadow: '阴影', 'inner-shadow': '内阴影', glow: '发光',
    plate: '底板', box: '逐词底块', image: '纹理', material: '材质'};
  const TIER_NAME = {'glyph-motion': '字形动画', 'text-paint': '文字涂装', 'texture-effects': '纹理与特效',
    'derived-decoration': '派生装饰'};
  const PLACE = [{k: 'y', name: '上下位置', base: 86}, {k: 'x', name: '水平位置', base: 50}, {k: 'width', name: '宽度', base: 80}];

  const pct = (s) => Math.round((s || 1) * 100);

  function SubAdjustSection({ctx, track, cue, first, pop, tg, setPop}) {
    const app = useApp();
    const scene = track.scene;
    const adj = track.adjust || null;
    const pres = track.presentation || {};
    const sum = PACK.summary(scene, adj);
    const org = PACK.originState(track.origin);
    const role = track.role === 'source' ? 'source' : 'translation';
    const home = track.home || {};
    const scale = (adj && adj.fontScale) || 1;
    const baseSize = (track.size || 20) / scale;

    /* 一笔：新的调整层 / 实例数据 → 连同画法键与字号一起写回轨上 */
    const put = (nextAdj, nextPres, live, extra) => {
      const p = nextPres === undefined ? track.presentation : nextPres;
      const paint = ADJ.toPaint(scene, nextAdj, {role, presentation: p});
      const s = (nextAdj && nextAdj.fontScale) || 1;
      const patch = Object.assign({}, paint, {adjust: nextAdj, presentation: p || null, size: Math.round(baseSize * s)}, extra || {});
      ctx.setSubTrack(track.id, patch, live ? 'subtitle:' + track.id + ':adjust' : null);
    };
    const keyword = sum.wordTags.indexOf('keyword') >= 0;
    /* `BC_SI` 的选词工具读的是强调设置的形状（`{on, marks}`）；这里只借它的点词逻辑 */
    const marks = {on: true, marks: (pres.wordTags && pres.wordTags.keyword) || {}};
    const placeable = sum.placeable;
    const diag = (k) => placeable.indexOf(k) < 0;

    const restore = () => {
      const before = track;
      const anchor = {};
      PLACE.forEach(({k}) => { if (home[k] !== undefined) anchor[k] = home[k]; });
      put(null, undefined, false, anchor);
      app.toast('已还原成模板原样', 'positive', {label: '撤销', undo: true,
        run: () => { ctx.setSubTrack(track.id, before); app.toast('已撤销还原'); }});
    };

    return (
      <React.Fragment key="adjust">
        <div className={cx('subadj__src', first && 'first')}>
          <span className="subadj__k">模板样式</span>
          <span className="subadj__pk">{org.removed ? '样式包已移除' : '来自「' + (org.pack ? org.pack.name : '样式包') + '」'}</span>
          {org.newer ? <span className="subadj__new">有新版本</span> : null}
        </div>
        {org.removed ? <div className="hint">这份模板已经冻结在这部视频里，照常显示与导出；只是不能再从样式包更新。</div> : null}

        {sum.adjustable.colors ? (
          <>
            <SecHead aside="改一个色块，模板里同一种颜色一起换">颜色</SecHead>
            <div className="sec subadj__colors">
              {sum.colors.map((c) => (
                <PRow key={c.value} label={c.uses.map((u) => USE_NAME[u] || u).join(' · ')}>
                  {c.animated ? <span className="subadj__anim">动画中</span> : null}
                  <ColorField value={c.to} scope="模板颜色" open={pop === 'adj-' + c.value} onToggle={() => tg('adj-' + c.value)}
                    allowsAlpha={c.value.length > 7}
                    onPick={(v, live) => { put(ADJ.withColor(adj, c.value, v), undefined, live); if (!live) setPop(null); }} inline />
                </PRow>
              ))}
            </div>
          </>
        ) : null}

        {sum.adjustable.fonts ? (
          <>
            <SecHead aside="换字体会重新排版">字体</SecHead>
            <div className="sec">
              {sum.fonts.map((f, i) => {
                const cur = f.to ? f.to.family : f.family;
                return (
                  <div key={f.key} className="subadj__font">
                    <PRow label={i === 0 ? '正文' : '第 ' + (i + 1) + ' 款'}>
                      <div className="subadj__fp">
                        <Picker wide value={cur} open={pop === 'adjf-' + f.key} onClick={() => tg('adjf-' + f.key)} />
                        {pop === 'adjf-' + f.key ? <FontPicker inline value={cur}
                          onPick={(n) => { put(ADJ.withFont(adj, f.key, n === f.family ? null : {family: n})); setPop(null); }} /> : null}
                      </div>
                    </PRow>
                    {f.to && f.tunedSpacing ? <div className="hint">这款字体的字距是模板作者手工调过的，换了字体不跟着换，字可能挤或散。</div> : null}
                  </div>
                );
              })}
            </div>
          </>
        ) : null}

        <SecHead aside="文字与装饰一起缩放">大小</SecHead>
        <div className="sec">
          <ValueRow label="字号倍率" value={pct(scale)} min={50} max={200} unit="%"
            onChange={(v) => put(ADJ.withScale(adj, v / 100), undefined, true)} />
        </div>

        <SecHead aside="画面宽高的比例">位置</SecHead>
        <div className="sec">
          {PLACE.map(({k, name, base}) => (diag(k) ? (
            <PRow key={k} label={name}><span className="subadj__off">由模板参数决定，这里调不了</span></PRow>
          ) : (
            <ValueRow key={k} label={name} value={track[k] == null ? base : track[k]} min={k === 'width' ? 30 : 0} max={100} unit="%"
              onChange={(v) => put(ADJ.withPlacement(adj, {[k]: v / 100}), undefined, true, {[k]: v})} />
          )))}
        </div>

        {keyword ? (
          <>
            <SecHead aside="手动点词，只作用于这一层字幕">关键词</SecHead>
            <div className="sec">
              <div className="subprops__words" aria-label="选择关键词">
                {cue ? window.BC_WA.split(ctx.cueText ? ctx.cueText(cue.id) : cue.text).map((word, index) => {
                  const on = window.BC_SI.isMarked(marks, cue.id, word, index);
                  return (
                    <BCAction key={index} className={cx('subprops__word', on && 'is-on')} aria-pressed={on}
                      onClick={() => put(adj, Object.assign({}, pres, {wordTags: Object.assign({}, pres.wordTags,
                        {keyword: window.BC_SI.toggleMark(marks, cue.id, word, index)})}))}>{word}</BCAction>
                  );
                }) : <span className="hint">先将播放头移到一条字幕上。</span>}
              </div>
              <div className="hint">模板读这些词的「关键词」标签，怎么强调由模板决定；不自动挑词。</div>
            </div>
          </>
        ) : null}

        {sum.seeded ? (
          <>
            <SecHead aside="模板里随机的部分换一组">换一版</SecHead>
            <div className="sec subadj__seed">
              <Btn variant="secondary" size="s" onClick={() => put(adj, Object.assign({}, pres, {seed: (pres.seed || 0) + 1}))}>换一版</Btn>
              <span className="subadj__n">第 {(pres.seed || 0) + 1} 版</span>
            </div>
          </>
        ) : null}

        <SecHead aside="只读">构成</SecHead>
        <div className="sec subadj__parts">
          <PRow label="效果层"><span className="subadj__list">{sum.layers.map((l) => LAYER_NAME[l.kind] || l.kind).join(' · ') || '—'}</span></PRow>
          <PRow label="分级"><span className="subadj__list">{sum.tiers.map((t) => TIER_NAME[t] || t).join(' · ') || '—'}</span></PRow>
          <PRow label="逐词时间"><span className="subadj__list">{sum.needsWordTiming ? '要' : '不要'}</span></PRow>
          <div className="hint">模板是一整份场景，里面的结构属性页表达不了，所以只开放上面这几样调整。要逐项改，换一份内置样式。</div>
        </div>

        <div className="savebar">
          <span className="savebar__s">{ADJ.isAdjusted(adj) ? <><strong>已调整</strong> · <BCAction className="sublib__clear" onClick={restore}>还原</BCAction></> : '模板原样'}</span>
          <Btn variant="secondary" size="s" onClick={() => app.toast('已存到品牌库 · 存的是这份模板的出处与你的调整', 'positive')}>
            存到品牌库
          </Btn>
        </div>
      </React.Fragment>
    );
  }

  Object.assign(window, {SubAdjustSection});
})();
