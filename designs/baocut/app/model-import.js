/* URL import design contract. Demo events only; no network or filesystem writes. */
(function () {
  const phases = {checking: '检查链接', downloading: '下载视频', verifying: '验证媒体', ready: '创建视频',
    repair: '需要准备下载工具', installing: '准备下载工具', error: '下载未完成',
    transcribing: '识别语音', done: '字幕已就绪', canceled: '已取消'};
  // Closed issue set. `retryable` mirrors the kernel contract: the same link can be re-run without any change.
  // `tools`: 'primary' = the tools card carries the main action, 'hint' = folded behind「检查下载工具」, null = not shown.
  const issues = {
    missing: {title: '准备一次，以后直接粘贴', body: 'BaoCut 需要视频下载工具来读取这个网站。安装完成后会自动继续这次下载。', action: '安装并继续', setup: true, retryable: false, tools: 'primary'},
    outdated: {title: '更新下载工具，再试一次', body: '检测到 yt-dlp 有更新，可能解决这次网站兼容问题。更新后自动重试一次；仍失败时保留链接。', action: '更新并重试', retryable: true, tools: 'primary'},
    install: {title: '下载工具没有安装成功', body: '连接安装源失败。保留了链接和设置，可以重新安装，或改用本地文件。', action: '重新安装并继续', retryable: false, tools: 'primary',
      diag: 'brew · Error: Failed to download resource "yt-dlp"（诊断示例）'},
    busy: {title: '下载工具正在准备中', body: '另一次安装或更新还没结束。等它完成后再重试，不需要重新粘贴链接。', action: '重试下载', retryable: true, tools: null,
      diag: 'BaoCut · 另一项工具安装正在进行，本次下载未开始（诊断示例）'},
    network: {title: '连接中断了', body: '检查网络后可以继续下载，支持续传时保留已下载的部分。', action: '重试下载', retryable: true, tools: null,
      diag: 'yt-dlp · ERROR: Connection interrupted（诊断示例）'},
    denied: {title: '网站拒绝了这次下载', body: '已自动刷新媒体地址、也逐个试过本机浏览器的登录信息。403 多半是临时链接或网站限制，也可能是工具兼容性。先重试；仍失败可检查工具更新，或换个链接、改用本地文件。更新不保证能解决。', action: '重试下载', retryable: true, tools: 'hint',
      diag: 'yt-dlp · ERROR: unable to download video data: HTTP Error 403: Forbidden（诊断示例）'},
    login: {title: '这个视频需要登录才能看', body: '已经逐个试过本机浏览器的登录信息，站点仍然要求登录。请先在其中一个浏览器里登录该网站再重试，或在浏览器里下载好再导入本地文件。', action: '换个链接', retryable: false, tools: null,
      diag: 'yt-dlp · ERROR: Sign in to confirm you’re not a bot（诊断示例）'},
    unsupported: {title: '还不支持这个来源', body: '下载工具认不出这个网站或页面。换一条视频页面或媒体直链，或改用本地文件。', action: '换个链接', retryable: false, tools: null,
      diag: 'yt-dlp · ERROR: Unsupported URL: https://example.com/page（诊断示例）'},
    invalid: {title: '下载到的文件不能用', body: '文件没有音轨或无法解码，可能是网站给了占位内容。换个链接或改用本地文件；如果怀疑是临时问题，可以重新下载一次。', action: '换个链接', retryable: true, tools: null,
      diag: 'ffprobe · 找不到音频流（诊断示例）'},
    transcription: {title: '转录中断了，视频已保留', body: '视频和下载的视频都在。重试只重新识别语音，不会再下载视频。', action: '重试转录', retryable: true, tools: null},
  };
  const downloadFailures = ['network', 'denied', 'login', 'unsupported', 'busy'];
  // Which buttons a failed task offers, in order. Primary is one accent button at most; when the tools card
  // carries the fix (missing / outdated / install), the block itself has no accent button.
  function recovery(t) {
    const issue = t.issue && issues[t.issue];
    if (!issue) return {primary: null, secondary: [], tools: null, setup: false};
    const change = t.project ? [] : ['change'];
    if (issue.tools === 'primary') return {primary: null, secondary: t.issue === 'outdated' ? ['retry', ...change] : change, tools: 'primary', setup: !!issue.setup};
    if (t.issue === 'transcription') return {primary: 'retry', secondary: [], tools: null, setup: false};
    if (!issue.retryable) return {primary: 'change', secondary: [], tools: null, setup: false};
    if (t.issue === 'invalid') return {primary: 'change', secondary: ['retry'], tools: null, setup: false};
    return {primary: 'retry', secondary: [...(issue.tools === 'hint' ? ['tools'] : []), ...change], tools: issue.tools, setup: false};
  }
  // 用哪台电脑下载（远端任务 J3）：`options.via` / `viaName` 是已配对节点。那台用它自己的网络与 yt-dlp，
  // 本机下载工具缺不缺都不拦；下载阶段的名字点名机器，视频经局域网传回后照常验证、建项目、转录。
  const phaseOf = (t, stage) => (stage === 'downloading' && t.options && t.options.viaName ? `在 ${t.options.viaName} 上下载视频` : phases[stage]);
  function start({id, url, info, scenario = 'success', options = {}, tool = 'ready'}) {
    return {id, url, info, options, scenario, origin: 'url', kind: 'import', project: null,
      title: info.title, sub: info.site, source: 'app', started: '刚刚', status: 'running',
      phase: phases.checking, stage: 'checking', pct: null, seq: Date.now(), cancellable: true,
      issue: null, repaired: false, tool};
  }
  function move(t, stage, extra = {}) {
    return {...t, stage, phase: phaseOf(t, stage), ...extra};
  }
  function tick(t) {
    if (t.origin !== 'url' || t.status !== 'running') return t;
    if (t.stage === 'checking') {
      if (!t.info.direct && !t.repaired && !t.options.via && (['missing', 'outdated', 'install'].includes(t.scenario) || t.tool !== 'ready'))
        return move(t, 'repair', {status: 'queued', issue: t.scenario === 'outdated' ? 'outdated' : 'missing', pct: null});
      return move(t, 'downloading', {pct: 0, issue: null});
    }
    if (t.stage === 'downloading') {
      if (!t.retried && downloadFailures.includes(t.scenario) && t.pct >= 30)
        return move(t, 'error', {status: 'error', issue: t.scenario});
      const pct = Math.min(100, t.pct + 10);
      return pct === 100 ? move(t, 'verifying', {pct: null}) : {...t, pct};
    }
    if (t.stage === 'verifying') {
      if (t.scenario === 'invalid' && !t.retried) return move(t, 'error', {status: 'error', issue: 'invalid', phase: '媒体验证未通过'});
      return move(t, 'ready', {verified: true});
    }
    if (t.stage === 'transcribing') {
      if (t.scenario === 'transcription' && !t.retried && t.pct >= 30)
        return move(t, 'error', {status: 'error', issue: 'transcription', phase: '转录未完成'});
      const pct = Math.min(100, t.pct + 2);
      return pct === 100 ? move(t, 'done', {pct, status: 'done', cancellable: false})
        : {...t, pct, phase: pct < 6 ? '解码音频' : pct < 92 ? '识别语音' : pct < 99 ? '词级对齐' : '保存字幕'};
    }
    return t;
  }
  function canCreate(t) { return t.stage === 'ready' && t.verified === true && !t.project && t.status === 'running'; }
  function attach(t, project) {
    return canCreate(t) ? move(t, 'transcribing', {project, kind: 'transcribe', phase: '解码音频', pct: 0, issue: null, sub: (t.options.model || 'moss-transcribe') + ' · 本机'}) : t;
  }
  /** 下载完成后建出的视频记录：链接导入（import-flow.jsx）与 Agent 的下载工具（store-agent-sim.jsx）共用。
      建出来就在转录（`status: 'transcribing'`），可以随时打开编辑器。`dir` / `folder` 是它落在哪个项目的哪个子目录。 */
  function movieRecord({id, title, name, saveDir, duration, hue, model, dir, folder}) {
    return {id, title, status: 'transcribing', progress: 0, origin: 'url',
      ...(dir ? {dir, folder: folder || title} : {}),
      src: {name, path: (saveDir || '~/Downloads').replace(/\/+$/, '') + '/' + name, format: 'MP4', res: '1920×1080', state: 'ok'},
      duration, lang: '自动检测', model: model || 'moss-transcribe', modified: '刚刚', hue, meta: {}};
  }
  function retry(t) {
    if (t.canceled || t.status !== 'error' || !issues[t.issue]?.retryable) return t;
    const resume = t.issue === 'invalid' || t.issue === 'outdated' || t.issue === 'busy' ? 0 : t.pct;
    return move(t, t.project ? 'transcribing' : 'downloading', {status: 'running', pct: t.project ? 0 : resume, issue: null, retried: true, attempts: (t.attempts || 0) + 1});
  }
  function cancel(t) { return move(t, 'canceled', {status: 'error', canceled: true, cancellable: false, issue: null, pct: null}); }
  function restart(t) { return t.canceled && t.project ? move(t, 'transcribing', {status: 'running', canceled: false, cancellable: true, issue: null, pct: 0, retried: true}) : t; }
  window.BC_IMPORT = {phases, issues, recovery, start, tick, canCreate, attach, retry, cancel, restart, movieRecord};
})();
