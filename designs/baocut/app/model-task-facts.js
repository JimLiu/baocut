/* BaoCut 原型 — 后台任务详情的事实装配（§17.3）
   window.BC_TASK_FACTS。纯函数，无 React、无 DOM。

   只有一个进度条的详情页回答不了「这是在转哪个视频」。这一层把一条任务记录
   和它的项目拼成三块能读的事实，与 `core/crates/bcut-editor-core/src/task_kind.rs`
   （`stats` / `transcript_reached`）同形：

   1. **来源**：视频（文件名 + 时长）、完整路径、视频。视频库里有的给「打开视频」；
      不在视频库里的（命令行建在临时目录的包）只剩包路径，并说清只能到它所在的文件夹里找。
   2. **已转录内容**：只在转录还在跑时出现，读 jobs 帧的 `liveSegments`（最多 40 段，
      按时间排）。任务一结束就不再显示——完整文稿在项目里，这里不是第二份文稿。
   3. **详情**：只产出有值的行，缺席不写占位（不是「行数：—」）。
   4. **图片**（2026-09-27）：生图任务 jobs 帧的 `images[]`（同 `JobGranular.images`，最多 24 行），
      每行一次请求：摘要 `2/3 张 · 1 在画 · 约 $0.08`、元信息 `模型 · 画幅 · N 张 · 约 $0.04 · 12 s`。
      费用是按价目表估的（只写「约」），只计已完成的行。标题兜底也在这里：阶段机器值不进标题。

   时长写法与 `wizard_media::clock` 一致（`3:26` / `1:02:03`），用时与 `took_ms` 一致。 */
(function () {
  /** jobs 帧里 liveSegments 的上限（`LIVE_TRANSCRIPT_SEGMENT_LIMIT`）。 */
  const LIVE_SEGMENT_LIMIT = 40;
  const TRANSCRIBE_KINDS = ['transcribe', 'retranscribe'];

  const pad2 = (n) => String(n).padStart(2, '0');

  /** `3:26` / `52:00` / `1:02:03`。 */
  function clock(seconds) {
    const total = Math.max(0, Math.round(+seconds || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
  }

  /** `42s` / `12m 40s` / `1h 5m`。 */
  function took(ms) {
    const seconds = Math.max(0, Math.round((Number.isFinite(+ms) ? +ms : 0) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  /** `612 MB` / `1.5 GB` / `500 KB`，1024 进位。 */
  function fmtSize(bytes) {
    const mb = (+bytes || 0) / (1024 * 1024);
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    if (mb >= 1) return `${Math.round(mb)} MB`;
    return `${Math.max(1, Math.round((+bytes || 0) / 1024))} KB`;
  }

  /** 千分位。 */
  function fmtCount(n) {
    return String(Math.round(+n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fileName(path) {
    const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  const has = (v) => v != null && v !== '';

  /** 来源卡：`{media, project}`，缺的那块是 null。
      项目库里有这个项目时，媒体读项目记录；没有时读任务记录上探测到的 `t.media`
      （App 从包里的 project.json 读，Web 读不到就只剩包路径）。 */
  function source(t, proj) {
    /* 生图不读项目的视频：媒体行写项目主视频会让人以为在「画这个视频」，只留项目行 */
    const src = t.kind === 'image' ? null : proj && proj.src ? proj.src : t.media;
    const duration = proj ? proj.duration : src && src.duration;
    const media = src && (src.name || src.path)
      ? {name: src.name || fileName(src.path), path: src.path || null, duration: duration > 0 ? duration : null}
      : null;
    let project = null;
    if (proj) project = {id: proj.id, title: proj.title, path: proj.pkg || null, registered: true};
    else if (t.pkg) project = {id: null, title: fileName(t.pkg), path: t.pkg, registered: false};
    return {media, project};
  }

  /** 已转录内容：转录还在跑时才有，否则 null。`total` 是媒体总长（秒，可缺）。 */
  function transcript(t, total) {
    if (!TRANSCRIBE_KINDS.includes(t.kind) || t.status !== 'running') return null;
    const segments = (t.liveSegments || [])
      .filter((s) => s && String(s.text || '').trim())
      .slice()
      .sort((a, b) => a.start - b.start)
      .slice(-LIVE_SEGMENT_LIMIT);
    const reached = segments.length ? Math.max(...segments.map((s) => s.end)) : null;
    return {segments, reached, total: total > 0 ? total : null};
  }

  /** 头部计数：`8 段 · 转录到 23:16 / 52:00`；一段都没有时是空串。 */
  function transcriptSummary(tr) {
    if (!tr || !tr.segments.length) return '';
    const at = tr.total ? `${clock(tr.reached)} / ${clock(tr.total)}` : clock(tr.reached);
    return `${tr.segments.length} 段 · 转录到 ${at}`;
  }

  function statusLabel(t) {
    if (t.undone) return '已撤销';
    if (t.canceled) return '已取消';
    if (t.status === 'done' && has(t.attention)) return `已完成 · ${t.attention}`;
    return {running: '进行中', queued: '排队中', done: '已完成', error: '失败'}[t.status] || t.status;
  }

  /** 智能裁剪任务的阶段是机器值，详情里给人看的名字。 */
  const SHORTS_CUT_STAGE = {find: '找片段', review: '等你挑', create: '创建视频', done: '已完成'};
  const CROP_STAGE = {analyze: '分析构图', review: '等你检查', render: '生成视频', done: '已完成'};

  /* ---------- 图片任务（jobs 帧的 `images[]`，与 liveSegments 不同，它随任务进历史） ---------- */

  /** 列表上限（`JobGranular.images` 最多 24 行；更多时 `imagesTotal` 给真实总行数）。 */
  const IMAGE_ROW_LIMIT = 24;
  const IMAGE_PROMPT_MAX = 300;
  const CURRENCY = {CNY: '¥', USD: '$'};

  /** 引擎族：以 `engine` 为准，缺时按模型 id 前缀兜底。 */
  function imageEngine(item) {
    if (item && item.engine) return item.engine;
    const m = String((item && item.model) || '');
    if (m.startsWith('agent:')) return 'codex';
    if (m.startsWith('local:')) return 'local';
    if (m.startsWith('remote:')) return 'remote';
    return 'cloud';
  }

  /** 给人看的模型名：`modelName` 优先，否则取 id 里 `/` 后那段（`cloud:openai/gpt-image-2` → `gpt-image-2`）。 */
  function imageModelName(item) {
    if (item.modelName) return item.modelName;
    if (imageEngine(item) === 'codex') return 'Codex';
    const m = String(item.model || '').replace(/^[a-z]+:/, '');
    return m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m;
  }

  /** 截到 n 字，截了才加省略号。 */
  function clip(text, n) {
    const chars = Array.from(String(text || '').trim());
    return chars.length > n ? chars.slice(0, n).join('') + '…' : chars.join('');
  }

  /** `12 s`；满一分钟起同 `took`。 */
  function secs(ms) {
    const s = Math.max(0, Math.round((+ms || 0) / 1000));
    return s < 60 ? `${s} s` : took(ms);
  }

  const money = (c) => `${CURRENCY[c.currency] || c.currency + ' '}${(+c.amount).toFixed(2)}`;

  /** 图片一节的事实：`{items, done, total, running, spent, engine}`；不是图片任务或没有行时 null。
      `spent` 只计已完成的行（没开跑的不计），按币种分开、保留两位。 */
  function images(t) {
    const all = (t && t.images) || [];
    if (!all.length) return null;
    const items = all.slice(0, IMAGE_ROW_LIMIT).map((it) =>
      Object.assign({}, it, {engine: imageEngine(it), prompt: clip(it.prompt, IMAGE_PROMPT_MAX)}));
    const total = Math.max(t.imagesTotal || 0, all.length);
    const done = all.filter((it) => it.status === 'done').length;
    const running = all.filter((it) => it.status === 'running').length;
    const sums = {};
    all.forEach((it) => {
      if (it.status !== 'done' || !it.cost || !(it.cost.amount >= 0)) return;
      sums[it.cost.currency] = (sums[it.cost.currency] || 0) + +it.cost.amount;
    });
    const spent = Object.keys(sums).map((currency) => ({currency, amount: Math.round(sums[currency] * 100) / 100}));
    const engines = Array.from(new Set(all.map(imageEngine)));
    return {items, done, total, running, spent, engine: engines.length === 1 ? engines[0] : 'mixed'};
  }

  /** 花费那一句：Codex「用 Codex 订阅额度」、本机「本机生成 · 不花钱」、远端节点「在已配对的电脑上生成 · 不花钱」、
      云端「约 $0.08」（估价，不是账单）；
      云端一张都还没画完时是空串。 */
  function imagesCost(im) {
    if (!im) return '';
    if (im.engine === 'codex') return '用 Codex 订阅额度';
    if (im.engine === 'local') return '本机生成 · 不花钱';
    if (im.engine === 'remote') return '在已配对的电脑上生成 · 不花钱';
    return im.spent.length ? '约 ' + im.spent.map(money).join(' + ') : '';
  }

  /** 图片一节标题右侧：`2/3 张 · 1 在画 · 约 $0.08`。 */
  function imagesSummary(im) {
    if (!im) return '';
    return [`${im.done}/${im.total} 张`, im.running ? `${im.running} 在画` : null, imagesCost(im) || null]
      .filter(Boolean).join(' · ');
  }

  /** 一行的元信息：`模型 · 画幅 · N 张 · 约 $0.04 · 12 s`，缺的不写。 */
  function imageMeta(item) {
    const engine = imageEngine(item);
    return [
      imageModelName(item) || null,
      item.aspect || null,
      item.n > 0 ? `${item.n} 张` : null,
      engine === 'cloud' && item.cost && item.cost.amount >= 0 ? '约 ' + money(item.cost) : null,
      has(item.elapsedMs) && item.status !== 'queued' ? secs(item.elapsedMs) : null,
    ].filter(Boolean).join(' · ');
  }

  const IMAGE_STATUS = {
    queued: {label: '排队中', tone: 'neutral'}, running: {label: '正在画', tone: 'accent'},
    done: {label: '已完成', tone: 'positive'}, error: {label: '失败', tone: 'negative'},
    cancelled: {label: '已取消', tone: 'neutral'},
  };
  const imageStatus = (item) => IMAGE_STATUS[item.status] || {label: item.status, tone: 'neutral'};

  /** 标题兜底：发起方给的标题 → 图片任务取第一行提示词（40 字）→ 种类名。
      `image` / `transcribe` 这种阶段机器值不进标题。项目名由视图先判（它是链接）。 */
  function taskTitle(t, kindLabel) {
    if (has(t.title)) return t.title;
    const first = (t.images || []).find((it) => String(it.prompt || '').trim());
    if (first) return clip(first.prompt, 40);
    return kindLabel || '任务';
  }

  /** 列表行的副行（图片任务）：`「提示词前 24 字…」 · 2/3 张`；其它任务 null（沿用 `t.sub`）。
      发起方没给标题时标题已经是这条提示词（`taskTitle`），副行只留张数，不念两遍。 */
  function cardSub(t) {
    const im = images(t);
    if (!im) return null;
    const first = has(t.title) ? im.items.find((it) => String(it.prompt || '').trim()) : null;
    return [first ? `「${clip(first.prompt, 24)}」` : null, `${im.done}/${im.total} 张`].filter(Boolean).join(' · ');
  }

  /** 详情行 `[label, value]`，只产出有值的行。
      `now`（毫秒，可缺）：运行中且执行方没报 `elapsedMs` 时，用时从 `startedAt` 现算。 */
  function details(t, kindLabel, now) {
    const rows = [];
    const add = (label, value) => { if (has(value)) rows.push([label, String(value)]); };
    const running = t.status === 'running';
    add('类型', kindLabel);
    add('发起方', t.source === 'cli' ? '命令行' : t.source === 'agent' ? 'Agent 会话' : 'App');
    add('状态', statusLabel(t));
    add('开始于', t.started);
    add('跑在', t.runsOn);
    add('语言', t.lang);
    // 阶段与种类同名（`image` / `export`）时是一句废话，不出这一格
    if (t.stage !== t.kind) add('阶段', t.crop ? (CROP_STAGE[t.stage] || t.stage)
      : t.kind === 'shorts-cut' ? (SHORTS_CUT_STAGE[t.stage] || t.stage) : t.stage);
    if (t.crop) { add('目标画幅', t.crop.ratio); add('场景', t.crop.scene); add('原片', t.crop.source); }
    if (has(t.linesDone) && has(t.linesTotal)) add('行数', `${fmtCount(t.linesDone)}/${fmtCount(t.linesTotal)}`);
    // 旧版项目导入：导入了几个、导入到哪
    if (has(t.projectsDone) && has(t.projectsTotal)) add('项目', `已导入 ${fmtCount(t.projectsDone)}/${fmtCount(t.projectsTotal)}`);
    add('导入到', t.dest);
    const im = images(t);
    if (im) { add('图片', `${im.done}/${im.total}`); add('花费', imagesCost(im)); }
    if (t.kind === 'export') {
      const total = has(t.framesTotal) ? t.framesTotal : t.frames;
      const pct = t.pctFine != null ? t.pctFine : t.pct;
      const done = has(t.framesDone) ? t.framesDone
        : total && pct != null ? Math.round(total * Math.min(100, pct) / 100) : null;
      if (has(total) && has(done)) add('帧', `${fmtCount(done)}/${fmtCount(total)}`);
      if (running && t.fps > 0) add('速度', `${Math.round(t.fps)} fps`);
    }
    if (t.callsTotal > 0) {
      add('调用', `${fmtCount(t.callsDone || 0)}/${fmtCount(t.callsTotal)}`
        + (t.callsRetried > 0 ? ` · 重试 ${fmtCount(t.callsRetried)}` : ''));
    }
    if (t.bytesTotal > 0) add('已传输', `${fmtSize(t.bytesDone || 0)} / ${fmtSize(t.bytesTotal)}`);
    if (running && has(t.leftMs)) add('预计剩余', took(t.leftMs));
    if (has(t.elapsedMs)) add('用时', took(t.elapsedMs));
    else if (running && Number.isFinite(t.startedAt) && Number.isFinite(now)) add('用时', took(now - t.startedAt));
    return rows;
  }

  window.BC_TASK_FACTS = {
    LIVE_SEGMENT_LIMIT, clock, took, fmtSize, fmtCount, fileName,
    source, transcript, transcriptSummary, statusLabel, details,
    IMAGE_ROW_LIMIT, IMAGE_PROMPT_MAX, images, imagesCost, imagesSummary, imageMeta, imageStatus, imageModelName,
    taskTitle, cardSub,
  };
})();
