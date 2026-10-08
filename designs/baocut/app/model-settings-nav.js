/* 设置导航表。product-design §7.6：「模型」组依次是 API 提供方、用量，然后每种能力一页（本机模型与 API 提供方的模型在同一页，
   不分本地 / 云端两个 Tab）；语音合成另有「我的声音」。旧的本地 / 云端深链由 normalize 规整到能力页或 API 提供方页。 */
(function () {
  const NAV = [
    {k: 'general', label: '通用', pages: ['general']},
    {k: 'shortcuts', label: '快捷键', pages: ['shortcuts']},
    {k: 'fonts', label: '字体', pages: ['fonts']},   // 按需下载的字体（product-design §5.9、§7.6），settings-fonts.jsx
    /* Agent 自成一组：提供方与 Skills 各一项；智能体登录在这里，不是 API 提供方（§7.6）。 */
    {k: 'agent', label: 'Agent 提供方', pages: ['agent']},
    {k: 'skills', label: 'Skills', pages: ['skills']},
    {k: 'providers', label: 'API 提供方', model: true, pages: ['providers']},
    {k: 'usage', label: '用量', model: true, pages: ['usage']},
    /* 能力页：local = 本机模型目录的类（BC_LOCALMODELS.CATS），cap = API 提供方目录的能力（BC_VENDORS.CAPS）；没有 cap 的只有本机模型 */
    {k: 'asr', label: '语音识别', model: true, capPage: true, pages: ['asr'], local: 'asr', cap: 'transcribe'},
    {k: 'tts', label: '语音合成', model: true, capPage: true, pages: ['tts', 'voices'], local: 'tts', cap: 'tts'},
    {k: 'llm', label: '文本生成', model: true, capPage: true, pages: ['llm'], cap: 'text'},
    {k: 'image', label: '图像生成', model: true, capPage: true, pages: ['image'], local: 'image', cap: 'image'},
    {k: 'sep', label: '人声分离', model: true, capPage: true, pages: ['sep'], local: 'sep'},
    {k: 'vision', label: '视觉分析', model: true, capPage: true, pages: ['vision'], local: 'vision'},
    {k: 'glossary', label: '术语库', pages: ['glossary']},
    {k: 'privacy', label: '隐私与权限', pages: ['privacy']},
    {k: 'diagnostics', label: '诊断', pages: ['diagnostics']},
    {k: 'about', label: '关于', pages: ['about']},
  ];
  const DESCRIPTIONS = {
    asr: '将语音转成文稿和字幕，并区分说话人。',
    tts: '生成语音、克隆声音，为视频配音。',
    llm: '润色文稿、翻译字幕，生成文本内容。',
    image: '生成视频所需的图片和封面。',
    sep: '分离人声、伴奏和背景声。只用这台电脑上的模型。',
    vision: '识别人像、说话人和画面内容，辅助智能裁剪。只用这台电脑上的模型。',
  };
  /* 只有语音合成一项有两页（Tab）；其余页名只用于搜索 */
  const PAGE_LABEL = {tts: '模型', voices: '我的声音', providers: 'API 提供方 服务商 账号 密钥', usage: '用量 花费 余额', agent: 'Agent 提供方', skills: 'Skills'};
  const LOCAL_TABS = NAV.filter((n) => n.local).map((n) => n.local);
  /* 旧「云端模型」页的 tab → 能力页 */
  const CLOUD_TAB = {stt: 'asr', llm: 'llm', tts: 'tts', image: 'image'};

  const byKey = (k) => NAV.find((n) => n.k === k) || null;

  /* 路由规整：旧深链 integrations → skills；本地 / 云端带 tab 的落到那一类的能力页；本地不带 tab 落到语音识别，
     云端不带 tab（以前是「去连接密钥」）落到 API 提供方页 */
  function normalize(sec, tab) {
    const s = sec === 'integrations' ? 'skills' : (sec || 'general');
    if (s === 'local') return {sec: LOCAL_TABS.includes(tab) ? tab : 'asr', tab: null};
    if (s === 'cloud') return {sec: CLOUD_TAB[tab] || 'providers', tab: null};
    if (!NAV.some((n) => n.pages.includes(s))) return {sec: 'general', tab: null};
    return {sec: s, tab: null};
  }

  /* 页 → 左栏哪一项 */
  function navOf(sec, tab) {
    const r = normalize(sec, tab);
    return NAV.find((n) => n.pages.includes(r.sec)).k;
  }

  /* 某一项的某一页 → 路由；page 缺省或不属于这一项时用 last（上次停在的页），再不行用第一页 */
  function routeFor(k, page, last) {
    const n = byKey(k);
    const pick = [page, last].find((p) => p && n.pages.includes(p)) || n.pages[0];
    return {r: 'settings', sec: pick};
  }

  const GROUPS = [
    {id: 'preferences', label: '偏好设置', keys: ['general', 'shortcuts', 'fonts']},
    {id: 'agents', label: 'Agent', keys: ['agent', 'skills']},   // 组 id 不能与条目键重名：SideNav 把两者放在同一个集合里
    {id: 'models', label: '模型', keys: NAV.filter((n) => n.model).map((n) => n.k)},
    {id: 'app', label: '应用', keys: ['glossary', 'privacy', 'diagnostics', 'about']},
  ];
  function searchGroups(query) {
    const q = String(query || '').trim().toLowerCase();
    return GROUPS.map((g) => ({...g, items: g.keys.map(byKey).filter((n) =>
      !q || [n.label, ...n.pages.map((p) => PAGE_LABEL[p] || '')].join(' ').toLowerCase().includes(q))})).filter((g) => g.items.length);
  }

  window.BC_SETTINGS_NAV = {NAV, DESCRIPTIONS, PAGE_LABEL, LOCAL_TABS, CLOUD_TAB, byKey, normalize, navOf, routeFor, searchGroups};
})();
