/* 用量账本的读法（product-design §7.6 用量页）：API 提供方与智能体的每次调用一条 UsageRecord，读的时候按标价估算、按时段汇总。
   金额分「提供方报告 / 按标价估算 / 未知」三种，不合成一个数；不同币种分别给，不换算（§7.4 费用如实）。
   本机模型不计费，不进账本。原型的账本是按种子生成的 30 天演示数据；只算，不画。 */
(function () {
  const W = typeof window !== 'undefined' ? window : {};
  const IMG = () => W.BC_CLOUD_IMAGE || (typeof require === 'function' ? require('./model-cloud-image.js') : null);

  const CAPS = ['text', 'transcribe', 'tts', 'image'];
  const SYMBOL = {USD: '$', CNY: '¥'};

  /* ---------- 标价（演示用；Runtime 的单价表写来源与日期，拿不准的不填 = 未知） ----------
     text：每百万 token；transcribe：每分钟；tts：每千字符；image：每张（没写的从图像生成的价目表读 price.normal，美元） */
  const PRICES = {
    'openai/gpt-6.1-sol': {currency: 'USD', inputPerMTok: 2.5, outputPerMTok: 10},
    'openai/gpt-6-luna': {currency: 'USD', inputPerMTok: 0.4, outputPerMTok: 1.6},
    'openai/gpt-4o-transcribe': {currency: 'USD', audioPerMinute: 0.006},
    'openai/gpt-4o-mini-transcribe': {currency: 'USD', audioPerMinute: 0.003},
    'openai/gpt-4o-mini-tts': {currency: 'USD', perKChars: 0.015},
    'deepseek/deepseek-v4-flash': {currency: 'CNY', inputPerMTok: 2, outputPerMTok: 8},
    'deepseek/deepseek-v4-pro': {currency: 'CNY', inputPerMTok: 4, outputPerMTok: 16},
    'elevenlabs/eleven_multilingual_v2': {currency: 'USD', perKChars: 0.3},
    'elevenlabs/eleven_flash_v2_5': {currency: 'USD', perKChars: 0.15},
    'minimax/MiniMax-M2.5': {currency: 'CNY', inputPerMTok: 2.1, outputPerMTok: 8.4},
  };
  function priceOf(providerId, modelId) {
    const p = PRICES[providerId + '/' + modelId];
    if (p) return p;
    const I = IMG();
    const prov = I && I.PROVIDERS.find((x) => x.id === providerId);
    const mdl = prov && prov.models.find((x) => x.id === modelId);
    return mdl && mdl.price && typeof mdl.price.normal === 'number' ? {currency: 'USD', perImage: mdl.price.normal} : null;
  }
  /** 按标价估算一条：{amount, currency}；没有标价或单位对不上时 null（算作未知） */
  function estimate(rec) {
    const p = priceOf(rec.providerId, rec.modelId);
    const u = rec.units || {};
    if (!p) return null;
    let amt = 0, hit = false;
    const add = (n, per, scale) => { if (n && per != null) { amt += (n / scale) * per; hit = true; } };
    add(u.inputTokens, p.inputPerMTok, 1e6);
    add(u.outputTokens, p.outputPerMTok, 1e6);
    add(u.audioSeconds, p.audioPerMinute, 60);
    add(u.chars, p.perKChars, 1000);
    add(u.images, p.perImage, 1);
    return hit ? {amount: amt, currency: p.currency} : null;
  }
  /** 一条的花费：提供方报告的优先；失败且没用量的不计费 */
  function costOf(rec) {
    if (rec.cost && rec.cost.kind === 'reported') return {kind: 'reported', amount: Number(rec.cost.amount), currency: rec.cost.currency};
    const u = rec.units || {};
    if (rec.status === 'error' && !Object.keys(u).some((k) => u[k])) return {kind: 'none'};
    const e = estimate(rec);
    return e ? {kind: 'estimated', amount: e.amount, currency: e.currency} : {kind: 'unknown'};
  }

  /* ---------- 汇总 ---------- */
  const UNIT_KEYS = ['inputTokens', 'outputTokens', 'cachedTokens', 'audioSeconds', 'chars', 'images'];
  const addUnits = (a, b) => { UNIT_KEYS.forEach((k) => { if (b && b[k]) a[k] = (a[k] || 0) + b[k]; }); return a; };
  /** Money = {USD?: n, CNY?: n}，币种分开 */
  const addMoney = (m, c) => { m[c.currency] = (m[c.currency] || 0) + c.amount; return m; };
  const dayOf = (iso) => { const d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const PERIODS = [{k: 'today', label: '今天', days: 1}, {k: '7d', label: '7 天', days: 7}, {k: '30d', label: '30 天', days: 30}, {k: 'all', label: '全部', days: null}];
  /** 时段 → {from, to}；另认 'month'（本月一号零点起，API 提供方详情的用量卡用） */
  function range(period, now, records) {
    if (period === 'month') { const d = new Date(now); return {from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: now}; }
    const p = PERIODS.find((x) => x.k === period) || PERIODS[2];
    const to = now;
    const first = (records || []).reduce((t, r) => Math.min(t, Date.parse(r.at)), now);
    const from = p.days ? startOfDay(now) - (p.days - 1) * 86400000 : startOfDay(first);
    return {from, to};
  }

  function row(key, label, extra) {
    return Object.assign({key, label, calls: 0, failed: 0, units: {}, est: {}, rep: {}, unknownCalls: 0}, extra || {});
  }
  function bump(r, rec, c) {
    r.calls += 1;
    if (rec.status === 'error') r.failed += 1;
    addUnits(r.units, rec.units);
    if (c.kind === 'estimated') addMoney(r.est, c);
    else if (c.kind === 'reported') addMoney(r.rep, c);
    else if (c.kind === 'unknown') r.unknownCalls += 1;
  }
  /** 行的花费种类：只有报告 / 只有估算 / 都有 / 全不知道 */
  function finish(r) {
    const hasE = Object.keys(r.est).length > 0, hasR = Object.keys(r.rep).length > 0;
    r.costKind = hasE && hasR ? 'mixed' : hasR ? 'reported' : hasE ? 'estimated' : (r.unknownCalls ? 'unknown' : 'none');
    r.cost = hasE || hasR ? Object.keys(Object.assign({}, r.est, r.rep)).reduce((m, k) => { m[k] = (r.est[k] || 0) + (r.rep[k] || 0); return m; }, {}) : null;
    return r;
  }

  /**
   * report(records, period, {providerId, now, names}) → UsageReport（共享简报 §5）
   * names(providerId) → 显示名；accountName(providerId, accountId) → 账号名
   */
  function report(records, period, opt) {
    const o = opt || {};
    const now = o.now == null ? Date.now() : o.now;
    const {from, to} = range(period, now, records);
    const recs = (records || []).filter((r) => { const t = Date.parse(r.at); return t >= from && t <= to && (!o.providerId || r.providerId === o.providerId); });
    const name = o.names || ((id) => id);
    const accName = o.accountName || ((p, a) => a || '智能体');
    const totals = row('total', '合计');
    const days = {};
    for (let t = startOfDay(from); t <= to; t += 86400000) days[dayOf(t)] = {day: dayOf(t), calls: 0, units: {}, byCapability: {}};
    const maps = {provider: {}, capability: {}, model: {}, account: {}};
    const get = (m, key, mk) => (m[key] = m[key] || mk());
    recs.forEach((rec) => {
      const c = costOf(rec);
      bump(totals, rec, c);
      const d = days[dayOf(rec.at)] || (days[dayOf(rec.at)] = {day: dayOf(rec.at), calls: 0, units: {}, byCapability: {}});
      d.calls += 1; addUnits(d.units, rec.units);
      d.byCapability[rec.capability] = (d.byCapability[rec.capability] || 0) + 1;
      bump(get(maps.provider, rec.providerId, () => row(rec.providerId, name(rec.providerId), {providerId: rec.providerId})), rec, c);
      bump(get(maps.capability, rec.capability, () => row(rec.capability, rec.capability)), rec, c);
      const mk = rec.providerId + '/' + rec.modelId;
      bump(get(maps.model, mk, () => row(mk, rec.modelId, {providerId: rec.providerId})), rec, c);
      const ak = rec.providerId + '#' + (rec.accountId || '');
      bump(get(maps.account, ak, () => row(ak, accName(rec.providerId, rec.accountId), {providerId: rec.providerId, accountId: rec.accountId})), rec, c);
    });
    const list = (m) => Object.keys(m).map((k) => finish(m[k])).sort((a, b) => b.calls - a.calls);
    finish(totals);
    return {
      period: {from: new Date(from).toISOString(), to: new Date(to).toISOString()},
      totals: {calls: totals.calls, failed: totals.failed, units: totals.units,
        cost: {estimated: Object.keys(totals.est).length ? totals.est : null, reported: Object.keys(totals.rep).length ? totals.rep : null, unknownCalls: totals.unknownCalls}},
      byDay: Object.keys(days).sort().map((k) => days[k]),
      byProvider: list(maps.provider), byCapability: list(maps.capability), byModel: list(maps.model), byAccount: list(maps.account),
    };
  }

  /* ---------- 格式 ---------- */
  /** 21M / 2.2K / 950 */
  function fmtCount(n) {
    const v = Number(n) || 0;
    const f = (x, s) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) + s;
    if (v >= 1e9) return f(v / 1e9, 'B');
    if (v >= 1e6) return f(v / 1e6, 'M');
    if (v >= 1e3) return f(v / 1e3, 'K');
    return String(Math.round(v));
  }
  /** $12.34 / ¥86.40；不足一分写 <$0.01 */
  function fmtMoney(amount, currency) {
    const s = SYMBOL[currency] || (currency + ' ');
    if (amount > 0 && amount < 0.01) return '<' + s + '0.01';
    return s + amount.toFixed(2);
  }
  /** Money（多币种）→ 「$12.34 + ¥86.40」；空为 '' */
  const fmtMoneyMap = (m) => (m ? ['USD', 'CNY'].concat(Object.keys(m).filter((k) => k !== 'USD' && k !== 'CNY')).filter((k) => m[k] != null).map((k) => fmtMoney(m[k], k)).join(' + ') : '');
  /** 音频秒 → 「12.5 分钟」/「45 秒」 */
  function fmtMinutes(sec) {
    const s = Number(sec) || 0;
    if (s < 60) return Math.round(s) + ' 秒';
    const m = s / 60;
    return (m >= 100 ? Math.round(m) : Math.round(m * 10) / 10) + ' 分钟';
  }
  /** 一行的用量短语：「1.2M 入 · 300K 出」「12 分钟」「8.4K 字符」「6 张」 */
  function fmtUnits(u) {
    const p = [];
    if (u.inputTokens || u.outputTokens) p.push(`${fmtCount(u.inputTokens)} 入 · ${fmtCount(u.outputTokens)} 出`);
    if (u.audioSeconds) p.push(fmtMinutes(u.audioSeconds));
    if (u.chars) p.push(`${fmtCount(u.chars)} 字符`);
    if (u.images) p.push(`${u.images} 张`);
    return p.join(' · ');
  }

  /* ---------- 演示账本：30 天，几家 API 提供方、几种能力、几个账号；有失败、有未知费用、有提供方报告的金额 ---------- */
  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  const MIX = [
    {p: 'openai', a: 'main', cap: 'text', m: 'gpt-6.1-sol', w: 6, units: (r) => ({inputTokens: 4000 + Math.round(r() * 40000), outputTokens: 600 + Math.round(r() * 6000)})},
    {p: 'openai', a: 'k7q2', cap: 'text', m: 'gpt-6-luna', w: 4, units: (r) => ({inputTokens: 2000 + Math.round(r() * 20000), outputTokens: 300 + Math.round(r() * 3000)})},
    {p: 'openai', a: 'main', cap: 'transcribe', m: 'gpt-4o-transcribe', w: 3, units: (r) => ({audioSeconds: 60 + Math.round(r() * 1200)})},
    {p: 'openai', a: 'main', cap: 'tts', m: 'gpt-4o-mini-tts', w: 2, units: (r) => ({chars: 200 + Math.round(r() * 3000)})},
    {p: 'openai', a: 'main', cap: 'image', m: 'gpt-image-2', w: 1, units: (r) => ({images: 1 + Math.floor(r() * 4)})},
    {p: 'deepseek', a: 'main', cap: 'text', m: 'deepseek-v4-flash', w: 5, units: (r) => ({inputTokens: 5000 + Math.round(r() * 60000), outputTokens: 800 + Math.round(r() * 8000)})},
    {p: 'elevenlabs', a: 'main', cap: 'tts', m: 'eleven_multilingual_v2', w: 3, units: (r) => ({chars: 300 + Math.round(r() * 4000)})},
    {p: 'elevenlabs', a: 'main', cap: 'transcribe', m: 'scribe_v2', w: 1, units: (r) => ({audioSeconds: 120 + Math.round(r() * 900)})},   // 没有标价：未知
    {p: 'minimax', a: 'main', cap: 'text', m: 'MiniMax-M2.5', w: 2, reported: true, units: (r) => ({inputTokens: 3000 + Math.round(r() * 20000), outputTokens: 500 + Math.round(r() * 4000)})},
    {p: 'agent:codex', a: null, cap: 'image', m: 'image-gen', w: 1, units: () => ({images: 1})},   // 智能体：费用未知
  ];
  function seedRecords(now, seed) {
    const r = rng(seed == null ? 7 : seed);
    const total = MIX.reduce((n, x) => n + x.w, 0);
    const pick = () => { let t = r() * total; return MIX.find((x) => (t -= x.w) < 0) || MIX[0]; };
    const out = [];
    for (let d = 29; d >= 0; d -= 1) {
      const dayStart = startOfDay(now) - d * 86400000;
      const weekend = [0, 6].indexOf(new Date(dayStart).getDay()) >= 0;
      const n = d === 0 ? 9 : Math.round((weekend ? 3 : 8) + r() * 10);
      for (let i = 0; i < n; i += 1) {
        const x = pick();
        let at = dayStart + Math.round((8 + r() * 14) * 3600000);
        if (at > now) at = now - Math.round(r() * 3600000 * 2);
        const failed = r() < 0.06;
        const units = failed ? {} : x.units(r);
        const rec = {at: new Date(at).toISOString(), providerId: x.p, accountId: x.a, capability: x.cap, modelId: x.m, source: x.cap === 'image' && x.p === 'agent:codex' ? 'agent-tool' : 'job',
          units, cost: {kind: 'unknown'}, durationMs: 800 + Math.round(r() * 30000), status: failed ? 'error' : 'ok'};
        if (failed) rec.error = x.p === 'openai' && x.a === 'k7q2' ? '429 · 每分钟请求数超限' : '服务商返回 500';
        if (x.reported && !failed) rec.cost = {kind: 'reported', amount: (((units.inputTokens || 0) * 2.1 + (units.outputTokens || 0) * 8.4) / 1e6).toFixed(4), currency: 'CNY'};
        out.push(rec);
      }
    }
    return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }

  const BC_USAGE = {CAPS, SYMBOL, PRICES, PERIODS, priceOf, estimate, costOf, range, report,
    fmtCount, fmtMoney, fmtMoneyMap, fmtMinutes, fmtUnits, dayOf, seedRecords};
  if (typeof window !== 'undefined') Object.assign(window, {BC_USAGE});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_USAGE;
})();
