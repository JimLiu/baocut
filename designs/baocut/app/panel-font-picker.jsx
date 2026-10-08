/* 统一字体选择框 —— 五个挂点共用一份（文字面板、元素样式、字幕属性的字体与强调词字体、舞台工具条）。
   从 panel-shared.jsx 拆出来（那个文件已经过了行数上限）。

   product-design §5.9「字体」：可选的字体有三种来源——随应用发布的、本机已装的、Google Fonts 字体目录里的
   （按需下载）——合在**一张表**里，每一行写着它此刻的状态：

     内置 / 本机 / 已下载        灰色标签，选了就用
     可下载                      下载按钮（tip 写大约多大）；也可以直接选——**立即生效**，先用回退字体显示，
                                 下载好后画面自动换上，toast 里可以取消下载
     下载中                      百分比（总数未知时念收到了多少）＋ 取消
     失败 / 已取消               原因在 tip 里 ＋ 重试；离线时整张表顶上一条「现在离线」

   分段（BC_FONTLIB.sections）：这个视频里用到 → 最近用过 → 品牌字体 → 全部字体（内置、已下载、目录热门、本机）。
   搜索族名、按分类与文字（中文、日文、韩文、拉丁……）筛时合成一条「搜索结果」。
   样张是懒的：一行滚进视野才按自己的字体画，之前（与画不出来时）是界面字体的纯文字。
   每一行的 ⓘ 进详情：来源、分类、文字、字重、大小、许可，以及下载 / 取消 / 重试 / 删除。

   没有按需下载的表面（`BC_SURFACE.fontDownloads` 为 false：Web 入口，对应浏览器会话没有 `fonts.*`）
   保持原来的「导入字体 ＋ Brand kits / Popular / All」三段（BC_FONT.groups），行为不变。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const D = window.BC_DATA;
  const L = window.BC_FONTLIB;

  function FontPicker(props) {
    return window.BC_SURFACE.fontDownloads ? <LibraryPicker {...props} /> : <CatalogPicker {...props} />;
  }

  /* ---------- 原来的三段（没有按需下载的表面） ---------- */
  function CatalogPicker({value, onPick, inline}) {
    const app = useApp();
    const [q, setQ] = useState('');
    const groups = window.BC_FONT.groups({
      all: D.fonts.all, popular: D.fonts.popular, brand: D.brand.fonts, query: q,
    });
    const empty = !groups.some((g) => g.rows.length);
    return (
      <div className={cx('fontpop', inline && 'fontpop--inline')}>
        <Field size="s" icon="search" placeholder="搜索字体…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="fupload">
          <BCAction className="fitem" onClick={() => app.toast('导入字体：选本机 .ttf / .otf（本轮为骨架）')}>
            <Ic n="upload" className="ic--14" />
            <span className="nm">导入字体…</span>
          </BCAction>
        </div>
        <div className="flist bc-scroll">
          {groups.map((g) => (g.rows.length ? (
            <React.Fragment key={g.key}>
              <div className="fsec">{g.title}</div>
              {g.rows.map((f) => (
                <BCAction key={f.n} className="fitem" onClick={() => onPick(f.n)}>
                  <span className="nm" style={window.BC_FONT.face(f.st)}>{f.n}</span>
                  {f.n === value ? <Ic n="check" className="ic--14" /> : null}
                </BCAction>
              ))}
            </React.Fragment>
          ) : null))}
          {empty ? <div className="fnone">没有匹配的字体</div> : null}
        </div>
      </div>
    );
  }

  /* ---------- 一张表（有按需下载的表面） ---------- */
  function LibraryPicker({value, onPick, inline}) {
    const app = useApp();
    const lib = window.useFontLibrary();
    const S = window.BC_FONTSTORE;
    const [q, setQ] = useState('');
    const [cat, setCat] = useState(null);
    const [script, setScript] = useState(null);
    const [pop, setPop] = useState(null);
    const [detail, setDetail] = useState(null);
    const listRef = useRef(null);
    /* 打开着的选字框里行序不动：下载完的族不在光标底下跳进「已下载」那一档，下次打开再按新状态排 */
    const frozen = useRef(null);
    if (!frozen.current) frozen.current = L.orderKey(lib.list);
    const projectId = lib.video;   // 编辑器里打开着的视频（打开时记进字体库）
    const secs = L.sections(lib.list, {query: q, category: cat, script,
      inVideo: projectId ? S.inVideo(projectId) : [], recent: lib.recent, frozen: frozen.current, brand: (D.brand.fonts || []).map((f) => f.name)});

    const pick = (f) => {
      onPick(f.family);
      const started = S.use(f.family);
      if (!started) return;
      /* 拉丁字体一两百 KB，一秒内就到：toast 不带动作，自己消失；大的（中日韩，几 MB）才给「取消下载」，
         点的时候已经下完就照实说 */
      const text = '「' + f.family + '」下载好之前先用「' + L.fallbackFor(f) + '」显示，下载好后自动换上';
      if (f.faceBytes * Math.max(1, L.defaultFaces(f).length) < 1024 * 1024) { app.toast(text); return; }
      app.toast(text, null, {label: '取消下载', run: () => {
        const cur = S.get().byName[f.family];
        if (cur && cur.state === 'downloading') S.cancel(f.family);
        else app.toast('「' + f.family + '」已经下载好了');
      }});
    };

    if (detail && lib.byName[detail]) {
      return (
        <div className={cx('fontpop', inline && 'fontpop--inline')}>
          <FontDetail f={lib.byName[detail]} onBack={() => setDetail(null)} onPick={() => pick(lib.byName[detail])} />
        </div>
      );
    }
    const catLabel = cat ? L.CATEGORIES.find((c) => c.k === cat).label : '全部分类';
    const scriptLabel = script ? L.SCRIPTS.find((s) => s.k === script).label : '全部文字';
    return (
      <div className={cx('fontpop', inline && 'fontpop--inline')}>
        <Field size="s" icon="search" placeholder="搜索字体…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        <div className="fontlib__filters">
          <Picker size="s" value={catLabel} open={pop === 'cat'} onClick={() => setPop(pop === 'cat' ? null : 'cat')}
            onClose={() => setPop(null)} popWidth={160}>
            <Menu>
              <MenuItem label="全部分类" on={!cat} onClick={() => { setCat(null); setPop(null); }} />
              {L.CATEGORIES.map((c) => <MenuItem key={c.k} label={c.label} on={cat === c.k} onClick={() => { setCat(c.k); setPop(null); }} />)}
            </Menu>
          </Picker>
          <Picker size="s" value={scriptLabel} open={pop === 'script'} onClick={() => setPop(pop === 'script' ? null : 'script')}
            onClose={() => setPop(null)} popWidth={160} popAlign="right">
            <Menu>
              <MenuItem label="全部文字" on={!script} onClick={() => { setScript(null); setPop(null); }} />
              {L.SCRIPTS.map((s) => <MenuItem key={s.k} label={s.label} on={script === s.k} onClick={() => { setScript(s.k); setPop(null); }} />)}
            </Menu>
          </Picker>
        </div>
        {lib.offline ? <div className="fontlib__note"><Ic n="alert" className="ic--14" />现在离线 · 可下载的字体要连上网络才能下载</div> : null}
        <div className="fupload">
          <BCAction className="fitem" onClick={() => app.toast('导入字体：选本机 .ttf / .otf（本轮为骨架）')}>
            <Ic n="upload" className="ic--14" />
            <span className="nm">导入字体…</span>
          </BCAction>
        </div>
        <div className="flist bc-scroll" ref={listRef}>
          {secs.map((g) => (g.rows.length ? (
            <React.Fragment key={g.key}>
              <div className="fsec">{g.title}{g.key === 'all' ? <span className="fontlib__count"> · 可下载 {lib.total.toLocaleString('en')} 个</span> : null}</div>
              {g.rows.map((f) => <FontRow key={g.key + f.family} f={f} on={f.family === value} root={listRef}
                onPick={() => pick(f)} onDetail={() => setDetail(f.family)} />)}
            </React.Fragment>
          ) : null))}
          {secs.every((g) => !g.rows.length) ? <div className="fnone">没有匹配的字体</div> : null}
        </div>
      </div>
    );
  }

  /* 一行：样张（懒）＋ 选中勾 ＋ 状态（标签 / 下载 / 进度与取消 / 失败与重试）＋ 详情。 */
  function FontRow({f, on, root, onPick, onDetail}) {
    const S = window.BC_FONTSTORE;
    const end = L.rowEnd(f);
    const sample = L.sampleText(f);
    return (
      <div className={cx('fontlib__row', on && 'is-on')}>
        <BCAction className="fitem fontlib__pick" onClick={onPick} aria-label={'用 ' + f.family}>
          <LazySample f={f} root={root} sample={sample} />
          {on ? <Ic n="check" className="ic--14" /> : null}
        </BCAction>
        <span className="fontlib__end">
          {end.kind === 'badge' ? <span className={cx('fontlib__tag', end.tone === 'positive' && 'fontlib__tag--ok')}>{end.label}</span> : null}
          {end.kind === 'download' ? <IconBtn icon="download" size="s" tip={'下载 · 约 ' + end.size} onClick={() => S.download(f.family)} /> : null}
          {end.kind === 'progress' ? <>
            <span className="fontlib__pct t-mono">{end.label}</span>
            <IconBtn icon="close" size="s" tip="取消下载" onClick={() => S.cancel(f.family)} />
          </> : null}
          {end.kind === 'retry' ? <>
            <span className="fontlib__tag fontlib__tag--bad" title={end.message}>{end.label}</span>
            <IconBtn icon="refresh" size="s" tip={'重试 · ' + end.message} onClick={() => S.download(f.family)} />
          </> : null}
          <IconBtn icon="info" size="s" tip="字体详情与许可" className="fontlib__info" onClick={onDetail} />
        </span>
      </div>
    );
  }

  /* 样张：滚进视野才按自己的字体画（真实应用这时才去取这个族的样张）；之前是界面字体的纯文字。 */
  function LazySample({f, root, sample}) {
    const ref = useRef(null);
    const [shown, setShown] = useState(false);
    useEffect(() => {
      const el = ref.current;
      if (!el || shown || typeof IntersectionObserver !== 'function') return undefined;
      let t = null;
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) { t = setTimeout(() => setShown(true), 120); io.disconnect(); }
      }, {root: root && root.current, rootMargin: '40px'});
      io.observe(el);
      return () => { io.disconnect(); if (t) clearTimeout(t); };
    }, [shown]);
    const style = shown ? window.BC_FONT.face(f.st) : undefined;
    return (
      <span className="nm" ref={ref} style={style}>
        {f.family}{sample ? <span className="fontlib__sample">{sample}</span> : null}
      </span>
    );
  }

  /* 详情：来源、分类、文字、字重、大小与许可；按状态给动作。 */
  function FontDetail({f, onBack, onPick}) {
    const S = window.BC_FONTSTORE;
    const app = useApp();
    const end = L.rowEnd(f);
    const cat = (L.CATEGORIES.find((c) => c.k === f.category) || {}).label;
    const scripts = (f.scripts || []).map((k) => (L.SCRIPTS.find((s) => s.k === k) || {}).label).filter(Boolean).join('、');
    const rows = [
      ['状态', L.STATE_LABEL[f.state] + (end.kind === 'progress' ? ' · ' + end.label : '') + (end.kind === 'retry' ? ' · ' + end.message : '')],
      ['来源', L.SOURCE_LABEL[f.source]],
      cat || scripts ? ['分类', [cat, scripts].filter(Boolean).join(' · ')] : null,
      f.weights && f.weights.length ? ['字重', f.weights.join(' · ') + (f.italics && f.italics.length ? '（有斜体）' : '')] : null,
      f.source === 'google-fonts' ? ['大小', f.faces.length ? '已下载 ' + L.fmtBytes(f.sizeBytes) : '常规与粗体约 ' + L.fmtBytes(f.faceBytes * L.defaultFaces(f).length)] : null,
      ['许可', f.licence ? L.LICENCE_LABEL[f.licence] : '未知（本机字体，请自行确认能否用于发布）'],
    ].filter(Boolean);
    return (
      <div className="fontlib__detail">
        <div className="fontlib__dhead">
          <IconBtn icon="back" size="s" tip="回到字体列表" onClick={onBack} />
          <b className="grow t-truncate" style={window.BC_FONT.face(f.st)}>{f.family}</b>
        </div>
        <dl className="fontlib__dl">
          {rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        </dl>
        {f.source === 'google-fonts' ? <p className="fontlib__fine">从 Google Fonts 下载，只发送族名与字重；存在应用数据里，不进视频目录。</p> : null}
        <div className="fontlib__dacts">
          {end.kind === 'download' ? <Btn variant="secondary" size="s" icon="download" onClick={() => S.download(f.family)}>下载</Btn> : null}
          {end.kind === 'progress' ? <Btn variant="secondary" size="s" onClick={() => S.cancel(f.family)}>取消下载</Btn> : null}
          {end.kind === 'retry' ? <Btn variant="secondary" size="s" icon="refresh" onClick={() => S.download(f.family)}>重试</Btn> : null}
          {f.state === 'downloaded' ? <Btn variant="quiet" size="s" onClick={() => {
            if (S.remove(f.family, L.exportPins(app.tasks))) app.toast('已删除「' + f.family + '」下载的字体');
            else app.toast('还没结束的导出在用「' + f.family + '」· 导出结束后再删', 'notice');
          }}>删除下载的文件</Btn> : null}
          <Btn variant="accent" size="s" onClick={onPick}>用这个字体</Btn>
        </div>
      </div>
    );
  }

  Object.assign(window, {FontPicker});
})();
