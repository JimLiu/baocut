/* 版面编辑器的右栏 —— §14.5（第 112 轮）。
   它与 panel-template-edit.jsx 是两件事：那一页改**这条视频**里的模板实例（章节名、台标
   写什么、进度画法）；这一页改**版面本身**——有哪些层、每层在哪、多大、什么底色。
   打开它时舞台换成 TemplateStudioStage（图层可拖可拉），右栏是这里；「完成」才把草稿
   写回去（项目实例 / 品牌库定义 / 新条目，由 tplStudio.source 决定），返回箭头 = 放弃。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const TPL = window.BC_TPL;

  /* 底色只给三档：深 / 浅 / 无。模板里的 rgba 半透明底是画进画面的内容色，不是 UI 面，
     但也不该让用户在 alpha 里手调——两款内置章节栏用的就是这两档。 */
  const BG = {dark: 'rgba(0,0,0,0.6)', light: 'rgba(255,255,255,0.72)', none: null};
  const bgKey = (v) => (!v ? 'none' : /255,\s*255,\s*255/.test(v) ? 'light' : 'dark');
  const BG_ITEMS = [{k: 'dark', label: '深'}, {k: 'light', label: '浅'}, {k: 'none', label: '无'}];
  const TRACK = {dark: 'rgba(0,0,0,0.35)', light: 'rgba(255,255,255,0.25)', none: null};

  function BgRow({label, value, onPick, autoInk}) {
    return (
      <PRow label={label}>
        <Segmented size="s" value={bgKey(value)} items={BG_ITEMS}
          onChange={(k) => onPick(BG[k], k)} />
      </PRow>
    );
  }

  function ColorRow({label, value, id, pop, setPop, onPick, clearLabel}) {
    return (
      <PRow label={label}>
        <window.ColorField value={value} scope={label} clearLabel={clearLabel}
          open={pop === id} onToggle={() => setPop(pop === id ? null : id)} onPick={onPick} />
      </PRow>
    );
  }

  /* 选中那一层的属性：位置四值人人有；其余按类型 */
  function LayerProps({ctx, l, pop, setPop}) {
    const set = (patch) => ctx.studioLayer(l.id, patch);
    const images = window.brandImages(ctx);
    const m = TPL.KIND_META[l.kind];
    const C = TPL.COLORS;
    const inkFor = (k) => (k === 'light' ? C.INK : C.WHITE);
    return (
      <>
        <SecHead aside={l.on ? null : '已关'} action={
          <Btn variant="secondary" size="s" icon="trash" onClick={() => ctx.studioRemove(l.id)}>删掉这一层</Btn>
        }>{m.label}</SecHead>
        {/* 位置 / 大小走几何段（§14.5）：九宫钉点 + 从钉点量起的数；原先的「左 / 上 / 宽 / 高」
            四行与「整宽 / 贴顶 / 贴底 / 居中」四钮收成一段——贴顶贴底是「钉点选上 / 下 + 贴齐钉点」 */}
        <window.LayerGeometry ctx={ctx} l={l} />

        {l.kind === 'chapters' ? (
          <>
            <SecHead>样子</SecHead>
            <div className="sec">
              <PRow label="进度">
                <Segmented size="s" value={l.fill || 'none'} onChange={(k) => set({fill: k})}
                  items={[{k: 'bar', label: '色条'}, {k: 'dim', label: '明暗'}, {k: 'none', label: '不画'}]} />
              </PRow>
              {l.fill !== 'none' ? (
                <ColorRow label={l.fill === 'dim' ? '播过的底' : '色条'} value={l.accent} id="acc" pop={pop} setPop={setPop}
                  onPick={(v) => set({accent: v})} />
              ) : null}
              <BgRow label="底色" value={l.bg} onPick={(v, k) => set({bg: v, color: inkFor(k), colorDone: k === 'light' ? C.WHITE : null})} />
              <PRow label="分隔线"><div className="push"><Switch on={!!l.divider} onChange={(v) => set({divider: v})} /></div></PRow>
              <window.ValueRow label="字号" value={l.size || 2.6} min={1} max={8} step={0.2} unit="%" onChange={(v) => set({size: v})} />
            </div>
          </>
        ) : null}

        {l.kind === 'progress' ? (
          <>
            <SecHead>样子</SecHead>
            <div className="sec">
              <ColorRow label="颜色" value={l.accent} id="acc" pop={pop} setPop={setPop} onPick={(v) => set({accent: v})} />
              <PRow label="轨道">
                <Segmented size="s" value={bgKey(l.track)} items={BG_ITEMS} onChange={(k) => set({track: TRACK[k]})} />
              </PRow>
            </div>
          </>
        ) : null}

        {l.kind === 'logo' ? (
          <>
            <SecHead>样子</SecHead>
            <div className="sec">
              <PRow label="来源">
                <Segmented size="s" value={l.src === 'text' ? 'text' : 'image'}
                  onChange={(k) => set({src: k === 'text' ? 'text' : (images[0] ? images[0].id : 'text')})}
                  items={[{k: 'text', label: '文字'}, {k: 'image', label: '品牌库图片'}]} />
              </PRow>
              {/* 平铺 + 不透明度（2026-09-14）：做水印类模板就靠这两项 */}
              <PRow label="平铺"><div className="push"><Switch on={!!l.tile} onChange={(v) => set({tile: v})} /></div></PRow>
              <window.ValueRow label="不透明度" value={Math.round(TPL.layerOpacity(l) * 100)} min={5} max={100} step={5} unit="%"
                onChange={(v) => set({opacity: TPL.clampOpacity(v / 100)})} />
              {/* 对齐（2026-09-15）：字 / 图在盒子里靠哪边，底色照旧铺满盒子；平铺时整盒铺满，这一行用不上 */}
              {!l.tile ? (
                <PRow label="对齐">
                  <Segmented size="s" value={TPL.logoAlign(l)} onChange={(k) => set({align: k})}
                    items={[{k: 'left', label: '左'}, {k: 'center', label: '中'}, {k: 'right', label: '右'}]} />
                </PRow>
              ) : null}
              {l.src === 'text' ? (
                <>
                  <PRow label="文字"><Field size="s" value={l.text || ''} onChange={(e) => set({text: e.target.value})} /></PRow>
                  <PRow label="形状">
                    <Segmented size="s" value={l.shape || 'plain'} onChange={(k) => set({shape: k})}
                      items={[{k: 'badge', label: '徽章'}, {k: 'plain', label: '纯文字'}]} />
                  </PRow>
                  <ColorRow label="底色" value={l.bg} id="bg" pop={pop} setPop={setPop} clearLabel="无" onPick={(v) => set({bg: v})} />
                  <ColorRow label="字色" value={l.color} id="fg" pop={pop} setPop={setPop} onPick={(v) => set({color: v})} />
                  <window.ValueRow label="字号" value={l.size || 3} min={1} max={8} step={0.2} unit="%" onChange={(v) => set({size: v})} />
                </>
              ) : (
                <div className="chiprow">
                  {images.length ? images.map((im) => (
                    <Chip key={im.id} pill on={l.src === im.id} icon="image" onClick={() => set({src: im.id})}>{im.name}</Chip>
                  )) : <span className="t-detail-xs">品牌库里还没有图片。</span>}
                </div>
              )}
            </div>
          </>
        ) : null}

        {l.kind === 'text' ? (
          <>
            <SecHead>内容</SecHead>
            <div className="sec">
              <Field size="s" area rows={2} value={l.text || ''} onChange={(e) => set({text: e.target.value})} />
              <div className="chiprow">
                {TPL.VAR_NAMES.map((k) => (
                  <Chip key={k} pill onClick={() => set({text: (l.text || '') + '{' + k + '}'})}>{'{' + k + '}'}</Chip>
                ))}
              </div>
              <div className="t-detail-xs">chapter 当前章节名 · n / count 第几章 / 共几章 · time / remain / total 时间码 · percent 百分比 · title 视频名</div>
            </div>
            <SecHead>样子</SecHead>
            <div className="sec">
              <PRow label="对齐">
                <Segmented size="s" value={l.align || 'left'} onChange={(k) => set({align: k})}
                  items={[{k: 'left', label: '左'}, {k: 'center', label: '中'}, {k: 'right', label: '右'}]} />
              </PRow>
              <ColorRow label="字色" value={l.color} id="fg" pop={pop} setPop={setPop} onPick={(v) => set({color: v})} />
              <ColorRow label="底色" value={l.bg} id="bg" pop={pop} setPop={setPop} clearLabel="无" onPick={(v) => set({bg: v})} />
              <PRow label="等宽数字"><div className="push"><Switch on={!!l.mono} onChange={(v) => set({mono: v})} /></div></PRow>
              <window.ValueRow label="字号" value={l.size || 2.8} min={1} max={8} step={0.2} unit="%" onChange={(v) => set({size: v})} />
            </div>
          </>
        ) : null}
      </>
    );
  }

  function TemplateStudioPanel({ctx}) {
    const s = ctx.tplStudio;
    const [pop, setPop] = useState(null);
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState('');
    if (!s) return null;
    const tpl = s.draft;
    const sel = TPL.layer(tpl, s.sel);
    const title = s.source === 'project' ? '编辑版面' : s.source === 'brand' ? '编辑品牌库模板' : '新模板';
    const doneLabel = s.source === 'project' ? '完成' : s.source === 'brand' ? '保存' : s.source === 'new-brand' ? '存到品牌库' : '套到视频';
    return (
      <div className="pview">
        <div className="panelhd">
          <IconBtn icon="back" size="s" tip="放弃改动并返回" onClick={ctx.studioCancel} />
          <span className="t-title-sm grow">{title}</span>
          <Btn variant="primary" size="s" onClick={ctx.studioDone}>{doneLabel}</Btn>
        </div>
        <div className="pscroll bc-scroll">
          <SecHead first>名字</SecHead>
          <div className="sec">
            <Field size="s" value={tpl.name} onChange={(e) => ctx.studioSet({name: e.target.value})} />
            <PRow label="画幅">
              <Segmented size="s" value={tpl.canvas || '16:9'} onChange={(k) => ctx.studioSet({canvas: k})}
                items={[{k: '16:9', label: '横 16:9'}, {k: '9:16', label: '竖 9:16'}]} />
            </PRow>
            {/* 第 114 轮：可选的「套用时画幅」——不改 ＋ 舞台画幅弹层同一份九档（D.ratios）。
                声明了，套用这套模板就一并把项目画幅改过去（同一步撤销）；不改只叠层。 */}
            <PRow label="套用时画幅">
              <div className="row gap6" style={{flexWrap: 'wrap'}}>
                <Chip pill on={!tpl.ratio} onClick={() => ctx.studioSet({ratio: null})}>不改</Chip>
                {D.ratios.map((r) => {
                  const v = r === 'Original' ? 'original' : r;
                  return (
                    <Chip key={r} pill on={TPL.ratioTarget(tpl) === r} onClick={() => ctx.studioSet({ratio: v})}>
                      {r === 'Original' ? '原始' : r}
                    </Chip>
                  );
                })}
              </div>
            </PRow>
            {/* 画幅锁（第 218 轮）：声明了画幅才有得锁。锁上 = 套用后舞台画幅钮与项目设置都改不了，
                用户在那两处会看到「由模板锁定」与「去模板设置」；解锁在项目里的模板属性页。 */}
            <PRow label="锁定画幅">
              <Switch on={!!tpl.lockRatio && !!TPL.ratioTarget(tpl)} disabled={!TPL.ratioTarget(tpl)}
                onChange={(v) => ctx.studioSet({lockRatio: v})}
                label={TPL.ratioTarget(tpl) ? (tpl.lockRatio ? '套用后不能改画幅' : '套用后仍可改画幅') : '先选一档套用时画幅'} />
            </PRow>
            <div className="signpost">
              {TPL.ratioLocked(tpl)
                ? `锁上后，套了这套模板的视频在舞台与视频设置里都改不了画幅，只能在模板设置里解锁；版面按 ${TPL.ratioLabel(TPL.ratioTarget(tpl))} 排，不会被拉变形。`
                : '可选。套用这套模板时视频画幅一并改成这个值（同一步撤销）；不改就只叠层。要让版面不被改画幅拉变形，再把「锁定画幅」打开。'}
            </div>
          </div>

          <SecHead aside={`${tpl.layers.length} 层 · 上面的盖住下面的`}>图层</SecHead>
          {tpl.layers.length ? tpl.layers.slice().reverse().map((l, ri) => {
            const i = tpl.layers.length - 1 - ri;
            const m = TPL.KIND_META[l.kind];
            return (
              <div key={l.id} className={cx('tplayer', s.sel === l.id && 'is-on', !l.on && 'is-off')}
                onClick={() => ctx.studioSel(l.id)} role="button" tabIndex={0}>
                <Ic n={m.icon} className="ic--16" />
                <span className="tl2"><b>{m.label}</b><span>{m.sub}</span></span>
                <IconBtn icon="layerup" size="s" tip="往上一层" disabled={i === tpl.layers.length - 1}
                  onClick={(e) => { e.stopPropagation(); ctx.studioReorder(l.id, 1); }} />
                <IconBtn icon="layerdown" size="s" tip="往下一层" disabled={i === 0}
                  onClick={(e) => { e.stopPropagation(); ctx.studioReorder(l.id, -1); }} />
                <Switch on={!!l.on} onChange={(v) => ctx.studioLayer(l.id, {on: v})} />
              </div>
            );
          }) : <Empty icon="layers" title="还没有图层">从下面加一层开始。</Empty>}
          <div className="row gap6" style={{marginTop: 8, flexWrap: 'wrap'}}>
            {TPL.KINDS.map((k) => (
              <Btn key={k} variant="secondary" size="s" icon="plus" onClick={() => ctx.studioAdd(k)}>{TPL.KIND_META[k].label}</Btn>
            ))}
          </div>

          {sel ? <LayerProps ctx={ctx} l={sel} pop={pop} setPop={setPop} /> : (
            <div className="signpost">在画面上点一层，或在上面的列表里选一层，这里就能调它。</div>
          )}

          {s.source === 'project' || s.source === 'new-project' ? (
            <>
              <SecHead>品牌库</SecHead>
              {naming ? (
                <div className="row gap6">
                  <Field size="s" value={name} placeholder="给它起个名" autoFocus onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { ctx.studioSaveBrand(name); setNaming(false); }
                      if (e.key === 'Escape') setNaming(false);
                    }} />
                  <Btn variant="primary" size="s" onClick={() => { ctx.studioSaveBrand(name); setNaming(false); }}>存</Btn>
                  <Btn variant="secondary" size="s" onClick={() => setNaming(false)}>取消</Btn>
                </div>
              ) : (
                <Btn variant="secondary" size="s" icon="brand" onClick={() => { setName(tpl.name); setNaming(true); }}>把这套版面存到品牌库</Btn>
              )}
              <div className="signpost">存进去的是版面本身（层、位置、颜色），不带这条视频的章节；别的视频套上它就用自己的章节。</div>
            </>
          ) : null}
        </div>
      </div>
    );
  }

  Object.assign(window, {TemplateStudioPanel});
})();
