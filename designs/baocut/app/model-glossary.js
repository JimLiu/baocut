/* 术语库的纯模型 —— §15.10（2026-09-20，同日二次收口）。
   术语库是**用户自己的、跨项目的**专名表。库里有**两种表**，各管一件事，不混在一张表里：

   - **转录术语表**（`kind: 'asr'`）：规范写法 + 常听错成什么。转录时送给吃得下提示的语音模型，
     润色时按记下的误识逐处改回规范写法。可以限定一门口播语言，也可以不限。
   - **翻译术语表**（`kind: 'trans'`）：原文 → 译文，**带语言方向**（中文 → 英文、英文 → 中文、
     中文 → 日文各是各的表）。翻译时只有方向对得上的表才参与，且**只把本篇命中的条目**交给模型。

   为什么拆开：第一版一张表同时记误识、类别、译名、锁定与备注，加一条词要填六格，而其中
   一半只对转录有用、另一半只对翻译有用。拆开之后一条词只剩两格——转录表是「规范写法 / 常听错成」，
   翻译表是「原文 / 译文」；备注与「可变通」收在「更多」里，类别不再让人填。

   与项目内那张表的关系仍是**上游，不是并行**：项目里生效的真相只有 `ai/context.md`
   （`# Canonical Terms`）与 `ai/context.<lang>.md`（`# Bilingual Glossary`）。库只把**本篇命中的**
   条目以 `Origin=user` 写进去；下游四道硬约束（rt → validate → lint → check）一行不改。
   库文件也仍是同构的 Markdown 表：转录表只有 `# Canonical Terms`，翻译表只有 `# Bilingual Glossary`。

   这里只算，不画。演示数据在 data.js（`D.glossary`）。 */
(function () {
  /* ---------- 两种表 ---------- */

  const KINDS = {
    asr: {k: 'asr', label: '转录术语表', short: '转录', a: '规范写法', b: '常听错成'},
    trans: {k: 'trans', label: '翻译术语表', short: '翻译', a: '原文', b: '译文'},
  };
  const kindOf = (pack) => (pack && pack.kind === 'trans' ? 'trans' : 'asr');

  /* 归并键：小写、去空白、去 ASCII 标点。与 core 的 `term_merge_key` 同口径——
     `KV cache` / `kv-cache` / `KV Cache` 是同一条，不能在库里并存成三条。 */
  const normKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s　]+/g, '').replace(/[!-/:-@[-`{-~]+/g, '');
  const sameTerm = (a, b) => normKey(a) === normKey(b) && normKey(a) !== '';

  /* ---------- 语言方向 ---------- */

  /* **术语库不自带语言表**：语言的名字与 code 只从全 App 共用的那份目录取（model-languages.js，
     镜像 `bcut-editor-core::translate_list::LANGS`），选语言也用共用的 `LanguageCombobox`。
     另带一份小表的下场是：别处能选的语言这里选不了，同一门语言在两处叫两个名字。 */
  const CATALOG = (typeof window !== 'undefined' && window.BC_LANGUAGES)
    || (typeof require === 'function' ? require('./model-languages.js') : null);
  const langLabel = (c) => (c ? CATALOG.native(c) : '任意语言');
  function langBase(code) { return String(code || '').toLowerCase().split(/[-_]/)[0]; }

  /* 源语言一侧只比主语种（`zh-Hans` 的口播与 `zh` 的表是一回事）；留空 = 任意语言。 */
  const fromMatch = (packLang, lang) => !packLang || !lang || lang === 'auto' || langBase(packLang) === langBase(lang);
  /* 目标语言一侧按目录里的那一条比：`zh-Hans` / `zh-CN` 都是简体中文那一条，而简体与繁体是
     两条——译文是要逐字照用的，「威科夫」不能原样用在繁体译文里。 */
  const toMatch = (packLang, lang) => !!packLang && !!lang && CATALOG.canon(packLang) === CATALOG.canon(lang);

  /** 这张表对这一步用不用得上。`ctx = {kind, from, to}`。 */
  function packApplies(pack, ctx) {
    if (kindOf(pack) !== ctx.kind) return false;
    if (ctx.kind === 'asr') return fromMatch(pack.lang, ctx.from);
    return toMatch(pack.to, ctx.to) && fromMatch(pack.from, ctx.from);
  }

  /** 表名旁边那句方向：`中文 → 英文` / `中文口播` / `任意语言`。 */
  function pairLabel(pack) {
    if (kindOf(pack) === 'trans') return `${langLabel(pack.from)} → ${langLabel(pack.to)}`;
    return pack.lang ? `${langLabel(pack.lang)} 口播` : '任意语言';
  }

  /* ---------- 条目校验 ---------- */

  /* 返回问题文案数组（空 = 可以保存）。每种表只有一格必填；第二格在转录表可空（只想让语音模型
     认得这个写法），在翻译表必填（没有译文的翻译条目什么也不约束）。 */
  function validate(term, kind) {
    const out = [];
    const src = String(term.source || '').trim();
    if (!src) out.push(kind === 'trans' ? '原文不能为空' : '规范写法不能为空');
    if (kind === 'trans') {
      if (!String(term.target || '').trim()) out.push('译文不能为空');
      return out;
    }
    const vs = (term.variants || []).map((v) => String(v).trim()).filter(Boolean);
    if (vs.some((v) => sameTerm(v, src))) out.push('常听错成的写法不能和规范写法相同');
    const keys = vs.map(normKey);
    if (keys.some((k, i) => keys.indexOf(k) !== i)) out.push('常听错成的写法里有重复');
    return out;
  }

  const splitVariants = (s) => [...new Set(String(s || '').split(/[,，、;；]/).map((v) => v.trim()).filter(Boolean))];

  /* ---------- 一次粘一批 ---------- */

  /* 加词的主路不是表单，是**一行一条**：
       转录表   `KV cache`            或  `KV cache = 开维缓存、KV 换成`
       翻译表   `commit = 突破确认`    （`=`、`→`、`->`、`=>`、Tab、`|` 都认；译文后面再跟一格是备注）
     Markdown 表、从表格软件复制出来的 Tab 分隔、CSV 两列都走这一只解析，所以「导入」和「粘一批」
     是同一个入口。解析不了的行**原样退回并说明原因**，不悄悄丢。 */
  function parseLines(text, kind) {
    const terms = [];
    const skipped = [];
    const seen = new Map();
    let cols = null;
    String(text || '').split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line || /^#/.test(line) || /^---+$/.test(line) || /^[A-Za-z]+\s*:\s/.test(line) && !/[=→\t|]/.test(line)) return;
      let cells;
      if (line.startsWith('|')) {
        cells = line.replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, '|').trim());
        if (cells.every((c) => /^:?-+:?$/.test(c) || c === '')) return;
        if (/^(source|原文|规范写法)$/i.test(cells[0])) {
          cols = {};
          cells.forEach((c, i) => {
            const k = c.toLowerCase();
            if (/^(variants|常听错成|常见误识)$/.test(k)) cols.variants = i;
            else if (/^(target|译文|译名)$/.test(k)) cols.target = i;
            else if (/^(note|备注)$/.test(k)) cols.note = i;
            else if (/^(lock|锁定)$/.test(k)) cols.lock = i;
          });
          return;
        }
      } else {
        const m = line.split(/\s*(?:=>|->|→|=|\t)\s*/);
        cells = m.length > 1 ? m : (kind === 'trans' ? line.split(/\s*[,，]\s*/) : [line]);
        cols = null;
      }
      const source = (cells[0] || '').trim();
      if (!source) return;
      const c = cols || (kind === 'trans' ? {target: 1, note: 2} : {variants: 1});
      const term = {source};
      if (kind === 'trans') {
        term.target = (cells[c.target == null ? -1 : c.target] || '').trim();
        term.note = (cells[c.note == null ? -1 : c.note] || '').trim();
        term.lock = c.lock == null ? true : !/^no$/i.test(cells[c.lock] || '');
        if (!term.target) { skipped.push({line, why: '没有译文'}); return; }
      } else {
        term.variants = splitVariants(cells[c.variants == null ? -1 : c.variants]).filter((v) => !sameTerm(v, source));
      }
      const key = normKey(source);
      if (!key) { skipped.push({line, why: '只有标点'}); return; }
      if (seen.has(key)) {
        const prev = seen.get(key);
        if (kind === 'asr') prev.variants = [...new Set([...prev.variants, ...term.variants])];
        skipped.push({line, why: '和前面的行是同一个词，已合并'});
        return;
      }
      seen.set(key, term);
      terms.push(term);
    });
    return {terms, skipped};
  }

  /** 把一批新词并进一张表：已有的词不重复加（转录表并入新的误识，翻译表保留原译文）。 */
  function addTerms(pack, incoming, idOf) {
    const kind = kindOf(pack);
    const terms = (pack.terms || []).map((t) => ({...t}));
    let added = 0;
    let merged = 0;
    (incoming || []).forEach((t, i) => {
      const at = terms.findIndex((x) => sameTerm(x.source, t.source));
      if (at < 0) { terms.push({...t, id: idOf ? idOf(t, i) : 'gt-' + normKey(t.source)}); added += 1; return; }
      merged += 1;
      if (kind === 'asr') terms[at].variants = [...new Set([...(terms[at].variants || []), ...(t.variants || [])])];
    });
    return {pack: {...pack, terms}, added, merged};
  }

  /* ---------- 多表合并 ---------- */

  /* 启用多张表时按**启用顺序**取：前面的表赢。冲突只在「同一个原文、译文不同」时成立。
     `ctx = {kind, from, to}`：方向对不上的表即使勾着也不参与。 */
  function mergePacks(packs, enabled, ctx) {
    const order = (enabled || []).map((id) => (packs || []).find((p) => p.id === id))
      .filter((p) => p && packApplies(p, ctx));
    const seen = new Map();
    const conflicts = [];
    order.forEach((pack) => {
      (pack.terms || []).forEach((t) => {
        const key = normKey(t.source);
        if (!key) return;
        const prev = seen.get(key);
        if (!prev) { seen.set(key, {...t, packId: pack.id, packName: pack.name}); return; }
        if (ctx.kind === 'trans') {
          if (t.target && prev.target && t.target !== prev.target) {
            const row = conflicts.find((c) => c.key === key);
            if (row) row.rows.push({packId: pack.id, packName: pack.name, target: t.target});
            else conflicts.push({key, source: prev.source, winner: prev.packName,
              rows: [{packId: prev.packId, packName: prev.packName, target: prev.target},
                {packId: pack.id, packName: pack.name, target: t.target}]});
          }
          return;
        }
        // 误识是并集：同一个词在别的表里记下的错法同样值得纠正
        seen.set(key, {...prev, variants: [...new Set([...(prev.variants || []), ...(t.variants || [])])]});
      });
    });
    return {packs: order, terms: [...seen.values()], conflicts};
  }

  /* ---------- 命中 ---------- */

  /* 拉丁词按词边界，CJK 直接子串——中文没有空格，`\b` 在这里是错的。 */
  function formRegex(form) {
    const esc = String(form).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const latin = /^[\x20-\x7e]+$/.test(form);
    return new RegExp(latin ? '(?<![A-Za-z0-9])' + esc + '(?![A-Za-z0-9])' : esc, 'gi');
  }

  /** 一段文本里命中的术语：`kind` 为 `exact`（已经是规范写法）或 `variant`（疑似误识）。 */
  function hits(text, terms) {
    const s = String(text || '');
    const out = [];
    (terms || []).forEach((t) => {
      const forms = [{form: t.source, kind: 'exact'},
        ...((t.variants || []).map((v) => ({form: v, kind: 'variant'})))];
      forms.forEach(({form, kind}) => {
        if (!String(form || '').trim()) return;
        const re = formRegex(form);
        let m;
        while ((m = re.exec(s)) !== null) {
          out.push({termId: t.id, source: t.source, at: m.index, len: m[0].length, form: m[0], kind});
          if (m.index === re.lastIndex) re.lastIndex++;
        }
      });
    });
    return out.sort((a, b) => a.at - b.at);
  }

  /** 同一条术语在全篇出现多少次（`exact` + `variant` 合计）。 */
  function countByTerm(paras, terms) {
    const tally = {};
    (paras || []).forEach((p) => hits(p.text, terms).forEach((h) => {
      const row = tally[h.termId] || (tally[h.termId] = {termId: h.termId, exact: 0, variant: 0});
      row[h.kind] += 1;
    }));
    return tally;
  }

  /* **翻译只带命中的**：库可以有几千条，交给模型的只能是这一篇真的出现了的那几条——
     整库灌进提示词既贵，又会把真正要紧的那几条淹掉。过滤是程序做的，不是让模型自己挑。
     翻译表本身不记误识，但同一个词在启用的转录表里记过的错法也算命中（文稿还没润色时，
     正文里写的可能是「维科夫」而不是 `Wyckoff`）。按命中次数降序，平手保持库里的顺序。 */
  function hitTerms(paras, transTerms, asrTerms) {
    const borrow = new Map((asrTerms || []).map((t) => [normKey(t.source), t.variants || []]));
    const probe = (transTerms || []).map((t) => ({...t, variants: borrow.get(normKey(t.source)) || []}));
    const tally = countByTerm(paras, probe);
    const hit = probe.map((t, i) => ({t, i, n: tally[t.id] ? tally[t.id].exact + tally[t.id].variant : 0}))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map((r) => ({...r.t, count: r.n}));
    return {hit, total: probe.length, locked: hit.filter((t) => t.lock !== false).length};
  }

  /* ---------- 校对建议（润色，用转录表） ---------- */

  /* 只有 `variant` 命中才成为建议：规范写法本来就对，不该出现在待办里。
     **一段一条建议**，段里所有术语的改动都在这一条里；同一条术语在段内多次误识也只算一条。 */
  function review(paras, terms) {
    const out = [];
    (paras || []).forEach((p) => {
      const text = String(p.text || '');
      /* 两条术语命中同一段文字时（`林彻` 与 `林彻说`），取靠前且更长的那处，
         否则替换区间会互相咬掉一截，拼出来的整段是坏的。 */
      const spots = [];
      hits(text, terms).filter((h) => h.kind === 'variant').forEach((h) => {
        const last = spots[spots.length - 1];
        if (last && h.at < last.at + last.len) { if (h.len > last.len) spots[spots.length - 1] = h; return; }
        spots.push(h);
      });
      if (!spots.length) return;
      const byTerm = [];
      spots.forEach((h) => {
        let row = byTerm.find((r) => r.termId === h.termId);
        if (!row) {
          const t = terms.find((x) => x.id === h.termId) || {};
          byTerm.push(row = {termId: h.termId, source: h.source, packName: t.packName || null, forms: [], count: 0});
        }
        row.count += 1;
        if (!row.forms.includes(h.form)) row.forms.push(h.form);
      });
      let after = '';
      let cur = 0;
      spots.forEach((h) => { after += text.slice(cur, h.at) + h.source; cur = h.at + h.len; });
      out.push({id: p.id, ref: p.id, label: p.label || p.id, text, after: after + text.slice(cur),
        spots: spots.map((h) => ({at: h.at, len: h.len, form: h.form, source: h.source, termId: h.termId})),
        terms: byTerm, count: spots.length,
        packNames: byTerm.map((r) => r.packName).filter((n, i, a) => n && a.indexOf(n) === i)});
    });
    return out;
  }

  /** 建议列表折成一句收据用的摘要。 */
  function reviewSummary(list) {
    const n = (list || []).reduce((s, r) => s + r.count, 0);
    const ids = new Set();
    (list || []).forEach((r) => r.terms.forEach((t) => ids.add(t.termId)));
    return {rows: (list || []).length, hits: n, terms: ids.size};
  }

  /* ---------- 候选回流 ---------- */

  /* 校对同时给「库里还没有、但这一篇反复出现」的疑似专名。判据是出现次数——
     只出现一次的词证据不足，收进库反而会污染以后每一篇。 */
  function newTerms(candidates, terms, minCount) {
    const min = minCount == null ? 2 : minCount;
    const known = new Set((terms || []).map((t) => normKey(t.source)));
    (terms || []).forEach((t) => (t.variants || []).forEach((v) => known.add(normKey(v))));
    return (candidates || [])
      .filter((c) => c.count >= min && !known.has(normKey(c.source)))
      .sort((a, b) => b.count - a.count);
  }

  /* ---------- 识别提示（转录） ---------- */

  /* **能力门**：吃不吃提示由语音模型说了算，不是一个可以到处打开的开关。
     - `prompt`：Whisper 系的 initial prompt / `gpt-4o-transcribe` 的 `prompt`，预算约 224 token；
     - `context`：Qwen3-ASR 的上下文文本，宽得多；
     - `none`：这只模型没有这条通道——选表与提示词两样都收起来，页面直说而不是假装生效。 */
  const ASR_HINT = {
    prompt: {label: '识别提示', budget: 180, note: '作为开头提示送进模型，篇幅有限',
      how: '模型把它当成「前文」来读，不是指令——写与内容相关的一两句话或专名，比写「请准确识别」有用。'},
    context: {label: '上下文', budget: 1200, note: '作为上下文文本送进模型',
      how: '可以写这段录音在讲什么、谁在说话、有哪些专名。'},
    none: {label: '不支持', budget: 0, note: '这只模型没有提示通道', how: ''},
  };

  function asrHint(modelId) {
    const id = String(modelId || '').split('/').pop();
    const kind = /^whisper|^gpt-4o(-mini)?-transcribe/.test(id) ? 'prompt'
      : /^qwen3-asr/.test(id) ? 'context'
        : 'none';
    return {kind, ...ASR_HINT[kind]};
  }

  /* 送进模型的那一串 = **自定义提示词在前，术语在后**。自己写的话一个字不截；术语按表的顺序
     填满剩下的篇幅，放不下的**丢在末尾并报出丢了几条**——悄悄截断会让用户以为整库都喂进去了。
     提示词自己就超了篇幅时 `over` 给出超了多少，页面要直说「后面的会被模型截掉」。 */
  function hintCompose(custom, terms, budget) {
    const head = String(custom || '').trim();
    const cap = budget || 0;
    const words = [];
    let dropped = 0;
    let len = head.length ? head.length + 1 : 0;
    (terms || []).forEach((t) => {
      const w = String(t.source || '').trim();
      if (!w) return;
      const add = (words.length ? 1 : 0) + w.length;
      if (cap && len + add > cap) { dropped += 1; return; }
      words.push(w);
      len += add;
    });
    const tail = words.join('、');
    return {text: [head, tail].filter(Boolean).join('\n'), custom: head.length, used: words.length, dropped,
      chars: head.length + (head && tail ? 1 : 0) + tail.length, over: cap ? Math.max(0, head.length - cap) : 0};
  }

  /* ---------- 译文过期 ---------- */

  /* 改了术语不该触发全文重译：按 §11.3 的 provenance，只有**命中该术语的句子**过期。 */
  function staleSentences(changedTermIds, sentences) {
    const set = new Set(changedTermIds || []);
    return (sentences || []).filter((s) => (s.termIds || []).some((id) => set.has(id))).map((s) => s.id);
  }

  /* ---------- Markdown 往返（与 ai/context.md 同构） ---------- */

  const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').trim();
  const yn = (b) => (b ? 'yes' : 'no');

  function toMarkdown(pack) {
    const kind = kindOf(pack);
    const head = ['---', 'name: ' + pack.name, 'kind: ' + (kind === 'trans' ? 'translate' : 'transcribe'),
      kind === 'trans' ? (pack.from ? 'from: ' + pack.from : null) : (pack.lang ? 'lang: ' + pack.lang : null),
      kind === 'trans' ? 'to: ' + pack.to : null,
      pack.dflt ? 'default: true' : null, '---', ''].filter((l) => l != null);
    const rows = pack.terms || [];
    if (kind === 'trans') {
      return head.concat('# Bilingual Glossary', '| Source | Target | Note | Lock | Origin |', '|---|---|---|---|---|',
        rows.map((t) => ['', cell(t.source), cell(t.target), cell(t.note), yn(t.lock !== false), 'user', '']
          .join(' | ').trim())).join('\n') + '\n';
    }
    return head.concat('# Canonical Terms', '| Source | Category | Variants | Note | Lock | Origin |',
      '|---|---|---|---|---|---|',
      rows.map((t) => ['', cell(t.source), cell(t.cat || 'other'), cell((t.variants || []).join(', ')),
        cell(t.note), 'no', 'user', ''].join(' | ').trim())).join('\n') + '\n';
  }

  /* 读一个库文件。**第一版的混合表**（一个文件里两张表都有、没有 `kind`）拆成两张：
     误识进转录表，译名进翻译表——拆是无损的，两张表的名字都沿用原名。
     返回 `{packs, warnings}`；一段没有 front matter 的纯文本也认（走 `parseLines`）。 */
  function parseMarkdown(text, fallbackKind) {
    const src = String(text || '');
    const lines = src.split(/\r?\n/);
    const meta = {};
    let i = 0;
    if (lines[0] && lines[0].trim() === '---') {
      i = 1;
      while (i < lines.length && lines[i].trim() !== '---') {
        const m = lines[i].match(/^([A-Za-z]+)\s*:\s*(.*)$/);
        if (m) meta[m[1]] = m[2].trim();
        i += 1;
      }
      i += 1;
    }
    const sections = {canon: [], bi: []};
    let section = null;
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^#\s/.test(line.trim())) { section = /bilingual/i.test(line) ? 'bi' : 'canon'; continue; }
      if (section) sections[section].push(line);
    }
    const warnings = [];
    const name = meta.name || '导入的术语表';
    const legacyTo = meta.targetLang || String(meta.targets || '').replace(/[[\]\s]/g, '').split(',')[0] || null;
    const packs = [];
    const take = (kind, body, extra) => {
      const {terms, skipped} = parseLines(body.join('\n'), kind);
      skipped.forEach((s) => warnings.push(`「${s.line}」${s.why}`));
      if (terms.length) packs.push({name, kind, dflt: meta.default === 'true', ...extra, terms});
    };
    if (!section) {
      const kind = meta.kind === 'translate' ? 'trans' : meta.kind === 'transcribe' ? 'asr' : (fallbackKind || 'asr');
      take(kind, lines, kind === 'trans' ? {from: meta.from || null, to: meta.to || legacyTo} : {lang: meta.lang || null});
      return {packs, warnings};
    }
    if (meta.kind !== 'translate') take('asr', sections.canon, {lang: meta.lang || null});
    if (meta.kind !== 'transcribe') take('trans', sections.bi, {from: meta.from || null, to: meta.to || legacyTo});
    return {packs, warnings};
  }

  /** 翻译表掉个头：`英文 → 中文` 生成一张 `中文 → 英文`。掉头后原文撞车的只留第一条。 */
  function reversePack(pack) {
    const seen = new Set();
    const terms = [];
    (pack.terms || []).forEach((t) => {
      const key = normKey(t.target);
      if (!key || seen.has(key)) return;
      seen.add(key);
      terms.push({...t, id: t.id + '-r', source: t.target, target: t.source});
    });
    return {...pack, id: pack.id + '-r', name: pack.name, from: pack.to, to: pack.from, dflt: false, terms};
  }

  /* ---------- 页面用的小算子 ---------- */

  function packStats(pack) {
    const terms = pack.terms || [];
    return {n: terms.length,
      withVariants: terms.filter((t) => (t.variants || []).length).length,
      loose: terms.filter((t) => t.lock === false).length};
  }

  function search(terms, q) {
    const key = normKey(q);
    if (!key) return terms || [];
    return (terms || []).filter((t) => normKey(t.source).includes(key)
      || (t.variants || []).some((v) => normKey(v).includes(key))
      || normKey(t.target).includes(key)
      || normKey(t.note).includes(key));
  }

  const toggle = (list, id) => ((list || []).includes(id) ? list.filter((x) => x !== id) : [...(list || []), id]);

  /** 项目启用哪几张表：用户为这个项目定过就听他的（空数组也算定过），没定过取标了 `dflt` 的。 */
  function enabledFor(use, projectId, packs) {
    const own = (use || {})[projectId];
    if (Array.isArray(own)) return own.filter((id) => (packs || []).some((p) => p.id === id));
    return (packs || []).filter((p) => p.dflt).map((p) => p.id);
  }

  /** 设置态那一行的副文案：「2 张表 · 148 条」。只数这一步用得上的表。 */
  function enabledLine(packs, enabled, ctx) {
    const merged = mergePacks(packs, enabled, ctx);
    if (!merged.packs.length) return '';
    return `${merged.packs.length} 张表 · ${merged.terms.length} 条`;
  }

  window.BC_GLOSSARY = {
    KINDS, kindOf, langLabel, langBase, packApplies, pairLabel, normKey, sameTerm, validate, splitVariants,
    parseLines, addTerms, mergePacks, hits, countByTerm, hitTerms, review, reviewSummary, newTerms,
    ASR_HINT, asrHint, hintCompose, staleSentences,
    toMarkdown, parseMarkdown, reversePack, packStats, search, toggle, enabledFor, enabledLine,
  };
})();
