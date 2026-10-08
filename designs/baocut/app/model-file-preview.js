/* 文件标签页的格式选择与文本解析。产品设计 §3.3；原型仅显示用户主动选择的文件或演示文件。 */
(function () {
  function kind(name, contentKind) {
    if (typeof contentKind === 'string') {
      if (contentKind === 'binary' || contentKind === 'archive') return null;
      if (contentKind === 'pdf' || contentKind === 'image' || contentKind === 'audio' || contentKind === 'video') return contentKind;
      if (contentKind === 'text' && /\.pdf$/i.test(name)) return 'text';
    }
    const ext = String(name || '').split('.').pop().toLowerCase();
    if (ext === 'pdf') return 'pdf';
    if (['html', 'htm'].includes(ext)) return 'html';
    if (['csv', 'tsv'].includes(ext)) return 'table';
    if (ext === 'json') return 'json';
    if (['md', 'markdown'].includes(ext)) return 'markdown';
    return 'text';
  }
  function table(text, delimiter) {
    const rows = []; let row = [], cell = '', quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (ch === '"') {
        if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
        else if (quoted || cell === '') quoted = !quoted;
        else cell += ch;
      } else if (ch === delimiter && !quoted) { row.push(cell); cell = ''; }
      else if ((ch === '\n' || ch === '\r') && !quoted) {
        if (ch === '\r' && source[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (quoted) return {error: '引号没有闭合，请切换到源码查看。', rows: []};
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return {rows, error: null};
  }
  function json(text) {
    try { return {text: JSON.stringify(JSON.parse(text), null, 2), error: null}; }
    catch { return {text, error: 'JSON 格式有误，已保留原文。'}; }
  }
  function linkedFile(href, files, dir) {
    let path;
    try { path = decodeURIComponent(href).replace(/^\.\//, ''); } catch { return null; }
    return files.find(file => !file.trashed && file.dir === dir && (file.file === path || file.name === path)) || null;
  }
  Object.assign(window, {BC_FILE_PREVIEW: {kind, table, json, linkedFile}});
})();
