/* 提取音频（product-design §2.7 表二「提取音频」）—— window.BC_TOOL_EXTRACT。纯函数，无 React、无 DOM；只在 App 入口加载。
   - 有音轨时去掉画面（`-vn`），只取第一条音轨；音轨编码能直接装进常见音频容器的原样拷贝，不重新编码：
     AAC → .m4a、MP3 → .mp3、Opus → .ogg、FLAC → .flac；其余（PCM、AC-3、Vorbis…）转成 AAC，放进 .m4a。
   - 没有音轨时不跑 ffmpeg，直接失败：错误码 `TRANSCODE_NO_AUDIO`，文案用产品口吻说清楚、给下一步。
   - 结果是保存位置里的一个音频文件、Space 里的一个音频条目；任务记录带 outputs 与 saveDir（model-tool-runs.js）。
   - Space 里的视频文件（final 条目）也能当输入：`fromEntry` 把条目换成和本机文件同样的源描述。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** 能原样拷贝的音轨编码 → 容器 */
  const COPY = {
    aac: {ext: '.m4a', label: 'AAC'},
    mp3: {ext: '.mp3', label: 'MP3'},
    opus: {ext: '.ogg', label: 'Opus'},
    flac: {ext: '.flac', label: 'FLAC'},
  };
  /** 转码时用的 AAC 码率 */
  const AAC_KBPS = 192;
  /** 拷贝时估体积用的常见码率（kbps）；FLAC 按无损的一般水平估 */
  const COPY_KBPS = {aac: 128, mp3: 192, opus: 96, flac: 900};

  const NO_AUDIO = 'TRANSCODE_NO_AUDIO';

  /** 编码名统一成小写短名：`AAC (LC)`、`mp4a` → aac，`libopus` → opus */
  function codecKey(codec) {
    const c = String(codec || '').toLowerCase();
    if (/aac|mp4a/.test(c)) return 'aac';
    if (/mp3|mpeg audio|mp3float/.test(c)) return 'mp3';
    if (/opus/.test(c)) return 'opus';
    if (/flac/.test(c)) return 'flac';
    return c || 'unknown';
  }
  /** 这条音轨怎么出：`{codec, ext, copy, label, line}`；没有音轨 → null */
  function formatOf(src) {
    if (!src || src.hasAudio === false) return null;
    const k = codecKey(src.audioCodec);
    const hit = COPY[k];
    if (hit) return {codec: k, ext: hit.ext, copy: true, label: hit.label, line: `${hit.label} 音轨原样拷贝成 ${hit.ext}，不重新编码`};
    const name = k === 'unknown' ? '这条音轨' : `${String(src.audioCodec).toUpperCase()} 音轨`;
    return {codec: 'aac', ext: '.m4a', copy: false, label: 'AAC', line: `${name}转成 AAC（${AAC_KBPS} kbps），保存为 .m4a`};
  }
  /** 输出文件名：源文件名换成音频扩展名 */
  function outputName(srcName, ext) {
    const base = String(srcName || 'audio').replace(/\.[^./]+$/, '') || 'audio';
    return base + (ext || '.m4a');
  }
  /** 没有音轨时的失败：错误码与产品口吻的文案 */
  function noAudio(srcName) {
    return {code: NO_AUDIO, title: '这个文件没有声音',
      line: `「${srcName || '源文件'}」里只有画面，没有可以提取的音轨。换一个带声音的视频再试。`};
  }
  /**
   * ffmpeg 计划。`input` / `output`：完整路径。没有音轨 → `{error: noAudio(...)}`，不出命令。
   * @returns {{args: string[], copy: boolean, ext: string, label: string, line: string, estimatedBytes: number}|{error: object}}
   */
  function plan(src, input, output) {
    const f = formatOf(src);
    if (!f) return {error: noAudio(src && src.name)};
    const codec = f.copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', `${AAC_KBPS}k`];
    const args = ['-hide_banner', '-y', '-i', input, '-map', '0:a:0', '-vn'].concat(codec, [output]);
    const kbps = f.copy ? COPY_KBPS[f.codec] || 128 : AAC_KBPS;
    return {args, copy: f.copy, ext: f.ext, label: f.label, line: f.line,
      estimatedBytes: Math.round(((src.seconds || 0) * kbps * 1000) / 8)};
  }
  /** Space 里的视频文件条目 → 源描述（与本机文件 probe 出来的同一个形状） */
  function fromEntry(entry) {
    if (!entry) return null;
    const res = String(entry.res || '').split(/[×x]/).map(Number);
    return {name: entry.name, path: entry.file || entry.name, bytes: entry.bytes || 0, seconds: entry.dur || 0,
      width: res[0] || 0, height: res[1] || 0, fps: entry.fps || 30, videoCodec: entry.videoCodec || 'h264',
      hasAudio: entry.hasAudio !== false, audioCodec: entry.audioCodec || 'aac', entry: entry.id};
  }
  /** 一条提取任务记录（与压缩 / 合并同一条队列：queued → running → done / error / canceled） */
  function makeJob(seq, src, taken, saveDir) {
    const f = formatOf(src);
    const used = new Set(taken || []);
    let name = outputName(src.name, f ? f.ext : '.m4a');
    for (let i = 2; used.has(name); i += 1) name = outputName(src.name, f ? f.ext : '.m4a').replace(/(\.[^.]+)$/, `-${i}$1`);
    const dir = saveDir || null;
    const p = plan(src, src.path, dir ? `${dir}/${name}` : name);
    return {id: 'v' + seq, seq, kind: 'extract', status: 'queued', pct: 0, taskId: null, outSeconds: null, speed: null, etaSeconds: null,
      bytes: null, name, source: src, form: {}, seconds: src.seconds || 0, sourceBytes: src.bytes || 0, saveDir: dir,
      plan: p.error ? {args: [], error: p.error} : p};
  }
  const mmss = (s) => { const t = Math.max(0, Math.round(s || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
  /** 记录的元数据行 */
  function jobMeta(r) {
    if (r.plan && r.plan.error) return `${mmss(r.seconds)} · 没有音轨`;
    return [mmss(r.seconds), r.plan.copy ? `${r.plan.label} · 原样拷贝` : `转成 ${r.plan.label}`].join(' · ');
  }

  root.BC_TOOL_EXTRACT = {NO_AUDIO, COPY, AAC_KBPS, codecKey, formatOf, outputName, noAudio, plan, fromEntry, makeJob, jobMeta};
})();
