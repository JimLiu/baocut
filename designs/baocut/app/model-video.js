/* 工具 › 压缩视频 / 合并视频 的纯模型 —— §17.5（2026-09-16）。
   这里算的是「按下按钮之前就该看见的东西」：这份 ffmpeg 行不行、要不要装 / 升，
   压完大概多大、几段能不能不重编码就接起来、整条命令长什么样、失败了是谁的问题、
   一键修法有哪几个。所有数字与分支和 core 的 `bcut-videotool` 同源（同一套系数、
   同一组枚举、同一串参数），原型不另编一套说法。
   Rust 侧：`core/crates/bcut-videotool/src/{ffmpeg,compress,merge,diagnose,setup}.rs`。 */
(function () {
  /* ---------- 共用系数（与 compress.rs 的常量一一对应） ---------- */
  const CONTAINER_OVERHEAD = 0.02;   // mp4 的 moov 与每帧头
  const SIZE_HEADROOM = 0.97;        // 按体积压时往下留的余量
  const MIN_VIDEO_KBPS = 80;         // 码率地板，再低画面不能看
  const SOURCE_SLACK = 1.15;         // 合并重编码时源侧上界的余量（见 merge.rs）
  const AUDIO_KBPS = 128;
  const MP4_SAFE_AUDIO = ['aac', 'mp3', 'alac'];
  /** ffmpeg 大版本下限：4 以下没有我们要的 `-progress` 与 VideoToolbox 行为 */
  const MIN_MAJOR = 4;

  const num = (v) => (Number.isFinite(v) ? v : 0);
  const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
  /** 去掉多余的零：30 / 29.97 */
  function trimNumber(v) {
    if (!Number.isFinite(v)) return '';
    const s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  /** 字节 → 人看的体积（1024 进制，与 ffmpeg / 资源管理器一致） */
  function humanBytes(bytes) {
    const v = num(bytes);
    if (v >= 1024 ** 3) return (v / 1024 ** 3).toFixed(1) + ' GB';
    if (v >= 1024 ** 2) return (v / 1024 ** 2).toFixed(1) + ' MB';
    if (v >= 1024) return Math.round(v / 1024) + ' KB';
    return Math.round(v) + ' B';
  }
  /** 秒 → `00:23` / `1:02:03` */
  function humanDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const t = Math.round(seconds);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
  /** 省了多少；源本来就更小时 null */
  function savedPercent(before, after) {
    return before > 0 && after < before ? Math.round(((before - after) / before) * 100) : null;
  }
  /** `1920×1080` */
  const fmtRes = (w, h) => `${w}×${h}`;
  /** 源信息一行：`00:42 · 1920×1080 · 30 fps · 68.4 MB · AAC 立体声` */
  function sourceLine(src) {
    if (!src) return '';
    const bits = [humanDuration(src.seconds), fmtRes(src.width, src.height)];
    if (src.fps) bits.push(`${trimNumber(src.fps)} fps`);
    bits.push(humanBytes(src.bytes));
    bits.push(src.hasAudio ? `${(src.audioCodec || '音轨').toUpperCase()} 音轨` : '没有音轨');
    return bits.join(' · ');
  }
  /** 输出文件名：同一个后缀不叠第二层，扩展名固定 mp4 */
  function outputName(source, suffix) {
    const base = String(source || 'video').replace(/\.[^./]+$/, '');
    const tail = '-' + suffix;
    return (base.endsWith(tail) ? base : base + tail) + '.mp4';
  }
  /** 不覆盖已有产出的名字：`clip-compressed.mp4` 占了就 `clip-compressed-2.mp4`。
   *  队列里已经有的名字也算占了——两条记录顶着同一个名字，收据就在说谎。 */
  function uniqueName(name, taken) {
    const used = new Set(taken || []);
    if (!used.has(name)) return name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; i <= 200; i += 1) {
      const next = `${stem}-${i}${ext}`;
      if (!used.has(next)) return next;
    }
    return name;
  }
  /** 参数里有空格或 shell 元字符就加引号，好让用户直接粘进终端复跑 */
  function quote(v) {
    const s = String(v);
    return s.length && /^[A-Za-z0-9._\-/=:+,@]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  }
  /** 参数数组 → 能原样复跑的一整行 */
  const commandLine = (program, args) => [program].concat(args || []).map(quote).join(' ');

  /* ---------- ffmpeg：检测 / 安装 / 升级 ---------- */
  /* 三条政策（与 setup.rs 的模块注释同源）：
     1. 不自带 ffmpeg 二进制——它是系统级共享工具，用户可能已经有一份，
        我们再塞一份只会让「我的 ffmpeg 在哪」变成两个答案；
     2. 不替用户装包管理器（不跑 `curl | bash`），只给一条能复制的命令与官网链接；
     3. 只升级能证明是包管理器装的那一份，别人编译进 /usr/local 的不碰。 */
  const WINGET_ID = 'Gyan.FFmpeg';
  /** 一条能复制的安装 / 升级命令 */
  function installCommand(installer, upgrade) {
    if (installer === 'brew') return `brew ${upgrade ? 'upgrade' : 'install'} ffmpeg`;
    if (installer === 'winget') return `winget ${upgrade ? 'upgrade' : 'install'} --id ${WINGET_ID} -e`;
    return null;
  }
  /** 一个包管理器都没有时的兜底：给命令（能装包管理器的那条）与官网 */
  function manualInstall(platform) {
    return platform === 'win'
      ? {command: `winget install --id ${WINGET_ID} -e`, url: 'https://ffmpeg.org/download.html'}
      : {command: '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
        url: 'https://ffmpeg.org/download.html'};
  }

  /* `env` 是 App 侧探测结果的原型投影：
     {found, version, major, path, manager:'brew'|'winget'|'foreign', installer:'brew'|'winget'|null,
      updateAvailable, checking, installing, pct} */
  const MANAGER_NAMES = {brew: 'Homebrew', winget: 'winget', foreign: '手工安装的'};
  /** ffmpeg 卡的状态：stage 决定卡片形态与主按钮 */
  function ffmpegState(env) {
    const e = env || {};
    if (e.installing) {
      return {stage: 'installing', tone: 'accent', title: e.upgrading ? '正在升级 ffmpeg' : '正在安装 ffmpeg',
        line: `${installCommand(e.installer, !!e.upgrading)} · 第一次装要几分钟`, actions: ['cancel']};
    }
    if (!e.found) {
      const inst = e.installer;
      return {stage: 'missing', tone: 'notice', title: '这两个工具要用 ffmpeg',
        line: inst
          ? `没找到 ffmpeg。可以用 ${MANAGER_NAMES[inst]} 装一份，几分钟就好。`
          : '没找到 ffmpeg，也没找到 Homebrew 或 winget。按下面的说明装好任一个再回来。',
        actions: inst ? ['install', 'manual', 'recheck'] : ['manual', 'recheck']};
    }
    if (num(e.major) < MIN_MAJOR) {
      return {stage: 'old', tone: 'notice', title: `ffmpeg ${e.version} 太旧了`,
        line: `这两个工具要 ffmpeg ${MIN_MAJOR} 或更新的版本${e.installer && e.manager === managerOf(e.installer) ? '，可以直接升' : '；这一份不是包管理器装的，要自己换掉'}。`,
        actions: upgradable(e) ? ['upgrade', 'manual', 'recheck'] : ['manual', 'recheck']};
    }
    if (e.updateAvailable && upgradable(e)) {
      return {stage: 'update', tone: 'default', title: `ffmpeg ${e.version} · 有新版本`,
        line: `${MANAGER_NAMES[e.manager]} 里有更新。旧版本也能用，遇到读不出来的新文件再升。`,
        actions: ['upgrade', 'recheck']};
    }
    return {stage: 'ready', tone: 'positive', title: `ffmpeg ${e.version}`,
      line: `${e.path || 'ffmpeg'} · ${MANAGER_NAMES[e.manager] || '自定义'}`,
      actions: e.installer ? ['checkUpdate', 'recheck'] : ['recheck']};
  }
  const managerOf = (installer) => (installer === 'brew' ? 'brew' : installer === 'winget' ? 'winget' : null);
  /** 能不能替用户升：只升包管理器自己那一份 */
  function upgradable(env) {
    const e = env || {};
    return !!(e.found && e.installer && e.manager === managerOf(e.installer));
  }
  /** 工具目录里压缩 / 合并两张卡共用的状态行 */
  function ffmpegStatus(env) {
    const e = env || {};
    if (!e.found) return {text: '要先装 ffmpeg', on: false};
    if (num(e.major) < MIN_MAJOR) return {text: `ffmpeg ${e.version} 太旧，要升级`, on: false};
    if (e.updateAvailable) return {text: `ffmpeg ${e.version} · 有新版本`, on: true};
    return {text: `ffmpeg ${e.version} 就绪`, on: true};
  }
  /** 能力：这份 ffmpeg 有没有某个编码器。`caps` 是编码器名字数组。 */
  function videoEncoder(caps, codec, accel) {
    const has = (n) => (caps || []).indexOf(n) >= 0;
    if (accel === 'fast') {
      const hw = codec === 'h265'
        ? ['hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_vaapi']
        : ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi'];
      const hit = hw.find(has);
      if (hit) return hit;
    }
    const sw = codec === 'h265' ? 'libx265' : 'libx264';
    return has(sw) ? sw : null;
  }
  const audioEncoder = (caps) => ['libfdk_aac', 'aac_at', 'aac'].find((n) => (caps || []).indexOf(n) >= 0) || null;

  /* ---------- 压缩 ---------- */
  const QUALITIES = [
    {k: 'smaller', name: '更小', sub: '发消息、传网盘够用'},
    {k: 'balanced', name: '均衡', sub: '默认。看不太出差别'},
    {k: 'high', name: '高画质', sub: '留着以后二次剪辑'},
  ];
  const CRF = {smaller: 30, balanced: 26, high: 22};
  const BPP = {smaller: 0.045, balanced: 0.075, high: 0.120};
  /** 这一档在这种编码下的 CRF（H.265 的标度整体高 5） */
  const crfOf = (quality, codec) => CRF[quality] + (codec === 'h265' ? 5 : 0);
  /** 估算用的每像素每帧比特数（H.265 同画质约省四成） */
  const bppOf = (quality, codec) => BPP[quality] * (codec === 'h265' ? 0.6 : 1);

  const RES_CAPS = [
    {k: 'original', name: '原始'}, {k: '1080p', name: '1080p', short: 1080},
    {k: '720p', name: '720p', short: 720}, {k: '480p', name: '480p', short: 480},
  ];
  const FPS_CAPS = [{k: 'original', name: '原始'}, {k: '30', name: '30 fps', limit: 30}, {k: '24', name: '24 fps', limit: 24}];
  const CODECS = [
    {k: 'h264', name: 'H.264', sub: '什么都能播'},
    {k: 'h265', name: 'H.265', sub: '同画质小四成，旧设备可能不认'},
  ];
  const ACCELS = [
    {k: 'quality', name: '画质优先', sub: '用 CPU 编码，慢一些，同体积更清楚'},
    {k: 'fast', name: '更快', sub: '用显卡编码，快好几倍，同体积画质略差'},
  ];
  /* 常见的体积目标。数字不是我们发明的：微信文件 25 MB 上限、邮件附件普遍 25 MB、
     Discord 免费档 10 MB —— 用户心里本来就有这几个数。 */
  const SIZE_PRESETS = [{mb: 10, label: '10 MB'}, {mb: 25, label: '25 MB', sub: '微信 / 邮件附件'}, {mb: 100, label: '100 MB'}];

  const shortSideOf = (k) => (RES_CAPS.find((r) => r.k === k) || {}).short || null;
  const fpsLimitOf = (k) => (FPS_CAPS.find((f) => f.k === k) || {}).limit || null;

  function blankCompress() {
    return {target: 'quality', quality: 'balanced', megabytes: 25,
      codec: 'h264', accel: 'quality', resolution: 'original', fps: 'original', audio: 'keep'};
  }
  /** 缩到上限之后的尺寸：只往下缩、两边取偶（yuv420p 要求） */
  function scaledSize(width, height, cap) {
    const limit = shortSideOf(cap);
    const short = Math.min(width, height);
    if (!limit || !short || short <= limit) return {width: even(width), height: even(height)};
    const factor = limit / short;
    return {width: even(Math.round(width * factor)), height: even(Math.round(height * factor))};
  }
  /** 按体积压时视频该用多少 kbps（音轨一律重编码，分母才确定） */
  function videoKbpsForSize(megabytes, seconds, audio) {
    if (!(seconds > 0) || !(megabytes > 0)) return null;
    const total = megabytes * 1024 * 1024 * 8 * SIZE_HEADROOM * (1 - CONTAINER_OVERHEAD);
    const audioBits = audio === 'remove' ? 0 : AUDIO_KBPS * 1000 * seconds;
    return Math.max(0, (total - audioBits) / seconds / 1000);
  }
  /** 这个时长下做得到的最小体积（MB） */
  function minMegabytes(seconds, audio) {
    const a = audio === 'remove' ? 0 : AUDIO_KBPS;
    return ((MIN_VIDEO_KBPS + a) * 1000 * seconds) / 8 / 1024 / 1024 / SIZE_HEADROOM / (1 - CONTAINER_OVERHEAD);
  }
  /** 「这个时长最小能压到多少」那句话里的数字。
   *  短片算出来不到 1 MB，写成「0.0 MB」像是坏了，统一交给 humanBytes 挑单位。 */
  function minSizeText(seconds, audio) {
    return humanBytes(minMegabytes(seconds, audio) * 1024 * 1024);
  }
  /** 还是超了，再紧一点：用实测比例回算，而不是乘个固定系数 */
  function retighten(previousKbps, achievedBytes, targetMegabytes) {
    const target = targetMegabytes * 1024 * 1024;
    if (!achievedBytes || !(target > 0) || !(previousKbps > 0)) return null;
    const next = previousKbps * (target / achievedBytes) * 0.99;
    return next >= MIN_VIDEO_KBPS && next < previousKbps ? next : null;
  }

  /** 该说给用户听的提醒。不拦流程，只在表单上摆一行。 */
  const WARNINGS = {
    targetAboveSource: '目标比源文件还大，压完可能反而变大',
    alreadySmaller: '源文件已经比目标小了',
    h265Compatibility: 'H.265 小是小，旧设备和部分浏览器不认',
    audioReencoded: (from) => `音轨是 ${String(from).toUpperCase()}，会重新编码成 AAC`,
    accelQualityTradeoff: '显卡编码快得多，同体积画质略差',
    resolutionCapInactive: '分辨率上限比源还高，这一项不起作用',
  };

  /** 压缩规划：一条完整命令 + 预计体积 + 提醒。规划不出来时返回 {error}。 */
  function compressPlan(f, src, caps, input, output, overrideKbps) {
    if (!src || !src.width || !src.height) return {error: {k: 'noVideoTrack'}};
    const encoder = videoEncoder(caps, f.codec, f.accel);
    if (!encoder) {
      return {error: {k: 'codecUnavailable', codec: f.codec, accel: f.accel,
        h264: !!videoEncoder(caps, 'h264', 'quality'), h265: !!videoEncoder(caps, 'h265', 'quality')}};
    }
    const warnings = [];
    const size = scaledSize(src.width, src.height, f.resolution);
    if (shortSideOf(f.resolution) && size.width === even(src.width) && size.height === even(src.height)) {
      warnings.push({k: 'resolutionCapInactive', text: WARNINGS.resolutionCapInactive});
    }
    const srcFps = Number.isFinite(src.fps) && src.fps > 0 ? src.fps : null;
    const limit = fpsLimitOf(f.fps);
    const dropping = srcFps && limit && srcFps > limit + 0.01 ? limit : null;
    const outFps = dropping || srcFps || limit || null;
    if (f.codec === 'h265') warnings.push({k: 'h265Compatibility', text: WARNINGS.h265Compatibility});
    if (f.accel === 'fast') warnings.push({k: 'accelQualityTradeoff', text: WARNINGS.accelQualityTradeoff});

    const bySize = f.target === 'size';
    const safeAudio = src.audioCodec && MP4_SAFE_AUDIO.indexOf(src.audioCodec) >= 0;
    const audioCopy = f.audio === 'keep' && src.hasAudio && !bySize && !!safeAudio;
    let aEnc = null;
    if (f.audio !== 'remove' && src.hasAudio && !audioCopy) {
      aEnc = audioEncoder(caps);
      if (src.audioCodec && (!safeAudio || bySize)) {
        warnings.push({k: 'audioReencoded', text: WARNINGS.audioReencoded(src.audioCodec)});
      }
    }

    const seconds = num(src.seconds);
    let kbps = null, estimated = null;
    if (bySize) {
      if (!(seconds > 0)) return {error: {k: 'durationUnknown'}};
      const floor = minMegabytes(seconds, f.audio);
      if (f.megabytes < floor) return {error: {k: 'targetTooSmall', minMegabytes: floor}};
      kbps = overrideKbps || videoKbpsForSize(f.megabytes, seconds, f.audio);
      if (!kbps || kbps < MIN_VIDEO_KBPS) return {error: {k: 'targetTooSmall', minMegabytes: floor}};
      const targetBytes = f.megabytes * 1024 * 1024;
      if (src.bytes > 0 && targetBytes >= src.bytes) {
        warnings.push(targetBytes > src.bytes
          ? {k: 'targetAboveSource', text: WARNINGS.targetAboveSource}
          : {k: 'alreadySmaller', text: WARNINGS.alreadySmaller});
      }
      estimated = Math.round(targetBytes * SIZE_HEADROOM);
    } else {
      if (f.accel === 'fast') {
        kbps = Math.max(MIN_VIDEO_KBPS, (size.width * size.height * (outFps || 30) * bppOf(f.quality, f.codec)) / 1000);
      }
      estimated = estimateBytes(f, size, outFps || 30, seconds, src.bytes);
    }

    const args = harnessArgs().concat(['-i', input || 'input.mp4']);
    const filters = [];
    if (size.width !== src.width || size.height !== src.height) filters.push(`scale=${size.width}:${size.height}:flags=bicubic`);
    if (dropping) filters.push(`fps=${trimNumber(dropping)}`);
    filters.push('setsar=1', 'format=yuv420p');
    args.push('-vf', filters.join(','), '-c:v', encoder);
    if (kbps) {
      const k = Math.max(MIN_VIDEO_KBPS, Math.round(kbps));
      args.push('-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.45)}k`, '-bufsize', `${k * 2}k`);
    } else {
      args.push('-crf', String(crfOf(f.quality, f.codec)), '-preset', 'medium');
    }
    if (f.codec === 'h265') args.push('-tag:v', 'hvc1');
    if (f.audio === 'remove' || !src.hasAudio) args.push('-an');
    else if (audioCopy || !aEnc) args.push('-c:a', 'copy');
    else args.push('-c:a', aEnc, '-b:a', `${AUDIO_KBPS}k`, '-ac', '2');
    args.push('-map_metadata', '0', '-movflags', '+faststart', output || 'output.mp4');

    return {args, videoEncoder: encoder, audioEncoder: aEnc, width: size.width, height: size.height,
      fps: outFps, estimatedBytes: estimated, videoKbps: kbps, warnings, seconds};
  }
  function estimateBytes(f, size, fps, seconds, sourceBytes) {
    if (!(seconds > 0) || !size.width || !size.height) return null;
    const videoBits = size.width * size.height * fps * bppOf(f.quality, f.codec) * seconds;
    const audioBits = f.audio === 'remove' ? 0 : AUDIO_KBPS * 1000 * seconds;
    const bytes = Math.round(((videoBits + audioBits) / 8) * (1 + CONTAINER_OVERHEAD));
    // 估算不该大于源：摆一个比源还大的数字只会让人不敢按。
    return sourceBytes > 0 ? Math.min(bytes, sourceBytes) : bytes;
  }
  /** 每条命令共用的前缀（见 compress.rs `harness_args`） */
  const harnessArgs = () => ['-hide_banner', '-nostdin', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', '-y'];

  /** 规划失败 → 一句人话 */
  function planErrorText(err) {
    if (!err) return null;
    if (err.k === 'noVideoTrack') return '这个文件里没有画面，换一个视频文件';
    if (err.k === 'durationUnknown') return '读不出时长，按体积压就没有分母；改成按画质压';
    if (err.k === 'targetTooSmall') return `这个时长最小只能压到约 ${humanBytes(err.minMegabytes * 1024 * 1024)}`;
    if (err.k === 'codecUnavailable') {
      const left = [err.h264 && 'H.264', err.h265 && 'H.265'].filter(Boolean);
      const codec = err.codec === 'h265' ? 'H.265' : 'H.264';
      return err.accel === 'fast'
        ? `这台机器没有能用的 ${codec} 显卡编码器，改成「画质优先」`
        : `这份 ffmpeg 不带 ${codec} 编码器${left.length ? `，还能用 ${left.join(' / ')}` : '，升级或重装 ffmpeg'}`;
    }
    return '这套设置算不出命令';
  }

  /** 按下「压缩」之前的校验：返回错误列表（空即可开跑） */
  function compressProblems(f, src, caps) {
    const errs = [];
    if (!src) { errs.push('先选一个视频文件'); return errs; }
    if (f.target === 'size' && !(f.megabytes > 0)) errs.push('填一个目标体积');
    const plan = compressPlan(f, src, caps, 'in.mp4', 'out.mp4');
    if (plan.error) errs.push(planErrorText(plan.error));
    return errs;
  }
  /** 生成条左边那一行：预计体积与省了多少 */
  function estimateLine(f, src, caps) {
    const plan = compressPlan(f, src, caps, 'in.mp4', 'out.mp4');
    if (plan.error) return {text: planErrorText(plan.error), bad: true};
    const saved = plan.estimatedBytes != null ? savedPercent(src.bytes, plan.estimatedBytes) : null;
    const size = f.target === 'size'
      ? `目标 ${trimNumber(f.megabytes)} MB`
      : `约 ${humanBytes(plan.estimatedBytes || 0)}`;
    const spec = [fmtRes(plan.width, plan.height), plan.fps ? `${trimNumber(plan.fps)} fps` : null,
      plan.videoEncoder].filter(Boolean).join(' · ');
    return {text: `${size}${saved ? `（小 ${saved}%）` : ''} · ${spec}`, bad: false,
      approx: f.target === 'quality', plan};
  }

  /* ---------- 合并 ---------- */
  /** 兼容性不合的那几项。每一条都指名道姓，不说「格式不一致」。 */
  function mismatchText(m) {
    if (m.k === 'resolution') return `分辨率不同：${m.values.map((v) => fmtRes(v[0], v[1])).join('、')}`;
    if (m.k === 'fps') return `帧率不同：${m.values.join(' / ')} fps`;
    if (m.k === 'videoCodec') return `画面编码不同：${m.values.join(' / ')}`;
    if (m.k === 'audioCodec') return `音频编码不同：${m.values.join(' / ')}`;
    if (m.k === 'audioPresence') return '有的片段有声音，有的没有';
    if (m.k === 'sampleRate') return `采样率不同：${m.values.map((v) => v / 1000 + ' kHz').join(' / ')}`;
    if (m.k === 'channels') return `声道数不同：${m.values.join(' / ')}`;
    return '规格不一致';
  }

  const uniq = (list) => list.filter((v, i) => list.findIndex((x) => String(x) === String(v)) === i);

  /** 各段能不能直接首尾拷流接起来；不能就说清是哪一项对不上。 */
  function analyze(clips) {
    const list = clips || [];
    const mismatches = [];
    const dims = [];
    list.forEach((c) => {
      if (!dims.some((d) => d[0] === c.width && d[1] === c.height)) dims.push([c.width, c.height]);
    });
    if (dims.length > 1) mismatches.push({k: 'resolution', values: dims});
    // 帧率按 0.05 容差归并：29.97 与 30000/1001 是同一个帧率。
    const rates = [];
    list.forEach((c) => {
      if (Number.isFinite(c.fps) && c.fps > 0 && !rates.some((r) => Math.abs(r - c.fps) < 0.05)) rates.push(c.fps);
    });
    if (rates.length > 1) mismatches.push({k: 'fps', values: rates.map(trimNumber)});
    const vcodecs = uniq(list.map((c) => c.videoCodec || '?'));
    if (vcodecs.length > 1) mismatches.push({k: 'videoCodec', values: vcodecs});
    const voiced = list.filter((c) => c.hasAudio);
    const anyAudio = voiced.length > 0;
    if (anyAudio && voiced.length < list.length) mismatches.push({k: 'audioPresence'});
    if (anyAudio) {
      const acodecs = uniq(voiced.map((c) => c.audioCodec || '?'));
      if (acodecs.length > 1) mismatches.push({k: 'audioCodec', values: acodecs});
      const srates = uniq(voiced.map((c) => c.sampleRate).filter(Boolean));
      if (srates.length > 1) mismatches.push({k: 'sampleRate', values: srates});
      const chans = uniq(voiced.map((c) => c.channels).filter(Boolean));
      if (chans.length > 1) mismatches.push({k: 'channels', values: chans});
    }
    // 尺寸取面积最大的那一段（缩小比放大损失小），帧率取最高的。
    const largest = list.reduce((best, c) => (!best || c.width * c.height > best.width * best.height ? c : best), null);
    const fps = list.reduce((best, c) => (Number.isFinite(c.fps) && c.fps > 0 ? Math.max(best || 0, c.fps) : best), null);
    // 有一段时长不明，总时长就不明——不要把一段当 0 秒悄悄加进去。
    const seconds = list.every((c) => c.seconds > 0) ? list.reduce((s, c) => s + c.seconds, 0) : null;
    return {canCopy: mismatches.length === 0 && list.length >= 2, mismatches,
      width: largest ? even(largest.width) : 0, height: largest ? even(largest.height) : 0,
      fps, seconds, anyAudio, bytes: list.reduce((s, c) => s + num(c.bytes), 0)};
  }

  const MERGE_MODES = [
    {k: 'fast', name: '快速合并', sub: '不重新编码，几秒就好，画质零损失'},
    {k: 'reencode', name: '重新编码', sub: '把各段统一成一套规格，慢但一定能接上'},
  ];
  function blankMerge() {
    return {mode: 'fast', quality: 'high', codec: 'h264', accel: 'quality'};
  }
  const TARGET_SAMPLE_RATE = 48000;

  /** 合并规划。选了「快速」但接不上时自己落到重新编码，并标出 fellBack。 */
  function mergePlan(f, clips, caps, listPath, output) {
    const list = clips || [];
    if (list.length < 2) return {error: {k: 'tooFew'}};
    const bad = list.findIndex((c) => !c.width || !c.height);
    if (bad >= 0) return {error: {k: 'noVideoTrack', index: bad}};
    const compat = analyze(list);
    const fellBack = f.mode === 'fast' && !compat.canCopy;
    const mode = compat.canCopy && f.mode === 'fast' ? 'fast' : 'reencode';

    if (mode === 'fast') {
      const args = harnessArgs().concat(['-f', 'concat', '-safe', '0', '-i', listPath || 'clips.txt',
        '-c', 'copy', '-movflags', '+faststart', output || 'merged.mp4']);
      return {args, mode, fellBack: false, concatList: concatList(list), compatibility: compat,
        videoEncoder: null, estimatedBytes: compat.bytes};
    }
    const encoder = videoEncoder(caps, f.codec, f.accel);
    if (!encoder) return {error: {k: 'codecUnavailable', codec: f.codec}};
    const args = harnessArgs();
    list.forEach((c) => args.push('-i', c.path || c.name));
    // 没有音轨的片段各自配一段同长的静音：不给的话 concat 滤镜会对不上轨，
    // 少一条音轨的结果是整片从那一段起没声音。
    const silent = [];
    list.forEach((c, i) => {
      if (compat.anyAudio && !c.hasAudio) {
        silent.push(i);
        args.push('-f', 'lavfi', '-t', trimNumber(c.seconds),
          '-i', `anullsrc=channel_layout=stereo:sample_rate=${TARGET_SAMPLE_RATE}`);
      }
    });
    const parts = [];
    let extra = 0;
    list.forEach((c, i) => {
      parts.push(`[${i}:v]scale=${compat.width}:${compat.height}:force_original_aspect_ratio=decrease,`
        + `pad=${compat.width}:${compat.height}:-1:-1:color=black,setsar=1,`
        + `fps=${trimNumber(compat.fps || 30)},format=yuv420p[v${i}]`);
      if (!compat.anyAudio) return;
      if (c.hasAudio) parts.push(`[${i}:a]aresample=${TARGET_SAMPLE_RATE},aformat=channel_layouts=stereo[a${i}]`);
      else { parts.push(`[${list.length + extra}:a]aresample=${TARGET_SAMPLE_RATE},aformat=channel_layouts=stereo[a${i}]`); extra += 1; }
    });
    const chain = list.map((c, i) => (compat.anyAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
    parts.push(compat.anyAudio
      ? `${chain}concat=n=${list.length}:v=1:a=1[v][a]`
      : `${chain}concat=n=${list.length}:v=1:a=0[v]`);
    args.push('-filter_complex', parts.join(';'), '-map', '[v]');
    if (compat.anyAudio) args.push('-map', '[a]', '-c:a', audioEncoder(caps) || 'aac', '-b:a', `${AUDIO_KBPS}k`);
    else args.push('-an');
    args.push('-c:v', encoder);
    if (f.accel === 'fast') {
      const k = Math.max(MIN_VIDEO_KBPS,
        Math.round((compat.width * compat.height * (compat.fps || 30) * bppOf(f.quality, f.codec)) / 1000));
      args.push('-b:v', `${k}k`, '-maxrate', `${Math.round(k * 1.45)}k`, '-bufsize', `${k * 2}k`);
    } else {
      args.push('-crf', String(crfOf(f.quality, f.codec)), '-preset', 'medium');
    }
    if (f.codec === 'h265') args.push('-tag:v', 'hvc1');
    args.push('-movflags', '+faststart', output || 'merged.mp4');
    // bpp 模型只是天花板：它只知道分辨率 × 帧率 × 画质档，不知道画面里有什么。
    // 屏幕录制大片平色，x264 实际给出的码率能比模型低一个数量级（实测三段
    // 8.43 秒素材：模型说 8.2 MB，实际 429 KB）。源文件自己的码率把内容复杂度
    // 算进去了，所以再压一道上界：源之和 + 一成半余量（往上放分辨率时产出可能
    // 比源略大）。和压缩那边「不超过源文件大小」是同一条规矩。
    const sourceCeiling = Math.round(SOURCE_SLACK * list.reduce((sum, c) => sum + (c.bytes || 0), 0));
    const estimated = compat.seconds
      ? estimateBytes({quality: f.quality, codec: f.codec, audio: compat.anyAudio ? 'keep' : 'remove'},
        {width: compat.width, height: compat.height}, compat.fps || 30, compat.seconds, sourceCeiling)
      : null;
    return {args, mode, fellBack, concatList: null, compatibility: compat, videoEncoder: encoder,
      estimatedBytes: estimated, silent};
  }
  /** concat demuxer 的清单：路径必须包单引号并把内部的 `'` 转义，
   *  相册导出的 `My Clip's.mp4` 这种名字不转义会让 ffmpeg 找不到文件。 */
  function concatList(clips) {
    return (clips || []).map((c) => `file '${String(c.path || c.name).replace(/'/g, `'\\''`)}'`).join('\n') + '\n';
  }
  function mergeProblems(f, clips, caps) {
    const errs = [];
    const list = clips || [];
    if (list.length < 2) { errs.push('至少要两段视频'); return errs; }
    const plan = mergePlan(f, list, caps, 'clips.txt', 'merged.mp4');
    if (plan.error) {
      if (plan.error.k === 'noVideoTrack') errs.push(`第 ${plan.error.index + 1} 段里没有画面，把它移出去`);
      else if (plan.error.k === 'codecUnavailable') errs.push(planErrorText({k: 'codecUnavailable', codec: plan.error.codec, accel: f.accel}));
      else errs.push('这套设置算不出命令');
    }
    return errs;
  }
  /** 兼容性横幅：能拷流就一句话，不能就列出对不上的每一项 */
  function compatBanner(f, clips) {
    const list = clips || [];
    if (list.length < 2) return null;
    const compat = analyze(list);
    if (compat.canCopy) {
      return {tone: 'positive', title: '可以快速合并',
        line: `${list.length} 段规格一致，不用重新编码，几秒就好，画质零损失。`, mismatches: []};
    }
    return {tone: 'notice', title: f.mode === 'fast' ? '这几段接不上，要重新编码' : '会重新编码统一规格',
      line: `统一成 ${fmtRes(compat.width, compat.height)}${compat.fps ? ` · ${trimNumber(compat.fps)} fps` : ''}`
        + `${compat.anyAudio ? ' · AAC 立体声' : ' · 无声'}，画面按比例缩放后补黑边。`,
      mismatches: compat.mismatches.map(mismatchText)};
  }
  /** 上移 / 下移一段；越界时原样返回 */
  function reorder(clips, index, delta) {
    const to = index + delta;
    if (!clips || to < 0 || to >= clips.length) return clips;
    const next = clips.slice();
    next.splice(to, 0, next.splice(index, 1)[0]);
    return next;
  }

  /* ---------- 失败归因 ---------- */
  /* 每条原因配好「一句人话 + 一串一键修法」。归因本身在 core 做（它看得见 stderr），
     这里的表是 UI 的另一半：同一个 cause code 出同一张卡。 */
  const CAUSES = {
    inputMissing: {title: '找不到源文件', line: '文件可能被移动、改名或删掉了，也可能在已经拔掉的硬盘上。'},
    inputUnreadable: {title: '打不开源文件', line: '没有读取权限，或者文件所在的位置暂时读不到。'},
    inputCorrupt: {title: '这个文件读不出来', line: '可能是文件损坏，也可能是这份 ffmpeg 不认这种容器。'},
    noStreams: {title: '文件里没有可用的轨道', line: '既没有画面也没有声音，换一个文件。'},
    outputUnwritable: {title: '写不进去', line: '目标位置没有写入权限，或者路径已经不存在了。'},
    diskFull: {title: '磁盘满了', line: '换一个还有空间的位置，或者先腾一些出来。'},
    encoderMissing: {title: '这份 ffmpeg 少一个编码器', line: '装的是精简版本。换 H.264 一般就能过，或者重装一份完整的 ffmpeg。'},
    decoderMissing: {title: '这份 ffmpeg 解不了这个文件', line: '源里用了它不认的编码，升级 ffmpeg 通常就能读。'},
    encoderOpenFailed: {title: '编码器起不来', line: '显卡编码器被别的程序占着，或者这个分辨率它不收。换成画质优先最省事。'},
    emptyOutput: {title: '跑完了，但没有产出文件', line: '再试一次；还是这样就换一个源文件看看。'},
    outOfMemory: {title: '内存不够', line: '降一档分辨率，或者改用画质优先（显卡编码更吃内存）。'},
    killed: {title: '进程被系统结束了', line: '多半是内存耗尽。降一档分辨率再试。'},
    cancelled: {title: '已取消', line: '没有产出文件。'},
    unknown: {title: '这次没跑成', line: '原因还不清楚。下面是 ffmpeg 自己说的最后一句，和能原样复跑的命令。'},
  };
  const FIXES = {
    relocateInput: {label: '重新选文件…', icon: 'folder'},
    revealInput: {label: '在文件夹中显示', icon: 'search'},
    chooseOutput: {label: '换个保存位置…', icon: 'folder'},
    retry: {label: '重试', icon: 'refresh'},
    switchToH264: {label: '换成 H.264 再试', icon: 'film'},
    switchToQualityEncoder: {label: '换成画质优先再试', icon: 'tune'},
    lowerResolution: {label: '降一档分辨率再试', icon: 'minus'},
    setupFfmpeg: {label: '重装 ffmpeg', icon: 'download'},
    updateFfmpeg: {label: '升级 ffmpeg', icon: 'upload'},
    copyReport: {label: '复制诊断报告', icon: 'copy'},
  };
  /** 哪种原因给哪几个修法，按推荐顺序（与 diagnose.rs `fixes_for` 同序） */
  function fixesFor(cause) {
    const table = {
      inputMissing: ['relocateInput', 'revealInput'],
      inputUnreadable: ['revealInput', 'relocateInput', 'retry'],
      inputCorrupt: ['updateFfmpeg', 'relocateInput'],
      noStreams: ['relocateInput'],
      outputUnwritable: ['chooseOutput'],
      diskFull: ['chooseOutput'],
      encoderMissing: ['switchToH264', 'setupFfmpeg'],
      decoderMissing: ['updateFfmpeg', 'setupFfmpeg'],
      encoderOpenFailed: ['switchToQualityEncoder', 'lowerResolution', 'retry'],
      emptyOutput: ['retry', 'relocateInput'],
      outOfMemory: ['lowerResolution', 'switchToQualityEncoder', 'retry'],
      killed: ['retry', 'lowerResolution'],
      cancelled: [],
      unknown: ['retry'],
    };
    const list = table[cause] || ['retry'];
    return cause === 'cancelled' ? [] : list.concat(['copyReport']);
  }
  /* stderr 里认得出的那几句。顺序有讲究：磁盘满要排在泛泛的写入失败前面。 */
  const SIGNATURES = [
    ['no such file or directory', 'inputMissing'],
    ['permission denied', 'inputUnreadable'],
    ['no space left on device', 'diskFull'],
    ['invalid data found when processing input', 'inputCorrupt'],
    ['moov atom not found', 'inputCorrupt'],
    ['invalid argument', 'outputUnwritable'],
    ['output file is empty', 'emptyOutput'],
    ['cannot allocate memory', 'outOfMemory'],
    ['error while opening encoder', 'encoderOpenFailed'],
    ['could not open encoder', 'encoderOpenFailed'],
    ['does not contain any stream', 'noStreams'],
  ];
  /** stderr + 退出码 → 归因。`cancelled` 只有调用方知道，不靠猜。 */
  function classify(stderr, exitCode, cancelled) {
    if (cancelled) return {cause: 'cancelled', evidence: null, fixes: []};
    const lines = String(stderr || '').split('\n');
    for (const line of lines) {
      const low = line.toLowerCase();
      const enc = quotedAfter(low, 'unknown encoder') || (low.indexOf('not found') >= 0 ? quotedAfter(low, 'encoder') : null);
      if (enc) return {cause: 'encoderMissing', name: enc, evidence: line.trim(), fixes: fixesFor('encoderMissing')};
      const dec = quotedAfter(low, 'unknown decoder')
        || (low.indexOf('no decoder') >= 0 ? quotedAfter(low, 'no decoder for') : null);
      if (dec) return {cause: 'decoderMissing', name: dec, evidence: line.trim(), fixes: fixesFor('decoderMissing')};
      const hit = SIGNATURES.find((s) => low.indexOf(s[0]) >= 0);
      if (hit) return {cause: hit[1], evidence: line.trim(), fixes: fixesFor(hit[1])};
    }
    const last = lines.map((l) => l.trim()).filter(Boolean).pop() || null;
    if (Number.isFinite(exitCode) && exitCode < 0) {
      return {cause: 'killed', evidence: last, fixes: fixesFor('killed')};
    }
    return {cause: 'unknown', evidence: last, fixes: fixesFor('unknown')};
  }
  function quotedAfter(low, prefix) {
    const at = low.indexOf(prefix);
    if (at < 0) return null;
    const m = /['"]([^'"]{1,63})['"]/.exec(low.slice(at + prefix.length));
    return m ? m[1] : null;
  }
  /** 卡片标题一行：原因 + 带出来的名字 */
  function causeTitle(d) {
    const base = (CAUSES[d.cause] || CAUSES.unknown).title;
    return d.name ? `${base}：${d.name}` : base;
  }
  /** 「复制诊断报告」的正文：纯文本、顺序固定、先摆能复跑的命令 */
  function report(command, banner, d, stderrTail) {
    return ['BaoCut video tool failure',
      `cause: ${d.cause}${d.name ? ':' + d.name : ''}`,
      `ffmpeg: ${String(banner || '').trim()}`,
      'command:', String(command || '').trim(),
      '', 'stderr (tail):', String(stderrTail || '').trim(), ''].join('\n');
  }

  /* ---------- 进度 ---------- */
  /** 进度行：`压缩中 42% · 已 00:18 / 00:42 · 2.1× · 剩约 00:14` */
  function progressLine(r) {
    const bits = [`${r.pct}%`];
    if (r.outSeconds != null && r.seconds) bits.push(`${humanDuration(r.outSeconds)} / ${humanDuration(r.seconds)}`);
    if (r.speed) bits.push(`${trimNumber(r.speed)}×`);
    if (r.etaSeconds != null) bits.push(`剩约 ${humanDuration(r.etaSeconds)}`);
    return bits.join(' · ');
  }
  /** 剩余时间：按已用时与已完成比例外推。5% 以前不报（那时的数字没意义）。 */
  function etaSeconds(fraction, elapsed) {
    if (!(fraction > 0.05) || !(elapsed > 0)) return null;
    return Math.max(0, (elapsed / fraction) - elapsed);
  }
  /** 体积外推：按已写字节与已完成比例。同样等到 5% 以后。 */
  function projectedBytes(fraction, written) {
    return fraction > 0.05 && written > 0 ? Math.round(written / fraction) : null;
  }

  /* ---------- 记录 ---------- */
  const pad = (n) => String(n).padStart(3, '0');
  /** 一条记录。状态 queued → running → done / error / canceled。 */
  function makeJob(kind, seq, payload, taken) {
    const base = {id: 'v' + seq, seq, kind, status: 'queued', pct: 0, taskId: null,
      outSeconds: null, speed: null, etaSeconds: null, bytes: null};
    if (kind === 'compress') {
      return Object.assign(base, {name: uniqueName(outputName(payload.src.name, 'compressed'), taken),
        source: payload.src, form: Object.assign({}, payload.form), seconds: payload.src.seconds,
        sourceBytes: payload.src.bytes, plan: payload.plan});
    }
    return Object.assign(base, {name: uniqueName(`合并-${pad(seq)}.mp4`, taken), clips: payload.clips.slice(),
      form: Object.assign({}, payload.form), seconds: (payload.plan.compatibility || {}).seconds || 0,
      sourceBytes: payload.clips.reduce((s, c) => s + num(c.bytes), 0), plan: payload.plan});
  }
  /** 记录的元数据行 */
  function jobMeta(r) {
    if (r.kind === 'compress') {
      const p = r.plan || {};
      return [humanDuration(r.seconds), fmtRes(p.width, p.height), p.fps ? `${trimNumber(p.fps)} fps` : null,
        p.videoEncoder, r.form.target === 'size' ? `目标 ${trimNumber(r.form.megabytes)} MB`
          : (QUALITIES.find((q) => q.k === r.form.quality) || {}).name].filter(Boolean).join(' · ');
    }
    const c = r.plan.compatibility || {};
    return [`${r.clips.length} 段`, humanDuration(r.seconds), fmtRes(c.width, c.height),
      r.plan.mode === 'fast' ? '快速合并' : '重新编码'].filter(Boolean).join(' · ');
  }
  /** 完成后的收据行：`68.4 MB → 21.8 MB（小 68%）` */
  function resultLine(r) {
    if (!r.bytes) return '';
    const saved = savedPercent(r.sourceBytes, r.bytes);
    return `${humanBytes(r.sourceBytes)} → ${humanBytes(r.bytes)}${saved ? `（小 ${saved}%）` : ''}`;
  }
  /** 按体积压完超了没有：超了就给「再紧一点」。 */
  function overTarget(r) {
    if (r.kind !== 'compress' || r.form.target !== 'size' || !r.bytes) return null;
    const target = r.form.megabytes * 1024 * 1024;
    if (r.bytes <= target) return null;
    const next = retighten(r.plan.videoKbps, r.bytes, r.form.megabytes);
    return {over: r.bytes - target, kbps: next,
      text: `比 ${trimNumber(r.form.megabytes)} MB 的目标多了 ${humanBytes(r.bytes - target)}`};
  }
  /** 本机一次跑一条：没有在跑的就把最早排队的那条交出来 */
  function nextQueued(list) {
    if (list.some((r) => r.status === 'running')) return null;
    const q = list.filter((r) => r.status === 'queued');
    return q.length ? q.reduce((a, b) => (a.seq < b.seq ? a : b)) : null;
  }
  /** 排队的记录前面还有几条（在跑的也算） */
  function aheadOf(list, id) {
    const me = list.find((r) => r.id === id);
    if (!me) return 0;
    return list.filter((r) => (r.status === 'running' || r.status === 'queued') && r.seq < me.seq).length;
  }

  window.BC_VIDEO = {
    MIN_MAJOR, MIN_VIDEO_KBPS, AUDIO_KBPS, SIZE_HEADROOM, WINGET_ID, MANAGER_NAMES,
    humanBytes, humanDuration, savedPercent, trimNumber, fmtRes, sourceLine, outputName, uniqueName, quote, commandLine,
    ffmpegState, ffmpegStatus, installCommand, manualInstall, upgradable, videoEncoder, audioEncoder,
    QUALITIES, RES_CAPS, FPS_CAPS, CODECS, ACCELS, SIZE_PRESETS, crfOf, bppOf, harnessArgs,
    blankCompress, scaledSize, videoKbpsForSize, minMegabytes, minSizeText, retighten, compressPlan, compressProblems,
    estimateLine, planErrorText, WARNINGS,
    MERGE_MODES, blankMerge, analyze, mismatchText, mergePlan, mergeProblems, compatBanner, concatList, reorder,
    CAUSES, FIXES, SIGNATURES, classify, fixesFor, causeTitle, report,
    progressLine, etaSeconds, projectedBytes,
    makeJob, jobMeta, resultLine, overTarget, nextQueued, aheadOf,
  };
})();
