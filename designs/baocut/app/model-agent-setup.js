/* Settings › Agent 的纯层（2026-09-18 重设计）：一家 provider 现在处于什么状态、该给用户看哪句话和哪颗按钮、
   排查清单怎么列、默认模型推荐哪一个、装与升级用哪条命令。视图只组合，不在 JSX 里判断状态。

   探测结果的形状（`data.js agent.harnesses` + store 的演示补丁）：
     found      本机找得到可执行文件
     runError   找到了却跑不起来（`claude --version` 失败）的原话；null = 能跑
     ver / minVer / latest   当前版本 / BaoCut 能驱动的最低版本 / 上游最新版本
     loggedIn   false = CLI 自己报告未登录或登录过期
     enabled    设置里的启用开关
     configModel       BaoCut 不指定模型时，CLI 自己的配置会选哪个模型（2026-09-29；读不到 = null）
     configModelKnown  那个 id 在不在**这个版本的 CLI 自己的完整模型表**里（含隐藏模型）：true / false / null（没法判断）。
                       由内核算好送来，视图不拿可见的模型表重算——隐藏模型不在可见表里，但这一版是认得的。
   状态优先级：missing > error > outdated > login > off > ready。前四个是「用不了」，off 是「你关的」。 */
(function () {
  function compareVer(a, b) {
    const pa = String(a || '0').split('.'), pb = String(b || '0').split('.');
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (parseInt(pa[i], 10) || 0) - (parseInt(pb[i], 10) || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  function health(h) {
    if (!h || !h.found) return 'missing';
    if (h.runError) return 'error';
    if (h.minVer && compareVer(h.ver, h.minVer) < 0) return 'outdated';
    if (h.loggedIn === false) return 'login';
    if (h.enabled === false) return 'off';
    return 'ready';
  }
  const BLOCKING = {missing: true, error: true, outdated: true, login: true};
  /** 装着却用不了：pickHarness 要跳过它，首页与 composer 才不会把活交给一个跑不起来的 CLI。 */
  const blocked = (h) => { const s = health(h); return s !== 'missing' && !!BLOCKING[s]; };
  /** 装的那一版低于 reinstall.below：换了发行包（OpenCode 1.x 在官方脚本与 opencode-ai，2.x 只在 @opencode/cli），
      原地升级到不了能驱动的版本，只能改装。 */
  const needsReinstall = (h) => !!(h && h.found && h.reinstall && compareVer(h.ver, h.reinstall.below) < 0);
  const hasUpdate = (h) => !!(h && h.found && h.latest && compareVer(h.ver, h.latest) < 0);

  /* ---------- 默认模型需要更新的 CLI（2026-09-29） ----------
     事故：另一个应用自带的新版 codex 把 `model = "gpt-6-sol"` 写进了共用的 `~/.codex/config.toml`，
     BaoCut 调用的是 PATH 上较旧的那一份。会话选的是「Agent 默认模型」（BaoCut 不传模型）时，旧 CLI 照配置
     发出 gpt-6-sol，服务端每一轮都拒绝。这一版 CLI 自己的模型表里根本没有它。
     两道防线都**不替用户改模型**：模型目录是「发现」的证据，不是改写用户选择的许可；要换只能是用户自己点。
       1. 发之前（`defaultModelGate`）：配置里的模型这一版不认得 → 在 composer 上方提示升级或显式改选；照样能发。
       2. 失败之后（`modelGateFailure`）：按 CLI 的失败原话认出来 → 就地给升级 / 改选的恢复区。
     这里不改 health / blocked：CLI 本身能用，只是「不指定模型」这一条路会失败，所以不跳过它、不挡发送。 */
  /** 这一家该拿什么当「显式改选」的建议：推荐模型（与新会话起手同一个），不能是配置里那个不认得的。 */
  function gateFallback(h) {
    const ms = (h && h.models) || [];
    const r = recommended(h);
    if (r && r.id !== h.configModel) return r;
    return ms.find((m) => m.id !== h.configModel) || null;
  }
  /** null = 没事；否则 {model, ver, latest, fallback}。latest 只在确实有更新的版本时给（没有就是 null）；
      fallback 是模型对象（{id, name, …}），只用作「改用它」那颗按钮的建议，BaoCut 自己不会换。
      configModelKnown 为 null（判断不了）或 true（含隐藏模型在内认得它）都不拦。 */
  function defaultModelGate(h) {
    if (!h || !h.found || !h.configModel || h.configModelKnown !== false) return null;
    return {model: h.configModel, ver: h.ver, latest: hasUpdate(h) ? h.latest : null, fallback: gateFallback(h)};
  }
  /* 失败详情里的这两种说法（CLI 的英文原话，按原文匹配，与界面语言无关；内核
     `bcut-editor-core::agent_setup::model_gate_failure` 同一张表）：
       The 'gpt-6-sol' model requires a newer version of Codex. Please upgrade…
       The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.
     模型 id 取第一个 '…' 里的内容；没有引号时 model 为 null，恢复区改说「这个模型」。 */
  const MODEL_GATE_NEEDLES = ['requires a newer version of codex', 'is not supported when using codex'];
  function modelGateFailure(detail) {
    const raw = String(detail || '');
    const t = raw.toLowerCase();
    if (!MODEL_GATE_NEEDLES.some((n) => t.includes(n))) return null;
    const q = raw.match(/'([^'\s]+)'/);
    return {model: q ? q[1] : null};
  }

  /** 行尾那枚状态词 + 色调。有新版本不是问题，只在就绪态上换一个词；默认模型要更新的 CLI 优先于「有新版本」。 */
  function badge(h) {
    const s = health(h);
    if (s === 'ready' && defaultModelGate(h)) return {tone: 'notice', label: hasUpdate(h) ? '可用 · 默认模型需升级' : '可用 · 默认模型不可用'};
    if (s === 'ready') return hasUpdate(h) ? {tone: 'notice', label: '可用 · 有新版本'} : {tone: 'positive', label: '可用'};
    if (s === 'missing' && h && h.added) return {tone: undefined, label: '还没检测'};   // 添加的（§7.6）：npx 现取现用的谈不上「安装」
    return {
      missing: {tone: undefined, label: '未安装'},
      error: {tone: 'negative', label: '无法运行'},
      outdated: {tone: 'negative', label: '版本过旧'},
      login: {tone: 'notice', label: '需要登录'},
      off: {tone: undefined, label: '已停用'},
    }[s];
  }

  /** 行下面那条问题说明：一句发生了什么、一句怎么办、一颗主按钮。没问题返回 null。 */
  function problem(h) {
    const s = health(h);
    if (s === 'error') return {kind: s, title: `找到了 ${h.name}，但它无法运行`, body: `${h.runError} 常见原因是 Node.js 被卸载或升级、文件权限被改。运行排查可以定位到具体哪一步。`, action: 'diagnose', cta: '运行排查'};
    if (s === 'outdated' && needsReinstall(h)) return {kind: s, title: `${h.name} ${h.ver} 太旧，BaoCut 无法驱动`, body: `装的是 ${h.ver}，大概来自${h.reinstall.from}，原地升级到不了 ${h.minVer}：请改装 ${h.reinstall.pkg}。改装只换这个命令行工具，不影响你的账号和它自己的设置；装好后旧的那一份可以删掉，免得 PATH 上先找到它。`, action: 'upgrade', cta: `改装 ${h.reinstall.pkg}`};
    if (s === 'outdated') return {kind: s, title: `${h.name} ${h.ver} 太旧，BaoCut 无法驱动`, body: `至少需要 ${h.minVer}。升级只更新这个命令行工具，不影响你的账号和它自己的设置。`, action: 'upgrade', cta: `升级到 ${h.latest || h.minVer}`};
    if (s === 'login') return {kind: s, title: `${h.name} 需要重新登录`, body: `登录在 ${h.name} 自己的窗口里完成，BaoCut 不经手你的账号和密码。登录后回到这里检查。`, action: 'login', cta: '打开终端登录'};
    return null;
  }

  /* ---------- 排查清单 ----------
     五步按依赖顺序排：前一步不过，后面的没法测，标 skip 而不是 fail——用户只需要看第一条红的。 */
  function diagnose(h) {
    const found = !!(h && h.found);
    const runs = found && !h.runError;
    const verOk = runs && !(h.minVer && compareVer(h.ver, h.minVer) < 0);
    const logged = verOk && h.loggedIn !== false;
    const step = (k, label, pass, reachable, okText, failText, fix) =>
      ({k, label, state: !reachable ? 'skip' : pass ? 'ok' : 'fail', detail: !reachable ? '上一步通过后再检查' : pass ? okText : failText, fix: reachable && !pass ? fix : null});
    return [
      step('find', '在这台电脑上找到它', found, true, h && h.bin, `在常见安装位置和 PATH 里都没找到 ${h ? h.cmd || h.bin : ''}`, {action: 'install', cta: '安装'}),
      step('run', '能够启动', runs, found, `${h && h.cmd} --version 返回 ${h && h.ver}`, h && h.runError, {action: 'reinstall', cta: '重新安装'}),
      step('ver', 'BaoCut 支持这个版本', verOk, runs, `${h && h.ver}，最低要求 ${h && h.minVer}`, `当前 ${h && h.ver}，最低要求 ${h && h.minVer}`, {action: 'upgrade', cta: '升级'}),
      step('login', '已登录你的账号', logged, verOk, h && String(h.account || '').split(' · ')[0], '它报告未登录或登录已过期', {action: 'login', cta: '打开终端登录'}),
      step('models', '能取到模型列表', logged, logged, `${((h && h.models) || []).length} 个模型`, '', null),
    ];
  }
  /** 排查结果一句话：全过 / 卡在第几步。 */
  function verdict(steps) {
    const bad = steps.find((s) => s.state === 'fail');
    return bad ? {ok: false, text: `卡在「${bad.label}」：${bad.detail}`} : {ok: true, text: '五项检查全部通过，可以开始会话'};
  }

  /* ---------- 默认模型 ----------
     每家模型带一个 tier：balanced = 推荐（日常够用、省额度），max = 最强，fast = 最快。
     偏好表 `prefs.agentModels[providerId]`：没设过 = 用推荐；'auto' = 交给 CLI 自己决定；其余是模型 id。 */
  const TIERS = {
    balanced: {label: '推荐', sub: '转录、翻译、剪辑都够用，速度快，也更省订阅额度'},
    max: {label: '最强', sub: '更慢，更耗订阅额度；一般用不上'},
    fast: {label: '最快', sub: '适合改几句字幕这类小改动'},
  };
  /* 推荐模型（2026-09-29 用户裁决）：Claude Code 取 Sonnet 系列、Codex CLI 取 Sol 系列——按这一版 CLI 自己的模型表次序，
     取第一个 Sonnet / 第一个 `-sol`。所以认得 gpt-6-sol 的新版推荐 gpt-6-sol，旧版推荐 gpt-5.6-sol。
     「没设过」= 推荐模型；只有用户明确选了「交给 Agent 自己决定」/「Agent 默认模型」才不传模型、按 CLI 配置走。
     其余几家不变：模型表里标了 balanced 的 → CLI 标的默认 → 第一个。 */
  const FAMILY = {claude: (m) => /sonnet/i.test(m.id), codex: (m) => /-sol$/i.test(m.id)};
  const recommended = (h) => {
    const ms = (h && h.models) || [];
    const fam = h && FAMILY[h.id];
    return (fam && ms.find(fam)) || ms.find((m) => m.tier === 'balanced') || ms.find((m) => m.dflt) || ms[0] || null;
  };
  function defaultModel(h, prefMap) {
    const v = (prefMap || {})[h && h.id];
    if (v === 'auto') return null;
    const hit = v && ((h && h.models) || []).find((m) => m.id === v);
    if (hit) return hit.id;
    const r = recommended(h);
    return r ? r.id : null;
  }
  /** 默认模型下拉的行：模型表 + 尾项「交给 Agent 自己决定」；偏好里的模型从目录里消失了也要原样露出来。 */
  function modelChoices(h, prefMap) {
    const cur = defaultModel(h, prefMap);
    const v = (prefMap || {})[h && h.id];
    const rec = recommended(h);
    /* 「推荐」只挂在推荐的那一个上（按上面的系列规则），其余的只认 max / fast 两档——模型表里可能不止一个 balanced。 */
    const tierOf = (m) => (rec && m.id === rec.id ? 'balanced' : m.tier === 'balanced' ? null : m.tier);
    const rows = ((h && h.models) || []).map((m) => {
      const t = TIERS[tierOf(m)];
      return {id: m.id, name: m.name, tag: t ? t.label : null, sub: t ? t.sub : null, on: cur === m.id};
    });
    if (v && v !== 'auto' && !rows.some((r) => r.id === v)) rows.unshift({id: v, name: v, tag: null, sub: '当前模型列表里没有它，新会话会改用推荐模型', on: false, gone: true});
    rows.push({id: 'auto', name: '交给 Agent 自己决定', tag: null, sub: '用它命令行里的默认模型', on: cur == null});
    return rows;
  }
  function modelLabel(h, prefMap) {
    const id = defaultModel(h, prefMap);
    if (id == null) return '交给 Agent 自己决定';
    const m = (h.models || []).find((x) => x.id === id);
    const rec = recommended(h);
    const t = m && TIERS[rec && m.id === rec.id ? 'balanced' : m.tier === 'balanced' ? null : m.tier];
    return (m ? m.name : id) + (t ? ` · ${t.label}` : '');
  }

  /* ---------- 安装与升级 ----------
     命令原样展示，左边一枚 ▶ 在设置页里直接运行（2026-09-18 起取代「摆进系统终端」），输出滚动显示在命令下面；
     `curl … | bash` 这类从网络下载并运行脚本的命令不给 ▶，只给复制（`runnable`）。登录要在 CLI 里交互，仍然去终端。

     已装那一份实际归谁管，看**真实位置**（`realBin`，链接一路解析到底），不看链接本身——与内核
     `agent_setup::install_source` 同一个次序、同一张判据表。只看链接会认错：Homebrew 的 node 下 `npm -g` 装的 codex
     也在 `/opt/homebrew/bin/`，当成 Homebrew 就会给出 `brew upgrade codex`，升不到它，还可能再装一份。认不出就是 null，
     升级那一段退回方式表的第一条，让人自己选。次序：
       1. 链接是 mise / asdf / nodenv 的 shim：真实位置只是管理器自己，认不出；volta 的全局包一律 `volta install`。
       2. Homebrew 的 Cellar / Caskroom 先于 node_modules（gemini-cli 的真身在 `Cellar/gemini-cli/…/lib/node_modules/…`）。
       3. bun / pnpm / yarn 的全局目录（它们的包也躺在 node_modules 里）。
       4. npm 全局只认 `<prefix>/lib/node_modules`（Windows `<prefix>\node_modules`）；Windows 的 npm shim 所在目录就是前缀。
       5. 官方安装脚本的目录。 */
  const locOf = (raw) => ({raw: String(raw || ''), key: String(raw || '').replace(/\\/g, '/').toLowerCase()});
  const segAfter = (loc, needle) => {
    const at = loc.key.indexOf(needle);
    if (at < 0) return null;
    const start = at + needle.length, slash = loc.key.indexOf('/', start);
    const len = (slash < 0 ? loc.key.length : slash) - start;
    return len > 0 ? loc.raw.slice(start, start + len) : null;
  };
  const pkgIn = (loc) => {
    const at = loc.key.indexOf('/node_modules/');
    if (at < 0) return null;
    const start = at + '/node_modules/'.length, parts = loc.key.slice(start).split('/');
    const len = (parts[0].startsWith('@') ? parts[0].length + 1 + (parts[1] || '').length : parts[0].length);
    return len > 0 ? loc.raw.slice(start, start + len).replace(/\\/g, '/') : null;
  };
  function installSource(bin, realBin) {
    const link = locOf(bin), real = locOf(realBin || bin);
    const any = (ns) => ns.some((n) => link.key.includes(n) || real.key.includes(n));
    const of = (k, pkg, prefix, cask) => ({k, pkg: pkg || null, prefix: prefix || null, cask: !!cask});
    if (['/mise/shims/', '/.asdf/shims/', '/.nodenv/shims/'].some((n) => link.key.includes(n))) return null;
    if (any(['/.volta/'])) return of('volta');
    const formula = segAfter(real, '/cellar/');
    if (formula) return of('brew', formula);
    const cask = segAfter(real, '/caskroom/');
    if (cask) return of('brew', cask, null, true);
    const pkg = pkgIn(real);
    if (any(['/.bun/'])) return of('bun', pkg);
    if (any(['/.pnpm/', '/pnpm/global/', '/library/pnpm/', '/.local/share/pnpm/', '/appdata/local/pnpm/'])) return of('pnpm', pkg);
    if (any(['/.yarn/', '/.config/yarn/', '/yarn/data/global/', '/yarn/bin/'])) return of('yarn', pkg);
    const nm = real.key.indexOf('/node_modules/');
    const win = real.raw.includes('\\') || real.key[1] === ':';
    if (nm >= 0) {
      const unix = real.key.slice(0, nm).endsWith('/lib');
      if (unix || win) return of('npm', pkg, real.raw.slice(0, unix ? nm - 4 : nm));
    }
    const slash = link.key.lastIndexOf('/');
    if (slash > 0 && link.key.slice(0, slash).endsWith('/npm')) return of('npm', null, link.raw.slice(0, slash));
    if (link.key.includes('/.nvm/') || link.key.includes('/fnm/')) return of('npm');
    if (['/.local/share/claude/', '/.local/share/cursor-agent/', '/.claude/', '/.opencode/', '/.cursor/'].some((n) => real.key.includes(n))
      || link.key.includes('/.local/bin/')) return of('script');
    return null;
  }
  /* 每种方式的名字与前置条件。新装只有前三种（data.js 的 installs）；后四种只在升级、而且检测到是它们装的时才出现。 */
  const KINDS = {
    script: {label: '官方脚本', needs: null}, brew: {label: 'Homebrew', needs: 'Homebrew'}, npm: {label: 'npm', needs: 'Node.js'},
    bun: {label: 'Bun', needs: 'Bun'}, pnpm: {label: 'pnpm', needs: 'pnpm'}, yarn: {label: 'Yarn', needs: 'Yarn'}, volta: {label: 'Volta', needs: 'Volta'},
  };
  const choice = (k, cmd) => ({k, label: KINDS[k].label, needs: KINDS[k].needs, cmd});
  const lastWord = (cmd) => cmd.trim().split(/\s+/).pop();
  const pkgName = (spec) => spec.replace(/(.)@[^/@]*$/, '$1');
  const shellArg = (t) => (/^[A-Za-z0-9/\\._\-~:@+]*$/.test(t) ? t : `"${t}"`);
  /** 升级 src 那一份用的命令（同内核 `upgrade_command`）：包名、formula / cask 名、npm 前缀都取已装那一份自己的；
      npm 一定带 --prefix（npm 的全局前缀跟着 PATH 上第一个 node 走，不跟着已装那一份）；钉了版本的沿用钉住的版本。 */
  function upgradeCmd(h, src) {
    const table = (h && h.installs) || [];
    const row = (k) => table.find((m) => m.k === k);
    const spec = () => {
      const listed = row('npm') ? lastWord(row('npm').upgrade || row('npm').cmd) : null;
      if (src.pkg) return listed && pkgName(listed) === src.pkg ? listed : src.pkg + '@latest';
      return listed;
    };
    const need = (v) => { if (!v) throw null; return v; };
    try {
      const cmd = {
        script: () => need(row('script')).upgrade,
        brew: () => (src.pkg ? `brew upgrade ${src.cask ? '--cask ' : ''}${src.pkg}` : need(row('brew')).upgrade),
        npm: () => (src.prefix ? `npm install -g --prefix ${shellArg(src.prefix)} ${need(spec())}` : `npm install -g ${need(spec())}`),
        bun: () => `bun add -g ${need(spec())}`,
        pnpm: () => `pnpm add -g ${need(spec())}`,
        yarn: () => `yarn global add ${need(spec())}`,
        volta: () => `volta install ${need(spec())}`,
      }[src.k]();
      return cmd ? choice(src.k, cmd) : null;
    } catch (e) { return null; }
  }
  /* 要改装时不沿用检测到的来源（那是旧发行包），升级段只列方式表里的新包。 */
  const sourceOf = (h) => (h && h.found && !needsReinstall(h) ? installSource(h.bin, h.realBin) : null);
  /** 升级时认出来的方式（推得出命令才算）。 */
  const detected = (h) => { const src = sourceOf(h); const c = src && upgradeCmd(h, src); return c ? c.k : null; };
  /** 安装（upgrade=false）或升级那一段可选的命令（同内核 `command_choices`）：安装只列方式表；升级把检测到的那种
      换成推出来的命令，表里没有这种（bun / pnpm / yarn / volta）就追加一行。 */
  function installMethods(h, upgrade) {
    const out = ((h && h.installs) || []).map((m) => choice(m.k, upgrade ? (m.upgrade || m.cmd) : m.cmd));
    const src = upgrade ? sourceOf(h) : null;
    const derived = src && upgradeCmd(h, src);
    if (derived) { const i = out.findIndex((c) => c.k === derived.k); if (i >= 0) out[i] = derived; else out.push(derived); }
    return out;
  }
  /** 分段起手选哪一种（同内核 `pick_choice`）：检测到的那一种，否则第一种。用户点过的由卡片自己记。 */
  function startMethod(h, upgrade) {
    const ms = installMethods(h, upgrade), d = upgrade ? detected(h) : null;
    const m = ms.find((x) => x.k === d) || ms[0] || null;
    return m ? m.k : null;
  }
  function installPlan(h, methodKey, upgrade) {
    const ms = installMethods(h, upgrade);
    return ms.find((x) => x.k === methodKey) || ms.find((x) => x.k === startMethod(h, upgrade)) || null;
  }
  const runnable = (plan) => !!plan && !/\|\s*bash\b/.test(plan.cmd);

  /* 运行输出只留最后 LOG_MAX 行：npm / brew 的进度行可以很多，界面只需要看得到最近的。 */
  const LOG_MAX = 400;
  const appendLog = (lines, more) => {
    const all = (lines || []).concat(more);
    return all.length > LOG_MAX ? all.slice(all.length - LOG_MAX) : all;
  };
  /* 命令里的包名：最后一个词去掉版本后缀（`@google/gemini-cli@latest` → `@google/gemini-cli`）。 */
  const pkgOf = (cmd) => cmd.trim().split(/\s+/).pop().replace(/(.)@[^/@]*$/, '$1');
  /* 原型演示用的输出：按方式编一段像样的日志，失败时以常见的权限错误收尾。正式版是子进程的真实输出。 */
  function demoRun(plan, h, upgrade, fail) {
    const ver = (upgrade ? h.latest : h.ver) || h.ver || '1.0.0';
    const pkg = pkgOf(plan.cmd);
    const body = plan.k === 'brew' ? [
      '==> Fetching downloads for: ' + pkg,
      '==> Downloading https://ghcr.io/v2/homebrew/core/' + pkg + '/manifests/' + ver,
      '######################################################################## 100.0%',
      '==> Pouring ' + pkg + '--' + ver + '.arm64_sequoia.bottle.tar.gz',
      '🍺  /opt/homebrew/Cellar/' + pkg + '/' + ver + ': 1,284 files, 48.6MB'] : plan.k === 'bun' ? [
      'bun add v1.3.1',
      'installed ' + pkg + '@' + ver + ' with binaries:',
      ' - ' + h.cmd,
      '1 package installed [1.84s]'] : plan.k === 'pnpm' ? [
      'Packages: +1',
      'Progress: resolved 1, reused 0, downloaded 1, added 1, done',
      '+ ' + pkg + ' ' + ver] : plan.k === 'yarn' ? [
      'yarn global v1.22.22',
      '[1/4] Resolving packages...',
      'success Installed "' + pkg + '@' + ver + '" with binaries:',
      '      - ' + h.cmd] : plan.k === 'volta' ? [
      'success: installed and set ' + pkg + '@' + ver + ' as default'] : plan.k === 'npm' ? [
      'npm http fetch GET 200 https://registry.npmjs.org/' + pkg + ' 312ms',
      'npm http fetch GET 200 https://registry.npmjs.org/' + pkg + '/-/' + ver + '.tgz 1.2s',
      (upgrade ? 'changed' : 'added') + ' 1 package in 4s'] : [
      'Checking for updates…', 'Downloading ' + h.name + ' ' + ver + '…', 'Installed ' + h.name + ' ' + ver + '.'];
    if (!fail) return {lines: body, code: 0};
    return plan.k === 'npm'
      ? {lines: body.slice(0, 1).concat(['npm error code EACCES', 'npm error syscall mkdir', 'npm error path /usr/local/lib/node_modules/' + pkg, 'npm error errno -13']), code: 243}
      : plan.k === 'bun' ? {lines: body.slice(0, 1).concat(['error: EACCES: Permission denied (~/.bun/install/global/node_modules/' + pkg + ')']), code: 1}
      : {lines: body.slice(0, 1).concat(['Error: Permission denied @ apply2files - /opt/homebrew/lib/node_modules']), code: 1};
  }

  /* ---------- 会话里的登录恢复（2026-09-20） ----------
     探测层的 loggedIn 只有刷新模型目录时才更新；凭据也可能在会话开着的这段时间里过期，
     那句话只会作为**一轮的失败详情**出现在线程里（`Failed to authenticate: OAuth session
     expired and could not be refreshed`）。所以按这一句判，判据与内核
     `bcut-editor-core::agent_setup::auth_failure` 逐条对拍。

     只认明确指向账号的说法：`auth` 这个词根不收（author 会误伤），denied / forbidden
     也不收——权限被拒是审批与沙箱的常态，说成「要重新登录」只会把人支到错的地方去。 */
  const AUTH_NEEDLES = [
    'oauth', 'authenticate', 'authentication', 'unauthorized', '401',
    'not logged in', 'not signed in', 'log in', 'login', 'sign in', 'signed out',
    'session expired', 'token expired', 'expired token', 'invalid token',
    'credential', 'api key', 'apikey',
  ];
  const authFailure = (detail) => { const t = String(detail || '').toLowerCase(); return AUTH_NEEDLES.some((n) => t.includes(n)); };

  /** 「打开终端登录」摆进终端的那条命令。有专门登录子命令的用子命令，其余直接起 CLI——
      它们没登录时自己会引导登录。与内核 `agent_setup::login_command` 同一张表。 */
  function loginCmd(h) {
    const cmd = (h && h.cmd) || '';
    /* 添加的、由 npx / uvx 现取现用的（model-agent-catalog.js）：起它自己的命令，不带 ACP 的参数；登录方式以它的说明为准。 */
    if (h && h.added && h.launcher && h.spec) {
      const c = h.launch || [], at = c.indexOf(h.spec);
      if (at > 0) return c.slice(0, at + (h.launcher === 'uvx' ? 2 : 1)).join(' ');
    }
    return {codex: 'codex login', opencode: 'opencode auth login', 'cursor-agent': 'cursor-agent login'}[cmd] || cmd;
  }

  /* ---------- 页顶状态卡 ---------- */
  function overview(list, preferredId) {
    const hs = list || [];
    const usable = hs.filter((h) => health(h) === 'ready');
    const cur = usable.find((h) => h.id === preferredId) || usable[0] || null;
    if (cur) return {state: 'ready', harness: cur, title: '已准备好，可以开始了', action: 'start', cta: '开始会话'};
    const bad = hs.find((h) => blocked(h));
    if (bad) { const p = problem(bad); return {state: 'attention', harness: bad, title: p.title, body: `它已经装在这台电脑上，不需要重装。原因和修法在下面「${bad.name}」那一行。`, action: p.action, cta: p.cta}; }
    const off = hs.find((h) => health(h) === 'off');
    if (off) return {state: 'off', harness: off, title: `${off.name} 已安装，但被停用了`, body: '启用后就能在 BaoCut 里用一句话交代活。', action: 'enable', cta: `启用 ${off.name}`};
    return {state: 'missing', harness: null, title: '这台电脑上还没有检测到 Agent', body: '装下面任意一个并用你已有的账号登录即可，不需要全部安装。', action: null, cta: null};
  }

  /* ---------- 完整 provider 表的分组（product-design §7.6） ----------
     main = 检测到的（在前）+ 常驻五家里没装的 + 用户添加、还没检测到的；more = 「更多」四家里没检测到的，折叠。
     装上任何一家它就自己挪进 main。用户自己添加的不折进 more。added = 用户添加的家数（total 里含它们）。 */
  function groups(list) {
    const hs = list || [];
    const found = hs.filter((h) => h.found);
    const missing = hs.filter((h) => !h.found);
    return {
      main: found.concat(missing.filter((h) => h.extra !== true && !h.added), missing.filter((h) => h.added)),
      more: missing.filter((h) => h.extra === true && !h.added),
      total: hs.length, found: found.length, added: hs.filter((h) => h.added).length,
    };
  }
  const moreSummary = (more) => more.slice(0, 3).map((h) => h.name).join('、') + (more.length > 3 ? ' 等' : '');

  /* ---------- 原型演示场景 ----------
     每个场景是一组盖在 data.js 探测结果上的补丁；store 把它并进 harnessList，整个原型跟着变。 */
  const SCENARIOS = [
    {k: 'default', label: '已连接 · 有新版本', patch: {}},
    {k: 'fresh', label: '一个都没装', patch: {claude: {found: false}}},
    {k: 'login', label: '登录过期', patch: {claude: {loggedIn: false}}},
    {k: 'outdated', label: '版本过旧', patch: {claude: {ver: '1.0.88'}}},
    {k: 'error', label: '无法运行', patch: {claude: {runError: '启动时报错「env: node: No such file or directory」。'}}},
    {k: 'both', label: '两家都可用', patch: {claude: {ver: '2.2.0'}, codex: {found: true, enabled: true}}},
    /* 「装了好几家」顺带演示四种来源：bun 装的 Codex、Homebrew 的 Gemini、npm 装的 OpenCode、nvm 下 npm 装的 Pi。 */
    /* 2026-09-29 事故重现：本机 codex 停在 0.153.0（模型表里还没有 gpt-6-sol），共用配置却写着 gpt-6-sol。 */
    {k: 'modelGate', label: '默认模型需升级', patch: {codex: {found: true, enabled: true, ver: '0.153.0', latest: '0.158.0',
      configModel: 'gpt-6-sol', configModelKnown: false,
      models: [{id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', dflt: true}, {id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', tier: 'fast'}]}}},
    /* OpenCode 1.x（官方脚本装的）：BaoCut 只驱动 2.x，问题说明要说「改装 @opencode/cli」而不是「升级」。 */
    {k: 'opencode1', label: 'OpenCode 装的是 1.x', patch: {opencode: {found: true, ver: '1.4.0', bin: '~/.opencode/bin/opencode', realBin: null}}},
    {k: 'many', label: '装了好几家', patch: {codex: {found: true, enabled: true, bin: '~/.bun/bin/codex', realBin: '~/.bun/install/global/node_modules/@openai/codex/bin/codex.js'}, gemini: {found: true}, opencode: {found: true, loggedIn: false}, pi: {found: true}}},
  ];
  const scenarioPatch = (k) => (SCENARIOS.find((s) => s.k === k) || SCENARIOS[0]).patch;

  window.BC_AGENT_SETUP = {
    compareVer, health, blocked, needsReinstall, hasUpdate, badge, problem, diagnose, verdict,
    TIERS, recommended, defaultModel, modelChoices, modelLabel,
    installSource, upgradeCmd, detected, installMethods, startMethod, installPlan, runnable, LOG_MAX, appendLog, pkgOf, demoRun, overview, groups, moreSummary, SCENARIOS, scenarioPatch,
    authFailure, loginCmd, defaultModelGate, modelGateFailure,
  };
})();
