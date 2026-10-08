/* Shared import task view: foreground progress, background detail and recovery. */
(function () {
  const M = window.BC_IMPORT;
  function ImportDiagnostic({text}) {
    const [copied, setCopied] = React.useState('');
    React.useEffect(()=>setCopied(''),[text]);
    return <div><div className="import-error" role="alert" tabIndex={0}>{text}</div>
      <Btn size="s" variant="quiet" onClick={async()=>setCopied(await copyToClipboard(text) ? '已复制' : '复制失败，请选择文字后复制')}>复制错误信息</Btn>
      {copied ? <span role="status" className="t-detail-xs">{copied}</span> : null}</div>;
  }
  function ImportTask({task: t}) {
    const app = useApp();
    const issue = t.issue && M.issues[t.issue];
    const rec = M.recovery(t);
    const busy = t.status === 'running';
    const at = t.project ? 2 : ['verifying', 'ready'].includes(t.stage) || t.issue === 'invalid' ? 1 : 0;
    // Tools card is either the fix itself (missing / outdated / install), or folded behind「检查下载工具」per attempt (403).
    const isRepair = ['repair', 'installing'].includes(t.stage) || rec.tools === 'primary';
    const attempt = `${t.issue || ''}:${t.attempts || 0}`;
    const [toolsFor, setToolsFor] = React.useState(null);
    const toolsOpen = isRepair || (rec.tools === 'hint' && toolsFor === attempt);
    const blocked = !app.downloader.isolated && app.downloader.blocker;
    const changeSource = (src) => {
      if (['running', 'queued'].includes(t.status)) app.patchTask(t.id, M.cancel(t));
      app.newProject({...window.BC_NEW.presetOf(t.options.intent || 'sub'), src, url: t.url, options: t.options});
    };
    const labels = {retry: issue?.action === '重试转录' ? '重试转录' : t.issue === 'invalid' ? '重新下载' : '重试下载', change: t.issue === 'login' || t.issue === 'unsupported' ? '换个链接' : '换个素材',
      tools: toolsOpen ? '收起工具检查' : '检查下载工具'};
    const act = key => key === 'retry' ? app.retryImport(t.id) : key === 'change' ? changeSource(t.issue === 'login' || t.issue === 'unsupported' ? 'url' : 'file') : setToolsFor(toolsOpen ? null : attempt);
    const stepClass = i => t.status === 'done' || i < at ? 'is-done' : i === at ? (issue && !rec.setup ? 'is-failed' : 'is-current') : '';
    return (
      <div className="import-flow" data-screen-label="URL 导入与恢复">
        <div className="row gap8">
          <Btn variant="quiet" size="s" icon="back" onClick={() => app.go({r: 'tasks'})}>后台任务</Btn>
          <span className="spacer" /><Chip tone="neutral">交互演示 · 不下载真实文件</Chip>
        </div>
        <div className="import-flow__heading">
          <div className="t-heading">{t.canceled ? (t.project ? '转录已停止' : '导入已停止') : t.status === 'done' ? '字幕准备好了' : t.project ? (issue ? '视频已就绪，转录需要处理' : '视频已就绪，正在生成字幕') : '把这条视频变成可编辑的字幕'}</div>
          <p className="t-detail">{t.project ? '视频已保存在视频中。你可以先预览，字幕会逐段出现。' : '先下载视频，确认可以播放后再创建视频。'}</p>
        </div>
        <ol className="import-steps" aria-label="导入步骤">
          {['下载视频', '确认媒体并建视频', '生成字幕'].map((label, i) => (
            <li key={label} className={stepClass(i)}>
              <span>{stepClass(i) === 'is-done' ? <Ic n="check" className="ic--14" /> : stepClass(i) === 'is-failed' ? <Ic n="alert" className="ic--14" /> : i + 1}</span>{label}
            </li>
          ))}
        </ol>
        <Card layer className="import-main">
          <div className="import-media">
            <span className="import-media__icon"><Ic n="film" className="ic--26" /></span>
            <div className="grow" style={{minWidth: 0}}>
              <div className="t-title-sm">{t.title}</div>
              <div className="t-detail">{t.info.site} · {window.BC_TIME.timecode(t.info.duration, {decimals: 0})} · 示例媒体</div>
              <div className="t-detail-xs t-truncate" title={t.url}>{t.url}</div>
            </div>
            <Chip tone={t.project ? 'positive' : 'neutral'}>{t.project ? '视频已保存' : '尚未创建视频'}</Chip>
          </div>
          <div className="import-status" aria-live="polite">
            <div className="row gap8">
              {busy ? (t.stage === 'transcribing'
                ? <window.RSP.AI.PixelLoader icon={window.RSP.AI.microphone} size={16} />
                : <span className="tpill__sp" />) : <Ic n={issue ? 'alert' : t.canceled ? 'info' : 'check'} className="ic--16" />}
              <b className="grow">{t.phase}</b>
              {busy && t.pct != null ? <b className="t-mono">{t.pct}%</b> : null}
            </div>
            {busy ? <Progress value={t.pct || 0} indeterminate={t.pct == null} /> : null}
            <div className="t-detail">
              {t.stage === 'downloading' ? `${Math.round(t.pct * 2.4)} / 240 MB · 2.7 MB/s · 下载速度为演示值`
                : t.stage === 'verifying' ? '正在检查文件完整性、音轨与播放信息…'
                : t.stage === 'transcribing' ? `已处理 ${window.BC_TIME.timecode(t.info.duration * t.pct / 100, {decimals: 0})} / ${window.BC_TIME.timecode(t.info.duration, {decimals: 0})} · ${t.options.model || 'moss-transcribe'}`
                : t.stage === 'installing' ? '下载 → 校验 → 测试可用性，完成后自动继续。'
                : t.canceled ? (t.project ? '下载文件和编辑视频仍在，稍后可以重新转录。' : '没有创建视频。链接保留在此记录中。')
                : t.stage === 'checking' ? '正在确认链接是否可读取，以及所需工具是否就绪…'
                : t.stage === 'done' ? '现在可以校对文稿、调整字幕样式或导出视频。' : '链接和你的设置已保留。'}
            </div>
          </div>
          {issue && blocked && isRepair ? <BlockedTools task={t} changeSource={changeSource} /> : issue ? <div className={cx('import-recovery', rec.setup && 'import-recovery--setup')} data-issue={t.issue}>
            <div className="t-title-sm">{issue.title}</div>
            <p className="t-detail">{issue.body}</p>
            {issue.diag ? <ImportDiagnostic text={issue.diag}/> : null}
            {isRepair ? <DownloaderSettings taskId={t.id} issue={t.issue} /> : null}
            <div className="row gap8">
              {rec.primary ? <Btn variant="accent" onClick={() => act(rec.primary)} disabled={app.downloader.state === 'updating'}>{labels[rec.primary]}</Btn> : null}
              {rec.secondary.map(key => <Btn key={key} variant="secondary" onClick={() => act(key)} disabled={app.downloader.state === 'updating'} aria-expanded={key === 'tools' ? toolsOpen : undefined}>{labels[key]}</Btn>)}
            </div>
            {rec.setup ? <div className="t-detail-xs">视频下载工具 · yt-dlp · 安装前会说明来源与位置</div> : null}
            {!isRepair && toolsOpen ? <DownloaderSettings taskId={t.id} issue={t.issue} /> : null}
          </div> : null}
          <div className="import-actions">
            {t.canceled && t.project ? <Btn variant="accent" onClick={() => app.retryImport(t.id)}>重新转录</Btn> : null}
            {t.project ? <Btn variant="accent" icon="play" onClick={() => app.go({r: 'editor', id: t.project})}>打开视频</Btn> : null}
            {busy || t.stage === 'repair' ? <>
              <Btn variant={t.project || issue ? 'secondary' : 'accent'} onClick={() => app.go({r: 'home'})}>先做别的</Btn>
              <Btn variant="quiet" onClick={() => app.cancelImport(t.id)}>{t.project ? '取消转录' : '取消导入'}</Btn>
            </> : t.canceled && !t.project ? <Btn variant="secondary" onClick={() => changeSource('url')}>重新导入</Btn>
            : issue && !t.project ? <Btn variant="quiet" onClick={() => app.go({r: 'home'})}>先做别的</Btn> : null}
            {/* 还在跑的导入没有「删除」可言——先取消，记录才停下来（第 221 轮）。 */}
            {busy || t.stage === 'repair' || t.status === 'queued' ? null
              : <Btn variant="quiet" onClick={() => app.dismissImport(t.id)}>删除记录</Btn>}
            <span className="spacer" />
            <span className="t-detail-xs">{busy || t.stage === 'repair' ? '离开此页后，任务仍保留在后台任务中' : issue && !t.project ? '链接和设置已保留，没有创建视频' : '任务记录已保留'}</span>
          </div>
        </Card>
        <div className="import-details">
          <p className="t-detail">下载到 {t.options.saveDir || '~/Downloads'}/{t.info.saveName}</p>
          <p className="t-detail">{t.options && t.options.viaName ? `由 ${t.options.viaName} 下载：用那台电脑的网络和下载工具，视频经局域网传回` : `${t.info.direct ? '媒体直链' : `视频下载工具：yt-dlp · ${app.downloader.source} · ${app.downloader.version}`} · ffmpeg 已就绪（演示）`}</p>
        </div>
      </div>
    );
  }
  // 第 158 轮：Homebrew 阻塞态整块接管——一句标题、一句正文、四颗钮，brew 原文折在「查看原因」后面，不再叠整张工具卡。
  function BlockedTools({task: t, changeSource}) {
    const app = useApp();
    const busy = app.downloader.state === 'updating';
    const repair = () => app.confirm({title:'修复开发工具…',body:'确认后会在本机终端运行固定修复步骤，并由终端请求管理员密码。先备份现有 Command Line Tools，再请求 macOS 安装器。安装完成前依赖这些工具的应用可能不可用；取消系统安装不会自动还原，终端保留备份路径和还原指引。这里仅演示，不执行命令。',confirmLabel:'打开终端修复',run:()=>app.toast('演示：完成系统安装后，回到 BaoCut 重新检查环境','notice')});
    return <div className="import-recovery import-recovery--setup" data-issue="blocked">
      <div className="t-title-sm">先更新 macOS 开发者工具，再重新检查</div>
      <p className="t-detail">Homebrew 需要更新版的 Command Line Tools 才能更新 yt-dlp。当前的 yt-dlp 保持可用，其它下载不受影响；也可以改为独立安装，绕开 Homebrew。</p>
      <div className="row gap8" style={{flexWrap:'wrap'}}>
        <Btn variant="accent" disabled={busy} onClick={() => app.toast('演示：真实客户端会打开系统设置 → 通用 → 软件更新', 'notice')}>打开软件更新</Btn>
        <Btn variant="secondary" disabled={busy} onClick={() => app.toast('原型只演示检查反馈；真实客户端会重新探测 Homebrew 条件', 'notice')}>重新检查环境</Btn>
        <Btn variant="secondary" disabled={busy} onClick={() => { app.setDownloader(x => ({...x, isolated: true})); app.updateDownloader(t.id); }}>改为独立安装并继续</Btn>
        <Btn variant="secondary" disabled={busy} onClick={() => changeSource('file')}>换个素材</Btn>
      </div>
      <BCDisclosure className="import-details" title={<> 查看原因 </>}>
        <ImportDiagnostic text={app.downloader.blocker}/>
        <div className="row gap8" style={{flexWrap:'wrap'}}><span className="t-detail-xs">软件更新里没有可装的更新？</span><Btn variant="quiet" size="s" onClick={repair}>修复开发工具…</Btn></div>
      </BCDisclosure>
    </div>;
  }
  function DownloaderSettings({taskId, issue} = {}) {
    const app = useApp();
    const d = app.downloader;
    const [options, setOptions] = React.useState(false);
    const blocked = !d.isolated && d.blocker;
    return <div className="import-tool" data-screen-label="视频下载工具设置">
      <div className="row gap8"><Ic n="download" className="ic--20" /><b className="grow">视频下载工具</b>
        <Chip tone={blocked || d.state === 'error' ? 'negative' : d.state === 'updating' ? 'info' : 'positive'}>{blocked ? '需要处理' : d.state === 'error' ? '更新失败' : d.state === 'updating' ? '正在更新' : d.checked ? '已检查' : '可用'}</Chip></div>
      <p className="t-detail">yt-dlp · {d.version} · {d.source} · 示例状态</p>
      {blocked ? <ImportDiagnostic text={d.blocker}/> : null}
      <div className="row gap8"><Btn size="s" variant="accent" disabled={d.state === 'updating'} onClick={() => blocked ? app.toast('原型只演示检查反馈；真实客户端会重新探测 Homebrew 条件', 'notice') : app.updateDownloader(taskId)}>{d.state === 'updating' ? '正在更新…' : blocked ? '重新检查环境' : issue === 'missing' ? '安装并继续' : issue === 'install' ? '重新安装并继续' : taskId ? '更新工具并重试' : '更新工具'}</Btn>
        <Btn size="s" variant="quiet" disabled={d.state === 'updating'} aria-expanded={options} onClick={()=>setOptions(!options)}>安装选项</Btn></div>
      {options ? <div className="import-tool-options"><window.RSP.RadioGroup label="安装范围" value={String(d.isolated)} isDisabled={d.state === 'updating'} onChange={value => app.setDownloader(x => ({...x, isolated: value === 'true'}))}>
        <window.RSP.Radio value="false">系统共享（推荐）</window.RSP.Radio><window.RSP.Radio value="true">仅为 BaoCut 独立安装</window.RSP.Radio>
      </window.RSP.RadioGroup><Btn size="s" variant="quiet" disabled={d.state==='updating'} onClick={()=>app.setDownloader(x=>({...x,checked:true,available:true}))}>检查更新</Btn></div> : null}
      {d.state === 'updating' ? <Progress indeterminate /> : d.available && d.version !== '已更新（演示）' ? <p className="t-detail">发现可用更新（演示）。共享更新由原包管理器执行；独立更新校验、自测通过后才切换。</p> : d.checked ? <p className="t-detail">工具检查完成 · yt-dlp、ffmpeg 已就绪（演示）</p> : null}
      {options ? <div className="import-details">
        {blocked ? <Btn variant="quiet" size="s" onClick={()=>app.confirm({title:'修复开发工具…',body:'确认后会在本机终端运行固定修复步骤，并由终端请求管理员密码。先备份现有 Command Line Tools，再请求 macOS 安装器。安装完成前依赖这些工具的应用可能不可用；取消系统安装不会自动还原，终端保留备份路径和还原指引。这里仅演示，不执行命令。',confirmLabel:'打开终端修复',run:()=>app.toast('演示：完成系统安装后，回到 BaoCut 重新检查环境','notice')})}>修复开发工具…</Btn> : null}
        <p className="t-detail">共享安装由原包管理器维护，兼容性更新会说明开发版渠道。独立副本从官方 nightly 下载、校验并自测；不会覆盖系统安装。</p>
        <p className="t-detail">请在当前下载结束后更新。这里只演示操作与反馈，不修改你的电脑。</p>
      </div> : null}
    </div>;
  }
  Object.assign(window, {ImportTask, DownloaderSettings, BlockedTools});
})();
