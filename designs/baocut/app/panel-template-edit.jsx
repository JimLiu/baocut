/* 模板属性页 —— §14.5（第 112 轮重写）。
   这一页调的是**项目里那一份实例**：章节名、台标写什么 / 用哪张图、进度画成色条还是明暗、
   哪些层开着、字幕要不要避让——都是「这条视频」的事。层的位置与大小不在这里：那是版面，
   改版面走「编辑版面」进 panel-template-studio.jsx（舞台换成可拖的图层）。
   页头与元素属性页同形：返回箭头 ＋ 左对齐标题，移除只在页脚。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const TPL = window.BC_TPL;
  const T = window.BC_TIME;

  /* 章节一行：名字可改（失焦或回车提交，Esc 回弹），点时间码跳过去 */
  function ChapterRow({c, i, cur, ctx}) {
    const [draft, setDraft] = useState(null);
    const commit = () => {
      if (draft === null) return;
      const v = draft.trim();
      setDraft(null);
      if (v && v !== c.title) ctx.renameChapter(c.id, v);
    };
    return (
      <div className={cx('tplchap', cur && 'is-on')}>
        <BCAction className="valin t-mono" title="跳到这一章" onClick={() => ctx.seek(c.start)}>
          {T.timecode(c.start, {decimals: 0})}
        </BCAction>
        <Field size="s" value={draft === null ? c.title : draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); e.target.blur(); }
            if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
          }} />
        {cur ? <Chip tone="accent">当前</Chip> : null}
      </div>
    );
  }

  function TemplateEdit({ctx, onBack}) {
    const app = useApp();
    const tpl = ctx.tplDoc;
    const [pop, setPop] = useState(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    if (!tpl) {
      return (
        <>
          <div className="panelhd">
            <IconBtn icon="back" size="s" tip="返回元素目录" onClick={onBack} />
            <span className="t-title-sm grow">模板</span>
          </div>
          <div className="pscroll bc-scroll"><Empty icon="template" title="这部视频还没套模板">回到目录挑一套，或者自己做一个。</Empty></div>
        </>
      );
    }
    const chapterL = tpl.layers.filter((l) => l.kind === 'chapters');
    const progressL = tpl.layers.filter((l) => l.kind === 'progress');
    const logoL = tpl.layers.filter((l) => l.kind === 'logo');
    const textL = tpl.layers.filter((l) => l.kind === 'text');
    const images = window.brandImages(ctx);
    const cur = window.BC_TL.chapterAt(ctx.chapters, ctx.playT);
    const lift = TPL.subsBottom(tpl, 0);
    const avoid = tpl.subsAvoid !== false;
    const saveBrand = () => {
      ctx.saveTplToBrand(name);
      setNaming(false);
    };
    const from = tpl.from ? (TPL.builtins(app.tplLang).concat(ctx.brandTpls).find((t) => t.id === tpl.from) || null) : null;

    return (
      <>
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="返回元素目录" onClick={onBack} />
          <span className="t-title-sm grow">模板 · {tpl.name}</span>
          <Btn variant="secondary" size="s" icon="edit"
            onClick={() => ctx.openTplStudio({source: 'project', tpl})}>编辑版面</Btn>
        </div>
        <div className="pscroll bc-scroll">
          <SecHead first aside={TPL.summary(tpl)}>版面</SecHead>
          <div className="tplrow tplrow--static">
            <span className="tplth tplth--tpl"><window.TemplateThumb tpl={tpl} h={44} ctx={ctx} /></span>
            <span className="tl2">
              <b>{tpl.name}</b>
              <span>{from ? `来自「${from.name}」· ` : ''}{tpl.brandId ? '已存进品牌库' : '只在这部视频里'}{TPL.ratioNote(tpl) ? ` · ${TPL.ratioNote(tpl)}` : ''}</span>
            </span>
          </div>
          <div className="row gap6" style={{marginTop: 8}}>
            <Btn variant="secondary" size="s" onClick={onBack}>换一套</Btn>
            {naming ? null : (
              <Btn variant="secondary" size="s" icon="brand"
                onClick={() => { setName(tpl.name); setNaming(true); }}>
                {tpl.brandId ? '更新品牌库' : '存到品牌库'}
              </Btn>
            )}
          </div>
          {naming ? (
            <div className="row gap6" style={{marginTop: 8}}>
              <Field size="s" value={name} placeholder="给它起个名" autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveBrand(); if (e.key === 'Escape') setNaming(false); }} />
              <Btn variant="primary" size="s" onClick={saveBrand}>存</Btn>
              <Btn variant="secondary" size="s" onClick={() => setNaming(false)}>取消</Btn>
            </div>
          ) : null}
          <div className="signpost">位置与大小在「编辑版面」里改；这一页改的都是这条视频自己的东西。</div>

          {/* 画幅锁（第 218 轮）：这里是唯一能解锁的地方——舞台画幅钮与项目设置只告诉你「被谁锁了」。
              只在模板声明了画幅时出现；没声明画幅的模板不管画幅。 */}
          {TPL.ratioTarget(tpl) ? (
            <>
              <SecHead aside={TPL.ratioLocked(tpl) ? '已锁定' : '未锁定'}>画幅</SecHead>
              <PRow label={TPL.ratioLabel(TPL.ratioTarget(tpl))}>
                <Switch on={TPL.ratioLocked(tpl)} onChange={(v) => ctx.setRatioLock(v)}
                  label={TPL.ratioLocked(tpl) ? '锁定，不让改' : '可以改'} />
              </PRow>
              <div className="signpost">
                {TPL.ratioLocked(tpl)
                  ? `这套模板的版面按 ${TPL.ratioLabel(TPL.ratioTarget(tpl))} 排，所以把视频画幅锁在这一档；舞台画幅钮与视频设置里都改不了。解锁后可以随意改，模板照旧叠在画面上，只是版面可能被拉变形。`
                  : `视频画幅现在可以随意改。锁上后，舞台画幅钮与视频设置都会锁在 ${TPL.ratioLabel(TPL.ratioTarget(tpl))}，并说明是这套模板锁的。`}
              </div>
            </>
          ) : null}

          {/* 章节是项目的，不是模板的：这里改名，边界在文稿面板里挪 */}
          <SecHead aside={`${ctx.chapters.length} 段`}>章节</SecHead>
          {ctx.chapters.map((c, i) => (
            <ChapterRow key={c.id} c={c} i={i} cur={i === cur} ctx={ctx} />
          ))}
          <div className="signpost">章节是视频的：这里改名字，边界在文稿面板里挪。模板只是把它画出来。</div>

          {chapterL.length ? (
            <>
              <SecHead>章节条</SecHead>
              <div className="sec">
                {chapterL.map((l) => (
                  <React.Fragment key={l.id}>
                    <PRow label="进度">
                      <Segmented size="s" value={l.fill || 'none'} onChange={(k) => ctx.patchLayer(l.id, {fill: k})}
                        items={[{k: 'bar', label: '色条'}, {k: 'dim', label: '明暗'}, {k: 'none', label: '不画'}]} />
                    </PRow>
                    {l.fill !== 'none' ? (
                      <PRow label={l.fill === 'dim' ? '播过的底色' : '色条'}>
                        <window.ColorField value={l.accent} scope="章节条进度"
                          open={pop === l.id + 'a'} onToggle={() => setPop(pop === l.id + 'a' ? null : l.id + 'a')}
                          onPick={(v) => ctx.patchLayer(l.id, {accent: v})} />
                      </PRow>
                    ) : null}
                    <PRow label="分隔线"><div className="push"><Switch on={!!l.divider} onChange={(v) => ctx.patchLayer(l.id, {divider: v})} /></div></PRow>
                  </React.Fragment>
                ))}
              </div>
              <div className="signpost">
                色条 = 一条色线跟着播放头长；明暗 = 播过的段换成深底，分界就是进度。点画面上的段可以跳过去。
              </div>
            </>
          ) : null}

          {progressL.length ? (
            <>
              <SecHead>进度条</SecHead>
              <div className="sec">
                {progressL.map((l) => (
                  <PRow key={l.id} label="颜色">
                    <window.ColorField value={l.accent} scope="进度条"
                      open={pop === l.id} onToggle={() => setPop(pop === l.id ? null : l.id)}
                      onPick={(v) => ctx.patchLayer(l.id, {accent: v})} />
                  </PRow>
                ))}
              </div>
            </>
          ) : null}

          {logoL.length ? (
            <>
              <SecHead>台标</SecHead>
              <div className="sec">
                {logoL.map((l) => (
                  <React.Fragment key={l.id}>
                    <PRow label="来源">
                      <Segmented size="s" value={l.src === 'text' ? 'text' : 'image'}
                        onChange={(k) => ctx.patchLayer(l.id, {src: k === 'text' ? 'text' : (images[0] ? images[0].id : 'text')})}
                        items={[{k: 'text', label: '文字'}, {k: 'image', label: '品牌库图片'}]} />
                    </PRow>
                    {/* 水印并进模板（2026-09-14）：平铺 + 不透明度就是「水印」与「台标」的全部区别 */}
                    <PRow label="平铺"><div className="push"><Switch on={!!l.tile} onChange={(v) => ctx.patchLayer(l.id, {tile: v})} /></div></PRow>
                    <window.ValueRow label="不透明度" value={Math.round(TPL.layerOpacity(l) * 100)} min={5} max={100} step={5} unit="%"
                      onChange={(v) => ctx.patchLayer(l.id, {opacity: TPL.clampOpacity(v / 100)})} />
                    {/* 对齐（2026-09-15）：字 / 图在盒子里靠哪边；与版面编辑器同一行、同一条件，平铺时整盒铺满不出 */}
                    {!l.tile ? (
                      <PRow label="对齐">
                        <Segmented size="s" value={TPL.logoAlign(l)} onChange={(k) => ctx.patchLayer(l.id, {align: k})}
                          items={[{k: 'left', label: '左'}, {k: 'center', label: '中'}, {k: 'right', label: '右'}]} />
                      </PRow>
                    ) : null}
                    {l.src === 'text' ? (
                      <PRow label="文字">
                        <Field size="s" value={l.text || ''} onChange={(e) => ctx.patchLayer(l.id, {text: e.target.value})} />
                      </PRow>
                    ) : (
                      <div className="chiprow">
                        {images.length ? images.map((m) => (
                          <Chip key={m.id} pill on={l.src === m.id} icon="image" onClick={() => ctx.patchLayer(l.id, {src: m.id})}>{m.name}</Chip>
                        )) : <span className="t-detail-xs">品牌库里还没有图片：在画布上选一张图，「···」里存到品牌库。</span>}
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </>
          ) : null}

          {textL.length ? (
            <>
              <SecHead>文字</SecHead>
              <div className="sec">
                {textL.map((l) => (
                  <PRow key={l.id} label={KIND_SHORT(l)}>
                    <Field size="s" value={l.text || ''} onChange={(e) => ctx.patchLayer(l.id, {text: e.target.value})} />
                  </PRow>
                ))}
              </div>
              <div className="signpost">可以写 {'{chapter}'} {'{time}'} {'{total}'} {'{n}'} {'{count}'} 这些变量，播放时按播放头换成真值。</div>
            </>
          ) : null}

          <SecHead aside={`${tpl.layers.filter((l) => l.on).length} / ${tpl.layers.length} 开着`}>图层</SecHead>
          {tpl.layers.map((l) => {
            const m = TPL.KIND_META[l.kind];
            return (
              <BCAction key={l.id} className={cx('tplayer', ctx.tplSel === l.id && 'is-on', !l.on && 'is-off')}
                onClick={() => ctx.pickTpl(l.id)}>
                <Ic n={m.icon} className="ic--16" />
                <span className="tl2"><b>{m.label}</b><span>{layerSub(l)}</span></span>
                <Switch on={!!l.on} onChange={(v) => ctx.patchLayer(l.id, {on: v})} />
              </BCAction>
            );
          })}

          <SecHead>字幕</SecHead>
          <div className="sec">
            <PRow label="自动避让"><div className="push"><Switch on={avoid} onChange={(v) => ctx.patchTemplate({subsAvoid: v})} /></div></PRow>
          </div>
          <div className="signpost">
            {lift ? (avoid ? `底部有整宽的条，字幕底边抬到 ${lift}%，不会被压住。` : '关掉了：字幕按自己的位置画，可能压在条上。')
              : '这套版面底部没有整宽的条，字幕不用让。'}
            字幕自己的字体、颜色与背景仍归字幕面板管。
          </div>

          <BCAction className="danger" onClick={ctx.removeTemplate}><Ic n="trash" className="ic--16" />移除模板</BCAction>
        </div>
      </>
    );
  }

  const KIND_SHORT = (l) => (l.mono ? '计时' : '内容');
  function layerSub(l) {
    if (l.kind === 'chapters') return l.fill === 'dim' ? '明暗分界' : l.fill === 'bar' ? '色条进度' : '只有段名';
    if (l.kind === 'progress') return '跟着播放头长';
    if (l.kind === 'logo') return (l.src === 'text' ? `文字「${l.text}」` : '品牌库图片') + (l.tile ? ' · 平铺' : '') + (TPL.layerOpacity(l) < 1 ? ` · ${Math.round(TPL.layerOpacity(l) * 100)}%` : '');
    return `「${l.text}」`;
  }

  Object.assign(window, {TemplateEdit});
})();
