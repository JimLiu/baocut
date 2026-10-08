/* Agent 回复里的设置链接（product-design §3.2.2）——window.BC_SETTINGS_LINK。纯函数，无 React、无 DOM；只在 App 入口加载。

   智能体要请用户去设置里改什么时，写一个 Markdown 链接，地址用应用内的设置路径（与正式客户端的界面内链接同一套）：
   - `/settings/<节>`：general、shortcuts、fonts、agent、skills、glossary、privacy、diagnostics、about；
   - `/settings/models/<类>[/<页>]`：类是 providers（API 提供方）、usage（用量）与各能力页 asr、tts、llm、image、sep、vision
     （§7.6），页只有语音合成的 voices；旧的 local、cloud 页（正式客户端还没改成能力页时的地址）落到那种能力的能力页，
     与 BC_SETTINGS_NAV.normalize 一致。
   认得的链接点了在当前窗口打开设置的那一页；认不出的（拼错的节、不属于这一类的页、别的路径）返回 null，按普通文字显示。
   能力 → 类的对照与正式客户端的模型任务一致：转写 = 语音识别，合成语音 = 语音合成，以此类推。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const SECTIONS = ['general', 'shortcuts', 'fonts', 'agent', 'skills', 'glossary', 'privacy', 'diagnostics', 'about'];
  const CAPABILITY_CATEGORY = {
    transcribe: 'asr', synthesizeSpeech: 'tts', generateText: 'llm', generateImage: 'image', separateAudio: 'sep',
  };
  const PATH_RE = /^\/settings\/([a-z]+)(?:\/([a-z]+)(?:\/([a-z]+))?)?\/?$/;

  function nav() { return root.BC_SETTINGS_NAV; }

  /** 旧的本地 / 云端页落到哪一项的能力页：本地只认有本机模型的能力，云端只认旧「云端模型」页有的那几类。 */
  function legacyPage(N, item, page) {
    if (page === 'local') return !!item.local;
    if (page === 'cloud') return Object.keys(N.CLOUD_TAB).some((tab) => N.CLOUD_TAB[tab] === item.k);
    return false;
  }

  /** 设置链接 → {route, trail}：route 是原型的路由，trail 是「设置 › 模型 › 语音识别 › 本地模型」这样的位置。认不出返回 null。 */
  function parse(href) {
    const m = PATH_RE.exec(String(href || '').trim());
    const N = nav();
    if (!m || !N) return null;
    const [, a, b, c] = m;
    if (a === 'models') {
      const item = N.byKey(b);
      if (!item || !item.model) return null;
      const legacy = !!c && legacyPage(N, item, c);
      if (c && !legacy && item.pages.indexOf(c) < 0) return null;
      const page = c && !legacy ? c : item.pages[0];
      const route = N.routeFor(item.k, page, null);
      const trail = ['设置', '模型', item.label].concat(page !== item.pages[0] ? [N.PAGE_LABEL[page]] : []);
      return {route, trail: trail.join(' › ')};
    }
    if (b || SECTIONS.indexOf(a) < 0) return null;
    const item = N.byKey(a);
    return {route: N.routeFor(a, null, null), trail: ['设置', item.label].join(' › ')};
  }

  /** 某种能力在设置里的位置：`page` 给了且是这一类的另一页（语音合成的我的声音）就落到那一页，否则只到能力页。没有对应的类返回 null。 */
  function capabilityHref(capability, page) {
    const cat = CAPABILITY_CATEGORY[capability];
    if (!cat) return null;
    const N = nav();
    const item = N && N.byKey(cat);
    return page && item && item.pages.indexOf(page) > 0 ? `/settings/models/${cat}/${page}` : `/settings/models/${cat}`;
  }

  root.BC_SETTINGS_LINK = {SECTIONS, CAPABILITY_CATEGORY, parse, capabilityHref};
})();
