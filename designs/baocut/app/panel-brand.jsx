/* Brand kit / Agent / 项目设置 —— §13.7、§17.2、§13.9。
   三块共用一个文件：它们都不大，各自拆一个文件反而更难找。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const BS = window.BC_BRAND_STICKERS;
  const S = window.RSP;

  /* ================= Brand kit（§13.7） =================
     模板 / 素材 / 贴纸 / 色 / 字 / 字幕样式。模板**烧进导出画面**，所以它排在最上面；
     「水印」不再是单独一节（2026-09-14）——它是模板的一类，旧水印已导成这里的模板。
     品牌色与品牌字会出现在全 App 的每一个取色面板与字体选择框里——字体选择框
     顶部那个 Brand kits 分区读的就是这一份。 */
  function BrandPanel({ctx}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const [colors, setColors] = useState(D.brand.colors);
    const stillRef = React.useRef(null);
    const dynRef = React.useRef(null);
    const stickers = ctx.brandStickers || [];
    /* 第 241 轮：贴纸拆成两节。分区判据不在这里写，走 `BC_STSRC.isDynamicPage`
       （`BS.split`），因此某一节里的东西恰好等于元素目录对应子页「我的贴纸」里
       的东西——两处永远不会各说各话。 */
    const parts = BS.split(stickers);

    /* 上传一批贴纸。**先读字节再判类型**：用户从别处导出的 Lottie 常叫 `.txt` 或
       `.json` 但里面不是 Lottie，只看扩展名会放进来一份放不出画面的死素材。判据在
       纯层，这里只负责把文本喂给它，并把每一份被拒的理由单独说一次——一次拖十份
       只弹一句「有文件被拒」，用户不知道是哪一份。 */
    const takeFiles = (files) => {
      const list = Array.prototype.slice.call(files || []);
      if (!list.length) return;
      list.forEach((f) => {
        const done = (text) => {
          const taken = BS.takenNames(ctx.brandStickers || []);
          const r = BS.intake(f, text, {src: URL.createObjectURL(f), taken: taken});
          if (!r.ok) { app.toast(f.name + '：' + r.reason, 'negative'); return; }
          ctx.addBrandSticker(r.item);
          /* 回执说的是**真落点**，不是用户点的那个入口。两个入口的 accept 只是把
             系统对话框的候选收窄，判类型仍在字节那一层；从「贴纸」那节传进一份
             Lottie 不该被拒收，但也不该谎称它进了「贴纸」。 */
          app.toast('已加进品牌库 › ' + (BS.isDynamic(r.item) ? '动态贴纸' : '贴纸')
            + '：' + r.item.name, 'positive');
        };
        // Codex Pet 的 zip 要解包再校验，走 pet-sticker.jsx 的异步收件（含回执）
        if (/\.zip$/i.test(f.name)) { window.addPetZip(f, ctx, app); return; }
        // 只有文本型的源需要看字节；位图直接按扩展名收，省一次整文件读取
        if (/\.(json|svg|txt)$/i.test(f.name)) f.text().then(done, () => done(null));
        else done(null);
      });
    };

    return (
      <>
        <window.PanelHead title="品牌">
          <Btn variant="secondary" size="s" icon="upload"
            onClick={() => app.toast('导入品牌包：本轮为骨架')}>导入</Btn>
        </window.PanelHead>
        <div className="pscroll bc-scroll">
          {/* 模板（第 112 轮；2026-09-14 排到最上）：存在这里的是版面定义，跨项目；套用 = 拷一份进项目。
              水印是模板的一类（`tag: 'watermark'`），旧版的水印表已经导成这里的模板（`imported`）——
              模板会烧进导出画面，所以这一节顶在最上，接了原来水印节的位置。 */}
          <window.SecHead first aside={'会烧进导出画面' + (ctx.brandTpls.length ? ` · ${ctx.brandTpls.length} 套` : '')}
            action={<Btn variant="secondary" size="s" icon="plus" onClick={() => ctx.openTplStudio({source: 'new-brand'})}>新建模板</Btn>}>
            模板
          </window.SecHead>
          {ctx.brandTpls.length ? ctx.brandTpls.map((t) => {
            const cur = ctx.tplDoc && ctx.tplDoc.from === t.id;
            return (
              <div className="brow" key={t.id}>
                <span className="bthumb bthumb--tpl"><window.TemplateThumb tpl={t} h={32} ctx={ctx} /></span>
                <b>{t.name}</b>
                <span className="t-detail-xs">{window.BC_TPL.summary(t)}{window.BC_TPL.ratioNote(t) ? ' · ' + window.BC_TPL.ratioNote(t) : ''}</span>
                {window.BC_TPL.isWatermark(t) ? <Chip>{t.imported === 'watermark' ? '由水印导入' : '水印'}</Chip> : null}
                {cur ? <Chip>已套用</Chip> : null}
                <IconBtn icon="more" size="s" tip="更多" onClick={() => setPop(pop === t.id ? null : t.id)} />
                <Popover open={pop === t.id} onClose={() => setPop(null)} align="right" width={200}>
                  <Menu>
                    <MenuItem icon="template" label={cur ? '重新套用到当前视频' : '套用到当前视频'}
                      onClick={() => { setPop(null); ctx.applyTemplate(t); }} />
                    <MenuItem icon="edit" label="编辑版面" onClick={() => { setPop(null); ctx.openTplStudio({source: 'brand', tpl: t, id: t.id}); }} />
                    <MenuItem icon="copy" label="复制一份" onClick={() => { setPop(null); ctx.dupBrandTpl(t.id); }} />
                    <MenuItem icon="trash" label="移出品牌库" tone="negative" onClick={() => { setPop(null); ctx.removeBrandTpl(t.id); }} />
                  </Menu>
                </Popover>
              </div>
            );
          }) : <div className="t-detail-xs" style={{padding: '4px 2px'}}>还没有存过模板。套一套内置的（含三款水印）改好后，在模板属性页「存到品牌库」，或者在这里新建。</div>}
          <div className="signpost">
            改品牌库里的模板不会动已经套用的视频；视频里那份是拷贝，各改各的。
            水印也是模板：在「元素 › 模板」里挑角标 / 平铺 / 社交名那三款，或把任一台标层调成平铺、半透明。
          </div>


          {/* 视频 / 图片两节（第 84.1 轮）。品牌库按素材类别分节，BaoCut 此前缺这两节
              ——于是画布 `···` 上「存到品牌库」在图片与视频上没有落点，被拦了两轮。
              **音频那一节不画**：原型里音频元素没有浮动条，没有把它存进来的入口。 */}
          {[{k: 'video', title: '视频', empty: '还没有存进来的视频'},
            {k: 'image', title: '图片', empty: '还没有存进来的图片'}].map((sec) => {
            const list = D.brand.media.concat(ctx.brandMedia || []).filter((m) => m.kind === sec.k);
            return (
              <React.Fragment key={sec.k}>
                <window.SecHead aside={list.length ? `${list.length} 条` : null}>{sec.title}</window.SecHead>
                {list.length ? list.map((m) => (
                  <div className="brow" key={m.id}>
                    <span className="bthumb" style={m.grad ? {background: m.grad} : null}>
                      <Ic n={m.kind === 'video' ? 'video' : 'image'} className="ic--14" />
                    </span>
                    <b>{m.name}</b>
                    {m.meta ? <span className="t-detail-xs">{m.meta}</span> : null}
                    {m.added ? <Chip>刚存入</Chip> : null}
                    <IconBtn icon="more" size="s" tip="更多"
                      onClick={() => app.toast('放到当前视频 / 重命名 / 移出品牌库：本轮为骨架')} />
                  </div>
                )) : <div className="t-detail-xs" style={{padding: '4px 2px'}}>{sec.empty}</div>}
              </React.Fragment>
            );
          })}
          <div className="signpost">
            在画布上选中一段视频或一张图片，「···」菜单里的「存到品牌库」就存到这里，跨视频可用。
          </div>

          {/* 贴纸两节（第 238 轮起收贴纸，第 241 轮拆成两节）。内置的五个动态分类是
              Google Noto 的 Lottie，可品牌这件事本来就是「换成你自己的」——所以这里既收
              静态的 SVG / 图片，也收会动的 Lottie / GIF / Codex Pet zip，元素目录的贴纸与动态贴纸两个子
              页各多一格「我的贴纸」读对应的那一半。收件规则（白名单、字节优先判类型、
              20 MiB 上限、重名追加）与分区判据都在
              [model-brand-stickers.js](model-brand-stickers.js)，这一层只负责把文件读进来、
              把拒收的理由与真落点说清楚。 */}
          {[
            {key: 'still', title: '贴纸', list: parts.still, ref: stillRef, dynamic: false,
              empty: '还没有上传过贴纸',
              hint: '收 SVG 与图片（PNG / WebP / JPG），单份最大 20 MB。上传后在「元素 › 贴纸」的'
                + '「我的贴纸」里取用；SVG 能分色编辑。'},
            {key: 'dynamic', title: '动态贴纸', list: parts.dynamic, ref: dynRef, dynamic: true,
              empty: '还没有上传过动态贴纸',
              hint: '收 Lottie（.json）、GIF 与 Codex Pet（.zip，pet.json ＋ spritesheet.webp），单份最大 20 MB。'
                + '上传后在「元素 › 动态贴纸」的「我的贴纸」与「Pet › 我的」里取用；Lottie 和 SVG 一样能分色编辑。'},
          ].map((sec) => (
            <React.Fragment key={sec.key}>
              <window.SecHead aside={sec.list.length ? `${sec.list.length} 份` : null}
                action={<S.Button variant="secondary" size="S"
                  onPress={() => sec.ref.current && sec.ref.current.click()}><S.Icons.Upload /><S.Text>上传</S.Text></S.Button>}>
                {sec.title}
              </window.SecHead>
              <input ref={sec.ref} type="file" hidden multiple accept={BS.acceptAttr(sec.dynamic)}
                onChange={(ev) => { takeFiles(ev.target.files); ev.target.value = ''; }} />
              {sec.list.length ? sec.list.map((m) => (
                <div className="brow" key={m.id}>
                  <span className="bthumb">
                    {window.BC_STSRC.isPet(m) ? <window.PetSprite src={m.src} version={(m.pet || {}).version} />
                      : window.BC_STSRC.isLottie(m) ? <window.LottieSticker src={m.src} />
                        : <img src={m.src} alt="" draggable="false" />}
                  </span>
                  <b>{m.name}</b>
                  <span className="t-detail-xs">{BS.sizeText(m.size)}</span>
                  <Chip>{window.BC_STSRC.label(m)}</Chip>
                  <IconBtn icon="trash" size="s" tip="移出品牌库"
                    onClick={() => { ctx.removeBrandSticker(m.id); app.toast('已移出品牌库'); }} />
                </div>
              )) : <div className="t-detail-xs" style={{padding: '4px 2px'}}>{sec.empty}</div>}
              <div className="signpost">{sec.hint}</div>
            </React.Fragment>
          ))}

          <window.SecHead>品牌色</window.SecHead>
          <div className="bsw">
            {colors.map((c) => (
              /* @ds-allow: 品牌色是用户自己选的导出画面颜色，不是 S2 表面 */
              <i key={c} style={{background: c}} />
            ))}
            <BCAction className="bthumb" style={{width: '100%', height: 'auto', aspectRatio: 1, borderRadius: 6}}
              onClick={() => setColors((v) => v.concat([D.brand.addDefault]))}>
              <Ic n="plus" className="ic--14" />
            </BCAction>
          </div>
          <div className="signpost">品牌色会出现在全 App 的每一个取色面板里。</div>

          <window.SecHead>品牌字体</window.SecHead>
          {D.brand.fonts.map((f) => (
            <div className="brow" key={f.name}>
              <span className="bthumb" style={{fontFamily: f.stack}}>Aa</span>
              <b style={{fontFamily: f.stack}}>{f.name}</b>
              <span className="t-detail-xs">{f.use}</span>
            </div>
          ))}
          <Btn variant="secondary" size="s" style={{marginTop: 8}}
            onClick={() => app.toast('添加字体：本轮为骨架')}>添加字体…</Btn>
          <div className="signpost">这几款会出现在全 App 的字体选择框顶部。</div>

          <window.SecHead>字幕样式</window.SecHead>
          <div className="abcgrid">
            {D.brand.subStyles.map((s) => (
              <BCAction key={s.id} className="abc"
                /* @ds-allow: 样本格画的是导出画面里的字幕样子 */
                style={{background: 'linear-gradient(135deg, #3B4252, #1F2430)'}}
                onClick={() => app.toast(`已把「${s.name}」设为当前字幕样式`, 'positive')}>
                <span style={{fontSize: 15, ...s.st}}>Aa</span>
              </BCAction>
            ))}
          </div>
          <div className="signpost">在字幕面板里「存为样式」，就会出现在这里，跨视频共用。</div>
        </div>
      </>
    );
  }

  /* Agent 面板于第 109 轮退场：Agent 升到左侧主入口（侧栏「会话」＋ Agent 页 ＋
     编辑器左抽屉，见 agent-thread.jsx / page-agent.jsx），右侧 rail 收成 11 项。 */

  /* ================= 项目设置（§13.9） =================
     只画**有落盘通道**的行：画幅走 setCanvas（可撤销、跨会话，与 bcut project undo
     同一个栈），画布填充与主画面检查器共用同一份控件。
     导出默认值那一段整段不画——没有 per-project 的持久化字段，画了就是撒谎。 */
  function ProjectSettingsPanel({ctx}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    /* 画布背景三档（G11a）：模糊 / 黑 / 颜色，写 `main.background`（blur | black | #RRGGBB）。
       此前这里是一格没接线的自由色板；选「颜色」才露出取色，色值记住上一次挑的。 */
    const KF = window.BC_KF;
    const bgNow = KF.bgMode(ctx.mainBg);
    const [lastColor, setLastColor] = useState(bgNow.color || '#FFFFFF');
    const CHIPS = ['16:9', '9:16', '1:1', '4:3'];

    return (
      <>
        <window.PanelHead title="视频属性" />
        <div className="pscroll bc-scroll">
          <window.SecHead first aside={ctx.ratioLock ? '模板锁定' : null}>画幅</window.SecHead>
          {/* 画幅锁（第 218 轮）：锁着时 chips 全灰、只留锁定那一档亮着；下面那句说清是谁锁的、去哪解 */}
          <div className="row gap6" style={{flexWrap: 'wrap'}}>
            {CHIPS.map((r) => (
              <Chip key={r} pill on={ctx.ratio === r} disabled={!!ctx.ratioLock && r !== ctx.ratioLock.ratio}
                onClick={() => ctx.setRatio(r)}>{r}</Chip>
            ))}
            {CHIPS.indexOf(ctx.ratio) < 0
              ? <Chip pill on>{ctx.ratio}</Chip>
              : null}
          </div>
          {ctx.ratioLock ? (
            <div className="signpost signpost--lock">
              <Ic n="lock" className="ic--14" />
              <span className="grow">{ctx.ratioLock.note}。要改，先去模板设置里解锁。</span>
              <Btn size="s" variant="secondary" onClick={ctx.openTplProps}>去模板设置</Btn>
            </div>
          ) : <div className="signpost">在这里改，舞台画幅一起变；可撤销。</div>}

          <window.SecHead aside="主画面没铺满画幅时露出的底">画布背景</window.SecHead>
          <window.PRow label="">
            <Segmented size="s" value={bgNow.mode}
              onChange={(m) => ctx.setMainBg && ctx.setMainBg(KF.bgValue(m, lastColor))}
              items={[{k: 'blur', label: '模糊'}, {k: 'black', label: '黑'}, {k: 'color', label: '颜色'}]} />
          </window.PRow>
          {bgNow.mode === 'color' ? (
            <window.PRow label="颜色">
              <window.ColorField value={bgNow.color} scope="画布背景" allowsAlpha={false}
                onPick={(c) => {
                  /* 字段只接受 #RRGGBB：带透明度的取色去掉 alpha（底色没有透明），「无颜色」忽略 */
                  const n = c ? window.BC_COLOR.normHex(c) : null;
                  const hex = n ? n.toUpperCase() : null;
                  if (hex) { setLastColor(hex); ctx.setMainBg && ctx.setMainBg(hex); }
                }}
                open={pop === 'bg'} onToggle={() => setPop(pop === 'bg' ? null : 'bg')} />
            </window.PRow>
          ) : null}
          <div className="signpost">{bgNow.mode === 'blur'
            ? '模糊 = 主画面放大虚化铺底（缺省）。'
            : bgNow.mode === 'black' ? '黑 = 纯黑铺底。' : '颜色 = 用这一色铺底。'}</div>
          <window.SecHead>时长</window.SecHead>
          <window.PRow label="">
            <Segmented size="s" value="auto" onChange={() => app.toast('固定时长：核心暂无这个字段')}
              items={[{k: 'auto', label: '自动'}, {k: 'fixed', label: '固定'}]} />
            <span className="valin" style={{opacity: 0.5, width: 72}}>{T.timecode(D.DUR)}</span>
          </window.PRow>
          <div className="signpost">自动 = 跟着最后一个元素走（只读）。</div>

          <div style={{marginTop: 16}}>
            <Todo title="刻意不画：导出默认值">
              画质 / 分辨率 / 烧录字幕 / 烧录译文四行**不在这一栏**。它们没有 per-movie 的
              落盘字段，画在视频设置里等于承诺一个记不住的选择；真正的出口是导出对话框，
              每次导出当场选。
            </Todo>
          </div>
        </div>
      </>
    );
  }

  Object.assign(window, {BrandPanel, ProjectSettingsPanel});
})();
