/* 设置 › 字体（product-design §5.9「字体」、§7.6；architecture-design §9.1、§5.10 的 `fonts.*` 设置）。
   ============================================================================
   两组：
   - **下载**：自动下载字体（缺省开）——预览、打开视频与导出用到本机没有、字体目录里有的族时自动下载；
     关掉时照回退字体显示与导出，选字框里仍可手动下载。镜像：样式表地址与字体文件地址两格，
     只接受 https、不带账号、查询参数与片段，留空用默认（googleapis / gstatic）；不合规的当场说，不保存。
   - **已下载的字体**：总大小与族数；每个族一行（样张、字重、大小、许可、下载时间），可以删除；
     「全部清空」先确认。还没结束的导出在用的族标「导出在用」、删除钮不可点，清空时留下并说留了几个。
   字体存在应用数据里，不进视频目录；删除后用到它的视频先用回退字体显示，需要时再下载。
   ============================================================================ */
(function () {
  const {useState} = React;
  const Row = window.ShellRow;
  const L = window.BC_FONTLIB;

  function MirrorField({label, placeholder, value, onSave}) {
    const [draft, setDraft] = useState(null);
    const shown = draft != null ? draft : value;
    const err = L.mirrorError(shown);
    return (
      <div className="fontset__mirror">
        <Field size="s" aria-label={label} placeholder={placeholder} value={shown} invalid={!!err}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft != null && !L.mirrorError(draft)) { onSave(draft.trim()); setDraft(null); } }} />
        {err ? <span className="fontset__err">{err}</span> : null}
      </div>
    );
  }

  function FontsSection() {
    const app = useApp();
    const lib = window.useFontLibrary();
    const S = window.BC_FONTSTORE;
    const pins = L.exportPins(app.tasks);
    const {rows, totalBytes} = L.downloadedList(lib.list, pins);
    const clearAll = () => app.confirm({
      title: '清空下载的字体？',
      body: '删除 ' + rows.length + ' 个族、共 ' + L.fmtBytes(totalBytes) + '。用到它们的视频先用回退字体显示，需要时再下载。'
        + (pins.length ? '还没结束的导出在用的会留下。' : ''),
      confirmLabel: '清空', tone: 'negative',
      run: () => {
        const r = S.clear(pins);
        app.toast('已清空 ' + r.removed + ' 个族，释放 ' + L.fmtBytes(r.freedBytes) + (r.kept ? ' · 导出在用的 ' + r.kept + ' 个留下' : ''), 'positive');
      },
    });
    return (
      <>
        <h1 className="setpage__title">字体</h1>
        <p className="t-detail fontset__lead">
          可选的字体有三种来源：随应用发布的、这台电脑上装的，以及 Google Fonts 字体目录里的（约 {lib.total.toLocaleString('en')} 个族，开源许可，按需下载）。
          下载只发送族名与字重，不需要账号；字体存在应用数据里，不进视频目录。
        </p>
        <section className="setpage__group" aria-label="下载">
          <h2>下载</h2>
          <div className="setpage__card">
            <Row label="自动下载字体" desc="预览、打开视频与导出用到这台电脑上没有的字体时，从 Google Fonts 下载。关掉后先用回退字体显示与导出，选字体时仍可手动下载。严格离线时不下载。">
              <Switch on={lib.auto} onChange={(v) => S.setAuto(v)} />
            </Row>
            <Row label="样式表地址" desc="镜像的基址，留空用 https://fonts.googleapis.com。">
              <MirrorField label="样式表地址" placeholder="https://fonts.googleapis.com" value={lib.css} onSave={(v) => S.setMirror('css', v)} />
            </Row>
            <Row label="字体文件地址" desc="只从这个地址下面取字体文件，留空用 https://fonts.gstatic.com。">
              <MirrorField label="字体文件地址" placeholder="https://fonts.gstatic.com" value={lib.file} onSave={(v) => S.setMirror('file', v)} />
            </Row>
          </div>
        </section>
        <section className="setpage__group" aria-label="已下载的字体">
          <div className="fontset__head">
            <h2 className="grow">已下载的字体</h2>
            <span className="t-detail">{rows.length ? rows.length + ' 个族 · ' + L.fmtBytes(totalBytes) : '还没有'}</span>
            <Btn variant="secondary" size="s" disabled={!rows.length} onClick={clearAll}>全部清空</Btn>
          </div>
          {rows.length ? (
            <div className="setpage__card">
              {rows.map((r) => (
                <div key={r.family} className="setrow fontset__row">
                  <span className="nm">
                    <b style={window.BC_FONT.face(r.st)}>{r.family}</b>
                    <span>字重 {r.faces.join(' · ')} · {L.fmtBytes(r.sizeBytes)} · {r.licence}{r.at ? ' · ' + r.at + '下载' : ''}</span>
                  </span>
                  {r.inUse ? <Chip tone="notice">导出在用</Chip> : null}
                  <IconBtn icon="trash" size="s" disabled={r.inUse} tip={r.inUse ? '还没结束的导出在用，导出结束后再删' : '删除这个字体下载的文件'}
                    onClick={() => { if (S.remove(r.family, pins)) app.toast('已删除「' + r.family + '」· 释放 ' + L.fmtBytes(r.sizeBytes)); }} />
                </div>
              ))}
            </div>
          ) : <p className="t-detail">选字体时下载的、打开视频与导出时自动下载的字体都会列在这里。</p>}
        </section>
      </>
    );
  }

  Object.assign(window, {FontsSection});
})();
