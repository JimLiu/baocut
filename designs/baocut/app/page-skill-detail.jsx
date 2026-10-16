/* Skills 页的详情（page-skills.jsx 的另一半）：#/skills/<id>，?tab=files&file=<路径> 落在「文件」并选中那个文件。
   页顶：返回 Skills、名字与标记、开关、更多菜单、「试一下」。两个页签：
   - 概览：描述、开关状态的意思、「试一下」示例、素材（Agent 可以把这些用进视频；点一个 → 文件页签选中它）、右侧信息栏
     （来源、作者、版本、更新时间、文件与大小、位置；带脚本的说明 BaoCut 不会运行）。
   - 文件：版本选择、下载、编辑；左边文件树，右边按类别预览——Markdown 可切预览 / 源码，svg 与图片画出来，音频给时长与大小，
     脚本标明不会运行，二进制只给信息。编辑：改文本、添加文件（选文件夹里的文件进来）、删文件，「保存为新版本」。
     内置的不能改，给「复制一份来改」；看旧版本只读，给「恢复为这个版本」（存成一个新版本，不改写历史）。 */
(function () {
  const {useState, useEffect, useMemo} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_SKILL_PKG;

  const svgSrc = (body) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body || '');
  const durLabel = (s) => (s >= 60 ? `${Math.floor(s / 60)} 分 ${Math.round(s % 60)} 秒` : `${String(s).replace(/\.0$/, '')} 秒`);

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
      if (b.type === 'code') out.push(<pre key={i} className="skp-code">{b.text}</pre>);
      else if (b.type === 'table') out.push(<table key={i} className="skp-table"><thead><tr>{b.rows[0].map((c, j) => <th key={j}>{c}</th>)}</tr></thead>
        <tbody>{b.rows.slice(1).map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{c}</td>)}</tr>)}</tbody></table>);
      else { const Tag = b.type; out.push(<Tag key={i}>{b.text}</Tag>); }
    });
    return <div className="skp-md">{out}</div>;
  }

  /* 素材的缩略：svg 与图片画出来，音频、视频、字体用图标 */
  function AssetThumb({file}) {
    const kind = P.fileKind(file.path);
    if (kind === 'svg' && file.body) return <img className="skp-thumb__img" src={svgSrc(file.body)} alt="" />;
    if (kind === 'image' && file.src) return <img className="skp-thumb__img" src={file.src} alt="" />;
    const Icon = kind === 'audio' ? R.Icons.AudioWave : kind === 'video' ? R.Icons.Play : kind === 'font' ? null : R.Icons.Image;
    return Icon ? <Icon /> : <span className="skp-thumb__font">Aa</span>;
  }

  function AssetGallery({skill, onOpen, hint}) {
    const list = P.assets(skill);
    if (!list.length) return null;
    return <section className="skp-block" aria-label="素材">
      <h3>素材 <span>{P.assetLine(list)}</span></h3>
      <p className="skp-block__hint">{hint || 'Agent 用这个 skill 时，可以把这些素材直接用进视频。要换素材，编辑这个 skill 或上传新版本。'}</p>
      <div className="skp-assets">
        {list.map((a) => <BCAction key={a.path} type="button" className="skp-asset" aria-label={'查看 ' + a.path} onClick={() => onOpen(a.path)}>
          <span className={cx('skp-thumb', (a.kind === 'svg' || a.kind === 'image') && 'skp-thumb--pic')}><AssetThumb file={a} /></span>
          <b>{a.name}</b>
          <span>{a.kind === 'audio' && a.dur ? durLabel(a.dur) + ' · ' : ''}{P.bytesLabel(a.bytes)}</span>
        </BCAction>)}
      </div>
    </section>;
  }

  function InfoList({skill, st}) {
    const rows = [
      ['来源', K.sourceLabel(skill.source)],
      ['作者', skill.author],
      skill.source === 'builtin' ? null : ['版本', `第 ${P.versionOf(skill)} 版`],
      ['更新', P.dateLabel(skill)],
      ['文件', `${st.files} 个 · ${P.bytesLabel(st.bytes)}`],
      ['位置', skill.source === 'builtin' ? 'BaoCut 自带' : `~/BaoCut/skills/${skill.id}/`],
      skill.origin ? ['来自', skill.origin] : null,
    ].filter(Boolean);
    return <dl className="skp-info">{rows.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>;
  }

  function Overview({skill, onFile}) {
    const act = window.useSkillActions();
    const st = P.stats(skill);
    return <div className="skp-overview">
      <div className="skp-overview__main">
        <p className="skp-desc">{K.blurb(skill)}</p>
        <p className="skp-state">{skill.enabled ? '开着：Agent 觉得相关时会自己用它。' : '关着：只在你从输入框「+」里选它时才用。'}</p>
        {skill.source === 'third-party' ? <p className="skp-note" role="note"><Ic n="alert" className="ic--16" /><span>{K.THIRD_PARTY_NOTE}</span></p> : null}
        {skill.examples && skill.examples.length ? <section className="skp-block" aria-label="试一下">
          <h3>试一下</h3>
          {skill.examples.map((x) => <BCAction key={x} type="button" className="skp-try" onClick={() => act.tryIt(skill, x)}>
            <span className="grow">{x}</span><Ic n="chevright" className="ic--16" /></BCAction>)}
        </section> : null}
        <AssetGallery skill={skill} onOpen={onFile} />
        <section className="skp-block" aria-label="Agent 怎么判断用不用">
          <h3>Agent 怎么判断用不用</h3>
          <p className="skp-block__hint">写在 SKILL.md 开头的 description。Agent 看到这句话觉得和你的要求相关，就会用这个 skill。</p>
          <pre className="skp-code">{skill.description}</pre>
        </section>
      </div>
      <aside className="skp-overview__side" aria-label="信息">
        <InfoList skill={skill} st={st} />
        {st.scripts.length ? <p className="skp-note" role="note"><Ic n="info" className="ic--16" />
          <span>{`带 ${st.scripts.length} 个脚本。BaoCut 不会运行它们，只读文字、用素材；在终端或其他应用的 Agent 里用这个 skill 时，它们可能会运行。`}</span></p> : null}
        <Btn size="s" icon="folder" onClick={() => onFile('SKILL.md')}>{`查看 ${st.files} 个文件`}</Btn>
      </aside>
    </div>;
  }

  /* 一个文件的内容：按类别画 */
  function FileView({file, editing, onChange}) {
    const app = useApp();
    const [mode, setMode] = useState('preview');
    useEffect(() => setMode('preview'), [file && file.path]);
    if (!file) return <p className="skp-files__none">选一个文件。</p>;
    const kind = P.fileKind(file.path);
    const text = P.isText(file);
    const size = P.bytesLabel(typeof file.size === 'number' ? file.size : new TextEncoder().encode(file.body || '').length);
    if (editing && text) {
      return <R.TextArea aria-label={'编辑 ' + file.path} value={file.body} onChange={onChange} UNSAFE_className="skp-editor" />;
    }
    const canPreview = kind === 'skill' || kind === 'doc' || kind === 'svg';
    const head = <div className="skp-files__path">
      <span className="grow">{file.path} · {size}</span>
      {canPreview && text ? <R.SegmentedControl aria-label="显示方式" selectedKey={mode} onSelectionChange={(k) => setMode(String(k))}>
        <R.SegmentedControlItem id="preview">预览</R.SegmentedControlItem>
        <R.SegmentedControlItem id="source">源码</R.SegmentedControlItem>
      </R.SegmentedControl> : null}
    </div>;
    let body;
    if (canPreview && text && mode === 'preview') {
      if (kind === 'svg') body = <div className="skp-pic"><img src={svgSrc(file.body)} alt={file.path} /></div>;
      else { const doc = K.fileBlocks(file.body); body = <>{doc.frontmatter ? <pre className="skp-code" aria-label="文件开头的元信息">{'---\n' + doc.frontmatter + '\n---'}</pre> : null}<Blocks blocks={doc.blocks} /></>; }
    } else if (kind === 'image') {
      body = file.src ? <div className="skp-pic"><img src={file.src} alt={file.path} /></div> : <Binary icon={R.Icons.Image} label="图片" file={file} size={size} />;
    } else if (kind === 'audio') {
      body = <div className="skp-audio">
        <R.ActionButton aria-label={'播放 ' + file.path} onPress={() => app.toast('原型演示：示例数据里没有真实音频')}><R.Icons.Play /></R.ActionButton>
        <span className="skp-audio__wave" aria-hidden="true" />
        <span>{file.dur ? durLabel(file.dur) + ' · ' : ''}{size}</span>
      </div>;
    } else if (text) {
      body = <>{kind === 'script' ? <p className="skp-note" role="note"><Ic n="info" className="ic--16" /><span>脚本。BaoCut 不会运行它；在终端或其他应用的 Agent 里用这个 skill 时，它可能会运行。</span></p> : null}
        <pre className="skp-code skp-code--src">{file.body}</pre></>;
    } else {
      body = <Binary icon={kind === 'video' ? R.Icons.Play : R.Icons.File} label={P.KIND_LABEL[kind] || '文件'} file={file} size={size} />;
    }
    return <>{head}{body}</>;
  }
  function Binary({icon: Icon, label, file, size}) {
    return <div className="skp-binary"><Icon /><b>{file.path.split('/').pop()}</b><span>{label} · {size} · 这里不预览</span></div>;
  }

  function FilesTab({skill, path, onPath}) {
    const app = useApp();
    const act = window.useSkillActions();
    const builtin = skill.source === 'builtin';
    const editable = skill.source === 'personal';
    const all = P.versions(skill);
    const [ver, setVer] = useState(P.versionOf(skill));
    const [draft, setDraft] = useState(null);   // 编辑中：完整的文件清单
    const [note, setNote] = useState('');
    const [ask, setAsk] = useState(false);
    useEffect(() => { setVer(P.versionOf(skill)); }, [skill.version]);
    const current = ver === P.versionOf(skill);
    const files = draft || P.filesAt(skill, ver);
    const tree = K.fileTree({files});
    const file = files.find((f) => f.path === path) || files.find((f) => f.path === 'SKILL.md') || files[0];
    const dirty = draft && draft !== skill.files;
    const save = () => {
      app.setAgentSkills((l) => P.saveVersion(l, skill.id, draft, note.trim() || '在 BaoCut 里编辑'));
      app.toast(`已保存为第 ${P.versionOf(skill) + 1} 版`, 'positive');
      setDraft(null); setNote('');
    };
    const restore = () => {
      app.setAgentSkills((l) => P.saveVersion(l, skill.id, P.filesAt(skill, ver), `恢复第 ${ver} 版`));
      app.toast(`已把第 ${ver} 版恢复为第 ${P.versionOf(skill) + 1} 版`, 'positive');
    };
    const edit = (body) => setDraft((d) => d.map((f) => (f.path === file.path ? {...f, body} : f)));
    const addFiles = (list) => {
      const picked = Array.from(list || []);
      Promise.all(picked.map(async (f) => {
        const p = (P.isAsset(f.name) ? 'assets/' : 'references/') + f.name;
        const kind = P.fileKind(p);
        if (kind === 'doc' || kind === 'svg' || kind === 'data' || kind === 'script' || kind === 'code') return {path: p, body: await f.text()};
        return {path: p, size: f.size, ...(kind === 'image' ? {src: URL.createObjectURL(f)} : {})};
      })).then((add) => {
        setDraft((d) => [...d.filter((x) => !add.some((a) => a.path === x.path)), ...add]);
        if (add[0]) onPath(add[0].path);
      });
    };
    const removeFile = () => { setDraft((d) => d.filter((f) => f.path !== file.path)); onPath('SKILL.md'); };
    return <div className="skp-filestab">
      <div className="skp-filebar">
        {builtin ? <span className="skp-filebar__label">BaoCut 内置 · 随 BaoCut 更新</span>
          : <R.Picker aria-label="版本" size="S" selectedKey={String(ver)} isDisabled={!!draft} onSelectionChange={(k) => setVer(Number(k))}>
            {all.map((v) => <R.PickerItem key={v.n} id={String(v.n)} textValue={`第 ${v.n} 版`}>
              <R.Text slot="label">{`第 ${v.n} 版${v.current ? ' · 当前' : ''}`}</R.Text>
              <R.Text slot="description">{[v.updated, v.note].filter(Boolean).join(' · ')}</R.Text>
            </R.PickerItem>)}
          </R.Picker>}
        <span className="grow" />
        {draft ? <>
          <R.FileTrigger allowsMultiple onSelect={addFiles}>
            <R.ActionButton size="S"><R.Icons.Add /><R.Text>添加文件</R.Text></R.ActionButton>
          </R.FileTrigger>
          <R.ActionButton size="S" isDisabled={!file || file.path === 'SKILL.md'} onPress={removeFile}><R.Icons.Delete /><R.Text>删除这个文件</R.Text></R.ActionButton>
        </> : <>
          <R.ActionButton size="S" onPress={() => act.download(skill)}><R.Icons.Download /><R.Text>下载</R.Text></R.ActionButton>
          {builtin || skill.source === 'third-party' ? <Btn size="s" onClick={() => act.duplicate(skill)}>复制一份来改</Btn>
            : current ? <Btn size="s" icon="edit" onClick={() => setDraft(skill.files)}>编辑</Btn>
              : <Btn size="s" variant="accent" onClick={restore}>恢复为这个版本</Btn>}
        </>}
      </div>
      {!current && !draft ? <p className="skp-note" role="note"><Ic n="info" className="ic--16" /><span>{`在看第 ${ver} 版，只读。恢复会把它存成第 ${P.versionOf(skill) + 1} 版，现在的版本仍然保留。`}</span></p> : null}
      <div className="skp-files">
        <nav className="skp-files__tree" aria-label="文件">
          {tree.map((node) => node.kind === 'dir'
            ? <div key={node.path} className="skp-files__dir" style={{'--depth': node.depth}}><Ic n="folder" className="ic--16" /><span>{node.name}</span></div>
            : <BCAction key={node.path} type="button" selected={file && node.path === file.path} style={{'--depth': node.depth}}
                className={cx('skp-files__file', file && node.path === file.path && 'is-on')} onClick={() => onPath(node.path)}>
                <span>{node.name}</span>{P.isAsset(node.path) ? <em>素材</em> : P.isScript(node.path) ? <em>脚本</em> : null}</BCAction>)}
        </nav>
        <div className="skp-files__view" aria-label={file ? file.path : '文件内容'}>
          <FileView file={file} editing={!!draft} onChange={edit} />
        </div>
      </div>
      {draft ? <div className="skp-savebar">
        <R.TextField aria-label="这次改了什么" placeholder="这次改了什么（可选）" value={note} onChange={setNote} UNSAFE_className="skp-savebar__note" />
        <Btn onClick={() => (dirty ? setAsk(true) : setDraft(null))}>取消</Btn>
        <Btn variant="accent" disabled={!dirty} onClick={save}>{`保存为第 ${P.versionOf(skill) + 1} 版`}</Btn>
      </div> : null}
      <ConfirmDialog ask={ask ? {title: '放弃这次的修改？', body: '改动还没保存。放弃后回到第 ' + P.versionOf(skill) + ' 版。', confirmLabel: '放弃修改', tone: 'negative'} : null}
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); setDraft(null); setNote(''); }} />
    </div>;
  }

  function SkillDetailPage({id, tab, file}) {
    const app = useApp();
    const act = window.useSkillActions();
    const skill = K.byId(app.agentSkills, id);
    const [path, setPath] = useState(file || 'SKILL.md');
    useEffect(() => { if (file) setPath(file); }, [file]);
    const back = <Btn variant="quiet" icon="back" onClick={() => app.go({r: 'skills'})}>Skills</Btn>;
    if (!skill) {
      return <window.Page title="找不到这个 skill" crumb={back}>
        <p className="skp-lede">它可能已经被移除了。回到 Skills 看看别的。</p>
      </window.Page>;
    }
    const st = P.stats(skill);
    const sel = tab === 'files' ? 'files' : 'overview';
    const setTab = (k) => app.replace({r: 'skills', id, ...(k === 'files' ? {tab: 'files'} : {})});
    const openFile = (p) => { setPath(p); app.replace({r: 'skills', id, tab: 'files', file: p}); };
    const toggle = (on) => {
      app.setAgentSkills((l) => K.toggle(l, skill.id, on));
      app.toast(on ? `已打开「${skill.name}」· Agent 觉得相关时会自己用它` : `已关闭「${skill.name}」· 只在你从输入框「+」里选它时才用`);
    };
    return <window.Page wide crumb={back} title={null} actions={null}>
      <header className="skp-head" data-screen-label="Skill 详情">
        <window.SkillIcon skill={skill} size="l" />
        <div className="skp-head__text">
          <h1 className="t-heading">{K.fullName(skill)}</h1>
          <span className="skp-head__meta"><window.SkillBadges skill={skill} /><span>{[P.byline(skill), skill.source === 'builtin' ? null : `第 ${P.versionOf(skill)} 版`, P.dateLabel(skill)].filter(Boolean).join(' · ')}</span></span>
        </div>
        <span className="skp-head__acts">
          <Switch on={skill.enabled} ariaLabel={'启用 ' + skill.name} onChange={toggle} />
          <window.SkillMoreMenu skill={skill} label="更多操作" onRemoved={() => app.go({r: 'skills'})} />
          <Btn variant="accent" icon="play" onClick={() => act.tryIt(skill)}>试一下</Btn>
        </span>
      </header>
      <R.Tabs aria-label="Skill 详情" selectedKey={sel} onSelectionChange={(k) => setTab(String(k))} UNSAFE_className="skp-tabs">
        <R.TabList><R.Tab id="overview">概览</R.Tab><R.Tab id="files">{`文件 ${st.files}`}</R.Tab></R.TabList>
        <R.TabPanel id="overview"><Overview skill={skill} onFile={openFile} /></R.TabPanel>
        <R.TabPanel id="files"><FilesTab skill={skill} path={path} onPath={setPath} /></R.TabPanel>
      </R.Tabs>
    </window.Page>;
  }

  Object.assign(window, {SkillDetailPage, SkillBlocks: Blocks, SkillAssetGallery: AssetGallery, SkillFileView: FileView});
})();
