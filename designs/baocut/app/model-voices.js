/* 「我的声音」的纯模型 —— 设计稿 docs/design/speech/bcut-voice-library-design.md（2026-09-24，原型先行）。
   克隆音色今天不是一个功能，是四个地方各自的一枚「我的音频」芯片，参考音频是一次性的文件路径。
   这里把它变成**用户级、跨项目、跨引擎**的对象：**音色档**（voice profile）——一段规整到 5–10 秒
   的参考录音 + 这段的文字 + 来源，在设置页采一次，生成语音 / 克隆声音 / 翻译配音 / 试听里按名字选。

   与 `model-tts.js` 的分工：参考窗算法（`referenceWindows`）、来源芯片（`refSources` 认 `my:<id>`）、
   表单落地（`pickRef`）都在那边，这里只放音色档本身、按引擎落地的判词、分人页的候选与质量判断、
   麦克风采集的门槛与导出包。演示数据 `DEMO` 也在这里（store 开局拷一份，刷新重置，与术语库同）。

   这里只算，不画。 */
(function () {
  const TTS = (typeof window !== 'undefined' && window.BC_TTS)
    || (typeof require === 'function' ? require('./model-tts.js') : null);

  /* ---------- 采集门槛（设计稿 §2.1 / §3.1） ---------- */

  /** 参考段规整到 5–10 秒：同时落在克隆引擎建议窗 [3, 15] 与 GPT-SoVITS 带原文的硬窗 [3, 10] 里，
   *  所以一段参考对每只引擎都合规。麦克风：目标 8 秒，12 秒自动停，短于 5 秒不给存。 */
  const REC = {min: 5, target: 8, max: 12};
  const WINDOW = {min: 5, max: 10};

  /** 录音停下后能不能存；不能就回一句原因，能就回 null */
  function takeProblem(seconds) {
    const s = +seconds || 0;
    if (s < REC.min) return `只录到 ${s.toFixed(1)} 秒，至少要 ${REC.min} 秒——照着台词再念一遍`;
    return null;
  }

  /* ---------- 音色档 ---------- */

  let seq = 0;
  /** 造一只音色档。`file` 是原型里试听用的随包录音（真机是自己的 reference.wav）。 */
  function makeVoice(o) {
    seq += 1;
    const lang = o.lang || 'zh';
    return {
      id: o.id || `v-${Date.now().toString(36)}-${seq}`,
      name: String(o.name || '').trim() || '我自己',
      lang,
      dur: +(+o.dur || REC.target).toFixed(1),
      text: String(o.text || '').trim(),
      textSource: o.textSource || (o.source && o.source.kind === 'mic' ? 'script' : 'transcript'),
      source: Object.assign({kind: 'mic'}, o.source || {}),
      file: o.file || (TTS ? TTS.defaultBuiltin(lang, '').file : null),
      emotion: o.emotion || null,
      consent: o.consent || 'unspecified',
      signal: o.signal || [],
      qwen3: o.qwen3 || 'icl',
      createdAt: o.createdAt || '刚刚',
      /* 云端（设计稿 bcut-cloud-tts-design §6）：来源段能截 ≥ 10 秒时另存一份 `source.wav`（`sourceDur`，≤ 60 秒），
         上传给服务商建克隆时优先用它；`cloud: {<provider>: {voiceId, referenceSha256, at, region?, stale?, orphan?}}` 是远端绑定 */
      sourceDur: o.sourceDur ? +(+o.sourceDur).toFixed(1) : 0,
      referenceSha256: o.referenceSha256 || null,
      cloud: o.cloud || {},
    };
  }

  /** 演示数据：一只麦克风录的、一只从访谈视频里挑出来的 */
  const DEMO = [
    makeVoice({id: 'v-me', name: '我自己', lang: 'zh', dur: 7.8,
      text: '欢迎使用 BaoCut！转录、翻译、配音，全都在你自己的电脑上完成。', textSource: 'script',
      source: {kind: 'mic', at: '2026-09-22'}, file: 'tts-voice-zh-male.wav', consent: 'self', createdAt: '2 天前'}),
    makeVoice({id: 'v-host', name: '主持人', lang: 'zh', dur: 7.4,
      text: '欢迎回到《码与远方》，我是林澈。这一期我们请到了两位做本地视频工具的朋友。', textSource: 'transcript',
      source: {kind: 'media', name: '第 12 期访谈.mp4', speaker: 'A', start: 0, end: 11.2, separated: true},
      file: 'tts-voice-zh-female.wav', consent: 'permitted', createdAt: '上周', sourceDur: 11.2,
      referenceSha256: 'e3b0c442', cloud: {elevenlabs: {voiceId: 'bc_ele_host', referenceSha256: 'e3b0c442', at: '2026-09-24'}}}),
  ];
  const CLOUD = () => (typeof window !== 'undefined' && window.BC_CLOUD_TTS) || (typeof require === 'function' ? require('./model-cloud-tts.js') : null);

  const fmtTime = (t) => {
    const s = Math.max(0, Math.round(+t || 0));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  /** 来源一句：`麦克风 · 2 天前` / `第 12 期访谈.mp4 · 说话人 A · 00:00–00:11` */
  function sourceLine(v) {
    const s = v.source || {};
    if (s.kind === 'media') {
      return `${s.name || '媒体文件'}${s.speaker ? ' · 说话人 ' + s.speaker : ''} · ${fmtTime(s.start)}–${fmtTime(s.end)}`;
    }
    if (s.kind === 'import') return `导入 · ${s.name || '音色包'}`;
    return `麦克风 · ${v.createdAt || '刚刚'}`;
  }
  /** 行上的元数据：`中文 · 7.8 秒 · 麦克风 · 2 天前` */
  function metaLine(v) {
    return `${TTS ? TTS.langLabel(v.lang) : v.lang} · ${(+v.dur).toFixed(1)} 秒 · ${sourceLine(v)}`;
  }
  const CONSENT = [
    {k: 'self', label: '我自己的'},
    {k: 'permitted', label: '已获本人许可'},
    {k: 'unspecified', label: '未说明'},
  ];
  const consentLabel = (k) => (CONSENT.find((c) => c.k === k) || CONSENT[2]).label;

  /* ---------- 按引擎落地（设计稿 §5）：判据是引擎能不能吃参考音频，不装通用 ---------- */

  /** 这只引擎（原型里是「引擎族」：qwen3 同时有 CustomVoice 与 Base）怎么用音色档。
   *  回 {ok, mode, line, why, alt}：ok 时 `mode` 是要落到的音色方式（永远是 clone），`line` 是选中后
   *  控件下写的那一句；不 ok 时 `why` 说原因、`alt` 给最近的可用做法。 */
  function profileFor(engine, voice, opt) {
    const e = TTS ? TTS.engineOf(engine) : null;
    if (e && e.cloud) {
      /* 云端：档在本地、克隆在对方（ProfileUse::Remote）——能不能用看这只音色在这家的克隆状态 */
      const C = CLOUD();
      const st = C.cloneStatus(voice || {consent: 'self', dur: 7.8}, e.provider, opt);
      return st.ok ? {ok: true, mode: 'preset', line: st.line, why: null, alt: null, cloud: st}
        : {ok: false, mode: null, line: null, why: st.line, alt: st.k === 'unsupported' ? null : '换参考段或补一行许可', cloud: st};
    }
    if (!e || !e.models || !e.models.clone) {
      const ok = TTS ? TTS.ENGINES.filter((x) => x.models && x.models.clone).map((x) => x.name) : [];
      return {ok: false, mode: null, line: null,
        why: '这只引擎不能克隆',
        alt: `能用它的：${ok.join(' / ')}`};
    }
    const lines = {
      'qwen3': '用参考录音克隆 · 有原文就走 ICL',
      'qwen3-1.7b': '用参考录音克隆 · 有原文就走 ICL',
      'indextts2': '用参考录音克隆 · 情绪可另给一段',
      'indextts25': '用参考录音克隆 · 情绪可另给一段',
      'gptsovits': '用参考录音克隆 · 带原文提示（参考 5–10 秒，合规）',
      'voxcpm2': '用参考录音克隆 · 有原文就高保真续写，写了风格走可控克隆',
      'omnivoice': '用参考录音克隆 · 有原文更像 · 仅限非商用',
    };
    return {ok: true, mode: 'clone', line: lines[e.id] || '用参考录音克隆', why: null, alt: null};
  }
  /** 多句生成（批量 / 翻译配音 / 旁白组）时音色怎么保持一致——设计稿 §3.2：整条只解析一次音色档，每一句都用同一段参考、
   *  同一份派生条件、同一颗种子；语速离群重抽只换那一句的种子，参考不换。选中我的声音后各处那一行都带这句。 */
  const RUN_LINE = '多句时每句都用这一段参考、同一颗种子';
  /** 行卡上的引擎 chip：`[{id, name, ok}]`，按引擎表次序，音源分离不算 */
  function engineChips() {
    return (TTS ? TTS.ENGINES : []).map((e) => ({id: e.id, name: e.name, ok: profileFor(e.id).ok}));
  }
  /** 行卡上的云端 chip（只列已连接的 API 提供方）：`[{id, name, ok, k, chip, line}]`，k 见 model-cloud-tts.js `cloneStatus` */
  function cloudChips(v, saved, opt) {
    const C = CLOUD();
    return C ? C.cloudChips(v, saved, opt) : [];
  }
  /** 试听克隆用哪只模型：已装的、能克隆的模型里按次序取第一只；一只都没装回 null */
  /* OmniVoice 仅限非商用，不拿它替用户的音色档试听 */
  const CLONE_MODELS = ['indextts2', 'qwen3-tts-0.6b-base', 'gpt-sovits-v2', 'index-tts2.5', 'qwen3-tts-1.7b-base', 'voxcpm2'];
  function auditionModel(installed) {
    return CLONE_MODELS.find((id) => installed(id)) || null;
  }

  /* ---------- 分人页（设计稿 §2.2 / §3.3） ---------- */

  const ISSUES = {
    overlap: '有人插话',
    background: '有背景声',
    clipping: '削波',
    short: '不足 5 秒',
  };
  const issueLabel = (k) => ISSUES[k] || k;

  /** 一段候选窗的质量：只报事实不替用户否决。输入是分离 / 分人两步各自报上来的区间：
   *  - 有人插话：`overlaps`（分人步报的多人同时说话区间）与窗相交超过 0.2 秒；
   *  - 有背景声：没分离过人声，且 `music`（分离步探测到的音乐 / 环境声区间）与窗相交；
   *  - 不足 5 秒：整窗短于下限（只在这位说话人凑不出一段时出现）。 */
  function windowIssues(w, opt) {
    const o = Object.assign({separated: false, overlaps: [], music: []}, opt || {});
    const hits = (ranges, eps) => (ranges || []).some(([a, b]) => Math.min(b, w.end) - Math.max(a, w.start) > eps);
    const issues = [];
    if (hits(o.overlaps, 0.2)) issues.push('overlap');
    if (!o.separated && hits(o.music, 0)) issues.push('background');
    if (w.end - w.start < WINDOW.min - 1e-9) issues.push('short');
    return issues;
  }

  /** 一段媒体的分人结果：每位说话人一张卡 + 前 3 段候选（带文字、时长、质量），按说话总时长排。
   *  字母按首次出场次序给（A 是最先开口的），名字空着由用户填；`opt` 见 `windowIssues`。 */
  function analyze(cues, speakers, opt) {
    const list = cues || [];
    const ids = [];
    list.forEach((c) => { if (ids.indexOf(c.sp) < 0) ids.push(c.sp); });
    const cards = ids.map((sp, i) => {
      const mine = list.filter((c) => c.sp === sp);
      const seconds = mine.reduce((a, c) => a + (c.end - c.start), 0);
      let candidates = (TTS ? TTS.referenceWindows(list, sp, 3) : []).map((w, k) => {
        const win = Object.assign({sp}, w);
        return Object.assign(win, {k, seconds: +(w.end - w.start).toFixed(1), issues: windowIssues(win, opt)});
      });
      // 凑得出 5 秒的就不再列不足 5 秒的碎段；一段都凑不出才把最长的那段亮出来（带「不足 5 秒」）
      if (candidates.some((w) => w.issues.indexOf('short') < 0)) candidates = candidates.filter((w) => w.issues.indexOf('short') < 0);
      return {
        id: sp, letter: String.fromCharCode(65 + i), name: '', hue: speakers && speakers[sp] ? speakers[sp].hue : (60 + i * 110) % 360,
        count: mine.length, seconds: +seconds.toFixed(1), candidates, sentences: mine,
      };
    });
    cards.sort((a, b) => b.seconds - a.seconds);
    return cards;
  }
  /** 说话人卡头：`说话人 A · 说了 1 分 12 秒 · 38 句` */
  function speakerLine(card) {
    const s = Math.round(card.seconds);
    const dur = s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
    return `说了 ${dur} · ${card.count} 句`;
  }
  /** 候选一行：`00:12–00:19 · 7.4 秒` */
  const candidateLine = (w) => `${fmtTime(w.start)}–${fmtTime(w.end)} · ${(w.end - w.start).toFixed(1)} 秒`;
  /** 分人页保存：每位勾中的说话人按选中的候选造一只音色档 */
  function voicesFromPicks(cards, picks, media) {
    return cards.filter((c) => picks[c.id] && picks[c.id].on).map((c) => {
      const w = c.candidates[(picks[c.id].k || 0)] || c.candidates[0];
      return makeVoice({
        name: picks[c.id].name || `说话人 ${c.letter}`, lang: media.lang || 'zh', dur: w ? w.end - w.start : REC.target,
        text: w ? w.text || '' : '', textSource: 'transcript',
        source: {kind: 'media', name: media.name, speaker: c.letter, start: w ? w.start : 0, end: w ? w.end : 0, separated: !!media.separated},
        signal: w ? w.issues.filter((k) => k === 'clipping') : [],
        file: media.file || null,
      });
    });
  }
  /** 底栏那句：`已选 2 位 · 存为 2 只音色` / `存为音色「主持人」` / `先勾一位说话人` */
  function saveLabel(cards, picks) {
    const on = cards.filter((c) => picks[c.id] && picks[c.id].on);
    if (!on.length) return '先勾一位说话人';
    if (on.length === 1) return `存为音色「${picks[on[0].id].name || '说话人 ' + on[0].letter}」`;
    return `已选 ${on.length} 位 · 存为 ${on.length} 只音色`;
  }
  /** 处理步骤：分离人声可选，缺模型时那一步给下载门 */
  const STEPS = [
    {k: 'separate', label: '分离人声', model: 'htdemucs-ft', optional: true},
    {k: 'diarize', label: '识别说话人', model: 'speaker-diarization'},
    {k: 'pick', label: '挑候选段'},
  ];

  /* ---------- 共享选择器（设计稿 §2.3）：四组 ---------- */

  /** 选择器的值：{kind: 'default' | 'my' | 'builtin' | 'preset' | 'file', id?, name?}
   *  `opt`：{file, builtin, preset} 传 false 收起那一组（配音的每人一行只要「自动取参考窗 / 我的声音」）；
   *  `defaultLabel / defaultSub` 改「默认」那一项的写法。 */
  function pickerGroups(engine, voices, opt) {
    const o = opt || {};
    const e = TTS ? TTS.engineOf(engine) : {models: {}};
    if (e.cloud) return CLOUD().pickerGroups(e.provider, voices, o);
    const p = profileFor(engine);
    const groups = [];
    groups.push({k: 'default', label: '默认', items: [{kind: 'default', label: o.defaultLabel || '默认音色', sub: o.defaultSub || '按念的语言挑一只内置音色'}]});
    const mine = (voices || []).map((v) => ({kind: 'my', id: v.id, label: v.name, sub: metaLine(v), disabled: !p.ok, why: p.why}));
    mine.push({kind: 'new', label: '克隆新音色…', sub: '去设置 › 模型 › 语音合成 › 我的声音录一段或从视频里取'});
    groups.push({k: 'my', label: '我的声音', items: mine});
    if (o.builtin !== false && TTS && e.models && e.models.clone) {
      groups.push({k: 'builtin', label: '内置音色', items: TTS.BUILTIN_REFS.map((r) => ({kind: 'builtin', id: r.id, label: r.label, sub: `${r.dur} 秒 · 随 BaoCut 自带`}))});
    }
    if (o.preset !== false && TTS && e.models && e.models.preset) {
      groups.push({k: 'preset', label: '模型预设', items: TTS.PRESETS.map((x) => ({kind: 'preset', id: x.id, label: x.id, sub: x.sub}))});
    }
    if (o.file !== false && e.models && e.models.clone) {
      groups.push({k: 'file', label: '临时', items: [{kind: 'file', label: '临时用一段录音…', sub: '只这一次，不进音色库'}]});
    }
    return groups;
  }
  /** 值 → 控件上显示的名字 */
  function valueLabel(value, voices, defaultLabel, engine) {
    const v = value || {kind: 'default'};
    if (v.kind === 'voice') { const C = CLOUD(); const e = TTS && engine ? TTS.engineOf(engine) : null; return C && e && e.cloud ? C.valueLabel(e.provider, v) : v.id; }
    if (v.kind === 'my') { const m = (voices || []).find((x) => x.id === v.id); return m ? m.name : '已删除的音色'; }
    if (v.kind === 'builtin') { const b = TTS && TTS.builtinRef(v.id); return b ? b.label : v.id; }
    if (v.kind === 'preset') return v.id;
    if (v.kind === 'file') return v.name || '临时录音';
    return defaultLabel || '默认音色';
  }
  /** 从生成表单反推选择器的值 */
  function valueOfForm(f) {
    if (TTS && TTS.engineOf(f.engine).cloud) return f.cloudVoice || {kind: 'default'};
    if (f.mode === 'preset') return {kind: 'preset', id: f.preset};
    if (f.ref && f.ref.my) return {kind: 'my', id: f.ref.my};
    if (f.ref && f.ref.builtin) return {kind: 'builtin', id: f.ref.builtin};
    if (f.ref) return {kind: 'file', name: f.ref.name};
    return {kind: 'default'};
  }
  /** 选择器的值 → 生成表单的补丁（音色方式跟着落：选我的声音 / 内置 / 默认 → clone，选预设 → preset） */
  function applyToForm(f, value, voices) {
    const v = value || {kind: 'default'};
    if (!TTS) return {};
    /* 云端引擎：音色只是表单上的 `cloudVoice`，方式固定 preset（克隆在对方那边） */
    if (TTS.engineOf(f.engine).cloud) return {mode: 'preset', cloudVoice: v.kind === 'default' ? {kind: 'default'} : v};
    if (v.kind === 'preset') return {mode: 'preset', preset: v.id};
    if (v.kind === 'my') return Object.assign({mode: 'clone'}, TTS.pickRef(f, 'my:' + v.id, null, voices));
    if (v.kind === 'builtin') return Object.assign({mode: 'clone'}, TTS.pickRef(f, v.id));
    if (v.kind === 'file') return Object.assign({mode: 'clone'}, TTS.pickRef(f, 'file', v.name ? {name: v.name, dur: v.dur} : null));
    return Object.assign({mode: TTS.voiceModes(f.engine).indexOf('clone') >= 0 ? 'clone' : f.mode}, TTS.pickRef(f, 'none'));
  }

  /* ---------- 导出包（设计稿 §2.4）：`<名字>.bcvoice/voice.json` ---------- */

  function exportBundle(v) {
    return JSON.stringify({
      schema: 1, id: v.id, name: v.name, language: v.lang,
      reference: {file: 'reference.wav', seconds: v.dur, text: v.text, textSource: v.textSource},
      emotion: v.emotion ? {file: 'emotion.wav', seconds: v.emotion.dur} : null,
      provenance: Object.assign({}, v.source, {createdAt: v.createdAt}),
      signal: {issues: v.signal || []}, consent: v.consent,
      qwen3: {mode: v.qwen3 || 'icl'},
      source: v.sourceDur ? {file: 'source.wav', seconds: v.sourceDur} : null,
      /* 远端绑定不进导出包：voice id 是这台电脑这把密钥下的，别人导入后第一次用时再建 */
    }, null, 2);
  }
  const bundleName = (v) => `${v.name}.bcvoice`;

  const BC_VOICES = {
    REC, WINDOW, takeProblem, makeVoice, DEMO, fmtTime, sourceLine, metaLine, CONSENT, consentLabel,
    profileFor, engineChips, cloudChips, CLONE_MODELS, auditionModel, RUN_LINE,
    ISSUES, issueLabel, windowIssues, analyze, speakerLine, candidateLine, voicesFromPicks, saveLabel, STEPS,
    pickerGroups, valueLabel, valueOfForm, applyToForm, exportBundle, bundleName,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_VOICES});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_VOICES;
})();
