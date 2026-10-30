/* BaoCut 原型 — 从某一轮分叉、把视频回到那时（产品设计 §3.2.2「分叉」）里「算出来的东西」：window.BC_AGENT_FORK。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   分叉不分叉原生会话：新会话在同一个项目（无项目的会话用同一个文件夹）、同一个 Agent 里开，第一条消息带上截至那一轮的记录
   （只带你和 Agent 说的话，不带工具步骤，同「在会话中查找」的口径），所以每家 Agent 都能用。记录太长时留最近的，更早的略去并写明。
   「把视频回到那时」按视频的版本记录（model-video-versions.js）回到那一轮结束之前的最后一版：只列这条会话改过、那之后又有改动的视频；
   回到本身记成新的一版，可以再回来。那一版已被保留规则清掉、或链断开时，这部视频变灰并写明原因。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /** 带进新会话的记录最多多少字（同参考实现的上限）。超出时从最早的一轮开始略去。 */
  const CONTEXT_CHARS = 100000;
  const OMITTED = '[Earlier messages omitted]';

  /** 线程行切成回合（同 BC_AGENT_TURN.turns 的切法，这里只要用户消息的下标）：第 n 轮（从 1 数）从第 n 条用户消息开始。 */
  function turnNumber(rows, index) {
    let n = 0;
    for (let i = 0; i <= index && i < (rows || []).length; i++) if (rows[i].role === 'user') n++;
    return n;
  }

  /** 这一轮能不能分叉：已经结束（不在跑、不在等你），有用户消息也有回复。 */
  function forkable(turn, live) {
    return !!(turn && !live && turn.user && turn.replied);
  }

  /** 带进去的一条：用户消息与 Agent 正文；工具步骤、允许卡、提问卡、提示都不带。再分叉一次时，上一次带进来的记录原样接着带。 */
  function entryOf(row) {
    if (row && row.role === 'marker' && row.kind === 'fork') return (row.context && row.context.text) || null;
    const text = String((row && row.text) || '').trim();
    if (!text) return null;
    if (row.role === 'user') return `User: ${text}`;
    if (row.role === 'assistant') return `Assistant: ${text}`;
    return null;
  }

  /**
   * 截至第 `end` 行（含）的记录，给模型读（英文）：`{text, turns, omitted}`。`turns` 是带进去的轮数，`omitted` 是略去的轮数。
   * 超过 `limit` 字时从最早的整轮开始略去，开头写一行 `[Earlier messages omitted]`；最近的一轮本身就超长时截掉它的中间。
   */
  function context(rows, end, meta, limit) {
    const max = limit || CONTEXT_CHARS;
    const head = ['Chat history from a previous BaoCut session.'];
    if (meta && meta.title) head.push(`Source session: ${String(meta.title).slice(0, 200)}`);
    if (meta && meta.folder) head.push(`Source folder: ${String(meta.folder).slice(0, 500)}`);
    const turns = [];
    (rows || []).slice(0, end + 1).forEach((row) => {
      if (row.role === 'user' || row.role === 'marker' || !turns.length) turns.push([]);
      const e = entryOf(row);
      if (e) turns[turns.length - 1].push(e);
    });
    const blocks = turns.filter((t) => t.length).map((t) => t.join('\n\n'));
    const frame = (body) => `${head.join('\n')}\n\n${body}`;
    let budget = max - frame('').length;
    const kept = [];
    let omitted = 0;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const size = blocks[i].length + (kept.length ? 2 : 0);
      // 前面还有更早的轮时，留出「略去」那一行的位置
      const reserve = i > 0 ? OMITTED.length + 2 : 0;
      if (size + reserve <= budget) {
        kept.unshift(blocks[i]);
        budget -= size;
        continue;
      }
      omitted = i + 1;
      if (!kept.length) {
        const marker = '\n[Message truncated]\n';
        const room = Math.max(0, budget - reserve - marker.length);
        const a = Math.ceil(room / 2);
        kept.unshift(blocks[i].slice(0, a) + marker + blocks[i].slice(blocks[i].length - (room - a)));
        omitted = i;
      }
      break;
    }
    const body = kept.length ? (omitted ? `${OMITTED}\n\n` : '') + kept.join('\n\n') : 'No chat history.';
    return {text: frame(body), turns: kept.length, omitted};
  }

  /** 新会话里那一枚引用的字：「分叉自「标题」· 截至第 N 轮」。 */
  function refLabel(title, n) {
    return `分叉自「${title || '新会话'}」· 截至第 ${n} 轮`;
  }

  /* ---------- 把视频回到那时 ---------- */

  const VV = () => root.BC_VIDEO_VERSIONS;

  /**
   * 一部视频能不能回到 `ago` 分钟前（那一轮结束时）：`st` 是 BC_VIDEO_VERSIONS.normalize 之后的状态（新的在前，start/end 是多少分钟前）。
   * - `none`：那之后没有改动，不用回；
   * - `ok`：回到 `target` 版结束时（`after` 是那之后的版本数，含你自己和别的会话的改动）；
   * - `gone`：那一刻之前的版本已被保留规则清掉；`new`：这部视频是那之后才有的；
   * - `blocked`：版本记录读不出或对不上，`why` 是一行说明；`outside`：不在项目里，没有版本记录。
   */
  function restoreState(st, ago) {
    if (!st || !st.inProject) return {k: 'outside'};
    const list = st.versions || [];
    const after = list.filter((v) => v.end < ago);
    if (!after.length) return {k: 'none'};
    const base = list.find((v) => v.end >= ago);
    if (!base) {
      const oldest = list[list.length - 1];
      return oldest && oldest.n === 1 ? {k: 'new', after: after.length} : {k: 'gone', after: after.length};
    }
    const r = VV().reach(st, base.n, false, false);
    if (!r.ok) return {k: 'blocked', after: after.length, why: VV().blockedText(r)};
    if (VV().isNoop(st, base.n, false)) return {k: 'none'};
    return {k: 'ok', target: base.n, after: after.length};
  }

  /** 这条会话改过的视频（版本里记着它的会话 ID）。`states` 是 {视频 id: 版本状态}。 */
  function touchedBy(sessId, states) {
    return Object.keys(states || {}).filter((id) => (states[id].versions || []).some((v) => (v.convs || []).some((c) => c.id === sessId)));
  }

  /**
   * 分叉菜单与对话框里列哪些视频：这条会话改过、那一轮之后又有改动的。`movies` 是 {id, title}。
   * 每项 {id, title, state, checked, disabled, note}；回得去的默认勾上，回不去的变灰并写原因。
   */
  function restoreRows(sessId, movies, states, ago) {
    return touchedBy(sessId, states).map((id) => {
      const movie = (movies || []).find((m) => m.id === id) || {id, title: id};
      const state = restoreState(states[id], ago);
      return {id, title: movie.title, state, checked: state.k === 'ok', disabled: state.k !== 'ok', note: restoreNote(state)};
    }).filter((r) => r.state.k !== 'none' && r.state.k !== 'outside');
  }

  /** 每部视频的一行说明。 */
  function restoreNote(s) {
    if (s.k === 'ok') return `回到版本 ${s.target}；那之后的 ${s.after} 版改动（含你和别的会话的）都会撤回`;
    if (s.k === 'gone') return '那时的版本已不在（版本记录只留最近 10 版和保存的版本）';
    if (s.k === 'new') return '这部视频是那之后才有的，不动它';
    if (s.k === 'blocked') return s.why;
    return '';
  }

  /** 菜单第二项的状态：没有要回的视频时不出现；都回不去时变灰。 */
  function restoreItem(rows) {
    if (!rows.length) return null;
    const ok = rows.filter((r) => r.state.k === 'ok').length;
    if (!ok) return {disabled: true, note: rows.length === 1 ? rows[0].note : '那时的版本都已不在或读不出'};
    return {disabled: false, note: rows.length === 1 ? `「${rows[0].title}」回到那一轮结束时` : `${ok} 部视频回到那一轮结束时`};
  }

  /** 分叉之后的提示。 */
  function doneText(restored) {
    return restored ? `已分叉到新会话，${restored} 部视频回到了那时；版本记录里可以再回来` : '已分叉到新会话';
  }

  root.BC_AGENT_FORK = {CONTEXT_CHARS, OMITTED, turnNumber, forkable, entryOf, context, refLabel,
    restoreState, touchedBy, restoreRows, restoreNote, restoreItem, doneText};
})();
