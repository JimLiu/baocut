/* 在线素材 —— Video / Audio Tab 顶部分段的另一半（`docs/design/editor/bcut-stock-assets-design.md` §9）。

   一句话定位：Stock **不是第四个 Tab**，它是项目素材库的一个**来源**。检索出来的
   东西一旦导入，后面的一切（时间轴、导出、撤销）都不知道它是从网上来的。

   这里只有壳：解析一句话、判面板状态、筛选记账、许可三值判定全在 `model-stock.js`
   （与 App v2 的 `bcut-editor-core::stock_pane` 同一套语义）。原型不连真实平台，
   候选是夹具且每条都标「演示」。 */
(function () {
  const {useState, useEffect, useRef, useMemo} = React;
  const S = window.BC_STOCK;
  const T = window.BC_TIME;
  const V = window.BC_VIDEO_LIBRARY;

  const KINDNAME = {video: '视频', audio: '音频'};
  const PLACEHOLDER = {
    video: '夜晚城市航拍，竖屏，10 秒以内',
    audio: '适合讲解的轻快背景乐，无人声',
  };

  /* ---------- 小件 ---------- */

  function VerdictTag({verdict}) {
    const v = S.VERDICT[verdict] || S.VERDICT.unverified;
    return <span className={cx('stk-verdict', 'stk-verdict--' + verdict)}
      title={verdict === 'unverified' ? '来源没给足够依据，用前请到原站核实' : null}>{v.label}</span>;
  }

  /** 逐条记账落成一行字：验过哪几项、哪几项没验成。缺元数据不算验过。 */
  function MatchLine({hit}) {
    const r = hit.matchReport;
    if (!r.verified.length && !r.unverified.length) return null;
    const name = (k) => S.LABELS[k] || k;
    return <span className="stk-match">
      {r.verified.length ? <span className="stk-match__ok"><Ic n="check" className="ic--12" />{r.verified.map(name).join(' · ')}</span> : null}
      {r.unverified.length ? <span className="stk-match__no">{r.unverified.map(name).join(' · ')}未验证</span> : null}
    </span>;
  }

  /** 波形只画真数据：夹具没有峰值，所以画一条普通进度条，不伪造起伏。 */
  const AudioBar = ({pct}) => <span className="stk-abar"><i style={{width: (pct || 0) + '%'}} /></span>;

  /* ---------- 结果行 ---------- */

  function StockRow({hit, kind, busy, playing, onOpen, onImport, onPlace, onPreview}) {
    const app = useApp();
    const {asset, rendition} = hit;
    const [pop, setPop] = useState(false);
    const provider = S.providerOf(asset.providerId);
    const blocked = hit.verdict === 'not-allowed' || !rendition;
    return <article className={cx('stk-row', kind === 'audio' && 'stk-row--audio')} aria-label={asset.title}>
      {kind === 'audio' ? (
        <BCAction className={cx('stk-thumb', 'stk-thumb--btn', playing && 'is-playing')}
          title={playing ? '停止试听' : '试听这段音频'} onClick={() => onPreview(playing ? null : asset.assetId)}>
          <Ic n={playing ? 'pause' : 'play'} className="ic--20" />
          <AudioBar pct={playing ? playing.pct : 0} />
        </BCAction>
      ) : (
        <BCAction className="stk-thumb" title={`打开 ${asset.title}`} onClick={() => onOpen(asset)}
          /* @ds-allow: 缩略图画的是素材本身的画面，不是 S2 表面 */
          style={{background: asset.grad}}>
          {asset.spec.durationSec ? <span className="stk-dur">{T.timecode(asset.spec.durationSec, {decimals: 0})}</span> : null}
        </BCAction>
      )}
      <div className="stk-info">
        <b className="stk-name" title={asset.title}>{asset.title}
          {asset.demo ? <Chip>演示</Chip> : null}</b>
        <span className="stk-meta">{provider ? provider.label : asset.providerId}
          {asset.origin.author && asset.origin.author.name ? ' · ' + asset.origin.author.name : ''}
          {' · ' + S.metaLine(asset, rendition)}</span>
        <span className="stk-line"><VerdictTag verdict={hit.verdict} /><MatchLine hit={hit} /></span>
        <span className="stk-act">
          <Btn size="s" variant="secondary" disabled={blocked || busy} onClick={() => onImport(hit)}>导入</Btn>
          <Btn size="s" variant="secondary" disabled={blocked || busy} onClick={() => onPlace(hit)}>添加到时间轴</Btn>
          <span className="grow" />
          <div style={{position: 'relative'}}>
            <IconBtn icon="more" size="s" tip={`更多 · ${asset.title}`} on={pop} onClick={() => setPop((v) => !v)} />
            <Popover open={pop} onClose={() => setPop(false)} align="right" dir="up" width={200}>
              <Menu>
                <MenuItem icon="info" label="查看详情" onClick={() => { setPop(false); onOpen(asset); }} />
                <MenuItem icon="web" label="查看来源页" sub={asset.origin.site} onClick={() => {
                  setPop(false); app.toast('原型不外开链接 · ' + asset.origin.pageUrl);
                }} />
                <MenuItem icon="copy" label="复制来源链接" onClick={async () => {
                  setPop(false); const ok = await copyToClipboard(asset.origin.pageUrl || '');
                  app.toast(ok ? '已复制来源链接' : '复制失败，请重试', ok ? 'positive' : 'negative');
                }} />
                <MenuItem icon="lock" label="查看许可"
                  sub={rendition ? (S.LICENSES[rendition.license] || {}).label : '这条没有可用版本'}
                  onClick={() => { setPop(false); onOpen(asset); }} />
              </Menu>
            </Popover>
          </div>
        </span>
      </div>
    </article>;
  }

  /* ---------- 详情子页（§9.1：钻子页时 Tab 标题栏让位，只有一条返回路径） ---------- */

  function StockDetail({hit, kind, usage, costPolicy, busy, onBack, onImport, onPlace}) {
    const app = useApp();
    const {asset} = hit;
    const provider = S.providerOf(asset.providerId);
    const spec = asset.spec;
    const rows = [
      ['来源', provider ? provider.label : asset.providerId],
      ['原始站点', asset.origin.site || '未知'],
      ['作者', (asset.origin.author && asset.origin.author.name) || '未知'],
      ['时长', spec.durationSec !== null && spec.durationSec !== undefined ? T.timecode(spec.durationSec, {decimals: 1}) : '未知'],
      ['尺寸', spec.width && spec.height ? spec.width + ' × ' + spec.height : '未知'],
      ['帧率', spec.fps ? spec.fps + ' fps' : '未知'],
      ['声音', spec.hasAudio === null || spec.hasAudio === undefined ? '未知' : spec.hasAudio ? '有' : '无'],
    ];
    return <>
      <window.PanelHead title="素材详情" onBack={onBack} backTip="返回在线素材" />
      <div className="pscroll bc-scroll">
        {kind === 'video'
          /* @ds-allow: 预览块画的是素材本身的画面，不是 S2 表面 */
          ? <div className="stk-hero" style={{background: asset.grad}} />
          : <div className="stk-hero stk-hero--audio"><Ic n="wave" className="ic--26" /></div>}
        <div className="stk-head">
          <b>{asset.title}{asset.demo ? <Chip>演示</Chip> : null}</b>
          <span>{asset.tags.join(' · ')}</span>
        </div>
        <window.SecHead>规格</window.SecHead>
        <dl className="stk-specs">
          {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
        <window.SecHead aside="许可挂在版本上，不在卡级别写一个">版本与许可</window.SecHead>
        {asset.renditions.map((r) => {
          const verdict = S.evaluate(r.license, usage);
          const lic = S.LICENSES[r.license] || {};
          const affordable = costPolicy !== 'free-only' || r.cost === 'free';
          return <div key={r.id} className="stk-rend">
            <div className="stk-rend__hd">
              <b>{r.id}</b>
              <span>{[r.format.toUpperCase(), r.width && r.height ? r.width + '×' + r.height : null, S.bytesText(r.bytesEstimate)].filter(Boolean).join(' · ')}</span>
              <span className="grow" />
              {r.cost === 'free' ? <Chip>免费</Chip> : <Chip>付费</Chip>}
              <VerdictTag verdict={verdict} />
            </div>
            <div className="stk-rend__lic">
              {lic.label || r.license}
              {lic.attributionRequired ? ' · 需要署名' : ''}
              {!affordable ? ' · 当前只用免费版本' : ''}
              {lic.textUrl ? <BCAction className="stlink" onClick={() => app.toast('原型不外开链接 · ' + lic.textUrl)}>许可原文</BCAction> : null}
            </div>
          </div>;
        })}
        <div className="hint hint--tight">
          许可判定是 <b>（许可 × 用途档）</b>，不是一个「可商用」的布尔值。当前用途是「{S.usageLabel(usage)}」。
          视频里存了许可记录 <b>不等于</b>已经完成了需要公开展示的署名；这套记录用于追溯与辅助检查，不是版权担保。
        </div>
        <div className="mact">
          <Btn variant="primary" size="s" disabled={busy || hit.verdict === 'not-allowed'} onClick={() => onImport(hit)}>导入</Btn>
          <Btn variant="secondary" size="s" disabled={busy || hit.verdict === 'not-allowed'} onClick={() => onPlace(hit)}>添加到时间轴</Btn>
        </div>
      </div>
    </>;
  }

  /* ---------- 站外桥接（§3.2 阶段一）：不得包装成「已支持 Mixkit 搜索」 ---------- */

  const TIERS = {
    video: [{k: 'mixkit-video-free', label: 'Free 档', sub: '免费许可，覆盖网络视频与播客'},
      {k: 'mixkit-video-restricted', label: 'Restricted 档', sub: '逐条附加限制，需要署名；判定落「未确认」'}],
    audio: [{k: 'mixkit-music-free', label: '音乐免费许可', sub: '允许播客 / 社媒 / 网络广告；不允许电视广播、电子游戏与 CD/DVD'}],
  };

  function ExternalCard({cap, kind, query, onLocalImport}) {
    const app = useApp();
    const [ask, setAsk] = useState(false);
    const [tier, setTier] = useState(TIERS[kind][0].k);
    return <section className="stk-ext" aria-label={cap.label}>
      <div className="stk-ext__hd"><b>{cap.label}</b><Chip>站外</Chip></div>
      <p className="stk-ext__t">{cap.note}</p>
      <div className="mact">
        <Btn variant="secondary" size="s" icon="web" onClick={() => app.toast('原型不外开链接 · ' + S.externalSearchUrl(cap, kind, query))}>前往网站搜索</Btn>
        <Btn variant="secondary" size="s" icon="upload" onClick={() => setAsk(true)}>导入已下载素材</Btn>
      </div>
      <Dialog open={ask} title="导入已下载素材" width={440} onClose={() => setAsk(false)}
        footer={<>
          <Btn variant="secondary" onClick={() => setAsk(false)}>取消</Btn>
          <Btn variant="primary" onClick={() => { setAsk(false); onLocalImport(tier); }}>选择文件并导入</Btn>
        </>}>
        <p className="t-detail">这条素材是你自己从 {cap.label} 下载的，BaoCut 不知道它的许可档。选一档，导入后记进来源记录；选错了，导出时的署名与用途检查就是错的。</p>
        <window.RSP.RadioGroup aria-label="素材许可" value={tier} onChange={setTier}>
          {TIERS[kind].map(t => <window.RSP.Radio key={t.k} value={t.k} description={t.sub}>{t.label}</window.RSP.Radio>)}
        </window.RSP.RadioGroup>
      </Dialog>
    </section>;
  }

  /* ---------- 来源状态（§9.3：每个来源为什么没出结果都要能看见） ---------- */

  function SourceList({caps, outcomes, disabled, onToggle}) {
    const byId = Object.fromEntries((outcomes || []).map((o) => [o.providerId, o]));
    return <Menu>
      <MenuHead>这一类的来源</MenuHead>
      {caps.map((cap) => {
        const base = S.providerOf(cap.id);
        const off = !!(disabled || {})[cap.id];
        const line = S.outcomeLine(byId[cap.id] || {status: S.statusOf(cap), returned: 0, filteredOut: 0});
        return <div key={cap.id} className="stk-src">
          <span className="stk-src__nm"><b>{base.label}</b><em>{off ? '已关闭' : line}</em></span>
          <Switch on={!off} disabled={base.search === 'disabled'} ariaLabel={`启用 ${base.label}`}
            onChange={() => onToggle(cap.id)} />
        </div>;
      })}
      <MenuRule />
      <MenuHead>密钥与配额在设置里按来源单独管</MenuHead>
    </Menu>;
  }

  /* ---------- 主视图 ---------- */

  function StockPane({ctx, kind, head, onDetailChange}) {
    const app = useApp();
    const [raw, setRaw] = useState('');
    const [query, setQuery] = useState('');
    const [searching, setSearching] = useState(false);
    const [result, setResult] = useState(null);
    const [disabled, setDisabled] = useState({});
    const [usage, setUsage] = useState('online-video');
    const [freeOnly, setFreeOnly] = useState(true);
    const [pop, setPop] = useState(null);
    const [detail, setDetail] = useState(null);
    useEffect(() => { onDetailChange?.(!!detail); return () => onDetailChange?.(false); }, [detail, onDetailChange]);
    const [job, setJob] = useState(null);           // 获取任务：{assetId, step, phase}
    const [play, setPlay] = useState(null);         // 试听：{id, pct}，一次只有一个
    const [viewport, setViewport] = useState({top: 0, height: 520});
    const scroll = useRef(null), timer = useRef(null), jobTimer = useRef(null);

    const costPolicy = freeOnly ? 'free-only' : 'any';
    const caps = useMemo(() => S.capabilitiesFor(kind, disabled), [kind, disabled]);
    const hits = result ? result.hits : [];
    const state = S.paneState(caps, kind, searching, hits.length);

    // 换 Tab / 改筛选条件就作废上一轮结果：留着它会让人以为新条件已经生效
    useEffect(() => { setResult(null); setDetail(null); setPlay(null); }, [kind, usage, freeOnly, disabled]);
    useEffect(() => () => { clearTimeout(timer.current); clearInterval(jobTimer.current); }, []);
    useEffect(() => {
      if (!play) return undefined;
      const tick = setInterval(() => setPlay((p) => (p && p.pct < 100 ? {...p, pct: p.pct + 4} : null)), 200);
      return () => clearInterval(tick);
    }, [play && play.id]);

    const run = (text) => {
      const q = text === undefined ? raw : text;
      clearTimeout(timer.current);
      setQuery(q); setSearching(true); setDetail(null);
      // 检索在飞是一种状态：壳知道请求有没有回来，纯层不猜
      timer.current = setTimeout(() => {
        setResult(S.search(kind, q, {disabled, usageProfile: usage, costPolicy}));
        setSearching(false);
      }, 420);
    };

    /* 获取流水线（§6.2）：落点在**点击时**冻结，不是下载完再读当前播放头。
       许可与花费两道闸在下载之前过；阶段走完才落项目素材。 */
    const acquire = (hit, place) => {
      const plan = S.acquirePlan(hit.asset, hit.rendition, usage, costPolicy);
      if (!plan.ok) {
        const issue = S.ISSUE_TEXT[plan.code];
        app.toast(issue.title + (issue.action ? ' · ' + issue.action : ''), 'negative');
        return;
      }
      const frozen = {playT: ctx.playT, projId: ctx.proj.id};
      let index = 0;
      setJob({assetId: hit.asset.assetId, step: 0});
      clearInterval(jobTimer.current);
      jobTimer.current = setInterval(() => {
        index += 1;
        if (index < S.ACQUIRE_STEPS.length) { setJob({assetId: hit.asset.assetId, step: index}); return; }
        clearInterval(jobTimer.current);
        setJob(null);
        if (ctx.proj.id !== frozen.projId) { app.toast(S.ISSUE_TEXT.project_changed.title, 'negative'); return; }
        finish(hit, place, frozen);
      }, 260);
    };

    const finish = (hit, place, frozen) => {
      const {asset, rendition} = hit;
      const n = ctx.nextSeq();
      const ext = (rendition && rendition.format) || (kind === 'video' ? 'mp4' : 'mp3');
      const src = {
        id: 'stk' + n,
        name: asset.title.replace(/\s+/g, '-') + '.' + ext,
        meta: S.metaLine(asset, rendition),
        dur: asset.spec.durationSec || (kind === 'video' ? 8 : 0),
        badge: '在线素材',
        grad: asset.grad,
      };
      if (kind === 'audio' && !(src.dur > 0.1)) { app.toast('无法读取音频时长，没有导入', 'negative'); return; }
      ctx.addSource(kind, src);
      if (!place) {
        app.toast(`已导入 ${src.name} · 还没放到时间轴上`, 'positive');
        return;
      }
      const element = window.BC_MEDIA.placement(kind + '-' + n, kind, src, frozen.playT);
      if (!element) { app.toast('无法读取时长，只导入了素材库', 'negative'); return; }
      // putSource + addElement 是同一步撤销（§6.6）
      ctx.addElement(element);
      ctx.setTab(kind);
      app.toast(kind === 'audio' ? '已添加音频到时间轴' : '已添加到画布和时间轴', 'positive');
    };

    if (detail) {
      const hit = hits.find((h) => h.asset.assetId === detail) || null;
      if (hit) return <StockDetail hit={hit} kind={kind} usage={usage} costPolicy={costPolicy}
        busy={!!job} onBack={() => setDetail(null)}
        onImport={(h) => acquire(h, false)} onPlace={(h) => acquire(h, true)} />;
    }

    const external = caps.filter((c) => S.externalOnly(c));
    const visible = V.windowFor(hits.length, viewport.top, viewport.height);

    return <>
      {head}
      <div className="stk-pane">
      <div className="stk-search">
        <Field size="s" icon="search" value={raw} placeholder={PLACEHOLDER[kind]}
          onChange={(e) => setRaw(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(); }} />
        <Btn size="s" variant="primary" onClick={() => run()}>搜索</Btn>
      </div>
      <div className="stk-filters">
        <Picker size="s" label="来源" value={`来源 ${caps.filter((c) => !disabled[c.id]).length}/${caps.length}`}
          open={pop === 'src'} onClick={() => setPop(pop === 'src' ? null : 'src')} onClose={() => setPop(null)} popWidth={280}>
          <SourceList caps={caps} outcomes={result ? result.providers : null} disabled={disabled}
            onToggle={(id) => setDisabled((d) => ({...d, [id]: !d[id]}))} />
        </Picker>
        <Picker size="s" label="用途" value={S.usageLabel(usage)}
          open={pop === 'use'} onClick={() => setPop(pop === 'use' ? null : 'use')} onClose={() => setPop(null)} popWidth={240}>
          <Menu>
            <MenuHead>许可按这一档判</MenuHead>
            {S.USAGE.map((u) => <MenuItem key={u.k} label={u.label} sub={u.sub} icon={usage === u.k ? 'check' : 'blank'}
              onClick={() => { setPop(null); setUsage(u.k); }} />)}
          </Menu>
        </Picker>
        <label className="stk-free">
          <Switch on={freeOnly} onChange={setFreeOnly} ariaLabel="只显示免费版本" />
          <span>仅免费版本</span>
        </label>
      </div>
      {result && result.intent ? <IntentLine intent={result.intent} /> : null}

      <div ref={scroll} className="stk-list bc-scroll" aria-label={`在线${KINDNAME[kind]}结果`}
        onScroll={(e) => setViewport({top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight})}>
        {state === 'needs-setup' ? (
          <Empty icon="web" title={`这一类还没有可用的来源`}>
            密钥、配额与授权状态在设置里按来源单独管。没有来源不等于没有结果——这里不显示空结果。
          </Empty>
        ) : null}
        {state === 'searching' ? <div className="stk-busy"><Progress indeterminate /><span>正在向 {caps.filter(S.searchable).length} 个来源检索…</span></div> : null}
        {state === 'empty' ? (
          <Empty icon="search" title={query ? '这一轮没有匹配的候选' : `搜索在线${KINDNAME[kind]}`}>
            {query ? '换个说法，或放宽上面的筛选条件。下面每个来源都写了它这一轮的状态。' : '打一句话就行，时长、画幅、分辨率这些会被认出来当筛选条件。'}
          </Empty>
        ) : null}
        {state === 'external-only' ? (
          <Empty icon="web" title="这一类只有站外来源">能内嵌检索的来源都关着。站外来源要到原网站搜索与下载，这与「没有搜索结果」是两件事。</Empty>
        ) : null}

        {state === 'results' ? <div className="stk-virtual" style={{height: visible.height}}>
          {hits.slice(visible.start, visible.end).map((hit, i) => <div className="stk-slot" key={hit.asset.providerId + ':' + hit.asset.assetId}
            style={{top: (visible.start + i) * V.ROW_HEIGHT}}>
            <StockRow hit={hit} kind={kind} busy={!!job}
              playing={play && play.id === hit.asset.assetId ? play : null}
              onPreview={(id) => setPlay(id ? {id, pct: 0} : null)}
              onOpen={(asset) => setDetail(asset.assetId)}
              onImport={(h) => acquire(h, false)} onPlace={(h) => acquire(h, true)} />
          </div>)}
        </div> : null}

        {job ? <div className="stk-job">
          <Progress value={(job.step + 1) / S.ACQUIRE_STEPS.length * 100} thin />
          <span>{S.ACQUIRE_STEPS[job.step].label} · 第 {job.step + 1}/{S.ACQUIRE_STEPS.length} 步</span>
        </div> : null}

        {result ? <>
          <window.SecHead aside="每个来源这一轮的状态">来源</window.SecHead>
          <ul className="stk-outcomes">
            {result.providers.map((o) => {
              const cap = S.providerOf(o.providerId);
              return <li key={o.providerId} className={cx(o.status !== 'ok' && 'is-off')}>
                <b>{cap.label}</b><span>{S.outcomeLine(o)}</span>
              </li>;
            })}
          </ul>
        </> : null}

        {external.map((cap) => <ExternalCard key={cap.id} cap={cap} kind={kind} query={query}
          onLocalImport={(tier) => {
            const lic = S.LICENSES[tier];
            const n = ctx.nextSeq();
            ctx.addSource(kind, {id: 'stk' + n, name: `mixkit-${n}.${kind === 'video' ? 'mp4' : 'mp3'}`,
              meta: (kind === 'video' ? '1920 × 1080' : '02:11 · 48 kHz') + ' · ' + lic.label,
              dur: kind === 'video' ? 12 : 131, badge: '在线素材'});
            app.toast(`已导入 · 许可记为「${lic.label}」`, 'positive');
          }} />)}

        <div className="signpost">
          <b>检索与试听不改视频</b>；导入才把文件收进素材库，放到时间轴是另一步。演示候选是夹具，不是真实平台响应。
        </div>
      </div>
      </div>
    </>;
  }

  /** 解析结果摊开给人看：哪几个词被当成了筛选条件、哪几个只能当偏好。 */
  function IntentLine({intent}) {
    const parts = [];
    const h = intent.hard;
    if (h.minDurationSec !== null) parts.push('至少 ' + h.minDurationSec + ' 秒');
    if (h.maxDurationSec !== null) parts.push('最多 ' + h.maxDurationSec + ' 秒');
    if (h.orientation) parts.push({portrait: '竖屏', landscape: '横屏', square: '方形'}[h.orientation]);
    if (h.minHeight) parts.push(h.minHeight + 'p 起');
    if (h.audioCategory) parts.push({music: '音乐', sfx: '音效', ambience: '环境声'}[h.audioCategory]);
    if (!parts.length && !intent.soft.length) return null;
    return <div className="stk-intent">
      {parts.length ? <span><Ic n="tune" className="ic--12" />{parts.join(' · ')}</span> : null}
      {intent.soft.length ? <span className="stk-intent__soft">{intent.soft.join(' · ')}：只当偏好排序，没法验证</span> : null}
    </div>;
  }

  Object.assign(window, {StockPane});
})();
