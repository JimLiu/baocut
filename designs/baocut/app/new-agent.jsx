/* Home 创建区（product-design §3.2.1）：Agent 输入框、项目，输入框下面的「快捷开始」一行，以及 AI 闸门的引导卡。
   模板网格在 home-templates.jsx。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const T = window.BC_HOME_TEMPLATES;
  const N = window.BC_NEW;
  const M = window.BC_MEDIA;
  const P = window.BC_PROMPT_SLOTS;
  const R = window.RSP;
  const A = R.AI;

  /* 快捷开始（product-design §3.2.1：主入口是输入框，这些只是可选的起点）：处理已有视频或音频的几件常见事。
     点一下只把一句提示词放进输入框，不展开表单、不发送；素材照常从输入框的「+」或拖放加。条目与提示词在 BC_NEW.homeStarters。
     行尾的「新建空白视频」不是提示词：不经过 Agent，直接建一部空白视频进编辑器。 */
  function HomeStarters({items, onPick, onBlank}) {
    return <div className="home-quick" role="group" aria-label="快捷开始">
      <span className="home-quick__label" aria-hidden="true">快捷开始</span>
      <div className="home-quick__items">
        {items.map(x => <R.TooltipTrigger key={x.k} placement="bottom">
          <R.ActionButton isQuiet size="S" onPress={() => onPick(x)}><Ic n={x.icon} className="ic--16" /><R.Text>{x.title}</R.Text></R.ActionButton>
          <R.Tooltip>{x.tip}</R.Tooltip>
        </R.TooltipTrigger>)}
      </div>
      <R.TooltipTrigger placement="bottom">
        <R.ActionButton isQuiet size="S" onPress={onBlank}><Ic n="blank" className="ic--16" /><R.Text>新建空白视频</R.Text></R.ActionButton>
        <R.Tooltip>不转录、不排队，直接进编辑器</R.Tooltip>
      </R.TooltipTrigger>
    </div>;
  }
  /* 待填提示（template-spec §5.5；product-design §2.6）：输入框里还有占位符时，框下面一行说还有几处、是哪些，
     不填也能发送；「填下一处」把焦点放回输入框并选中下一个占位符（同 Tab）。没有待填项时只留一个空的 status 区。 */
  function SlotHint({labels, onNext}) {
    return <div className="pslot-hint" role="status">
      {labels.length > 0 && <>
        <span className="pslot-hint__t">还有 {labels.length} 处待填：{labels.join('、')} · 不填也能发送，Agent 会先问你</span>
        <R.ActionButton isQuiet size="S" onPress={onNext}>填下一处</R.ActionButton>
      </>}
    </div>;
  }
  /* AI 闸门：输入框里这句话要交给 Agent，却没有可用的 Agent 时，在输入框下面给一句原因和去处（BC_NEW.gateGuide）。 */
  function GateCard({guide, avail}) {
    const app = useApp();
    if (!guide) return null;
    const h = guide.enable && avail && avail.installed && avail.installed[0];
    const fix = () => (h ? app.enableAgent(h.id) : app.go(guide.route));
    return <div className="ngate" role="status">
      <span className="ngate__ic"><Ic n="alert" className="ic--16" /></span>
      <div className="ngate__t grow"><b>{guide.title}</b><p>{guide.body}</p></div>
      <div className="ngate__acts"><Btn variant="accent" size="s" onClick={fix}>{h ? `启用 ${h.name}` : guide.fix}</Btn></div>
    </div>;
  }
  // 项目是工作目录（product-design §2.3、§3.1）；两个创建入口共用此表单。
  function CreateProjectDialog({onClose, onCreated}) {
    const app = useApp();
    const P = window.BC_AGENT_PROJECTS;
    const [name, setName] = useState('');
    const [parent, setParent] = useState('');
    const [custom, setCustom] = useState(false);
    const [touched, setTouched] = useState(false);
    const error = P.dirCreationError(name, parent);
    const preview = !error ? P.newDir(app.dirs, 'preview', name, parent) : null;
    const create = () => {
      if (error) { setTouched(true); return; }
      const project = app.createDir(name.trim(), parent.trim());
      onCreated(project);
      onClose();
      app.toast(`已创建项目「${project.name}」`, 'positive');
    };
    return <BCModal title="创建项目" size="S" onClose={onClose} className="home-project-dialog">
      <div className="home-project-dialog__close"><IconBtn icon="close" tip="关闭创建项目" onClick={onClose} /></div>
      <div className="home-project-dialog__heading"><span className="home-project-dialog__mark"><R.Icons.Folder /></span><h2>创建项目</h2></div>
      <form className="home-project-dialog__form" onSubmit={e => { e.preventDefault(); create(); }}>
        <R.TextField label="项目名称" placeholder="给项目起个名字" value={name} onChange={setName} autoFocus
          onBlur={() => setTouched(true)} isInvalid={touched && !!P.dirCreationError(name, '~/')}
          errorMessage={P.dirCreationError(name, '~/')} UNSAFE_className="home-project-dialog__field" />
        <section className="home-project-dialog__location" aria-label="保存文件夹">
          <div className="home-project-dialog__label"><span>保存文件夹</span><span className="home-project-dialog__device"><R.Icons.DeviceLaptop />这台电脑</span></div>
          <R.MenuTrigger>
            <R.ActionButton aria-label="选择保存文件夹" UNSAFE_className="home-project-dialog__folder"><R.Icons.FolderOpen /><R.Text>{parent || '选择文件夹'}</R.Text></R.ActionButton>
            <R.Menu aria-label="保存位置" onAction={key => { setCustom(key === 'custom'); if (key !== 'custom') setParent(String(key)); }}>
              <R.MenuItem id="~/BaoCut/" textValue="BaoCut"><R.Icons.Folder /><R.Text>BaoCut</R.Text><R.Text slot="description">~/BaoCut/</R.Text></R.MenuItem>
              <R.MenuItem id="~/Movies/" textValue="视频"><R.Icons.Folder /><R.Text>视频</R.Text><R.Text slot="description">~/Movies/</R.Text></R.MenuItem>
              <R.MenuItem id="~/Desktop/" textValue="桌面"><R.Icons.Folder /><R.Text>桌面</R.Text><R.Text slot="description">~/Desktop/</R.Text></R.MenuItem>
              <R.MenuItem id="custom" textValue="输入其他路径…"><R.Icons.Edit /><R.Text>输入其他路径…</R.Text></R.MenuItem>
            </R.Menu>
          </R.MenuTrigger>
          {custom && <R.TextField label="文件夹路径" placeholder="~/Movies/" value={parent} onChange={setParent}
            isInvalid={!!parent && !!P.dirCreationError('项目', parent)} errorMessage={P.dirCreationError('项目', parent)} UNSAFE_className="home-project-dialog__field" />}
          {preview && <p className="home-project-dialog__path">项目将保存在 {preview.path}</p>}
        </section>
        <div className="home-project-dialog__actions"><R.Button variant="secondary" onPress={onClose}>取消</R.Button><R.Button variant="accent" type="submit" isDisabled={!!error}>创建</R.Button></div>
      </form>
    </BCModal>;
  }
  function HomeProjectPicker({dir, onDir}) {
    const app = useApp();
    const [creating, setCreating] = useState(false);
    const selected = app.dirs.find(d => d.id === dir);
    return <div className="home-create__project">
      <span className="home-project-dialog__device"><R.Icons.DeviceLaptop />这台电脑</span>
      <R.MenuTrigger>
        <R.ActionButton size="S" isQuiet aria-label={'选择项目：' + (selected?.name || '未选择')}><R.Icons.Folder /><R.Text>{selected?.name || '选择项目'}</R.Text></R.ActionButton>
        <R.Menu aria-label="选择项目" onAction={key => key === 'new' ? setCreating(true) : onDir(key)}>
          <R.MenuSection>{app.dirs.map(d => <R.MenuItem key={d.id} id={d.id} textValue={d.name}><R.Icons.Folder /><R.Text>{d.name}</R.Text>{d.id === dir && <R.Text slot="description">当前项目</R.Text>}</R.MenuItem>)}</R.MenuSection>
          <R.MenuSection><R.MenuItem id="new" textValue="新建项目"><R.Icons.Add /><R.Text>新建项目</R.Text></R.MenuItem></R.MenuSection>
        </R.Menu>
      </R.MenuTrigger>
      {selected && <span className="home-create__project-path" title={selected.path}>{selected.path}</span>}
      {creating && <CreateProjectDialog onClose={() => setCreating(false)} onCreated={d => onDir(d.id)} />}
    </div>;
  }
  function AgentHero({text, onText, files, onFiles, media, mediaAttachment, onMedia, recent, onRecent, skill, onSkill, scene, onScene, downloading, focusTick, dir, onDir, sel, onSel, ready, can, busy, onSubmit}) {
    const app = useApp();
    const [over, setOver] = useState(false);
    const ta = useRef(null);
    /* 输入框按自己的宽度收窄（product-design §3.2.3）：访问模式与 Agent 只剩图标、模型只留级别名 */
    const boxRef = useRef(null);
    const narrow = window.useComposerNarrow(boxRef);
    /* 「填下一处」与填入带占位符的提示词后：PromptField 聚焦并选中光标后的下一个占位符（template-spec §5.5）。 */
    const [slotTick, setSlotTick] = useState(0);
    const slots = P.labels(text);
    /* 填入提示词后（快捷开始、作品示例、模板库）焦点回到输入框：等弹窗把焦点还给触发按钮之后再拿回来，
       有占位符时选中第一处，否则光标放到末尾。 */
    useEffect(() => {
      if (!focusTick) return undefined;
      const id = setTimeout(() => {
        if (!ta.current) return;
        if (slots.length) { setSlotTick((n) => n + 1); return; }
        ta.current.focus();
        /* ref 是 PromptField 的句柄，不是 DOM 节点：聚焦后对拿到焦点的可编辑区把光标放到末尾。 */
        const el = document.activeElement, sel = window.getSelection();
        if (el && el.isContentEditable && sel) { sel.selectAllChildren(el); sel.collapseToEnd(); el.scrollTop = el.scrollHeight; }
      }, 60);
      return () => clearTimeout(id);
    }, [focusTick]);
    /* 主素材（`media`）一个项目一条：空着时第一条视频 / 音频补上去；已经有了就**不替换**，再来的视频音频
       和文档、图片一样进 `files`，交给 Agent 当参考（做 MV 时的风格参考片）。一次放多少份都收，一份不丢；
       要换主素材先点它的 ×。App 同一条规则在 `home::split_home_paths`。
       `recent`：从「+ › 最近的视频」选的已有视频，和主素材占同一个位置（两者互斥，规则在 page-new.jsx 的 pickRecent）；
       它在的时候再来的视频音频同样只进 `files`。 */
    const merge = (list, f) => list.filter((x) => x.name !== f.name).concat([f]).slice(0, 8);
    const addReal = async (list) => {
      try {
        const loaded = await window.readComposerFiles(list);
        const lead = media || recent ? null : loaded.find(file => file.kind === 'media');
        if (lead) onMedia(lead.name, lead);
        onFiles(loaded.filter(file => file !== lead).reduce(merge, files).slice(0, 8));
      } catch (error) {app.toast(error.message, 'negative');}
    };
    const hasMedia = !!(media || recent);
    const template = T.get(scene);
    return <div className="nhero">
      <div ref={boxRef} className={cx('bc-ai-home', over && 'is-over')}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); addReal(Array.from(e.dataTransfer.files)); }}>
        <PromptField inputRef={ta} selectSlot={slotTick} onSubmit={onSubmit} busy={busy} canSubmit={can.ok} hasAttachments={files.length > 0 || hasMedia}
          attachments={<>
            <window.ComposerSkillToken skill={skill} onRemove={() => onSkill(null)} />
            {template && <div className="home-template-token"><window.HomeTemplateThumb t={template} size="xs" /><span>模板：{template.title}</span>
              {downloading && <span className="home-template-token__dl" aria-live="polite">正在下载素材 {downloading.pct}%</span>}
              <IconBtn icon="close" size="xs" tip="移除模板" onClick={() => onScene(null)} /></div>}
            <ComposerAttachments items={[...(hasMedia ? [mediaAttachment || {name: recent ? recent.title : media, kind: 'media'}] : []), ...files]}
              onRemove={i => { if (hasMedia && i === 0) { if (recent) onRecent(null); else onMedia(null); } else onFiles(files.filter((_, n) => n !== i - (hasMedia ? 1 : 0))); }} />
          </>}
          inputProps={{value: text, disabled: !ready, placeholder: template ? '想讲什么内容？补充主题、受众或你的要求…' : '描述你想做的视频，或把素材拖到这里…',
            onChange: e => onText(e.target.value), onPaste: e => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); addReal(fs); } }}}
          toolbar={<><window.ComposerInsertMenu onSkill={onSkill} onMovie={onRecent} onFiles={addReal} /><span className="spacer" />
            {ready && <><window.AccessPicker value={sel.mode} narrow={narrow} onChange={mode => onSel({mode})} /><window.ProviderModelPicker sel={sel} compact={narrow} onChange={onSel} /></>}
          </>} />
      </div>
      {recent ? <div className="home-create__project"><span className="home-create__project-path">在「{recent.title}」里继续，不新建视频</span></div>
        : <HomeProjectPicker dir={dir} onDir={onDir} />}
      <SlotHint labels={ready ? slots : []} onNext={() => setSlotTick((n) => n + 1)} />
    </div>;
  }
  Object.assign(window, {NewAgentHero: AgentHero, HomeStarters, NewGateCard: GateCard, CreateProjectDialog});
})();
