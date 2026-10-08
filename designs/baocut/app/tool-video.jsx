/* 工具 › 视频文件工具的共享层 —— §17.5（2026-09-16）；2026-10-06 按 product-design §2.7「视频文件」组改成一页三个动作。
   压缩 / 合并 / 提取音频共用：ffmpeg 卡（检测 / 安装 / 升级）、任务队列（本机一次跑一条，每条落一条不属于任何项目的后台任务）、
   页面外壳（VideoToolShell：页顶 SegmentedControl 切三个动作、保存位置一行、演示挡位、右栏队列）、从 Space 里选视频文件。
   各页：压缩 tool-video-compress.jsx、合并 tool-video-merge.jsx、提取音频 tool-video-extract.jsx；任务卡 tool-video-jobs.jsx。
   完成的结果注册进 Space（压缩 / 合并是视频文件条目，提取音频是音频条目），文件在保存位置；
   任务记录带 toolId、params、outputs 与 saveDir（字段形状见 model-tool-runs.js 头注释）。
   规则、命令与数字全部来自 model-video.js（BC_VIDEO），视图不自己算。
   源文件的时长与尺寸是**真读**的：选中的文件挂到一个隐藏 <video> 上取 metadata，
   帧率与编码浏览器给不出，按 30 fps / h264 记（真产品走 ffprobe）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const V = window.BC_VIDEO;

  /* ---------- 原型演示挡位 ---------- */
  const FULL_CAPS = ['libx264', 'libx265', 'h264_videotoolbox', 'hevc_videotoolbox', 'aac', 'aac_at'];
  const THIN_CAPS = ['libx264', 'aac'];
  const ENVS = [
    {k: 'ready', label: 'ffmpeg 7.1 已就绪',
      env: {found: true, version: '7.1', major: 7, manager: 'brew', installer: 'brew', path: '/opt/homebrew/bin/ffmpeg', caps: FULL_CAPS}},
    {k: 'update', label: 'ffmpeg 6.1 · Homebrew 里有新版',
      env: {found: true, version: '6.1', major: 6, manager: 'brew', installer: 'brew', path: '/opt/homebrew/bin/ffmpeg', updateAvailable: true, caps: FULL_CAPS}},
    {k: 'thin', label: 'ffmpeg 7.1 精简版（没有 libx265）',
      env: {found: true, version: '7.1', major: 7, manager: 'foreign', installer: 'brew', path: '/usr/local/bin/ffmpeg', caps: THIN_CAPS}},
    {k: 'missing', label: '没装 ffmpeg，有 Homebrew',
      env: {found: false, installer: 'brew', caps: []}},
    {k: 'bare', label: '没装 ffmpeg，也没有包管理器',
      env: {found: false, installer: null, caps: []}},
    {k: 'old', label: 'ffmpeg 3.4.8 太旧（Homebrew 装的）',
      env: {found: true, version: '3.4.8', major: 3, manager: 'brew', installer: 'brew', path: '/opt/homebrew/bin/ffmpeg', caps: THIN_CAPS}},
    {k: 'foreign', label: 'ffmpeg 3.4.8 太旧（自己编译的）',
      env: {found: true, version: '3.4.8', major: 3, manager: 'foreign', installer: 'brew', path: '/usr/local/bin/ffmpeg', caps: THIN_CAPS}},
  ];
  /* 跑完之后的结果挡位：故障卡不靠想象，照着真实 stderr 的原句演示。 */
  const OUTCOMES = [
    {k: 'ok', label: '成功'},
    {k: 'disk', label: '磁盘满', stderr: "av_interleaved_write_frame(): No space left on device\nError writing trailer of /Volumes/Tiny/out.mp4: No space left on device"},
    // 缺编码器这一条要报出「这次真的点了的那个编码器」，否则命令里写着 libx264、
    // 报错里却说 libx265，看截图的人第一反应会是原型坏了。
    {k: 'encoder', label: '缺这次要用的编码器',
      stderr: (r) => `Unknown encoder '${(r.plan || {}).videoEncoder || 'libx265'}'\nError while opening encoder for output stream #0:0`},
    {k: 'hw', label: '显卡编码器起不来', stderr: "Error while opening encoder for output stream #0:0 - maybe incorrect parameters such as bit_rate, rate, width or height"},
    {k: 'missing', label: '源文件不见了', stderr: '/Users/me/Movies/holiday.mov: No such file or directory'},
    {k: 'weird', label: '认不出的失败', stderr: 'Conversion failed!\n[out#0/mp4 @ 0x600001] Error muxing a packet'},
    {k: 'over', label: '按体积压完还是超了'},
    {k: 'noaudio', label: '源文件没有音轨（提取音频）'},
  ];
  const LABEL = {compress: '压缩视频', merge: '合并视频', extract: '提取音频'};

  /* ---------- 模块级状态：离开这一页任务照样跑完 ---------- */
  const store = {env: 'ready', outcome: 'ok', list: [], seq: 0, timer: null,
    install: null, drafts: {}, subs: new Set()};
  const emit = () => store.subs.forEach((fn) => fn(store.list.slice()));
  const env = () => (ENVS.find((e) => e.k === store.env) || ENVS[0]).env;
  const caps = () => env().caps || [];
  const patch = (id, p) => { store.list = store.list.map((r) => (r.id === id ? Object.assign({}, r, p) : r)); emit(); };
  const drop = (id) => { store.list = store.list.filter((r) => r.id !== id); emit(); };
  function useStore() {
    const [, bump] = useState(0);
    useEffect(() => {
      const fn = () => bump((n) => n + 1);
      store.subs.add(fn);
      return () => { store.subs.delete(fn); };
    }, []);
    return {list: store.list, env: env(), caps: caps(),
      setEnv: (k) => { store.env = k; emit(); }, setOutcome: (k) => { store.outcome = k; emit(); }};
  }

  /* ---------- 真读源文件的时长与尺寸 ---------- */
  function probeFile(file) {
    return new Promise((done) => {
      const url = URL.createObjectURL(file);
      const el = document.createElement('video');
      const finish = (extra) => {
        URL.revokeObjectURL(url);
        done(Object.assign({name: file.name, path: file.name, bytes: file.size,
          seconds: 0, width: 0, height: 0, fps: 30, hasAudio: true, audioCodec: 'aac', videoCodec: 'h264'}, extra));
      };
      el.preload = 'metadata';
      el.onloadedmetadata = () => finish({seconds: isFinite(el.duration) ? el.duration : 0,
        width: el.videoWidth, height: el.videoHeight});
      el.onerror = () => finish({});
      el.src = url;
    });
  }
  /** 只收视频容器：把一张 PNG 拖进来应该在挑文件那一步就被拦下 */
  const VIDEO_ACCEPT = 'video/*,.mkv,.m2ts,.mts,.ts,.flv,.wmv';

  /** 拖进来或点开系统选文件。`multiple` 给合并用。 */
  function DropZone({onFiles, multiple, title, sub, icon}) {
    const input = useRef(null);
    const [over, setOver] = useState(false);
    const take = (files) => {
      const list = Array.prototype.slice.call(files || []);
      if (list.length) onFiles(list);
    };
    return (
      <div className={cx('vdrop', over && 'is-over')}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
        <Ic n={icon || 'film'} className="ic--26 vdrop__ic" />
        <b className="t-title-sm">{title}</b>
        <span className="t-detail">{sub}</span>
        <Btn variant="secondary" size="s" icon="folder" onClick={() => input.current.click()}>选择视频…</Btn>
        <input ref={input} type="file" accept={VIDEO_ACCEPT} multiple={!!multiple} hidden
          onChange={(e) => { const f = e.target.files; e.target.value = ''; take(f); }} />
      </div>
    );
  }

  /* ---------- ffmpeg 卡 ---------- */
  /* 三条政策写在 model-video.js 的注释里：不自带二进制、不替用户装包管理器、
     只升能证明是包管理器装的那一份。这张卡就是那三条的界面。 */
  function FfmpegCard({st, s}) {
    const app = useApp();
    const [manual, setManual] = useState(false);
    const e = s.env;
    const upgrade = st.stage === 'old' || st.stage === 'update';
    const cmd = V.installCommand(e.installer, upgrade);
    const fallback = V.manualInstall('mac');
    const run = () => {
      // 原型里安装是一段可取消的模拟；真产品起 `brew install ffmpeg` 并把输出喂进这张卡。
      const tid = app.addTask({kind: 'setup', flow: 'tools', project: null,
        title: upgrade ? '升级 ffmpeg' : '安装 ffmpeg', sub: cmd, phase: '下载', cancellable: true});
      let p = 0;
      clearInterval(store.install);
      store.install = setInterval(() => {
        p = Math.min(100, p + 8);
        app.patchTask(tid, {pct: p, phase: p < 60 ? '下载' : '安装'});
        if (p < 100) return;
        clearInterval(store.install);
        app.patchTask(tid, {status: 'done', outcome: 'done', pct: 100, phase: null});
        s.setEnv('ready');
        app.toast(upgrade ? '已升级到 ffmpeg 7.1' : '已装好 ffmpeg 7.1', 'positive');
      }, 160);
    };
    return (
      <div className={cx('vffm', 'vffm--' + st.tone)}>
        <Ic n={st.stage === 'ready' ? 'ok' : st.stage === 'installing' ? 'refresh' : 'alert'} className="ic--16 vffm__ic" />
        <div className="vffm__txt">
          <b className="t-title-sm">{st.title}</b>
          <span className="t-detail">{st.line}</span>
          {manual ? (
            <div className="vffm__manual">
              <span className="t-detail-xs">先装一个包管理器，再回来按「安装 ffmpeg」：</span>
              <div className="vffm__cmd">
                <code className="t-mono">{fallback.command}</code>
                <IconBtn icon="copy" size="s" tip="复制命令"
                  onClick={() => { copyToClipboard(fallback.command); app.toast('已复制命令'); }} />
              </div>
              <span className="t-detail-xs">也可以从 <a href={fallback.url} target="_blank" rel="noreferrer">ffmpeg.org</a> 下官方构建，放进 PATH 里。BaoCut 不替你跑安装脚本。</span>
            </div>
          ) : null}
        </div>
        <div className="vffm__acts">
          {st.actions.indexOf('install') >= 0
            ? <Btn variant="accent" size="s" icon="download" onClick={run}>安装 ffmpeg</Btn> : null}
          {st.actions.indexOf('upgrade') >= 0
            ? <Btn variant={st.stage === 'old' ? 'accent' : 'secondary'} size="s" icon="upload" onClick={run}>升级</Btn> : null}
          {st.actions.indexOf('checkUpdate') >= 0
            ? <Btn variant="quiet" size="s" icon="refresh" onClick={() => app.toast('已经是最新版本')}>检查更新</Btn> : null}
          {st.actions.indexOf('manual') >= 0
            ? <Btn variant="quiet" size="s" onClick={() => setManual((v) => !v)}>{manual ? '收起' : '手动安装说明'}</Btn> : null}
          {st.actions.indexOf('recheck') >= 0
            ? <Btn variant="quiet" size="s" icon="search" onClick={() => app.toast(e.found ? `找到 ${e.path}` : '还是没找到 ffmpeg')}>重新检测</Btn> : null}
          {st.actions.indexOf('cancel') >= 0
            ? <Btn variant="quiet" size="s" onClick={() => clearInterval(store.install)}>取消</Btn> : null}
        </div>
      </div>
    );
  }

  /** 原型演示挡位：不属于产品 UI，照 wizard.jsx 的 `<details>` 放在表单底下。 */
  function DemoSwitch({s}) {
    return (
      <BCDisclosure className="import-demo" title={<> 原型演示场景 </>}>
        <div className="vdemo">
          <label>
            ffmpeg 环境
            <BCSelect aria-label="ffmpeg 演示环境" value={store.env} onChange={(e) => s.setEnv(e.target.value)}>
              {ENVS.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </BCSelect>
          </label>
          <label>
            这次运行的结果
            <BCSelect aria-label="运行结果演示挡位" value={store.outcome} onChange={(e) => s.setOutcome(e.target.value)}>
              {OUTCOMES.map((x) => <option key={x.k} value={x.k}>{x.label}</option>)}
            </BCSelect>
          </label>
        </div>
      </BCDisclosure>
    );
  }

  /* ---------- 队列：本机一次跑一条 ---------- */
  /** `saveDir`：这次的保存位置（BC_SAVE_DIR.current）；名字不与队列里和 Space 里已有的重名 */
  function enqueue(app, kind, payload, saveDir) {
    store.seq += 1;
    const taken = store.list.map((r) => r.name).concat((app.spaceItems || []).map((x) => x.name));
    const rec = kind === 'extract' ? window.BC_TOOL_EXTRACT.makeJob(store.seq, payload.src, taken, saveDir)
      : Object.assign(V.makeJob(kind, store.seq, payload, taken), {saveDir: saveDir || null});
    store.list = [rec].concat(store.list);
    emit();
    const ahead = V.aheadOf(store.list, rec.id);
    if (ahead) app.toast(`已排队 · 前面还有 ${ahead} 条，本机一次跑一条`);
    pump(app);
    return rec;
  }
  function pump(app) {
    const r = V.nextQueued(store.list);
    if (!r) return;
    const EX = window.BC_TOOL_EXTRACT;
    const extract = r.kind === 'extract';
    const tid = app.addTask({kind: 'video', flow: 'tools', tool: r.kind, toolId: r.kind, project: null, title: `${LABEL[r.kind]} · ${r.name}`,
      sub: extract ? EX.jobMeta(r) : V.jobMeta(r), phase: extract ? '读取音轨' : '编码', cancellable: true,
      params: extract ? {src: r.source} : {src: r.source, clips: r.clips, form: r.form}, ...window.BC_TOOL_RUNS.outputsPatch([], r.saveDir)});
    patch(r.id, {status: 'running', pct: 0, taskId: tid});
    const t0 = Date.now();
    const outcome = OUTCOMES.find((o) => o.k === store.outcome) || OUTCOMES[0];
    let p = 0;
    clearInterval(store.timer);
    store.timer = setInterval(() => {
      const cur = store.list.find((x) => x.id === r.id);
      if (!cur || cur.status !== 'running') { clearInterval(store.timer); return; }
      p = Math.min(100, p + (extract ? 8 : 4));
      const elapsed = (Date.now() - t0) / 1000;
      const fraction = p / 100;
      // 提取音频：源文件没有音轨时不跑编码，读完音轨信息就停（§2.7，错误码 TRANSCODE_NO_AUDIO）
      if (extract && (r.plan.error || store.outcome === 'noaudio') && p >= 8) {
        clearInterval(store.timer);
        const err = r.plan.error || EX.noAudio(r.source.name);
        patch(r.id, {status: 'error', noAudio: err, elapsed});
        app.patchTask(tid, {status: 'error', outcome: 'error', phase: null, error: err.title, errorCode: err.code});
        app.toast(err.title, 'negative');
        pump(app);
        return;
      }
      // 失败挡位在 40% 上报错：进度条已经动过，才看得出「跑到一半失败」长什么样。
      if (outcome.stderr && p >= 40 && !extract) {
        const text = typeof outcome.stderr === 'function' ? outcome.stderr(r) : outcome.stderr;
        clearInterval(store.timer);
        const d = V.classify(text, 1, false);
        patch(r.id, {status: 'error', diagnosis: d, stderr: text, elapsed});
        app.patchTask(tid, {status: 'error', outcome: 'error', phase: null, error: V.causeTitle(d)});
        app.toast(V.causeTitle(d), 'negative');
        pump(app);
        return;
      }
      patch(r.id, {pct: p, outSeconds: r.seconds * fraction, speed: 1.6 + (p % 7) / 10,
        etaSeconds: V.etaSeconds(fraction, elapsed)});
      app.patchTask(tid, {pct: p, phase: p < 6 ? '准备' : '编码'});
      if (p < 100) return;
      clearInterval(store.timer);
      const planned = r.plan.estimatedBytes || Math.round(r.sourceBytes * 0.3);
      // 「超了」挡位故意压出比目标大一点的文件，好演示「再紧一点」那一枚。
      const bytes = r.overrideKbps ? Math.round(r.form.megabytes * 1024 * 1024 * 0.95)
        : store.outcome === 'over' ? Math.round(r.form.megabytes * 1024 * 1024 * 1.2) : planned;
      const entry = register(app, r, extract ? r.plan.estimatedBytes : bytes, tid);
      patch(r.id, {status: 'done', pct: 100, bytes: extract ? r.plan.estimatedBytes : bytes, elapsed, ago: '刚刚', entry});
      app.patchTask(tid, Object.assign({status: 'done', outcome: 'done', pct: 100, phase: null}, window.BC_TOOL_RUNS.outputsPatch([entry], r.saveDir)));
      app.toast(`已生成 ${r.name} · 保存在 ${window.BC_SAVE_DIR.label(r.saveDir || window.BC_SAVE_DIR.DEFAULT)}`, 'positive');
      pump(app);
    }, 90);
  }
  /** 完成的结果进 Space：压缩 / 合并是视频文件条目，提取音频是音频条目；文件在保存位置 */
  function register(app, r, bytes, task) {
    const dir = r.saveDir || window.BC_SAVE_DIR.DEFAULT;
    const p = r.plan || {};
    const c = p.compatibility || {};
    const w = p.width || c.width || (r.source && r.source.width);
    const h = p.height || c.height || (r.source && r.source.height);
    return app.registerToolOutput(r.kind === 'extract' ? 'audio' : 'final', {id: `${r.id}-${Date.now().toString(36)}`, name: r.name,
      file: `${dir}/${r.name}`, dur: r.seconds, bytes, res: r.kind === 'extract' || !w ? '' : `${w}×${h}`,
      sourceName: r.source ? r.source.name : null, toolId: r.kind, tool: r.kind, task,
      params: r.kind === 'extract' ? {src: r.source} : {src: r.source, clips: r.clips, form: r.form},
      note: r.kind === 'extract' ? `${r.plan.line} · 交互原型不落真文件` : '交互原型不落真文件'});
  }
  function cancel(app, r) {
    if (r.status === 'queued') { patch(r.id, {status: 'canceled'}); return; }
    app.cancelTask(r.taskId, {after: () => {
      clearInterval(store.timer);
      patch(r.id, {status: 'canceled', pct: 0});
      pump(app);
    }});
  }
  const requeue = (app, r, extra) => { patch(r.id, Object.assign({status: 'queued', pct: 0, bytes: null, diagnosis: null, noAudio: null}, extra)); pump(app); };

  /** 合并那一页的草稿（离开再回来还在）。传参写、不传读。 */
  function mergeDraft(next) {
    if (next) store.drafts.merge = next;
    return store.drafts.merge || {};
  }

  /* ---------- 页面外壳：三个动作共用一页 ---------- */
  const ACTIONS = [{id: 'compress', label: '压缩'}, {id: 'merge', label: '合并'}, {id: 'extract', label: '提取音频'}];
  /** ffmpeg 还没准备好时导航栏上说什么（三页同一句） */
  function ffmpegGate(st) {
    if (st.stage === 'ready' || st.stage === 'update') return null;
    return st.stage === 'installing' ? 'ffmpeg 正在装，装完这里就能跑' : '先把 ffmpeg 准备好——下面那张卡里就能装';
  }
  /** 页面里 ⌘↵ 触发开始（这几页没有文字框，钩在窗口上） */
  function useCmdEnter(goRef) {
    useEffect(() => {
      const onKey = (ev) => {
        if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter' && goRef.current) { ev.preventDefault(); goRef.current(); }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, []);
  }
  /**
   * 视频文件工具的一页：页顶切换三个动作（S2 SegmentedControl，切换就是换路由）、ffmpeg 卡、表单、保存位置、演示挡位，右栏是共用队列。
   * @param {{tool: 'compress'|'merge'|'extract', title: string, bar: any, s: object, save: object, onReuse: Function, onFix: Function, children: any}} props
   */
  function VideoToolShell({tool, title, bar, s, save, onReuse, onFix, children}) {
    const app = useApp();
    const R = window.RSP;
    const st = V.ffmpegState(s.env);
    return (
      <window.Page wide title={title} bar={bar} actions={<Chip icon="lock">在这台电脑上处理 · 不上传</Chip>}>
        <div className="vw">
          <div className="vw__main">
            <R.SegmentedControl aria-label="视频文件工具" selectedKey={tool} onSelectionChange={(id) => { if (id !== tool) app.go({r: 'tools', id}); }}>
              {ACTIONS.map((a) => <R.SegmentedControlItem key={a.id} id={a.id}>{a.label}</R.SegmentedControlItem>)}
            </R.SegmentedControl>
            {st.stage === 'ready' ? null : <FfmpegCard st={st} s={s} />}
            {children}
            <window.ToolSaveDirRow save={save} />
            <DemoSwitch s={s} />
          </div>
          <window.VideoJobList list={s.list} onReuse={onReuse} onFix={onFix} />
        </div>
      </window.Page>
    );
  }
  /** 「从 Space 里选」：收起时一枚按钮，展开是 Space 选择器（只列视频文件）；选中给出与本机文件同一形状的源描述 */
  function VideoSpacePick({tool, onPick, label}) {
    const [open, setOpen] = useState(false);
    if (!open) return <BCAction className="viewall" onClick={() => setOpen(true)}>{label || '从 Space 里选…'}</BCAction>;
    return <div className="vw__space">
      <window.ToolSpacePicker tool={tool} value={null} onChange={(e) => { setOpen(false); onPick(window.BC_TOOL_EXTRACT.fromEntry(e), e); }} />
      <BCAction className="viewall" onClick={() => setOpen(false)}>收起</BCAction>
    </div>;
  }

  Object.assign(window, {VideoDropZone: DropZone, VideoFfmpegCard: FfmpegCard, VideoDemoSwitch: DemoSwitch, useVideoStore: useStore,
    VideoToolShell, VideoSpacePick,
    videoProbeFile: probeFile, videoEnqueue: enqueue, videoRequeue: requeue, videoMergeDraft: mergeDraft, VIDEO_ACCEPT,
    BC_VIDEO_QUEUE: {store, env, drop, cancel, requeue, ffmpegGate, useCmdEnter, LABEL}});
})();
