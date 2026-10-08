/* Agent Skills 的「怎么装、装在哪」（第 128 轮；2026-09-18 重设计）。
   安装方式两选一：默认软链接（指向 App 内置的那一份，随 App 更新），也可以复制一份过去。
   每个位置一行：谁会读它 / 路径 / 现在的状态（未安装、软链接、副本、副本过期、链接失效、位置被占用）/ 一颗对症的按钮，
   其余动作（换方式、在文件夹中显示、移除）收进行尾菜单；会删掉真实文件的（移除副本、副本换成软链接）先在行内确认。
   被占用的位置没有「替换」：不是 BaoCut 放的东西永不覆盖。状态判定与写操作都是 model-skill-install.js 的纯函数；不碰磁盘。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
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
      if (c.action === 'install') { write((m) => M.put(m, path, mode, ver)); app.toast(`已用${M.modeLabel(mode)}安装到 ${M.reader(folder)}（演示）`, 'positive'); }
      if (c.action === 'update') { write((m) => M.repair(m, path, ver)); app.toast(`副本已更新到 v${ver}（演示）`, 'positive'); }
      if (c.action === 'repair') { write((m) => M.repair(m, path, ver)); app.toast('链接已重新指向当前的 BaoCut（演示）', 'positive'); }
    };
    /* 会删掉真实文件的两件事（移除副本、副本换成软链接）先在行内确认一次：副本里可能有用户改过的内容。 */
    const [ask, setAsk] = useState(null);   // null | 'remove' | 'link'
    const doConvert = (to) => { write((m) => M.put(m, path, to, ver)); app.toast(to === 'copy' ? '已改为副本：软链接已换成一份复制的文件（演示）' : '已改为软链接：副本已移除（演示）', 'positive'); };
    const doRemove = () => { write((m) => M.remove(m, path)); app.toast('已移除（演示）'); };
    const convert = (to) => { setMenu(false); if (to === 'link' && M.removalDeletesFiles(kind)) setAsk('link'); else doConvert(to); };
    const remove = () => { setMenu(false); if (M.removalDeletesFiles(kind)) setAsk('remove'); else doRemove(); };
    const installed = kind !== 'none' && kind !== 'foreign';
    return <div className={cx('ags-link-row', 'is-' + kind)}>
      <div className="grow"><span className="ags-reader">{M.reader(folder)}</span><code>{path}</code>
        <span className={cx('ags-link-state', c.tone && 'is-' + c.tone)}>{c.text}</span></div>
      {c.cta ? <Btn size="s" variant={kind === 'none' ? 'secondary' : 'accent'} aria-label={c.cta + ' ' + path} onClick={act}>{c.cta}</Btn> : null}
      <div className="ags-more">
        <IconBtn size="s" icon="more" tip="更多操作" aria-expanded={menu} onClick={() => setMenu((v) => !v)} />
        <Popover open={menu} onClose={() => setMenu(false)} align="right" width={224}>
          <Menu>
            {installed && entry.mode === 'link' ? <MenuItem label="改为复制一份" sub="不再依赖 App 的位置" onClick={() => convert('copy')} /> : null}
            {installed && entry.mode === 'copy' ? <MenuItem label="改为软链接" sub="随 App 自动更新" onClick={() => convert('link')} /> : null}
            <MenuItem icon="copy" label="复制路径" onClick={() => { setMenu(false); copy(); }} />
            <MenuItem label="在文件夹中显示" disabled={kind === 'none'} onClick={() => { setMenu(false); app.toast('原型演示：在文件夹中显示 ' + path); }} />
            {installed ? <><MenuRule /><MenuItem tone="negative" icon="trash" label="移除" sub={entry.mode === 'copy' ? '删除这份副本' : '只删除链接，App 内置 skill 保留'}
              onClick={remove} /></> : null}
          </Menu>
        </Popover>
      </div>
      {ask ? <div className="agp-problem is-notice ags-ask" role="alert"><Ic n="alert" className="ic--16" />
        <div className="grow"><p>{ask === 'link' ? '把这份副本换成软链接？副本（包括你在里面改过的内容）会被删除。' : '删除这份副本？你在里面改过的内容会一起删除。App 内置的 skill 保留。'}</p></div>
        <Btn size="s" variant="negative" onClick={() => { const a = ask; setAsk(null); if (a === 'link') doConvert('link'); else doRemove(); }}>{ask === 'link' ? '换成软链接' : '删除副本'}</Btn>
        <Btn size="s" onClick={() => setAsk(null)}>取消</Btn></div> : null}
    </div>;
  }

  function SkillInstallSection({mode, setMode}) {
    const app = useApp();
    const [adding, setAdding] = useState(false);
    const [paths, setPaths] = useState('');
    const [targets, setTargets] = useState(M.folders);
    const [error, setError] = useState('');
    const ver = D.app.skillVersion;
    const count = M.installedPaths(app.skillInstalls, ver).length;
    const add = () => {
      const parsed = M.parseRoots(paths);
      if (parsed.error || !targets.length) { setError(parsed.error || '至少选择一个 Skill 目录。'); return; }
      const dup = parsed.roots.filter((r) => app.skillRoots.includes(r));
      if (dup.length === parsed.roots.length) { setError('这些项目已经在列表里了。'); return; }
      app.setSkillRoots((roots) => [...new Set([...roots, ...parsed.roots])]);
      app.setSkillInstalls((m) => parsed.roots.reduce((acc, r) => targets.reduce((a2, t) => M.put(a2, M.destination(r, t), mode, ver), acc), m));
      setAdding(false); setPaths(''); setError('');
      app.toast(`已为 ${parsed.roots.length} 个项目安装（${M.modeLabel(mode)}，演示）`, 'positive');
    };
    return <>
      <div className="agset-heading"><div><h2 className="t-title-sm">安装方式</h2><p>对之后的每一次安装生效；已经装好的位置可以在各自的菜单里单独切换。</p></div></div>
      <BCChoiceGroup className="ags-modes" value={mode} onChange={setMode} aria-label="安装方式">
        {M.MODES.map((m) => <BCAction key={m.k} type="button" choiceKey={m.k}
          className={cx('agm-access__option', mode === m.k && 'is-on')} >
                    <span><b>{m.label}{m.tag ? <span className="agp-tier">{m.tag}</span> : null}</b><span>{m.desc}</span></span>
        </BCAction>)}
      </BCChoiceGroup>

      <div className="agset-heading"><div><h2 className="t-title-sm">安装位置</h2><p>每个 Agent 只读自己的 skills 目录，所以按你用的 Agent 分别安装。</p></div><Chip tone={count ? 'positive' : undefined}>{count ? `${count} 处已安装` : '尚未安装'}</Chip></div>
      <Card layer className="agset-advanced">
        <div className="ags-location ags-location--first"><h3 className="t-title-sm">全局</h3><p>在这台电脑的所有项目里都可用。大多数人只需要装这里。</p>{M.folders.map((f) => <LocationRow key={f} root="~" folder={f} mode={mode} />)}</div>
        <div className="ags-location"><div className="row gap8"><div className="grow"><h3 className="t-title-sm">单个项目</h3><p>只在指定的项目文件夹里可用，适合只想让某个仓库里的 Agent 会用 BaoCut。</p></div><Btn size="s" onClick={() => { setError(''); setAdding(true); }}>添加项目…</Btn></div>
          {app.skillRoots.length ? app.skillRoots.map((root) => <div className="ags-project" key={root}><div className="row gap8"><b className="grow">{root}</b><IconBtn size="s" icon="close" tip={'移除这个项目里的安装 ' + root} onClick={() => {
            app.setSkillRoots((roots) => roots.filter((r) => r !== root));
            app.setSkillInstalls((m) => M.remove(m, M.folders.map((f) => M.destination(root, f))));
            app.toast('已移除这个项目里的安装（演示），项目文件保留');
          }} /></div>{M.folders.map((f) => <LocationRow key={f} root={root} folder={f} mode={mode} />)}</div>) : <p className="ags-empty">还没有按项目安装。全局与单个项目可以同时使用，项目里的那份优先。</p>}
        </div>
        <p className="ags-unlink-note">移除只影响安装位置里的链接或副本，App 内置的 skill 和你的项目文件都会保留。</p>
      </Card>
      <Dialog open={adding} title="添加项目文件夹" width={560} onClose={() => setAdding(false)} footer={<><Btn onClick={() => setAdding(false)}>取消</Btn><Btn variant="accent" onClick={add}>安装到这些项目</Btn></>}>
        <p className="t-body-sm">输入项目根目录，每行一个，可同时安装到多个项目。</p>
        <label className="ags-input-label" htmlFor="skill-project-paths">项目文件夹</label>
        <Field area id="skill-project-paths" className="ags-path-input" autoFocus rows={4} placeholder={'~/Projects/video-workflows\n~/Projects/content-studio'} value={paths} onChange={(e) => { setPaths(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby={error ? 'skill-install-error' : undefined} />
        <div className="ags-input-label">在每个项目中安装到</div>
        <div className="row gap8">{M.folders.map((f) => <Checkbox key={f} on={targets.includes(f)} label={`${M.reader(f)} · ${f}`} onChange={next => { setTargets(ts => next ? [...ts, f] : ts.filter(x => x !== f)); setError(''); }} />)}</div>
        <p className="hint">安装方式：{M.modeLabel(mode)}。位置：〈项目根目录〉/〈所选目录〉/baocut</p>
        {error ? <p id="skill-install-error" className="ags-error" role="alert">{error}</p> : null}
        <p className="hint">原型以输入路径演示；正式版也支持系统文件夹选择。</p>
      </Dialog>
    </>;
  }
  Object.assign(window, {SkillInstallSection});
})();
