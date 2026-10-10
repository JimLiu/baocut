/* Home 模板库（product-design §3.2.1；格式与使用语义见 template-spec §1.2、§5）：模板的封面、预览，
   起始页输入框下面的模板网格（HomeTemplateShelf），以及「全部模板」弹窗（类型、来源、分类、搜索、分页、详情）。
   弹窗是左右两栏：左边找，右边看当前这个的预览与提示词。
   两类模板：场景模板选用后挂在输入框上（发送后先确认简报）；作品示例选用即把提示词放进输入框。
   封面是画进视频画面的内容：按模板自己的画幅画，放进统一的 16:10 格子里（竖屏、方形两边留空），一排卡片才对得齐。
   演示里的封面与预览是按 `beats` 画出来的；真模板放它自己渲染的视频。 */
(function () {
  const {useState, useEffect} = React;
  const T = window.BC_HOME_TEMPLATES;
  const P = window.BC_PROMPT_SLOTS;
  const R = window.RSP;
  const {Dialog, Segmented} = window;
  const Labeled = ({label, children}) => <window.BCControlLabel.Provider value={label}>{children}</window.BCControlLabel.Provider>;

  /* 预览「播放」：每隔一会儿换一幕。on 关掉就停在当前这一幕。 */
  function useSlides(on) {
    const [i, setI] = useState(0);
    useEffect(() => {
      if (!on) return undefined;
      const id = setInterval(() => setI(v => v + 1), 1400);
      return () => clearInterval(id);
    }, [on]);
    return i;
  }

  /* size：xs = 输入框里模板 token 的小色块（不写字）；md = 卡片封面（起始页网格与弹窗）；lg = 详情里的预览。
     slide：null = 封面；数字 = 预览播到第几幕。 */
  function HomeTemplateThumb({t, size = 'md', slide = null, children}) {
    const n = t.beats.length;
    const at = slide == null ? null : slide % n;
    return <span className={'home-tpl-thumb home-tpl-thumb--' + size} aria-hidden="true">
      <span className={cx('home-tpl-art', 'home-tpl-art--' + t.tone, 'home-tpl-art--r' + (t.ratio || '16:9').replace(':', '-'))}>
        {size !== 'xs' && <span className="home-tpl-art__kicker">{at == null ? t.kicker : `${at + 1} / ${n}`}</span>}
        <span className={'home-tpl-art__fig home-tpl-art__fig--' + t.fig}><i /><i /><i /><i /></span>
        {size !== 'xs' && <span className="home-tpl-art__word" key={at}>{at == null ? t.title : t.beats[at]}</span>}
        {size !== 'xs' && <span className="home-tpl-art__line" />}
      </span>
      {children}
    </span>;
  }

  /* 作品示例的小标识（场景模板不标）：起始页网格与弹窗的卡片标题旁都用它。 */
  function HomeTemplateKind({t}) {
    return T.isExample(t) ? <span className="home-tpl-kind">示例</span> : null;
  }

  /* 左栏的一张卡：点一下，右栏就换成它的预览与提示词。is-current = 右栏正在看的；is-on = 已经选进输入框的。 */
  function Card({t, current, picked, downloaded, onOpen}) {
    const remote = T.needsDownload(t, downloaded);
    return <button type="button" className={cx('home-tpl__card', current && 'is-current', picked && 'is-on')} aria-label={'查看模板：' + t.title} aria-pressed={current} onClick={onOpen}>
      <HomeTemplateThumb t={t}>
        {picked ? <span className="home-tpl__badge"><Ic n="ok" className="ic--14" />已选</span>
          : remote ? <span className="home-tpl__badge"><Ic n="download" className="ic--14" />{t.size} MB</span> : null}
      </HomeTemplateThumb>
      <span className="home-tpl__title"><span className="home-tpl__name">{t.title}</span><HomeTemplateKind t={t} /></span>
      <span className="home-tpl__meta">{T.meta(t)}</span>
    </button>;
  }

  /* 提示词预览：`{{label}}` 画成与输入框里占位 token 同一外观的标记（template-spec §5.5）。 */
  function SlotText({text}) {
    return P.parse(text).map((x, i) => (x.type === 'slot' ? <span key={i} className="pslot-mark">{x.label}</span> : x.text));
  }

  /* 右栏：正在看的那个模板——预览自动播，下面是介绍、画幅时长、提示词、素材与使用。
     场景模板多一句「先确认简报」的说明、「需要你补充」与「可以这样说」；作品示例的按钮是把提示词放进输入框。 */
  function Detail({t, picked, downloaded, onUse}) {
    const example = T.isExample(t);
    const [playing, setPlaying] = useState(true);
    const slide = useSlides(playing);
    const n = t.beats.length;
    const remote = T.needsDownload(t, downloaded);
    const assets = T.assetList(t);
    const fields = T.slotFields(t);
    const skillLine = T.skillLine(t);
    return <aside className="home-tpl-detail" aria-label={'模板：' + t.title}>
      <div className="home-tpl-detail__scroll bc-scroll">
        <div className="home-tpl-detail__preview">
          <HomeTemplateThumb t={t} size="lg" slide={slide} />
          <div className="home-tpl-detail__ctl">
            <IconBtn icon={playing ? 'pause' : 'play'} size="s" tip={playing ? '暂停预览' : '播放预览'} onClick={() => setPlaying(v => !v)} />
            <span className="home-tpl-detail__track" aria-hidden="true"><span style={{width: ((slide % n) + 1) / n * 100 + '%'}} /></span>
            <span className="home-tpl-detail__time">{T.meta(t)}</span>
          </div>
        </div>
        <h3 className="home-tpl-detail__title">{t.title}</h3>
        <p className="home-tpl-detail__by">{T.byline(t)}</p>
        <p className="home-tpl-detail__sample">{t.description}</p>
        <p className="home-tpl-detail__spec"><Ic n="settings" className="ic--14" />{T.specLine(t)}</p>
        {!example && <p className="home-tpl-detail__brief">{T.BRIEF_NOTE}</p>}
        {skillLine && <p className="home-tpl-detail__spec">{skillLine}</p>}
        {!example && fields.length > 0 && <section aria-label="需要你补充">
          <h4 className="home-tpl-detail__label">需要你补充</h4>
          <ul className="home-tpl-detail__fields">
            {fields.map(f => <li key={f.label}><span className="pslot-mark">{f.label}</span>{f.hint && <span className="home-tpl-detail__hint">{f.hint}</span>}</li>)}
          </ul>
        </section>}
        {!example && t.sample && <section aria-label="可以这样说">
          <h4 className="home-tpl-detail__label">可以这样说</h4>
          <p className="home-tpl-detail__say">{t.sample}</p>
        </section>}
        <section aria-label="提示词">
          <h4 className="home-tpl-detail__label">提示词</h4>
          <pre className="home-tpl-detail__prompt"><SlotText text={T.prompt(t)} /></pre>
        </section>
        <section aria-label="素材">
          <h4 className="home-tpl-detail__label">素材</h4>
          {assets.length > 0 && <div className="home-tpl-detail__assets">
            {assets.map(a => <span key={a.k} className="home-tpl-detail__asset"><Ic n={a.k === 'audio' ? 'audio' : 'image'} className="ic--14" />{a.label} {a.count}</span>)}
            <span className="home-tpl-detail__asset">{t.size} MB</span>
          </div>}
          <p className="home-tpl-detail__state">{T.stateLabel(t, downloaded)}</p>
        </section>
      </div>
      <div className="home-tpl-detail__actions">
        <Btn variant="accent" icon={remote ? 'download' : undefined} onClick={() => onUse(t.k)}>{remote ? '下载并使用' : example ? '使用这条提示词' : picked ? '继续用这个模板' : '使用这个模板'}</Btn>
      </div>
    </aside>;
  }

  /* 左右两栏：左边找（搜索、类型、来源、分类、分页的封面格子），右边看（当前这个的预览与提示词）。
     右栏不空着：没点过就看已选的那个；它不在这一页时看这一页的第一个。 */
  function Library({picked, downloaded, onUse}) {
    const [query, setQuery] = useState('');
    const [kind, setKind] = useState('all');
    const [source, setSource] = useState('all');
    const [category, setCategory] = useState('all');
    const [page, setPage] = useState(1);
    const [open, setOpen] = useState(picked);
    const filter = (patch) => { patch(); setPage(1); };
    const view = T.pageOf(T.find(query, {kind, source, category}), page);
    const detail = T.get(open) || view.items[0] || null;
    return <div className="home-tpl">
      <div className="home-tpl__browse">
        <div className="home-tpl__bar">
          <R.SearchField aria-label="搜索模板" placeholder="搜索模板" value={query} onChange={v => filter(() => setQuery(v))} UNSAFE_className="home-tpl__search" />
          <span className="home-tpl__filters">
          <Labeled label="类型"><Segmented items={T.TYPES} value={kind} onChange={v => filter(() => setKind(v))} /></Labeled>
          <R.Picker aria-label="来源" size="M" UNSAFE_className="home-tpl__source" menuWidth={140} selectedKey={source} onSelectionChange={k => filter(() => setSource(String(k)))}>
            {T.SOURCES.map(o => <R.PickerItem key={o.k} id={o.k} textValue={o.label}>{o.label}</R.PickerItem>)}
          </R.Picker>
          </span>
        </div>
        <div className="home-tpl__cats" role="group" aria-label="分类">
          {T.CATEGORIES.map(c => <R.ToggleButton key={c.k} isQuiet size="S" isSelected={category === c.k} onChange={() => filter(() => setCategory(c.k))}>
            <R.Text>{c.label} {T.find(query, {kind, source, category: c.k}).length}</R.Text>
          </R.ToggleButton>)}
        </div>
        <div className="home-tpl__list bc-scroll">
          {view.total ? <div className="home-tpl__grid" role="list">
            {view.items.map(t => <div key={t.k} role="listitem"><Card t={t} current={!!detail && detail.k === t.k} picked={picked === t.k} downloaded={downloaded} onOpen={() => setOpen(t.k)} /></div>)}
          </div> : <p className="home-tpl__empty">没有找到匹配的模板，换个词或换个分类试试。</p>}
        </div>
        <div className="home-tpl__pager">
          <span className="home-tpl__page" aria-live="polite">第 {view.page} / {view.pages} 页 · 共 {view.total} 个</span>
          <span className="spacer" />
          <R.ActionButton isQuiet size="S" isDisabled={view.page <= 1} onPress={() => setPage(view.page - 1)}>上一页</R.ActionButton>
          <R.ActionButton isQuiet size="S" isDisabled={view.page >= view.pages} onPress={() => setPage(view.page + 1)}>下一页</R.ActionButton>
        </div>
        <p className="home-tpl__note">官方模板随应用提供；社区投稿的模板带素材时，用之前先下载到本机。</p>
      </div>
      {detail ? <Detail key={detail.k} t={detail} picked={picked === detail.k} downloaded={downloaded} onUse={onUse} />
        : <aside className="home-tpl-detail home-tpl-detail--empty"><p className="home-tpl__empty">在左边选一个模板，这里看它的预览与提示词。</p></aside>}
    </div>;
  }

  /* 弹窗关掉再打开，从第一页的列表重新开始（Library 的状态跟着内容一起卸载）。 */
  function HomeTemplateLibrary({open, picked, downloaded, onUse, onClose}) {
    return <Dialog open={open} title="全部模板" width={960} onClose={onClose}>
      <Library picked={picked} downloaded={downloaded} onUse={onUse} />
    </Dialog>;
  }

  /* 起始页的一张模板卡：大封面 + 标题 + 画幅时长。场景模板是开关（点一下挂到输入框，再点取消）；
     作品示例点一下就把提示词放进输入框，没有「选中」这回事（template-spec §5.1、§5.2）。 */
  function ShelfCard({t, picked, downloaded, onScene, onExample}) {
    const example = T.isExample(t);
    const remote = T.needsDownload(t, downloaded);
    return <button type="button" className={cx('home-tpl__card home-shelf__card', picked && 'is-on')} title={t.summary}
      aria-label={(example ? '使用提示词：' : '使用模板：') + t.title} aria-pressed={example ? undefined : picked}
      onClick={() => (example ? onExample(t.k) : onScene(picked ? null : t.k))}>
      <HomeTemplateThumb t={t}>
        {picked ? <span className="home-tpl__badge"><Ic n="ok" className="ic--14" />已选</span>
          : remote ? <span className="home-tpl__badge"><Ic n="download" className="ic--14" />{t.size} MB</span> : null}
      </HomeTemplateThumb>
      <span className="home-tpl__title"><span className="home-tpl__name">{t.title}</span><HomeTemplateKind t={t} /></span>
      <span className="home-tpl__meta">{T.meta(t)}</span>
    </button>;
  }

  /* 起始页输入框下面的模板网格（product-design §3.2.1；template-spec §1.2）：四列两行共八张，最近用过的在前，两类混排；
     其余的在「全部模板」里按类型、分类翻。封面按模板自己的画幅画，和弹窗里的卡片是同一份。 */
  function HomeTemplateShelf({scene, onScene, onExample, shelf, downloaded}) {
    const [library, setLibrary] = useState(false);
    const use = k => { setLibrary(false); if (T.isExample(T.get(k))) onExample(k); else onScene(k); };
    return <><section className="home-shelf" aria-label="视频创作模板">
      <div className="home-shelf__hd">
        <h2 className="home-shelf__title">视频创作模板</h2>
        <span className="spacer" />
        <R.ActionButton isQuiet size="S" onPress={() => setLibrary(true)}><Ic n="grid" className="ic--16" /><R.Text>全部模板</R.Text></R.ActionButton>
      </div>
      <div className="home-shelf__grid" role="list">
        {T.shelf(shelf).map(t => <div key={t.k} role="listitem"><ShelfCard t={t} picked={scene === t.k} downloaded={downloaded} onScene={onScene} onExample={onExample} /></div>)}
      </div>
    </section>
    <HomeTemplateLibrary open={library} picked={scene} downloaded={downloaded} onClose={() => setLibrary(false)} onUse={use} /></>;
  }

  Object.assign(window, {HomeTemplateThumb, HomeTemplateKind, HomeTemplateLibrary, HomeTemplateShelf});
})();
