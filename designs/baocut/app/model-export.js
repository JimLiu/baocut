/* 导出的纯模型 —— 第 120 轮（§17.1）。window.BC_EXPORT。纯函数，无 React、无 DOM。

   三件事都从 timeline 派生，不另立「原文 / 译文 / 双语」这种与轨集平行的设置：

     · lanes()   把时间轴的行变成导出面板上的「画面里有什么」清单——字幕轨逐条列、
                 元素合成一组、音频 / 音乐各一条。每条的初值就是时间轴上的启停位。
     · apply()   叠一层**只对这次导出生效**的覆盖表：临时关掉一条轨不写时间轴。
                 想把这次的取舍留下来，走 syncWrites() 一次写回时间轴（同一套写路径）。
     · range     整片 / 按章节 / 按片段 / 自定义（第 239 轮重拾并放宽，见 spanOf）。
                 章节与片段可多选；自定义是一对起止。时间一律按源时间线。
     · quality   体积档：省空间 / 标准 / 高画质，只缩放码率——改体积不改耗时。
     · res       分辨率的值是**短边像素**：默认原始分辨率（源短边，裁切后算），
                 比它高的档一律不列——放大渲染只会让画面更糟（resChoices）。

   任务侧的两张小表（`TASK_LABEL` / `cancelCopy`）也放这里：顶栏胶囊、任务页与
   导出弹层的「取消」要念同一句话，不能三处三个版本。 */
(function () {
  /* 分辨率的值是**短边像素**（不是档位名）：默认就是源的短边，比它高的档一律不给——
     放大渲染不会把画面变好，只会让它更糟（§17.1）。标准档只在**低于**源短边时出现。 */
  const STD_SHORTS = [2160, 1080, 720];
  /* 源尺寸未知（纯音频项目、没探到尺寸）时的兜底短边，与内核 `source_height` 同口径。 */
  const FALLBACK_SHORT = 1080;
  /* 短边 → 预设码率（Mb/s）：取第一条不高于短边的。码率只决定体积，不决定耗时（§17.1 M122）。 */
  const RES_MBPS = [[2160, 30], [1440, 16], [1080, 8], [720, 4], [0, 2]];
  /* 体积档（第 239 轮）：对档位码率的倍率。内核只按 H.264 写、HEVC 只读不写（native_video），
     所以「压缩体积」只有码率这一根杠杆；导出码率仍取「档位预设 × 倍率」与源码率的较小者。 */
  const QUALITY = {
    small: {label: '省空间', factor: 0.5, note: '码率减半，画面细节略少'},
    standard: {label: '标准', factor: 1, note: ''},
    high: {label: '高画质', factor: 1.5, note: '码率上浮一半，不高于源码率'},
  };
  const QUALITY_KEYS = ['small', 'standard', 'high'];
  /* 耗时模型（§17.1 M122）：帧数 × k × 输出百万像素，k 默认 2.10 ms/(帧·Mpx)，30 fps。 */
  const K_MS_PER_FRAME_MPX = 2.10;
  const FPS = 30;

  const even = (n) => Math.round(n / 2) * 2;

  /** 画幅串 → 宽÷高；认不出来（含 `Original`）返回 null。 */
  function ratioValue(ratio) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(ratio || ''));
    if (!m) return null;
    const a = +m[1], b = +m[2];
    return a > 0 && b > 0 ? a / b : null;
  }

  /** 输出尺寸：短边由分辨率定，长边按画幅比推。竖幅 9:16 的短边 1080 是 1080×1920，
   *  不是 1920 压成 608 宽——短边才是分辨率承诺的东西。 */
  function dims(short, ratio) {
    const s = +short > 0 ? Math.round(+short) : FALLBACK_SHORT;
    const r = ratioValue(ratio) || 16 / 9;
    if (r >= 1) return {w: even(s * r), h: s};
    return {w: s, h: even(s / r)};
  }

  /** 短边 → 展示名：2160 念「4K」，其余念「{短边}p」。非标准短边照实念（`1440p` / `608p`）。 */
  function resLabel(short) {
    const s = +short > 0 ? Math.round(+short) : FALLBACK_SHORT;
    return s === 2160 ? '4K' : s + 'p';
  }

  /** 源尺寸 + 目标画幅 → 这次导出「原始分辨率」的短边；源尺寸未知（纯音频项目）返回 null。
   *
   *  裁切先于缩放：竖幅 1080×1920 源导 16:9 得到 1080×608，这次的原始分辨率就是 608
   *  而不是 1920——按未裁的高度标注会把一个 1080×608 的文件写成 1920p。
   *  `res` 收 `'1920×1080'` 这种串（`proj.src.res`），也收 `{w, h}`。 */
  function sourceShort(res, ratio) {
    let w = 0, h = 0;
    if (res && typeof res === 'object') { w = +res.w; h = +res.h; }
    else { const p = String(res || '').split(/[×x]/); w = +p[0]; h = +p[1]; }
    if (!(w > 0 && h > 0)) return null;
    const r = ratioValue(ratio) || w / h;
    const ch = w / h > r ? even(h) : Math.min(even(h), even(w / r));
    const cw = even(ch * r);
    return Math.max(2, Math.min(cw, ch));
  }

  /** 多个视频源时的「原始分辨率」短边（2026-09-13；2026-09-16 起没有主视频）：转录源
   *  （`mainRes`，可能未知）与时间轴上每个可见视频元素各自按**这次导出的画幅** cover 裁切后
   *  量短边，取最大。画幅（舞台）由 `ratio` 定，认不出时跟第一个认得出尺寸的源；各源不改画幅，
   *  只抬高原始那一档——640×360 的原片配 1080p 的 B-roll，16:9 导出的原始档是 1080。
   *  转录源尺寸未知时仍从视频元素里取；一个都不知道（纯音频项目）才返回 null，走兜底。 */
  const resPair = (res) => {
    if (!res) return null;
    const p = typeof res === 'object' ? [+res.w, +res.h] : String(res).split(/[×x]/).map(Number);
    return p[0] > 0 && p[1] > 0 ? p : null;
  };
  function exportShort(mainRes, videoRes, ratio) {
    const main = sourceShort(mainRes, ratio);
    let stage = ratio;
    if (!ratioValue(ratio)) {
      const p = resPair(mainRes) || (videoRes || []).map(resPair).find(Boolean);
      if (p) stage = `${p[0]}:${p[1]}`;
    }
    return (videoRes || []).reduce((best, v) => {
      const s = sourceShort(v, stage);
      return s != null && (best == null || s > best) ? s : best;
    }, main);
  }

  /** 可选分辨率（降序，首项即默认）。每项 `{short, label, source}`，`source` 就是要标
   *  「原始分辨率」的那一项。源短边未知时按 1080 兜底，且**没有**哪一项配得上那个标注。 */
  function resChoices(sourceShortSide) {
    const src = +sourceShortSide > 0 ? Math.round(+sourceShortSide) : null;
    const cap = src || FALLBACK_SHORT;
    const list = src ? [{short: src, label: resLabel(src), source: true}] : [];
    STD_SHORTS.forEach((s) => {
      if (src ? s < cap : s <= cap) list.push({short: s, label: resLabel(s), source: false});
    });
    return list;
  }

  /** 记下来的挑选值 → 这次能用的短边：没挑过（或挑了个高于源的）就落回原始分辨率，
   *  挑过一档更低的就取不超过它的最大档（画幅一变源短边会缩，挑的那档可能已经不在了）。 */
  function resolveShort(pick, sourceShortSide) {
    const list = resChoices(sourceShortSide);
    const p = +pick;
    if (!(p > 0)) return list[0].short;
    const hit = list.find((c) => c.short === p) || list.find((c) => c.short <= p);
    return (hit || list[list.length - 1]).short;
  }

  function mmss(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  /* ---------- 「画面里有什么」清单 ---------- */

  /** 时间轴行 → 导出清单。`st`：`{hiddenEls: {id: true}, muted, musicMuted}`。
   *  返回的每条 `{key, kind, label, sub, on}`；元素那条多一个 `items`。
   *  视频元素在「元素」那一组里逐件列（2026-09-16 起没有主轨）。
   *  模板行也不在：章节条 / 进度条那一层有自己的属性页开关。 */
  function lanes(rows, st) {
    const s = st || {};
    const hidden = s.hiddenEls || {};
    const out = [];
    const items = [];
    (rows || []).forEach((r) => {
      if (r.kind === 'subs' && r.track) {
        const t = r.track;
        out.push({key: 'subs:' + t.id, kind: 'subs', id: t.id, label: t.name,
          sub: t.role === 'source' ? '源语言字幕' : '译文字幕', on: !t.hidden,
          lang: t.lang || t.id, role: t.role});
      } else if ((r.kind === 'element' || r.kind === 'text') && r.el && !r.member) {
        // 同类共道后一行可能坐着多件（2026-09-11）：导出清单仍逐件列，key 照旧是 `el:<id>`
        (r.els || [r.el]).forEach((el) => {
          items.push({key: 'el:' + el.id, id: el.id, label: el.name || el.label || el.id,
            icon: el.icon, on: !hidden[el.id]});
        });
      } else if (r.kind === 'audio') {
        // 有配音组时这条是「原声」：从视频剥离出来的原始人声 + 背景，默认停用、导出可再勾回
        out.push({key: 'audio', kind: 'audio', label: r.split ? '原声' : '音频',
          sub: r.split ? '视频里的原始声音 · 已被配音替下' : r.label === '音频' ? '视频里的原始声音' : r.label, on: !s.muted});
      } else if (r.kind === 'music') {
        out.push({key: 'music', kind: 'music', label: '音乐', sub: '背景音乐', on: !s.musicMuted});
      } else if (r.kind === 'score') {
        // 配乐轨（2026-09-24）：一路一条，停用位与时间轴行头那只喇叭同源（`scoreOff[bus]`）
        out.push({key: 'score:' + r.bus, kind: 'score', id: r.bus, label: r.label,
          sub: r.stale ? '配乐 stem · 已过期，导出的是上次生成的那一版' : '配乐 stem', on: !r.off});
      } else if (r.kind === 'dub') {
        // 翻译配音（2026-09-11）：一种语言一行，进混音清单，与时间轴上的停用位同源
        const lang = (r.dub && r.dub.lang) || '';
        const off = s.dubOff ? !!s.dubOff[lang] : !!s.dubMuted;
        const blocks = (r.dub && r.dub.blocks) || [];
        const live = blocks.filter((b) => b.status !== 'failed' && !b.muted).length;
        out.push({key: 'dub:' + lang, kind: 'dub', id: lang, label: r.label || '配音',
          sub: '按句合成的译文配音 · ' + (live === blocks.length ? blocks.length + ' 句' : live + '/' + blocks.length + ' 句'), on: !off});
      } else if (r.kind === 'bed') {
        // 背景声跟着自己那组配音（2026-09-14）：一组一份，组关了它也不进混音
        const lang = r.lang || (r.dub && r.dub.lang) || '';
        const grpOff = s.dubOff ? !!s.dubOff[lang] : false;
        const off = s.bedOff ? !!s.bedOff[lang] : !!s.bedMuted;
        out.push({key: 'bed:' + lang, kind: 'bed', id: lang, label: r.label || '背景声', sub: '这组配音自己分离出来的伴奏', on: !(grpOff || off)});
      }
    });
    if (items.length) {
      // 元素那组插在字幕之后、音频之前——与时间轴上的行序不同，但导出清单读的是
      // 「字幕 → 画面上的东西 → 声音」这条心智顺序，字幕是最常临时关的
      const at = out.findIndex((l) => l.kind === 'audio' || l.kind === 'music' || l.kind === 'score');
      const grp = {key: 'els', kind: 'els', label: '元素', items, on: items.some((i) => i.on)};
      if (at < 0) out.push(grp); else out.splice(at, 0, grp);
    }
    return out;
  }

  /** 叠覆盖表。`ov` 是 `{key: bool}`，键是 lane / item 的 key。元素组的 `on` 现算。 */
  function apply(lanesIn, ov) {
    const o = ov || {};
    const pick = (x) => (Object.prototype.hasOwnProperty.call(o, x.key) ? !!o[x.key] : x.on);
    return (lanesIn || []).map((l) => {
      if (l.kind !== 'els') return Object.assign({}, l, {on: pick(l)});
      const items = l.items.map((i) => Object.assign({}, i, {on: pick(i)}));
      return Object.assign({}, l, {items, on: items.some((i) => i.on)});
    });
  }

  /** 整组开关：把每一件都写进覆盖表（组本身没有独立的 on 位）。 */
  function setGroup(lanesIn, ov, on) {
    const next = Object.assign({}, ov);
    (lanesIn || []).forEach((l) => {
      if (l.kind === 'els') l.items.forEach((i) => { next[i.key] = !!on; });
    });
    return next;
  }

  /** 覆盖之后与时间轴不一样的那几条：`[{key, kind, id, on}]`。空 = 与时间轴一致。 */
  function syncWrites(lanesIn, ov) {
    const eff = apply(lanesIn, ov);
    const out = [];
    (lanesIn || []).forEach((l, n) => {
      const e = eff[n];
      if (l.kind === 'els') {
        l.items.forEach((i, k) => {
          if (i.on !== e.items[k].on) out.push({key: i.key, kind: 'el', id: i.id, on: e.items[k].on});
        });
      } else if (l.on !== e.on) {
        out.push({key: l.key, kind: l.kind, id: l.id, on: e.on});
      }
    });
    return out;
  }

  /* ---------- 范围 ---------- */

  /** 时间轴上的视频元素 → 「按片段」的段（2026-09-16，没有主轨）：一件视频元素 = 一段，
   *  按 start 排；停用的、开放式片尾的不算。`docs` 是 `elDocs`（停用位与起止真相在那里）。 */
  function videoSegments(elements, docs) {
    const d = docs || {};
    return (elements || []).map((e) => Object.assign({}, e, d[e.id]))
      .filter((e) => e.kind === 'video' && !e.hidden && e.end != null && e.end > e.start)
      .sort((a, b) => a.start - b.start || String(a.id).localeCompare(String(b.id)))
      .map((e) => ({id: e.id, start: e.start, end: e.end, name: e.name || e.asset || ''}));
  }
  /** 一段 = 一件视频元素。标签 `片段 N · <元素名> · 起止`（N 按时间轴上的先后 1-based）。 */
  function rangeOptions(segs) {
    return (segs || []).map((k, i) => ({
      id: k.id, index: i + 1, start: k.start, end: k.end, dur: k.end - k.start, name: k.name || '',
      label: '片段 ' + (i + 1) + (k.name ? ' · ' + k.name : '') + ' · ' + mmss(k.start) + '–' + mmss(k.end),
    }));
  }

  /** 默认导哪一段：选中的视频元素 > 播放头所在的那段 > 第一段。 */
  function defaultRange(segs, sels, playT) {
    const list = segs || [];
    const sel = (sels || []).find((s) => s && s.kind === 'element' && list.some((k) => k.id === s.id));
    if (sel) return sel.id;
    const at = list.find((k) => playT >= k.start && playT < k.end);
    return at ? at.id : (list[0] ? list[0].id : null);
  }

  function rangeSpan(segs, rangeId, dur) {
    const k = rangeId ? (segs || []).find((x) => x.id === rangeId) : null;
    if (!k) return {start: 0, end: dur, dur, index: 0, whole: true};
    return {start: k.start, end: k.end, dur: k.end - k.start, index: (segs || []).indexOf(k) + 1, whole: false};
  }

  /* ---------- 范围（第 239 轮重拾）：整片 / 按章节 / 按片段 / 自定义 ----------
     120.1 轮撤下的「只导一段」只认一个 clip；这一轮按用户要求重拾并放宽：章节与片段
     都可以**多选**（2026-09-16 起「片段」= 时间轴上的视频元素，`videoSegments`），自定义是一对起止（QuickTime 修剪那种两只把手 ＋ 可输入的时间码）。
     选出来的段先合并成**连续区间**（runs）：相邻的段拼成一段、不相邻的按顺序拼接
     或各出一份——决定权在弹层的「多段」开关，模型只负责把两种口径都算出来。
     时间一律是**源时间线**的秒；已剪掉的段（§12.6 剪口覆盖层）在范围内照旧被跳过。 */
  const RANGE_MODES = [
    {k: 'all', label: '整片'},
    {k: 'chapters', label: '按章节'},
    {k: 'clips', label: '按片段'},
    {k: 'custom', label: '自定义'},
  ];
  const ADJ_EPS = 0.05;

  /** `m:ss.d`——自定义范围的输入框、把手角标用；与 `mmss` 的区别是带一位小数 */
  function fmtT(sec) {
    const s = Math.max(0, Math.round((+sec || 0) * 10) / 10);
    const m = Math.floor(s / 60);
    const r = +(s - m * 60).toFixed(1);
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  /** 收 `m:ss(.d)` / `h:mm:ss(.d)` / 裸秒；非法返回 null（调用方回退原值，不静默改成 0） */
  function parseT(text) {
    const raw = String(text == null ? '' : text).trim();
    if (!raw || !/^[0-9:.]+$/.test(raw) || raw === '.') return null;
    const parts = raw.split(':');
    if (parts.length > 3) return null;
    let total = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === '' || p === '.' || !/^[0-9]*\.?[0-9]*$/.test(p)) return null;
      if (i < parts.length - 1 && p.indexOf('.') >= 0) return null;
      const v = parseFloat(p);
      if (!isFinite(v) || (parts.length > 1 && i > 0 && v >= 60)) return null;
      total = total * 60 + v;
    }
    return total;
  }
  /** 文件名里的时间：`0m45s`——冒号进不了文件名 */
  function fileT(sec) {
    const s = Math.max(0, Math.round(+sec || 0));
    return Math.floor(s / 60) + 'm' + String(s % 60).padStart(2, '0') + 's';
  }

  /** 章节列表：1-based 章号 + 标题 + 起止 */
  function chapterOptions(chapters) {
    return (chapters || []).map((c, i) => ({
      id: c.id, index: i + 1, start: c.start, end: c.end, dur: c.end - c.start, title: c.title,
      label: '第 ' + (i + 1) + ' 章 · ' + c.title, time: mmss(c.start) + '–' + mmss(c.end),
    }));
  }
  /** 默认勾哪一章：播放头所在 > 第一章 */
  function defaultChapter(chapters, playT) {
    const list = chapters || [];
    const at = list.find((c) => playT >= c.start && playT < c.end);
    return at ? at.id : (list[0] ? list[0].id : null);
  }
  /** 勾选 / 取消一项；返回新数组（顺序不重要，`spanOf` 会按时间排） */
  function toggleId(ids, id) {
    const list = ids || [];
    return list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat([id]);
  }
  /** 把选中的段合并成连续区间：相邻（缝 < 0.05s）的并成一段 */
  function runsOf(segs) {
    const sorted = (segs || []).slice().sort((a, b) => a.start - b.start);
    const out = [];
    sorted.forEach((s) => {
      const last = out[out.length - 1];
      if (last && Math.abs(last.end - s.start) < ADJ_EPS) { last.end = s.end; last.ids.push(s.id); }
      else out.push({start: s.start, end: s.end, ids: [s.id]});
    });
    return out;
  }
  /** 自定义起止收口：钳在 [0, dur]、一位小数、至少留 0.5s */
  function clampCustom(start, end, dur) {
    const r1 = (v) => Math.round(v * 10) / 10;
    let s = r1(Math.min(Math.max(+start || 0, 0), dur));
    let e = r1(Math.min(Math.max(+end || 0, 0), dur));
    if (e - s < 0.5) {
      if (s + 0.5 <= dur) e = r1(s + 0.5); else { e = r1(dur); s = r1(Math.max(0, dur - 0.5)); }
    }
    return {start: s, end: e};
  }

  /** 范围的生效口径。`opts`：`{chapters, clips: videoSegments(...), ids, custom: {start, end}, dur}`。
   *  返回 `{mode, whole, empty, start, end, dur, segs, runs, contiguous, label, short, tag}`：
   *    label 给「将导出」那一行、short 给任务副标题、tag 给文件名。 */
  function spanOf(mode, opts) {
    const o = opts || {};
    const dur = o.dur || 0;
    const whole = {mode: 'all', whole: true, empty: false, start: 0, end: dur, dur, index: 0,
      segs: [{id: 'all', start: 0, end: dur}], runs: [{start: 0, end: dur, ids: ['all']}], contiguous: true,
      label: '整片 ' + mmss(dur), short: '', tag: ''};
    if (mode === 'custom') {
      const c = clampCustom(o.custom ? o.custom.start : 0, o.custom ? o.custom.end : dur, dur);
      if (c.start <= 0 && c.end >= dur) return whole;
      const seg = {id: 'custom', start: c.start, end: c.end, tag: ' ' + fileT(c.start) + '-' + fileT(c.end)};
      return {mode, whole: false, empty: false, start: c.start, end: c.end, dur: +(c.end - c.start).toFixed(1), index: 0,
        segs: [seg], runs: [{start: c.start, end: c.end, ids: ['custom']}], contiguous: true,
        label: fmtT(c.start) + '–' + fmtT(c.end) + ' · ' + mmss(c.end - c.start),
        short: mmss(c.start) + '–' + mmss(c.end), tag: seg.tag};
    }
    if (mode === 'chapters' || mode === 'clips') {
      const isCh = mode === 'chapters';
      const all = isCh ? chapterOptions(o.chapters) : rangeOptions(o.clips);
      const ids = o.ids || [];
      const segs = all.filter((s) => ids.indexOf(s.id) >= 0)
        .map((s) => Object.assign({}, s, {tag: ' ' + (isCh ? '第' + s.index + '章' : '片段' + s.index)}));
      if (!segs.length) {
        return {mode, whole: false, empty: true, start: 0, end: 0, dur: 0, index: 0, segs: [], runs: [], contiguous: true,
          label: isCh ? '还没勾章节' : '还没勾片段', short: '', tag: ''};
      }
      const runs = runsOf(segs);
      const total = segs.reduce((a, s) => a + s.dur, 0);
      const idx = segs.map((s) => s.index);
      const unit = isCh ? '章' : '';
      const noun = isCh ? '第 ' : '片段 ';
      let head, tag;
      if (segs.length === 1) {
        head = isCh ? segs[0].label : segs[0].label.replace(/ · .*$/, '');
        tag = segs[0].tag;
      } else if (runs.length === 1) {
        head = noun + idx[0] + '–' + idx[idx.length - 1] + ' ' + unit;
        tag = ' ' + (isCh ? '第' + idx[0] + '-' + idx[idx.length - 1] + '章' : '片段' + idx[0] + '-' + idx[idx.length - 1]);
      } else {
        head = segs.length + (isCh ? ' 章' : ' 段');
        tag = ' ' + (isCh ? '第' + idx.join('+') + '章' : '片段' + idx.join('+'));
      }
      const label = head.trim() + ' · ' + mmss(total) + (runs.length > 1 ? ' · 不相邻' : '');
      return {mode, whole: false, empty: false, start: segs[0].start, end: segs[segs.length - 1].end, dur: total,
        index: segs[0].index, segs, runs, contiguous: runs.length === 1, label, short: head.trim(), tag};
    }
    return whole;
  }

  /** t 是否落在任一区间里 */
  function inRuns(t, runs) {
    return (runs || []).some((r) => t >= r.start - ADJ_EPS && t < r.end - ADJ_EPS);
  }
  /** 预览播放只走选中的范围：下一拍出了当前区间就跳到下一段的开头，走完回到第一段。 */
  function stepIn(t, step, runs) {
    const list = runs || [];
    if (!list.length) return t + step;
    const next = +(t + step).toFixed(1);
    if (inRuns(next, list)) return next;
    const after = list.find((r) => r.start > t + ADJ_EPS);
    return after ? after.start : list[0].start;
  }

  /** 各出一份时的文件名清单；合成一份或单段时就是 `videoName` 那一个 */
  function spanFiles(base, eff, span, each) {
    if (!span || span.whole || span.empty || !each || span.segs.length < 2) return [videoName(base, eff, span)];
    return span.segs.map((s) => videoName(base, eff, {whole: false, tag: s.tag}));
  }

  /* ---------- 预估 ---------- */

  function fmtEta(ms) {
    const s = ms / 1000;
    if (s < 60) return '≈ ' + Math.max(1, Math.round(s)) + ' 秒';
    const m = Math.round(s / 60);
    if (m < 60) return '≈ ' + Math.max(1, m) + ' 分';
    return '≈ ' + Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
  }

  /** 导出中的剩余时间（product-design §8.3）：`0:45`、`12:03`，超过一小时 `1:02:03`；按整秒向上取。 */
  function fmtLeft(ms) {
    const total = Math.max(0, Math.ceil((ms || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const ss = String(total % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }

  function fmtSize(bytes) {
    if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    return Math.max(1, Math.round(bytes / 1e6)) + ' MB';
  }

  /** `{frames, ms, bytes, eta, size, dims, mbps}`。体积 = 短边预设码率 × 体积档倍率 × 时长
   *  （源码率上限见 §17.1，演示口径不做那一步夹取）。`quality` 缺省即标准档。 */
  function estimate(short, ratio, seconds, quality) {
    const d = dims(short, ratio);
    const mpx = d.w * d.h / 1e6;
    const frames = Math.round(seconds * FPS);
    const ms = frames * K_MS_PER_FRAME_MPX * mpx;
    const q = QUALITY[quality] || QUALITY.standard;
    const base = (RES_MBPS.find(([s]) => Math.min(d.w, d.h) >= s) || [0, 2])[1];
    const mbps = +(base * q.factor).toFixed(1);
    const bytes = mbps * 1e6 / 8 * seconds;
    return {frames, ms, bytes, eta: fmtEta(ms), size: fmtSize(bytes), dims: d, mbps};
  }

  /* ---------- 用哪台电脑导出（远端任务 J4，2026-09-27）----------
     导出要整个项目：素材按内容寻址，节点缺哪些传哪些（按内容缓存 24 小时，同一项目再导只传改过的），
     MP4 经局域网传回。局域网带宽是上限，所以开跑前把「上传 + 那边导出」与「本机导出」摆在一起比。 */
  const LAN_BPS = 60e6;          // 局域网实际吞吐按 60 MB/s 估（千兆有线的一半；Wi-Fi 会更慢）
  const SRC_BPS = 8e6 / 8;       // 项目素材没有体积表时按 8 Mb/s 的源估，再加一成半给图片 / 字体 / 贴纸
  /** 这次要传给节点的字节：`mediaBytes` 缺省按时长估；`cachedBytes` 是节点已按内容缓存的部分。 */
  function uploadBytes(o) {
    const opt = o || {};
    const all = opt.mediaBytes != null ? opt.mediaBytes : Math.round((opt.duration || 0) * SRC_BPS * 1.15);
    return Math.max(0, all - (opt.cachedBytes || 0));
  }
  /** 远端导出的时间账：`speed` 是节点相对这台 Mac 的编码速度倍数。 */
  function remoteEstimate(localMs, bytes, speed, lanBps) {
    const uploadMs = bytes / (lanBps || LAN_BPS) * 1000;
    const remoteMs = localMs / Math.max(0.1, speed || 1);
    const totalMs = uploadMs + remoteMs;
    return {uploadMs, remoteMs, totalMs, faster: totalMs < localMs, upload: fmtSize(bytes),
      uploadShare: totalMs > 0 ? uploadMs / totalMs : 0};
  }
  /** 选了节点时画质区下面那一句 */
  function remoteNote(name, r, localMs) {
    return `先把视频用到的素材传过去：约 ${r.upload} · ${fmtEta(r.uploadMs)}；在 ${name} 上导出 ${fmtEta(r.remoteMs)} · 合计 ${fmtEta(r.totalMs)}（本机导出 ${fmtEta(localMs)}）`
      + (r.faster ? '' : ' · 这次在本机导出更快');
  }

  /* ---------- 摘要与命名 ---------- */

  const subsOn = (eff) => (eff || []).filter((l) => l.kind === 'subs' && l.on);

  /** 「将导出」那一行的零件，按顺序：范围 · 尺寸 · 字幕 · 元素 · 声音。 */
  function summary(eff, opts) {
    const o = opts || {};
    const span = o.span || {whole: true, dur: o.dur || 0};
    const parts = [];
    if (span.label) parts.push(span.label);
    else parts.push((span.whole ? '整片 ' : '片段 ' + span.index + ' · ') + mmss(span.dur));
    if (o.dims) parts.push(o.dims.w + '×' + o.dims.h);
    const subs = subsOn(eff);
    parts.push(subs.length ? subs.map((l) => l.label).join(' + ') + '字幕' : '无字幕');
    const grp = (eff || []).find((l) => l.kind === 'els');
    if (grp) {
      const n = grp.items.filter((i) => i.on).length;
      parts.push(n === 0 ? '无元素' : n === grp.items.length ? n + ' 个元素' : n + '/' + grp.items.length + ' 个元素');
    }
    const au = (eff || []).find((l) => l.kind === 'audio');
    if (au) parts.push(au.on ? '音频' : '静音');
    const mu = (eff || []).find((l) => l.kind === 'music');
    if (mu && mu.on) parts.push('音乐');
    const dbs = (eff || []).filter((l) => l.kind === 'dub' && l.on);
    if (dbs.length) parts.push(dbs.length > 1 ? dbs.length + ' 条配音' : '配音');
    if ((eff || []).some((l) => l.kind === 'bed' && l.on)) parts.push('背景声');
    return parts;
  }

  /** `<源名>[.<语言>][ 片段N | 第2章 | 0m45s-1m18s].mp4`——语言是画面上开着的字幕轨的语言代码，几条用 `-` 连
   *  （`kelang-ep42.zh-ja.mp4`，与字幕文件同一个写法，product-design §8.3）；范围后缀由 `spanOf` 给的 `tag` 决定，
   *  老口径的 `index` 仍认。 */
  function videoName(base, eff, span) {
    const tag = subsOn(eff).map((l) => String(l.lang || l.id)).join('-');
    let seg = '';
    if (span && !span.whole) seg = span.tag != null ? span.tag : ' 片段' + span.index;
    return base + (tag ? '.' + tag : '') + seg + '.mp4';
  }

  /** 没选位置时导到哪（product-design §8.3）：原视频所在的文件夹；原视频不是本机文件（链接），或表面拿不到本机路径
   *  （`nextToSource` 为 false，Web）时放项目的 exports/。 */
  function exportPlace(src, nextToSource) {
    const p = src && src.path;
    if (nextToSource === false || !p || /^[a-z]+:\/\//i.test(p) || p.lastIndexOf('/') < 0) return '项目下的 exports/';
    return '原视频所在的文件夹 · ' + (p.slice(0, p.lastIndexOf('/')) || '/');
  }

  /* 字幕格式（第 239 轮加 ASS）：SRT / VTT 是纯文本时间轴，ASS 带样式头——把当前字幕样式
     （字体、描边、位置）一并写进去，播放器按样式渲染；但支持 ASS 的播放器比 SRT 少。
     2026-09-23 加 JSON：同一份字幕条（成片时间），每条另带原文逐词时间戳，给脚本和工具用
     （内核 `--to json-words`）。 */
  const SUB_FORMATS = [
    {k: 'srt', label: 'SRT', note: '通用，几乎所有播放器和平台都认'},
    {k: 'vtt', label: 'VTT', note: '网页播放器用，带位置提示'},
    {k: 'ass', label: 'ASS', note: '带字幕样式（字体、描边、位置），播放器支持较少'},
    {k: 'json', label: 'JSON', note: '每条带逐词时间戳，给脚本和工具用'},
  ];

  /** 字幕文件：勾一条出一份；勾多条默认合成一份双语（`merge`），也可各出一份。 */
  function subtitleNames(base, eff, fmt, merge) {
    const subs = subsOn(eff);
    const f = String(fmt || 'srt').toLowerCase();
    const ext = '.' + (SUB_FORMATS.some((x) => x.k === f) ? f : 'srt');
    if (!subs.length) return [];
    if (subs.length > 1 && merge !== false) {
      return [base + '-' + subs.map((l) => String(l.lang || l.id)).join('-') + ext];
    }
    return subs.map((l) => base + '-' + String(l.lang || l.id) + ext);
  }

  /** 任务卡副标题：`mp4 · 1920×1080 · 日本語字幕 · 片段 3`。 */
  function taskSub(eff, opts) {
    const o = opts || {};
    const parts = ['mp4'];
    if (o.dims) parts.push(o.dims.w + '×' + o.dims.h);
    const subs = subsOn(eff);
    parts.push(subs.length ? subs.map((l) => l.label).join(' + ') + '字幕' : '无字幕');
    if (o.span && !o.span.whole) parts.push(o.span.short || ('片段 ' + o.span.index));
    return parts.join(' · ');
  }

  /* ---------- 文稿导出（第 239 轮从字幕页拆出来） ----------
     字幕文件是「带时间轴的行」，文稿是「按段落读的文章」——两者的语言轴、格式轴、
     选项都不一样，硬放一页只会互相干扰。文稿的正文由 BC_TX.exportText 生成，
     这里只管语言选项、文件名与收据。 */
  const TX_FORMATS = [
    {k: 'md', label: 'Markdown', ext: '.md', note: '可带文首元信息，章节成小标题、说话人加粗、译文成引用 · 贴进笔记或文档'},
    {k: 'txt', label: '纯文本', ext: '.txt', note: '不带标记语法 · 章节标题单独一行'},
  ];
  /** 语言选项：原文 + 每条已完成的译文 + 每条译文对应的双语对照。
   *  `langs`：`[{code, name, native, done}]`；`srcName` 是源语言名。 */
  function txLangOptions(srcCode, srcName, langs) {
    const sn = srcName || String(srcCode || '').toUpperCase();
    const out = [{k: 'src', label: '原文', sub: sn, lang: 'src'}];
    const done = (langs || []).filter((l) => l.code !== srcCode && (l.done == null || l.done >= 100));
    done.forEach((l) => out.push({k: 'trans:' + l.code, label: l.native || l.name || l.code, sub: '译文', lang: 'trans', code: l.code}));
    done.forEach((l) => out.push({k: 'both:' + l.code, label: '双语对照', sub: sn + ' + ' + (l.native || l.name || l.code), lang: 'both', code: l.code}));
    return out;
  }
  /** 语言复选（替掉原来的单选下拉）：一行源语言 + 每门译文一行。
   *  `sel = {src: bool, trans: code|null}`；勾选组合塌成 txLangOptions 的一项——
   *  只勾源 = 原文、只勾一门译文 = 译文、两边都勾 = 双语对照。
   *  至少留一行：唯一勾着的那行锁住（勾选框置灰）；双语只配得了一门译文，
   *  再开另一门译文会换掉当前那门，不叠加。App / Web 的判据在 editor-core `toggle_transcript_lang`。 */
  function txLangChecked(sel, key) {
    return key === 'src' ? !!sel.src : sel.trans === key;
  }
  function txLangLocked(sel, key) {
    return txLangChecked(sel, key) && (key === 'src' ? !sel.trans : !sel.src);
  }
  function txLangToggle(sel, key) {
    if (txLangLocked(sel, key)) return sel;
    if (key === 'src') return {src: !sel.src, trans: sel.trans};
    return {src: sel.src, trans: sel.trans === key ? null : key};
  }
  /** 勾选组合 → txLangOptions 里对应那一项 */
  function txLangPick(sel, opts) {
    const k = sel.trans ? (sel.src ? 'both:' : 'trans:') + sel.trans : 'src';
    return (opts || []).find((o) => o.k === k) || (opts || [])[0];
  }
  /** 文件名：`<base>-transcript[-<lang>].md`；双语用 `<src>-<trans>`。 */
  function transcriptName(base, opt, fmt, srcCode, transCode) {
    const f = TX_FORMATS.find((x) => x.k === fmt) || TX_FORMATS[0];
    const o = opt || {lang: 'src'};
    let lang = String(srcCode || 'src');
    if (o.lang === 'trans') lang = String(o.code || transCode || 'trans');
    else if (o.lang === 'both') lang = String(srcCode || 'src') + '-' + String(o.code || transCode || 'trans');
    return base + '-transcript-' + lang + f.ext;
  }
  /** 「将导出」一行的零件：格式 · 语言 · 章节 · 时间戳 · 说话人 · 跳过已剪段 */
  function transcriptSummary(opt, fmt, st) {
    const s = st || {};
    const f = TX_FORMATS.find((x) => x.k === fmt) || TX_FORMATS[0];
    const parts = [f.label, opt ? opt.label : '原文'];
    if (s.frontmatter && fmt !== 'txt') parts.push('文首元信息');
    if (s.chapters) parts.push('章节标题');
    if (s.time) parts.push('段落时间戳');
    if (s.speaker) parts.push('说话人');
    if (s.skipCut) parts.push('跳过已剪段');
    return parts;
  }

  /* ---------- 任务文案（三处共用） ---------- */

  const TASK_LABEL = {
    crop: '智能裁剪', 'shorts-cut': '剪成短视频',
    transcribe: '转录', export: '导出', translate: '翻译', polish: '润色文稿', chapters: '生成章节',
    speakers: '识别说话人', retranscribe: '重新转录', cleanup: '找可剪的口', stale: '刷新过期译文',
    image: '生成图片', download: '下载视频', 'legacy-import': '导入旧版项目',
  };

  /** 任务停下来等人时的说法：智能裁剪等人检查构图，剪成短视频等人挑片段。 */
  const reviewLabel = (kind) => (kind === 'shorts-cut' ? '等你挑' : '等你检查');

  function pillLabel(task) {
    if (!task) return '';
    if (preparationView(task).active) return '准备导出';
    if (task.stage === 'review') return (TASK_LABEL[task.kind] || '任务') + ' · ' + reviewLabel(task.kind);
    return (TASK_LABEL[task.kind] || '任务') + ' · ' + (task.pct || 0) + '%';
  }

  function preparationView(task) {
    const active = !!task && task.kind === 'export' && task.status === 'running'
      && String(task.preparePhase || '').startsWith('prepare');
    const labels = {'prepare-fonts': '下载字体', 'prepare-project': '读取视频', 'prepare-media': '检查素材',
      'prepare-timeline': '整理时间轴与音频', 'prepare-overlays': '准备字幕与画面'};
    /* 下载字体（product-design §5.9）：视频用到的字体还在下载时导出先等，念在下哪一个 */
    const detail = task && task.preparePhase === 'prepare-fonts' && task.prepareDetail ? ' · ' + task.prepareDetail : '';
    return {active, label: (labels[task && task.preparePhase] || '正在准备导出') + detail,
      seconds: Math.floor(Math.max(0, (task && task.prepareElapsedMs) || 0) / 1000)};
  }

  /** 「取消」确认框的话。导出与 AI run 的后果不同：导出丢的是半个文件，项目不动；
   *  AI run 丢的是没落盘的结果。 */
  function cancelCopy(kind) {
    if (kind === 'crop') return {title: '取消智能裁剪？', body: '设置和构图会保留，未完成的视频不会进素材库。', confirmLabel: '取消任务'};
    if (kind === 'shorts-cut') return {title: '取消剪成短视频？', body: '设置会保留。还没创建的短视频不会出现，已经创建的不受影响。', confirmLabel: '取消任务'};
    if (kind === 'export') {
      return {title: '取消导出？', body: '已写出的那部分文件会删掉，视频本身不受影响。', confirmLabel: '取消导出'};
    }
    if (kind === 'transcribe') {
      return {title: '取消转录？', body: '任务会停下，已经识别出来的部分不落盘。', confirmLabel: '取消任务'};
    }
    if (kind === 'translate') {
      return {title: '取消翻译？', body: '任务会停下。文稿一个字不会被改动——已经译出来的句子不落盘。', confirmLabel: '取消任务'};
    }
    if (kind === 'download') {
      return {title: '取消下载？', body: '临时文件会删掉，不会建视频。链接留在会话里，之后可以重试。', confirmLabel: '取消下载'};
    }
    return {title: '取消这个任务？', body: '已经算出来的部分会保留，任务本身停止。', confirmLabel: '取消任务'};
  }

  /* ---------- 工程导出（可编辑工程导出 v2，见 docs/design/editor/bcut-editable-export-v2-design.md） ----------
     七个目标，点一行就导出（原型 / Web 口径；App 是选中后点底部按钮，见分歧台账）。
     每个目标的落地格式与内核一致：剪映与 CapCut 目前共用同一份 `.capcut` 草稿骨架
     （剪映独立模板是 P2，§10），Premiere 是 FCP7 `.xml`（不是 `.prproj`），Resolve /
     Final Cut Pro 是 `fcpxml`（Resolve 额外能认一份 `.xml` 兜底），Shotcut / Kdenlive
     是各自的原生工程文件。`bakeFormats` 是这个目标认的动态元素烘焙格式（§4.3）：只有
     Shotcut / Kdenlive 认不止一种——`.mov` / `.webm` / PNG 序列（MLT 能把 PNG 序列写成
     图像序列）；其余五个只吃得下 ProRes 4444 的 `.mov`（Premiere / Resolve 的 FCP7 XML /
     FCPXML 只能引用序列首帧，动画会变成静帧，所以不认 PNG 序列）。静态元素恒为单张
     PNG，所有目标都当图片收，不在这张表里。 */
  const PROJECT_TARGETS = [
    {id: 'jianying', name: '剪映草稿', ext: '.capcut', isDirectory: true, bakeFormats: ['mov'], installable: true},
    {id: 'capcut', name: 'CapCut', ext: '.capcut', isDirectory: true, bakeFormats: ['mov'], installable: true},
    {id: 'premiere', name: 'Premiere Pro', ext: '.xml', isDirectory: false, bakeFormats: ['mov'], installable: false},
    {id: 'resolve', name: 'DaVinci Resolve', ext: '.fcpxml', altExt: '.xml', isDirectory: false, bakeFormats: ['mov'], installable: false},
    {id: 'final-cut-pro', name: 'Final Cut Pro', ext: '.fcpxml', isDirectory: false, bakeFormats: ['mov'], installable: false},
    {id: 'shotcut', name: 'Shotcut', ext: '.mlt', isDirectory: false, bakeFormats: ['mov', 'webm', 'png'], installable: false},
    {id: 'kdenlive', name: 'Kdenlive', ext: '.kdenlive', isDirectory: false, bakeFormats: ['mov', 'webm', 'png'], installable: false},
  ];
  /** 目标行右侧那一句说明：目录 / 扩展名（+ 可选兜底扩展名）+ 能不能直接装草稿库。 */
  function targetMeta(target) {
    const t = target || {};
    const base = t.isDirectory ? '目录 · ' + t.ext : t.ext + (t.altExt ? '（可选 ' + t.altExt + '）' : '');
    return t.installable ? base + ' · 可直接安装打开' : base;
  }
  /** 这个目标认哪些烘焙媒体格式（§4.3）；纯访问器，留出以后按 ffmpeg 探测结果收窄的口子。 */
  function bakeFormatsFor(target) {
    return (target && target.bakeFormats) ? target.bakeFormats.slice() : [];
  }
  const BAKE_FORMAT_LABEL = {mov: 'ProRes 4444（.mov）', webm: 'VP9 透明（.webm）', png: 'PNG 序列'};
  /* 算法元素三选一（设计稿 §3 决策表的用户开关，对应内核 `--bake auto|lossy|none`）。 */
  const BAKE_POLICIES = [
    {k: 'auto', label: '转成视频素材（推荐）'},
    {k: 'lossy', label: '连动画、遮罩等有损属性也转'},
    {k: 'none', label: '不转，直接放弃'},
  ];
  /* 决策表（§3）压缩成一张纯前端够用的分类表：sticker / placeholder 按有没有源件判，
     其余按 kind 一刀切。真正的决策与烘焙在内核 `bcut-editable`（纯函数）与
     `editable_bake`（宿主）——这里只为演示时间轴算一个可信的三档计数，不是真值源。 */
  const NATIVE_KINDS = ['video', 'image', 'audio', 'text', 'textgroup'];
  const BAKE_KINDS = ['shape', 'visualizer', 'wave', 'progress', 'confetti', 'draw', 'whiteboard', 'counter', 'overlay', 'vframe', 'tpl', 'template'];
  /** 单个元素在给定策略下的落法：`'native' | 'baked' | 'dropped'`。 */
  function elementDelivery(el, policy) {
    const k = (el && el.kind) || '';
    const p = policy || 'auto';
    if (k === 'sticker') return el.asset ? 'native' : (p === 'none' ? 'dropped' : 'baked');
    if (k === 'placeholder') return el.srcId ? 'native' : (p === 'none' ? 'dropped' : 'baked');
    if (NATIVE_KINDS.indexOf(k) >= 0) return 'native';
    if (BAKE_KINDS.indexOf(k) >= 0) return p === 'none' ? 'dropped' : 'baked';
    return 'native';
  }
  /** 时间轴元素 → 工程导出回执 `{native, baked, dropped, skipped, droppedNames}`。
   *  `elements` 每项可带 `hidden`（停用的轨或元素）——跳过，不计三档、也不进 dropped 名单，
   *  与内核「hidden 轨/元素直接跳过」同口径（§3 决策表最后一行）。 */
  function deliverySummary(elements, policy) {
    const p = policy || 'auto';
    const out = {native: 0, baked: 0, dropped: 0, skipped: 0, droppedNames: []};
    (elements || []).forEach((el) => {
      if (el.hidden) { out.skipped++; return; }
      const d = elementDelivery(el, p);
      out[d]++;
      if (d === 'dropped') out.droppedNames.push(el.name || el.label || el.id);
    });
    return out;
  }

  /* ---------- 预览几何（第 120.1 轮）：弹层里那一小块画面 ----------
     导出画面 = 项目画面按目标画幅**居中裁切**（§17.1）。预览盒按目标画幅算，项目画面
     在盒里做 cover：比盒宽就两边裁、比盒高就上下裁——返回的是项目画面相对预览盒的
     百分比矩形，视图直接落成 left/top/width/height。 */
  function cropRect(srcRatio, outRatio) {
    const sr = srcRatio > 0 ? srcRatio : 16 / 9;
    const orr = outRatio > 0 ? outRatio : sr;
    if (sr >= orr) {
      const w = +(sr / orr * 100).toFixed(3);
      return {left: +((100 - w) / 2).toFixed(3), top: 0, width: w, height: 100, cut: sr > orr + 1e-9 ? 'sides' : null};
    }
    const h = +(orr / sr * 100).toFixed(3);
    return {left: 0, top: +((100 - h) / 2).toFixed(3), width: 100, height: h, cut: 'topBottom'};
  }
  /** 预览盒：在 boxW×boxH 里按画幅比放到最大，整数像素。 */
  function fitBox(boxW, boxH, ratio) {
    const r = ratio > 0 ? ratio : 16 / 9;
    if (boxW <= 0 || boxH <= 0) return {w: 0, h: 0};
    return boxW / boxH > r ? {w: Math.round(boxH * r), h: Math.round(boxH)}
                           : {w: Math.round(boxW), h: Math.round(boxW / r)};
  }
  /** 生效清单里关着的 key 集合（含元素组里逐件的 `el:<id>`）——预览与画布按它跳过 */
  function offKeys(eff) {
    const off = {};
    (eff || []).forEach((l) => {
      if (l.kind === 'els') (l.items || []).forEach((it) => { if (!it.on) off[it.key] = true; });
      else if (!l.on) off[l.key] = true;
    });
    return off;
  }

  window.BC_EXPORT = {
    STD_SHORTS, FALLBACK_SHORT, RES_MBPS, K_MS_PER_FRAME_MPX, FPS,
    ratioValue, dims, resLabel, sourceShort, exportShort, resChoices, resolveShort, mmss,
    lanes, apply, setGroup, syncWrites,
    videoSegments, rangeOptions, defaultRange, rangeSpan,
    RANGE_MODES, chapterOptions, defaultChapter, toggleId, runsOf, clampCustom, spanOf, spanFiles, inRuns, stepIn,
    fmtT, parseT, fileT,
    QUALITY, QUALITY_KEYS, estimate, fmtEta, fmtLeft, fmtSize, LAN_BPS, uploadBytes, remoteEstimate, remoteNote,
    cropRect, fitBox, offKeys,
    PROJECT_TARGETS, targetMeta, bakeFormatsFor, BAKE_FORMAT_LABEL, BAKE_POLICIES, elementDelivery, deliverySummary,
    summary, videoName, exportPlace, SUB_FORMATS, subtitleNames, taskSub,
    TX_FORMATS, txLangOptions, txLangChecked, txLangLocked, txLangToggle, txLangPick, transcriptName, transcriptSummary,
    TASK_LABEL, pillLabel, preparationView, reviewLabel, cancelCopy,
  };
})();
