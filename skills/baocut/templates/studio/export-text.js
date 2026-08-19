// BaoCut Subtitle Studio — 导出对话框的纯文本产物与命名规则（window.BCS_EXPORT_TEXT）。
//
// 对应 Mac：apps/mac/Sources/VoiceInk/Export/ExportNaming.swift（文件名）、
// ExportFormatters.swift（slug / 时间码）、Adapters/ExportDomainAdapter.swift 的
// buildMarkdown / buildSubtitleOutput（转录稿 Markdown 与字幕事件）；CLI 侧真相是
// apps/cli/src/cmd/media/subtitles.rs 的 render_subtitle_events / speaker_prefix
// 与 support.rs 的 render_markdown。
//
// 前端能算的才放进来：Web Studio 没有 ASS（样式表要靠 CLI 合成）、没有剪辑段
// （Studio 投影已经把时间轴投影成 timelineCues），所以这里只有 SRT / VTT /
// Markdown 三种纯文本，外加与 Mac 一致的文件名策略。
//
// 已知差异（与 Mac 对话框同款、都写在 buildSubtitleOutput 的 KNOWN GAPS 里）：
// 文本不过投递期标点投影（style.punct 只影响画面预览），双语按源 Cue 中点配对
// 译文行而不是走 union_events。
//
// UMD：无 React/Konva 依赖，node --test 可直接加载。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_EXPORT_TEXT = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const trimmed = (value) => String(value == null ? '' : value).trim();
  const pad = (n, w) => String(n).padStart(w, '0');

  // ---------- 时间码 ----------
  // mm:ss / hh:mm:ss —— 与 util.jsx 的 fmt()、Mac Formatting.swift 的 fmtTime 同格式，
  // Markdown 的段落时间戳用它。
  function clockTime(seconds) {
    const t = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    const tail = pad(m, 2) + ':' + pad(s, 2);
    return h ? pad(h, 2) + ':' + tail : tail;
  }

  // 字幕时间码。SRT 用逗号、VTT 用点，其余一致（CLI subtitle_time 同构）。
  function stampTime(seconds, decimal) {
    const t = Math.max(0, Number(seconds) || 0);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
    const ms = Math.min(999, Math.round((t % 1) * 1000));
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + decimal + pad(ms, 3);
  }
  const srtTime = (t) => stampTime(t, ',');
  const vttTime = (t) => stampTime(t, '.');

  // ---------- 文件名（ExportNaming.swift） ----------
  function slug(title) {
    const value = trimmed(title).toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '');
    return value || 'untitled';
  }

  // BCP-47 → 文件名用的短码。Mac 保留 ja→jp 这个产品侧别名，其余按标签大小写规范化；
  // 非法/自动检测一律 'und'。（Mac 还会先把显示名查一遍语言目录，Web 的
  // doc.meta.*Lang.code 本来就是 BCP-47，所以这一步不需要。）
  function languageCode(raw) {
    const value = trimmed(raw);
    if (!value || /^(auto(?:-detect)?|automatic|—)$/i.test(value)) return 'und';
    const parts = value.replace(/_/g, '-').split('-');
    if (!/^[a-z]{2,3}$/i.test(parts[0])) return 'und';
    if (parts.slice(1).some((part) => !/^[a-z0-9]{1,8}$/i.test(part))) return 'und';
    if (parts[0].toLowerCase() === 'ja') return 'jp';
    return parts.map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^[a-z]{4}$/i.test(part)) return part[0].toUpperCase() + part.slice(1).toLowerCase();
      if (/^[a-z]{2}$/i.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    }).join('-');
  }

  // 名字跟着产物真正装了什么走：双语两码、译文单码、原文取源语言码。
  // 烧录原文的视频也带源语言码——它绝不能和源文件重名把源文件盖掉。
  function languageTag(content, sourceLang, targetLang) {
    const source = languageCode(sourceLang);
    const codes = content === 'bi' ? [source, languageCode(targetLang)]
      : content === 'trans' ? [languageCode(targetLang)]
      : [source];
    return codes.filter(Boolean).join('-');
  }

  const filename = (title, tag, ext) => slug(title) + (tag ? '-' + tag : '') + '.' + ext;
  // 视频用空格分隔（Mac videoFilename 同规则）：它的词干本来是源文件名，
  // Web 的 studio/data.json 不下发源文件路径，退回 Mac 自己的 slug(title) 兜底分支。
  const videoFilename = (title, tag) => slug(title) + (tag ? ' ' + tag : '') + '.mp4';

  // ---------- 说话人 ----------
  const speakerName = (doc, sp) => {
    const name = trimmed((((doc || {}).speakers || {})[sp] || {}).name);
    return name || 'Speaker';
  };

  // 开关是用户那一半答案，文档决定另一半：只有一位说话人时 CLI 一律不写名字
  // （render_markdown / speaker_prefix 都门控 speakers.len() > 1），所以这里也不许诺。
  function speakersOn(doc, on) {
    if (!on || !doc) return false;
    return Object.keys(doc.speakers || {}).length >= 2;
  }

  // ---------- 译文投影 ----------
  const compactScript = (lang) => ['zh', 'ja', 'ko', 'th']
    .includes(String(lang || '').toLowerCase().split(/[-_]/)[0]);

  function joinTexts(parts, lang) {
    return (parts || []).map(trimmed).filter(Boolean).join(compactScript(lang) ? '' : ' ');
  }

  const targetLanguage = (doc) => (((doc || {}).meta || {}).targetLang || {}).code || '';
  const sourceLanguage = (doc) => (((doc || {}).meta || {}).sourceLang || {}).code || '';

  // 段落译文，与 paragraphs 同序。一段译文归属它第一个词所在的段落——Mac
  // paragraphTranslations 与 CLI render_markdown 的分桶规则；Studio 投影里
  // Sentence 自带 paraId，直接用它，缺失时退回按 cueId 归属、再退回按起点落段。
  function paragraphTranslations(doc, paragraphs) {
    const list = paragraphs || [];
    const buckets = list.map(() => []);
    const byParaId = new Map();
    const byCueId = new Map();
    list.forEach((para, index) => {
      if (para.paraId) byParaId.set(para.paraId, index);
      (para.cues || []).forEach((cue) => { if (cue && cue.id != null) byCueId.set(String(cue.id), index); });
    });
    const lang = targetLanguage(doc);
    ((doc || {}).sentences || []).forEach((sentence) => {
      const text = trimmed(sentence.trans);
      if (!text) return;
      let index = sentence.paraId != null && byParaId.has(sentence.paraId)
        ? byParaId.get(sentence.paraId) : undefined;
      if (index === undefined) {
        const first = (sentence.cueIds || [])[0];
        if (first != null && byCueId.has(String(first))) index = byCueId.get(String(first));
      }
      if (index === undefined) {
        index = list.findIndex((para) => sentence.start >= para.start && sentence.start < para.end);
      }
      if (index === undefined || index < 0) return;
      buckets[index].push(text);
    });
    return buckets.map((parts) => joinTexts(parts, lang));
  }

  // ---------- 转录稿 Markdown（ExportDomainAdapter.buildMarkdown 孪生） ----------
  // 三个开关就是文件真正听的三个：--no-timestamps / --no-speakers / --no-chapters，
  // `# 标题` 与 `## 章节` 由同一个 render_markdown 写出。
  // 内容轴选正文：译文只印译文，没有译文的段整段丢掉（时间戳引出一段空白比缺一段更糟）；
  // 双语保留原文段并把译文另起一段放在它下面 —— 永远原文在前（order 是字幕排版字段，
  // 不进文本文档）。
  function markdown(doc, paragraphs, options) {
    const opts = options || {};
    const content = opts.content || 'orig';
    const list = paragraphs || [];
    const chapters = (doc || {}).chapters || [];
    const named = speakersOn(doc, opts.speakers);
    const targets = content === 'orig' ? list.map(() => '') : paragraphTranslations(doc, list);
    let output = '# ' + trimmed(opts.title) + '\n';
    let lastChapter = -1;
    list.forEach((para, index) => {
      const target = targets[index] || '';
      if (content === 'trans' && !target) return;
      // 章节标题归属「这一章里第一段活下来的段落」：首段没有译文时不该把整章标题带走。
      if (opts.chapters && para.ch !== lastChapter) {
        if (chapters[para.ch]) output += '\n## ' + chapters[para.ch].title + '\n';
        lastChapter = para.ch;
      }
      let prefix = '';
      if (opts.timestamps) prefix += '[' + clockTime(para.start) + '] ';
      if (named) prefix += '**' + speakerName(doc, para.sp) + ':** ';
      if (content === 'trans') output += '\n' + prefix + target + '\n';
      else if (content === 'bi' && target) output += '\n' + prefix + para.text + '\n\n' + target + '\n';
      else output += '\n' + prefix + para.text + '\n';
    });
    return output;
  }

  function wordCount(doc) {
    return ((doc || {}).cues || []).reduce((sum, cue) => sum + ((cue.words || []).length), 0);
  }

  // ---------- 字幕事件 ----------
  // 与 store.jsx exportSRT 同一套投影选择（时间轴投影优先）：
  //   orig —— 源 Cue 流；
  //   trans —— 译文自己的展示流（transCues），一条一事件，没有译文的句子不产生事件；
  //   bi —— 源 Cue 一条一事件，第二行取覆盖它中点的译文片。
  function subtitleEvents(doc, options) {
    const opts = options || {};
    const content = opts.content || 'orig';
    const cues = (doc || {}).timelineCues || (doc || {}).cues || [];
    const transCues = (doc || {}).timelineTransCues || (doc || {}).transCues || [];
    if (content === 'trans') {
      return transCues
        .filter((tc) => trimmed(tc.text))
        .map((tc) => ({ start: tc.start, end: tc.end, sp: tc.sp || '', lines: [tc.text] }));
    }
    return cues.filter((cue) => trimmed(cue.text)).map((cue) => {
      const mid = (cue.start + cue.end) / 2;
      const tc = content === 'bi'
        ? transCues.find((item) => mid >= item.start && mid < item.end) : null;
      const second = tc && trimmed(tc.text) ? tc.text : null;
      return {
        start: cue.start, end: cue.end, sp: cue.sp || '',
        lines: second ? [cue.text, second] : [cue.text],
      };
    });
  }

  // 「有多少条没有译文」——译文单语丢掉整条（留空），双语只丢第二行。两个内容轴
  // 丢的东西不同，所以文案也不同（Mac 的 missingTranslations 同款计数）。
  function missingTranslations(doc, content) {
    if (content === 'trans') {
      return ((doc || {}).sentences || []).filter((s) => !trimmed(s.trans)).length;
    }
    if (content !== 'bi') return 0;
    const transCues = (doc || {}).timelineTransCues || (doc || {}).transCues || [];
    const cues = (doc || {}).timelineCues || (doc || {}).cues || [];
    return cues.filter((cue) => {
      if (!trimmed(cue.text)) return false;
      const mid = (cue.start + cue.end) / 2;
      const tc = transCues.find((item) => mid >= item.start && mid < item.end);
      return !(tc && trimmed(tc.text));
    }).length;
  }

  // SRT 带序号、`[名字] ` 前缀写在正文里；VTT 无序号、说话人开 `<v 名字>` 声道。
  const speakerPrefix = (format, name) => {
    const value = trimmed(name);
    if (!value) return '';
    return format === 'vtt' ? '<v ' + value + '>' : '[' + value + '] ';
  };

  function render(doc, events, format, options) {
    const opts = options || {};
    const named = speakersOn(doc, opts.speakers);
    let output = format === 'vtt' ? 'WEBVTT\n\n' : '';
    (events || []).forEach((event, index) => {
      const stamp = format === 'vtt'
        ? vttTime(event.start) + ' --> ' + vttTime(event.end)
        : srtTime(event.start) + ' --> ' + srtTime(event.end);
      if (format !== 'vtt') output += (index + 1) + '\n';
      output += stamp + '\n';
      const body = event.lines.join('\n');
      output += (named ? speakerPrefix(format, speakerName(doc, event.sp)) : '') + body + '\n\n';
    });
    return output;
  }

  const subtitles = (doc, options) =>
    render(doc, subtitleEvents(doc, options), (options || {}).format || 'srt', options);

  return {
    clockTime, srtTime, vttTime,
    slug, languageCode, languageTag, filename, videoFilename,
    speakerName, speakersOn, speakerPrefix,
    joinTexts, paragraphTranslations, markdown, wordCount,
    subtitleEvents, missingTranslations, render, subtitles,
    sourceLanguage, targetLanguage,
  };
}));
