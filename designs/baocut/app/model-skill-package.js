/* Skills 页（rail 上 Space 下面一格，2026-10-16）的纯模型：skill 里的文件分类与素材、上传的包怎么认、版本、复制与新建。
   和 model-agent-skills.js 分工：那边是开关、搜索、点选与持久化（Web 也加载）；这里只服务 App 的 Skills 页。
   一个 skill 是一个文件夹：SKILL.md 加上参考文件、模板与素材（logo、印章、片头音乐、字体……）。素材就是 skill 的一部分，
   上传 zip 或文件夹时一起进来，Agent 用这个 skill 时能把它们直接用进视频。BaoCut 不运行 skill 里的任何脚本。
   文件形状：{path, body?, size?, src?}——文本文件带 body；二进制只带 size（演示数据可带 src 预览）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 上限与 Runtime 一致（@baocut/protocol 的 SKILL_LIMITS）：200 个文件、合计 8 MiB；SKILL.md 64 KiB */
  const LIMITS = {files: 200, totalBytes: 8 * 1024 * 1024, skillFileBytes: 64 * 1024};

  const ext = (path) => { const m = /\.([a-z0-9]+)$/i.exec(String(path || '')); return m ? m[1].toLowerCase() : ''; };
  const KINDS = {
    md: 'doc', markdown: 'doc', txt: 'doc',
    svg: 'svg', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
    mp3: 'audio', wav: 'audio', m4a: 'audio', flac: 'audio', ogg: 'audio',
    mp4: 'video', mov: 'video', webm: 'video',
    ttf: 'font', otf: 'font', woff2: 'font',
    json: 'data', yaml: 'data', yml: 'data', csv: 'data', toml: 'data',
    js: 'script', mjs: 'script', cjs: 'script', ts: 'script', py: 'script', sh: 'script', rb: 'script', ps1: 'script', bat: 'script',
    html: 'code', css: 'code',
  };
  /** 文件属于哪一类：skill（根目录的 SKILL.md）/ doc / svg / image / audio / video / font / data / script / code / other */
  function fileKind(path) {
    if (path === 'SKILL.md') return 'skill';
    return KINDS[ext(path)] || 'other';
  }
  const ASSET_KINDS = ['svg', 'image', 'audio', 'video', 'font'];
  const isAsset = (path) => ASSET_KINDS.includes(fileKind(path));
  const isScript = (path) => fileKind(path) === 'script';
  /** 能当文本看与编辑的（有 body 的才算） */
  const isText = (file) => !!file && typeof file.body === 'string';
  const KIND_LABEL = {svg: '图片', image: '图片', audio: '音频', video: '视频', font: '字体'};
  const KIND_UNIT = {svg: '张', image: '张', audio: '段', video: '段', font: '套'};

  const sizeOf = (f) => (typeof f.size === 'number' ? f.size : typeof f.body === 'string' ? new TextEncoder().encode(f.body).length : 0);
  /** 1.2 MB / 340 KB / 12 B */
  function bytesLabel(n) {
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  /** skill 里的素材，按 svg/图片 → 音频 → 视频 → 字体 排 */
  function assets(skill) {
    const order = (k) => ({svg: 0, image: 0, audio: 1, video: 2, font: 3})[k];
    return ((skill && skill.files) || []).filter((f) => isAsset(f.path))
      .map((f) => ({...f, kind: fileKind(f.path), name: f.path.split('/').pop(), bytes: sizeOf(f)}))
      .sort((a, b) => order(a.kind) - order(b.kind) || a.path.localeCompare(b.path));
  }
  /** 「2 张图片 · 4 段音频」：图片与 svg 合并计 */
  function assetLine(list) {
    const n = {};
    (list || []).forEach((a) => { const k = a.kind === 'svg' ? 'image' : a.kind; n[k] = (n[k] || 0) + 1; });
    return ['image', 'audio', 'video', 'font'].filter((k) => n[k]).map((k) => `${n[k]} ${KIND_UNIT[k]}${KIND_LABEL[k]}`).join(' · ');
  }
  /** 文件数、大小、素材与脚本 */
  function stats(skill) {
    const files = (skill && skill.files) || [];
    const a = assets(skill);
    return {files: files.length, bytes: files.reduce((s, f) => s + sizeOf(f), 0), assets: a, assetLine: assetLine(a),
      scripts: files.filter((f) => isScript(f.path)).map((f) => f.path)};
  }

  /* ---------- SKILL.md 的 front matter ---------- */
  function frontMatter(body) {
    const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(body || ''));
    const out = {};
    if (!m) return out;
    m[1].split(/\r?\n/).forEach((line) => {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
    });
    return out;
  }
  /* skill 的 id 照 SKILL.md 的 name 规则：小写字母、数字与连字符；中文名取不出字时由调用方兜底 */
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

  /* ---------- 上传的包：zip 或文件夹 ----------
     pkg：{name, entries: [{path, body?, size?, src?}]}。认法：
     - 系统与隐藏文件（__MACOSX/、.DS_Store、点开头的目录如 .claude-plugin/）略过，并告诉用户略过了什么；
     - 根目录有 SKILL.md → 一个 skill；否则每个含 SKILL.md 的子目录是一个候选（插件包常见的 skills/<名字>/），候选里的路径去掉前缀；
     - 一个 SKILL.md 都没有 → 报错；文件数、大小超上限 → 报错。 */
  const hidden = (path) => path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX');
  function parsePackage(pkg) {
    const entries = (pkg && pkg.entries) || [];
    const ignored = [...new Set(entries.filter((e) => hidden(e.path)).map((e) => {
      const seg = e.path.split('/'); const i = seg.findIndex((s) => s.startsWith('.') || s === '__MACOSX');
      return seg.slice(0, i + 1).join('/') + (i < seg.length - 1 ? '/' : '');
    }))];
    const files = entries.filter((e) => !hidden(e.path));
    const roots = files.filter((e) => e.path === 'SKILL.md' || e.path.endsWith('/SKILL.md'))
      .map((e) => e.path.slice(0, -'SKILL.md'.length))
      .filter((r, _, all) => !all.some((o) => o !== r && r.startsWith(o)));   // 嵌套的 SKILL.md 归外层那个
    if (!roots.length) return {ok: false, error: '这个包里没有 SKILL.md。Skill 的根目录要有一份 SKILL.md，说明它做什么、什么时候用。', ignored};
    const candidates = roots.map((prefix) => {
      const own = files.filter((e) => e.path.startsWith(prefix)).map((e) => ({...e, path: e.path.slice(prefix.length)}));
      const skillMd = own.find((e) => e.path === 'SKILL.md');
      const fm = frontMatter(skillMd.body);
      const folder = prefix.replace(/\/$/, '').split('/').pop() || String(pkg.name || '').replace(/\.zip$/i, '');
      const name = fm.name || folder;
      const skill = {id: slug(name) || slug(folder) || 'skill', name, description: fm.description || '', files: own};
      const st = stats(skill);
      let error = '';
      if (!fm.description) error = 'SKILL.md 开头缺少 description：写一两句它做什么、什么时候用，Agent 靠这句话判断要不要用它。';
      else if (st.files > LIMITS.files) error = `文件太多（${st.files} 个），一个 skill 最多 ${LIMITS.files} 个文件。`;
      else if (st.bytes > LIMITS.totalBytes) error = `太大了（${bytesLabel(st.bytes)}），一个 skill 合计最多 ${bytesLabel(LIMITS.totalBytes)}。`;
      return {prefix, skill, stats: st, error};
    });
    return {ok: true, candidates, ignored};
  }

  /* ---------- 和已有的撞名 ----------
     同 id 的个人 skill → 可以「更新为新版本」（旧版本保留，可以恢复），也可以另存为副本；
     同 id 的内置或第三方 → 只能另存为副本（内置的不能改，第三方的更新从 GitHub 来）。 */
  function conflictOf(list, skill) {
    const cur = (list || []).find((s) => s.id === skill.id);
    if (!cur) return null;
    return {skill: cur, canUpdate: cur.source === 'personal', nextVersion: versionOf(cur) + 1};
  }
  function copyId(list, id) {
    let n = 2;
    while ((list || []).some((s) => s.id === `${id}-${n}`)) n++;
    return `${id}-${n}`;
  }

  /* ---------- 版本 ----------
     每次保存（上传更新、页内编辑）产生一个整数版本；versions 新的在前，每项 {n, updated, note, files}。
     看旧版本只读；「恢复为这个版本」= 用它的文件存一个新版本，不改写历史。 */
  const versionOf = (skill) => (skill && skill.version) || 1;
  function versions(skill) {
    if (!skill) return [];
    const list = skill.versions && skill.versions.length ? skill.versions : [{n: versionOf(skill), updated: skill.updated, note: ''}];
    return list.map((v) => (v.n === versionOf(skill) ? {...v, files: skill.files, current: true} : v));
  }
  function filesAt(skill, n) {
    const v = versions(skill).find((x) => x.n === n);
    return (v && v.files) || (skill && skill.files) || [];
  }
  /** 存一个新版本：files 是完整的新文件清单 */
  function saveVersion(list, id, files, note) {
    return (list || []).map((s) => {
      if (s.id !== id) return s;
      const n = versionOf(s) + 1;
      const past = versions(s).map(({current, ...v}) => v);
      const fm = frontMatter((files.find((f) => f.path === 'SKILL.md') || {}).body);
      /* 名字不跟着 SKILL.md 的 name 走：那是给 Agent 的标识（多半是英文 id），列表上的名字是用户起的 */
      return {...s, description: fm.description || s.description, files, version: n, updated: '刚刚', fresh: true,
        versions: [{n, updated: '刚刚', note: note || ''}, ...past]};
    });
  }

  /** 上传装进来：mode 'new'（新的）/ 'update'（更新同名的个人 skill）/ 'copy'（另存为副本） */
  function install(list, cand, mode, origin) {
    const sk = cand.skill;
    if (mode === 'update') {
      const next = saveVersion(list, sk.id, sk.files, '上传 ' + (origin || '新版本'))
        .map((s) => (s.id === sk.id && origin ? {...s, origin} : s));
      return {list: next, id: sk.id};
    }
    const id = mode === 'copy' ? copyId(list, sk.id) : sk.id;
    const name = mode === 'copy' ? sk.name + ' 副本' : sk.name;
    const skill = {id, name, description: sk.description, source: 'personal', author: '你', category: guessCategory(sk), enabled: true,
      updated: '刚刚', fresh: true, version: 1, origin: origin || '', examples: [], files: sk.files,
      versions: [{n: 1, updated: '刚刚', note: '上传 ' + (origin || '')}]};
    return {list: [skill, ...(list || [])], id};
  }
  /** 内置的不能改：复制一份到「我的」再改 */
  function duplicate(list, id) {
    const s = (list || []).find((x) => x.id === id);
    if (!s) return {list, id: null};
    const nid = copyId(list, s.id);
    const copy = {...s, id: nid, name: s.name + ' 副本', summary: undefined, source: 'personal', author: '你', enabled: true,
      updated: '刚刚', fresh: true, version: 1, origin: '复制自「' + s.name + '」', versions: [{n: 1, updated: '刚刚', note: '复制自「' + s.name + '」'}]};
    return {list: [copy, ...list], id: nid};
  }
  /** 新建一个空白 skill：一份带 front matter 的 SKILL.md 模板 */
  function blank(list, name, when) {
    const nm = String(name || '').trim();
    if (!nm) return {error: '给 skill 起个名字。'};
    const desc = String(when || '').trim() || '写一两句：它做什么，用户说什么的时候用它。';
    const id0 = slug(nm) || 'my-skill';
    const id = (list || []).some((s) => s.id === id0) ? copyId(list, id0) : id0;
    const body = `---\nname: ${id}\ndescription: ${desc}\n---\n\n# ${nm}\n\n## 什么时候用\n\n- \n\n## 步骤\n\n1. \n\n## 素材\n\n把要用的 logo、印章、片头音乐放进 assets/，在这里写清每个文件什么时候用。\n`;
    const skill = {id, name: nm, description: desc, source: 'personal', author: '你', category: '我的', enabled: true, updated: '刚刚', fresh: true,
      version: 1, examples: [], files: [{path: 'SKILL.md', body}], versions: [{n: 1, updated: '刚刚', note: '新建'}]};
    return {list: [skill, ...(list || [])], id};
  }
  /** 带素材的多半是品牌类；其余归「我的」 */
  const guessCategory = (sk) => (assets(sk).length ? '品牌' : '我的');

  /* ---------- 列表 ---------- */
  /** 两段：我的（个人 + 从 GitHub 导入的）与 BaoCut 内置；query 照 BC_AGENT_SKILLS.find 的搜法 */
  function sections(list, query) {
    const K = root.BC_AGENT_SKILLS;
    const rows = K ? K.find(list, query, 'all') : (list || []);
    return [
      {k: 'mine', label: '我的', items: rows.filter((s) => s.source !== 'builtin')},
      {k: 'builtin', label: 'BaoCut 内置', items: rows.filter((s) => s.source === 'builtin')},
    ];
  }
  /** 类别 → S2 图标名（Skills 页的行、输入框「+ › 使用 Skill」共用） */
  const CATEGORY_ICON = {字幕: 'CloseCaptions', 剪辑: 'Cut', 发布: 'Publish', 品牌: 'Bookmark', 文稿: 'FileText', 社区: 'GlobeGrid', 我的: 'Lightbulb'};
  const iconName = (category) => CATEGORY_ICON[category] || 'Lightbulb';
  /** 列表右侧的日期：YYYY-MM-DD → 「10 月 14 日」；相对时间原样 */
  function dateLabel(skill) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((skill && skill.updated) || ''));
    return m ? `${Number(m[2])} 月 ${Number(m[3])} 日` : String((skill && skill.updated) || '');
  }
  /** 第二行：「你 · 描述」/「来自 GitHub · owner · 描述」/「BaoCut · 一句话」 */
  function byline(skill) {
    const who = skill.source === 'third-party' ? `GitHub · ${skill.author}` : skill.author;
    return who;
  }

  root.BC_SKILL_PKG = {
    LIMITS, fileKind, isAsset, isScript, isText, ASSET_KINDS, KIND_LABEL, bytesLabel, assets, assetLine, stats, frontMatter, slug,
    parsePackage, conflictOf, versionOf, versions, filesAt, saveVersion, install, duplicate, blank, sections, iconName, dateLabel, byline,
  };
})();
