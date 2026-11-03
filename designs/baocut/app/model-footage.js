/* 「素材处理」六个工具的纯模型（product-design §2.7「素材处理」；实现的规则在 packages/ui/src/model/tools-footage.ts）。
   去抖、视频超分、插帧、统一色调、去除背景与分轨都是文件到文件：1–20 个输入各写成新文件，不动原文件、不建视频，结果是 Space 条目。
   参数、缺省值与上限照协议的 FootageParams、SeparateAudioParams 与流程 footage.ts；提示的说法照 messages/jobs/footage.zh-Hans.ts；
   受管工具的版本、大小与许可照 external-tools/tool-manifests.ts。
   这里只算：工具表、每种处理的选项、一个输入的计划（帧数、输出尺寸与时长）、工作量（耗时与磁盘）、开始前的检查与结果里的提醒。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* ---------- 六个工具 ----------
     `id` 就是流程名（FOOTAGE_PIPELINE_NAMES 与 separate-audio），也是工具目录里的 id；`accepts`：收哪几种输入。 */
  const OPS = [
    {id: 'stabilize-video', op: 'stabilize', name: '视频去抖', verb: '开始去抖', ic: 'film', accepts: ['video'],
      desc: '给手持拍摄的晃动画面去抖，用本机的 ffmpeg，不用另外下载'},
    {id: 'upscale-video', op: 'upscale', name: '视频超分', verb: '开始超分', ic: 'film', accepts: ['video'],
      desc: '用本机的 Real-ESRGAN 把视频放大 2–4 倍，补出细节'},
    {id: 'interpolate-video', op: 'interpolate', name: '视频插帧', verb: '开始插帧', ic: 'film', accepts: ['video'],
      desc: '用本机的 RIFE 做顺滑的慢动作，或者提高帧率'},
    {id: 'match-color', op: 'match-color', name: '统一色调', verb: '统一色调', ic: 'film', accepts: ['video', 'image'],
      desc: '把几段视频或几张图片的颜色对齐到同一张参考，用本机的 ffmpeg'},
    {id: 'remove-background', op: 'remove-background', name: '去除背景', verb: '去除背景', ic: 'film', accepts: ['video', 'image'],
      desc: '不用绿幕，抠出画面里的主体；视频得到带透明的 MOV，图片得到 PNG'},
    {id: 'separate-audio', op: 'separate', name: '音频分轨', verb: '开始分轨', ic: 'wave', accepts: ['audio', 'video'],
      desc: '把音频或视频的第一条音轨拆成人声与伴奏，也可以再拆出鼓、贝斯与其他'},
  ];
  const opById = (id) => OPS.find((o) => o.id === id) || null;
  const ACCEPT_LABEL = {video: '视频文件', image: '图片', audio: '音频'};
  const acceptText = (o) => o.accepts.map((k) => ACCEPT_LABEL[k]).join('或');
  const MAX_INPUTS = 20;
  /** 输出每边的上限、按帧处理一次任务的帧数上限（30 fps 两小时）：footage.ts 的 MAX_OUTPUT_SIDE、MAX_INPUT_FRAMES */
  const MAX_OUTPUT_SIDE = 7680;
  const MAX_INPUT_FRAMES = 216000;

  /* ---------- 受管工具：第一次用到时在这一页下载，点了才下（product-design §7.6「外部工具」的同意规则） ----------
     Real-ESRGAN 和放大图片是同一份，装好了两边都不用再下。`mb` 只给下载进度用。 */
  const REALESRGAN = 'realesrgan-ncnn-vulkan';
  const RIFE = 'rife-ncnn-vulkan';
  const MATTE = 'matte-models';
  const MATTE_ISNET = 'matte-models-isnet';
  const MANAGED = {
    [REALESRGAN]: {name: 'Real-ESRGAN', version: 'v0.2.5.0', short: '约 50 MB', size: '约 50 MB（含视频、实拍、动画三套权重）', mb: 50, license: 'BSD-3-Clause',
      source: 'github.com/xinntao/Real-ESRGAN/releases', pick: '指定本机的程序…',
      body: '开源的超分辨率程序，在这台电脑的显卡上运行，不联网、不上传视频。和放大图片用的是同一份，装一次两边都能用。'},
    [RIFE]: {name: 'RIFE', version: '20221029', short: '430 MB', size: '下载 430 MB · 解开后约 40 MB', mb: 430, license: 'MIT；用 ncnn 构建（BSD-3-Clause）',
      source: 'github.com/nihui/rife-ncnn-vulkan/releases', pick: '指定本机的程序…', unpack: '只留 rife-v4.6',
      body: '开源的插帧程序，在这台电脑的显卡上运行，不联网、不上传视频。发布包里带着十几个历代模型，所以要下 430 MB；BaoCut 只解开可执行文件与 rife-v4.6 这一个模型，解开后约 40 MB。'},
    [MATTE]: {name: '抠像权重（U²-Net）', version: 'v0.0.0', short: '约 5 MB', size: '约 5 MB（u2netp.onnx）', mb: 5, license: 'Apache-2.0',
      source: 'github.com/danielgatis/rembg/releases', pick: '指定权重所在的文件夹…',
      body: 'rembg 项目发布的权重，只是模型文件，由随 BaoCut 提供的抠像程序在这台电脑的 CPU 上运行，不上传。'},
    [MATTE_ISNET]: {name: '抠像权重（IS-Net）', version: 'v0.0.0', short: '约 180 MB', size: '约 180 MB（isnet-general-use.onnx）', mb: 180, license: '权重没有单独的许可，训练集只许可非商业用途',
      source: 'github.com/danielgatis/rembg/releases', pick: '指定权重所在的文件夹…', nonCommercial: true,
      body: 'rembg 项目发布的权重，只是模型文件，由随 BaoCut 提供的抠像程序在这台电脑的 CPU 上运行，不上传。和默认的权重分开下载，因为许可不同。'},
  };
  /** 这一次要下载的受管工具（去抖、统一色调只用 ffmpeg；分轨用本机模型，走模型下载） */
  function toolsFor(f) {
    const o = opById(f.id);
    if (o.op === 'upscale') return [REALESRGAN];
    if (o.op === 'interpolate') return [RIFE];
    if (o.op === 'remove-background') return [matteModel(f.matteModel).tool];
    return [];
  }

  /* ---------- 每种处理的选项 ---------- */
  const STRENGTHS = [{k: 'low', label: '轻'}, {k: 'medium', label: '中'}, {k: 'high', label: '强'}];
  const SCALES = [2, 3, 4];
  const UPSCALE_MODELS = [
    {k: 'video', name: '视频（快）', sub: '给视频做的轻量模型，原生 2、3、4 倍', weights: 'realesr-animevideov3', native: [2, 3, 4]},
    {k: 'photo', name: '实拍', sub: '慢得多；原生 4 倍', weights: 'realesrgan-x4plus', native: [4]},
    {k: 'anime', name: '动画', sub: '动画与线稿，慢得多；原生 4 倍', weights: 'realesrgan-x4plus-anime', native: [4]},
  ];
  const upscaleModel = (k) => UPSCALE_MODELS.find((m) => m.k === k) || UPSCALE_MODELS[0];
  const FACTORS = [2, 3, 4, 8];
  const MODES = [
    {k: 'slowmo', name: '慢动作', sub: '帧率不变、时长乘倍数；不带声音'},
    {k: 'smooth', name: '提高帧率', sub: '时长不变、帧率乘倍数；声音保留'},
  ];
  const METHODS = [
    {k: 'hm-mkl-hm', name: '标准', sub: '多数情况最好'},
    {k: 'mkl', name: '稳妥', sub: '只对齐均值与协方差，最不容易出色块'},
    {k: 'reinhard', name: '温和', sub: '只对齐均值与方差，改动最小'},
    {k: 'histogram', name: '逐通道', sub: '逐通道对齐分布，容易偏色'},
  ];
  const methodOf = (k) => METHODS.find((m) => m.k === k) || METHODS[0];
  const MATTE_MODELS = [
    {k: 'fast', name: '快', sub: 'U²-Net · 每帧约 0.25 秒 · Apache-2.0', label: 'U²-Net', tool: MATTE, weights: 'u2netp'},
    {k: 'general', name: '更干净', sub: 'IS-Net · 慢约 4 倍 · 另下约 180 MB · 仅限非商用', label: 'IS-Net', tool: MATTE_ISNET, weights: 'isnet-general-use', nonCommercial: true},
  ];
  const matteModel = (k) => MATTE_MODELS.find((m) => m.k === k) || MATTE_MODELS[0];
  const LICENSE_NOTE = 'IS-Net 的权重只能用于非商业的研究与教育：代码是 Apache-2.0，但权重没有单独的许可，训练集 DIS5K 的条款只许可非商业用途。要商用先问作者，或者换回「快」。';
  const RESULT_LICENSE_NOTE = '这个结果用 IS-Net 的权重做出来：只能用于非商业的研究与教育。';
  const STEMS = [
    {k: 'vocals', name: '人声与伴奏', sub: '两个 WAV：-vocals、-background', tracks: ['vocals', 'background']},
    {k: 'four', name: '再拆出鼓、贝斯与其他', sub: '五个 WAV：另加 -drums、-bass、-other；只有 HTDemucs 系的模型能拆', tracks: ['vocals', 'background', 'drums', 'bass', 'other']},
  ];
  const stemsOf = (k) => STEMS.find((s) => s.k === k) || STEMS[0];

  /* 分离模型：设置页模型表里 cat === 'sep' 的那几只（本机模型，走模型下载）；只有 HTDemucs 系能拆四轨（separator.fourStems） */
  const canFourStems = (m) => /demucs/i.test(String((m && (m.id || m.label)) || ''));
  function sepModels(catalog, installed, extra) {
    return (catalog || []).filter((m) => m.cat === 'sep').map((m) => ({id: m.id, label: m.name, local: true, ok: !!(installed && installed(m.id)), size: m.size}))
      .concat(extra || []);
  }

  /* ---------- 表单 ---------- */
  /** 缺省值照协议的注释；`ranged`、`start`、`end` 是「只处理一段」 */
  function blank(id) {
    return {id, ranged: false, start: 0, end: 10, strength: 'medium', scale: 2, model: 'video', factor: 2, mode: 'slowmo',
      reference: null, referenceAt: null, method: 'hm-mkl-hm', amount: 1, matteModel: 'fast', temporal: 0.3, stems: 'vocals', sepModel: null};
  }

  /* ---------- 文字 ---------- */
  const count = (n) => Math.round(n).toLocaleString('en-US');
  function timecode(sec) {
    const s = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    const pad = (v) => String(v).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`;
  }
  /* 与 Space 条目的规格行同一种算法（1024 进位），同一个文件不会一处 52 MB、一处 50 MB */
  function bytesText(b) {
    const mb = b / 1048576;
    if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
    return mb >= 1 ? `${Math.round(mb)} MB` : '不到 1 MB';
  }
  /** 一个区间的说法：「几秒」「不到 1 分钟」「约 5–12 分钟」「约 1.5–4 小时」 */
  function etaText(range) {
    const [lo, hi] = range;
    if (hi < 15) return '几秒';
    if (hi < 60) return '不到 1 分钟';
    if (hi < 3600) {
      const to = Math.max(2, Math.round(hi / 60));
      return lo < 30 ? `不到 ${to} 分钟` : `约 ${Math.round(lo / 60)}–${to} 分钟`;
    }
    const hours = (v) => (v < 10 ? Math.round(v * 2) / 2 : Math.round(v));
    return `约 ${hours(Math.max(0.5, lo / 3600))}–${hours(hi / 3600)} 小时`;
  }
  /** 单个时长（任务进行中）：「还要约 18 分钟」 */
  function remainText(sec) {
    if (sec < 60) return '不到 1 分钟';
    if (sec < 3600) return `约 ${Math.round(sec / 60)} 分钟`;
    return `约 ${(sec / 3600).toFixed(1)} 小时`;
  }

  /* ---------- 一个输入的计划 ---------- */
  const even = (n) => Math.round(n / 2) * 2;
  /** 这个输入处理哪一段（秒）；图片、音频与「整段」都是全部。结束晚于文件时截到文件末尾。 */
  function rangeOf(f, src) {
    const total = src.seconds || 0;
    if (!f.ranged || src.kind !== 'video') return {start: 0, end: total, seconds: total};
    const start = Math.max(0, Number(f.start) || 0);
    const end = Math.min(Number(f.end) || 0, total);
    return {start, end, seconds: Math.max(0, end - start)};
  }
  /** 帧数、输出尺寸与时长；与 footage.ts 的 InputPlan 同一套算法：插帧整段输出 (帧数 − 1) × 倍数 + 1 张 */
  function planOf(f, src) {
    const o = opById(f.id);
    if (src.kind === 'audio' || o.op === 'separate') return {kind: src.kind, audioOnly: true, frames: 0, outFrames: 0, seconds: src.seconds || 0, outSeconds: src.seconds || 0};
    if (src.kind === 'image') return {kind: 'image', frames: 1, outFrames: 1, seconds: null, outSeconds: null, outWidth: src.width, outHeight: src.height, outFps: null};
    const r = rangeOf(f, src);
    const fps = src.fps || 30;
    const frames = Math.max(1, Math.round(r.seconds * fps));
    const scale = o.op === 'upscale' ? f.scale : 1;
    const outWidth = even(src.width * scale), outHeight = even(src.height * scale);
    if (o.op !== 'interpolate') return {kind: 'video', frames, outFrames: frames, seconds: r.seconds, outSeconds: r.seconds, outWidth, outHeight, outFps: fps, fps};
    const outFrames = (frames - 1) * f.factor + 1;
    const outFps = f.mode === 'smooth' ? fps * f.factor : fps;
    return {kind: 'video', frames, outFrames, seconds: r.seconds, outSeconds: outFrames / outFps, outWidth, outHeight, outFps, fps};
  }
  /** 超分的权重没有这个原生倍数时：先放大到 4 倍，再由编码端缩到目标尺寸 */
  const upscaleNote = (f) => (upscaleModel(f.model).native.indexOf(f.scale) >= 0 ? '模型原生就是这个倍数。'
    : `这套权重原生是 4 倍：先放大 4 倍，再缩到 ${f.scale} 倍。`);

  /* ---------- 工作量 ----------
     下界是 M5 Max 上跑真实流程量的（2026-11，抠像用 release 构建）。那是一台很快的电脑，上界按别的电脑慢多少放宽：走显卡的（超分、插帧）放宽 4 倍以上，
     只在 CPU 上的（抠像、去抖、统一色调）放宽约 2.5 倍。vid.stab 没量过（那台电脑的 ffmpeg 不带 libvidstab），仍是估的。
     界面都写明是粗算；按帧处理的任务开始后按实际速度更新。 */
  const RATE = {
    /* 秒 / 帧 / 百万像素 */
    stabilize: {vidstab: [0.012, 0.03], deshake: [0.008, 0.025]},
    upscale: {video: [0.1, 0.6], photo: [3.5, 14], anime: [1.1, 4.5]},
    interpolate: [0.02, 0.15],
    color: [0.004, 0.012],
    /* 秒 / 帧 */
    matte: {fast: [0.25, 0.7], general: [1.1, 2.8]},
    /* 处理时长 / 素材时长。HTDemucs-FT 是 M5 Max 上量的，别的是 model-audiocpp.js 记的 M4 实测（80 秒样本）。实测的是下限，老一些的机器按 2.5 倍算 */
    separate: {'htdemucs-ft': 0.65, htdemucs: 0.21, mel: 0.9},
  };
  function separateRate(modelId) {
    const id = String(modelId || 'htdemucs-ft');
    const base = /mel/i.test(id) ? RATE.separate.mel : /htdemucs-ft/i.test(id) ? RATE.separate['htdemucs-ft'] : /demucs/i.test(id) ? RATE.separate.htdemucs : RATE.separate['htdemucs-ft'];
    return [base, base * 2.5];
  }
  /** 一个输入要多少秒 [少, 多]；`vidstab` 是这台电脑的 ffmpeg 带不带 libvidstab */
  function secondsOf(f, plan, ctx) {
    const o = opById(f.id);
    if (o.op === 'separate') { const [a, b] = separateRate(f.sepModel); return [plan.seconds * a, plan.seconds * b]; }
    if (plan.kind === 'image') return o.op === 'remove-background' ? RATE.matte[f.matteModel] : [1, 2];
    const mp = (plan.outWidth * plan.outHeight) / 1e6;
    const sourceMp = mp / (o.op === 'upscale' ? f.scale * f.scale : 1);
    const by = (rate, frames, pixels) => rate.map((r) => r * frames * pixels);
    if (o.op === 'stabilize') return by(RATE.stabilize[ctx && ctx.vidstab === false ? 'deshake' : 'vidstab'], plan.frames, sourceMp);
    if (o.op === 'upscale') return by(RATE.upscale[f.model], plan.frames, sourceMp);
    if (o.op === 'interpolate') return by(RATE.interpolate, plan.outFrames, sourceMp);
    if (o.op === 'match-color') return by(RATE.color, plan.frames, sourceMp);
    return RATE.matte[f.matteModel].map((r) => r * plan.frames);
  }
  /* 临时空间照 resource-profiles.ts 的 footageDemand；输出体积是粗估：H.264 约每像素 0.01 字节，ProRes 4444 约每像素 0.6 字节，WAV 按 44.1 kHz 立体声 */
  const STAGING_SLACK = 64 * 1024 * 1024;
  function scratchOf(f, plan, inputBytes) {
    const o = opById(f.id);
    if (o.op === 'separate') return Math.round(inputBytes * 2 + STAGING_SLACK);
    if (plan.kind === 'image') return STAGING_SLACK;
    const pixels = plan.outWidth * plan.outHeight;
    if (o.op === 'stabilize' || o.op === 'match-color') return Math.round(inputBytes * 2 + STAGING_SLACK);
    if (o.op === 'remove-background') return Math.round(plan.frames * pixels * 0.6 + STAGING_SLACK);
    return Math.round(pixels * 4 * (o.op === 'interpolate' ? 200 : 48) + inputBytes * 8 + STAGING_SLACK);
  }
  function outBytesOf(f, plan, src) {
    const o = opById(f.id);
    if (o.op === 'separate') return Math.round(plan.seconds * 176400) * stemsOf(f.stems).tracks.length;
    if (plan.kind === 'image') return Math.round(plan.outWidth * plan.outHeight * 1.6);
    const pixels = plan.outWidth * plan.outHeight;
    if (o.op === 'remove-background') return Math.round(plan.frames * pixels * 0.6);
    if (o.op === 'upscale' || o.op === 'interpolate') return Math.round(plan.outFrames * pixels * 0.01);
    const whole = src.seconds ? plan.seconds / src.seconds : 1;
    return Math.round((src.bytes || plan.frames * pixels * 0.01) * whole);
  }
  /** 长到要提醒的线：十分钟起提醒「只处理用到的一段」，一小时起再加重 */
  const LONG_SEC = 600;
  const VERY_LONG_SEC = 3600;
  /** 这一次的工作量。`level`：ok / long / veryLong，看的是偏慢那一端 */
  function workload(f, srcs, ctx) {
    const plans = srcs.map((s) => planOf(f, s));
    const sum = (fn) => plans.reduce((n, p, i) => n + fn(p, srcs[i]), 0);
    const lo = plans.reduce((n, p) => n + secondsOf(f, p, ctx)[0], 0);
    const hi = plans.reduce((n, p) => n + secondsOf(f, p, ctx)[1], 0);
    return {plans, frames: sum((p) => p.frames), outFrames: sum((p) => p.outFrames), seconds: [lo, hi], outSeconds: sum((p) => p.outSeconds || 0),
      audioSeconds: sum((p) => (p.audioOnly ? p.seconds : 0)), scratch: sum((p, s) => scratchOf(f, p, s.bytes || 0)), outBytes: sum((p, s) => outBytesOf(f, p, s)),
      level: hi >= VERY_LONG_SEC ? 'veryLong' : hi >= LONG_SEC ? 'long' : 'ok', hasVideo: plans.some((p) => p.kind === 'video' && !p.audioOnly)};
  }
  /** 输入一行：「00:42 · 1920×1080 · 30 fps · 1,260 帧」；图片、音频与 HDR 各说各的 */
  function sourceLine(f, src) {
    const o = opById(f.id);
    if (src.kind === 'image') return `图片 · ${src.width}×${src.height}${src.entry ? ' · Space' : ''}`;
    if (src.kind === 'audio' || o.op === 'separate') return `${timecode(src.seconds)}${src.hasAudio === false ? ' · 没有音轨' : ''}${src.entry ? ' · Space' : ''}`;
    const p = planOf(f, src);
    const bits = [timecode(src.seconds), `${src.width}×${src.height}`, `${src.fps || 30} fps`];
    if (src.hdr) bits.push('HDR');
    bits.push(f.ranged ? `这一段 ${count(p.frames)} 帧` : `${count(p.frames)} 帧`);
    if (src.entry) bits.push('Space');
    return bits.join(' · ');
  }

  /* ---------- 开始前的检查（说法照 footage.zh-Hans.ts） ----------
     分两种：`blockers` 是输入或选项本身过不去（HDR、超上限），一选中就标出来；`nextSteps` 是还差一步（选文件、选参考、下载），按了开始才标。 */
  /** `ctx.sep`：分轨的模型列表 */
  function blockers(f, srcs, ctx) {
    const o = opById(f.id);
    const out = [];
    if (srcs.length > MAX_INPUTS) out.push(`一次最多 ${MAX_INPUTS} 个，移出 ${srcs.length - MAX_INPUTS} 个`);
    const hdr = srcs.find((s) => s.hdr);
    if (hdr && o.op !== 'separate') out.push(`${hdr.name} 是 HDR。这些工具按 SDR 处理，请先转成 SDR。`);
    if (o.op === 'separate') {
      const silent = srcs.find((s) => s.hasAudio === false);
      if (silent) out.push(`${silent.name} 没有音轨`);
      const cur = ((ctx && ctx.sep) || []).find((m) => m.id === f.sepModel);
      if (f.stems === 'four' && cur && cur.ok && !canFourStems(cur)) out.push(`${cur.label} 只能把人声和其余部分分开；要鼓、贝斯与其他请选 HTDemucs 模型`);
      return out;
    }
    if (f.ranged && srcs.length) {
      const image = srcs.find((s) => s.kind === 'image');
      if (image) out.push(`${image.name} 是图片，不能只处理一段：移出图片，或者改回整段`);
      if ((Number(f.end) || 0) <= (Number(f.start) || 0)) out.push('结束要晚于开始');
      else {
        const short = srcs.find((s) => s.kind === 'video' && rangeOf(f, s).seconds <= 0);
        if (short) out.push(`这一段是空的：${short.name} 长 ${(short.seconds || 0).toFixed(1)} 秒`);
      }
    }
    srcs.filter((s) => s.kind === 'video').forEach((s) => {
      const p = planOf(f, s);
      if (o.op === 'upscale' && (p.outWidth > MAX_OUTPUT_SIDE || p.outHeight > MAX_OUTPUT_SIDE)) {
        out.push(`${s.name} 放大后是 ${p.outWidth}×${p.outHeight}，每边至多 ${MAX_OUTPUT_SIDE} 像素。请选小一点的倍数。`);
      }
      if (o.op === 'interpolate' && p.frames < 2) out.push(`${s.name} 至少要有两帧才能插帧`);
      if ((o.op === 'upscale' || o.op === 'interpolate' || o.op === 'remove-background') && p.frames > MAX_INPUT_FRAMES) {
        out.push(`${s.name} 约有 ${count(p.frames)} 帧，一次至多处理 ${count(MAX_INPUT_FRAMES)} 帧。请选短一点的一段。`);
      }
    });
    return out;
  }
  /** `ctx.tools`：受管工具的现状；`ctx.sep`：分轨的模型列表 */
  function nextSteps(f, srcs, ctx) {
    const o = opById(f.id);
    const out = [];
    if (!srcs.length) out.push(`先选一个${acceptText(o)}（一次最多 ${MAX_INPUTS} 个）`);
    if (o.op === 'separate') {
      const list = (ctx && ctx.sep) || [];
      const cur = list.find((m) => m.id === f.sepModel) || null;
      if (!list.some((m) => m.ok)) out.push('还没有可用的分离模型，先下载一只');
      else if (!cur || !cur.ok) out.push(cur ? `${cur.label} 还没安装` : '先选一只分离模型');
      return out;
    }
    if (o.op === 'match-color' && !f.reference) out.push('先选一张参考：图片或视频都可以');
    const missing = ctx && ctx.tools ? toolsFor(f).find((t) => ctx.tools[t] !== 'ready') : null;
    if (missing) out.push(`第一次用前要下载 ${MANAGED[missing].name} · ${MANAGED[missing].short}`);
    return out;
  }
  /** 第一条就是导航栏上的那句 */
  const problems = (f, srcs, ctx) => blockers(f, srcs, ctx).concat(nextSteps(f, srcs, ctx));
  /** 导航栏上的状态行：问题优先，否则说这一次多少帧、要多久 */
  function statusLine(f, srcs, ctx, tried) {
    const hard = blockers(f, srcs, ctx);
    if (hard.length) return {bad: true, text: hard[0]};
    const steps = nextSteps(f, srcs, ctx);
    if (steps.length) return {bad: !!srcs.length && !!tried, text: steps[0]};
    const w = workload(f, srcs, ctx);
    const head = opById(f.id).op === 'separate' ? `${srcs.length} 个文件 · ${timecode(w.audioSeconds)}` : w.hasVideo ? `${count(w.frames)} 帧` : `${srcs.length} 张图片`;
    return {bad: false, text: `${head} · ${etaText(w.seconds)}`};
  }

  /* ---------- 输出 ---------- */
  const stemOf = (name) => String(name || 'file').replace(/\.[^.]+$/, '');
  const SUFFIX = {
    stabilize: () => ({suffix: 'stabilized', ext: '.mp4'}),
    upscale: (f) => ({suffix: `upscaled-${f.scale}x`, ext: '.mp4'}),
    interpolate: (f) => ({suffix: `${f.mode}-${f.factor}x`, ext: '.mp4'}),
    'match-color': (f, src) => ({suffix: 'color-matched', ext: src.kind === 'image' ? '.png' : '.mp4'}),
    'remove-background': (f, src) => ({suffix: 'cutout', ext: src.kind === 'image' ? '.png' : '.mov'}),
  };
  function uniqueName(base, ext, used) {
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name); n += 1) name = `${base}-${n}${ext}`;
    used.add(name);
    return name;
  }
  /** 一次运行写出的文件：`<原名>-<处理>`，分轨是每轨一个 WAV；重名时加序号，不覆盖 */
  function outputsOf(f, srcs, taken) {
    const o = opById(f.id);
    const used = new Set(taken || []);
    const list = [];
    srcs.forEach((src) => {
      const plan = planOf(f, src);
      if (o.op === 'separate') {
        const tracks = stemsOf(f.stems).tracks;
        tracks.forEach((t) => list.push({kind: 'audio', name: uniqueName(`${stemOf(src.name)}-${t}`, '.wav', used), source: src, stem: t, seconds: plan.seconds,
          bytes: Math.round(outBytesOf(f, plan, src) / tracks.length)}));
        return;
      }
      const s = SUFFIX[o.op](f, src);
      list.push({kind: s.ext === '.png' ? 'image' : 'final', name: uniqueName(`${stemOf(src.name)}-${s.suffix}`, s.ext, used), source: src, seconds: plan.outSeconds,
        width: plan.outWidth, height: plan.outHeight, bytes: outBytesOf(f, plan, src)});
    });
    return list;
  }
  /** 保存位置那一行的说明 */
  function saveNote(f) {
    const o = opById(f.id);
    if (o.op === 'separate') return '每轨是保存位置里的一个 WAV、Space 里的一个音频条目；原文件不动，重名时加序号。';
    const s = o.op === 'match-color' || o.op === 'remove-background' ? SUFFIX[o.op](f, {kind: 'video'}) : SUFFIX[o.op](f);
    const image = o.accepts.indexOf('image') >= 0 ? `（图片是 ${o.op === 'remove-background' ? '带透明的 ' : ''}PNG）` : '';
    return `结果是保存位置里的 <原名>-${s.suffix}${s.ext}${image}，也是 Space 里的条目；原文件不动，重名时加序号。`;
  }

  /* ---------- 结果 ---------- */
  /** 执行者：引擎、工具与版本、权重或方法（FootageSummary.executor） */
  function executorOf(f, ctx) {
    const o = opById(f.id);
    if (o.op === 'stabilize') return ctx && ctx.vidstab === false ? 'deshake · ffmpeg' : 'vid.stab · ffmpeg';
    if (o.op === 'upscale') return `Real-ESRGAN ${MANAGED[REALESRGAN].version} · ${upscaleModel(f.model).weights}`;
    if (o.op === 'interpolate') return `RIFE ${MANAGED[RIFE].version} · rife-v4.6`;
    if (o.op === 'match-color') return `3D LUT · ${f.method}`;
    if (o.op === 'remove-background') return `${matteModel(f.matteModel).label} · ${matteModel(f.matteModel).weights}`;
    return (ctx && ctx.sepLabel) || 'HTDemucs-FT';
  }
  const DESHAKE_BEFORE = '这个 ffmpeg 没有 vid.stab（libvidstab），会用自带的 deshake，只修小幅的平移抖动。要更强的去抖，请用带 libvidstab 的 ffmpeg（例如 Homebrew 的 ffmpeg-full），并把 BAOCUT_FFMPEG 指向它。';
  const DESHAKE_AFTER = '这个 ffmpeg 没有 vid.stab（libvidstab），用的是自带的 deshake，只修小幅的平移抖动。要更强的去抖，请用带 libvidstab 的 ffmpeg（例如 Homebrew 的 ffmpeg-full），并把 BAOCUT_FFMPEG 指向它。';
  /** 结果里的提醒（FootageSummary.warnings，footage.ts 第 480 行起）；`noSubject`：没认出主体的文件名 */
  function warningsOf(f, ctx, noSubject) {
    const o = opById(f.id);
    const out = [];
    if (o.op === 'stabilize' && ctx && ctx.vidstab === false) out.push(DESHAKE_AFTER);
    if (o.op === 'interpolate') out.push('跨硬切的两帧会被插出重影：请先按镜头切开再插帧。');
    if (o.op === 'interpolate' && f.mode === 'slowmo') out.push('慢动作不带声音：需要声音时在时间线上另外放。');
    if (o.op === 'remove-background' && f.matteModel === 'general') out.push(RESULT_LICENSE_NOTE);
    (noSubject || []).forEach((name) => out.push(`${name} 里几乎没有认出主体，请检查结果`));
    return out;
  }
  /** 任务卡上的一行说明 */
  function jobMeta(r) {
    const f = r.form;
    const o = opById(f.id);
    const size = r.outs && r.outs[0] && r.outs[0].width ? `${r.outs[0].width}×${r.outs[0].height}` : null;
    if (o.op === 'stabilize') return `强度${(STRENGTHS.find((s) => s.k === f.strength) || STRENGTHS[1]).label}`;
    if (o.op === 'upscale') return [`${f.scale}×`, upscaleModel(f.model).name, size].filter(Boolean).join(' · ');
    if (o.op === 'interpolate') return `${(MODES.find((m) => m.k === f.mode) || MODES[0]).name} · ${f.factor}×`;
    if (o.op === 'match-color') return `${methodOf(f.method).name} · ${Math.round(f.amount * 100)}% · 参考 ${f.reference ? f.reference.name : '—'}`;
    if (o.op === 'remove-background') return matteModel(f.matteModel).name;
    return stemsOf(f.stems).name;
  }
  /** 进度的步骤（footage.ts 的读取 → 处理 → 校验 → 发布，分轨是读取 → 分离 → 发布）；`pct` 落到哪一步 */
  function phaseOf(id, pct) {
    if (opById(id).op === 'separate') return pct < 5 ? '读取输入' : pct < 95 ? '分离' : '发布';
    return pct < 5 ? '读取输入' : pct < 90 ? '处理' : pct < 97 ? '校验输出' : '发布';
  }
  /** 失败的说法与错误码（流程的 error.code）；演示挡位「下一条失败」用 */
  function failOf(f, name) {
    const o = opById(f.id);
    if (o.op === 'upscale') return {title: `Real-ESRGAN 处理不了 ${name}`, line: '显卡内存不够：换小一点的倍数，或者只处理一段再试。', code: 'FOOTAGE_TOOL_FAILED', evidence: 'vkAllocateMemory failed -2'};
    if (o.op === 'interpolate') return {title: `RIFE 处理不了 ${name}`, line: '显卡内存不够：4K 素材先转成小一点的尺寸，或者只处理一段再试。', code: 'FOOTAGE_TOOL_FAILED', evidence: 'vkAllocateMemory failed -2'};
    if (o.op === 'remove-background') return {title: `抠像没能处理 ${name}`, line: '一帧处理超时：这台电脑可能太忙。稍后再试，或者换回「快」。', code: 'FOOTAGE_TOOL_FAILED', evidence: 'matte frame timed out after 120 s'};
    if (o.op === 'separate') return {title: `分离模型没能处理 ${name}`, line: '内存不够：关掉别的程序再试，或者换一只轻一些的模型。', code: 'MODEL_OUTPUT_INVALID', evidence: 'worker exited with code 137'};
    return {title: `${name} 的输出没有通过校验`, line: '写出的文件和预期的时长对不上。再试一次；还是这样就先转成常见的 H.264 MP4。', code: 'FOOTAGE_VERIFY_FAILED', evidence: 'duration mismatch'};
  }

  /* ---------- 工具目录卡片的现状行 ---------- */
  function toolStatus(id, ctx) {
    const o = opById(id);
    const c = ctx || {};
    if (o.op === 'separate') {
      const ok = (c.sep || []).filter((m) => m.ok);
      return ok.length ? {text: `${ok[0].label} 已装好`, on: true} : {text: '第一次使用前要下载分离模型', on: false};
    }
    if (o.op === 'stabilize' || o.op === 'match-color') return {text: '用本机的 ffmpeg，不用下载', on: true};
    if (o.op === 'remove-background') {
      return (c.tools || {})[MATTE] === 'ready' ? {text: '默认权重已装好', on: true} : {text: `第一次使用前要下载权重（${MANAGED[MATTE].short}）`, on: false};
    }
    const name = o.op === 'upscale' ? REALESRGAN : RIFE;
    return (c.tools || {})[name] === 'ready' ? {text: `${MANAGED[name].name} 已就绪 · ${MANAGED[name].version}`, on: true}
      : {text: `第一次使用前要下载 ${MANAGED[name].name}（${MANAGED[name].short}）`, on: false};
  }

  /* ---------- 来源 ---------- */
  /** Space 条目 → 输入的描述。帧率与 HDR 交互原型读不到，按 30 fps、SDR 记（真实页面走 ffprobe） */
  function fromEntry(entry) {
    const res = String(entry.res || '').split(/[×x]/).map(Number);
    const kind = entry.kind === 'image' ? 'image' : entry.kind === 'audio' ? 'audio' : 'video';
    return {kind, name: entry.name, path: entry.file || entry.name, bytes: entry.bytes || 0, seconds: entry.dur || 0, width: res[0] || 1920, height: res[1] || 1080,
      fps: entry.fps || 30, hasAudio: entry.hasAudio !== false, entry: entry.id};
  }
  /* 演示素材：走得到长素材、上限、HDR、没有音轨这些分支，不用真找一个文件。名字不用真实品牌 */
  const SAMPLES = [
    {k: 'walk', label: '手持短片 · 42 秒', src: {kind: 'video', name: '手持街拍.mp4', seconds: 42, width: 1920, height: 1080, fps: 30, bytes: 88000000, hasAudio: true}},
    {k: 'cuts', label: '多镜头 · 3 分钟', src: {kind: 'video', name: '旅行混剪.mp4', seconds: 186, width: 1920, height: 1080, fps: 24, bytes: 410000000, hasAudio: true}},
    {k: 'long', label: '长素材 · 52 分钟', src: {kind: 'video', name: '访谈全片.mov', seconds: 3120, width: 1920, height: 1080, fps: 25, bytes: 9200000000, hasAudio: true}},
    {k: 'over', label: '超过帧数上限 · 2.5 小时', src: {kind: 'video', name: '直播回放.mkv', seconds: 9000, width: 1280, height: 720, fps: 30, bytes: 7400000000, hasAudio: true}},
    {k: 'uhd', label: '4K · 95 秒', src: {kind: 'video', name: '航拍 4K.mp4', seconds: 95, width: 3840, height: 2160, fps: 60, bytes: 1800000000, hasAudio: false}},
    {k: 'hdr', label: 'HDR', src: {kind: 'video', name: '夜景 HDR.mov', seconds: 30, width: 3840, height: 2160, fps: 30, bytes: 900000000, hdr: true, hasAudio: true}},
    {k: 'still', label: '图片', src: {kind: 'image', name: '产品图.png', width: 2048, height: 2048, bytes: 3400000}},
    {k: 'song', label: '歌曲', src: {kind: 'audio', name: '片头曲.mp3', seconds: 214, bytes: 5100000, hasAudio: true}},
    {k: 'mute', label: '没有音轨', src: {kind: 'video', name: '无声空镜.mp4', seconds: 20, width: 1920, height: 1080, fps: 30, bytes: 42000000, hasAudio: false}},
  ];
  const samplesFor = (id) => SAMPLES.filter((s) => {
    const o = opById(id);
    if (s.k === 'mute') return o.op === 'separate';
    if (s.k === 'hdr') return o.op !== 'separate';
    return o.accepts.indexOf(s.src.kind) >= 0;
  });

  const api = {OPS, opById, acceptText, MAX_INPUTS, MAX_OUTPUT_SIDE, MAX_INPUT_FRAMES, REALESRGAN, RIFE, MATTE, MATTE_ISNET, MANAGED, toolsFor,
    STRENGTHS, SCALES, UPSCALE_MODELS, upscaleModel, FACTORS, MODES, METHODS, methodOf, MATTE_MODELS, matteModel, LICENSE_NOTE, RESULT_LICENSE_NOTE, STEMS, stemsOf, canFourStems, sepModels,
    blank, count, timecode, bytesText, etaText, remainText, rangeOf, planOf, upscaleNote, secondsOf, LONG_SEC, VERY_LONG_SEC, workload, sourceLine, blockers, nextSteps, problems, statusLine,
    outputsOf, saveNote, executorOf, DESHAKE_BEFORE, DESHAKE_AFTER, warningsOf, jobMeta, phaseOf, failOf, toolStatus, fromEntry, SAMPLES, samplesFor};
  root.BC_FOOTAGE = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
