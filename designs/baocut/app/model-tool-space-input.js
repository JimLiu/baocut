/* 工具的 Space 输入（product-design §2.7「页面」第 1 条、§4.5「用工具处理…」；architecture §7.9 工具输入种类）——
   window.BC_TOOL_SPACE_INPUT。纯函数，无 React、无 DOM；只在 App 入口加载。

   哪个工具收哪几种 Space 条目，只在工具目录（model-tools.js 的 `inputs`）声明一次；这里从声明派生两个方向：
   - 工具 → 条目：Space 选择器的候选（`candidates`）。只列这个工具收的种类，回收站里的不列；能选的排前面，
     不能选的置灰并写清原因（生成中、文件缺失、视频还没有文稿……）；
   - 条目 → 工具：Space 查看器的「用工具处理…」（`toolsFor`）。
   另外算：选中的条目让这次运行怎么走（`runInput`：可编辑的视频写进它，其余当文件用）、
   从文档 / 字幕取文字（`textOf`）与生成语音的字数上限检查（`textCheck`，超了拒绝、不截断）、工具页挂载时的预设（`fromPreset`）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const T = () => root.BC_TOOLS;
  const TT = () => root.BC_TOOL_TARGETS;

  const KIND_LABEL = {movie: '视频', final: '视频文件', audio: '音频', image: '图片', subtitle: '字幕', doc: '文档', template: '模板'};
  /* 视频条目对各工具的要求（与 BC_TOOL_TARGETS.NEEDS 同一张表） */
  const MOVIE_NEEDS = {transcribe: 'media', translate: 'transcript', dub: 'transcript'};

  /** 工具声明里的 space 输入；`attach` = 取附加材料那一项 */
  function spaceInput(toolId, attach) {
    const t = T().toolById(toolId);
    return t ? t.inputs.find((i) => i.kind === 'space' && !!i.attach === !!attach) || null : null;
  }
  /** 这个工具在 Space 选择器里收哪几种条目；不收 Space 输入 → [] */
  function kindsFor(toolId, attach) {
    const i = spaceInput(toolId, attach);
    return i ? i.kinds.slice() : [];
  }
  /** 条目本身的状态挡不挡（与工具无关）：回收站、生成中、缺失、失败 */
  function stateReason(entry) {
    if (entry.trashed) return '在回收站里';
    if (entry.status === 'generating') return '还在生成，完成后才能选';
    if (entry.status === 'missing') return '文件找不到，接回之后再选';
    if (entry.status === 'failed') return '上次生成失败';
    return null;
  }

  /**
   * 这个条目对这个工具来说为什么不能选；能选 → null。
   * @param {{movie?: object, attach?: boolean}} [opt] `movie`：视频条目对应的视频记录（看有没有文稿）；`attach`：按附加材料那一项判断
   */
  function reasonFor(toolId, entry, opt) {
    const o = opt || {};
    if (!entry) return '没有选中条目';
    const kinds = kindsFor(toolId, o.attach);
    if (kinds.indexOf(entry.kind) < 0) return `这个工具不收${KIND_LABEL[entry.kind] || '这种条目'}`;
    /* 视频条目的「失败」是上次转录失败：对转录来说正是要重试的那部（product-design §4.4「重试转录…」），交给 blockReason 判 */
    const retryable = entry.kind === 'movie' && entry.status === 'failed' && MOVIE_NEEDS[toolId] === 'media';
    const st = retryable ? null : stateReason(entry);
    if (st) return st;
    if (entry.kind === 'movie' && o.movie && MOVIE_NEEDS[toolId] && TT()) {
      return TT().blockReason(toolId, o.movie, TT().facts(o.movie));
    }
    if ((entry.kind === 'doc' || entry.kind === 'subtitle') && entry.text === '') return '这份内容是空的';
    return null;
  }

  /**
   * Space 选择器的候选：只列这个工具收的种类，回收站里的不列；能选的排前面，同组内按最近活动（`mtime` 越小越近）。
   * @param {Array} items Space 条目（BC_SPACE.items 的投影）
   * @param {{q?: string, attach?: boolean, movies?: Array}} [opt] `movies`：视频记录，用来判断视频有没有文稿、标出语言
   * @returns {Array<{id, entry, kind, kindLabel, name, eligible, reason, tags}>}
   */
  function candidates(toolId, items, opt) {
    const o = opt || {};
    const kinds = kindsFor(toolId, o.attach);
    const q = String(o.q || '').trim().toLowerCase();
    const byId = {};
    (o.movies || []).forEach((m) => { byId[m.id] = m; });
    const rows = (items || []).filter((it) => it && !it.trashed && kinds.indexOf(it.kind) >= 0)
      .filter((it) => !q || String(it.name || '').toLowerCase().indexOf(q) >= 0)
      .map((it, i) => {
        const movie = it.kind === 'movie' ? byId[it.movie || it.id] || null : null;
        const reason = reasonFor(toolId, it, {movie, attach: o.attach});
        const tags = movie && TT() ? TT().tags(TT().facts(movie)) : [];
        return {id: it.id, entry: it, kind: it.kind, kindLabel: KIND_LABEL[it.kind] || it.kind, name: it.name, eligible: !reason, reason, tags,
          mtime: it.mtime != null ? it.mtime : Infinity, idx: i};
      });
    return rows.sort((a, b) => (Number(b.eligible) - Number(a.eligible)) || (a.mtime - b.mtime) || (a.idx - b.idx));
  }

  /**
   * 条目 → 收它的工具（Space 查看器「用工具处理…」，§4.5）。回收站里的条目 → []。
   * 附加材料也算（文档、字幕可以带进文本生成）。`reason`：给了视频记录时，视频还不能用于这个工具的原因。
   * @returns {Array<{id, name, icon, navIcon, attach, reason}>}
   */
  function toolsFor(entry, opt) {
    if (!entry || entry.trashed) return [];
    const o = opt || {};
    return T().TOOLS.filter((t) => !t.planned).map((t) => {
      const i = t.inputs.find((x) => x.kind === 'space' && x.kinds.indexOf(entry.kind) >= 0);
      if (!i) return null;
      return {id: t.id, name: t.name, icon: t.icon, navIcon: t.navIcon, attach: !!i.attach,
        reason: reasonFor(t.id, entry, {movie: o.movie, attach: i.attach})};
    }).filter(Boolean);
  }

  /** 选中的条目让这次运行怎么走：可编辑的视频 → 'video'（写进它），其余 → 'file'（按文件处理，结果是新条目） */
  const runInput = (entry) => (entry && entry.kind === 'movie' ? 'video' : 'file');

  /** 文档 / 字幕条目的文字：字幕去掉序号与时间码，只留台词 */
  function textOf(entry) {
    if (!entry) return '';
    if (entry.kind === 'subtitle') {
      if (entry.cues && entry.cues.length) return entry.cues.map((c) => c.text).join('\n');
      return String(entry.text || '').split(/\r?\n/).filter((l) => l.trim() && !/^\d+$/.test(l.trim()) && l.indexOf('-->') < 0).join('\n');
    }
    return String(entry.text || '');
  }
  /**
   * 生成语音取条目的文字（§2.7 表二「生成语音」）：超过上限时拒绝，报出字数与上限，不截断。
   * @returns {{ok: boolean, text: string, chars: number, error: string|null}}
   */
  function textCheck(entry, max) {
    const text = textOf(entry).trim();
    const chars = text.length;
    const cap = max || T().MAX_CHARS;
    if (!chars) return {ok: false, text: '', chars: 0, error: `「${entry ? entry.name : ''}」里没有可以念的文字`};
    if (chars > cap) return {ok: false, text: '', chars, error: `「${entry.name}」有 ${chars} 字，超过一次 ${cap} 字的上限。先拆成几份再生成，这里不截断。`};
    return {ok: true, text, chars, error: null};
  }

  /**
   * 工具页挂载时取到的预设（store 的 takeToolPreset）→ 输入：`{source: 'space', entry, attach}`；条目不收或没有 → null。
   * 从 Space 查看器「用工具处理…」与结果页「接着用工具」进来时输入已经选好（§2.7、§4.5）。
   */
  function fromPreset(toolId, preset) {
    const entry = preset && preset.entry;
    if (!entry || entry.trashed) return null;
    if (kindsFor(toolId).indexOf(entry.kind) >= 0) return {source: 'space', entry, attach: false};
    if (kindsFor(toolId, true).indexOf(entry.kind) >= 0) return {source: 'space', entry, attach: true};
    return null;
  }

  root.BC_TOOL_SPACE_INPUT = {KIND_LABEL, kindsFor, stateReason, reasonFor, candidates, toolsFor, runInput, textOf, textCheck, fromPreset};
})();
