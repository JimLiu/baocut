/* 首次启动引导（2026-10-16 用户要求，参考 voice-ink 原型的 onboarding.jsx；规格待补，见交付说明）。
   第一次打开 App 时弹一次（从没有引导的旧版升级上来的老用户也弹一次，2026-10-16 用户确认）。六步：
   连接 Agent → 语音识别 → 语音合成 → 语义搜索 → 图像生成 → 音乐生成。
   每一步都是一张多选列表（2026-10-16 用户要求：Agent 一家不够、模型也可以下好几只）：Agent 勾上就启用或在后台安装，
   模型勾上就下载；模型每一步默认至少勾一只（这一类已经装了的算勾上）。
   每一步都不是必须的：有「跳过」，「退出引导」与 Esc 随时退出整个引导。任何一种关掉都记下，以后启动不再弹，也没有再打开的入口。
   下载照旧先过同一个下载确认框（download-dialog.jsx）；确认后下载成为一条后台任务，引导立刻翻到下一步，不等下完。
   勾上要装的几家 Agent 按顺序一家一家装（product-design §7.6；Homebrew 同一时间只能跑一个），装 Agent 没有百分比。
   人声分离、视觉分析不进引导：体积小，用到的地方会先提出下载。
   Web 入口不加载：浏览器里不能安装本地模型（product-design §7.6「本地模型由用户安装」），也不连本机的 Agent。

   这一层只算：步骤表、要不要弹、落成什么记录、Agent 每一行能不能勾与勾上意味着什么、每一步的候选与默认勾选、
   这次要下多少（经 BC_LOCALMODELS，与下载确认框同一张安装表）、主按钮怎么写、后台在下的那一行。不碰 DOM。 */
(function () {
  const LM = () => window.BC_LOCALMODELS;

  /* `cat`：这一步列哪一类本机模型；语义搜索是一个包（`pkg`）；Agent 一步列这台电脑上的 Agent */
  const STEPS = [
    {k: 'agent', label: '连接 Agent'},
    {k: 'asr', label: '语音识别', cat: 'asr'},
    {k: 'tts', label: '语音合成', cat: 'tts'},
    {k: 'semantic', label: '语义搜索', pkg: true},
    {k: 'image', label: '图像生成', cat: 'image'},
    {k: 'music', label: '音乐生成', cat: 'music'},
  ];
  const stepOf = (k) => STEPS.find((s) => s.k === k) || STEPS[0];
  const isLast = (k) => STEPS[STEPS.length - 1].k === k;

  /* 每一步推荐的那只（排第一、带「推荐」）：
     · 转录：所有平台的默认转写模型包都是 MOSS Transcribe（packages/models bundle-registry.ts
       DEFAULT_TRANSCRIBE_BUNDLE / DEFAULT_CANDLE_TRANSCRIBE_BUNDLE），转录时自己区分说话人；
     · 语音合成：CustomVoice 有 9 个预设音色，不用参考录音就能念，最容易上手；
     · 图像生成：Turbo 是本地生图的首选（data.js：蒸馏版，比基础版快 2 倍多）。 */
  const RECOMMENDED = {asr: 'moss-transcribe', tts: 'qwen3-tts-1.7b-customvoice', image: 'qwen-image-2.1-turbo'};
  /* 语音合成那一步列的三只：三种出声方式各一只（预设音色 / 克隆 / 多语言），都可商用；其余在设置里下 */
  const TTS_HIGHLIGHTS = ['qwen3-tts-1.7b-customvoice', 'qwen3-tts-0.6b-base', 'voxcpm2'];
  /* 随应用附带、全新安装也在盘上的模型（data.js 的人物定位：体积小到进安装包） */
  const BUNDLED = ['vision-person'];

  /** 已经有记录（走完或退出）就不再弹：只在第一次启动出现 */
  const decided = (record) => !!record && (record.state === 'done' || record.state === 'skipped');
  const shouldShow = (record) => !decided(record);
  /* 原型里「第一次启动」由 `?onboarding=1` 或原型开关模拟；`?onboarding=installed` 演示老用户升级后的第一次启动（模型目录里已有模型） */
  const demoParam = (search) => new URLSearchParams(search || '').get('onboarding');
  const demoLaunch = (search) => demoParam(search) === '1' || demoParam(search) === 'installed';
  const demoFresh = (search) => demoParam(search) === '1';

  /**
   * 关掉引导时记下的偏好。`how`：'done' 在最后一步点完成或跳过；其余（「退出引导」、Esc、半路去了别处）都是 'skipped'。
   * `step` 是关掉时停在哪一步；`downloaded` 是这次引导里开始下载的模型（本来就装好的不算；语义搜索记包 id）。
   */
  function record(how, step, downloaded) {
    return {state: how === 'done' ? 'done' : 'skipped', step: step || STEPS[0].k, downloaded: (downloaded || []).slice()};
  }

  function recordText(rec) {
    if (!decided(rec)) return '没有记录';
    const head = rec.state === 'done' ? '已走完' : `在「${stepOf(rec.step).label}」退出`;
    const n = (rec.downloaded || []).length;
    return head + (n ? ` · 下载了 ${n} 个` : '');
  }

  /**
   * 一步的候选：[{m, recommended, note}]。推荐的排第一，其余按目录顺序；不支持这台电脑的不列。
   * 转录不含「说话人区分」这类辅助包，`speakers` 来自 data.js 的转录模型表：'builtin' 自己区分说话人，'pack' 要另装。
   */
  function choices(stepK, models, speakers) {
    const s = stepOf(stepK);
    if (!s.cat) return [];
    let list = (models || []).filter((m) => (m.cat || 'asr') === s.cat && !m.pack && m.supported !== false);
    if (stepK === 'tts') list = TTS_HIGHLIGHTS.map((id) => list.find((m) => m.id === id)).filter(Boolean);
    const rec = RECOMMENDED[stepK];
    const ordered = list.filter((m) => m.id === rec).concat(list.filter((m) => m.id !== rec));
    return ordered.map((m) => ({m, recommended: m.id === rec, note: noteOf(stepK, m, speakers)}));
  }

  /** 候选下面那一句：转录写区分说话人的方式；其余用目录里的说明 */
  function noteOf(stepK, m, speakers) {
    if (stepK !== 'asr') return m.note || '';
    return ((speakers || {})[m.id] || 'pack') === 'builtin' ? '转录同时区分说话人' : '要区分说话人，另装「说话人区分」';
  }

  /** 只许非商业用途的模型（下载确认框里还会再确认一次） */
  const nonCommercial = (m) => !!(m && m.license && m.license.commercialUse === false);

  /**
   * 安装表（与下载确认框共用，两边算的大小才对得上）：模型看 `installed(id)`；组件看演示数据里的 `installed`，
   * 全新安装（`fresh`）时盘上没有任何组件；`got` 是这次引导里已经下好或正在下的部分。
   */
  function installTable(models, comps, installed, fresh, got) {
    const on = {};
    (models || []).forEach((m) => { on[m.id] = !!installed(m.id); });
    (comps || []).forEach((c) => { on[c.id] = !fresh && !!c.installed; });
    (got || []).forEach((id) => { on[id] = true; });
    return on;
  }

  /** 全新安装时模型表的样子：只有随应用附带的在盘上 */
  const freshInstalled = (id) => BUNDLED.indexOf(id) >= 0;

  /**
   * 打开这一步时默认勾哪几只（2026-10-16 用户要求「默认至少选择一个模型」）：这一类已经有装好的，它就显示成勾上的，
   * 不再替人多勾；一只都没装时勾推荐的那只，没有推荐的勾第一只。
   */
  function initialPicks(stepK, list, comps, on) {
    const all = list || [];
    if (!all.length || all.some((c) => LM().ready(c.m, comps, on))) return [];
    const rec = all.find((c) => c.recommended) || all[0];
    return [rec.m.id];
  }

  /**
   * 勾上的这几只要下什么：[{id, name, size}]（各自的权重带上模型名，共用组件只算一份）与合计 MB。
   * 已经装好或正在下的不算。
   */
  function plan(ms, comps, on) {
    const seen = Object.assign({}, on);
    const parts = [];
    (ms || []).filter(Boolean).forEach((m) => {
      LM().missing(m, comps, seen).forEach((p) => {
        if (seen[p.id]) return;
        seen[p.id] = true;
        parts.push(p.weights ? Object.assign({}, p, {name: m.name}) : p);
      });
    });
    return {parts, total: parts.reduce((n, p) => n + p.size, 0)};
  }

  /** 卡片下面的一行：「一起下载：MOSS Transcribe 1.7 GB · 声纹嵌入 26.5 MB」；什么都不缺时 null */
  function planLine(p) {
    if (!p.parts.length) return null;
    return '一起下载：' + p.parts.map((x) => `${x.name} ${LM().mb(x.size)}`).join(' · ');
  }

  /** 语义搜索包还缺哪几部分（data.js semantic.packages：文字模型、多模态模型、LiteRT-LM 运行时） */
  function pkgPlan(pkg, installed) {
    const parts = installed || !pkg ? [] : pkg.parts.slice();
    return {parts, total: parts.reduce((n, p) => n + p.size, 0)};
  }

  /**
   * 一步的主按钮：有要下的就「后台下载 1.7 GB 并继续」（确认框之后立刻翻页，下载在后台；最后一步是「并完成」）；
   * 没有要下的就往下走，最后一步是「完成」。Agent 一步见 agentPrimary。
   */
  function primary(stepK, p) {
    const last = isLast(stepK);
    if (p && p.parts.length) return {kind: 'download', label: `后台下载 ${LM().mb(p.total)} 并${last ? '完成' : '继续'}`};
    return {kind: 'next', label: last ? '完成' : '下一步'};
  }

  /**
   * Agent 一步的每一行（主列表那六家，同 设置 › Agent 提供方；`AS` 是 BC_AGENT_SETUP）。`kind` 决定勾选框：
   * · 'use'：装好、能用或停用着——勾上 = 在 BaoCut 里启用（就是设置里那个开关，改了立刻生效）；
   * · 'fix'：装了但要先处理（需要登录、版本过旧、跑不起来）——不给勾，写出问题，处理在设置里；
   * · 'install'：没装、BaoCut 能在后台装（Homebrew / npm）——勾上 = 后台安装，装好后还要在它自己的终端里登录一次；
   * · 'manual'：没装、只有官方脚本——BaoCut 不替你运行来自网络的脚本，不给勾，安装说明在设置里。
   * `method`：'install' 时用哪一种（方式表里第一种能就地运行的，同 settings-agent-provider.jsx 的就地运行）。
   */
  function agentRows(list, AS) {
    return AS.groups(list).main.map((h) => {
      const st = AS.health(h);
      if (h.found) return {h, kind: st === 'ready' || st === 'off' ? 'use' : 'fix', method: null};
      const method = AS.installMethods(h, false).find(AS.runnable) || null;
      return {h, kind: method ? 'install' : 'manual', method};
    });
  }

  /**
   * 一行下面那一句（同实现 model/onboarding.ts agentLine）。`st`：{picked, running, failed}——
   * 在装（排在队里等前一家装完的也算）写用什么装、装好后怎么登录；装好的写版本与账号；要处理的写问题；
   * 没装的写用什么订阅，勾上后写这次怎么装；上一次没装成、没再勾上的写去后台任务里看。
   */
  function agentLine(row, st, AS) {
    const {h, kind, method} = row;
    const s = st || {};
    if (s.running) return `正在用 ${method ? method.label : h.cmd} 在后台安装 · 装好后在终端里运行 ${AS.loginCmd(h)} 登录`;
    if (kind === 'use') return `本机已安装 · v${h.ver} · ${String(h.account || '').split(' · ')[0]}`;
    if (kind === 'fix') { const p = AS.problem(h); return p ? `${p.title} · 在 设置 › Agent 提供方 里处理` : ''; }
    if (kind === 'manual') return `只能在终端里按官方说明安装 · 说明在 设置 › Agent 提供方`;
    if (s.picked && method) return `用 ${method.label} 在后台安装（${method.cmd}）· 装好后在终端里运行 ${AS.loginCmd(h)} 登录`;
    if (s.failed) return '没装成 · 详情在后台任务里';
    return `未安装 · 装好后用你已有的 ${h.plan}登录`;
  }

  /**
   * 排着队的一家走到哪了（同实现 agentJobStatus）：还没轮到（还没有任务）、正在装都算在跑；装好是 done；
   * 没装成、被停止都算 error。job：{tid, failed}；tasks：后台任务表。
   */
  function agentJobStatus(job, tasks) {
    if (job.failed) return 'error';
    if (!job.tid) return 'running';
    const t = (tasks || []).find((x) => x.id === job.tid);
    if (!t || t.status === 'running' || t.status === 'queued') return 'running';
    return t.status === 'done' ? 'done' : 'error';
  }

  /** Agent 一步的主按钮：勾了要装的就「后台安装 2 个并继续」，否则往下走 */
  function agentPrimary(n) {
    return n ? {kind: 'install', label: `后台安装 ${n} 个并继续`} : {kind: 'next', label: '下一步'};
  }

  /**
   * 对话框底部那一行（和按钮挤一排，要短）：这次引导里开始的下载与 Agent 安装，只有一件在跑时写名字与百分比
   * （Agent 安装给不出进度，`pct` 是 null，只写名字），几件同时在跑只写个数（各自的进度在后台任务里），跑完的、没成的只计数。
   * items：[{name, pct, status, agent?}]（status 是后台任务的状态；agent 为真是安装 Agent，其余是下载模型）；一个都没有时 null。
   * 底部有这一行、按钮文字又长时，S2 的 ButtonGroup 会自己换到下一行（原生行为，实现里一样），不另外缩短。
   */
  function bgLine(items) {
    const list = items || [];
    if (!list.length) return null;
    // 用词跟着那几件走：全是 Agent 写「安装」，全是模型写「下载」，混在一起写个笼统的
    const words = (xs) => {
      const n = xs.filter((x) => x.agent).length;
      return n === xs.length ? {verb: '安装', done: '已装好', fail: '没装成'}
        : n ? {verb: '下载和安装', done: '已完成', fail: '没成功'} : {verb: '下载', done: '已下完', fail: '没下成'};
    };
    const live = list.filter((x) => x.status === 'running');
    const failed = list.filter((x) => x.status === 'error');
    const done = list.filter((x) => x.status !== 'running' && x.status !== 'error');
    const pct = (x) => (x.pct == null ? '' : ` ${Math.round(x.pct)}%`);
    const bits = [live.length === 1 ? `后台在${words(live).verb} ${live[0].name}${pct(live[0])}`
      : live.length ? `后台在${words(live).verb} ${live.length} 个` : `后台${words(list).verb}`];
    if (done.length) bits.push(`${done.length} 个${words(done).done}`);
    if (failed.length) bits.push(`${failed.length} 个${words(failed).fail}`);
    return bits.join(' · ');
  }

  const api = {STEPS, RECOMMENDED, TTS_HIGHLIGHTS, BUNDLED, stepOf, isLast, decided, shouldShow, demoLaunch, demoFresh,
    record, recordText, choices, nonCommercial, installTable, freshInstalled, initialPicks, plan, planLine, pkgPlan, primary,
    agentRows, agentLine, agentJobStatus, agentPrimary, bgLine};
  if (typeof window !== 'undefined') window.BC_ONBOARDING = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
