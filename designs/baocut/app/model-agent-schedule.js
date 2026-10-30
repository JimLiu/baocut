/* BaoCut 原型 — 定时任务（产品设计 §6.1「定时任务」）里「算出来的东西」：window.BC_AGENT_SCHEDULE。
   无 React、无 DOM，node --test 直接 require。只在 App 入口加载。

   定时任务按频率把一段提示词发给一条会话，或者每次在某个项目里新开一条会话。Runtime 开着才跑，按本机时区：
   - 到点时上一次还在跑：这次跳过，记「跳过」；
   - 目标会话正忙（你正在和它说话、或它在等你）：等它空下来再起这一轮，不跳过（同完成收件箱）；
   - 目标会话归档或删除：定时任务自动暂停，写明原因；
   - Runtime 没开着时错过的不补跑：记一条「错过 · N 次」，从现在起算下一次；
   - 跑满「最多运行次数」就停，标为已完成。
   无人值守撞上「等你允许 / 等你回答」会停在那里等你回来（照常发通知）；BaoCut 不替你改访问模式，只在建立时提示。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = (n) => String(n).padStart(2, '0');

  /* ---------- cron（五段：分 时 日 月 周） ---------- */

  const FIELDS = [
    {name: '分', min: 0, max: 59},
    {name: '时', min: 0, max: 23},
    {name: '日', min: 1, max: 31},
    {name: '月', min: 1, max: 12},
    {name: '周', min: 0, max: 7},
  ];

  /** 一段：`*`、`n`、`a-b`、`*\/k`、`a-b/k`，逗号分隔。返回取值的集合，或出错的说明。 */
  function parseField(text, f, i) {
    const out = new Set();
    for (const part of String(text).split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!m) return {error: `第 ${i + 1} 段（${f.name}）「${part}」看不懂`};
      const lo = m[1] === '*' ? f.min : Number(m[2]);
      const hi = m[1] === '*' ? f.max : m[3] != null ? Number(m[3]) : m[4] != null ? f.max : lo;
      const step = m[4] != null ? Number(m[4]) : 1;
      if (lo < f.min || hi > f.max || lo > hi || step < 1) return {error: `第 ${i + 1} 段（${f.name}）「${part}」超出 ${f.min}–${f.max}`};
      for (let v = lo; v <= hi; v += step) out.add(f.name === '周' && v === 7 ? 0 : v);
    }
    return {set: out, any: text === '*'};
  }

  /** 解析 cron 表达式：`{ok, fields}` 或 `{ok: false, error}`。 */
  function parseCron(expr) {
    const parts = String(expr || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 5) return {ok: false, error: 'cron 要五段：分 时 日 月 周'};
    const fields = [];
    for (let i = 0; i < 5; i++) {
      const r = parseField(parts[i], FIELDS[i], i);
      if (r.error) return {ok: false, error: r.error};
      fields.push(r);
    }
    return {ok: true, fields};
  }

  /** 频率换成 cron。`hourly` {minute}、`daily` {time}、`weekly` {days, time}、`cron` {expr}。 */
  function toCron(c) {
    const [hh, mm] = String((c && c.time) || '09:00').split(':').map(Number);
    if (!c || c.type === 'daily') return `${mm} ${hh} * * *`;
    if (c.type === 'hourly') return `${c.minute || 0} * * * *`;
    if (c.type === 'weekly') return `${mm} ${hh} * * ${(c.days && c.days.length ? c.days : [1]).slice().sort().join(',')}`;
    return c.expr;
  }

  /** 这一天对不对：月份要对；日与周都限定时满足其一就算（cron 的老规矩）。 */
  function dayMatches(p, d) {
    const [, , dom, mon, dow] = p.fields;
    if (!mon.set.has(d.getMonth() + 1)) return false;
    const a = dom.set.has(d.getDate());
    const b = dow.set.has(d.getDay());
    if (dom.any && dow.any) return true;
    if (dom.any) return b;
    if (dow.any) return a;
    return a || b;
  }

  /** `from` 之后（不含）的下一次；一年里都没有（如 2 月 30 日）为 null。日子不对跳到第二天，钟点不对跳到下一个钟头。 */
  function nextRun(c, from) {
    const p = parseCron(toCron(c));
    if (!p.ok) return null;
    const [mi, h] = p.fields;
    const d = new Date(from.getTime());
    d.setSeconds(0, 0);
    d.setMinutes(d.getMinutes() + 1);
    const end = from.getTime() + 366 * 24 * 3600 * 1000;
    while (d.getTime() <= end) {
      if (!dayMatches(p, d)) d.setHours(24, 0, 0, 0);
      else if (!h.set.has(d.getHours())) d.setHours(d.getHours() + 1, 0, 0, 0);
      else if (mi.set.has(d.getMinutes())) return d;
      else d.setMinutes(d.getMinutes() + 1);
    }
    return null;
  }

  /** (from, to] 之间到点了几次（Runtime 没开着时错过的），数到 `cap` 为止。 */
  function missedBetween(c, from, to, cap) {
    let n = 0;
    let t = nextRun(c, from);
    while (t && t.getTime() <= to.getTime() && n < (cap || 1000)) { n++; t = nextRun(c, t); }
    return n;
  }

  /** 频率的说法。 */
  function describe(c) {
    if (!c) return '';
    if (c.type === 'hourly') return `每小时第 ${c.minute || 0} 分`;
    if (c.type === 'daily') return `每天 ${c.time}`;
    if (c.type === 'weekly') return `每周${(c.days || []).slice().sort().map((d) => WEEKDAYS[d]).join('、')} ${c.time}`;
    return `cron ${c.expr}`;
  }

  /** 下一次的说法：今天 / 明天 / 几月几日 + 时刻。 */
  function whenLabel(t, now) {
    if (!t) return '没有下一次';
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(t) - day(now)) / 86400000);
    const hm = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
    if (diff === 0) return `今天 ${hm}`;
    if (diff === 1) return `明天 ${hm}`;
    return `${t.getMonth() + 1} 月 ${t.getDate()} 日 ${hm}`;
  }

  /* ---------- 到点时怎么办 ---------- */

  /** 算进「最多运行次数」的：真跑过的（完成或失败），跳过与错过不算。 */
  function countedRuns(s) {
    return (s.runs || []).filter((r) => r.status === 'done' || r.status === 'failed').length;
  }

  /**
   * 到点时的决定：`run` 起一轮；`queue` 目标会话正忙，等它空下来；`skip` 上一次还在跑；
   * `pause` 目标会话没了或归档了（`reason`）；`complete` 跑满了；不在启用状态为 null。`target` 是目标会话（新开会话的为 undefined）。
   */
  function fire(s, target) {
    if (!s || s.status !== 'active') return null;
    if (s.maxRuns && countedRuns(s) >= s.maxRuns) return {k: 'complete'};
    if (s.target && s.target.type === 'session') {
      if (!target) return {k: 'pause', reason: '目标会话已删除'};
      if (target.archived) return {k: 'pause', reason: '目标会话已归档'};
    }
    if ((s.runs || []).some((r) => r.status === 'running' || r.status === 'queued')) return {k: 'skip'};
    if (target && (target.status === 'running' || target.status === 'waiting')) return {k: 'queue'};
    return {k: 'run'};
  }

  /** 运行记录的状态词与色调（S2 StatusLight）。 */
  const RUN_STATUS = {
    running: {label: '运行中', tone: 'informative'},
    queued: {label: '等会话空下来', tone: 'notice'},
    done: {label: '完成', tone: 'positive'},
    failed: {label: '失败', tone: 'negative'},
    skipped: {label: '跳过：上一次还在跑', tone: 'neutral'},
    missed: {label: '错过', tone: 'neutral'},
  };
  function runLabel(r) {
    const s = RUN_STATUS[r.status] || {label: r.status};
    return r.status === 'missed' ? `错过 · ${r.count || 1} 次（BaoCut 没开着）` : s.label;
  }

  /** 定时任务本身的状态。 */
  function statusOf(s, now) {
    if (s.status === 'paused') return {k: 'paused', label: s.pauseReason ? `已暂停：${s.pauseReason}` : '已暂停', tone: 'neutral'};
    if (s.status === 'completed') return {k: 'completed', label: `已完成（跑满 ${s.maxRuns} 次）`, tone: 'positive'};
    return {k: 'active', label: `下一次：${whenLabel(nextRun(s.cadence, now), now)}`, tone: 'informative'};
  }

  /** 访问模式会停下来问人时，建立时的一行提示（不替你改模式）。 */
  function accessHint(mode, modes) {
    if (mode === 'fullAccess') return null;
    const m = (modes || []).find((x) => x.k === mode);
    const name = m ? m.label : mode;
    return `这条会话的访问模式是「${name}」：没人看着时遇到要你允许或回答的事，会停在那里等你回来。`;
  }

  /** 新建时的检查：提示词不空，cron 能解析，每周至少选一天，最多运行次数是正整数。返回错误说明或 null。 */
  function validate(d) {
    if (!String(d.prompt || '').trim()) return '写一段每次要发的话';
    if (d.cadence.type === 'cron') { const p = parseCron(d.cadence.expr); if (!p.ok) return p.error; }
    if (d.cadence.type === 'weekly' && !(d.cadence.days || []).length) return '至少选一天';
    if (d.cadence.type !== 'cron' && d.cadence.type !== 'hourly' && !/^\d{2}:\d{2}$/.test(d.cadence.time || '')) return '时刻写成 09:00 这样';
    if (d.maxRuns != null && !(Number.isInteger(d.maxRuns) && d.maxRuns > 0)) return '最多运行次数要是正整数';
    return null;
  }

  root.BC_AGENT_SCHEDULE = {WEEKDAYS, parseCron, toCron, nextRun, missedBetween, describe, whenLabel, countedRuns, fire,
    RUN_STATUS, runLabel, statusOf, accessHint, validate};
})();
