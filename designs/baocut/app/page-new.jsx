/* Home 起始页（product-design §3.2.1）：一切从 Agent 输入框开始。自上而下只有标题、输入框、项目选择、
   「快捷开始」一行（点一下把一句提示词放进输入框）和模板网格；没有表单，工具从左侧 rail 进。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const AG = window.BC_AGENT;
  const N = window.BC_NEW;
  const T = window.BC_HOME_TEMPLATES;
  const S = window.BC_SHORTS;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_PROMPT_SLOTS;

  /* 带着素材开始时建项用的转录默认值（原样进 createProject）；页面上没有改它们的地方。 */
  const DEFAULTS = {lang: 'auto', model: 'moss-transcribe', speakers: true, filler: true, pause: true, badtake: false, review: true,
    bg: 'gray', subs: true, wave: true, file: null};

  function NewProjectPage() {
    const app = useApp();
    const mem = app.newMem;
    const seed = useRef(N.seed(mem)).current;
    /* 项目：默认是上次在这里选的那个（还在、没归档才算），否则不用项目（product-design §2.3：会话可以不属于任何项目）。
       在托盘里换一次就记一次；别处带着项目来的预置（newPreset.dir）只管这一次，不记。 */
    const usable = (id) => !!id && app.dirs.some((d) => d.id === id && !d.archived);
    const [dir, setDirState] = useState(() => (usable(seed.dir) ? seed.dir : null));
    const setDir = (id) => {
      const next = usable(id) ? id : null;
      setDirState(next);
      app.rememberNew({dir: next});
    };
    /* 模板与用户输入分别保存；换模板不会改写已输入的内容。 */
    const [scene, setScene] = useState(null);
    /* 模板的记忆（prefs.homeTemplates）：输入框下面的网格摆哪几个、哪些已经下载到本机。
       dl：正在下载素材的模板与进度；带素材的网上模板要先下载到本机才能开始。 */
    const tplMem = app.prefs.homeTemplates;
    const [dl, setDl] = useState(null);
    useEffect(() => {
      if (!dl) return undefined;
      if (dl.pct >= 100) {
        app.setPref('homeTemplates', T.remember(app.prefs.homeTemplates, {downloaded: dl.k}));
        app.toast(`「${T.get(dl.k).title}」的素材已下载到本机`, 'positive');
        setDl(null);
        return undefined;
      }
      const id = setTimeout(() => setDl((d) => d && {...d, pct: Math.min(100, d.pct + 20)}), 500);
      return () => clearTimeout(id);
    }, [dl]);

    /* Shorts 开关只存用户亲手拨的（true / false）；null = 没拨过，按框里这句话猜（BC_SHORTS.effective）。 */
    const [shortsPick, setShortsPick] = useState(seed.shorts);
    const [text, setText] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const h = app.harness;
    /* 2026-09-21：底栏那枚 chip 的**家 · 模型不是这一页自己的状态**——它和下面「AI 由谁来做」
       共用新会话默认档（`prefs.harness` + `prefs.agentModels`，App v2 `agent_chat_defaults`），
       两处改哪一处另一处立刻跟着。页面自己只留强度与访问档。 */
    const [own, setOwn] = useState(() => ({effort: 'mid', mode: AG.nextSessionMode(app.sessions[0], app.prefs.agentMode)}));
    const sel = {...own, harness: h ? h.id : null,
      model: h ? window.BC_AGENT_SETUP.defaultModel(h, app.prefs.agentModels) : null};
    const setSelPatch = (p) => {
      if (p.harness !== undefined || p.model !== undefined) {
        app.setAgentDefault(p.harness !== undefined ? p.harness : sel.harness,
          p.model !== undefined ? p.model : sel.model);
      }
      const rest = {...p}; delete rest.harness; delete rest.model;
      if (Object.keys(rest).length) setOwn((s) => ({...s, ...rest}));
    };


    const agentReady = app.agentAvail.ready;

    /* 主素材只有一份：`file`，从输入框的「+」或拖放加，点它的 × 去掉。 */
    const [file, setFile] = useState(null);
    const media = file || null;
    const [mediaAttachment, setMediaAttachment] = useState(null);
    const setMedia = (name, attachment = null) => {setFile(name || null); setMediaAttachment(attachment);};
    /* 「+ › 使用 Skill」选的那个：这条消息明确要求用它，发送时提示词末尾带一行（BC_AGENT_SKILLS.withSkill）。 */
    const [skillId, setSkillId] = useState(null);
    const skill = K.byId(app.agentSkills, skillId);
    /* 「+ › 最近的视频」选的已有视频：和主素材占同一个位置，两者互斥——这句话只对一条视频说。
       已有主素材时选它 = 替换，给一次撤销；它在的时候再加的视频音频只当参考材料（new-agent.jsx 的 addReal）。
       发送时不新建视频，直接在那部视频的会话里说（startAgent）。 */
    const [recentId, setRecentId] = useState(null);
    const recent = recentId ? app.projById(recentId) : null;
    const pickRecent = (id) => {
      const mv = id ? app.projById(id) : null;
      if (!mv) { setRecentId(null); return; }
      const prevFile = file, prevAttachment = mediaAttachment;
      setRecentId(mv.id);
      if (!prevFile) return;
      setMedia(null);
      app.toast(`已改为处理「${mv.title}」，「${prevFile}」已移除`, null, {label: '撤销', run: () => { setRecentId(null); setMedia(prevFile, prevAttachment); }});
    };
    const lead = recent ? recent.title : media;
    /* 没填的占位符（template-spec §5.5）不算用户的话：路线、Shorts 猜测与视频标题都按 `[label]` 版本看。 */
    const said = P.forAgent(text).trim();
    /* 往输入框里填一句提示词（快捷开始、作品示例、场景模板共用）：框里原来有字时直接替换，不先问，给一次撤销；
       填完焦点回到输入框（有占位符时选中第一处，否则光标在末尾）。`undo` 是撤销时除了文字还要还原的东西。 */
    const [focusTick, setFocusTick] = useState(0);
    const fillPrompt = (next, undo) => {
      const prev = text;
      setText(next);
      setFocusTick((n) => n + 1);
      if (prev.trim() && prev !== next) {
        app.toast('已填入提示词', null, {label: '撤销', run: () => { setText(prev); if (undo) undo(); setFocusTick((n) => n + 1); }});
      }
    };
    /* 场景模板（template-spec §5.2、§5.5）：挂在输入框上，并把 brief 填进输入框
       （带占位符，用户把占位符换成自己的内容；已经挂着的再选一次不重填）。取消挂载（再点一次同一张卡、或点 token 的 ×）只摘模板，不动文字。
       模板的默认画幅与时长由 Runtime 随模板段交给 Agent，起始页不另设。撤销把文字与模板一起还原（同 applyExample）。 */
    const pickScene = (k) => {
      const template = T.get(k);
      const prev = {scene, dl, shortsPick};
      setScene(template ? k : null);
      setDl(T.needsDownload(template, T.downloaded(tplMem)) ? {k, pct: 0} : null);
      if (!template) return;
      app.setPref('homeTemplates', T.remember(tplMem, {pick: k}));
      setShortsPick(false);
      if (template.brief && k !== scene) {
        fillPrompt(template.brief, () => {
          setScene(prev.scene); setShortsPick(prev.shortsPick);
          setDl(prev.dl ? {...prev.dl, pct: 0} : null);
        });
      }
    };
    /* 快捷开始：只换输入框里的字，模板与素材都不动；不发送。 */
    const applyStarter = (x) => fillPrompt(x.prompt);
    /* 新建空白视频：不是提示词，也不经过 Agent。画幅用上次的（没有就是 16:9），建好直接进编辑器。
       `inDir`：别处带着项目来时用它，否则用页面上选的项目。 */
    const createBlank = (inDir) => {
      const proj = app.createProject(null, {entry: 'blank', dir: inDir || dir, ratio: seed.ratio});
      app.go({r: 'editor', id: proj.id});
      app.toast('空白视频已创建', 'positive');
    };
    /* 别处带着预置来（⌘N、Space 的「新建」、会话里的「新建视频」、导入失败「换个素材」、帮助中心）：读一次就清掉。
       `entry: 'media'`：带了文件就挂成输入框的主素材，带了目标且有对应的快捷开始、输入框又空着，就填上那句提示词；
       `entry: 'blank'`：直接建空白视频；`entry: 'agent'` 或不带入口：只落到这一页。旧表单的字段（options、src、url）不再读。
       `prompt` / `skill`（设置里 skill 详情的「试一下」）：把这句话填进输入框，并挂上那个 skill 的 token；哪个入口都认。 */
    useEffect(() => {
      const p = app.newPreset;
      if (!p) return;
      app.takeNewPreset();
      if (p.dir) setDirState(p.dir);
      if (p.entry === 'blank') { createBlank(p.dir); return; }
      if (p.prompt) { setText(p.prompt); setFocusTick((n) => n + 1); }
      if (p.skill) setSkillId(p.skill);
      if (p.entry !== 'media') return;
      if (p.file) setMedia(p.file);
      const x = p.goal ? N.starter(p.goal) : null;
      if (x && !text.trim()) { setText(x.prompt); setFocusTick((n) => n + 1); }
    }, [app.newPreset]);
    /* 作品示例（template-spec §5.1）：提示词全文放进输入框（之后就是用户自己的话，可以改），不挂模板、不走简报。
       撤销把文字与模板一起还原。 */
    const applyExample = (k) => {
      const t = T.get(k);
      if (!t) return;
      const prev = {scene, dl, shortsPick};
      setScene(null);
      setDl(null);
      setShortsPick(false);
      app.setPref('homeTemplates', T.remember(tplMem, {pick: k}));
      fillPrompt(T.prompt(t), () => {
        setScene(prev.scene); setShortsPick(prev.shortsPick);
        if (prev.dl) setDl({...prev.dl, pct: 0});   // 被打断的素材下载从头再来
      });
    };
    /* 内置模板不带制作类型：挂着模板时路线按这句话猜（猜不出就是自由发挥）。 */
    const template = T.get(scene);
    const picked = template ? null : scene;
    const route = N.route(said, lead ? [{name: lead, kind: 'media'}] : [], picked);
    const aGate = N.aiGate(route.goal, null, app.agentAvail);
    /* 同一枚开关两种用法：做新视频 → 按 Shorts 做；带着视频 → 切成几条 Shorts（交给 Agent 的那一行换成切片版，
       一支一个新项目、记来源片段）。 */
    const shorts = S.effective(shortsPick, said);
    const shortsOn = !route.media && route.by !== 'scene' && shorts.on;
    const shortsCut = !!route.media && route.by === 'media' && shorts.on;
    /* 模板本身不代替创作主题；需要一句话或参考材料才能开始。 */
    const ownWords = said;
    const request = N.homePrompt(text, template && {title: template.title}, {shorts: shortsOn, attachments: files.length});
    const aCan = dl ? {ok: false, why: '模板素材还在下载'} : N.canStart(route.goal, {media: !!route.media, prompt: lead && scene ? request : route.goal === 'ask' ? said : ownWords, own: ownWords, attachments: files.length, gate: aGate});
    const startAgent = () => {
      if (!aCan.ok || busy) return;
      const g = N.goal(route.goal);
      const rest = files;
      const names = rest.filter((f) => !f.url).map((f) => f.name);
      const run = {harness: sel.harness, model: sel.model, effort: sel.effort, mode: sel.mode};
      /* 「转录并翻译」填的目标语言记下来，下次点这条快捷开始直接沿用（N.starterTarget 认不出就不记） */
      app.rememberNew({entry: 'agent', picked, shorts: shortsPick, targetName: N.starterTarget(text)});
      const materials = names.length ? `\n材料：${names.join('、')}` : '';
      if (recent) {
        // 选了已有的视频：不新建，直接在它的会话里说；带着素材的那条路线照旧（含切成 Shorts 的那一行）
        const cut = shortsCut ? `\n${S.cutPromptLine(S.cutCount(said))}` : '';
        app.openAgent({project: recent.id, prompt: K.withSkill(request + cut + materials, skill), attachments: [...rest.filter((f) => f.url), ...(mediaAttachment?.name === media ? [mediaAttachment] : [])], send: true, ...run});
        app.toast(`已交给 Agent · 在「${recent.title}」里继续`, 'positive');
        return;
      }
      if (route.media) {
        // 带着素材：先建项转录（§8.4 的原子短事务），Agent 在这个项目的会话里等转录完再动手
        setBusy(true);
        setTimeout(() => {
          setBusy(false);
          const proj = app.createProject(route.media, {...DEFAULTS, dir, entry: 'sub', intent: 'ask'});
          const cut = shortsCut ? `\n${S.cutPromptLine(S.cutCount(said))}` : '';
          app.openAgent({project: proj.id, prompt: K.withSkill(request + cut + materials, skill),
            attachments: [...rest.filter((f) => f.url), ...(mediaAttachment?.name === media ? [mediaAttachment] : [])], send: true, ...run});
          app.toast('视频已创建 · 转录在后台跑，Agent 会等它', 'positive');
        }, 900);
        return;
      }
      const prompt = K.withSkill(request + materials, skill);
      if (N.linkIn(said)) {
        /* 话里带着链接（视频网站的页面、文件地址）：不先建空白视频，直接开会话，由 Agent 把视频下载下来再建视频。
           会话落在选中的项目里；不用项目时会话先不属于任何项目，建视频时按 §2.3 自动建项目。 */
        app.openAgent({dir: dir || undefined, prompt, attachments: rest.filter((f) => f.url), send: true, ...run});
        app.toast('已交给 Agent · 链接里的视频由它下载', 'positive');
        return;
      }
      const ratio = shortsOn ? S.RATIO : '16:9';
      const proj = app.createProject(null, {entry: 'blank', dir, ratio, delivery: shortsOn ? 'shorts' : undefined, title: `${template ? template.title : g.k === 'free' ? 'Agent 制作' : g.title} · ${(said || names[0] || '未命名').slice(0, 16)}`});
      app.openAgent({project: proj.id, prompt, attachments: [...rest.filter((f) => f.url), ...(mediaAttachment?.name === media ? [mediaAttachment] : [])], send: true, ...run});
      app.toast(`视频已创建 · 已交给 Agent 制作${g.k === 'free' ? '' : g.title}`, 'positive');
    };

    return (
      <Page fluid>
        <div className="newp home-create">
          {/* 旧版项目导入在跑 / 留了没导入的（legacy-import-task.jsx，只在 App） */}
          {window.LegacyImportBanner ? <window.LegacyImportBanner /> : null}
          <div className="newp__hd newp__hd--hero">
            <div className="greet">想做个什么视频？</div>
          </div>
          <window.NewAgentHero text={text} onText={setText} files={files} onFiles={setFiles} media={media} mediaAttachment={mediaAttachment} onMedia={setMedia}
            recent={recent} onRecent={pickRecent} skill={skill} onSkill={setSkillId}
            scene={scene} onScene={pickScene} downloading={dl} focusTick={focusTick} dir={dir} onDir={setDir}
            sel={sel} onSel={setSelPatch} ready={agentReady} can={aCan} busy={busy} onSubmit={startAgent} />
          <window.NewGateCard guide={N.gateGuide(route.goal, aGate)} avail={app.agentAvail} />
          <window.HomeStarters items={N.homeStarters({targetName: seed.targetName})} onPick={applyStarter} onBlank={() => createBlank()} />
          <window.HomeTemplateShelf scene={scene} onScene={pickScene} onExample={applyExample} shelf={tplMem && tplMem.recent} downloaded={T.downloaded(tplMem)} />
        </div>
      </Page>
    );
  }

  Object.assign(window, {HomePage: NewProjectPage, NewProjectPage});
})();
