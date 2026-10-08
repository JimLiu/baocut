/* BaoCut 原型 — 项目详情的行装配
   window.BC_PINFO。纯函数，无 React、无 DOM。

   与 `core/crates/bcut-editor-core/src/project_info.rs` 同形：两个入口（编辑器
   顶栏 ⓘ / 项目卡 ⋯ 菜单）共用同一份分区行，渲染与「复制全部」也共用同一份——
   屏幕上看得见的每一行都必须能原样粘出去，反过来复制文本里不出现屏幕上没有的行。

   三条与实现共享的语义：

   1. **缺的行整行省略，不写占位。** 没有媒体路径就没有「位置」行，不是「位置：—」；
      三段内容计数全 0 时整个「内容」行不出现，不是「0 位说话人」。空分区连标题一起丢。

   2. **内容与译文只有编辑器那条路给得出。** 说话人 / 章节 / 段落数和目标语来自已
      加载的文稿，项目卡那条路手上只有项目记录，那两行缺席。所以它们是调用方传进来
      的 `extras`，不在这一层从项目对象里猜。

   3. **省略号只进眼睛，不进剪贴板。** hero 那行的源文件名可以是一整段被当成文件名
      的标题，显示时中间省略（[elideMiddle](#elideMiddle)）；复制走的是完整值，
      「位置」行也始终是完整路径。原简介在框里限高滚动，复制同样是全文。

   网址导入的项目带着下载时记下的页面标题与简介（「原标题」「原简介」，YouTube 那一份）：
   原标题与项目标题一样时省略（hero 已经写着），改过名才有用；原简介是平台上的原文，
   和下面可编辑的「简介」不是一回事，所以名字前面带「原」。 */
(function () {
  /** hero 第二行（源文件名）在 500pt 对话框里放得下的字符数。 */
  const HERO_NAME_MAX = 56;

  /** 中间省略：留头留尾砍中段——尾巴留住扩展名，头部留住能认出是谁。 */
  function elideMiddle(value, max) {
    const chars = Array.from(value || '');
    if (chars.length <= max || max < 4) return value || '';
    const tail = Math.floor((max - 1) / 3);
    const head = max - 1 - tail;
    return chars.slice(0, head).join('') + '…' + chars.slice(chars.length - tail).join('');
  }

  /** 来源种类：网址导入 / 录屏 / 本地文件。 */
  function srcTypeLabel(p) {
    if (p && p.recording) return '录制';
    return p && p.url ? '网址导入' : '本地文件';
  }

  /** hero 那行的复制形态：`本地文件 · talk.mp4`。文件名缺席时只剩种类。 */
  function heroLine(p) {
    const name = ((p && p.src && p.src.name) || '').trim();
    return name ? `${srcTypeLabel(p)} · ${name}` : srcTypeLabel(p);
  }

  function row(label, value, mono, extra) {
    return Object.assign({label, value, mono: !!mono}, extra || {});
  }

  /** 千分位。App v2 `fmt_count` 同口径。 */
  function fmtCount(n) {
    const digits = Math.abs(n).toString();
    let out = '';
    for (let i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
      out += digits[i];
    }
    return n < 0 ? '-' + out : out;
  }

  /** `20260420` → `2026-04-20`；不是八位数字就整行不出。 */
  function prettyDate(raw) {
    if (typeof raw !== 'string' || !/^\d{8}$/.test(raw)) return null;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  }

  /** 内容那一行：`3 位说话人 · 4 章 · 62 段`。为 0 的段省略，全 0 整行缺席。 */
  function contentsRow(speakers, chapters, segments) {
    const parts = [];
    if (speakers > 0) parts.push(`${speakers} 位说话人`);
    if (chapters > 0) parts.push(`${chapters} 章`);
    if (segments > 0) parts.push(`${segments} 段`);
    return parts.length ? row('内容', parts.join(' · ')) : null;
  }

  /** 译文那一行。没有译文时缺席——目标语只有文稿里才有。 */
  function translationRow(target) {
    const value = (target || '').trim();
    return value ? row('译文', value) : null;
  }

  /** 编辑器入口多出来的两行，顺序即渲染顺序。 */
  function editorExtras(p) {
    const meta = (p && p.meta) || {};
    return [
      contentsRow(meta.speakers || 0, meta.chapters || 0, meta.cues || 0),
      translationRow(p && p.tlang),
    ].filter(Boolean);
  }

  /** 来源与媒体：位置 → 媒体（时长 · 分辨率 · 格式）→ 转录（模型 · 语言）。 */
  function mediaRows(p, durationText) {
    const rows = [];
    const path = ((p.src && p.src.path) || '').trim();
    // `reveal`：这一行的值是磁盘上的位置，框里在它旁边放「在文件夹中显示」（表面能做到时）。
    if (path) rows.push(row('位置', path, true, {reveal: path}));
    const media = [durationText];
    if (p.src && p.src.res) media.push(p.src.res);
    if (p.src && p.src.format) media.push(p.src.format);
    rows.push(row('媒体', media.filter(Boolean).join(' · ')));
    if (p.model || p.lang) rows.push(row('转录', [p.model, p.lang].filter(Boolean).join(' · ')));
    return rows;
  }

  /** 来源信息：只有从网址导入的项目才有，逐项按存在与否放行。 */
  function metaRows(p) {
    const s = p.source;
    if (!s) return [];
    const rows = [];
    const title = (s.title || '').trim();
    if (title && title !== (p.title || '').trim()) rows.push(row('原标题', title));
    if (s.uploader) rows.push(row('频道', s.uploader));
    const date = prettyDate(s.publishedAt);
    if (date) rows.push(row('发布', date));
    if (s.platform) rows.push(row('平台', s.platform));
    if (typeof s.views === 'number' && s.views >= 0) rows.push(row('播放量', fmtCount(s.views)));
    if (s.videoId) rows.push(row('视频 ID', s.videoId, true));
    const desc = (s.desc || '').trim();
    // 原简介可以很长（YouTube 上限五千字）：`long` 让框里限高滚动，复制仍是全文。
    if (desc) rows.push(row('原简介', desc, false, {long: true}));
    return rows;
  }

  const SECTION_MEDIA = '来源与媒体';
  const SECTION_SOURCE = '来源信息';
  const SECTION_DETAILS = '详情';

  /** 只读区的全部分区。`extras` 接在媒体分区尾巴上；空分区整个丢掉。 */
  function sections(p, durationText, extras) {
    return [
      {title: SECTION_MEDIA, rows: mediaRows(p, durationText).concat(extras || [])},
      {title: SECTION_SOURCE, rows: metaRows(p)},
    ].filter((s) => s.rows.length);
  }

  /** 可编辑三项在「复制全部」里的那一段（标题是复制文本的第一行，不进来）。 */
  function detailsSection(url, desc, notes) {
    const rows = [];
    [['网址', url], ['简介', desc], ['备注', notes]].forEach(([label, value]) => {
      const v = (value || '').trim();
      if (v) rows.push(row(label, v));
    });
    return rows.length ? {title: SECTION_DETAILS, rows} : null;
  }

  /** 一段可直接粘贴的纯文本：标题、hero 各一行，分区之间空行，值内换行缩进两格。 */
  function copyText(title, hero, list) {
    const lines = [];
    if ((title || '').trim()) lines.push(title.trim());
    if ((hero || '').trim()) lines.push(hero.trim());
    (list || []).forEach((s) => {
      lines.push('');
      lines.push(s.title);
      s.rows.forEach((r) => lines.push(`${r.label}: ${r.value.replace(/\n/g, '\n  ')}`));
    });
    return lines.join('\n') + '\n';
  }

  window.BC_PINFO = {
    HERO_NAME_MAX, elideMiddle, srcTypeLabel, heroLine,
    contentsRow, translationRow, editorExtras,
    fmtCount, prettyDate, sections, detailsSection, copyText,
    SECTION_MEDIA, SECTION_SOURCE, SECTION_DETAILS,
  };
})();
