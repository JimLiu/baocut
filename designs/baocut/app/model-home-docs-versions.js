/* 协作文档的版本记录（版本记录设计 §13.2，待确认的三期方案）：每个标签页的正文各自记版本，与视频的版本记录同一套说法。
   window.BC_HOME_DOCS_VERSIONS。纯函数，无 React、无 DOM；只在 App 入口加载（原型的 Web 入口没有协作文档）。

   文档服务已经给每个正文留最近 50 个 rev 的快照（tabs/<id>.history.json），但编辑器每一批改动、智能体每次调用都是一个 rev，
   连续输入几分钟就挤掉更早的。版本是它上面的一层：分段规则同视频（§3.1：安静 5 分钟、满 30 分钟、智能体开始新的一轮），
   一版存这一段结束时的正文，每个标签页最多留 10 个（建议存在 tabs/<id>.versions.json）。

   版本（data.js 协作文档条目的 `versions[<标签页 id>]`，旧的在前）：
     {n, day, start, end, by: [{kind: 'you' | 'agent', session?}], cut?: 'quiet' | 'max' | 'turn', open?, blocks}
   `blocks` 是这一版结束时的正文，块的写法同 model-home-docs.js。data.js 里最新的一版不写 `blocks`：它就是标签页的正文（`tab.blocks`）。
   `open` 是还开着的最新一版；`cut` 是它之后为什么切出了新的一版。回到版本加的一版是 {kind: 'restore', from}，单独成版。

   原型里的「回到这个版本」只改这份状态（`extra`：每个标签页回到版本后加出来的那几版），不写 data.js。 */
(function () {
  const KEEP = 10;
  const CUT = {quiet: '之后安静了 5 分钟', max: '这一版满 30 分钟', turn: '智能体开始了新的一轮'};

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /** 一个标签页的版本，旧的在前：data.js 的加上回到版本加出来的；超过 10 个时删最旧的。最新一版带上现在的正文。 */
  function list(doc, tabId, extra) {
    const tab = (doc?.tabs || []).find((t) => t.id === tabId);
    if (!tab) return [];
    const seeded = ((doc.versions || {})[tabId] || []).map((v) => Object.assign({kind: 'edit'}, v));
    if (!seeded.length) seeded.push({n: 1, kind: 'edit', day: '今天', start: '', end: '', by: [{kind: 'you'}], open: true});
    /* data.js 里最新的那一版就是标签页现在的正文；回到版本加出来的几版各自带着正文，接在它后面 */
    const top = seeded[seeded.length - 1];
    if (!top.blocks) seeded[seeded.length - 1] = Object.assign({}, top, {blocks: tab.blocks});
    const all = seeded.concat((extra || {})[tabId] || []);
    /* 回到版本以后，原来还开着的那一版收口 */
    return all.map((v, i) => (i < all.length - 1 && v.open ? Object.assign({}, v, {open: false, cut: v.cut || 'restore'}) : v)).slice(-KEEP);
  }

  /** 标签页现在的正文：最新一版的正文。 */
  function current(doc, tabId, extra) {
    const vs = list(doc, tabId, extra);
    return vs.length ? vs[vs.length - 1].blocks : [];
  }

  /** 前一版与这一版逐块比：按块 id 对上；这一版里有、前一版没有的是 added，文字变了的是 changed；
      前一版有、这一版没有的作为 removed 插回它原来的位置后面。没有前一版时全是 same。 */
  function diff(prev, blocks) {
    if (!prev) return blocks.map((b) => ({block: b, status: 'same'}));
    const before = new Map(prev.map((b) => [b.id, b]));
    const after = new Set(blocks.map((b) => b.id));
    const out = blocks.map((b) => {
      const p = before.get(b.id);
      return {block: b, status: !p ? 'added' : same(p, b) ? 'same' : 'changed'};
    });
    prev.forEach((b, i) => {
      if (after.has(b.id)) return;
      /* 放到它在前一版里前面那一块的后面（那一块可能也是刚插回来的删掉的块）；前面没有块就放最前 */
      let at = 0;
      for (let j = i - 1; j >= 0; j--) {
        const k = out.findIndex((x) => x.block.id === prev[j].id);
        if (k >= 0) { at = k + 1; break; }
      }
      out.splice(at, 0, {block: b, status: 'removed'});
    });
    return out;
  }

  /** 一块所在的小节：它前面最近的标题；它自己是标题就是它自己。 */
  function sectionOf(blocks, id) {
    const i = blocks.findIndex((b) => b.id === id);
    for (let j = i; j >= 0; j--) if (/^h\d$/.test(blocks[j].type)) return blocks[j].text;
    return null;
  }

  /** 模板拼的摘要（不用模型，§13.4）：改了哪几个小节。 */
  function summary(prev, v) {
    if (v.kind === 'restore') return `回到版本 ${v.from}`;
    if (!prev) return '第一版';
    const changes = diff(prev.blocks, v.blocks).filter((x) => x.status !== 'same');
    if (!changes.length) return '没有改动正文';
    const names = [];
    for (const x of changes) {
      const name = sectionOf(x.status === 'removed' ? prev.blocks : v.blocks, x.block.id) || '开头';
      if (!names.includes(name)) names.push(name);
    }
    const shown = names.slice(0, 2).map((s) => `「${s}」`).join('');
    return names.length > 2 ? `改了${shown}等 ${names.length} 处` : `改了${shown}`;
  }

  /** 谁改的：你、智能体（带会话名）。 */
  function byText(v, sessionTitle) {
    if (v.kind === 'restore') return '你';
    return (v.by || []).map((b) => (b.kind === 'agent' ? `智能体${b.session && sessionTitle(b.session) ? `（${sessionTitle(b.session)}）` : ''}` : '你')).join('、');
  }

  function range(v) {
    if (!v.start) return v.day;
    return v.end && v.end !== v.start ? `${v.day} ${v.start}–${v.end}` : `${v.day} ${v.start}`;
  }

  /** 版本列表的行，新的在前。 */
  function rows(doc, tabId, extra, sessionTitle = () => null) {
    const vs = list(doc, tabId, extra);
    return vs.map((v, i) => ({
      n: v.n, kind: v.kind, open: !!v.open,
      title: summary(vs[i - 1], v),
      sub: [range(v), byText(v, sessionTitle)].filter(Boolean).join(' · '),
    })).reverse();
  }

  /** 选中一版时详情栏要的：正文（带和前一版比的改动）、能不能回到它、为什么不能。 */
  function detail(doc, tabId, extra, n, sessionTitle = () => null) {
    const vs = list(doc, tabId, extra);
    const i = vs.findIndex((v) => v.n === n);
    if (i < 0) return null;
    const v = vs[i];
    const latest = i === vs.length - 1;
    const now = vs[vs.length - 1].blocks;
    const noop = !latest && same(v.blocks, now);
    return {
      n: v.n, kind: v.kind, open: !!v.open, latest,
      title: summary(vs[i - 1], v),
      range: range(v), by: byText(v, sessionTitle),
      sessions: v.kind === 'restore' ? [] : (v.by || []).filter((b) => b.kind === 'agent' && b.session).map((b) => b.session),
      cut: v.cut ? (v.cut === 'restore' ? '之后回到了别的版本' : CUT[v.cut]) : null,
      changes: diff(vs[i - 1] ? vs[i - 1].blocks : null, v.blocks),
      first: i === 0,
      canRestore: !latest && !noop,
      why: latest ? '这就是标签页现在的正文' : noop ? `标签页现在就是版本 ${v.n} 的正文，回到它不会有改动` : null,
    };
  }

  /** 回到版本 n：加一个新的版本，正文换成版本 n 的；原来还开着的那一版收口。和现在一样时不加（noop）。 */
  function restore(doc, tabId, extra, n, clock) {
    const vs = list(doc, tabId, extra);
    const v = vs.find((x) => x.n === n);
    if (!v) return {error: `没有版本 ${n}`};
    if (same(v.blocks, vs[vs.length - 1].blocks)) return {noop: true, extra};
    const m = vs[vs.length - 1].n + 1;
    const next = Object.assign({}, extra || {});
    next[tabId] = ((extra || {})[tabId] || []).concat([{n: m, kind: 'restore', from: n, day: '今天', start: clock, end: clock, by: [{kind: 'you'}], blocks: v.blocks}]);
    return {extra: next, version: m};
  }

  /** 和前一版比改了几块，给版本栏的「显示改动 · N 处」用。 */
  function changeCount(changes) {
    return changes.filter((x) => x.status !== 'same').length;
  }

  Object.assign(window, {BC_HOME_DOCS_VERSIONS: {KEEP, list, current, diff, summary, rows, detail, restore, changeCount, sectionOf}});
})();
