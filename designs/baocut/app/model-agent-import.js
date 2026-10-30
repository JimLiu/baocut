/* BaoCut 原型 — 导入 Claude Code / Codex 的本机会话（产品设计 §3.1「导入外部会话」）里「算出来的东西」：window.BC_AGENT_IMPORT。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   在终端里做到一半的活接到 BaoCut 里继续：Claude Code 读 `~/.claude/projects` 下的会话记录，Codex 读它的会话列表（`thread/list`）。
   导入时把那条会话的记录复制进 BaoCut 的会话记录（之后能查找、能分叉），线程里一条分隔线「以上导入自 …」；
   之后用原生会话的恢复句柄接着跑，Agent 固定是来源的那一家。落在哪个项目按原会话的工作目录：已是项目就落进去，
   不是就默认把目录接成项目（不接就作为无项目会话，工作目录仍是原目录）。目录不在了不能导入（原生会话按目录找）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** 能从哪几家导入：`where` 是说明行里写的出处。只列本机找到的那几家（`sources`）。 */
  const SOURCES = [
    {id: 'claude', name: 'Claude Code', where: '~/.claude/projects'},
    {id: 'codex', name: 'Codex', where: 'Codex 的会话列表'},
  ];

  function sources(harnesses) {
    const found = new Set((harnesses || []).filter((h) => h.found).map((h) => h.id));
    return SOURCES.filter((s) => found.has(s.id));
  }

  /** 路径比较时去掉末尾的斜杠。 */
  const norm = (p) => String(p || '').replace(/\/+$/, '');

  /** 目录的最后一段，接成项目时用作项目名。 */
  function baseName(p) {
    const parts = norm(p).split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : String(p || '');
  }

  /**
   * 导入后落在哪：`project`（目录已是 BaoCut 的项目）、`adopt`（目录还不是项目，默认接成项目，`name` 取目录名）、
   * `missing`（目录不在了，不能导入）。项目自己标了目录不在（`dir.missing`）也算不在。
   */
  function landing(item, dirs) {
    if (!item || item.cwdMissing) return {k: 'missing'};
    const dir = (dirs || []).find((d) => norm(d.path) === norm(item.cwd));
    if (dir) return dir.missing ? {k: 'missing'} : {k: 'project', dir};
    return {k: 'adopt', path: item.cwd, name: baseName(item.cwd)};
  }

  /** 已经导入过的：BaoCut 里接着这条原生会话的那条会话（不重复导入，改成「打开」）。 */
  function importedAs(item, sessions) {
    return (sessions || []).find((s) => s.importedFrom && s.importedFrom.agent === item.agent && s.importedFrom.nativeId === item.nativeId) || null;
  }

  /** 列表：按 Agent 分段，搜索第一句与目录（不分大小写），最近的在前。`dir` 给了时只列那个目录的（项目菜单的入口）。 */
  function filter(list, o) {
    const q = String((o && o.q) || '').trim().toLowerCase();
    const dir = o && o.dir ? norm(o.dir) : null;
    return (list || [])
      .filter((x) => !o || !o.agent || x.agent === o.agent)
      .filter((x) => !dir || norm(x.cwd) === dir)
      .filter((x) => !q || String(x.title || '').toLowerCase().includes(q) || String(x.cwd || '').toLowerCase().includes(q))
      .slice()
      .sort((a, b) => (a.ago || 0) - (b.ago || 0));
  }

  /** 列表里每行下面的一行：目录 · 多久前 · N 轮。 */
  function meta(item, agoLabel) {
    return [item.cwd, agoLabel ? agoLabel(item.ago) : null, item.turns ? `${item.turns} 轮` : null].filter(Boolean).join(' · ');
  }

  /**
   * 导入后的会话行：原会话的消息按原样复制（ID 加前缀，不撞 BaoCut 自己的），末尾一条分隔线。
   * 原会话里的工具调用照样成为工具步骤，只是收起；最后一条分隔线写明来源与时刻。
   */
  function toRows(item, sourceName, atLabel) {
    const rows = (item.history || []).map((m, i) => Object.assign({}, m, {id: `imp_${i}`}));
    rows.push({id: 'imp_end', role: 'marker', kind: 'imported', text: `以上导入自 ${sourceName}${atLabel ? ` · ${atLabel}` : ''}`});
    return rows;
  }

  /** 对话框里的两行说明（不藏在规范里）。 */
  const NOTES = [
    '导入后接着原来那条会话跑。终端里如果还在用它，两边会各写各的记录。',
    'BaoCut 的说明与 skill 从导入后的第一轮起才生效；原会话加载过的项目层设置（项目里的 .claude/ 等）BaoCut 不加载。',
  ];

  root.BC_AGENT_IMPORT = {SOURCES, sources, baseName, landing, importedAs, filter, meta, toRows, NOTES};
})();
