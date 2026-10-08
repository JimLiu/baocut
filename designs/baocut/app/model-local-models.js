/* 设置 › 本地模型的纯模型 —— §17.3（2026-09-13 分类重排）。
   依赖图照 `core/crates/bcut-models/src/catalog.rs`：模型声明自己要哪些组件（`uses`），
   组件是否算「公共」不手写，按**同一分类里有几只模型声明它**算——两只及以上放到分类顶部的
   「公共组件」，只有一只用的跟着那只模型的依赖子行走。安装位是一张表 `on`：模型 id 表示
   权重在盘上，组件 id 表示组件在盘上；共享组件只在最后一个装着的使用者删除时一起回收
   （`ModelCatalog::remove` / `removal_preview` 同一条规则）。不碰 React、不碰 DOM。 */
(function () {
  const CATS = [
    {k: 'asr', title: '语音识别', desc: '转录、重新转录与说话人区分用。'},
    {k: 'tts', title: '语音合成', desc: '「生成语音」「克隆声音」「翻译配音」用。装好后点「试听」，选好音色和内容再生成。'},
    {k: 'sep', title: '音源分离', desc: '翻译配音分离背景声时用，也能单独把人声与伴奏拆开。'},
    {k: 'vision', title: '画面理解', desc: '「智能裁剪」用：认出画面里的人、判断谁在说、找到白板和屏幕上的内容。按场景只装需要的那几个。'},
    /* 图像生成（2026-09-25 图像生成设计稿 §2.3）：与「画面理解」严格分开——那是看图，这是出图 */
    {k: 'image', title: '图像生成', desc: '图片 Tab 的「AI 生成」、工具 › 生成图片、bcut image 用：在这台电脑上出图，不联网。Qwen-Image-2.1 支持 Apple Silicon 与 Windows/Linux x64。NVIDIA 加速需 CUDA 运行时，CPU 生成较慢。'},
  ];
  const catOf = (m) => m.cat || 'asr';
  const visionDefaultName = (m) => ({'vision-person': 'YuNet 2023mar', 'vision-speaker': 'LR-ASD',
    'vision-content': 'PP-OCRv5 server det'}[m.id] || m.name);
  /* 语音合成与图像生成没有出厂默认（architecture-design §6.2）：默认菜单没有「自动选择」，
     没设默认时新建任务要手动选模型。语音识别与音源分离保留「自动选择」。 */
  const FACTORY_DEFAULT = {asr: true, sep: true};
  const hasAuto = (cat) => !!FACTORY_DEFAULT[cat];
  const DEFAULT_DESC = {
    asr: '新建视频时预选它，命令行转录也用它。',
    tts: '新建合成任务时预选它；没有默认时要手动选模型，手动选择优先。',
    sep: '未指定模型时，命令行音源分离使用它。',
    image: '新建生图任务时预选它；没有默认时要手动选模型，手动选择优先。',
  };
  /* 云端默认只有语音合成与图像生成有（设置 › 云端模型）；其余类只有本地默认。 */
  const CLOUD_CATS = {tts: true, image: true};
  /** 默认模型行的显示状态。`local` 是存着的本地默认 id，`cloud` 是云端默认的显示名（API 提供方 · 模型，没有则空），
   *  `choices` 是能选的已装本地模型。没有出厂默认的类：默认是云端时如实显示它、菜单不勾本地项；
   *  存着的本地默认已不在可选里（删了或缺组件）按未设置算；什么都没有显示「未设置」。 */
  function defaultView(cat, local, cloud, choices) {
    const auto = hasAuto(cat);
    const hit = (choices || []).find((m) => m.id === local) || null;
    const cloudName = CLOUD_CATS[cat] && cloud ? cloud : '';
    if (cloudName) return {auto, label: cloudName, checked: null, cloud: true};
    if (auto) return {auto, label: hit ? hit.name : local || '自动选择', checked: local || null, cloud: false};
    return {auto, label: hit ? hit.name : '未设置', checked: hit ? hit.id : null, cloud: false};
  }
  const defaultChoices = (models, comps, on, cat) => models.filter((m) =>
    cat !== 'vision' && catOf(m) === cat && !m.pack && m.supported !== false && ready(m, comps, on));
  const mb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : (Math.round(n * 10) / 10) + ' MB');

  const compMap = (comps) => {
    const map = {};
    (comps || []).forEach((c) => { map[c.id] = c; });
    return map;
  };
  /** 声明了这个组件的模型（不看装没装），按目录顺序 */
  const usersOf = (compId, models) => (models || []).filter((m) => (m.uses || []).indexOf(compId) >= 0);

  /** 一个分类的版面：顶部公共组件 + 模型行（每行带自己独用的组件）。
   *  公共与否只看目录，不看安装态——删掉一只模型不会让组件从顶部跳进某一行。 */
  function layout(models, comps, cat) {
    const list = (models || []).filter((m) => catOf(m) === cat);
    const cmap = compMap(comps);
    // 顺序按组件目录，不按哪只模型先出场
    const shared = (comps || []).filter((c) => usersOf(c.id, list).length >= 2);
    const sharedIds = shared.map((c) => c.id);
    return {
      shared,
      rows: list.map((m) => ({
        m,
        own: (m.uses || []).filter((id) => sharedIds.indexOf(id) < 0 && cmap[id]).map((id) => cmap[id]),
        common: (m.uses || []).filter((id) => sharedIds.indexOf(id) >= 0),
      })),
    };
  }

  /** Installed weights stay in the installed group even when a dependency needs repair. */
  function catalog(models, comps, on, cat) {
    const lay = layout(models, comps, cat);
    return {
      groups: [
        {id: 'installed', label: '已安装', rows: lay.rows.filter(({m}) => on[m.id])},
        {id: 'available', label: '可下载', rows: lay.rows.filter(({m}) => !on[m.id])},
      ],
      repair: lay.shared.filter((c) => !on[c.id] && lay.rows.some(({m}) => on[m.id] && (m.uses || []).includes(c.id))),
    };
  }

  /** 这只模型要用上还缺什么：[{id, name, size, weights?}]，权重在前 */
  function missing(m, comps, on) {
    const cmap = compMap(comps);
    const out = [];
    if (!on[m.id]) out.push({id: m.id, name: '模型权重', size: m.size, weights: true});
    (m.uses || []).forEach((id) => { if (!on[id] && cmap[id]) out.push(cmap[id]); });
    return out;
  }
  const ready = (m, comps, on) => missing(m, comps, on).length === 0;
  /** 半装：权重在、组件缺——可修复状态，行上挂芯片、自动展开 */
  const half = (m, comps, on) => !!on[m.id] && missing(m, comps, on).length > 0;
  const needSize = (m, comps, on) => missing(m, comps, on).reduce((n, x) => n + x.size, 0);

  /** 盘上合计：装着的权重 + 装着的组件（共享组件只算一次）。传 cat 只算那一类用得到的。 */
  function disk(models, comps, on, cat) {
    const list = (models || []).filter((m) => !cat || catOf(m) === cat);
    const ids = {};
    list.forEach((m) => (m.uses || []).forEach((id) => { ids[id] = true; }));
    return list.reduce((n, m) => n + (on[m.id] ? m.size : 0), 0)
      + (comps || []).reduce((n, c) => n + (ids[c.id] && on[c.id] ? c.size : 0), 0);
  }

  /** 组件行的副题：「3 个模型在用 · 共 4 个需要」；没人装着就写谁会用它 */
  function compUsage(c, models, on) {
    const all = usersOf(c.id, models);
    const live = all.filter((m) => on[m.id]);
    if (!live.length) return `${all.length} 个模型会用到 · 暂无已装`;
    return `${live.length} 个已装模型在用 · 共 ${all.length} 个需要`;
  }

  /** 删除预览：腾出多少、哪些组件跟着走、哪些因为别人在用而保留 */
  function removal(m, models, comps, on) {
    const cmap = compMap(comps);
    const orphaned = [];
    const kept = [];
    (m.uses || []).forEach((id) => {
      if (!on[id] || !cmap[id]) return;
      const others = usersOf(id, models).filter((x) => x.id !== m.id && on[x.id]);
      if (others.length) kept.push({c: cmap[id], by: others});
      else orphaned.push(cmap[id]);
    });
    const weights = on[m.id] ? m.size : 0;
    const extra = orphaned.reduce((n, c) => n + c.size, 0);
    return {weights, orphaned, kept, frees: weights + extra};
  }
  /** 确认框正文 */
  function removalBody(m, models, comps, on) {
    const r = removal(m, models, comps, on);
    const head = `腾出 ${mb(r.frees)}。`;
    const orphan = r.orphaned.length
      ? `其中 ${mb(r.frees - r.weights)} 是 ${r.orphaned.map((c) => c.name).join('、')}——没有别的已装模型还需要。` : '';
    const kept = r.kept.length
      ? `${r.kept.map((k) => k.c.name).join('、')} 还有 ${uniqNames(r.kept).join('、')} 在用，保留。` : '';
    return head + orphan + kept;
  }
  function uniqNames(kept) {
    const names = [];
    kept.forEach((k) => k.by.forEach((x) => { if (names.indexOf(x.name) < 0) names.push(x.name); }));
    return names;
  }

  /** 删掉一只模型后的安装表 */
  function applyRemove(on, m, models, comps) {
    const r = removal(m, models, comps, on);
    const next = Object.assign({}, on, {[m.id]: false});
    r.orphaned.forEach((c) => { next[c.id] = false; });
    return next;
  }
  /** 下载一只模型（只补缺的）后的安装表 */
  function applyInstall(on, m) {
    const next = Object.assign({}, on, {[m.id]: true});
    (m.uses || []).forEach((id) => { next[id] = true; });
    return next;
  }
  /** 单独补一件公共组件 */
  const applyComp = (on, id) => Object.assign({}, on, {[id]: true});

  /** 初始安装表：模型行的 `installed` 与组件的 `installed` */
  function initial(models, comps) {
    const on = {};
    (models || []).forEach((m) => { on[m.id] = !!m.installed; });
    (comps || []).forEach((c) => { on[c.id] = !!c.installed; });
    return on;
  }

  /** 详情「许可」那一行列什么：权重的许可，再加上组件里要署名（CC-BY）或与权重许可不同的，每件一条。
      组件按 `uses` 全看（公共组件也算，MOSS 的声纹嵌入就在公共组件里）；都没有许可时空表，这一行不画。 */
  function licenseLines(m, comps) {
    const cmap = compMap(comps);
    const own = m.license || null;
    const lines = own ? [{part: '模型权重', lic: own}] : [];
    (m.uses || []).forEach((id) => {
      const c = cmap[id];
      const lic = c && c.license;
      if (!lic) return;
      if (!own || lic.name !== own.name || /^CC-BY/.test(lic.name)) lines.push({part: c.name, comp: true, lic});
    });
    return lines;
  }

  const BC_LOCALMODELS = {
    CATS, DEFAULT_DESC, hasAuto, defaultView, defaultChoices, visionDefaultName, catOf, mb, usersOf, layout, catalog, missing, ready, half, needSize, disk, compUsage,
    removal, removalBody, applyRemove, applyInstall, applyComp, initial, licenseLines,
  };
  if (typeof module !== 'undefined') module.exports = BC_LOCALMODELS;
  if (typeof window !== 'undefined') Object.assign(window, {BC_LOCALMODELS});
})();
