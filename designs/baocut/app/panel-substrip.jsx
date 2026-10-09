/* 字幕 Tab 主页顶上那一块：**当前样式入口卡 ＋ 画面上的字幕轨条**（第 151 轮；第 152 轮
   起翻译 Tab 并入字幕 Tab，轨条也接过了语言入口下拉的全部四组东西——见下面 SubTrackStrip）。

   两个 Tab 此前把样式藏在面板头右侧一个 Style/Edit 分段控件里：默认落 Edit（校对是
   每天的活，第 31 轮），于是「换个样子」要先认出那个只有两个英文词的小开关。用户
   在两处试错：① 找不到样式在哪；② 找到之后，字幕 Tab 的画廊只画一行、翻译 Tab 的
   画廊画两行——缩略图在许诺一件套上去不会发生的事（第 108 轮起样式卡不动轨集），
   于是推断「套翻译样式会多一条译文、套字幕样式会少一条」。

   这一轮把两件事摊在主页最上面、一眼可见：

     · **入口卡**画的是**当下**套在**当下这几条轨**上的样子（与画廊缩略图同一段代码），
       整张卡直接进入属性编辑（product-design §5.1）；使用统一导航箭头。与第 150 轮
       动画入口卡同一种形状——用户已经认得这种「预览 ＋ 换一个 ›」的卡。
     · **轨条**列 timeline 上的每一条字幕轨（＝画面上有哪几条），停用的带闭眼；
       拿下来的那几门是虚线幽灵 chip，点它放回。它是 §16.1 那两条写路径的第三个入口
       （同一个 `useSubTrackOps`，同一句软上限确认），不是新的写路径。

   画廊页头下面也摆同一条轨条：卡片画的就是这几条，想多一条或少一条，改的是这里，
   不是换一张卡。

   第 152 轮：轨条是**唯一的语言选择器**。此前面板头的语言下拉分四组（画面上 / 已拿下 /
   正在翻 / 翻译成…），轨条只画前两组，于是同一件事有两个入口、两种形态；现在四组都在
   轨条上：正在翻的那门是一枚带进度的 chip（可选中，看进度），「＋ 翻译成…」去 AI 工具。
   第 153 轮起列表**不再**从这里的选中反推形态——它有自己的对照条（panel-subtitle.jsx
   的 ListBar）；这里的选中只管样式作用域，唯一的耦合是选中译文轨会把对照语言切成它。 */
(function () {
  const S = window.BC_SUB;
  const D = window.BC_DATA;

  /** 一条轨的 chip：点名字选中它（作用域），尾部的 × 把它从画面上拿下。
   *  `<button>` 不能套 `<button>`，所以外层是 span，两个动作各自一颗钮。 */
  function TrackChip({t, on, last, run, onPick, onDrop}) {
    /* 这条轨正在被重翻（第 207 轮）：chip 尾巴挂呼吸点 + 百分比。轨还在画面上、
       列表照旧能看——进度只是提醒「这一门马上会被新译文替掉」。 */
    const rerun = run && run.target === t.id ? run : null;
    return (
      <span className={cx('subtrk', on && 'is-on', t.hidden && 'subtrk--off', rerun && 'subtrk--rerun')}>
        <BCAction className="subtrk__n" onClick={onPick}
          title={rerun ? (rerun.status === 'queued' ? '排队中 · 等着重新翻译' : '正在重新翻译 · ' + Math.round(rerun.pct) + '%')
            : t.hidden ? '已停用 · 时间轴行头能启用' : '改这一条的样式' + (t.role === 'translation' ? ' · 列表也对照到它' : '')}>
          {t.hidden ? <Ic n="eyeoff" className="ic--14" /> : null}
          {S.label(t)}
          {rerun ? <span className="subtrk__run"><i className="livehd__dot" /><span className="t-mono">{Math.round(rerun.pct)}%</span></span> : null}
        </BCAction>
        {last ? null : (
          <BCAction className="subtrk__x" onClick={onDrop} aria-label={'把「' + t.name + '」从画面上拿下'}
            title="从画面上拿下 · 不删数据">
            <Ic n="close" className="ic--14" />
          </BCAction>
        )}
      </span>
    );
  }

  /** 画面上的字幕轨条。`ops` 是调用方那份 `useSubTrackOps`（软上限对话框挂在调用方
   *  树里，不在这里再开一份）。`sel` 高亮的是当下的编辑对象——与画布、属性页顶部那排
   *  chip、语言入口写的是同一个字段（`sel.trackId`）。 */
  function SubTrackStrip({ctx, ops, editId}) {
    const app = useApp();
    const st = ctx.subStyle;
    const list = S.tracks(st);
    const shelved = ctx.availableSubTracks();
    /* 选中带 trackId 的都算（轨条 chip、画布、时间轴 cue 块）——样式作用域照它走 */
    const selId = (ctx.sel && ctx.sel.trackId) || editId;
    const order = S.stackOrder(st);
    const run = ctx.transJob;
    const running = run && run.target && !S.byId(st, run.target)
      ? (D.transLangs.find((l) => l.code === run.target) || {code: run.target, name: run.target}) : null;
    const flipIt = () => {
      const before = st;
      ctx.setSubStyle({tracks: S.flipStack(st)});
      app.toast('已倒转 · 现在' + (order === 'srcTop' ? '译文在上、原文在下' : '原文在上、译文在下'),
        'positive', {label: '撤销', undo: true, run: () => {
          ctx.restoreSubStyle(before); app.toast('已撤销倒转');
        }});
    };
    return (
      <div className="substrip">
        <span className="substrip__k">画面上</span>
        {list.map((t) => (
          <TrackChip key={t.id} t={t} on={t.id === selId} last={list.length < 2} run={run}
            onPick={() => ctx.pickSub(t.id)} onDrop={() => ops.drop(t.id)} />
        ))}
        {shelved.map((t) => (
          <BCAction key={t.id} className="subtrk subtrk--ghost" onClick={() => ops.put(t)}
            title={'把「' + t.name + '」放回画面' + (list.length >= 2 ? ' · 第三条会问一次' : '')}>
            <Ic n="plus" className="ic--14" />{S.label(t)}
          </BCAction>
        ))}
        {/* 正在翻、还没落轨的那门语言：选中它看进度（列表换成翻译中那一屏） */}
        {running ? (
          <BCAction className={cx('subtrk', 'subtrk--ghost', 'subtrk--run', running.code === selId && 'is-on')}
            onClick={() => ctx.pickSub(running.code)} title="正在翻译 · 点开看进度">
            <Ic n="translate" className="ic--14" />翻译中 {run.pct}% · {running.name}
          </BCAction>
        ) : null}
        {/* 去 AI 工具开一门新语言——翻译是 AI 工具的一项，这里只是它的入口（第 109 轮起执行方式在那边选） */}
        {window.BC_SURFACE.ai ? <BCAction className="subtrk subtrk--ghost" onClick={() => ctx.requestAi('translate', null)}
          title="翻译成另一门语言">
          <Ic n="plus" className="ic--14" />翻译成…
        </BCAction> : null}
        {order ? (
          <BCAction className="stlink substrip__flip" onClick={flipIt}
            title="倒转两行的上下——在上那行是主行，字更大">倒转 ⇅</BCAction>
        ) : null}
      </div>
    );
  }

  /** 主页顶上的样式入口卡：预览 ＝ 当下这张卡画在当下这几条轨上。`noCard` 只留轨条
   *  （正在翻这一门时，这一屏的主角是进度）。名字按轨记（第 152 轮「套到」之后各轨可以
   *  勾在不同的卡上）：全部同一张印一个名字，混搭印「Ali · Kitty」。 */
  function SubStyleEntry({ctx, ops, editId, noCard}) {
    const st = ctx.subStyle;
    // 与画廊同一份陈列（`BC_CS.galleryCards`，不按家族别名折叠），勾哪张卡按家族精确比
    const catalog = React.useMemo(() => window.BC_CS.galleryCards(D.subtitle.catalog), []);
    const cur = S.currentCard(st, catalog, true) || S.currentCard(st, D.brand.subStyles, true);
    const name = S.styleNames(st, [catalog, D.brand.subStyles]).join(' · ');
    /* 预览画的是**轨上现在的涂装**，不是那张卡的目录涂装：属性页改过字色之后，
       入口卡要跟着变——否则它在说「你套的是 X」而画面上早已不是 X。所以 look 取轨
       自己的那一份（`S.line` 读出来的就是涂装对象，`SubThumb` 认 look 对象与 look 键）。 */
    const p = {look: cur ? cur.look : 'casper', anim: 'none'};
    const rows = S.screenRows(st, p, D.subtitle.specimen.main)
      .map(([role, look, lang, id]) => [role, id ? S.line(st, id) : look, lang]);
    const src = S.source(st);
    const anim = (src && !src.hidden && src.wordAnim) || 'none';
    const n = S.tracks(st).filter((t) => !t.hidden).length;
    return (
      <div className="substyle-home">
        {noCard ? null : ctx.subsOn ? (
          <BCAction className="substyle-entry" aria-label="编辑字幕样式" onClick={() => ctx.setPaneView('subprops')}>
            <span className="substyle-entry__preview">
              <window.SubThumb p={Object.assign({}, p, {anim}, src && src.activeWord
                ? {activeWord: src.activeWord, motion: src.motion || null} : null)} rows={rows} fz={10} />
            </span>
            <span className="substyle-entry__copy">
              <strong>{cur ? cur.name : name}</strong>
              <span>编辑样式{n ? ' · 画面上 ' + n + ' 条字幕轨' : ''}</span>
            </span>
            <NavChevron className="substyle-entry__chev" />
          </BCAction>
        ) : (
          <div className="subhid">
            <Ic n="captions" className="ic--16" />
            <span className="grow">字幕已隐藏 · 画面上不显示</span>
            <Btn variant="secondary" size="s" onClick={() => ctx.setSubsOn(true)}>显示</Btn>
          </div>
        )}
        <SubTrackStrip ctx={ctx} ops={ops} editId={editId} />
      </div>
    );
  }

  Object.assign(window, {SubStyleEntry, SubTrackStrip});
})();
