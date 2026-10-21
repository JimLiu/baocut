/* 审片视图的脚本与它的版本（docs/design/lite-editor §3「侧栏」的扩展，待确认的方案）。
   window.BC_LITE_SCRIPT。纯函数，无 React、无 DOM；App 与 Web 两个入口都加载。

   脚本是做这部视频时写下的那份 Markdown（讲明白、纪录片这类流程的 `脚本.md`）：生成方在把视频放上时间线时
   连同它写进视频，作为一份 `kind: 'script'` 的文档（正文 `{schema: 'baocut.script/1', markdown, file?}`）。
   文档本来就按版本存（视频格式规范 §4.4：每次写入一个版本，旧版本留着），所以「脚本的版本」就是这份文档的版本：
   智能体重写脚本是一版，回到某个版本也是一版（正文换成那一版的，单独记一版），不另造一套版本记录。

   演示数据在 data.js 视频条目的 `script`：{file, versions: [{n, kind, day, at, by, session?, markdown}]}，旧的在前；
   kind 是 create（做视频时写入）/ agent（智能体改写）/ restore（回到版本，带 from）。
   原型里「回到这个版本」只改这份状态（`extra`：回到版本加出来的那几版），不写 data.js。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** Markdown 按空行切块；标题单独成块。块只是比对与标出改动的单位，渲染仍按 Markdown。 */
  function blocks(markdown) {
    const out = [];
    String(markdown || '').replace(/\r\n?/g, '\n').split(/\n{2,}/).forEach(part => {
      const lines = part.split('\n');
      let buf = [];
      const flush = () => { const t = buf.join('\n').trim(); if (t) out.push(t); buf = []; };
      lines.forEach(line => {
        if (/^#{1,6}\s/.test(line)) { flush(); out.push(line.trim()); } else buf.push(line);
      });
      flush();
    });
    return out.map(text => ({text, heading: /^#{1,6}\s/.test(text) ? text.replace(/^#+\s*/, '') : null}));
  }

  /** 前一版与这一版逐块比（最长公共子序列）：same / added / removed；删掉一块紧跟着加了一块的并成一块 changed（显示新的那段）。 */
  function diff(prevMd, md) {
    const b = blocks(md);
    if (prevMd == null) return b.map(x => ({...x, status: 'same'}));
    const a = blocks(prevMd);
    const n = a.length, m = b.length;
    const dp = Array.from({length: n + 1}, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const raw = [];
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i].text === b[j].text) { raw.push({...b[j], status: 'same'}); i++; j++; }
      else if (i < n && (j >= m || dp[i + 1][j] >= dp[i][j + 1])) { raw.push({...a[i], status: 'removed'}); i++; }   // 先删后加，好并成 changed
      else { raw.push({...b[j], status: 'added'}); j++; }
    }
    /* 一串删掉紧跟一串新加：按位置配对成 changed（都是标题或都不是标题才配），配不上的照旧 */
    const out = [];
    for (let k = 0; k < raw.length;) {
      if (raw[k].status !== 'removed') { out.push(raw[k++]); continue; }
      const gone = [], added = [];
      while (k < raw.length && raw[k].status === 'removed') gone.push(raw[k++]);
      while (k < raw.length && raw[k].status === 'added') added.push(raw[k++]);
      const left = [], right = [];
      let g = 0, a = 0;
      while (g < gone.length && a < added.length) {
        if (!gone[g].heading === !added[a].heading) { out.push({...added[a], status: 'changed', before: gone[g].text}); g++; a++; }
        else if (gone[g].heading) right.push(added[a++]);
        else left.push(gone[g++]);
      }
      out.push(...left, ...gone.slice(g), ...right, ...added.slice(a));
    }
    return out;
  }

  const changeCount = changes => changes.filter(x => x.status !== 'same').length;

  /** 一块所在的小节：它前面最近的标题（它自己是标题就是它自己）。 */
  function sectionOf(list, index) {
    for (let k = index; k >= 0; k--) if (list[k].heading) return list[k].heading;
    return null;
  }

  /** 脚本的全部版本，旧的在前：data.js 的加上回到版本加出来的。 */
  function list(script, extra) {
    if (!script || !(script.versions || []).length) return [];
    return script.versions.map(v => ({kind: 'agent', ...v})).concat(extra || []);
  }

  /** 现在的正文：最新一版的。 */
  function current(script, extra) {
    const vs = list(script, extra);
    return vs.length ? vs[vs.length - 1].markdown : '';
  }

  /** 模板拼的摘要（不用模型）：做视频时写入 / 回到版本 N / 改了哪几个小节。 */
  function summary(prev, v) {
    if (v.kind === 'restore') return `回到版本 ${v.from}`;
    if (v.kind === 'create' || !prev) return '做视频时写入';
    const changes = diff(prev.markdown, v.markdown);
    const names = [];
    changes.forEach((x, k) => {
      if (x.status === 'same') return;
      const name = sectionOf(changes, k) || '开头';
      if (!names.includes(name)) names.push(name);
    });
    if (!names.length) return '没有改动正文';
    const shown = names.slice(0, 2).map(s => `「${s}」`).join('');
    return names.length > 2 ? `改了${shown}等 ${names.length} 处` : `改了${shown}`;
  }

  /** 谁写的：做视频的智能体、智能体、你。 */
  function byText(v) {
    if (v.kind === 'restore' || v.by === 'you') return '你';
    return '智能体';
  }

  const when = v => [v.day, v.at].filter(Boolean).join(' ');

  /** 版本列表的行，新的在前。 */
  function rows(script, extra) {
    const vs = list(script, extra);
    return vs.map((v, i) => ({n: v.n, kind: v.kind, latest: i === vs.length - 1, title: summary(vs[i - 1], v),
      sub: [when(v), byText(v)].filter(Boolean).join(' · '), session: v.session || null})).reverse();
  }

  /** 选中一版时要的：正文（带和前一版比的改动）、能不能回到它、为什么不能。 */
  function detail(script, extra, n) {
    const vs = list(script, extra);
    const i = vs.findIndex(v => v.n === n);
    if (i < 0) return null;
    const v = vs[i];
    const latest = i === vs.length - 1;
    const noop = !latest && v.markdown === vs[vs.length - 1].markdown;
    return {n: v.n, kind: v.kind, latest, first: i === 0, title: summary(vs[i - 1], v), when: when(v), by: byText(v), session: v.session || null,
      markdown: v.markdown, changes: diff(i ? vs[i - 1].markdown : null, v.markdown),
      canRestore: !latest && !noop,
      why: latest ? '这就是现在的脚本' : noop ? `脚本现在就是版本 ${v.n} 的正文，回到它不会有改动` : null};
  }

  /** 回到版本 n：加一个新版本，正文换成版本 n 的。和现在一样时不加（noop）。 */
  function restore(script, extra, n, clock) {
    const vs = list(script, extra);
    const v = vs.find(x => x.n === n);
    if (!v) return {error: `没有版本 ${n}`};
    if (v.markdown === vs[vs.length - 1].markdown) return {noop: true, extra};
    const m = vs[vs.length - 1].n + 1;
    return {extra: (extra || []).concat([{n: m, kind: 'restore', from: n, day: '今天', at: clock, by: 'you', markdown: v.markdown}]), version: m};
  }

  /** 正在播的这一段在脚本里对应的小节：标题以段的 ID 开头（「s02 聊天 AI 在写作文」），或标题就是段名。对不上返回 -1。 */
  function sectionFor(list, seg) {
    if (!seg) return -1;
    const id = String(seg.id || '').toLowerCase();
    const title = String(seg.title || '').trim();
    return list.findIndex(b => b.heading && ((id && b.heading.toLowerCase().split(/\s+/)[0] === id) || (title && b.heading.trim() === title)));
  }

  Object.assign(root, {BC_LITE_SCRIPT: {blocks, diff, changeCount, sectionOf, list, current, summary, rows, detail, restore, sectionFor}});
})();
