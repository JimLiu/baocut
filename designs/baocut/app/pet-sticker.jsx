/* Codex Pet 贴纸（第 242 轮）：播放盒、目录格、Pet 分类页、zip 收件。

   Codex Pet 是一张 8 列雪碧图（格子 192×208，v1 九行 / v2 十一行，每行一种状态，
   逐帧时长表在 [model-pet.js](model-pet.js)）。没有现成的播放库，也不需要：一枚
   `<i>` 拿雪碧图当 `background-image`，按 `BC_PET.frameAt` 算出的格子改
   `background-position`，就是逐格步进。三件与 Lottie 播放盒对齐的事：

   1. **磁贴不自己跑**。官方 9 只 ＋ 品牌库里的全摆出来就是十几条 rAF；磁贴停在待机
      第 0 帧（这也是 awesome-codex-pet 的缩略图定义），悬停才播。
   2. **画布跟播放头**。`time` 给了就按「播放头 − 起点」取帧，拖播放头 / 暂停 / 逐帧
      看到的都是同一帧；导出端按同一张时长表算，帧才对得上。
   3. **社区 pet 不预载雪碧图**。239 只里翻分类看的是 codexpet.top 预渲染的静态缩略图
      （悬停换成那一只 `idle.webp` 动图，`<img>` 原生就放），点「加」才把 raw 雪碧图
      的 URL 写进元素——一张雪碧图 1–2 MB，翻目录时全拉下来是几百 MB。

   zip 收件（`intakePetZip`）在这一层：JSZip 解包是浏览器的事，纯层 `BC_PET.pickEntries`
   / `parsePetJson` / `checkSheet` 只做挑文件与校验；解出来的雪碧图变成 `blob:` 源，
   按 `kind:'pet'` 进品牌库（与 Lottie / GIF 一样归「动态贴纸」那一节），`pet` 元数据
   袋跟着记录走。 */
(function () {
  const PET = window.BC_PET;
  const CAT = window.BC_PETCAT;

  /* ---------- 播放盒 ---------- */

  /** 雪碧图播放盒。
      - `time`（秒）给了：跟播放头，停在那一格（画布）。
      - 没给：`play` 为真就按时长表循环，为假停在第 0 格（目录磁贴）。 */
  function PetSprite({src, version, state, play, time, className, style}) {
    const v = version === 2 ? 2 : 1;
    const key = state || PET.DEFAULT_STATE;
    const [ms, setMs] = React.useState(0);
    const raf = React.useRef(0);
    React.useEffect(() => {
      if (time != null || !play) { cancelAnimationFrame(raf.current); raf.current = 0; setMs(0); return undefined; }
      const t0 = performance.now();
      const step = (now) => { setMs(now - t0); raf.current = requestAnimationFrame(step); };
      raf.current = requestAnimationFrame(step);
      return () => { cancelAnimationFrame(raf.current); raf.current = 0; };
    }, [play, time == null]);
    const at = time != null ? (Number(time) || 0) * 1000 : ms;
    const f = PET.frameAt(key, at, v);
    const bg = PET.bgStyle(f.col, f.row, v);
    return (
      <i className={cx('petbox', className)} aria-hidden="true"
        style={Object.assign({backgroundImage: 'url("' + src + '")'}, bg, style || {})} />
    );
  }

  /* ---------- 目录格 ---------- */

  /** 随包 / 品牌库那种手上有雪碧图的格子：停在第 0 格，悬停按时长表播。 */
  function PetTile({src, version, name, sub, onAdd}) {
    const [hover, setHover] = React.useState(false);
    const tip = sub ? name + ' · ' + sub : name;
    return (
      <div className="pettile">
        <BCAction className="stile stile--pet" onClick={onAdd} title={tip} aria-label={tip}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          <PetSprite src={src} version={version} play={hover} />
        </BCAction>
        <span className="petcap"><b>{name}</b>{sub ? <small>{sub}</small> : null}</span>
      </div>
    );
  }

  /** 社区格：静态缩略图，悬停换那一只的 `idle.webp` 动图；署名（作者 · 许可）写在格下。 */
  function PetRemoteTile({pet, onAdd}) {
    const [hover, setHover] = React.useState(false);
    const [dead, setDead] = React.useState(false);
    const name = PET.displayName(pet);
    const credit = PET.attribution(pet);
    const tip = name + (credit ? ' · ' + credit : '');
    return (
      <div className="pettile">
        <BCAction className="stile stile--pet" onClick={onAdd} title={tip} aria-label={tip}
          onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
          onFocus={() => setHover(true)} onBlur={() => setHover(false)}>
          {dead ? <Ic n="image" className="ic--20 petdead" />
            : <img src={hover ? PET.previewUrl(pet.slug) : PET.thumbUrl(pet.slug)} alt=""
                draggable="false" loading="lazy" onError={() => setDead(true)} />}
        </BCAction>
        <span className="petcap">
          <b>{name}</b>
          <small className={PET.nonCommercial(pet.license) ? 'is-nc' : null}>{credit}</small>
        </span>
      </div>
    );
  }

  /* ---------- zip 收件 ---------- */

  /** 量一张 `blob:` 图的像素尺寸。 */
  function imageSize(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve({w: im.naturalWidth, h: im.naturalHeight});
      im.onerror = () => reject(new Error('decode'));
      im.src = src;
    });
  }

  /** 解一份 Pet zip → 可进 `ctx.brandStickers` 的记录，或拒收理由。
      步骤：JSZip 解包 → 挑 `pet.json` 与雪碧图 → 校验 json → 雪碧图转 `blob:` →
      量尺寸对版本 → 走 `BC_BRAND_STICKERS.intake` 拿 id / 重名规则，再把 `pet`
      元数据袋与展示名（`displayName`，不是 zip 文件名）补上。 */
  async function intakePetZip(file, taken) {
    const BS = window.BC_BRAND_STICKERS;
    if (!window.JSZip) return {ok: false, reason: '解 zip 的组件还没加载好，稍后再试'};
    if (Number(file.size) > BS.MAX_BYTES) return {ok: false, reason: BS.REASONS.size};
    let zip;
    try { zip = await window.JSZip.loadAsync(file); }
    catch (e) { return {ok: false, reason: '这份 .zip 打不开'}; }
    const names = Object.keys(zip.files);
    let pick = PET.pickEntries(names);
    if (!pick.ok) return pick;
    const meta = PET.parsePetJson(await zip.file(pick.json).async('string'));
    if (!meta.ok) return meta;
    pick = PET.pickEntries(names, meta.sheetPath);
    if (!pick.ok) return pick;
    const raw = await zip.file(pick.sheet).async('blob');
    const sheet = new Blob([raw], {type: 'image/webp'});
    const src = URL.createObjectURL(sheet);
    let size;
    try { size = await imageSize(src); }
    catch (e) { URL.revokeObjectURL(src); return {ok: false, reason: '雪碧图解不出来（要 WebP）'}; }
    if (!PET.checkSheet(meta.version, size.w, size.h)) {
      URL.revokeObjectURL(src);
      return {ok: false, reason: PET.REASONS.size};
    }
    const r = BS.intake({name: meta.name + '.zip', size: sheet.size}, null, {src: src, taken: taken});
    if (!r.ok) { URL.revokeObjectURL(src); return r; }
    r.item.pet = PET.meta({version: meta.version, name: meta.name, author: '', license: ''},
      {description: meta.description});
    return r;
  }

  /** 收一份 zip 进品牌库并给回执（Pet 页与品牌库两个入口共用）。 */
  function addPetZip(file, ctx, app) {
    const taken = window.BC_BRAND_STICKERS.takenNames(ctx.brandStickers || []);
    return intakePetZip(file, taken).then((r) => {
      if (!r.ok) { app.toast(file.name + '：' + r.reason, 'negative'); return r; }
      ctx.addBrandSticker(r.item);
      app.toast('已加进品牌库 › 动态贴纸：' + r.item.name, 'positive');
      return r;
    });
  }

  /** 隐藏的 `<input type=file accept=.zip>` ＋ 一颗按钮。 */
  function PetUpload({ctx, size, children}) {
    const app = useApp();
    const ref = React.useRef(null);
    const take = (files) => { Array.prototype.slice.call(files || []).forEach((f) => addPetZip(f, ctx, app)); };
    return (
      <>
        <input ref={ref} type="file" hidden multiple accept=".zip"
          onChange={(ev) => { take(ev.target.files); ev.target.value = ''; }} />
        <Btn variant="secondary" size={size || 's'} icon="upload"
          onClick={() => ref.current && ref.current.click()}>{children || '上传 Pet zip'}</Btn>
      </>
    );
  }

  /* ---------- Pet 分类页 ---------- */

  const SUBS = [{k: 'official', label: '官方'}, {k: 'community', label: '社区'}, {k: 'mine', label: '我的'}];

  /** 官方那 9 只的网格（随包，`assets/pets/official/`）。 */
  function OfficialGrid({list, onAdd}) {
    return (
      <div className="stgrid stgrid--anim">
        {list.map((o) => (
          <PetTile key={o.id} src={o.src} version={o.version} name={o.name} sub={'v' + o.version}
            onAdd={() => onAdd('sticker', {id: 'pet-' + o.id, src: o.src, kind: 'pet', alt: o.name,
              pet: PET.meta({version: o.version, name: o.name, author: 'OpenAI', license: ''})})} />
        ))}
      </div>
    );
  }

  /** 品牌库里 `kind:'pet'` 的那几只。 */
  function MineGrid({ctx, onAdd}) {
    const B = window.BC_BRAND_STICKERS;
    const list = B.mru((ctx.brandStickers || []).filter((m) => m.kind === 'pet'));
    if (!list.length) {
      return (
        <Empty icon="upload" title="还没有你自己的 Pet">
          上传一份 Pet zip（里面是 pet.json ＋ spritesheet.webp），它会存进品牌库 › 动态贴纸，跨视频可用。
        </Empty>
      );
    }
    return (
      <div className="stgrid stgrid--anim">
        {list.map((m) => (
          <PetTile key={m.id} src={m.src} version={(m.pet || {}).version} name={m.name}
            sub={'v' + ((m.pet || {}).version || 1)}
            onAdd={() => {
              if (ctx.touchBrandSticker) ctx.touchBrandSticker(m.id);
              onAdd('sticker', {id: m.id, src: m.src, kind: 'pet', alt: m.name, pet: m.pet});
            }} />
        ))}
      </div>
    );
  }

  /** 社区 239 只：分类 chip ＋ 网格。点「加」写的是 raw 雪碧图 URL，署名进 `pet` 袋。 */
  function CommunityGrid({q, onAdd}) {
    const [cat, setCat] = React.useState('all');
    const pets = React.useMemo(() => PET.search(PET.byCategory(CAT.PETS, cat), q), [cat, q]);
    return (
      <>
        <div className="chiprow chiprow--sub">
          <Chip pill on={cat === 'all'} onClick={() => setCat('all')}>全部 {CAT.PETS.length}</Chip>
          {CAT.CATS.map((c) => (
            <Chip key={c.slug} pill on={cat === c.slug} onClick={() => setCat(c.slug)}>{c.zh} {c.count}</Chip>
          ))}
        </div>
        {pets.length ? (
          <div className="stgrid stgrid--anim">
            {pets.map((p) => (
              <PetRemoteTile key={p.slug} pet={p}
                onAdd={() => onAdd('sticker', {id: 'pet-' + p.slug, src: PET.sheetUrl(p.slug), kind: 'pet',
                  alt: PET.displayName(p), pet: PET.meta(p, {slug: p.slug})})} />
            ))}
          </div>
        ) : <Empty icon="search" title="没有匹配的 Pet">换个词，或者换一个分类</Empty>}
        <div className="signpost">
          社区 Pet 来自 awesome-codex-pet，各按作者自报的许可使用（多为 CC BY-NC 4.0，
          标橙的是<b>仅限非商用</b>）；署名跟着元素一起存，导出时能报出来。缩略图与雪碧图
          按需从站点取，不随包。
        </div>
      </>
    );
  }

  /** 动态贴纸 › Pet 子页。三段：官方（随包 9 只）/ 社区（按 11 类浏览）/ 我的（品牌库）。 */
  function PetSection({ctx, q, onAdd}) {
    const [sub, setSub] = React.useState('official');
    const official = React.useMemo(() => PET.search(CAT.OFFICIAL, q), [q]);
    const mine = (ctx.brandStickers || []).filter((m) => m.kind === 'pet').length;
    const count = {official: CAT.OFFICIAL.length, community: CAT.PETS.length, mine: mine};
    return (
      <>
        <div className="packhead">
          <b>Codex Pet</b>
          <span className="t-detail-xs">8 列雪碧图 · 待机循环 · 跟播放头</span>
          <PetUpload ctx={ctx} />
        </div>
        <div className="chiprow chiprow--sub">
          {SUBS.map((s) => (
            <Chip key={s.k} pill on={sub === s.k} onClick={() => setSub(s.k)}>{s.label} {count[s.k]}</Chip>
          ))}
        </div>
        {sub === 'official' ? (official.length
          ? <OfficialGrid list={official} onAdd={onAdd} />
          : <Empty icon="search" title="没有匹配的 Pet">换个词，或者到「社区」里找</Empty>) : null}
        {sub === 'community' ? <CommunityGrid q={q} onAdd={onAdd} /> : null}
        {sub === 'mine' ? <MineGrid ctx={ctx} onAdd={onAdd} /> : null}
        <div className="hint">
          Codex Pet 是 Codex 桌面端桌宠的格式：一份 pet.json ＋ 一张 WebP 雪碧图（8 列 ×
          192×208，v1 九行 / v2 十一行），每行一种状态、逐帧时长各不相同。落到画布上先放
          待机那一行，帧号由播放头决定。官方 9 只随包；社区 239 只按 11 类浏览，点一格
          才取那一只的雪碧图。
        </div>
      </>
    );
  }

  /** 「全部」页里那一小段：官方前 6 只 ＋「查看全部」切到 Pet chip。 */
  function PetPeek({ctx, onAdd, onMore}) {
    return (
      <>
        <div className="packhead">
          <b>Codex Pet</b>
          <span className="t-detail-xs">官方 {CAT.OFFICIAL.length} · 社区 {CAT.PETS.length}</span>
          {onMore ? <BCAction className="viewall" onClick={() => onMore('pet')}>查看全部<NavChevron /></BCAction> : null}
        </div>
        <OfficialGrid list={CAT.OFFICIAL.slice(0, 6)} onAdd={onAdd} />
      </>
    );
  }

  /* ---------- 画布 ---------- */

  /** 舞台上的 Pet：外盒（不透明度 / 圆角 / 调整层）与 Lottie、位图两支同口径，
      帧号由 `time`（播放头 − 起点）给；状态与版本从元素样式袋的 `pet` 里读。 */
  function PetStage({st, src, k, fillH, time}) {
    const pet = st.pet || {};
    return (
      <span className="fxwrap" style={{display: 'block',
        height: fillH ? '100%' : null,
        borderRadius: window.BC_EL.radiusCss(st, k) || null,
        opacity: (st.opacity == null ? 100 : st.opacity) / 100}}>
        <PetSprite src={src} version={pet.version} state={pet.state} time={time} className="petbox--stage"
          style={{height: fillH ? '100%' : null, filter: window.BC_EL.fxCss(st) || null}} />
        {window.BC_EL.fxLayers(st).map((l) => (
          <i key={l.k} className="fxlayer" style={{opacity: l.opacity,
            background: l.background, backgroundSize: l.backgroundSize}} />
        ))}
      </span>
    );
  }

  Object.assign(window, {PetSprite, PetTile, PetRemoteTile, PetSection, PetPeek, PetUpload, PetStage,
    intakePetZip, addPetZip});
})();
