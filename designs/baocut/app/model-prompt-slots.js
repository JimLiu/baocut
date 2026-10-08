/* 提示词里的待填项（template-spec §5.5；product-design §3.2.1、§3.2.3）。
   模板的 brief 与作品示例的 prompt.md 用 `{{label}}` 标出要用户补的地方；输入框把它画成占位 token，
   打字即替换。草稿始终是一个字符串（占位符原样写成 `{{label}}`），这里负责字符串与片段之间的往返：
   - parse / serialize 必须严格互逆：serialize(parse(s)) === s，否则 PromptField 会反复重建；
   - label 是 `{{` 与 `}}` 之间的原文，不修剪；空的 `{{}}`、没闭合的 `{{`、label 里带括号或换行的都按普通文字留着。
   纯模型：不碰 DOM，可被 node --test 直接 require。 */
(function () {
  /* 一个占位符：label 非空，不含花括号与换行（label ≤ 24，见 template-spec §3.1）。 */
  const SLOT = /\{\{([^{}\n]+)\}\}/g;

  /** 文本 → 片段：[{type: 'text', text}, {type: 'slot', label}]。不产生空的文字片段；空串返回 []。 */
  function parse(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let at = 0;
    SLOT.lastIndex = 0;
    let m;
    while ((m = SLOT.exec(s))) {
      if (m.index > at) out.push({type: 'text', text: s.slice(at, m.index)});
      out.push({type: 'slot', label: m[1]});
      at = m.index + m[0].length;
    }
    if (at < s.length) out.push({type: 'text', text: s.slice(at)});
    return out;
  }

  /** 片段 → 文本：slot 写回 `{{label}}`。 */
  function serialize(segments) {
    return (segments || []).map((x) => (x.type === 'slot' ? `{{${x.label}}}` : x.text || '')).join('');
  }

  /** 文本里还没填的占位符 label：去重，按第一次出现的顺序。 */
  function labels(text) {
    const seen = [];
    parse(text).forEach((x) => { if (x.type === 'slot' && !seen.includes(x.label)) seen.push(x.label); });
    return seen;
  }

  /** 交给 Agent 的文字：没填的 `{{label}}` 写成 `[label]`，Agent 据此知道哪里要先问（template-spec §5.5）。 */
  function forAgent(text) {
    return parse(text).map((x) => (x.type === 'slot' ? `[${x.label}]` : x.text)).join('');
  }

  /** 「可以这样说」的示例句：占位符换成 fields 里同名项的 example，没有 example 时用 label 本身。 */
  function example(text, fields) {
    const list = Array.isArray(fields) ? fields : [];
    return parse(text).map((x) => {
      if (x.type !== 'slot') return x.text;
      const f = list.find((y) => y && y.label === x.label);
      return (f && f.example) || x.label;
    }).join('');
  }

  /* ---------- 与 S2 PromptFieldValue 片段的互换（纯数据，app/ui.jsx 的 PromptField 用） ----------
     S2 的占位 token 是 {type: 'token', text: label, value: {type: 'placeholder', placeholderType: 'text'}}：
     画成占位样式，点一下整个选中，打字即替换，Tab / Shift+Tab 在 token 之间跳。 */
  const isSlotToken = (x) => !!x && x.type === 'token' && !!x.value && x.value.type === 'placeholder' && x.value.placeholderType === 'text';

  /** 草稿字符串 → PromptFieldValue 的片段。 */
  function toTokens(text) {
    return parse(text).map((x) => (x.type === 'slot'
      ? {type: 'token', text: x.label, value: {type: 'placeholder', placeholderType: 'text'}}
      : {type: 'text', text: x.text}));
  }

  /** PromptFieldValue 的片段 → 草稿字符串：占位 token 写回 `{{label}}`，链接 token 写完整地址（同 S2 的 toString），其余取文字。 */
  function fromTokens(segments) {
    return (segments || []).map((x) => {
      if (isSlotToken(x)) return `{{${x.text}}}`;
      if (x.type === 'token' && x.value && x.value.type === 'url') return x.value.url;
      return x.text || '';
    }).join('');
  }

  /** 「填下一处」：从片段下标 `from` 往后找下一个占位 token，到末尾从头再找；没有返回 -1。 */
  function nextSlot(segments, from) {
    const list = segments || [];
    const n = list.length;
    const start = Number.isInteger(from) ? from : -1;
    for (let k = 1; k <= n; k++) {
      const i = (((start + k) % n) + n) % n;
      if (isSlotToken(list[i])) return i;
    }
    return -1;
  }

  const api = {parse, serialize, labels, forAgent, example, toTokens, fromTokens, nextSlot, isSlotToken};
  if (typeof window !== 'undefined') window.BC_PROMPT_SLOTS = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
