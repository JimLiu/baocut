/* 原型装的两份演示样式包（caption-editor-redesign §7），只为把样式库的「样式包」来源、模板卡、
   调整页与适配判定画出来。不复刻任何现成模板，名字也不借谁的；BaoCut 仓库不随附第三方样式包。

   每份样式挑一样调整页要演示的东西：
     · 斜贴大字   拉丁字体（中文轨上标字体提示）、字距调过（换字体时提示）、念到时弹出
     · 综艺闪字   读 `keyword` 词标签（调整页出现「关键词」）、动画里有两种颜色
     · 随机贴纸   随 seed 变（「换一版」）
     · 手账便签   纸张底板 ＋ 油墨纹理 ＋ 材质，不要逐词时间
     · 三行标题   固定三词一页、上一下二
     · 安静一行   上下位置由模板参数决定（位置那一行报「调不了」）
     · 霓虹灯管   发光 ＋ 内阴影 ＋ 纹理，当前词发光
     · 火花迸发   要一样这台设备没有的能力（卡不可套用）
     · 金色片名   渐变字身、两层描边、字距调过、循环慢推

   场景草图的形状见 model-sceneadjust.js。颜色是画进视频画面的内容色，按文件登记在
   `_ds_conformance.json`。 */
(function () {
  const SCHEMA = 'baocut.caption-style-pack/1';
  const font = (family, weight, more) => Object.assign({key: 'f0', family, weight: weight || 400}, more || {});

  const headline = {
    schema: SCHEMA, id: 'demo-headline', version: '1.2.0',
    name: {'zh-Hans': '演示包 · 标题与综艺', en: 'Demo pack · Headlines'},
    publisher: 'BaoCut 演示', license: 'CC0-1.0',
    categories: [
      {id: 'title', name: {'zh-Hans': '标题', en: 'Titles'}},
      {id: 'variety', name: {'zh-Hans': '综艺', en: 'Variety'}},
      {id: 'journal', name: {'zh-Hans': '手账', en: 'Journal'}},
    ],
    styles: [
      {id: 'tilt-pop', revision: 3, name: {'zh-Hans': '斜贴大字', en: 'Tilt pop'}, categories: ['title'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('Bangers', 400, {tunedSpacing: true})],
          text: {upper: true, spacing: 4, lh: 105},
          paints: [
            {kind: 'shadow', color: '#1A0B2ECC', offset: [0.06, 0.08], blur: 0},
            {kind: 'stroke', color: '#1A0B2E', width: 0.07},
            {kind: 'stroke', color: '#FFFFFF', width: 0.04},
            {kind: 'fill', color: '#FFD23F'},
          ],
          states: {active: {mode: 'pop', color: '#FF4D8D', scale: 1.25}},
          animation: {in: 'elastic-pop'},
          layout: {x: 0.5, y: 0.8, width: 0.86},
        }},
      {id: 'variety-flash', revision: 2, name: {'zh-Hans': '综艺闪字', en: 'Variety flash'}, categories: ['variety'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('ZCOOL KuaiLe'), {key: 'f1', family: 'Archivo Black', weight: 400}],
          text: {lh: 110},
          paints: [
            {kind: 'stroke', color: '#000000', width: 0.08},
            {kind: 'stroke', color: '#FFFFFF', width: 0.05},
            {kind: 'fill', color: '#2B2B2B'},
          ],
          states: {active: {mode: 'color', color: '#FF3B30'}, keyword: {color: '#FFE600', font: 'f1', scale: 1.4, bold: true}},
          animation: {in: 'pop', colors: ['#FF3B30', '#FFE600']},
          wordTags: ['keyword'],
          layout: {x: 0.5, y: 0.82, width: 0.9},
        }},
      {id: 'sticker-random', revision: 1, name: {'zh-Hans': '随机贴纸', en: 'Random sticker'}, categories: ['variety'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('Rubik', 900)],
          paints: [
            {kind: 'shadow', color: '#00000080', offset: [0, 0.05], blur: 0.08},
            {kind: 'stroke', color: '#FFFFFF', width: 0.09},
            {kind: 'fill', color: '#1E1E1E'},
          ],
          states: {active: {mode: 'box', color: '#1E1E1E', box: {color: '#FFC93C', radius: 0.2, padding: [0.18, 0.06]}}},
          animation: {in: 'pop'},
          seeded: true, seedPalette: ['#FFC93C', '#7BE495', '#7FC8FF', '#FF8FB1'],
          layout: {x: 0.5, y: 0.8, width: 0.86},
        }},
      {id: 'note-paper', revision: 1, name: {'zh-Hans': '手账便签', en: 'Note paper'}, categories: ['journal'],
        fonts: [], resources: [{sha256: 'demo', path: 'textures/paper-grain.png'}],
        scene: {
          fonts: [font('Ma Shan Zheng')],
          text: {lh: 125},
          paints: [
            {kind: 'plate', color: '#FFF4D6', opacity: 92, corners: 10, shape: 'line'},
            {kind: 'material', name: 'paper-grain', color: '#E9DCC0'},
            {kind: 'fill', texture: 'ink'},
          ],
          states: {},
          animation: {in: 'fade-up'},
          layout: {x: 0.5, y: 0.84, width: 0.8},
        }},
      {id: 'three-line', revision: 2, name: {'zh-Hans': '三行标题', en: 'Three-line title'}, categories: ['title'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('Anton')],
          text: {upper: true, lh: 100},
          paints: [
            {kind: 'shadow', color: '#000000B3', offset: [0, 0.06], blur: 0.1},
            {kind: 'stroke', color: '#000000', width: 0.05},
            {kind: 'fill', color: '#FFFFFF'},
          ],
          states: {active: {mode: 'color', color: '#3DF5A4'}, unread: {opacity: 0.45}},
          animation: {in: 'line-slide'},
          pagination: {mode: 'fixed', wordsPerPage: 3, rows: [1, 2]},
          layout: {x: 0.5, y: 0.5, width: 0.7},
        }},
    ],
  };

  const night = {
    schema: SCHEMA, id: 'demo-night', version: '0.9.0',
    name: {'zh-Hans': '演示包 · 夜景与极简', en: 'Demo pack · Night and minimal'},
    publisher: 'BaoCut 演示', license: 'CC0-1.0',
    categories: [
      {id: 'minimal', name: {'zh-Hans': '极简', en: 'Minimal'}},
      {id: 'night', name: {'zh-Hans': '夜景', en: 'Night'}},
    ],
    styles: [
      {id: 'quiet-line', revision: 1, name: {'zh-Hans': '安静一行', en: 'Quiet line'}, categories: ['minimal'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('Noto Sans SC', 500)],
          text: {spacing: 2, lh: 120},
          paints: [
            {kind: 'shadow', color: '#00000066', offset: [0, 0.03], blur: 0.08},
            {kind: 'fill', color: '#F5F5F5'},
          ],
          states: {},
          animation: {in: 'fade-up'},
          layout: {x: 0.5, y: {param: 'baseline'}, width: 0.8},
        }},
      {id: 'gold-film', revision: 4, name: {'zh-Hans': '金色片名', en: 'Gold title'}, categories: ['minimal'],
        fonts: [], resources: [],
        scene: {
          fonts: [font('Noto Serif SC', 700, {tunedSpacing: true})],
          text: {spacing: 12, lh: 120},
          paints: [
            {kind: 'shadow', color: '#000000B3', offset: [0, 0.05], blur: 0.12},
            {kind: 'stroke', color: '#2B1A00', width: 0.03},
            {kind: 'stroke', color: '#FFF8E1', width: 0.012},
            {kind: 'fill', gradient: {angle: 180, stops: [[0, '#FFF3C4'], [0.5, '#E8B64A'], [1, '#9C6A12']]}},
          ],
          states: {},
          animation: {in: 'feather', loop: 'slow-push'},
          layout: {x: 0.5, y: 0.5, width: 0.8},
        }},
      {id: 'neon-tube', revision: 2, name: {'zh-Hans': '霓虹灯管', en: 'Neon tube'}, categories: ['night'],
        fonts: [], resources: [{sha256: 'demo', path: 'textures/neon-tube.png'}],
        scene: {
          fonts: [font('Montserrat', 600)],
          text: {upper: true, spacing: 6},
          paints: [
            {kind: 'glow', color: '#FF2BD6', radius: 0.45, strength: 0.9},
            {kind: 'stroke', color: '#FF2BD6', width: 0.03},
            {kind: 'fill', texture: 'neon-tube'},
            {kind: 'inner-shadow', color: '#FF2BD680', offset: [0, 0.04], blur: 0.06},
          ],
          states: {active: {mode: 'glow', color: '#FFFFFF', glow: {color: '#7DF9FF', radius: 0.5}}},
          animation: {loop: 'pulse'},
          layout: {x: 0.5, y: 0.78, width: 0.86},
        }},
      {id: 'spark-burst', revision: 1, name: {'zh-Hans': '火花迸发', en: 'Spark burst'}, categories: ['night'],
        requires: ['caption-particle-burst/1'], fonts: [], resources: [],
        scene: {
          fonts: [font('Archivo Black')],
          paints: [
            {kind: 'glow', color: '#FFB13D', radius: 0.3, strength: 0.7},
            {kind: 'stroke', color: '#2A1300', width: 0.05},
            {kind: 'fill', color: '#FFF1D6'},
          ],
          states: {active: {mode: 'pop', color: '#FFB13D', scale: 1.2}},
          animation: {in: 'pop'},
          decorations: true,
          layout: {x: 0.5, y: 0.8, width: 0.86},
        }},
    ],
  };

  window.BC_PACK_DEMO = [headline, night];
})();
