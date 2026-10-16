/* 设置 › 本地模型 —— §17.3（2026-09-13 分类重排）。
   按能力分类显示默认模型、已安装与可下载列表；公共组件与下载存储收进折叠区，
   已安装模型缺少公共组件时自动展开。公共组件不单独装（2026-10-08）：缺的那一行「下载」借一只装着、用到它的
   模型去补齐，先确认要下的，进度同时显示在那只模型行与这一行；没有装着的模型用它时不给按钮，写「装模型时一起下载」。只有一只模型
   用的组件跟着那只模型的展开区走。算法全在 `BC_LOCALMODELS`，这里只画。
   下载与补齐确认后交给 store 的 `downloadModel`（2026-10-16）：落一条后台任务，离开设置页照样下完；结局记在 `app.modelEnd`。
   语音合成行只写能拿它做什么（出声方式 / 要不要录音 / 情绪 / 语言 / 体积），仓库名、语速库与组成
   收进展开区；装好后点「试听」展开试听面板，选好再点「生成试听」（`TtsQuickTest`）。
   音乐生成行（2026-10-11）与语音合成同一种「试听」展开面板（MusicQuickTest）。
   「检查」与「试听 / 试画」是两件事（2026-10-05，BC_LOCALCHECK）：试用是行上的主操作，检查在 ⋯ 里紧挨「修复…」，
   没有试用的能力在行上另有一个安静的「检查」；健康只写在行上那一条状态里（ModelCheckLine）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const LM = window.BC_LOCALMODELS;
  const TTS = window.BC_TTS;
  const CK = window.BC_LOCALCHECK;
  const MD = window.BC_MODELSDIR;
  const mb = LM.mb;

  /* 组件 / 权重的一行状态：✓ 已装 或 ⚠ 缺 · 体积 */
  function PartLine({name, desc, on, size}) {
    return (
      <div className="lmpart">
        <Ic n={on ? 'ok' : 'alert'} className={cx('ic--14', on ? 'lmpart__ok' : 'lmpart__miss')} />
        <span className="lmpart__nm">{name}{desc ? <span className="t-detail-xs"> · {desc}</span> : null}</span>
        <span className="t-detail-xs">{on ? '已装 · ' + mb(size) : '缺 · ' + mb(size)}</span>
      </div>
    );
  }

  function SharedCard({shared, models, comps, on, dl, onGet}) {
    if (!shared.length) return null;
    return (
      <div className="lmshared">
        <div className="lmshared__hd">
          <span className="t-detail-xs">这一类的多只模型共用，装一次就够；最后一只用它的模型删除时一起回收。</span>
        </div>
        {shared.map((c) => {
          const act = LM.compAction(c, models, comps, on);
          // 用到它的模型正在下载（这里点的补齐或行上的下载 / 补齐）：缺的组件跟着那只模型下，显示同一个进度
          const busy = on[c.id] ? null : models.find((m) => dl[m.id] >= 0 && (m.uses || []).includes(c.id));
          return (
            <div className="lmshared__row" key={c.id}>
              <Ic n={on[c.id] ? 'ok' : 'alert'} className={cx('ic--14', on[c.id] ? 'lmpart__ok' : 'lmpart__miss')} />
              <span className="grow lmrow__txt">
                <span className="t-ui">{c.name}</span>
                <span className="t-detail-xs">{c.desc} · {LM.compUsage(c, models, on)}</span>
              </span>
              {busy ? <div className="lmrow__pg"><Progress value={dl[busy.id]} /></div>
                : act.kind === 'installed' ? <span className="t-detail-xs">已装 · {mb(c.size)}</span>
                : act.kind === 'get' ? <Btn variant="secondary" size="s" icon="download" onClick={() => onGet(act)}>下载 {mb(c.size)}</Btn>
                : <span className="t-detail-xs">装模型时一起下载 · {mb(c.size)}</span>}
            </div>
          );
        })}
      </div>
    );
  }

  /* away：权重下载时放在了模型目录之外的文件夹（下载确认框的「存放位置」），没有时 null */
  function ModelRow({row, cat, on, comps, dflt, pct, fail, away, onDownload, onRemove, onWork}) {
    const app = useApp();
    const {m, own, common} = row;
    const cmap = {};
    comps.forEach((c) => { cmap[c.id] = c; });
    const ready = LM.ready(m, comps, on);
    const half = LM.half(m, comps, on);
    const lack = LM.missing(m, comps, on);
    const [open, setOpen] = useState(false);
    const [pop, setPop] = useState(false);
    const [test, setTest] = useState(false);
    // 「克隆新音色…」的回程：试听面板只在点过「试听」后才在，回来时先把它展开，认领的是面板自己
    const handoff = app.voiceHandoff;
    useEffect(() => {
      if (handoff && handoff.voiceId && handoff.key === 'quick:' + m.id) setTest(true);
    }, [handoff]);
    // 「检查」：这只模型能不能正常工作，结果只写在行上那一条状态里（settings-model-check.jsx，说法在 BC_LOCALCHECK）
    const [check, setCheck] = useState(() => (m.id === 'moss-transcribe' && ready ? {phase: 'passed', at: Date.now() - 2 * 60 * 1000} : {phase: 'idle'}));
    const checkNow = useRef(check);
    checkNow.current = check;
    const checkBefore = useRef(null);   // 取消时回到检查前的状态
    const ckTimer = useRef(null);
    const checkBusy = check.phase === 'checking' || check.phase === 'repairing';
    // 图像生成行的「试画」走共用对话框（image-gen.jsx ImageProbeDialog）：能改提示词、看结果图、下载；不算检查
    const [imgProbe, setImgProbe] = useState(false);
    useEffect(() => () => { clearInterval(ckTimer.current); }, []);
    // 下载 / 检查 / 修复期间模型目录不能改（settings-models-dir.jsx 读这张表）
    const working = pct >= 0 || check.phase === 'repairing' ? 'downloading' : check.phase === 'checking' ? 'testing' : null;
    useEffect(() => { onWork(m.id, working); }, [working]);
    useEffect(() => () => onWork(m.id, null), []);
    useEffect(() => { if (half) setOpen(true); }, [half]);
    useEffect(() => { if (!ready) { setTest(false); clearInterval(ckTimer.current); setCheck({phase: 'idle'}); } }, [ready]);
    const brief = cat === 'tts' ? TTS.modelBrief(m.id) : null;
    // 不许商用的权重（OmniVoice、Qwen-Image-2.1 与 Turbo，data.js 该行 `license.commercialUse: false`）：行上标「仅限非商用」、写许可提要，
    // 下载确认框里写许可（download-dialog.jsx）；权重已在、只补齐组件时不再写
    const lic = window.ttsLicenseOf ? window.ttsLicenseOf(m.id) : null;
    const lics = LM.licenseLines(m, comps);
    // 说话人区分包自己不跑任务，没有检查：行上与 ⋯ 里都不给（修复照常）
    const checkable = !m.pack;

    // 下载进度在 store（app.modelDl，后台任务跟着它走）；公共组件那一行借这只模型补齐时显示同一个进度
    // 下载与补齐都先过下载确认框（download-dialog.jsx）：大小、来源（可就地换），确认后才下
    const download = () => onDownload(m);
    /* 检查：结果由原型开关「下次检查的结果」决定（shell.jsx TweaksPanel）；修复之后那一次总是通过 */
    const remember = () => {
      const c = checkNow.current;
      if (c.phase !== 'checking' && c.phase !== 'repairing') checkBefore.current = c;
    };
    const runCheck = (afterRepair) => {
      remember();
      const demo = afterRepair ? 'pass' : (app.prefs.modelCheckDemo || 'pass');
      clearInterval(ckTimer.current);
      setCheck({phase: 'checking', pct: 0});
      let p = 0;
      ckTimer.current = setInterval(() => {
        p += 6;
        if (p < 100) { setCheck({phase: 'checking', pct: p}); return; }
        clearInterval(ckTimer.current);
        setCheck(CK.finish(demo, m, cat, Date.now()));
      }, 120);
    };
    const repair = () => app.confirm({
      title: `修复「${m.name}」？`,
      body: `找出坏掉或缺失的文件，只重新下载这些（这次约 ${mb(Math.round(m.size * 0.24))}），完好的文件不动。修好后会自动再检查一次。`,
      confirmLabel: '修复',
      run: () => {
        remember();
        clearInterval(ckTimer.current);
        setCheck({phase: 'repairing', pct: 0});
        let p = 0;
        ckTimer.current = setInterval(() => {
          p += 8;
          if (p < 100) { setCheck({phase: 'repairing', pct: p}); return; }
          clearInterval(ckTimer.current);
          runCheck(true);
        }, 120);
      },
    });
    const onCheck = (k) => {
      if (k === 'cancel') { clearInterval(ckTimer.current); setCheck(checkBefore.current || {phase: 'idle'}); }
      else if (k === 'repair') repair();
      else if (k === 'recheck' || k === 'check') runCheck();
    };
    const paceLangs = cat === 'tts' && !(brief && brief.dubOnly) && TTS.PACE_SEED[m.id] ? Object.keys(TTS.PACE_SEED[m.id]) : [];

    return (
      <div className="lmrow">
        <div className="lmrow__main">
          <IconBtn icon={open ? 'chevdown' : 'chevright'} size="xs" tip={open ? '收起详情' : '详情'} onClick={() => setOpen((v) => !v)} />
          <span className="grow lmrow__txt">
            <span className="lmrow__name">
              <b className="t-ui t-strong">{m.name}</b>
              {dflt ? <Chip tone="accent">默认</Chip> : null}
              {half ? <Chip tone="notice">缺 {lack.map((x) => x.name).join('、')}</Chip> : null}
              {lic ? <Chip tone="notice">仅限非商用</Chip> : null}
            </span>
            {brief ? (
              <>
                <span className="t-detail">{brief.summary}</span>
                <span className="t-detail-xs">{brief.facts.concat(mb(m.size)).join(' · ')}</span>
              </>
            ) : <span className="t-detail-xs">{m.note ? m.note + ' · ' : ''}{mb(m.size)}</span>}
            {lic ? <span className="t-detail-xs">{window.ttsLicenseBrief(lic)}</span> : null}
            {away ? <span className="t-detail-xs lmrow__away" title={away}>存放在 {MD.shorten(away, 44)} · 不在模型目录</span> : null}
          </span>
          {pct >= 0 ? <div className="lmrow__pg"><Progress value={pct} /></div> : (
            <>
              {ready && (cat === 'tts' || cat === 'music')
                ? <Btn variant={test ? 'secondary' : 'accent'} size="s" onClick={() => setTest((v) => !v)}>{test ? CK.tryOf(cat).hide : CK.tryOf(cat).label}</Btn>
                : null}
              {ready && cat === 'image'
                ? <Btn variant="accent" size="s" onClick={() => setImgProbe(true)}>{CK.tryOf('image').label}</Btn> : null}
              {/* 没有试用的能力：检查在行上露一个安静的按钮；有试用的能力，检查只在 ⋯ 里 */}
              {ready && checkable && CK.checkOnRow(cat) ? (
                <Tip label={CK.LABEL.checkFull}>
                  <Btn variant="quiet" size="s" icon={CK.CHECK_ICON} disabled={checkBusy} onClick={() => runCheck()}>{CK.LABEL.check}</Btn>
                </Tip>
              ) : null}
              {half ? <Btn variant="accent" size="s" onClick={download}>补齐 {mb(LM.needSize(m, comps, on))}</Btn> : null}
              {!on[m.id] ? <Btn variant="secondary" size="s" icon="download" onClick={download}>下载 {mb(LM.needSize(m, comps, on))}</Btn> : null}
              {on[m.id] ? (
                <>
                  <div className="lmrow__more">
                    <IconBtn icon="more" size="s" tip="更多" onClick={() => setPop((v) => !v)} />
                    <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={230}>
                      <Menu>
                        {checkable ? <MenuItem icon={CK.CHECK_ICON} label={CK.LABEL.checkFull} disabled={!ready || checkBusy}
                          onClick={() => { setPop(false); runCheck(); }} /> : null}
                        <MenuItem icon="download" label={CK.LABEL.repair} sub={CK.LABEL.repairSub} disabled={checkBusy}
                          onClick={() => { setPop(false); repair(); }} />
                        <MenuRule />
                        <MenuItem icon="copy" label="复制下载地址" sub="按当前生效的源拼"
                          onClick={() => { setPop(false); app.toast('已复制下载地址'); }} />
                        <MenuItem icon="folder" label="复制本地路径"
                          onClick={() => { setPop(false); app.toast('已复制路径'); }} />
                        <MenuItem icon="link" label="在文件夹中显示"
                          onClick={() => { setPop(false); app.toast('已在文件夹中显示'); }} />
                      </Menu>
                    </Popover>
                  </div>
                  <IconBtn icon="trash" size="s" tip="删除" onClick={() => onRemove(m)} />
                </>
              ) : null}
            </>
          )}
        </div>

        {/* 上次下载没下完：哪一部分、连的哪里；下好的留着，「补齐」只下缺的（可以先在确认框里换来源） */}
        {fail && pct < 0 ? <p className="lmrow__fail" role="status"><Ic n="alert" className="ic--14" /><span>{fail}</span></p> : null}
        {ready ? <window.ModelCheckLine st={check} cat={cat} m={m} onAction={onCheck} /> : null}
        {/* 能克隆的 TTS 模型：绑着的音色（每只一颗种子）+ 「克隆新音色」（settings-voice-capture.jsx） */}
        {ready && cat === 'tts' && TTS.MODELS[m.id] && TTS.MODELS[m.id].mode === 'clone' && window.ModelVoicesLine
          ? <window.ModelVoicesLine target={{kind: 'local', id: TTS.MODELS[m.id].engine}} from={`「${m.name}」`} /> : null}
        {test && ready && cat === 'tts' ? <window.TtsQuickTest m={m} check={check} onCheck={onCheck} /> : null}
        {/* 音乐生成行的「试听」（settings-music.jsx）：固定几秒纯音乐，只挑风格；慢，面板里写清预计耗时 */}
        {test && ready && cat === 'music' ? <window.MusicQuickTest m={m} check={check} onCheck={onCheck} /> : null}
        {imgProbe && ready ? <window.ImageProbeDialog open onClose={() => setImgProbe(false)}
          engine={{family: 'local', title: m.name, modelId: m.id, chip: 'MLX', steps: 8, cap: window.BC_CLOUD_IMAGE.capabilities(m.id)}}
          notice={CK.tryNotice(check, cat)} onCheck={(k) => { setImgProbe(false); onCheck(k); }} /> : null}

        {open ? (
          <div className="lmrow__detail">
            <div className="lmrow__dl">
              <span className="t-detail-xs lmrow__dt">组成</span>
              <div className="grow">
                <PartLine name="模型权重" on={!!on[m.id]} size={m.size} />
                {own.map((c) => <PartLine key={c.id} name={c.name} desc={c.desc} on={!!on[c.id]} size={c.size} />)}
                {common.length ? (
                  <div className="t-detail-xs lmrow__common">
                    另用公共组件：{common.map((id) => cmap[id].name + (on[id] ? '' : '（缺）')).join('、')}
                  </div>
                ) : null}
              </div>
            </div>
            {/* 许可：权重的，加上要署名（CC-BY）或许可不同的组件各一条；只有权重一条时不写「模型权重」 */}
            {lics.length ? (
              <div className="lmrow__dl">
                <span className="t-detail-xs lmrow__dt">许可</span>
                <div className="grow">
                  {lics.map((x) => (
                    <div key={x.part} className="lmrow__lic">
                      <span className="t-detail-xs">{lics.length > 1 || x.comp ? x.part + ' · ' : ''}{x.lic.name} · {x.lic.summary}</span>
                      <span className="t-mono t-detail-xs lmrow__repo">{x.lic.url}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {paceLangs.length && on[m.id] ? (
              <div className="lmrow__dl" title={'语速库 · ' + TTS.PACE_PATH}>
                <span className="t-detail-xs lmrow__dt">语速</span>
                <span className="t-detail-xs grow">{paceLangs.map((l) => TTS.paceLine(TTS.paceFor(app.ttsPace, m.id, l), l)).join(' · ')}</span>
              </div>
            ) : null}
            {/* 下载地址：权重的仓库；只有这只模型用的组件来源不同时各加一行（来自 GitHub 发布页的组件写版本；audio.cpp 引擎随应用内置，不在这里） */}
            <div className="lmrow__dl">
              <span className="t-detail-xs lmrow__dt">下载地址</span>
              <div className="grow">
                <div className="t-mono t-detail-xs lmrow__repo">{m.repo}</div>
                {own.filter((c) => (c.release || c.repo) !== m.repo).map((c) => (
                  <div key={c.id} className="t-detail-xs">
                    {c.name} · <span className="t-mono lmrow__repo">{c.release ? 'GitHub 发布 ' + c.release : c.repo}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function ModelDisclosure({label, summary, expanded, onToggle, children}) {
    const R = window.RSP;
    return <R.Disclosure size="S" isQuiet isExpanded={expanded} onExpandedChange={onToggle} UNSAFE_className="lmfold">
      <R.DisclosureHeader><R.DisclosureTitle>{label}</R.DisclosureTitle>
        <span className="lmfold__summary">{summary}</span>
      </R.DisclosureHeader>
      <R.DisclosurePanel>{children}</R.DisclosurePanel>
    </R.Disclosure>;
  }

  /* 下载来源（2026-10-13 设计稿，download-sources.jsx）：两种来源各一个紧凑选择器，改的与 设置 › 通用 › 下载来源与离线 是同一个「在用」；
     添加、编辑、删除镜像在通用页，这里给一个去那儿的入口。 */
  function SourceRows() {
    const app = useApp();
    const Row = window.ShellRow;
    const DS = window.BC_DLSRC;
    return (
      <>
        {DS.KINDS.map((x) => (
          <Row key={x.k} label={`${x.title} · 下载来源`} desc={x.desc}>
            <window.DownloadSourcePicker k={x.k} />
          </Row>
        ))}
        <p className="lmsrc__note t-detail-xs">
          可以存多个镜像，下载时在确认框里也能换。
          <BCAction className="tsetup__lnk lmsrc__lnk" onClick={() => app.go({r: 'settings', sec: 'general'})}>管理下载来源…</BCAction>
        </p>
      </>
    );
  }

  /* hideDefault：能力页（settings-capability.jsx）用统一的默认模型选择器，这里不再给本机的默认行 */
  function LocalModelsSection({tab, hideDefault}) {
    const app = useApp();
    const Row = window.ShellRow;
    const models = D.setModels;
    const comps = D.setComponents;
    // 安装表从演示数据起步，补上 store 记的下载结局，再与 store 对齐（别处下载 / 删除过的模型以 store 为准）
    const [on, setOn] = useState(() => LM.withStore(LM.initial(models, comps), models, app.modelInstalled, app.modelEnd));
    // 下载在 store 里跑（离开设置页照样下完、进后台任务）；开着时收到的结局在这里补进安装表
    const seenEnd = useRef(app.modelEnd);
    useEffect(() => {
      const prev = seenEnd.current;
      seenEnd.current = app.modelEnd;
      if (prev === app.modelEnd) return;
      models.forEach((m) => {
        const end = app.modelEnd[m.id];
        if (end && end !== prev[m.id]) setOn((t) => LM.applyEnd(t, m, end));
      });
    }, [app.modelEnd]);
    const [storageOpen, setStorageOpen] = useState(false);
    const [, , activeOf] = window.useDlSources();
    const [sharedOpen, setSharedOpen] = useState(null);
    const [pop, setPop] = useState(null);
    const dl = app.modelDl;   // 模型 id → 下载 / 补齐进度 0–100
    // 模型 id → 上次下载没下完的那一句（BC_DLSRC.failLine）
    const failOf = (id) => (app.modelEnd[id] && !app.modelEnd[id].ok ? app.modelEnd[id].line : null);
    const [work, setWork] = useState({});   // 模型 id → 'downloading' | 'testing'
    const onWork = React.useCallback((id, kind) => setWork((w) => {
      if ((w[id] || null) === kind) return w;
      const next = {...w};
      if (kind) next[id] = kind; else delete next[id];
      return next;
    }), []);
    const cat = LM.CATS.some((c) => c.k === tab) ? tab : 'asr';
    const defaults = app.prefs.localModelDefaults || {};
    const dflt = defaults[cat] || null;
    // 一种能力只有一个默认：选了本地模型就替掉云端默认
    const setDflt = (id) => {
      app.setPref('localModelDefaults', {...defaults, [cat]: id});
      if (id && cat === 'tts') app.setCloudTtsDefault('');
      if (id && cat === 'image') app.setCloudImageDefault('');
    };
    const cloudId = cat === 'tts' ? app.cloudTtsDefault : cat === 'image' ? app.cloudImageDefault : '';
    const cloudName = (() => {
      if (!cloudId) return '';
      if (cloudId.indexOf('agent:') === 0) return 'Codex 画图';
      const C = cat === 'tts' ? window.BC_CLOUD_TTS : window.BC_CLOUD_IMAGE;
      const parsed = C.parse(cloudId);
      if (!parsed) return cloudId;
      const prov = C.providerById(parsed.provider);
      return `${prov ? prov.name : parsed.provider} · ${parsed.model}`;
    })();
    const catalog = LM.catalog(models, comps, on, cat);
    const sharedExpanded = sharedOpen ?? catalog.repair.length > 0;
    const lay = LM.layout(models, comps, cat);
    const installed = LM.defaultChoices(models, comps, on, cat);
    const view = LM.defaultView(cat, dflt, cloudName, installed);

    // 下载与补齐（行上的按钮、公共组件那一行）：确认后交给 store，落一条后台任务，演示进度走完才算装上。outcome 来自下载确认框：
    // 有一部分没下成时，下好的部分照样存下（安装表里记上），这只模型成了「缺 X」，行上写失败那一句，「补齐」只下缺的
    const askDownload = (m) => window.askModelDownload(app, m.id,
      (outcome) => app.downloadModel(m.id, {outcome, completing: !!on[m.id], notify: true}), {on});
    // 下载时选了别处的条目（download-dialog.jsx）；在不在模型目录里按生效的模型目录算
    const places = window.BC_DLASK ? window.BC_DLASK.places() : {};
    const dirNow = window.modelsDirNow(app).path;
    const awayOf = (id) => (on[id] && places[id] && places[id] !== dirNow ? places[id] : null);
    const remove = (m) => {
      const r = LM.removal(m, models, comps, on);
      app.confirm({
        title: `删除「${m.name}」？`,
        body: LM.removalBody(m, models, comps, on),
        tone: 'negative', confirmLabel: '删除',
        run: () => {
          setOn((t) => LM.applyRemove(t, m, models, comps));
          app.setModelInstalled(m.id, false);
          app.toast(`已删除 · 腾出 ${mb(r.frees)}`, 'positive');
        },
      });
    };
    // 公共组件的「下载」= 补齐用到它的一只已装模型（compAction 挑的），同一个下载确认框写清这次下哪几件、装好的不动
    const getComp = ({target: m}) => askDownload(m);

    return (
      <>
        <window.ModelsDirCard models={models} comps={comps} on={on} setOn={setOn} work={work} places={places} />
        {hideDefault ? null : cat !== 'vision' ? (
          <Row label="默认模型" desc={view.cloud ? '默认是 API 提供方的模型；选一只本机模型会改用它。' : LM.DEFAULT_DESC[cat]}>
            <Picker size="s" value={view.label}
              open={pop === 'd'} popAlign="right" popWidth={230}
              onClick={() => setPop(pop === 'd' ? null : 'd')} onClose={() => setPop(null)}>
              <Menu>
                {view.auto ? <MenuItem label="自动选择" on={!dflt} onClick={() => { setDflt(null); setPop(null); }} /> : null}
                {!view.auto && !installed.length ? <MenuHead>还没有已安装的本地模型</MenuHead> : null}
                {installed.map((m) => (
                  <MenuItem key={m.id} label={m.name} on={m.id === view.checked} onClick={() => { setDflt(m.id); setPop(null); }} />
                ))}
              </Menu>
            </Picker>
          </Row>
        ) : lay.rows.map(({m}) => (
          <Row key={m.id} label={`${m.name} · 默认模型`} desc="按用途选用；此用途目前只有一只模型。">
            <span className="t-detail">{LM.visionDefaultName(m)} · {LM.ready(m, comps, on) ? '已安装' : '未安装'}</span>
          </Row>
        ))}

        {catalog.groups.map((group) => <section className="lmgroup" key={group.id} aria-label={group.label}>
          <h2>{group.label}<span>{group.rows.length}</span></h2>
          {group.id === 'installed' && group.rows.length ? <p className="t-detail-xs lmgroup__note">{CK.CAPTION}</p> : null}
          {group.rows.length ? <div className="lmlist">
            {group.rows.map((row) => <ModelRow key={row.m.id} row={row} cat={cat} on={on} comps={comps}
              dflt={row.m.id === view.checked && LM.ready(row.m, comps, on)} pct={dl[row.m.id] ?? -1}
              fail={failOf(row.m.id)} away={awayOf(row.m.id)} onDownload={askDownload} onRemove={remove} onWork={onWork} />)}
          </div> : <p className="t-detail">{group.id === 'installed' ? '还没有安装模型，从下面选择一个下载。' : '这一类的模型已全部安装。'}</p>}
        </section>)}
        {lay.shared.length > 0 && <ModelDisclosure label="公共组件"
          summary={catalog.repair.length ? `${catalog.repair.length} 个组件待补全` : `${lay.shared.length} 个共享组件`}
          expanded={sharedExpanded} onToggle={() => setSharedOpen(!sharedExpanded)}>
          <SharedCard shared={lay.shared} models={models.filter((m) => LM.catOf(m) === cat)} comps={comps} on={on} dl={dl} onGet={getComp} />
        </ModelDisclosure>}
        <ModelDisclosure label="下载与存储"
          summary={`已用 ${mb(LM.disk(models, comps, on))} · ${activeOf('models').src.name}`}
          expanded={storageOpen} onToggle={() => setStorageOpen(!storageOpen)}>
          <SourceRows />
          <Row label="盘上合计"
            desc={LM.CATS.map((c) => `${c.title} ${mb(LM.disk(models, comps, on, c.k))}`).join(' · ')}>
            <span className="t-mono t-detail">{mb(LM.disk(models, comps, on))}</span>
          </Row>
        </ModelDisclosure>
      </>
    );
  }

  Object.assign(window, {LocalModelsSection});
})();
