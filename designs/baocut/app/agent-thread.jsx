/* Agent 会话线程 —— §17.2（第 109 轮）。
   一份线程、三个宿主：Agent 页（全宽）、编辑器左抽屉（compact）、首页 composer
   （只有 composer 那一截）。消息角色见 data.js `agent.sessions` 的注释。

   Agent 是装在本机的 Claude Code / Codex CLI（用户自己的订阅）：composer 上选的是
   编码 Agent ＋ 模型 ＋ 推理强度，不是 API key。每一次写入项目都要在允许卡上点一下——
   这一条是产品红线（从不无头执行），所以允许卡是线程里唯一会**停下来等你**的东西。

   第 110 轮：一条会话只绑一个项目。composer 里的 @ 只引入**只读参考**（本项目的章节 /
   说话人 / 译文 / 术语表，其他项目排最后一组），写入目标永远是绑定的那个项目。
   允许卡不再只是一条命令：它复用工具设置态（tool-setup.jsx），说清「这一步会用 gpt-4o
   翻译 42 句」，模型与范围可以当场改了再允许。

   第 111 轮补丁：项目上下文挪到输入框**上面**一行（没绑项目时才出现——已经在项目里就
   不再问）；推理强度从 Segmented 改成下拉；脚注随选中的编码 Agent 变。底栏最左一枚 +：
   附上文件 / 引用（= 敲 @）/ 使用工具（= 开头敲 /）——三件事一个入口，正文里直接敲也行。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const A = window.RSP.AI;

  /* ---------- 消息 ----------
     回复正文（Markdown、逐字显示）在 agent-markdown.jsx，工具步骤行、工作记录与回合页脚在 agent-steps.jsx。 */
  const TURN = window.BC_AGENT_TURN;
  const {AgentCopyButton: CopyMsg, AgentMarkdown, AgentWorkMsg: WorkMsg, AgentToolSteps, AgentTurnFooter} = window;

  /* 第 191 轮：正文下面只留复制——「用作草稿」撤了，复制再粘进输入框一样快，不值得一枚链接。 */
  function UserMsg({m}) {
    const [preview, setPreview] = useState(null);
    /* 交给 Agent 带的引用（§4.7）放在气泡上方，与气泡右对齐 */
    return <div className="amsg amsg--user" data-role="user">
      {m.reference && window.ComposerRefToken ? <div className="bc-ai-sent-attachments" style={{marginBottom: 0}} aria-label="引用的 Space 条目"><window.ComposerRefToken reference={m.reference} /></div> : null}
      <A.UserMessage>
      {!!m.attachments?.length && <div className="bc-ai-sent-attachments" aria-label="已发送的文件">
        {m.attachments.map((a, i) => <BCAction key={a.id || i} className="bc-ai-sent-file" aria-label={`打开附件：${a.name}`} onClick={() => setPreview(a)}>
          {window.BC_ATTACHMENTS.kind(a) === 'image' && a.url ? <img className="bc-ai-sent-preview" src={a.url} alt="" /> : <window.RSP.Icons.FileText />}
          <span>{a.name}</span>
        </BCAction>)}
      </div>}
      <div className="bc-ai-message-text" onDoubleClick={selectTextBlock}>{m.text}</div>
      {preview && <window.ComposerAttachmentViewer item={preview} items={m.attachments} onClose={() => setPreview(null)} />}
    </A.UserMessage><div className="awork__actions"><CopyMsg text={m.text} /></div></div>;
  }

  /* 这一轮真的停下来了：失败详情一行红字挂在正文下面，可选可复制。
     详情读起来是账号问题时（登录过期、401、没 API key）再多一块恢复区——
     用户在这里就能把登录做完，不必自己去设置页找入口（2026-09-20）。 */
  /* 2026-09-29：详情是「这个模型要更新版本的 CLI / 这个账号用不了它」（`modelGateFailure`）时，恢复区换成升级与显式改选。
     改选只在你点「改用 X 重新发送」时发生：先把这条会话的模型写成 X，再把最后一句原样重发——BaoCut 从不自己换模型。 */
  function ErrorMsg({m, sess}) {
    const app = useApp();
    const S = window.BC_AGENT_SETUP;
    const h = (app.harnessList || []).find((x) => x.id === sess.harness);
    const name = (h && h.name) || 'Agent';
    const cmd = S.loginCmd(h);
    const lastUser = () => [...(sess.messages || [])].reverse().find((x) => x.role === 'user');
    const resend = () => {
      const last = lastUser();
      if (last) app.sendAgent(sess.id, last.text, undefined, last.attachments || []);
    };
    const auth = S.authFailure(m.error);
    const gateHit = !auth ? S.modelGateFailure(m.error) : null;
    const gate = gateHit && h ? S.defaultModelGate(h) : null;
    const fallback = gateHit && h ? (gate ? gate.fallback : S.recommended(h)) : null;
    const pickFallback = fallback && fallback.id !== gateHit.model ? fallback : null;
    const latest = h && h.found && S.hasUpdate(h) ? h.latest : null;
    const resendWith = () => {
      /* sendAgent 读的是 sessionsRef，要等这一拍的会话补丁落进去再发，否则仍按旧模型发（同 AgentThread.patch 的写法） */
      app.patchSession(sess.id, {model: pickFallback.id, activeModel: null});
      const last = lastUser();
      if (last) setTimeout(() => app.sendAgent(sess.id, last.text, undefined, last.attachments || []), 0);
    };
    return <div className="aerr">
      <div className="aerr__line"><Ic n="alert" className="ic--14" /><span className="grow" onDoubleClick={selectTextBlock}>{m.error}</span><CopyMsg text={m.error} /></div>
      {gateHit ? <div className="aerr__fix">
        <b>{gateHit.model || '这个模型'} 需要更新版本的 {name}</b>
        <p>{h && h.found && h.ver ? `本机是 ${h.ver}${latest ? `，最新 ${latest}` : ''}。` : ''}升级只更新这个命令行工具，不影响你的账号和它自己的设置；升级后回到这里重新发送。</p>
        <div className="aerr__acts">
          <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'agent', provider: sess.harness})}>升级 {name}</Btn>
          {pickFallback ? <Btn variant="secondary" size="s" onClick={resendWith}>改用 {pickFallback.name} 重新发送</Btn> : null}
          <Btn variant="quiet" size="s" onClick={() => app.go({r: 'settings', sec: 'agent'})}>Agent 设置</Btn>
        </div>
      </div> : null}
      {auth ? <div className="aerr__fix">
        <b>{name} 需要重新登录</b>
        <p>登录在 {name} 自己的窗口里完成，BaoCut 不经手你的账号和密码。登录后回到这里重新发送。</p>
        <div className="aerr__acts">
          <Btn variant="accent" size="s" onClick={() => app.toast(`原型演示：正式版会打开终端并运行 ${cmd}`)}>打开终端登录</Btn>
          <Btn variant="secondary" size="s" onClick={resend}>重新发送</Btn>
          <Btn variant="quiet" size="s" onClick={() => app.go({r: 'settings', sec: 'agent'})}>Agent 设置</Btn>
        </div>
      </div> : null}
    </div>;
  }

  /* 工作记录挂在正文**下面**（第 191 轮）：先读结论，过程默认收着。
     流式中没有光标、也没有「正在回复」：文字本身在往外走，这一轮在不在跑看回合页脚。
     复制挪到回合页脚（整轮正文一起复制），这里不再每条一个。 */
  function AssistantMsg({m, live, sess}) {
    const app = useApp();
    const movie = m.movieId || sess.project;
    return (
      <div className="amsg amsg--ai">
        <span className="amsg__av"><Ic n="agent" className="ic--14" /></span>
        <div className="amsg__body">
          {m.text ? <AgentMarkdown text={m.text} streaming={!!m.streaming} /> : null}
          {m.open && movie && app.openTool ? <div className="amsg__open"><Btn variant="secondary" size="s" onClick={() => app.openTool(movie, m.open.tool, sess.id)}>{`打开${m.open.label}`}</Btn></div> : null}
          {m.error ? <ErrorMsg m={m} sess={sess} /> : null}
          {m.work ? <WorkMsg m={{id: `work-${m.id}`, items: m.work}} live={live}
            className={m.text ? `agap-${TURN.gapBetween('assistant', 'tool')}` : null} /> : null}
        </div>
      </div>
    );
  }

  /* 允许卡：Agent 想写项目，停下来问。三个答案——允许 / 总是允许这一类 / 拒绝。
     决定之后卡片留在线程里（变成一行记录），不消失：回头要看得见「是我允许的」。
     pending 态的正文就是工具设置态：一句话说清规模，模型与范围可以改了再允许。 */
  function PermissionMsg({m, sid}) {
    const app = useApp();
    const rule = AG.rulePrefix(m.cmd);
    const decided = m.state !== 'pending';
    const [model, setModel] = useState(null);
    const [scope, setScope] = useState(null);
    const label = {allowed: '已允许', always: `已允许 · 之后 ${rule} 不再问`, denied: '已拒绝', stopped: '已停止',
      auto: AG.autoAllowLabel(m.reason || 'rule', rule)}[m.state];
    const step = m.plan && m.plan.step;
    const answer = (mode) => app.answerPermission(sid, m.id, mode, {
      model: model ? model.name : null,
      scope: scope && scope.k !== 'all' ? scope.label : null,
    });
    if (decided) return <BCDisclosure className="awork" title={<> <Ic n="lock" className="ic--14" /> {label} · 写入视频 </>}>
      <div className="awork__section"><header>输入摘要<CopyMsg text={m.cmd} /></header><pre tabIndex={0}>{m.cmd}</pre></div>
      <p>{m.why}</p></BCDisclosure>;
    return (
      <div className={cx('aperm', decided && 'is-decided', (m.state === 'denied' || m.state === 'stopped') && 'is-denied')}>
        <div className="aperm__hd">
          <Ic n="lock" className="ic--16" />
          <b>{decided ? '写入视频' : 'Agent 想要写入视频'}</b>
          {decided ? <Chip tone={m.state === 'denied' ? 'neutral' : 'positive'}>{label}</Chip> : null}
        </div>
        {decided || !step ? null : (
          <window.ToolSetup plan={m.plan} compact model={model} onModel={setModel} scope={scope} onScope={setScope} />
        )}
        <div className="aperm__cmd t-mono">{m.cmd}</div>
        <div className="aperm__why">{m.why}{decided && (m.model || m.scope) ? ` · ${[m.model, m.scope].filter(Boolean).join(' · ')}` : ''}</div>
        {decided ? null : (
          <div className="aperm__acts">
            <Btn variant="accent" size="s" onClick={() => answer('allow')}>允许</Btn>
            <Btn variant="secondary" size="s" onClick={() => answer('always')}>总是允许 {rule}</Btn>
            <Btn variant="quiet" size="s" onClick={() => answer('deny')}>拒绝</Btn>
          </div>
        )}
      </div>
    );
  }

  function Message({m, sess}) {
    if (m.role === 'user') return <UserMsg m={m} />;
    if (m.role === 'work') return <WorkMsg m={m} live={sess.status === 'running'} className="awork--row" />;
    if (m.role === 'assistant') return <AssistantMsg m={m} live={sess.status === 'running'} sess={sess} />;
    if (m.role === 'tool') return <AgentToolSteps items={[m]} />;
    if (m.role === 'permission') return <PermissionMsg m={m} sid={sess.id} />;
    return null;
  }

  /* ---------- composer ----------
     底栏三件：跑在哪（harness · 模型）、多用力（推理强度）、以哪个项目为上下文。
     发送 = Enter，换行 = Shift+Enter。没有装任何 harness 时整块置灰、说清原因——
     不是「发送失败」，是「没有可以交出去的对象」。 */
  /* Provider · 模型两级下拉：第 186 轮起是公共组件 agent-picker.jsx::ProviderModelPicker
     （与工具页「用」下拉共用），这里只用不画。 */

  /* 访问模式（第 121 轮）：底栏的粗闸，四档（第 185 轮起挪到左边紧挨 +，弹层贴左）。它和设置里的「总是允许」规则是两层叠加，
     不是二选一——规则先读（最窄、最好解释），命不中才轮到这一档。菜单向上弹、贴左边，
     每行是 图标 + 档名 + 一句说明 + 当前档打勾；宽 288，说明整段折行。
     照搬 waku：**四档永远全部可选**，不按编码 Agent、不按任何设置开关置灰——哪个 harness
     支持哪一档是它自己的事，粗闸的语义在我们这边；切档也不弹确认框（只出一条 toast）。 */
  function AccessPicker({value, compact, narrow, onChange}) {
    const [pop, setPop] = useState(false);
    const modes = D.agent.modes;
    const cur = modes.find((m) => m.k === value) || modes[0];
    const name = `访问模式 · ${cur.label}`;
    // 抽屉里只剩档名（前缀会把底栏挤到两行），用档位图标补上「这是什么」；
    // 输入区窄（`narrow`，product-design §3.2.3）时只剩图标，档名在无障碍标签与悬停提示里
    return (
      <Picker size="s" icon={compact || narrow ? cur.icon : null} label={name} tip={narrow ? name : null}
        value={narrow ? '' : compact ? cur.label : name}
        open={pop} popWidth={288} popDir="up" popAlign="left"
        onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
        <Menu>
          {modes.map((m) => (
            <MenuItem key={m.k} icon={m.icon} label={m.label} wrap check={m.k === cur.k} sub={m.desc}
              onClick={() => { onChange(m.k); setPop(false); }} />
          ))}
        </Menu>
      </Picker>
    );
  }

  /* 写入目标（2026-10-01）：会话在某个项目（目录）里时只列这个项目的视频；不属于任何项目的会话列全部视频，
     选了哪部，会话就跟着进那部视频所在的项目。 */
  function ProjectPicker({value, onChange, locked, dir}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const proj = value ? app.projById(value) : null;
    const movies = dir ? app.moviesOf(dir) : app.activeProjects;
    /* 有项目就锁成一枚芯片：会话只绑这一个项目，换项目 = 新会话（第 110 轮）。 */
    if (locked && proj) return <Tip label="这条会话正写入这部视频 · 在对话中打开视频卡片查看"><span className="acomp__proj"><Chip icon="film">{proj.title}</Chip></span></Tip>;
    return (
      <Picker size="s" icon="film" value={proj ? proj.title : '选一部视频'} open={pop} popWidth={300} popDir="up"
        onClick={() => setPop((v) => !v)} onClose={() => setPop(false)} className={cx(!proj && 'acomp__nop')}>
        <Menu>
          {movies.map((p) => (
            <MenuItem key={p.id} icon="film" label={p.title} on={p.id === value}
              sub={p.status === 'complete' ? `${p.lang} · ${p.model}` : (D.BADGE[p.status] || {}).label}
              onClick={() => { onChange(p.id); setPop(false); }} />
          ))}
          <MenuRule />
          <MenuItem icon="plus" label="新建视频…" sub="视频、音频，或让 Agent 从零制作"
            onClick={() => { setPop(false); app.newProject(dir ? {dir} : undefined); }} />
        </Menu>
      </Picker>
    );
  }

  async function composerImageFiles(files) {
    return Promise.all(Array.from(files).map((file) => new Promise((resolve, reject) => {
      if (!file.type.startsWith('image/') || !file.size || file.size > 20 * 1024 * 1024) { reject(new Error('请选择不超过 20 MiB 的图片')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.onload = () => resolve({name: file.name || 'image.png', url: String(reader.result)});
      reader.readAsDataURL(file);
    })));
  }

  function Composer({sess, onSend, onPatch, compact, autoFocus, lockProject}) {
    const app = useApp();
    const [draft, setDraft] = useState(sess.draft || '');
    const [attachments, setAttachments] = useState(sess.draftAttachments || []);
    const [reading, setReading] = useState(false);
    /* 「+ › 使用 Skill」选的那个：挂在输入框上，发送时提示词末尾带一行；换会话就清掉。 */
    const [skillId, setSkillId] = useState(null);
    const skill = window.BC_AGENT_SKILLS.byId(app.agentSkills, skillId);
    const owner = useRef(sess.id);
    owner.current = sess.id;
    useEffect(() => { setDraft(sess.draft || ''); setAttachments(sess.draftAttachments || []); setSkillId(null); }, [sess.id]);
    const addFiles = async (files) => {
      if (reading || off) return;
      const key = sess.id;
      setReading(true);
      try {
        const added = await window.readComposerFiles(files);
        if (owner.current !== key) return;
        const all = [...attachments];
        added.forEach((a) => { if (!all.some((b) => a.url ? a.url === b.url : a.name === b.name && a.kind === b.kind)) all.push(a); });
        if (all.length > 8) throw new Error('最多附上 8 个文件');
        setAttachments(all); onPatch({draftAttachments: all});
      } catch (e) { app.toast(e.message, 'negative'); }
      finally { setReading(false); }
    };
    const ref = useRef(null);
    const boxRef = useRef(null);
    const narrow = window.useComposerNarrow(boxRef);
    // 图片批注与比例请求追加到现有草稿，带当前图片；不替换已输入的文字或附件，也不自动发送。
    useEffect(() => {
      const request = sess.draftAppend;
      if (!request) return;
      try {
        const next = window.BC_MEDIA_PREVIEW.mergeAttachments(attachments, request.images || (request.image ? [request.image] : []));
        setDraft(previous => window.BC_MEDIA_PREVIEW.appendDraft(previous, request.text));
        setAttachments(next); onPatch({draftAppend: null, draftAttachments: next});
      } catch (error) { app.toast(error.message, 'negative'); onPatch({draftAppend: null}); }
    }, [sess.draftAppend]);
    // 编辑器入口把提示词塞进 draft：composer 已经开着时也要接住
    useEffect(() => { if (sess.draft) { setDraft(sess.draft); onPatch({draft: ''}); } }, [sess.draft]);
    useEffect(() => { if (autoFocus && ref.current) ref.current.focus(); }, [autoFocus, sess.id]);
    const h = app.harnessList.find((x) => x.id === sess.harness && x.enabled) || app.harness;
    const off = !h || !h.found;
    const SETUP = window.BC_AGENT_SETUP;
    const gate = !off && h.id === sess.harness && sess.model == null && SETUP.health(h) === 'ready' ? SETUP.defaultModelGate(h) : null;
    const busy = sess.status === 'running' || sess.status === 'waiting';
    const proj = sess.project ? app.projById(sess.project) : null;
    const dirId = sess.project ? (proj && proj.dir) || null : sess.dir || null;
    // 访问模式：会话自己的那一档就是真相，没有全局上限去改写它
    const mode = AG.normalizeMode(sess.mode);
    /* Space 条目的引用标签（product-design §4.7）：读会话上的 `draftReference`，随下一条消息发出，发之前可以去掉 */
    const reference = sess.draftReference || null;
    const send = () => {
      if (off || reading || busy || (!draft.trim() && !attachments.length && !reference)) return;
      onSend(window.BC_AGENT_SKILLS.withSkill(draft.trim(), skill), attachments, reference);
      setDraft(''); setSkillId(null);
      setAttachments([]); onPatch({draftAttachments: [], ...(reference ? {draftReference: null} : {})});
    };
    const completions = filter => {
      if (filter.startsWith('/')) return AG.slashItems(filter.slice(1), D.agent.slash).map(c =>
        <A.InsertTextMenuItem key={c.cmd} id={c.cmd} text={c.cmd + ' '} textValue={c.cmd}>
          {/* S2 菜单项的文字要落在 label / description 插槽里，裸的多段文本没有栅格位 */}
          <window.RSP.Text slot="label">{`${c.label} · ${c.cmd}`}</window.RSP.Text>
          {c.sub ? <window.RSP.Text slot="description">{c.sub}</window.RSP.Text> : null}
        </A.InsertTextMenuItem>);
      return AG.mentionItems(filter.slice(1), {
        project: proj, projects: app.projects, chapters: D.chapters, speakers: D.speakers,
        langs: (D.transLangs || []).filter(l => l.done),
      }).flatMap(group => group.items.map(it => <A.InsertTokenMenuItem key={it.ref} id={it.ref}
        token={{type: 'token', text: it.ref, value: {type: 'custom', anchor: '@', valueType: 'reference', data: it.ref}}}>
        {it.label || it.ref}
      </A.InsertTokenMenuItem>));
    };
    return (
      <div ref={boxRef} className={cx('acomp', compact && 'acomp--compact', off && 'acomp--off')}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
        onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); } }}>
        {off ? (
          <div className="acomp__offnote">
            <Ic n="alert" className="ic--16" />
            <span className="grow">这台 Mac 上没有可用的编码 Agent（Claude Code 或 Codex）——指令没有可以交出去的对象。装一个或在设置里启用，用你自己的订阅登录即可。</span>
            <Btn variant="secondary" size="s" onClick={() => app.go({r: 'settings', sec: 'agent'})}>去设置</Btn>
          </div>
        ) : null}
        {/* 发之前的预检（2026-09-29）：这条会话明确选了「Agent 默认模型」（BaoCut 不传模型），而 CLI 配置里的那个模型
            这一版不认得。只提示，不挡发送；「改用 X」是你的显式改选，BaoCut 自己不换。 */}
        {gate ? (
          <div className="acomp__gate" role="status">
            <Ic n="alert" className="ic--16" />
            <div className="grow">
              <b>{h.name} 配置的默认模型 {gate.model} 需要更新的版本</b>
              <p>本机是 {gate.ver}{gate.latest ? `，最新 ${gate.latest}` : ''}。不升级的话，这个会话发出去会被拒绝。</p>
              <div className="acomp__gate-acts">
                <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'agent', provider: h.id})}>升级 {h.name}</Btn>
                {gate.fallback ? <Btn variant="secondary" size="s" onClick={() => onPatch({model: gate.fallback.id})}>改用 {gate.fallback.name}</Btn> : null}
              </div>
            </div>
          </div>
        ) : null}
        {/* 写入目标在输入框上面：还没选视频时给一行说明 + 下拉；选了就整行不出（视频入口在消息产物卡） */}
        {!off && !sess.project ? (
          <div className="acomp__note">
            <Ic n="info" className="ic--16" />
            <span className="grow">还没选视频：可以先规划和提问。要写入时，先在这里选一部视频，或把视频拖进来。</span>
            <ProjectPicker value={sess.project} locked={lockProject} dir={dirId} onChange={(id) => onPatch({project: id})} />
          </div>
        ) : null}
        <PromptField inputRef={ref} onSubmit={send} onStop={() => app.stopAgent(sess.id)} busy={busy}
          canSubmit={!off && !reading && (!!draft.trim() || !!attachments.length || !!reference)} hasAttachments={!!attachments.length || !!reference}
          renderCompletions={completions}
          attachments={<><window.ComposerSkillToken skill={skill} onRemove={() => setSkillId(null)} />
            <window.ComposerRefToken reference={reference} onRemove={() => onPatch({draftReference: null})} />
            <ComposerAttachments items={attachments} onRemove={i => {
              const all = attachments.filter((_, n) => n !== i); setAttachments(all); onPatch({draftAttachments: all});
            }} /></>} inputProps={{rows: compact ? 2 : 3, value: draft, disabled: off,
          placeholder: sess.project ? '要对这部视频做什么？比如：把口癖剪掉，再翻成英文。/ 调用工具，@ 引用章节或说话人' : '用一句话说你要做什么，或者把视频拖进来',
          onChange: (e) => setDraft(e.target.value),
          onPaste: (e) => { const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (images.length) { e.preventDefault(); addFiles(images); } },
        }}
        toolbar={<>
          {/* product-design §3.2.3：附件共用「文件和文件夹」入口，@ 引用仍走补全；工具在后面的分区。 */}
          <span inert={off || undefined}><window.ComposerInsertMenu onFiles={addFiles} onSkill={setSkillId}
            onMovie={sess.project ? undefined : (id) => onPatch({project: id})} movies={dirId ? app.moviesOf(dirId) : undefined}
            extra={<window.RSP.MenuSection aria-label="这条会话">
              <window.RSP.SubmenuTrigger><window.RSP.MenuItem id="commands" textValue="使用工具"><window.RSP.Icons.Tools /><window.RSP.Text slot="label">使用工具</window.RSP.Text></window.RSP.MenuItem>
                <window.RSP.Menu aria-label="使用工具">{D.agent.slash.map(c => <A.InsertTextMenuItem key={c.cmd} id={c.cmd} text={c.cmd + ' '}>{`${c.label} · ${c.cmd}`}</A.InsertTextMenuItem>)}</window.RSP.Menu>
              </window.RSP.SubmenuTrigger>
            </window.RSP.MenuSection>} /></span>
          {/* 草稿会话（还没说第一句话）也要能切档：写回宿主的那份草稿，`setSessionMode` 只负责种子与 toast */}
          <AccessPicker value={mode} compact={compact} narrow={narrow}
            onChange={(k) => { onPatch({mode: k}); app.setSessionMode(sess.id, k); }} />
          <span className="spacer" />
          <ProviderModelPicker sel={sess} compact={narrow} onChange={onPatch} />
        </>} />
        {compact ? null : (
          <div className="acomp__foot">{AG.composerFoot(h, mode)}</div>
        )}
      </div>
    );
  }

  /* ---------- 线程 ----------
     `sid` 为空 = 新会话：第一句话才真的建会话（然后 onCreated 把宿主切过去）。
     这样侧栏「新会话」点十次不会长出十条空会话。 */
  function AgentThread({sid, project, dir, compact, onCreated, onSent, videoCard, autoFocus}) {
    const app = useApp();
    const sess = sid ? app.sessionById(sid) : null;
    const [draftSess, setDraftSess] = useState(() => ({
      id: null, project: project || null, dir: dir || null, harness: app.harness ? app.harness.id : null,
      // 2026-09-18：起手就是设置 › Agent 里这一家的默认模型（没设过 = 推荐模型），不再一律「Agent 默认模型」
      model: app.harness ? window.BC_AGENT_SETUP.defaultModel(app.harness, app.prefs.agentModels) : null,
      // 还没落盘的会话也有访问模式：种子与真会话同一条（继承上一条，再回落全局默认）
      mode: AG.nextSessionMode(app.sessions[0], app.prefs.agentMode),
      effort: 'mid', status: 'idle', messages: [], draft: '',
    }));
    // 宿主换了项目（编辑器切项目）：草稿会话跟着换
    useEffect(() => { if (!sess) setDraftSess((d) => ({...d, project: project || null})); }, [project, !!sess]);
    const scroller = useRef(null);
    const list = useRef(null);
    const following = useRef(true);
    const cur = sess || draftSess;
    const n = cur.messages.length;
    useEffect(() => { following.current = true; }, [sid]);
    useEffect(() => {
      const el = scroller.current; if (!el) return;
      if (following.current) el.scrollTop = el.scrollHeight;
    }, [cur.messages, n, sid, cur.status]);
    /* 回复是逐帧放出来的（store 里的全文已经到了，线程里的高度还在长）：跟随到底部要看列表本身的尺寸 */
    useEffect(() => {
      const el = list.current, sc = scroller.current;
      if (!el || !sc || typeof ResizeObserver === 'undefined') return undefined;
      const ro = new ResizeObserver(() => { if (following.current) sc.scrollTop = sc.scrollHeight; });
      ro.observe(el);
      return () => ro.disconnect();
    }, [sid, n === 0]);
    const rows = AG.conversationRows(cur.messages);
    /* 每一行后面挂的卡（agent-cards.jsx）：视频卡等会话产物、还没建出视频的下载、完成的候选；
       每张只挂在第一次出现的那一行，工具消息折在回复或工作组里时挂在那一行后面 */
    const cardAt = window.BC_AGENT_CARDS
      ? window.BC_AGENT_CARDS.rowCards(rows, cur.messages, window.BC_AGENT_PROJECTS.sessionArtifacts(cur, app.spaceItems, app.tasks), app.tasks) : null;
    /* 回合：一句用户消息到下一句之前。页脚挂在每轮最后一行下面；最后一轮在跑时页脚计时 */
    const turns = TURN.turns(rows);
    const live = cur.status === 'running' || cur.status === 'waiting';
    const footerAt = new Map(turns.map((t, i) => [t.end, {turn: t, live: live && i === turns.length - 1}]));

    const patch = (p) => {
      const next = ('model' in p || 'harness' in p) ? {...p, activeModel: null} : p;
      if (!sess) { setDraftSess((d) => ({...d, ...next})); return; }
      app.patchSession(sess.id, next);
      /* 2026-10-01：选了写入目标的会话仍住在 Home——视频从消息卡片打开（第 110 轮「搬进项目编辑器」退场） */
    };
    const send = (text, attachments = [], reference = null) => {
      // product-design §5.1：Space 首条消息带当前视频卡，随后进入 Home 会话。
      const artifacts = videoCard && !cur.messages.length && cur.project ? [cur.project] : [];
      if (sess) {
        app.sendAgent(sess.id, text, undefined, attachments, reference, artifacts);
        if (onSent) onSent(sess);
        return;
      }
      const s = app.newSession({project: draftSess.project, dir: draftSess.dir, harness: draftSess.harness, model: draftSess.model,
        effort: draftSess.effort, mode: draftSess.mode});
      app.sendAgent(s.id, text, s, attachments, reference, artifacts);
      if (onCreated) onCreated(s);
      if (onSent) onSent(s);
    };
    const chips = cur.project ? D.agent.chips.editor : D.agent.chips.home;
    const proj = cur.project ? app.projById(cur.project) : null;

    return (
      <div className={cx('ath', compact && 'ath--compact')}>
        <div className="ath__scroll bc-scroll" ref={scroller} onScroll={(e) => {
          const el = e.currentTarget; following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}>
          {n === 0 ? (
            <div className="ath__empty">
              <span className="ath__glyph"><Ic n="agent" className="ic--26" /></span>
              <div className="ath__greet">{proj ? `对「${proj.title}」做点什么？` : '让 Agent 帮你做什么？'}</div>
              <div className="ath__sub">
                {proj
                  ? '它会先读这部视频，给你一个计划；写入之前一定先问你。@ 可以引用章节、说话人、译文，或别的视频做参考。'
                  : '把视频拖进来，或者先描述要做的事。它在你本机的编码 Agent 里跑，用的是你自己的订阅。'}
              </div>
              <div className="bc-ai-suggestions"><A.MessageSuggestionList aria-label="试着问问">
                {chips.map((c) => (
                  <A.MessageSuggestion key={c} onPress={() => patch({draft: c})}>{c}</A.MessageSuggestion>
                ))}
              </A.MessageSuggestionList></div>
            </div>
          ) : (
            <div className="ath__list" ref={list}>
              {rows.map((m, i) => {
                const kind = TURN.rowKind(m);
                const foot = footerAt.get(i);
                const showFoot = foot && (foot.live || (foot.turn.replied && foot.turn.user));
                return <React.Fragment key={m.id}>
                  <div className={cx('ath__row', `agap-${TURN.gapBetween(i ? TURN.rowKind(rows[i - 1]) : null, kind)}`)}>
                    <Message m={m} sess={cur} />
                    {cardAt && cardAt.has(m.id) && window.AgentRowCards ? <window.AgentRowCards cards={cardAt.get(m.id)} sess={cur} /> : null}
                  </div>
                  {/* 原先线程末尾的「正在回复」占位并进了页脚：这一轮在跑就是「正在工作 · 0:42」，停下来等放行是「等你允许」 */}
                  {showFoot ? <AgentTurnFooter turn={foot.turn} live={foot.live} waiting={foot.live && cur.status === 'waiting'}
                    className={`agap-${TURN.gapBetween(kind, 'footer')}`} /> : null}
                </React.Fragment>;
              })}
            </div>
          )}
        </div>
        <Composer sess={cur} onSend={send} onPatch={patch} compact={compact} autoFocus={autoFocus}
          lockProject={!!cur.project} />
      </div>
    );
  }

  /* 会话行（侧栏 / 首页「进行中」/ 抽屉切换菜单共用）。状态词：运行中 / 等你允许 / 完成。 */
  function SessionStatus({s}) {
    const app = useApp();
    const task = s.taskId ? app.tasks.find((t) => t.id === s.taskId) : null;
    if (s.status === 'running') return <span className="sstat sstat--run">运行中{task && task.status === 'running' ? ` · ${task.pct}%` : ''}</span>;
    if (s.status === 'waiting') return <span className="sstat sstat--wait">等你允许</span>;
    return <span className="sstat">{AG.agoLabel(s.ago)}</span>;
  }

  Object.assign(window, {AgentThread, AgentComposer: Composer, SessionStatus, AccessPicker, composerImageFiles});
})();
