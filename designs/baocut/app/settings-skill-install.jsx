/* 外部 Agent 的 baocut skill「装在哪、什么版本」（2026-10-18 重排）。
   - 全局：两个目录各一行——`~/.agents/skills`（Codex 与其他 Agent）、`~/.claude/skills`（Claude Code）。
   - 项目：每个装过的项目一组，同样是这两个目录；「安装到项目…」优先列 BaoCut 里的项目，也可以填别的文件夹。
   默认装成指向 App 自带那份的链接，永远与 App 同版本；副本才有「可更新」。
   每行：谁会读它 / 路径 / 版本与状态（未安装、最新、可更新到 vX、链接失效、位置被占用）/ 一颗对症的按钮，
   其余动作（换方式、复制路径、在文件夹中显示、移除）收进行尾菜单；会删掉真实文件的（移除副本、副本换成链接）先在行内确认。
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
      if (c.action === 'repair') { write((m) => M.repair(m, path, ver)); app.toast('链接已重新指向 App 自带的那份（演示）', 'positive'); }
    };
    const [ask, setAsk] = useState(null);   // null | 'remove' | 'link'
    const doConvert = (to) => { write((m) => M.put(m, path, to, ver)); app.toast(to === 'copy' ? '已改为复制一份（演示）' : '已改为链接：副本已移除（演示）', 'positive'); };
    const doRemove = () => { write((m) => M.remove(m, path)); app.toast(`已从 ${M.reader(folder)} 移除（演示）`); };
    const deletes = M.removalDeletesFiles(kind, entry);
    const convert = (to) => { setMenu(false); if (to === 'link' && deletes) setAsk('link'); else doConvert(to); };
    const remove = () => { setMenu(false); if (deletes) setAsk('remove'); else doRemove(); };
    const installed = kind !== 'none' && kind !== 'foreign';
    return <div className={cx('ags-link-row', 'is-' + kind)}>
      <div className="grow"><span className="ags-reader">{M.reader(folder)}</span><code>{path}</code>
        <span className={cx('ags-link-state', c.tone && 'is-' + c.tone)}>{c.text}</span></div>
      {c.cta ? <Btn size="s" variant={kind === 'none' ? 'secondary' : 'accent'} aria-label={c.cta + ' ' + path} onClick={act}>{c.cta}</Btn> : null}
      <div className="ags-more">
        <IconBtn size="s" icon="more" tip="更多操作" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
        <Popover open={menu} onClose={() => setMenu(false)} align="right" width={224}>
          <Menu>
            {installed && entry.mode === 'link' ? <MenuItem label="改为复制一份" sub="不再依赖 App 的位置，之后要手动更新" onClick={() => convert('copy')} /> : null}
            {installed && entry.mode !== 'link' ? <MenuItem label="改为链接到 App" sub="指向 App 自带的那份，随 App 更新" onClick={() => convert('link')} /> : null}
            <MenuItem icon="copy" label="复制路径" onClick={() => { setMenu(false); copy(); }} />
            <MenuItem label="在文件夹中显示" disabled={kind === 'none'} onClick={() => { setMenu(false); app.toast('原型演示：在文件夹中显示 ' + path); }} />
            {installed ? <><MenuRule /><MenuItem tone="negative" icon="trash" label="移除" sub={entry.mode === 'link' ? '只删除链接' : '删除这份副本'}
              onClick={remove} /></> : null}
          </Menu>
        </Popover>
      </div>
      {ask ? <div className="agp-problem is-notice ags-ask" role="alert"><Ic n="alert" className="ic--16" />
        <div className="grow"><p>{ask === 'link' ? '把这份副本换成链接？副本（包括你在里面改过的内容）会被删除。' : '删除这份副本？你在里面改过的内容会一起删除。'}</p></div>
        <Btn size="s" variant="negative" onClick={() => { const a = ask; setAsk(null); if (a === 'link') doConvert('link'); else doRemove(); }}>{ask === 'link' ? '换成链接' : '删除副本'}</Btn>
        <Btn size="s" onClick={() => setAsk(null)}>取消</Btn></div> : null}
    </div>;
  }

  /** 项目根目录在 BaoCut 里叫什么：登记过的项目给名字，别的文件夹只有路径 */
  const dirOfRoot = (dirs, root) => (dirs || []).find((d) => String(d.path).replace(/\/+$/, '') === root) || null;

  function ProjectInstallDialog({open, mode, onClose}) {
    const app = useApp();
    const ver = D.app.skillVersion;
    const dirs = app.dirs || [];
    const [picked, setPicked] = useState([]);
    const [paths, setPaths] = useState('');
    const [hosts, setHosts] = useState(M.folders);
    const [error, setError] = useState('');
    const add = () => {
      const typed = paths.trim() ? M.parseRoots(paths) : {roots: [], error: ''};
      if (typed.error) { setError(typed.error); return; }
      const roots = [...new Set([...picked.map((id) => dirs.find((d) => d.id === id)).filter(Boolean).map((d) => d.path.replace(/\/+$/, '')), ...typed.roots])];
      if (!roots.length) { setError('选一个项目，或填一个文件夹。'); return; }
      if (!hosts.length) { setError('至少选一个 Agent。'); return; }
      app.setSkillInstalls((m) => M.installProjects(m, roots, hosts, mode, ver));
      app.toast(`已装进 ${roots.length} 个项目（v${ver}，${M.modeLabel(mode)}，演示）`, 'positive');
      setPicked([]); setPaths(''); setError(''); onClose();
    };
    const toggle = (list, set, k, on) => { set(on ? [...list, k] : list.filter((x) => x !== k)); setError(''); };
    return <Dialog open={open} title="安装到项目" width={560} onClose={onClose} footer={<><Btn onClick={onClose}>取消</Btn><Btn variant="accent" onClick={add}>安装</Btn></>}>
      <p className="t-body-sm">只在这些项目文件夹里可用。项目里的那份优先于全局的，适合只想让某个仓库里的 Agent 会用 BaoCut，或者把 skill 随仓库提交给同事。</p>
      <div className="ags-input-label">BaoCut 里的项目</div>
      <div className="ags-pick">{dirs.map((d) => <Checkbox key={d.id} aria-label={d.name} on={picked.includes(d.id)} label={<span className="ags-pick__i"><b>{d.name}</b><code>{d.path}</code></span>}
        onChange={(on) => toggle(picked, setPicked, d.id, on)} />)}</div>
      <label className="ags-input-label" htmlFor="skill-project-paths">其他文件夹（每行一个，可不填）</label>
      <Field area id="skill-project-paths" className="ags-path-input" rows={2} placeholder={'~/Projects/video-workflows'} value={paths}
        onChange={(e) => { setPaths(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'skill-install-error' : undefined} />
      <div className="ags-input-label">装给哪些 Agent</div>
      <div className="row gap8 wrap">{M.HOSTS.map((h) => <Checkbox key={h.k} on={hosts.includes(h.folder)} label={h.name} onChange={(on) => toggle(hosts, setHosts, h.folder, on)} />)}</div>
      <p className="hint">{`${M.modeLabel(mode)}，v${ver}。位置：〈项目根目录〉/.agents/skills/baocut、〈项目根目录〉/.claude/skills/baocut`}</p>
      {error ? <p id="skill-install-error" className="ags-error" role="alert">{error}</p> : null}
      <p className="hint">原型以勾选与输入路径演示；正式版「其他文件夹」用系统的文件夹选择。</p>
    </Dialog>;
  }

  function ProjectGroup({root, mode}) {
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
          <R.Menu aria-label="这个项目里的安装" onAction={(k) => {
            const key = String(k);
            if (key === 'remove') { app.setSkillInstalls((m) => M.removeRoot(m, root)); app.toast('已移除这个项目里的安装（演示），项目文件保留'); return; }
            app.setSkillInstalls((m) => M.put(m, M.destination(root, key), mode, ver));
            app.toast(`已给这个项目的 ${M.reader(key)} 装上 v${ver}（演示）`, 'positive');
          }}>
            {others.map((h) => <R.MenuItem key={h.k} id={h.folder} textValue={'也装给 ' + h.name}><R.Icons.Add /><R.Text slot="label">{'也装给 ' + h.name}</R.Text></R.MenuItem>)}
            <R.MenuItem id="remove" textValue="移除这个项目里的安装"><R.Icons.Delete /><R.Text slot="label">移除这个项目里的安装</R.Text>
              <R.Text slot="description">只删 baocut，项目文件保留</R.Text></R.MenuItem>
          </R.Menu>
        </R.MenuTrigger>
      </div>
      {mine.map((f) => <LocationRow key={f} root={root} folder={f} mode={mode} />)}
    </div>;
  }

  /** 全局与项目两块；mode 是之后每次安装用的方式 */
  function SkillInstallSection({mode}) {
    const app = useApp();
    const [adding, setAdding] = useState(false);
    const roots = M.projectRoots(app.skillInstalls);
    return <>
      <div className="ags-location">
        <h3 className="t-title-sm">全局</h3>
        <p>这台电脑上的所有项目都能用，大多数人只需要装这里。<code>.agents/skills</code> 是 Codex 等 Agent 共用的约定目录，Claude Code 读 <code>.claude/skills</code>。</p>
        {M.folders.map((f) => <LocationRow key={f} root={M.GLOBAL} folder={f} mode={mode} />)}
      </div>
      <div className="ags-location">
        <div className="row gap8"><div className="grow"><h3 className="t-title-sm">项目</h3>
          <p>只在指定的项目文件夹里可用，项目里的那份优先于全局的。</p></div>
          <Btn size="s" icon="plus" onClick={() => setAdding(true)}>安装到项目…</Btn></div>
        {roots.length ? roots.map((r) => <ProjectGroup key={r} root={r} mode={mode} />)
          : <p className="ags-empty">还没有按项目安装。</p>}
      </div>
      <ProjectInstallDialog open={adding} mode={mode} onClose={() => setAdding(false)} />
    </>;
  }
  Object.assign(window, {SkillInstallSection});
})();
