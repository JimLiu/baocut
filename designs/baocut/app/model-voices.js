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

  /** 参考段规整到 5–10 秒：落在克隆引擎建议窗 [3, 15] 里，也在 Fish Audio S2 Pro 的 30 秒上限之内，
   *  所以一段参考对每只引擎都合规。麦克风：目标 8 秒，12 秒自动停，短于 5 秒不给存。 */
  const REC = {min: 5, target: 8, max: 12};
  const WINDOW = {min: 5, max: 10};

  /* ---------- 采集流程（2026-10-14 重做）：一段样本 + 一段授权 ----------
     以前只录 5–12 秒照念一句；现在录的是**样本**：目标 30 秒（计时器到 30 自动停），麦克风或上传都行。
     本地引擎的 5–10 秒参考段从样本里截（前面那句台词，原文已知）；云端要长样本的（MiniMax ≥ 10、Gemini 10–30、
     ElevenLabs 建议 60）直接用整段。要**第二段录音**的只有 Gemini：同一个人念一句固定的授权声明
     （接口核对两段是不是同一个人），声明有语言之分——实测中文常验不过，英文稳，所以语言是一个选项、英文是推荐值。
     2026-11-08：30 秒一到就停常把人截在半句话上。现在样本最长 3 分钟（`max`），不在 30 秒停；进度条按 30 秒目标填满，
     过了 30 秒说「够了，想多说就接着说」，只在最后 10 秒（`countdown`）倒数。各家只收自己那一段：Google Gemini 收 10–30 秒
     （能力视图的 `voiceClone.sourceSeconds`），样本更长时明说「用前 30 秒」，由后端在停顿处截。 */
  const SAMPLE = {min: 5, good: 10, target: 30, max: 180, countdown: 10};
  const CONSENT_REC = {min: 3, target: 8, max: 15};
  /** 授权声明原文：Google 官方表里的 30 个地区语言（`code` 是接口收的 `language_code`，同一语言的几个地区原文相同）。
   *  `verified` 是实测能过：只有英文稳；简体中文实测常验不过，其余没测过。除了表里的还能自定义一句（`custom`）——
   *  Google 只认表里的原文，自定义的留给别家或将来的提供方。 */
  const CONSENT_PHRASES = [
    {code: 'en-US', label: 'English', region: '美国', text: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.', verified: true, recommended: true},
    {code: 'zh-CN', label: '简体中文', text: '我是此声音的拥有者并授权谷歌使用此声音创建语音合成模型', verified: false, note: '实测常验不过 · 不急就念英文'},
    {code: 'en-GB', label: 'English', region: '英国', text: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.'},
    {code: 'en-IN', label: 'English', region: '印度', text: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.'},
    {code: 'en-AU', label: 'English', region: '澳大利亚', text: 'I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model.'},
    {code: 'ja-JP', label: '日本語', text: '私はこの音声の所有者であり、Googleがこの音声を使用して音声合成モデルを作成することを承認します。'},
    {code: 'ko-KR', label: '한국어', text: '나는 이 음성의 소유자이며 구글이 이 음성을 사용하여 음성 합성 모델을 생성할 것을 허용합니다.'},
    {code: 'fr-FR', label: 'Français', region: '法国', text: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique."},
    {code: 'fr-CA', label: 'Français', region: '加拿大', text: "Je suis le propriétaire de cette voix et j'autorise Google à utiliser cette voix pour créer un modèle de voix synthétique."},
    {code: 'de-DE', label: 'Deutsch', text: 'Ich bin der Eigentümer dieser Stimme und bin damit einverstanden, dass Google diese Stimme zur Erstellung eines synthetischen Stimmmodells verwendet.'},
    {code: 'es-ES', label: 'Español', region: '西班牙', text: 'Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.'},
    {code: 'es-US', label: 'Español', region: '美国', text: 'Soy el propietario de esta voz y doy mi consentimiento para que Google la utilice para crear un modelo de voz sintética.'},
    {code: 'it-IT', label: 'Italiano', text: 'Sono il proprietario di questa voce e acconsento che Google la utilizzi per creare un modello di voce sintetica.'},
    {code: 'pt-BR', label: 'Português', region: '巴西', text: 'Eu sou o proprietário desta voz e autorizo o Google a usá-la para criar um modelo de voz sintética.'},
    {code: 'ru-RU', label: 'Русский', text: 'Я являюсь владельцем этого голоса и даю согласие Google на использование этого голоса для создания модели синтетического голоса.'},
    {code: 'nl-NL', label: 'Nederlands', text: 'Ik ben de eigenaar van deze stem en ik geef Google toestemming om deze stem te gebruiken om een synthetisch stemmodel te maken.'},
    {code: 'pl-PL', label: 'Polski', text: 'Jestem właścicielem tego głosu i wyrażam zgodę na wykorzystanie go przez Google w celu utworzenia syntetycznego modelu głosu.'},
    {code: 'tr-TR', label: 'Türkçe', text: "Bu sesin sahibi benim ve Google'ın bu sesi kullanarak sentetik bir ses modeli oluşturmasına izin veriyorum."},
    {code: 'id-ID', label: 'Indonesia', text: 'Saya pemilik suara ini dan saya menyetujui Google menggunakan suara ini untuk membuat model suara sintetis.'},
    {code: 'vi-VN', label: 'Tiếng Việt', text: 'Tôi là chủ sở hữu giọng nói này và tôi đồng ý cho Google sử dụng giọng nói này để tạo mô hình giọng nói tổng hợp.'},
    {code: 'th-TH', label: 'ไทย', text: 'ฉันเป็นเจ้าของเสียงนี้ และฉันยินยอมให้ Google ใช้เสียงนี้เพื่อสร้างแบบจำลองเสียงสังเคราะห์'},
    {code: 'ar-XA', label: 'العربية', text: 'أنا مالك هذا الصوت وأوافق على أن تستخدم Google هذا الصوت لإنشاء نموذج صوتي اصطناعي.'},
    {code: 'hi-IN', label: 'हिन्दी', text: 'मैं इस आवाज का मालिक हूं और मैं सिंथेटिक आवाज मॉडल बनाने के लिए Google को इस आवाज का उपयोग करने की सहमति देता हूं'},
    {code: 'bn-IN', label: 'বাংলা', text: 'আমি এই ভয়েসের মালিক এবং আমি একটি সিন্থেটিক ভয়েস মডেল তৈরি করতে এই ভয়েস ব্যবহার করে Google-এর সাথে সম্মতি দিচ্ছি।'},
    {code: 'gu-IN', label: 'ગુજરાતી', text: 'હું આ વોઈસનો માલિક છું અને સિન્થેટિક વોઈસ મોડલ બનાવવા માટે આ વોઈસનો ઉપયોગ કરીને google ને હું સંમતિ આપું છું'},
    {code: 'kn-IN', label: 'ಕನ್ನಡ', text: 'ನಾನು ಈ ಧ್ವನಿಯ ಮಾಲಿಕ ಮತ್ತು ಸಂಶ್ಲೇಷಿತ ಧ್ವನಿ ಮಾದರಿಯನ್ನು ರಚಿಸಲು ಈ ಧ್ವನಿಯನ್ನು ಬಳಸಿಕೊಂಡುಗೂಗಲ್ ಗೆ ನಾನು ಸಮ್ಮತಿಸುತ್ತೇನೆ.'},
    {code: 'ml-IN', label: 'മലയാളം', text: 'ഈ ശബ്ദത്തിന്റെ ഉടമ ഞാനാണ്, ഒരു സിന്തറ്റിക് വോയ്സ് മോഡൽ സൃഷ്ടിക്കാൻ ഈ ശബ്ദം ഉപയോഗിക്കുന്നതിന് ഞാൻ Google-ന് സമ്മതം നൽകുന്നു.'},
    {code: 'mr-IN', label: 'मराठी', text: 'मी या आवाजाचा मालक आहे आणि सिंथेटिक व्हॉइस मॉडेल तयार करण्यासाठी हा आवाज वापरण्यासाठी मी Google ला संमती देतो'},
    {code: 'ta-IN', label: 'தமிழ்', text: 'நான் இந்த குரலின் உரிமையாளர் மற்றும் செயற்கை குரல் மாதிரியை உருவாக்க இந்த குரலை பயன்படுத்த குகல்க்கு நான் ஒப்புக்கொள்கிறேன்.'},
    {code: 'te-IN', label: 'తెలుగు', text: 'నేను ఈ వాయిస్ యజమానిని మరియు సింతటిక్ వాయిస్ మోడల్ ని రూపొందించడానికి ఈ వాయిస్ ని ఉపయోగించడానికి googleకి నేను సమ్మతిస్తున్నాను.'},
  ];
  /** 采集页上直接给芯片的两种；其余在「更多语言」里 */
  const CONSENT_COMMON = ['en-US', 'zh-CN'];
  const CONSENT_ALIAS = {en: 'en-US', zh: 'zh-CN'};
  /** 一种声明：表里的按 `code` 找（旧档里的 `en` / `zh` 也认）；`custom` 回自定义的那句（`customText`），没有就回英文 */
  function consentPhrase(code, customText) {
    if (code === 'custom') return {code: 'custom', label: '自定义', text: String(customText || '').trim(), custom: true};
    const c = CONSENT_ALIAS[code] || code;
    return CONSENT_PHRASES.find((x) => x.code === c) || CONSENT_PHRASES[0];
  }
  /** 声明的显示名：`English（美国）` / `简体中文` / `自定义` */
  const phraseLabel = (ph) => (ph.region ? `${ph.label}（${ph.region}）` : ph.label);
  /** 「更多语言」菜单的项：表里除常用两种之外的，按原表次序；`sub` 是地区码 */
  const consentMore = () => CONSENT_PHRASES.filter((c) => CONSENT_COMMON.indexOf(c.code) < 0).map((c) => ({code: c.code, label: phraseLabel(c), sub: c.code}));
  /** 秒数的说法：`30 秒` / `3 分钟` / `1 分 30 秒` */
  function secLabel(n) {
    const s = Math.round(+n || 0);
    if (s < 60) return `${s} 秒`;
    const m = Math.floor(s / 60);
    return s % 60 ? `${m} 分 ${s % 60} 秒` : `${m} 分钟`;
  }
  /** 录音进行中那一句与进度条。有 `countdown` 的（样本）进度条按目标填满，过了目标说够了、可以接着说，只在最后几秒倒数；
   *  没有的（授权声明）照旧数还能录几秒。回 {text, pct}，`pct` 是 0–100 */
  function liveHint(seconds, spec) {
    const sp = spec || SAMPLE;
    const s = Math.max(0, +seconds || 0);
    const left = Math.max(0, sp.max - s);
    const pct = Math.min(100, (s / (sp.countdown ? sp.target : sp.max)) * 100);
    let text;
    if (s < sp.min) text = `还差 ${(sp.min - s).toFixed(1)} 秒`;
    else if (left <= 0.05) text = '到点自动停';
    else if (sp.countdown && left <= sp.countdown) text = `还能录 ${Math.ceil(left)} 秒`;
    else if (s < sp.target) text = `够了 · 到 ${secLabel(sp.target)}最好`;
    else if (sp.countdown) text = `够了 · 想多说就接着说，最长 ${secLabel(sp.max)}`;
    else text = `还能录 ${left.toFixed(1)} 秒`;
    return {text, pct};
  }
  /** 样本停下后：`problem` 不为 null 就不给存；`short` 列出嫌它短的云端提供方（只提醒，不拦）；
   *  `trim` 列出只用前一段的（样本比这家的上限长：`Google Gemini 用前 30 秒`）。`providers` 是 [{name, clone: {min, max}}] */
  function sampleVerdict(seconds, providers) {
    const s = +seconds || 0;
    if (s < SAMPLE.min) return {problem: `只录到 ${s.toFixed(1)} 秒，至少要 ${SAMPLE.min} 秒——再来一遍`, short: [], trim: []};
    const list = (providers || []).filter((p) => p.clone);
    const short = list.filter((p) => p.clone.min && s < p.clone.min).map((p) => `${p.name} 要 ${p.clone.min} 秒以上`);
    const trim = list.filter((p) => p.clone.max && s > p.clone.max).map((p) => `${p.name} 用前 ${secLabel(p.clone.max)}`);
    const base = s < SAMPLE.good ? '够本地引擎用了 · 再长一点云端也能用' : s < SAMPLE.target ? `够了 · 念到 ${SAMPLE.target} 秒最好` : '够了';
    return {problem: null, short, trim, line: trim.length ? `${base} · ${trim.join('，')}` : base};
  }
  /** 授权录音停下后能不能用 */
  function consentProblem(seconds) {
    const s = +seconds || 0;
    if (s < CONSENT_REC.min) return `只录到 ${s.toFixed(1)} 秒 · 把整句念完`;
    return null;
  }
  /** 录音停下后能不能存；不能就回一句原因，能就回 null（旧门槛，分人页的候选窗仍按它） */
  function takeProblem(seconds) {
    const s = +seconds || 0;
    if (s < REC.min) return `只录到 ${s.toFixed(1)} 秒，至少要 ${REC.min} 秒——照着台词再念一遍`;
    return null;
  }
  /** 30 秒样本照着念的台词：这门语言的三句示例连起来；念完可以接着随便说。第一句就是本地引擎的参考段原文 */
  function sampleScript(lang) {
    if (!TTS) return {lines: [], first: ''};
    const lines = TTS.sampleKinds(lang).map((k) => TTS.sampleLine(lang, k.k).text);
    return {lines, first: lines[0] || ''};
  }
  /** 从样本截本地引擎的参考段：前 5–10 秒，原文是第一句台词（上传的没有台词就空着，`textSource: 'none'`） */
  function referenceFromSample(seconds, firstLine) {
    const s = +seconds || 0;
    return {dur: +Math.min(WINDOW.max, Math.max(WINDOW.min, s)).toFixed(1), text: firstLine || '', textSource: firstLine ? 'script' : 'none'};
  }
  /* ---------- 克隆去哪些模型（2026-10-14 二轮：先选模型，再录） ----------
     `target` = {kind: 'local', id: <engine id>, name} 或 {kind: 'cloud', id: <provider id>, name, consent, connected}。
     本机引擎总能用（种子就在本机）；云端列能克隆的提供方，没连密钥的也能先选——先把样本与授权声明录好，连上后在音色的 ⋯ 里上传。 */
  function cloneTargets(engineChips, providers, saved) {
    const local = (engineChips || []).filter((c) => c.ok).map((c) => ({kind: 'local', id: c.id, name: c.name}));
    const cloud = (providers || []).filter((p) => p.clone).map((p) => ({kind: 'cloud', id: p.id, name: p.name, consent: !!p.clone.consent, connected: !saved || saved.indexOf(p.id) >= 0}));
    return local.concat(cloud);
  }
  /** 采集页的步骤：选模型 → 样本 →（选中的目标里有要授权声明的才有）授权 → 保存；`needed` 点名谁要它 */
  function cloneSteps(targets) {
    const needed = (targets || []).filter((t) => t.consent).map((t) => t.name);
    const steps = [{k: 'models', label: '选模型'}, {k: 'sample', label: '录样本'}];
    if (needed.length) steps.push({k: 'consent', label: '授权声明', needed});
    steps.push({k: 'save', label: '保存'});
    return steps;
  }

  /* ---------- 存好就上传（2026-11-08） ----------
     以前存音色只存在本机，云端克隆藏在 ⋯ →「上传到 X」→ 确认，保存那一步还说「第一次用时建」（并不会：
     architecture-design §5.9，没有有效克隆的合成以 VOICE_CLONE_REQUIRED 拒绝）。现在选了哪家云端、前提齐了，点保存就上传；
     没齐的那一行照实说不上传和为什么。云端只在它就是入口那只模型时预选——存好就上传之后，替人勾上别家等于替人把声音发出去。 */

  /** 采集页一开始勾哪些：本机引擎照旧全勾，云端只勾入口那一家（从模型页「克隆一只」过来时的 `entryId`） */
  function initialPicks(targets, entryId) {
    return (targets || []).filter((t) => t.kind === 'local' || t.id === entryId).map((t) => t.id);
  }
  /** 从某只云端模型过来：直接从「录样本」开始（第一步还能点「上一步」回去改） */
  const startStep = (targets, entryId) => ((targets || []).some((t) => t.kind === 'cloud' && t.id === entryId) ? 1 : 0);
  const sampleWhat = (s, spec) => (spec.max && s > spec.max ? `样本前 ${secLabel(spec.max)}` : `样本 ${(+s).toFixed(1)} 秒`);

  /** 保存那一步：每个选中的模型落到哪、点保存会上传到哪几家、主按钮写什么、按钮旁那句外发说明。
   *  `chosen` 是 cloneTargets 里选中的；`o` = {declared, sampleDur, refDur, consentClip: {dur} | null, consentCustom, providers}
   *  （providers 给云端的 clone 规格；consentCustom = 授权声明念的是自定义的一句）。
   *  一家云端能上传要四样都齐：连着密钥、勾了本人声明（§5.9：没有声明不上传）、样本够这家的下限、要授权声明的录了官方原文那段。 */
  function savePlan(chosen, o) {
    const opt = o || {};
    const s = +opt.sampleDur || 0;
    const clip = opt.consentClip && opt.consentClip.dur > 0 ? +opt.consentClip.dur : 0;
    const rows = [];
    const local = (chosen || []).filter((t) => t.kind === 'local');
    if (local.length) {
      rows.push({id: 'local', kind: 'local', name: '本机', k: 'local', tone: 'neutral',
        line: `${local.map((t) => t.name).join(' / ')} · 用样本前 ${opt.refDur || WINDOW.max} 秒当参考段，每只引擎一颗种子`});
    }
    const uploads = [];
    (chosen || []).filter((t) => t.kind === 'cloud').forEach((t) => {
      const p = (opt.providers || []).find((x) => x.id === t.id);
      const spec = (p && p.clone) || {};
      const row = {id: t.id, kind: 'cloud', name: t.name};
      if (!t.connected) {
        Object.assign(row, {k: 'offline', tone: 'neutral', chip: '先不上传', line: `没连上 ${t.name} 的密钥 · 先存在本机，连上后在这只音色的 ⋯ 里上传`});
      } else if (!opt.declared) {
        Object.assign(row, {k: 'undeclared', tone: 'notice', chip: '不上传', line: '没勾「这是我自己的声音」· 不发给任何第三方；勾上就一起上传'});
      } else if (spec.min && s < spec.min) {
        Object.assign(row, {k: 'short', tone: 'notice', chip: '不上传', line: `样本只有 ${s.toFixed(1)} 秒，${t.name} 要 ${spec.min} 秒以上 · 回「录样本」录长一点`});
      } else if (t.consent && !clip) {
        Object.assign(row, {k: 'no-consent', tone: 'notice', chip: '不上传', line: `跳过了授权声明，${t.name} 没有它建不了 · 以后在这只音色的 ⋯ 里补录`});
      } else if (t.consent && opt.consentCustom) {
        Object.assign(row, {k: 'custom-consent', tone: 'notice', chip: '不上传', line: `${t.name} 只认官方原文，自定义的授权声明验不过 · 回「授权声明」换一种语言`});
      } else {
        const trimmed = spec.max && s > spec.max;
        const what = sampleWhat(s, spec) + (t.consent ? `和授权声明（${clip.toFixed(1)} 秒）` : '');
        Object.assign(row, {k: 'upload', tone: 'positive', chip: '保存后上传', what,
          line: `保存后马上上传${what}${trimmed ? '，截在停顿处' : ''} · 建好记下 voice id`});
        uploads.push(row);
      }
      rows.push(row);
    });
    const names = uploads.map((r) => r.name);
    return {
      rows, uploads: uploads.map((r) => r.id),
      button: names.length ? `保存并上传到 ${names.length > 2 ? `${names.length} 家` : names.join('、')}` : '保存音色',
      outflow: names.length
        ? `会把${uploads.map((r) => `${r.what}发给 ${r.name}`).join('，')}，用来建克隆；其余都留在这台电脑上。`
        : '只存在这台电脑上，不发给任何服务商。',
    };
  }

  /* ---------- 上传中 / 建好 / 没建成 ----------
     上传是一次任务（§5.9 `library.createVoiceClone`，kind: voiceClone）。原型把进度记在音色上：
     `cloneRun: {<provider>: {state: 'uploading' | 'ready' | 'failed', error?}}`；建好就落进 `cloud.<provider>`（voice id），
     这一项留成 ready 让行上报一声「建好了」，用户点「知道了」（dismiss）才清掉。 */
  const CLONE_ETA = '一般半分钟内建好';
  /** 这只音色在某家：uploading / failed / ready / null（没建过也没在建） */
  function cloneState(v, providerId) {
    const run = v && v.cloneRun && v.cloneRun[providerId];
    if (run) return run.state;
    return v && v.cloud && v.cloud[providerId] && v.cloud[providerId].voiceId ? 'ready' : null;
  }
  /** 这次会话里在建、刚建好或没建成的那几家（行上要报的）：[{id, state, error}] */
  const cloneRuns = (v) => Object.keys((v && v.cloneRun) || {}).map((id) => Object.assign({id}, v.cloneRun[id]));
  /** 状态变换，回音色的补丁：start 开始上传；ready 建好（`o.voiceId` 可给，落进 cloud）；fail 没建成（`o.error`）；dismiss 收起 */
  function cloneAfter(v, providerId, action, o) {
    const run = Object.assign({}, (v && v.cloneRun) || {});
    const patch = {};
    if (action === 'start') run[providerId] = {state: 'uploading'};
    else if (action === 'fail') run[providerId] = {state: 'failed', error: (o && o.error) || {}};
    else if (action === 'ready') run[providerId] = {state: 'ready'};
    else delete run[providerId];
    if (action === 'ready') patch.cloud = CLOUD().bindAfter(v, providerId, 'upload', Object.assign({at: '刚刚'}, o || {}));
    patch.cloneRun = run;
    return patch;
  }

  /* ---------- 没建成：原因 → 怎么办 → 一键去做 ----------
     不把服务商的英文原话甩给人：先用大白话说原因，再给能照着做的办法，再给一个按钮直接去做；原话只当小字附在最后。
     `err` = {code?, reason?, message?}：`reason` 是适配器归好的类（`PROVIDER_REJECTED` 的 `details.reason`，命令协议规范），`code` 是 Runtime 的错误码；
     认不出的拒绝不带 `reason`，落到按这家要求排的自查清单。
     `action.k`：consent（重录授权声明，存好自动重新上传）/ sample（录新样本）/ retry / provider（打开这家的设置）/ grant（同意外发并上传）。 */
  function cloneChecklist(p) {
    const spec = (p && p.clone) || {};
    const range = spec.min && spec.max ? `${spec.min}–${spec.max} 秒` : spec.min ? `${spec.min} 秒以上` : '十几秒';
    const list = [`样本是 ${range}干净、自然的说话`, '从头到尾只有一个成年人在说', '在安静的房间录，没有音乐和回声'];
    if (spec.consent) list.push('样本和授权声明用同一只麦克风、在同一个房间录', '授权声明一字不差照着原文念');
    return list;
  }
  function cloneFailure(err, provider) {
    const e = err || {};
    const p = provider || {name: '服务商', clone: {}};
    const n = p.name;
    const spec = p.clone || {};
    const google = p.id === 'google';
    const studio = google ? 'Google AI Studio' : `${n} 的后台`;
    const range = spec.min && spec.max ? `${spec.min}–${spec.max} 秒` : `${spec.min || 10} 秒以上`;
    const reConsent = {k: 'consent', label: '重录授权声明', sub: '存好后自动重新上传'};
    const newSample = {k: 'sample', label: '录新样本', sub: '存好后自动重新上传'};
    const retry = {k: 'retry', label: '重试'};
    const settings = {k: 'provider', label: `打开 ${n} 设置`};
    const REASONS = {
      'speaker-mismatch': {title: '两段录音不像同一个人', cause: `${n} 把样本和授权声明对了一下，判断不是同一个人说的。`,
        advice: ['请样本里的那个人自己念授权声明', '和样本用同一只麦克风、在同一个房间录，离麦克风的距离也差不多'], action: reConsent},
      'consent-unrecognized': {title: '没听出授权声明', cause: `${n} 没在这段录音里认出官方那句授权声明。`,
        advice: ['照着原文一字不差念完整句，不加不减', '念英文最稳；中文实测常验不过'], action: reConsent},
      'source-duration': {title: '样本长度不合要求', cause: `${n} 只收 ${range}的说话，太短或太长都会退回。`,
        advice: ['用麦克风录一段新样本，连着说 20 秒以上', '开头和结尾别留长段静音，中间别停太久',
          spec.max ? `上传的文件先剪到 ${spec.max} 秒以内（录的会自动截）` : '上传的文件先剪短一些'], action: newSample},
      'synthetic-audio': {title: '样本听起来不像真人录音', cause: `${n} 只收真人现录的声音，不收 AI 生成或带数字水印的音频。`,
        advice: ['用麦克风现录一段', '别用配音成品、别家生成的语音'], action: newSample},
      'audio-invalid': {title: '这段音频读不了', cause: `${n} 不接受这段音频的格式或大小。`,
        advice: ['换成 WAV、MP3 或 FLAC，20 MB 以内', '或者直接用麦克风录'], action: newSample},
      'voice-limit': {title: '音色存满了', cause: google ? 'Google Gemini 每个 API 项目最多存 200 只音色，这个项目已经满了。' : `${n} 账户里的音色数到上限了。`,
        advice: [`到 ${studio} 删掉用不着的音色，再回来重试`], action: retry},
      'feature-unavailable': {title: '这把密钥还不能克隆声音', cause: google ? 'Google Gemini 的复刻音色只对付费层级（Tier 1 及以上）的 API 项目开放。' : `${n} 的这个账户没开通克隆。`,
        advice: [google ? '在 Google AI Studio 给这个项目开通结算，或换一把付费项目的密钥' : `在 ${n} 开通克隆，或换一把能用的密钥`], action: settings},
    };
    const CODES = {
      PROVIDER_AUTH_FAILED: {reason: 'auth', title: '密钥不能用了', cause: `${n} 拒绝了这把密钥：可能过期、被删，或没有这项权限。`,
        advice: ['在设置里换一把能用的密钥，再回来重试'], action: settings},
      PROVIDER_QUOTA_EXCEEDED: {reason: 'quota', title: '请求太频繁', cause: `碰到了 ${n} 的频率或用量限制。`,
        advice: ['等一两分钟再重试', `常碰到就去 ${studio} 看看配额`], action: retry},
      PROVIDER_UNAVAILABLE: {reason: 'network', title: `连不上 ${n}`, cause: '网络断了，或者对方的服务暂时不可用。',
        advice: ['检查网络或代理，再重试'], action: retry},
      GRANT_REQUIRED: {reason: 'grant', title: `还没同意把录音发给 ${n}`, cause: '上传录音是一次数据外发，要先同意一次。',
        advice: [`同意一次，以后往 ${n} 发音色录音不再问`], action: {k: 'grant', label: '同意并上传'}},
    };
    const hit = (e.reason && REASONS[e.reason] && Object.assign({reason: e.reason}, REASONS[e.reason])) || (e.code && CODES[e.code]) || null;
    const d = hit || {reason: 'unknown', title: `没能在 ${n} 建好`, cause: `${n} 没说具体原因。照下面几条查一遍再试，多半能过：`,
      advice: cloneChecklist(p), action: retry};
    return Object.assign({}, d, {raw: e.message ? String(e.message) : '', code: e.code || null});
  }
  /** 演示挡位「下一次上传的结果」：原话是照服务商的口气编的演示文字 */
  const CLONE_DEMO = [
    {k: 'ok', label: '建好了'},
    {k: 'speaker-mismatch', label: '两段不像同一个人', error: {code: 'PROVIDER_REJECTED', reason: 'speaker-mismatch', message: 'Consent verification failed: the speaker in consent_audio does not match the speaker in the source audio.'}},
    {k: 'consent-unrecognized', label: '没听出授权声明', error: {code: 'PROVIDER_REJECTED', reason: 'consent-unrecognized', message: 'Consent verification failed: the consent statement was not recognized in consent_audio.'}},
    {k: 'source-duration', label: '样本说话不够', error: {code: 'PROVIDER_REJECTED', reason: 'source-duration', message: 'Source audio must contain between 10 and 30 seconds of speech.'}},
    {k: 'synthetic-audio', label: '疑似合成音频', error: {code: 'PROVIDER_REJECTED', reason: 'synthetic-audio', message: 'The provided audio appears to be synthetic or watermarked.'}},
    {k: 'audio-invalid', label: '音频读不了', error: {code: 'PROVIDER_REJECTED', reason: 'audio-invalid', message: 'Invalid audio: unsupported encoding or payload too large.'}},
    {k: 'voice-limit', label: '音色存满了', error: {code: 'PROVIDER_REJECTED', reason: 'voice-limit', message: 'Quota exceeded for stored voices per project.'}},
    {k: 'feature-unavailable', label: '密钥不能克隆', error: {code: 'PROVIDER_REJECTED', reason: 'feature-unavailable', message: 'Voice replication is not available for this API project tier.'}},
    {k: 'auth', label: '密钥失效', error: {code: 'PROVIDER_AUTH_FAILED', message: 'API key not valid. Please pass a valid API key.'}},
    {k: 'quota', label: '请求太频繁', error: {code: 'PROVIDER_QUOTA_EXCEEDED', message: 'Resource has been exhausted (e.g. check quota).'}},
    {k: 'network', label: '网络断了', error: {code: 'PROVIDER_UNAVAILABLE', message: 'fetch failed: ECONNRESET'}},
    {k: 'grant', label: '没同意外发', error: {code: 'GRANT_REQUIRED', message: 'No grant covers sending audio to this provider.'}},
    {k: 'unknown', label: '被拒但没说原因', error: {code: 'PROVIDER_REJECTED', message: 'Request contains an invalid argument.'}},
  ];
  /** 种子：本地引擎没有 voice id，靠「同一段参考 + 同一颗种子」让每次生成都是同一个人 */
  const randomSeed = () => 1 + Math.floor(Math.random() * 2147483646);
  /** 新音色的默认名字：「我的声音」，重名时依次加「 2」「 3」…，用户可以再改 */
  function defaultVoiceName(voices, base) {
    const b = base || '我的声音';
    const taken = new Set((voices || []).map((v) => String(v.name).trim()));
    if (!taken.has(b)) return b;
    let n = 2;
    while (taken.has(`${b} ${n}`)) n++;
    return `${b} ${n}`;
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
      /* 2026-10-14：`consentClip` 是本人念授权声明的那段（`consent.wav`，{lang, dur, file, at}），只有要它的提供方（Gemini）看；
         `seed` 是本地引擎的种子——有 voice id 的记 id（`cloud.<provider>.voiceId`），没有的就靠这颗种子复现 */
      consentClip: o.consentClip ? Object.assign({lang: 'en-US', at: '刚刚'}, o.consentClip, {dur: +(+o.consentClip.dur).toFixed(1)}) : null,
      seed: o.seed || randomSeed(),
      /* 二轮：一只音色在几只本机引擎上各一颗种子（`seeds: {<engine>: n}`，没写的引擎用 `seed`），云端各家各一只 voice id（`cloud`） */
      seeds: Object.assign({}, o.seeds || {}),
    };
  }

  /** 演示数据：一只麦克风录的、一只从访谈视频里挑出来的 */
  const DEMO = [
    makeVoice({id: 'v-me', name: '我自己', lang: 'zh', dur: 7.8,
      text: '欢迎使用 BaoCut！转录、翻译、配音，全都在你自己的电脑上完成。', textSource: 'script',
      source: {kind: 'mic', at: '2026-09-22'}, file: 'tts-voice-zh-male.wav', consent: 'self', createdAt: '2 天前',
      sourceDur: 29.1, referenceSha256: '9f2a7c10', seed: 48213, seeds: {indextts2: 48213, voxcpm2: 90117},
      consentClip: {lang: 'en-US', dur: 7.9, file: 'tts-voice-en-male.wav', at: '2026-10-07'},
      cloud: {google: {voiceId: 'voice_demo7q2mx', referenceSha256: '9f2a7c10', at: '2026-10-07'}}}),
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

  /** 来源一句：`麦克风 · 2 天前` / `上传 · reference_speaker.wav · 刚刚` / `第 12 期访谈.mp4 · 说话人 A · 00:00–00:11` */
  function sourceLine(v) {
    const s = v.source || {};
    if (s.kind === 'media') {
      return `${s.name || '媒体文件'}${s.speaker ? ' · 说话人 ' + s.speaker : ''} · ${fmtTime(s.start)}–${fmtTime(s.end)}`;
    }
    if (s.kind === 'import') return `导入 · ${s.name || '音色包'}`;
    if (s.kind === 'upload') return `上传 · ${s.name || '音频文件'} · ${v.createdAt || '刚刚'}`;
    return `麦克风 · ${v.createdAt || '刚刚'}`;
  }
  /** 行上的元数据：`中文 · 样本 29.1 秒 · 麦克风 · 2 天前`；没有长样本的旧音色写参考段 `中文 · 7.8 秒 · …` */
  function metaLine(v) {
    const secs = v.sourceDur > 0 ? `样本 ${(+v.sourceDur).toFixed(1)} 秒` : `${(+v.dur).toFixed(1)} 秒`;
    return `${TTS ? TTS.langLabel(v.lang) : v.lang} · ${secs} · ${sourceLine(v)}`;
  }
  /** 这只引擎上用的种子：单独给过的用那颗，否则用音色的底种子 */
  const seedFor = (v, engine) => (v && v.seeds && v.seeds[engine]) || (v ? v.seed : 0);
  /** 这只音色在各处凭什么认人：`[{kind: 'seed', id, name, value} | {kind: 'voice', id, name, value, stale}]`——
   *  本机按引擎（没单独给种子的引擎合成一条「其余引擎」），云端按已有 voice id 的提供方。`providers` 是 BC_CLOUD_TTS.providers() */
  function bindings(v, providers) {
    const out = [];
    const seeds = (v && v.seeds) || {};
    Object.keys(seeds).forEach((k) => {
      const e = TTS ? TTS.engineOf(k) : null;
      out.push({kind: 'seed', id: k, name: e && e.name ? e.name : k, value: seeds[k]});
    });
    out.push({kind: 'seed', id: '*', name: Object.keys(seeds).length ? '其余本机引擎' : '本机引擎', value: v ? v.seed : 0});
    Object.keys((v && v.cloud) || {}).forEach((k) => {
      const b = v.cloud[k];
      if (!b || !b.voiceId) return;
      const p = (providers || []).find((x) => x.id === k);
      out.push({kind: 'voice', id: k, name: p ? p.name : k, value: b.voiceId, stale: !!b.stale});
    });
    return out;
  }
  /** 行上第三行：`种子 48213（IndexTTS2 / 其余本机引擎）· 种子 90117（VoxCPM2）· Google Gemini voice_demo7q2mx · 授权声明 English 7.9 秒` */
  function idLine(v, providers) {
    const all = bindings(v, providers);
    const byValue = [];
    all.filter((b) => b.kind === 'seed').forEach((b) => {
      const hit = byValue.find((x) => x.value === b.value);
      if (hit) hit.names.push(b.name); else byValue.push({value: b.value, names: [b.name]});
    });
    const parts = byValue.map((x) => `种子 ${x.value}（${x.names.join(' / ')}）`);
    all.filter((b) => b.kind === 'voice').forEach((b) => parts.push(`${b.name} ${b.value}${b.stale ? '（参考已换）' : ''}`));
    if (v.consentClip && v.consentClip.dur > 0) parts.push(`授权声明 ${phraseLabel(consentPhrase(v.consentClip.lang, v.consentClip.text))} ${(+v.consentClip.dur).toFixed(1)} 秒`);
    return parts.join(' · ');
  }
  /** 模型页那一行：绑在这只模型上的音色——本机引擎列每只音色与它的种子，云端提供方只列已经建了 voice id 的。
   *  `target` 是 {kind: 'local', id: engine} 或 {kind: 'cloud', id: provider}；回 `[{v, value}]` */
  function voicesBoundTo(voices, target) {
    if (!target) return [];
    if (target.kind === 'cloud') {
      return (voices || []).filter((v) => v.cloud && v.cloud[target.id] && v.cloud[target.id].voiceId)
        .map((v) => ({v, value: v.cloud[target.id].voiceId}));
    }
    return (voices || []).map((v) => ({v, value: `种子 ${seedFor(v, target.id)}`}));
  }
  const CONSENT = [
    {k: 'self', label: '我自己的'},
    {k: 'permitted', label: '已获本人许可'},
    {k: 'unspecified', label: '未说明'},
  ];
  const consentLabel = (k) => (CONSENT.find((c) => c.k === k) || CONSENT[2]).label;

  /* ---------- 按引擎落地（设计稿 §5）：判据是引擎能不能吃参考音频，不装通用 ---------- */

  /** 这只引擎（原型里是「引擎族」：qwen3-1.7b 同时有 CustomVoice 与 Base）怎么用音色档。
   *  回 {ok, mode, line, why, alt}：ok 时 `mode` 是要落到的音色方式（永远是 clone），`line` 是选中后
   *  控件下写的那一句；不 ok 时 `why` 说原因、`alt` 给最近的可用做法。 */
  function profileFor(engine, voice, opt) {
    const e = TTS ? TTS.engineOf(engine) : null;
    if (e && e.cloud) {
      /* 云端：档在本地、克隆在对方（ProfileUse::Remote）——能不能用看这只音色在这家的克隆状态 */
      const C = CLOUD();
      const st = C.cloneStatus(voice || {consent: 'self', dur: 7.8}, e.provider, opt);
      /* 没建过克隆的（fix: upload）算能用：建一次就行，选择器里选它就上传 */
      return st.ok || st.fix === 'upload' ? {ok: true, mode: 'preset', line: st.line, why: null, alt: null, cloud: st}
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
  const CLONE_MODELS = ['indextts2', 'qwen3-tts-0.6b-base', 'index-tts2.5', 'qwen3-tts-1.7b-base', 'voxcpm2'];
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
      /* 种子随包走：导入的人用同一段参考 + 同一颗种子，本地引擎出的还是同一个人 */
      seed: v.seed, seeds: v.seeds && Object.keys(v.seeds).length ? v.seeds : null,
      /* 授权录音随包走（它是本人对这段声音的授权，跟着声音），远端绑定不进导出包：voice id 是这台电脑这把密钥下的，别人导入后在选择器里选它时再建 */
      consentClip: v.consentClip && v.consentClip.dur > 0 ? Object.assign({file: 'consent.wav', seconds: v.consentClip.dur, language: v.consentClip.lang}, v.consentClip.lang === 'custom' ? {text: v.consentClip.text || ''} : {}) : null,
    }, null, 2);
  }
  const bundleName = (v) => `${v.name}.bcvoice`;

  const BC_VOICES = {
    REC, WINDOW, takeProblem, makeVoice, DEMO, fmtTime, sourceLine, metaLine, idLine, bindings, seedFor, voicesBoundTo, CONSENT, consentLabel,
    SAMPLE, CONSENT_REC, CONSENT_PHRASES, CONSENT_COMMON, consentPhrase, phraseLabel, consentMore, sampleVerdict, consentProblem, sampleScript, referenceFromSample, cloneTargets, cloneSteps, randomSeed, defaultVoiceName,
    secLabel, liveHint, initialPicks, startStep, savePlan, CLONE_ETA, cloneState, cloneRuns, cloneAfter, cloneFailure, cloneChecklist, CLONE_DEMO,
    profileFor, engineChips, cloudChips, CLONE_MODELS, auditionModel, RUN_LINE,
    ISSUES, issueLabel, windowIssues, analyze, speakerLine, candidateLine, voicesFromPicks, saveLabel, STEPS,
    pickerGroups, valueLabel, valueOfForm, applyToForm, exportBundle, bundleName,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_VOICES});
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_VOICES;
})();
