/* 音频导出的纯模型（2026-09-20，§17.1）。window.BC_AEXPORT。纯函数，无 React、无 DOM。

   导出弹层多出一页「音频」——把这个项目的声音单独写成一个文件（WAV / MP3 / M4A），
   而不是先导一份 MP4 再去别处扒音轨。视频页那一套照旧管用，这里只补音频独有的四件事：

     · soundLanes()  「声音里有什么」：从同一份生效清单（`BC_EXPORT.apply` 的结果）里挑出
                     会发声的那几条。**2026-09-16 起没有主视频**，原声跟着每件视频元素走
                     （`el:<id>`，[§12.0]），所以这张清单是「每件带声音的元素」＋ 原声轨
                     （纯音频项目才有）＋ 音乐 ＋ 配音 ＋ 背景声。开关与视频页**共用同一层
                     覆盖表**：一条声音进不进这次导出，两页问的是同一个问题。
     · presets()     快速选择：成片混音 / 只要原声 / 只要配音 / 只要音乐。一档就是一张覆盖表
                     补丁；当前取舍恰好等于某一档时那颗 Chip 亮着（presetOf）。音频元素这类
                     「别的声音」只在「成片混音」里跟着时间轴走，另外三档一律关掉。
     · voiceParts()  人声分份：音频容器没有「播放器里切语言」这回事（那是 MP4 多音轨才有的
                     东西），所以开着的人声多于一条时默认**每种一份**：一条人声一个文件，
                     各自带自己的背景声，音乐与音频元素进每一份。也可以「混成一份」——挑一种
                     人声烧进去，其余不进文件，与视频页「一条声道」同口径。
                     几件视频元素的声音合起来算**一条**人声（同一条原声被剪成几段），不是几条。
     · estimate()    体积与耗时：WAV 按 48 kHz / 16-bit / 声道数硬算，有损按码率算；耗时按
                     实时的 AUDIO_SPEED 倍估——音频不过混音与编码，比视频快一个量级。

   范围（整片 / 按章节 / 按片段 / 自定义）与文件名的范围后缀都走 `BC_EXPORT`：音频页与视频页
   共用**同一份范围状态**，一次导出的取舍只有一份。 */
(function () {
  const X = typeof window !== 'undefined' && window.BC_EXPORT ? window.BC_EXPORT
    : (typeof require === 'function'
      ? (global.window = global.window || {}, require('./model-export.js'), global.window.BC_EXPORT)
      : null);

  /* 格式三档。WAV 不依赖任何编码器；MP3（libmp3lame）与 M4A（AAC）要本机有 ffmpeg——
     与 `worker/tts.rs::default_speech_format` 同一条口径，探不到 ffmpeg 时这两档该灰掉
     并写明原因（原型无处取真值，按有 ffmpeg 画）。 */
  const AUDIO_FORMATS = [
    {k: 'wav', label: 'WAV', ext: '.wav', lossless: true, needsFfmpeg: false,
     note: '无损 · 体积最大 · 拿去后期再加工用这个'},
    {k: 'mp3', label: 'MP3', ext: '.mp3', lossless: false, needsFfmpeg: true,
     note: '通用 · 播客平台、车机和老设备都认'},
    {k: 'm4a', label: 'M4A', ext: '.m4a', lossless: false, needsFfmpeg: true,
     note: 'AAC · 同码率比 MP3 清楚一点 · Apple 生态原生'},
  ];
  const BITRATES = [128, 192, 320];        // kbps，默认 192
  const DEFAULT_BITRATE = 192;
  const WAV_RATE = 48000;                  // Hz
  const WAV_BITS = 16;
  /* 耗时：混音 + 编码，按实时的多少倍走。视频那条是 帧数 × k × 输出百万像素（§17.1 M122），
     音频与画面大小无关，只与时长有关。 */
  const AUDIO_SPEED = 40;
  const CHANNELS = [
    {k: 'stereo', label: '立体声', n: 2},
    {k: 'mono', label: '单声道', n: 1},
  ];

  const fmtOf = (fmt) => AUDIO_FORMATS.find((f) => f.k === fmt) || AUDIO_FORMATS[1];
  const chOf = (ch) => CHANNELS.find((c) => c.k === ch) || CHANNELS[0];

  /* ---------- 声音里有什么 ---------- */

  const LANE_KINDS = ['audio', 'music', 'score', 'dub', 'bed'];
  /** 元素里自己带声音的那几种；别的元素（贴纸 / 文字 / 形状…）不进这张清单。 */
  const EL_KINDS = {video: '这段视频里的声音', audio: '音频元素'};

  /** 生效清单 ＋ 元素表 → 音频页的清单。排序是「原声 → 别的声音 → 音乐 / 配音 / 背景声」。
   *  几件视频元素的声音**折成一组**（`kind: 'orig'`，可展开逐件）——一条原声被剪成的几段
   *  在清单上平铺成七行「视频 · 这段视频里的声音」谁也读不下去；组里每一件的 `key` 仍是
   *  `el:<id>`，与视频页是同一个开关。纯音频项目没有视频元素，走原声轨那一条（`kind: 'audio'`）。
   *  `els` 是 `ctx.elements`（`[{id, kind, name}]`）。 */
  function soundLanes(eff, els) {
    const kindOf = {};
    (els || []).forEach((e) => { if (e && e.id) kindOf[e.id] = e.kind; });
    const out = [];
    const orig = [];
    const extra = [];
    const grp = (eff || []).find((l) => l.kind === 'els');
    ((grp && grp.items) || []).forEach((it) => {
      const k = kindOf[it.id];
      if (!EL_KINDS[k]) return;
      const row = {key: it.key, kind: 'el', el: k, id: it.id, label: it.label, sub: EL_KINDS[k], on: !!it.on};
      (k === 'video' ? orig : extra).push(row);
    });
    if (orig.length) {
      out.push({key: 'orig', kind: 'orig', label: '原声', sub: '视频里的原始声音',
        items: orig, on: orig.some((i) => i.on)});
    }
    extra.forEach((r) => out.push(r));
    (eff || []).forEach((l) => { if (LANE_KINDS.indexOf(l.kind) >= 0) out.push(l); });
    return out;
  }
  /** 清单上的每一个开关键（组展开成逐件） */
  function soundKeys(rows) {
    const out = [];
    (rows || []).forEach((l) => {
      if (l.kind === 'orig') l.items.forEach((i) => out.push(i.key));
      else out.push(l.key);
    });
    return out;
  }
  /** 一条声音都没开 = 导不出东西 */
  const anyOn = (eff, els) => soundLanes(eff, els).some((l) => l.on);
  /** 这条是不是「原声」：视频元素的声音那一组，以及纯音频项目才有的原声轨 */
  const isOrig = (l) => l.kind === 'orig' || l.kind === 'audio';

  /* ---------- 快速选择 ---------- */

  const PRESETS = [
    {k: 'mix', label: '成片混音', note: '跟时间轴上现在听到的一样'},
    {k: 'orig', label: '只要原声', note: '视频里的原始声音，不要配音和音乐'},
    {k: 'dub', label: '只要配音', note: '译文配音 ＋ 它自己的背景声'},
    {k: 'music', label: '只要音乐', note: '只留背景音乐（有配乐轨时连同配乐）'},
  ];
  /** 这个项目配得上哪几档：`mix` 只在有两条以上声音时才有意义，其余按有没有那种声音。 */
  function presets(eff, els) {
    const sounds = soundLanes(eff, els);
    if (sounds.length < 2) return [];
    return PRESETS.filter((p) => p.k === 'mix'
      || (p.k === 'orig' && sounds.some(isOrig))
      || (p.k === 'dub' && sounds.some((l) => l.kind === 'dub'))
      || (p.k === 'music' && sounds.some((l) => l.kind === 'music' || l.kind === 'score')));
  }
  /** 某一档下每条声音该开还是关；`lanes` 是**原始清单**（`mix` 要读它的时间轴启停位）。
   *  返回的是**逐件**的键（原声组展开成每件视频元素的 `el:<id>`），直接就是覆盖表补丁。 */
  function presetTarget(lanes, els, key) {
    const out = {};
    soundLanes(lanes, els).forEach((l) => {
      const want = key === 'orig' ? isOrig(l)
        : key === 'dub' ? (l.kind === 'dub' || l.kind === 'bed')
        : key === 'music' ? (l.kind === 'music' || l.kind === 'score') : null;
      if (l.kind === 'orig') l.items.forEach((i) => { out[i.key] = key === 'mix' ? !!i.on : want; });
      else out[l.key] = key === 'mix' ? !!l.on : want;
    });
    return out;
  }
  /** 点一档 → 新的覆盖表。只动会发声的那几条；贴纸、文字这些画面上的东西一个不碰。 */
  function applyPreset(lanes, els, ov, key) {
    return Object.assign({}, ov, presetTarget(lanes, els, key));
  }
  /** 当前取舍恰好等于哪一档（没有就是 null）。`mix` 最后判——它与别的档撞上时
   *  （比如时间轴上本来就只剩音乐开着）说「只要音乐」更贴近用户刚点的那颗。 */
  function presetOf(lanes, els, eff) {
    const cur = {};
    soundLanes(eff, els).forEach((l) => {
      if (l.kind === 'orig') l.items.forEach((i) => { cur[i.key] = !!i.on; });
      else cur[l.key] = !!l.on;
    });
    const keys = Object.keys(cur);
    const same = (t) => keys.length && keys.every((k) => !!t[k] === cur[k]);
    const list = presets(lanes, els);
    const hit = list.filter((p) => p.k !== 'mix').find((p) => same(presetTarget(lanes, els, p.k)));
    if (hit) return hit.k;
    return list.some((p) => p.k === 'mix') && same(presetTarget(lanes, els, 'mix')) ? 'mix' : null;
  }

  /* ---------- 人声分份 ---------- */

  /** 开着的人声：原声算**一条**（几件视频元素是同一条原声被剪成的几段）＋ 每条开着的配音。
   *  音乐、音频元素与背景声不是人声，它们跟着人声走。 */
  function voiceLanes(eff, els) {
    const sounds = soundLanes(eff, els);
    const out = [];
    if (sounds.some((l) => isOrig(l) && l.on)) out.push({key: 'orig', id: 'audio', kind: 'audio', label: '原声', tag: '原声'});
    sounds.forEach((l) => {
      if (l.kind === 'dub' && l.on) out.push({key: l.key, id: l.id, kind: 'dub', label: l.label || '配音',
        tag: String(l.id || 'dub').toUpperCase()});
    });
    return out;
  }
  /** 默认分份口径：一条人声混成一份，两条以上各出一份（两种语言压进同一个文件没有意义）。 */
  function voiceModeDefault(eff, els) { return voiceLanes(eff, els).length > 1 ? 'each' : 'one'; }
  /** 某条配音自己那组的背景声开着没有（老的单条 `bed` 也认，与 `BC_DUB.audioTracks` 同口径）。 */
  const bedOn = (eff, id) => (eff || []).some((l) => l.kind === 'bed' && l.on && (l.id === id || l.id === 'bed'));
  /** 每一份都带着的那些声音：音乐 ＋ 配乐轨 ＋ 开着的音频元素 */
  function riders(eff, els) {
    const out = [];
    const sounds = soundLanes(eff, els);
    if (sounds.some((l) => l.kind === 'music' && l.on)) out.push('音乐');
    if (sounds.some((l) => l.kind === 'score' && l.on)) out.push('配乐');
    const n = sounds.filter((l) => l.kind === 'el' && l.el === 'audio' && l.on).length;
    if (n) out.push(n + ' 个音频元素');
    return out;
  }

  /** 这次会写出几份声音，每份里有什么。`mode`：`each` 每种人声一份 / `one` 混成一份；
   *  `pick` 是 `one` 时留哪一条人声（缺省第一条）。一条人声都没开时仍可能有一份纯音乐 /
   *  纯背景声——那份没有人声标签。 */
  function voiceParts(eff, els, mode, pick) {
    const voices = voiceLanes(eff, els);
    const ride = riders(eff, els);
    const withParts = (v) => {
      const p = [v.label];
      if (v.kind === 'dub' && bedOn(eff, v.id)) p.push('背景声');
      return p.concat(ride);
    };
    if (!voices.length) {
      const rest = ride.slice();
      (eff || []).forEach((l) => { if (l.kind === 'bed' && l.on) rest.push(l.label || '背景声'); });
      return rest.length ? [{key: 'rest', tag: '', label: rest[0], sub: rest.join(' + ')}] : [];
    }
    if (mode === 'one' || voices.length === 1) {
      const v = voices.find((x) => x.id === pick) || voices[0];
      const sub = withParts(v).join(' + ')
        + (voices.length > 1 ? ' · 其余 ' + (voices.length - 1) + ' 条人声不进文件' : '');
      return [{key: v.key, id: v.id, tag: voices.length > 1 ? v.tag : '', label: v.label, sub}];
    }
    return voices.map((v) => ({key: v.key, id: v.id, tag: v.tag, label: v.label, sub: withParts(v).join(' + ')}));
  }

  /* ---------- 文件名 ---------- */

  /** `<源名>[ 人声标签][ 范围标签].<ext>`。人声标签只在写出多份时出现（`原声` / `EN`），
   *  范围标签沿用 `BC_EXPORT.spanOf` 给的那个（` 第2章` / ` 片段1+3` / ` 0m45s-1m18s`）。
   *  「每种一份」与范围「各出一份」同时开着时两个后缀都带，文件数是两者的乘积。 */
  function audioFiles(base, opts) {
    const o = opts || {};
    const f = fmtOf(o.fmt);
    const span = o.span || {whole: true, segs: [], tag: ''};
    const parts = voiceParts(o.eff, o.els, o.mode, o.pick);
    if (!parts.length) return [];
    const segs = (o.each && span.segs && span.segs.length > 1)
      ? span.segs.map((s) => s.tag || '')
      : [span.whole ? '' : (span.tag != null ? span.tag : '')];
    const out = [];
    segs.forEach((segTag) => parts.forEach((p) => {
      out.push({name: base + (p.tag ? ' ' + p.tag : '') + segTag + f.ext, part: p.label, sub: p.sub});
    }));
    return out;
  }

  /* ---------- 体积与耗时 ---------- */

  /** 一份文件的码率（kbps）：WAV 是采样率 × 位深 × 声道数，有损就是选中的那档。
   *  单声道不改有损码率——同样的码率花在一路声音上，听感反而更干净（注脚里说清楚）。 */
  function bitrate(fmt, kbps, ch) {
    if (fmtOf(fmt).lossless) return WAV_RATE * WAV_BITS * chOf(ch).n / 1000;
    const k = +kbps;
    return BITRATES.indexOf(k) >= 0 ? k : DEFAULT_BITRATE;
  }
  /** `{kbps, bytes, size, ms, eta, total, totalSize}`。`files` 是这次写几份，体积按份数乘。 */
  function estimate(seconds, opts) {
    const o = opts || {};
    const secs = Math.max(0, +seconds || 0);
    const files = Math.max(1, +o.files || 1);
    const kbps = bitrate(o.fmt, o.kbps, o.ch);
    const bytes = kbps * 1000 / 8 * secs;
    const ms = Math.max(1000, secs * 1000 / AUDIO_SPEED * files);
    return {kbps: Math.round(kbps), bytes, size: X.fmtSize(bytes), ms, eta: X.fmtEta(ms),
      total: bytes * files, totalSize: X.fmtSize(bytes * files)};
  }
  /** 格式那一行的读法：`WAV · 48 kHz · 16-bit` / `MP3 · 192 kbps` */
  function qualityLine(fmt, kbps, ch) {
    const f = fmtOf(fmt);
    if (f.lossless) return f.label + ' · ' + (WAV_RATE / 1000) + ' kHz · ' + WAV_BITS + '-bit';
    return f.label + ' · ' + bitrate(fmt, kbps, ch) + ' kbps';
  }

  /* ---------- 摘要与任务文案 ---------- */

  /** 「将导出」那一行的零件：范围 · 格式与码率 · 声道 · 里面有什么。 */
  function summary(eff, opts) {
    const o = opts || {};
    const span = o.span || {whole: true, dur: 0, label: ''};
    const parts = [span.label || ('整片 ' + X.mmss(span.dur || 0))];
    parts.push(qualityLine(o.fmt, o.kbps, o.ch));
    parts.push(chOf(o.ch).label);
    const list = voiceParts(eff, o.els, o.mode, o.pick);
    if (!list.length) parts.push('没有声音');
    else if (list.length > 1) parts.push(list.length + ' 份 · ' + list.map((p) => p.label).join(' / '));
    else parts.push(list[0].sub);
    return parts;
  }
  /** 任务卡副题：`mp3 · 192 kbps · 立体声 · 配音 · English`。 */
  function taskSub(eff, opts) {
    const o = opts || {};
    const f = fmtOf(o.fmt);
    const parts = [f.k];
    parts.push(f.lossless ? (WAV_RATE / 1000) + ' kHz · ' + WAV_BITS + '-bit' : bitrate(o.fmt, o.kbps, o.ch) + ' kbps');
    parts.push(chOf(o.ch).label);
    const list = voiceParts(eff, o.els, o.mode, o.pick);
    if (list.length > 1) parts.push(list.length + ' 份');
    else if (list.length) parts.push(list[0].label);
    if (o.span && !o.span.whole && o.span.short) parts.push(o.span.short);
    return parts.join(' · ');
  }

  window.BC_AEXPORT = {
    AUDIO_FORMATS, BITRATES, DEFAULT_BITRATE, WAV_RATE, WAV_BITS, AUDIO_SPEED, CHANNELS, PRESETS, EL_KINDS,
    fmtOf, chOf, soundLanes, soundKeys, anyOn, isOrig,
    presets, presetTarget, applyPreset, presetOf,
    voiceLanes, voiceModeDefault, riders, voiceParts,
    audioFiles, bitrate, estimate, qualityLine, summary, taskSub,
  };
})();
