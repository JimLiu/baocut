/* 工具结果进入 Space，并可派生视频（product-design §4.5–§4.8）。 */
(function () {
  /* `final`：视频文件（从链接导入「只下载成文件」的结果，Space 把视频文件归在「成片」类） */
  function output(kind, record) {
    const r = record || {};
    if (!['audio', 'image', 'subtitle', 'doc', 'final'].includes(kind) || !r.id || !r.name) return null;
    /* 透传 toolId / tool、task（任务 id）、params（这次运行的参数）；file 是保存位置里的完整路径，缺省落在默认保存位置（BC_SAVE_DIR） */
    const dir = (typeof window !== 'undefined' && window.BC_SAVE_DIR && window.BC_SAVE_DIR.DEFAULT) || '~/Downloads';
    return {...r, id: `tool-${kind}-${r.id}`, kind, file: r.file || `${dir}/${r.name}`, toolId: r.toolId || r.tool || null, task: r.task || null, params: r.params || null,
      status: null, mtime: 0, tool: true, note: r.note || '工具生成的结果 · 交互原型使用示例内容'};
  }
  /** 产物 → 新视频的记录补丁。字幕没有来源媒体时要配上一份（`media`：选中的媒体文件名，§2.7「以此新建视频」）。 */
  function moviePatch(it, media) {
    const source = (it && it.sourceName) || media || null;
    if (!it || !['audio', 'subtitle'].includes(it.kind) || (it.kind === 'subtitle' && !source)) return null;
    const audio = it.kind === 'audio';
    return {origin: 'local', entry: audio ? 'a2v' : 'sub', title: it.name.replace(/\.[^.]+$/, ''),
      status: 'complete', duration: it.dur || 0, sourceOutput: it.id,
      src: {name: audio ? it.name : source, path: audio || it.sourceName ? it.sourceUrl || it.file : source, format: audio ? 'WAV' : '视频 / 音频', res: '', state: 'ok'},
      config: {wave: audio, subs: !audio, bg: 'gray'},
      initialCues: audio ? [] : (it.cues || []).map(c => ({...c})),
      model: it.model || '', lang: it.lang || '自动检测'};
  }
  function asrProvider(model) {
    if (!model) return null;
    if (model.id.startsWith('cloud:')) return model.id.slice(6).split('/')[0];
    return model.provider === 'OpenAI' ? 'openai' : null;
  }
  const api = {output, moviePatch, asrProvider};
  if (typeof window !== 'undefined') window.BC_HOME_TOOLS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
