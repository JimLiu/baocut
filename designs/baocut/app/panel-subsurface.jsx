/* 字幕属性页「外观」里的涂装栈一段与「排版」里的分页一段（caption-editor-redesign §9.2）。

   涂装栈取代此前分开的「文字描边」「文字阴影」两张开关卡：字身填充（纯色 / 渐变 / 纹理）、
   描边与阴影各可加到三层（每层一行，点开改参数，可上下挪、可删）、一层发光。落笔写整个栈
   （`layers`）连同它的 v1 镜像键（`BC_SURF.toPaint`）：导出预览的旧路、品牌页小卡这些只认
   一道描边一层阴影的读者照读第一层，不会和栈画得不一样。底板与逐词底块仍是「背景」那一段。

   长度在栈里按 em 存，这里一律按「占字号的百分比」显示（0.06em → 6%），与背景的圆角同一个口径。 */
(function () {
  const SURF = window.BC_SURF;
  const CS = window.BC_CS;

  const pct = (em) => Math.round((em || 0) * 1000) / 10;
  const em = (v) => Math.round(v * 10) / 1000;

  /** 一层：标题行（色块 · 名字 · 摘要，点开收起）＋ 上下挪 ＋ 删除；展开后是这一层的参数。 */
  function LayerRow({name, color, summary, open, onOpen, onUp, onDown, onRemove, children}) {
    return (
      <div className={cx('subsurf__layer', open && 'is-open')}>
        <div className="subsurf__lh">
          <BCAction className="subsurf__lb" aria-expanded={open} onClick={onOpen}>
            <i className="subsurf__sw cdot" style={{'--swatch-c': color}} />
            <span className="subsurf__ln">{name}</span>
            <span className="subsurf__ls">{summary}</span>
            <Ic n={open ? 'chevup' : 'chevdown'} className="ic--14" />
          </BCAction>
          {onUp ? <IconBtn icon="chevup" size="xs" tip="往里挪" onClick={onUp} /> : null}
          {onDown ? <IconBtn icon="chevdown" size="xs" tip="往外挪" onClick={onDown} /> : null}
          <IconBtn icon="trash" size="xs" tip="删掉这一层" onClick={onRemove} />
        </div>
        {open ? <div className="subsurf__lbd">{children}</div> : null}
      </div>
    );
  }

  function SubSurfaceSection({ln, set, first, aside, action, pop, tg, setPop}) {
    const [open, setOpen] = React.useState(null);
    const s = SURF.layersOf(ln);
    const put = (next, live) => set(SURF.toPaint(next, {color: ln.color}), live);
    const color = (key, value, onPick, alpha) => (
      <PRow label="颜色">
        <ColorField value={value} scope={aside} open={pop === key} onToggle={() => tg(key)} allowsAlpha={alpha}
          onPick={(c, live) => { onPick(c, live); if (!live) setPop(null); }} inline />
      </PRow>
    );
    const toggle = (k) => setOpen(open === k ? null : k);
    const kind = SURF.fillKind(s);
    const fill = s.fill;

    /* 字身：纯色的颜色就是上面「文字」一段的文字颜色，这里只多出渐变的两头与角度、纹理的选择 */
    const fillBody = kind === 'linear' ? (
      <>
        {color('sf-f0', fill.stops[0][1], (c, live) => put(Object.assign({}, s, {fill: Object.assign({}, fill,
          {stops: [[0, c]].concat(fill.stops.slice(1))})}), live))}
        {color('sf-f1', fill.stops[fill.stops.length - 1][1], (c, live) => put(Object.assign({}, s, {fill: Object.assign({}, fill,
          {stops: fill.stops.slice(0, -1).concat([[1, c]])})}), live))}
        <ValueRow label="角度" value={fill.angle == null ? 180 : fill.angle} min={0} max={360} unit="°"
          onChange={(v) => put(Object.assign({}, s, {fill: Object.assign({}, fill, {angle: v})}), true)} />
      </>
    ) : kind === 'texture' ? (
      <PRow label="纹理">
        <div className="subsurf__tex" role="group" aria-label="纹理">
          {SURF.TEXTURES.map((t) => (
            <Tip key={t.k} label={t.name}>
              <BCAction className={cx('subsurf__tx', fill.texture === t.k && 'is-on')} aria-label={t.name}
                aria-pressed={fill.texture === t.k} onClick={() => put(Object.assign({}, s, {fill: Object.assign({}, fill, {texture: t.k})}))}>
                <i style={{backgroundImage: t.image}} />
              </BCAction>
            </Tip>
          ))}
        </div>
      </PRow>
    ) : <div className="hint">字身是纯色，颜色在上面「文字颜色」。</div>;

    const layers = (k, list, label) => list.map((x, i) => {
      const id = k + i;
      const where = list.length > 1 ? (i === 0 ? '（最里）' : i === list.length - 1 ? '（最外）' : '') : '';
      const sum = k === 'stroke' ? pct(x.width) + '%'
        : (x.inner ? '内 · ' : '') + pct(Math.hypot(x.offset[0], x.offset[1])) + '% · 模糊 ' + pct(x.blur) + '%';
      const patch = (p, live) => put(SURF.setLayer(s, k, i, p), live);
      return (
        <LayerRow key={id} name={label + ' ' + (i + 1) + where} color={x.color} summary={sum} open={open === id}
          onOpen={() => toggle(id)} onRemove={() => { put(SURF.removeLayer(s, k, i)); setOpen(null); }}
          onUp={i > 0 ? () => { put(SURF.moveLayer(s, k, i, -1)); setOpen(k + (i - 1)); } : null}
          onDown={i < list.length - 1 ? () => { put(SURF.moveLayer(s, k, i, 1)); setOpen(k + (i + 1)); } : null}>
          {color('sf-' + id, x.color, (c, live) => patch({color: c}, live), k === 'shadow')}
          {k === 'stroke' ? (
            <ValueRow label="粗细" value={pct(x.width)} min={0.5} max={20} step={0.5} unit="%"
              onChange={(v) => patch({width: em(v)}, true)} />
          ) : (
            <>
              <PRow label="内阴影"><Switch ariaLabel="内阴影" on={!!x.inner} onChange={(v) => patch({inner: v})} />
                <span>画在字身里面</span></PRow>
              <ValueRow label="距离" value={pct(Math.hypot(x.offset[0], x.offset[1]))} min={0} max={30} step={0.5} unit="%"
                onChange={(v) => { const a = x.offset[0] || x.offset[1] ? Math.atan2(x.offset[1], x.offset[0]) : Math.PI / 2; patch({offset: [em(v * Math.cos(a)), em(v * Math.sin(a))]}, true); }} />
              <ValueRow label="角度" value={Math.round(((Math.atan2(x.offset[1], x.offset[0]) * 180) / Math.PI + 360) % 360)} min={0} max={360} unit="°"
                onChange={(v) => { const d = Math.hypot(x.offset[0], x.offset[1]); const a = (v * Math.PI) / 180; patch({offset: [Math.round(d * Math.cos(a) * 10000) / 10000, Math.round(d * Math.sin(a) * 10000) / 10000]}, true); }} />
              <ValueRow label="模糊" value={pct(x.blur)} min={0} max={50} step={0.5} unit="%"
                onChange={(v) => patch({blur: em(v)}, true)} />
            </>
          )}
        </LayerRow>
      );
    });
    const addBtn = (k, list, label) => (list.length < SURF.MAX_LAYERS ? (
      <BCAction className="subsurf__add" onClick={() => { const next = SURF.addLayer(s, k, k === 'stroke' && !list.length ? '#000000' : null); put(next); setOpen(k + list.length); }}>
        <Ic n="plus" className="ic--14" />{label}
      </BCAction>
    ) : <span className="subsurf__max">最多三层</span>);
    const g = s.glow;

    return (
      <React.Fragment key="surface">
        <SecHead first={first} aside={aside} action={action}>文字效果</SecHead>
        <div className="sec subsurf">
          <PRow label="字身">
            <div style={{flex: 1}}>
              <Segmented size="s" value={kind} onChange={(k) => put(SURF.setFill(s, k, ln.color))}
                items={[{k: 'solid', label: '纯色'}, {k: 'linear', label: '渐变'}, {k: 'texture', label: '纹理'}]} />
            </div>
          </PRow>
          {fillBody}

          <div className="subsurf__gh"><span>描边</span><span className="subsurf__gn">由里向外</span>{addBtn('stroke', s.strokes, '加一层描边')}</div>
          {layers('stroke', s.strokes, '描边')}

          <div className="subsurf__gh"><span>阴影</span><span className="subsurf__gn">先画的在下面</span>{addBtn('shadow', s.shadows, '加一层阴影')}</div>
          {layers('shadow', s.shadows, '阴影')}

          <div className="subsurf__gh"><span>发光</span><span className="spacer" />
            <Switch ariaLabel="发光" on={!!g} onChange={(v) => put(Object.assign({}, s, {glow: v ? {color: ln.activeColor || ln.color, radius: 0.3, strength: 0.8} : null}))} />
          </div>
          {g ? (
            <>
              {color('sf-glow', g.color, (c, live) => put(Object.assign({}, s, {glow: Object.assign({}, g, {color: c})}), live), true)}
              <ValueRow label="半径" value={pct(g.radius)} min={2} max={80} step={1} unit="%"
                onChange={(v) => put(Object.assign({}, s, {glow: Object.assign({}, g, {radius: em(v)})}), true)} />
              <ValueRow label="强度" value={Math.round(g.strength * 100)} min={10} max={100} unit="%"
                onChange={(v) => put(Object.assign({}, s, {glow: Object.assign({}, g, {strength: v / 100})}), true)} />
            </>
          ) : null}
        </div>
      </React.Fragment>
    );
  }

  /** 分页（§4 `layout.pagination`）：自动按排版换行，或固定每页几个词、每页怎么分行。 */
  function SubPaginationSection({ln, set, first, aside, action}) {
    const R = window.RSP;
    const pg = CS.normPagination(ln.pagination);
    const per = pg ? pg.wordsPerPage : 3;
    const rowsKey = (r) => (r ? r.join('-') : 'one');
    return (
      <React.Fragment key="pagination">
        <SecHead first={first} aside={aside} action={action}>分页</SecHead>
        <div className="sec">
          <PRow label="每页">
            <div style={{flex: 1}}>
              <Segmented size="s" value={pg ? 'fixed' : 'auto'}
                onChange={(v) => set({pagination: v === 'auto' ? null : {wordsPerPage: per, rows: null}})}
                items={[{k: 'auto', label: '自动'}, {k: 'fixed', label: '固定词数'}]} />
            </div>
          </PRow>
          {pg ? (
            <>
              <ValueRow label="词数" value={per} min={1} max={CS.PAGE_MAX}
                onChange={(v) => set({pagination: CS.normPagination({wordsPerPage: v, rows: pg.rows})}, true)} />
              {per > 1 ? (
                <PRow label="分行">
                  {/* 拆法随词数长到七种，段控件排不下，用下拉 */}
                  <R.Picker aria-label="分行" size="S" selectedKey={rowsKey(pg.rows)} UNSAFE_className="subsurf__rows"
                    onSelectionChange={(k) => set({pagination: {wordsPerPage: per, rows: k === 'one' ? null : String(k).split('-').map(Number)}})}>
                    {CS.rowPatterns(per).map((r) => <R.PickerItem key={rowsKey(r)} id={rowsKey(r)} textValue={CS.rowsLabel(r)}>{CS.rowsLabel(r)}</R.PickerItem>)}
                  </R.Picker>
                </PRow>
              ) : null}
              <div className="hint">念到下一页时整页换掉；入场动效每页从头再来一遍。</div>
            </>
          ) : <div className="hint">按字幕宽度自动换行，一条字幕整句显示。</div>}
        </div>
      </React.Fragment>
    );
  }

  Object.assign(window, {SubSurfaceSection, SubPaginationSection});
})();
