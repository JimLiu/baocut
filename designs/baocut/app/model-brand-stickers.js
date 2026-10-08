/* model-brand-stickers.js —— 品牌库「贴纸」的收件规则（第 238 轮）。

   品牌库此前只收视频和图片。本轮起它也收贴纸：用户把自己的 Lottie / GIF /
   SVG 动画 / 静态图存进品牌库，元素 › 贴纸 与 › 动态贴纸 里就多出一组
   「我的贴纸」，和内置分类一样一键上时间轴。

   这一层只回答「这份文件收不收、收进来叫什么、算哪一类」，不碰 DOM、不碰
   `URL.createObjectURL`（那是视图层的事）：

   - **收件白名单**是 8 个扩展名（第 242 轮加 `.zip`：Codex Pet 的包），两个上传入口的 `<input accept>` 由它拼
     （`acceptAttr`）。第 241 轮起品牌库把贴纸分成**两节**（贴纸 / 动态贴纸），
     两节的入口各拿白名单的一半。
   - **类型先看字节再看扩展名**。浏览器里 `File.name` 是用户随手起的，`.txt`
     里塞一份 Lottie 完全可能；所以给了前几百字节就按 magic 判（`{` 且能解析出
     `layers` 才算 Lottie、`GIF8` 是 GIF、`<svg` / XML 声明后跟 `<svg` 是 SVG），
     判不出来才退回扩展名。
   - **20 MiB 上限**，与 `bcut serve` 的单文件上传限一致；越界不是截断而是拒收。
   - **重名**不覆盖也不拒收，追加 `-2`、`-3`……——品牌库是收纳，用户连传两版
     同名文件时两份都该在。

   `BC_STSRC.kindOf` 管的是「一个 src 怎么播」，这里管的是「一份上传件收不收」，
   两者的 kind 取值刻意保持同一套词表。 */
(function () {
  /** 收件白名单：扩展名 → kind。两节的 `<input accept>` 直接由它分区拼出。 */
  const ACCEPT = {
    json: 'lottie', gif: 'gif', svg: 'svg',
    png: 'image', webp: 'image', jpg: 'image', jpeg: 'image',
    /* Codex Pet（第 242 轮）：一份 `pet.json` + 一张 `spritesheet.webp` 打成的 zip。
       这一层只认「它是个 zip」；解包、校验 `pet.json`、量雪碧图尺寸在视图层
       （JSZip）与 `BC_PET` 里做，坏包的拒收理由也从 `BC_PET.REASONS` 来。 */
    zip: 'pet',
  };
  /** 单份上限 20 MiB（与 serve 的上传限同口径）。 */
  const MAX_BYTES = 20 * 1024 * 1024;
  /** 拒收理由的文案（第二人称、无感叹号，走 toast）。 */
  const REASONS = {
    ext: '只收 Lottie（.json）、GIF、SVG、图片或 Codex Pet（.zip）',
    size: '单份贴纸不能超过 20 MB',
    empty: '这份文件是空的',
    broken: '这份 .json 不是可用的 Lottie',
  };

  function ext(name) {
    if (typeof name !== 'string') return '';
    const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    const base = slash < 0 ? name : name.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
  }

  /** 扩展名认不认。 */
  function accepts(name) { return Object.prototype.hasOwnProperty.call(ACCEPT, ext(name)); }

  /** 扩展名给出的 kind；不认识时 `null`。 */
  function kindFromName(name) { return ACCEPT[ext(name)] || null; }

  /** 字节头给出的 kind；判不出来 `null`。`text` 是文件开头的一段文本。 */
  function kindFromBytes(text) {
    if (typeof text !== 'string') return null;
    const head = text.replace(/^\uFEFF/, '').trimStart();
    if (!head) return null;
    if (head.startsWith('GIF8')) return 'gif';
    if (head.startsWith('PK\x03\x04')) return 'pet';
    if (head.startsWith('<svg') || /^<\?xml[\s\S]*?<svg/.test(head)) return 'svg';
    if (head.startsWith('{')) {
      try {
        const data = JSON.parse(text);
        return data && Array.isArray(data.layers) ? 'lottie' : null;
      } catch (e) { return null; }
    }
    if (head.startsWith('\x89PNG') || head.startsWith('\xFF\xD8\xFF')) return 'image';
    if (head.startsWith('RIFF') && head.indexOf('WEBP') > 0) return 'image';
    return null;
  }

  /** 最终 kind：字节优先，其次扩展名。 */
  function kindOf(name, text) { return kindFromBytes(text) || kindFromName(name); }

  /** 文件名 → 展示名：去扩展名、下划线连字符换空格、收紧空白、截到 40 字。 */
  function displayName(name) {
    if (typeof name !== 'string') return '贴纸';
    const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    let base = slash < 0 ? name : name.slice(slash + 1);
    const dot = base.lastIndexOf('.');
    if (dot > 0) base = base.slice(0, dot);
    base = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!base) return '贴纸';
    return base.length > 40 ? base.slice(0, 40).trim() : base;
  }

  /** 重名追加 `-2`、`-3`……；`taken` 是已占用的展示名数组。 */
  function uniqueName(name, taken) {
    const used = new Set(taken || []);
    if (!used.has(name)) return name;
    let n = 2;
    while (used.has(name + '-' + n)) n += 1;
    return name + '-' + n;
  }

  /** 收不收。`file` 形如 `{name, size}`，`text` 可选（文件开头的文本）。 */
  function validate(file, text) {
    const f = file || {};
    const size = Number(f.size) || 0;
    if (!accepts(f.name) && !kindFromBytes(text)) return {ok: false, reason: REASONS.ext};
    if (size > MAX_BYTES) return {ok: false, reason: REASONS.size};
    if (f.size === 0) return {ok: false, reason: REASONS.empty};
    const sniffed = kindFromBytes(text);
    /* 拿到了字节却什么都没判出来，而扩展名声称是 Lottie —— 那就是坏的 .json，
       不能靠扩展名蒙混过关（其余类型交给 <img> 自己降级）。 */
    if (!sniffed && typeof text === 'string' && text && kindFromName(f.name) === 'lottie') {
      return {ok: false, reason: REASONS.broken};
    }
    const kind = sniffed || kindFromName(f.name);
    if (!kind) return {ok: false, reason: REASONS.broken};
    return {ok: true, kind: kind};
  }

  /** 收件：给出可以直接进 `ctx.brandStickers` 的一条记录，或者拒收理由。
      `opts` = `{src, taken, id}`。 */
  function intake(file, text, opts) {
    const o = opts || {};
    const v = validate(file, text);
    if (!v.ok) return v;
    const name = uniqueName(displayName((file || {}).name), o.taken);
    return {ok: true, kind: v.kind, item: {
      id: o.id || ('bs-' + name.replace(/\s+/g, '-').toLowerCase()),
      name: name,
      kind: v.kind,
      src: o.src || '',
      size: Number((file || {}).size) || 0,
      addedAt: Number(o.now) || Date.now(),
      added: true,
    }};
  }

  /** 这一份归「动态贴纸」那一节吗？（第 241 轮）

     分区判据不在这一层再写一份，走 `BC_STSRC.isDynamicPage`——品牌库的两节与
     元素目录的两个子页因此严丝合缝：某一节里的东西，恰好就是那一页「我的贴纸」
     里的东西。入参可以是收件记录（带 `kind`）、文件名或 src。 */
  function isDynamic(item) { return window.BC_STSRC.isDynamicPage(item); }

  /** 某一节的 `<input accept>` 串。白名单**按落点分区**，两串不重不漏——静态那
     节的选文件对话框不该列出 `.json`，用户在那儿选中一份 Lottie 只会得到一条
     「它去了另一节」。真落点仍按字节判（`intake`），accept 只是收窄候选。 */
  function acceptAttr(dynamic) {
    /* 按白名单给的 kind 判，不按文件名：`.zip` 在 `BC_STSRC` 里没有扩展名判据
       （它收进来之后是 `kind:'pet'`），拿 `x.zip` 去问会被当成位图。 */
    return Object.keys(ACCEPT)
      .filter((e) => isDynamic({kind: ACCEPT[e]}) === !!dynamic)
      .map((e) => '.' + e).join(',');
  }

  /** 按落点把库切成两半，各自保持原序。 */
  function split(list) {
    const out = {still: [], dynamic: []};
    (list || []).forEach((m) => { (isDynamic(m) ? out.dynamic : out.still).push(m); });
    return out;
  }

  /** 最近用过的排序键：用过的看 `usedAt`，没用过的回落 `added`（收进库的时刻）。
      两者同一条时间线（毫秒 epoch），直接比大小。 */
  function recency(m) {
    const item = m || {};
    const used = Number(item.usedAt);
    if (Number.isFinite(used) && used > 0) return used;
    return Number(item.addedAt) || 0;
  }

  /** 按最近用过倒序（第 239 轮）。**稳定**：同一刻的两条保持库里的原序，否则
      每次重排都可能换位，用户会觉得网格自己在动。

      为什么只排这一组：随包目录的次序是照抄的分类序（`BC_ELPANEL.ANIM_ORDER`），
      那是一份对照契约；用户自己传的这几件没有外部次序可依，最近用过就是最好的
      次序——它随手要找的多半就是上一条刚用过的。 */
  function mru(list) {
    return (list || []).map((m, i) => [m, i])
      .sort((a, b) => (recency(b[0]) - recency(a[0])) || (a[1] - b[1]))
      .map((pair) => pair[0]);
  }

  /** 记一次「用出去了」。`id` 不在库里时原样返回——素材可能刚被移出品牌库，
      那不该凭空长出一条。 */
  function touch(list, id, now) {
    const at = Number(now) || Date.now();
    return (list || []).map((m) => (m && m.id === id ? Object.assign({}, m, {usedAt: at}) : m));
  }

  /** 已收下的名字表，喂给 `uniqueName`。 */
  function takenNames(list) { return (list || []).map((s) => s && s.name).filter(Boolean); }

  /** 体积的展示串（品牌库行右侧的 meta）。 */
  function sizeText(bytes) {
    const n = Number(bytes) || 0;
    if (n <= 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  Object.assign(window, {BC_BRAND_STICKERS: {
    ACCEPT, MAX_BYTES, REASONS,
    ext, accepts, kindFromName, kindFromBytes, kindOf,
    isDynamic, acceptAttr, split,
    displayName, uniqueName, validate, intake, takenNames, sizeText,
    recency, mru, touch,
  }});
})();
