/* 审片页的导出（表面 `review` 的 `exportQuick`，product-design §5.12「导出成片」，2026-11-25）。
   ============================================================================
   审片页开在 Agent 宿主的浏览器里（Claude 桌面应用的浏览器窗格这类）。用户看完觉得可以了，
   想要成片，不必再回到对话里让 Agent 导：视频栏右边的「导出」就在这一页导。

   裁决：
   1. **只导成片**。不开五页的导出面板：音频、字幕文件、文稿、工程与便携包仍交给 Agent 或 BaoCut。
      格式固定 MP4；画面里有什么、声音怎么混全照时间线（与 `baocut export` 不带覆盖时一样），
      这里能挑的只有尺寸（同导出面板的那张表，缺省画布那档）与字幕烧不烧（画面上有字幕时才有这一行）。
   2. **就是 `baocut export` 那一条导出**。按钮提交的是 Runtime 的导出任务（`exports.create`，提交者是 Web 服务的审片会话），
      不经 Agent、不花它的回合；冻结、预检、先写临时文件再发布这些合同照旧（§8.3）。
      面板底下「复制命令」给出等效的 CLI，用户可以贴进终端自己跑，或贴给 Agent。
   3. **存到项目的 exports/**。浏览器拿不到保存窗口与本机路径，位置不可选，同名加序号、不覆盖（§8.3 浏览器口径）。
      完成后给「复制路径」与「下载」（经 Web 服务把这个文件交给浏览器）；审片页没有「在文件夹中显示」。
   4. **进度在视频栏**。审片页没有任务胶囊与任务页：导出按钮变「导出中 · N%」，点开就是这里的运行态；
      关掉这一页导出照跑，再打开同一条链接接着看。审片会话只看得到、取消得了它自己起的导出。

   推进复用 export.jsx 的 `useExportRunner`（同一条任务记录）；算的东西在 model-export.js。 */
(function () {
  const {useState, useMemo} = React;
  const D = window.BC_DATA;
  const X = window.BC_EXPORT;

  /** 视频所属项目的目录（演示数据里 `dir` 指回 `agentProjects`）；找不到时退回默认项目根下的视频目录名。 */
  function projectPath(proj) {
    const dir = (D.agentProjects || []).find((d) => d.id === proj.dir);
    return dir ? dir.path : '~/BaoCut/' + String(proj.folder || proj.title || 'video') + '/';
  }
  const baseName = (proj) => String((proj.src && proj.src.name) || proj.title || 'export').replace(/\.[a-z0-9]+$/i, '');

  function ExportQuickPopover({ctx, onClose}) {
    const app = useApp();
    const proj = ctx.proj;
    const ratio = ctx.ratio === 'Original' ? '16:9' : ctx.ratio;
    const [resPick, setResPick] = useState(null);
    const [resOpen, setResOpen] = useState(false);
    const [burn, setBurn] = useState(true);
    const [copied, setCopied] = useState(null);       // 'cmd' | 'path'：按钮上短暂换成「已复制」

    /* 正在跑的这部视频的导出：重开弹层直接接管它（审片会话只看得到自己起的那条） */
    const running = app.taskFor(proj.id, 'export');
    const [watch, setWatch] = useState(running ? running.id : null);
    const watched = watch ? app.tasks.find((t) => t.id === watch) : null;

    const lanes = useMemo(() => window.ExportLanes(ctx), [ctx.elements, ctx.elDocs, ctx.subStyle, ctx.muted, ctx.musicMuted, ctx.dubs, ctx.dubOff, ctx.bedOff, ctx.score, ctx.scoreOff, ctx.trackOrder]);
    const subsLanes = lanes.filter((l) => l.kind === 'subs' && l.on);
    /* 「字幕不烧」是这一次的覆盖：所有开着的字幕轨这次都不画，时间线不动 */
    const ov = burn ? {} : Object.fromEntries(subsLanes.map((l) => [l.key || l.id, false]));
    const eff = X.apply(lanes, ov);

    const videoRes = (ctx.elements || [])
      .filter((e) => e.kind === 'video' && e.res && !(ctx.elDocs && ctx.elDocs[e.id] && ctx.elDocs[e.id].hidden))
      .map((e) => e.res);
    const srcShort = ctx.audioProject ? null : X.exportShort(proj.src && proj.src.res, videoRes, ratio);
    const resList = X.resChoices(srcShort);
    const res = X.resolveShort(resPick, srcShort);
    const span = {whole: true, dur: ctx.duration};
    const est = X.estimate(res, ratio, span.dur, 'standard');
    const parts = X.summary(eff, {span, dims: est.dims});
    const file = X.videoName(baseName(proj), eff, span);
    const dir = X.exportsDir(projectPath(proj));
    const cmd = X.cliCommand(proj.videoId || proj.id, {dims: est.dims, burn: subsLanes.length ? burn : undefined});

    const copy = (what, text) => copyToClipboard(text).then((ok) => {
      if (!ok) { app.toast('复制失败 · 浏览器拒绝了剪贴板权限，请选中文字复制', 'negative'); return; }
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    });

    const start = () => {
      const id = app.addTask({
        kind: 'export', exportTab: 'video', project: proj.id, title: '导出 · ' + proj.title,
        sub: X.taskSub(eff, {span, dims: est.dims}), phase: '读取视频', cancellable: true, source: 'review',
        preparePhase: 'prepare-project', prepareElapsedMs: 0, fontsWait: [], fontPins: [], fontFallbacks: [],
        etaMs: est.ms, frames: est.frames, file, size: est.size, path: dir + file,
      });
      setWatch(id);
    };

    const view = !watched ? 'setup'
      : watched.status === 'running' || watched.status === 'queued' ? 'run'
      : watched.outcome === 'canceled' ? 'canceled' : 'done';

    return (
      <Popover open padding="none" label="导出成片" onClose={onClose} align="right" width={440}>
      <div className="xpop bc-export-popover xq">
        {view === 'run' ? (
          <>
            <div className="xhead">
              <b>{X.preparationView(watched).active ? '正在准备导出' : '正在导出'}</b>
              <span className="t-detail t-truncate push">{watched.file}</span>
            </div>
            {X.preparationView(watched).active ? <Progress indeterminate thin />
              : <div className="xbar"><i style={{width: (watched.pctFine || watched.pct || 0) + '%'}} /></div>}
            <div className="xrun">
              {X.preparationView(watched).active
                ? <span>{X.preparationView(watched).label} · 已用 {X.preparationView(watched).seconds} 秒</span>
                : <>
                    <b className="t-mono">{watched.pct}%</b>
                    {watched.leftMs ? <span className="t-mono">剩余 {X.fmtLeft(watched.leftMs)}</span> : null}
                    {watched.fps ? <span className="t-mono">{watched.fps} fps</span> : null}
                  </>}
            </div>
            <div className="xnote">{watched.sub}</div>
            <div className="xacts xacts--between">
              <span className="t-detail">在这台电脑上导出 · 关掉这一页也会继续</span>
              <Btn variant="negative" onClick={() => app.cancelTask(watched)}>取消导出</Btn>
            </div>
          </>
        ) : view === 'done' ? (
          <>
            <div className="xdone">
              <div className="ok"><Ic n="check" className="ic--22" /></div>
              <b>已导出</b>
              <span>{watched.file} · {watched.size}</span>
            </div>
            <div className="xq__path">
              <span className="xq__path-text t-mono" title={watched.path}>{watched.path}</span>
            </div>
            <div className="xacts">
              <Btn variant="secondary" icon={copied === 'path' ? 'check' : 'copy'} onClick={() => copy('path', watched.path)}>
                {copied === 'path' ? '已复制' : '复制路径'}
              </Btn>
              <Btn variant="secondary" icon="download" onClick={() => app.toast('已开始下载 · ' + watched.file, 'positive')}>下载</Btn>
              <Btn variant="accent" onClick={onClose}>完成</Btn>
            </div>
          </>
        ) : view === 'canceled' ? (
          <>
            <div className="xdone xdone--off">
              <div className="ok"><Ic n="close" className="ic--22" /></div>
              <b>已取消导出</b>
              <span>半成品文件已删掉 · 视频不受影响</span>
            </div>
            <div className="xacts">
              <Btn variant="secondary" onClick={onClose}>关闭</Btn>
              <Btn variant="accent" onClick={() => setWatch(null)}>重新导出</Btn>
            </div>
          </>
        ) : (
          <>
            <div className="xhead">
              <b>导出成片</b>
              <span className="t-detail push">MP4</span>
            </div>
            <div className="xq__sum">{parts.join(' · ')}</div>
            <div className="xq__rows">
              <div className="xq__row">
                <span className="xq__lb">尺寸</span>
                <Picker size="s" value={X.resLabel(res) + ' · ' + est.dims.w + '×' + est.dims.h} open={resOpen}
                  onClick={() => setResOpen((v) => !v)} onClose={() => setResOpen(false)} popWidth={260}>
                  <Menu>
                    {resList.map((c) => {
                      const e = X.estimate(c.short, ratio, span.dur, 'standard');
                      return <MenuItem key={c.short} label={c.label + ' · ' + e.dims.w + '×' + e.dims.h} on={c.short === res}
                        sub={(c.source ? '原始分辨率 · ' : '') + e.eta + ' · 约 ' + e.size}
                        onClick={() => { setResPick(c.short); setResOpen(false); }} />;
                    })}
                  </Menu>
                </Picker>
                <span className="t-detail push">{est.eta} · 约 {est.size}</span>
              </div>
              {subsLanes.length ? (
                <div className="xq__row">
                  <span className="xq__lb">字幕</span>
                  <Switch on={burn} onChange={setBurn} label="画进画面" />
                  <span className="t-detail push t-truncate">{subsLanes.map((l) => l.label).join(' + ')}</span>
                </div>
              ) : null}
              <div className="xq__row xq__row--top">
                <span className="xq__lb">存到</span>
                <span className="xq__val">
                  <span className="t-mono xq__file">{file}</span>
                  <span className="t-detail">项目的 exports/ 文件夹 · 同名时加序号，不覆盖</span>
                </span>
              </div>
            </div>
            <div className="xnote">画面、声音和每一层开不开都照时间线。要换画幅、只导一段，或导音频、字幕文件，让 Agent 导或在 BaoCut 里打开这部视频。</div>
            <div className="xacts xacts--between">
              <BCAction type="button" className="xlink xq__cmd" onClick={() => copy('cmd', cmd)} title={cmd}>
                <Ic n={copied === 'cmd' ? 'check' : 'copy'} className="ic--14" />
                {copied === 'cmd' ? '已复制命令' : '复制等效命令'}
              </BCAction>
              <span className="xq__btns">
                <Btn variant="secondary" onClick={onClose}>取消</Btn>
                <Btn variant="accent" icon="export" onClick={start}>导出</Btn>
              </span>
            </div>
          </>
        )}
      </div></Popover>
    );
  }

  Object.assign(window, {ExportQuickPopover});
})();
