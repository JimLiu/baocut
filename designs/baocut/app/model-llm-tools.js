/* 独立工具入口沿用 product-design §2.1；LLM 分类与固定模型请求按本次需求扩展，不创建 Agent 会话。 */
(function () {
  const SAMPLE = '1\n00:00:00,000 --> 00:00:03,000\n欢迎来到今天的分享。\n\n2\n00:00:03,000 --> 00:00:06,500\n让我们从一个简单的想法开始。';
  function models(catalog, saved) {
    return (catalog || []).flatMap(p => (p.models || []).filter(m => m.kind === 'llm').map(m => ({
      id: p.id + '/' + m.id, name: m.id, provider: p.name, ready: (saved || []).includes(p.id),
    })));
  }
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
  function request(kind, form, model) {
    if (!model?.ready) throw new Error('请先连接一个文本模型');
    if (kind === 'text') {
      if (!String(form.input || '').trim()) throw new Error('请先输入生成要求');
      if (form.input.length > 16000) throw new Error('一次最多输入 16,000 字符');
      return {model: model.id, messages: [{role: 'user', content: form.input.trim()}]};
    }
    if (kind !== 'translate') throw new Error('未知工具');
    const parsed = parseSubtitles(form.input);
    if (parsed.error) throw new Error(parsed.error);
    if (!form.lang) throw new Error('请选择目标语言');
    return {model: model.id, messages: [{role: 'system', content: `将字幕正文翻译为${form.lang}。保持每条字幕的 id、数量与顺序，不修改时间码。返回包含 id 和 text 的 JSON 数组。`},
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
  const api = {SAMPLE, models, parseSubtitles, srt, request, translatedCues, demo};
  if (typeof window !== 'undefined') window.BC_LLM_TOOLS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
