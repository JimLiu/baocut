/* 项目品牌（2026-10-16）：项目根目录的 BRAND.md，Agent 在这个项目里创作时的品牌参考——等同于一个品牌 skill，
   只是跟着项目目录走、在这个项目的每条会话里自动用，没有开关。模型在 model-project-brand.js。
   - Skills 页「项目品牌」段（ProjectBrandsSection）：有 BRAND.md 的项目各一行；段头「给项目加 BRAND.md」列出还没有的项目。
   - #/skills?dir=<项目 id>（ProjectBrandPage）：有就是详情（概览 / 文件，改了直接存回项目，不分版本）；
     没有就是新建：空白模板，或从一个品牌 skill 生成（SKILL.md 正文成为 BRAND.md，素材进 brand/）。
   - Home 侧栏项目菜单与会话页头菜单的「品牌（BRAND.md）」都到这里。
   - 输入框上的「品牌：BRAND.md」标签（ComposerBrandToken）：会话所在项目有 BRAND.md 时出现；点 × 只是这条消息不用。
   写盘、在文件夹中显示都是演示。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_SKILL_PKG;
  const PB = window.BC_PROJECT_BRAND;
  const AUTO = '这个项目的每条会话都会自动参考它，不用选，也没有开关。';

  function useBrandActions() {
    const app = useApp();
    return {
      open(dirId, tab) { app.go({r: 'skills', dir: dirId, ...(tab ? {tab} : {})}); },
      reveal(d) { app.toast(`原型演示：在文件夹中显示 ${d.path}${PB.FILE}`); },
      newSession(d) { app.go({r: 'agent', dir: d.id}); },
      remove(d) {
        const prev = PB.brandOf(app.projectBrands, d.id);
        app.setProjectBrands((l) => PB.remove(l, d.id));
        app.toast(`已删除「${d.name}」的 BRAND.md（演示）`, null, prev ? {label: '撤销', run: () => app.setProjectBrands((l) => [prev, ...PB.remove(l, d.id)])} : null);
      },
    };
  }

  /* 行与详情共用的「更多」：编辑 / 在这个项目里新建会话 / 在文件夹中显示 / 删除 */
  function BrandMoreMenu({dir, label, onRemoved}) {
    const act = useBrandActions();
    const [ask, setAsk] = useState(false);
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
          <R.MenuItem id="new" textValue="在这个项目里新建会话"><R.Icons.Add /><R.Text slot="label">在这个项目里新建会话</R.Text></R.MenuItem>
          <R.MenuItem id="reveal" textValue="在文件夹中显示"><R.Icons.FolderOpen /><R.Text slot="label">在文件夹中显示</R.Text></R.MenuItem>
          <R.MenuItem id="remove" textValue="删除 BRAND.md"><R.Icons.Delete /><R.Text slot="label">删除 BRAND.md</R.Text>
            <R.Text slot="description">这个项目的会话不再自动参考品牌规则</R.Text></R.MenuItem>
        </R.Menu>
      </R.MenuTrigger>
      <ConfirmDialog ask={ask ? {title: `删除「${dir.name}」的 BRAND.md？`, body: 'BRAND.md 和 brand/ 文件夹会移到废纸篓。之后这个项目的会话不再自动参考品牌规则，用到的视频不受影响。', confirmLabel: '删除', tone: 'negative'} : null}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); act.remove(dir); if (onRemoved) onRemoved(); }} />
    </>;
  }

  function ProjectBrandRow({skill, dir}) {
    const act = useBrandActions();
    return <div className="skp-row">
      <BCAction type="button" className="skp-row__main" aria-label={`查看「${dir.name}」的 BRAND.md`} onClick={() => act.open(dir.id)}>
        <window.SkillIcon skill={skill} />
        <span className="skp-row__text">
          <span className="skp-row__title"><b>{skill.name}</b><window.SkillBadges skill={skill} /></span>
          <span className="skp-row__sub">{skill.path} · {K.blurb(skill)}</span>
        </span>
        <span className="skp-row__date">{P.dateLabel(skill)}</span>
      </BCAction>
      <span className="skp-row__end">
        <span className="skp-auto">自动用</span>
        <BrandMoreMenu dir={dir} />
      </span>
    </div>;
  }

  /* Skills 页「项目品牌」段：夹在「我的」与「BaoCut 内置」之间 */
  function ProjectBrandsSection({query}) {
    const app = useApp();
    const act = useBrandActions();
    const all = PB.list(app.projectBrands, app.dirs || []);
    const rows = PB.find(all, query);
    const q = String(query || '').trim();
    const without = (app.dirs || []).filter((d) => !PB.hasBrand(app.projectBrands, d.id));
    if (q && !rows.length) return null;
    return <section className="skp-section" aria-label="项目品牌">
      <div className="skp-section__bar">
        <h2 className="skp-section__hd">项目品牌<span>{rows.length}</span></h2>
        {without.length ? <R.MenuTrigger>
          <R.ActionButton isQuiet size="S"><R.Icons.Add /><R.Text>给项目加 BRAND.md</R.Text></R.ActionButton>
          <R.Menu aria-label="选一个项目" onAction={(k) => act.open(String(k))}>
            {without.map((d) => <R.MenuItem key={d.id} id={d.id} textValue={d.name}><R.Icons.Folder /><R.Text slot="label">{d.name}</R.Text>
              <R.Text slot="description">{d.path}</R.Text></R.MenuItem>)}
          </R.Menu>
        </R.MenuTrigger> : null}
      </div>
      <p className="skp-section__hint">项目根目录的 BRAND.md 等同于一个品牌 skill，只在那个项目里用：{AUTO}</p>
      {rows.length ? <div className="skp-list">
        {rows.map((s) => <ProjectBrandRow key={s.id} skill={s} dir={app.dirById(s.dirId)} />)}
      </div> : <p className="skp-none">还没有项目有 BRAND.md。在项目菜单里选「品牌（BRAND.md）」，或用上面的「给项目加 BRAND.md」。</p>}
    </section>;
  }

  /* 优先级：概览与新建页共用 */
  function Precedence() {
    return <section className="skp-block" aria-label="和别的要求冲突时">
      <h3>和别的要求冲突时</h3>
      <ol className="skp-rule">
        <li><b>你在这条消息里说的</b><span>比如「这期不要片头」</span></li>
        <li><b>这个项目的 BRAND.md</b><span>{AUTO}</span></li>
        <li><b>开着的品牌 skill</b><span>各项目共用；和 BRAND.md 说法不一样时，以 BRAND.md 为准</span></li>
      </ol>
    </section>;
  }

  function BrandOverview({dir, skill, onFile}) {
    const st = P.stats(skill);
    const f = PB.brandFile({files: skill.files});
    const doc = K.fileBlocks(f ? f.body : '');
    return <div className="skp-overview">
      <div className="skp-overview__main">
        {skill.description ? <p className="skp-desc">{skill.description}</p> : null}
        <p className="skp-state">{AUTO}只想某条消息不用：在输入框上点掉「品牌：BRAND.md」。</p>
        <Precedence />
        <window.SkillAssetGallery skill={skill} onOpen={onFile}
          hint="放在项目的 brand/ 文件夹里，Agent 可以直接导入进视频。要换素材，替换 brand/ 里的文件或在「文件」里编辑。" />
        <section className="skp-block" aria-label="BRAND.md">
          <h3>BRAND.md</h3>
          <div className="skp-brand-doc"><window.SkillBlocks blocks={doc.blocks} /></div>
        </section>
      </div>
      <aside className="skp-overview__side" aria-label="信息">
        <dl className="skp-info">
          <dt>项目</dt><dd>{dir.name}</dd>
          <dt>位置</dt><dd>{skill.path}</dd>
          <dt>更新</dt><dd>{P.dateLabel(skill)}</dd>
          <dt>文件</dt><dd>{`${st.files} 个 · ${P.bytesLabel(st.bytes)}`}</dd>
        </dl>
        <p className="skp-note" role="note"><Ic n="info" className="ic--16" />
          <span>它是项目里的普通文件，跟着项目走：复制、同步或交给别人时一起带上。用 git 管理的项目，改动历史在 git 里。</span></p>
        <Btn size="s" icon="folder" onClick={() => onFile(PB.FILE)}>{`查看 ${st.files} 个文件`}</Btn>
      </aside>
    </div>;
  }

  /* 文件：没有版本，保存直接写回项目目录；BRAND.md 不能删（要删用「更多 › 删除 BRAND.md」） */
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
      app.toast('已保存 · 这个项目接下来的消息按新的品牌规则来', 'positive');
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
        <span className="skp-filebar__label">{`${dir.path} · 存在项目里，保存后立刻生效`}</span>
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
      <ConfirmDialog ask={ask ? {title: '放弃这次的修改？', body: '改动还没保存，项目里的 BRAND.md 保持原样。', confirmLabel: '放弃修改', tone: 'negative'} : null}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); setDraft(null); }} />
    </div>;
  }

  /* 还没有 BRAND.md：空白模板，或从一个品牌 skill 生成 */
  function BrandCreate({dir, back}) {
    const app = useApp();
    const brandSkills = (app.agentSkills || []).filter((s) => s.category === '品牌');
    const [from, setFrom] = useState('blank');
    const [skillId, setSkillId] = useState(brandSkills[0] ? brandSkills[0].id : null);
    const skill = K.byId(app.agentSkills, skillId);
    const create = () => {
      const files = from === 'skill' && skill ? PB.fromSkill(skill) : PB.template(dir);
      app.setProjectBrands((l) => PB.save(l, dir.id, files));
      app.toast(`已在 ${dir.path} 建好 BRAND.md · 这个项目的会话会自动参考它`, 'positive');
      app.replace({r: 'skills', dir: dir.id, tab: 'files'});
    };
    return <window.Page crumb={back} title={`${dir.name} · BRAND.md`}>
      <div className="skp-create" data-screen-label="新建 BRAND.md">
        <p className="skp-lede">{`这个项目还没有 BRAND.md。放一份在项目根目录（${dir.path}${PB.FILE}），Agent 在这个项目里创作时就会参考它：栏目名、口号、配色、字体、logo、开场白和配音音色。${AUTO}`}</p>
        <R.RadioGroup label="从哪里开始" value={from} onChange={setFrom}>
          <R.Radio value="blank">空白模板</R.Radio>
          <R.Radio value="skill" isDisabled={!brandSkills.length}>{brandSkills.length ? '从一个品牌 skill 生成' : '从一个品牌 skill 生成（还没有品牌 skill）'}</R.Radio>
        </R.RadioGroup>
        {from === 'skill' ? <R.Picker label="品牌 skill" selectedKey={skillId} onSelectionChange={(k) => setSkillId(String(k))} UNSAFE_className="skp-create__pick">
          {brandSkills.map((s) => <R.PickerItem key={s.id} id={s.id} textValue={s.name}><R.Text slot="label">{s.name}</R.Text>
            <R.Text slot="description">{P.stats(s).assetLine || '没有素材'}</R.Text></R.PickerItem>)}
        </R.Picker> : null}
        <p className="skp-block__hint">{from === 'skill'
          ? 'SKILL.md 的正文成为 BRAND.md，素材与参考文件复制到 brand/，脚本不带。之后两边各改各的，互不影响。'
          : '模板里列好了名字与口号、视觉、声音几段，填你的就行；logo、片头音乐等素材放进 brand/ 文件夹。'}</p>
        <Precedence />
        <span className="skp-create__acts">
          <Btn variant="accent" onClick={create} disabled={from === 'skill' && !skill}>创建 BRAND.md</Btn>
          <Btn onClick={() => app.go({r: 'skills'})}>取消</Btn>
        </span>
      </div>
    </window.Page>;
  }

  function ProjectBrandPage({dir: dirId, tab, file}) {
    const app = useApp();
    const act = useBrandActions();
    const dir = app.dirById ? app.dirById(dirId) : null;
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
    const skill = PB.asSkill(dir, brand);
    const st = P.stats(skill);
    const sel = tab === 'files' ? 'files' : 'overview';
    const setTab = (k) => app.replace({r: 'skills', dir: dirId, ...(k === 'files' ? {tab: 'files'} : {})});
    const openFile = (p) => { setPath(p); app.replace({r: 'skills', dir: dirId, tab: 'files', file: p}); };
    return <window.Page wide crumb={back} title={null} actions={null}>
      <header className="skp-head" data-screen-label="项目品牌">
        <window.SkillIcon skill={skill} size="l" />
        <div className="skp-head__text">
          <h1 className="t-heading">{skill.name}</h1>
          <span className="skp-head__meta"><window.SkillBadges skill={skill} /><span>{[skill.path, '这个项目里自动用', P.dateLabel(skill)].filter(Boolean).join(' · ')}</span></span>
        </div>
        <span className="skp-head__acts">
          <BrandMoreMenu dir={dir} label="更多操作" onRemoved={() => app.go({r: 'skills'})} />
          <Btn variant="accent" icon="plus" onClick={() => act.newSession(dir)}>在这个项目里新建会话</Btn>
        </span>
      </header>
      <R.Tabs aria-label="项目品牌" selectedKey={sel} onSelectionChange={(k) => setTab(String(k))} UNSAFE_className="skp-tabs">
        <R.TabList><R.Tab id="overview">概览</R.Tab><R.Tab id="files">{`文件 ${st.files}`}</R.Tab></R.TabList>
        <R.TabPanel id="overview"><BrandOverview dir={dir} skill={skill} onFile={openFile} /></R.TabPanel>
        <R.TabPanel id="files"><BrandFilesTab dir={dir} brand={brand} path={path} onPath={setPath} /></R.TabPanel>
      </R.Tabs>
    </window.Page>;
  }

  /* 输入框上的标签：会话所在项目有 BRAND.md 时出现；off = 这条消息不用（点 × 关，再点标签恢复） */
  function ComposerBrandToken({dirId, off, onToggle}) {
    const app = useApp();
    if (!dirId || !PB.hasBrand(app.projectBrands, dirId)) return null;
    if (off) {
      return <BCAction type="button" className="cins-token cins-token--off" aria-label="这条消息恢复使用 BRAND.md" onClick={() => onToggle(false)}>
        <Ic n="brand" className="ic--16" /><span>品牌：这条消息不用 BRAND.md</span><Ic n="plus" className="ic--16" /></BCAction>;
    }
    return <div className="cins-token"><Ic n="brand" className="ic--16" />
      <BCAction type="button" className="cins-token__link" aria-label="查看这个项目的 BRAND.md" onClick={() => app.go({r: 'skills', dir: dirId})}>
        品牌：BRAND.md<span className="cins-token__note"> · 这个项目自动用</span></BCAction>
      <IconBtn icon="close" size="xs" tip="这条消息不用 BRAND.md" onClick={() => onToggle(true)} /></div>;
  }

  Object.assign(window, {ProjectBrandsSection, ProjectBrandPage, ComposerBrandToken});
})();
