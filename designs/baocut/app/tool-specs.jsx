/* 按步骤跑的四个工具每次运行的「做什么」（交给 BC_TOOL_RUNNER.start，product-design §2.7）：标题、步骤完成时的写入、结果页的几句话。
   转录从链接开始与「下载视频 + 下载后转录」共用同一段下载写入（linkEffects）与文稿、字幕的保存（publishTranscript），
   步骤表也是同一张（model-tool-runs.js）。产物都用 BC_TOOL_RUNNER.put 记下，结果页与任务记录据此列出。 */
(function () {
  const D = window.BC_DATA;
  const TT = window.BC_TOOL_TARGETS;
  const Run = () => window.BC_TOOL_RUNNER;
  const base = (name) => String(name || '').replace(/\.[^.]+$/, '');
  const dirName = (app, id) => (app.dirById(id) || {}).name || '项目';
  /** 写进任务记录与产物的参数：表单原样，Space 条目只留 id、名字与种类（重试时按 id 找回） */
  const paramsOf = (st) => Object.assign({}, st, st.entry ? {entry: {id: st.entry.id, name: st.entry.name, kind: st.entry.kind}} : {});
  const movieTitle = (app, id) => (Run().movieNow(id).title || (app.projById(id) || {}).title || '视频');

  /** 转写三步的写入：应用文稿、建立字幕层 */
  const asrEffects = (o) => ({
    applyTx: (ctx) => Run().applyTranscript(ctx.app, ctx, {lang: o.lang, model: o.model}),
    layer: (ctx) => Run().layer(ctx.app, ctx, {lang: o.lang, kind: 'source'}),
  });
  /** 从链接拿媒体并落到目标的写入：新建视频 / 导入已有视频 / 放进 Space */
  function linkEffects(o) {
    const media = Run().linkMedia(o.url);
    return {media, effects: {
      create: (ctx) => Run().createMovie(ctx.app, ctx, {dir: o.dir, name: o.name || media.title, src: media.src}, o.label, o.transcribe),
      import: (ctx) => Run().importToMovie(ctx.app, ctx, media),
      store: (ctx) => Run().storeDownload(ctx.app, ctx, media, o.dir),
    }};
  }
  const CREATED_LINK = '下载的媒体已放上时间线';
  /* 开了「识别说话人」：回执报出区分出几位，字幕与文稿带名字（演示数据的说话人表） */
  const txLines = (o) => [`写进一份${TT.langLabel(o.lang)}文稿（${D.cues.length} 句，${o.modelName}）`]
    .concat(o.speakers ? [`区分出 ${Object.keys(D.speakers).length} 位说话人，字幕与文稿都标上了名字`] : [], ['建立了一条可编辑的字幕层']);

  /** 转录的输入落到哪一类：Space 里的视频走「写进视频」，Space 里的媒体文件与本机文件一样当文件（BC_TOOL_SPACE_INPUT.runInput） */
  const runInput = (st) => (st.source === 'space' ? window.BC_TOOL_SPACE_INPUT.runInput(st.entry) : st.source);
  /** Space 媒体条目当作新视频的主素材 */
  const entrySrc = (e) => ({name: e.name, path: e.file || e.name, format: e.kind === 'audio' ? '音频' : '视频', res: e.res || '', state: 'ok'});

  /**
   * 转录（§2.7 表二「转录」）。st: {source: file|link|space|video, file?, url?, entry?（Space 条目）, movie?, target,
   *   dir（新建视频放进的项目）, saveDir, lang, model, modelName, speakers?, diarize?, name?（新建视频的名字）, translations?}
   * 文件、链接与 Space 里的媒体：target = none（缺省）产出 `<源名>.txt` 与 `<源名>.srt`，放在保存位置；
   * target = create 新建视频并放进项目，写进文稿与字幕层。
   * Space 里的可编辑视频（product-design §5.11、§2.7）：没有文稿时 target = first，直接写进它；
   * 已有文稿时 target = new-video（缺省）在同项目新建一部视频，链接同一份素材，名字默认「<原名> · 重新转录」，这部视频不动；
   * target = replace 走换用文稿：同一份文稿的新版本取代当前文稿，译文按原文配对结转（translations = carry），一笔可撤销。
   * `speakers`：这次要不要识别说话人；`diarize`：要不要在转写之后单列「识别说话人」一步（模型自带区分时不单列）
   */
  function transcribe(app, st) {
    const input = runInput(st);
    const video = input === 'video';
    const movie = video ? (st.movie || (st.entry && (st.entry.movie || st.entry.id))) : null;
    const create = !video && st.target === 'create';
    const vt = video ? (st.target === 'new-video' || st.target === 'replace' ? st.target : 'first') : null;
    const orig = video ? Run().movieNow(movie) : null;
    const newName = vt === 'new-video' ? (st.name || TT.newVideoName(orig)) : null;
    const asr = asrEffects(st);
    let name = '';
    let srcInfo = null;
    let effects = {};
    if (st.source === 'link') {
      const l = linkEffects({url: st.url, dir: st.dir, label: '转录', transcribe: true});
      name = l.media.title;
      srcInfo = {sourceName: l.media.name, sourceUrl: st.url};
      effects = create ? {create: l.effects.create} : {store: (ctx) => Run().storeDownload(ctx.app, ctx, Object.assign({}, l.media,
        {src: Object.assign({}, l.media.src, {path: `${st.saveDir}/${l.media.name}`})}), null)};
    } else if (!video) {
      const src = st.source === 'space' ? entrySrc(st.entry) : {name: st.file, path: `~/视频素材/${st.file}`, format: '视频 / 音频', res: '', state: 'ok'};
      name = base(src.name);
      srcInfo = {sourceName: src.name, sourceUrl: src.path};
      if (create) effects = {create: (ctx) => Run().createMovie(ctx.app, ctx, {dir: st.dir, name, src}, '转录', true)};
    }
    if (vt === 'new-video') {
      effects.create = (ctx) => Run().createMovie(ctx.app, ctx, {dir: orig.dir, name: newName, src: orig.src}, '转录', true);
      Object.assign(effects, asr);
    } else if (vt === 'replace') {
      /* 换用文稿：文稿换成新版本；结转摘要（carryLines）按换之前的事实算（译文、pin、配音） */
      effects.switchTx = (ctx) => Run().switchTranscript(ctx.app, ctx, {lang: st.lang, model: st.model});
    }
    else if (video || create) Object.assign(effects, asr);
    else effects.publish = (ctx) => Run().publishTranscript(ctx.app, ctx, Object.assign({name, saveDir: st.saveDir, dir: null,
      lang: st.lang, model: st.model, speakers: st.speakers}, srcInfo));
    const title = `转录 · ${video ? movieTitle(app, movie) : name}`;
    const carryLines = () => {
      const c = TT.carrySummary(orig);
      return c.lines.length ? c.lines.concat(c.translations.some((t) => t.stale) ? ['过期的译文用「刷新过期译文」重译'] : [])
        : ['这部视频没有译文与字幕 pin，没有要结转的'];
    };
    const head = (ctx) => (vt === 'replace' ? [`取代「${movieTitle(app, movie)}」的文稿：一笔事务，可以撤销`]
      : vt === 'new-video' ? [`新建视频「${movieTitle(app, ctx.movie)}」，放进「${dirName(app, orig.dir)}」，链接同一份素材；「${movieTitle(app, movie)}」和它的译文没动`]
      : video ? [`写进「${movieTitle(app, ctx.movie)}」`]
      : create ? [`新建视频「${movieTitle(app, ctx.movie)}」，放进「${dirName(app, st.dir)}」；${st.source === 'link' ? CREATED_LINK : '素材留在原处，只做链接'}`]
      : [`${name}.txt 与 ${name}.srt 保存在 ${window.BC_SAVE_DIR.label(st.saveDir)}，也作为条目出现在 Space 里`]);
    return {params: paramsOf(st), tool: 'transcribe', input: video ? 'video' : st.source === 'link' ? 'link' : 'file',
      opts: {diarize: !!st.diarize, target: vt || (create ? 'create' : 'none'), translations: vt === 'replace' ? (st.translations || 'carry') : undefined},
      title, sub: st.modelName + (st.speakers ? ' · 识别说话人' : ''), saveDir: video ? null : st.saveDir,
      movie: vt === 'new-video' ? null : movie, create: create ? {dir: st.dir} : vt === 'new-video' ? {dir: orig.dir} : null,
      effects, result: (ctx) => ({actions: vt === 'replace' ? replaceActions(movie, orig) : undefined,
        lines: head(ctx).concat(vt === 'replace' ? [`换上一份${TT.langLabel(st.lang)}文稿（${D.cues.length} 句，${st.modelName}）`].concat(carryLines())
        : video || create ? txLines(st)
        : [`${TT.langLabel(st.lang)}文稿 ${D.cues.length} 句（${st.modelName}）`].concat(st.speakers ? [`区分出 ${Object.keys(D.speakers).length} 位说话人，字幕与文稿都标上了名字`] : []))})};
  }

  /** 换用文稿的结果卡（product-design §5.11）：有过期译文时给「刷新过期译文」，并且整笔可以撤销 */
  function replaceActions(movie, orig) {
    const stale = TT.carrySummary(orig).translations.some((t) => t.stale);
    /* 打开这部视频，再给编辑器下单「刷新过期译文」（product-design §5.10 所在面板）；工具页的路由不是编辑器，先开视频 */
    const refresh = (app) => { app.openMovie(movie, {via: 'space'}); app.requestTool(movie, 'stale'); };
    return (stale ? [{label: '刷新过期译文', run: refresh}] : [])
      .concat([{label: '撤销', run: (app) => Run().undoSwitch(app, movie, orig)}]);
  }

  /**
   * 下载视频。st: {url, transcribe, saveDir, cookieBrowsers, lang?, model?, modelName?}
   * 媒体文件与（勾了下载后转录时）文稿、字幕都保存在 `saveDir`，各是一个 Space 条目。
   * cookieBrowsers 已按尝试顺序排好；演示里第一个就用上，失败时第一个读不到 Cookie、其余仍要求登录（product-design §2.7）。
   */
  function link(app, st) {
    const media = Run().linkMedia(st.url);
    const saveDir = st.saveDir || window.BC_SAVE_DIR.DEFAULT;
    media.src.path = `${saveDir}/${media.name}`;
    const opts = {target: 'none', transcribe: !!st.transcribe};
    const CK = window.BC_TOOL_COOKIES;
    const browsers = st.cookieBrowsers || [];
    return {params: paramsOf(st), tool: 'link', input: 'link', opts, title: `下载视频 · ${media.title}`, sub: CK.subText(browsers),
      failMessage: browsers.length ? CK.failureText(browsers.map((browser, i) => ({browser, login: i > 0})), (app.downloader && app.downloader.demoHost) || 'darwin')
        : '网站要求登录或验证。先在浏览器中登录目标网站，再在「网站登录」里勾选该浏览器后重新下载；网站解析失败时更新 yt-dlp 并重新检测。',
      movie: null, create: null, saveDir,
      effects: {
        store: (ctx) => Run().storeDownload(ctx.app, ctx, media, null),
        publish: (ctx) => Run().publishTranscript(ctx.app, ctx, {name: media.title, saveDir, dir: st.dir || null, lang: st.lang, model: st.model,
          sourceName: media.name, sourceUrl: st.url}),
      },
      result: () => ({lines: [`${media.name} 已下载到 ${window.BC_SAVE_DIR.label(saveDir)}`].concat(browsers.length ? [CK.usedText(browsers[0])] : [],
        st.transcribe ? ['TXT 文稿和 SRT 字幕保存在同一个目录'] : [])})};
  }

  /**
   * 翻译字幕（视频）。st: {movie, lang, bilingual, model, modelName, from}
   */
  function translateVideo(app, st) {
    const t = movieTitle(app, st.movie);
    return {params: paramsOf(st), tool: 'translate', input: 'video', title: `翻译字幕 · ${t} → ${TT.langLabel(st.lang)}`, sub: st.modelName, movie: st.movie, exportLang: st.lang,
      effects: {
        applyTr: (ctx) => Run().addDoc(ctx.app, ctx.movie, 'translations', {lang: st.lang, from: st.from && st.from.id, model: st.model}),
        layer: (ctx) => Run().layer(ctx.app, ctx, {lang: st.lang, kind: 'translation', bilingual: !!st.bilingual}),
      },
      result: () => ({lines: [`写进「${t}」：新增一份${TT.langLabel(st.lang)}译文（译自${TT.langLabel(st.from && st.from.lang)}文稿），原文没动`,
        `建立了${TT.langLabel(st.lang)}字幕层${st.bilingual ? '，双语显示' : ''}`]})};
  }

  /**
   * 翻译字幕（字幕文件或 Space 字幕条目）。st: {file?, entry?, input, lang, model, modelName, saveDir}
   * 译好的字幕是保存位置里的一个新文件、Space 里的一个字幕条目，时间码不变；原文件不动。
   */
  function translateFile(app, st) {
    const L = window.BC_LLM_TOOLS;
    const src = st.entry ? st.entry.name : st.file || '字幕';
    return {params: paramsOf(st), tool: 'translate', input: 'file', title: `翻译字幕 · ${src} → ${TT.langLabel(st.lang)}`, sub: st.modelName, saveDir: st.saveDir,
      effects: {save: (ctx) => {
        const r = L.demo('translate', {input: st.input, lang: st.lang});
        const name = window.BC_TOOL_FRAME.savedName(ctx.app, `${base(src)}-${st.lang}`, '.srt');
        Run().reg(ctx, 'subtitle', Object.assign({}, r, {id: ctx.run.id, name, file: `${st.saveDir}/${name}`,
          dir: (st.entry && st.entry.dir) || null, sourceName: st.entry ? st.entry.sourceName : null, sourceUrl: st.entry ? st.entry.sourceUrl : null,
          model: st.model, lang: TT.langLabel(st.lang), note: '交互原型示例 · 未调用模型 API', demo: true}));
      }},
      result: (ctx) => ({lines: [`译好的字幕 ${ctx.outputs[0] ? ctx.outputs[0].name : ''} 保存在 ${window.BC_SAVE_DIR.label(st.saveDir)}，时间码不变，原文件没动`]})};
  }

  /**
   * 翻译配音。st: {movie, translation?（选用的译文）, lang, engine, engineName, original, model?, modelName?}
   */
  function dub(app, st) {
    const t = movieTitle(app, st.movie);
    const fresh = !st.translation;
    /* 先翻译时新译文在「核对译文」完成时写进去；配音挂在这份译文上（读当前记录里最后一份同语言译文） */
    const lastTr = (id) => TT.facts(Run().movieNow(id)).translations.filter((x) => x.lang === st.lang).pop();
    const effects = {applyDub: (ctx) => Run().addDoc(ctx.app, ctx.movie, 'dubs', {lang: st.lang,
      translation: st.translation ? st.translation.id : (lastTr(ctx.movie) || {}).id, engine: st.engine, original: st.original})};
    if (fresh) effects.check = (ctx) => Run().addDoc(ctx.app, ctx.movie, 'translations', {lang: st.lang, model: st.model});
    const ORIG = {duck: '压低', mute: '静音', keep: '保留'};
    return {params: paramsOf(st), tool: 'dub', input: 'video', translate: fresh, title: `翻译配音 · ${t} → ${TT.langLabel(st.lang)}`, sub: st.engineName, movie: st.movie,
      effects,
      result: () => ({lines: (fresh ? [`先翻译成${TT.langLabel(st.lang)}：新增一份译文`] : [`用了已有的${st.translation.label}`]).concat(
        [`写进「${t}」：新的一组${TT.langLabel(st.lang)}配音（${st.engineName}），原来的配音保留`, `原声${ORIG[st.original] || '压低'}`])})};
  }

  window.BC_TOOL_SPECS = {transcribe, link, translateVideo, translateFile, dub, linkEffects, asrEffects};
})();
