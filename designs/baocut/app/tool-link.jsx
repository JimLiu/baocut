/* 下载视频（product-design §2.7）：文件下载与可选转录，不创建编辑视频。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const SAMPLE_URL = 'https://video.example.com/watch?v=kl39';
  const drafts = {st: null};
  const urlOk = (u) => window.BC_MEDIA.urlValid(u);
  function LinkField({value, onChange}) {
    return <div className="ttsw__sec">
      <R.TextField label="视频链接" value={value} onChange={onChange} placeholder="https://…" type="url"
        isInvalid={!!value && !urlOk(value)} errorMessage="链接要以 http:// 或 https:// 开头" UNSAFE_className="tool-link__url" />
      <div className="row gap8"><span className="t-detail-xs grow">支持单个视频页面与媒体直链。</span>
        <Btn size="s" variant="quiet" onClick={() => onChange(SAMPLE_URL)}>填入示例链接</Btn></div>
    </div>;
  }
  /* 下载工具与网站登录（product-design §2.7）：两项都在设置 › 视频下载里管理，这里只摘要——yt-dlp 的版本与状态、
     这次下载按什么顺序试哪些浏览器的 Cookie（默认所有检测到的浏览器），没就绪时就地「准备下载工具」，
     其余去设置里改（更新、重新检测、改勾选）。 */
  function DownloadSummary() {
    const app = useApp();
    const DL = window.BC_DOWNLOADER;
    const d = app.downloader || {};
    const updating = d.state === 'updating';
    const settings = window.BC_SETTINGS_LINK.parse('/settings/downloader');
    return <div className="ttsw__sec">
      <div className="row gap8"><R.Icons.Download /><b className="grow">视频下载工具 · yt-dlp</b><span className="t-detail-xs">{DL.statusOf(d)}</span></div>
      <span className="t-detail-xs">{d.version || '未安装'} · 网站登录：{window.BC_TOOL_COOKIES.subText(DL.cookieList(app))}</span>
      <div className="row gap8">
        {d.state !== 'ready' && !updating && <Btn size="s" onClick={() => app.updateDownloader()}>准备下载工具</Btn>}
        <Btn size="s" variant="quiet" onClick={() => app.go(settings.route)}>更改下载设置</Btn>
      </div>
    </div>;
  }
  function LinkToolPage() {
    const app = useApp();
    const s = window.useToolRuns();
    const [st, setSt] = useState(() => Object.assign({url: '', target: 'none', dir: null, transcribe: false, saveDir: window.BC_SAVE_DIR.current(app.prefs, null)}, drafts.st || {}));
    const [changeDir, setChangeDir] = useState(false);
    const set = (patch) => setSt((x) => Object.assign({}, x, patch));
    useEffect(() => { drafts.st = st; }, [st]);
    const toolReady = !app.downloader || app.downloader.state === 'ready';
    const ready = urlOk(st.url) && toolReady && /^(~\/|\/|[a-zA-Z]:[\\/])/.test(st.saveDir);
    /* 网站登录按设置 › 视频下载：开始时按当前检测结果展开成浏览器列表，冻结进这一次下载 */
    const go = () => window.BC_TOOL_RUNNER.start(app, window.BC_TOOL_SPECS.link(app, Object.assign({}, st, {target: 'none',
      cookieBrowsers: window.BC_DOWNLOADER.cookieList(app)})));
    return <window.ToolFrame tool="link" title="下载视频" bar={<Btn variant="accent" disabled={!ready} onClick={go}>{st.transcribe ? '下载并转录' : '开始下载'}</Btn>}>
      <p className="t-detail">粘贴视频链接，下载到本机。需要文稿时，可以在下载完成后自动转录。</p>
      <LinkField value={st.url} onChange={(url) => set({url})} />
      <div className="ttsw__sec"><div className="row gap8"><R.Icons.Folder /><span className="grow t-detail">下载到 {st.saveDir}</span><Btn size="s" variant="quiet" onClick={() => setChangeDir(!changeDir)}>更改目录</Btn></div>
        {changeDir && <R.TextField label="下载目录（原型演示）" value={st.saveDir} onChange={(saveDir) => set({saveDir})} description="Electron 中使用系统文件夹选择器。" />}
      </div>
      <DownloadSummary />
      <div className="ttsw__sec">
        <R.Switch isSelected={st.transcribe} onChange={(transcribe) => set({transcribe})}>下载后转录</R.Switch>
        {st.transcribe && <>
          <span className="t-detail-xs">使用默认语音识别模型，自动检测语言，保存 TXT 文稿和 SRT 字幕。转录失败时已下载的视频仍保留。</span>
          <R.Picker label="转录结果放到项目（可选）" selectedKey={st.dir || 'none'} onSelectionChange={(dir) => set({dir: dir === 'none' ? null : dir})}
            disabledKeys={app.dirs.filter((d) => d.missing).map((d) => d.id)} UNSAFE_className="tool-llm__field">
            <R.PickerItem id="none">不放到项目</R.PickerItem>
            {app.dirs.map((d) => <R.PickerItem key={d.id} id={d.id} textValue={d.name}><R.Text slot="label">{d.name}</R.Text>
              {d.missing && <R.Text slot="description">目录不在了</R.Text>}</R.PickerItem>)}
          </R.Picker>
          {st.dir && <span className="t-detail-xs">仅关联项目，文件仍保存在上方指定的目录。</span>}
        </>}
      </div>
      <window.ToolDemo />
      <p className="t-detail-xs">交互原型：模拟下载和转录，不访问真实视频，不读取真实浏览器的 Cookie。</p>
    </window.ToolFrame>;
  }
  Object.assign(window, {LinkToolPage, BC_LINK_TOOL: {LinkField, urlOk, SAMPLE_URL}});
})();
