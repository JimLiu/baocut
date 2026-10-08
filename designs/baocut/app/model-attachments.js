/* 附件类型与预览记录；上传附件独立于 Space 产物。产品设计 §3.3。 */
(function () {
  function kind(file) {
    const mime = file.mimeType || file.type || '';
    const ext = (file.name || '').split('.').pop().toLowerCase();
    if (file.contentKind) return file.contentKind;
    if (mime.startsWith('image/') || ['png','jpg','jpeg','webp','gif','svg','avif','bmp'].includes(ext) || file.kind === 'image') return 'image';
    if (mime.startsWith('audio/') || ['wav','mp3','aac','m4a','flac','ogg','opus'].includes(ext)) return 'audio';
    if (mime.startsWith('video/') || ['mp4','mov','m4v','webm','mkv'].includes(ext)) return 'video';
    if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
    return file.kind === 'media' ? 'video' : 'text';
  }
  function textContent(bytes) {
    if (bytes.includes(0)) return null;
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { return null; }
  }
  function record(item) {
    return {id: item.id, name: item.name, file: item.name, kind: kind(item) === 'image' ? 'image' : 'doc',
      contentKind: kind(item), previewSrc: item.url, text: item.text, bytes: item.bytes,
      previewTooLarge: item.previewTooLarge, attachment: true};
  }
  function mime(item) {
    const type = kind(item);
    return item.mimeType || ({image: 'image/png', video: 'video/mp4', audio: 'audio/mpeg', pdf: 'application/pdf'}[type] || 'text/plain');
  }
  window.BC_ATTACHMENTS = {kind, textContent, record, mime};
})();
