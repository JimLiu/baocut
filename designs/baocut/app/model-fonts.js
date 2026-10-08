/* 统一字体选择框的纯层 —— §18（第 80 轮）。
   ============================================================================
   菜单只有三段，外加恒在第一位的「导入字体…」：

     ┌ 搜索字体…              ← 真 <input>，实时过滤
     ├ ↑ 导入字体…            ← **第一项**，不随列表滚走：它是动作，不是目录里的一条
     ├ BRAND KITS             ← `brand.fonts`，按上一次用过倒序；有检索词时整节让位
     ├ POPULAR                ← 指向 `all` 里的名字，人挑的一小撮
     └ ALL                    ← 目录全量，按名字自然序

   三段是**同一份目录的三种取法**，不去重：Brand kits 回答「哪几只是本品牌的」、
   Popular 回答「常用的是哪几只」、All 回答「一共有哪些」。同一个族在三段里各出现
   一次不是 bug——这与 `apps/baocut` 的 `menu_sections` 是同一条口径。**只有检索结果
   去重**：那时候三段合成一条平列表，同一个名字出现两次就只是重复。

   `BC_FONT` 是纯函数：不碰 DOM、不读 `window.BC_DATA`，输入全部由调用方给。
   ============================================================================ */
(function () {
  /** 拉丁名在前、其余（中文名等）在后，段内按 en 序——不依赖运行环境的默认 locale。 */
  function byName(a, b) {
    const la = /^[\x20-\x7F]/.test(a) ? 0 : 1;
    const lb = /^[\x20-\x7F]/.test(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return a.localeCompare(b, 'en');
  }

  /** 目录全量，按名字自然序（`data.js` 里那份是出处顺序，不动它）。 */
  function catalog(all) {
    return (all || []).slice().sort((x, y) => byName(x.n, y.n));
  }

  /** 品牌字体按**上一次用过**倒序：`used` 是「多少分钟前」，越小越新。
      没有 `used` 的排在最后，同值保持登记顺序（`sort` 稳定）。 */
  function brandFonts(list) {
    return (list || []).slice().sort((a, b) => {
      const ua = a.used == null ? Infinity : a.used;
      const ub = b.used == null ? Infinity : b.used;
      return ua - ub;
    });
  }

  const hit = (name, q) => !q || String(name).toLowerCase().includes(q);

  /** 一行的样张写法：`st` 是一条 CSS 声明串，摊成 React 的行内 style 对象。
      此前视图只从里面正则抠字重与 mono，于是「每行按自己的字面渲染」这句
      对 30 个族里的 28 个都不成立——族名本身就写在 `st` 里，摊开就有。 */
  function face(st) {
    const out = {};
    String(st || '').split(';').forEach((decl) => {
      const at = decl.indexOf(':');
      if (at < 0) return;
      const key = decl.slice(0, at).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const val = decl.slice(at + 1).trim();
      if (key && val) out[key] = val;
    });
    return out;
  }

  /** 菜单分段。`{all, popular, brand, query}` → `[{key, title, rows}]`，
      `rows` 的每一项就是目录里那条记录（品牌里有、目录里没有的族退化成 `{n}`）。 */
  function groups(input) {
    const all = (input && input.all) || [];
    const q = String((input && input.query) || '').trim().toLowerCase();
    const byKey = {};
    all.forEach((f) => { byKey[f.n] = f; });
    const row = (n) => byKey[n] || {n: n};
    const brand = brandFonts((input && input.brand) || []).map((f) => f.name);

    // 检索时三段合成一条：品牌命中在前（那是用户自己的资产），其后是目录自然序；
    // 这时候才去重——一条平列表里同一个名字出现两次只是重复。
    if (q) {
      const rows = [];
      const seen = {};
      const push = (n) => { if (!seen[n] && hit(n, q)) { seen[n] = 1; rows.push(row(n)); } };
      brand.forEach(push);
      catalog(all).forEach((f) => push(f.n));
      return [{key: 'search', title: '搜索结果', rows: rows}];
    }

    const out = [];
    if (brand.length) out.push({key: 'brand', title: 'Brand kits', rows: brand.map(row)});
    const popular = ((input && input.popular) || []).map(row);
    if (popular.length) out.push({key: 'popular', title: 'Popular', rows: popular});
    const rest = catalog(all);
    if (rest.length) out.push({key: 'all', title: 'All', rows: rest});
    return out;
  }

  window.BC_FONT = {byName, catalog, brandFonts, face, groups};
})();
