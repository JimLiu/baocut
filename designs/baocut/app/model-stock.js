/* 在线素材的纯模型（`docs/design/editor/bcut-stock-assets-design.md` §4 / §7 / §8 / §9）。
   与 App v2 的 `bcut-editor-core::stock_pane` + `services/stock/license.rs` 同一套语义：
   一句话 → `SearchIntent`（能验证的进 hard、验证不了的进 soft）、候选逐条记账、
   许可判定是**三值**、面板只有五种状态。三端解析同一句话必须得到同一份 hard，
   否则各筛各的。

   本文件不发请求、不碰 DOM：演示数据是夹具，标着「演示」，不是真实平台响应。 */
(function () {
  /* ---------- 用途档与许可（§7.1） ---------- */

  const USAGE = [
    {k: 'online-video', label: '网络视频', sub: '社媒 / YouTube'},
    {k: 'podcast', label: '播客'},
    {k: 'online-ad', label: '网络广告'},
    {k: 'broadcast', label: '电视 / 广播'},
    {k: 'game', label: '电子游戏'},
    {k: 'offline-screening', label: '线下放映 / 物理介质'},
  ];
  const ALL_USAGE = USAGE.map((u) => u.k);
  const usageLabel = (k) => (USAGE.find((u) => u.k === k) || {label: k}).label;

  /* `verified` 说的是「这张允许/禁止表是逐条核对条款正文得来的」。没核对过的
     许可不许悄悄升级成「可以用」——那才是三值判定存在的理由。 */
  const LICENSES = {
    'pexels-license': {
      id: 'pexels-license', label: 'Pexels 许可', textUrl: 'https://www.pexels.com/license/',
      attributionRequired: true, verified: true,
      allows: ['online-video', 'podcast', 'online-ad', 'broadcast', 'offline-screening'], denies: [],
    },
    'pixabay-content-license': {
      id: 'pixabay-content-license', label: 'Pixabay 内容许可', textUrl: 'https://pixabay.com/service/license-summary/',
      attributionRequired: false, verified: true,
      allows: ['online-video', 'podcast', 'online-ad', 'broadcast', 'offline-screening'], denies: [],
    },
    'mixkit-music-free': {
      id: 'mixkit-music-free', label: 'Mixkit 音乐免费许可', textUrl: 'https://mixkit.co/license/modal/musicFree/',
      attributionRequired: false, verified: true,
      allows: ['online-video', 'podcast', 'online-ad'],
      denies: ['broadcast', 'game', 'offline-screening'],
    },
    'mixkit-video-free': {
      id: 'mixkit-video-free', label: 'Mixkit 视频免费许可（Free）', textUrl: 'https://mixkit.co/license/',
      attributionRequired: false, verified: false,
      allows: ['online-video', 'podcast', 'online-ad'], denies: [],
    },
    'mixkit-video-restricted': {
      id: 'mixkit-video-restricted', label: 'Mixkit 视频许可（Restricted）', textUrl: 'https://mixkit.co/license/',
      attributionRequired: true, verified: false, allows: [], denies: [],
    },
    // Openverse 的许可 id 照抄索引给的，但不替它背书：官方声明不保证准确。
    'cc0': {id: 'cc0', label: 'CC0 1.0', textUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false, verified: false, allows: [], denies: []},
    'by': {id: 'by', label: 'CC BY', textUrl: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true, verified: false, allows: [], denies: []},
    'by-nc': {id: 'by-nc', label: 'CC BY-NC（禁止商用）', textUrl: 'https://creativecommons.org/licenses/by-nc/4.0/', attributionRequired: true, verified: false, allows: [], denies: []},
  };

  /** 三值判定：禁止的返 not-allowed，核对过且覆盖的返 allowed，其余一律 unverified。 */
  function evaluate(licenseId, usage) {
    const lic = LICENSES[licenseId];
    if (!lic) return 'unverified';
    if (lic.denies.indexOf(usage) >= 0) return 'not-allowed';
    if (!lic.verified) return 'unverified';
    return lic.allows.indexOf(usage) >= 0 ? 'allowed' : 'unverified';
  }
  const VERDICT = {
    allowed: {label: '可用于此用途', tone: 'positive'},
    'not-allowed': {label: '此用途不允许', tone: 'negative'},
    unverified: {label: '许可未确认', tone: 'notice'},
  };

  /* ---------- 来源能力（§3.1） ---------- */

  const PROVIDERS = [
    {
      id: 'pexels', label: 'Pexels', siteUrl: 'https://www.pexels.com/', kinds: ['video'],
      search: 'api', preview: 'proxy', acquire: 'direct', credential: 'configured', policy: 'approved',
      limits: {perHour: 200, usedHour: 37, cacheTtlHours: 24},
      filters: {orientation: true, duration: true, minHeight: true, audioCategory: false},
      attributionNote: '需要在应用里放 Pexels 链接，并尽量署名作者',
    },
    {
      id: 'pixabay', label: 'Pixabay', siteUrl: 'https://pixabay.com/', kinds: ['video'],
      search: 'api', preview: 'proxy', acquire: 'direct', credential: 'configured', policy: 'approved',
      limits: {perMinute: 100, usedMinute: 8, cacheTtlHours: 24},
      filters: {orientation: true, duration: true, minHeight: false, audioCategory: false},
      note: '按条款缓存 24 小时，预览图经本机供给，不长期直链平台 CDN',
    },
    {
      id: 'openverse', label: 'Openverse', siteUrl: 'https://openverse.org/', kinds: ['audio'],
      search: 'api', preview: 'proxy', acquire: 'direct', credential: 'anonymous', policy: 'approved',
      limits: {perHour: 60, usedHour: 5, cacheTtlHours: 24},
      filters: {orientation: false, duration: true, minHeight: false, audioCategory: true},
      note: '索引里的许可信息官方不保证准确，结果一律标「未确认」，用前到原站核实',
    },
    {
      id: 'mixkit', label: 'Mixkit', siteUrl: 'https://mixkit.co/', kinds: ['video', 'audio'],
      search: 'external', preview: 'unavailable', acquire: 'external',
      credential: 'not-required', policy: 'external-only', limits: {},
      filters: {orientation: false, duration: false, minHeight: false, audioCategory: false},
      externalSearch: {video: 'https://mixkit.co/free-stock-video/', audio: 'https://mixkit.co/free-stock-music/'},
      note: '此来源当前通过原网站搜索与下载',
    },
    {
      id: 'freesound', label: 'Freesound', siteUrl: 'https://freesound.org/', kinds: ['audio'],
      search: 'disabled', preview: 'unavailable', acquire: 'unavailable',
      credential: 'not-required', policy: 'needs-authorization', limits: {},
      filters: {orientation: false, duration: false, minHeight: false, audioCategory: false},
      note: '商业使用其 API 需要逐案协商，取得授权前不启用',
    },
  ];

  const searchable = (cap) => cap.search === 'api' && cap.acquire !== 'unavailable';
  const externalOnly = (cap) => cap.search === 'external';

  /** 面板看到的来源：按素材类别过滤，叠上用户在「来源」里关掉的那些。 */
  function capabilitiesFor(kind, disabled) {
    const off = disabled || {};
    return PROVIDERS.filter((cap) => cap.kinds.indexOf(kind) >= 0)
      .map((cap) => (off[cap.id] ? Object.assign({}, cap, {search: 'disabled', acquire: 'unavailable', policy: 'disabled'}) : cap));
  }

  /* ---------- 面板状态（§9） ---------- */

  const STATES = ['needs-setup', 'searching', 'results', 'empty', 'external-only'];

  /** 壳只按这个结果分支，不自己再判一遍。`searching` 由壳传入。 */
  function paneState(caps, kind, searching, hits) {
    const serving = (caps || []).filter((cap) => cap.kinds.indexOf(kind) >= 0);
    if (serving.some(searchable)) {
      if (searching) return 'searching';
      return hits > 0 ? 'results' : 'empty';
    }
    if (serving.some(externalOnly)) return 'external-only';
    return 'needs-setup';
  }

  /* ---------- 一句话 → SearchIntent（§4.2 / §8） ---------- */

  const ORIENTATION_WORDS = [['竖屏', 'portrait'], ['竖版', 'portrait'], ['纵向', 'portrait'], ['portrait', 'portrait'], ['vertical', 'portrait'],
    ['横屏', 'landscape'], ['横版', 'landscape'], ['landscape', 'landscape'], ['horizontal', 'landscape'],
    ['方形', 'square'], ['square', 'square']];
  const HEIGHT_WORDS = [['4k', 2160], ['2160p', 2160], ['1440p', 1440], ['1080p', 1080], ['高清', 1080], ['720p', 720]];
  const CATEGORY_WORDS = [['bgm', 'music'], ['背景音乐', 'music'], ['配乐', 'music'], ['music', 'music'],
    ['音效', 'sfx'], ['sfx', 'sfx'], ['sound effect', 'sfx'],
    ['环境音', 'ambience'], ['氛围音', 'ambience'], ['ambience', 'ambience'], ['ambient', 'ambience']];
  /* 验证不了、只能进 soft 的偏好词。列出来是为了让它们**被认出来**并明确降级，
     而不是混在检索词里当关键词发给来源。 */
  const SOFT_WORDS = ['安静', '舒缓', '温暖', '高级感', '有节奏', '励志', '空灵', '史诗',
    'calm', 'relaxing', 'warm', 'epic', 'uplifting', 'cinematic', 'minimal', 'premium'];
  const DURATION_DIRECTION_WORDS = ['以内', '以下', '之内', '以上', '不超过', '至少', '超过', '最多',
    'at least', 'more than', 'under', 'over'];
  const FILLER = ['a', 'an', 'the', 'of', 'with', 'and', 'or', '为', '和', '与', '或', '个', '些',
    '一段', '一些', '素材', '视频', '音频', 'clip', 'clips', 'footage', 'track'];
  const UNITS = ['秒钟', '秒', 'seconds', 'second', 'secs', 'sec', 's'];

  const isDigit = (ch) => ch >= '0' && ch <= '9';

  /** 数字后面紧跟的时间单位到哪儿结束；没有单位返回 -1。 */
  function timeUnitEnd(chars, from) {
    const rest = chars.slice(from, from + 8).join('');
    const trimmed = rest.replace(/^\s+/, '');
    const skipped = rest.length - trimmed.length;
    for (const unit of UNITS) {
      if (trimmed.indexOf(unit) !== 0) continue;
      // 「s」只有后面不再接字母时才是「秒」，否则是 sunset 这种词头
      if (unit === 's' && /[A-Za-z]/.test(trimmed.charAt(1))) return -1;
      return from + skipped + unit.length;
    }
    return -1;
  }

  /** 「10 秒以内」「至少 30s」「5-15 秒」→ 上下界 ＋ 从原句吃掉的那几段。
     认不出方向的孤零零一个时长按**上界**算：用户说「10 秒空镜」要的是十秒以内
     能用的片段，不是十秒起步的长镜头。 */
  function durationBounds(text) {
    const chars = Array.from(String(text || ''));
    const out = {min: null, max: null, consumed: []};
    const pending = [];
    let i = 0;
    while (i < chars.length) {
      if (!isDigit(chars[i])) { i++; continue; }
      const start = i;
      while (i < chars.length && (isDigit(chars[i]) || chars[i] === '.')) i++;
      const value = parseFloat(chars.slice(start, i).join(''));
      if (!isFinite(value)) continue;
      const unitEnd = timeUnitEnd(chars, i);
      if (unitEnd < 0) {
        // 区间写法「5-15 秒」：单位只跟在后一个数字后面
        if ('-~—'.indexOf(chars[i] || '') >= 0) pending.push([value, start]);
        continue;
      }
      const head = chars.slice(Math.max(0, start - 8), start).join('');
      const tail = chars.slice(unitEnd, unitEnd + 8).join('');
      if (pending.length) {
        const low = pending.pop();
        out.min = low[0]; out.max = value;
        out.consumed.push(chars.slice(low[1], unitEnd).join(''));
        continue;
      }
      const lower = tail.indexOf('以上') >= 0 || tail.indexOf('起') >= 0
        || head.indexOf('至少') >= 0 || head.indexOf('超过') >= 0
        || head.indexOf('over') >= 0 || head.indexOf('least') >= 0 || head.indexOf('more than') >= 0;
      if (lower) out.min = value; else out.max = value;
      out.consumed.push(chars.slice(start, unitEnd).join(''));
    }
    return out;
  }

  const emptyHard = () => ({minDurationSec: null, maxDurationSec: null, orientation: null, minHeight: null, audioCategory: null});

  /** 解析是**减法**：识别出的筛选词从原句里吃掉，不再作为关键词发给来源。 */
  function parseIntent(kind, raw) {
    const intent = {kind, rawQuery: String(raw || '').trim(), queries: [], hard: emptyHard(), soft: [],
      costPolicy: 'free-only', usageProfile: 'online-video'};
    let rest = String(raw || '').toLowerCase();
    const bounds = durationBounds(rest);
    intent.hard.minDurationSec = bounds.min;
    intent.hard.maxDurationSec = bounds.max;
    for (const token of bounds.consumed) rest = rest.replace(token, ' ');
    if (bounds.min !== null || bounds.max !== null) {
      for (const word of DURATION_DIRECTION_WORDS) rest = rest.split(word).join(' ');
    }
    for (const [word, value] of ORIENTATION_WORDS) {
      if (rest.indexOf(word) >= 0) { intent.hard.orientation = value; rest = rest.split(word).join(' '); }
    }
    for (const [word, value] of HEIGHT_WORDS) {
      if (rest.indexOf(word) >= 0) {
        intent.hard.minHeight = intent.hard.minHeight === null ? value : Math.max(intent.hard.minHeight, value);
        rest = rest.split(word).join(' ');
      }
    }
    if (kind === 'audio') {
      for (const [word, value] of CATEGORY_WORDS) {
        if (rest.indexOf(word) >= 0) { intent.hard.audioCategory = value; rest = rest.split(word).join(' '); }
      }
    }
    for (const word of SOFT_WORDS) {
      if (rest.indexOf(word) >= 0) { intent.soft.push(word); rest = rest.split(word).join(' '); }
    }
    const query = rest.split(/[\s,，、的。./]+/).map((t) => t.trim())
      .filter((t) => t && FILLER.indexOf(t) < 0).join(' ');
    if (query) intent.queries.push(query);
    return intent;
  }

  /* ---------- 硬条件与匹配记账（§8.2） ---------- */

  function orientationOf(width, height) {
    if (!width || !height) return null;
    const ratio = width / height;
    if (Math.abs(ratio - 1) <= 0.02) return 'square';
    return ratio > 1 ? 'landscape' : 'portrait';
  }

  const LABELS = {minDurationSec: '最短时长', maxDurationSec: '最长时长', orientation: '画幅', minHeight: '分辨率', audioCategory: '类别'};

  /** 逐条记账：验过的进 verified，元数据缺席或对不上的进 unverified。
     **缺元数据不算通过**——验证不了就不该混进「已按 10 秒以内筛过」的结果里。 */
  function report(asset, hard) {
    const out = {verified: [], unverified: [], score: 0};
    const check = (key, verdict) => (verdict === true ? out.verified : out.unverified).push(key);
    const dur = asset.spec.durationSec;
    if (hard.minDurationSec !== null && hard.minDurationSec !== undefined) {
      check('minDurationSec', dur === null || dur === undefined ? null : dur + 0.05 >= hard.minDurationSec);
    }
    if (hard.maxDurationSec !== null && hard.maxDurationSec !== undefined) {
      check('maxDurationSec', dur === null || dur === undefined ? null : dur <= hard.maxDurationSec + 0.05);
    }
    if (hard.orientation) {
      const actual = orientationOf(asset.spec.width, asset.spec.height);
      check('orientation', actual === null ? null : actual === hard.orientation);
    }
    if (hard.minHeight) {
      const heights = asset.renditions.map((r) => r.height).filter((h) => h);
      const best = heights.length ? Math.max.apply(null, heights) : asset.spec.height;
      check('minHeight', best ? best >= hard.minHeight : null);
    }
    if (hard.audioCategory) {
      check('audioCategory', asset.audioCategory ? asset.audioCategory === hard.audioCategory : null);
    }
    return out;
  }
  const passesHard = (asset, hard) => report(asset, hard).unverified.length === 0;

  /** 验过的条件每条 +1，软偏好命中标题或标签每条 +0.5，再加一点原始名次衰减。
     **不跨来源相加平台自己的相关度分**——那是各家的量纲，加起来没有意义。 */
  function score(asset, intent, rank_) {
    let value = report(asset, intent.hard).verified.length;
    const hay = (asset.title + ' ' + asset.tags.join(' ')).toLowerCase();
    for (const soft of intent.soft) if (hay.indexOf(soft.toLowerCase()) >= 0) value += 0.5;
    return value - (rank_ || 0) * 0.001;
  }

  /** 所选花费策略下该用哪条版本。仅免费时没有免费版本就**不自动改用付费版本**。 */
  function defaultRendition(asset, costPolicy, usage) {
    const pool = costPolicy === 'free-only' ? asset.renditions.filter((r) => r.cost === 'free') : asset.renditions;
    if (!pool.length) return null;
    const ok = pool.filter((r) => evaluate(r.license, usage) !== 'not-allowed');
    return (ok.length ? ok : pool)[0];
  }

  function hit(asset, intent, rank_) {
    const matched = report(asset, intent.hard);
    matched.score = score(asset, intent, rank_);
    const rendition = defaultRendition(asset, intent.costPolicy, intent.usageProfile);
    return {asset, rendition, matchReport: matched,
      verdict: rendition ? evaluate(rendition.license, intent.usageProfile) : 'unverified'};
  }
  const rank = (hits) => hits.sort((a, b) => b.matchReport.score - a.matchReport.score);

  /* ---------- 夹具检索 ---------- */

  const STATUS_TEXT = {ok: '', unconfigured: '未配置密钥', 'quota-exhausted': '本小时配额已用完',
    unavailable: '暂时不可用', 'external-only': '只能到站点检索', disabled: '已关闭',
    'needs-authorization': '需要单独授权后才能启用'};

  function statusOf(cap) {
    if (cap.search === 'external') return 'external-only';
    if (cap.policy === 'needs-authorization') return 'needs-authorization';
    if (cap.search === 'disabled') return 'disabled';
    if (cap.credential === 'missing') return 'unconfigured';
    return 'ok';
  }

  /** 来源行的一句话说明：每个来源为什么没出结果都要能看见。 */
  function outcomeLine(outcome) {
    if (outcome.status !== 'ok') return STATUS_TEXT[outcome.status] || '暂时不可用';
    return outcome.filteredOut > 0
      ? outcome.returned + ' 条，另有 ' + outcome.filteredOut + ' 条不满足筛选条件'
      : outcome.returned + ' 条';
  }

  /* 文字命中。中文没有空格，「城市夜景」是一个 token，所以除了「候选里有这个词」
     还认「这个 token 里含候选的某个标签」——否则一句自然的中文只能整串比对，
     一条都命不中。这只影响**召回**：硬条件照样逐条验，命中不等于满足条件。 */
  const textMatch = (asset, intent) => {
    if (!intent.queries.length) return true;
    const hay = (asset.title + ' ' + asset.tags.join(' ')).toLowerCase();
    const tags = asset.tags.map((t) => t.toLowerCase()).filter((t) => t.length >= 2);
    return intent.queries[0].split(' ').some((word) =>
      word && (hay.indexOf(word) >= 0 || tags.some((tag) => word.indexOf(tag) >= 0)));
  };

  /** 跨来源检索的夹具实现：复筛与记账口径与内核一致，数据是演示数据。 */
  function search(kind, raw, opts) {
    const o = opts || {};
    const intent = parseIntent(kind, raw);
    intent.costPolicy = o.costPolicy || 'free-only';
    intent.usageProfile = o.usageProfile || 'online-video';
    const caps = capabilitiesFor(kind, o.disabled);
    const providers = [], hits = [];
    for (const cap of caps) {
      const status = statusOf(cap);
      if (status !== 'ok') {
        providers.push({providerId: cap.id, status, returned: 0, filteredOut: 0, externalUrl: (cap.externalSearch || {})[kind] || null});
        continue;
      }
      const pool = ASSETS.filter((a) => a.providerId === cap.id && a.kind === kind && textMatch(a, intent));
      let kept = 0;
      pool.forEach((asset, index) => {
        if (!passesHard(asset, intent.hard)) return;
        const one = hit(asset, intent, index);
        // 用途档下明确禁止的候选不进结果：给用户看一条他用不了的素材，只会让他白下一次
        if (one.verdict === 'not-allowed') return;
        kept++; hits.push(one);
      });
      providers.push({providerId: cap.id, status: 'ok', returned: kept, filteredOut: pool.length - kept, externalUrl: null});
    }
    rank(hits);
    return {intent, hits, providers, caps};
  }

  /* ---------- 获取（§4.3 / §6） ---------- */

  const ACQUIRE_STEPS = [
    {k: 'resolving', label: '重新核实下载信息'},
    {k: 'downloading', label: '下载到临时目录'},
    {k: 'verifying', label: '类型与魔数校验'},
    {k: 'probing', label: '探测时长与画幅'},
    {k: 'installing', label: '原子安装到视频'},
    {k: 'committing', label: '写入视频素材'},
  ];
  const ISSUE_TEXT = {
    provider_unconfigured: {title: '这个来源还没配好', action: '去设置'},
    quota_exhausted: {title: '本小时配额已用完', action: '稍后重试'},
    provider_unavailable: {title: '来源暂时不可用', action: '重试'},
    rendition_gone: {title: '这个版本在来源那边没了', action: '换一个版本'},
    license_mismatch: {title: '这条许可不允许当前用途', action: '换用途档或换素材'},
    cost_not_allowed: {title: '按当前设置只用免费版本', action: '改花费设置'},
    not_media: {title: '下到的不是媒体文件', action: '重试'},
    too_large: {title: '文件超过单次获取上限', action: '换一个版本'},
    disk_full: {title: '磁盘空间不足', action: '清理后重试'},
    project_changed: {title: '落点已经不在了', action: '重新发起'},
    network: {title: '网络没连上', action: '重试'},
    cancelled: {title: '已取消', action: ''},
  };

  /** 下载**之前**先过许可与花费两道闸：不让用户白下一次再被拒。 */
  function acquirePlan(asset, rendition, usage, costPolicy) {
    if (!rendition) return {ok: false, code: 'cost_not_allowed'};
    if (costPolicy === 'free-only' && rendition.cost !== 'free') return {ok: false, code: 'cost_not_allowed'};
    const verdict = evaluate(rendition.license, usage);
    if (verdict === 'not-allowed') return {ok: false, code: 'license_mismatch', verdict};
    return {ok: true, verdict, steps: ACQUIRE_STEPS};
  }

  /** 署名行按时间轴**实际引用**生成；查不到来源如实写「未知」，不猜。 */
  function attributionLine(record) {
    if (!record) return '未知来源';
    const lic = LICENSES[record.license] || {};
    const author = (record.origin && record.origin.author && record.origin.author.name) || null;
    const site = (record.origin && record.origin.site) || null;
    if (!author && !site) return record.title + '：来源未知';
    return record.title + '：' + [author, site, lic.label].filter(Boolean).join(' · ');
  }

  /* ---------- 演示候选（夹具，不是平台响应） ---------- */

  /* @ds-allow: 缩略图画的是素材本身的画面，不是 S2 表面 */
  const G = ['linear-gradient(160deg,#1b2740,#070a12)', 'linear-gradient(160deg,#2f3a4f,#101722)', 'linear-gradient(160deg,#402a1b,#120b07)', 'linear-gradient(160deg,#16303a,#07131a)', 'linear-gradient(160deg,#3a2740,#140b1a)'];

  const ASSETS = [
    {providerId: 'pexels', assetId: 'demo-v-1', kind: 'video', title: '城市夜景航拍', demo: true,
      tags: ['城市', '夜景', 'city', 'night', 'aerial', 'cinematic'],
      origin: {site: 'pexels.com', pageUrl: 'https://www.pexels.com/video/3130284/', author: {name: '示例作者 A', url: null}},
      spec: {durationSec: 16, width: 1080, height: 1920, fps: 29.97, hasAudio: false}, grad: G[0],
      renditions: [{id: 'hd-1080p', format: 'mp4', width: 1080, height: 1920, bytesEstimate: 12582912, cost: 'free', acquire: 'direct', license: 'pexels-license'},
        {id: 'uhd-4k', format: 'mp4', width: 2160, height: 3840, bytesEstimate: 62914560, cost: 'free', acquire: 'direct', license: 'pexels-license'}]},
    {providerId: 'pexels', assetId: 'demo-v-2', kind: 'video', title: '黄昏天际线', demo: true,
      tags: ['城市', '天际线', 'city', 'skyline', 'dusk', 'calm'],
      origin: {site: 'pexels.com', pageUrl: 'https://www.pexels.com/video/2098989/', author: {name: '示例作者 B', url: null}},
      spec: {durationSec: 24, width: 3840, height: 2160, fps: 25, hasAudio: false}, grad: G[1],
      renditions: [{id: 'uhd-4k', format: 'mp4', width: 3840, height: 2160, bytesEstimate: 88080384, cost: 'free', acquire: 'direct', license: 'pexels-license'}]},
    {providerId: 'pixabay', assetId: 'demo-v-3', kind: 'video', title: '夜间车流延时', demo: true,
      tags: ['城市', '车流', 'city', 'traffic', 'night', 'timelapse'],
      origin: {site: 'pixabay.com', pageUrl: 'https://pixabay.com/videos/id-118813/', author: {name: '示例作者 C', url: null}},
      spec: {durationSec: 9, width: 1080, height: 1920, fps: 30, hasAudio: false}, grad: G[2],
      renditions: [{id: 'large', format: 'mp4', width: 1080, height: 1920, bytesEstimate: 7340032, cost: 'free', acquire: 'direct', license: 'pixabay-content-license'}]},
    {providerId: 'pixabay', assetId: 'demo-v-4', kind: 'video', title: '雨夜街道', demo: true,
      tags: ['城市', '雨', 'city', 'rain', 'street', 'night'],
      origin: {site: 'pixabay.com', pageUrl: 'https://pixabay.com/videos/id-201455/', author: {name: '示例作者 D', url: null}},
      spec: {durationSec: 31, width: 1920, height: 1080, fps: 30, hasAudio: false}, grad: G[3],
      renditions: [{id: 'large', format: 'mp4', width: 1920, height: 1080, bytesEstimate: 24117248, cost: 'free', acquire: 'direct', license: 'pixabay-content-license'}]},
    // 时长与画幅缺席的一条：三项硬条件一条都验不了，只能落 unverified，不许混进筛过的结果
    {providerId: 'pexels', assetId: 'demo-v-5', kind: 'video', title: '海边日落慢镜', demo: true,
      tags: ['海', '日落', 'sea', 'sunset', 'warm'],
      origin: {site: 'pexels.com', pageUrl: 'https://www.pexels.com/video/857251/', author: {name: '示例作者 E', url: null}},
      spec: {durationSec: null, width: null, height: null, fps: null, hasAudio: false}, grad: G[4],
      renditions: [{id: 'hd-1080p', format: 'mp4', width: null, height: null, bytesEstimate: null, cost: 'free', acquire: 'direct', license: 'pexels-license'}]},
    {providerId: 'openverse', assetId: 'demo-a-1', kind: 'audio', audioCategory: 'music', title: '轻快讲解背景乐', demo: true,
      tags: ['讲解', '轻快', 'bgm', 'upbeat', 'minimal'],
      origin: {site: 'freemusicarchive.example', pageUrl: 'https://openverse.org/audio/demo-a-1', author: {name: '示例音乐人 F', url: null}},
      spec: {durationSec: 138, width: null, height: null, fps: null, hasAudio: true},
      renditions: [{id: 'mp3', format: 'mp3', width: null, height: null, bytesEstimate: 3355443, cost: 'free', acquire: 'direct', license: 'by'}]},
    {providerId: 'openverse', assetId: 'demo-a-2', kind: 'audio', audioCategory: 'sfx', title: '键盘敲击', demo: true,
      tags: ['键盘', '打字', 'keyboard', 'typing', 'sfx'],
      origin: {site: 'freesound.example', pageUrl: 'https://openverse.org/audio/demo-a-2', author: {name: '示例录音师 G', url: null}},
      spec: {durationSec: 3.2, width: null, height: null, fps: null, hasAudio: true},
      renditions: [{id: 'wav', format: 'wav', width: null, height: null, bytesEstimate: 614400, cost: 'free', acquire: 'direct', license: 'cc0'}]},
    {providerId: 'openverse', assetId: 'demo-a-3', kind: 'audio', audioCategory: 'ambience', title: '窗外雨声', demo: true,
      tags: ['雨', '环境音', 'rain', 'ambience', 'calm'],
      origin: {site: 'freesound.example', pageUrl: 'https://openverse.org/audio/demo-a-3', author: {name: '示例录音师 H', url: null}},
      spec: {durationSec: 240, width: null, height: null, fps: null, hasAudio: true},
      renditions: [{id: 'mp3', format: 'mp3', width: null, height: null, bytesEstimate: 5767168, cost: 'free', acquire: 'direct', license: 'by-nc'}]},
  ];

  /* ---------- 展示辅助 ---------- */

  function bytesText(n) {
    if (!n) return null;
    return n >= 1048576 ? '约 ' + Math.round(n / 1048576) + ' MB' : '约 ' + Math.round(n / 1024) + ' KB';
  }
  /** 元信息行：未知一律缺席，不推算假精度。 */
  function metaLine(asset, rendition) {
    const out = [];
    const dur = asset.spec.durationSec;
    if (dur !== null && dur !== undefined) {
      const m = Math.floor(dur / 60), s = Math.round(dur % 60);
      out.push(m + ':' + String(s).padStart(2, '0'));
    } else out.push('时长未知');
    if (rendition && rendition.width && rendition.height) out.push(rendition.width + '×' + rendition.height);
    else if (asset.spec.width && asset.spec.height) out.push(asset.spec.width + '×' + asset.spec.height);
    const bytes = rendition ? bytesText(rendition.bytesEstimate) : null;
    if (bytes) out.push(bytes);
    return out.join(' · ');
  }
  const providerOf = (id) => PROVIDERS.find((p) => p.id === id) || null;
  /** 站外桥接的检索地址：带上关键词打开对应分类页，不解析页面结构。 */
  function externalSearchUrl(cap, kind, raw) {
    const base = (cap.externalSearch || {})[kind];
    if (!base) return cap.siteUrl;
    const q = String(raw || '').trim();
    return q ? base + '?q=' + encodeURIComponent(q) : base;
  }

  const api = {USAGE, ALL_USAGE, usageLabel, LICENSES, VERDICT, evaluate, PROVIDERS, ASSETS, STATES,
    searchable, externalOnly, capabilitiesFor, paneState, parseIntent, durationBounds, orientationOf,
    LABELS, report, passesHard, score, defaultRendition, hit, rank, statusOf, outcomeLine, search,
    ACQUIRE_STEPS, ISSUE_TEXT, acquirePlan, attributionLine, bytesText, metaLine, providerOf, externalSearchUrl};
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.BC_STOCK = api;
})();
