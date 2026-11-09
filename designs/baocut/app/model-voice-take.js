/* 一段录音的音质自查（2026-11-08）：克隆新音色的样本与授权声明录完先在本机看一遍，别等 Google Gemini 退回才知道录坏了。
   Gemini 会核对两段是不是同一个人，官方建议同一只麦克风、同一个房间、干净自然的说话；爆音、底噪、太小声都会让它认不准。

   - `analyzeTake(samples, sampleRate)`：一段单声道 PCM（-1..1）→ 说话电平、峰值、削顶比例、静音比例、底噪（取开头 0.5 秒）。
   - `liveTakeHint`：录音进行中那一行（爆音 / 没声音 / 太小声 / 太吵 / 合适），只看最近 1.5 秒与开头量到的底噪。
   - `takeVerdict`：停下后的判词，一句原因 + 一句具体的办法；只提醒，不拦（时长门槛仍在 model-voices.js）。
   - `saveTakeWarnings`：保存这一步、上传按钮上面那条提醒：削顶超过 0.5% 或底噪高于 −45 dBFS，外加两段不是同一只麦克风；干净的不说话。
   - `micMismatch`：授权声明用的麦克风和录样本的那只不一样。

   门槛都在 `TAKE`，原型与 packages/ui 用同一组数。这里只算，不画；演示用的合成录音 `demoTake` 也在这里，好让测试与原型跑同一份数据。 */
(function () {
  const TAKE = {
    frame: 0.02,          // 20 ms 一帧
    noiseWindow: 0.5,     // 底噪取开头 0.5 秒：按下录音到开口通常有这么久
    clipAt: 0.99,         // |x| ≥ 0.99 算削顶
    clipWarn: 0.005,      // 削顶样本超过 0.5%：判爆音，保存前提醒
    noiseWarnDb: -45,     // 底噪高于 −45 dBFS：判太吵，保存前提醒
    silenceDb: -50,       // 一帧 RMS 低于 −50 dBFS 算静音
    quietDb: -35,         // 说话（非静音帧）的电平低于 −35 dBFS：太小声
    silentRatio: 0.95,    // 95% 以上是静音：几乎没录到声音
    pauseWarn: 0.5,       // 一半以上是静音：停顿太多
    liveWindow: 1.5,      // 录音中只看最近 1.5 秒
    liveClip: 0.001,      // 最近这一段削顶超过 0.1% 就当场提醒
    noVoiceAfter: 3,      // 开录 3 秒还没听到人声：多半是麦克风不对
  };
  const DB_FLOOR = -120;
  const ZERO_DB = -100;   // 比它还低的是数字静音（设备刚打开时的全零），不算进底噪

  const db = (x) => (x > 0 ? Math.max(DB_FLOOR, 20 * Math.log10(x)) : DB_FLOOR);
  const round1 = (x) => Math.round(x * 10) / 10;
  /** 从小到大第 q 分位（0–1），取下标向下取整的那个 */
  function quantile(list, q) {
    if (!list.length) return DB_FLOOR;
    const sorted = list.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) * q)];
  }

  /** 一段录音的读数。`levelDb` 是非静音帧的 RMS（全是静音时退到整段 RMS），`noiseFloorDb` 是开头 0.5 秒各帧 RMS 的下四分位
   *  （刚开口也不至于被说话顶高），`clipRatio` / `silenceRatio` 是 0–1。dB 都是 dBFS，最低 −120。 */
  function analyzeTake(samples, sampleRate) {
    const n = samples ? samples.length : 0;
    const sr = +sampleRate || 0;
    if (!n || !sr) return {seconds: 0, levelDb: DB_FLOOR, peakDb: DB_FLOOR, clipRatio: 0, silenceRatio: 1, noiseFloorDb: DB_FLOOR};
    const size = Math.max(1, Math.round(TAKE.frame * sr));
    const headEnd = TAKE.noiseWindow * sr;
    const head = [];
    let peak = 0, clipped = 0, total = 0, voiced = 0, voicedN = 0, frames = 0, silent = 0;
    for (let start = 0; start < n; start += size) {
      const end = Math.min(n, start + size);
      let sum = 0;
      for (let i = start; i < end; i++) {
        const x = samples[i];
        const a = x < 0 ? -x : x;
        if (a > peak) peak = a;
        if (a >= TAKE.clipAt) clipped += 1;
        sum += x * x;
      }
      total += sum;
      frames += 1;
      const d = db(Math.sqrt(sum / (end - start)));
      if (d < TAKE.silenceDb) silent += 1;
      else { voiced += sum; voicedN += end - start; }
      if (start < headEnd && d > ZERO_DB) head.push(d);
    }
    return {
      seconds: round1(n / sr),
      levelDb: round1(db(Math.sqrt(voicedN ? voiced / voicedN : total / n))),
      peakDb: round1(db(peak)),
      clipRatio: clipped / n,
      silenceRatio: silent / frames,
      noiseFloorDb: round1(quantile(head, 0.25)),
    };
  }

  /** 录音进行中那一行。`recent` 是最近 1.5 秒的 analyzeTake，`noiseFloorDb` 是开头量到的（还没量到给 null），
   *  `heard` 是到现在有没有过非静音帧。回 {k, tone, text}；tone 是 neutral / positive / notice。
   *  先后：爆音 > 3 秒还没声音 > 太小声 > 太吵 > 等开口 > 合适。 */
  function liveTakeHint(o) {
    const s = +o.seconds || 0;
    const recent = o.recent || null;
    const noise = o.noiseFloorDb == null ? null : o.noiseFloorDb;
    if (recent && recent.clipRatio > TAKE.liveClip) return {k: 'clipping', tone: 'notice', text: '爆音了 · 离麦克风远一点，或说轻一点'};
    if (!o.heard && s >= TAKE.noVoiceAfter) return {k: 'silent', tone: 'notice', text: '还没听到声音 · 看看麦克风选对了没有，或者离近一点'};
    if (o.heard && recent && recent.silenceRatio < 1 && recent.levelDb < TAKE.quietDb) return {k: 'quiet', tone: 'notice', text: '太小声 · 离麦克风近一点'};
    if (noise != null && noise > TAKE.noiseWarnDb) return {k: 'noisy', tone: 'notice', text: '周围有点吵 · 风扇、空调能关先关掉'};
    if (!o.heard) return {k: 'waiting', tone: 'neutral', text: '照着上面念'};
    return {k: 'ok', tone: 'positive', text: '音量合适'};
  }

  /** 这段录音有哪些毛病（按要紧程度排）：silent / clipping / quiet / noisy / pauses */
  function takeIssues(a) {
    if (!a) return [];
    if (a.silenceRatio >= TAKE.silentRatio) return ['silent'];
    const out = [];
    if (a.clipRatio > TAKE.clipWarn) out.push('clipping');
    if (a.levelDb < TAKE.quietDb) out.push('quiet');
    if (a.noiseFloorDb > TAKE.noiseWarnDb) out.push('noisy');
    if (a.silenceRatio > TAKE.pauseWarn) out.push('pauses');
    return out;
  }
  const VERDICT = {
    silent: {title: '几乎没录到声音', fix: '看看选的麦克风对不对、有没有被静音，再录一遍'},
    clipping: {title: '有爆音', fix: '离麦克风远一拳，或者把系统的输入音量调低，再录一遍'},
    quiet: {title: '声音太小', fix: '离麦克风近一点，用平常说话的音量，再录一遍'},
    noisy: {title: '底噪偏大', fix: '关掉风扇和空调，换个安静的房间再录'},
    pauses: {title: '一大半是停顿', fix: '连着说，别在中间停太久'},
  };
  /** 停下后的判词：{k, tone, title, fix, issues}；没毛病回 k 'ok'。只提醒，不拦 */
  function takeVerdict(a) {
    const issues = takeIssues(a);
    if (!issues.length) return {k: 'ok', tone: 'positive', title: '音质不错', fix: '音量合适、没有爆音、周围够安静', issues};
    const k = issues[0];
    const more = issues.slice(1).map((x) => VERDICT[x].title);
    return {k, tone: 'notice', title: more.length ? `${VERDICT[k].title}，${more.join('、')}` : VERDICT[k].title, fix: VERDICT[k].fix, issues};
  }

  /** 授权声明用的麦克风和样本那只不一样：回 {sample, used}（设备 id），一样或不适用回 null。
   *  样本是上传的不比；授权声明已录就看它录时用的，没录就看现在选的 `current`；授权声明是上传的也不比。 */
  function micMismatch(sample, consent, current) {
    if (!sample || sample.via !== 'mic' || !sample.mic) return null;
    const used = consent ? (consent.via === 'mic' ? consent.mic : null) : current;
    return used && used !== sample.mic ? {sample: sample.mic, used} : null;
  }

  /** 保存这一步、上传按钮上面那条提醒：只看会让对方认不准的——削顶超过 0.5%、底噪高于 −45 dBFS、两段不是同一只麦克风。
   *  `clips` = {sample, consent}，每段 {analysis, via, mic}；授权声明这次不上传就别给 `consent`（本机引擎只用样本）。
   *  回 [{step, k}]（step 是 sample / consent，k 是 clipping / noisy / mic），干净回 []。 */
  function saveTakeWarnings(clips) {
    const out = [];
    ['sample', 'consent'].forEach((step) => {
      const c = clips && clips[step];
      const a = c && c.analysis;
      if (!a) return;
      if (a.clipRatio > TAKE.clipWarn) out.push({step, k: 'clipping'});
      if (a.noiseFloorDb > TAKE.noiseWarnDb) out.push({step, k: 'noisy'});
    });
    if (clips && clips.consent && micMismatch(clips.sample, clips.consent, null)) out.push({step: 'consent', k: 'mic'});
    return out;
  }
  const STEP_NAME = {sample: '样本', consent: '授权声明'};
  const WARN_WORD = {clipping: '有爆音', noisy: '底噪偏大'};
  /** 那条提醒的话：{title, items, body, redo: [step]}；`uploadTo` 是这次要传的提供方名字（空就是只存本机）。
   *  `items` 一段一条（「样本有爆音」「授权声明底噪偏大」），换了麦克风另起一条；`redo` 是要回去重录的步骤 */
  function saveWarningText(list, uploadTo) {
    if (!list || !list.length) return null;
    const items = [];
    ['sample', 'consent'].forEach((step) => {
      const words = list.filter((w) => w.step === step && WARN_WORD[w.k]).map((w) => WARN_WORD[w.k]);
      if (words.length) items.push(`${STEP_NAME[step]}${words.join('、')}`);
    });
    if (list.some((w) => w.k === 'mic')) items.push('授权声明和样本不是同一只麦克风录的');
    const redo = ['sample', 'consent'].filter((step) => list.some((w) => w.step === step));
    const who = uploadTo && uploadTo.length ? uploadTo.join(' / ') : '';
    return who
      ? {title: `${who} 可能验不过`, items, body: '照样上传也行，被退回时会说原因；回去重录更稳。', redo}
      : {title: '样本有毛病，克隆出来的声音也会带上', items, body: '照样存也行；回去重录更好。', redo};
  }

  /* ---------- 演示：合成一段「录音」（原型没有真麦克风；测试也拿它验门槛） ----------
     说话是 140 Hz 的几个泛音，按 4.5 Hz 的音节起伏；开头 0.8 秒还没开口，之后每 3 秒停 0.6 秒。按样本下标算，切成几段拼起来和一次算完一样。 */
  const TAKE_DEMO = [
    {k: 'clean', label: '干净', speech: 0.35, noise: 0.001},
    {k: 'quiet', label: '太小声', speech: 0.03, noise: 0.0003},
    {k: 'clipping', label: '爆音', speech: 1.35, noise: 0.001},
    {k: 'noisy', label: '底噪大', speech: 0.35, noise: 0.02},
    {k: 'silent', label: '没声音（麦克风不对）', speech: 0, noise: 0.0005},
  ];
  const hashNoise = (i) => {
    let h = (i | 0) ^ 0x9e3779b9;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
  function demoTake(kind, from, to, sampleRate) {
    const spec = TAKE_DEMO.find((d) => d.k === kind) || TAKE_DEMO[0];
    const sr = sampleRate || 8000;
    const i0 = Math.round(from * sr);
    const i1 = Math.round(to * sr);
    const out = new Float32Array(Math.max(0, i1 - i0));
    for (let j = 0; j < out.length; j++) {
      const i = i0 + j;
      const t = i / sr;
      const talking = t >= 0.8 && (t - 0.8) % 3 < 2.4;
      let x = spec.noise * hashNoise(i);
      if (talking && spec.speech) {
        const env = 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * 4.5 * t));
        const voice = (Math.sin(2 * Math.PI * 140 * t) + 0.5 * Math.sin(2 * Math.PI * 280 * t) + 0.25 * Math.sin(2 * Math.PI * 420 * t)) / 1.75;
        x += spec.speech * env * voice;
      }
      out[j] = Math.max(-1, Math.min(1, x));
    }
    return out;
  }

  const BC_VOICE_TAKE = {TAKE, analyzeTake, liveTakeHint, takeIssues, takeVerdict, micMismatch, saveTakeWarnings, saveWarningText, TAKE_DEMO, demoTake};
  if (typeof module !== 'undefined' && module.exports) module.exports = BC_VOICE_TAKE;
  if (typeof window !== 'undefined') Object.assign(window, {BC_VOICE_TAKE});
})();
