/* 常用格式的文件标签页原型（产品设计 §3.3）。PDF 用演示页；HTML 在无脚本、无网络沙箱内显示。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const F = window.BC_FILE_PREVIEW;
  function FileTabPreview({file, source}) {
    const kind = F.kind(file.file || file.name, file.contentKind);
    if (file.previewTooLarge) return <div className="file-preview__error" role="status">文件太大，无法在这里完整显示。</div>;
    if (!kind) return <div className="file-preview__error" role="status">{file.attachment ? 'BaoCut 暂时不能预览这种文件。可以下载副本，用其他应用打开。' : 'BaoCut 暂时不能预览这种文件。请在文件夹中显示，再用其他应用打开。'}</div>;
    if (kind === 'pdf') return file.attachment && file.previewSrc ? <iframe className="file-preview__uploaded-pdf" title={file.name} src={file.previewSrc} /> : <PdfPreview file={file} />;
    if (source) return <Source text={file.text || ''} />;
    if (kind === 'markdown') return <window.DocumentReading text={file.text || ''} />;
    if (kind === 'html') {
      const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">`;
      return <iframe className="file-preview__html" title={file.name} sandbox="" referrerPolicy="no-referrer" srcDoc={policy + (file.text || '')} />;
    }
    if (kind === 'table') {
      const parsed = F.table(file.text, /\.tsv$/i.test(file.file) ? '\t' : ',');
      if (parsed.error) return <div className="file-preview__error" role="status">{parsed.error}</div>;
      const width = Math.max(0, ...parsed.rows.map(row => row.length));
      return <div className="file-preview__table-wrap bc-scroll"><table className="file-preview__table" aria-label={file.name}>
        <thead><tr><th scope="col">行</th>{Array.from({length: width}, (_, i) => <th key={i} scope="col">{parsed.rows[0]?.[i] || `列 ${i + 1}`}</th>)}</tr></thead>
        <tbody>{parsed.rows.slice(1).map((row, i) => <tr key={i}><th scope="row">{i + 1}</th>{Array.from({length: width}, (_, j) => <td key={j}>{row[j] || ''}</td>)}</tr>)}</tbody>
      </table><div className="file-preview__meta">{Math.max(0, parsed.rows.length - 1)} 行 · {width} 列</div></div>;
    }
    const parsed = kind === 'json' ? F.json(file.text) : {text: file.text || '', error: null};
    return <>{parsed.error && <div className="file-preview__error" role="status">{parsed.error}</div>}<Source text={parsed.text} /></>;
  }
  function Source({text}) {
    return <pre className="file-preview__source"><code>{String(text).split('\n').map((line, i) => <span className="file-preview__line" key={i}>
      <span className="file-preview__number" aria-hidden="true">{i + 1}</span><span>{line || '\n'}</span>
    </span>)}</code></pre>;
  }
  function PdfPreview({file}) {
    const [page, setPage] = useState(0);
    const [zoom, setZoom] = useState('fit');
    const pages = file.pages || [];
    if (!pages.length) return <div className="file-preview__error">这个 PDF 没有可预览的页面，请用默认应用打开。</div>;
    return <div className="file-preview__pdf">
      <div className="file-preview__toolbar">
        <R.ActionButton isQuiet aria-label="上一页" isDisabled={page === 0} onPress={() => setPage(page - 1)}><R.Icons.ChevronLeft /></R.ActionButton>
        <span aria-live="polite">第 {page + 1} / {pages.length} 页</span>
        <R.ActionButton isQuiet aria-label="下一页" isDisabled={page === pages.length - 1} onPress={() => setPage(page + 1)}><R.Icons.ChevronRight /></R.ActionButton>
        <R.Picker aria-label="PDF 缩放" selectedKey={zoom} onSelectionChange={k => setZoom(String(k))}>
          <R.PickerItem id="fit">适合宽度</R.PickerItem><R.PickerItem id="100">100%</R.PickerItem><R.PickerItem id="125">125%</R.PickerItem><R.PickerItem id="150">150%</R.PickerItem>
        </R.Picker>
      </div>
      <div className="file-preview__pdf-scroll bc-scroll"><article className="file-preview__paper" style={zoom === 'fit' ? undefined : {width: `${Number(zoom) * 4.8}px`, flexShrink: 0}}>
        <div className="file-preview__eyebrow">制作简报</div><h1>{pages[page].title}</h1>
        {pages[page].paragraphs.map((text, i) => <p key={i}>{text}</p>)}
        <footer>{page + 1}</footer>
      </article></div>
    </div>;
  }
  Object.assign(window, {FileTabPreview});
})();
