/* 设置 › 本地模型：「检查」与「试听 / 试画」分开的两件事（2026-10-05）。
   - 用它：有东西可试的能力（语音合成「试听」、图像生成「试画」）把它当行上唯一的主操作。
   - 检查：这只模型能不能正常工作。名字只有「检查」（菜单与提示里写全「检查模型」），图标是放大镜，
     不用播放三角。有试用的行，检查只在 ⋯ 里，紧挨「修复…」；没有试用的行（语音识别、音源分离、
     画面理解）在行上另有一个安静的「检查」按钮，⋯ 里照样有。
   - 模型的健康只在一处说：行上的一条状态。没检查过什么也不写；通过是一句安静的「N 分钟前检查通过」；
     没通过是红色的一句人话 + 能做的事（修复… / 重新检查 / 技术详情），技术详情里才有代码与细节
     （不叫「详情」：行首的展开钮已经叫「详情」，是这只模型的组成与下载地址）；
     检查没能开始也走这一条，不弹 toast。
   - 试用（试听 / 试画）自己的失败留在试用面板里，用同一套说法：哪里不对 + 怎么办 + 有动作就给按钮。
     模型上次检查没通过时，试用面板开头先说这件事。
   不碰 React、不碰 DOM。相对时间借 BC_UPDATE.relTime（model-app-update.js）。 */
(function () {
  const LABEL = {
    check: '检查', checkFull: '检查模型', recheck: '重新检查', repair: '修复…', repairSub: '只重新下载坏掉的文件',
    details: '技术详情', hideDetails: '收起技术详情', cancel: '取消', copy: '复制技术详情',
  };
  /** 检查与修复的图标：放大镜。不用 play——那是「试听」。 */
  const CHECK_ICON = 'search';

  /* 有东西可试的能力：行上的主操作。其余能力没有试用。 */
  const TRY = {
    tts: {label: '试听', hide: '收起试听', verb: '合成', noun: '试听'},
    image: {label: '试画', verb: '画', noun: '试画'},
  };
  const tryOf = (cat) => TRY[cat] || null;
  /** 检查要不要在行上露出来：只有没有试用的能力露一个安静的按钮；⋯ 里总有「检查模型」。 */
  const checkOnRow = (cat) => !TRY[cat];

  /** 已安装列表上方那句说明：检查和修复各做什么，一句话；第二句是删除的规矩。 */
  const CAPTION = '检查会确认模型能正常使用；修复只重新下载坏掉的文件。删除时，别的模型还在用的公共组件会保留。';

  /* 检查跑的是一小段随 BaoCut 自带的样本；这里只写人看得懂的阶段名。 */
  function phaseLabel(pct) {
    if (pct < 35) return '加载模型';
    if (pct < 85) return '试跑一小段样本';
    return '核对结果';
  }

  /* 结果不对时，这一类模型「不对」长什么样（一句人话）与技术细节 */
  const WRONG = {
    asr: {text: '识别不出样本里的话', detail: '样本「欢迎回到码与远方」→ 识别结果为空（期望 8 个字）'},
    tts: {text: '念出来的几乎是静音', detail: '样本句合成 2.4 秒 · 响度 -71 LUFS（期望 -30 以上）'},
    sep: {text: '人声和背景没分开', detail: '人声轨与原混音的相关度 0.98（期望 0.6 以下）'},
    vision: {text: '示例画面里一个人也没认出来', detail: '样本图应检出 2 张人脸，实际 0'},
    image: {text: '画出来是一张纯色图', detail: '输出 256 × 256 · 像素方差 0'},
  };

  /*
   * 检查没通过的原因。每条：
   *   head  —— 状态行开头（「检查没通过」/「检查没能开始」）
   *   text  —— 哪里不对，一句人话
   *   todo  —— 怎么办，一句人话
   *   fix   —— 'repair' 修复能解决（状态行给「修复…」）；'reinstall' 是应用自己的问题，修复帮不上；'retry' 处理后重新检查
   *   code / detail —— 只在「技术详情」里出现，给反馈问题时用
   */
  const PROBLEMS = {
    appFileMissing: (m) => ({
      head: '检查没通过', fix: 'reinstall', code: 'APP_RESOURCE_MISSING',
      text: 'BaoCut 自带的一个文件不见了，不是模型的问题',
      todo: '重新安装 BaoCut 可以解决，已下载的模型不受影响。',
      detail: ['缺少 BaoCut.app/Contents/Resources/runtime/espeak-ng-data/phontab', `模型 ${m.id} 的文件完好`],
    }),
    modelDamaged: (m) => ({
      head: '检查没通过', fix: 'repair', code: 'MODEL_FILE_CORRUPT',
      text: '模型文件损坏了',
      todo: '修复会重新下载坏掉的文件。',
      detail: [`${m.repo || m.id}/model.safetensors 校验不符`, '期望 sha256 3f9a…c21e，实际 07c1…9b40'],
    }),
    wrongOutput: (m, cat) => ({
      head: '检查没通过', fix: 'repair', code: 'MODEL_OUTPUT_MISMATCH',
      text: `模型能运行，但${(WRONG[cat] || WRONG.asr).text}`,
      todo: '先修复；修复后还是这样，复制技术详情发给我们。',
      detail: [(WRONG[cat] || WRONG.asr).detail],
    }),
    noMemory: (m) => ({
      head: '检查没通过', fix: 'retry', code: 'OUT_OF_MEMORY',
      text: '内存不够，模型没能加载',
      todo: '关掉别的大模型或占内存的应用，再检查一次。',
      detail: [`加载 ${m.id} 需要约 ${memNeed(m)} 可用内存，当时只有 1.8 GB`],
    }),
    notStarted: () => ({
      head: '检查没能开始', fix: 'retry', code: 'RUNTIME_UNAVAILABLE',
      text: 'BaoCut 的后台服务没有响应',
      todo: '稍后再检查一次；一直这样就重启 BaoCut。',
      detail: ['modelTest 没有在 10 秒内被接收', 'Worker 进程未就绪'],
    }),
  };
  const PROBLEM_KEYS = Object.keys(PROBLEMS);
  function memNeed(m) {
    const gb = Math.max(1, Math.round(((m && m.size) || 1024) * 1.6 / 1024 * 10) / 10);
    return gb + ' GB';
  }
  function problem(key, m, cat) {
    const make = PROBLEMS[key];
    return make ? Object.assign({key}, make(m || {}, cat)) : null;
  }

  /* 原型开关「下次检查的结果」：pass 或 PROBLEMS 的键 */
  const CHECK_DEMOS = [
    {k: 'pass', label: '通过'}, {k: 'appFileMissing', label: '自带文件缺失'}, {k: 'modelDamaged', label: '模型文件损坏'},
    {k: 'wrongOutput', label: '结果不对'}, {k: 'noMemory', label: '内存不够'}, {k: 'notStarted', label: '没能开始'},
  ];
  /* 原型开关「下次试听的结果」 */
  const TRY_DEMOS = [
    {k: 'ok', label: '成功'}, {k: 'refUnreadable', label: '录音读不出'}, {k: 'noMemory', label: '内存不够'}, {k: 'modelError', label: '模型出错'},
  ];

  /** 跑完一次检查后的状态。`demo` 是原型开关的值；`at` 是毫秒时间戳。 */
  function finish(demo, m, cat, at) {
    if (!demo || demo === 'pass' || !PROBLEMS[demo]) return {phase: 'passed', at};
    return {phase: 'failed', at, problem: problem(demo, m, cat)};
  }

  function ago(at, now) {
    const U = (typeof window !== 'undefined' && window.BC_UPDATE) || null;
    if (U && U.relTime) return U.relTime(Math.floor(at / 1000), Math.floor(now / 1000));
    return '刚刚';
  }

  /**
   * 行上那一条健康状态。st: {phase:'idle'|'checking'|'repairing'|'passed'|'failed', pct?, at?, problem?}。
   * 返回 null（没检查过，什么也不写）或 {tone:'running'|'passed'|'failed', head?, text, todo?, pct?, actions:[{k,label,primary?}]}。
   * 动作键：cancel / repair / recheck / details。
   */
  function lineView(st, cat, now) {
    if (!st || st.phase === 'idle') return null;
    if (st.phase === 'checking') {
      const pct = st.pct || 0;
      return {tone: 'running', head: '检查中…', text: phaseLabel(pct), pct, actions: [{k: 'cancel', label: LABEL.cancel}]};
    }
    if (st.phase === 'repairing') {
      return {tone: 'running', head: '修复中…', text: '重新下载坏掉的文件，修好后自动再检查一次', pct: st.pct || 0, actions: [{k: 'cancel', label: LABEL.cancel}]};
    }
    if (st.phase === 'passed') return {tone: 'passed', text: `${ago(st.at, now)}检查通过`, actions: []};
    const p = st.problem;
    const actions = [];
    if (p.fix === 'repair') actions.push({k: 'repair', label: LABEL.repair, primary: true});
    actions.push({k: 'recheck', label: LABEL.recheck});
    actions.push({k: 'details', label: LABEL.details});
    return {tone: 'failed', head: p.head, text: p.text + '。', todo: p.todo, actions};
  }

  /** 「技术详情」里的几行：代码、时间、技术细节。复制详情也用它。 */
  function detailLines(st, m, now) {
    if (!st || st.phase !== 'failed') return [];
    const p = st.problem;
    return [`代码 ${p.code}`, `模型 ${m.id} · ${ago(st.at, now)}`].concat(p.detail || []);
  }

  /**
   * 试用面板开头的提醒：上次检查没通过就先说，并给「修复… / 重新检查」。没有提醒时 null。
   * okAt 是这块面板里试用做成的那次的时间：在那次检查之后就不再说（眼前的结果已经做成了）；行上那条检查结果照旧。
   */
  function tryNotice(st, cat, okAt) {
    if (!st || st.phase !== 'failed' || !tryOf(cat)) return null;
    if (okAt && okAt > st.at) return null;
    const p = st.problem;
    const actions = [];
    if (p.fix === 'repair') actions.push({k: 'repair', label: LABEL.repair, primary: true});
    actions.push({k: 'recheck', label: LABEL.recheck});
    return {tone: 'failed', text: `这只模型上次检查没通过：${p.text}`, todo: `${p.todo}现在${tryOf(cat).noun}多半也会失败。`, actions};
  }

  /**
   * 试用（试听 / 试画）自己的失败。kind 是 TRY_DEMOS 的键（ok 除外）或 'invalid'（表单没填好，ctx.msg 是那条校验）。
   * ctx.file 是用户自己选的录音名（参考录音读不出时点名）。返回 {text, todo, actions:[{k,label,primary?}]}。
   * 动作键：pickRef（换一段录音…）/ useSample（用示例录音）/ retry（重试）/ check（检查模型）。
   */
  function tryFailure(kind, cat, ctx) {
    const t = tryOf(cat) || TRY.tts;
    const c = ctx || {};
    if (kind === 'invalid') return {text: c.msg || '还缺一项设置', todo: '', actions: []};
    if (kind === 'refUnreadable') {
      return {
        text: `读不出你的录音「${c.file || '录音'}」，文件可能损坏，或者不是音频`,
        todo: '换一段录音再试，或先用示例录音听听效果。',
        actions: [{k: 'pickRef', label: '换一段录音…', primary: true}, {k: 'useSample', label: '用示例录音'}],
      };
    }
    if (kind === 'noMemory') {
      return {
        text: `内存不够，没${t.verb}完`,
        todo: cat === 'image' ? '关掉别的大模型后重试，或把步数调低。' : '关掉别的大模型或占内存的应用后重试。',
        actions: [{k: 'retry', label: '重试', primary: true}],
      };
    }
    return {
      text: `模型出错了，没${t.verb}出来`,
      todo: '检查一下模型，看看是哪里出了问题。',
      actions: [{k: 'check', label: LABEL.checkFull, primary: true}, {k: 'retry', label: '重试'}],
    };
  }
  /** 这次试用会不会失败（原型开关）：录音读不出只在用了自己的录音时成立。 */
  function tryOutcome(demo, usesOwnFile) {
    if (!demo || demo === 'ok') return 'ok';
    if (demo === 'refUnreadable' && !usesOwnFile) return 'ok';
    return TRY_DEMOS.some((d) => d.k === demo) ? demo : 'ok';
  }

  const BC_LOCALCHECK = {
    LABEL, CHECK_ICON, TRY, tryOf, checkOnRow, CAPTION, phaseLabel, PROBLEMS, PROBLEM_KEYS, problem,
    CHECK_DEMOS, TRY_DEMOS, finish, lineView, detailLines, tryNotice, tryFailure, tryOutcome,
  };
  if (typeof window !== 'undefined') Object.assign(window, {BC_LOCALCHECK});
  if (typeof module !== 'undefined') module.exports = BC_LOCALCHECK;
})();
