/* 图片 Tab › 「AI 生成」段（§2.4，2026-09-25）：与「视频素材」同层的另一个视图（S2 Tabs），
   表单是工具页那套压扁的版本，多一颗「跟视频画布」画幅；结果格四个动作：放到画布 / 收进素材库 / 用作参考 / 再来一版。
   记录按项目分（scope = 项目 id），最近 3 批留在这一段里，全部记录在工具 › 生成图片。 */
(function () {
  const {useState, useEffect, useMemo} = React;
  const IM = window.BC_CLOUD_IMAGE;
  const J = window.BC_IMAGE_JOBS;

  function ImageGenPane({ctx, head, onPlace: place}) {
    const app = useApp();
    const engines = useImageEngines(app);
    const scope = (ctx.proj && ctx.proj.id) || 'proj';
    const [f, setF] = useState(() => J.drafts[scope] || Object.assign(IM.blank(IM.preferred(engines, app.cloudImageDefault || (app.prefs.localModelDefaults || {}).image)), {fit: true}));
    const set = (p) => setF((s) => Object.assign({}, s, p));
    useEffect(() => { J.drafts[scope] = f; }, [f, scope]);
    // 「跟视频画布」跟着视频画幅走：换画幅时表单里那颗自动改
    const cap = IM.capabilities(f.model);
    const fitted = IM.fitAspect(ctx.ratio || '16:9', cap.aspects);
    useEffect(() => { if (f.fit && fitted && f.aspect !== fitted) set({aspect: fitted}); }, [fitted, f.fit]);
    const list = useImageRecords(scope);
    const [tried, setTried] = useState(false);
    const [kept, setKept] = useState({});
    const e = IM.engineOf(engines, f.model);
    const status = J.statusOf(f, engines, tried);
    const anyReady = IM.anyReady(engines);
    const sources = ctx.sources.image;

    const generate = () => {
      setTried(true);
      if (status.bad) { app.toast(status.text); return; }
      J.enqueue(app, f, engines, scope);
    };
    const keepOne = (r, img) => {
      if (kept[img.id]) return kept[img.id];
      const src = IM.toSource(r, img, ctx.nextSeq());
      ctx.addSource('image', src);
      setKept((k) => Object.assign({}, k, {[img.id]: src}));
      return src;
    };
    const onKeep = (r, img) => { keepOne(r, img); app.toast('已收进素材库 · 在「视频素材」里带 ✦', 'positive'); };
    const onPlace = (r, img) => { const src = keepOne(r, img); place(src); };
    const onRef = (r, img) => { const src = keepOne(r, img); if (f.refs.indexOf(src.id) < 0 && f.refs.length < cap.refs) set({refs: f.refs.concat([src.id])}); app.toast(`已把 ${img.name} 设为参考图`, 'positive'); };
    const onAgain = (r) => { setF(Object.assign(IM.blank(), r.form, {seed: ''})); app.toast('已带回这一版的设置 · 改一改再生成'); };

    return (
      <>
        {head}
        <div className="pscroll bc-scroll imgen__pane" onKeyDown={(ev) => { if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); generate(); } }}>
          {!anyReady ? (
            <div className="mact">
              <div className="aicard aicard--warn">
                <b>还没有能画图的模型</b>
                <span>连一家 API 提供方（设置 › 模型 › API 提供方）、下载 Qwen-Image-2.1（设置 › 模型 › 图像生成）或在设置 › Agent 打开「用 Codex 画图」，三条路任选其一。</span>
                <div className="row gap8" style={{marginTop: 4}}>
                  <Btn variant="accent" size="s" onClick={() => app.go({r: 'settings', sec: 'cloud', tab: 'image'})}>连接 API 提供方</Btn>
                  <Btn variant="secondary" size="s" icon="download" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'image'})}>下载本地模型</Btn>
                </div>
              </div>
            </div>
          ) : null}
          <div className="mact imgen__form">
            <ImageGenForm f={f} set={set} engines={engines} ctx={ctx} sources={sources} compact />
            <div className="imgen__go">
              <span className={cx('t-detail-xs grow', status.bad && 'ttsw__err')}>{status.text}</span>
              <Btn variant="accent" size="s" icon="image" disabled={!e || !e.ready} onClick={generate}>生成图片</Btn>
            </div>
          </div>
          <div className="mact">
            <div className="ttsw__sechd">
              <span className="t-section grow">最近生成</span>
              {list.length > 3 ? <BCAction className="viewall" onClick={() => app.go({r: 'tools', id: 'image'})}>全部 {list.length} 批…</BCAction> : null}
            </div>
            {list.filter((r) => r.status !== 'canceled').length
              ? <ImageResults list={list} keep={kept} batches={3} onPlace={onPlace} onKeep={onKeep} onRef={onRef} onAgain={onAgain} />
              : <span className="t-detail-xs">这部视频还没生成过图。结果先留在这里，「放到画布」或「收进素材库」才进视频。</span>}
          </div>
          <div className="signpost">
            <b>生成的图先不进视频</b>；放到画布或收进素材库时才拷进 <code>assets/</code>，出处（模型、提示词、种子）随文件一起记，素材库里带 ✦。
          </div>
        </div>
      </>
    );
  }

  /* 项目素材里 ✦ 卡片的「⋯」：查看生成参数 / 再生成一版 */
  function AiSourceMenu({s, onAgain}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const [show, setShow] = useState(false);
    const g = s.gen || {};
    return (
      <span className="imgen__srcmenu" onClick={(ev) => ev.stopPropagation()}>
        <IconBtn icon="more" size="s" tip="更多" onClick={() => setOpen((x) => !x)} />
        <Popover open={open} onClose={() => setOpen(false)} align="right" width={220}>
          <Menu>
            <MenuItem icon="info" label="查看生成参数" onClick={() => { setOpen(false); setShow(true); }} />
            {window.BC_SURFACE.ai && onAgain ? <MenuItem icon="refresh" label="再生成一版" sub="带着这张的提示词与设置到「AI 生成」" wrap onClick={() => { setOpen(false); onAgain(s); }} /> : null}
            <MenuItem icon="copy" label="复制提示词" onClick={() => { setOpen(false); copyToClipboard(g.prompt || ''); app.toast('已复制提示词', 'positive'); }} />
          </Menu>
        </Popover>
        {/* 对话框挂到 body：这个 span 在素材卡的缩略图里，fixed 的 scrim 会被卡片裁掉；portal 之后 React 事件仍沿树冒泡，外层的 stopPropagation 照样拦住卡片的「放到画布」 */}
        {show ? ReactDOM.createPortal(<Dialog open title="生成参数" onClose={() => setShow(false)} footer={<Btn onClick={() => setShow(false)}>关闭</Btn>}>
          <dl className="imgen__params">
            <dt>模型</dt><dd>{g.engineName ? `${g.engineName}${g.modelName ? ` · ${g.modelName}` : ''}` : g.model}</dd>
            <dt>提示词</dt><dd>{g.prompt}</dd>
            {g.negative ? <><dt>不要出现</dt><dd>{g.negative}</dd></> : null}
            <dt>尺寸</dt><dd>{g.size ? g.size.join('×') : g.aspect}{g.quality === '2k' ? ' · 2K' : ''}{g.transparent ? ' · 透明底' : ''}</dd>
            <dt>种子</dt><dd>{g.seed}</dd>
            {g.refs && g.refs.length ? <><dt>参考图</dt><dd>{g.refs.length} 张</dd></> : null}
            {g.steps ? <><dt>步数</dt><dd>{g.steps}</dd></> : null}
            <dt>时间</dt><dd>{g.createdAt || s.meta}</dd>
            <dt>许可</dt><dd>{IM.LICENSE_LABEL[g.license] || g.license || '按服务商条款'}</dd>
          </dl>
        </Dialog>, document.body) : null}
      </span>
    );
  }

  Object.assign(window, {ImageGenPane, AiSourceMenu});
})();
