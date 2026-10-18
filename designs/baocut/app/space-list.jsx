/* Space 的列表区（2026-10-01，product-design §4.3–§4.4）—— 只在 App 入口加载，控件用 react-spectrum S2。
   网格是 React Aria GridList + S2 Card，列表是 TableView（七列：名称 / 时长 / 类型 / 来源 / 规格 / 状态 / 最近活动）。
   有时长的条目（视频、成片、音频）时长是首要事实（§4.3）：卡片预览右下角压一枚时长角标，列表里「时长」紧跟名称；
   分辨率、文件大小、句数这些次要事实归「规格」，卡片的描述行写「类型 · 规格」。
   列表的名称列和卡片一样先放缩略图（ItemPreview 的 small 档，§4.3），行高因此用 spacious 密度。
   网格按可用宽度自然降为一列；TableView 继续虚拟化。外框给定高，各自负责滚动。
   条目是 BC_SPACE.items 投影出来的；这里只画，动作回调给 page-space.jsx。
   「全部」与「视频」里一部视频只有一张卡（BC_SPACE.group）：它导出、生成的文件收在卡上的「N 个文件」里，
   视频自己没有状态时，状态灯替这些文件里最该被看见的那个说话（生成中 / 失败 / 缺失 / 来源已变）。
   语义索引的标志（2026-10-13 待确认，BC_SPACE_INDEX）：卡片缩略图左上角、列表名称后面各一枚，悬停说明写各通道；
   右键与 ⋯ 是同一份菜单，能重建的条目多一项「重新索引」。 */
(function () {
  const SP = window.BC_SPACE;

  /* 状态色调 → S2 StatusLight */
  const LIGHT = {informative: 'informative', notice: 'notice', positive: 'positive', negative: 'negative'};

  /** 最近活动：收了文件的视频取它和文件里最近的一次。 */
  const activity = (it) => (it.activity != null ? it.activity : it.mtime);

  /** 条目 → 语义索引状态（BC_SPACE_INDEX.entryState）；读设置 › 语义索引的演示状态，没装模型时都是 null。
      GridList / TableBody 按 items 缓存渲染过的条目，语义状态要放进 `dependencies` 才会重画标志。 */
  function useSpaceIndex() {
    const app = useApp();
    const [st, sem] = window.BC_SEMSTATE.useSemantic();
    const X = window.BC_SPACE_INDEX;
    const SEM = window.BC_DATA.semantic;
    const visual = st.install === 'full' && st.visual;
    const paused = !!window.BC_SEMANTIC.pauseReasonOf(st);
    return (it) => {
      const mv = it && it.movie ? app.projById(it.movie) : null;
      const d = it && it.dir ? (app.dirs || []).find((x) => x.id === it.dir) : null;
      return X.entryState(it, {sem, visual, paused, demo: SEM.entries, requeued: st.requeued, movieName: mv ? mv.title : null,
        noIndex: st.noIndex, excluded: st.excluded, dirName: d ? d.name : null});
    };
  }

  /** 查看框里的语义索引状态：图标（在建时转圈）+ 悬停说明；`withText` 时后面跟状态文字。 */
  function IndexMark({s, className, withText}) {
    const R = window.RSP;
    if (!s || (!withText && s.k === 'empty')) return null;
    const title = window.BC_SPACE_INDEX.stateTitle(s);
    const Icon = s.icon ? R.Icons[s.icon] : null;
    return (
      <span className={cx('sp-idx', `sp-idx--${s.tone}`, className)} title={title} role="img" aria-label={title}>
        {Icon ? <Icon /> : <R.ProgressCircle size="S" isIndeterminate aria-label={s.label} UNSAFE_className="sp-idx__spin" />}
        {withText ? <span className="sp-idx__t">{s.label}{s.pct != null ? ` ${s.pct}%` : ''}</span> : null}
      </span>
    );
  }

  /** 状态：灯 + 字。视频自己没有状态时看名下的文件（filesAttention）；都没有时列表里写一道横线，卡片上写最近活动（`quiet`）。 */
  function ItemStatus({it, quiet}) {
    const R = window.RSP;
    const s = it.status ? SP.STATUS[it.status] : null;
    const att = s ? null : SP.filesAttention(it);
    if (att) return <R.StatusLight size="S" variant={LIGHT[SP.STATUS[att.status].tone] || 'neutral'}>{att.text}</R.StatusLight>;
    if (!s) return quiet ? <span className="sp-muted">{SP.agoText(activity(it))}</span> : <span className="sp-muted">—</span>;
    return <R.StatusLight size="S" variant={LIGHT[s.tone] || 'neutral'}>{SP.statusText(it)}</R.StatusLight>;
  }

  /** 卡片上的「N 个文件」：点开是这部视频的查看框，文件逐个列在里面。 */
  function FilesButton({it, onAct}) {
    const R = window.RSP;
    const n = (it.files || []).length;
    if (!n) return null;
    return (
      <R.ActionButton size="S" isQuiet UNSAFE_className="sp-files" onPress={() => onAct('view', it)}
        aria-label={`${n} 个文件：${SP.filesSummary(it)}`}>
        <R.Icons.Layers /><R.Text>{n} 个文件</R.Text>
      </R.ActionButton>
    );
  }

  /** 预览块：视频用编辑器同款的封面（Thumb）；文档与字幕使用实际正文摘要；没有预览文件的条目保留类型占位。
      `big` 是查看框里的大图，`small` 是列表行里的缩略图：小到放不下正文与「找不到文件」的角标，
      文档只留纸面和类型图标，缺失只靠 is-missing 的灰底，文字改由 aria-label 说。 */
  function ItemPreview({it, movie, big, small}) {
    const R = window.RSP;
    const size = big ? 'sp-prev--big' : small ? 'sp-prev--small' : null;
    const missing = it.status === 'missing';
    const Icon = R.Icons[SP.KINDS[it.kind].icon];
    if (it.kind === 'movie' && movie) {
      return <window.Thumb p={movie} className={cx('sp-prev', size)} />;
    }
    if ((it.kind === 'doc' || it.kind === 'subtitle') && it.text && !missing) {
      if (small) {
        return <div className={cx('sp-prev', 'sp-prev--document', size)} aria-hidden="true">
          <div className="sp-prev__paper"><Icon /></div>
        </div>;
      }
      return <div className={cx('sp-prev', 'sp-prev--document', size)}>
        <div className="sp-prev__paper" aria-hidden="true"><pre>{it.text}</pre></div>
        <span className="sp-prev__doctype">{SP.KINDS[it.kind].label}</span>
      </div>;
    }
    /* 幻灯片（docs/design/slides §7.3）：第一页；列表行里的小图放不下，留类型图标 */
    if (it.kind === 'slides' && it.slides?.length && !missing && !small && window.SlideFace) {
      return <div className={cx('sp-prev', 'sp-prev--slides', size)}><window.SlideFace slide={it.slides[0]} label={`${it.name}的第一页`} /></div>;
    }
    /* 设计稿（docs/design/canvas §7.3）：整张画布；列表行里同样留类型图标 */
    if (it.kind === 'design' && it.boards?.length && !missing && !small && window.DesignCanvasView) {
      return <div className={cx('sp-prev', 'sp-prev--design', size)}><window.DesignCanvasView canvas={it} pad={12} label={`${it.name}的画布`} /></div>;
    }
    /* 设计系统（docs/design/canvas §10.6）：封面缩成一张卡；列表行里同样留类型图标 */
    if (it.kind === 'design-system' && !missing && !small && window.DesignSystemFace) {
      return <div className={cx('sp-prev', 'sp-prev--design-system', size)}><window.DesignSystemFace system={it} label={`设计系统「${it.name}」的封面`} /></div>;
    }
    /* 协作文档（docs/design/docs §6）：纸面上印第一个标签页的开头；列表行里同文档一样只留纸面和类型图标 */
    if (it.kind === 'docs' && it.tabs?.length && !missing && window.DocsFace) {
      if (small) {
        return <div className={cx('sp-prev', 'sp-prev--document', size)} aria-hidden="true">
          <div className="sp-prev__paper"><Icon /></div>
        </div>;
      }
      return <div className={cx('sp-prev', 'sp-prev--document', size)}>
        <div className="sp-prev__paper" aria-hidden="true"><window.DocsFace doc={it} /></div>
        <span className="sp-prev__doctype">{SP.KINDS[it.kind].label}</span>
      </div>;
    }
    if (it.kind === 'image' && it.art) {
      /* 列表行里名字就在旁边，缩略图不再重复读一遍 */
      const a11y = small ? {'aria-hidden': true} : {role: 'img', 'aria-label': it.name};
      return <div className={cx('sp-prev', size)} {...a11y} style={{background: it.art}} />;
    }
    const hue = it.hue == null ? 220 : it.hue;
    return (
      <div className={cx('sp-prev', 'sp-prev--kind', size, missing && 'is-missing')}
        style={{'--sp-hue': hue}} {...(small && missing ? {role: 'img', 'aria-label': '找不到文件'} : {})}>
        <Icon />
        {missing && !small ? <span className="sp-prev__flag">找不到文件</span> : null}
      </div>
    );
  }

  /** 视频的转录动作（§4.4）：失败的排在最前；回收站里的不给（先恢复）；Web 没有 AI 入口。 */
  function transcribeItem(R, it) {
    const k = it.kind === 'movie' && !it.trashed && window.BC_SURFACE.ai ? it.transcribe : null;
    if (!k) return null;
    const label = SP.TRANSCRIBE[k].label;
    return <R.MenuItem key="transcribe" id="transcribe" textValue={label.replace('…', '')}><R.Icons.Redo /><R.Text>{label}</R.Text></R.MenuItem>;
  }

  /** 条目菜单的各项（⋯ 与右键共用一份）。`idx`：这一条的语义索引状态，能重建时多一项「重新索引」。 */
  function menuItems(R, it, idx) {
    const tx = transcribeItem(R, it);
    const infoLabel = (it.files || []).length ? '查看信息与文件' : '查看信息';
    /* 只有快照的视频目录打开时就地重建（视频格式规范 §9.7），菜单与查看器的主按钮同一个说法 */
    const openLabel = it.status === 'rebuild' ? '重建并打开' : '打开视频';
    const items = [
      it.transcribe === 'retry' ? tx : null,
      it.kind === 'movie' && !it.lib
        ? <R.MenuItem key="open" id="open" textValue={openLabel}><R.Icons.OpenIn /><R.Text>{openLabel}</R.Text></R.MenuItem>
        : <R.MenuItem key="view" id="view" textValue="查看"><R.Icons.Preview /><R.Text>查看</R.Text></R.MenuItem>,
      it.kind === 'movie' && !it.lib
        ? <R.MenuItem key="view" id="view" textValue={infoLabel}><R.Icons.InfoCircle /><R.Text>{infoLabel}</R.Text></R.MenuItem>
        : null,
      it.transcribe === 'retry' ? null : tx,
      it.status === 'generating' && window.BC_SURFACE.pages
        ? <R.MenuItem key="task" id="task" textValue="查看任务"><R.Icons.Clock /><R.Text>查看任务</R.Text></R.MenuItem> : null,
      idx && idx.canReindex
        ? <R.MenuItem key="reindex" id="reindex" textValue="重新索引"><R.Icons.Refresh /><R.Text>重新索引</R.Text>
          <R.Text slot="description">{idx.k === 'failed' ? '再试一次，排到最前' : '丢掉这一条的索引，排到最前重建'}</R.Text></R.MenuItem> : null,
      idx && idx.canExclude
        ? <R.MenuItem key="noindex" id="noindex" textValue="不索引"><R.Icons.StopProcessing /><R.Text>不索引</R.Text>
          <R.Text slot="description">删掉这一条的索引，以后也不建；只能按字面找到</R.Text></R.MenuItem> : null,
      idx && idx.canInclude
        ? <R.MenuItem key="include" id="include" textValue="恢复索引"><R.Icons.Refresh /><R.Text>恢复索引</R.Text>
          <R.Text slot="description">排回索引队列，按讲话内容与画面建</R.Text></R.MenuItem> : null,
      <R.MenuItem key="fav" id="fav" textValue={it.fav ? '取消收藏' : '收藏'}>{it.fav ? <R.Icons.StarFilled /> : <R.Icons.Star />}<R.Text>{it.fav ? '取消收藏' : '收藏'}</R.Text></R.MenuItem>,
      <R.MenuItem key="reveal" id="reveal" textValue="在文件夹中显示"><R.Icons.Folder /><R.Text>在文件夹中显示</R.Text></R.MenuItem>,
      /* 索引文件夹里的文件只读（2026-10-14 确认）：不进回收站；不想要了就在设置里移除那个文件夹 */
      it.lib ? null : it.trashed
        ? <R.MenuItem key="restore" id="restore" textValue="从回收站恢复"><R.Icons.Revert /><R.Text>从回收站恢复</R.Text></R.MenuItem>
        : <R.MenuItem key="trash" id="trash" textValue="移入回收站"><R.Icons.Delete /><R.Text>移入回收站</R.Text></R.MenuItem>,
    ].filter(Boolean);
    return items;
  }

  /** 条目的 ⋯ 菜单（卡片与行共用）。 */
  function itemMenu(R, it, onAct, idx) {
    return (
      <R.ActionMenu aria-label={`「${it.name}」的操作`} isQuiet size="S" onAction={(k) => onAct(String(k), it)}>{menuItems(R, it, idx)}</R.ActionMenu>
    );
  }

  /** 右键菜单：在指针那一点（键盘的菜单键 / ⇧F10 在条目左上角）弹出，和 ⋯ 是同一份。
      `at` = {it, x, y}；一个 0 尺寸的 fixed 锚点当触发处（同时间轴的右键菜单）。 */
  function SpaceContextMenu({at, onAct, onClose}) {
    const R = window.RSP;
    const anchor = React.useRef(null);
    const idxOf = useSpaceIndex();
    const [ready, setReady] = React.useState(false);
    React.useLayoutEffect(() => { setReady(!!at); }, [at]);
    if (!at) return null;
    return (
      <>
        <span ref={anchor} className="sp-ctx" style={{left: at.x, top: at.y}} aria-hidden="true" />
        {ready ? (
          <R.Popover isOpen triggerRef={anchor} placement="bottom start" hideArrow padding="none"
            onOpenChange={(v) => { if (!v) onClose(); }} aria-label={`「${at.it.name}」的操作`}>
            <R.Menu aria-label={`「${at.it.name}」的操作`} autoFocus="first" onAction={(k) => { onClose(); onAct(String(k), at.it); }}>
              {menuItems(R, at.it, idxOf(at.it))}
            </R.Menu>
          </R.Popover>
        ) : null}
      </>
    );
  }

  /** 列表区上的右键与菜单键：找到指针 / 焦点所在的条目（React Aria 在行上写 data-key），弹出右键菜单。 */
  function contextHandlers(rows, open) {
    const find = (el) => {
      const row = el && el.closest ? el.closest('[data-key]') : null;
      const it = row ? rows.find((x) => String(x.id) === row.getAttribute('data-key')) : null;
      return it ? {it, row} : null;
    };
    return {
      onContextMenu: (e) => {
        const hit = find(e.target);
        if (!hit) return;
        e.preventDefault();
        open({it: hit.it, x: e.clientX, y: e.clientY});
      },
      onKeyDown: (e) => {
        if (!(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
        const hit = find(document.activeElement);
        if (!hit) return;
        e.preventDefault();
        const r = hit.row.getBoundingClientRect();
        open({it: hit.it, x: r.left + 16, y: r.top + 16});
      },
    };
  }

  /* CardView 1.7 shrinks cards to retain two columns. The reviewed responsive
     design requires readable 200px cards and a single column below 416px.
     Use the public Aria collection for navigation, with unmodified S2 cards. */
  function SpaceGrid({rows, movies, onAct, empty}) {
    const R = window.RSP;
    const idxOf = useSpaceIndex();
    return (
      <R.GridList aria-label="Space 条目" layout="grid" items={rows} dependencies={[window.BC_SEMSTATE.get()]}
        className="space__grid bc-scroll" renderEmptyState={empty}
        onAction={(key) => { const it = rows.find((x) => x.id === key); if (it) onAct(it.kind === 'movie' ? 'open' : 'view', it); }}>
        {(it) => (
          <R.GridListItem id={it.id} textValue={it.name} className="space__grid-item">
            <R.Card UNSAFE_className="space__card">
              <R.CardPreview>
                <div className="sp-prev__wrap">
                  <ItemPreview it={it} movie={movies[it.id]} />
                  {SP.durationClock(it) ? <span className="sp-prev__dur" title={`时长 ${SP.durationText(it)}`}>{SP.durationClock(it)}</span> : null}
                </div>
              </R.CardPreview>
              <R.Content>
                <R.Text slot="title">{it.name}</R.Text>
                {itemMenu(R, it, onAct, idxOf(it))}
                <R.Text slot="description">{SP.hitsText(it) || `${SP.KINDS[it.kind].label}${SP.specText(it) ? ' · ' + SP.specText(it) : ''}${it.ver ? ` · v${it.ver}` : ''}`}</R.Text>
              </R.Content>
              <R.Footer>
                <ItemStatus it={it} quiet />
                {it.fav ? <span className="sp-fav" aria-label="已收藏"><R.Icons.StarFilled /></span> : null}
                <FilesButton it={it} onAct={onAct} />
              </R.Footer>
            </R.Card>
          </R.GridListItem>
        )}
      </R.GridList>
    );
  }

  /* 七列合计（S2 给定宽列的下限是 75）不超过 1440 宽窗口里列表区的 1056，不出横向滚动：
     时长是时钟写法，80 放得下「1:20:20」；规格最长「3840×2160 · 59 GB」要 168，状态最长「排队中 · 第 2 位」要 140，
     最近活动「12 分钟前」要 104；来源本来就长、按省略号截断，最小宽度让到 132（窗口再宽时名称与来源分余下的宽度）。 */
  const COLS = [
    {id: 'name', name: '名称', row: true, min: 280}, // 缩略图比原来的类型图标宽约 40，最小宽度随之加宽，名字至少留出原来的宽度
    {id: 'dur', name: '时长', w: 80, align: 'end'}, // 首要事实，紧跟名称（§4.3）
    {id: 'kind', name: '类型', w: 75},
    {id: 'src', name: '来源', min: 132},
    {id: 'spec', name: '规格', w: 168}, // 次要事实，灰字；在原「时长或尺寸」的位置，状态与最近活动仍收在行尾
    {id: 'status', name: '状态', w: 140},
    {id: 'ago', name: '最近活动', w: 104},
    {id: 'menu', name: '操作', w: 64, hide: true},
  ];

  function SpaceTable({rows, movies, dirs, onAct, empty}) {
    const R = window.RSP;
    const idxOf = useSpaceIndex();
    const cell = (it, c) => {
      if (c === 'name') {
        const n = (it.files || []).length;
        return <span className="sp-name"><ItemPreview it={it} movie={movies[it.id]} small />
          <span className="sp-name__body">
            <span className="sp-name__t">{it.name}</span>
            {SP.hitsText(it) || n ? <span className="sp-name__sub" title={n ? SP.filesSummary(it) : undefined}>{SP.hitsText(it) || `${n} 个文件 · ${SP.filesSummary(it)}`}</span> : null}
          </span>
          {it.ver ? <span className="sp-muted">v{it.ver}</span> : null}{it.fav ? <R.Icons.StarFilled UNSAFE_className="sp-fav" aria-label="已收藏" /> : null}</span>;
      }
      if (c === 'kind') return SP.KINDS[it.kind].label;
      if (c === 'src') return SP.sourceText(it, dirs, movies);
      if (c === 'dur') return SP.durationClock(it) ? <span className="sp-num" title={SP.durationText(it)}>{SP.durationClock(it)}</span> : <span className="sp-muted">—</span>;
      if (c === 'spec') return <span className="sp-muted">{SP.specText(it) || '—'}</span>;
      if (c === 'status') return <ItemStatus it={it} />;
      if (c === 'ago') return SP.agoText(activity(it));
      return itemMenu(R, it, onAct, idxOf(it));
    };
    return (
      <R.TableView aria-label="Space 条目" overflowMode="truncate" density="spacious" UNSAFE_className="space__view"
        onAction={(key) => { const it = rows.find((x) => x.id === key); if (it) onAct(it.kind === 'movie' ? 'open' : 'view', it); }}>
        <R.TableHeader columns={COLS}>
          {(c) => <R.Column id={c.id} isRowHeader={!!c.row} minWidth={c.min} width={c.w} align={c.align} hideHeader={!!c.hide}>{c.name}</R.Column>}
        </R.TableHeader>
        <R.TableBody items={rows} renderEmptyState={empty} dependencies={[window.BC_SEMSTATE.get()]}>
          {(it) => (
            <R.Row id={it.id} columns={COLS}>
              {(c) => <R.Cell align={c.align}>{cell(it, c.id)}</R.Cell>}
            </R.Row>
          )}
        </R.TableBody>
      </R.TableView>
    );
  }

  Object.assign(window, {SpaceGrid, SpaceTable, SpaceItemPreview: ItemPreview, SpaceItemStatus: ItemStatus, SpaceIndexMark: IndexMark, useSpaceIndex,
    SpaceContextMenu, spaceContextHandlers: contextHandlers});
})();
