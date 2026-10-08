/* 合成前的注音（多音字读音）纯模型 —— docs/design/speech/bcut-tts-readings-design.md（2026-09-23，原型先行）。
   一条线格式 `<表面|读音>`：读音是拼音，多字表面按空格分音节（`<银行|yin2 hang2>`）。每个音节可写声调数字
   （`hang2`，轻声 5，ü 写 v）或带调拼音（`háng`、`lǜ`，不标调是轻声 `le`），可混用、不分大小写；
   解析时一律规范成声调数字（`<银行|yín háng>` → `yin2 hang2`），之后只见数字写法。
   注记住在文字里，不另开字段：配音稿每句的 `text`、生成语音的文字都是带注记的，
   语速 / 预算 / 字数一律先 `stripReadings` 再数。
   这里只算：解析 / 去注记 / 渲回文字、判定（词组表 → 语境多音字 → 演示用的「模型校对」规则）、
   各引擎哪些注记没按注音念（`dropped`）、chip 上的带调拼音与收据那一行。
   **词典是原型近似**：产品里是 pypinyin 全表 + 精选的约 200–500 个语境多音字 + mmseg 词组表（core，R1），
   这里只带几十个字、几十个词，够把审阅页、chip 与收据演示出来；「模型校对」是几条上下文规则，
   产品里是一次送约 20 句的 LLM 批调用（`kind: tts-readings`）。不碰 React、不碰 DOM，`node --test` 直接 require。 */
(function () {
  /* ---------- 语境多音字（首个是词典默认读音；每个读音带一个例词，候选菜单里用） ----------
     只收「念错了听得出来、又常见」的字；要 / 没 / 好 / 和 / 会 / 几 / 少 这类几乎总念默认读音的不收，
     逐句都标就是噪音（设计稿 §4.1）。 */
  const DICT = {
    行: [['xing2', '行走'], ['hang2', '银行']],
    重: [['zhong4', '重要'], ['chong2', '重新']],
    长: [['chang2', '长度'], ['zhang3', '长大']],
    还: [['hai2', '还有'], ['huan2', '还钱']],
    干: [['gan4', '干活'], ['gan1', '干净']],
    发: [['fa1', '发现'], ['fa4', '头发']],
    给: [['gei3', '给你'], ['ji3', '供给']],
    血: [['xue4', '血液'], ['xie3', '流血了']],
    率: [['lv4', '效率'], ['shuai4', '率领']],
    曾: [['ceng2', '曾经'], ['zeng1', '曾孙']],
    处: [['chu4', '到处'], ['chu3', '处理']],
    传: [['chuan2', '传播'], ['zhuan4', '自传']],
    强: [['qiang2', '强大'], ['qiang3', '勉强']],
    相: [['xiang1', '相同'], ['xiang4', '真相']],
    兴: [['xing4', '高兴'], ['xing1', '兴起']],
    应: [['ying1', '应该'], ['ying4', '答应']],
    便: [['bian4', '方便'], ['pian2', '便宜']],
    都: [['dou1', '都是'], ['du1', '首都']],
    难: [['nan2', '困难'], ['nan4', '灾难']],
    模: [['mo2', '模型'], ['mu2', '模样']],
    差: [['cha4', '差不多'], ['cha1', '差别'], ['chai1', '出差']],
    间: [['jian1', '时间'], ['jian4', '间隔']],
    为: [['wei4', '因为'], ['wei2', '成为']],
    只: [['zhi3', '只有'], ['zhi1', '一只']],
    乐: [['le4', '快乐'], ['yue4', '音乐']],
    调: [['diao4', '调查'], ['tiao2', '调整']],
    数: [['shu4', '数字'], ['shu3', '数一数']],
    种: [['zhong3', '种类'], ['zhong4', '种树']],
    倒: [['dao4', '倒水'], ['dao3', '倒下']],
    空: [['kong1', '天空'], ['kong4', '空闲']],
    量: [['liang4', '数量'], ['liang2', '量一量']],
    朝: [['chao2', '朝向'], ['zhao1', '朝气']],
    藏: [['cang2', '隐藏'], ['zang4', '宝藏']],
    转: [['zhuan3', '转换'], ['zhuan4', '转圈']],
    觉: [['jue2', '觉得'], ['jiao4', '睡觉']],
    露: [['lu4', '露水'], ['lou4', '露面']],
    绿: [['lv4', '绿色'], ['lu4', '绿林']],
    背: [['bei4', '背后'], ['bei1', '背包']],
    教: [['jiao4', '教育'], ['jiao1', '教书']],
    省: [['sheng3', '省钱'], ['xing3', '反省']],
  };
  /* ---------- 词组表：命中的字直接定读音、不进候选（chip 只画剩下的单字） ---------- */
  const PHRASES = {
    银行: 'yin2 hang2', 行长: 'hang2 zhang3', 行走: 'xing2 zou3', 重新: 'chong2 xin1', 重要: 'zhong4 yao4',
    长大: 'zhang3 da4', 模型: 'mo2 xing2', 一模一样: 'yi1 mu2 yi1 yang4', 真相: 'zhen1 xiang4',
    差不多: 'cha4 bu4 duo1', 时间: 'shi2 jian1', 因为: 'yin1 wei4', 为什么: 'wei4 shen2 me5', 上传: 'shang4 chuan2',
    单独: 'dan1 du2', 音乐: 'yin1 yue4', 快乐: 'kuai4 le4', 还有: 'hai2 you3', 觉得: 'jue2 de5', 大家好: 'da4 jia1 hao3',
    首都: 'shou3 du1', 睡觉: 'shui4 jiao4', 数量: 'shu4 liang4', 答应: 'da1 ying4', 应该: 'ying1 gai1', 没有: 'mei2 you3',
    只有: 'zhi3 you3', 调整: 'tiao2 zheng3', 处理: 'chu3 li3', 发现: 'fa1 xian4', 头发: 'tou2 fa4', 便宜: 'pian2 yi5',
  };
  /* ---------- 演示用的「模型校对」：看前后一个字改读音（产品里是 LLM 批调用，只答标出来的字） ---------- */
  const CONTEXT = {
    重: [['chong2', '', '新复做来渲建组启试播拍装']],
    行: [['hang2', '银一同外内本', '业列情家']],
    长: [['zhang3', '校部市班组队家', '大高出成']],
    还: [['huan2', '', '钱给回原清款']],
    干: [['gan1', '', '净燥脆杯']],
    发: [['fa4', '头理白', '']],
    都: [['du1', '首古', '']],
    难: [['nan4', '灾患遇避', '民']],
    差: [['chai1', '出', ''], ['cha1', '', '别异距']],
    间: [['jian4', '', '隔断']],
    为: [['wei2', '成作认以', '']],
    只: [['zhi1', '一两几', '猫狗鸟']],
    数: [['shu3', '', '一着']],
    种: [['zhong4', '', '树地田花']],
    便: [['pian2', '', '宜']],
    相: [['xiang4', '真照长', '机片声']],
    强: [['qiang3', '勉', '']],
    应: [['ying4', '答反回响', '用对']],
    调: [['tiao2', '', '整节和皮']],
    量: [['liang2', '测丈', '一']],
    转: [['zhuan4', '', '圈动']],
    觉: [['jiao4', '睡午', '']],
    乐: [['yue4', '音', '器队曲']],
    空: [['kong4', '有', '闲白格']],
    倒: [['dao3', '摔跌打', '下闭塌']],
    率: [['shuai4', '', '领先']],
    血: [['xie3', '', '了']],
    曾: [['zeng1', '', '孙祖']],
    处: [['chu3', '', '理置罚分']],
    传: [['zhuan4', '自', '记']],
    兴: [['xing1', '', '起建奋']],
    朝: [['zhao1', '', '气阳']],
    藏: [['zang4', '宝西', '']],
    露: [['lou4', '', '面脸']],
    绿: [['lu4', '', '林']],
    背: [['bei1', '', '包负着']],
    教: [['jiao1', '', '书你我他']],
    省: [['xing3', '反', '']],
    模: [['mu2', '', '样具板']],
    给: [['ji3', '供', '予养']],
  };
  /* ---------- 各引擎怎么吃读音（设计稿 §3） ----------
     IndexTTS2：拼音片内联替换，**词表里没这个片的音节**没法念（本机 bpe.model 实查缺 LU4 / LV4）。
     Qwen3：同音字替换——只替「与词典默认不同」的读音（模型校对 / 用户改的），词组表与词典默认的注记按原字送、
     不算没念；读音没有可替换的代表字（多数轻声、几个冷僻音）就算没按注音念。
     GPT-SoVITS 的接缝注入是 R3，在那之前全部退回原文 */
  const NO_PIECE = {lu4: 1, lv4: 1};
  const HOMOPHONE = {
    hang2: '杭', chong2: '虫', zhong4: '众', zhang3: '掌', chang2: '常', huan2: '环', hai2: '孩', gan1: '甘',
    xiang4: '向', xiang1: '香', du1: '督', dou1: '兜', hao4: '号', chai1: '钗', cha1: '叉', jian4: '见', wei2: '围',
    wei4: '位', zhi1: '知', huo4: '货', shu3: '属', shu4: '树', zhong3: '肿', mo4: '墨', qiang3: '抢', ying4: '硬',
    ying1: '英', tiao2: '条', diao4: '掉', liang2: '梁', liang4: '亮', zhuan4: '赚', kuai4: '快', yao1: '腰',
    jiao4: '叫', jue2: '绝', yue4: '月', kong4: '控', dao3: '岛', dao4: '到', shao4: '哨', ji1: '机', ji3: '挤',
    shuai4: '帅', xie3: '写', zeng1: '增', ceng2: '层', chu3: '楚', chu4: '触', xing1: '星', xing4: '杏', xing2: '形',
    zhao1: '招', chao2: '潮', zang4: '葬', lou4: '漏', lu4: '路', lv4: '律', bei1: '杯', bei4: '被', jiao1: '交',
    xing3: '醒', pian2: '骈',
  };
  const DROPS_ALL = {gptsovits: 1, voxcpm2: 1, omnivoice: 1};   // 注音支持 none（core `readings_support`）

  const HAN = /[㐀-鿿]/;
  /** 这门语言要不要注音：v1 只有中文（zh / zh-Hans / zh-Hant 及别名） */
  function needsReadings(lang) { return /^zh(?:[-_]|$)/i.test(String(lang || '')); }
  /** 文字里有没有汉字（生成语音的「注音」钮只在有中文时出现） */
  function hasHan(text) { return HAN.test(String(text || '')); }

  /* 带调字母 → [去调字母, 声调]（ü 不带调为 0）；只认预组合字符 */
  const TONED = {ü: ['v', 0]};
  [['a', 'āáǎà'], ['e', 'ēéěè'], ['i', 'īíǐì'], ['o', 'ōóǒò'], ['u', 'ūúǔù'], ['v', 'ǖǘǚǜ'], ['n', ' ńňǹ'], ['m', ' ḿ  ']]
    .forEach(([base, marks]) => Array.from(marks).forEach((c, i) => { if (c !== ' ') TONED[c] = [base, i + 1]; }));
  /** 一个音节 → `hang2`：声调取末尾数字 1–5、唯一的调号，都没有是轻声 5；调号与数字并存、两个调号、
   *  去调后不是 1–6 个字母或没有元音（成音节的 m / n / ng / hm / hng 除外）回 null */
  function normSyllable(raw) {
    let body = '', mark = 0, digit = 0;
    for (const c of Array.from(raw.toLowerCase())) {
      if (digit) return null;
      if (/[a-z]/.test(c)) body += c;
      else if (/[1-5]/.test(c)) digit = +c;
      else if (TONED[c]) {
        body += TONED[c][0];
        if (TONED[c][1]) { if (mark) return null; mark = TONED[c][1]; }
      } else return null;
    }
    if (digit && mark) return null;
    if (body.length < 1 || body.length > 6) return null;
    if (!/[aeiouv]/.test(body) && !/^(?:m|n|ng|hm|hng)$/.test(body)) return null;
    if (/^[jqxy]/.test(body)) body = body.replace(/v/g, 'u');
    return body + (digit || mark || 5);
  }
  /** 读音规范化：每个音节 `normSyllable`、多个空白压成一个；不合法（音节数对不上表面字数、某个音节不合法）回 null */
  function normReading(surface, reading) {
    const r = String(reading || '').trim();
    if (!r) return null;
    const syl = r.split(/\s+/).map(normSyllable);
    if (!syl.every(Boolean)) return null;
    if (syl.length !== Array.from(surface).length) return null;
    return syl.join(' ');
  }
  /** 解析带注记的文字 → {surface, readings: [{start, end, surface, reading}]}，偏移按 Unicode 字、落在 surface 上。
   *  畸形的注记（没收尾 `<行|`、空表面 `<|x>`、没有竖线 `<行>`、读音不合法）原样当普通文字。 */
  function parseReadings(text) {
    const s = String(text == null ? '' : text);
    const out = [];
    let surface = '';
    let n = 0;                                     // surface 已有多少个字（按码点）
    const re = /<([^<>|]+)\|([^<>|]+)>/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      const reading = hasHan(m[1]) && normReading(m[1], m[2]);
      if (!reading) continue;
      const before = s.slice(last, m.index);
      surface += before; n += Array.from(before).length;
      const len = Array.from(m[1]).length;
      out.push({start: n, end: n + len, surface: m[1], reading});
      surface += m[1]; n += len;
      last = m.index + m[0].length;
    }
    surface += s.slice(last);
    return {surface, readings: out};
  }
  /** 去掉注记只留表面文字（量语速、数字数、写 script.txt 都用它） */
  function stripReadings(text) { return parseReadings(text).surface; }
  /** 表面文字 + 注记 → 带注记的文字（按 start 排，重叠的后一个丢掉） */
  function render(surface, readings) {
    const chars = Array.from(String(surface || ''));
    const list = (readings || []).filter((r) => r && r.reading).slice().sort((a, b) => a.start - b.start);
    let out = '', at = 0;
    list.forEach((r) => {
      if (r.start < at || r.end > chars.length) return;
      out += chars.slice(at, r.start).join('') + '<' + chars.slice(r.start, r.end).join('') + '|' + r.reading + '>';
      at = r.end;
    });
    return out + chars.slice(at).join('');
  }

  /* ---------- 带调拼音（chip 上画 `行 háng`） ---------- */
  const MARKS = {a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ'};
  function markSyllable(syl) {
    const m = /^([a-z]+)([1-5])$/.exec(String(syl || ''));
    if (!m) return String(syl || '');
    const body = m[1], tone = +m[2];
    if (tone === 5) return body.replace(/v/g, 'ü');
    let at = body.indexOf('a');
    if (at < 0) at = body.indexOf('e');
    if (at < 0 && body.indexOf('ou') >= 0) at = body.indexOf('ou');
    if (at < 0) { for (let i = body.length - 1; i >= 0; i--) { if (MARKS[body[i]]) { at = i; break; } } }
    if (at < 0) return body;
    const out = body.slice(0, at) + MARKS[body[at]][tone - 1] + body.slice(at + 1);
    return out.replace(/v/g, 'ü');
  }
  /** `hang2` → `háng`；`yin2 hang2` → `yín háng`；`lv4` → `lǜ`；`le5` → `le` */
  function toneMark(reading) { return String(reading || '').split(' ').map(markSyllable).join(' '); }

  /* ---------- 判定 ---------- */
  const dictDefault = (ch) => (DICT[ch] ? DICT[ch][0][0] : null);
  /** 一个注记的候选读音：单字取词典全部读音（带例词），当前读音不在表里时补在最前；
   *  多字（词组表 / 项目读音）按其中多音字的读音组合，当前读音排第一，最多 6 个 */
  function optionsOf(r) {
    const chars = Array.from(r.surface || '');
    if (chars.length === 1 && DICT[chars[0]]) {
      const list = DICT[chars[0]].map(([reading, ex]) => ({reading, ex}));
      return list.some((o) => o.reading === r.reading) ? list : [{reading: r.reading, ex: ''}].concat(list);
    }
    const syl = String(r.reading || '').split(' ');
    let combos = [[]];
    chars.forEach((c, i) => {
      const alts = DICT[c] ? DICT[c].map((x) => x[0]) : [];
      const each = [syl[i]].concat(alts.filter((a) => a !== syl[i]));
      combos = combos.reduce((acc, head) => acc.concat(each.map((s) => head.concat([s]))), []).slice(0, 6);
    });
    return combos.map((c) => ({reading: c.join(' '), ex: ''}));
  }
  /** 给注记补上来源：词组表命中 = phrase；单字且等于词典默认 = dict；其余（模型校对或人改的）= `fallback` */
  function classify(r, fallback) {
    const chars = Array.from(r.surface || '');
    if (PHRASES[r.surface] === r.reading) return 'phrase';
    if (chars.length === 1 && dictDefault(chars[0]) === r.reading) return 'dict';
    return fallback || 'user';
  }
  function contextReading(ch, prev, next) {
    const rules = CONTEXT[ch] || [];
    const hit = rules.find(([, before, after]) => (before && prev && before.indexOf(prev) >= 0) || (after && next && after.indexOf(next) >= 0));
    return hit ? hit[0] : null;
  }
  /** 判定一段文字：
   *  1. 已写在文字里的注记照单全收（来源按 `classify`，人写的算 user）；
   *  2. 项目级读音（`project`：只有多字表面词，[{surface, reading}]）最长匹配；
   *  3. 词组表最长匹配（命中的词整段注记，来源 phrase，不画 chip）；
   *  4. 剩下的语境多音字：`llm` 为真时按上下文规则定读音（来源 llm），否则词典默认（来源 dict）。
   *  返回 {surface, readings: [{start, end, surface, reading, src, dflt, chip}]}；`chip` = 审阅页要画成 chip（不是词组表命中的）。 */
  function annotate(text, o) {
    const opt = o || {};
    const parsed = parseReadings(text);
    const chars = Array.from(parsed.surface);
    const taken = new Array(chars.length).fill(false);
    const out = [];
    const put = (r) => { for (let i = r.start; i < r.end; i++) taken[i] = true; out.push(r); };
    parsed.readings.forEach((r) => put(Object.assign({}, r, {src: classify(r, 'user')})));
    const free = (i, len) => { for (let k = i; k < i + len; k++) { if (k >= chars.length || taken[k]) return false; } return true; };
    const scan = (table, src) => {
      const keys = Object.keys(table).sort((a, b) => Array.from(b).length - Array.from(a).length);
      for (let i = 0; i < chars.length; i++) {
        if (taken[i]) continue;
        for (const w of keys) {
          const wc = Array.from(w);
          if (wc.length < 2 || !free(i, wc.length) || chars.slice(i, i + wc.length).join('') !== w) continue;
          if (!wc.some((c) => DICT[c]) && src === 'phrase') continue;       // 词组里没有多音字就不必注
          put({start: i, end: i + wc.length, surface: w, reading: table[w], src});
          i += wc.length - 1;
          break;
        }
      }
    };
    const proj = {};
    (opt.project || []).forEach((p) => { if (p && Array.from(p.surface || '').length > 1 && normReading(p.surface, p.reading)) proj[p.surface] = normReading(p.surface, p.reading); });
    scan(proj, 'user');
    scan(PHRASES, 'phrase');
    chars.forEach((ch, i) => {
      if (taken[i] || !DICT[ch]) return;
      const dflt = dictDefault(ch);
      const ctx = opt.llm ? contextReading(ch, chars[i - 1], chars[i + 1]) : null;
      put({start: i, end: i + 1, surface: ch, reading: ctx || dflt, src: ctx && ctx !== dflt ? 'llm' : 'dict'});
    });
    out.sort((a, b) => a.start - b.start);
    out.forEach((r) => {
      const cs = Array.from(r.surface);
      r.dflt = cs.length === 1 ? dictDefault(cs[0]) || r.reading : PHRASES[r.surface] || r.reading;
      r.chip = r.src !== 'phrase';
      r.remembered = !!proj[r.surface] && proj[r.surface] === r.reading;
    });
    return {surface: parsed.surface, readings: out};
  }
  /** 审阅页里一次改读音：返回新的注记表（这一处来源记 user） */
  function setReading(readings, start, reading) {
    return (readings || []).map((r) => (r.start === start ? Object.assign({}, r, {reading, src: reading === r.dflt && r.src !== 'user' ? r.src : 'user'}) : r));
  }

  /* ---------- 各引擎哪些注记没按注音念 ---------- */
  /** 一只引擎把这些注记里的哪几处丢了（软失败：句子照常合成，UI 在收据与句属性页说清） */
  function dropped(readings, engine) {
    const list = readings || [];
    const e = String(engine || '');
    if (DROPS_ALL[e]) return list.slice();
    if (e === 'indextts2') return list.filter((r) => r.reading.split(' ').some((s) => NO_PIECE[s]));
    if (e === 'qwen3' || e === 'qwen3-1.7b') {
      return list.filter((r) => {
        const src = r.src || classify(r, 'user');
        if (src === 'phrase' || src === 'dict') return false;
        const cs = Array.from(r.surface);
        const syl = r.reading.split(' ');
        return cs.some((c, i) => syl[i] !== dictDefault(c) && DICT[c] && !HOMOPHONE[syl[i]]);
      });
    }
    return [];
  }
  /** 引擎为什么没按注音念（chip 的 tip） */
  function dropReason(engine) {
    const e = String(engine || '');
    if (e === 'indextts2') return 'IndexTTS2 的词表里没有这个音节';
    if (e === 'qwen3' || e === 'qwen3-1.7b') return 'Qwen3 不支持这一读音 · 合成时保留原字';
    if (e === 'gptsovits') return 'GPT-SoVITS 还不认注音 · 按原字念';
    if (e === 'voxcpm2') return 'VoxCPM2 不认注音 · 按原字念';
    if (e === 'omnivoice') return 'OmniVoice 不认注音 · 按原字念';
    return '';
  }
  const sameReading = (a, b) => a.start === b.start && a.end === b.end && a.reading === b.reading;
  /** 一段带注记的文字交给某只引擎：{text: 表面文字, readings, dropped} —— 配音块、版、生成语音记录都存这三样 */
  function forEngine(text, engine) {
    const p = parseReadings(text);
    const readings = p.readings.map((r) => Object.assign({}, r, {src: classify(r, 'user')}));
    return {text: p.surface, readings, dropped: dropped(readings, engine)};
  }
  const isDropped = (r, list) => (list || []).some((x) => sameReading(x, r));

  /** 收据那一行：`注音 12 处 · 3 处引擎没按注音念`；没有注音回空串 */
  function receiptLine(n, m) {
    if (!n) return '';
    return m ? `注音 ${n} 处 · ${m} 处引擎没按注音念` : `注音 ${n} 处`;
  }
  /** 一组块的注音计数（收据用）：{n, m} */
  function tally(blocks) {
    return (blocks || []).reduce((acc, b) => ({n: acc.n + (b.readings || []).length, m: acc.m + (b.readingsDropped || []).length}), {n: 0, m: 0});
  }
  /** 只有多字表面词进项目级读音（`project.dub.readings`），单字永远不进（设计稿 §4.3）；同表面后来的盖前面 */
  function remember(project, readings) {
    const out = (project || []).slice();
    (readings || []).forEach((r) => {
      if (r.src !== 'user' || Array.from(r.surface || '').length < 2) return;
      const i = out.findIndex((p) => p.surface === r.surface);
      if (i >= 0) out[i] = {surface: r.surface, reading: r.reading};
      else out.push({surface: r.surface, reading: r.reading});
    });
    return out;
  }
  /* ---------- 生成语音的表单（`f.readings` 是按下「注音」时对 `f.readingsFor` 那段文字标的） ---------- */
  /** 标完注音之后文字又改过：chip 行作废，要再按一次重扫 */
  function formStale(f) { return !!(f && f.readings) && f.readingsFor !== f.text; }
  /** 送去合成的文字：注音没作废就把 chip 行的读音渲进去，否则原样（文字里手写的注记照样生效） */
  function formText(f) {
    const text = String((f && f.text) || '');
    if (!f || !f.readings || formStale(f)) return text;
    return render(stripReadings(text), f.readings);
  }

  /** 这只云端模型能不能做「模型校对」：没连 key 就只按词典标 */
  function llmReady(model) { return !!model && !/未连接/.test(String(model.note || '')); }
  /** 审阅页 / chip 行的副题 */
  /** 注音摘要的后半句：`llm` 传模型名（校对过）或假值（只按词典）——2026-09-24 起点名是哪只模型校对的 */
  function reviewSub(llm) { return llm ? `词典先标、${typeof llm === 'string' ? llm : '模型'} 按上下文校对过 · 点字能改` : '只按词典标了，没有模型校对 · 点字能改'; }

  const BC_READINGS = {
    DICT, PHRASES, NO_PIECE, HOMOPHONE,
    needsReadings, hasHan, parseReadings, stripReadings, render, toneMark, annotate, setReading, optionsOf, classify,
    dropped, dropReason, forEngine, isDropped, receiptLine, tally, remember, llmReady, reviewSub, formStale, formText,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_READINGS});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_READINGS;
})();
