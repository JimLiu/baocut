/* @generated catalogue: core/assets/elements/catalogue.json.
   Pinned third-party artwork only; regenerate with scripts/dev/elements/generate.py. */
(function () {
  /** 一个静态包：目录 slug / 英文名 / 中文名 / 原目录总数 / 检索词 / 收下的文件后缀 / 备注 */
  const P = (k, en, label, total, tags, files, note) =>
    ({k, en, label, total, tags, files, note: note || null});
  /** 一个动态分类：同上，`anim: true` 让两侧共用一套渲染与检索 */
  const A = (k, label, en, total, tags, files) =>
    ({k, en, label, total, tags, files, note: null, anim: true});

  const DIR = 'assets/stickers/';
  const ANIM_DIR = DIR + 'anim/';

  const PACKS = [
    {"k":"featured","en":"Featured","label":"精选","total":20,"tags":"精选 featured 推荐","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg"],"note":null},
    {"k":"emoji","en":"Emoji","label":"表情","total":24,"tags":"表情 emoji 反应 笑脸","files":["blowKiss.svg","burrito.svg","cat.svg","cryLaugh.svg","fire.svg","fist.svg","heart.svg","hundred.svg","leftPoint.svg","loudCry.svg","lovestruck.svg","moneyTongue.svg","okHand.svg","pizza.svg","pointRight.svg","shrugging.svg","singleTear.svg","smiling.svg","starstruck.svg","sunglasses.svg","surprised.svg","thinking.svg","thumbsUp.svg","tongue.svg"],"note":null},
    {"k":"people","en":"People","label":"人物","total":20,"tags":"人物 角色 头像 人像 多样性 person portrait people character open peeps","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg"],"note":null},
    {"k":"mockup","en":"Mockups","label":"样机窗口","total":13,"tags":"样机 窗口 设备 电脑 手机 平板 相机 播放器 mockup device window desktop mobile tablet camera","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg"],"note":null},
    {"k":"podcast","en":"Podcast","label":"播客","total":24,"tags":"播客 麦克风 直播 podcast mic live","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg","21.svg","22.svg","23.svg","24.svg"],"note":null},
    {"k":"icon","en":"Icons","label":"图标","total":24,"tags":"图标 icon 符号","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg","21.svg","22.svg","23.svg","24.svg"],"note":null},
    {"k":"summer","en":"Summer","label":"夏日","total":13,"tags":"夏日 海滩 太阳 summer beach","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg"],"note":null},
    {"k":"gesture","en":"Gestures","label":"手势","total":13,"tags":"手势 手 指 点赞 鼓掌 祈祷 握手 爱心 胜利 gesture hand point thumbs clap pray handshake heart victory","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg"],"note":null},
    {"k":"arrow","en":"Arrows & Pointers","label":"箭头指针","total":24,"tags":"箭头 指针 光标 arrow pointer","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg","21.svg","22.svg","23.svg","24.svg"],"note":null},
    {"k":"hand","en":"Hand-drawn","label":"手绘","total":8,"tags":"手绘 涂鸦 灯泡 相机 爱心 消息 星星 火箭 铃铛 清单 hand drawn doodle bulb camera heart message star rocket bell checklist","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg"],"note":null},
    {"k":"birthday","en":"Happy Birthday","label":"生日","total":4,"tags":"生日 蛋糕 庆祝 birthday cake","files":["01.svg","02.svg","03.svg","04.svg"],"note":null},
    {"k":"finance","en":"Finance","label":"金融","total":20,"tags":"金融 货币 图表 finance money chart","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg"],"note":null},
    {"k":"fitness","en":"Fitness","label":"健身","total":19,"tags":"健身 运动 fitness gym sport","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg"],"note":null},
    {"k":"seasonal","en":"Seasonal","label":"季节","total":24,"tags":"季节 节日 圣诞 万圣 seasonal holiday","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg","20.svg","21.svg","22.svg","23.svg","24.svg"],"note":null},
    {"k":"school","en":"Back To School","label":"开学季","total":19,"tags":"开学 文具 书本 school","files":["01.svg","02.svg","03.svg","04.svg","05.svg","06.svg","07.svg","08.svg","09.svg","10.svg","11.svg","12.svg","13.svg","14.svg","15.svg","16.svg","17.svg","18.svg","19.svg"],"note":null},
    {"k":"cta","en":"CTA","label":"CTA 弹窗","total":32,"tags":"CTA 弹窗 按钮 订阅 关注 点赞 评论 分享 收藏 购买 优惠 subscribe follow like comment share buy shop button","files":["subscribe.svg","subscribeZh.svg","subscribed.svg","subscribedZh.svg","notify.svg","notifyZh.svg","like.svg","likeZh.svg","comment.svg","commentZh.svg","share.svg","shareZh.svg","save.svg","saveZh.svg","follow.svg","followZh.svg","buyNow.svg","buyNowZh.svg","shopNow.svg","shopNowZh.svg","offer.svg","offerZh.svg","freeGift.svg","freeGiftZh.svg","linkInBio.svg","linkInBioZh.svg","watchNext.svg","watchNextZh.svg","tickets.svg","ticketsZh.svg","learnMore.svg","learnMoreZh.svg"],"note":"Tabler Icons · MIT ＋ 随包 OFL 字体转曲"}
  ];
  const ANIM = [
    {"k":"dyn-collage","en":"Collage","label":"拼贴","total":18,"tags":"拼贴 剪贴 心 星 collage heart star","files":["01.json","02.json","03.json","04.json","05.json","06.json","07.json","08.json","09.json","10.json","11.json","12.json","13.json","14.json","15.json","16.json","17.json","18.json"],"note":"Google Noto Animated Emoji · CC BY 4.0 · Lottie","anim":true},
    {"k":"dyn-emoji","en":"Emoji","label":"表情","total":18,"tags":"表情 笑脸 emoji face","files":["01.json","02.json","03.json","04.json","05.json","06.json","07.json","08.json","09.json","10.json","11.json","12.json","13.json","14.json","15.json","16.json","17.json","18.json"],"note":"Google Noto Animated Emoji · CC BY 4.0 · Lottie","anim":true},
    {"k":"dyn-grow","en":"Growth","label":"生长","total":14,"tags":"生长 增长 图表 火箭 growth chart rocket","files":["01.json","02.json","03.json","04.json","05.json","06.json","07.json","08.json","09.json","10.json","11.json","12.json","13.json","14.json"],"note":"Google Noto Animated Emoji · CC BY 4.0 · Lottie","anim":true},
    {"k":"dyn-holiday","en":"Holiday","label":"假日","total":14,"tags":"假日 节日 庆祝 holiday party celebration","files":["01.json","02.json","03.json","04.json","05.json","06.json","07.json","08.json","09.json","10.json","11.json","12.json","13.json","14.json"],"note":"Google Noto Animated Emoji · CC BY 4.0 · Lottie","anim":true},
    {"k":"dyn-work","en":"Work","label":"工作","total":17,"tags":"工作 办公 work office","files":["01.json","02.json","03.json","04.json","05.json","06.json","07.json","08.json","09.json","10.json","11.json","12.json","13.json","14.json","15.json","16.json","17.json"],"note":"Google Noto Animated Emoji · CC BY 4.0 · Lottie","anim":true}
  ];

  /** 核心那十款矢量贴纸（`layers` 的坐标是 0..1，画的时候乘格子边长） */
  const BUILTIN = [
    {id: 'badge_check', name: '对勾徽章', tags: '对勾 通过 check', layers: [{fill: '#22C55E', d: 'M0.5 0.04C0.754 0.04 0.96 0.246 0.96 0.5C0.96 0.754 0.754 0.96 0.5 0.96C0.246 0.96 0.04 0.754 0.04 0.5C0.04 0.246 0.246 0.04 0.5 0.04Z'}, {stroke: '#FFFFFF', w: 0.1, d: 'M0.28 0.51L0.44 0.67L0.73 0.33'}]},
    {id: 'badge_cross', name: '叉号徽章', tags: '叉 错误 cross', layers: [{fill: '#EF4444', d: 'M0.5 0.04C0.754 0.04 0.96 0.246 0.96 0.5C0.96 0.754 0.754 0.96 0.5 0.96C0.246 0.96 0.04 0.754 0.04 0.5C0.04 0.246 0.246 0.04 0.5 0.04Z'}, {stroke: '#FFFFFF', w: 0.1, d: 'M0.33 0.33L0.67 0.67'}, {stroke: '#FFFFFF', w: 0.1, d: 'M0.67 0.33L0.33 0.67'}]},
    {id: 'star_burst', name: '爆闪星', tags: '星 爆闪 star', layers: [{fill: '#FACC15', d: 'M0.5 0.01L0.585 0.181L0.745 0.076L0.733 0.267L0.924 0.255L0.819 0.415L0.99 0.5L0.819 0.585L0.924 0.745L0.733 0.733L0.745 0.924L0.585 0.819L0.5 0.99L0.415 0.819L0.255 0.924L0.267 0.733L0.076 0.745L0.181 0.585L0.01 0.5L0.181 0.415L0.076 0.255L0.267 0.267L0.255 0.076L0.415 0.181Z'}, {fill: '#F97316', d: 'M0.5 0.3C0.61 0.3 0.7 0.39 0.7 0.5C0.7 0.61 0.61 0.7 0.5 0.7C0.39 0.7 0.3 0.61 0.3 0.5C0.3 0.39 0.39 0.3 0.5 0.3Z'}]},
    {id: 'speech_bubble', name: '对话气泡', tags: '气泡 对话 bubble', layers: [{fill: '#FFFFFF', d: 'M0.17 0.06L0.83 0.06C0.907 0.06 0.97 0.123 0.97 0.2L0.97 0.58C0.97 0.657 0.907 0.72 0.83 0.72L0.46 0.72L0.24 0.96L0.3 0.72L0.17 0.72C0.093 0.72 0.03 0.657 0.03 0.58L0.03 0.2C0.03 0.123 0.093 0.06 0.17 0.06Z'}, {stroke: '#111827', w: 0.05, d: 'M0.17 0.06L0.83 0.06C0.907 0.06 0.97 0.123 0.97 0.2L0.97 0.58C0.97 0.657 0.907 0.72 0.83 0.72L0.46 0.72L0.24 0.96L0.3 0.72L0.17 0.72C0.093 0.72 0.03 0.657 0.03 0.58L0.03 0.2C0.03 0.123 0.093 0.06 0.17 0.06Z'}]},
    {id: 'heart', name: '心形', tags: '心 喜欢 heart', layers: [{fill: '#EF4444', d: 'M0.5 0.93C0.34 0.79 0.05 0.6 0.05 0.35C0.05 0.17 0.19 0.06 0.32 0.06C0.41 0.06 0.48 0.12 0.5 0.2C0.52 0.12 0.59 0.06 0.68 0.06C0.81 0.06 0.95 0.17 0.95 0.35C0.95 0.6 0.66 0.79 0.5 0.93Z'}]},
    {id: 'bolt', name: '闪电', tags: '闪电 快 bolt', layers: [{fill: '#FACC15', d: 'M0.6 0.02L0.19 0.56L0.43 0.56L0.38 0.98L0.79 0.44L0.55 0.44Z'}, {stroke: '#B45309', w: 0.035, d: 'M0.6 0.02L0.19 0.56L0.43 0.56L0.38 0.98L0.79 0.44L0.55 0.44Z'}]},
    {id: 'pin', name: '图钉', tags: '图钉 定位 pin', layers: [{fill: '#EF4444', d: 'M0.2 0.34C0.2 0.174 0.334 0.04 0.5 0.04C0.666 0.04 0.8 0.174 0.8 0.34C0.8 0.5 0.62 0.72 0.5 0.98C0.38 0.72 0.2 0.5 0.2 0.34Z'}, {fill: '#FFFFFF', d: 'M0.5 0.225C0.564 0.225 0.615 0.276 0.615 0.34C0.615 0.404 0.564 0.455 0.5 0.455C0.436 0.455 0.385 0.404 0.385 0.34C0.385 0.276 0.436 0.225 0.5 0.225Z'}]},
    {id: 'sparkle', name: '闪光', tags: '闪光 星光 sparkle', layers: [{fill: '#FDE047', d: 'M0.42 0.02L0.491 0.329L0.8 0.4L0.491 0.471L0.42 0.78L0.349 0.471L0.04 0.4L0.349 0.329ZM0.78 0.53L0.815 0.685L0.97 0.72L0.815 0.755L0.78 0.91L0.745 0.755L0.59 0.72L0.745 0.685ZM0.2 0.68L0.226 0.794L0.34 0.82L0.226 0.846L0.2 0.96L0.174 0.846L0.06 0.82L0.174 0.794Z'}]},
    {id: 'arrow_curved', name: '弯箭头', tags: '箭头 弯 arrow', layers: [{stroke: '#111827', w: 0.07, d: 'M0.1 0.84C0.18 0.36 0.5 0.13 0.8 0.26'}, {fill: '#111827', d: 'M0.902 0.301L0.742 0.317L0.797 0.178Z'}]},
    {id: 'crown', name: '皇冠', tags: '皇冠 王冠 crown', layers: [{fill: '#FACC15', d: 'M0.06 0.78L0.06 0.26L0.28 0.5L0.5 0.14L0.72 0.5L0.94 0.26L0.94 0.78Z'}, {fill: '#F59E0B', d: 'M0.11 0.75L0.89 0.75C0.918 0.75 0.94 0.772 0.94 0.8L0.94 0.9C0.94 0.928 0.918 0.95 0.89 0.95L0.11 0.95C0.082 0.95 0.06 0.928 0.06 0.9L0.06 0.8C0.06 0.772 0.082 0.75 0.11 0.75Z'}]},
  ];

  /** 一张贴纸的完整路径。`files` 里存的是后缀，前缀恒等于包的 slug。 */
  function src(pack, file) { return (pack.anim ? ANIM_DIR : DIR) + pack.k + '-' + file; }
  /** 一个包的全部贴纸：`{id, pack, src, alt}` */
  function list(pack) {
    return pack.files.map((f, i) => ({id: pack.k + '-' + f, pack: pack, file: f,
      src: src(pack, f), alt: pack.label + ' ' + (i + 1), anim: !!pack.anim,
      motion: null}));
  }
  const find = (k) => PACKS.concat(ANIM).filter((p) => p.k === k)[0] || null;
  /** 有素材的静态包（品牌标识包在目录里如实列名，但一张都不收） */
  const mirrored = () => PACKS.filter((p) => p.files.length > 0);
  /** All 视图那一屏：按包轮流取，不是取列表前 n 张——否则整屏都是第一个包 */
  function head(n, per, from) {
    const out = [];
    const packs = from || mirrored();
    for (let i = 0; i < (per || 2); i++) {
      packs.forEach((p) => { if (p.files[i]) out.push(list(p)[i]); });
    }
    return out.slice(0, n || 12);
  }
  const match = (p, k) => (p.label + ' ' + p.en + ' ' + p.tags).toLowerCase().indexOf(k) >= 0;
  /** 搜索：分类名（中文与英文）与检索词，命中就把整包铺出来 */
  function search(q) {
    const k = String(q || '').trim().toLowerCase();
    if (!k) return mirrored();
    return mirrored().filter((p) => match(p, k));
  }
  function searchAnim(q) {
    const k = String(q || '').trim().toLowerCase();
    if (!k) return ANIM;
    return ANIM.filter((p) => match(p, k));
  }
  const total = () => PACKS.concat(ANIM).reduce((n, p) => n + p.files.length, 0);

  window.BC_SK = {DIR, ANIM_DIR, PACKS, ANIM, BUILTIN, P, A, src, list, find, mirrored, head,
    search, searchAnim, total};
})();
