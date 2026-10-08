/* 翻译配音的纯模型（2026-09-13 改版，§15.6）——向导、时长对比页、时间轴配音轨与导出声道共用。
   `model-tts.js`（BC_TTS）管引擎目录、语速库、按句合成的块；这一份管**围绕这些块的决定**：
   - 取向：音色优先（克隆本人原声念译文，跨语言会带口音）还是发音标准优先（目标语言的
     母语声音，地道但不像本人）——按引擎与语言算出每档能不能选、怎么实现；
   - 引擎能力：会念哪些语言、有没有预设音色、能不能克隆、有没有情绪 / 风格控制，表单随之增减；
   - 时长对比：每句原声时长 vs 译文按语速库预测的时长，差得远的交 AI 缩写或人工改；
   - 过程：合成到第几句、最近完成的几句、排队的几句，给运行态列表；
   - 块级管理：静音、删除、选中若干句重新生成；
   - 导出：多条配音时是「只带一条声道」还是「每种语言各一条」。
   不 import React、不碰 DOM；`node --test model-dub.test.js`。 */
(function () {
  const TTS = typeof window !== 'undefined' && window.BC_TTS ? window.BC_TTS
    : (typeof require === 'function' ? (global.window = global.window || {}, require('./model-tts.js'), global.window.BC_TTS) : null);
  const RD = typeof window !== 'undefined' && window.BC_READINGS ? window.BC_READINGS
    : (typeof require === 'function' ? require('./model-readings.js') : null);

  /* ---------- 取向 ---------- */
  const PRIORITY = [
    {id: 'voice', name: '音色优先', short: '像本人',
     desc: '克隆每位说话人的原声来念译文，听得出还是那个人；跨语言会带一点原语言口音'},
    {id: 'accent', name: '发音标准优先', short: '像母语',
     desc: '换成目标语言的母语声音，发音地道；听起来不再是本人，说话人之间靠不同声音区分'},
  ];
  /** Qwen3-TTS 预设音色的母语（0.6B 与 1.7B CustomVoice 同一张表）：日语 / 韩语各一位，其余中英双语 */
  const PRESET_NATIVE = {
    Vivian: ['zh', 'en'], Serena: ['zh', 'en'], Uncle_Fu: ['zh', 'en'], Dylan: ['zh', 'en'],
    Eric: ['zh', 'en'], Ryan: ['zh', 'en'], Aiden: ['zh', 'en'], Ono_Anna: ['ja'], Sohee: ['ko'],
  };
  const langCode = (v) => String(v || '').toLowerCase().split(/[-_]/)[0];

  /** 引擎能力卡：表单按它增减选项 */
  function capabilities(engine) {
    const e = (TTS.ENGINES.find((x) => x.id === engine)) || TTS.ENGINES[0];
    const presets = TTS.cloneOnly(e.id) ? [] : TTS.PRESETS.map((p) => Object.assign({}, p, {native: PRESET_NATIVE[p.id] || []}));
    return {
      id: e.id, name: e.name, langs: e.langs.slice(), clone: true, presets,
      // 风格：CustomVoice 的预设指令，或 VoxCPM2 的可控克隆（2026-09-26 起不再等于「有预设」）
      emotion: !!e.emotion, style: TTS.hasStyle(e.id),
      refText: e.id === 'gptsovits' || e.id === 'voxcpm2' || e.id === 'omnivoice',
      describe: !!e.models.describe, vocab: !!e.vocab,
      // 按目标时长合成（OmniVoice，每句最长 60 秒）：要压的句直接按目标长度出声，不事后加速
      duration: e.duration || 0, nonCommercial: !!e.nonCommercial,
    };
  }
  /** 能力一行：`会念 10 种语言 · 9 个预设音色 · 可克隆 · 一句话指定风格` */
  function capabilityLine(engine) {
    const c = capabilities(engine);
    const parts = [`会念 ${c.langs.length} 种语言`];
    parts.push(c.presets.length ? `${c.presets.length} 个预设音色` : '没有预设音色');
    parts.push('可克隆');
    if (c.emotion) parts.push('情绪可控');
    if (c.style) parts.push('一句话指定风格');
    if (c.describe) parts.push('可描述新声音');
    if (c.duration) parts.push('能按目标时长合成');
    if (c.nonCommercial) parts.push('仅限非商用');
    return parts.join(' · ');
  }
  /** 某种语言下这只引擎的预设：母语的排前面 */
  function presetsFor(engine, lang) {
    const l = langCode(lang);
    const all = capabilities(engine).presets;
    const native = all.filter((p) => p.native.indexOf(l) >= 0);
    const others = all.filter((p) => p.native.indexOf(l) < 0);
    return {native, others};
  }
  /** 「发音标准优先」怎么实现：有母语预设就用预设，其次用内置的母语参考；两样都没有、
   *  就任选一个预设，最后才要用户自己传一段。 */
  function accentSource(engine, lang) {
    const l = langCode(lang);
    const c = capabilities(engine);
    const ps = presetsFor(engine, l);
    if (ps.native.length) return {kind: 'preset', items: ps.native, how: `用 ${ps.native.map((p) => p.id).join(' / ')} 这${ps.native.length > 1 ? ps.native.length + ' 个' : '个'}母语预设`};
    const refs = (TTS.BUILTIN_REFS || []).filter((r) => langCode(r.lang) === l);
    if (refs.length) return {kind: 'ref', items: refs, how: `用内置的${refs.map((r) => r.label).join(' / ')}当母语参考`};
    // Qwen3-TTS 1.7B VoiceDesign 与 OmniVoice 的描述只在语音合成面板与工作台用，配音不走
    if (ps.others.length) return {kind: 'preset-any', items: ps.others, how: '没有这门语言的母语预设 · 任选一个预设，口音比克隆轻'};
    return {kind: 'upload', items: [], how: '需要一段这门语言的母语参考音频（5–10 秒）'};
  }
  /** 两档取向在当前引擎 × 语言下的可选性与实现方式 */
  function priorityOptions(engine, lang) {
    const speaks = TTS.engineSpeaks(engine, lang);
    const acc = accentSource(engine, lang);
    return PRIORITY.map((p) => {
      if (p.id === 'voice') return Object.assign({}, p, {available: speaks, how: '每位说话人取连续几整句（5–10 秒）当参考', source: {kind: 'clone'}});
      return Object.assign({}, p, {available: speaks, how: acc.how, source: acc, needsUpload: acc.kind === 'upload'});
    });
  }
  /** 取向 → 旧字段 strategy（clone / preset / upload），块与任务副题仍认它 */
  function strategyOf(priority, engine, lang) {
    if (priority !== 'accent') return 'clone';
    const acc = accentSource(engine, lang);
    return acc.kind === 'preset' || acc.kind === 'preset-any' ? 'preset' : 'upload';
  }
  /** 每位说话人默认分到的母语预设：男女声轮着来，不够就循环 */
  function assignPresets(engine, lang, speakerIds) {
    const acc = accentSource(engine, lang);
    const pool = (acc.kind === 'preset' || acc.kind === 'preset-any') ? acc.items : [];
    const out = {};
    (speakerIds || []).forEach((id, i) => { out[id] = pool.length ? pool[i % pool.length].id : null; });
    return out;
  }
  /** 声音一节的摘要：`音色优先 · 克隆 3 位说话人的原声` / `发音标准优先 · Ono_Anna 等母语预设` */
  function voiceSummary(r, speakerCount) {
    const p = PRIORITY.find((x) => x.id === r.priority) || PRIORITY[0];
    if (p.id === 'voice') return `${p.name} · 克隆 ${speakerCount} 位说话人的原声`;
    const acc = accentSource(r.engine, r.lang);
    if (acc.kind === 'ref') return `${p.name} · ${acc.items[0].label}当参考`;
    if (acc.kind === 'upload') return `${p.name} · ${r.ref ? r.ref.name : '还没给参考音频'}`;
    const used = Object.values(r.presets || {}).filter(Boolean);
    return `${p.name} · ${used.length ? used.slice(0, 2).join(' / ') + (used.length > 2 ? ' 等' : '') : acc.items[0].id} 预设`;
  }
  /** 引擎专属的「其他设置」：Qwen3 一句话风格；IndexTTS 情绪；GPT-SoVITS 参考原文。每项带 `default`，表单按 `r[key]` 读写。 */
  function extraSettings(engine) {
    const c = capabilities(engine);
    const out = [];
    if (c.style) out.push({key: 'style', label: '风格', kind: 'text', default: '', placeholder: '例如：沉稳、像纪录片旁白',
      hint: c.presets.length ? '一句话，留空就按参考音频的语气' : '一句话，留空就按参考音频的语气；写了风格就只取参考的音色（可控克隆），不再用参考原文'});
    if (c.emotion) out.push({key: 'emotion', label: '情绪', kind: 'segmented', default: 'follow', items: [{k: 'follow', label: '跟原声'}, {k: 'neutral', label: '平稳'}], hint: '跟原声：每句从原声里估情绪；平稳：全程中性'});
    if (c.refText) out.push({key: 'refText', label: '参考原文', kind: 'note', hint: '克隆时连同参考句的原文一起喂给模型，更像本人'});
    // 按目标时长合成（OmniVoice）的说明不在这里：它画在「更多设置 › 时长」那一节，挨着「超长时」策略（panel-dub-setup.jsx）
    return out;
  }
  /** 取向是否就绪：发音标准优先 + 需上传参考时得有参考 */
  function voiceReady(r) {
    if (r.priority !== 'accent') return true;
    const acc = accentSource(r.engine, r.lang);
    return acc.kind !== 'upload' || (!!r.ref && !refTextMissing(r));
  }
  /** 上传的母语参考缺原文：OmniVoice 不带原文会吞掉每句开头（内核 `ref-text-required` 同样拦） */
  const refTextMissing = (r) => !!r.ref && TTS.refTextRequired(r.engine) && !String(r.refText || '').trim();

  /* ---------- 设置页（2026-09-16 改版）：自动选引擎、模型门、人话摘要、开始前的阻碍 ---------- */
  /** 目标语言 + 取向 → 该用哪只引擎。会念这门语言的引擎里，这种取向要的模型**已经装好的排前面**
   *  （按候选次序取第一只）；都没装就按候选次序取第一只会念的。返回 {engine, installed, model, speaks}。
   *  候选次序 = 引擎表次序，但 **IndexTTS2 排最前**（D2 裁决，2026-09-23，`docs/design/speech/bcut-tts-pace-stability.md`：
   *  语速最稳且零错字，与 `bcut tts` 1.173.0 起的中英文缺省同一只）。它只会中英，别的语言照旧表头 Qwen3-TTS；
   *  「已装优先」不变——装了 Qwen3 没装 IndexTTS2 时仍用 Qwen3，不为缺省逼人下 3.7 GB。 */
  const PREFERRED_ENGINE = 'indextts2';
  function pickEngine(o) {
    const opt = o || {};
    const installed = opt.installed || (() => false);
    const cands = TTS.ENGINES.filter((e) => TTS.engineSpeaks(e.id, opt.lang))
      .sort((a, b) => (b.id === PREFERRED_ENGINE) - (a.id === PREFERRED_ENGINE));   // 稳定排序：只把它提到最前
    if (!cands.length) return {engine: TTS.ENGINES[0].id, installed: false, model: null, speaks: false};
    const need = (e) => modelNeeded({engine: e.id, lang: opt.lang, priority: opt.priority || 'voice'});
    const hit = cands.find((e) => installed(need(e)));
    const e = hit || cands[0];
    return {engine: e.id, installed: !!hit, model: need(e), speaks: true};
  }
  /** 这份设置要的 TTS 模型 id（取向 × 引擎 × 语言） */
  function modelNeeded(r) {
    const st = strategyOf(r.priority, r.engine, r.lang);
    return TTS.modelFor(r.engine, st === 'preset' ? st : 'clone');
  }
  /* ---------- 在哪儿跑（远端配音） ---------- */
  /** 这台已配对节点此刻报得出这只 TTS 模型吗。`ttsModels` 缺席（还没扫过配音模型的
   *  旧节点）答否——宁可不给选，也不要开跑才失败。 */
  function nodeRunsModel(nodes, alias, model) {
    return (nodes || []).some((n) => n.id === alias && n.state !== 'offline'
      && Array.isArray(n.ttsModels) && n.ttsModels.indexOf(model) >= 0);
  }
  /** 「在哪儿跑」的候选机器（本机不在内）：非 offline 且报得出这只模型的节点。
   *  一台都没有时那一行整行不画。 */
  function dubNodes(nodes, model) {
    return (nodes || []).filter((n) => n.state !== 'offline'
      && Array.isArray(n.ttsModels) && n.ttsModels.indexOf(model) >= 0);
  }
  /** 选中的那台节点也开放人声分离吗（远端任务 J2）：非 offline、`tasks` 含 `separate`、
   *  `taskModels.separate` 里有 HTDemucs-FT。没报 `tasks` 的旧节点答否——分离留在本机。 */
  function nodeSeparates(nodes, alias) {
    return !!alias && (nodes || []).some((n) => n.id === alias && n.state !== 'offline'
      && Array.isArray(n.tasks) && n.tasks.indexOf('separate') >= 0
      && n.taskModels && Array.isArray(n.taskModels.separate) && n.taskModels.separate.indexOf('htdemucs-ft') >= 0);
  }
  /** 「在哪儿跑」选了节点后的旁注：分离开着时说清它跟没跟过去。 */
  function nodeHint(o) {
    const opt = o || {};
    if (!opt.separate) return '合成在那台机器上跑、音频经局域网传回，本机不需要装这只模型';
    return opt.remoteSeparate
      ? '人声分离与合成都在那台机器上跑、音频经局域网传回，本机不需要装这两只模型'
      : '合成在那台机器上跑、音频经局域网传回；那台机器没开放人声分离，分离仍在这台 Mac 上跑';
  }
  /** 按钮下那一行开头：`全程在本机` / `合成在 X 上跑` / `合成与人声分离在 X 上跑`。 */
  function whereLine(o) {
    const opt = o || {};
    if (!opt.nodeName) return '全程在本机';
    return (opt.separate && opt.remoteSeparate ? '合成与人声分离在 ' : '合成在 ') + opt.nodeName + ' 上跑';
  }
  /** 真正交给引擎的模型 id：选了别的机器就是 `remote:<alias>/<model>`。模型 id 本身
   *  不变——门检查、下载卡、语速库看的还是裸 id，机器只决定它在哪儿跑。 */
  function runtimeModel(model, alias) {
    return alias ? 'remote:' + alias + '/' + model : model;
  }

  const mbLabel = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' GB' : Math.round(n) + ' MB');
  /** 模型门：还没装的模型（TTS 那只 + 开着分离时的 HTDemucs），一张卡、一颗「下载 x GB」。
   *  返回 {list: [{id, name, size}], ids, size, sizeLabel}；`catalog` 是设置页那份本地模型表。
   *  `opt.remote` 为真表示这只 TTS 跑在别人机器上（选了「在哪儿跑」里的节点），它不进门；
   *  `opt.remoteSeparate` 为真表示那台节点也接人声分离（`nodeSeparates`），HTDemucs 也不进门，
   *  否则分离留在本机跑，那一只照算。 */
  function missingModels(r, o) {
    const opt = o || {};
    const installed = opt.installed || (() => false);
    const cat = opt.catalog || [];
    const ids = opt.remote ? [] : [modelNeeded(r)];
    if (r.separate !== false && !opt.locked && !(opt.remote && opt.remoteSeparate)) ids.push('htdemucs-ft');
    const list = ids.filter((id) => !installed(id)).map((id) => cat.find((m) => m.id === id) || {id, name: id, size: 0});
    const size = list.reduce((n, m) => n + (m.size || 0), 0);
    return {list, ids: list.map((m) => m.id), size, sizeLabel: mbLabel(size)};
  }
  /** 已装的替代引擎：同一取向、同一语言下另一只模型已经装好的；挑不到给 null */
  function installedAlternative(r, installed) {
    const ok = installed || (() => false);
    const e = TTS.ENGINES.filter((x) => x.id !== r.engine && TTS.engineSpeaks(x.id, r.lang))
      .find((x) => ok(modelNeeded({engine: x.id, lang: r.lang, priority: r.priority})));
    return e ? {engine: e.id, name: e.name} : null;
  }
  /** 设置页第一句人话：`用 Qwen3-TTS 0.6B 克隆 3 位说话人的原声，把 62 句配成 English`；
   *  没译文的写「先翻译再配」，只重配几句的写「重新生成这 3 句」。 */
  function stepLine(r, o) {
    const opt = o || {};
    const eng = TTS.engineName(r.engine);
    const n = opt.count || 0;
    const voice = r.priority === 'voice'
      ? `克隆 ${opt.speakers || 0} 位说话人的原声`
      : '换成母语声音';
    if (opt.locked) return `用 ${eng} ${voice}，重新生成这 ${n} 句`;
    const ln = opt.ln || opt.langName || r.lang;   // 中英之间留一格（` English`）
    const tail = `把 ${n} 句配成${ln}`;
    return opt.needTranslate ? `先把 ${n} 句翻成${ln}，再用 ${eng} ${voice}配音` : `用 ${eng} ${voice}，${tail}`;
  }
  /** 主按钮：`配成 English · 62 句` / `翻译并配成日本語 · 62 句` / `对比时长并配成…`；缺模型时前面加「下载模型并」 */
  function ctaLabel(o) {
    const opt = o || {};
    if (opt.locked) return `重新生成这 ${opt.count} 句`;
    const ln = opt.ln || opt.langName || '';
    const core = opt.needTranslate ? `翻译并配成${ln} · ${opt.count} 句` : opt.review ? `对比时长再配成${ln}` : `配成${ln} · ${opt.count} 句`;
    return opt.download ? `下载模型并${core}` : core;
  }
  /** 开始前的阻碍（按顺序只报第一条）：没文稿 / 引擎不会念 / 描述空 / 没参考。主按钮不置灰，
   *  按下时 toast 这一条；设置页也把它写在按钮上方。没有阻碍返回 null。 */
  function startProblem(r, o) {
    const opt = o || {};
    if (!opt.count) return '还没有文稿 · 先转录，转好回到这里就能配';
    if (!TTS.engineSpeaks(r.engine, r.lang)) return `${TTS.engineName(r.engine)} 不会念${opt.langName || r.lang} · 换一只引擎`;
    if (r.priority === 'accent') {
      const acc = accentSource(r.engine, r.lang);
      if (acc.kind === 'upload' && !r.ref) return `先给一段 5–10 秒的${opt.langName || r.lang}母语录音当参考`;
      if (acc.kind === 'upload' && refTextMissing(r)) return `先写上参考录音的原文 · ${TTS.engineName(r.engine)} 不带原文会吞掉每句开头`;
    }
    return null;
  }
  /** 语言那一行下面的一句：`English 已有译文 · 直接配` / `日本語 还没有译文 · 会先翻译，译文轨也留下` / 已配过的写「这次会替换」 */
  function langLine(o) {
    const opt = o || {};
    const same = (opt.dubs || []).some((d) => langCode(d.lang) === langCode(opt.lang));
    const base = opt.translated ? `${opt.langName} 已有译文 · 直接配` : `${opt.langName} 还没有译文 · 会先翻译，译文轨也留下`;
    return same ? `${base} · 已有「配音 · ${opt.langName}」，这次写回同一条轨` : base;
  }

  /* ---------- 时长对比 ---------- */
  /** 每句：原声时长 vs 译文预测时长。`ratio` = 预测 / 原声槽位；`level` 沿用 fitPlan
   *  （ok / tight / over / retranslate，按可借到下一句前的上限算），另标 `short`（不到六成，配出来会空一截）。 */
  function compareRows(cues, o) {
    const plan = TTS.fitPlan(cues, o);
    const rows = plan.rows.map((r) => {
      const src = +(r.end - r.start).toFixed(2);
      const pred = +((r.units / Math.max(1, plan.pace.perMin.median)) * 60).toFixed(2);
      const ratio = +(pred / Math.max(0.1, src)).toFixed(2);
      return Object.assign({}, r, {srcDur: src, predDur: pred, ratio, delta: +(pred - src).toFixed(2), short: ratio < 0.6});
    });
    return Object.assign({}, plan, {rows});
  }
  /** 对比汇总：总时长、整体比例、要处理的句数 */
  function compareSummary(plan) {
    const rows = plan.rows || [];
    const srcTotal = rows.reduce((n, r) => n + r.srcDur, 0);
    const predTotal = rows.reduce((n, r) => n + r.predDur, 0);
    const need = rows.filter((r) => r.level === 'over' || r.level === 'retranslate').length;
    const short = rows.filter((r) => r.short).length;
    return {total: rows.length, srcTotal: +srcTotal.toFixed(1), predTotal: +predTotal.toFixed(1),
      ratio: +(predTotal / Math.max(0.1, srcTotal)).toFixed(2), need, short, ok: rows.length - need};
  }
  /** 对比条的宽度：两条都按同一把尺（这句里较长的那个撑满） */
  function barWidths(row) {
    const max = Math.max(row.srcDur, row.predDur, 0.1);
    return {src: +((row.srcDur / max) * 100).toFixed(1), pred: +((row.predDur / max) * 100).toFixed(1)};
  }
  /** 汇总一行：`译文预计 3 分 12 秒 · 比原声长 14% · 6 句装不下` */
  function compareLine(sum) {
    const pct = Math.round((sum.ratio - 1) * 100);
    const rel = Math.abs(pct) < 3 ? '与原声相当' : pct > 0 ? `比原声长 ${pct}%` : `比原声短 ${-pct}%`;
    const parts = [`译文预计 ${mmss(sum.predTotal)}`, rel];
    if (sum.need) parts.push(`${sum.need} 句装不下`);
    if (sum.short) parts.push(`${sum.short} 句偏短`);
    return parts.join(' · ');
  }
  function mmss(s) {
    const t = Math.max(0, Math.round(s || 0));
    const m = Math.floor(t / 60), r = t % 60;
    return m ? `${m} 分 ${r} 秒` : `${r} 秒`;
  }

  /* ---------- 过程 ---------- */
  /** 合成阶段在总进度里占的区间：按 BC_TTS 的阶段表权重算（翻译 20 · 分离 30 · 合成 55 · 对齐 10 · 写轨 5，
   *  只出现的阶段归一到 100），与 `dubPhase` 的分段一致。 */
  const STAGE_W = {'翻译字幕': 20, '分离人声与背景': 30, '逐句合成': 55, '时间对齐': 10, '写入时间轴': 5};
  function synthSpan(o) {
    const labels = TTS.dubStages(o || {});
    const total = labels.reduce((n, l) => n + (STAGE_W[l] || 0), 0) || 100;
    let acc = 0;
    for (let i = 0; i < labels.length; i++) {
      const w = ((STAGE_W[labels[i]] || 0) / total) * 100;
      if (labels[i] === '逐句合成') return {from: +acc.toFixed(1), to: +(acc + w).toFixed(1)};
      acc += w;
    }
    return {from: 0, to: 100};
  }
  /** 进度 → 正在合成第几句（0 起）；合成还没开始返回 -1，合成完返回 n */
  function sentenceAt(pct, n, span) {
    const sp = span || synthSpan();
    if (!n) return -1;
    if (pct < sp.from) return -1;
    if (pct >= sp.to) return n;
    return Math.min(n - 1, Math.floor(((pct - sp.from) / (sp.to - sp.from)) * n));
  }
  /** 运行态的逐句列表：最近做完的 `before` 句 + 当前句 + 排队的 `after` 句。
   *  `failed` 是演示里会失败的句 id 集合（合成过了就标失败）。 */
  function runLog(cues, pct, o) {
    const opt = o || {};
    const list = cues || [];
    const n = list.length;
    const cur = sentenceAt(pct, n, opt.span || synthSpan(opt));
    const before = opt.before == null ? 3 : opt.before;
    const after = opt.after == null ? 2 : opt.after;
    const failed = opt.failed || {};
    const from = Math.max(0, cur - before);
    const to = Math.min(n, cur + 1 + after);
    const items = [];
    for (let i = from; i < to; i++) {
      const c = list[i];
      const state = i < cur ? (failed[c.id] ? 'failed' : 'done') : i === cur ? 'running' : 'queued';
      items.push({id: c.id, i, start: c.start, text: c.trans || c.text || '', state});
    }
    return {total: n, done: Math.max(0, Math.min(n, cur)), cur, items,
      stage: cur < 0 ? 'before' : cur >= n ? 'after' : 'synth'};
  }

  /* ---------- 块级管理 ---------- */
  const idSet = (ids) => { const s = {}; (ids || []).forEach((id) => { s[id] = true; }); return s; };
  function muteBlocks(blocks, ids, on) {
    const set = idSet(ids);
    return (blocks || []).map((b) => (set[b.id] ? Object.assign({}, b, {muted: !!on}) : b));
  }
  function deleteBlocks(blocks, ids) {
    const set = idSet(ids);
    return (blocks || []).filter((b) => !set[b.id]);
  }
  /** 排队重新生成：块留在原位，状态转 queued（轨上画成待合成） */
  function queueRegen(blocks, ids) {
    const set = idSet(ids);
    return (blocks || []).map((b) => (set[b.id] ? Object.assign({}, b, {status: 'queued'}) : b));
  }
  /** 重新生成完成：按（可能改过的）译文重新估时长、按策略重排这一块；手动拉伸作废。
   *  每次重新生成都记成新的一**版**（`takes[]` 多一条、`take` 指向它），上一版留着（归档，§版）；
   *  `opt.take` 是这一版用的参数 {model, engine, seed}，缺省沿用组（`opt.group`）的。 */
  function regenerate(blocks, ids, o) {
    const opt = o || {};
    const set = idSet(ids);
    const policy = opt.fit || 'compress';
    const g = opt.group || {};
    return (blocks || []).map((b) => {
      if (!set[b.id]) return b;
      // 配音稿里这句带着注记就用它；没有稿（旁白组）就把块上存的注记渲回去，重新生成不丢读音
      const raw = opt.script && opt.script[b.id] != null ? String(opt.script[b.id]) : RD.render(b.text, b.readings);
      const prev = takesOf(b, g);
      const k = prev.reduce((m, t) => Math.max(m, t.k), 0) + 1;
      const p = opt.take || {};
      const model = p.model || groupModel(g);
      const rd = RD.forEngine(raw, p.engine || engineOfModel(model, g.engine));
      const text = rd.text;
      const seed = p.seed != null ? p.seed : demoSeed(b.id, k);
      const synth = opt.synthDur ? opt.synthDur(b, text) : demoSynth(text, seed, model);
      const slot = b.slotEnd - b.start;
      const limit = b.limitEnd - b.start;
      const f = TTS.fitSentence(synth, slot, policy, limit);
      const take = {k, seed, model, engine: p.engine || engineOfModel(model, g.engine), synth: +Math.max(0.1, synth).toFixed(2),
        perMin: perMinOf(text, synth, groupLang(g)), at: opt.now || 0,
        ...(rd.readings.length ? {readings: rd.readings, readingsDropped: rd.dropped} : {})};
      return Object.assign({}, b, {text, synth: take.synth, end: +(b.start + f.dur).toFixed(2),
        rate: f.rate, overrun: f.overrun, fast: f.fast, cut: f.cut, status: 'done', manual: false,
        takes: prev.concat([take]), take: k, readings: rd.readings.length ? rd.readings : undefined,
        readingsDropped: rd.readings.length ? rd.dropped : undefined});
    });
  }

  /* ---------- 版（takes，2026-09-23，docs/design/speech/bcut-tts-sentence-takes-design.md） ----------
     一句合成过的每一版一个文件、一份侧车（model / engine / seed / 语速），时间轴元素只指向**当前版**；
     同一句其余的版就是「归档」——归档不是另一张表，是「没被引用的版」。这里只算：一句有哪些版、
     当前是哪一版、换回一版块怎么变、归档组长什么样、语速离整条基准多远。数值都是确定性的演示值。 */
  /** 模型 id → 它属于哪只引擎（`ENGINES[].models` 反查），认不出落到组的引擎 */
  function engineOfModel(model, fallback) {
    const hit = TTS.ENGINES.find((e) => Object.keys(e.models || {}).some((k) => e.models[k] === model));
    return hit ? hit.id : (fallback || TTS.ENGINES[0].id);
  }
  const fnv = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  /** 演示用的确定性种子：按句 id 与版号派生（App 里是 run 种子 → `retry_seed`），落在 1000–9999 */
  function demoSeed(id, k) { return 1000 + (fnv(id + ':' + (k || 1)) % 9000); }
  /** 演示用的合成时长：估算值 ± 最多 12%，按种子与模型确定地抖——同一颗种子同一只模型永远同一个数 */
  function demoSynth(text, seed, model) {
    const base = TTS.estimateDuration(text);
    const j = ((fnv(String(seed) + '|' + (model || '')) % 2401) / 2400) * 0.24 - 0.12;
    return +Math.max(0.1, base * (1 + j)).toFixed(2);
  }
  /** 一句念了多少字 / 词一分钟（CLI `pace.perMin` 的口径：单位数 / 秒 × 60） */
  function perMinOf(text, synth, lang) {
    // 文字与语言的单位对不上（演示项目里译文缺席、块上还是原文）就按文字自己的书写系统数
    const units = TTS.countUnits(text, lang) || TTS.countUnits(text, TTS.paceUnit(lang) === 'char' ? 'en' : 'zh');
    return synth > 0 && units > 0 ? +((units / synth) * 60).toFixed(1) : null;
  }
  /** 组用的模型：设置页选的引擎 × 取向要的那只（`modelNeeded`），显式 `d.model` 优先 */
  function groupModel(d) {
    const g = d || {};
    if (g.model) return g.model;
    return modelNeeded({engine: g.engine || 'qwen3', lang: g.lang || 'en', priority: g.priority || 'voice'});
  }
  /** 一句的版列表（按版号升序）。没合成出来的句没有版；旧块（没有 `takes`）按组的模型补一条「第 1 版」——
   *  这是块当前状态的**视图**，不改块本身 */
  function takesOf(b, d) {
    if (!b || b.status === 'failed') return [];
    if (Array.isArray(b.takes) && b.takes.length) return b.takes.slice().sort((x, y) => x.k - y.k);
    const g = d || {};
    const model = groupModel(g);
    return [{k: 1, seed: demoSeed(b.id, 1), model, engine: engineOfModel(model, g.engine),
      synth: b.synth, perMin: perMinOf(b.text, b.synth, groupLang(g)), at: 0,
      ...(b.readings && b.readings.length ? {readings: b.readings, readingsDropped: b.readingsDropped || []} : {})}];
  }
  /** 当前版号（`take` 缺席就是最新的一版） */
  function activeK(b, d) {
    const list = takesOf(b, d);
    if (!list.length) return 0;
    return b.take && list.some((t) => t.k === b.take) ? b.take : list[list.length - 1].k;
  }
  function activeTake(b, d) { const k = activeK(b, d); return takesOf(b, d).find((t) => t.k === k) || null; }
  /** 一句的归档版：当前版以外的 */
  function archivedTakes(b, d) { const k = activeK(b, d); return takesOf(b, d).filter((t) => t.k !== k); }
  /** 句序（按开口时间，1 起）与总句数：属性页页头 `第 12 / 62 句`、文件名 `s-12` */
  function sentenceIndex(blocks, id) {
    const list = (blocks || []).slice().sort((a, b) => a.start - b.start);
    const i = list.findIndex((b) => b.id === id);
    return {i: i + 1, n: list.length};
  }
  /** 一版的文件名：`s-12.t3.wav`（版号只增不复用） */
  function takeFile(seq, k) { return `s-${seq}.t${k}.wav`; }
  /** 整组的语速基准：与组同一只模型的各句当前版取 `perMin` 中位数（CLI 的 `<清单>.pace.json` 同一把尺）；
   *  一句都没有返回 null */
  function paceReference(blocks, d) {
    const model = groupModel(d);
    const vals = (blocks || []).map((b) => activeTake(b, d)).filter((t) => t && t.model === model && t.perMin > 0).map((t) => t.perMin).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 ? vals[mid] : +((vals[mid - 1] + vals[mid]) / 2).toFixed(1);
    return {model, perMin: median, from: vals.length};
  }
  const PACE_TOL = 0.10;
  /** 一版离基准多远：模型不同或没有基准就 null（「不比整条基准」） */
  function paceRatio(take, ref) {
    if (!take || !ref || !take.perMin || take.model !== ref.model) return null;
    return +(take.perMin / ref.perMin).toFixed(3);
  }
  const isOutlier = (ratio) => ratio != null && Math.abs(Math.log(ratio)) > Math.log(1 + PACE_TOL);
  /** 语速一行：`237 字/分 · 比整条基准快 12%` / `… · 与整条基准相当` / `237 字/分 · 不比整条基准`；`outlier` 超过 ±10% */
  function paceText(take, ref, lang) {
    if (!take || !take.perMin) return {text: '没量到语速', outlier: false, ratio: null};
    const unit = TTS.unitName(TTS.paceUnit(lang));
    const ratio = paceRatio(take, ref);
    const head = `${take.perMin} ${unit}/分`;
    if (ratio == null) return {text: `${head} · 不比整条基准`, outlier: false, ratio: null};
    const pct = Math.round((ratio - 1) * 100);
    const rel = Math.abs(pct) < 3 ? '与整条基准相当' : pct > 0 ? `比整条基准快 ${pct}%` : `比整条基准慢 ${-pct}%`;
    return {text: `${head} · ${rel}`, outlier: isOutlier(ratio), ratio};
  }
  /** 偏差短写：`快 12%` / `慢 8%` / `相当`；不可比给空串 */
  function deviationShort(take, ref) {
    const ratio = paceRatio(take, ref);
    if (ratio == null) return '';
    const pct = Math.round((ratio - 1) * 100);
    return Math.abs(pct) < 3 ? '相当' : pct > 0 ? `快 ${pct}%` : `慢 ${-pct}%`;
  }
  /** 版的一行：`第 2 版 · 种子 1042 · IndexTTS2 · 2.4 s · 快 12%` */
  function versionLine(take, o) {
    const opt = o || {};
    const parts = [`第 ${take.k} 版`, `种子 ${take.seed}`, TTS.engineFamily(take.engine), `${take.synth.toFixed(1)} s`];
    const dev = deviationShort(take, opt.ref);
    if (dev) parts.push(dev);
    return parts.join(' · ');
  }
  /** 这一句当前版用的模型与组不同 */
  function modelMismatch(b, d) {
    const t = activeTake(b, d);
    return !!t && t.model !== groupModel(d);
  }
  function mismatchCount(blocks, d) { return (blocks || []).filter((b) => modelMismatch(b, d)).length; }
  /** 换回一版：`take` 指向它、块按那一版的合成时长重排（手动拉伸作废）；不合成、不新增版 */
  function restoreTake(blocks, id, k, o) {
    const opt = o || {};
    const policy = opt.fit || 'compress';
    return (blocks || []).map((b) => {
      if (b.id !== id) return b;
      const take = takesOf(b, opt.group).find((t) => t.k === k);
      if (!take) return b;
      const f = TTS.fitSentence(take.synth, b.slotEnd - b.start, policy, b.limitEnd - b.start);
      return Object.assign({}, b, {take: k, takes: takesOf(b, opt.group), synth: take.synth, end: +(b.start + f.dur).toFixed(2),
        rate: f.rate, overrun: f.overrun, fast: f.fast, cut: f.cut, status: 'done', manual: false,
        readings: take.readings, readingsDropped: take.readingsDropped});
    });
  }
  /** 只保留每句最近 n 版（当前版永远保留，其余按版号从新到旧留 n−1 版） */
  function keepLatest(blocks, n, d) {
    const keep = Math.max(1, n || 1);
    return (blocks || []).map((b) => {
      const list = takesOf(b, d);
      if (list.length <= keep) return b;
      const k = activeK(b, d);
      const others = list.filter((t) => t.k !== k).sort((x, y) => y.k - x.k).slice(0, keep - 1);
      return Object.assign({}, b, {takes: list.filter((t) => t.k === k || others.some((x) => x.k === t.k)), take: k});
    });
  }
  /** 清空归档：每句只剩当前版 */
  function clearArchive(blocks, d) { return keepLatest(blocks, 1, d); }
  /** 归档的字节：演示按 48 kHz · 单声道 · 16 bit（96 KB/s） */
  const BYTES_PER_SECOND = 96000;
  function sizeLabel(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }
  /** 归档组的形状：按语言分小段，每行一版 {id, seq, k, text, take, line}；没有归档版时 `groups` 为空 */
  function archiveShape(dubs, o) {
    const opt = o || {};
    const groups = [];
    let total = 0, seconds = 0;
    (dubs || []).forEach((d) => {
      const ref = paceReference(d.blocks, d);
      const rows = [];
      (d.blocks || []).slice().sort((a, b) => a.start - b.start).forEach((b, i) => {
        archivedTakes(b, d).sort((x, y) => y.k - x.k).forEach((t) => {
          rows.push({id: b.id, lang: d.lang, seq: i + 1, k: t.k, text: b.text || '', take: t, file: takeFile(i + 1, t.k), line: versionLine(t, {ref})});
          seconds += t.synth || 0;
        });
      });
      if (!rows.length) return;
      total += rows.length;
      groups.push({lang: d.lang, langName: d.langName || d.lang, rows});
    });
    const bytes = Math.round(seconds * BYTES_PER_SECOND);
    const line = groups.length ? [`${total} 个旧版本`, `${groups.length} 种语言`, sizeLabel(bytes)].join(' · ') : '';
    return {groups, total, langs: groups.length, bytes, line, keep: opt.keep || 3};
  }
  /** 归档里一共多少版（组头副题用） */
  function archivedCount(blocks, d) { return (blocks || []).reduce((n, b) => n + archivedTakes(b, d).length, 0); }

  /* ---------- 所有 TTS 组一个规矩（2026-09-23 补充） ----------
     时间轴上每一条 TTS 轨都是一个**组**：翻译配音是 `role: 'dub'`（一种语言一组，`lang` 就是组键），
     生成语音 / 手绘旁白是 `role: 'narration'`（组键 `vo<n>`、轨 `dub:vo<n>`，与 App 同形——组键会进音源 id `dub-vo1-<sid>`，不带冒号；`langCode` 才是念的语言，`langName` 是标题）。
     组可以有多条——旁白组不互斥、也不参与「一次只听一种配音」的音源切换；逐句属性页、版与归档对所有组一样。 */
  const isNarration = (d) => !!d && d.role === 'narration';
  /** 组念的语言（旁白组的 `lang` 是组键，不是语言） */
  const groupLang = (d) => (d && (d.langCode || d.lang)) || 'en';
  /** 行头小牌：语言牌；旁白组语言认不出时写 VO */
  function groupBadge(d, badgeOf) {
    const b = badgeOf ? badgeOf(groupLang(d)) : null;
    return b || (isNarration(d) ? 'VO' : '配音');
  }
  /** 组名：`配音 · English` / `旁白 · 开场`；一角色一轨的旁白组（剧情短片，`tts --batch` 的 cast）是 `旁白 · vo/sea` */
  function groupTitle(d) { return `${isNarration(d) ? '旁白' : '配音'} · ${(d && (d.langName || d.lang)) || ''}`; }
  /** 「角色」那一格：`sea · 低沉、缓慢`；清单没写风格只有角色名；不是一角色一轨的组是 null */
  function roleText(d) {
    if (!d || !d.who) return null;
    const style = String(d.style || '').trim();
    return style ? `${d.who} · ${style}` : d.who;
  }
  const NARRATION_GAP = 0.35;   // 旁白句与句之间的停顿（秒）
  /** 生成语音的一段文字按句落成一条旁白轨：从 `at` 起顺序排，每句槽位 = 自己的合成时长（不压不截），
   *  重新生成变长就把后面的句顺延（`reflowNarration`）。 */
  function narrationGroup(f, seq, o) {
    const opt = o || {};
    const segs = TTS.segments(RD.formText(f));          // 按过「注音」的表单：chip 行的读音渲进文字再切句
    // 「自动」：汉字 / 假名个数对英文词数，多者定中英（同 App `narration::resolve_lang`）
    const cjk = (String(f.text || '').match(/[぀-ヿ㐀-鿿豈-﫿]/g) || []).length;
    const lang = f.lang && f.lang !== 'auto' ? f.lang : (cjk > TTS.countUnits(f.text, 'en') ? 'zh' : 'en');
    const model = TTS.modelFor(f.engine, f.mode);
    let t = +(opt.at || 0);
    const blocks = segs.map((raw, i) => {
      const rd = RD.forEngine(raw, f.engine);          // 生成语音的文字可以带注记：块上存表面文字，注记单列
      const text = rd.text;
      const synth = TTS.estimateDuration(text) || 0.1;
      const b = {id: `n${seq}-${i + 1}`, start: +t.toFixed(2), end: +(t + synth).toFixed(2), slotEnd: +(t + synth).toFixed(2), limitEnd: +(t + synth + NARRATION_GAP).toFixed(2),
        sp: null, hue: TTS.speakerHue(0), text, synth: +synth.toFixed(2), rate: 1, overrun: false, fast: false, cut: false, status: 'done',
        ...(rd.readings.length ? {readings: rd.readings, readingsDropped: rd.dropped} : {})};
      t += synth + NARRATION_GAP;
      return b;
    });
    // 一个角色一条轨（`opt.who`，剧情短片的 cast 清单）：组名是 `vo/<who>`，角色的说话风格随组带着
    const who = opt.who ? String(opt.who) : null;
    const title = who ? `vo/${who}` : opt.title || (blocks[0] ? blocks[0].text : '').slice(0, 12) || `第 ${seq} 段`;
    return {role: 'narration', lang: `vo${seq}`, langCode: lang, langName: title, ...(who ? {who, style: opt.style || null} : {}), engine: f.engine, engineName: TTS.engineFamily(f.engine), model,
      priority: 'voice', fit: 'fixed', bed: false, original: 'keep', blocks, trackId: `dub:vo${seq}`, tts: Object.assign({}, f)};
  }
  /** 旁白轨的重排：每句槽位跟着自己的合成时长走，后面的句顺延，保持句间停顿 */
  function reflowNarration(blocks) {
    const list = (blocks || []).slice().sort((a, b) => a.start - b.start);
    let t = list.length ? list[0].start : 0;
    return list.map((b) => {
      const dur = b.manual ? b.end - b.start : b.synth;
      const nb = Object.assign({}, b, {start: +t.toFixed(2), end: +(t + dur).toFixed(2), slotEnd: +(t + b.synth).toFixed(2), limitEnd: +(t + b.synth + NARRATION_GAP).toFixed(2)});
      t += dur + NARRATION_GAP;
      return nb;
    });
  }
  /** shift 连选：锚点到这一块之间（按 start 排）的全部块 id */
  function rangeIds(blocks, anchorId, id) {
    const list = (blocks || []).slice().sort((a, b) => a.start - b.start);
    const a = list.findIndex((b) => b.id === anchorId);
    const z = list.findIndex((b) => b.id === id);
    if (a < 0 || z < 0) return z >= 0 ? [id] : [];
    const [lo, hi] = a < z ? [a, z] : [z, a];
    return list.slice(lo, hi + 1).map((b) => b.id);
  }
  /** 点选 / 追加 / 连选后的选中集 */
  function pickIds(cur, blocks, id, mod) {
    const m = mod || {};
    const ids = (cur || []).slice();
    if (m.shift && ids.length) {
      const anchor = ids[0];
      const range = rangeIds(blocks, anchor, id);
      return range.filter((x) => x === anchor).concat(range.filter((x) => x !== anchor));
    }
    if (m.meta) return ids.indexOf(id) >= 0 ? ids.filter((x) => x !== id) : ids.concat([id]);
    return [id];
  }
  /** 一条配音轨的计数：总句、静音、失败、过快、排队 */
  function blockCounts(blocks) {
    const list = blocks || [];
    const n = (f) => list.filter(f).length;
    return {total: list.length, muted: n((b) => b.muted), failed: n((b) => b.status === 'failed'),
      fast: n((b) => b.status !== 'failed' && b.fast), queued: n((b) => b.status === 'queued')};
  }
  /** 行头副题：`62 句 · 3 句过快 · 1 句静音` */
  function trackLine(blocks) {
    const c = blockCounts(blocks);
    const parts = [`${c.total} 句`];
    if (c.failed) parts.push(`${c.failed} 句没合成`);
    if (c.fast) parts.push(`${c.fast} 句过快`);
    if (c.muted) parts.push(`${c.muted} 句静音`);
    if (c.queued) parts.push(`${c.queued} 句重生成中`);
    return parts.join(' · ');
  }
  /** 块菜单的标题：一句写文字，多句写句数 */
  function selectionTitle(blocks, ids) {
    const list = blocks || [];
    if (!ids || ids.length <= 1) {
      const b = list.find((x) => x.id === (ids || [])[0]);
      const t = b ? b.text : '';
      return t.length > 22 ? t.slice(0, 22) + '…' : t;
    }
    return `选中 ${ids.length} 句`;
  }
  /** 需要重新生成的候选：失败的 + 过快的 */
  function regenCandidates(blocks) {
    return (blocks || []).filter((b) => b.status === 'failed' || (b.status !== 'failed' && b.fast)).map((b) => b.id);
  }

  /* ---------- 导出声道 ---------- */
  const DUB_EXPORT = [
    {id: 'one', name: '只带一条声道', desc: '成片只有一条音轨：所选配音混上背景声；别的语言不进文件'},
    {id: 'multi', name: '每种语言各一条声道', desc: '原声与每条配音各成一条可切换的音轨，播放器里选语言；文件大一些'},
  ];
  /** 导出清单里开着的配音行 */
  const dubLanes = (eff) => (eff || []).filter((l) => l.kind === 'dub' && l.on);
  /** 默认：一条配音走「只带一条」，两条以上默认「各一条」（两种语言混进一条声道没有意义） */
  function dubModeDefault(eff) { return dubLanes(eff).length > 1 ? 'multi' : 'one'; }
  /** 成片里的音轨清单。`pick` 是「只带一条」时烧哪种语言（缺省第一条开着的）。 */
  function audioTracks(eff, mode, pick) {
    const dubs = dubLanes(eff);
    const orig = (eff || []).find((l) => l.kind === 'audio');
    // 背景声一组一份（2026-09-14）：某种语言的声道只混它自己那组的背景声（老的单条 `bed` 也认）
    const withBed = (d) => ((eff || []).some((l) => l.kind === 'bed' && l.on && (l.id === d.id || l.id === 'bed')) ? ' + 背景声' : '');
    if (!dubs.length) return [];
    if (mode === 'multi') {
      const out = [];
      if (orig && orig.on) out.push({key: 'audio', label: '原声', sub: '视频里的原始声音', dflt: false});
      dubs.forEach((d, i) => out.push({key: d.key, id: d.id, label: d.label, sub: '配音' + withBed(d), dflt: i === 0}));
      return out;
    }
    const chosen = dubs.find((d) => d.id === pick) || dubs[0];
    return [{key: chosen.key, id: chosen.id, label: chosen.label, sub: '配音' + withBed(chosen) + (dubs.length > 1 ? ` · 其余 ${dubs.length - 1} 条不进文件` : ''), dflt: true}];
  }
  /** 「将导出」汇总里的声道一段：`配音 · English` / `3 条声道 · English 默认` */
  function dubExportPart(eff, mode, pick) {
    const tracks = audioTracks(eff, mode, pick);
    if (!tracks.length) return '';
    if (mode === 'multi') return `${tracks.length} 条声道 · ${(tracks.find((t) => t.dflt) || tracks[0]).label}默认`;
    return tracks[0].label;
  }

  /* ---------- 音频 Tab 的分组（§13.6，2026-09-13 三改） ----------
     一条配音轨落盘是一叠文件：分离出来的 background.wav + 逐句 s-N.wav。素材库不再把它们与
     导入的 mp3 平铺，而是按语言折成一组；这里只算「组里有什么」，怎么折由视图定。 */
  const fileDur = (b) => +Math.max(0.1, (b.end || 0) - (b.start || 0)).toFixed(1);
  /** 一条配音轨的文件清单：`background.wav`（分离过才有）在前，之后按句序 `s-1.wav … s-N.wav` */
  function dubFiles(d, o) {
    const opt = o || {};
    const out = [];
    const list = (d && d.blocks || []).slice().sort((a, b) => a.start - b.start);
    if (d && d.bed) out.push({id: `dub-${d.lang}-bed`, name: 'background.wav', kind: 'bed', text: '分离出来的背景声', dur: +(opt.duration || (list.length ? list[list.length - 1].end : 0)).toFixed(1)});
    list.forEach((b, i) => {
      const k = activeK(b, d);
      out.push({id: `dub-${d.lang}-${b.id}`, name: `s-${i + 1}.wav`, kind: 'sentence', blockId: b.id, text: b.text || '',
        dur: fileDur(b), start: b.start, status: b.status === 'failed' ? 'failed' : b.status === 'queued' ? 'queued' : b.fast ? 'fast' : 'done', muted: !!b.muted,
        k, archived: archivedTakes(b, d).length});
    });
    return out;
  }
  /** 组头副题：`63 个文件 · 62 句 · 3 句没合成 · Qwen3-TTS`；有归档版时在文件数后加 `· 7 个旧版本` */
  function groupLine(d, files) {
    const n = (files || dubFiles(d)).length;
    const old = archivedCount(d.blocks || [], d);
    return [`${n} 个文件`, old ? `${old} 个旧版本` : '', trackLine(d.blocks || []), d.engineName || d.engine].filter(Boolean).join(' · ');
  }
  /** 「视频音频」的形状：每种语言一组（带文件清单与副题）+ 散装文件；`off` 是这条轨关着（组头不标「已在时间轴」） */
  function audioGroups(files, dubs, o) {
    const opt = o || {};
    const groups = (dubs || []).map((d) => {
      const list = dubFiles(d, opt);
      return {lang: d.lang, langName: d.langName || d.lang, role: d.role || 'dub', langCode: d.langCode, engineName: d.engineName || d.engine || '', files: list,
        who: d.who || null, roleLine: roleText(d),
        line: groupLine(d, list), regen: regenCandidates(d.blocks || []), onTimeline: !(opt.dubOff && opt.dubOff[d.lang])};
    });
    const total = groups.reduce((n, g) => n + g.files.length, 0) + (files || []).length;
    return {groups, loose: (files || []).slice(), total};
  }
  /** 段头旁注：`2 组配音 · 65 个文件` / `2 个文件` */
  function audioAside(shape) {
    const g = shape.groups.length;
    return g ? `${g} 组配音 · ${shape.total} 个文件` : `${shape.total} 个文件`;
  }

  const BC_DUB = {
    PRIORITY, PRESET_NATIVE, capabilities, capabilityLine, presetsFor, accentSource, priorityOptions, strategyOf, assignPresets,
    voiceSummary, extraSettings, voiceReady,
    pickEngine, modelNeeded, missingModels, installedAlternative, stepLine, ctaLabel, startProblem, langLine,
    compareRows, compareSummary, barWidths, compareLine, mmss,
    STAGE_W, synthSpan, sentenceAt, runLog,
    muteBlocks, deleteBlocks, queueRegen, regenerate, rangeIds, pickIds, blockCounts, trackLine, selectionTitle, regenCandidates,
    nodeRunsModel, dubNodes, runtimeModel, nodeSeparates, nodeHint, whereLine,
    DUB_EXPORT, dubLanes, dubModeDefault, audioTracks, dubExportPart,
    dubFiles, groupLine, audioGroups, audioAside,
    PACE_TOL, engineOfModel, demoSeed, demoSynth, perMinOf, groupModel, takesOf, activeK, activeTake, archivedTakes, sentenceIndex, takeFile,
    paceReference, paceRatio, paceText, deviationShort, versionLine, modelMismatch, mismatchCount, restoreTake, keepLatest, clearArchive,
    sizeLabel, archiveShape, archivedCount,
    isNarration, groupLang, groupBadge, groupTitle, roleText, NARRATION_GAP, narrationGroup, reflowNarration,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_DUB});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_DUB;
})();
