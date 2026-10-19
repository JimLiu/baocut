/* 外部 Agent 的 baocut skill「装在哪、什么版本」（2026-10-18 重排）。
   - 全局：两个目录各一行——`~/.agents/skills`（Codex 与其他 Agent）、`~/.claude/skills`（Claude Code）。
   - 目录：每个装过的文件夹一组，同样是这两个宿主目录。外部 Agent 不一定在 BaoCut 项目里工作，所以叫「安装到目录…」：
     最近在用的 BaoCut 项目默认勾上，其他项目可勾，也能添加任意文件夹（正式版走系统的文件夹选择）。
   默认装成指向 App 自带那份的软链接（symlink），不复制文件，永远与 App 同版本；副本才有「可更新」。
   每行：谁会读它 / 路径 / 状态灯（未安装、已安装 · vX、可更新、未生效、被占用）+ 一句灰字原因 / 一颗对症的次要按钮，
   其余动作（换方式、复制路径、在文件夹中显示、移除）收进行尾菜单；会删掉真实文件的（移除副本、副本换成软链接）先在行内确认。
   被占用的位置没有「替换」：不是 BaoCut 放的东西永不覆盖。状态判定与写操作都是 model-skill-install.js 的纯函数；不碰磁盘。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const R = window.RSP;
  const M = window.BC_SKILL_INSTALL;

  function LocationRow({root, folder, mode}) {
    const app = useApp();
    const [menu, setMenu] = useState(false);
    const ver = D.app.skillVersion;
    const path = M.destination(root, folder);
    const entry = app.skillInstalls[path];
    const kind = M.locationState(entry, ver);
    const c = M.stateCopy(kind, entry, ver);
    const write = (fn) => app.setSkillInstalls((m) => fn(m));
    const copy = async () => {
      try { await navigator.clipboard.writeText(path); app.toast('路径已复制', 'positive'); }
      catch (e) { app.toast('复制失败，请选中路径后复制'); }
    };
    const act = () => {
      if (c.action === 'install') { write((m) => M.put(m, path, mode, ver)); app.toast(`已给 ${M.reader(folder)} 装上 v${ver}（${M.modeLabel(mode)}，演示）· 新开一个 ${M.reader(folder)} 会话后生效`, 'positive'); }
      if (c.action === 'update') { write((m) => M.repair(m, path, ver)); app.toast(`已更新到 v${ver}（演示）· 新开一个 ${M.reader(folder)} 会话后生效`, 'positive'); }
      if (c.action === 'repair') { write((m) => M.repair(m, path, ver)); app.toast(`已重新安装：软链接指向这个 App 自带的那份（演示）· 新开一个 ${M.reader(folder)} 会话后生效`, 'positive'); }
    };
    const [ask, setAsk] = useState(null);   // null | 'remove' | 'link'
    const doConvert = (to) => { write((m) => M.put(m, path, to, ver)); app.toast(to === 'copy' ? '已改为复制一份（演示）' : '已改为软链接：副本已移除（演示）', 'positive'); };
    const doRemove = () => { write((m) => M.remove(m, path)); app.toast(`已从 ${M.reader(folder)} 移除（演示）`); };
    const deletes = M.removalDeletesFiles(kind, entry);
    const convert = (to) => { setMenu(false); if (to === 'link' && deletes) setAsk('link'); else doConvert(to); };
    const remove = () => { setMenu(false); if (deletes) setAsk('remove'); else doRemove(); };
    const installed = kind !== 'none' && kind !== 'foreign';
    return <div className={cx('ags-link-row', 'is-' + kind)}>
      <div className="grow"><span className="ags-reader">{M.reader(folder)}</span><code>{path}</code>
        <span className="ags-link-status"><R.StatusLight variant={c.light} size="S">{c.label}</R.StatusLight>
          {c.detail ? <span className="ags-link-detail">{c.detail}</span> : null}</span></div>
      {c.cta ? <Btn size="s" variant="secondary" aria-label={c.cta + ' ' + path} onClick={act}>{c.cta}</Btn> : null}
      <div className="ags-more">
        <IconBtn size="s" icon="more" tip="更多操作" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
        <Popover open={menu} onClose={() => setMenu(false)} align="right" width={224}>
          <Menu>
            {installed && entry.mode === 'link' ? <MenuItem label="改为复制一份" sub="不再依赖 App 的位置，之后要手动更新" onClick={() => convert('copy')} /> : null}
            {installed && entry.mode !== 'link' ? <MenuItem label="改为软链接到 App" sub="指向 App 自带的那份，随 App 更新" onClick={() => convert('link')} /> : null}
            <MenuItem icon="copy" label="复制路径" onClick={() => { setMenu(false); copy(); }} />
            <MenuItem label="在文件夹中显示" disabled={kind === 'none'} onClick={() => { setMenu(false); app.toast('原型演示：在文件夹中显示 ' + path); }} />
            {installed ? <><MenuRule /><MenuItem tone="negative" icon="trash" label="移除" sub={entry.mode === 'link' ? '只删除软链接' : '删除这份副本'}
              onClick={remove} /></> : null}
          </Menu>
        </Popover>
      </div>
      {ask ? <div className="agp-problem is-notice ags-ask" role="alert"><Ic n="alert" className="ic--16" />
        <div className="grow"><p>{ask === 'link' ? '把这份副本换成软链接？副本（包括你在里面改过的内容）会被删除。' : '删除这份副本？你在里面改过的内容会一起删除。'}</p></div>
        <Btn size="s" variant="negative" onClick={() => { const a = ask; setAsk(null); if (a === 'link') doConvert('link'); else doRemove(); }}>{ask === 'link' ? '换成软链接' : '删除副本'}</Btn>
        <Btn size="s" onClick={() => setAsk(null)}>取消</Btn></div> : null}
    </div>;
  }

  /** 一个目录在 BaoCut 里叫什么：BaoCut 的项目给名字，别的文件夹只有路径 */
  const dirOfRoot = (dirs, root) => (dirs || []).find((d) => String(d.path).replace(/\/+$/, '') === root) || null;
  const rootOf = (d) => String(d.path).replace(/\/+$/, '');

  /* 「安装到目录」：外部 Agent 不一定在 BaoCut 项目里工作，所以装到任意文件夹都行。
     列表 = 最近在用的 BaoCut 项目（默认勾上，标「当前项目」）+ 其他 BaoCut 项目（不勾）+ 用户加进来的文件夹（加进来就勾上）。 */
  function DirInstallDialog({open, mode, onClose}) {
    const app = useApp();
    const ver = D.app.skillVersion;
    const dirs = app.dirs || [];
    const cur = M.currentDir(dirs);
    const projects = cur ? [cur, ...dirs.filter((d) => d !== cur)] : dirs;
    const [extra, setExtra] = useState([]);            // 用户加进来的文件夹路径
    const [picked, setPicked] = useState(() => (cur ? [rootOf(cur)] : []));
    const [adding, setAdding] = useState(false);
    const [typed, setTyped] = useState('');
    const [hosts, setHosts] = useState(M.folders);
    const [error, setError] = useState('');
    const reset = () => { setExtra([]); setPicked(cur ? [rootOf(cur)] : []); setAdding(false); setTyped(''); setError(''); };
    const close = () => { reset(); onClose(); };
    const toggle = (list, set, k, on) => { set(on ? [...list, k] : list.filter((x) => x !== k)); setError(''); };
    /* 正式版「添加目录…」直接弹系统的文件夹选择；原型用一行路径输入代替 */
    const addTyped = () => {
      const r = M.parseRoots(typed);
      if (r.error) { setError(r.error); return; }
      const root = r.roots[0];
      if (!projects.some((d) => rootOf(d) === root) && !extra.includes(root)) setExtra([...extra, root]);
      if (!picked.includes(root)) setPicked([...picked, root]);
      setTyped(''); setAdding(false); setError('');
    };
    const install = () => {
      if (!picked.length) { setError('至少勾选一个目录，或者添加一个。'); return; }
      if (!hosts.length) { setError('至少选一个 Agent。'); return; }
      app.setSkillInstalls((m) => M.installDirs(m, picked, hosts, mode, ver));
      app.toast(`已装进 ${picked.length} 个目录（v${ver}，${M.modeLabel(mode)}，演示）`, 'positive');
      close();
    };
    const row = (root, name, tag, removable) => <div key={root} className="ags-pick__row">
      <Checkbox aria-label={name || root} on={picked.includes(root)} onChange={(on) => toggle(picked, setPicked, root, on)}
        label={<span className="ags-pick__i">{name ? <b>{name}</b> : null}{tag ? <span className="agp-tier">{tag}</span> : null}<code>{root}</code></span>} />
      {removable ? <IconBtn size="s" icon="close" tip={'从列表移除 ' + root} onClick={() => { setExtra(extra.filter((x) => x !== root)); setPicked(picked.filter((x) => x !== root)); }} /> : null}
    </div>;
    return <Dialog open={open} title="安装到目录" width={560} onClose={close} footer={<><Btn onClick={close}>取消</Btn>
      <Btn variant="accent" disabled={!picked.length || !hosts.length} onClick={install}>{picked.length ? `安装到 ${picked.length} 个目录` : '安装'}</Btn></>}>
      <p className="t-body-sm">只在这些文件夹里打开的 Agent 会读到，那里的一份优先于全局的。可以是 BaoCut 的项目，也可以是任何代码仓库或工作目录。</p>
      <div className="row gap8"><div className="ags-input-label grow">目录</div>
        {!adding ? <Btn size="s" icon="plus" onClick={() => { setAdding(true); setError(''); }}>添加目录…</Btn> : null}</div>
      {adding ? <div className="row gap8 ags-add-dir">
        <Field id="skill-dir-path" className="grow" autoFocus placeholder="~/Projects/video-workflows" value={typed} aria-label="目录路径"
          aria-invalid={!!error} aria-describedby={error ? 'skill-install-error' : undefined}
          onChange={(e) => { setTyped(e.target.value); setError(''); }} onKeyDown={(e) => { if (e.key === 'Enter') addTyped(); }} />
        <Btn size="s" variant="accent" disabled={!typed.trim()} onClick={addTyped}>添加</Btn>
        <Btn size="s" onClick={() => { setAdding(false); setTyped(''); setError(''); }}>取消</Btn></div> : null}
      <div className="ags-pick">
        {extra.map((r) => row(r, null, null, true))}
        {projects.map((d) => row(rootOf(d), d.name, d === cur ? '当前项目' : null, false))}
      </div>
      <div className="ags-input-label">装给哪些 Agent</div>
      <div className="row gap8 wrap">{M.HOSTS.map((h) => <Checkbox key={h.k} on={hosts.includes(h.folder)} label={h.name} onChange={(on) => toggle(hosts, setHosts, h.folder, on)} />)}</div>
      <p className="hint">{`${M.modeLabel(mode)}，v${ver}。每个目录里放 .agents/skills/baocut、.claude/skills/baocut，都${mode === 'link' ? '是指向 App 那份的软链接，不复制文件' : '是复制的一份'}。`}</p>
      {error ? <p id="skill-install-error" className="ags-error" role="alert">{error}</p> : null}
      <p className="hint">原型用路径输入演示；正式版「添加目录…」直接打开系统的文件夹选择。</p>
    </Dialog>;
  }

  function DirGroup({root, mode}) {
    const app = useApp();
    const ver = D.app.skillVersion;
    const dir = dirOfRoot(app.dirs, root);
    const mine = M.folders.filter((f) => app.skillInstalls[M.destination(root, f)]);
    const others = M.HOSTS.filter((h) => !mine.includes(h.folder));
    return <div className="ags-project">
      <div className="row gap8">
        <Ic n="folder" className="ic--16" />
        <span className="grow ags-project__name"><b>{dir ? dir.name : root}</b>{dir ? <code>{root}</code> : null}</span>
        <R.MenuTrigger>
          <R.ActionButton isQuiet size="S" aria-label={`「${dir ? dir.name : root}」的安装`}><R.Icons.More /></R.ActionButton>
          <R.Menu aria-label="这个目录里的安装" onAction={(k) => {
            const key = String(k);
            if (key === 'remove') { app.setSkillInstalls((m) => M.removeRoot(m, root)); app.toast('已移除这个目录里的安装（演示），其他文件保留'); return; }
            app.setSkillInstalls((m) => M.put(m, M.destination(root, key), mode, ver));
            app.toast(`已给这个目录的 ${M.reader(key)} 装上 v${ver}（演示）`, 'positive');
          }}>
            {others.map((h) => <R.MenuItem key={h.k} id={h.folder} textValue={'也装给 ' + h.name}><R.Icons.Add /><R.Text slot="label">{'也装给 ' + h.name}</R.Text></R.MenuItem>)}
            <R.MenuItem id="remove" textValue="移除这个目录里的安装"><R.Icons.Delete /><R.Text slot="label">移除这个目录里的安装</R.Text>
              <R.Text slot="description">只删 baocut，其他文件保留</R.Text></R.MenuItem>
          </R.Menu>
        </R.MenuTrigger>
      </div>
      {mine.map((f) => <LocationRow key={f} root={root} folder={f} mode={mode} />)}
    </div>;
  }

  /** 全局与目录两块；mode 是之后每次安装用的方式 */
  function SkillInstallSection({mode}) {
    const app = useApp();
    const [adding, setAdding] = useState(false);
    const roots = M.dirRoots(app.skillInstalls);
    return <>
      <div className="ags-location">
        <h3 className="t-title-sm">全局</h3>
        <p>这台电脑上任何地方打开的 Agent 都能用，大多数人只需要装这里。<code>.agents/skills</code> 是 Codex 等 Agent 共用的约定目录，Claude Code 读 <code>.claude/skills</code>。</p>
        {M.folders.map((f) => <LocationRow key={f} root={M.GLOBAL} folder={f} mode={mode} />)}
      </div>
      <div className="ags-location">
        <div className="row gap8"><div className="grow"><h3 className="t-title-sm">指定目录</h3>
          <p>只在这些文件夹里可用——BaoCut 的项目，或任何代码仓库、工作目录。那里的一份优先于全局的。</p></div>
          <Btn size="s" icon="plus" onClick={() => setAdding(true)}>安装到目录…</Btn></div>
        {roots.length ? roots.map((r) => <DirGroup key={r} root={r} mode={mode} />)
          : <p className="ags-empty">还没有装到指定目录。</p>}
      </div>
      <DirInstallDialog open={adding} mode={mode} onClose={() => setAdding(false)} />
    </>;
  }
  Object.assign(window, {SkillInstallSection});
})();
