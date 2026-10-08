/* 设置 › Agent「添加更多 Agent」的纯层（product-design §7.6）：目录搜索、目录条目与自定义命令变成一家 provider、
   自定义命令的解析与校验、添加与移除。视图（settings-agent-catalog.jsx）只组合，store 只存添加的那几家。

   添加的 provider 与内置的同形（model-agent-setup.js 的探测字段），另带：
     added    'catalog' | 'custom'：用户添加的，能移除；内置的没有这个字段，只能停用
     launch   BaoCut 启动它用的命令数组（经 ACP）；env 启动时附加的环境变量
     launcher 'npx' | 'uvx' | null：由包管理器现取现用的不需要单独安装
   刚添加时 found:false、模型表为空——和内置的一样，探测到之后才有模型、才进选择器。 */
(function () {
  const ID_RE = /^[a-z][a-z0-9-]*$/;
  const ID_MAX = 40;
  const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const LAUNCHERS = {npx: {needs: 'Node.js'}, uvx: {needs: 'uv'}};

  const norm = (t) => String(t || '').toLowerCase();
  /** 目录搜索：按空白拆词，每个词都要在名字、id、介绍或命令里出现（不分大小写）。
      `addedIds` 里的条目标 added:true，行上换成「已添加」。空查询返回全部，次序同目录。 */
  function searchCatalog(catalog, query, addedIds) {
    const taken = new Set(addedIds || []);
    const words = norm(query).split(/\s+/).filter(Boolean);
    return (catalog || []).filter((e) => {
      const hay = norm([e.name, e.id, e.desc, (e.command || []).join(' ')].join(' '));
      return words.every((w) => hay.includes(w));
    }).map((e) => ({...e, added: taken.has(e.id)}));
  }

  /** 命令行按空白拆成数组；双引号或单引号包住的一段算一个参数（引号本身去掉）。 */
  function splitCommand(line) {
    const out = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(String(line || '')))) out.push(m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]);
    return out;
  }
  /** 环境变量：每行一个 KEY=VALUE，空行忽略。返回 {env, bad}；bad 是第一处写错的行号（从 1 数），没有为 null。 */
  function parseEnv(text) {
    const env = {};
    const lines = String(text || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line) continue;
      const at = line.indexOf('=');
      const key = at > 0 ? line.slice(0, at).trim() : '';
      if (!ENV_RE.test(key)) return {env, bad: i + 1};
      env[key] = line.slice(at + 1).trim();
    }
    return {env, bad: null};
  }

  /** 由包管理器现取现用（`npx -y 包@版本`、`uvx --from 包==版本 …`）时，包名带版本；否则 null。 */
  function launcherOf(command) {
    const c = command || [];
    if (!LAUNCHERS[c[0]]) return null;
    if (c[0] === 'npx') { const spec = c.slice(1).find((t) => !t.startsWith('-')); return spec ? {k: 'npx', spec} : null; }
    const from = c.indexOf('--from');
    const spec = from > 0 ? c[from + 1] : c.slice(1).find((t) => !t.startsWith('-'));
    return spec ? {k: 'uvx', spec} : null;
  }

  /** 自定义命令表单的校验：{id, name, command, env} → 按字段的错误（没有错误的字段不出现）。
      `takenIds` = 内置的、已添加的与目录里的 id，撞上就提示换一个。 */
  function validateCustom(form, takenIds, names) {
    const f = form || {};
    const err = {};
    const id = String(f.id || '').trim();
    const taken = new Set(takenIds || []);
    if (!id) err.id = '填一个 id，例如 my-agent';
    else if (!ID_RE.test(id)) err.id = 'id 要以小写字母开头，只能用小写字母、数字和连字符';
    else if (id.length > ID_MAX) err.id = `id 最长 ${ID_MAX} 个字符`;
    else if (taken.has(id)) err.id = `已经有一个 Agent 用了「${id}」${names && names[id] && names[id] !== id ? `（${names[id]}）` : ''}，换一个 id`;
    if (!String(f.name || '').trim()) err.name = '填一个显示在列表里的名字';
    const cmd = splitCommand(f.command);
    if (!cmd.length) err.command = '填启动它的命令，例如 my-agent --acp';
    else if (cmd.some((t) => /^(\||\|\||&&|;|>|<)$/.test(t)) || /[|;&<>]/.test(cmd[0])) err.command = '只填一条命令：BaoCut 直接启动它，不经过终端，管道、重定向和 && 都不生效';
    const env = parseEnv(f.env);
    if (env.bad) err.env = `第 ${env.bad} 行要写成 KEY=VALUE，KEY 以字母或下划线开头`;
    return err;
  }
  const hasErrors = (err) => Object.keys(err || {}).length > 0;

  /* 模型表是探测到之后由它的 ACP 应答给出的；原型探测落定时用这份演示值。 */
  const DEMO_MODELS = [{id: 'default', name: '标准', dflt: true, tier: 'balanced'}, {id: 'fast', name: '快速', tier: 'fast'}];
  /* account 的第一段是选择器与状态卡上的副文案；添加的那家用哪个账号 BaoCut 不知道，只说它怎么接进来的。 */
  const ACCOUNT = '经 ACP 接入';
  const PLAN = '它自己的账号';

  /** 目录条目或自定义命令 → 一家 provider（还没探测：found:false、没有模型）。 */
  function toHarness(src, added) {
    const command = (src.command || []).slice();
    const l = launcherOf(command);
    const exe = command[0] || src.id;
    return {
      id: src.id, name: src.name, desc: src.desc || null, added, extra: false,
      cmd: exe, launch: command, env: src.env || {}, launcher: l ? l.k : null, launcherNeeds: l ? LAUNCHERS[l.k].needs : null, spec: l ? l.spec : null,
      docs: src.docs || null, found: false, enabled: true, loggedIn: true, runError: null,
      ver: src.ver || '1.0.0', minVer: null, latest: src.ver || '1.0.0',
      bin: '/opt/homebrew/bin/' + exe, configModel: null, configModelKnown: null,
      account: ACCOUNT, plan: PLAN, install: null, installs: [], models: [],
    };
  }
  const fromCatalog = (entry) => toHarness(entry, 'catalog');
  function fromCustom(form) {
    return toHarness({
      id: String(form.id).trim(), name: String(form.name).trim(), command: splitCommand(form.command), env: parseEnv(form.env).env,
    }, 'custom');
  }
  /** 原型里「重新检测」落定的样子：找到了、还要登录一次（ACP 的 session/new 回「需要登录」），模型表到手。 */
  const detectedPatch = () => ({found: true, loggedIn: false, models: DEMO_MODELS.slice()});

  /** 启动命令的展示：整行，环境变量在前。 */
  function launchLine(h) {
    const env = Object.entries((h && h.env) || {}).map(([k, v]) => `${k}=${/\s/.test(v) ? `"${v}"` : v}`);
    const cmd = ((h && h.launch) || []).map((t) => (/\s/.test(t) || t === '' ? `"${t}"` : t));
    return env.concat(cmd).join(' ');
  }

  /** 添加：同 id 已在就不动；移除：只动添加的那家，内置的不在这张表里。 */
  const addTo = (list, h) => ((list || []).some((x) => x.id === h.id) ? list || [] : (list || []).concat([h]));
  const removeFrom = (list, id) => (list || []).filter((x) => x.id !== id);
  const removable = (h) => !!(h && h.added);

  window.BC_AGENT_CATALOG = {
    ID_RE, searchCatalog, splitCommand, parseEnv, launcherOf, validateCustom, hasErrors,
    DEMO_MODELS, fromCatalog, fromCustom, detectedPatch, launchLine, addTo, removeFrom, removable,
  };
})();
