/* 转录源语：语言表不在这儿，在全 App 共用的那份目录（model-languages.js，镜像 `bcut-lang`）。
   这里只留转录**特有**的两件事：哪只模型认哪张能力表、换模型后当前值往哪儿落。
   MOSS 没有语言 token 表，靠识别指令点名语言，所以它的可选集是整份目录的主语种
   （繁中 / 欧洲葡语折掉），默认仍是 Auto（镜像 `asr_language::codes`）。
   名字、次序、别名归一一律回目录取。 */
(function(root) {
  const L = (typeof window !== 'undefined' && window.BC_LANGUAGES)
    || (typeof require === 'function' ? require('./model-languages.js') : null);
  /* 旧名：`data.languages` / `data.whisper` / `data.qwen` 都是目录里的那几张表。 */
  const moss = L.all.map(l => l.code).filter(code => L.asrCanon(code) === code);
  const data = {languages: L.all, whisper: L.whisper, qwen: L.qwen, moss};
  const modelId = id => ({'moss-transcribe':'moss-transcribe-diarize','whisper-turbo':'whisper-large-v3-turbo','qwen3-asr':'qwen3-asr-1.7b'}[id] || id);
  const codes = id => {
    id = modelId(id);
    return /^whisper-large-v3(-turbo)?$/.test(id) ? L.whisper : /^qwen3-asr-(0.6|1.7)b$/.test(id) ? L.qwen
      : id === 'moss-transcribe-diarize' ? moss : [];
  };
  const resolve = (model, code) => {
    if (!codes(model).length) return code;
    const normalized = L.asrCanon(code);
    return normalized === 'auto' || codes(model).includes(normalized) ? normalized : 'auto';
  };
  const lang = code => L.find(code);
  const label = code => code === 'auto' ? 'Auto（自动检测）' : L.label(lang(code)) || code;
  const norm = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const recent = codes => L.recent(codes, L.all);
  function groups(model, query, history, current = 'auto') {
    const enabled = codes(model).slice();
    if (!enabled.length && lang(current)) enabled.push(current);
    const match = l => norm(l.code + ' ' + l.name + ' ' + l.native).includes(norm(query));
    const used = recent(history).filter(c => enabled.includes(c));
    const auto = {code:'auto', name:'Auto', native:'自动检测'};
    return [
      {key:'recent', label:'最近使用', items:used.map(lang).filter(match)},
      {key:'all', label:'可选语言', items:[auto, ...L.all.filter(l => enabled.includes(l.code) && !used.includes(l.code)).sort((a,b) => a.name.localeCompare(b.name,'en'))].filter(match)},
    ];
  }
  /* 框下那一行说明。MOSS 多说一句：指定后按该语言逐字转写，选错会得到译文。 */
  const note = model => {
    const n = codes(model).length;
    if (!n) return '此服务尚未声明语言范围；保留当前语言提示，由服务端校验。';
    return modelId(model) === 'moss-transcribe-diarize'
      ? `可指定 ${n} 种语言，默认 Auto 自动检测；指定后 MOSS 按该语言逐字转写，请与音频语言一致。`
      : `可指定 ${n} 种语言，也可以使用 Auto 自动检测。`;
  };
  const api = {data,codes,resolve,lang,label,recent,groups,note};
  if (typeof module !== 'undefined') module.exports=api; else root.BC_ASR_LANG=api;
})(typeof window !== 'undefined' ? window : globalThis);
