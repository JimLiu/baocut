/* 图片与视频预览的纯模型。产品设计 §3.3；像素不回写，批注与比例请求进入会话草稿。 */
(function () {
  function kind(path) {
    const ext = String(path || '').split(/[?#]/)[0].split('.').pop().toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'].includes(ext)) return 'image';
    if (['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'].includes(ext)) return 'audio';
    if (['mp4', 'mov', 'm4v', 'webm', 'mkv'].includes(ext)) return 'video';
    return null;
  }
  function gallery(file, files) {
    if (!file || kind(file.file) !== 'image') return [];
    if (!file.previewGroup) return [file];
    return files.filter(it => !it.trashed && it.dir === file.dir && it.session === file.session &&
      it.previewGroup === file.previewGroup && kind(it.file) === 'image');
  }
  function galleryKey(index, count, key) {
    if (!count) return null;
    if (key === 'Home') return 0;
    if (key === 'End') return count - 1;
    if (['ArrowUp', 'ArrowLeft'].includes(key)) return Math.max(0, index - 1);
    if (['ArrowDown', 'ArrowRight'].includes(key)) return Math.min(count - 1, index + 1);
    return null;
  }
  const clamp = value => Math.max(0, Math.min(1, value));
  function point(client, bounds) {
    if (bounds.width <= 0 || bounds.height <= 0) return null;
    return {x: clamp((client.x - bounds.left) / bounds.width), y: clamp((client.y - bounds.top) / bounds.height)};
  }
  function region(a, b) {
    return {x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y)};
  }
  function fit(natural, viewport) {
    return Math.max(0.05, Math.min(1, Math.max(0, viewport.width - 48) / natural.width, Math.max(0, viewport.height - 48) / natural.height));
  }
  const ZOOM = [10, 25, 50, 100, 150, 200, 300, 400];
  function zoomStep(percent, delta) {
    return delta > 0 ? ZOOM.find(n => n > percent) || 400 : [...ZOOM].reverse().find(n => n < percent) || 10;
  }
  const RATIOS = ['1:1', '3:4', '9:16', '4:3', '16:9'];
  function commentPrompt(file, comments) {
    return `请按以下批注修改图片「${file.file}」，生成新文件并保留原图：\n` + comments.map((c, i) => {
      const pct = n => `${Math.round(n * 100)}%`;
      const r = c.region;
      return `${i + 1}. 位置 ${pct(r.x)}, ${pct(r.y)}；区域 ${pct(r.width)} × ${pct(r.height)}：${c.text}`;
    }).join('\n');
  }
  function resizePrompt(file, ratio) {
    if (!RATIOS.includes(ratio)) return null;
    return `请把图片「${file.file}」调整为 ${ratio}，保留主体和原有风格；生成新文件并保留原图。`;
  }
  function filePath(file, root) {
    const path = file.file || file.name;
    return /^(?:[\/~]|[a-z]:[\\/])/i.test(path) || !root ? path : `${root.replace(/[\\/]$/, '')}/${path}`;
  }
  const appendDraft = (draft, addition) => draft ? `${draft}\n\n${addition}` : addition;
  const clampZoom = n => Math.max(10, Math.min(400, Number.isFinite(n) ? n : 100));
  const wheelZoom = (zoom, delta) => clampZoom(Math.round(zoom * Math.exp(-delta * .01)));
  const pinchZoom = (zoom, before, after) => before > 0 ? clampZoom(zoom * after / before) : clampZoom(zoom);
  function playback(media) {
    return {time: Number.isFinite(media.currentTime) ? media.currentTime : 0, paused: media.paused, volume: media.volume, muted: media.muted, rate: media.playbackRate};
  }
  function mergeAttachments(existing, incoming, limit = 8) {
    const merged = [...existing];
    for (const file of incoming) if (!merged.some(old => old.url === file.url)) merged.push(file);
    if (merged.length > limit) throw new Error(`最多附上 ${limit} 个文件；请先移除部分附件。`);
    return merged;
  }
  function batchPrompt(files, comments) {
    return files.map(file => commentPrompt(file, comments[file.id] || [])).join('\n\n');
  }
  window.BC_MEDIA_PREVIEW = {kind, filePath, gallery, galleryKey, point, region, fit, zoomStep, ZOOM, RATIOS, commentPrompt, resizePrompt, appendDraft, clampZoom, wheelZoom, pinchZoom, playback, mergeAttachments, batchPrompt};
})();
