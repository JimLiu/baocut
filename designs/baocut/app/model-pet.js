/* model-pet.js —— Codex Pet 雪碧图的纯模型（第 242 轮）。

   Codex Pet 是 ChatGPT / Codex 桌面端那只桌宠的素材格式：一份 `pet.json`
   （`displayName` / `description` / `spriteVersionNumber` / `spritesheetPath`）
   加一张 WebP 雪碧图。图集固定 **8 列、格子 192×208**，每一行是一种状态，
   帧序从左到右；v1 九行（1536×1872），v2 多两行「看向」（1536×2288）。每帧
   的停留时长不是等长的，逐状态一张表（毫秒），照抄 awesome-codex-pet 的
   `README` 与它的 `validate.mjs`：

   | 行 | 状态          | 帧时长（ms）                    |
   | -- | ------------- | ------------------------------- |
   | 0  | idle          | 280 110 110 140 140 320         |
   | 1  | running-right | 120 ×7 220                      |
   | 2  | running-left  | 120 ×7 220                      |
   | 3  | waving        | 140 140 140 280                 |
   | 4  | jumping       | 140 140 140 140 280             |
   | 5  | failed        | 140 ×7 240                      |
   | 6  | waiting       | 150 ×5 260                      |
   | 7  | running       | 120 ×5 220                      |
   | 8  | review        | 150 ×5 280                      |
   | 9  | look-000-157  | 160 ×7 260（v2）                |
   | 10 | look-180-337  | 160 ×7 260（v2）                |

   这一层只做算术与校验：给一个时刻算出该显示第几格（`frameAt`）、把格子换算
   成 CSS `background-position/size`（`bgStyle`）、判一份 `pet.json` 合不合规
   （`validatePetJson`）、从 zip 的文件名表里挑出那两份文件（`pickEntries`）。
   不碰 DOM、不解 zip（那是 JSZip 与视图层的事）、不发网络请求。

   目录那半（官方 9 只 + awesome-codex-pet 社区索引 239 只）的数据在生成物
   [model-pet-catalog.js](model-pet-catalog.js)（`BC_PETCAT`），这里只放按分类
   取 / 搜索 / 拼远端 URL 的函数，数据作参数传进来，`node --test` 不用先加载
   目录也能测算术。

   播放判据与 Lottie 同一条：舞台上的帧由播放头（`playT − start`）决定，不走
   自己的时钟，导出与预览才能对得上帧。 */
(function () {
  const COLS = 8;
  const CELL = {w: 192, h: 208};
  /** 版本 → 行数。缺省 / 1 是 v1，2 是 v2。 */
  const ROWS = {1: 9, 2: 11};

  const rep = (ms, n, last) => Array.from({length: n}, () => ms).concat([last]);
  /** 状态表：行号即数组下标。`v2` 标出只有 v2 图集才有的两行。 */
  const STATES = [
    {key: 'idle',          row: 0,  label: '待机',   frames: [280, 110, 110, 140, 140, 320]},
    {key: 'running-right', row: 1,  label: '右跑',   frames: rep(120, 7, 220)},
    {key: 'running-left',  row: 2,  label: '左跑',   frames: rep(120, 7, 220)},
    {key: 'waving',        row: 3,  label: '挥手',   frames: [140, 140, 140, 280]},
    {key: 'jumping',       row: 4,  label: '跳跃',   frames: [140, 140, 140, 140, 280]},
    {key: 'failed',        row: 5,  label: '失败',   frames: rep(140, 7, 240)},
    {key: 'waiting',       row: 6,  label: '等待',   frames: rep(150, 5, 260)},
    {key: 'running',       row: 7,  label: '奔跑',   frames: rep(120, 5, 220)},
    {key: 'review',        row: 8,  label: '审阅',   frames: rep(150, 5, 280)},
    {key: 'look-000-157',  row: 9,  label: '看向左', frames: rep(160, 7, 260), v2: true},
    {key: 'look-180-337',  row: 10, label: '看向右', frames: rep(160, 7, 260), v2: true},
  ];
  const STATE_BY_KEY = {};
  STATES.forEach((s) => { STATE_BY_KEY[s.key] = s; });
  /** 默认状态：目录格子与舞台都先放待机那一行（缩略图 = 第 0 行第 0 格）。 */
  const DEFAULT_STATE = 'idle';

  /** `spriteVersionNumber` → 1 / 2；认不出的值给 `null`。缺省算 v1（老 pet 没这一格）。 */
  function versionOf(pet) {
    const v = pet && pet.spriteVersionNumber;
    if (v === undefined || v === null) return 1;
    if (v === 1 || v === 2) return v;
    return null;
  }

  /** 整张图集的像素尺寸。 */
  function sheetSize(version) {
    const rows = ROWS[version] || ROWS[1];
    return {w: COLS * CELL.w, h: rows * CELL.h};
  }

  /** 一张图集的实测尺寸对不对得上它声明的版本。 */
  function checkSheet(version, w, h) {
    const want = sheetSize(version);
    return Number(w) === want.w && Number(h) === want.h;
  }

  /** 状态定义；认不出的 key 回落待机。给 `version` 时 v1 图集上的 v2 行也回落。 */
  function stateOf(key, version) {
    const s = STATE_BY_KEY[key] || STATE_BY_KEY[DEFAULT_STATE];
    if (s.v2 && version === 1) return STATE_BY_KEY[DEFAULT_STATE];
    return s;
  }

  /** 可选的状态列表（按版本裁掉 v2 那两行）。 */
  function statesFor(version) {
    return STATES.filter((s) => !s.v2 || version !== 1);
  }

  /** 一轮的总时长（毫秒）。 */
  function cycleMs(key, version) {
    return stateOf(key, version).frames.reduce((a, b) => a + b, 0);
  }

  /** 某时刻（毫秒，从这件元素起点算）该显示的格子。循环播放；负数当 0。 */
  function frameAt(key, ms, version) {
    const s = stateOf(key, version);
    const total = s.frames.reduce((a, b) => a + b, 0);
    let t = Number(ms) || 0;
    if (t < 0) t = 0;
    t = total > 0 ? t % total : 0;
    let col = 0;
    for (let i = 0; i < s.frames.length; i += 1) {
      if (t < s.frames[i]) { col = i; break; }
      t -= s.frames[i];
      col = i;
    }
    return {col: col, row: s.row, index: col, count: s.frames.length};
  }

  /** 格子 → CSS 背景定位（百分比，元素自身按 192:208 定形）。
      `background-size` 是 `列数×100% 行数×100%`，`background-position` 用
      `col/(列数−1)`、`row/(行数−1)` 的百分比——CSS 百分比定位的语义正好是
      「把第 k 格对齐到盒子」，所以不依赖盒子的像素尺寸。 */
  function bgStyle(col, row, version) {
    const rows = ROWS[version] || ROWS[1];
    const x = COLS > 1 ? (col / (COLS - 1)) * 100 : 0;
    const y = rows > 1 ? (row / (rows - 1)) * 100 : 0;
    return {
      backgroundSize: (COLS * 100) + '% ' + (rows * 100) + '%',
      backgroundPosition: x.toFixed(4).replace(/\.?0+$/, '') + '% ' + y.toFixed(4).replace(/\.?0+$/, '') + '%',
    };
  }

  /** 缩略图那一格（待机第 0 帧）的背景定位。 */
  function posterStyle(version) { return bgStyle(0, 0, version); }

  /* ---------- pet.json 校验 ---------- */

  const REASONS = {
    json: '这份 zip 里没有 pet.json',
    sheet: '这份 zip 里没有 spritesheet.webp',
    parse: 'pet.json 不是合法的 JSON',
    shape: 'pet.json 缺 displayName 或 spritesheetPath',
    version: 'spriteVersionNumber 只认 1 或 2',
    path: 'spritesheetPath 必须指向 zip 里那张 .webp',
    size: '雪碧图尺寸与声明的版本不符（v1 1536×1872，v2 1536×2288）',
  };

  /** 校验一份已解析的 `pet.json`。合规时给出 `{ok, version, name, description}`。 */
  function validatePetJson(pet) {
    if (!pet || typeof pet !== 'object' || Array.isArray(pet)) return {ok: false, reason: REASONS.shape};
    const name = typeof pet.displayName === 'string' ? pet.displayName.trim() : '';
    const path = typeof pet.spritesheetPath === 'string' ? pet.spritesheetPath.trim() : '';
    if (!name || !path) return {ok: false, reason: REASONS.shape};
    const version = versionOf(pet);
    if (!version) return {ok: false, reason: REASONS.version};
    if (!/\.webp$/i.test(path) || path.indexOf('..') >= 0) return {ok: false, reason: REASONS.path};
    return {
      ok: true, version: version, name: name,
      description: typeof pet.description === 'string' ? pet.description.trim() : '',
      sheetPath: path,
    };
  }

  /** 解析 `pet.json` 文本并校验。 */
  function parsePetJson(text) {
    let data;
    try { data = JSON.parse(String(text).replace(/^﻿/, '')); }
    catch (e) { return {ok: false, reason: REASONS.parse}; }
    return validatePetJson(data);
  }

  /** 从 zip 的条目名表里挑出 `pet.json` 与雪碧图。

      awesome-codex-pet 的 zip 长成 `pets/<slug>/{submission.json,pet.json,spritesheet.webp}`，
      用户自己打的包多半在根目录；两种都收：先找 `pet.json`（最浅的那份），再在
      它的同级目录里找 `spritesheetPath` 指的文件（缺 `sheetPath` 时按
      `spritesheet.webp`）。`__MACOSX/` 与点文件跳过。 */
  function pickEntries(names, sheetPath) {
    const list = (names || []).filter((n) => typeof n === 'string' && !/(^|\/)(__MACOSX|\.)/.test(n) && !n.endsWith('/'));
    const jsons = list.filter((n) => /(^|\/)pet\.json$/i.test(n))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
    if (!jsons.length) return {ok: false, reason: REASONS.json};
    const json = jsons[0];
    const dir = json.slice(0, json.lastIndexOf('/') + 1);
    const want = (sheetPath || 'spritesheet.webp').replace(/^\.?\//, '');
    const sheet = list.find((n) => n === dir + want) || list.find((n) => n.startsWith(dir) && /\.webp$/i.test(n));
    if (!sheet) return {ok: false, reason: REASONS.sheet};
    return {ok: true, json: json, sheet: sheet, dir: dir};
  }

  /* ---------- 目录（数据在 BC_PETCAT，这里只有函数） ---------- */

  const PREVIEW_BASE = 'https://codexpet.top/assets/previews/';
  const RAW_BASE = 'https://raw.githubusercontent.com/legeling/awesome-codex-pet/main/pets/';
  const REPO_URL = 'https://github.com/legeling/awesome-codex-pet';

  /** 社区 pet 的静态缩略图（待机第 0 帧，站点预渲染）。 */
  function thumbUrl(slug) { return PREVIEW_BASE + encodeURIComponent(slug) + '/thumbnail.webp'; }
  /** 社区 pet 某一状态的动图 webp（`<img>` 原生就会放）。 */
  function previewUrl(slug, state) {
    return PREVIEW_BASE + encodeURIComponent(slug) + '/webp/' + (state || DEFAULT_STATE) + '.webp';
  }
  /** 社区 pet 的整张雪碧图（上时间轴时才取，目录不预载）。 */
  function sheetUrl(slug) { return RAW_BASE + encodeURIComponent(slug) + '/spritesheet.webp'; }
  /** 仓库里那只 pet 的目录页。 */
  function repoUrl(slug) { return REPO_URL + '/tree/main/pets/' + encodeURIComponent(slug); }

  /** 某分类下的社区 pet（`cat` 是分类 slug；`'all'` / 空给全部）。 */
  function byCategory(pets, cat) {
    const list = pets || [];
    if (!cat || cat === 'all') return list;
    return list.filter((p) => p.cat === cat);
  }

  /** 名字（中英）/ 作者 / slug 的子串搜索，大小写不敏感。 */
  function search(pets, q) {
    const s = String(q || '').trim().toLowerCase();
    if (!s) return pets || [];
    return (pets || []).filter((p) => [p.name, p.zh, p.author, p.handle, p.slug]
      .some((f) => typeof f === 'string' && f.toLowerCase().indexOf(s) >= 0));
  }

  /** 展示名：有中文名且当前是中文界面就用中文，否则英文。 */
  function displayName(p) { return (p && (p.zh || p.name)) || ''; }

  /** 署名串：`作者 · 许可`。许可缺省时只写作者。 */
  function attribution(p) {
    if (!p) return '';
    const parts = [];
    if (p.author) parts.push(p.author);
    if (p.license) parts.push(p.license);
    return parts.join(' · ');
  }

  /** 许可是不是明确禁止商用（awesome-codex-pet 里大半是 CC BY-NC 或手写「non-commercial」）。 */
  function nonCommercial(license) {
    const s = String(license || '').toLowerCase();
    return /\bnc\b|non-?commercial|非商/.test(s);
  }

  /** 目录格子 → 舞台样式袋里的 `pet` 元数据（版本、名字、署名跟着元素走，
      导出与属性页都能读到，不用回目录查）。 */
  function meta(p, extra) {
    return Object.assign({
      version: (p && p.version) || 1,
      state: DEFAULT_STATE,
      name: (p && (p.name || p.zh)) || '',
      author: (p && p.author) || '',
      license: (p && p.license) || '',
    }, extra || {});
  }

  Object.assign(window, {BC_PET: {
    COLS, CELL, ROWS, STATES, STATE_BY_KEY, DEFAULT_STATE, REASONS,
    PREVIEW_BASE, RAW_BASE, REPO_URL,
    versionOf, sheetSize, checkSheet, stateOf, statesFor, cycleMs, frameAt, bgStyle, posterStyle,
    validatePetJson, parsePetJson, pickEntries,
    thumbUrl, previewUrl, sheetUrl, repoUrl, byCategory, search, displayName, attribution, nonCommercial, meta,
  }});
})();
