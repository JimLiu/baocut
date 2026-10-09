/* Space 的列表区（2026-10-01，product-design §4.3–§4.4）—— 只在 App 入口加载，控件用 react-spectrum S2。
   网格是 React Aria GridList + S2 Card，列表是 TableView（七列：名称 / 时长 / 类型 / 来源 / 规格 / 状态 / 最近活动）。
   有时长的条目（视频、成片、音频）时长是首要事实（§4.3）：卡片预览右下角压一枚时长角标，列表里「时长」紧跟名称；
   分辨率、文件大小、句数这些次要事实归「规格」，卡片的描述行写「类型 · 规格」。
   列表的名称列和卡片一样先放缩略图（ItemPreview 的 small 档，§4.3），行高因此用 spacious 密度。
   网格按可用宽度自然降为一列；TableView 继续虚拟化。外框给定高，各自负责滚动。
   条目是 BC_SPACE.items 投影出来的；这里只画，动作回调给 page-space.jsx。
   「全部」与「视频」里一部视频只有一张卡（BC_SPACE.group）：它导出、生成的文件收在卡上的「N 个文件」里，
   视频自己没有状态时，状态灯替这些文件里最该被看见的那个说话（生成中 / 失败 / 缺失 / 来源已变）。 */
(function () {
  const SP = window.BC_SPACE;

  /* 状态色调 → S2 StatusLight */
  const LIGHT = {informative: 'informative', notice: 'notice', positive: 'positive', negative: 'negative'};

  /** 最近活动：收了文件的视频取它和文件里最近的一次。 */
  const activity = (it) => (it.activity != null ? it.activity : it.mtime);

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

  /** 条目的 ⋯ 菜单（卡片与行共用）。 */
  function itemMenu(R, it, onAct) {
    const tx = transcribeItem(R, it);
    const infoLabel = (it.files || []).length ? '查看信息与文件' : '查看信息';
    const items = [
      it.transcribe === 'retry' ? tx : null,
      it.kind === 'movie'
        ? <R.MenuItem key="open" id="open" textValue="打开视频"><R.Icons.OpenIn /><R.Text>打开视频</R.Text></R.MenuItem>
        : <R.MenuItem key="view" id="view" textValue="查看"><R.Icons.Preview /><R.Text>查看</R.Text></R.MenuItem>,
      it.kind === 'movie'
        ? <R.MenuItem key="view" id="view" textValue={infoLabel}><R.Icons.InfoCircle /><R.Text>{infoLabel}</R.Text></R.MenuItem>
        : null,
      it.transcribe === 'retry' ? null : tx,
      it.status === 'generating' && window.BC_SURFACE.pages
        ? <R.MenuItem key="task" id="task" textValue="查看任务"><R.Icons.Clock /><R.Text>查看任务</R.Text></R.MenuItem> : null,
      <R.MenuItem key="fav" id="fav" textValue={it.fav ? '取消收藏' : '收藏'}>{it.fav ? <R.Icons.StarFilled /> : <R.Icons.Star />}<R.Text>{it.fav ? '取消收藏' : '收藏'}</R.Text></R.MenuItem>,
      <R.MenuItem key="reveal" id="reveal" textValue="在文件夹中显示"><R.Icons.Folder /><R.Text>在文件夹中显示</R.Text></R.MenuItem>,
      it.trashed
        ? <R.MenuItem key="restore" id="restore" textValue="从回收站恢复"><R.Icons.Revert /><R.Text>从回收站恢复</R.Text></R.MenuItem>
        : <R.MenuItem key="trash" id="trash" textValue="移入回收站"><R.Icons.Delete /><R.Text>移入回收站</R.Text></R.MenuItem>,
    ].filter(Boolean);
    return (
      <R.ActionMenu aria-label={`「${it.name}」的操作`} isQuiet size="S" onAction={(k) => onAct(String(k), it)}>{items}</R.ActionMenu>
    );
  }

  /* CardView 1.7 shrinks cards to retain two columns. The reviewed responsive
     design requires readable 200px cards and a single column below 416px.
     Use the public Aria collection for navigation, with unmodified S2 cards. */
  function SpaceGrid({rows, movies, onAct, empty}) {
    const R = window.RSP;
    return (
      <R.GridList aria-label="Space 条目" layout="grid" items={rows}
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
                {itemMenu(R, it, onAct)}
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
      return itemMenu(R, it, onAct);
    };
    return (
      <R.TableView aria-label="Space 条目" overflowMode="truncate" density="spacious" UNSAFE_className="space__view"
        onAction={(key) => { const it = rows.find((x) => x.id === key); if (it) onAct(it.kind === 'movie' ? 'open' : 'view', it); }}>
        <R.TableHeader columns={COLS}>
          {(c) => <R.Column id={c.id} isRowHeader={!!c.row} minWidth={c.min} width={c.w} align={c.align} hideHeader={!!c.hide}>{c.name}</R.Column>}
        </R.TableHeader>
        <R.TableBody items={rows} renderEmptyState={empty}>
          {(it) => (
            <R.Row id={it.id} columns={COLS}>
              {(c) => <R.Cell align={c.align}>{cell(it, c.id)}</R.Cell>}
            </R.Row>
          )}
        </R.TableBody>
      </R.TableView>
    );
  }

  Object.assign(window, {SpaceGrid, SpaceTable, SpaceItemPreview: ItemPreview, SpaceItemStatus: ItemStatus});
})();
