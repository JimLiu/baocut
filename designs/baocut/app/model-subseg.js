/* 字幕轨的**段**（第 244 轮）：一层字幕由几份字幕文档拼成时怎么称呼、怎么挑。

   纪录片一类的视频按片段各自转录：旁白分十一段，每段采访一份原文、一份译文，于是
   「画面上」那条轨条按文档列会冒出三十多枚 chip。裁决是**一枚 chip ＝ 一层**（原文 /
   译文 ＋ 语言）：同一层的各段收成一枚，chip 上印段数；× 拿下整层、幽灵 chip 放回整层；
   样式与倒转作用于整层。校对列表仍一次改一段，所以选中的层多于一段时轨条下面多一行
   「段落」选择器，默认落在播放头所在那一段。

   原型里一层就是一条字幕轨（`BC_SUB.tracks`），段是轨上可选的 `segments`
   （`[{id, start, end, source}]`，秒）。没有 `segments` 的轨就是一段，原有演示不变。
   这里只放算出来的东西：段数、chip 上的字、播放头落在哪一段、段的叫法、演示开关与
   纪录片那一份演示轨集。不依赖别的 `BC_*` 模块。 */
(function () {
  /** 一条轨上的段，按开始时刻排好。没有段返回空数组。 */
  function segments(t) {
    return t && Array.isArray(t.segments) ? t.segments.slice().sort((a, b) => a.start - b.start) : [];
  }
  /** chip 上算几段：没有 `segments` 的轨算一段。 */
  function count(t) { return segments(t).length || 1; }
  /** 多于一段才需要轨条下面那一行段落选择器。 */
  function hasRow(t) { return segments(t).length > 1; }

  /** chip 上的字：原文写「原文」，画面上（含拿下的）有两层原文时带上语言「原文 · English」；
   *  译文写语言名。`all` 是参与比较的那一组轨（画面上的 ＋ 拿下的），拿下一层原文时
   *  另一层的叫法不跟着跳。 */
  function chipLabel(t, all) {
    if (!t) return '';
    const name = t.name || t.lang || '';
    if (t.role !== 'source') return name;
    const sources = (all || []).filter((x) => x && x.role === 'source').length;
    return sources > 1 ? '原文 · ' + name : '原文';
  }

  /** 播放头落在哪一段：落在段内取那一段；落在段与段之间取最近开始过的那一段；
   *  比第一段还早取第一段。没有段返回 null。 */
  function segmentAt(t, time) {
    const list = segments(t);
    if (!list.length) return null;
    const x = Number(time) || 0;
    const inside = list.find((s) => s.start <= x && x < s.end);
    if (inside) return inside;
    const before = list.filter((s) => s.start <= x);
    return before.length ? before[before.length - 1] : list[0];
  }

  /** 这一段的画面需要这条轨吗：没有段的轨恒在；有段的只在某一段覆盖 `time` 时在。 */
  function covers(t, time) {
    const list = segments(t);
    return !list.length || list.some((s) => s.start <= time && time < s.end);
  }

  function mmss(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  /** 段落选择器里一段的叫法：开始时刻 · 素材名（`0:54 · 实拍 IzV8Vzekqg0`）。 */
  function segmentLabel(seg) {
    return seg ? mmss(seg.start) + (seg.source ? ' · ' + seg.source : '') : '';
  }

  /* ---------- 演示：纪录片形态 ----------
     地址的 hash 前加 `?subdemo=documentary` 打开。默认演示不受影响。 */
  const DEMO = 'documentary';
  function demo(search) {
    return new RegExp('[?&]subdemo=' + DEMO + '(?:&|$)').test(String(search || ''));
  }

  const CLIPS = ['IzV8Vzekqg0', 'q3RkT0wbL1s', 'Hn7cXe2PaZg', 'u0YbM4dKfQw', 'Lr9sGt6VnEo',
    'cP2wJx8HmTa', 'Zk5eRb1NqUy', 'tW4hDs7LcXi', 'Ej8oQv3YgBn', 'mA6fKu0ZrPd', 'Gx1nVc9TsHl'];

  /** 纪录片那一份轨集：旁白一层原文（源语言，11 段）、采访一层原文（另一门语言，11 段，
   *  每段一条实拍素材）、采访的译文一层（源语言，11 段，与采访同起止）。
   *  `base` 是默认那一对 `[译文轨, 源语言轨]`，涂装从它们拿；`total` 是视频总长（秒）。
   *  旁白与采访在时间上交替，一个时刻画面上只有旁白一行，或采访原文 ＋ 译文两行。 */
  function documentaryTracks(base, total) {
    const trans = (base || []).find((t) => t.role !== 'source');
    const src = (base || []).find((t) => t.role === 'source');
    if (!trans || !src) return base || [];
    const n = CLIPS.length;
    const slot = (Number(total) || 0) / (n * 2);
    const at = (i) => +(i * slot).toFixed(2);
    const narr = [], iv = [], tr = [];
    for (let i = 0; i < n; i++) {
      const no = String(i + 1).padStart(2, '0');
      narr.push({id: 'narr-' + no, start: at(2 * i), end: at(2 * i + 1), source: '旁白 ' + no});
      iv.push({id: 'iv-' + no, start: at(2 * i + 1), end: at(2 * i + 2), source: '实拍 ' + CLIPS[i]});
      tr.push({id: 'iv-tr-' + no, start: at(2 * i + 1), end: at(2 * i + 2), source: '实拍 ' + CLIPS[i]});
    }
    const narration = Object.assign({}, src, {size: 28, y: 90, valign: 'bottom', segments: narr});
    const interview = Object.assign({}, src, {
      id: trans.id, lang: trans.lang, name: trans.name, role: 'source',
      size: 20, y: 93, valign: 'bottom', segments: iv});
    const translation = Object.assign({}, trans, {
      id: src.id + '-tr', lang: src.lang, name: src.name, role: 'translation', of: interview.id,
      size: 32, y: 86, valign: 'bottom', segments: tr});
    // 数组序只管时间轴行序：译文在前、原文在后（同 BC_SUB.place）
    return [translation, narration, interview];
  }

  window.BC_SUBSEG = {
    segments, count, hasRow, chipLabel, segmentAt, covers, segmentLabel, mmss,
    DEMO, demo, documentaryTracks,
  };
})();
