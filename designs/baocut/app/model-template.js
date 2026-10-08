/* 模板文档 —— §14.5（第 112 轮；2026-09-14 水印并入模板、内置目录跟随界面语言）。
   模板 = 叠在视频画面上的一组**图层**：章节条 / 进度 / 台标 / 文字。每一层有自己的
   盒子（百分比坐标，左上角原点）与这一类自己的参数；模板本身只认画幅比。
   两个身份：**定义**住在内置目录（`builtins(lang)`）与品牌库里；**实例**住在项目里
   （`instance()` 深拷贝一份，之后改属性、改版面都只动这一份，品牌库那份不跟着变）。
   章节段的文字与边界不在模板里——那是项目的章节表，模板只决定怎么画它。
   第 218 轮加**画幅锁**：模板声明了「套用时画幅」（`ratio`）再把 `lockRatio` 打开，套着它的
   项目就不能改画幅——舞台画幅钮、项目设置的画幅 chips 都读 `ratioLock()` 这一份判据，
   并把「为什么改不了」写在脸上；解锁只在模板属性页（那是模板的设置，不是画幅的）。
   2026-09-14：**没有「水印」这个格式了**。水印从来就是一层台标（文字或品牌库图片、平铺或
   钉在一角、半透明），所以它并进模板：内置目录多三款 `tag: 'watermark'` 的模板，旧版
   Brand kit 的水印表由 `importWatermarks()` 一次性导成品牌库模板（`imported: 'watermark'`）。
   台标层为此多两个参数：`tile`（铺满盒子）与 `opacity`（0–1，缺省 1）。
   2026-09-15：台标层再加 `align`（`left` / `center` / `right`，缺省居中）——文字台标的字、品牌库
   图片台标的图在盒子里靠哪边；底色照旧铺满整个盒子，平铺时用不上。
   同日文字层与台标层都加 `pad`：字离盒子左右边的内边距，单位同 `size`（画面高的百分比）。
   缺省时内边距按各自字号推（文字 0.5em、徽章 0.6em、无底 0），字号不同的几层字就起笔不齐；
   要从同一条竖线起笔，就让盒子左缘相同、再给同一个 `pad`（`layerPad`）。只管字，图片台标与平铺不看它。
   内置模板的名字 / 说明 / 示例文字跟随设置 › 界面语言（`langOf` → `builtins(lang)`）；
   界面 chrome 本身仍是中文（原型没有 i18n 层），跟着语言走的是**画进画面的内容**。

   颜色是画进视频画面的内容色，不是 S2 表面（登记在 _ds_conformance.json 的本文件作用域）。 */
(function () {
  const KINDS = ['chapters', 'progress', 'logo', 'text'];
  const KIND_META = {
    chapters: {label: '章节条', icon: 'list',     sub: '段名 · 分隔 · 当前段与进度', strip: true},
    progress: {label: '进度条', icon: 'speed',    sub: '一条色条，跟着播放头长', strip: true},
    logo:     {label: '台标',   icon: 'brand',    sub: '一段文字或品牌库里的图；可平铺、可半透明', strip: false},
    text:     {label: '文字',   icon: 'text',     sub: '可写 {chapter} {time} 这类变量', strip: false},
  };
  const WHITE = '#FFFFFF';
  const INK = '#131313';
  const ORANGE = '#FF7A1A';
  const RED = '#C0392B';
  const BLUE = '#3B63FB';
  const YELLOW = '#FFE14D';
  const PINK = '#FF4D7A';    // 小红书风格的玫红（不是任何平台的品牌色值）
  const TEAL = '#1FB6C9';    // B 站风格的青（同上）
  const MIST = '#D9D9D9';    // 深色标题卡上次一级文字的浅灰（竖屏切片的章节名行）
  const VPAD = 1.2;          // 竖屏切片四层字共用的左右内边距（画面高的 %，与 Rust `VERTICAL_PAD` 同值）

  /* ---------- 语言 ----------
     设置 › 界面语言那一份中文标签（'跟随系统' / '简体中文' / 'English' …）经 `langOf` 折成
     这里的词表键；没有词表的语言退到英文（国际用户至少拿到英文示例，不再是一屏中文）。
     「跟随系统」读 navigator.language（浏览器与新版 node 都有）；没有 navigator 时按简体中文。 */
  const LANG_FALLBACK = 'en';
  const LANG_BY_LABEL = {'简体中文': 'zh', '繁體中文': 'zh-Hant', 'English': 'en', '日本語': 'ja'};
  function systemLang(tag) {
    const t = String(tag || '').toLowerCase();
    if (/^zh(-|$)/.test(t)) return /hant|-tw|-hk|-mo/.test(t) ? 'zh-Hant' : 'zh';
    if (/^ja(-|$)/.test(t)) return 'ja';
    return LANG_FALLBACK;
  }
  function langOf(label) {
    if (label && LANG_BY_LABEL[label]) return LANG_BY_LABEL[label];
    if (label && label !== '跟随系统') return LANG_FALLBACK;
    const nav = typeof navigator !== 'undefined' && navigator && navigator.language;
    return nav ? systemLang(nav) : 'zh';
  }
  const LANGS = ['zh', 'zh-Hant', 'en', 'ja'];

  /* 词表：`brand` 台标名、`handle` 社交名、`speaker` 讲者名、`ep` 集数徽章、`talk` 讲座前缀；
     每一款内置模板一条 [名字, 说明]。演示品牌「科浪」不是真实品牌。 */
  const STR = {
    zh: {
      brand: '科浪访谈', handle: '@kelang.studio', speaker: '林深', ep: '第 {n} 集', talk: 'TALK',
      tags: '#干货 #科普', subscribe: '订阅', save: '记得收藏', part: 'P{n}',
      groups: {chapters: '章节与进度', info: '信息条', vertical: '竖屏', douyin: '抖音', xhs: '小红书', youtube: 'YouTube', bili: 'B 站', watermark: '水印', brand: '品牌库'},
      'tpl-chapter-bar': ['章节底栏 · 色条', '底部章节名一字排开，播过的部分被一条色条填满；台标在左下角'],
      'tpl-chapter-dim': ['章节底栏 · 明暗', '播过的章节段是深底，没播的是浅底，进度就是这条明暗分界；台标在右上角'],
      'tpl-progress-line': ['极简进度线', '顶部一条细色线 + 右上角时间码，画面不被遮住'],
      'tpl-talk-top': ['讲座顶栏', '顶部信息栏：讲者 · 当前章节名 · 计时，底部一条进度；整宽顶栏只按横屏排，画幅锁定 16:9'],
      'tpl-lower-third': ['下三分名条', '左下角两行名条：上行蓝底写视频名、下行白底写当前章节名；访谈与新闻式讲解的经典版式'],
      'tpl-podcast': ['播客集数', '左上角集数徽章、右上角计时，底部当前章节名 + 一条细进度；给音频转视频的对谈'],
      'tpl-vertical': ['竖屏切片', '竖屏：上三分之一一张半透明深色标题卡，大字写视频标题、下面小一号写章节名；台标在左上、右上角「第几段 / 共几段」；不画进度条，画幅锁定 9:16'],
      'tpl-wm-corner': ['水印 · 角标', '右下角一枚半透明台标，全程压在画面上；导出时烧进画面'],
      'tpl-wm-tiled': ['水印 · 平铺', '品牌名斜向铺满整幅画面，低不透明度；防搬运用'],
      'tpl-wm-handle': ['水印 · 社交名', '右上角一枚社交账号徽章；发短视频平台时把账号带在画面上'],
      'tpl-dy-title': ['抖音 · 大字标题', '黑底黄字的大标题写章节名、下面一枚红底段数徽章；账号名放在左下、避开评论区与右侧按钮；画幅锁定 9:16'],
      'tpl-dy-list': ['抖音 · 知识点条', '顶部黄底写视频名，下面一条明暗分段的知识点条——讲到第几点一眼看到；左下一行话题标签；画幅锁定 9:16'],
      'tpl-xhs-note': ['小红书 · 笔记封面', '白底圆角标题卡居中写章节名，玫红页码徽章；台标白底放左下；软色调的笔记感，画幅锁定 9:16'],
      'tpl-xhs-list': ['小红书 · 要点清单', '玫红话题标签 + 白底要点条按章节分段、播过的段填成玫红；左下一枚「记得收藏」白底徽章；画幅锁定 9:16'],
      'tpl-yt-lower': ['YouTube · 频道名条', '左下角红底白字写视频名、白底红字「订阅」徽章，底部一条红色进度线；横屏长视频的经典开场名条'],
      'tpl-yt-chapters': ['YouTube · 章节进度', '底部章节名一字排开、播过的段被红色色条填满；左上红底台标、右上剩余时间倒数'],
      'tpl-bili-part': ['B 站 · 分 P 标题', '左上青底「P 几」徽章、右上台标，底部青色章节条写本 P 名；给分 P 长视频'],
    },
    'zh-Hant': {
      brand: '科浪訪談', handle: '@kelang.studio', speaker: '林深', ep: '第 {n} 集', talk: 'TALK',
      tags: '#乾貨 #科普', subscribe: '訂閱', save: '記得收藏', part: 'P{n}',
      groups: {chapters: '章節與進度', info: '資訊條', vertical: '直屏', douyin: '抖音', xhs: '小紅書', youtube: 'YouTube', bili: 'B 站', watermark: '浮水印', brand: '品牌庫'},
      'tpl-chapter-bar': ['章節底欄 · 色條', '底部章節名一字排開，播過的部分被一條色條填滿；台標在左下角'],
      'tpl-chapter-dim': ['章節底欄 · 明暗', '播過的章節段是深底，沒播的是淺底，進度就是這條明暗分界；台標在右上角'],
      'tpl-progress-line': ['極簡進度線', '頂部一條細色線 + 右上角時間碼，畫面不被遮住'],
      'tpl-talk-top': ['講座頂欄', '頂部資訊欄：講者 · 目前章節名 · 計時，底部一條進度；整寬頂欄只按橫屏排，畫幅鎖定 16:9'],
      'tpl-lower-third': ['下三分名條', '左下角兩行名條：上行藍底寫视频名、下行白底寫目前章節名；訪談與新聞式講解的經典版式'],
      'tpl-podcast': ['播客集數', '左上角集數徽章、右上角計時，底部目前章節名 + 一條細進度；給音訊轉视频的對談'],
      'tpl-vertical': ['直屏切片', '直屏：上三分之一一張半透明深色標題卡，大字寫视频標題、下面小一號寫章節名；台標在左上、右上角「第幾段 / 共幾段」；不畫進度條，畫幅鎖定 9:16'],
      'tpl-wm-corner': ['浮水印 · 角標', '右下角一枚半透明台標，全程壓在畫面上；匯出時燒進畫面'],
      'tpl-wm-tiled': ['浮水印 · 平鋪', '品牌名斜向鋪滿整幅畫面，低不透明度；防搬運用'],
      'tpl-wm-handle': ['浮水印 · 社群名', '右上角一枚社群帳號徽章；發短影音平台時把帳號帶在畫面上'],
      'tpl-dy-title': ['抖音 · 大字標題', '黑底黃字的大標題寫章節名、下面一枚紅底段數徽章；帳號名放在左下、避開留言區與右側按鈕；畫幅鎖定 9:16'],
      'tpl-dy-list': ['抖音 · 知識點條', '頂部黃底寫视频名，下面一條明暗分段的知識點條——講到第幾點一眼看到；左下一行話題標籤；畫幅鎖定 9:16'],
      'tpl-xhs-note': ['小紅書 · 筆記封面', '白底圓角標題卡置中寫章節名，玫紅頁碼徽章；台標白底放左下；軟色調的筆記感，畫幅鎖定 9:16'],
      'tpl-xhs-list': ['小紅書 · 要點清單', '玫紅話題標籤 + 白底要點條按章節分段、播過的段填成玫紅；左下一枚「記得收藏」白底徽章；畫幅鎖定 9:16'],
      'tpl-yt-lower': ['YouTube · 頻道名條', '左下角紅底白字寫视频名、白底紅字「訂閱」徽章，底部一條紅色進度線；橫屏長视频的經典開場名條'],
      'tpl-yt-chapters': ['YouTube · 章節進度', '底部章節名一字排開、播過的段被紅色色條填滿；左上紅底台標、右上剩餘時間倒數'],
      'tpl-bili-part': ['B 站 · 分 P 標題', '左上青底「P 幾」徽章、右上台標，底部青色章節條寫本 P 名；給分 P 長视频'],
    },
    en: {
      brand: 'Kelang Talks', handle: '@kelang.studio', speaker: 'Lin Shen', ep: 'EP {n}', talk: 'TALK',
      tags: '#tips #explainer', subscribe: 'Subscribe', save: 'Save this', part: 'Part {n}',
      groups: {chapters: 'Chapters & progress', info: 'Info bars', vertical: 'Vertical', douyin: 'Douyin', xhs: 'Xiaohongshu', youtube: 'YouTube', bili: 'Bilibili', watermark: 'Watermarks', brand: 'Brand kit'},
      'tpl-chapter-bar': ['Chapter bar · fill', 'Chapter names across the bottom, a color bar fills what has played; logo bottom-left'],
      'tpl-chapter-dim': ['Chapter bar · dim', 'Played chapters go dark, unplayed stay light, the edge is the progress; logo top-right'],
      'tpl-progress-line': ['Thin progress line', 'A hairline across the top plus a timecode top-right; nothing covers the picture'],
      'tpl-talk-top': ['Talk header', 'Top bar with speaker · current chapter · timer, a progress bar at the bottom; full-width header is landscape only, ratio locked to 16:9'],
      'tpl-lower-third': ['Lower third', 'Two-line name plate bottom-left: movie title on blue above, current chapter on white below; the classic interview and news layout'],
      'tpl-podcast': ['Podcast episode', 'Episode badge top-left, timer top-right, current chapter along the bottom with a thin progress line; for audio turned into video'],
      'tpl-vertical': ['Vertical clip', 'Portrait: a translucent dark title card in the top third — the video title large, the chapter name smaller below; logo top-left, “part / of” top-right; no progress bar, ratio locked to 9:16'],
      'tpl-wm-corner': ['Watermark · corner', 'A translucent logo pinned bottom-right for the whole video; burned into the export'],
      'tpl-wm-tiled': ['Watermark · tiled', 'The brand name repeated diagonally across the whole frame at low opacity; deters re-uploads'],
      'tpl-wm-handle': ['Watermark · handle', 'A social handle badge top-right; keeps your account on the picture when posting to short-video platforms'],
      'tpl-dy-title': ['Douyin · big title', 'Bold yellow-on-black title with the chapter name and a red part badge under it; handle bottom-left, clear of the comment area and side buttons; ratio locked to 9:16'],
      'tpl-dy-list': ['Douyin · key points', 'Movie title on yellow at the top, a dim-fill points bar under it so the viewer sees which point you are on; hashtags bottom-left; ratio locked to 9:16'],
      'tpl-xhs-note': ['Xiaohongshu · note cover', 'A centered white title card with the chapter name and a rose page badge; logo on white bottom-left; the soft note look, ratio locked to 9:16'],
      'tpl-xhs-list': ['Xiaohongshu · checklist', 'Rose hashtag tag plus a white points bar split by chapter, played parts fill rose; a “Save this” badge bottom-left; ratio locked to 9:16'],
      'tpl-yt-lower': ['YouTube · channel lower third', 'Movie title on red bottom-left with a white “Subscribe” badge, a red progress line along the bottom; the classic long-form intro plate'],
      'tpl-yt-chapters': ['YouTube · chapter progress', 'Chapter names across the bottom, played parts filled red; red logo badge top-left, remaining time top-right'],
      'tpl-bili-part': ['Bilibili · part title', 'Teal “Part n” badge top-left, logo top-right, a teal chapter bar along the bottom with this part’s name; for multi-part long videos'],
    },
    ja: {
      brand: 'Kelang トーク', handle: '@kelang.studio', speaker: 'リン・シェン', ep: '第 {n} 回', talk: 'TALK',
      tags: '#豆知識 #解説', subscribe: 'チャンネル登録', save: '保存してね', part: 'P{n}',
      groups: {chapters: 'チャプターと進捗', info: '情報バー', vertical: '縦型', douyin: 'Douyin', xhs: 'Xiaohongshu', youtube: 'YouTube', bili: 'Bilibili', watermark: '透かし', brand: 'ブランドキット'},
      'tpl-chapter-bar': ['チャプターバー · 塗り', '下部にチャプター名を並べ、再生済みの部分をカラーバーで塗る。ロゴは左下'],
      'tpl-chapter-dim': ['チャプターバー · 明暗', '再生済みのチャプターは濃い地、未再生は薄い地、その境目が進捗。ロゴは右上'],
      'tpl-progress-line': ['細い進捗ライン', '上端に細いラインと右上にタイムコード。映像を隠さない'],
      'tpl-talk-top': ['講演ヘッダー', '上部に話者 · 現在のチャプター · タイマー、下部に進捗バー。全幅ヘッダーは横長のみ、比率は 16:9 に固定'],
      'tpl-lower-third': ['ローワーサード', '左下に 2 行のネームプレート：上段は青地にプロジェクト名、下段は白地に現在のチャプター。インタビューとニュースの定番'],
      'tpl-podcast': ['ポッドキャスト回数', '左上にエピソードバッジ、右上にタイマー、下部に現在のチャプターと細い進捗ライン。音声を映像にした対談向け'],
      'tpl-vertical': ['縦型クリップ', '縦型：上 1/3 に半透明の暗いタイトルカード。動画タイトルを大きく、その下にチャプター名を小さく。ロゴは左上、右上に「何話目 / 全何話」。進捗バーなし、比率は 9:16 に固定'],
      'tpl-wm-corner': ['透かし · コーナー', '右下に半透明のロゴを全編固定。書き出し時に映像へ焼き込む'],
      'tpl-wm-tiled': ['透かし · タイル', 'ブランド名を低い不透明度で画面全体に斜めに敷き詰める。無断転載の抑止に'],
      'tpl-wm-handle': ['透かし · アカウント名', '右上に SNS アカウントのバッジ。ショート動画に投稿するときアカウントを画面に載せる'],
      'tpl-dy-title': ['Douyin · 大見出し', '黒地に黄色の大見出しでチャプター名、その下に赤いパート番号バッジ。アカウント名は左下でコメント欄と右側ボタンを避ける。比率は 9:16 に固定'],
      'tpl-dy-list': ['Douyin · ポイントバー', '上部に黄地でプロジェクト名、その下に明暗で区切ったポイントバー。いま何点目かが一目で分かる。左下にハッシュタグ。比率は 9:16 に固定'],
      'tpl-xhs-note': ['Xiaohongshu · ノート表紙', '中央に白い角丸タイトルカードでチャプター名、ローズ色のページバッジ。ロゴは左下に白地。やわらかいノート風、比率は 9:16 に固定'],
      'tpl-xhs-list': ['Xiaohongshu · チェックリスト', 'ローズ色のハッシュタグと、チャプターで区切った白いポイントバー。再生済みはローズ色に塗る。左下に「保存してね」バッジ。比率は 9:16 に固定'],
      'tpl-yt-lower': ['YouTube · チャンネルネームプレート', '左下に赤地白字でプロジェクト名、白地赤字の「チャンネル登録」バッジ、下端に赤い進捗ライン。横長長尺動画の定番オープニング'],
      'tpl-yt-chapters': ['YouTube · チャプター進捗', '下部にチャプター名を並べ、再生済みを赤で塗る。左上に赤いロゴバッジ、右上に残り時間'],
      'tpl-bili-part': ['Bilibili · パートタイトル', '左上にティール色の「P 番号」バッジ、右上にロゴ、下部にティール色のチャプターバーでこのパート名。分割長尺動画向け'],
    },
  };

  /* ---------- 内置模板（十七款；同一份版面，文字按词表换） ----------
     前六款是版面（章节条 / 进度 / 顶栏 / 名条 / 播客），第七款竖屏，接着七款平台款（抖音 2 / 小红书 2 /
     YouTube 2 / B 站 1），末三款是水印（`tag: 'watermark'`，只有台标层）。每款带 `group` 供目录分组。水印那三款不含章节条与进度条，所以它们对字幕避让没有影响。 */
  function build(s) {
    const def = (id, extra, layers) => Object.assign(
      {id, name: s[id][0], desc: s[id][1], canvas: '16:9', builtin: true}, extra, {layers});
    return [
      def('tpl-chapter-bar', {hue: 'purple', group: 'chapters'}, [
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 0, y: 91, w: 100, h: 9},
         fill: 'bar', bg: 'rgba(0,0,0,0.6)', color: WHITE, accent: ORANGE, divider: true, size: 2.6},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 2, y: 80, w: 14, h: 8},
         src: 'text', text: s.brand, bg: RED, color: WHITE, shape: 'badge', size: 3.2},
      ]),
      def('tpl-chapter-dim', {hue: 'cyan', group: 'chapters'}, [
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 0, y: 91, w: 100, h: 9},
         fill: 'dim', bg: 'rgba(255,255,255,0.72)', color: INK, accent: 'rgba(0,0,0,0.78)',
         colorDone: WHITE, divider: true, size: 2.6},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 84, y: 4, w: 14, h: 8},
         src: 'text', text: s.brand, bg: 'rgba(0,0,0,0.55)', color: WHITE, shape: 'badge', size: 3},
      ]),
      def('tpl-progress-line', {hue: 'orange', group: 'chapters'}, [
        {id: 'l-pg', kind: 'progress', on: true, box: {x: 0, y: 0, w: 100, h: 1.4},
         accent: ORANGE, track: 'rgba(255,255,255,0.25)'},
        {id: 'l-tc', kind: 'text', on: true, box: {x: 80, y: 3, w: 18, h: 6},
         text: '{time} / {total}', color: WHITE, bg: 'rgba(0,0,0,0.45)', align: 'right', size: 2.8, mono: true},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 2, y: 3, w: 12, h: 6},
         src: 'text', text: s.brand, bg: null, color: WHITE, shape: 'plain', size: 2.8},
      ]),
      def('tpl-talk-top', {hue: 'yellow', group: 'info', ratio: '16:9', lockRatio: true}, [
        {id: 'l-bar', kind: 'text', on: true, box: {x: 0, y: 0, w: 100, h: 7},
         text: s.talk + ' · ' + s.speaker + ' · {chapter}', color: INK, bg: YELLOW, align: 'left', size: 2.8, weight: 800},
        {id: 'l-tc', kind: 'text', on: true, box: {x: 84, y: 0, w: 16, h: 7},
         text: '{time}', color: INK, bg: null, align: 'right', size: 2.8, mono: true},
        {id: 'l-pg', kind: 'progress', on: true, box: {x: 0, y: 98, w: 100, h: 2},
         accent: YELLOW, track: 'rgba(0,0,0,0.35)'},
      ]),
      /* 下三分名条：两行叠在左下角，上行品牌蓝底白字写视频名，下行白底墨字写当前章节，
         下行短一截——这是访谈 / 新闻讲解最经典的两色名条。 */
      def('tpl-lower-third', {hue: 'blue', group: 'info'}, [
        {id: 'l-name', kind: 'text', on: true, box: {x: 4, y: 74, w: 40, h: 7.5},
         text: '{title}', color: WHITE, bg: BLUE, align: 'left', size: 3.2, weight: 800},
        {id: 'l-role', kind: 'text', on: true, box: {x: 4, y: 81.5, w: 30, h: 6.5},
         text: '{chapter}', color: INK, bg: WHITE, align: 'left', size: 2.4, weight: 600},
      ]),
      /* 播客集数：左上「第 n 集」徽章、右上剩余时间、底部当前章节名一行 + 细进度线——
         音频转视频的对谈没有画面可看，这一套把「听到哪了」写在脸上。 */
      def('tpl-podcast', {hue: 'green', group: 'info'}, [
        {id: 'l-ep', kind: 'text', on: true, box: {x: 3, y: 4, w: 14, h: 7},
         text: s.ep, color: INK, bg: YELLOW, align: 'center', size: 2.8, weight: 800},
        {id: 'l-tc', kind: 'text', on: true, box: {x: 80, y: 4, w: 17, h: 7},
         text: '-{remain}', color: WHITE, bg: 'rgba(0,0,0,0.45)', align: 'right', size: 2.8, mono: true},
        {id: 'l-ch', kind: 'text', on: true, box: {x: 3, y: 86, w: 60, h: 7},
         text: '{n} / {count} · {chapter}', color: WHITE, bg: null, align: 'left', size: 3, weight: 700},
        {id: 'l-pg', kind: 'progress', on: true, box: {x: 3, y: 95, w: 94, h: 1.2},
         accent: YELLOW, track: 'rgba(255,255,255,0.25)'},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 80, y: 86, w: 17, h: 7},
         src: 'text', text: s.brand, bg: null, color: WHITE, shape: 'plain', size: 2.2, opacity: 0.8},
      ]),
      /* 竖屏切片：上三分之一一张半透明深色标题卡——上行白色粗体大字写视频标题（`{title}`，主），
         下行小一号、浅灰、中等字重写当前章节（`{chapter}`，次）。两行同一种底色、盒子上下相接成一张卡，
         接缝落在 17.5%（1920 / 1280 / 960 / 640 / 320 高都是整像素，合成不出细缝）。左上台标徽章的字
         靠左（`align: 'left'`），盒宽 24 与右上「第几段 / 共几段」对称；台标、标题卡左缘都在 x 6，
         标题卡右缘与计数右缘都在 x 94。四层字的内边距都写死 `pad: VPAD`（画面高的 1.2%，1080×1920
         下 23px）：台标字、标题、章节名从同一条竖线起笔，计数的右缘与台标字左右对称——按 em 推的
         内边距跟着字号走，三种字号就是三条起笔线。2026-09-15 换掉黄底墨字：整块亮黄在竖屏上太扎眼，
         只写章节名也分不出主次。竖屏平台自带进度条，底部还是字幕与平台 UI 的地盘，所以这一款不画进度。 */
      def('tpl-vertical', {hue: 'magenta', group: 'vertical', canvas: '9:16', ratio: '9:16', lockRatio: true}, [
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 6, y: 4, w: 24, h: 3.2},
         src: 'text', text: s.brand, bg: 'rgba(0,0,0,0.55)', color: WHITE, shape: 'badge', size: 1.6, align: 'left', pad: VPAD},
        {id: 'l-n', kind: 'text', on: true, box: {x: 70, y: 4, w: 24, h: 3.2},
         text: '{n} / {count}', color: WHITE, bg: null, align: 'right', size: 1.6, mono: true, pad: VPAD},
        {id: 'l-tt', kind: 'text', on: true, box: {x: 6, y: 12.5, w: 88, h: 5},
         text: '{title}', color: WHITE, bg: 'rgba(0,0,0,0.55)', align: 'left', size: 2.4, weight: 800, pad: VPAD},
        {id: 'l-ct', kind: 'text', on: true, box: {x: 6, y: 17.5, w: 88, h: 4},
         text: '{chapter}', color: MIST, bg: 'rgba(0,0,0,0.55)', align: 'left', size: 1.8, weight: 600, pad: VPAD},
      ]),
      /* ---- 平台款（2026-09-14）：按各平台上流行的版式排，安全区照平台 UI 留——
         竖屏三家（抖音 / 小红书）右侧 18% 是点赞评论按钮、底部 28% 是文案与评论区、顶部 8% 是状态栏，
         所以竖屏款只在 x 6–82、y 10–72 里摆东西；横屏两家（YouTube / B 站）底部留给平台自己的进度条，
         我们的章节条 / 进度线压在其上方一点。颜色只是「像那个平台」的风格色，不是任何品牌色值。 */
      def('tpl-dy-title', {hue: 'red', group: 'douyin', canvas: '9:16', ratio: '9:16', lockRatio: true}, [
        {id: 'l-tt', kind: 'text', on: true, box: {x: 6, y: 12, w: 76, h: 9},
         text: '{chapter}', color: YELLOW, bg: 'rgba(0,0,0,0.72)', align: 'left', size: 3.2, weight: 800},
        {id: 'l-n', kind: 'text', on: true, box: {x: 6, y: 22, w: 18, h: 3.6},
         text: '{n} / {count}', color: WHITE, bg: RED, align: 'center', size: 1.6, weight: 800, mono: true},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 6, y: 66, w: 34, h: 3.4},
         src: 'text', text: s.handle, bg: 'rgba(0,0,0,0.55)', color: WHITE, shape: 'badge', size: 1.6, opacity: 0.9},
      ]),
      def('tpl-dy-list', {hue: 'orange', group: 'douyin', canvas: '9:16', ratio: '9:16', lockRatio: true}, [
        {id: 'l-tt', kind: 'text', on: true, box: {x: 6, y: 11, w: 76, h: 5.5},
         text: '{title}', color: INK, bg: YELLOW, align: 'left', size: 2.2, weight: 800},
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 6, y: 17.5, w: 76, h: 4.2},
         fill: 'dim', bg: 'rgba(0,0,0,0.55)', color: WHITE, accent: ORANGE, colorDone: INK, divider: true, size: 1.5},
        {id: 'l-tg', kind: 'text', on: true, box: {x: 6, y: 66, w: 60, h: 3.4},
         text: s.tags, color: WHITE, bg: null, align: 'left', size: 1.6, weight: 700},
      ]),
      def('tpl-xhs-note', {hue: 'pink', group: 'xhs', canvas: '9:16', ratio: '9:16', lockRatio: true}, [
        {id: 'l-tt', kind: 'text', on: true, box: {x: 10, y: 13, w: 68, h: 8},
         text: '{chapter}', color: INK, bg: WHITE, align: 'center', size: 2.8, weight: 800},
        {id: 'l-n', kind: 'text', on: true, box: {x: 36, y: 22.2, w: 16, h: 3.4},
         text: '{n} / {count}', color: WHITE, bg: PINK, align: 'center', size: 1.5, weight: 800, mono: true},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 10, y: 66, w: 30, h: 3.4},
         src: 'text', text: s.brand, bg: WHITE, color: INK, shape: 'badge', size: 1.6, opacity: 0.92},
      ]),
      def('tpl-xhs-list', {hue: 'pink', group: 'xhs', canvas: '9:16', ratio: '9:16', lockRatio: true}, [
        {id: 'l-tg', kind: 'text', on: true, box: {x: 6, y: 11, w: 36, h: 3.6},
         text: s.tags, color: WHITE, bg: PINK, align: 'left', size: 1.6, weight: 800},
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 6, y: 16, w: 76, h: 5},
         fill: 'bar', bg: 'rgba(255,255,255,0.92)', color: INK, accent: PINK, divider: true, size: 1.5},
        {id: 'l-sv', kind: 'text', on: true, box: {x: 6, y: 66, w: 28, h: 3.4},
         text: s.save, color: PINK, bg: WHITE, align: 'center', size: 1.6, weight: 800},
      ]),
      def('tpl-yt-lower', {hue: 'red', group: 'youtube'}, [
        {id: 'l-name', kind: 'text', on: true, box: {x: 4, y: 76, w: 44, h: 7.5},
         text: '{title}', color: WHITE, bg: RED, align: 'left', size: 3.2, weight: 800},
        {id: 'l-sub', kind: 'text', on: true, box: {x: 4, y: 83.5, w: 16, h: 5.5},
         text: s.subscribe, color: RED, bg: WHITE, align: 'center', size: 2.4, weight: 800},
        {id: 'l-pg', kind: 'progress', on: true, box: {x: 0, y: 96, w: 100, h: 1.4},
         accent: RED, track: 'rgba(255,255,255,0.3)'},
      ]),
      def('tpl-yt-chapters', {hue: 'red', group: 'youtube'}, [
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 0, y: 92, w: 100, h: 6},
         fill: 'bar', bg: 'rgba(0,0,0,0.6)', color: WHITE, accent: RED, divider: true, size: 2.2},
        {id: 'l-tc', kind: 'text', on: true, box: {x: 82, y: 3, w: 16, h: 5.5},
         text: '-{remain}', color: WHITE, bg: 'rgba(0,0,0,0.45)', align: 'right', size: 2.6, mono: true},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 2, y: 3, w: 15, h: 5.5},
         src: 'text', text: s.brand, bg: RED, color: WHITE, shape: 'badge', size: 2.4},
      ]),
      def('tpl-bili-part', {hue: 'cyan', group: 'bili'}, [
        {id: 'l-ep', kind: 'text', on: true, box: {x: 2, y: 3, w: 10, h: 5.5},
         text: s.part, color: WHITE, bg: TEAL, align: 'center', size: 2.6, weight: 800, mono: true},
        {id: 'l-lg', kind: 'logo', on: true, box: {x: 84, y: 3, w: 14, h: 5.5},
         src: 'text', text: s.brand, bg: 'rgba(0,0,0,0.55)', color: WHITE, shape: 'badge', size: 2.4},
        {id: 'l-ch', kind: 'chapters', on: true, box: {x: 0, y: 93, w: 100, h: 5},
         fill: 'bar', bg: 'rgba(0,0,0,0.6)', color: WHITE, accent: TEAL, divider: true, size: 2},
      ]),
      /* 水印三款：只有台标层。角标半透明钉右下；平铺铺满整幅、低不透明度、斜排；社交名是右上徽章。 */
      def('tpl-wm-corner', {hue: 'gray', group: 'watermark', tag: 'watermark'}, [
        {id: 'l-wm', kind: 'logo', on: true, box: {x: 80, y: 89, w: 17, h: 7},
         src: 'text', text: s.brand, bg: null, color: WHITE, shape: 'plain', size: 2.4, opacity: 0.7},
      ]),
      def('tpl-wm-tiled', {hue: 'gray', group: 'watermark', tag: 'watermark'}, [
        {id: 'l-wm', kind: 'logo', on: true, box: {x: 0, y: 0, w: 100, h: 100},
         src: 'text', text: s.brand, bg: null, color: WHITE, shape: 'plain', size: 2.6, opacity: 0.2, tile: true},
      ]),
      def('tpl-wm-handle', {hue: 'gray', group: 'watermark', tag: 'watermark'}, [
        {id: 'l-wm', kind: 'logo', on: true, box: {x: 74, y: 4, w: 23, h: 6},
         src: 'text', text: s.handle, bg: 'rgba(0,0,0,0.55)', color: WHITE, shape: 'badge', size: 2.4, opacity: 0.85},
      ]),
    ];
  }
  const builtCache = {};
  /** 某一语言的内置目录：同一语言返回同一个数组（视图层拿它当依赖不会抖）。 */
  function builtins(lang) {
    const k = STR[lang] ? lang : LANG_FALLBACK;
    if (!builtCache[k]) builtCache[k] = build(STR[k]);
    return builtCache[k];
  }
  /* ---------- 分组（2026-09-14） ----------
     目录与向导按组分节：内置模板的 `group` 是组键，品牌库里的一律归 `brand`（不管它从哪来）；
     组名走词表 `groups`，顺序固定在 GROUPS 里，空组不出现。 */
  const GROUPS = ['chapters', 'info', 'vertical', 'douyin', 'xhs', 'youtube', 'bili', 'watermark', 'brand'];
  function groupKey(t) { return t && t.brand ? 'brand' : (t && GROUPS.includes(t.group) ? t.group : 'info'); }
  function groupLabel(key, lang) { const w = (STR[lang] || STR[LANG_FALLBACK]).groups; return w[key] || key; }
  function groupTemplates(list, lang) {
    const by = {};
    (list || []).forEach((t) => { const k = groupKey(t); (by[k] = by[k] || []).push(t); });
    return GROUPS.filter((k) => by[k]).map((k) => ({key: k, label: groupLabel(k, lang), items: by[k]}));
  }
  /** 缺省语言（简体中文）的目录：纯层测试与 data.js 的演示数据读这一份。 */
  const BUILTINS = builtins('zh');
  const isWatermark = (tpl) => !!(tpl && tpl.tag === 'watermark');
  /** 按 id 找定义：先内置（按语言）再品牌库。实例的 `from` 记的是 id，换语言后仍找得到。 */
  const byId = (id, lang, brand) => builtins(lang).concat(brand || []).find((t) => t.id === id) || null;

  /* ---------- 工具 ---------- */
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r1 = (v) => Math.round(v * 10) / 10;
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const MIN_W = 4, MIN_H = 0.6;

  /** 盒子夹在画幅里：先夹尺寸，再夹位置。 */
  function clampBox(b) {
    const w = r1(clamp(b.w, MIN_W, 100));
    const h = r1(clamp(b.h, MIN_H, 100));
    return {x: r1(clamp(b.x, 0, 100 - w)), y: r1(clamp(b.y, 0, 100 - h)), w, h};
  }

  function nextId(prefix, list) {
    const has = (id) => list.some((x) => x.id === id);
    let n = 1;
    while (has(prefix + n)) n += 1;
    return prefix + n;
  }

  /** 新图层的默认样子——章节条 / 进度是整宽的带，台标 / 文字是一块小盒。 */
  function newLayer(kind, tpl, lang) {
    const id = nextId('l-' + kind + '-', (tpl && tpl.layers) || []);
    const s = STR[lang] || STR.zh;
    const base = {id, kind, on: true};
    if (kind === 'chapters') {
      return Object.assign(base, {box: {x: 0, y: 91, w: 100, h: 9}, fill: 'bar',
        bg: 'rgba(0,0,0,0.6)', color: WHITE, accent: ORANGE, divider: true, size: 2.6});
    }
    if (kind === 'progress') {
      return Object.assign(base, {box: {x: 0, y: 98, w: 100, h: 2},
        accent: ORANGE, track: 'rgba(255,255,255,0.25)'});
    }
    if (kind === 'logo') {
      return Object.assign(base, {box: {x: 2, y: 4, w: 14, h: 8},
        src: 'text', text: s.brand, bg: RED, color: WHITE, shape: 'badge', size: 3.2});
    }
    return Object.assign(base, {box: {x: 4, y: 14, w: 40, h: 6},
      text: '{chapter}', color: WHITE, bg: 'rgba(0,0,0,0.45)', align: 'left', size: 2.8});
  }

  const addLayer = (tpl, kind, lang) => Object.assign({}, tpl, {layers: tpl.layers.concat([newLayer(kind, tpl, lang)])});
  const removeLayer = (tpl, id) => Object.assign({}, tpl, {layers: tpl.layers.filter((l) => l.id !== id)});
  const updateLayer = (tpl, id, patch) => Object.assign({}, tpl,
    {layers: tpl.layers.map((l) => (l.id === id ? Object.assign({}, l, patch) : l))});
  const moveBox = (tpl, id, patch) => Object.assign({}, tpl, {layers: tpl.layers.map((l) =>
    (l.id === id ? Object.assign({}, l, {box: clampBox(Object.assign({}, l.box, patch))}) : l))});
  /** 层序：数组顺序就是叠放顺序（后画的在上）。dir = +1 往上一层，-1 往下一层。 */
  function reorder(tpl, id, dir) {
    const i = tpl.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= tpl.layers.length) return tpl;
    const ls = tpl.layers.slice();
    const t = ls[i]; ls[i] = ls[j]; ls[j] = t;
    return Object.assign({}, tpl, {layers: ls});
  }
  const layer = (tpl, id) => (tpl && tpl.layers.find((l) => l.id === id)) || null;
  /** 整层不透明度：缺省 1，写进文档时夹到 [0.05, 1]（0 等于关掉这一层，那是 `on` 的事）。 */
  const clampOpacity = (v) => (v == null || Number.isNaN(Number(v)) ? 1 : clamp(Number(v), 0.05, 1));
  const layerOpacity = (l) => (l && l.opacity != null ? clampOpacity(l.opacity) : 1);
  /** 台标在盒子里靠哪边（2026-09-15）：只认 left / right，缺省与其它值一律居中（旧文档没有这个字段）。 */
  const logoAlign = (l) => (l && (l.align === 'left' || l.align === 'right') ? l.align : 'center');
  /** 字离盒子左右边的像素内边距（2026-09-15）：写了 `pad`（画面高的百分比，不设字号那样的 7px 下限）
      就按画面高 `fh` 折算；没写或不是非负有限数则 null，交给 CSS 按字号推（`.tpltxt` 0.5em、
      `.tpllogo--badge` 0.6em）。与 Rust 渲染器 `pad_px` 同一口径。 */
  const layerPad = (l, fh) => (l && typeof l.pad === 'number' && Number.isFinite(l.pad) && l.pad >= 0
    ? l.pad / 100 * fh : null);

  /** 拖动：像素位移折成百分比，再夹取。 */
  const dragBox = (box, dxPx, dyPx, frame) => clampBox(Object.assign({}, box,
    {x: box.x + dxPx / frame.w * 100, y: box.y + dyPx / frame.h * 100}));
  /** 右下角拉伸：只改宽高，左上角不动。 */
  const resizeBox = (box, dxPx, dyPx, frame) => clampBox(Object.assign({}, box,
    {w: box.w + dxPx / frame.w * 100, h: box.h + dyPx / frame.h * 100}));

  /** 八个拉伸把手，顺序同 `template.rs::Handle::ALL`。sx / sy：-1 拖起边，1 拖终边，0 不动这根轴。 */
  const HANDLES = [
    {k: 'nw', sx: -1, sy: -1, cursor: 'nwse-resize'},
    {k: 'n', sx: 0, sy: -1, cursor: 'ns-resize'},
    {k: 'ne', sx: 1, sy: -1, cursor: 'nesw-resize'},
    {k: 'e', sx: 1, sy: 0, cursor: 'ew-resize'},
    {k: 'se', sx: 1, sy: 1, cursor: 'nwse-resize'},
    {k: 's', sx: 0, sy: 1, cursor: 'ns-resize'},
    {k: 'sw', sx: -1, sy: 1, cursor: 'nesw-resize'},
    {k: 'w', sx: -1, sy: 0, cursor: 'ew-resize'},
  ];
  const handleOf = (k) => HANDLES.find((h) => h.k === k) || null;
  /** 一根轴上拖一条边：对边不动，被拖的边夹在 [0, 对边 − min] 或 [对边 + min, 100]。 */
  function dragEdge(start, size, delta, side, min) {
    const lo = start, hi = start + size;
    if (side < 0) { const e = clamp(lo + delta, 0, hi - min); return [e, hi - e]; }
    if (side > 0) { const e = clamp(hi + delta, lo + min, 100); return [lo, e - lo]; }
    return [start, size];
  }
  /** 八把手拉伸（镜像 `template.rs::resize_box_from`）：被拖的边跟手、对边不动，最后过 clampBox。
      resizeBox 等价于 handle = 'se'。 */
  function resizeBoxFrom(box, handle, dxPx, dyPx, frame) {
    const h = typeof handle === 'string' ? handleOf(handle) : handle;
    const dxp = frame.w > 0 ? dxPx / frame.w * 100 : 0;
    const dyp = frame.h > 0 ? dyPx / frame.h * 100 : 0;
    const [x, w] = dragEdge(box.x, box.w, dxp, h ? h.sx : 0, MIN_W);
    const [y, hh] = dragEdge(box.y, box.h, dyp, h ? h.sy : 0, MIN_H);
    return clampBox({x, y, w, h: hh});
  }

  /** 快捷贴齐（两轴口径与几何面板一致）：
      'fullWidth' 整宽、'fullHeight' 整高、'top' / 'bottom' 贴顶 / 贴底、'center' 两轴一起居中。
      旧版「居中」只动 x——那是 bug，不是口径。 */
  function snap(box, mode) {
    if (mode === 'fullWidth') return clampBox(Object.assign({}, box, {x: 0, w: 100}));
    if (mode === 'fullHeight') return clampBox(Object.assign({}, box, {y: 0, h: 100}));
    if (mode === 'top') return clampBox(Object.assign({}, box, {y: 0}));
    if (mode === 'bottom') return clampBox(Object.assign({}, box, {y: 100 - box.h}));
    if (mode === 'center') return clampBox(Object.assign({}, box, {x: (100 - box.w) / 2, y: (100 - box.h) / 2}));
    return clampBox(box);
  }

  /** 模板插画色（画进视频画面，不是 chrome）。版面编辑器的色板从这里取。 */
  const COLORS = {WHITE, INK, ORANGE, RED, BLUE, YELLOW, PINK, TEAL};

  /** 命中：从最上层往下找第一个包住这个点（百分比）的开着的层。 */
  function hitTest(tpl, px, py) {
    for (let i = tpl.layers.length - 1; i >= 0; i -= 1) {
      const l = tpl.layers[i];
      if (!l.on) continue;
      const b = l.box;
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return l.id;
    }
    return null;
  }

  /* ---------- 投影：章节段 / 进度 / 变量 ---------- */
  const progress = (playT, dur) => (dur > 0 ? clamp(playT / dur, 0, 1) : 0);

  /** 章节段：每段的占比、已播比例与三态（done / on / todo）。空章节表 = 整段一条。 */
  function segments(chapters, playT, dur) {
    const list = chapters && chapters.length ? chapters : [{id: 'all', title: '', start: 0, end: dur}];
    return list.map((c) => {
      const span = Math.max(0.001, c.end - c.start);
      const done = clamp((playT - c.start) / span, 0, 1);
      const state = playT >= c.end ? 'done' : playT >= c.start ? 'on' : 'todo';
      return {id: c.id, title: c.title, start: c.start, span, done, state};
    });
  }

  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function tc(sec) {
    const s = Math.max(0, Math.floor(sec));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + pad2(m) : m) + ':' + pad2(x);
  }
  /** 文字层的变量表。`chapter` 是播放头所在章的标题（章节表为空时是空串）。 */
  function vars(chapters, playT, dur, extra) {
    const segs = segments(chapters, playT, dur);
    const cur = segs.find((s) => s.state === 'on') || (playT >= dur ? segs[segs.length - 1] : segs[0]);
    const idx = segs.indexOf(cur);
    return Object.assign({
      chapter: cur ? cur.title : '', n: cur ? String(idx + 1) : '', count: String(segs.length),
      time: tc(playT), remain: tc(dur - playT), total: tc(dur),
      percent: Math.round(progress(playT, dur) * 100) + '%',
    }, extra || {});
  }
  const VAR_NAMES = ['chapter', 'n', 'count', 'time', 'remain', 'total', 'percent', 'title'];
  const fill = (text, v) => String(text == null ? '' : text)
    .replace(/\{(\w+)\}/g, (m, k) => (v && v[k] != null ? v[k] : m));

  /** 字幕避让：底部有整宽的章节条 / 进度条时，字幕栈的 bottom 抬到条子上沿之上。
      `base` 是没有模板时的 bottom 百分比（`.subs` 的 7%）。 */
  function subsBottom(tpl, base) {
    let bottom = base;
    if (!tpl) return base;
    tpl.layers.forEach((l) => {
      if (!l.on || !KIND_META[l.kind].strip) return;
      if (l.box.y < 50) return;                      // 顶部的带不挡字幕
      bottom = Math.max(bottom, r1(100 - l.box.y + 2));
    });
    return bottom;
  }

  /* ---------- 定义 ↔ 实例 ↔ 品牌库 ---------- */
  const summary = (tpl) => {
    const seen = [];
    tpl.layers.forEach((l) => {
      const lab = KIND_META[l.kind].label;
      if (seen.indexOf(lab) < 0) seen.push(lab);
    });
    return seen.join(' · ');
  };
  /** 可选的「套用时画幅」（`ratio`）：null / 缺省 = 不改；'original' 跟随源尺寸；否则 'W:H'。
      返回值是舞台画幅弹层那套名字（D.ratios），套用时直接 setRatio 它。 */
  const ratioTarget = (tpl) => {
    const r = tpl && tpl.ratio ? String(tpl.ratio).trim() : '';
    if (!r) return null;
    return /^original$/i.test(r) ? 'Original' : r;
  };
  const ratioLabel = (r) => (r === 'Original' ? '原始' : r);
  /** 画幅锁（第 218 轮）：声明了「套用时画幅」**且** `lockRatio` 打开才算锁；只开锁不声明画幅
      等于没锁——锁的是「这一档」，不是「现在碰巧是哪一档」。 */
  const ratioLocked = (tpl) => !!(tpl && tpl.lockRatio && ratioTarget(tpl));
  /** 舞台画幅钮 / 项目设置 / 导出弹层读这一份：null = 画幅自由；否则 {ratio, name, note}，
      `note` 就是界面上那句「为什么改不了」。 */
  const ratioLock = (tpl) => (ratioLocked(tpl)
    ? {ratio: ratioTarget(tpl), name: tpl.name,
       note: `画幅由模板「${tpl.name}」锁定为 ${ratioLabel(ratioTarget(tpl))}`}
    : null);
  /** 改画幅前问一声：没锁随便改；锁着只放行锁定的那一档（幂等地设回去不算改）。 */
  const canSetRatio = (tpl, r) => !ratioLocked(tpl) || r === ratioTarget(tpl);
  /** 套用这套模板时项目画幅怎么走：{ratio 套用后的画幅, changed 是否真改了, locked 套上后锁不锁} */
  const applyRatio = (tpl, cur) => {
    const t = ratioTarget(tpl);
    return {ratio: t || cur, changed: !!(t && t !== cur), locked: ratioLocked(tpl)};
  };
  /** 目录 / 品牌库 / 属性页摘要末尾那一节；没声明就是空串。锁着的写「锁定画幅」，只声明写「套用后画幅」。 */
  const ratioNote = (tpl) => {
    const r = ratioTarget(tpl);
    if (!r) return '';
    return (ratioLocked(tpl) ? '锁定画幅 ' : '套用后画幅 ') + ratioLabel(r);
  };
  /** 进项目：深拷贝一份，记住来自哪个定义。 */
  const instance = (tpl) => Object.assign(clone(tpl), {from: tpl.id, builtin: false});
  const dup = (tpl, patch) => Object.assign(clone(tpl), {builtin: false}, patch || {});
  const blank = (canvas) => ({id: 'tpl-new', name: '未命名模板', hue: 'gray', canvas: canvas || '16:9',
    builtin: false, desc: '', layers: []});

  /** 存进品牌库：同名覆盖（更新那一条），否则新增一条。返回新表与那一条。 */
  function saveToBrand(list, tpl, name) {
    const nm = (name || tpl.name || '').trim() || '未命名模板';
    const hit = list.find((t) => t.name === nm);
    const id = hit ? hit.id : nextId('tpl-brand-', list);
    const doc = Object.assign(clone(tpl), {id, name: nm, builtin: false, brand: true});
    delete doc.from;
    const next = hit ? list.map((t) => (t.id === id ? doc : t)) : list.concat([doc]);
    return {list: next, doc, updated: !!hit};
  }

  /* ---------- 旧版水印 → 模板（2026-09-14） ----------
     旧 Brand kit 的水印是 {id, name, mode}：文字或图片，`mode` 是「平铺」或钉在哪一角。
     它从来就是一层台标，所以导入 = 造一条只有台标层的品牌库定义：平铺 → 铺满整幅、
     低不透明度；钉角 → 一块小盒；图片水印按名字在品牌库图片里找，找不到退成文字。
     `imported: 'watermark'` 让品牌页标出来历；`tag: 'watermark'` 与内置水印同一类。 */
  const WM_CORNER = {'左上角': {x: 3, y: 4}, '右上角': {x: 79, y: 4}, '左下角': {x: 3, y: 88}, '右下角': {x: 79, y: 88}};
  function fromWatermark(w, opt) {
    const images = (opt && opt.images) || [];
    const img = images.find((m) => m.name === w.name) || null;
    const tiled = w.mode === '平铺';
    const corner = WM_CORNER[w.mode] || WM_CORNER['右下角'];
    const box = tiled ? {x: 0, y: 0, w: 100, h: 100} : Object.assign({w: 18, h: 8}, corner);
    const layer = Object.assign({id: 'l-wm', kind: 'logo', on: true, box, shape: 'plain', bg: null, color: WHITE,
      size: tiled ? 2.6 : 2.4, opacity: tiled ? 0.22 : 0.75, tile: tiled},
      img ? {src: img.id} : {src: 'text', text: w.name});
    return {id: 'tpl-wm-' + w.id, name: w.name, hue: 'gray', canvas: '16:9', builtin: false, brand: true,
      tag: 'watermark', imported: 'watermark', desc: '由水印导入 · ' + (w.mode || '右下角'), layers: [layer]};
  }
  /** 一次性导入：逐条走 `saveToBrand`（同名覆盖，重复导入不产生第二份）。 */
  function importWatermarks(list, wms, opt) {
    return (wms || []).reduce((acc, w) => saveToBrand(acc, fromWatermark(w, opt), w.name).list, list);
  }

  Object.assign(window, {BC_TPL: {
    KINDS, KIND_META, BUILTINS, LANGS, STR, GROUPS, groupKey, groupLabel, groupTemplates, VAR_NAMES, MIN_W, MIN_H,
    langOf, systemLang, builtins, byId, isWatermark, fromWatermark, importWatermarks, clampOpacity, layerOpacity, logoAlign, layerPad,
    clampBox, newLayer, addLayer, removeLayer, updateLayer, moveBox, reorder, layer,
    dragBox, resizeBox, resizeBoxFrom, HANDLES, handleOf, snap, COLORS, hitTest,
    progress, segments, vars, fill, subsBottom, timecode: tc,
    summary, ratioTarget, ratioNote, ratioLabel, ratioLocked, ratioLock, canSetRatio, applyRatio,
    instance, dup, blank, saveToBrand,
  }});
})();
