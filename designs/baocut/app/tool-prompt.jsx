/* AI 工具页的提示词框（product-design §5.10，2026-10-09）。
   以前工具页是「还有什么要求」一只框子加一块只读的「会发给 Agent 的话」——同一段话出现两次。现在只有一只框：
   预填模板（意图句 + 固定约束，BC_AIPROMPT.template），用户直接改这段话；它与会话输入框是同一个控件
   （PromptField + 「+」菜单 + 附件），`@` 能引用章节、说话人与译文，`/` 不在这里（已经在工具页里了）。
   底栏随「用」变：交给 Agent 时是访问模式与 Agent · 模型（与会话输入框同一套选择器），直接调模型时是文本模型。
   主按钮在框下面，全宽、写明动作；再下面一行 hint 说清按下去会去哪。 */
(function () {
  const {useState, useRef} = React;
  const D = window.BC_DATA;
  const AG = window.BC_AGENT;
  const P = window.BC_AIPROMPT;

  /** ToolSetup 里的「会话」一行：交给 Agent 时发到哪条会话，缺省新会话（§5.10）。 */
  function SessionRow({ctx, value, onChange}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const so = P.sessionOptions(app.sessions, ctx.proj.id);
    const cur = so.options.find((o) => o.k === (value || so.dflt)) || so.options[0];
    return (
      <div className="tsetup__row">
        <span className="tsetup__lb">会话</span>
        <Picker size="s" value={cur.label} open={pop} popWidth={320} onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
          <Menu>
            {so.options.map((o) => <MenuItem key={o.k} label={o.label} sub={o.sub} on={o.k === cur.k} onClick={() => { onChange(o); setPop(false); }} />)}
          </Menu>
        </Picker>
      </div>
    );
  }

  /* 交给 Agent 时底栏那两枚选择器的状态：家 · 模型跟新会话默认档（输入框底栏那枚 chip），访问模式继承上一条会话。 */
  function useAgentSel() {
    const app = useApp();
    const h = app.harness;
    const [sel, setSel] = useState(() => ({
      harness: h ? h.id : null,
      model: h ? window.BC_AGENT_SETUP.defaultModel(h, app.prefs.agentModels) : null,
      effort: 'mid',
      mode: AG.nextSessionMode(app.sessions[0], app.prefs.agentMode),
    }));
    return [sel, (patch) => setSel((s) => Object.assign({}, s, patch))];
  }

  /**
   * props：
   *   ctx / tool          编辑器上下文与工具 id
   *   runner              useToolRunner 的返回（agent / apiModel / pick）
   *   value / onChange    输入框里的话：null = 还没改过，显示 defaultText（模板）；改过才出「恢复默认」，恢复即 onChange(null)
   *   session / onSession 「会话」行的值（{k:'new'|'current', sid}），由宿主放进 ToolSetup；这里只用来写 hint
   *   context             直接调模型时发给模型的上下文（BC_AIPROMPT.contextPack 的返回）
   *   label               直接调模型时主按钮的字（交给 Agent 时固定「交给 Agent」）
   *   readonly            写作与发布类：不写进视频（hint 用）
   *   onStart(payload)    {text, attachments, skillId, harness, model, effort, mode}
   */
  function ToolPrompt({ctx, tool, runner, value, onChange, defaultText, session, context, label, readonly, onStart, disabled}) {
    const app = useApp();
    const [attachments, setAttachments] = useState([]);
    const [skillId, setSkillId] = useState(null);
    const [reading, setReading] = useState(false);
    const [sel, patchSel] = useAgentSel();
    const ref = useRef(null);
    const boxRef = useRef(null);
    const narrow = window.useComposerNarrow(boxRef);
    const skill = window.BC_AGENT_SKILLS.byId(app.agentSkills, skillId);
    const agent = !!runner.agent;
    // 模板随范围、勾选项变：用户没改过（value 为 null）就一直显示最新模板，改过的那段话是用户的，不动
    const edited = value != null;
    const text = edited ? value : (defaultText || '');

    const addFiles = async (files) => {
      if (reading) return;
      setReading(true);
      try {
        const added = await window.readComposerFiles(files);
        const all = attachments.slice();
        added.forEach((a) => { if (!all.some((b) => (a.url ? a.url === b.url : a.name === b.name && a.kind === b.kind))) all.push(a); });
        if (all.length > 8) throw new Error('最多附上 8 个文件');
        setAttachments(all);
      } catch (e) { app.toast(e.message, 'negative'); }
      finally { setReading(false); }
    };
    const completions = (filter) => {
      if (filter.startsWith('/')) return [];
      return AG.mentionItems(filter.slice(1), {
        project: ctx.proj, projects: app.projects, chapters: ctx.chapters || D.chapters, speakers: D.speakers,
        langs: (D.transLangs || []).filter((l) => l.done),
      }).flatMap((group) => group.items.map((it) => <window.RSP.AI.InsertTokenMenuItem key={it.ref} id={it.ref}
        token={{type: 'token', text: it.ref, value: {type: 'custom', anchor: '@', valueType: 'reference', data: it.ref}}}>
        {it.label || it.ref}
      </window.RSP.AI.InsertTokenMenuItem>));
    };
    const start = () => {
      if (disabled || reading) return;
      onStart({text: window.BC_AGENT_SKILLS.withSkill(text.trim(), skill), attachments, skillId,
        harness: sel.harness, model: sel.model, effort: sel.effort, mode: sel.mode});
    };
    const model = runner.apiModel;
    const hint = P.hint({agent, session: session && session.k, model: model ? model.name : null, readonly, cloud: !!model});
    // 直接调模型而这个模型看不了图：附了图片就说一声，不拦
    const images = !agent && attachments.filter((a) => window.BC_ATTACHMENTS.kind(a) === 'image').length;
    const ctxItems = (context || []).concat(attachments.length ? [{k: 'attachments', label: '附件', detail: `${attachments.length} 个`}] : []);
    return (
      <div ref={boxRef} className="aitp">
        <div className="aitp__hd">
          <span className="t-detail-xs">{agent ? '要对 Agent 说的话' : '提示词'}</span>
          <span className="spacer" />
          {edited ? <BCAction className="tsetup__lnk" onClick={() => onChange(null)}>恢复默认</BCAction> : null}
        </div>
        <div className="aitp__box"
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }}
          onDrop={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); } }}>
          <PromptField inputRef={ref} busy={false} canSubmit={false} hasAttachments={!!attachments.length}
            renderCompletions={completions}
            attachments={<>
              <window.ComposerSkillToken skill={skill} onRemove={() => setSkillId(null)} />
              <ComposerAttachments items={attachments} onRemove={(i) => setAttachments(attachments.filter((_, n) => n !== i))} />
            </>}
            inputProps={{rows: 5, value: text, disabled, 'aria-label': agent ? '要对 Agent 说的话' : '提示词',
              placeholder: '要做什么、怎么做；@ 引用章节或说话人',
              onChange: (e) => onChange(e.target.value),
              onPaste: (e) => { const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/')); if (imgs.length) { e.preventDefault(); addFiles(imgs); } },
            }}
            toolbar={<>
              {/* product-design §3.2.3：附件共用「文件和文件夹」入口，Skill 挂成 token，@ 引用走补全 */}
              <window.ComposerInsertMenu onFiles={addFiles} onSkill={setSkillId} />
              {agent ? <window.AccessPicker value={sel.mode} compact narrow={narrow} onChange={(k) => patchSel({mode: k})} /> : null}
              <span className="spacer" />
              {agent
                ? <window.ProviderModelPicker sel={sel} compact={narrow} onChange={patchSel} />
                : <window.ToolModelPick value={model ? model.id : (D.transModels[0] || {}).id}
                    onChange={(m) => runner.pick({k: `api:${m.id}`, kind: 'api', model: m.id})} />}
            </>} />
        </div>
        {!agent ? (
          <div className="aitp__ctx">
            <Ic n="info" className="ic--14" />
            <span>{P.contextLine(ctxItems)}{images ? `；${model ? model.name : '这个模型'}看不了图，${images} 张图片会略过` : ''}</span>
          </div>
        ) : null}
        <div className="flowcta">
          <Btn variant="accent" disabled={disabled || reading} onClick={start} style={{width: '100%'}}>{agent ? '交给 Agent' : label}</Btn>
        </div>
        <div className="hint">{hint}</div>
      </div>
    );
  }

  Object.assign(window, {ToolPrompt, ToolSessionRow: SessionRow});
})();
