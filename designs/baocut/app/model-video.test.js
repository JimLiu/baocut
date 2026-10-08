const test = require('node:test');
const assert = require('node:assert/strict');

global.window = {};
require('./model-video.js');
const V = global.window.BC_VIDEO;

/* 一份完整的 ffmpeg 能力表（Homebrew 装的那种） */
const FULL = ['libx264', 'libx265', 'h264_videotoolbox', 'hevc_videotoolbox', 'aac', 'aac_at'];
/* 精简版：只有 H.264 软编码 */
const THIN = ['libx264', 'aac'];

const src = (over) => Object.assign({
  name: 'holiday.mov', path: '/Users/me/Movies/holiday.mov',
  seconds: 60, width: 1920, height: 1080, fps: 30,
  bytes: 200 * 1024 * 1024, hasAudio: true, audioCodec: 'aac',
}, over);

/* ---------- ffmpeg 检测 / 安装 / 升级 ---------- */

test('ffmpeg 卡：没装时给包管理器那条路，没有包管理器就只给说明', () => {
  const withBrew = V.ffmpegState({found: false, installer: 'brew'});
  assert.equal(withBrew.stage, 'missing');
  assert.deepEqual(withBrew.actions, ['install', 'manual', 'recheck']);
  assert.match(withBrew.line, /Homebrew/);

  const bare = V.ffmpegState({found: false, installer: null});
  assert.deepEqual(bare.actions, ['manual', 'recheck']);
  assert.match(bare.line, /Homebrew 或 winget/);
});

test('ffmpeg 卡：只升包管理器自己那一份，别人编译的不碰', () => {
  const ours = V.ffmpegState({found: true, version: '3.4.8', major: 3, manager: 'brew', installer: 'brew'});
  assert.equal(ours.stage, 'old');
  assert.deepEqual(ours.actions, ['upgrade', 'manual', 'recheck']);

  const foreign = V.ffmpegState({found: true, version: '3.4.8', major: 3, manager: 'foreign', installer: 'brew'});
  assert.equal(foreign.stage, 'old');
  assert.deepEqual(foreign.actions, ['manual', 'recheck']);
  assert.match(foreign.line, /不是包管理器装的/);
  assert.equal(V.upgradable({found: true, manager: 'foreign', installer: 'brew'}), false);
});

test('ffmpeg 卡：有新版本时不拦路，就绪时报出路径与来源', () => {
  const upd = V.ffmpegState({found: true, version: '7.1', major: 7, manager: 'brew', installer: 'brew', updateAvailable: true});
  assert.equal(upd.stage, 'update');
  assert.deepEqual(upd.actions, ['upgrade', 'recheck']);
  assert.match(upd.line, /旧版本也能用/);

  const ok = V.ffmpegState({found: true, version: '7.1', major: 7, manager: 'brew', installer: 'brew', path: '/opt/homebrew/bin/ffmpeg'});
  assert.equal(ok.stage, 'ready');
  assert.equal(ok.title, 'ffmpeg 7.1');
  assert.equal(ok.line, '/opt/homebrew/bin/ffmpeg · Homebrew');

  const busy = V.ffmpegState({installing: true, installer: 'brew'});
  assert.equal(busy.stage, 'installing');
  assert.deepEqual(busy.actions, ['cancel']);
});

test('安装命令与手工兜底：不跑 curl | bash，只给一条能复制的命令', () => {
  assert.equal(V.installCommand('brew', false), 'brew install ffmpeg');
  assert.equal(V.installCommand('brew', true), 'brew upgrade ffmpeg');
  assert.equal(V.installCommand('winget', false), 'winget install --id Gyan.FFmpeg -e');
  assert.equal(V.installCommand(null, false), null);
  assert.match(V.manualInstall('win').command, /winget install/);
  assert.equal(V.manualInstall('mac').url, 'https://ffmpeg.org/download.html');
});

test('工具卡状态行：按 ffmpeg 就绪程度换话', () => {
  assert.deepEqual(V.ffmpegStatus({found: false}), {text: '要先装 ffmpeg', on: false});
  assert.deepEqual(V.ffmpegStatus({found: true, major: 3, version: '3.4.8'}),
    {text: 'ffmpeg 3.4.8 太旧，要升级', on: false});
  assert.deepEqual(V.ffmpegStatus({found: true, major: 7, version: '7.1', updateAvailable: true}),
    {text: 'ffmpeg 7.1 · 有新版本', on: true});
  assert.deepEqual(V.ffmpegStatus({found: true, major: 7, version: '7.1'}), {text: 'ffmpeg 7.1 就绪', on: true});
});

test('编码器挑选：软编码只认 libx264 / libx265，硬编码按平台次序', () => {
  assert.equal(V.videoEncoder(FULL, 'h264', 'quality'), 'libx264');
  assert.equal(V.videoEncoder(FULL, 'h265', 'quality'), 'libx265');
  assert.equal(V.videoEncoder(FULL, 'h264', 'fast'), 'h264_videotoolbox');
  // 没有硬件编码器时退回软编码，而不是报错
  assert.equal(V.videoEncoder(THIN, 'h264', 'fast'), 'libx264');
  // 精简版没有 libx265：宁可报「没有」，也不要悄悄换成 mpeg4
  assert.equal(V.videoEncoder(THIN, 'h265', 'quality'), null);
  assert.equal(V.audioEncoder(FULL), 'aac_at');
  assert.equal(V.audioEncoder(['aac']), 'aac');
  assert.equal(V.audioEncoder([]), null);
});

/* ---------- 压缩 ---------- */

test('分辨率上限只往下缩、按短边、两边取偶', () => {
  assert.deepEqual(V.scaledSize(1920, 1080, '720p'), {width: 1280, height: 720});
  // 竖屏按短边封：1080×1920 封 720 得 720×1280，不是 1280×720
  assert.deepEqual(V.scaledSize(1080, 1920, '720p'), {width: 720, height: 1280});
  // 源本来就小于上限：不动
  assert.deepEqual(V.scaledSize(1280, 720, '1080p'), {width: 1280, height: 720});
  assert.deepEqual(V.scaledSize(1920, 1080, 'original'), {width: 1920, height: 1080});
  // 奇数尺寸取偶
  assert.deepEqual(V.scaledSize(1921, 1081, 'original'), {width: 1920, height: 1080});
});

test('按画质压：走 CRF，AAC 音轨直接拷流', () => {
  const p = V.compressPlan(V.blankCompress(), src(), FULL, '/in.mov', '/out.mp4');
  assert.equal(p.videoEncoder, 'libx264');
  const a = p.args.join(' ');
  assert.match(a, /-crf 26 -preset medium/);
  assert.ok(!a.includes('-b:v'), '按画质压不该出现码率');
  assert.match(a, /-c:a copy/);
  assert.match(a, /-movflags \+faststart/);
  assert.match(a, /-vf setsar=1,format=yuv420p/);
  assert.match(a, /-progress pipe:1/);
  assert.deepEqual(p.warnings, []);
});

test('H.265 的 CRF 标度整体高 5，还要补 hvc1 tag', () => {
  const f = Object.assign(V.blankCompress(), {codec: 'h265'});
  const p = V.compressPlan(f, src(), FULL, '/in.mov', '/out.mp4');
  assert.equal(p.videoEncoder, 'libx265');
  assert.match(p.args.join(' '), /-crf 31 .*-tag:v hvc1/);
  assert.deepEqual(p.warnings.map((w) => w.k), ['h265Compatibility']);
});

test('按体积压：VBV 受限 ABR，音轨一律重编码', () => {
  const f = Object.assign(V.blankCompress(), {target: 'size', megabytes: 25});
  const p = V.compressPlan(f, src(), FULL, '/in.mov', '/out.mp4');
  const kbps = Math.round(V.videoKbpsForSize(25, 60, 'keep'));
  const a = p.args.join(' ');
  assert.match(a, new RegExp(`-b:v ${kbps}k -maxrate ${Math.round(kbps * 1.45)}k -bufsize ${kbps * 2}k`));
  assert.ok(!a.includes('-crf'), '按体积压不该出现 CRF');
  assert.match(a, /-c:a aac_at -b:a 128k -ac 2/);
  assert.deepEqual(p.warnings.map((w) => w.k), ['audioReencoded']);
  // 预计体积就是目标乘余量
  assert.equal(p.estimatedBytes, Math.round(25 * 1024 * 1024 * V.SIZE_HEADROOM));
});

test('按体积压：低于码率地板就说清做得到的最小值', () => {
  const f = Object.assign(V.blankCompress(), {target: 'size', megabytes: 1});
  const p = V.compressPlan(f, src({seconds: 600}), FULL, '/in.mov', '/out.mp4');
  assert.equal(p.error.k, 'targetTooSmall');
  assert.ok(Math.abs(p.error.minMegabytes - V.minMegabytes(600, 'keep')) < 1e-9);
  assert.match(V.planErrorText(p.error), /最小只能压到约 15\.7 MB/);
  // 短片算出来不到 1 MB，写「0.0 MB」像坏了，要按 KB 说
  assert.equal(V.minSizeText(600, 'keep'), '15.7 MB');
  assert.equal(V.minSizeText(2, 'keep'), '53 KB');
  // 去掉音轨之后地板更低
  assert.ok(V.minMegabytes(600, 'remove') < V.minMegabytes(600, 'keep'));
});

test('按体积压：时长探不出来就没有分母', () => {
  const f = Object.assign(V.blankCompress(), {target: 'size'});
  const p = V.compressPlan(f, src({seconds: 0}), FULL, '/in.mov', '/out.mp4');
  assert.equal(p.error.k, 'durationUnknown');
  assert.match(V.planErrorText(p.error), /按画质压/);
});

test('降帧滤镜只在真降帧时插：29.97 遇上 30 的上限不动', () => {
  const capped = Object.assign(V.blankCompress(), {fps: '24'});
  assert.match(V.compressPlan(capped, src(), FULL, '/i', '/o').args.join(' '), /fps=24/);
  const noop = Object.assign(V.blankCompress(), {fps: '30'});
  const p = V.compressPlan(noop, src({fps: 29.97}), FULL, '/i', '/o');
  assert.ok(!p.args.join(' ').includes('fps='), '29.97 已经在 30 以下，不该重排时间戳');
  assert.equal(V.trimNumber(p.fps), '29.97');
});

test('分辨率上限比源还高时明说它不起作用', () => {
  const f = Object.assign(V.blankCompress(), {resolution: '1080p'});
  const p = V.compressPlan(f, src({width: 1280, height: 720}), FULL, '/i', '/o');
  assert.deepEqual(p.warnings.map((w) => w.k), ['resolutionCapInactive']);
  assert.ok(!p.args.join(' ').includes('scale='));
});

test('没有画面 / 没有这套编码器时不硬拼命令', () => {
  assert.equal(V.compressPlan(V.blankCompress(), src({width: 0, height: 0}), FULL, '/i', '/o').error.k, 'noVideoTrack');
  const f = Object.assign(V.blankCompress(), {codec: 'h265'});
  const p = V.compressPlan(f, src(), THIN, '/i', '/o');
  assert.deepEqual(p.error, {k: 'codecUnavailable', codec: 'h265', accel: 'quality', h264: true, h265: false});
  assert.match(V.planErrorText(p.error), /不带 H\.265 编码器，还能用 H\.264/);
});

test('非 AAC 音轨要重编码，去掉音轨就 -an', () => {
  const mp3 = V.compressPlan(V.blankCompress(), src({audioCodec: 'opus'}), FULL, '/i', '/o');
  assert.match(mp3.args.join(' '), /-c:a aac_at/);
  assert.equal(mp3.warnings[0].text, '音轨是 OPUS，会重新编码成 AAC');
  const off = V.compressPlan(Object.assign(V.blankCompress(), {audio: 'remove'}), src(), FULL, '/i', '/o');
  assert.match(off.args.join(' '), /-an/);
  // 有音轨但这份 ffmpeg 一个 AAC 编码器都没有：拷流，不静默丢声音
  const mute = V.compressPlan(V.blankCompress(), src({audioCodec: 'opus'}), ['libx264'], '/i', '/o');
  assert.match(mute.args.join(' '), /-c:a copy/);
});

test('显卡编码走码率而不是 CRF，同时提醒画质取舍', () => {
  const f = Object.assign(V.blankCompress(), {accel: 'fast'});
  const p = V.compressPlan(f, src(), FULL, '/i', '/o');
  assert.equal(p.videoEncoder, 'h264_videotoolbox');
  assert.match(p.args.join(' '), /-b:v \d+k/);
  assert.deepEqual(p.warnings.map((w) => w.k), ['accelQualityTradeoff']);
});

test('体积估算：按 bits-per-pixel 外推，且永不大于源文件', () => {
  const p = V.compressPlan(V.blankCompress(), src(), FULL, '/i', '/o');
  assert.equal(V.humanBytes(p.estimatedBytes), '35.0 MB');
  // 源本来就只有 4 MB：估算跟着封到 4 MB，不摆一个更大的数字
  const tiny = V.compressPlan(V.blankCompress(), src({bytes: 4 * 1024 * 1024}), FULL, '/i', '/o');
  assert.equal(tiny.estimatedBytes, 4 * 1024 * 1024);
  // H.265 同画质约省四成
  const h265 = V.compressPlan(Object.assign(V.blankCompress(), {codec: 'h265'}), src(), FULL, '/i', '/o');
  assert.ok(Math.abs(h265.estimatedBytes / p.estimatedBytes - 0.6) < 0.02);
});

test('生成条那一行：预计体积 + 省多少 + 输出规格', () => {
  const line = V.estimateLine(V.blankCompress(), src(), FULL);
  assert.equal(line.bad, false);
  assert.equal(line.approx, true);
  assert.equal(line.text, '约 35.0 MB（小 83%） · 1920×1080 · 30 fps · libx264');
  const sized = V.estimateLine(Object.assign(V.blankCompress(), {target: 'size', megabytes: 25}), src(), FULL);
  assert.match(sized.text, /^目标 25 MB（小 88%）/);
  assert.equal(sized.approx, false);
  const bad = V.estimateLine(Object.assign(V.blankCompress(), {codec: 'h265'}), src(), THIN);
  assert.equal(bad.bad, true);
});

test('再紧一点：用实测比例回算，不是乘固定系数', () => {
  // 目标 25 MB 却压出了 30 MB：下一遍按 25/30 收，再留 1%
  const next = V.retighten(3000, 30 * 1024 * 1024, 25);
  assert.equal(Math.round(next), Math.round(3000 * (25 / 30) * 0.99));
  // 已经达标就不用再压
  assert.equal(V.retighten(3000, 20 * 1024 * 1024, 25), null);
  // 收到地板以下就别收了
  assert.equal(V.retighten(100, 30 * 1024 * 1024, 1), null);
});

test('校验：没选文件、目标为空各说各的', () => {
  assert.deepEqual(V.compressProblems(V.blankCompress(), null, FULL), ['先选一个视频文件']);
  const f = Object.assign(V.blankCompress(), {target: 'size', megabytes: 0});
  assert.equal(V.compressProblems(f, src(), FULL)[0], '填一个目标体积');
  assert.deepEqual(V.compressProblems(V.blankCompress(), src(), FULL), []);
});

/* ---------- 合并 ---------- */

const clip = (over) => Object.assign({
  name: 'a.mp4', path: '/Users/me/Movies/a.mp4', seconds: 10, width: 1920, height: 1080, fps: 30,
  bytes: 10 * 1024 * 1024, hasAudio: true, audioCodec: 'aac', videoCodec: 'h264',
  sampleRate: 48000, channels: 2,
}, over);

test('兼容性分析：规格一致就能拷流，总时长是各段之和', () => {
  const c = V.analyze([clip(), clip({name: 'b.mp4'})]);
  assert.equal(c.canCopy, true);
  assert.deepEqual(c.mismatches, []);
  assert.equal(c.seconds, 20);
  assert.equal(c.width, 1920);
  assert.equal(c.anyAudio, true);
  // 只有一段时谈不上合并
  assert.equal(V.analyze([clip()]).canCopy, false);
});

test('兼容性分析：对不上的每一项都指名道姓', () => {
  const c = V.analyze([clip(), clip({width: 1280, height: 720, fps: 24, videoCodec: 'hevc', audioCodec: 'opus', sampleRate: 44100, channels: 1})]);
  assert.equal(c.canCopy, false);
  assert.deepEqual(c.mismatches.map(V.mismatchText), [
    '分辨率不同：1920×1080、1280×720',
    '帧率不同：30 / 24 fps',
    '画面编码不同：h264 / hevc',
    '音频编码不同：aac / opus',
    '采样率不同：48 kHz / 44.1 kHz',
    '声道数不同：2 / 1',
  ]);
  // 目标规格取面积最大的那一段与最高帧率
  assert.equal(V.fmtRes(c.width, c.height), '1920×1080');
  assert.equal(c.fps, 30);
});

test('帧率容差：29.97 与 30000/1001 是同一个帧率', () => {
  const c = V.analyze([clip({fps: 29.97}), clip({fps: 30000 / 1001})]);
  assert.deepEqual(c.mismatches, []);
  assert.equal(c.canCopy, true);
});

test('有的片段没声音：这一项单独报，不混进「音频编码不同」', () => {
  const c = V.analyze([clip(), clip({hasAudio: false, audioCodec: null})]);
  assert.deepEqual(c.mismatches.map((m) => m.k), ['audioPresence']);
  assert.equal(V.mismatchText(c.mismatches[0]), '有的片段有声音，有的没有');
  // 全都没声音就不是不一致
  assert.deepEqual(V.analyze([clip({hasAudio: false}), clip({hasAudio: false})]).mismatches, []);
});

test('一段时长不明，总时长就不明', () => {
  assert.equal(V.analyze([clip(), clip({seconds: 0})]).seconds, null);
});

test('快速合并：concat demuxer + 清单，路径里的单引号要转义', () => {
  const clips = [clip(), clip({name: "My Clip's.mp4", path: "/m/My Clip's.mp4"})];
  const p = V.mergePlan(V.blankMerge(), clips, FULL, '/tmp/clips.txt', '/out.mp4');
  assert.equal(p.mode, 'fast');
  assert.equal(p.fellBack, false);
  assert.match(p.args.join(' '), /-f concat -safe 0 -i \/tmp\/clips\.txt -c copy/);
  assert.equal(p.concatList, "file '/Users/me/Movies/a.mp4'\nfile '/m/My Clip'\\''s.mp4'\n");
});

test('接不上时自己落到重新编码，并标出「不是你选的」', () => {
  const clips = [clip(), clip({width: 1280, height: 720})];
  const p = V.mergePlan(V.blankMerge(), clips, FULL, '/tmp/l.txt', '/out.mp4');
  assert.equal(p.mode, 'reencode');
  assert.equal(p.fellBack, true);
  const a = p.args.join(' ');
  assert.match(a, /scale=1920:1080:force_original_aspect_ratio=decrease/);
  assert.match(a, /pad=1920:1080:-1:-1:color=black/);
  assert.match(a, /concat=n=2:v=1:a=1\[v\]\[a\]/);
  assert.match(a, /-map \[v\] -map \[a\] -c:a aac_at/);
  assert.match(a, /-crf 22 -preset medium/);
  // 用户自己选重新编码时不算「落回」
  const chosen = V.mergePlan(Object.assign(V.blankMerge(), {mode: 'reencode'}), [clip(), clip()], FULL, '/l', '/o');
  assert.equal(chosen.mode, 'reencode');
  assert.equal(chosen.fellBack, false);
});

test('重编码的预计体积不超过源码率给的上界（本机实测）', () => {
  // 三段屏幕录制：1920×1080 两段 + 1280×720 一段，共 8.43 秒、346 081 字节。
  // 实跑 ffmpeg 7.1 重编码成 1080p30 CRF 22 得到 428 744 字节；只按 bpp 模型
  // 算会报 8.2 MB。
  const clips = [
    clip({seconds: 2.53, bytes: 150686}),
    clip({seconds: 2.07, width: 1280, height: 720, bytes: 62537}),
    clip({seconds: 3.83, bytes: 132858}),
  ];
  const p = V.mergePlan(V.blankMerge(), clips, FULL, '/l', '/o');
  assert.equal(p.mode, 'reencode');
  assert.ok(Math.abs(p.estimatedBytes - 428744) / 428744 < 0.15,
    `实际 428744，预计 ${p.estimatedBytes}`);
});

test('无声片段各配一段同长静音，而不是整片静音', () => {
  const clips = [clip(), clip({hasAudio: false, audioCodec: null, seconds: 7})];
  const p = V.mergePlan(V.blankMerge(), clips, FULL, '/l', '/o');
  const a = p.args.join(' ');
  assert.match(a, /-f lavfi -t 7 -i anullsrc=channel_layout=stereo:sample_rate=48000/);
  assert.match(a, /\[2:a\]aresample=48000/);
  assert.match(a, /concat=n=2:v=1:a=1/);
  assert.deepEqual(p.silent, [1]);
});

test('全都没声音：出一个无声文件，不凭空造静音轨', () => {
  const p = V.mergePlan(V.blankMerge(), [clip({hasAudio: false}), clip({hasAudio: false, width: 1280, height: 720})], FULL, '/l', '/o');
  const a = p.args.join(' ');
  assert.match(a, /concat=n=2:v=1:a=0\[v\]/);
  assert.match(a, /-an/);
  assert.ok(!a.includes('anullsrc'));
});

test('合并的拦路条件：不到两段、某段没画面、没有编码器', () => {
  assert.deepEqual(V.mergeProblems(V.blankMerge(), [clip()], FULL), ['至少要两段视频']);
  assert.deepEqual(V.mergeProblems(V.blankMerge(), [clip(), clip({width: 0, height: 0})], FULL),
    ['第 2 段里没有画面，把它移出去']);
  const h265 = Object.assign(V.blankMerge(), {mode: 'reencode', codec: 'h265'});
  assert.match(V.mergeProblems(h265, [clip(), clip()], THIN)[0], /不带 H\.265 编码器/);
  assert.deepEqual(V.mergeProblems(V.blankMerge(), [clip(), clip()], FULL), []);
});

test('兼容性横幅：能拷流一句话，不能就列全对不上的项', () => {
  const ok = V.compatBanner(V.blankMerge(), [clip(), clip()]);
  assert.equal(ok.tone, 'positive');
  assert.match(ok.line, /不用重新编码/);
  const bad = V.compatBanner(V.blankMerge(), [clip(), clip({width: 1280, height: 720})]);
  assert.equal(bad.tone, 'notice');
  assert.equal(bad.title, '这几段接不上，要重新编码');
  assert.equal(bad.line, '统一成 1920×1080 · 30 fps · AAC 立体声，画面按比例缩放后补黑边。');
  assert.deepEqual(bad.mismatches, ['分辨率不同：1920×1080、1280×720']);
  assert.equal(V.compatBanner(V.blankMerge(), [clip()]), null);
});

test('上移 / 下移：越界时原样返回', () => {
  const list = [clip({name: 'a'}), clip({name: 'b'}), clip({name: 'c'})];
  assert.deepEqual(V.reorder(list, 2, -1).map((c) => c.name), ['a', 'c', 'b']);
  assert.deepEqual(V.reorder(list, 0, 1).map((c) => c.name), ['b', 'a', 'c']);
  assert.equal(V.reorder(list, 0, -1), list);
  assert.equal(V.reorder(list, 2, 1), list);
});

/* ---------- 失败归因 ---------- */

test('少编码器：把名字连着报出来，先给「换 H.264」', () => {
  const d = V.classify("Unknown encoder 'libx265'", 1, false);
  assert.equal(d.cause, 'encoderMissing');
  assert.equal(d.name, 'libx265');
  assert.equal(V.causeTitle(d), '这份 ffmpeg 少一个编码器：libx265');
  assert.deepEqual(d.fixes, ['switchToH264', 'setupFfmpeg', 'copyReport']);
});

test('磁盘满排在泛泛的写入失败前面', () => {
  const d = V.classify('av_interleaved_write_frame(): No space left on device', 1, false);
  assert.equal(d.cause, 'diskFull');
  assert.deepEqual(d.fixes, ['chooseOutput', 'copyReport']);
});

test('硬件编码器打不开：先指「换成画质优先」', () => {
  const d = V.classify('Error while opening encoder for output stream #0:0', 1, false);
  assert.equal(d.cause, 'encoderOpenFailed');
  assert.deepEqual(d.fixes, ['switchToQualityEncoder', 'lowerResolution', 'retry', 'copyReport']);
});

test('找不到文件 / 解码器缺失 / 坏容器各归各的', () => {
  assert.equal(V.classify('/m/gone.mp4: No such file or directory', 1, false).cause, 'inputMissing');
  assert.equal(V.classify('moov atom not found', 1, false).cause, 'inputCorrupt');
  const dec = V.classify("No decoder for 'av1' found", 1, false);
  assert.equal(dec.cause, 'decoderMissing');
  assert.equal(dec.name, 'av1');
  assert.deepEqual(dec.fixes, ['updateFfmpeg', 'setupFfmpeg', 'copyReport']);
});

test('被杀 / 被取消 / 不认识的失败各有各的说法', () => {
  const killed = V.classify('frame= 120 fps=30', -9, false);
  assert.equal(killed.cause, 'killed');
  assert.deepEqual(killed.fixes, ['retry', 'lowerResolution', 'copyReport']);

  const cancelled = V.classify('anything', null, true);
  assert.equal(cancelled.cause, 'cancelled');
  assert.deepEqual(cancelled.fixes, []);

  // 不认识就说不认识，不要瞎猜一个原因
  const unknown = V.classify('something weird\nlast line here', 1, false);
  assert.equal(unknown.cause, 'unknown');
  assert.equal(unknown.evidence, 'last line here');
  assert.deepEqual(unknown.fixes, ['retry', 'copyReport']);
});

test('除了「已取消」，每条原因最后都能复制诊断报告', () => {
  Object.keys(V.CAUSES).forEach((cause) => {
    const fixes = V.fixesFor(cause);
    if (cause === 'cancelled') assert.deepEqual(fixes, []);
    else assert.equal(fixes[fixes.length - 1], 'copyReport', cause);
  });
});

test('诊断报告：先摆能复跑的命令，纯文本、顺序固定', () => {
  const text = V.report("ffmpeg -i '/a b.mov' out.mp4", 'ffmpeg version 7.1', {cause: 'encoderMissing', name: 'libx265'}, 'Unknown encoder');
  assert.equal(text.split('\n')[0], 'BaoCut video tool failure');
  assert.match(text, /cause: encoderMissing:libx265/);
  assert.match(text, /ffmpeg: ffmpeg version 7\.1/);
  assert.match(text, /command:\nffmpeg -i '\/a b\.mov' out\.mp4/);
  assert.match(text, /stderr \(tail\):\nUnknown encoder/);
});

test('命令行是能原样粘进终端的那种', () => {
  assert.equal(V.commandLine('/opt/homebrew/bin/ffmpeg', ['-i', '/m/My Clip.mov', '-crf', '26', '/m/out.mp4']),
    "/opt/homebrew/bin/ffmpeg -i '/m/My Clip.mov' -crf 26 /m/out.mp4");
  assert.equal(V.quote("it's.mp4"), "'it'\\''s.mp4'");
});

/* ---------- 进度与记录 ---------- */

test('进度行：百分比 / 已处理到哪 / 倍速 / 剩多久', () => {
  assert.equal(V.progressLine({pct: 42, outSeconds: 18, seconds: 60, speed: 2.1, etaSeconds: 14}),
    '42% · 00:18 / 01:00 · 2.1× · 剩约 00:14');
  // 还没有速度信息时不硬凑
  assert.equal(V.progressLine({pct: 0, seconds: 60}), '0%');
});

test('剩余时间与体积外推都等到 5% 之后才报', () => {
  assert.equal(V.etaSeconds(0.02, 3), null);
  assert.equal(Math.round(V.etaSeconds(0.25, 10)), 30);
  assert.equal(V.projectedBytes(0.04, 1000), null);
  assert.equal(V.projectedBytes(0.5, 1000), 2000);
});

test('记录：文件名不叠后缀，元数据行写清这次用的规格', () => {
  const f = V.blankCompress();
  const s = src();
  const plan = V.compressPlan(f, s, FULL, '/i', '/o');
  const r = V.makeJob('compress', 3, {src: s, form: f, plan});
  assert.equal(r.name, 'holiday-compressed.mp4');
  assert.equal(V.jobMeta(r), '01:00 · 1920×1080 · 30 fps · libx264 · 均衡');
  // 压过的文件再压一次不该变成 …-compressed-compressed.mp4
  assert.equal(V.outputName('holiday-compressed.mp4', 'compressed'), 'holiday-compressed.mp4');
  // 队列里已经有同名产出时挂序号，两条记录不会顶着一个名字说谎
  assert.equal(V.uniqueName('holiday-compressed.mp4', []), 'holiday-compressed.mp4');
  assert.equal(
    V.uniqueName('holiday-compressed.mp4', ['holiday-compressed.mp4']),
    'holiday-compressed-2.mp4',
  );
  assert.equal(
    V.uniqueName('holiday-compressed.mp4', ['holiday-compressed.mp4', 'holiday-compressed-2.mp4']),
    'holiday-compressed-3.mp4',
  );
  const again = V.makeJob('compress', 4, {src: s, form: f, plan}, [r.name]);
  assert.equal(again.name, 'holiday-compressed-2.mp4');

  const clips = [clip(), clip({width: 1280, height: 720})];
  const mplan = V.mergePlan(V.blankMerge(), clips, FULL, '/l', '/o');
  const m = V.makeJob('merge', 4, {clips, form: V.blankMerge(), plan: mplan});
  assert.equal(m.name, '合并-004.mp4');
  assert.equal(V.jobMeta(m), '2 段 · 00:20 · 1920×1080 · 重新编码');
});

test('收据行与「再紧一点」：超了目标才给那一枚按钮', () => {
  const f = Object.assign(V.blankCompress(), {target: 'size', megabytes: 25});
  const s = src();
  const r = V.makeJob('compress', 1, {src: s, form: f, plan: V.compressPlan(f, s, FULL, '/i', '/o')});
  r.bytes = 30 * 1024 * 1024;
  assert.equal(V.resultLine(r), '200.0 MB → 30.0 MB（小 85%）');
  const over = V.overTarget(r);
  assert.match(over.text, /比 25 MB 的目标多了 5\.0 MB/);
  assert.ok(over.kbps < r.plan.videoKbps);
  r.bytes = 24 * 1024 * 1024;
  assert.equal(V.overTarget(r), null);
  // 按画质压没有目标可超
  const q = V.makeJob('compress', 2, {src: s, form: V.blankCompress(), plan: V.compressPlan(V.blankCompress(), s, FULL, '/i', '/o')});
  q.bytes = 99;
  assert.equal(V.overTarget(q), null);
});

test('本机一次跑一条：排队次序与「前面还有几条」', () => {
  const list = [{id: 'c', seq: 3, status: 'queued'}, {id: 'b', seq: 2, status: 'queued'}, {id: 'a', seq: 1, status: 'queued'}];
  assert.equal(V.nextQueued(list).id, 'a');
  assert.equal(V.aheadOf(list, 'c'), 2);
  list[2].status = 'running';
  assert.equal(V.nextQueued(list), null);
  assert.equal(V.aheadOf(list, 'b'), 1);
  list[2].status = 'done';
  assert.equal(V.nextQueued(list).id, 'b');
  assert.equal(V.aheadOf(list, 'b'), 0);
});

test('体积、时长与源信息行读起来像文件管理器', () => {
  assert.equal(V.humanBytes(880 * 1024), '880 KB');
  assert.equal(V.humanBytes(3.5 * 1024 * 1024), '3.5 MB');
  assert.equal(V.humanBytes(2 * 1024 ** 3), '2.0 GB');
  assert.equal(V.humanDuration(3723), '1:02:03');
  assert.equal(V.humanDuration(NaN), '--:--');
  assert.equal(V.savedPercent(100, 32), 68);
  assert.equal(V.savedPercent(100, 140), null);
  assert.equal(V.sourceLine(src()), '01:00 · 1920×1080 · 30 fps · 200.0 MB · AAC 音轨');
  assert.equal(V.sourceLine(src({hasAudio: false})), '01:00 · 1920×1080 · 30 fps · 200.0 MB · 没有音轨');
});
