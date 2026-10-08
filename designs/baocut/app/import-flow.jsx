/* One owner for the simulated import and downloader lifecycle, mounted by useStore. */
(function () {
  const {useState, useRef, useEffect} = React;
  const M = window.BC_IMPORT;
  function useImportFlow({tasks, setTasks, setProjects, go, route, toast, confirm}) {
    const [downloader, setDownloader] = useState({state: 'ready', version: '2026.07.04', source: '系统共享', isolated: false, checked: false});
    const jobs = useRef(tasks); jobs.current = tasks;
    const nav = useRef(route); nav.current = route;
    const seq = useRef(0);
    const attached = useRef(new Set());
    const reported = useRef(new Set());
    const toolTimer = useRef(null);
    const patch = (id, fn) => setTasks(ts => ts.map(t => t.id === id ? fn(t) : t));
    useEffect(() => {
      const timer = setInterval(() => setTasks(ts => {
        const next = ts.map(M.tick);
        return next.some((t, i) => t !== ts[i]) ? next : ts;
      }), 900);
      return () => { clearInterval(timer); clearTimeout(toolTimer.current); };
    }, []);
    useEffect(() => {
      for (const t of tasks) {
        if (M.canCreate(t) && !attached.current.has(t.id)) {
          attached.current.add(t.id);
          const id = 'url-project-' + t.id;
          const name = t.info.saveName;
          const project = M.movieRecord({id, title: t.title, name, saveDir: t.options.saveDir, duration: t.info.duration,
            hue: t.info.hue, model: t.options.model});
          setProjects(ps => [project, ...ps]);
          patch(t.id, job => M.attach(job, id));
          // Only hand off when the user is still watching this import. Background completion never steals focus.
          if (nav.current.r === 'task' && nav.current.id === t.id) go({r: 'editor', id});
          toast('视频已下载 · 视频已创建，正在生成字幕', 'positive', {label: '打开视频', run: () => go({r: 'editor', id})});
        }
        if (t.origin === 'url' && t.project && (t.status === 'done' || t.status === 'error') && !reported.current.has(t.id + t.status)) {
          reported.current.add(t.id + t.status);
          setProjects(ps => ps.map(p => p.id === t.project && p.status === 'transcribing'
            ? {...p, status: t.status === 'done' ? 'complete' : 'error', progress: t.pct, error: t.status === 'done' ? null : t.issue ? M.issues[t.issue].title : '已取消转录'} : p));
          toast(t.status === 'done' ? '字幕已就绪 · 打开视频开始校对' : '转录已停止 · 下载文件和编辑视频已保留', t.status === 'done' ? 'positive' : 'notice',
            {label: t.status === 'done' ? '打开视频' : '查看任务', run: () => go(t.status === 'done' ? {r: 'editor', id: t.project} : {r: 'task', id: t.id})});
        }
      }
    }, [tasks]);
    const startImport = (url, options = {}, scenario = 'success') => {
      const existing = jobs.current.find(t => t.origin === 'url' && t.url === url.trim() && ['running', 'queued'].includes(t.status));
      if (existing) { go({r: 'task', id: existing.id}); return existing.id; }
      const id = 'import-' + Date.now().toString(36) + '-' + (++seq.current);
      // 内核只带 brew doctor 原文（第 158 轮）；「怎么办」由界面按语言自己讲。
      if (scenario === 'install') setDownloader(d=>({...d, blocker:'Warning: Your Command Line Tools are too outdated.\nUpdate them from Software Update in System Settings.\n\nIf that doesn\'t show you any updates, run:\n  sudo rm -rf /Library/Developer/CommandLineTools\n  sudo xcode-select --install'}));
      // 选的机器开跑前又掉线 / 关了下载：回落本机，不带一个跑不了的 via
      const via = window.BC_SERVICES.nodeOffering(window.BC_DATA.remote.paired, options.via, 'download');
      options = {...options, via: via ? via.id : null, viaName: via ? via.name : null};
      const job = M.start({id, url: url.trim(), info: {...window.BC_MEDIA.probeUrl(url), duration: window.BC_DATA.DUR}, options, scenario, tool: downloader.state});
      setTasks(ts => [job, ...ts]);
      go({r: 'task', id});
      return id;
    };
    const updateDownloader = (taskId) => {
      if (downloader.state === 'updating') return;
      if (!downloader.isolated && downloader.blocker) { toast('请先处理 Homebrew 环境问题，再重新检查', 'notice'); return; }
      confirm({title: taskId ? '准备下载工具并继续？' : '更新视频下载工具？',
        body: (downloader.isolated ? '从官方 nightly 发布源下载并校验 yt-dlp，安装到 BaoCut 独立目录；ffmpeg、Deno 仍复用系统安装。' : '通过系统原包管理器准备 yt-dlp；Homebrew 使用最新开发版（--HEAD）获取网站兼容修复，并准备缺失的 ffmpeg、Deno。终端与其它应用共享；无法确认已有安装归属时提供手动更新指引。') + (taskId ? '随后自动重试这条链接一次。' : ''),
        confirmLabel: taskId ? '允许并继续' : '更新工具', run: () => {
          setDownloader(d => ({...d, state: 'updating', checked: false}));
          if (taskId) patch(taskId, t => ({...t, stage: 'installing', phase: M.phases.installing, status: 'running', pct: null}));
          toolTimer.current = setTimeout(() => {
            const fail = jobs.current.find(t => t.id === taskId)?.scenario === 'install';
            setDownloader(d => ({...d, state: fail ? 'error' : 'ready', source: fail ? d.source : d.isolated ? 'BaoCut 独立安装' : '系统共享', version: fail ? d.version : '已更新（演示）', checked: !fail}));
            setTasks(ts => ts.map(t => t.origin === 'url' && ['repair', 'installing'].includes(t.stage) && !t.canceled
              ? {...t, status: fail ? 'error' : 'running', stage: fail ? 'error' : 'checking', issue: fail ? 'install' : null,
                phase: fail ? '工具安装失败' : M.phases.checking, repaired: !fail, tool: fail ? 'missing' : 'ready', scenario: fail ? 'missing' : t.scenario} : t));
          }, 2700);
        }});
    };
    const retryImport = id => {
      reported.current.delete(id + 'error');
      patch(id, t => t.canceled ? M.restart(t) : M.retry(t));
      const job = jobs.current.find(t => t.id === id);
      if (job?.project) setProjects(ps => ps.map(p => p.id === job.project ? {...p, status: 'transcribing', error: null} : p));
    };
    const cancelImport = id => {
      const job = jobs.current.find(t => t.id === id);
      confirm({title: job?.project ? '取消转录？' : '取消这次导入？',
        body: job?.project ? '下载文件和编辑视频保留，未完成的转录结果不保存。' : '停止下载并清理临时文件。不会创建视频，链接保留在任务记录里。',
        confirmLabel: job?.project ? '取消转录' : '取消导入', tone: 'negative', run: () => patch(id, M.cancel)});
    };
    // 失败和已取消的导入卡会一直钉在任务页上，此前只有「取消」没有「删除」——
    // 这是它们唯一的清除入口。只忘掉这笔记账：已下载的视频和已创建的项目都不动。
    const dismissImport = id => {
      const job = jobs.current.find(t => t.id === id);
      // 还在跑的导入没有「删除」可言——先取消，记录才停下来。
      if (!job || job.status === 'running' || job.status === 'queued') return;
      setTasks(ts => ts.filter(t => t.id !== id));
      reported.current.delete(id + 'done'); reported.current.delete(id + 'error');
      attached.current.delete(id);
      if (nav.current.r === 'task' && nav.current.id === id) go({r: 'tasks'});
      toast('记录已删除 · 下载文件与编辑视频不受影响', 'positive');
    };
    return {downloader, setDownloader, startImport, updateDownloader, retryImport, cancelImport, dismissImport};
  }
  Object.assign(window, {useImportFlow});
})();
