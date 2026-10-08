/* Skills 管理的详情与添加（settings-agent-skills.jsx 的另一半）。
   详情：分类、名称、来源与作者、更新时间、开关、更多菜单（在文件夹中显示、移除——内置的不能移除，只能关）、描述、
   「试一下」示例提示词（点一条 → 落到 Home，把这句话填进输入框并挂上这个 skill 的 token）、「查看文件」。
   文件视图：左边文件树，右边所选文件的内容（frontmatter 按代码块画），顶部有返回。
   添加：从本地文件夹（演示文件夹，校验根目录有没有 SKILL.md）、从 GitHub 导入（地址解析在 BC_AGENT_SKILLS.parseGithub，
   导入的是第三方、默认关）。都是演示，不碰磁盘、不访问网络。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const D = window.BC_DATA;

  /* 正文块 → 元素：相邻的列表项收进同一个列表 */
  function Blocks({blocks}) {
    const out = [];
    let run = null;
    blocks.forEach((b, i) => {
      if (b.type === 'li' || b.type === 'ol') {
        if (!run || run.type !== b.type) { run = {type: b.type, items: []}; const cur = run; out.push(b.type === 'ol' ? <ol key={i}>{cur.items}</ol> : <ul key={i}>{cur.items}</ul>); }
        run.items.push(<li key={i}>{b.text}</li>);
        return;
      }
      run = null;
      if (b.type === 'code') out.push(<pre key={i} className="skl-code">{b.text}</pre>);
      else { const Tag = b.type; out.push(<Tag key={i}>{b.text}</Tag>); }
    });
    return <div className="skl-md">{out}</div>;
  }

  function FilesView({skill, onBack, onClose}) {
    const tree = K.fileTree(skill);
    const [path, setPath] = useState('SKILL.md');
    const file = skill.files.find((f) => f.path === path) || skill.files[0];
    const doc = file ? K.fileBlocks(file.body) : null;
    return <>
      <header className="skl-detail__bar">
        <IconBtn icon="back" tip="返回 skill 详情" onClick={onBack} />
        <b className="grow">{skill.name} 的文件</b>
        <IconBtn icon="close" tip="关闭" onClick={onClose} />
      </header>
      <div className="skl-files">
        <nav className="skl-files__tree" aria-label="文件">
          {tree.map((node) => node.kind === 'dir'
            ? <div key={node.path} className={'skl-files__dir skl-files__depth' + Math.min(node.depth, 2)}><Ic n="folder" className="ic--16" /><span>{node.name}</span></div>
            : <BCAction key={node.path} type="button" selected={file && node.path === file.path}
                className={cx('skl-files__file', 'skl-files__depth' + Math.min(node.depth, 2), file && node.path === file.path && 'is-on')}
                onClick={() => setPath(node.path)}><span>{node.name}</span></BCAction>)}
        </nav>
        <div className="skl-files__view" aria-label={file ? file.path : '文件内容'}>
          {file ? <>
            <div className="skl-files__path">{file.path}</div>
            {doc.frontmatter ? <pre className="skl-code" aria-label="文件开头的元信息">{'---\n' + doc.frontmatter + '\n---'}</pre> : null}
            <Blocks blocks={doc.blocks} />
          </> : <p className="skl-files__none">这个 skill 里没有文件。</p>}
        </div>
      </div>
    </>;
  }

  function AgentSkillDetail({skill, onToggle, onClose}) {
    const app = useApp();
    const [view, setView] = useState('info');
    const builtin = skill.source === 'builtin';
    const more = (key) => {
      if (key === 'reveal') { app.toast('原型演示：在文件夹中显示「' + skill.name + '」'); return; }
      const r = K.remove(app.agentSkills, skill.id);
      if (r.error) { app.toast(r.error); return; }
      onClose();
      app.setAgentSkills((l) => K.remove(l, skill.id).list);
      app.toast(`已移除「${skill.name}」（演示）`, null, {label: '撤销', run: () => app.setAgentSkills((l) => K.add(l, skill).list)});
    };
    const tryIt = (prompt) => { onClose(); app.newProject({entry: 'agent', prompt, skill: skill.id}); };
    return <BCModal title={skill.name} size="L" onClose={onClose} className="skl-detail">
      {view === 'files' ? <FilesView skill={skill} onBack={() => setView('info')} onClose={onClose} /> : <>
        <header className="skl-detail__bar">
          <R.Badge variant="neutral" size="S">{skill.category}</R.Badge>
          <span className="grow" />
          <Switch on={skill.enabled} ariaLabel={'启用 ' + skill.name} onChange={onToggle} />
          <R.MenuTrigger>
            <R.ActionButton isQuiet aria-label="更多操作"><R.Icons.More /></R.ActionButton>
            <R.Menu aria-label="更多操作" onAction={(key) => more(String(key))} disabledKeys={builtin ? ['remove'] : []}>
              <R.MenuItem id="reveal" textValue="在文件夹中显示"><R.Icons.FolderOpen /><R.Text slot="label">在文件夹中显示</R.Text></R.MenuItem>
              <R.MenuItem id="remove" textValue="移除"><R.Icons.Delete /><R.Text slot="label">移除</R.Text>
                <R.Text slot="description">{builtin ? '内置 skill 不能移除，可以把它关掉' : '从 BaoCut 里移除这个 skill'}</R.Text></R.MenuItem>
            </R.Menu>
          </R.MenuTrigger>
          <IconBtn icon="close" tip="关闭" onClick={onClose} />
        </header>
        <div className="skl-detail__body">
          <h2 className="skl-detail__name">{skill.name}</h2>
          <p className="skl-detail__meta">{[K.sourceLabel(skill.source), '作者 ' + skill.author, K.updatedLabel(skill)].filter(Boolean).join(' · ')}</p>
          <p className="skl-detail__state">{skill.enabled ? '开着：Agent 觉得相关时会自己用它。' : '关着：只在你从输入框「+」里选它时才用。'}</p>
          {skill.source === 'third-party' ? <p className="skl-detail__note" role="note"><Ic n="alert" className="ic--16" /><span>{K.THIRD_PARTY_NOTE}</span></p> : null}
          <p className="skl-detail__desc">{skill.description}</p>
          {skill.examples && skill.examples.length ? <section className="skl-try" aria-label="试一下">
            <h3>试一下</h3>
            {skill.examples.map((x) => <BCAction key={x} type="button" className="skl-try__row" onClick={() => tryIt(x)}>
              <span className="grow">{x}</span><Ic n="chevright" className="ic--16" /></BCAction>)}
          </section> : null}
          <div className="skl-detail__files">
            <Btn size="s" icon="folder" onClick={() => setView('files')}>查看文件</Btn>
            <span>{skill.files.length} 个文件{skill.origin ? ' · ' + skill.origin : ''}</span>
          </div>
        </div>
      </>}
    </BCModal>;
  }

  function AgentSkillAddFolder({onClose, onAdded}) {
    const app = useApp();
    const folders = D.agentSkillFolders;
    const [path, setPath] = useState('');
    const [error, setError] = useState('');
    const add = () => {
      const r = K.fromFolder(folders.find((f) => f.path === path), app.agentSkills);
      if (r.error) { setError(r.error); return; }
      app.setAgentSkills((l) => K.add(l, r.skill).list);
      onClose();
      app.toast(`已添加「${r.skill.name}」· 默认打开（演示）`, 'positive');
      onAdded(r.skill);
    };
    return <Dialog open title="从本地文件夹添加" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" disabled={!path} onClick={add}>添加</Btn></>}>
      <p className="t-body-sm">选一个 skill 文件夹。文件夹的根目录要有一份 SKILL.md；添加后归在「我的」，默认打开。</p>
      <div className="skl-add__list">
        <R.RadioGroup aria-label="Skill 文件夹" value={path} onChange={(v) => { setPath(v); setError(''); }}>
          {folders.map((f) => <R.Radio key={f.path} value={f.path}>{f.path}</R.Radio>)}
        </R.RadioGroup>
      </div>
      {error ? <p className="skl-add__error" role="alert">{error}</p> : null}
      <p className="hint">原型以示例文件夹演示；正式版会打开系统文件夹选择。</p>
    </Dialog>;
  }

  function AgentSkillAddGithub({onClose, onAdded}) {
    const app = useApp();
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const parsed = url.trim() ? K.parseGithub(url) : null;
    const add = () => {
      const r = K.fromGithub(K.parseGithub(url), app.agentSkills);
      if (r.error) { setError(r.error); return; }
      app.setAgentSkills((l) => K.add(l, r.skill).list);
      onClose();
      app.toast(`已导入「${r.skill.name}」· 第三方 skill 默认关闭（演示）`, 'positive');
      onAdded(r.skill);
    };
    return <Dialog open title="从 GitHub 导入" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={add}>导入</Btn></>}>
      <form className="skl-add__form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <R.TextField label="仓库地址" placeholder="owner/repo" value={url} autoFocus onChange={(v) => { setUrl(v); setError(''); }}
          description="也可以粘贴完整地址，例如 https://github.com/owner/repo/tree/main/skills/name"
          isInvalid={!!error} errorMessage={error} UNSAFE_className="skl-add__field" />
      </form>
      {parsed && parsed.ok && !error ? <p className="skl-add__preview">将导入 {parsed.owner}/{parsed.repo}{parsed.branch ? ` · 分支 ${parsed.branch}` : ''}{parsed.path ? ` · 文件夹 ${parsed.path}` : ''}</p> : null}
      <p className="skl-detail__note" role="note"><Ic n="alert" className="ic--16" /><span>{K.THIRD_PARTY_NOTE}导入后默认关闭，只在你从输入框「+」里选它时才用。</span></p>
      <p className="hint">原型演示：不会访问网络，导入的是一份示例内容。</p>
    </Dialog>;
  }

  Object.assign(window, {AgentSkillDetail, AgentSkillAddFolder, AgentSkillAddGithub});
})();
