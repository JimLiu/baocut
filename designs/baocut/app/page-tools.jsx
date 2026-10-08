/* 工具页 —— §17.5（2026-09-16）。
   侧栏「后台任务」下面一行进来：不依附任何项目的独立工具。直接调用模型，无 Agent loop。目录按能力分组，
   每张卡一句「能拿它做什么」加一行现状；远端算力 2026-09-17 搬去侧栏「服务」（§17.6，旧链接在 main.jsx 里落过去），
   生成语音见 tool-tts.jsx，压缩 / 合并视频见 tool-video.jsx 与 tool-video-merge.jsx，生成图片见 tool-image.jsx（2026-09-25）。
   2026-10-03 每张卡多一行「结果」（从工具目录的输入声明派生）；2026-10-06 按 product-design §2.7 分成语音与字幕 / 文字与图片 /
   视频文件三组，新增提取音频（与压缩、合并共用一页，tool-video-extract.jsx）。各工具页共用一套骨架：输入（含 Space 选择器）→ 模型 →
   选项 → 保存位置 → 开始（tool-frame.jsx、tool-space-picker.jsx），结果是保存到默认保存位置的 Space 条目。
   从 Space 查看器「用工具处理…」或结果页「接着用工具」进来时（store 的 openToolWith），各工具页挂载时取走预设、输入已经选好。 */
(function () {
  const D = window.BC_DATA;
  const T = window.BC_TOOLS;

  function ToolCard({t, status}) {
    const app = useApp();
    const Icon = window.RSP.Icons[t.icon];
    return (
      <BCAction type="button" className={cx('toolcard', t.planned && 'is-planned')} disabled={t.planned}
        onClick={() => app.go({r: 'tools', id: t.id})}>
        <span className="toolcard__ic">{Icon ? <Icon aria-hidden="true" /> : <Ic n={t.icon} className="ic--22" />}</span>
        <span className="toolcard__txt">
          <span className="toolcard__nm">
            <b>{t.name}</b>
            {t.planned ? <Chip>即将推出</Chip> : null}
          </span>
          <span className="toolcard__desc">{t.desc}</span>
          <span className="toolcard__res">{T.resultLine(t.id)}</span>
          {status ? (
            <span className="toolcard__st">
              <span className="sidedot" style={{background: status.on ? 'var(--green-900)' : 'var(--gray-400)'}} />
              {status.text}
            </span>
          ) : null}
        </span>
        {t.planned ? null : <NavChevron className="toolcard__go" />}
      </BCAction>
    );
  }

  function ToolsGallery() {
    const app = useApp();
    const v = window.useVideoStore();
    const ffmpeg = T.videoStatus(v.env);
    const status = {
      tts: T.ttsStatus(app.modelInstalled, app.cloudSaved),
      compress: ffmpeg,
      merge: ffmpeg,
      extract: ffmpeg,
      image: T.imageStatus(window.useImageEngines(app).filter(e => e.family !== 'agent')),
      link: app.downloader ? {text: app.downloader.state === 'ready' ? `下载工具就绪 · yt-dlp ${app.downloader.version}` : '第一次使用前要准备下载工具', on: app.downloader.state === 'ready'} : null,
    };
    return (
      <window.Page title="工具">
        <div className="t-body-sm t-subdued tools__lede">
          不经过会话，直接做一件确定的事，无需连接 Agent。结果保存到默认保存位置，并作为条目出现在 Space 里，可以接着用别的工具处理、以此新建视频，或交给 Agent 继续。
        </div>
        {T.GROUPS.map((g) => (
          <section key={g.k} className="tools__grp">
            <div className="t-section">{g.label}</div>
            <div className="t-detail tools__grpdesc">{g.desc}</div>
            <div className="tools__grid">
              {g.tools.map((t) => <ToolCard key={t.id} t={t} status={status[t.id]} />)}
            </div>
          </section>
        ))}
        <div className="t-detail tools__foot">Space 里的条目也能直接送进工具：在 Space 中打开一个条目，选「用工具处理…」。</div>
      </window.Page>
    );
  }

  /** 路由 `{r:'tools', id?}`：id 能打开就进那个工具，否则是目录 */
  function ToolsPage({id}) {
    const t = T.openable(id);
    if (t && t.id === 'transcribe') return <window.TranscribeToolPage />;
    if (t && t.id === 'translate') return <window.TranslateToolPage />;
    if (t && t.id === 'dub') return <window.DubToolPage />;
    if (t && t.id === 'link') return <window.LinkToolPage />;
    if (t && t.id === 'text') return <window.LlmToolPage key={t.id} kind={t.id} />;
    if (t && t.id === 'tts') return <window.TtsToolPage />;
    if (t && t.id === 'compress') return <window.CompressToolPage />;
    if (t && t.id === 'merge') return <window.MergeToolPage />;
    if (t && t.id === 'extract') return <window.ExtractToolPage />;
    if (t && t.id === 'image') return <window.ImageToolPage />;
    return <ToolsGallery />;
  }

  Object.assign(window, {ToolsPage});
})();
