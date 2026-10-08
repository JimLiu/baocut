/* Image / Video / Audio 面板 —— §13.6。
   三个 Tab 是**同一份项目素材库**（timeline.json 的 sources{}）按类别过滤出的三个
   视图，共用一份渲染与一条导入链：**导入只发 putSource，放置才发 addElement**。
   音频元素不带 track 提交，由核心判成 audio 轨并自动建轨。

   刻意与前身画板不同：那边这三栏是 0 handler 的静态稿（连拖拽区都只是长得像）。
   本载体能真的点，所以导入、放置、⋯ 菜单都接上了。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const M = window.BC_MEDIA;

  function placeSource(ctx, app, kind, src) {
    const element = M.placement(kind + '-' + ctx.nextSeq(), kind, src, ctx.playT);
    if (!element) { app.toast('无法读取音频时长，未添加到时间轴', 'negative'); return; }
    ctx.addElement(element);
    ctx.setTab(kind); ctx.setPaneView(null);
    app.toast(kind === 'audio' ? '已添加音频到时间轴' : '已添加到画布和时间轴', 'positive');
  }

  const KIND = {
    image: {title: '图片', drop: '把图片拖进来', accept: 'PNG、JPG、SVG、WEBP', sec: '视频图片'},
    video: {title: '视频', drop: '把视频拖进来', accept: 'MP4、MOV、WEBM —— 也可以粘贴一个链接', sec: '视频视频'},
    audio: {title: '音频', drop: '把音频拖进来', accept: 'MP3、WAV、M4A、FLAC', sec: '视频音频'},
  };

  /** 确定性正弦叠加的波形缩略，不是随机——原型必须可复现 */
  function WavePreview() {
    const bars = [];
    for (let i = 0; i < 26; i++) {
      const a = Math.abs(Math.sin(i / 2.1) * 0.6 + Math.sin(i / 5.7) * 0.4);
      bars.push(<rect key={i} x={i * 2.5} y={13 - a * 11} width="1.4" height={Math.max(1.5, a * 22)}
        rx="0.7" fill="var(--blue-800)" />);
    }
    return <svg width="64" height="26" viewBox="0 0 65 26">{bars}</svg>;
  }

  function MediaMenu({src, kind, ctx, onClose}) {
    const app = useApp();
    const place = () => {
      onClose();
      placeSource(ctx, app, kind, src);
    };
    return (
      <Menu>
        <MenuItem icon="plus" label={kind === 'audio' ? '加到时间轴' : '放到画布'} onClick={place} />
        {kind === 'video' && window.BC_SURFACE.ai ? <MenuItem icon="sparkle" label={src.crop ? '再调整构图…' : '智能裁剪…'} sub={src.crop ? `第 ${src.crop.version || 1} 版 · 改完另存一版` : '换一种画幅，重点留在框里'} onClick={() => {
          onClose(); src.crop ? ctx.openCrop(null, {output: src}) : ctx.openCrop(src);
        }} /> : null}
        {kind === 'video' && src.crop ? (() => {
          const g = window.BC_VIDEO_REPLACE.replaceGroup({elements: ctx.elements, docs: ctx.elDocs, sources: ctx.sources.video, output: src, canvasRatio: window.BC_LAYOUT.ratioValue(ctx.ratio)});
          const n = g.replaced.length;
          return <MenuItem icon="refresh" label="替换时间轴上的视频…" disabled={!n}
            sub={n ? (n === 1 ? '换掉时间轴上这段视频' : `${n} 段一起换 · 剪口不动`) : g.count ? '时间轴上的片段不在处理范围里' : '时间轴上没有用这段原片的视频'}
            onClick={() => { onClose(); ctx.replaceWithOutput(src.id); }} />;
        })() : null}
        {src.tts ? (
          <>
            <MenuItem icon="download" label="下载 WAV" sub="48 kHz · 单声道" onClick={() => {
              onClose(); app.toast(`已保存 ${src.name} 到下载目录`, 'positive');
            }} />
            <MenuItem icon="redo" label="重新生成" sub="带着这次的文字与音色回到表单" onClick={() => {
              onClose(); window.BC_TTS_DRAFT = src.tts;
              ctx.setPaneView(src.tts.mode === 'clone' ? 'tts-clone' : 'tts');
            }} />
          </>
        ) : null}
        <MenuItem icon="copy" label="复制文件名" onClick={async () => {
          onClose(); const ok = await copyToClipboard(src.name);
          app.toast(ok ? '已复制 ' + src.name : '复制失败，请重试', ok ? 'positive' : 'negative');
        }} />
        <MenuRule />
        <MenuItem icon="trash" label="从视频移除" tone="negative"
          disabled={M.sourceUsed(src, ctx.elements, ctx.proj.src.name)}
          onClick={() => {
            onClose();
            if (M.sourceUsed(src, ctx.elements, ctx.proj.src.name)) return;
            ctx.removeSource(kind, src.id);
            if (src.crop) app.crop.removeOutput(ctx.proj.id, src.id);
            app.toast('已从素材库移除（源文件不动）', 'positive');
          }} />
      </Menu>
    );
  }

  /* 音频卡的缩略图本身就是试听钮（2026-09-11）：点一下就地放，不必先加到时间轴。
     一次只放一个（状态在列表上），进度盖在波形下沿，时长位在放的时候改成已播时间。 */
  function FileCard({src, kind, ctx, preview, onPreview}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const playing = !!preview;
    const pct = playing && src.dur ? Math.min(100, (preview.t / src.dur) * 100) : 0;
    return (
      <div><div className="fcard">
        {kind === 'audio' ? (
          <BCAction className={cx('fthumb', 'fthumb--btn', playing && 'is-playing')} style={{background: 'var(--gray-75)'}}
            title={playing ? '暂停试听' : '试听这段音频'} onClick={() => onPreview(playing ? null : src.id)}>
            <WavePreview />
            <span className="fthumb__play"><Ic n={playing ? 'pause' : 'play'} className="ic--14" /></span>
            {src.dur ? <span className="dur">{T.timecode(playing ? preview.t : src.dur, {decimals: 0})}</span> : null}
            {playing ? <span className="fthumb__prog"><i style={{width: pct + '%'}} /></span> : null}
          </BCAction>
        ) : (
          <span className="fthumb"
            /* @ds-allow: 缩略图画的是素材本身的画面，不是 S2 表面 */
            style={{background: src.grad || 'linear-gradient(160deg, #232a38, #10141c)'}}>
            {src.dur ? <span className="dur">{T.timecode(src.dur, {decimals: 0})}</span> : null}
          </span>
        )}
        <span className="finfo">
          <b>{src.name}</b>
          <span>{src.meta}</span>
          {src.badge ? <Chip>{src.badge}</Chip> : null}
        </span>
        <div style={{position: 'relative'}}>
          <IconBtn icon="more" size="s" tip="更多" onClick={() => setPop((v) => !v)} />
          <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={200}>
            <MediaMenu src={src} kind={kind} ctx={ctx} onClose={() => setPop(false)} />
          </Popover>
        </div>
      </div></div>
    );
  }

  /* 项目音频里的一组配音（2026-09-13 三改）：组头 = 语言小牌 + 「配音 · English」+ `63 个文件 · 62 句 · 3 句没合成 · Qwen3-TTS`
     + 「已在时间轴」+ 重新生成 N 句 + ⋯；展开是紧凑的文件行（background.wav / s-N.wav · 译文 · 时长 · 状态）。
     点组头开合；⋯ 菜单是整组的动作（打开轨的菜单 / 下载整组 / 移除整组）。
     一角色一轨的旁白组（2026-09-24，剧情短片的 cast 清单）：组名 `旁白 · vo/sea`，副题下多一行「角色：sea · 低沉、缓慢」。 */
  function AudioGroup({g, ctx, open, onToggle}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const TL = window.BC_TL;
    const ST = {fast: '过快', failed: '没合成', queued: '重生成中'};
    return (
      <section className="agroup" aria-label={window.BC_DUB.groupTitle(g)}>
        {/* 组头是 div 不是 button：右侧的「重新生成 N 句」与 ⋯ 本身是按钮，button 里不能再套 button */}
        <div className="agroup__hd" role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--12" />
          <span className="tlang">{window.BC_DUB.groupBadge(g, TL.languageBadge)}</span>
          <span className="agroup__nm">
            <b>{window.BC_DUB.groupTitle(g)}{g.onTimeline ? <Chip>已在时间轴</Chip> : <Chip>轨已关</Chip>}</b>
            <span>{g.line}</span>
            {g.roleLine ? <span>角色：{g.roleLine}</span> : null}
          </span>
          <BCAction className="agroup__act" onClick={(e) => e.stopPropagation()}>
            {g.regen.length && window.BC_SURFACE.ai ? <Btn variant="secondary" size="s" onClick={() => ctx.requestAi('dub', {lang: g.lang, ids: g.regen})}>重新生成 {g.regen.length} 句</Btn> : null}
            <div style={{position: 'relative'}}>
              <IconBtn icon="more" size="s" tip="这组配音" onClick={() => setPop((v) => !v)} />
              <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={220}>
                <Menu>
                  <MenuItem icon="wave" label="在时间轴上看这条轨" onClick={() => { setPop(false); ctx.setTab('audio'); app.toast(`时间轴上「配音 · ${g.langName}」这一行`); }} />
                  <MenuItem icon="download" label="下载整组" sub={`${g.files.length} 个 WAV · 48 kHz`} onClick={() => { setPop(false); app.toast(`已保存 dub-${g.lang}/ 到下载目录`, 'positive'); }} />
                  {window.BC_SURFACE.ai ? <MenuItem icon="redo" label="重新配这种语言" sub="回到翻译配音，带着这次的设置" onClick={() => { setPop(false); ctx.requestAi('dub', {lang: g.lang}); }} /> : null}
                  <MenuRule />
                  <MenuItem icon="trash" label="移除这组配音" tone="negative" sub="时间轴上的这条轨一起去掉，可撤销" onClick={() => {
                    setPop(false); const prev = (ctx.dubs || []).find((d) => d.lang === g.lang); ctx.clearDub(g.lang);
                    app.toast(`已移除「配音 · ${g.langName}」`, 'positive', {label: '撤销', undo: true, run: () => ctx.restoreDubs(prev ? [prev] : [])});
                  }} />
                </Menu>
              </Popover>
            </div>
          </BCAction>
        </div>
        {open ? (
          <div className="agroup__body bc-scroll">
            {g.files.map((f) => {
              // 每一句那一行可点（2026-09-23）：点 = 选中这一句 + 打开「编辑配音句」；背景声那行不是句
              const Row = f.kind === 'bed' ? 'div' : 'button';
              const sel = ctx.dubSel && ctx.dubSel.lang === g.lang && ctx.dubSel.ids.indexOf(f.blockId) >= 0;
              return (
                <Row key={f.id} className={cx('agfile', f.kind === 'bed' && 'agfile--bed', f.kind !== 'bed' && 'agfile--btn', f.muted && 'agfile--muted', sel && 'is-on')} title={f.kind === 'bed' ? f.text : f.text + ' · 点开属性'}
                  onClick={f.kind === 'bed' ? undefined : () => ctx.pickDub(g.lang, f.blockId, {})}>
                  <Ic n={f.kind === 'bed' ? 'ambient' : 'wave'} className="ic--12" />
                  <span className="agfile__nm">{f.name}</span>
                  <span className="agfile__tx">{f.text}</span>
                  {ST[f.status] ? <span className={cx('agfile__st', 'agfile__st--' + f.status)}>{ST[f.status]}</span> : null}
                  {f.k > 1 ? <span className="agfile__vtag" title={`第 ${f.k} 版 · ${f.archived} 个旧版本在归档`}>v{f.k}</span> : null}
                  <span className="agfile__dur">{T.timecode(f.dur, {decimals: 1})}</span>
                </Row>
              );
            })}
          </div>
        ) : null}
      </section>
    );
  }

  const IMG_ID = 'e-img';                   // 画布上那块演示图片（`D.elements` 里的那条）

  /* product-design §5.1：素材来源使用原生 Tabs，图标与文字遵循 S2 插槽布局。 */
  const SOURCE_TABS = [{k: 'project', label: '视频素材', icon: 'Collection'}, {k: 'stock', label: '在线素材', icon: 'GlobeGrid'}];
  const IMAGE_TABS = [SOURCE_TABS[0], {k: 'gen', label: 'AI 生成', icon: 'AIMark'}];
  const imageSeg = window.BC_SURFACE.ai;
  function MediaSourceTabs({title, view, setView, items, detail, children}) {
    const R = window.RSP;
    return <>{!detail && <window.PanelHead title={title} />}
      {items ? <R.Tabs aria-label={title + '来源'} selectedKey={view} onSelectionChange={setView} UNSAFE_className="media-source-tabs">
        <div className="media-source-tabs__nav" hidden={detail}><R.TabList aria-label={title + '来源'}>
          {items.map(item => { const Icon = R.Icons[item.icon]; return <R.Tab key={item.k} id={item.k}><Icon /><R.Text>{item.label}</R.Text></R.Tab>; })}
        </R.TabList></div>
        {items.map(item => <R.TabPanel key={item.k} id={item.k} UNSAFE_className={cx("media-source-tabs__panel", detail && "is-detail")}>{view === item.k ? children : null}</R.TabPanel>)}
      </R.Tabs> : children}
    </>;
  }

  /* 素材库里 AI 生成的图（`origin: 'ai'`，§2.4）：✦ 徽标 + ⋯（查看生成参数 / 再生成一版 / 复制提示词）。
     卡片本身仍是「点一下放到画布」；徽标与菜单在 Web 上也画（只读出处），「再生成一版」只在 App。 */
  function ImageCard({s, ctx, onAgain}) {
    const app = useApp();
    return (
      <div className={cx('icard', s.origin === 'ai' && 'icard--ai')} role="button" tabIndex={0}
        onClick={() => placeSource(ctx, app, 'image', s)}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); placeSource(ctx, app, 'image', s); } }}>
        <span className={cx('ithumb', s.alpha && 'checker')}
          /* @ds-allow: 缩略图画的是素材本身 */
          style={s.grad ? {background: s.grad} : null}>
          {s.alpha && s.origin !== 'ai' ? <Ic n="image" className="ic--26" style={{color: 'var(--gray-500)'}} /> : null}
          {s.origin === 'ai' ? <span className="icard__ai" title="AI 生成"><Ic n="sparkle" className="ic--12" /></span> : null}
          {s.origin === 'ai' && window.AiSourceMenu ? <window.AiSourceMenu s={s} onAgain={onAgain} /> : null}
        </span>
        <em>{s.name}</em>
        <span>{s.meta}</span>
      </div>
    );
  }

  function MediaPanel({ctx, kind}) {
    const app = useApp();
    const k = KIND[kind];
    const [over, setOver] = useState(false);
    const [view, setView] = useState('project');
    const [stockDetail, setStockDetail] = useState(false);
    useEffect(() => { setView('project'); }, [kind]);
    const list = ctx.sources[kind];
    // 项目音频按配音分组（§13.6 三改）：每种语言一组，默认收起；散装文件照旧平铺在组下面
    const shape = kind === 'audio' ? window.BC_DUB.audioGroups(list, ctx.dubs || [], {duration: ctx.duration, dubOff: ctx.dubOff || {}}) : null;
    const [openG, setOpenG] = useState({});
    // 归档组（2026-09-23）：所有语言组之后；没有归档版时不画
    const archive = kind === 'audio' ? window.BC_DUB.archiveShape(ctx.dubs || []) : null;
    const [play, setPlay] = useState(null);       // 试听：{id, t}，一次只有一个
    const timer = useRef(null);
    const playId = play ? play.id : null;
    useEffect(() => {
      clearInterval(timer.current);
      if (!playId) return undefined;
      const dur = (list.find((s) => s.id === playId) || {}).dur || 0;
      timer.current = setInterval(() => setPlay((p) => (p && p.t + 0.2 < dur ? {...p, t: p.t + 0.2} : null)), 200);
      return () => clearInterval(timer.current);
    }, [playId, list]);
    useEffect(() => { setPlay(null); }, [kind]);

    const importOne = () => {
      const n = ctx.nextSeq();
      const made = kind === 'image'
        ? {id: 'x' + n, name: `import-${n}.png`, meta: '1920 × 1080 · 640 KB'}
        : kind === 'video'
          ? {id: 'x' + n, name: `import-${n}.mp4`, meta: '1080p · 30 fps · 96 MB', dur: 64}
          : {id: 'x' + n, name: `import-${n}.m4a`, meta: '00:31 · 48 kHz', dur: 31};
      ctx.addSource(kind, made);
      // 导入只发 putSource——放置是另一步（§13.6）
      app.toast('已导入素材库 · 还没放到时间轴上', 'positive');
    };

    /* 选中一张图片 → 这一栏落在**编辑图片**（第 58.2 轮）。此前点画布上那张图、点
       时间轴那条、点素材库里的卡片，翻出来的都是素材库本身——一个只能看不能改的
       死胡同。与 Text 栏同一条规矩：在哪一页由选中决定。 */
    const selImg = kind === 'image' && ctx.sel && ctx.sel.kind === 'element'
      && (ctx.sel.elKind === 'image' || ctx.sel.id === IMG_ID);
    const imageId = selImg ? ctx.sel.id : IMG_ID;
    const edit = window.useImageEdit(ctx, imageId);
    if (selImg) {
      if (ctx.paneView === 'adjust') {
        return <window.ImageAdjust v={edit.v} set={edit.set} onBack={() => ctx.setPaneView(null)} />;
      }
      if (ctx.paneView === 'anims') {
        return (
          <>
            <window.PanelHead title="动画" onBack={() => ctx.setPaneView(null)} backTip="返回编辑图片" />
            <div className="pscroll bc-scroll">
              <window.AnimSection pick={edit.v.anim || {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}}
                setPick={(a) => ctx.setElDoc(imageId, {anim: a})} ctx={ctx} peekId={imageId} />
            </div>
          </>
        );
      }
      return (
        <window.ImageProps ctx={ctx} id={imageId} v={edit.v} set={edit.set}
          onBack={() => ctx.pick(null)}
          onDelete={() => {
            const doc = ctx.elDocs[imageId];
            const rec = ctx.elements.find(e => e.id === imageId);
            ctx.removeElement(imageId);
            app.toast('已删除图片', 'positive', {label: '撤销', undo: true,
              run: () => ctx.restoreElement(Object.assign({}, rec, doc))});
          }}
          onAnims={() => ctx.setPaneView('anims')}
          onAdjust={() => ctx.setPaneView('adjust')}
          onReplace={(name) => { ctx.setElDoc(imageId, {asset: name}); app.toast(`已换成 ${name}`, 'positive'); }} />
      );
    }

    /* 选中一段视频 → 这一栏落在**编辑视频**（第 84 轮，与图片第 58.2 轮同一条规矩）。
       此前点画布上那块 B-roll、点时间轴那条，翻出来的都是素材库本身。
       子页四张：动画 / 调整 / 滤镜（调色）/ 滤镜（效果）——后两张是同一页的两个 tab，
       因为画布 `···` 菜单上「滤镜」与「效果」是分开的两行。 */
    const selVid = kind === 'video' && ((ctx.sel && ctx.sel.kind === 'element'
      && (ctx.sel.elKind === 'video' || ctx.sel.id === window.VIDEO_ID)));
    const videoId = (selVid ? ctx.sel.id : window.VIDEO_ID);
    const vedit = window.useVideoEdit(ctx, videoId);
    if (selVid) {
      const back = () => ctx.setPaneView(null);
      const grad = (window.videoSourceOf(vedit.v.name) || {}).grad;
      if (ctx.paneView === 'transitions') {
        return <window.VideoTransitionsView key={videoId} ctx={ctx} el={{id: videoId}} onBack={back} />;
      }
      if (ctx.paneView === 'adjust') {
        return <window.ImageAdjust v={vedit.v} set={vedit.set} onBack={back} backLabel="编辑视频"
          preview={<div className="imgprev fxwrap">
            <span className="fxlayer" style={{background: grad || null,
              filter: window.BC_EL.fxCss(Object.assign({}, vedit.v, {opacity: 100})) || null}} />
          </div>} />;
      }
      if (ctx.paneView === 'filters' || ctx.paneView === 'effects') {
        return <window.FiltersPage v={vedit.v} set={vedit.set}
          tab={ctx.paneView === 'effects' ? 'effects' : 'grading'}
          setTab={(t) => ctx.setPaneView(t === 'effects' ? 'effects' : 'filters')}
          onBack={back} />;
      }
      if (ctx.paneView === 'anims') {
        return (
          <>
            <window.PanelHead title="动画" onBack={back} backTip="返回编辑视频" />
            <div className="pscroll bc-scroll">
              <window.AnimSection pick={vedit.v.anim || {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}}
                setPick={(a) => ctx.setElDoc(videoId, {anim: a})} ctx={ctx} peekId={videoId} />
            </div>
          </>
        );
      }
      return (
        <window.VideoProps ctx={ctx} id={videoId} v={vedit.v} set={vedit.set}
          onBack={() => ctx.pick(null)}
          onDelete={() => {
            const doc = ctx.elDocs[videoId];
            const rec = ctx.elements.find(e => e.id === videoId);
            ctx.removeElement(videoId);
            app.toast('已删除视频元素', 'positive', {label: '撤销', undo: true,
              run: () => ctx.restoreElement(Object.assign({},
                rec, doc))});
          }}
          onAnims={() => ctx.setPaneView('anims')}
          onTransitions={() => ctx.setPaneView('transitions')}
          onAdjust={() => ctx.setPaneView('adjust')}
          onFilters={() => ctx.setPaneView('filters')} />
      );
    }

    const frame = body => <MediaSourceTabs title={k.title} view={view} setView={setView}
      items={kind === 'image' ? (imageSeg ? IMAGE_TABS : null) : SOURCE_TABS} detail={view === 'stock' && stockDetail}>{body}</MediaSourceTabs>;

    if (kind === 'image' && imageSeg && view === 'gen') return frame(<window.ImageGenPane ctx={ctx} onPlace={(src) => placeSource(ctx, app, 'image', src)} />);
    const againFromSource = (s) => {
      const IM = window.BC_CLOUD_IMAGE; const g = s.gen || {};
      const scope = (ctx.proj && ctx.proj.id) || 'proj';
      window.BC_IMAGE_JOBS.drafts[scope] = Object.assign(IM.blank(g.model), {prompt: g.prompt || '', aspect: g.aspect || '16:9', fit: false,
        negative: g.negative || '', quality: g.quality || 'normal', transparent: !!g.transparent, steps: g.steps || 20, refs: [], advanced: !!(g.negative || g.quality === '2k' || g.transparent)});
      setView('gen');
    };

    if (kind === 'video') return view === 'stock'
      ? frame(<window.StockPane ctx={ctx} kind="video" onDetailChange={setStockDetail} />)
      /* 短视频项目（§15.12）：素材库上面先是「原片」卡——这一支从哪儿来、用了哪几段、还能从原片拿什么。
         来源项目这一头是「切出的短视频」一组（没切过就不画）：点一支打开它，App 上还能调整后再生成 */
      : frame(<>{window.BC_SHORTS_CUT.isChild(ctx.proj) ? <window.ShortsSourceCard ctx={ctx} /> : <window.ShortsMadeGroup ctx={ctx} />}<window.VideoLibrary ctx={ctx} onImport={importOne} /></>);

    /* 选中一句配音 → 这一栏落在「编辑配音句」（2026-09-23）：时间轴上单点一块、素材库里点一行都到这里；
       多选（⌘ / ⇧）只选不翻页。返回 = 清掉选中、回到列表。 */
    if (kind === 'audio' && ctx.dubSel && ctx.dubSel.ids.length === 1 && !ctx.paneView && view === 'project') {
      const d = (ctx.dubs || []).find((x) => x.lang === ctx.dubSel.lang);
      const b = d && (d.blocks || []).find((x) => x.id === ctx.dubSel.ids[0]);
      if (d && b) return <window.DubSentenceProps key={b.id} ctx={ctx} d={d} b={b} onBack={() => ctx.clearDubSel()} />;
    }

    // 音频 Tab 的两个子页（§13.6）：生成语音 / 克隆声音，同一张表单两个默认
    if (window.BC_SURFACE.ai && kind === 'audio' && (ctx.paneView === 'tts' || ctx.paneView === 'tts-clone')) {
      return <window.TtsPanel key={ctx.paneView} ctx={ctx} clone={ctx.paneView === 'tts-clone'} />;
    }

    if (kind === 'audio' && view === 'stock') return frame(<window.StockPane ctx={ctx} kind="audio" onDetailChange={setStockDetail} />);

    return frame(
        <div className="pscroll bc-scroll">
          {kind === 'audio' ? (
            <>
            {/* 翻译配音不再从这里启动（2026-09-16）：它的家是 AI 工具（§15.6）。音频 Tab 只放产物——
                下面「视频音频」里一种语言一组；没有配音时在组头位置留一行指路，有了就在组下给一颗安静按钮 */}
            <div className="mact">
              <Btn variant="secondary" size="s" icon="upload" onClick={importOne}>导入</Btn>
              {/* 生成语音 / 克隆声音是 AI 入口：Web 表面只留导入（model-surface.js） */}
              {window.BC_SURFACE.ai ? <Btn variant="secondary" size="s" icon="wave" onClick={() => ctx.setPaneView('tts')}>生成语音</Btn> : null}
              {window.BC_SURFACE.ai ? <Btn variant="secondary" size="s" icon="mic" onClick={() => ctx.setPaneView('tts-clone')}>克隆声音</Btn> : null}
            </div>
            </>
          ) : null}
          <div className={cx('drop media-library-drop', over && 'is-over')}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); importOne(); }}
            onClick={importOne}>
            <Ic n="upload" className="ic--26" />
            <span className="drop__t">{k.drop}</span>
            <span className="t-detail-xs">点一下也能选文件 · {k.accept}</span>
          </div>

          <window.SecHead aside={shape ? window.BC_DUB.audioAside(shape) : `${list.length} 个文件`}>{k.sec}</window.SecHead>
          {shape ? shape.groups.map((g) => (
            <AudioGroup key={g.lang} g={g} ctx={ctx} open={!!openG[g.lang]}
              onToggle={() => setOpenG((m) => ({...m, [g.lang]: !m[g.lang]}))} />
          )) : null}
          {archive && archive.groups.length ? (
            <window.DubArchiveGroup ctx={ctx} shape={archive} open={!!openG.__archive}
              onToggle={() => setOpenG((m) => ({...m, __archive: !m.__archive}))} />
          ) : null}
          {window.BC_SURFACE.ai && kind === 'audio' && shape && shape.groups.length ? (
            <div className="row gap8" style={{padding: '2px 12px 8px'}}>
              <Btn variant="secondary" size="s" icon="translate" onClick={() => ctx.requestAi('dub')}>再配一种语言</Btn>
              <span className="t-detail-xs">已配 {shape.groups.length} 种</span>
            </div>
          ) : null}
          {window.BC_SURFACE.ai && kind === 'audio' && !(shape && shape.groups.length) ? (
            <div className="hint hint--tight">要让视频用另一种语言开口，打开<BCAction className="stlink" onClick={() => ctx.requestAi('dub')}>翻译配音</BCAction>；配好的每种语言在这里各成一组。</div>
          ) : null}
          {!list.length
            ? (shape && shape.groups.length ? null
              : <Empty title="素材库里还没有这一类文件">拖进来，或者点上面的区域选文件。</Empty>)
            : kind === 'image'
              ? <div className="igrid">
                  {list.map((s) => <ImageCard key={s.id} s={s} ctx={ctx} onAgain={imageSeg ? againFromSource : null} />)}
                </div>
              : list.map((s) => <FileCard key={s.id} src={s} kind={kind} ctx={ctx}
                  preview={play && play.id === s.id ? play : null}
                  onPreview={(id) => setPlay(id ? {id, t: 0} : null)} />)}

          <div className="signpost">
            <b>导入只把文件收进素材库</b>；放到画布或时间轴是另一步，同一个素材可以用很多次。
          </div>
        </div>
    );
  }

  Object.assign(window, {MediaPanel, MediaFileCard: FileCard, MediaSourceMenu: MediaMenu});
})();
