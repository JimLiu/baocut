/* 独立工具入口沿用 product-design §2.1；LLM 分类与固定模型请求按本次需求扩展，不创建 Agent 会话。 */
(function () {
  const SAMPLE = '1\n00:00:00,000 --> 00:00:03,000\n欢迎来到今天的分享。\n\n2\n00:00:03,000 --> 00:00:06,500\n让我们从一个简单的想法开始。';
  /** 智能体写文字（架构设计 §6.9 的 `agent:codex` 文本模型）：与 Codex 画图共用设置 › Agent 的同一个开关。 */
  const CODEX_PROVIDER = 'agent:codex';
  /** Codex 的「Agent 默认模型」：不传模型，按 Codex 自己的配置选（就是以前唯一的那只「Codex 写文字」，选过的照样认得）。 */
  const CODEX_TEXT_ID = CODEX_PROVIDER + '/text-gen';
  /** API key 登录时写文字的提醒（画图那句说「可能画不了」，写文字只有费用一条）。 */
  const CODEX_TEXT_CAUTION = '用 API key 登录 · 费用不在订阅里';
  /** 文本模型清单：能用的在前（2026-10-28 用户要求：配好的排前面），同一状态里 API 提供方在前、Codex 在后——
      Codex 能用时排在已连接的提供方之后、没连接的之前。`codex`（BC_CLOUD_IMAGE.codexReady 的结果加上 Codex 的模型表 `models`，
      没装 Codex 时 null）给了才列 Codex：「Agent 默认模型」打头，再是它的模型（2026-10-28 用户要求：Agent 能选模型和推理强度），
      key 是 `agent:codex/<模型 id>`；不能用时照样列出、写原因；API key 登录时能用但带 `caution`，开页不自动选它。 */
  function models(catalog, saved, codex) {
    const cloud = (catalog || []).flatMap(p => (p.models || []).filter(m => m.kind === 'llm').map(m => ({
      id: p.id + '/' + m.id, providerId: p.id, name: m.id, provider: p.name, ready: (saved || []).includes(p.id),
    })));
    const agent = (id, model, name, dflt) => ({id, providerId: CODEX_PROVIDER, model, name, provider: 'Codex', ready: !!codex.ready, agent: true,
      why: codex.ready ? null : codex.why, caution: codex.caution ? CODEX_TEXT_CAUTION : null, dflt: !!dflt});
    const all = codex ? cloud.concat([agent(CODEX_TEXT_ID, null, 'Agent 默认模型'),
      ...(codex.models || []).map(m => agent(CODEX_PROVIDER + '/' + m.id, m.id, m.name || m.id, m.dflt))]) : cloud;
    return [...all.filter(m => m.ready), ...all.filter(m => !m.ready)];
  }
  /** 没选过时选哪只：`saved` 还在单子里就用它（不能用也留着，界面说原因）；否则设置里的默认模型（能用时）；
      再是第一只能用、不用提醒的（API key 登录的 Codex 不自动选）；都没有时第一只。 */
  function initial(list, saved, dflt) {
    const of = (id) => list.find(m => m.id === id);
    const d = of(dflt);
    return of(saved) || (d && d.ready ? d : null) || list.find(m => m.ready && !m.caution) || list[0] || null;
  }

  /* ---------- 两级菜单（2026-10-28 用户要求：先选提供方，再选它的模型；text-model-picker.jsx 只负责画与翻页） ---------- */
  /** 第一级：每家提供方一行，按 `models` 的次序（能用的在前）。`value` 是当前选中的模型 key，所在那家 `on`。
      能用的点了翻到第二级；没连接的、不能用的那家副题写原因，点了去设置。 */
  function providers(list, value) {
    const cur = list.find(m => m.id === value);
    const rows = [];
    for (const m of list) {
      const row = rows.find(r => r.id === m.providerId);
      if (row) { row.models.push(m); continue; }
      rows.push({id: m.providerId, name: m.provider, agent: !!m.agent, ready: !!m.ready, why: m.why || null, caution: m.caution || null,
        on: !!cur && cur.providerId === m.providerId, models: [m]});
    }
    return rows.map(r => Object.assign(r, {sub: r.agent
      ? `智能体 · ${r.ready ? r.caution || '用你的 Codex 订阅 · 比 API 慢' : r.why}`
      : r.ready ? `已连接 · ${r.models.length} 个模型` : '未连接 · 去设置连接'}));
  }
  /** 第二级：这家的模型。智能体的第一行是「Agent 默认模型」（按 Codex 配置选）；记住的模型从 Codex 的模型表里没了时
      照样列出、写明（同 model-agent.js `modelRows`）。 */
  function modelRows(row, value) {
    const rows = row.models.map(m => ({id: m.id, name: m.name,
      sub: m.agent ? (m.model ? (m.dflt ? '默认' : null) : '按 Codex 配置选择') : null, on: m.id === value}));
    if (row.agent && value && value.indexOf(row.id + '/') === 0 && !rows.some(r => r.on)) {
      rows.push({id: value, name: value.slice(row.id.length + 1), sub: '当前列表未提供此模型', on: true});
    }
    return rows;
  }
  /** 智能体的推理强度：与会话 composer 同一套键（BC_DATA.agent.efforts），没选过（null）是「中」，就是模型自己的默认。 */
  const EFFORTS = [{k: 'low', label: '低', sub: '快'}, {k: 'mid', label: '中', sub: '默认'}, {k: 'high', label: '高', sub: '慢，想得更久'}];
  const effortOf = (k) => EFFORTS.find(e => e.k === k) || EFFORTS[1];
  /** 下拉收起时那一行：API 提供方是「提供方 · 模型」，智能体再接推理强度。 */
  const pickLabel = (m, effort) => (m ? [m.provider, m.name, m.agent ? effortOf(effort).label : null].filter(Boolean).join(' · ') : '');
  function parseSubtitles(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!raw) return {cues: [], error: '请导入或粘贴 SRT / VTT 字幕'};
    if (raw.length > 64000) return {cues: [], error: '一次最多处理 64,000 字符，请分段导入'};
    const cues = [];
    const toSeconds = s => {
      const v = s.replace(',', '.').split(':').map(Number);
      if (v[v.length - 1] >= 60 || v[v.length - 2] >= 60) return NaN;
      return v.length === 3 ? v[0] * 3600 + v[1] * 60 + v[2] : v[0] * 60 + v[1];
    };
    const time = /^(\d{2,}:\d{2}:\d{2}[,.]\d{3}|\d{2}:\d{2}[.]\d{3})\s+-->\s+(\d{2,}:\d{2}:\d{2}[,.]\d{3}|\d{2}:\d{2}[.]\d{3})(?:\s+.*)?$/;
    const blocks = raw.replace(/^WEBVTT[^\n]*(?:\n|$)/, '').trim().split(/\n\s*\n/);
    for (const block of blocks) {
      if (/^(NOTE(?:\s|$)|STYLE(?:\s|$)|REGION(?:\s|$))/.test(block)) continue;
      const lines = block.split('\n');
      const i = lines[0].includes('-->') ? 0 : 1;
      const match = (lines[i] || '').match(time);
      if (!match || !lines.slice(i + 1).join('\n').trim()) return {cues: [], error: '字幕格式不完整：每条需要起止时间和正文'};
      const start = toSeconds(match[1]), end = toSeconds(match[2]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {cues: [], error: '字幕时间码无效：结束时间必须晚于开始时间'};
      cues.push({id: 'cue-' + (cues.length + 1), start, end, text: lines.slice(i + 1).join('\n')});
    }
    return {cues, error: cues.length ? '' : '没有找到可翻译的字幕'};
  }
  const stamp = s => {
    const ms = Math.round(s * 1000);
    return [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
  };
  const srt = cues => cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
  /** 固定请求：模型与消息；智能体选了推理强度时带上 `effort`（API 模型的推理强度在设置 › 模型 › 文本生成里统一设）。 */
  function request(kind, form, model) {
    if (!model?.ready) throw new Error('请先连接一个文本模型');
    const effort = model.agent && form.effort ? {effort: form.effort} : {};
    if (kind === 'text') {
      if (!String(form.input || '').trim()) throw new Error('请先输入生成要求');
      if (form.input.length > 16000) throw new Error('一次最多输入 16,000 字符');
      return {model: model.id, ...effort, messages: [{role: 'user', content: form.input.trim()}]};
    }
    if (kind !== 'translate') throw new Error('未知工具');
    const parsed = parseSubtitles(form.input);
    if (parsed.error) throw new Error(parsed.error);
    if (!form.lang) throw new Error('请选择目标语言');
    return {model: model.id, ...effort, messages: [{role: 'system', content: `将字幕正文翻译为${form.lang}。保持每条字幕的 id、数量与顺序，不修改时间码。返回包含 id 和 text 的 JSON 数组。`},
      {role: 'user', content: JSON.stringify(parsed.cues.map(c => ({id: c.id, text: c.text})))}]};
  }
  /** 只接受逐条对应的模型结果，防止漏句、重复或越界覆盖时间码。 */
  function translatedCues(cues, rows) {
    if (!Array.isArray(rows) || rows.length !== cues.length) throw new Error('模型返回的字幕数量不匹配');
    return cues.map((c, i) => {
      if (rows[i].id !== c.id || typeof rows[i].text !== 'string' || !rows[i].text.trim()) throw new Error('模型返回的字幕顺序或正文无效');
      return {...c, text: rows[i].text};
    });
  }
  function demo(kind, form) {
    if (kind === 'text') return {text: '# 文本生成示例\n\n> 交互原型示例，尚未调用模型。\n\n## 生成要求\n\n' + form.input.trim() + '\n\n## 示例结构\n\n用一个具体场景引出主题。\n\n围绕核心观点展开，补充事实与例子。\n\n用一句简洁的总结收尾。'};
    const originals = parseSubtitles(form.input).cues;
    const lines = form.lang === 'en' ? ['Welcome to today’s session.', 'Let’s start with a simple idea.'] : form.lang === 'ja' ? ['今日のセッションへようこそ。', 'シンプルなアイデアから始めましょう。'] : null;
    const sample = parseSubtitles(SAMPLE).cues;
    const cues = translatedCues(originals, originals.map(c => {
      const i = sample.findIndex(s => s.text === c.text);
      return {id: c.id, text: i >= 0 && lines ? lines[i] : `[${form.lang} · 示例占位，待接入模型] ${c.text}`};
    }));
    return {text: srt(cues), cues, lines: cues.length, dur: Math.max(...cues.map(c => c.end)), lang: form.lang};
  }
  const api = {SAMPLE, CODEX_PROVIDER, CODEX_TEXT_ID, CODEX_TEXT_CAUTION, models, initial, providers, modelRows, EFFORTS, effortOf, pickLabel, parseSubtitles, srt, request, translatedCues, demo};
  if (typeof window !== 'undefined') window.BC_LLM_TOOLS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
