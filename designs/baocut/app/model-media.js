/* BaoCut 原型 — 建项媒体探测（§8.2 / §8.3 类型 A，第 101 轮）
   window.BC_MEDIA。纯函数，无 React、无 DOM。

   这一层回答的是「选完文件（或粘完地址）之后，卡片上写什么」。真产品里这些字段
   来自 ffprobe（本地档）与 `yt-dlp --dump-json`（URL 档）；原型没有那两条通道，
   于是**按文件名/地址确定性折算**——同一个名字永远算出同一张卡，不同名字算出不同的
   一张。刻意不写随机数：向导每 render 一次就换一遍分辨率的卡片没法验收。

   演示项目的源文件（`data.js` 的 `projects[].src`）是**先查表再折算**：
   `kelang-ep42-master.mp4` 在首页 hero 与向导里探出来的格式/分辨率/时长，必须与
   我的项目列表里那一行、编辑器顶栏那一份完全一致——两处对不上，用户会以为是两个文件。 */
(function () {
  const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mpeg', 'mpg', 'webm', 'mkv'];
  const AUDIO_EXT = ['m4a', 'mp3', 'wav', 'flac', 'aac', 'ogg'];

  /** 确定性字符串散列（FNV-1a 32 位）——所有「看起来随机」的折算都由它派生 */
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < String(s).length; i++) {
      h ^= String(s).charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function ext(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  }

  /** video / audio / other——拖进来的东西收不收，判据只有这一个 */
  function kindOf(name) {
    const e = ext(name);
    if (VIDEO_EXT.includes(e)) return 'video';
    if (AUDIO_EXT.includes(e)) return 'audio';
    return 'other';
  }

  /* 容器 → 常见编码。写死一张表而不是也去散列：MOV 探出 H.264 与探出 ProRes
     是两个不同的产品事实（后者意味着几十 GB 的素材），随手掷骰子会误导。 */
  const CODEC = {
    mp4: 'H.264', m4v: 'H.264', mpeg: 'MPEG-2', mpg: 'MPEG-2', mov: 'ProRes',
    webm: 'VP9', mkv: 'H.264',
    m4a: 'AAC', mp3: 'MP3', wav: 'PCM', flac: 'FLAC', aac: 'AAC', ogg: 'Opus',
  };
  const RES = [[1920, 1080], [1280, 720], [3840, 2160], [1080, 1920]];

  /**
   * 本地文件探测。`known` 传 `BC_DATA.projects`（或任何带 `src.name` 的表），
   * 命中就用表里的真相，未命中才折算。
   * 返回 {name, kind, container, codec, res, w, h, ratio, duration, sizeMB, dir, path, hue}
   */
  function probeFile(name, known) {
    const fname = String(name || '');
    const e = ext(fname);
    const kind = kindOf(fname);
    const h = hash(fname);

    const hit = (known || []).map((p) => p.src && {src: p.src, duration: p.duration})
      .find((x) => x && x.src.name === fname);

    const container = (e || 'mp4').toUpperCase();
    const codec = CODEC[e] || (kind === 'audio' ? 'AAC' : 'H.264');
    const dims = RES[h % RES.length];
    const duration = hit ? hit.duration : 120 + (h % 5400);

    let w = dims[0], hgt = dims[1];
    if (hit && hit.src.res) {
      const parts = String(hit.src.res).split(/[×x]/);
      w = +parts[0]; hgt = +parts[1];
    }

    /* 码率折算：视频按分辨率档给一个常见值，音频按容器给。大小 = 码率 × 时长，
       所以「3840×2160 的 52 分钟素材」算出来是几十 GB——那正是用户该看见的量级。 */
    const mbps = kind === 'audio'
      ? (e === 'wav' ? 1.4 : e === 'flac' ? 0.7 : 0.16)
      : (w >= 3840 ? (codec === 'ProRes' ? 47 : 12) : w >= 1920 ? 4.6 : 2.4);
    const sizeMB = Math.max(1, Math.round(mbps * duration / 8));

    /* 未命中演示表时的目录按类型给：音频落 ~/Music，视频落 ~/Movies——
       把一个 m4a 播客写在 ~/Movies 下面，卡片第三行当场就不像真的了。 */
    const dir = hit ? String(hit.src.path).replace(/\/[^/]*$/, '')
      : kind === 'audio' ? '~/Music' : '~/Movies';
    return {
      name: fname, kind, container, codec,
      res: kind === 'audio' ? null : `${w}×${hgt}`,
      w: kind === 'audio' ? null : w, h: kind === 'audio' ? null : hgt,
      ratio: kind === 'audio' ? null : w / hgt,
      duration, sizeMB, dir, path: dir + '/' + fname,
      hue: h % 360,
    };
  }

  /** 1.2 GB / 612 MB —— 1024 起进位，小于 1 GB 只写整数 MB */
  function fmtSize(mb) {
    const v = Math.max(0, +mb || 0);
    return v >= 1024 ? `${(v / 1024).toFixed(1)} GB` : `${Math.round(v)} MB`;
  }

  /** 卡片副行：`MP4 · H.264 · 1920×1080 · 03:26 · 118 MB`（音频没有分辨率那一格） */
  function fileMeta(info, fmtDur) {
    return [info.container, info.codec, info.res, fmtDur(info.duration), fmtSize(info.sizeMB)]
      .filter(Boolean).join(' · ');
  }

  /* ---------- URL 档 ---------- */

  /* 演示用的节目表：标题与频道**成对**取（此前两者各掷一次骰子，抓出过
     「码与远方 · 第 18 期」挂在「Local-first Lab」名下这种对不上的卡）。
     禁真实品牌名，这三档与 data.js 的演示项目同一族虚构节目。 */
  const SHOWS = [
    {title: '码与远方 · 第 18 期：本地优先的渲染管线', channel: '码与远方'},
    {title: '科浪访谈 · 第 39 期：确定性合成器是怎么做的', channel: '科浪访谈'},
    {title: 'Local-first Lab · Ep. 07: Shipping a GPU pipeline', channel: 'Local-first Lab'},
  ];

  const SITES = [
    {host: /(^|\.)youtube\.com$|(^|\.)youtu\.be$/, name: 'YouTube'},
    {host: /(^|\.)bilibili\.com$|(^|\.)b23\.tv$/,  name: '哔哩哔哩'},
    {host: /(^|\.)vimeo\.com$/,                    name: 'Vimeo'},
    {host: /(^|\.)twitch\.tv$/,                    name: 'Twitch'},
  ];

  /** 地址像不像个地址——CTA 的 canGo 与解析卡出不出，共用这一个判据 */
  function urlValid(url) {
    return /^https?:\/\/\S+\.\S+/.test(String(url || '').trim());
  }

  function hostOf(url) {
    const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || '').trim());
    return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
  }

  /** 直链（地址末尾就是个媒体文件）与页面地址是两种抓取，卡片写的话也不同 */
  function directExt(url) {
    const m = /\/([^/?#]+)\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(String(url || ''));
    const e = m ? m[2].toLowerCase() : '';
    return VIDEO_EXT.includes(e) || AUDIO_EXT.includes(e) ? e : '';
  }

  /** 落盘文件名：站点页取标题的 slug，直链保留原文件名 */
  function saveName(url) {
    const direct = directExt(url);
    if (direct) {
      const m = /\/([^/?#]+)(?:[?#]|$)/i.exec(String(url));
      return m ? m[1] : 'download.' + direct;
    }
    const slug = String(url || '').replace(/^https?:\/\//, '')
      .replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 28).toLowerCase();
    return (slug || 'download') + '.mp4';
  }

  /**
   * URL 探测。返回 {site, direct, title, channel, duration, date, saveName, hue, fetching}
   * `fetching` 为真表示标题还在路上——真产品里 `yt-dlp --dump-json` 要一两秒，
   * 卡片先占位再补字，不是等解析完才整张出现（那会让人以为地址粘错了）。
   */
  function probeUrl(url, opts) {
    const u = String(url || '').trim();
    const host = hostOf(u);
    const h = hash(u);
    const direct = directExt(u);
    const site = direct ? '直链' : (SITES.find((s) => s.host.test(host)) || {name: host || '网页'}).name;
    const fetching = !!(opts && opts.fetching);
    const days = h % 900;
    const d = new Date(Date.UTC(2026, 7, 31) - days * 86400000);
    return {
      site, direct, host, fetching,
      title: direct ? saveName(u) : SHOWS[h % SHOWS.length].title,
      channel: direct ? host : SHOWS[h % SHOWS.length].channel,
      duration: 180 + (h % 6000),
      date: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
      saveName: saveName(u),
      hue: h % 360,
    };
  }

  /** 媒体是否就绪——本地档看选没选文件，URL 档看地址像不像个地址。
      CTA 的 canGo 与卡片出不出必须同一个函数：两处各写一份，早晚出现
      「卡片都解析出来了钮还灰着」。 */
  function mediaReady(st) {
    return (st.src || 'file') === 'url' ? urlValid(st.url) : !!st.file;
  }

  /* ---------- 音频 / 视频的建项差异（第 225 轮） ----------
     文件一落下来就知道它有没有画面，这一点决定了三件事：向导该推哪个意图、
     画布上要不要先放一条声波、时间轴上主轨是视频还是音频。判据只有一个
     （`kindOf`），三处都问它，不各自看后缀。 */

  /** 首页 / 向导拿到文件时的默认意图：纯音频默认做成视频，视频默认加字幕 */
  function wizardIntent(name) {
    return kindOf(name) === 'audio' ? 'a2v' : 'sub';
  }

  /**
   * 文件与当前意图搭不搭：返回 {kind, suggest, note}。
   * `suggest` 非空表示「换成这个意图更对题」，向导在用户没亲手挑过意图时直接换，
   * 挑过就只把话说出来、给一颗换的钮。音频配「翻译 / 剪口播」是合理组合，不推翻，
   * 只说清编辑器里会是音频主轨。
   */
  function intentAdvice(name, intent) {
    const kind = kindOf(name || '');
    if (kind === 'audio') {
      if (intent === 'a2v') return {kind, suggest: null,
        note: '纯音频没有画面：建好视频就是一段带背景、声波和字幕的视频，导出后能直接发平台。'};
      if (intent === 'sub') return {kind, suggest: 'a2v',
        note: '这是纯音频：按「加字幕」只转录出字幕，编辑器里主轨是音频波形；想做成能发的视频，换成「音频转视频」。'};
      return {kind, suggest: null,
        note: '这是纯音频：编辑器里主轨是音频波形，没有视频轨；想配上画面可以换成「音频转视频」。'};
    }
    if (kind === 'video' && intent === 'a2v') return {kind, suggest: 'sub',
      note: '这是视频，画面会保留，不需要转成视频；换成「加字幕」就好。'};
    return {kind, suggest: null, note: null};
  }

  /** 向导 6 色背景板 → 画布底色 token（与向导色块同一张表，灰取 300、其余取 400） */
  const BG_HUES = ['gray', 'blue', 'purple', 'green', 'orange', 'magenta'];
  function bgToken(bg) {
    const h = BG_HUES.includes(bg) ? bg : 'gray';
    return `var(--${h === 'gray' ? 'gray-300' : h + '-400'})`;
  }

  /** 建项交接与探测卡共用媒体事实；配置留在项目和任务上，不被示例默认值覆盖。 */
  function localProject(id, file, options = {}, known = []) {
    const media = probeFile(file || '未命名.mp4', known);
    const entry = options.entry || options.intent || 'sub';
    const audio = media.kind === 'audio';
    /* 音频项目的三样默认（第 225 轮）：声波开、字幕开、灰底——不管走的是哪个意图。
       用户在向导里关掉的照关；视频项目不带这三样（它有画面）。 */
    const config = {...options, entry, lang: options.lang || 'auto',
      model: options.model || 'moss-transcribe',
      wave: audio && options.wave !== false, subs: options.subs !== false,
      bg: audio ? (BG_HUES.includes(options.bg) ? options.bg : 'gray') : null};
    const ratio = audio ? options.ratio || '16:9'
      : media.w && media.h ? `${media.w / gcd(media.w, media.h)}:${media.h / gcd(media.w, media.h)}` : '16:9';
    const project = {id, title: media.name.replace(/\.[a-z0-9]+$/i, ''), origin: 'local', entry,
      status: 'transcribing', progress: 0, ratio, config,
      src: {name: media.name, path: media.path, format: [media.container, media.codec].join(' · '),
        res: media.res || '', state: 'ok'},
      duration: media.duration, lang: config.lang === 'auto' ? '自动检测' : config.lang,
      model: config.model, modified: '刚刚', ctime: 0, hue: media.hue, meta: {}};
    const task = {kind: 'transcribe', project: id, title: '转录 · ' + project.title,
      sub: config.model + ' · 本机', phase: '解码中', cancellable: true, origin: 'local', options: {...config}};
    return {project, task};
  }

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  /**
   * 项目打开时的媒体装置：视频给一段完整 clip；音频不出 clip、`audio` 为真（时间轴主轨
   * 是音频波形），并按建项配置预埋一条**真的**声波元素（`elements`）——它在画布上可选、
   * 可换样式、可删，时间轴上有自己的一行，不是画在画面上的示意图。
   */
  function projectMedia(project) {
    const kind = kindOf(project.src.name);
    const sources = {image: [], video: [], audio: []};
    if (kind !== 'other') sources[kind].push({id: 'source-' + kind, name: project.src.name, dur: project.duration,
      meta: [project.src.format, project.src.res].filter(Boolean).join(' · ')});
    const clips = [{id: 'source', start: 0, end: project.duration, src: 0}];
    const cfg = project.config || {};
    const elements = kind === 'audio' && cfg.wave !== false
      ? [{id: 'wave-main', kind: 'wave', name: '声波', icon: 'wave', hue: 'magenta', added: true,
          start: 0, end: project.duration, place: {x: 50, y: 60, w: 55}}]
      : [];
    return {sources, clips: kind === 'video' ? clips : [], audio: kind === 'audio', elements,
      bg: kind === 'audio' ? bgToken(cfg.bg) : null, subs: cfg.subs !== false};
  }

  function placement(id, kind, source, playhead) {
    const start = Math.max(0, Math.floor((Number(playhead) || 0) * 10) / 10);
    if (kind === 'audio' && !(source.dur > 0.1)) return null;
    const duration = kind === 'image' ? 4 : source.dur > 0 ? source.dur : 8;
    const element = {id, kind, name: source.name, asset: source.name, sourceId: source.id,
      icon: kind, hue: kind === 'audio' ? 'green' : 'yellow', added: true,
      start, end: start + duration, srcStart: 0};
    if (kind !== 'audio') {
      element.place = kind === 'image' ? {x: 71, y: 29, w: 34} : {x: 50, y: 50, w: 60};
      element.style = kind === 'image' ? {radius: 28} : {vol: 100};
    }
    return element;
  }

  /** 素材能不能从项目移除：**转录源不可移除**（字幕与文稿来自它，`mainName` 是转录源文件名，
      不是「主视频」——时间轴上它只是普通视频元素），其余看有没有元素还引用着。 */
  function sourceUsed(source, elements, mainName) {
    return source.name === mainName || elements.some(e => e.asset
      ? e.asset === source.name : e.sourceId === source.id);
  }

  window.BC_MEDIA = {
    VIDEO_EXT, AUDIO_EXT, hash, ext, kindOf, probeFile, fmtSize, fileMeta,
    urlValid, hostOf, directExt, saveName, probeUrl, mediaReady, localProject, projectMedia, placement, sourceUsed,
    wizardIntent, intentAdvice, bgToken, BG_HUES,
  };
})();
