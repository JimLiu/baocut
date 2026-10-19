/* 品牌（2026-10-16 项目品牌；2026-10-18 加全局品牌、先用 Agent 建）：BRAND.md 是 Agent 创作时的品牌参考，
   等同于一个品牌 skill，只是总在生效、没有开关。模型在 model-project-brand.js。
   - 两种范围：全局（~/.baocut/BRAND.md，所有会话都用）与项目（项目根目录的 BRAND.md，只在那个项目里用）；
     项目的和全局的说法不一样时以项目的为准。每行都写明它管哪里、文件在哪。
   - Skills 页「品牌」段（BrandsSection）：全局一行（没有时是一行空态）+ 有 BRAND.md 的项目各一行；段头「新建品牌」。
   - 新建（BrandCreateDialog / BrandCreate 页）：先选用在哪里，再选怎么建——默认「和 Agent 一起建」：
     新开一条会话，第一条消息请 Agent 一次问一个问题，问完给草稿、确认后写成 BRAND.md；也可以空白模板或从品牌 skill 生成。
   - #/skills?dir=<项目 id 或 global>（ProjectBrandPage）：有就是详情（概览 / 文件，改了直接存回，不分版本）；没有就是新建。
   - Home 侧栏项目菜单与会话页头菜单的「品牌（BRAND.md）」都到这里。
   - 输入框上的「品牌：…」标签（ComposerBrandToken）：这条会话带上了哪几份品牌；点 × 只是这条消息不用。
   写盘、在文件夹中显示都是演示。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_SKILL_PKG;
  const PB = window.BC_PROJECT_BRAND;
  const NO_SWITCH = '不用选，也没有开关。';
  const autoLine = (dir) => (PB.isGlobal(dir) ? `每条会话都会自动参考它，${NO_SWITCH}` : `这个项目的每条会话都会自动参考它，${NO_SWITCH}`);

  /** 范围对应的项目：全局的是个假项目，其余从 app.dirs 找 */
  function useBrandDir(dirId) {
    const app = useApp();
    if (PB.isGlobal(dirId)) return PB.globalDir();
    return app.dirById ? app.dirById(dirId) : null;
  }

  function useBrandActions() {
    const app = useApp();
    return {
      open(dirId, tab) { app.go({r: 'skills', dir: dirId, ...(tab ? {tab} : {})}); },
      reveal(d) { app.toast(`原型演示：在文件夹中显示 ${d.path}${PB.FILE}`); },
      newSession(d) { if (PB.isGlobal(d)) app.newProject({entry: 'agent'}); else app.go({r: 'agent', dir: d.id}); },
      remove(d) {
        const prev = PB.brandOf(app.projectBrands, d.id);
        app.setProjectBrands((l) => PB.remove(l, d.id));
        app.toast(`已删除「${d.name}」的 BRAND.md（演示）`, null, prev ? {label: '撤销', run: () => app.setProjectBrands((l) => [prev, ...PB.remove(l, d.id)])} : null);
      },
      /* 建：agent 新开一条会话（项目的就开在那个项目里），其余直接写文件后进文件页签 */
      create(dir, how, skill) {
        if (how === 'agent') {
          app.newProject({entry: 'agent', prompt: PB.interviewPrompt(dir), ...(PB.isGlobal(dir) ? {} : {dir: dir.id})});
          return;
        }
        const files = how === 'skill' && skill ? PB.fromSkill(skill) : PB.template(dir);
        app.setProjectBrands((l) => PB.save(l, dir.id, files));
        app.toast(`已建好 ${dir.path}${PB.FILE} · ${PB.isGlobal(dir) ? '每条会话' : '这个项目的会话'}会自动参考它`, 'positive');
        app.go({r: 'skills', dir: dir.id, tab: 'files'});
      },
    };
  }

  /* 行与详情共用的「更多」：编辑 / 新建会话 / 在文件夹中显示 / 删除 */
  function BrandMoreMenu({dir, label, onRemoved}) {
    const act = useBrandActions();
    const [ask, setAsk] = useState(false);
    const global = PB.isGlobal(dir);
    const run = (k) => {
      if (k === 'edit') act.open(dir.id, 'files');
      else if (k === 'new') act.newSession(dir);
      else if (k === 'reveal') act.reveal(dir);
      else if (k === 'remove') setAsk(true);
    };
    return <>
      <R.MenuTrigger>
        <R.ActionButton isQuiet aria-label={label || `「${dir.name}」BRAND.md 的更多操作`}><R.Icons.More /></R.ActionButton>
        <R.Menu aria-label="更多操作" onAction={(k) => run(String(k))}>
          <R.MenuItem id="edit" textValue="编辑"><R.Icons.Edit /><R.Text slot="label">编辑</R.Text></R.MenuItem>
          <R.MenuItem id="new" textValue={global ? '新建会话' : '在这个项目里新建会话'}><R.Icons.Add /><R.Text slot="label">{global ? '新建会话' : '在这个项目里新建会话'}</R.Text></R.MenuItem>
          <R.MenuItem id="reveal" textValue="在文件夹中显示"><R.Icons.FolderOpen /><R.Text slot="label">在文件夹中显示</R.Text></R.MenuItem>
          <R.MenuItem id="remove" textValue="删除 BRAND.md"><R.Icons.Delete /><R.Text slot="label">删除 BRAND.md</R.Text>
            <R.Text slot="description">{global ? '会话不再自动参考全局品牌' : '这个项目的会话不再自动参考它'}</R.Text></R.MenuItem>
        </R.Menu>
      </R.MenuTrigger>
      <ConfirmDialog ask={ask ? {title: `删除「${dir.name}」的 BRAND.md？`, body: `BRAND.md 和 brand/ 文件夹会移到废纸篓。之后${global ? '会话' : '这个项目的会话'}不再自动参考它，用到的视频不受影响。`, confirmLabel: '删除', tone: 'negative'} : null}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); act.remove(dir); if (onRemoved) onRemoved(); }} />
    </>;
  }

  /* 一行：名字 + 范围徽章；第一行小字说清它管哪里、文件在哪，第二行是一句话介绍 */
  function BrandRow({skill, dir}) {
    const act = useBrandActions();
    return <div className="skp-row">
      <BCAction type="button" className="skp-row__main" aria-label={`查看「${dir.name}」的 BRAND.md`} onClick={() => act.open(dir.id)}>
        <window.SkillIcon skill={skill} />
        <span className="skp-row__text">
          <span className="skp-row__title"><b>{skill.name}</b><window.SkillBadges skill={skill} /></span>
          <span className="skp-row__scope">{PB.scopeLine(dir)}<code>{skill.path}</code></span>
          {skill.description ? <span className="skp-row__sub">{K.blurb(skill)}</span> : null}
        </span>
        <span className="skp-row__date">{P.dateLabel(skill)}</span>
      </BCAction>
      <span className="skp-row__end">
        <span className="skp-auto">自动用</span>
        <BrandMoreMenu dir={dir} />
      </span>
    </div>;
  }

  /* 还没有全局品牌：画成一行空态，按钮直接去建 */
  function GlobalEmptyRow({onCreate}) {
    return <div className="skp-row skp-row--empty">
      <span className="skp-row__main skp-row__main--static">
        <span className="skp-icon" aria-hidden="true"><R.Icons.GlobeGrid /></span>
        <span className="skp-row__text">
          <span className="skp-row__title"><b>全局品牌</b><R.Badge variant="neutral" fillStyle="subtle" size="S">全局</R.Badge></span>
          <span className="skp-row__sub">还没有。所有会话都会用它：栏目名、口号、配色、logo、配音和开场结尾，写一次，每个项目都照着做。</span>
        </span>
      </span>
      <span className="skp-row__end"><Btn size="s" icon="sparkle" onClick={onCreate}>和 Agent 一起建</Btn></span>
    </div>;
  }

  /* Skills 页「品牌」段：夹在「我的」与「BaoCut 内置」之间 */
  function BrandsSection({query}) {
    const app = useApp();
    const [creating, setCreating] = useState(null);   // null | {dir?: id}
    const g = PB.globalDir();
    const gBrand = PB.brandOf(app.projectBrands, PB.GLOBAL);
    const gSkill = gBrand ? PB.asSkill(g, gBrand) : null;
    const projects = PB.list(app.projectBrands, app.dirs || []);
    const q = String(query || '').trim();
    const rows = PB.find([...(gSkill ? [gSkill] : []), ...projects], query);
    if (q && !rows.length) return null;
    return <section className="skp-section" aria-label="品牌">
      <div className="skp-section__bar">
        <h2 className="skp-section__hd">品牌<span>{rows.length}</span></h2>
        <R.ActionButton isQuiet size="S" onPress={() => setCreating({})}><R.Icons.Add /><R.Text>新建品牌</R.Text></R.ActionButton>
      </div>
      <p className="skp-section__hint">品牌设定（BRAND.md）总在生效，{NO_SWITCH}全局的用在所有会话；项目的只用在那个项目里，和全局的说法不一样时以项目的为准。</p>
      <div className="skp-list">
        {!q && !gSkill ? <GlobalEmptyRow onCreate={() => setCreating({dir: PB.GLOBAL})} /> : null}
        {rows.map((s) => <BrandRow key={s.id} skill={s} dir={PB.isGlobal(s.dirId) ? g : app.dirById(s.dirId)} />)}
      </div>
      {!q && !projects.length ? <p className="skp-none">还没有项目有自己的 BRAND.md。在项目菜单里选「品牌（BRAND.md）」，或用上面的「新建品牌」。</p> : null}
      {creating ? <BrandCreateDialog preset={creating.dir} onClose={() => setCreating(null)} /> : null}
    </section>;
  }

  /* 怎么建：三种，和 Agent 一起建排第一 */
  function MethodPicker({how, setHow, skillId, setSkillId}) {
    const app = useApp();
    const brandSkills = (app.agentSkills || []).filter((s) => s.category === '品牌');
    const opts = [
      {k: 'agent', label: '和 Agent 一起建', tag: '推荐', desc: 'Agent 一次问你一个问题：栏目名与口号、语气、配色与字体、logo、开场结尾、配音。问完给你看草稿，确认后写成 BRAND.md，你发来的素材放进 brand/。'},
      {k: 'blank', label: '空白模板', desc: '列好了名字与口号、视觉、声音几段，自己填。'},
      {k: 'skill', label: '从品牌 skill 生成', desc: brandSkills.length ? 'SKILL.md 的正文成为 BRAND.md，素材与参考文件复制到 brand/，脚本不带。之后两边各改各的。' : '还没有品牌 skill。'},
    ];
    return <>
      <BCChoiceGroup className="skp-how" value={how} onChange={setHow} aria-label="怎么建">
        {opts.map((o) => <BCAction key={o.k} type="button" choiceKey={o.k} disabled={o.k === 'skill' && !brandSkills.length}
          className={cx('agm-access__option', how === o.k && 'is-on')}>
          <span><b>{o.label}{o.tag ? <span className="agp-tier">{o.tag}</span> : null}</b><span>{o.desc}</span></span>
        </BCAction>)}
      </BCChoiceGroup>
      {how === 'skill' && brandSkills.length ? <R.Picker label="品牌 skill" selectedKey={skillId || brandSkills[0].id} onSelectionChange={(k) => setSkillId(String(k))} UNSAFE_className="skp-create__pick">
        {brandSkills.map((s) => <R.PickerItem key={s.id} id={s.id} textValue={s.name}><R.Text slot="label">{s.name}</R.Text>
          <R.Text slot="description">{P.stats(s).assetLine || '没有素材'}</R.Text></R.PickerItem>)}
      </R.Picker> : null}
    </>;
  }
  function useMethod() {
    const app = useApp();
    const [how, setHow] = useState('agent');
    const [skillId, setSkillId] = useState(null);
    const brandSkills = (app.agentSkills || []).filter((s) => s.category === '品牌');
    const skill = K.byId(app.agentSkills, skillId || (brandSkills[0] && brandSkills[0].id));
    return {how, setHow, skillId, setSkillId, skill, ready: how !== 'skill' || !!skill};
  }
  const ctaOf = (how) => (how === 'agent' ? '开始对话' : '创建 BRAND.md');

  /* 新建品牌：先选用在哪里（全局或一个还没有 BRAND.md 的项目），再选怎么建 */
  function BrandCreateDialog({preset, onClose}) {
    const app = useApp();
    const act = useBrandActions();
    const m = useMethod();
    const hasGlobal = PB.hasBrand(app.projectBrands, PB.GLOBAL);
    const dirs = (app.dirs || []).filter((d) => !d.archived);
    const first = preset || (!hasGlobal ? PB.GLOBAL : (dirs.find((d) => !PB.hasBrand(app.projectBrands, d.id)) || {}).id);
    const [target, setTarget] = useState(first || null);
    const dir = PB.isGlobal(target) ? PB.globalDir() : dirs.find((d) => d.id === target) || null;
    const taken = [...(hasGlobal ? [PB.GLOBAL] : []), ...dirs.filter((d) => PB.hasBrand(app.projectBrands, d.id)).map((d) => d.id)];
    const go = () => { onClose(); act.create(dir, m.how, m.skill); };
    return <Dialog open title="新建品牌" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" disabled={!dir || !m.ready} onClick={go}>{ctaOf(m.how)}</Btn></>}>
      <div className="skp-create">
        <R.Picker label="用在哪里" selectedKey={target} onSelectionChange={(k) => setTarget(String(k))} disabledKeys={taken} UNSAFE_className="skp-create__pick">
          <R.PickerSection><R.Header>全局</R.Header>
            <R.PickerItem id={PB.GLOBAL} textValue="全局品牌"><R.Icons.GlobeGrid /><R.Text slot="label">全局品牌</R.Text>
              <R.Text slot="description">{hasGlobal ? '已经有了，在列表里点开编辑' : '所有会话都用 · ~/.baocut/BRAND.md'}</R.Text></R.PickerItem>
          </R.PickerSection>
          <R.PickerSection><R.Header>项目</R.Header>
            {dirs.map((d) => <R.PickerItem key={d.id} id={d.id} textValue={d.name}><R.Icons.Folder /><R.Text slot="label">{d.name}</R.Text>
              <R.Text slot="description">{PB.hasBrand(app.projectBrands, d.id) ? '已经有了' : `只在这个项目里用 · ${d.path}${PB.FILE}`}</R.Text></R.PickerItem>)}
          </R.PickerSection>
        </R.Picker>
        {dir ? <p className="skp-block__hint">{PB.isGlobal(dir) ? '全局品牌用在所有会话里；某个项目要不一样，再给那个项目单独建一份，它优先。'
          : `只在「${dir.name}」里用；和全局品牌说法不一样时，以它为准。`}</p> : null}
        <div className="skp-create__label">怎么建</div>
        <MethodPicker {...m} />
      </div>
    </Dialog>;
  }

  /* 优先级：概览与新建页共用 */
  function Precedence() {
    return <section className="skp-block" aria-label="和别的要求冲突时">
      <h3>和别的要求冲突时</h3>
      <ol className="skp-rule">
        <li><b>你在这条消息里说的</b><span>比如「这期不要片头」</span></li>
        <li><b>项目的 BRAND.md</b><span>只在那个项目里用</span></li>
        <li><b>全局的 BRAND.md</b><span>所有会话都用</span></li>
        <li><b>开着的品牌 skill</b><span>Agent 觉得相关时才用；和 BRAND.md 说法不一样时，以 BRAND.md 为准</span></li>
      </ol>
    </section>;
  }

  function BrandOverview({dir, skill, onFile}) {
    const st = P.stats(skill);
    const f = PB.brandFile({files: skill.files});
    const doc = K.fileBlocks(f ? f.body : '');
    const global = PB.isGlobal(dir);
    return <div className="skp-overview">
      <div className="skp-overview__main">
        {skill.description ? <p className="skp-desc">{skill.description}</p> : null}
        <p className="skp-state">{autoLine(dir)}只想某条消息不用：在输入框上点掉「品牌」标签。</p>
        <Precedence />
        <window.SkillAssetGallery skill={skill} onOpen={onFile}
          hint={`放在 ${dir.path}${PB.ASSET_DIR} 里，Agent 可以直接导入进视频。要换素材，替换那里的文件或在「文件」里编辑。`} />
        <section className="skp-block" aria-label="BRAND.md">
          <h3>BRAND.md</h3>
          <div className="skp-brand-doc"><window.SkillBlocks blocks={doc.blocks} /></div>
        </section>
      </div>
      <aside className="skp-overview__side" aria-label="信息">
        <dl className="skp-info">
          <dt>范围</dt><dd>{global ? '全局 · 所有会话' : `项目 · ${dir.name}`}</dd>
          <dt>位置</dt><dd>{skill.path}</dd>
          <dt>更新</dt><dd>{P.dateLabel(skill)}</dd>
          <dt>文件</dt><dd>{`${st.files} 个 · ${P.bytesLabel(st.bytes)}`}</dd>
        </dl>
        <p className="skp-note" role="note"><Ic n="info" className="ic--16" />
          <span>{global ? '它在 BaoCut 的数据目录里，换电脑时和其他设置一起迁移。'
            : '它是项目里的普通文件，跟着项目走：复制、同步或交给别人时一起带上。用 git 管理的项目，改动历史在 git 里。'}</span></p>
        <Btn size="s" icon="folder" onClick={() => onFile(PB.FILE)}>{`查看 ${st.files} 个文件`}</Btn>
      </aside>
    </div>;
  }

  /* 文件：没有版本，保存直接写回；BRAND.md 不能删（要删用「更多 › 删除 BRAND.md」） */
  function BrandFilesTab({dir, brand, path, onPath}) {
    const app = useApp();
    const act = useBrandActions();
    const [draft, setDraft] = useState(null);
    const [ask, setAsk] = useState(false);
    const files = draft || brand.files;
    const tree = K.fileTree({files});
    const file = files.find((f) => f.path === path) || files.find((f) => f.path === PB.FILE) || files[0];
    const dirty = draft && draft !== brand.files;
    const save = () => {
      app.setProjectBrands((l) => PB.save(l, dir.id, draft));
      app.toast(`已保存 · ${PB.isGlobal(dir) ? '接下来的消息' : '这个项目接下来的消息'}按新的品牌规则来`, 'positive');
      setDraft(null);
    };
    const edit = (body) => setDraft((d) => d.map((f) => (f.path === file.path ? {...f, body} : f)));
    const addFiles = (list) => {
      Promise.all(Array.from(list || []).map(async (f) => {
        const p = PB.ASSET_DIR + f.name;
        const kind = P.fileKind(p);
        if (kind === 'doc' || kind === 'svg' || kind === 'data' || kind === 'code') return {path: p, body: await f.text()};
        return {path: p, size: f.size, ...(kind === 'image' ? {src: URL.createObjectURL(f)} : {})};
      })).then((add) => {
        setDraft((d) => [...d.filter((x) => !add.some((a) => a.path === x.path)), ...add]);
        if (add[0]) onPath(add[0].path);
      });
    };
    const removeFile = () => { setDraft((d) => d.filter((f) => f.path !== file.path)); onPath(PB.FILE); };
    return <div className="skp-filestab">
      <div className="skp-filebar">
        <span className="skp-filebar__label">{`${dir.path} · 保存后立刻生效`}</span>
        <span className="grow" />
        {draft ? <>
          <R.FileTrigger allowsMultiple onSelect={addFiles}>
            <R.ActionButton size="S"><R.Icons.Add /><R.Text>添加到 brand/</R.Text></R.ActionButton>
          </R.FileTrigger>
          <R.ActionButton size="S" isDisabled={!file || file.path === PB.FILE} onPress={removeFile}><R.Icons.Delete /><R.Text>删除这个文件</R.Text></R.ActionButton>
        </> : <>
          <R.ActionButton size="S" onPress={() => act.reveal(dir)}><R.Icons.FolderOpen /><R.Text>在文件夹中显示</R.Text></R.ActionButton>
          <Btn size="s" icon="edit" onClick={() => setDraft(brand.files)}>编辑</Btn>
        </>}
      </div>
      <div className="skp-files">
        <nav className="skp-files__tree" aria-label="文件">
          {tree.map((node) => node.kind === 'dir'
            ? <div key={node.path} className="skp-files__dir" style={{'--depth': node.depth}}><Ic n="folder" className="ic--16" /><span>{node.name}</span></div>
            : <BCAction key={node.path} type="button" selected={file && node.path === file.path} style={{'--depth': node.depth}}
                className={cx('skp-files__file', file && node.path === file.path && 'is-on')} onClick={() => onPath(node.path)}>
                <span>{node.name}</span>{P.isAsset(node.path) ? <em>素材</em> : null}</BCAction>)}
        </nav>
        <div className="skp-files__view" aria-label={file ? file.path : '文件内容'}>
          <window.SkillFileView file={file} editing={!!draft} onChange={edit} />
        </div>
      </div>
      {draft ? <div className="skp-savebar">
        <span className="grow" />
        <Btn onClick={() => (dirty ? setAsk(true) : setDraft(null))}>取消</Btn>
        <Btn variant="accent" disabled={!dirty} onClick={save}>保存</Btn>
      </div> : null}
      <ConfirmDialog ask={ask ? {title: '放弃这次的修改？', body: '改动还没保存，BRAND.md 保持原样。', confirmLabel: '放弃修改', tone: 'negative'} : null}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); setDraft(null); }} />
    </div>;
  }

  /* 还没有 BRAND.md（侧栏项目菜单、会话页头菜单来的）：同样先推荐和 Agent 一起建 */
  function BrandCreate({dir, back}) {
    const app = useApp();
    const act = useBrandActions();
    const m = useMethod();
    const global = PB.isGlobal(dir);
    return <window.Page crumb={back} title={global ? '全局品牌' : `${dir.name} · 品牌`}>
      <div className="skp-create" data-screen-label="新建 BRAND.md">
        <p className="skp-lede">{global
          ? `还没有全局品牌。放一份在 ${dir.path}${PB.FILE}，Agent 在每条会话里创作时都会参考它：栏目名、口号、配色、字体、logo、开场白和配音音色。${NO_SWITCH}`
          : `这个项目还没有自己的品牌。放一份在项目根目录（${dir.path}${PB.FILE}），Agent 在这个项目里创作时就会参考它；和全局品牌说法不一样时，以它为准。${NO_SWITCH}`}</p>
        <div className="skp-create__label">怎么建</div>
        <MethodPicker {...m} />
        <Precedence />
        <span className="skp-create__acts">
          <Btn variant="accent" onClick={() => act.create(dir, m.how, m.skill)} disabled={!m.ready}>{ctaOf(m.how)}</Btn>
          <Btn onClick={() => app.go({r: 'skills'})}>取消</Btn>
        </span>
      </div>
    </window.Page>;
  }

  function ProjectBrandPage({dir: dirId, tab, file}) {
    const app = useApp();
    const act = useBrandActions();
    const dir = useBrandDir(dirId);
    const brand = PB.brandOf(app.projectBrands, dirId);
    const [path, setPath] = useState(file || PB.FILE);
    useEffect(() => { if (file) setPath(file); }, [file]);
    const back = <Btn variant="quiet" icon="back" onClick={() => app.go({r: 'skills'})}>Skills</Btn>;
    if (!dir) {
      return <window.Page title="找不到这个项目" crumb={back}>
        <p className="skp-lede">它可能已经从 BaoCut 里移走了。回到 Skills 看看别的。</p>
      </window.Page>;
    }
    if (!brand) return <BrandCreate dir={dir} back={back} />;
    const global = PB.isGlobal(dir);
    const skill = PB.asSkill(dir, brand);
    const st = P.stats(skill);
    const sel = tab === 'files' ? 'files' : 'overview';
    const setTab = (k) => app.replace({r: 'skills', dir: dirId, ...(k === 'files' ? {tab: 'files'} : {})});
    const openFile = (p) => { setPath(p); app.replace({r: 'skills', dir: dirId, tab: 'files', file: p}); };
    return <window.Page wide crumb={back} title={null} actions={null}>
      <header className="skp-head" data-screen-label={global ? '全局品牌' : '项目品牌'}>
        <window.SkillIcon skill={skill} size="l" />
        <div className="skp-head__text">
          <h1 className="t-heading">{skill.name}</h1>
          <span className="skp-head__meta"><window.SkillBadges skill={skill} /><span>{[PB.scopeLine(dir), skill.path, P.dateLabel(skill)].filter(Boolean).join(' · ')}</span></span>
        </div>
        <span className="skp-head__acts">
          <BrandMoreMenu dir={dir} label="更多操作" onRemoved={() => app.go({r: 'skills'})} />
          <Btn variant="accent" icon="plus" onClick={() => act.newSession(dir)}>{global ? '新建会话' : '在这个项目里新建会话'}</Btn>
        </span>
      </header>
      <R.Tabs aria-label={global ? '全局品牌' : '项目品牌'} selectedKey={sel} onSelectionChange={(k) => setTab(String(k))} UNSAFE_className="skp-tabs">
        <R.TabList><R.Tab id="overview">概览</R.Tab><R.Tab id="files">{`文件 ${st.files}`}</R.Tab></R.TabList>
        <R.TabPanel id="overview"><BrandOverview dir={dir} skill={skill} onFile={openFile} /></R.TabPanel>
        <R.TabPanel id="files"><BrandFilesTab dir={dir} brand={brand} path={path} onPath={setPath} /></R.TabPanel>
      </R.Tabs>
    </window.Page>;
  }

  /* 输入框上的标签：这条会话带上了哪几份品牌（项目的在前）；off = 这条消息不用（点 × 关，再点标签恢复） */
  function ComposerBrandToken({dirId, off, onToggle}) {
    const app = useApp();
    const layers = PB.layers(app.projectBrands, dirId);
    if (!layers.length) return null;
    const names = layers.map((id) => (PB.isGlobal(id) ? '全局' : (app.dirById(id) || {name: '项目'}).name));
    const label = '品牌：' + names.join(' + ');
    if (off) {
      return <BCAction type="button" className="cins-token cins-token--off" aria-label="这条消息恢复使用品牌" onClick={() => onToggle(false)}>
        <Ic n="brand" className="ic--16" /><span>品牌：这条消息不用</span><Ic n="plus" className="ic--16" /></BCAction>;
    }
    return <div className="cins-token"><Ic n="brand" className="ic--16" />
      <BCAction type="button" className="cins-token__link" aria-label={`查看${names[0]}的 BRAND.md`} onClick={() => app.go({r: 'skills', dir: layers[0]})}>
        {label}<span className="cins-token__note"> · 自动用</span></BCAction>
      <IconBtn icon="close" size="xs" tip="这条消息不用品牌" onClick={() => onToggle(true)} /></div>;
  }

  Object.assign(window, {BrandsSection, ProjectBrandPage, ComposerBrandToken});
})();
