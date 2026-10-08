/* 字幕的拆与并（第 155 轮，§13.2）——纯模型，两张列表共用。

   这一层回答的是「回车、退格落下去之后数据长什么样」，与键位、按钮、toast 无关：

     · 单列 cue 列表：`splitCue` 在光标处把一条拆成两条（时间按**字数比例**分、每边
       不短于 MIN_DUR），`mergeCues` 把一条并进相邻那条（同说话人才并；文本按两端字符
       决定接法——中日文直接相接、拉丁文补一个空格）。cue 是写入单位，段落是投影：
       拆出来的新条带 `root`（它从哪一条原始 cue 长出来），`parasOf` 据此把段落的
       cueIds 重投影，文稿 Tab 不用另存一份。
     · 双语对照卡：块卡的一行 = 一个对齐块（原文 / 译文成对）。`splitRow` 在一侧的光标处
       在已有成对边界把两侧同时拆成两行；没有内部边界的原子块不拆。`mergeRows` 把相邻两行
       并回一行；`mergeCards` 把两句（两张卡）并成一张——那正是「合并两个句子」：
       行首再按一次退格，跨过卡的边界并到上一句去。多对一 / 亏空 / 整句对应三种卡
       没有「行」这个单位，不参与拆并（返回 err）。

   与 apps/baocut 的口径：`cue_edit.rs` 的 Enter 在文本内拆、在两端提交，`merge_up`
   只并同说话人；`translation_edit.rs` 的 `merge_piece_up` / `merge_sentence_up`。
   成对单位只来自演示数据或之前的合并，不能按字符比例猜另一侧的译文。 */
(function () {
  const MIN_DUR = 0.3;
  const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

  /** 两段文本相接时中间放什么：中日文（或已带空白）直接相接，其余补一个空格。 */
  function joiner(a, b) {
    if (!a || !b) return '';
    const l = a[a.length - 1];
    const f = b[0];
    if (CJK.test(l) || CJK.test(f) || /\s/.test(l) || /\s/.test(f)) return '';
    return ' ';
  }

  /** 在 at 处切文本；任一侧切空就不算拆（= 光标在两端）。 */
  function cutText(text, at) {
    const s = String(text == null ? '' : text);
    const i = Math.max(0, Math.min(s.length, at | 0));
    const left = s.slice(0, i).trim();
    const right = s.slice(i).trim();
    if (!left || !right) return null;
    return {left, right};
  }

  /** 拆分点的时间：按左右字数比例分，两边各不短于 MIN_DUR（太短的条按中点对半）。 */
  function splitTime(start, end, leftLen, rightLen) {
    const dur = end - start;
    if (dur <= MIN_DUR * 2) return +(start + dur / 2).toFixed(2);
    const k = leftLen / Math.max(1, leftLen + rightLen);
    const t = start + dur * k;
    return +Math.min(end - MIN_DUR, Math.max(start + MIN_DUR, t)).toFixed(2);
  }

  function freshId(cues, base) {
    const taken = new Set(cues.map((c) => c.id));
    let n = 1;
    while (taken.has(base + '-' + n)) n++;
    return base + '-' + n;
  }

  /** 把 id 这条在 at 处拆成两条。text 是这一刻的文本（可能还没提交）。
      返回 {cues, id: 新条 id, left, right}；光标在两端返回 null（= 这不是一次拆分）。 */
  function splitCue(cues, id, text, at) {
    const i = cues.findIndex((c) => c.id === id);
    if (i < 0) return null;
    const cut = cutText(text, at);
    if (!cut) return null;
    const c = cues[i];
    const t = splitTime(c.start, c.end, cut.left.length, cut.right.length);
    const nid = freshId(cues, c.root || c.id);
    const a = Object.assign({}, c, {text: cut.left, end: t});
    const b = Object.assign({}, c, {id: nid, text: cut.right, trans: '', start: t, root: c.root || c.id});
    const next = cues.slice(0, i).concat([a, b], cues.slice(i + 1));
    return {cues: next, id: nid, left: cut.left, right: cut.right};
  }

  /** 把 id 这条并进 dir（-1 上 / +1 下）那条。text 是这一刻的文本。
      返回 {cues, id: 并后那条的 id, caret: 接缝在并后文本里的位置}，或 {err: 'edge' | 'speaker'}。 */
  function mergeCues(cues, id, text, dir) {
    const i = cues.findIndex((c) => c.id === id);
    if (i < 0) return {err: 'edge'};
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= cues.length) return {err: 'edge'};
    const me = Object.assign({}, cues[i], {text: String(text == null ? cues[i].text : text)});
    const other = cues[j];
    if (me.sp !== other.sp) return {err: 'speaker'};
    const first = dir < 0 ? other : me;
    const second = dir < 0 ? me : other;
    const jn = joiner(first.text, second.text);
    const tj = joiner(first.trans, second.trans);
    const merged = Object.assign({}, first, {
      text: first.text + jn + second.text,
      trans: (first.trans || '') + tj + (second.trans || ''),
      end: second.end,
    });
    const lo = Math.min(i, j);
    const next = cues.slice(0, lo).concat([merged], cues.slice(lo + 2));
    return {cues: next, id: merged.id, caret: first.text.length + jn.length};
  }

  /** 段落投影：段落记的是原始 cueIds，拆出来的新条按 root 归回原段，并掉的条自然消失；
      一条 cue 都不剩的段落不再出现。 */
  function parasOf(cues, paras) {
    const byRoot = new Map();
    cues.forEach((c, i) => {
      const r = c.root || c.id;
      if (!byRoot.has(r)) byRoot.set(r, []);
      byRoot.get(r).push({c, i});
    });
    const out = [];
    paras.forEach((p) => {
      const list = p.cueIds.flatMap((id) => byRoot.get(id) || []).sort((a, b) => a.i - b.i);
      if (!list.length) return;
      out.push(Object.assign({}, p, {
        cueIds: list.map((x) => x.c.id),
        start: list[0].c.start,
        end: list[list.length - 1].c.end,
      }));
    });
    return out;
  }

  /* ---------- 双语对照卡 ---------- */

  /** 这张卡的行（原文 / 译文成对）；没有「行」这个单位的卡返回 null。 */
  function rowsOf(card) {
    const row = (o, t, units) => Object.assign({o, t}, units ? {units} : {});
    if (card.kind === 'block') return card.blocks.map((b) => row(b.o, b.t, b.units));
    if (card.kind === 'plain') return [row(card.orig || '', card.trans || '', card.units)];
    return null;
  }

  /** 用行表重建卡：一行就是普通成对卡，多行是块卡。与行无关的字段原样带走。 */
  function withRows(card, rows) {
    const base = Object.assign({}, card);
    delete base.blocks; delete base.orig; delete base.trans; delete base.untranslated; delete base.units;
    if (rows.length === 1) return Object.assign(base, {kind: 'plain', orig: rows[0].o, trans: rows[0].t}, rows[0].units ? {units: rows[0].units} : {});
    return Object.assign(base, {kind: 'block', blocks: rows.map((r) => Object.assign({}, r, {ow: r.o.length, tw: r.t.length}))});
  }

  const joined = (units, key) => units.reduce((text, unit) => text + joiner(text, unit[key]) + unit[key], '');
  /** 普通卡 / 多对一卡的原文是 cue 子行，拆 cue 不切译文。块卡另走成对边界。 */
  function sourceRows(card) {
    if (card.kind === 'plain') return [card.orig || ''];
    if (card.kind === 'many' || card.kind === 'deficit') return card.subs;
    return null;
  }
  function withSourceRows(card, subs) {
    const next = Object.assign({}, card);
    delete next.orig; delete next.subs; delete next.units;
    if (subs.length === 1) return Object.assign(next, {kind: 'plain', orig: subs[0]});
    return Object.assign(next, {kind: card.kind === 'deficit' ? 'deficit' : 'many', subs});
  }
  function splitSourceRow(card, i, text, at) {
    const rows = sourceRows(card), cut = cutText(text, at);
    if (!rows || rows[i] == null || !cut) return null;
    return withSourceRows(card, rows.slice(0, i).concat([cut.left, cut.right], rows.slice(i + 1)));
  }
  function mergeSourceRows(card, i, text, dir) {
    const rows = sourceRows(card), j = i + (dir < 0 ? -1 : 1);
    if (!rows || rows[i] == null || rows[j] == null) return null;
    const first = dir < 0 ? rows[j] : text, second = dir < 0 ? text : rows[j];
    const seam = joiner(first, second), lo = Math.min(i, j);
    return {card: withSourceRows(card, rows.slice(0, lo).concat([first + seam + second], rows.slice(lo + 2))),
      row: lo, caret: first.length + seam.length};
  }
  /** 已有成对单位必须能原样拼回当前行；旧覆盖改写后不再把旧边界当作对齐真相。 */
  function pairedUnits(row) {
    const units = row.units;
    return Array.isArray(units) && units.length && units.every(u => u.o && u.t)
      && joined(units, 'o') === row.o && joined(units, 't') === row.t ? units : [{o: row.o, t: row.t}];
  }

  /** 在第 i 行 side（'orig' | 'trans'）一侧的 at 处拆行；text 是这一侧这一刻的文本。
      返回新卡，光标在两端返回 null。 */
  function splitRow(card, i, side, text, at) {
    const rows = rowsOf(card);
    if (!rows || !rows[i]) return null;
    if (!cutText(text, at)) return null;
    const key = side === 'orig' ? 'o' : 't';
    const units = pairedUnits(rows[i]);
    if (units.length < 2) return null;
    let best = null;
    for (let j = 1; j < units.length; j++) {
      const left = units.slice(0, j), right = units.slice(j);
      const cut = joined(left, key).length;
      if (!best || Math.abs(cut - at) < Math.abs(best.cut - at)) best = {left, right, cut};
    }
    const split = cutText(text, best.cut);
    if (!split) return null;
    const make = us => ({o: joined(us, 'o'), t: joined(us, 't'), units: us});
    const a = make(best.left), b = make(best.right);
    a[key] = split.left; b[key] = split.right;
    // 当前草稿与拆分同笔接纳；改过的块不沿用已经对不回文本的内部边界。
    if (text !== rows[i][key]) {delete a.units; delete b.units;}
    return withRows(card, rows.slice(0, i).concat([a, b], rows.slice(i + 1)));
  }

  /** 把第 i 行并进 dir 那一行（两侧各自相接）。返回 {card, row, caret: {o, t}} 或 {err}。 */
  function mergeRows(card, i, side, text, dir) {
    const rows = rowsOf(card);
    if (!rows) return {err: 'kind'};
    const j = i + (dir < 0 ? -1 : 1);
    if (!rows[i] || !rows[j]) return {err: 'edge'};
    const me = Object.assign({}, rows[i]);
    if (text != null) me[side === 'orig' ? 'o' : 't'] = String(text);
    const first = dir < 0 ? rows[j] : me;
    const second = dir < 0 ? me : rows[j];
    const jo = joiner(first.o, second.o);
    const jt = joiner(first.t, second.t);
    const merged = {o: first.o + jo + second.o, t: first.t + jt + second.t,
      units: pairedUnits(first).concat(pairedUnits(second))};
    const lo = Math.min(i, j);
    return {
      card: withRows(card, rows.slice(0, lo).concat([merged], rows.slice(lo + 2))),
      row: lo,
      caret: {o: first.o.length + jo.length, t: first.t.length + jt.length},
    };
  }

  /** 把 id 这张卡并进 dir 那张：两张的行首尾相接成一张（= 合并两个句子）。
      返回 {cards, id, row: 第二张的第一行在并后卡里的序号} 或 {err: 'edge' | 'speaker' | 'kind'}。 */
  function mergeCards(cards, id, dir) {
    const i = cards.findIndex((c) => c.id === id);
    if (i < 0) return {err: 'edge'};
    const j = i + (dir < 0 ? -1 : 1);
    if (j < 0 || j >= cards.length) return {err: 'edge'};
    const first = dir < 0 ? cards[j] : cards[i];
    const second = dir < 0 ? cards[i] : cards[j];
    const ra = rowsOf(first);
    const rb = rowsOf(second);
    if (!ra || !rb) return {err: 'kind'};
    if (first.sp !== second.sp) return {err: 'speaker'};
    const merged = withRows(first, ra.concat(rb));
    // 合并句子的显示跨度也要合并，否则新文本仍除以第一句的旧时长。
    if (Number.isFinite(first.duration) && Number.isFinite(second.duration)) {
      const parse = time => String(time || '0').split(':').reduce((n, part) => n * 60 + Number(part), 0);
      merged.duration = Math.max(first.duration, parse(second.time) + second.duration - parse(first.time));
    }
    if (second.stale) merged.stale = true;
    const lo = Math.min(i, j);
    return {cards: cards.slice(0, lo).concat([merged], cards.slice(lo + 2)), id: merged.id, row: ra.length};
  }

  /** 两张相邻卡能不能并（悬停接缝上那枚「并入上一句」按它决定要不要出现）。 */
  function canMergeCards(cards, id, dir) {
    const r = mergeCards(cards, id, dir);
    return !r.err;
  }

  /** 两条相邻 cue 能不能并。 */
  function canMergeCues(cues, id, dir) {
    return !mergeCues(cues, id, null, dir).err;
  }

  /** 暂停时点正文跟播放头（第 159 轮）：光标落在第 `at` 个字（全文 `len` 字）上，
   *  播放头该去哪。原型的 cue 没有词级时间，只能在 [start, end] 里按字符位置线性插值；
   *  App 拿 transcript 的 words[] 真实词时（`transcript_list::word_index_at_byte_offset`），
   *  这里是它的近似。两端与非法输入都收到 start，永不越过 end。 */
  function caretTime(start, end, at, len) {
    const s = Number(start) || 0;
    const e = Math.max(s, Number(end) || s);
    if (!(len > 0) || !(at > 0)) return s;
    const f = Math.min(1, at / len);
    return Math.round((s + (e - s) * f) * 100) / 100;
  }

  window.BC_CUEOPS = {MIN_DUR, joiner, cutText, splitTime, splitCue, mergeCues, canMergeCues, parasOf,
    rowsOf, withRows, sourceRows, splitSourceRow, mergeSourceRows, splitRow, mergeRows, mergeCards, canMergeCards, caretTime};
})();
