/* BaoCut 原型 — 视频的版本记录（2026-10-17，视频格式规范 §9、版本记录设计 §6）
   window.BC_VIDEO_VERSIONS。纯函数，无 React、无 DOM。

   版本记录是视频目录里 `.bcut-snapshot/history/` 的版本文件：每版一份从上一版到这一版的 diff，头部列出动作、执行者与会话。
   这里算：摘要（与引擎同一套模板）、执行者与文件的显示名、时间段、能不能回到（读不出的版本、链断开的位置）、
   回到之后是否与当前相同（相同就不提交、不产生版本），保存 / 回到 / 删除保存的版本之后的新状态，
   以及快照被外部改过时的导入与两个选择（§9.8）。

   原型不存真快照：每个版本结束时的状态记一个状态号 `to`，开始之前是 `from`（上一版的 `to`）。保存的版本 diff 为空，`from === to`；
   回到版本的 `to` 是目标的状态号。比较状态号就知道一次回到会不会改变视频。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 种类（§9.4）。图标是 S2 图标名（RSP.Icons）。`external` 是快照被外部改过、BaoCut 导入的那一版（§9.8）。 */
  const KINDS = {
    segment:  {k: 'segment',  label: '一段修改', icon: 'Edit'},
    save:     {k: 'save',     label: '保存的版本', icon: 'Bookmark'},
    restore:  {k: 'restore',  label: '回到版本', icon: 'Revert'},
    external: {k: 'external', label: '外部变更', icon: 'Cloud'},
    rebuild:  {k: 'rebuild',  label: '重建', icon: 'Refresh'},
  };

  /* 冲突的两种原因（§9.7 `conflict`）：两边都改了可以选任一边；快照读不出只能保留 BaoCut 里的。 */
  const CONFLICTS = {
    'both-changed': {k: 'conflict', reason: 'both-changed', label: '快照和 BaoCut 都改过', tone: 'negative',
      desc: '快照文件被外部改过，BaoCut 里也有还没写进快照的修改。选好保留哪边之前，BaoCut 不覆盖快照。'},
    invalid: {k: 'conflict', reason: 'invalid', label: '快照读不出', tone: 'negative',
      desc: '快照文件解析不了，BaoCut 没有导入。修好文件后会重新检查，也可以用 BaoCut 里的覆盖它们。'},
  };

  /* 快照与视频库的关系（§9.7，`videos.versions.status`）。tone 是 S2 StatusLight 的 variant。
     `external` 只有快照被改、BaoCut 里没有别的改动：发现就导入，通常不到一秒，单独给一个状态好让内容变化有个说法。 */
  const STATES = {
    synced:   {k: 'synced',   label: '快照已同步',       tone: 'positive',    desc: '视频目录里的工作区快照与当前内容一致。'},
    pending:  {k: 'pending',  label: '正在写入快照',     tone: 'informative', desc: '刚才的修改几秒内写进快照与版本记录。'},
    external: {k: 'external', label: '正在导入外部改动', tone: 'informative',
      desc: '快照文件被外部改过（git pull、同步盘或手改），BaoCut 里没有别的改动，正在把它们导入成一个「外部变更」版本。'},
    conflict: CONFLICTS['both-changed'],
    missing:  {k: 'missing',  label: '还没有快照',       tone: 'neutral',     desc: '工作区快照还没写下，或者 video.json 不在了。'},
    rebuild:  {k: 'rebuild',  label: '待重建',           tone: 'informative', desc: '只有工作区快照，没有视频库。打开时从快照重建。'},
  };

  /* 原型里的「现在」：演示数据只记多少分钟前，换成钟点时以它为准（UTC 读数，免得测试随时区变）。 */
  const NOW = Date.UTC(2026, 9, 17, 10, 30);
  const pad = (n) => String(n).padStart(2, '0');
  const at = (min) => new Date(NOW - Math.round(min || 0) * 60000);
  const clock = (min) => { const d = at(min); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
  const dayKey = (min) => { const d = at(min); return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`; };
  function dayLabel(min) {
    const d = at(min);
    const days = Math.round((Date.UTC(2026, 9, 17) - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 86400000);
    if (days === 0) return '今天';
    if (days === 1) return '昨天';
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
  }
  /** 「今天 09:41–10:02」；开始与结束在同一分钟只写一个钟点；跨天两头都写日子。 */
  function rangeText(v) {
    const a = v.start, b = v.end;
    if (clock(a) === clock(b) && dayKey(a) === dayKey(b)) return `${dayLabel(a)} ${clock(a)}`;
    if (dayKey(a) === dayKey(b)) return `${dayLabel(a)} ${clock(a)}–${clock(b)}`;
    return `${dayLabel(a)} ${clock(a)} – ${dayLabel(b)} ${clock(b)}`;
  }
  function agoText(min) {
    const m = Math.max(0, Math.round(min || 0));
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    if (m < 60 * 24) return `${Math.floor(m / 60)} 小时前`;
    return `${dayLabel(m)} ${clock(m)}`;
  }

  /* ---------- 执行者、文件 ---------- */

  /** 操作者 ID（§9.4 `Action`）的种类：用户、智能体、外部服务、BaoCut 自己。 */
  function actorKind(actor) {
    const a = String(actor || '');
    if (a === 'user_local' || a.startsWith('user')) return 'user';
    if (a.startsWith('agent:')) return 'agent';
    if (a.startsWith('external:')) return 'external';
    return 'system';
  }
  /** 显示名：`user_local` 是「你」，`agent:claude` 取已知的智能体名，`system:*` 是 BaoCut。 */
  function actorLabel(actor, names) {
    const k = actorKind(actor);
    const id = String(actor || '').split(':').slice(1).join(':');
    if (k === 'user') return '你';
    if (k === 'agent') return (names && names[id]) || id || '智能体';
    if (k === 'external') return `外部服务 ${id}`;
    return 'BaoCut';
  }

  /** 快照里的文件（相对 `.bcut-snapshot/`）→ 给人看的部分：video.json 是时间线，documents/<id>.json 是那份文档。 */
  function fileLabel(path, docs) {
    if (path === 'video.json') return '时间线';
    const m = /^documents\/(.+)\.json$/.exec(path || '');
    if (m) return (docs && docs[m[1]]) || '文档';
    return path;
  }
  const CHANGE = {add: '新建', delete: '删除', modify: '修改'};

  /* ---------- 摘要（引擎 versions.rs::summarize 的同一套模板，原型只写中文） ---------- */

  /** 没有动作 →「编辑」；只有一条且一次 → 它的名字；只有一条多次 →「名字（N 项修改）」；多条 → 次数最多的那条「等 N 项修改」。 */
  function summarize(actions, omitted) {
    const list = actions || [];
    const total = list.reduce((s, a) => s + a.count, 0) + (omitted || 0);
    if (!list.length) return '编辑';
    if (list.length === 1 && !omitted && list[0].count === 1) return list[0].label;
    if (list.length === 1 && !omitted) return `${list[0].label}（${total} 项修改）`;
    const main = list.reduce((best, a) => (a.count > best.count ? a : best), list[0]);
    return `${main.label}等 ${total} 项修改`;
  }
  function summaryOf(v) {
    if (v.kind === 'save') return v.name;
    if (v.kind === 'rebuild') return '从快照重建';
    return summarize(v.actions, v.omitted);
  }
  const restoreLabel = (n, before) => (before ? `回到版本 ${n} 之前` : `回到版本 ${n}`);

  /** 同一执行者、同一标签合在一起计数，按首次出现的顺序（§9.4）。 */
  function mergeActions(a, b) {
    const out = (a || []).map((x) => Object.assign({}, x));
    (b || []).forEach((x) => {
      const hit = out.find((y) => y.actor === x.actor && y.label === x.label);
      if (hit) hit.count += x.count; else out.push(Object.assign({}, x));
    });
    return out;
  }
  function mergeConvs(a, b) {
    const out = (a || []).slice();
    (b || []).forEach((c) => { const i = out.findIndex((x) => x.id === c.id); if (i >= 0) out[i] = c; else out.push(c); });
    return out;
  }
  function mergeFiles(a, b) {
    const out = (a || []).map((f) => Object.assign({}, f));
    (b || []).forEach((f) => { if (!out.some((x) => x.path === f.path)) out.push(Object.assign({}, f)); });
    return out;
  }

  /* ---------- 演示数据 → 状态 ---------- */

  /* 数据里的紧凑写法：`at: [开始, 结束]`（分钟前）、`actions: [[执行者, 标签, 次数]]`、`convs: [[会话 ID, 标题]]`、
     `files: ['video.json', ['documents/x.json', 'add']]`。`target` 只给回到版本：`[序号, 是否之前]`。
     `unreadable: true` 的版本在列表里只露出序号（读不出头部，§9.4）。 */
  function normalize(raw) {
    const asc = (raw.list || []).slice().sort((a, b) => a.n - b.n);
    const byN = {};
    const versions = [];
    asc.forEach((r, i) => {
      const prev = versions[i - 1];
      const from = prev ? prev.to : r.from || `S${r.n - 1}`;
      const v = {
        n: r.n, kind: r.kind || 'segment', start: r.at ? r.at[0] : 0, end: r.at ? r.at[1] : 0,
        revs: r.revs || [0, 0],
        actions: (r.actions || []).map(([actor, label, count]) => ({actor, label, count: count || 1})),
        omitted: r.omitted || 0,
        convs: (r.convs || []).map(([id, title]) => ({id, title})),
        name: r.name || null, note: r.note || null, checkpoint: r.checkpoint || (r.kind === 'save' ? `ckp_${r.n}` : null),
        files: (r.files || []).map((f) => (Array.isArray(f) ? {path: f[0], change: f[1]} : {path: f, change: 'modify'})),
        summary: r.summary || null, unreadable: !!r.unreadable, open: false,
        from, to: null,
      };
      if (v.kind === 'save' || v.kind === 'rebuild') v.to = from;   // diff 通常为空
      else if (v.kind === 'restore' && r.target) {
        const t = byN[r.target[0]];
        v.to = t ? (r.target[1] ? t.from : t.to) : `S${r.target[0]}`;
      } else v.to = r.to || `S${r.n}`;
      byN[v.n] = v;
      versions.push(v);
    });
    const top = versions[versions.length - 1];
    if (top && top.kind === 'segment' && raw.open !== false) top.open = true;
    return {
      inProject: raw.inProject !== false,
      next: raw.next || (top ? top.n + 1 : 1),
      revision: raw.revision || (top ? top.revs[1] : 1),
      snapshotRevision: raw.revision || (top ? top.revs[1] : 1),
      keep: raw.keep || 10,
      docs: raw.docs || {},
      /* conflict：冲突的原因；unsealed：库里还没写进快照的动作；disk：磁盘上那份被外部改过的快照的状态号 */
      state: 'synced', conflict: null, changedPaths: [], unsealed: [], disk: null,
      current: top ? top.to : 'S0',
      versions: versions.reverse(),   // 新的在前
      tampered: [], brokenAt: null,
    };
  }

  /** 没写演示历史的视频：按视频自己的修改时间排一段短历史。 */
  function seed(movie) {
    const t = (movie && movie.mtime) || 30;
    return {next: 5, list: [
      {n: 1, at: [t + 2900, t + 2880], revs: [1, 4], actions: [['system:jobs', '写入文档', 1]], files: ['video.json']},
      {n: 2, at: [t + 1500, t + 1460], revs: [4, 19], actions: [['agent:claude', '剪掉片段', 8]], files: ['video.json']},
      {n: 3, kind: 'save', at: [t + 1440, t + 1440], revs: [19, 20], actions: [['user_local', '保存版本', 1]], name: '初剪'},
      {n: 4, at: [t + 25, t], revs: [20, 31], actions: [['user_local', '裁切片段', 5], ['user_local', '修改文字', 2]], files: ['video.json']},
    ]};
  }

  /* ---------- 演示场景（原型开关「版本记录」） ---------- */

  const SCENARIOS = [
    {k: 'normal', label: '正常'},
    {k: 'pending', label: '正在写入'},
    {k: 'missing', label: '还没有快照'},
    {k: 'external', label: '外部改动：正在导入'},
    {k: 'conflict', label: '冲突：两边都改了'},
    {k: 'invalid', label: '冲突：快照读不出'},
    {k: 'unreadable', label: '版本文件读不出'},
    {k: 'tampered', label: '版本文件被改过'},
    {k: 'outside', label: '不在项目里'},
  ];
  /** 把正常状态改成某个场景。读不出 / 被改过都取列表中间偏旧的一版，让它之前与之后的版本都在。
      外部改动与两边都改了：时间线和最后一份文档被改过（像一次 git pull）；两边都改了时库里另有 3 处改字还没写进快照。
      快照读不出：只有 video.json，像 git 合并留下了冲突标记。 */
  function scenario(st, k) {
    const s = Object.assign({}, st, {versions: st.versions.map((v) => Object.assign({}, v))});
    const mid = s.versions[Math.min(s.versions.length - 1, Math.max(1, Math.floor(s.versions.length / 2)))];
    const docs = Object.keys(s.docs);
    const touched = ['video.json'].concat(docs.length ? [`documents/${docs[docs.length - 1]}.json`] : []);
    if (k === 'pending') { s.state = 'pending'; s.revision = s.snapshotRevision + 3; }
    else if (k === 'missing') { s.state = 'missing'; s.versions = []; s.current = 'S0'; }
    else if (k === 'external') Object.assign(s, {state: 'external', changedPaths: touched, disk: 'X1'});
    else if (k === 'conflict') {
      Object.assign(s, {state: 'conflict', conflict: 'both-changed', changedPaths: touched, disk: 'X1',
        unsealed: [{actor: 'user_local', label: '修改文字', count: 3}], revision: s.snapshotRevision + 3, current: 'L1'});
    } else if (k === 'invalid') Object.assign(s, {state: 'conflict', conflict: 'invalid', changedPaths: ['video.json']});
    else if (k === 'unreadable' && mid) mid.unreadable = true;
    else if (k === 'tampered' && mid) s.tampered = [mid.n];
    else if (k === 'outside') { s.inProject = false; s.versions = []; s.state = 'missing'; }
    return s;
  }

  /* ---------- 能不能回到（§9.5） ---------- */

  const find = (st, n) => st.versions.find((v) => v.n === n) || null;
  const unreadableOf = (st) => st.versions.filter((v) => v.unreadable).map((v) => v.n);
  /** 挡路的版本：界面知道的（读不出的、上次回到时报出的断点），或引擎实际会撞上的（读不出的、被改过的）。 */
  function blockers(st, truth) {
    const out = unreadableOf(st);
    if (truth) return out.concat(st.tampered || []);
    return st.brokenAt != null ? out.concat([st.brokenAt]) : out;
  }
  /** 回到版本 n 结束时（before 为真时是开始之前）：要从最新一版逆着走过比它新的每一版（before 时连它自己），
      路上有读不出或对不上的就断在那里；目标本身读不出也不行。 */
  function reach(st, n, before, truth) {
    const v = find(st, n);
    if (!v) return {ok: false, code: 'VERSION_NOT_FOUND'};
    if (!before && v.unreadable) return {ok: false, code: 'VERSION_CHAIN_BROKEN', brokenAt: n, why: 'unreadable'};
    const hit = blockers(st, truth).filter((k) => (before ? k >= n : k > n));
    if (!hit.length) return {ok: true};
    const at = Math.max.apply(null, hit);
    return {ok: false, code: 'VERSION_CHAIN_BROKEN', brokenAt: at, why: unreadableOf(st).includes(at) ? 'unreadable' : 'tampered'};
  }
  const targetOf = (st, n, before) => { const v = find(st, n); return v ? (before ? v.from : v.to) : null; };
  /** 回到之后与当前相同：不提交，不产生版本。 */
  const isNoop = (st, n, before) => targetOf(st, n, before) === st.current;

  /** 一行说明为什么回不去；回得去返回 null。 */
  function blockedText(r) {
    if (!r || r.ok) return null;
    if (r.code === 'VERSION_NOT_FOUND') return '这个版本已经不在了';
    return r.why === 'unreadable'
      ? `版本 ${r.brokenAt} 的文件读不出来，它和更早的状态都回不去`
      : `版本记录在版本 ${r.brokenAt} 处对不上，更早的状态都回不去`;
  }

  /* ---------- 写操作：保存、回到、删除（都先「写一次快照」：最新一版收口） ---------- */

  function gate(st) {
    if (!st.inProject) return {code: 'VERSIONS_NEED_PROJECT', message: '只有项目里的视频才有版本记录；先把视频移进项目'};
    if (st.state === 'conflict') {
      return {code: 'SNAPSHOT_CONFLICT', message: st.conflict === 'invalid'
        ? '快照读不出，BaoCut 不会覆盖它；处理好之前不能保存或回到版本'
        : '快照和 BaoCut 都改过；选好保留哪边之前不能保存或回到版本'};
    }
    return null;
  }
  const clone = (st) => Object.assign({}, st, {versions: st.versions.map((v) => Object.assign({}, v)), unsealed: (st.unsealed || []).slice()});
  function closeTop(st) {
    if (st.versions[0]) st.versions[0].open = false;
    st.snapshotRevision = st.revision;
    if (st.state === 'pending' || st.state === 'missing') st.state = 'synced';
  }

  /** 保留规则（§9.4）：最近 keep 个未命名的版本（最新一版计在里面）加全部保存的版本。
      删掉最旧的那一版直接删；中间的并进紧接着的那一版：它的开始取被删的那一版的，动作与会话合在一起。链对不上的留着。 */
  function prune(st) {
    const bad = blockers(st, true);
    for (;;) {
      const unnamed = st.versions.filter((v) => v.kind !== 'save');
      if (unnamed.length <= st.keep) return st;
      const old = unnamed[unnamed.length - 1];
      const i = st.versions.indexOf(old);
      const newer = st.versions[i - 1];
      const oldest = i === st.versions.length - 1;
      if (!oldest && (bad.includes(old.n) || bad.includes(newer.n))) return st;
      if (!oldest) {
        Object.assign(newer, {from: old.from, start: old.start, revs: [old.revs[0], newer.revs[1]],
          actions: mergeActions(old.actions, newer.actions), convs: mergeConvs(old.convs, newer.convs), files: mergeFiles(old.files, newer.files)});
      }
      st.versions.splice(i, 1);
    }
  }

  /** 保存版本（§9.6）：建一个检查点（一笔事务），单独成一个 save 版本，diff 为空。名字必填（1–200 字），说明可选（≤ 2000 字）。 */
  function save(st, input) {
    const err = gate(st);
    if (err) return {state: st, error: err};
    const name = String((input && input.name) || '').trim();
    if (!name) return {state: st, error: {code: 'INVALID_INPUT', message: '给这个版本起个名字'}};
    const note = String((input && input.note) || '').trim();
    const s = clone(st);
    closeTop(s);
    const n = s.next;
    s.revision += 1;
    s.snapshotRevision = s.revision;
    s.versions.unshift({n, kind: 'save', start: 0, end: 0, revs: [s.revision - 1, s.revision],
      actions: [{actor: 'user_local', label: '保存版本', count: 1}], omitted: 0, convs: [],
      name: name.slice(0, 200), note: note ? note.slice(0, 2000) : null, checkpoint: `ckp_${n}`,
      files: [], summary: null, unreadable: false, open: false, from: s.current, to: s.current});
    s.next = n + 1;
    return {state: s, version: n};
  }

  /** 回到版本（§9.5）：链断开 → VERSION_CHAIN_BROKEN（记下断点，界面据此标出回不去的版本，视频不变）；
      与当前相同 → 不提交（noop）；否则作为一笔可撤销的事务，单独成一个 restore 版本。 */
  function restore(st, n, before) {
    const err = gate(st);
    if (err) return {state: st, error: err};
    const r = reach(st, n, !!before, true);
    if (!r.ok) {
      const s = clone(st);
      if (r.brokenAt != null) s.brokenAt = Math.max(s.brokenAt || 0, r.brokenAt);
      return {state: s, error: {code: r.code, brokenAt: r.brokenAt, message: blockedText(r)}};
    }
    const target = targetOf(st, n, !!before);
    if (target === st.current) {
      const s = clone(st);
      closeTop(s);
      return {state: s, noop: true, version: null};
    }
    const s = clone(st);
    closeTop(s);
    const walked = s.versions.filter((v) => (before ? v.n >= n : v.n > n));
    const files = walked.reduce((acc, v) => mergeFiles(acc, v.files), []);
    const v = s.next;
    s.revision += 1;
    s.snapshotRevision = s.revision;
    s.versions.unshift({n: v, kind: 'restore', start: 0, end: 0, revs: [s.revision - 1, s.revision],
      actions: [{actor: 'user_local', label: restoreLabel(n, !!before), count: 1}], omitted: 0, convs: [],
      name: null, note: null, checkpoint: null, files: files.length ? files : [{path: 'video.json', change: 'modify'}],
      summary: null, unreadable: false, open: false, from: s.current, to: target, target: [n, !!before]});
    s.current = target;
    s.next = v + 1;
    prune(s);
    return {state: s, version: v};
  }

  /** 删除保存的版本（§9.6）：只能删保存的版本。最新一版 → 变回开着的一段；中间的 → 并进紧接着的那一版（链对不上时拒绝）。 */
  function remove(st, n) {
    const err = gate(st);
    if (err) return {state: st, error: err};
    const i = st.versions.findIndex((v) => v.n === n);
    if (i < 0) return {state: st, error: {code: 'VERSION_NOT_FOUND', message: '这个版本已经不在了'}};
    if (st.versions[i].kind !== 'save') return {state: st, error: {code: 'INVALID_OPERATION', message: '只能删除保存的版本'}};
    const s = clone(st);
    const v = s.versions[i];
    s.revision += 1;
    s.snapshotRevision = s.revision;
    if (i === 0) {
      Object.assign(v, {kind: 'segment', name: null, note: null, checkpoint: null, open: true,
        actions: mergeActions(v.actions, [{actor: 'user_local', label: '删除保存的版本', count: 1}])});
      return {state: s};
    }
    const newer = s.versions[i - 1];
    const bad = blockers(s, true);
    if (bad.includes(v.n) || bad.includes(newer.n)) {
      const at = Math.max(v.n, newer.n);
      s.revision -= 1; s.snapshotRevision = s.revision;
      s.brokenAt = Math.max(s.brokenAt || 0, bad.includes(newer.n) ? newer.n : v.n);
      return {state: s, error: {code: 'VERSION_CHAIN_BROKEN', brokenAt: at, message: `版本记录在版本 ${at} 处对不上，这个版本删不掉`}};
    }
    Object.assign(newer, {from: v.from, start: v.start, revs: [v.revs[0], newer.revs[1]],
      actions: mergeActions(v.actions, newer.actions), convs: mergeConvs(v.convs, newer.convs), files: mergeFiles(v.files, newer.files)});
    s.versions.splice(i, 1);
    /* 删检查点这笔事务不改快照内容：最新一版开着就记进它的动作清单，否则不开新版（§9.3） */
    if (s.versions[0] && s.versions[0].open) s.versions[0].actions = mergeActions(s.versions[0].actions, [{actor: 'user_local', label: '删除保存的版本', count: 1}]);
    return {state: s};
  }

  /** 一笔普通的修改写进快照（§9.3）：最新一版开着就并进去，否则开一个新的一段。`to` 是改完的状态号（撤销回到版本时是回到之前的状态）。 */
  function edit(st, action, to, files) {
    const s = clone(st);
    s.revision += 1;
    s.snapshotRevision = s.revision;
    const top = s.versions[0];
    const act = [Object.assign({actor: 'user_local', count: 1}, action)];
    if (top && top.open) {
      Object.assign(top, {end: 0, revs: [top.revs[0], s.revision], to, actions: mergeActions(top.actions, act), files: mergeFiles(top.files, files)});
    } else {
      s.versions.unshift({n: s.next, kind: 'segment', start: 0, end: 0, revs: [s.revision - 1, s.revision], actions: act, omitted: 0, convs: [],
        name: null, note: null, checkpoint: null, files: files || [{path: 'video.json', change: 'modify'}], summary: null, unreadable: false, open: true,
        from: s.current, to});
      s.next += 1;
      prune(s);
    }
    s.current = to;
    return s;
  }
  /** 撤销刚才的回到版本：一笔「撤销：回到版本 N」，内容回到之前的状态，记进新开的一段。 */
  function undoRestore(st, version) {
    const v = find(st, version);
    if (!v || v.kind !== 'restore') return st;
    return edit(st, {label: `撤销：${summaryOf(v)}`}, v.from, v.files);
  }

  /* ---------- 快照被外部改过：导入与冲突时的选择（§9.8） ---------- */

  /** 库里还没写进快照的改动记进版本：最新一版开着就并进去，否则开新的一段（§9.3）。返回记进的版本号，没有改动时是 null。
      keepOpen 为假是「封存」：后面紧跟着外部变更，这一版收口；还没有任何版本时不另封存，外部变更直接从库里的状态算起。 */
  function commitLocal(s, keepOpen) {
    const top = s.versions[0];
    const acts = s.unsealed;
    s.unsealed = [];
    if (!acts.length || (!top && !keepOpen)) return null;
    const files = [{path: 'video.json', change: 'modify'}];
    let n;
    if (top && top.open) {
      Object.assign(top, {end: 0, revs: [top.revs[0], s.revision], to: s.current, actions: mergeActions(top.actions, acts), files: mergeFiles(top.files, files)});
      n = top.n;
    } else {
      n = s.next;
      s.versions.unshift({n, kind: 'segment', start: 0, end: 0, revs: [s.snapshotRevision, s.revision], actions: acts.map((a) => Object.assign({}, a)), omitted: 0, convs: [],
        name: null, note: null, checkpoint: null, files, summary: null, unreadable: false, open: true, from: top ? top.to : 'S0', to: s.current});
      s.next = n + 1;
    }
    s.versions[0].open = keepOpen;
    s.snapshotRevision = s.revision;
    return n;
  }
  /** 导入磁盘上的快照（`videos.applySnapshot`）：一笔「外部变更」事务（操作者 system:history），单独成一个 external 版本，
      diff 从库里导入前的状态算到磁盘上的快照，版本链不断；之后的改动另开一版。 */
  function importDisk(s) {
    if (s.versions[0]) s.versions[0].open = false;
    const n = s.next;
    s.revision += 1;
    s.snapshotRevision = s.revision;
    s.versions.unshift({n, kind: 'external', start: 0, end: 0, revs: [s.revision - 1, s.revision],
      actions: [{actor: 'system:history', label: '外部变更', count: 1}], omitted: 0, convs: [], name: null, note: null, checkpoint: null,
      files: s.changedPaths.map((path) => ({path, change: 'modify'})), summary: null, unreadable: false, open: false,
      from: s.current, to: s.disk || `X${n}`});
    s.current = s.versions[0].to;
    s.next = n + 1;
    Object.assign(s, {state: 'synced', conflict: null, changedPaths: [], disk: null});
    prune(s);
    return n;
  }
  /** 只有快照被改（状态 external）：发现就导入。 */
  function applyExternal(st) {
    if (!st.inProject || st.state !== 'external') return {state: st, noop: true};
    const s = clone(st);
    return {state: s, version: importDisk(s)};
  }
  /** 冲突时的选择（`videos.versions.resolve`）。用户选之前快照不被重写，视频照常编辑。
      keep 'video'：立即写快照、覆盖磁盘上的，外部改动不进版本记录；库里的改动照常并进最新一版或开新的一段。
      keep 'snapshot'：先封存库里还没写进快照的改动，再导入；快照读不出时以 SNAPSHOT_INVALID 拒绝。 */
  function resolve(st, keep) {
    if (!st.inProject) return {state: st, error: gate(st)};
    if (st.state !== 'conflict') return {state: st, noop: true};
    if (keep === 'snapshot' && st.conflict === 'invalid') {
      return {state: st, error: {code: 'SNAPSHOT_INVALID', message: '磁盘上的快照读不出，只能保留 BaoCut 里的'}};
    }
    const s = clone(st);
    if (keep === 'video') {
      const n = commitLocal(s, true);
      Object.assign(s, {state: 'synced', conflict: null, changedPaths: [], disk: null});
      return {state: s, keep, version: n};
    }
    const sealed = commitLocal(s, false);
    return {state: s, keep, version: importDisk(s), sealed};
  }
  /** 撤销导入：库领先，下一次写把快照写回撤销后的状态，成为普通的一段，相当于拒绝了这次外部改动。 */
  function undoImport(st, version) {
    const v = find(st, version);
    if (!v || v.kind !== 'external') return st;
    return edit(st, {label: '撤销：外部变更'}, v.from, v.files);
  }

  /** 两个选择的确认框：写明各自丢掉什么。保留 BaoCut 里的会覆盖磁盘上的文件，用危险色。 */
  function resolveAsk(st, keep) {
    const files = st.changedPaths.map((p) => fileLabel(p, st.docs)).join('、');
    if (keep === 'video') {
      return {title: '保留 BaoCut 里的？', confirmLabel: '覆盖磁盘上的', tone: 'negative',
        body: `BaoCut 里的内容立即写进快照，覆盖磁盘上${st.conflict === 'invalid' ? '读不出' : '被改过'}的 ${st.changedPaths.length} 个文件（${files}）。`
          + '磁盘上的那些改动不进版本记录，在 BaoCut 里找不回来；它们来自 git 或同步盘的话，可以在那里找回。'};
    }
    const top = st.versions[0];
    const into = !st.unsealed.length || !top ? null : top.open ? `先并进版本 ${top.n}` : `先存成版本 ${st.next}`;
    return {title: '用磁盘上的？', confirmLabel: '用磁盘上的',
      body: `视频内容换成磁盘上的快照（${files}），记成一个「外部变更」版本。`
        + (into ? `BaoCut 里还没写进快照的 ${st.unsealed.reduce((t, a) => t + a.count, 0)} 项修改（${[...new Set(st.unsealed.map((a) => a.label))].join('、')}）${into}，回到「外部变更」之前就能找回。` : '')
        + '这一笔也可以撤销。'};
  }
  /** 选择之后、自动导入之后的结果说明（对话框里的提示与编辑器里的 toast 共用）。 */
  function resolvedNote(r) {
    if (r.keep === 'video') {
      return {tone: 'positive', title: '已保留 BaoCut 里的',
        text: `磁盘上的快照换成了 BaoCut 里的内容${r.version ? `，刚才的修改记进版本 ${r.version}` : ''}。磁盘上的那些改动没有进版本记录。`};
    }
    return {tone: 'positive', title: `已用磁盘上的，记成版本 ${r.version}「外部变更」`,
      text: `${r.sealed ? `BaoCut 里原来的修改在版本 ${r.sealed}，回到版本 ${r.version} 之前就能找回。` : `回到版本 ${r.version} 之前就是导入前的内容。`}这一笔也可以撤销。`};
  }
  const importedNote = (n) => ({tone: 'informative', title: `已导入外部改动，记成版本 ${n}「外部变更」`,
    text: `快照文件被外部改过，BaoCut 里没有别的改动，所以直接导入。回到版本 ${n} 之前就是导入前的内容；这一笔也可以撤销。`});
  const undoImportNote = {tone: 'informative', title: '已撤销导入',
    text: '视频回到导入前的内容，几秒后写回快照，相当于拒绝了这次外部改动；撤销本身记进新开的一段。'};

  /* ---------- diff（原型按动作生成一份像样的 unified diff；真实的由引擎写在版本文件里） ---------- */

  const CLIPS = [['4f1c', '00:03:12.400', '00:03:18.900', '00:03:17.600'], ['51aa', '00:03:21.000', '00:03:26.250', '00:03:25.700'],
    ['5b07', '00:04:02.120', '00:04:09.800', '00:04:08.950'], ['63d2', '00:04:40.000', '00:04:47.400', '00:04:46.100'],
    ['6e90', '00:05:13.300', '00:05:20.000', '00:05:19.300'], ['7a15', '00:06:01.000', '00:06:05.600', '00:06:05.000']];
  const LINES = {
    en: [['Let us start with speech recognition. For years everyone assumed it belonged in the cloud.', 'Let us start with speech recognition, which for years everyone assumed belonged in the cloud.'],
      ['More importantly, your audio never leaves the machine.', 'More importantly, the audio never leaves your machine.'],
      ['Zhou asked about cost once: locally it is electricity, in the cloud it is a bill.', 'Zhou pressed on cost: locally it is electricity; in the cloud it is a bill.'],
      ['The rasterization step has to be deterministic.', 'The rendering step has to be deterministic.']],
    zh: [['先说语音识别。过去几年大家默认它是云上的事。', '先说语音识别：过去几年，大家默认它是云上的事。'],
      ['就是说，嗯，语音数据不出本机。', '语音数据不出本机。'],
      ['我们演示一下，拖进来一个文件。', '我们演示一下：拖进来一个文件。']],
  };
  /** 一份文件的 hunk：几处修改，每处上下各 3 行上下文。种子取版本号与路径，同一版每次生成的一样。 */
  function hunksFor(v, f) {
    const seedN = v.n * 7 + f.path.length;
    const nAct = Math.max(1, Math.min(3, v.actions.reduce((s, a) => s + a.count, 0)));
    const out = [];
    if (f.path === 'video.json') {
      for (let h = 0; h < nAct; h++) {
        const c = CLIPS[(seedN + h) % CLIPS.length];
        const line = 40 + ((seedN * 13 + h * 37) % 180);
        const row = (id, end) => `    "itm_${id}": {"body":{"kind":"clip","range":{"end":"${end}","start":"${c[1]}"},"source":"ast_master"},"sequenceId":"seq_main"},`;
        const ctx = (k) => `    "itm_${(parseInt(c[0], 16) + k).toString(16)}": {"body":{"kind":"clip","range":{…}},"source":"ast_master"},"sequenceId":"seq_main"},`;
        const cut = v.actions.some((a) => /剪掉|删除/.test(a.label)) && h % 2 === 1;
        const lines = [[' ', ctx(-3)], [' ', ctx(-2)], [' ', ctx(-1)]];
        if (cut) lines.push(['-', row(c[0], c[2])]);
        else lines.push(['-', row(c[0], c[2])], ['+', row(c[0], c[3])]);
        lines.push([' ', ctx(1)], [' ', ctx(2)], [' ', ctx(3)]);
        out.push({head: `@@ -${line},7 +${line},${cut ? 6 : 7} @@`, lines});
      }
      return out;
    }
    const lang = /_zh\b|_zh\./.test(f.path) ? 'zh' : 'en';
    const pool = LINES[lang];
    if (f.change === 'add') {
      return [{head: '@@ -0,0 +1,6 @@', lines: [['+', '{'], ['+', '  "format": "baocut.document",'], ['+', '  "kind": "translation",'],
        ['+', '  "segments": {'], ['+', `    "seg_001": {"end":4.2,"start":0.0,"text":"${pool[0][1]}"},`], ['+', '  }']]}];
    }
    for (let h = 0; h < Math.min(nAct, pool.length); h++) {
      const p = pool[(seedN + h) % pool.length];
      const id = 10 + ((seedN * 5 + h * 11) % 50);
      const seg = (k, text) => `    "seg_0${id + k}": {"end":${(id + k) * 3 + 2.4},"start":${(id + k) * 3},"text":"${text}","words":[…]},`;
      const line = 20 + id * 2;
      out.push({head: `@@ -${line},7 +${line},7 @@`, lines: [[' ', seg(-3, '…')], [' ', seg(-2, '…')], [' ', seg(-1, '…')],
        ['-', seg(0, p[0])], ['+', seg(0, p[1])], [' ', seg(1, '…')], [' ', seg(2, '…')], [' ', seg(3, '…')]]});
    }
    return out;
  }
  /** 一个版本的 diff，按文件分开，带 +/− 计数。保存的版本通常为空。 */
  function diffOf(st, v) {
    if (!v || v.unreadable) return [];
    return v.files.map((f) => {
      const hunks = hunksFor(v, f);
      const plus = hunks.reduce((s, h) => s + h.lines.filter((l) => l[0] === '+').length, 0);
      const minus = hunks.reduce((s, h) => s + h.lines.filter((l) => l[0] === '-').length, 0);
      return {path: f.path, label: fileLabel(f.path, st.docs), change: f.change, changeText: CHANGE[f.change] || CHANGE.modify, hunks, plus, minus};
    });
  }
  /** 标准 unified diff 文本（复制出去可以 `patch -R` 逐版退回快照文本，§9.4）。 */
  function diffText(st, v) {
    return diffOf(st, v).map((f) => [
      `--- ${f.change === 'add' ? '/dev/null' : 'a/' + f.path}`,
      `+++ ${f.change === 'delete' ? '/dev/null' : 'b/' + f.path}`,
    ].concat(...f.hunks.map((h) => [h.head].concat(h.lines.map((l) => l[0] + l[1]))))
      .join('\n')).join('\n');
  }
  /** 版本文件的大小（列表里不显示，详情的脚注用）。 */
  const bytesOf = (st, v) => 360 + v.actions.length * 48 + diffText(st, v).length;
  const sizeText = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`);

  /* ---------- 给视图的行与详情 ---------- */

  /** 执行者分组：同一执行者的动作放一起（保持首次出现的顺序）。 */
  function byActor(actions, names) {
    const out = [];
    (actions || []).forEach((a) => {
      let g = out.find((x) => x.actor === a.actor);
      if (!g) { g = {actor: a.actor, kind: actorKind(a.actor), label: actorLabel(a.actor, names), items: []}; out.push(g); }
      g.items.push({label: a.label, count: a.count});
    });
    return out;
  }
  /** 列表里的「谁改的」：执行者显示名用「、」连起来。 */
  const actorsText = (v, names) => byActor(v.actions, names).map((g) => g.label).join('、');

  /** 列表行，新的在前。读不出的版本只有序号与原因。 */
  function rows(st, names) {
    return st.versions.map((v, i) => {
      if (v.unreadable) return {n: v.n, unreadable: true, title: '读不出这个版本文件', sub: '', top: i === 0, blocked: true};
      const end = reach(st, v.n, false, false);
      const before = reach(st, v.n, true, false);
      return {
        n: v.n, kind: v.kind, kindLabel: KINDS[v.kind].label, icon: KINDS[v.kind].icon,
        title: summaryOf(v), sub: [agoText(v.end), actorsText(v, names)].filter(Boolean).join(' · '),
        open: v.open, top: i === 0,
        blocked: !end.ok && !before.ok,
      };
    });
  }

  /** 选中版本的详情与可用的动作。顶上那一版结束时就是当前状态，不给「回到这个版本」。 */
  function detail(st, n, names) {
    const v = find(st, n);
    if (!v) return null;
    const top = st.versions[0] === v;
    if (v.unreadable) {
      const r = reach(st, n, true, false);
      return {n, unreadable: true, top, blocked: blockedText(r) || blockedText({ok: false, brokenAt: n, why: 'unreadable'})};
    }
    const end = reach(st, n, false, false);
    const before = reach(st, n, true, false);
    return {
      n, kind: v.kind, kindLabel: KINDS[v.kind].label, icon: KINDS[v.kind].icon, top, open: v.open,
      title: summaryOf(v), range: rangeText(v), revsText: v.revs[0] === v.revs[1] ? `修订 ${v.revs[1]}` : `修订 ${v.revs[0]}–${v.revs[1]}`,
      actors: byActor(v.actions, names), omitted: v.omitted, convs: v.convs,
      name: v.name, note: v.note, checkpoint: v.checkpoint,
      files: v.files.map((f) => ({path: f.path, label: fileLabel(f.path, st.docs), change: f.change, changeText: CHANGE[f.change] || CHANGE.modify})),
      size: sizeText(bytesOf(st, v)),
      restoreEnd: top ? null : {ok: end.ok, why: blockedText(end), noop: end.ok && isNoop(st, n, false), label: '回到这个版本'},
      restoreBefore: {ok: before.ok, why: blockedText(before), noop: before.ok && isNoop(st, n, true), label: '回到这个版本之前'},
      canDelete: v.kind === 'save',
    };
  }

  /** 入口按钮与对话框标题旁的状态灯。 */
  function stateOf(st) {
    if (!st.inProject) return null;
    if (st.state === 'conflict') return CONFLICTS[st.conflict] || CONFLICTS['both-changed'];
    return STATES[st.state] || STATES.synced;
  }
  /** 视频栏「历史」按钮的提示：当前修订 + 最新是第几版 + 快照状态（版本与撤销历史合在一个按钮里，产品设计 §5.1）。 */
  function buttonTip(st) {
    const rev = `修订 ${st.revision}`;
    if (!st.inProject) return ['历史', rev, '这部视频不在项目里'].join(' · ');
    const top = st.versions[0];
    const s = stateOf(st);
    return ['历史', rev, top ? `最新是版本 ${top.n}` : '还没有版本', s.k === 'synced' ? null : s.label].filter(Boolean).join(' · ');
  }

  root.BC_VIDEO_VERSIONS = {
    KINDS, STATES, CONFLICTS, SCENARIOS, CHANGE,
    clock, dayLabel, rangeText, agoText, actorKind, actorLabel, fileLabel, summarize, summaryOf, restoreLabel,
    mergeActions, normalize, seed, scenario, find, reach, targetOf, isNoop, blockedText,
    save, restore, remove, prune, edit, undoRestore, applyExternal, resolve, undoImport, resolveAsk, resolvedNote, importedNote, undoImportNote,
    diffOf, diffText, rows, detail, byActor, stateOf, buttonTip,
  };
})();
