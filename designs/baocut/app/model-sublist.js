/* 字幕 Tab 列表的**对照条**模型（第 153 轮，§13.2）。

   第 152 轮把翻译并进字幕 Tab 之后，列表「装哪一屏」是从轨条的选中反推的：选中原文轨
   → 单列，选中译文轨 → 双语对照。用户看不出来这条规则——轨条读起来是「画面上有哪几条、
   样式改哪一条」，不像「列表给我看哪一门语言」；想看「中文 ＋ 日本語」对照去改两边的
   字幕时，找不到开关。所以列表现在有自己的一行控件（对照条），三档模式 ＋ 一门对照语言：

     src    只看原文（单列 cue 列表，可直接改写）
     bi     原文 ＋ 译文（双语对照，两侧都能直接改写）
     trans  只看译文（单列，只改译文；可选做的那一档）

   与轨条的耦合只剩一条、单向：**选中一条译文轨（轨条 chip、画布、时间轴的译文行）会把
   对照语言切成它**（单列时顺便切到双语）——那是「我在看这门语言」最自然的入口；选中原文轨
   不动列表：用户可能正在双语里改样式作用域，列表不该跟着塌成单列。

   这里只做纯计算：候选语言表、偏好 → 实际视图的收敛、选中带来的偏好变化、头部文案。 */
(function () {
  const MODES = ['src', 'bi', 'trans'];

  // 镜像 bcut-editor-core::subtitle_list：Unicode 字符计数，不计空白；
  // 判档用未取整的速度，显示才保留一位小数。泰语与 CJK 使用紧凑文字阈值。
  function readingSpeed(text, duration, language) {
    const count = Array.from(String(text || '')).filter(c => !/\p{White_Space}/u.test(c)).length;
    const raw = count / Math.max(0.1, Number(duration) || 0);
    const compact = /^(zh|ja|ko|th)(?:[-_]|$)/i.test(String(language || ''));
    const [warn, bad] = compact ? [9, 13] : [17, 21];
    return {value: Math.round(raw * 10) / 10,
      level: !count ? 'none' : raw > bad ? 'bad' : raw > warn ? 'warn' : 'ok'};
  }

  /** 能对照的语言：落了轨的译文（含停用的）、拿下来的（`shelved`）、正在翻的（`running`）。
   *  顺序 = 轨条上的顺序：画面上的在前，拿下的其次，正在翻的最后。 */
  function langs({tracks, shelved, running}) {
    const out = [];
    const seen = new Set();
    const add = (code, name, state, extra) => {
      if (!code || seen.has(code)) return;
      seen.add(code);
      out.push(Object.assign({code, name: name || code, state}, extra || {}));
    };
    (tracks || []).forEach((t) => { if (t.role === 'translation') add(t.id, t.name, t.hidden ? 'off' : 'on'); });
    (shelved || []).forEach((t) => { if (t.role === 'translation') add(t.id, t.name, 'shelved'); });
    if (running && running.code) {
      /* 正在翻的那门已经落了轨（重翻）：条目不换态——轨在画面上、列表照旧能看，
         只在它身上挂进度；还没落轨的才是一条独立的「翻译中」候选。 */
      const had = out.find((o) => o.code === running.code);
      /* 智能体自己翻译没有百分比：pct 留 null，后缀只写「翻译中」 */
      const pct = running.pct == null ? null : running.pct;
      if (had) { had.pct = pct; had.running = true; }
      else add(running.code, running.name, 'running', {pct});
    }
    return out;
  }

  /** 偏好 → 实际视图。没有任何译文时只能是单列；偏好的语言不在候选里就落到第一门
   *  （刚拿下 / 刚翻完的那门仍在候选里，所以「拿下」不会把列表打回原文）。 */
  function resolve(pref, opts) {
    const p = pref || {};
    const mode = MODES.includes(p.mode) ? p.mode : 'src';
    if (!opts || !opts.length) return {mode: 'src', lang: null, opt: null};
    const opt = opts.find((o) => o.code === p.lang) || opts[0];
    return {mode, lang: opt.code, opt};
  }

  /** 选中变化带来的偏好变化：选中译文轨 → 对照语言切成它、单列切到双语；其余不动。 */
  function onPick(pref, trackId, opts) {
    const p = pref || {mode: 'src', lang: null};
    if (!trackId || !(opts || []).some((o) => o.code === trackId)) return p;
    if (p.lang === trackId && p.mode !== 'src') return p;
    return {mode: p.mode === 'src' ? 'bi' : p.mode, lang: trackId};
  }

  /** 面板头右侧那一句：在看什么。 */
  function label(view, srcName) {
    const l = view.opt ? view.opt.name : '';
    if (view.mode === 'bi' && l) return srcName + ' ＋ ' + l;
    if (view.mode === 'trans' && l) return '只看 ' + l;
    return srcName;
  }

  /** 下拉里一门语言的后缀：状态不是 `on` 才说，画面上有的不用标。 */
  function suffix(o) {
    if (o.state === 'running' || o.running) return o.pct == null ? '翻译中' : '翻译中 ' + Math.round(o.pct) + '%';
    if (o.state === 'shelved') return '已拿下';
    if (o.state === 'off') return '已停用';
    return '';
  }

  Object.assign(window, {BC_SUBLIST: {MODES, langs, resolve, onPick, label, suffix, readingSpeed}});
})();
