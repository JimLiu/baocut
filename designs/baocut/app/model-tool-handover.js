/* 「交给 Agent」（product-design §2.7「结果与下一步」、§4.7）：把工具的结果作为引用带进会话，输入框里预填一句可以改写的说明，
   由用户发送、不自动发送。这里只算那句草稿与引用的形状；放进哪个会话由 store 决定。 */
(function () {
  /* 按结果种类给一句缺省意图；`intent` 给了时用它。句子里不写文件路径，引用标签会带位置。 */
  const DEFAULTS = {
    subtitle: '把这份字幕翻译成英文，保持时间码不变。',
    doc: '根据这份文稿写一篇摘要。',
    audio: '用这段音频做一部视频。',
    image: '以这张图片为封面做一部视频。',
    final: '给这个视频加上字幕。',
    movie: '继续修改这部视频。',
  };
  /** 结果条目 → `{text, reference}`：`text` 是预填的草稿，`reference` 是输入框里的引用标签（只有元数据） */
  function draft(entry, intent) {
    if (!entry || !entry.id) return null;
    const text = (typeof intent === 'string' && intent.trim()) || DEFAULTS[entry.kind] || '接着处理这个结果。';
    return {
      text,
      reference: {id: entry.id, kind: entry.kind || 'doc', name: entry.name || '', dir: entry.dir || null, file: entry.file || null},
    };
  }
  const api = {DEFAULTS, draft};
  if (typeof window !== 'undefined') window.BC_HANDOVER = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
