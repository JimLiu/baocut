/* 设置 › 本地模型 › 添加模型（issue 113）的纯模型：audio.cpp 支持的模型都能按需加进列表，加进来以后与内置的模型一样
   下载、删除、试听。目录数据在 `BC_AUDIOCPP_CATALOG`（model-audiocpp-catalog.js）。不碰 React、不碰 DOM。
   - 分组按 BaoCut 能拿它做什么：语音合成、音乐生成、音源分离三组能添加；语音识别与其余任务归「暂时用不上」，写原因，不给添加。
     音源分离只开人声 / 背景两轨能直接接上翻译配音、速度也能用的族（`SEP_OPEN`）；其余分离族按族写原因。
     依据：2026-10-28 在 M4 上的 audio.cpp 实测——分离见 `SEP_OPEN` 处的注释；识别比现在的 MLX 慢 1.2–1.8 倍，
     没有 Whisper 与说话人区分，MOSS 一次吃下整段音频（10 分钟要约 14 GB），所以转录不换。
   - 添加的东西记在偏好 `addedModels`（按表面分键持久化）：目录里的包记 `{kind: 'catalog', pkg}`，
     自己指定的 GGUF 记 `{kind: 'custom', fam, src, repo, revision, path, name, mb}`。启动时 `sync` 把它们并进
     设置页的模型表（data.js `setModels`）与组件表（`setComponents`）；同族配件（YuE2 的 VAE、AuK 的 Qwen 与 VAE）
     作为组件挂在 `uses` 上，两只以上用到时照常进「公共组件」。
   - 加进来的行都标 `added`，没经过 BaoCut 逐只验证（`verified: false`），与添加的 ACP Agent 同一个说法。 */
(function () {
  const PREFIX = 'audiocpp:';
  const CUSTOM = 'audiocpp-custom:';
  const GROUPS = [
    {k: 'tts', label: '语音合成'},
    {k: 'music', label: '音乐生成'},
    {k: 'sep', label: '音源分离'},
    {k: 'idle', label: '暂时用不上'},
  ];
  /* 能添加的分离族。80 秒人声叠音乐的样本上（内置 HTDemucs-FT 走 MLX：36 秒，人声 / 背景 SDR 17.8 / 14.3 dB）：
     HTDemucs 单模型 17 秒、17.6 / 14.4 dB；Mel-Band RoFormer 72 秒、20.9 / 17.9 dB。
     BS-RoFormer 21.4 / 18.4 dB 但要 300 秒，许可也不明；6 轨版没测，配音只要两轨；MossFormer2、TF-GridNet 是拆开几个人的说话声。 */
  const SEP_OPEN = {htdemucs: '人声 / 背景分离 · 单模型，比内置的 HTDemucs-FT 轻、快',
    mel_band_roformer: '人声 / 背景分离 · 分得更干净，也更慢'};
  const groupOf = (fam) => (fam.cap === 'tts' || fam.cap === 'music' ? fam.cap
    : fam.cap === 'sep' && SEP_OPEN[fam.f] ? 'sep' : 'idle');

  const TASK_LABEL = {
    asr: '语音识别', vad: '人声检测', wake_word: '唤醒词', classify: '声音分类', align: '文字对时间', diar: '说话人区分',
    vc: '换声', s2s: '语音对话', midi: '转 MIDI', sfx: '音效生成', sep: '音源分离', svc: '歌声转换', edit: '音频编辑',
    turn: '判断说完没有', tts: '语音合成', clone: '克隆', design: '造声', music: '音乐生成',
  };
  /** 「暂时用不上」那一句：为什么这一族在 BaoCut 里还没地方用 */
  function idleReason(fam) {
    if (fam.cap === 'asr') return '转录照旧用 BaoCut 自己的识别模型：audio.cpp 上的识别更慢，也没有说话人区分';
    if (fam.f === 'bs_roformer') return '分得最干净，但比实时慢近 4 倍，许可也不明；先用 Mel-Band RoFormer';
    if (fam.f === 'htdemucs_6stems') return '拆成 6 轨；翻译配音只要人声与背景两轨，用 HTDemucs';
    if (fam.cap === 'sep') return '把几个人的说话声拆开，不是人声与背景分离；BaoCut 还没有用到';
    const tasks = (fam.tasks || []).map((t) => TASK_LABEL[t] || t);
    return (tasks.length ? tasks.join('、') + ' · ' : '') + 'BaoCut 还没有用到它的功能';
  }

  /** 上游标的成熟度：supported 不标，其余给一个短标签 */
  const STATUS = {experimental: '实验', community: '社区', testing: '测试中', wip: '测试中'};
  const statusLabel = (fam) => STATUS[fam.status] || null;

  const LANG = {zh: '中', en: '英', ja: '日', ko: '韩', de: '德', fr: '法', ru: '俄', pt: '葡', es: '西', it: '意', ar: '阿',
    yue: '粤', vi: '越', th: '泰', id: '印尼', hi: '印地', tr: '土', nl: '荷', pl: '波', da: '丹', sv: '瑞典', he: '希伯来',
    kk: '哈萨克', ky: '吉尔吉斯', uz: '乌兹别克', 'en-us': '美式英', 'en-gb': '英式英', 'fr-fr': '法', 'pt-br': '巴葡'};
  /* 上游的几个说法词，不是语言代码 */
  const LANG_WORD = {multilingual: '多语言', language_agnostic: '不限语言', model_dependent: '看具体模型', music: ''};
  /** 语言一句：个数、自动、或几个字的简称；认不出的照原样 */
  function langLine(fam) {
    if (typeof fam.langs === 'number') return `${fam.langs} 种语言`;
    if (!fam.langs || !fam.langs.length) return '';
    const l = fam.langs.filter((x) => x !== 'auto');
    if (!l.length) return '自动认语言';
    if (l.length === 1 && /^\d+\+/.test(l[0])) return `${parseInt(l[0], 10)} 种以上语言`;
    if (l.length === 1 && /^\d+ languages$/.test(l[0])) return `${parseInt(l[0], 10)} 种语言`;
    if (l.length === 1 && l[0] in LANG_WORD) return LANG_WORD[l[0]];
    const short = l.filter((x) => !(x in LANG_WORD)).map((x) => LANG[x] || x);
    // 多于 5 种只写前 4 种加个数（与内置模型行的 BC_TTS.modelBrief 同一写法）
    return short.length > 5 ? `${short.slice(0, 4).join(' / ')} 等 ${short.length} 种语言` : short.join(' / ');
  }

  /** 特点一句：能怎么出声（与内置模型行的说法一致） */
  function traitsLine(fam) {
    // 分离不分语言，只写分成什么、跟内置的比
    if (fam.cap === 'sep') return SEP_OPEN[fam.f] || '';
    const t = fam.traits || {};
    const out = [];
    if (t.clone) out.push('克隆');
    if (t.design) out.push('按描述造声');
    if (t.voices) out.push(`${t.voices} 个内置音色`);
    if (t.style) out.push('可写风格');
    if (t.emotion) out.push('情绪可调');
    if (t.speed) out.push('能调语速');
    if (t.lyrics) out.push('能填歌词');
    const lang = langLine(fam);
    if (lang) out.push(lang);
    return out.join(' · ');
  }

  /** 许可：上游许可表（docs/model_licenses.md）的四档 → 设置行的 `license`；表里没有的写「未标许可」 */
  const LIC_SUMMARY = {
    yes: '上游许可表标可商用',
    no: '上游许可表标不可商用',
    conditional: '上游许可表标有条件商用，用前读一遍许可原文',
    unclear: '上游许可表标不明，商用前自己核实',
  };
  function licenseOf(fam) {
    const l = fam.lic;
    if (!l) return {name: '未标许可', url: '', commercialUse: null, summary: '上游许可表里没有这一族，商用前自己核实'};
    return {name: l.name, url: l.url || '', commercialUse: l.commercial === 'yes' ? true : l.commercial === 'no' ? false : null,
      summary: LIC_SUMMARY[l.commercial] || LIC_SUMMARY.unclear};
  }
  /** 许可要不要单独提醒：不可商用（行上「仅限非商用」）或商用条件不明（行上「商用待核实」） */
  const licenseFlag = (lic) => (lic.commercialUse === false ? 'nc' : lic.commercialUse === true ? null : 'check');

  /** 能选的包（同族配件不单列） */
  const pkgsOf = (fam) => (fam.pkgs || []).filter((p) => !p.part);
  const defaultPkg = (fam) => pkgsOf(fam).find((p) => p.dflt) || pkgsOf(fam)[0] || null;
  const partsOf = (fam, pkg) => (pkg.needs || []).map((id) => (fam.pkgs || []).find((p) => p.id === id)).filter(Boolean);
  const sizeOf = (fam, pkg) => Math.round(partsOf(fam, pkg).reduce((s, p) => s + p.mb, pkg.mb));
  const idOf = (pkg) => PREFIX + pkg.id;
  const precLabel = (pkg) => String(pkg.prec || '').toUpperCase();
  const pkgName = (pkg) => pkg.name.replace(/\s+GGUF$/i, '');

  /** 一个包在设置里的状态：已经内置（指向内置那只的 id）、已经加过、或都不是 */
  function stateOf(pkg, models) {
    if (pkg.builtin) return {kind: 'builtin', id: pkg.builtin};
    const id = idOf(pkg);
    const m = (models || []).find((x) => x.id === id);
    return m ? {kind: 'added', id} : null;
  }

  /** 同族配件 → 组件行（setComponents 的形状） */
  const compOf = (fam, part) => ({id: idOf(part), name: pkgName(part), size: Math.round(part.mb), installed: false,
    repo: part.repo, desc: `${fam.name} 的配件`, added: true});

  /** 目录里的一个包 → 设置页的一行（setModels 的形状） */
  function rowOf(fam, pkg) {
    return {
      id: idOf(pkg), name: pkgName(pkg), cat: fam.cap, size: Math.round(pkg.mb), installed: false,
      note: [traitsLine(fam), precLabel(pkg)].filter(Boolean).join(' · '),
      repo: pkg.repo, file: pkg.nfiles ? null : pkg.file, nfiles: pkg.nfiles || 1, uses: partsOf(fam, pkg).map(idOf), license: licenseOf(fam),
      added: 'catalog', family: fam.f, familyName: fam.name, status: fam.status, verified: false,
    };
  }

  /* ---------- 自己指定 GGUF ---------- */
  /** 认一个 Hugging Face 文件：网页地址（/blob/ 或 /resolve/ 加修订）或 `owner/repo/路径.gguf`。
   *  → {ok, repo, revision, path} 或 {ok: false, code: 'empty' | 'not-hf' | 'not-gguf'} */
  function parseHfFile(input) {
    let s = String(input || '').trim();
    if (!s) return {ok: false, code: 'empty'};
    let rev = 'main';
    const url = s.match(/^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\/(.+)$/i);
    if (/^https?:\/\//i.test(s) && !url) return {ok: false, code: 'not-hf'};
    if (url) {
      const m = url[1].split(/[?#]/)[0].match(/^([^/]+\/[^/]+)\/(?:blob|resolve)\/([^/]+)\/(.+)$/);
      if (!m) return {ok: false, code: 'not-hf'};
      s = m[1] + '/' + m[3];
      rev = m[2];
    }
    const parts = s.split('/').filter(Boolean);
    if (parts.length < 3) return {ok: false, code: 'not-hf'};
    const path = parts.slice(2).join('/');
    if (!/\.gguf$/i.test(path)) return {ok: false, code: 'not-gguf'};
    return {ok: true, repo: parts[0] + '/' + parts[1], revision: rev, path};
  }
  const PARSE_TEXT = {
    empty: '',
    'not-hf': '认不出这个地址：贴 Hugging Face 上那个文件的网页地址，或写成 用户/仓库/文件.gguf',
    'not-gguf': '只能加 .gguf 文件；整套多文件的模型请从上面的列表里加',
  };
  /** 自己指定的文件放哪一族：只列能添加（语音合成、音乐生成、音源分离）的族 */
  const customFamilies = (families) => (families || []).filter((f) => groupOf(f) !== 'idle');
  const baseName = (p) => String(p).split(/[\\/]/).pop().replace(/\.gguf$/i, '');

  /** 自己指定的文件 → 设置页的一行。src 'hf'：从仓库下载；'local'：原地引用这台电脑上的文件（不复制进模型目录），加完就装好。
   *  inPlace 的行不算模型目录里的东西：换目录不搬它，删除只从列表移除、原文件不动 */
  function customRow(fam, e) {
    const local = e.src === 'local';
    const key = local ? 'local/' + e.path : e.repo + '/' + e.path;
    return {
      id: CUSTOM + key, name: e.name || baseName(e.path), cat: fam.cap, size: Math.round(e.mb || 0), installed: local, inPlace: local, path: local ? e.path : null,
      note: `自己指定 · 按 ${fam.name} 跑`, repo: local ? e.path : e.repo, file: local ? null : e.path, revision: local ? null : (e.revision || 'main'),
      uses: [], license: local
        ? {name: '未知', url: '', commercialUse: null, summary: '这台电脑上的文件，许可请按它的来源自己核实'}
        : {name: '见仓库说明', url: 'https://huggingface.co/' + e.repo, commercialUse: null, summary: '自己指定的仓库，许可请看仓库说明'},
      added: 'custom', family: fam.f, familyName: fam.name, status: fam.status, verified: false,
    };
  }

  /* ---------- 记录与合并 ---------- */
  const entryKey = (e) => (e.kind === 'catalog' ? e.pkg : (e.src || 'hf') + ':' + (e.repo || '') + '/' + e.path);
  const famById = (families, f) => (families || []).find((x) => x.f === f) || null;
  function findPkg(families, pkgId) {
    for (const fam of families || []) {
      const pkg = (fam.pkgs || []).find((p) => p.id === pkgId && !p.part);
      if (pkg) return {fam, pkg};
    }
    return null;
  }
  /** 一条记录 → {row, comps}；找不到（目录变了）给 null */
  function materialize(families, e) {
    if (e.kind === 'catalog') {
      const hit = findPkg(families, e.pkg);
      return hit && !hit.pkg.builtin ? {row: rowOf(hit.fam, hit.pkg), comps: partsOf(hit.fam, hit.pkg).map((p) => compOf(hit.fam, p))} : null;
    }
    const fam = famById(families, e.fam);
    return fam ? {row: customRow(fam, e), comps: []} : null;
  }
  /** 加一条（同一个包 / 同一个文件不重复记） */
  const addEntry = (entries, e) => ((entries || []).some((x) => entryKey(x) === entryKey(e)) ? (entries || []) : (entries || []).concat([e]));
  /** 按设置行的 id 去掉那一条 */
  const removeEntry = (entries, families, id) => (entries || []).filter((e) => {
    const r = materialize(families, e);
    return !r || r.row.id !== id;
  });

  /**
   * 把添加的记录并进模型表与组件表（就地改，别处拿的是同一个数组）：补上缺的、去掉已经不在记录里的添加行；
   * 内置的行不动。返回这次加进来的行 id。
   */
  function sync(models, comps, families, entries) {
    const want = (entries || []).map((e) => materialize(families, e)).filter(Boolean);
    const rowIds = {};
    const compIds = {};
    want.forEach((w) => { rowIds[w.row.id] = true; w.comps.forEach((c) => { compIds[c.id] = true; }); });
    for (let i = models.length - 1; i >= 0; i--) if (models[i].added && !rowIds[models[i].id]) models.splice(i, 1);
    for (let i = comps.length - 1; i >= 0; i--) if (comps[i].added && !compIds[comps[i].id]) comps.splice(i, 1);
    const fresh = [];
    want.forEach((w) => {
      if (!models.some((m) => m.id === w.row.id)) { models.push(w.row); fresh.push(w.row.id); }
      w.comps.forEach((c) => { if (!comps.some((x) => x.id === c.id)) comps.push(c); });
    });
    return fresh;
  }

  /* ---------- 对话框里的列表 ---------- */
  /** 一族能不能加：有包、在能添加的组里、还有没内置也没加过的包 */
  function familyState(fam, models) {
    if (groupOf(fam) === 'idle') return 'idle';
    const ps = pkgsOf(fam);
    if (!ps.length) return 'nopkg';
    return ps.every((p) => stateOf(p, models)) ? 'done' : 'open';
  }
  const hay = (fam) => [fam.f, fam.name, langLine(fam), traitsLine(fam)].concat(pkgsOf(fam).map((p) => p.name)).join(' ').toLowerCase();
  /** 按组与搜索词筛；能添加的在前（内置与加过的排后面），再按上游成熟度（supported 在前、社区排后），同档按名字 */
  const STATUS_RANK = {supported: 0, experimental: 1, testing: 2, wip: 2, community: 3};
  function search(families, models, q, group) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const rank = {open: 0, nopkg: 1, done: 2, idle: 0};
    const sr = (f) => (f.status in STATUS_RANK ? STATUS_RANK[f.status] : 4);
    return (families || [])
      .filter((f) => !group || groupOf(f) === group)
      .filter((f) => { const h = hay(f); return words.every((w) => h.indexOf(w) >= 0); })
      .sort((a, b) => rank[familyState(a, models)] - rank[familyState(b, models)] || sr(a) - sr(b) || a.name.localeCompare(b.name));
  }
  const countOf = (families, group) => (families || []).filter((f) => groupOf(f) === group).length;
  /** 能力页入口那一句用：这一类里内置之外的族数（内置的族也还有别的精度可加，那一句另说） */
  const moreCount = (families, cat) => (families || []).filter((f) => groupOf(f) === cat && pkgsOf(f).length && !pkgsOf(f).some((p) => p.builtin)).length;

  /** 删除确认补一句：添加的模型删掉权重后要不要从列表里一起拿掉——添加的行没装时 ⋯ 里给「从列表移除」 */
  const removalNote = (m) => (m && m.added ? '它是你添加的模型，删除后也从列表里移除；要再用就重新添加。' : '');
  /** 原地引用的文件「删除」= 从列表移除：盘上什么都不动 */
  const inPlaceRemoval = (m) => ({
    title: `从列表移除「${m.name}」？`,
    body: `文件留在 ${m.path}，BaoCut 不再用它，也不会删它；要再用就重新添加。`,
    confirm: '移除',
    toast: `已从列表移除「${m.name}」· 原文件没动`,
  });

  window.BC_AUDIOCPP = {
    PREFIX, CUSTOM, GROUPS, groupOf, TASK_LABEL, idleReason, statusLabel, langLine, traitsLine, licenseOf, licenseFlag,
    pkgsOf, defaultPkg, partsOf, sizeOf, idOf, precLabel, pkgName, stateOf, compOf, rowOf,
    parseHfFile, PARSE_TEXT, customFamilies, customRow, baseName,
    entryKey, findPkg, materialize, addEntry, removeEntry, sync,
    familyState, search, countOf, moreCount, removalNote, inPlaceRemoval,
  };
})();
