/* One destination-first chooser, shared by selected-video menus and properties.
   2026-09-16 二次修订：不检查时长，直接换——片段长度跟着新素材走，同轨后面的片段跟着挪
   （`BC_VIDEO_REPLACE.plan`）；改项目画幅只是一个可选勾选，不勾就保持画幅居中放入。
   另有 `ReplaceAllDialog`：一份智能裁剪产物把时间轴上用同一原片的视频整段换掉。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const R = window.BC_VIDEO_REPLACE, T = window.BC_TIME;
  function ratioOf(src) { return src?.naturalW && src?.naturalH ? src.naturalW / src.naturalH : null; }
  function CompareThumb({src, sourceStart, label, ratio}) {
    return <div className="vr-compare__cell"><span>{label}</span>
      <div className="vr-compare__box" style={{aspectRatio: ratio || 16 / 9}}>
        {src?.crop && window.CropVideo ? <window.CropVideo source={src} el={{start: 0, srcStart: sourceStart || 0, rate: 1}} ctx={{playT: Math.min(src.dur || 0, 12)}} fillH />
          : src?.poster ? <img src={src.poster} alt="" /> : <Ic n="video" className="ic--20" />}
      </div></div>;
  }
  function VideoReplaceDialog({ctx, expected, candidate, onClose}) {
    const preset = candidate ? ctx.sources.video.find(s => s.id === candidate) : null;
    const [tab, setTab] = useState('project'), [query, setQuery] = useState('');
    const [chosen, setChosen] = useState(preset ? preset.id : null);
    const [local, setLocal] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
    const [syncCanvas, setSyncCanvas] = useState(false);
    const file = useRef(null), body = useRef(null), localUrl = useRef(null), kept = useRef(false), request = useRef(0);
    const probeCleanup = useRef(null);
    const record = ctx.elements.find(e => e.id === expected.id);
    const target = record ? {...record, ...ctx.elDocs[record.id]} : null;
    const source = chosen === local?.id ? local : ctx.sources.video.find(s => s.id === chosen);
    const original = ctx.sources.video.find(s => R.sameSource(expected, s));
    // 新素材一律从 0 秒起，同源成片由 plan 自己按原片时间对齐——没有「开始时间」可填
    const result = R.plan({expected, target, source, elements: ctx.elements, docs: ctx.elDocs});
    const recipe = source?.crop;
    const aligned = R.aligned(expected, source);
    const ratio = recipe && window.BC_CROP.ratioOf(recipe.ratio)?.id;
    const full = R.fullFrame(expected, original, ctx.ratio);
    const outRatio = ratioOf(source), canvas = {ratio: window.BC_LAYOUT.ratioValue(ctx.ratio)};
    // 画幅有差只是提示：勾了就一起改项目画幅，不勾就保持画幅、新素材按高居中放入
    const ratioDiffers = !!(full && outRatio && canvas && Math.abs(outRatio - canvas.ratio) > 1e-6);
    const syncBlocked = ratioDiffers ? (ctx.ratioLock ? '视频画幅被模板锁定' : !ratio ? '自定义比例不能作为视频画幅' : '') : '';
    const canApply = result.ok && !loading;
    useEffect(() => {
      const previous = document.activeElement;
      body.current?.querySelector('button')?.focus();
      return () => {
        request.current++; probeCleanup.current?.();
        if (localUrl.current && !kept.current) URL.revokeObjectURL(localUrl.current);
        previous?.focus?.();
      };
    }, []);
    const select = item => { setChosen(item.id); setSyncCanvas(false); setError(''); };
    const chooseFile = event => {
      const picked = event.target.files?.[0];
      if (!picked) return;
      event.target.value = '';
      const ticket = ++request.current;
      probeCleanup.current?.();
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      const url = URL.createObjectURL(picked); localUrl.current = url;
      const probe = document.createElement('video');
      const dispose = () => {
        probe.onloadedmetadata = null; probe.onerror = null;
        probe.removeAttribute('src'); probe.load();
        if (probeCleanup.current === dispose) probeCleanup.current = null;
      };
      probeCleanup.current = dispose;
      setLoading(true); setError(''); setLocal(null); setChosen(null);
      const finish = (message) => {
        dispose();
        if (request.current !== ticket) return;
        setLoading(false); setError(message || '');
      };
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => {
        if (request.current !== ticket) { dispose(); return; }
        if (!Number.isFinite(probe.duration) || !probe.videoWidth) { finish('无法读取这个视频，请选择可播放的视频文件。'); return; }
        const item = {id:'local-video-'+ctx.nextSeq(),name:picked.name,url,kind:'video',dur:probe.duration,
          naturalW:probe.videoWidth,naturalH:probe.videoHeight,meta:`${probe.videoWidth}×${probe.videoHeight} · 本地文件`};
        setLocal(item); select(item); finish();
      };
      probe.onerror = () => finish('无法读取这个视频，请尝试 MP4、MOV 或 WebM。');
      probe.src = url;
    };
    const apply = () => {
      if (!canApply) return;
      const patch = {...result.patch};
      const sync = ratioDiffers && syncCanvas && !syncBlocked;
      if (ratioDiffers && !sync) { patch.place = R.keepPlace(target.place, outRatio, canvas.ratio); patch.pose = {...patch.place}; patch.mode = null; }
      if (source === local) kept.current = true;
      ctx.applyReplacePlan({patches: [{id: expected.id, patch}], ripple: result.ripple, ratioSync: sync ? ratio : null, message: '已替换所选视频',
        before: source === local ? () => { ctx.addSource('video', source); ctx.retainLocalVideoUrl(source.url); } : null});
      onClose();
    };
    const trap = event => {
      event.stopPropagation();
      if (event.key !== 'Tab') return;
      const nodes = Array.from(body.current.closest('.dlg').querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]'));
      const first = nodes[0], last = nodes[nodes.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    return <div className="vr-dialog-host" onKeyDown={trap}><Dialog open title="替换视频" width={840} onClose={onClose}
      footer={<><Btn variant="secondary" onClick={onClose}>取消</Btn><Btn variant="accent" disabled={!canApply} onClick={apply}>确认替换</Btn></>}>
      <div ref={body} className="vr-layout">
        <aside className="vr-target"><div className="vr-section-title">正在替换这个片段</div>
          <div className="vr-target-thumb">{original?.poster ? <img src={original.poster} alt="" /> : <Ic n="video" className="ic--24" />}</div>
          <b>{expected.asset || expected.name}</b><span>{T.timecode(expected.start)} — {T.timecode(expected.end)}</span>
          <span>片段时长 {T.duration(expected.end-expected.start)} · {expected.rate || 1}×</span>
          <p>只替换这个片段。新视频多长片段就多长：同一条轨道上后面的片段跟着挪，位置、缩放与音量保留。</p>
          <div className="vr-target-note"><Ic n="info" className="ic--14" />关闭窗口可取消。确认后可撤销。</div>
        </aside>
        <section className="vr-picker"><div className="vr-picker-head"><Segmented items={[{k:'project',label:'视频视频'},{k:'local',label:'本地文件'}]} value={tab} onChange={setTab} />
          <IconBtn icon="close" tip="关闭替换窗口" onClick={onClose} /></div>
          {tab === 'project' ? <><Field aria-label="搜索视频视频" placeholder="搜索视频视频…" value={query} onChange={e => setQuery(e.target.value)} />
            <VideoLibrary ctx={{...ctx,sources:{...ctx.sources,video:ctx.sources.video.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))}}}
              selection={{id:chosen,onSelect:select,focusId:preset?.id||null}} /></> : <div className="vr-local">
            <Ic n="upload" className="ic--24" /><b>选择本地视频</b><p>文件会加入视频素材，用于替换当前片段。</p>
            <input ref={file} type="file" accept="video/*,.mp4,.mov,.webm,.mkv" hidden onChange={chooseFile} />
            <Btn icon="plus" onClick={() => file.current.click()} disabled={loading}>{loading ? '正在读取视频…' : local ? '重新选择文件' : '选择视频文件'}</Btn>
            {local ? <div className="vr-local-file"><Ic n="video" /><b>{local.name}</b><span>{local.meta} · {T.duration(local.dur)}</span></div> : null}
          </div>}
          <div className="vr-choice"><b>{source ? `替换为：${source.name}` : '尚未选择新素材'}</b>
            {aligned && result.ok && result.mode === 'aligned' ? <span>已按原片时间匹配这份重构图素材。</span> : null}
            {source && result.ok ? <div className="vr-compare">
              <CompareThumb src={original} sourceStart={expected.srcStart} label="现在" ratio={ratioOf(original)} />
              <Ic n="chevright" className="ic--16" />
              <CompareThumb src={source} sourceStart={result.patch.srcStart} label="替换后" ratio={outRatio} />
            </div> : null}
            {ratioDiffers && result.ok ? <div className="vr-canvas">
              <b>新素材是 {ratio || `${source.naturalW}×${source.naturalH}`}，视频画幅是 {ctx.ratio}</b>
              <Checkbox on={syncCanvas && !syncBlocked} disabled={!!syncBlocked} onChange={setSyncCanvas}
                label={syncBlocked ? `同时把视频画幅改为 ${ratio || '新比例'} · ${syncBlocked}` : `同时把视频画幅改为 ${ratio}（之后复核字幕位置）`} />
              <span>{syncCanvas && !syncBlocked ? '整部视频改成新画幅，字幕和元素位置之后复核。' : `不勾就保持 ${ctx.ratio}，新素材按高居中放入，两侧留画布底色。`}</span>
            </div> : null}
            <p className={error || (source && !result.ok) ? 'vr-error' : ''} role="status">
              {error || result.reason || (result.ok ? R.describe(result) : '选一份素材，选了就能换。')}</p>
          </div>
        </section>
      </div>
    </Dialog></div>;
  }
  /** 一份成片换整段视频：列出会一起换的片段与留下的片段，画幅同步可选，一笔确认。 */
  function ReplaceAllDialog({ctx, candidate, group, onClose}) {
    const [syncCanvas, setSyncCanvas] = useState(false);
    const g = group, n = g.replaced.length;
    const ratio = candidate.crop && window.BC_CROP.ratioOf(candidate.crop.ratio)?.id;
    const canvas = {ratio: window.BC_LAYOUT.ratioValue(ctx.ratio)};
    const syncBlocked = g.ratioDiffers ? (ctx.ratioLock ? '视频画幅被模板锁定' : !ratio ? '自定义比例不能作为视频画幅' : '') : '';
    const original = ctx.sources.video.find(v => v.id === candidate.crop?.sourceId);
    const apply = () => {
      const sync = g.ratioDiffers && syncCanvas && !syncBlocked;
      const patches = g.replaced.map(r => {
        const el = g.instances?.find(e => e.id === r.id) || ctx.elements.find(e => e.id === r.id);
        const patch = {...r.patch};
        if (g.ratioDiffers && !sync && el && original && R.fullFrame({...el, ...ctx.elDocs[el.id]}, original, ctx.ratio)) {
          patch.place = R.keepPlace(el.place, g.outRatio, canvas.ratio); patch.pose = {...patch.place}; patch.mode = null;
        }
        return {id: r.id, patch};
      });
      ctx.applyReplacePlan({patches, ratioSync: sync ? ratio : null, message: n === 1 ? '已替换时间轴上的视频' : `已替换时间轴上的视频 · ${n} 段`});
      onClose();
    };
    return <Dialog open title="替换时间轴上的视频" width={560} onClose={onClose}
      footer={<><Btn variant="secondary" onClick={onClose}>取消</Btn><Btn variant="accent" icon="refresh" onClick={apply}>确认替换</Btn></>}>
      <div className="vr-targets">
        <p className="vr-targets__lead">用 <b>{candidate.name}</b> 换掉时间轴上的 <b>{g.name}</b>：{n === g.count ? (n === 1 ? '这一段整段换掉' : `${n} 段一起换，剪口和位置不动`) : `只换处理范围里的 ${n} 段，其余保持原样`}；时间、速度和音量都保留。</p>
        <div className="vr-compare">
          <CompareThumb src={original} sourceStart={g.replaced[0]?.patch.srcStart} label="现在" ratio={ratioOf(original)} />
          <Ic n="chevright" className="ic--16" />
          <CompareThumb src={candidate} sourceStart={g.replaced[0]?.patch.srcStart} label="替换后" ratio={g.outRatio} />
        </div>
        <ul className="vr-targets__list">{g.replaced.map(r => <li key={r.id} className="vr-targets__row">
          <span className="vr-targets__name">{r.name}</span><span className="vr-targets__meta">{T.timecode(r.start)} — {T.timecode(r.end)}</span></li>)}
        {g.outside.map(e => <li key={e.id} className="vr-targets__row is-off">
          <span className="vr-targets__name">{e.asset || e.name}{e.locked ? ' · 已锁定' : ' · 不在处理范围'}</span><span className="vr-targets__meta">{T.timecode(e.start)} — {T.timecode(e.end)} · 保持原样</span></li>)}
        </ul>
        {g.ratioDiffers ? <div className="vr-canvas">
          <b>新素材是 {ratio || `${candidate.naturalW}×${candidate.naturalH}`}，视频画幅是 {ctx.ratio}</b>
          <Checkbox on={syncCanvas && !syncBlocked} disabled={!!syncBlocked} onChange={setSyncCanvas}
            label={syncBlocked ? `同时把视频画幅改为 ${ratio || '新比例'} · ${syncBlocked}` : `同时把视频画幅改为 ${ratio}（之后复核字幕位置）`} />
          <span>{syncCanvas && !syncBlocked ? '整部视频改成新画幅，字幕和元素位置之后复核。' : `不勾就保持 ${ctx.ratio}，新素材按高居中放入，两侧留画布底色。`}</span>
        </div> : null}
        <p className="vr-targets__note">确认后可撤销；原视频素材仍在 Video 里。</p>
      </div>
    </Dialog>;
  }
  Object.assign(window, {VideoReplaceDialog, ReplaceAllDialog});
})();
