/* 项目品牌（2026-10-16）：项目根目录的 BRAND.md——这个项目里 Agent 创作时的品牌参考，等同于一个品牌 skill，
   区别只在作用范围：skill 装在 BaoCut 里、各项目共用；BRAND.md 跟着项目目录走，在这个项目的每条会话里自动用，没有开关。
   - 文件：`<项目>/BRAND.md`，普通 Markdown，开头的 front matter 可有可无；列表上的一句话取 front matter 的 description，
     没有就取第一段正文。素材按项目内的相对路径引用，惯例放 `brand/`（`brand/logo.svg`）。
   - 优先级：你在这条消息里说的 > BRAND.md > 品牌 skill。
   - 素材在项目目录里，Agent 用现有的导入素材就能放进视频，不用把文件从 skill 目录拷出来。
   Skills 页把它画成 skill 的样子（source: 'project'），列表、详情与输入框都复用 skill 的画法。
   数据形状：brands = [{dir, updated, files: [{path, body?, size?}]}]；路径相对项目根目录。
   全局品牌（2026-10-18 提案）：BaoCut 数据目录里的 BRAND.md（~/.baocut/BRAND.md，素材在 ~/.baocut/brand/），
   所有会话都自动用，没有项目的会话也用；在 brands 里记作 dir: 'global'，和项目的走同一套建、改、删与持久化。
   优先级：你在这条消息里说的 > 项目的 BRAND.md > 全局的 BRAND.md > 开着的品牌 skill。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const FILE = 'BRAND.md';
  const ASSET_DIR = 'brand/';
  const GLOBAL = 'global';
  /** 全局品牌画成一个「项目」的样子，好让详情、文件页签与新建页共用 */
  const globalDir = () => ({id: GLOBAL, name: '全局品牌', path: '~/.baocut/', global: true});
  const isGlobal = (dirOrId) => (dirOrId && typeof dirOrId === 'object' ? dirOrId.id : dirOrId) === GLOBAL;

  const brandOf = (brands, dirId) => (brands || []).find((b) => b.dir === dirId) || null;
  const hasBrand = (brands, dirId) => !!brandOf(brands, dirId);
  const brandFile = (brand) => ((brand && brand.files) || []).find((f) => f.path === FILE) || null;

  function stripFrontMatter(body) {
    return String(body || '').replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '');
  }
  /** 一句话介绍：front matter 的 description → 第一段正文（跳过标题、列表与表格） */
  function summaryOf(body) {
    const P = root.BC_SKILL_PKG;
    const fm = P ? P.frontMatter(body) : {};
    if (fm.description) return fm.description;
    const para = [];
    for (const line of stripFrontMatter(body).split('\n')) {
      const t = line.trim();
      if (!t) { if (para.length) break; continue; }
      if (/^(#|[-*]\s|\d+[.)]\s|\||```|>)/.test(t)) { if (para.length) break; continue; }
      para.push(t);
    }
    return para.join(' ');
  }

  /** 画成 skill 的样子：Skills 页的行、详情与输入框共用 */
  function asSkill(dir, brand) {
    if (!dir || !brand) return null;
    const f = brandFile(brand);
    const global = isGlobal(dir);
    return {id: 'project:' + dir.id, dirId: dir.id, name: dir.name, source: 'project', scope: global ? 'global' : 'project',
      author: global ? '全局' : '项目', category: '品牌', enabled: true, updated: brand.updated || '', description: summaryOf(f && f.body),
      files: brand.files, path: dir.path + FILE};
  }
  /** 行与详情上说清楚它管哪里 */
  const scopeLine = (dir) => (isGlobal(dir) ? '所有会话都用，包括不属于项目的' : `只在「${dir.name}」项目里用`);
  /** 一条会话实际带上哪几份品牌：项目的在前（优先），全局的在后 */
  function layers(brands, dirId) {
    const out = [];
    if (dirId && !isGlobal(dirId) && hasBrand(brands, dirId)) out.push(dirId);
    if (hasBrand(brands, GLOBAL)) out.push(GLOBAL);
    return out;
  }
  /** 和 Agent 一起建：作为新会话的第一条消息。一次问一个问题，问完写文件，不替用户编。 */
  function interviewPrompt(dir) {
    const where = isGlobal(dir) ? `BaoCut 的全局品牌（写到 ${dir.path}${FILE}，素材放 ${dir.path}${ASSET_DIR}；所有会话都会用）`
      : `「${dir.name}」项目的品牌（写到项目根目录的 ${FILE}，素材放 ${ASSET_DIR}；这个项目的每条会话都会用）`;
    return [`帮我建一份${where}。`,
      '请一次只问我一个问题，按这个顺序：栏目名与口号、受众与语气、主色与字体、logo 与水印、开场与结尾、配音音色、其他固定要求。',
      '我说「跳过」就跳过那一项；不确定的给我两三个选项挑；我发来的素材放进 brand/ 并在正文里按相对路径引用。',
      `问完先给我看草稿，我确认后再写成 ${FILE}。`].join('\n');
  }
  /** 有 BRAND.md 的项目，按更新时间新的在前 */
  function list(brands, dirs) {
    return (dirs || []).map((d) => asSkill(d, brandOf(brands, d.id))).filter(Boolean)
      .sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  /** Skills 页的搜索：名字、路径、一句话 */
  function find(rows, query) {
    const q = String(query || '').trim().toLowerCase();
    return q ? (rows || []).filter((s) => [s.name, s.path, s.description].some((v) => String(v || '').toLowerCase().includes(q))) : (rows || []);
  }

  /** 空白模板：几段常用的品牌要素，Agent 和人都看得懂 */
  function template(dir) {
    const global = isGlobal(dir);
    const name = global ? '我的品牌' : `${(dir && dir.name) || '这个项目'} · 品牌`;
    const lede = global ? '所有视频都要守的品牌规则。Agent 在每条会话里都会读它；项目里的 BRAND.md 和它说法不一样时，以项目的为准；你在消息里另有要求时，以你说的为准。'
      : '这个项目里做视频时要守的品牌规则。Agent 在这个项目的每条会话里都会读它；你在消息里另有要求时，以你说的为准。';
    return [{path: FILE, body: `# ${name}\n\n${lede}\n\n## 名字与口号\n\n- 栏目名：\n- 口号：\n\n## 视觉\n\n- 主色：\n- 字体：\n- logo：brand/logo.svg（放进 brand/ 文件夹后写在这里）\n\n## 声音\n\n- 配音音色：\n- 开场白：\n- 结尾：\n`}];
  }
  /** 从一个品牌 skill 生成：SKILL.md 去掉 front matter 当 BRAND.md，素材与参考文件放进 brand/，正文里的路径跟着改；脚本不带 */
  function fromSkill(skill) {
    const P = root.BC_SKILL_PKG;
    const files = (skill && skill.files) || [];
    const moved = (p) => p.replace(/^(assets|references)\//, ASSET_DIR);
    const md = files.find((f) => f.path === 'SKILL.md');
    const body = stripFrontMatter(md && md.body).replace(/(^|[^\w./-])(assets|references)\//gm, `$1${ASSET_DIR}`).replace(/^\n+/, '');
    const rest = files.filter((f) => f.path !== 'SKILL.md' && !(P && P.isScript(f.path)))
      .map((f) => ({...f, path: /^(assets|references)\//.test(f.path) ? moved(f.path) : ASSET_DIR + f.path}));
    return [{path: FILE, body}, ...rest];
  }

  /** 只这条消息不用 BRAND.md：发送时在提示词末尾带一行（同 BC_AGENT_SKILLS.withSkill 的做法） */
  const SKIP_LINE = '这条消息不用品牌设定（BRAND.md）';
  const withoutBrand = (prompt) => { const p = String(prompt || ''); return p ? p + '\n' + SKIP_LINE : SKIP_LINE; };

  /** 建、改、移除：都按项目 id，返回新的 brands */
  const save = (brands, dirId, files, updated) => [{dir: dirId, updated: updated || '刚刚', files}, ...(brands || []).filter((b) => b.dir !== dirId)];
  const remove = (brands, dirId) => (brands || []).filter((b) => b.dir !== dirId);

  /* ---------- 持久化：只存用户动过的差量 ---------- */
  function snapshot(demo, brands) {
    const base = demo || [];
    return {
      changed: (brands || []).filter((b) => { const d = brandOf(base, b.dir); return !d || d.files !== b.files; }),
      removed: base.filter((d) => !brandOf(brands, d.dir)).map((d) => d.dir),
    };
  }
  function apply(demo, saved) {
    const sv = saved && typeof saved === 'object' ? saved : {};
    const removed = Array.isArray(sv.removed) ? sv.removed : [];
    const changed = Array.isArray(sv.changed) ? sv.changed.filter((b) => b && b.dir && Array.isArray(b.files)) : [];
    const base = (demo || []).filter((d) => !removed.includes(d.dir) && !brandOf(changed, d.dir)).map((d) => ({...d}));
    return [...changed, ...base];
  }

  root.BC_PROJECT_BRAND = {FILE, ASSET_DIR, GLOBAL, globalDir, isGlobal, scopeLine, layers, interviewPrompt, brandOf, hasBrand, brandFile, summaryOf, asSkill, list, find, template, fromSkill, SKIP_LINE, withoutBrand, save, remove, snapshot, apply};
})();
