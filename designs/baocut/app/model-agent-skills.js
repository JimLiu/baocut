/* BaoCut 内置 Agent 自己使用的 skills（设置 › Skills，以及输入框「+」里的「使用 Skill」）。
   和 model-skill-install.js 是两回事：那边讲的是把 BaoCut 的 skill 装进终端里的其他 Agent；这里是内置 Agent 自己按什么方法做事。
   全局只有一条语义：
   - Skill = 一个文件夹（SKILL.md + 可选的 references/ 等文件），教 Agent 按某种方法做事。
   - 开关开：Agent 觉得相关时会自己用它。开关关：只在你从输入框「+」里选它时才用。关不是删除，移除才是删除。
   - 从「+」里选了某个 skill = 这条消息明确要求用它：输入框上挂一个可移除的 token，发送时在提示词末尾带一行 promptLine。
   skill 形状：{id, name, summary, description, source: 'builtin'|'personal'|'third-party', author, category, enabled,
   updated, examples: [...], files: [{path, body}]}。演示数据在 data.js 的 agentSkills / agentSkillFolders；不碰磁盘。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const SOURCES = [
    {k: 'builtin', label: '内置'},
    {k: 'personal', label: '我的'},
    {k: 'third-party', label: '第三方'},
  ];
  const TABS = [{k: 'all', label: '全部'}, ...SOURCES];
  const THIRD_PARTY_NOTE = '第三方 skill 来自社区，添加前请看一眼它的文件。';
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  const sourceLabel = (k) => (SOURCES.find((s) => s.k === k) || SOURCES[1]).label;

  /** 列表区：先按页签（来源）筛，再按名称、描述、作者、分类搜；顺序不变。 */
  function find(list, query, tab) {
    const q = lc(query).trim();
    return (list || []).filter((s) => (!tab || tab === 'all' || s.source === tab)
      && (!q || [s.name, s.summary, s.description, s.author, s.category].some((v) => lc(v).includes(q))));
  }
  /** 各页签的计数；query 给了就是搜索后的计数。 */
  function counts(list, query) {
    const rows = find(list, query, 'all');
    const out = {all: rows.length};
    SOURCES.forEach((s) => { out[s.k] = rows.filter((x) => x.source === s.k).length; });
    return out;
  }
  const byId = (list, id) => (list || []).find((s) => s.id === id) || null;
  /** 开关：on 缺省时取反。只改 enabled，不动别的。 */
  function toggle(list, id, on) {
    return (list || []).map((s) => (s.id === id ? {...s, enabled: on === undefined ? !s.enabled : !!on} : s));
  }
  /** 添加：同 id 已在列表里就拒绝；新加的排最前。 */
  function add(list, skill) {
    if (!skill || !skill.id || !skill.name) return {list, error: '这个 skill 缺少名称，无法添加。'};
    if (byId(list, skill.id)) return {list, error: `「${skill.name}」已经添加过了。`};
    return {list: [skill, ...(list || [])], skill};
  }
  /** 移除：内置 skill 不能移除，只能关。 */
  function remove(list, id) {
    const s = byId(list, id);
    if (!s) return {list, error: '没有找到这个 skill。'};
    if (s.source === 'builtin') return {list, error: '内置 skill 不能移除，可以把它关掉。'};
    return {list: list.filter((x) => x.id !== id), skill: s};
  }
  const clip = (text, n) => { const t = String(text || '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  /** 输入框「+ › 使用 Skill」的条目：全部已添加的，开着的在前，组内保持原顺序；描述截成一行。 */
  function menuItems(list) {
    const rows = (list || []).map((s) => ({id: s.id, name: s.name, desc: clip(s.summary || s.description, 20), enabled: !!s.enabled, category: s.category}));
    return rows.filter((s) => s.enabled).concat(rows.filter((s) => !s.enabled));
  }
  /** 发送时带在提示词末尾的那一行。 */
  const promptLine = (skill) => (skill && skill.name ? `使用 skill：${skill.name}` : '');
  function withSkill(prompt, skill) {
    const line = promptLine(skill);
    const p = String(prompt || '');
    return line ? (p ? p + '\n' + line : line) : p;
  }

  /** 「来源 · 更新于 …」：updated 是 YYYY-MM-DD 就写成「9 月 28 日」，否则是相对时间原样（「刚刚」）。 */
  function updatedLabel(skill) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String((skill && skill.updated) || ''));
    if (m) return `更新于 ${Number(m[2])} 月 ${Number(m[3])} 日`;
    return skill && skill.updated ? `${skill.updated}更新` : '';
  }
  const metaLine = (skill) => [sourceLabel(skill.source), updatedLabel(skill)].filter(Boolean).join(' · ');

  /* ---------- 添加：从本地文件夹 ---------- */
  const slug = (s) => lc(s).replace(/[^a-z0-9一-龥]+/g, '-').replace(/^-+|-+$/g, '');
  /** folder：{path, skill?}（演示文件夹）。文件夹里要有 SKILL.md；没有就给错误。添加进来的归「我的」，默认开。 */
  function fromFolder(folder, list) {
    if (!folder) return {error: '先选一个文件夹。'};
    const sk = folder.skill;
    if (!sk || !(sk.files || []).some((f) => f.path === 'SKILL.md')) return {error: '这个文件夹里没有 SKILL.md。Skill 文件夹的根目录要有一份 SKILL.md。'};
    const skill = {...sk, id: sk.id || 'local-' + slug(folder.path), source: 'personal', enabled: true, updated: '刚刚', origin: folder.path};
    if (byId(list, skill.id)) return {error: `「${skill.name}」已经添加过了。`};
    return {skill};
  }

  /* ---------- 添加：从 GitHub 导入 ---------- */
  const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
  /** 认 `owner/repo` 与 `https://github.com/owner/repo[/tree/branch/path]`（可带 .git、末尾斜杠）。 */
  function parseGithub(input) {
    const raw = String(input || '').trim();
    if (!raw) return {ok: false, error: '输入仓库地址，例如 owner/repo。'};
    let rest = raw;
    const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i.exec(raw);
    if (url) rest = url[1];
    else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /^[^/\s]+\.[a-z]{2,}\//i.test(raw)) return {ok: false, error: '只支持 GitHub 仓库地址。'};
    const parts = rest.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return {ok: false, error: '地址要写成 owner/repo，或 https://github.com/owner/repo。'};
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!NAME_RE.test(owner) || !NAME_RE.test(repo)) return {ok: false, error: '仓库地址里有不能识别的字符。'};
    let branch = null, path = '';
    if (parts.length > 2) {
      if (parts[2] !== 'tree' || !parts[3]) return {ok: false, error: '只支持仓库首页，或 /tree/分支/文件夹 形式的地址。'};
      branch = parts[3];
      path = parts.slice(4).join('/');
    }
    const name = path ? path.split('/').pop() : repo;
    return {ok: true, owner, repo, branch, path, name, url: `https://github.com/${owner}/${repo}${branch ? `/tree/${branch}${path ? '/' + path : ''}` : ''}`};
  }
  /** 解析结果 → 一条「第三方」skill，默认关（第三方默认只在选用时生效）。内容是演示占位。 */
  function fromGithub(parsed, list) {
    if (!parsed || !parsed.ok) return {error: (parsed && parsed.error) || '地址不对。'};
    const id = `gh-${lc(parsed.owner)}-${lc(parsed.repo)}${parsed.path ? '-' + slug(parsed.path) : ''}`;
    if (byId(list, id)) return {error: '这个仓库里的 skill 已经添加过了。'};
    const summary = `从 ${parsed.owner}/${parsed.repo} 导入的 skill。`;
    const skill = {id, name: parsed.name, summary, description: `${summary}第三方 skill 默认关闭：只在你从输入框「+」里选它时才用。打开开关后，Agent 觉得相关时会自己用它。`,
      source: 'third-party', author: parsed.owner, category: '社区', enabled: false, updated: '刚刚', origin: parsed.url, examples: [],
      files: [{path: 'SKILL.md', body: `---\nname: ${parsed.name}\ndescription: ${summary}\n---\n\n# ${parsed.name}\n\n原型演示：正式版会在这里显示从仓库读到的 SKILL.md。\n\n## 来源\n\n- 仓库：${parsed.owner}/${parsed.repo}\n- 分支：${parsed.branch || '默认分支'}\n- 文件夹：${parsed.path || '仓库根目录'}`}]};
    return {skill};
  }

  /* ---------- 文件视图 ---------- */
  /** 文件树：SKILL.md 在最前，其余按路径；每行带缩进层级与所在文件夹。 */
  function fileTree(skill) {
    const files = ((skill && skill.files) || []).slice().sort((a, b) =>
      (a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path)));
    const out = [];
    const seen = new Set();
    files.forEach((f) => {
      const segs = f.path.split('/');
      segs.slice(0, -1).forEach((_, i) => {
        const dir = segs.slice(0, i + 1).join('/');
        if (!seen.has(dir)) { seen.add(dir); out.push({kind: 'dir', path: dir, name: segs[i] + '/', depth: i}); }
      });
      out.push({kind: 'file', path: f.path, name: segs[segs.length - 1], depth: segs.length - 1});
    });
    return out;
  }
  /** Markdown 正文 → {frontmatter, blocks}。frontmatter 原样（按代码块画）；块只认标题、列表、代码块与段落。 */
  function fileBlocks(body) {
    let text = String(body || '').replace(/\r\n/g, '\n');
    let frontmatter = null;
    const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
    if (fm) { frontmatter = fm[1]; text = text.slice(fm[0].length); }
    const blocks = [];
    let para = [], code = null;
    const flush = () => { if (para.length) { blocks.push({type: 'p', text: para.join(' ')}); para = []; } };
    text.split('\n').forEach((line) => {
      if (/^```/.test(line)) {
        if (code) { blocks.push({type: 'code', text: code.join('\n')}); code = null; } else { flush(); code = []; }
        return;
      }
      if (code) { code.push(line); return; }
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      const li = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
      if (h) { flush(); blocks.push({type: 'h' + h[1].length, text: h[2]}); }
      else if (li) { flush(); blocks.push({type: li[1] ? 'ol' : 'li', n: li[1] ? Number(li[1]) : undefined, text: li[2]}); }
      else if (!line.trim()) flush();
      else para.push(line.trim());
    });
    if (code) blocks.push({type: 'code', text: code.join('\n')});
    flush();
    return {frontmatter, blocks};
  }

  /* ---------- 持久化：只存用户动过的差量，演示数据改了文案不会被旧存储盖住 ---------- */
  /** list 相对 demo 的差量：开关改过的、用户添加的、移除掉的。 */
  function snapshot(demo, list) {
    const base = demo || [];
    const enabled = {};
    (list || []).forEach((s) => { const d = byId(base, s.id); if (d && !!d.enabled !== !!s.enabled) enabled[s.id] = !!s.enabled; });
    return {enabled, added: (list || []).filter((s) => !byId(base, s.id)),
      removed: base.filter((d) => !byId(list, d.id)).map((d) => d.id)};
  }
  /** demo + 差量 → 列表；差量坏了或缺字段时回到 demo。 */
  function apply(demo, saved) {
    const sv = saved && typeof saved === 'object' ? saved : {};
    const removed = Array.isArray(sv.removed) ? sv.removed : [];
    const en = sv.enabled && typeof sv.enabled === 'object' ? sv.enabled : {};
    const base = (demo || []).filter((d) => d.source === 'builtin' || !removed.includes(d.id))
      .map((d) => (Object.prototype.hasOwnProperty.call(en, d.id) ? {...d, enabled: !!en[d.id]} : {...d}));
    const added = (Array.isArray(sv.added) ? sv.added : []).filter((s) => s && s.id && s.name && !byId(base, s.id));
    return added.concat(base);
  }

  root.BC_AGENT_SKILLS = {
    SOURCES, TABS, THIRD_PARTY_NOTE, sourceLabel, find, counts, byId, toggle, add, remove, menuItems, promptLine, withSkill,
    updatedLabel, metaLine, fromFolder, parseGithub, fromGithub, fileTree, fileBlocks, snapshot, apply,
  };
})();
