/* Skills 页的添加：上传 zip 或文件夹、从 GitHub 导入、新建 skill（page-skills.jsx 的菜单与拖放打开这里）。
   上传分两步：
   ① 选：拖进来、选 zip、选文件夹，或用示例包（原型不解压 zip；文件夹——选的或拖进来的——会真的读进来，文字文件读内容，图片做预览，其余只记大小）。
   ② 看清楚再装：这个包里有几个 skill（插件包常见 skills/<名字>/ 下好几个，勾要装的）、每个的文件数、大小、素材、脚本；
      略过了哪些系统与隐藏文件；和已有的同名时——个人的可以「更新为第 N 版」（旧版本保留，可以恢复）或另存为副本，
      内置和第三方的只能另存为副本。装好后进第一个的详情。认包的规则在 model-skill-package.js。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const K = window.BC_AGENT_SKILLS;
  const P = window.BC_SKILL_PKG;
  const D = window.BC_DATA;

  const ZIP_HINT = (name) => `原型不解压 zip（${name}）。可以选或拖进一个文件夹，或用下面的示例包。`;
  /* 文件清单 [{file, rel}] → 包：文字读内容，图片给预览地址，其余只记大小 */
  async function toPackage(pairs, name) {
    const entries = await Promise.all(pairs.map(async ({file, rel}) => {
      const kind = P.fileKind(rel);
      if (['skill', 'doc', 'svg', 'data', 'script', 'code'].includes(kind) && file.size <= 256 * 1024) return {path: rel, body: await file.text()};
      return {path: rel, size: file.size, ...(kind === 'image' ? {src: URL.createObjectURL(file)} : {})};
    }));
    return {name, entries};
  }
  /* 选来的文件夹：路径去掉最外层文件夹名 */
  function folderToPackage(list) {
    const files = Array.from(list || []);
    const top = ((files[0] && (files[0].webkitRelativePath || files[0].name)) || '').split('/')[0];
    return toPackage(files.map((file) => ({file, rel: file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name})), top || '文件夹');
  }
  /* 拖进来的：entry 要在 drop 事件里同步取出，之后再慢慢读 */
  function dropEntries(dt) {
    return Array.from((dt && dt.items) || []).map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)).filter(Boolean);
  }
  async function readTree(entries) {
    const out = [];
    const walk = async (entry, dir) => {
      if (entry.isFile) { out.push({file: await new Promise((ok, no) => entry.file(ok, no)), rel: dir + entry.name}); return; }
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((ok, no) => reader.readEntries(ok, no));
        if (!batch.length) break;
        for (const e of batch) await walk(e, dir + entry.name + '/');
      }
    };
    for (const e of entries) await walk(e, '');
    return out;
  }
  /** 拖进来的 → {pkg} 或 {hint}。拖一个文件夹：去掉它的名字；拖散的文件：路径原样 */
  async function packageFromDrop(entries) {
    if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) return {hint: ZIP_HINT(entries[0].name)};
    const single = entries.length === 1 && entries[0].isDirectory;
    const pairs = (await readTree(entries)).map(({file, rel}) => ({file, rel: single ? rel.split('/').slice(1).join('/') : rel}));
    if (!pairs.length) return {hint: '没有读到文件。拖一个 skill 文件夹进来，根目录要有 SKILL.md。'};
    return {pkg: await toPackage(pairs, single ? entries[0].name : '拖进来的文件')};
  }
  const pkgBytes = (pkg) => P.stats({files: pkg.entries}).bytes;

  function Candidate({cand, multi, picked, onPick, mode, onMode, list}) {
    const conflict = P.conflictOf(list, cand.skill);
    const st = cand.stats;
    return <div className={cx('skp-cand', cand.error && 'is-bad')}>
      <div className="skp-cand__hd">
        {multi ? <R.Checkbox isSelected={picked} isDisabled={!!cand.error} onChange={onPick} aria-label={'安装 ' + cand.skill.name} /> : null}
        <b className="grow">{cand.skill.name}</b>
        {cand.prefix ? <span className="skp-cand__path">{cand.prefix}</span> : null}
      </div>
      {cand.skill.description ? <p className="skp-cand__desc">{cand.skill.description}</p> : null}
      <p className="skp-cand__meta">{[`${st.files} 个文件`, P.bytesLabel(st.bytes), st.assetLine && '素材 ' + st.assetLine].filter(Boolean).join(' · ')}</p>
      {cand.error ? <p className="skp-cand__err" role="alert">{cand.error}</p> : null}
      {!cand.error && st.scripts.length ? <p className="skp-note" role="note"><Ic n="info" className="ic--16" />
        <span>{`带 ${st.scripts.length} 个脚本（${st.scripts.slice(0, 2).join('、')}${st.scripts.length > 2 ? ' 等' : ''}）。BaoCut 不会运行它们，只读文字、用素材。`}</span></p> : null}
      {!cand.error && conflict && (!multi || picked) ? <div className="skp-cand__conflict">
        <p>{`「我的」里已经有「${conflict.skill.name}」${conflict.skill.source === 'personal' ? `（第 ${P.versionOf(conflict.skill)} 版）` : `（${K.sourceLabel(conflict.skill.source)}）`}。`}</p>
        {conflict.canUpdate ? <R.RadioGroup aria-label="同名时怎么装" value={mode} onChange={onMode}>
          <R.Radio value="update">{`更新为第 ${conflict.nextVersion} 版（旧版本保留，可以恢复）`}</R.Radio>
          <R.Radio value="copy">另存为副本</R.Radio>
        </R.RadioGroup> : <p className="skp-cand__hint">它不能改，这个包会装成一份副本。</p>}
      </div> : null}
    </div>;
  }

  function SkillUploadDialog({onClose, dropped}) {
    const app = useApp();
    const [over, setOver] = useState(false);
    const [pkg, setPkg] = useState(null);
    const [demo, setDemo] = useState('');
    const [hint, setHint] = useState('');
    const [picked, setPicked] = useState({});
    const [modes, setModes] = useState({});
    const parsed = pkg ? P.parsePackage(pkg) : null;
    const take = (p) => {
      const r = P.parsePackage(p);
      const ok = r.ok ? r.candidates.filter((c) => !c.error) : [];
      setPkg(p); setHint('');
      setPicked(Object.fromEntries(ok.map((c, i) => [c.prefix, r.candidates.length === 1 || i === 0])));
      setModes({});
    };
    const pickZip = (files) => { const f = files && files[0]; if (f) setHint(ZIP_HINT(f.name)); };
    const pickFolder = async (files) => { if (files && files.length) take(await folderToPackage(files)); };
    const fromDrop = (entries) => packageFromDrop(entries).then((r) => (r.pkg ? take(r.pkg) : setHint(r.hint)));
    useEffect(() => { if (dropped && dropped.length) fromDrop(dropped); }, []);
    const drag = {
      onDragOver: (e) => { e.preventDefault(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: (e) => { e.preventDefault(); setOver(false); fromDrop(dropEntries(e.dataTransfer)); },
    };
    const cands = parsed && parsed.ok ? parsed.candidates : [];
    const multi = cands.length > 1;
    const chosen = cands.filter((c) => !c.error && (!multi || picked[c.prefix]));
    const install = () => {
      let list = app.agentSkills;
      const ids = [];
      chosen.forEach((c) => {
        const conflict = P.conflictOf(list, c.skill);
        const mode = !conflict ? 'new' : conflict.canUpdate ? (modes[c.prefix] || 'update') : 'copy';
        const r = P.install(list, c, mode, pkg.name);
        list = r.list; ids.push({id: r.id, mode});
      });
      app.setAgentSkills(() => list);
      onClose();
      const first = K.byId(list, ids[0].id);
      app.toast(ids.length > 1 ? `已安装 ${ids.length} 个 skill（演示）`
        : ids[0].mode === 'update' ? `「${first.name}」已更新为第 ${P.versionOf(first)} 版（演示）` : `已安装「${first.name}」· 默认打开（演示）`, 'positive');
      app.go({r: 'skills', id: ids[0].id});
    };

    const pickStage = <>
      <div className={cx('skp-upload', over && 'is-over')} {...drag}>
        <R.Icons.Upload />
        <b>把 skill 的 zip 或文件夹拖到这里</b>
        <span>根目录要有一份 SKILL.md。logo、印章、音乐、字体这些素材放在同一个文件夹里，一起上传。</span>
        <span className="skp-upload__acts">
          <R.FileTrigger acceptedFileTypes={['.zip', 'application/zip']} onSelect={pickZip}>
            <R.Button variant="secondary"><R.Text>选择 zip</R.Text></R.Button>
          </R.FileTrigger>
          <R.FileTrigger acceptDirectory onSelect={pickFolder}>
            <R.Button variant="secondary"><R.Icons.FolderOpen /><R.Text>选择文件夹</R.Text></R.Button>
          </R.FileTrigger>
        </span>
      </div>
      {hint ? <p className="skp-note" role="status"><Ic n="info" className="ic--16" /><span>{hint}</span></p> : null}
      <div className="skp-demo">
        <R.RadioGroup label="示例包（原型演示）" value={demo} onChange={(v) => { setDemo(v); take(D.agentSkillPackages.find((p) => p.name === v)); }}>
          {D.agentSkillPackages.map((p) => <R.Radio key={p.name} value={p.name}>{`${p.name} · ${P.bytesLabel(pkgBytes(p))}`}</R.Radio>)}
        </R.RadioGroup>
      </div>
    </>;

    const previewStage = parsed ? <>
      <div className="skp-pkg">
        <R.Icons.Archive />
        <b className="grow">{pkg.name}</b>
        <span>{P.bytesLabel(pkgBytes(pkg))}</span>
        <R.ActionButton size="S" isQuiet onPress={() => { setPkg(null); setDemo(''); }}>换一个</R.ActionButton>
      </div>
      {!parsed.ok ? <p className="skp-cand__err" role="alert">{parsed.error}</p> : <>
        {multi ? <p className="skp-pkg__lede">{`这个包里有 ${cands.length} 个 skill，勾上要装的。`}</p> : null}
        <div className="skp-cands">
          {cands.map((c) => <Candidate key={c.prefix} cand={c} multi={multi} list={app.agentSkills}
            picked={!!picked[c.prefix]} onPick={(on) => setPicked((m) => ({...m, [c.prefix]: on}))}
            mode={modes[c.prefix] || 'update'} onMode={(v) => setModes((m) => ({...m, [c.prefix]: v}))} />)}
        </div>
      </>}
      {parsed.ignored.length ? <p className="skp-pkg__ignored">{`略过了 ${parsed.ignored.join('、')}（系统与隐藏文件）。`}</p> : null}
    </> : null;

    return <Dialog open title={pkg ? '安装 skill' : '上传 skill'} width={640} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn>
        {pkg ? <Btn variant="accent" disabled={!chosen.length} onClick={install}>{chosen.length > 1 ? `安装 ${chosen.length} 个` : '安装'}</Btn> : null}</>}>
      {pkg ? previewStage : pickStage}
    </Dialog>;
  }

  function SkillGithubDialog({onClose}) {
    const app = useApp();
    const [url, setUrl] = useState('');
    const [error, setError] = useState('');
    const parsed = url.trim() ? K.parseGithub(url) : null;
    const add = () => {
      const r = K.fromGithub(K.parseGithub(url), app.agentSkills);
      if (r.error) { setError(r.error); return; }
      app.setAgentSkills((l) => K.add(l, {...r.skill, fresh: true}).list);
      onClose();
      app.toast(`已导入「${r.skill.name}」· 第三方 skill 默认关闭（演示）`, 'positive');
      app.go({r: 'skills', id: r.skill.id});
    };
    return <Dialog open title="从 GitHub 导入" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={add}>导入</Btn></>}>
      <form className="skp-form" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <R.TextField label="仓库地址" placeholder="owner/repo" value={url} autoFocus onChange={(v) => { setUrl(v); setError(''); }}
          description="也可以粘贴完整地址，例如 https://github.com/owner/repo/tree/main/skills/name"
          isInvalid={!!error} errorMessage={error} UNSAFE_className="skp-form__field" />
      </form>
      {parsed && parsed.ok && !error ? <p className="skp-form__preview">将导入 {parsed.owner}/{parsed.repo}{parsed.branch ? ` · 分支 ${parsed.branch}` : ''}{parsed.path ? ` · 文件夹 ${parsed.path}` : ''}</p> : null}
      <p className="skp-note" role="note"><Ic n="alert" className="ic--16" /><span>{K.THIRD_PARTY_NOTE}导入后默认关闭，只在你从输入框「+」里选它时才用。</span></p>
      <p className="hint">原型演示：不会访问网络，导入的是一份示例内容。</p>
    </Dialog>;
  }

  function SkillBlankDialog({onClose}) {
    const app = useApp();
    const [name, setName] = useState('');
    const [when, setWhen] = useState('');
    const [error, setError] = useState('');
    const create = () => {
      const r = P.blank(app.agentSkills, name, when);
      if (r.error) { setError(r.error); return; }
      app.setAgentSkills(() => r.list);
      onClose();
      app.toast('已新建 · 点「编辑」写下你的做法，把素材放进 assets/', 'positive');
      app.go({r: 'skills', id: r.id, tab: 'files'});
    };
    return <Dialog open title="新建 skill" width={560} onClose={onClose}
      footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={create}>新建</Btn></>}>
      <form className="skp-form" onSubmit={(e) => { e.preventDefault(); create(); }}>
        <R.TextField label="名字" placeholder="例如：我的频道品牌" value={name} autoFocus onChange={(v) => { setName(v); setError(''); }}
          isInvalid={!!error} errorMessage={error} UNSAFE_className="skp-form__field" />
        <R.TextArea label="什么时候用" placeholder="例如：做我频道的视频、或我说「按我的品牌」时使用" value={when} onChange={setWhen}
          description="会写进 SKILL.md 开头的 description。Agent 靠这句话判断要不要用它。" UNSAFE_className="skp-form__field" />
      </form>
    </Dialog>;
  }

  Object.assign(window, {SkillUploadDialog, SkillGithubDialog, SkillBlankDialog, skillDropEntries: dropEntries});
})();
