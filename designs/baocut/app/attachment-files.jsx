/* Browser File references live for the page lifetime, including sent messages and open tabs. */
(function () {
  const urls = new WeakMap();
  async function readAttachment(file) {
    const M = window.BC_ATTACHMENTS;
    const item = {id: `attachment:${crypto.randomUUID()}`, name: file.webkitRelativePath || file.name,
      mimeType: file.type, bytes: file.size};
    const type = M.kind(item);
    if(!file.size || file.size > 20 * 1024 * 1024) throw new Error('请选择大小大于 0 且不超过 20 MiB 的附件');
    if (type === 'image' && (!file.size || file.size > 20 * 1024 * 1024)) throw new Error('请选择不超过 20 MiB 的图片');
    item.kind = type === 'image' ? 'image' : ['audio','video'].includes(type) ? 'media' : 'doc';
    item.contentKind = type;
    if (type === 'text') {
      const head = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
      // Streaming decode accepts a UTF-8 character split by the sample boundary.
      let text;
      try { text = head.includes(0) ? null : new TextDecoder('utf-8', {fatal: true}).decode(head, {stream: file.size > head.length}); } catch { text = null; }
      if (text === null) item.contentKind = 'binary';
      else if (file.size > 10 * 1024 * 1024) item.previewTooLarge = true;
      else {
        const full = M.textContent(new Uint8Array(await file.arrayBuffer()));
        if (full === null) item.contentKind = 'binary';
        else item.text = full;
      }
    }
    if (!urls.has(file)) urls.set(file, URL.createObjectURL(file));
    item.url = urls.get(file);
    return item;
  }
  window.readComposerFiles = files => Promise.all(Array.from(files).map(readAttachment));
})();
