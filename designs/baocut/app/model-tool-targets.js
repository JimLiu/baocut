/* 视频工具的输入目标（product-design §2.7、architecture §7.9「候选输入」）—— window.BC_TOOL_TARGETS。
   纯函数，无 React、无 DOM；只在 App 入口加载。

   视频选择器读的是 Space 的目录，不打开视频：每部视频有没有文稿、是什么语言、已有哪些译文与配音。
   这里算：
   - 视频的文档事实（`facts`）：演示数据里多数视频没有显式的 `docs`，从记录推出来（转录过 = 有转录模型且已完成；
     译文 = `content.trans` 里出现的语言）；工具写进视频之后记录上就有了显式的 `docs`，以它为准；
   - 某个工具的候选（`candidates`）：按工具要求的事实筛选、标注、排序；不能选的置灰并写清原因；
   - 写进已有视频时的提示（`duplicateNote`）与写入后的事实（`withDoc`；文稿取代用 `withDoc(…, {mode: 'replace'})`）；
   - 翻译配音能选用的译文（`translationOptions`）；
   - 重新转录的落点（product-design §5.11、§2.7）：已有文稿时「新建视频」/「取代这部视频的文稿」（`retargetOptions`）、
     用户改过原文的闸门（`edited`）、选「取代」时的影响预览（`replaceImpact`）与换用文稿之后的结转摘要（`carrySummary`）。 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;

  /* 演示数据里语言有三种写法（`中文` / `简体中文` / `English`），按语言码比较才知道「同一种语言」 */
  const NAME_TO_CODE = {
    '中文': 'zh', '简体中文': 'zh', '汉语': 'zh', '英语': 'en', '英文': 'en', 'english': 'en',
    '日语': 'ja', '日文': 'ja', '日本語': 'ja', '韩语': 'ko', '한국어': 'ko', '西班牙语': 'es', 'español': 'es',
    '法语': 'fr', 'français': 'fr', '德语': 'de', 'deutsch': 'de',
  };
  const LABEL = {zh: '中文', en: '英语', ja: '日语', ko: '韩语', es: '西班牙语', fr: '法语', de: '德语'};
  const catalog = () => root.BC_LANGUAGES || null;

  /** 语言名或码 → 语言码；认不出（含「自动检测」）→ null */
  function langCode(v) {
    const raw = String(v || '').trim();
    if (!raw) return null;
    const low = raw.toLowerCase();
    if (NAME_TO_CODE[raw] || NAME_TO_CODE[low]) return NAME_TO_CODE[raw] || NAME_TO_CODE[low];
    if (LABEL[low]) return low;
    const L = catalog();
    const hit = L && L.all ? L.all.find((l) => l.code === raw || l.native === raw || l.name.toLowerCase() === low) : null;
    return hit ? hit.code : null;
  }
  /** 语言码 → 界面上的短名（中文 / 英语 / 日语…） */
  function langLabel(code) {
    if (!code) return '未知语言';
    if (LABEL[code]) return LABEL[code];
    const L = catalog();
    const hit = L && L.all ? L.all.find((l) => l.code === code) : null;
    return hit ? hit.native : code;
  }

  /** 转录这一步的状态：none 没转录 · running 转录中 · queued 排队 · failed 失败 · done 有文稿 */
  function transcriptState(m) {
    if (m.status === 'transcribing') return 'running';
    if (m.status === 'queued') return 'queued';
    if (m.status === 'error') return 'failed';
    return null;
  }

  /* 句数缺省：记录里有 `meta.cues` 用它，否则 0（演示数据里没有的数一律 0，不编） */
  const cueCount = (m) => (m && m.meta && +m.meta.cues) || 0;
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);

  /**
   * 视频的文档事实：`{transcripts:[{id, lang, units, edited}], translations:[{id, lang, from, units, reviewed}],
   * dubs:[{id, lang, translation, units}], layers:[…], pins, state}`。
   * `units` 是句数，`reviewed` 是已审句数，`pins` 是字幕的手工换行 / 固定时间（CaptionOverride、userBreaks…）的个数。
   * 显式的 `m.docs` 优先；没有就从记录推。返回新对象，改它不影响记录。没有这些数的旧记录按 0 算。
   */
  function facts(m) {
    const busy = transcriptState(m);
    const n = cueCount(m);
    if (m && m.docs) {
      const d = m.docs;
      const out = {transcripts: (d.transcripts || []).map((x) => Object.assign({}, x, {units: num(x.units, n), edited: !!x.edited})),
        translations: (d.translations || []).map((x) => Object.assign({}, x, {units: num(x.units, n), reviewed: num(x.reviewed, 0)})),
        dubs: (d.dubs || []).map((x) => Object.assign({}, x, {units: num(x.units, 0)})),
        layers: (d.layers || []).map((x) => Object.assign({}, x)),
        pins: num(d.pins, 0)};
      out.state = busy || (out.transcripts.length ? 'done' : 'none');
      return out;
    }
    const out = {transcripts: [], translations: [], dubs: [], layers: [], pins: 0};
    const transcribed = !busy && !!(m && m.model) && m.status === 'complete';
    if (transcribed) {
      const lang = langCode(m.lang);
      const tx = {id: `${m.id}-tx1`, lang, units: n, edited: !!m.transcriptEdited};
      out.transcripts.push(tx);
      out.layers.push({id: `${m.id}-sub-${lang || 'src'}`, lang});
      const seen = new Set();
      ((m.content && m.content.trans) || []).forEach((t) => {
        const code = langCode(t.lang);
        if (!code || code === lang || seen.has(code)) return;
        seen.add(code);
        /* 推出来的译文句数：`content.trans` 只是摘几句演示，真实句数按文稿算；已审数推不出来，记 0 */
        out.translations.push({id: `${m.id}-tr-${code}`, lang: code, from: tx.id, units: n, reviewed: 0});
      });
    }
    out.state = busy || (out.transcripts.length ? 'done' : 'none');
    return out;
  }

  /** 一组语言码 → 「英语、日语」（同一种语言出现多份时记成「英语 ×2」） */
  function langsText(list) {
    const n = {};
    const order = [];
    (list || []).forEach((x) => { if (!(x.lang in n)) { n[x.lang] = 0; order.push(x.lang); } n[x.lang]++; });
    return order.map((c) => (n[c] > 1 ? `${langLabel(c)} ×${n[c]}` : langLabel(c))).join('、');
  }

  /** 选择器每一行的标注：文稿 · 中文 / 译文 · 英语、日语 / 配音 · 英语 */
  function tags(f) {
    const out = [];
    if (f.transcripts.length) out.push({k: 'transcript', label: `文稿 · ${langsText(f.transcripts)}`});
    if (f.translations.length) out.push({k: 'translation', label: `译文 · ${langsText(f.translations)}`});
    if (f.dubs.length) out.push({k: 'dub', label: `配音 · ${langsText(f.dubs)}`});
    return out;
  }

  /* 这个工具要视频有什么（product-design §2.7 视频工具的输入表）：转录要有素材；翻译字幕、翻译配音要有文稿；
     从链接导入加进已有视频什么都不要求（没转录、空白的都能加） */
  const NEEDS = {transcribe: 'media', translate: 'transcript', dub: 'transcript', link: 'any'};

  /** 这部视频对这个工具来说为什么不能选；能选 → null */
  function blockReason(tool, m, f) {
    if (NEEDS[tool] === 'any') return null;
    if (NEEDS[tool] === 'media') {
      if (f.state === 'running') return '正在转录，完成后可以重新转录';
      if (f.state === 'queued') return '已在转录队列里';
      if (!m.src || !m.src.name) return '视频里还没有可转录的素材';
      if (m.src.state === 'missing') return '源文件找不到，接回文件后再转录';
      return null;
    }
    if (f.transcripts.length) return null;
    if (f.state === 'running') return '正在转录，完成后才能选';
    if (f.state === 'queued') return '在转录队列里，转录完成后才能选';
    if (f.state === 'failed') return '上次转录失败，先重新转录';
    return '还没有文稿，先转录';
  }

  /**
   * 某个工具的候选视频：回收站里的不列；能选的排在前面，同组内按最近活动（`mtime` 越小越近）。
   * 不能选的保留在列表里（置灰），`reason` 说明为什么。
   * @returns {Array<{id, title, dir, mtime, dur, facts, tags, eligible, reason}>}
   */
  function candidates(tool, movies, opt) {
    const o = opt || {};
    const q = String(o.q || '').trim().toLowerCase();
    const rows = (movies || []).filter((m) => !m.archived).map((m, i) => {
      const f = facts(m);
      const reason = blockReason(tool, m, f);
      return {id: m.id, title: m.title, dir: m.dir || null, mtime: m.mtime != null ? m.mtime : m.ctime != null ? m.ctime : Infinity,
        dur: m.duration || 0, facts: f, tags: tags(f), eligible: !reason, reason, idx: i};
    }).filter((r) => !q || String(r.title).toLowerCase().indexOf(q) >= 0);
    return rows.sort((a, b) => (Number(b.eligible) - Number(a.eligible)) || (a.mtime - b.mtime) || (a.idx - b.idx));
  }

  /** 预选：给了的视频能选就用它，否则第一部能选的；都不能选 → null */
  function pick(rows, want) {
    const hit = want && rows.find((r) => r.id === want && r.eligible);
    if (hit) return hit.id;
    const first = rows.find((r) => r.eligible);
    return first ? first.id : null;
  }

  /** 翻译字幕的目标语言里不该出现文稿自己的语言 */
  function targetLangs(langs, m) {
    const f = m ? facts(m) : null;
    const src = f && f.transcripts.length ? f.transcripts[f.transcripts.length - 1].lang : null;
    return (langs || []).filter((l) => l.code !== src);
  }

  /**
   * 写进已有视频时的说明；没有同类结果 → null。
   * 文稿：默认新建一部视频，选「取代这部视频的文稿」走换用文稿（product-design §5.11）；
   * 译文与配音：不覆盖、新增一份（§2.7「视频已有同类结果时不覆盖」）。
   * @param {{lang?}} o 翻译字幕 / 翻译配音的目标语言
   */
  function duplicateNote(tool, m, o) {
    if (!m) return null;
    const f = facts(m);
    const lang = o && o.lang;
    if (tool === 'transcribe' && f.transcripts.length) {
      return `这部视频已有${langsText(f.transcripts)}文稿。默认新建一部视频，这部视频和它的译文不动；选「取代这部视频的文稿」会换掉当前文稿，译文按原文配对结转、原文变了的标为过期，一笔可撤销。`;
    }
    if (tool === 'translate' && lang && f.translations.some((t) => t.lang === lang)) {
      return `这部视频已有${langLabel(lang)}译文。这次会新增一份，原来的保留，用哪一份在编辑器里选。`;
    }
    if (tool === 'dub' && lang && f.dubs.some((d) => d.lang === lang)) {
      return `这部视频已有${langLabel(lang)}配音。这次会新增一组，原来的保留。`;
    }
    return null;
  }

  /** 翻译配音能直接选用的译文：每份一项，标出来源文稿的语言 */
  function translationOptions(m) {
    if (!m) return [];
    const f = facts(m);
    const txLang = (id) => { const t = f.transcripts.find((x) => x.id === id); return t ? t.lang : null; };
    return f.translations.map((t, i) => {
      const same = f.translations.filter((x) => x.lang === t.lang);
      const nth = same.length > 1 ? ` 第 ${same.indexOf(t) + 1} 份` : '';
      const from = txLang(t.from);
      return {id: t.id, lang: t.lang, label: `${langLabel(t.lang)}译文${nth}`, sub: from ? `译自${langLabel(from)}文稿` : '', idx: i};
    });
  }

  /**
   * 把一份新结果写进视频的事实，返回新的 `docs`（记录本身不动）：
   * kind = transcripts / translations / dubs / layers；id 不给就按「视频-种类-序号」编一个。
   * `opt.mode = 'replace'`（只对文稿）：换用文稿（product-design §5.11）——同一份文稿的新版本取代第一份，
   * id 不变、`version` 加一、`edited` 清掉；译文随新版本结转（`from` 不变，句数照旧）。没有文稿时与追加一样。
   */
  function withDoc(m, kind, doc, opt) {
    const f = facts(m);
    const list = f[kind];
    if (!list) return null;
    const short = {transcripts: 'tx', translations: 'tr', dubs: 'dub', layers: 'sub'}[kind];
    const docsOf = () => ({transcripts: f.transcripts, translations: f.translations, dubs: f.dubs, layers: f.layers, pins: f.pins});
    if (opt && opt.mode === 'replace' && kind === 'transcripts' && list.length) {
      const old = list[0];
      const rec = Object.assign({}, old, doc, {id: old.id, version: (old.version || 1) + 1, edited: false});
      list[0] = rec;
      return {docs: docsOf(), doc: rec, replaced: old};
    }
    const rec = Object.assign({id: `${m.id}-${short}${list.length + 1}-new`}, doc);
    list.push(rec);
    return {docs: docsOf(), doc: rec};
  }

  /* ---------- 重新转录的落点（product-design §5.11、§2.7） ---------- */

  /** 用户改过原文没有（当前文稿全文指纹 ≠ `stages.asr`）：记录上 `transcriptEdited`，或某份文稿 `edited` */
  function edited(m) {
    if (!m) return false;
    if (m.transcriptEdited === true) return true;
    return facts(m).transcripts.some((t) => t.edited);
  }

  /**
   * 落点单选：视频已有文稿 → 新建视频（默认）/ 取代这部视频的文稿；没有文稿 → null（不显示落点，直接写进它）。
   * @returns {{options: Array<{k, label, note}>, value: 'new-video', edited: boolean}|null}
   */
  function retargetOptions(m) {
    if (!m) return null;
    const f = facts(m);
    if (!f.transcripts.length) return null;
    return {
      options: [
        {k: 'new-video', label: '新建视频', note: '同一项目里的新视频，链接同一份素材；这部视频和它的译文不动'},
        {k: 'replace', label: '取代这部视频的文稿', note: '换掉当前文稿，译文、字幕与配音在同一笔事务里结转，可以撤销'},
      ],
      value: 'new-video',
      edited: edited(m),
    };
  }

  /** 新建视频的默认名（可改） */
  const newVideoName = (m) => `${(m && m.title) || '视频'} · 重新转录`;

  const IMPACT_RULE = '原文没变的句子保留译文与审阅状态，对齐降为句级；原文变了或配不上的标为过期，转录完成后用「刷新过期译文」重译。具体几句在结果里报告。';

  /**
   * 选「取代」时的影响预览（product-design §5.11）：开跑前只报现有的数，算不出会过期几句。
   * @returns {{translations: Array<{lang, label, units, reviewed, line}>, pins, pinLine, dubs: Array<{lang, label, groups, line}>,
   *   edited, rule, undo}}
   */
  function replaceImpact(m) {
    const f = m ? facts(m) : {translations: [], dubs: [], pins: 0};
    const translations = f.translations.map((t) => ({lang: t.lang, label: langLabel(t.lang), units: t.units, reviewed: t.reviewed,
      line: `${langLabel(t.lang)} · ${t.units} 句${t.reviewed ? ` · 已审 ${t.reviewed} 句` : ''}`}));
    const groups = {};
    const order = [];
    f.dubs.forEach((d) => { if (!(d.lang in groups)) { groups[d.lang] = 0; order.push(d.lang); } groups[d.lang]++; });
    const dubs = order.map((lang) => ({lang, label: langLabel(lang), groups: groups[lang],
      line: `${langLabel(lang)} · ${groups[lang]} 组 · 句子译文不变的保留，标可能不一致`}));
    return {translations, pins: f.pins,
      pinLine: f.pins ? `${f.pins} 处手工换行 / 固定时间 · 按时间重新锚定，锚不上的标 orphaned` : null,
      dubs, edited: edited(m), rule: IMPACT_RULE, undo: '一笔事务，可以撤销'};
  }

  /* 演示的结转比例：原文没变、保留下来的约 88%；pin 锚不上的约 1/12 */
  const KEEP = 0.88;

  /**
   * 换用文稿之后的结转摘要（product-design §5.11 结果卡 / 任务摘要）。演示数据按比例给数。
   * `o.share`：局部重跑时范围占全篇的比例（0–1），只对范围内的句子配对，范围外的不算进来。
   * @returns {{translations: Array<{lang, label, kept, keptReviewed, stale, line}>, captionPins: {reanchored, orphaned},
   *   dubs: Array<{lang, label, kept, stale}>, lines: string[]}}
   */
  function carrySummary(m, o) {
    const f = m ? facts(m) : {translations: [], dubs: [], pins: 0};
    const share = o && o.share != null ? Math.max(0, Math.min(1, +o.share)) : 1;
    const scoped = (v) => Math.round((v || 0) * share);
    const dubBy = {};
    f.dubs.forEach((d) => { dubBy[d.lang] = d; });
    const translations = f.translations.map((t) => {
      const units = scoped(t.units);
      const kept = Math.round(units * KEEP);
      const keptReviewed = Math.min(kept, Math.round(scoped(t.reviewed) * (kept / (units || 1))));
      return {lang: t.lang, label: langLabel(t.lang), kept, keptReviewed, stale: units - kept};
    });
    const pinsN = scoped(f.pins);
    const orphaned = pinsN ? Math.max(1, Math.round(pinsN / 12)) : 0;
    const captionPins = {reanchored: pinsN - orphaned, orphaned};
    const dubs = Object.keys(dubBy).map((lang) => {
      const tr = translations.find((t) => t.lang === lang);
      const units = scoped(dubBy[lang].units || (tr ? tr.kept + tr.stale : 0));
      const kept = tr ? Math.min(units, tr.kept) : 0;
      return {lang, label: langLabel(lang), kept, stale: units - kept};
    });
    /* 字幕 pin 挂在字幕层上，不分语言：只在第一行报一次 */
    const lines = translations.map((t, i) => {
      const d = dubs.find((x) => x.lang === t.lang);
      return [`${t.label}：保留 ${t.kept} 句（已审 ${t.keptReviewed}）`, `过期 ${t.stale} 句`,
        pinsN && i === 0 ? `字幕 pin 重锚 ${captionPins.reanchored} / orphaned ${captionPins.orphaned}` : null,
        d ? `配音保留 ${d.kept}、过期 ${d.stale}` : null].filter(Boolean).join(' · ').replace('） · ', '）· ');
    });
    if (!translations.length && pinsN) lines.push(`字幕 pin 重锚 ${captionPins.reanchored} / orphaned ${captionPins.orphaned}`);
    translations.forEach((t, i) => { t.line = lines[i]; });
    return {translations, captionPins, dubs, lines};
  }

  root.BC_TOOL_TARGETS = {
    LABEL, langCode, langLabel, langsText, facts, tags, NEEDS, blockReason, candidates, pick, targetLangs,
    duplicateNote, translationOptions, withDoc,
    edited, retargetOptions, newVideoName, replaceImpact, carrySummary, IMPACT_RULE,
  };
})();
