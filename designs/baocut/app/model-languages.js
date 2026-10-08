/* 全 App 唯一的语言目录，镜像 `bcut-lang`（`ALL` / `TRANSLATE` / `WHISPER` / `QWEN` /
   `TTS_ENGINES` / `DUB`）。**谁也别另带一份语言表**：翻译目标、转录源语、配音语言、
   术语库语言方向都是「这份目录 ∩ 一张能力表」，名字、次序、别名归一只有这里一处。
   `languages`（= `translate`，目录前 31 条）是翻译目录，`all` 是含语音模型专有语言的全表。 */
(function(root) {
  const all = [{"code":"zh","name":"Chinese (Simplified)","native":"简体中文"},{"code":"en","name":"English","native":"English"},{"code":"zh-Hant","name":"Chinese (Traditional)","native":"繁體中文"},{"code":"es","name":"Spanish","native":"Español"},{"code":"ja","name":"Japanese","native":"日本語"},{"code":"fr","name":"French","native":"Français"},{"code":"de","name":"German","native":"Deutsch"},{"code":"ko","name":"Korean","native":"한국어"},{"code":"pt","name":"Portuguese (Brazil)","native":"Português"},{"code":"it","name":"Italian","native":"Italiano"},{"code":"ru","name":"Russian","native":"Русский"},{"code":"ar","name":"Arabic","native":"العربية"},{"code":"hi","name":"Hindi","native":"हिन्दी"},{"code":"id","name":"Indonesian","native":"Indonesia"},{"code":"vi","name":"Vietnamese","native":"Tiếng Việt"},{"code":"tr","name":"Turkish","native":"Türkçe"},{"code":"nl","name":"Dutch","native":"Nederlands"},{"code":"pl","name":"Polish","native":"Polski"},{"code":"uk","name":"Ukrainian","native":"Українська"},{"code":"sv","name":"Swedish","native":"Svenska"},{"code":"th","name":"Thai","native":"ไทย"},{"code":"pt-PT","name":"Portuguese (Portugal)","native":"Português"},{"code":"el","name":"Greek","native":"Ελληνικά"},{"code":"he","name":"Hebrew","native":"עברית"},{"code":"cs","name":"Czech","native":"Čeština"},{"code":"ro","name":"Romanian","native":"Română"},{"code":"fi","name":"Finnish","native":"Suomi"},{"code":"hu","name":"Hungarian","native":"Magyar"},{"code":"da","name":"Danish","native":"Dansk"},{"code":"no","name":"Norwegian","native":"Norsk"},{"code":"ms","name":"Malay","native":"Melayu"},{"code":"ca","name":"Catalan","native":"català"},{"code":"ta","name":"Tamil","native":"தமிழ்"},{"code":"ur","name":"Urdu","native":"اردو"},{"code":"hr","name":"Croatian","native":"hrvatski"},{"code":"bg","name":"Bulgarian","native":"български"},{"code":"lt","name":"Lithuanian","native":"lietuvių"},{"code":"la","name":"Latin","native":"Latin"},{"code":"mi","name":"Māori","native":"Māori"},{"code":"ml","name":"Malayalam","native":"മലയാളം"},{"code":"cy","name":"Welsh","native":"Cymraeg"},{"code":"sk","name":"Slovak","native":"slovenčina"},{"code":"te","name":"Telugu","native":"తెలుగు"},{"code":"fa","name":"Persian","native":"فارسی"},{"code":"lv","name":"Latvian","native":"latviešu"},{"code":"bn","name":"Bangla","native":"বাংলা"},{"code":"sr","name":"Serbian","native":"српски"},{"code":"az","name":"Azerbaijani","native":"azərbaycan"},{"code":"sl","name":"Slovenian","native":"slovenščina"},{"code":"kn","name":"Kannada","native":"ಕನ್ನಡ"},{"code":"et","name":"Estonian","native":"eesti"},{"code":"mk","name":"Macedonian","native":"македонски"},{"code":"br","name":"Breton","native":"brezhoneg"},{"code":"eu","name":"Basque","native":"euskara"},{"code":"is","name":"Icelandic","native":"íslenska"},{"code":"hy","name":"Armenian","native":"հայերեն"},{"code":"ne","name":"Nepali","native":"नेपाली"},{"code":"mn","name":"Mongolian","native":"монгол"},{"code":"bs","name":"Bosnian","native":"bosanski"},{"code":"kk","name":"Kazakh","native":"қазақ тілі"},{"code":"sq","name":"Albanian","native":"shqip"},{"code":"sw","name":"Swahili","native":"Kiswahili"},{"code":"gl","name":"Galician","native":"galego"},{"code":"mr","name":"Marathi","native":"मराठी"},{"code":"pa","name":"Punjabi","native":"ਪੰਜਾਬੀ"},{"code":"si","name":"Sinhala","native":"සිංහල"},{"code":"km","name":"Khmer","native":"ខ្មែរ"},{"code":"sn","name":"Shona","native":"chiShona"},{"code":"yo","name":"Yoruba","native":"Èdè Yorùbá"},{"code":"so","name":"Somali","native":"Soomaali"},{"code":"af","name":"Afrikaans","native":"Afrikaans"},{"code":"oc","name":"Occitan","native":"occitan"},{"code":"ka","name":"Georgian","native":"ქართული"},{"code":"be","name":"Belarusian","native":"беларуская"},{"code":"tg","name":"Tajik","native":"тоҷикӣ"},{"code":"sd","name":"Sindhi","native":"سنڌي"},{"code":"gu","name":"Gujarati","native":"ગુજરાતી"},{"code":"am","name":"Amharic","native":"አማርኛ"},{"code":"yi","name":"Yiddish","native":"ייִדיש"},{"code":"lo","name":"Lao","native":"ລາວ"},{"code":"uz","name":"Uzbek","native":"o‘zbek"},{"code":"fo","name":"Faroese","native":"føroyskt"},{"code":"ht","name":"Haitian Creole","native":"Haitian Creole"},{"code":"ps","name":"Pashto","native":"پښتو"},{"code":"tk","name":"Turkmen","native":"türkmen dili"},{"code":"nn","name":"Norwegian Nynorsk","native":"norsk nynorsk"},{"code":"mt","name":"Maltese","native":"Malti"},{"code":"sa","name":"Sanskrit","native":"संस्कृत भाषा"},{"code":"lb","name":"Luxembourgish","native":"Lëtzebuergesch"},{"code":"my","name":"Burmese","native":"မြန်မာ"},{"code":"bo","name":"Tibetan","native":"བོད་སྐད་"},{"code":"tl","name":"Tagalog","native":"Tagalog"},{"code":"mg","name":"Malagasy","native":"Malagasy"},{"code":"as","name":"Assamese","native":"অসমীয়া"},{"code":"tt","name":"Tatar","native":"татар"},{"code":"haw","name":"Hawaiian","native":"ʻŌlelo Hawaiʻi"},{"code":"ln","name":"Lingala","native":"lingála"},{"code":"ha","name":"Hausa","native":"Hausa"},{"code":"ba","name":"Bashkir","native":"башҡорт"},{"code":"jw","name":"Javanese","native":"Basa Jawa"},{"code":"su","name":"Sundanese","native":"Basa Sunda"},{"code":"yue","name":"Cantonese","native":"粵語"},{"code":"fil","name":"Filipino","native":"Filipino"}];
  const TRANSLATE_LEN = 31;
  /* 翻译目录：目录的前 31 条，次序沿用 Mac。`languages` 是它的旧名。 */
  const translate = all.slice(0, TRANSLATE_LEN);
  /* 能力表：某只模型 / 引擎认哪些语言。只列 code，名字一律回目录里取。 */
  const whisper = ["en","zh","de","es","ru","ko","fr","ja","pt","tr","pl","ca","nl","ar","sv","it","id","hi","fi","vi","he","uk","el","ms","cs","ro","da","hu","ta","no","th","ur","hr","bg","lt","la","mi","ml","cy","sk","te","fa","lv","bn","sr","az","sl","kn","et","mk","br","eu","is","hy","ne","mn","bs","kk","sq","sw","gl","mr","pa","si","km","sn","yo","so","af","oc","ka","be","tg","sd","gu","am","yi","lo","uz","fo","ht","ps","tk","nn","mt","sa","lb","my","bo","tl","mg","as","tt","haw","ln","ha","ba","jw","su","yue"];
  const qwen = ["zh","en","yue","ar","de","fr","es","pt","id","it","ko","ru","th","vi","ja","tr","hi","ms","nl","sv","da","fi","pl","cs","fil","fa","el","ro","hu","mk"];
  const ttsEngines = [{"id":"qwen3","langs":["zh","en","ja","ko","de","fr","es","it","pt","ru"]},{"id":"qwen3-1.7b","langs":["zh","en","ja","ko","de","fr","es","it","pt","ru"]},{"id":"indextts2","langs":["zh","en"]},{"id":"indextts25","langs":["zh","en","ja","es","ar"]},{"id":"gptsovits","langs":["zh","en"]},{"id":"voxcpm2","langs":["zh","en","ja","ko","yue","ar","my","da","nl","fi","fr","de","el","he","hi","id","it","km","lo","ms","no","pl","pt","ru","es","sw","sv","tl","th","tr","vi"]},{"id":"omnivoice","langs":whisper}];
  /* 「先翻译再配」默认摆出来的配音目标语言。 */
  const dub = ["en","ja","ko","zh","de","fr","es"];
  const RECENT_CAP = 5;
  const label = l => l ? `${l.name}（${l.native}）` : '';
  const normalize = s => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  /* 最近使用：去重、只留目录里有的、最多 RECENT_CAP 条。`domain` 默认翻译目录，
     转录那边传全表（语音模型认的语言比翻译目录多）。 */
  function recent(codes, domain) {
    const rows = domain || translate;
    return [...new Set(Array.isArray(codes) ? codes : [])].filter(c => rows.some(l => l.code === c)).slice(0, RECENT_CAP);
  }
  /* `only`：只列这些 code（配音按 TTS 引擎会念的语言收窄；给 null 就是翻译目录） */
  function groups(query, codes, only) {
    const q = normalize(query);
    const rows = Array.isArray(only) ? all.filter(l => only.includes(l.code)) : translate;
    const matches = l => normalize(l.code + ' ' + l.name + ' ' + l.native).includes(q);
    const used = recent(codes, rows);
    return [
      {key: 'recent', items: used.map(c => rows.find(l => l.code === c)).filter(matches)},
      {key: 'all', items: rows.filter(l => !used.includes(l.code) && matches(l)).sort((a,b) => a.name.localeCompare(b.name, 'en'))},
    ];
  }
  /* 别处拿到的 code（`zh-Hans`、`zh_CN`、`en-US`、`pt-BR`）归到目录里的那一条：先整条比，再按中文的
     简繁别名，最后退到主语种。认不出的返回 null，由调用方原样显示，绝不悄悄落到目录首项。 */
  const ALIAS = {'zh-hans': 'zh', 'zh-cn': 'zh', 'zh-sg': 'zh', 'zh-tw': 'zh-Hant', 'zh-hk': 'zh-Hant', 'zh-mo': 'zh-Hant', 'pt-br': 'pt'};
  function find(code) {
    const raw = String(code || '').trim().replace(/_/g, '-');
    if (!raw) return null;
    const lower = raw.toLowerCase();
    return all.find(l => l.code.toLowerCase() === lower)
      || all.find(l => l.code === ALIAS[lower])
      || all.find(l => l.code.toLowerCase() === lower.split('-')[0]) || null;
  }
  const canon = code => (find(code) || {code: String(code || '')}).code;
  /** 窄处用的短名：只要母语写法（`简体中文`、`English`）。目录里没有的 code 原样显示。 */
  const native = code => (find(code) || {native: String(code || '')}).native;
  /* 这只 TTS 引擎会念的语言主码；认不出的 id 按表头那只算。 */
  const ttsLangs = engine => (ttsEngines.find(e => e.id === engine) || ttsEngines[0]).langs;
  /* 语音模型参数的归一（与 `find` 不是一回事）：折到主语种，再把 ISO-639-2/3 的写法折成
     模型认的两字母码。语音模型不区分繁简，这一段**必须**折。 */
  const ASR_ALIAS = {jv: 'jw', cmn: 'zh', zho: 'zh', eng: 'en', jpn: 'ja', kor: 'ko'};
  function asrCanon(raw) {
    const base = String(raw || '').trim().toLowerCase().replaceAll('_', '-').split('-')[0];
    return ASR_ALIAS[base] || base;
  }
  const api = {all, translate, languages: translate, TRANSLATE_LEN, whisper, qwen, ttsEngines, dub, RECENT_CAP,
    label, recent, groups, find, canon, native, ttsLangs, asrCanon};
  if (typeof module !== 'undefined') module.exports = api;
  else root.BC_LANGUAGES = api;
})(typeof window !== 'undefined' ? window : globalThis);
