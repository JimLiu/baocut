// i18n-ignore-file: 给模型的工具说明、错误与下一步
import { z } from 'zod';

/**
 * `edits_apply` 的操作族（命令与协议规范 §4.2）：每个操作的说明、参数的 JSON Schema 与一个最小示例，`edits_ops` 原样列出，
 * `edits_apply` 的说明由这里的说明拼成，两边不会走样。
 *
 * schema 描述的是智能体写的形态（`normalizeOperations` 补成引擎的标准形态之前）：时间写秒数，`sequenceId` 与 `alignment` 可以省略。
 * 字段的取值与适用范围仍由引擎校验，这里只给出形状、取值与说明，`edits_apply` 不按它预先拒绝。
 */

/** 操作族：与命令与协议规范 §4.2 的表同一套分法（只列智能体能用的）。 */
export const OPERATION_FAMILIES = [
  'assets',
  'items',
  'styles',
  'transitions-and-effects',
  'chapters-and-ducking',
  'speech',
  'code',
  'tracks-and-sequences',
  'documents-and-versions',
] as const;
export type OperationFamily = (typeof OPERATION_FAMILIES)[number];

export interface EditOperationSpec {
  type: string;
  family: OperationFamily;
  /** `edits_apply` 说明里的那一（几）行：形态与语义。 */
  doc: readonly string[];
  schema: z.ZodType;
  example: Record<string, unknown>;
}

const idOf = (what: string) => z.string().min(1).describe(what);
const time = z
  .union([
    z.number(),
    z.string(),
    z.object({
      unit: z.enum(['frames', 'seconds']).describe('frames（帧）或 seconds（十进制秒字符串）'),
      value: z.union([z.number(), z.string()]).describe('帧数或秒数'),
    }),
  ])
  .describe('时间：秒数（数字或数字字符串，例如 1.5），也可以写 {"unit":"frames","value":30}');
const seconds = z.union([z.number(), z.string()]).describe('秒数（数字或十进制字符串）');
const nullableNumber = (what: string) => z.number().nullable().optional().describe(`${what}；null 回到缺省`);
const ref = z.string().optional().describe('同一笔修改里后面的操作引用它的名字');
const assetTarget = z
  .union([idOf('素材 ID'), z.object({ assetId: idOf('素材 ID') }), z.object({ ref: z.string().describe('importAsset 的 ref') })])
  .describe('素材：素材 ID、{"assetId"} 或同一笔修改里 importAsset 的 {"ref"}');
const sequenceId = z.string().optional().describe('序列 ID；省略时用根序列');
const timed = {
  sequenceId,
  alignment: z
    .enum(['nearest-frame', 'exact-frame', 'floor-frame', 'ceil-frame'])
    .optional()
    .describe('时间对齐到帧：nearest-frame（缺省）、exact-frame、floor-frame、ceil-frame'),
};

function op(type: string, fields: z.ZodRawShape) {
  return z.object({ type: z.literal(type).describe('操作种类'), ...fields });
}

export const EDIT_OPERATIONS: readonly EditOperationSpec[] = [
  {
    type: 'importAsset',
    family: 'assets',
    doc: [
      '- {"type":"importAsset","path":"素材文件（相对工作目录或绝对路径）","name"?:"素材名","ref"?:"同一笔修改里引用它的名字","storage"?:"linked"|"managed"}：把媒体文件登记为视频的素材。默认 linked：文件留在原处、不复制，视频只记下它在哪里，之后移动或删除这个文件，素材就缺失了；给 "storage":"managed" 才把 bytes 复制进视频目录（用户要求复制进视频，或文件是你生成之后会清理的临时文件时）。',
      '- {"type":"importAsset","artifactId":"sha256:…","name"?,"ref"?}：把生成的产物（jobs_inspect 的 outputs 里的 artifactId）导入为素材，不重新生成；来源记为那次生成，bytes 总是收进视频（managed）。path 与 artifactId 只给一个。',
    ],
    schema: op('importAsset', {
      path: z.string().optional().describe('素材文件：相对工作目录或绝对路径；与 artifactId 只给一个'),
      artifactId: z.string().optional().describe('生成或下载的产物（jobs_inspect 的 outputs 里的 artifactId）；与 path 只给一个'),
      name: z.string().optional().describe('素材名'),
      ref: ref,
      storage: z
        .enum(['linked', 'managed'])
        .optional()
        .describe('linked（缺省，文件留在原处）或 managed（复制进视频目录）；产物总是 managed'),
    }),
    example: { type: 'importAsset', path: 'demo.mp4', ref: 'clip' },
  },
  {
    type: 'collectAssets',
    family: 'assets',
    doc: [
      '- {"type":"collectAssets","assetIds":["素材 ID"]}：把已经链接的素材的 bytes 收进视频目录（linked → managed），素材版本不变；已经在视频里的不做事。',
    ],
    schema: op('collectAssets', {
      assetIds: z.array(idOf('素材 ID')).min(1).describe('要收进视频目录的链接素材'),
    }),
    example: { type: 'collectAssets', assetIds: ['asset_1'] },
  },
  {
    type: 'removeAssets',
    family: 'assets',
    doc: [
      '- {"type":"removeAssets","assetIds":["素材 ID"]}：从视频里删掉没有任何引用的素材（片段与它的预渲染替身、章节缩略图、文档的来源都不再指向它）；还有引用时拒绝（details.usedBy 列出谁在用）。代码包与它烘焙出的预渲染替身成对删除。先用 assets_prune 看哪些能删。',
    ],
    schema: op('removeAssets', {
      assetIds: z.array(idOf('素材 ID')).min(1).describe('要删掉的、没有引用的素材'),
    }),
    example: { type: 'removeAssets', assetIds: ['asset_1'] },
  },
  {
    type: 'addItem',
    family: 'items',
    doc: [
      '- {"type":"addItem","asset":"素材 ID" 或 {"ref":"importAsset 的 ref"},"at"?:秒,"trackId"?,"name"?}：把素材放到时间线上；省略 at 时接在轨道末尾，省略 trackId 时用第一条未锁定的同类轨道（视频、图片放视觉轨，音频放音频轨）。',
    ],
    schema: op('addItem', {
      asset: assetTarget,
      at: time.optional().describe('开始时间；省略时接在轨道末尾'),
      trackId: idOf('轨道 ID').optional().describe('放在哪条轨道；省略时用第一条未锁定的同类轨道'),
      name: z.string().optional().describe('片段名'),
      ...timed,
    }),
    example: { type: 'addItem', asset: { ref: 'clip' }, at: 1 },
  },
  {
    type: 'moveItem',
    family: 'items',
    doc: [
      '- {"type":"moveItem","itemId","at"?:秒,"offset"?:秒,"trackId"?}：移动片段；at 是新的开始时间，offset 是相对移动（可为负），二选一。',
    ],
    schema: op('moveItem', {
      itemId: idOf('片段 ID'),
      at: time.optional().describe('新的开始时间；与 offset 二选一'),
      offset: time.optional().describe('相对移动（可为负）；与 at 二选一'),
      trackId: idOf('轨道 ID').optional().describe('移到哪条轨道；省略时不换轨'),
      ...timed,
    }),
    example: { type: 'moveItem', itemId: 'item_1', at: 5 },
  },
  {
    type: 'arrangeItem',
    family: 'items',
    doc: [
      '- {"type":"arrangeItem","itemId","direction":"forward"|"backward"|"front"|"back"}：调整画面片段的叠放次序（前移一层 / 后移一层 / 移到最前 / 移到最后）。叠放次序就是轨道的上下：与别的片段共用一条轨道时拆到相邻新建的轨道上，独占一条轨道时整条轨道挪位；已经在最前 / 最后时拒绝。',
    ],
    schema: op('arrangeItem', {
      itemId: idOf('片段 ID'),
      direction: z.enum(['forward', 'backward', 'front', 'back']).describe('forward 前移一层、backward 后移一层、front 移到最前、back 移到最后'),
      sequenceId,
    }),
    example: { type: 'arrangeItem', itemId: 'item_1', direction: 'forward' },
  },
  {
    type: 'moveItems',
    family: 'items',
    doc: ['- {"type":"moveItems","moves":[{"itemId","at"?,"offset"?,"trackId"?}]}：一次移动多个片段。'],
    schema: op('moveItems', {
      moves: z
        .array(
          z.object({
            itemId: idOf('片段 ID'),
            at: time.optional().describe('新的开始时间；与 offset 二选一'),
            offset: time.optional().describe('相对移动（可为负）'),
            trackId: idOf('轨道 ID').optional().describe('移到哪条轨道'),
          }),
        )
        .min(1)
        .describe('每个片段怎么移动'),
      ...timed,
    }),
    example: {
      type: 'moveItems',
      moves: [
        { itemId: 'item_1', offset: 2 },
        { itemId: 'item_2', offset: 2 },
      ],
    },
  },
  {
    type: 'trimItem',
    family: 'items',
    doc: ['- {"type":"trimItem","itemId","edge":"start"|"end","at":秒}：裁切片段的开头或结尾，at 是这条边在时间线上的新位置。'],
    schema: op('trimItem', {
      itemId: idOf('片段 ID'),
      edge: z.enum(['start', 'end']).describe('裁哪一边：start（开头）或 end（结尾）'),
      at: time.describe('这条边在时间线上的新位置'),
      ...timed,
    }),
    example: { type: 'trimItem', itemId: 'item_1', edge: 'end', at: 8 },
  },
  {
    type: 'splitItem',
    family: 'items',
    doc: [
      '- {"type":"splitItem","itemId","at":秒}：在时间线上的这个位置把片段一分为二；关键帧按两半各自的窗口分开，裁切时关键帧跟着内容走。',
    ],
    schema: op('splitItem', {
      itemId: idOf('片段 ID'),
      at: time.describe('在时间线上的这个位置拆开'),
      ...timed,
    }),
    example: { type: 'splitItem', itemId: 'item_1', at: 3.5 },
  },
  {
    type: 'joinItems',
    family: 'items',
    doc: [
      '- {"type":"joinItems","itemIds":["片段 ID","片段 ID"],"keep"?:"first"|"second"}：把同一轨道上首尾相接、取自同一素材且源时间连续的两个片段合并回一个（拆分的逆）；关键帧一并拼回。其余设置不一致时失败，details.keys 列出不一致的字段，再用 keep 指明取 itemIds 里第一个还是第二个的设置。',
    ],
    schema: op('joinItems', {
      itemIds: z.array(idOf('片段 ID')).length(2).describe('同一轨道上首尾相接的两个片段'),
      keep: z.enum(['first', 'second']).optional().describe('设置不一致时取 itemIds 里 first（第一个）还是 second（第二个）的'),
    }),
    example: { type: 'joinItems', itemIds: ['item_1', 'item_2'] },
  },
  {
    type: 'deleteItems',
    family: 'items',
    doc: ['- {"type":"deleteItems","itemIds":["..."]}：删除片段（不移动其他片段，留下空隙）。'],
    schema: op('deleteItems', {
      itemIds: z.array(idOf('片段 ID')).min(1).describe('要删的片段（不移动其他片段）'),
      sequenceId,
    }),
    example: { type: 'deleteItems', itemIds: ['item_1'] },
  },
  {
    type: 'removeRange',
    family: 'items',
    doc: [
      '- {"type":"removeRange","from":秒,"to":秒,"trackIds":["..."]}：波纹删除——在列出的轨道上删掉这段时间并让后面的内容前移补上（口播剪掉一句话、一段停顿）。盖住这段时间的视频、音频片段被拆开、删掉中间；文字、图片、字幕片段缩短；之后的片段前移。没列出的轨道不动，所以要连同画面一起动的配音、字幕轨都要列上；列出的轨道或要动的片段锁着时整笔失败（TARGET_LOCKED）。经被拆片段投影的字幕跟着走。',
    ],
    schema: op('removeRange', {
      from: time.describe('起点'),
      to: time.describe('终点'),
      trackIds: z.array(idOf('轨道 ID')).min(1).describe('在哪些轨道上删并前移；要一起动的配音、字幕轨都要列上'),
      ...timed,
    }),
    example: { type: 'removeRange', from: 12, to: 15.5, trackIds: ['track_v1', 'track_a1'] },
  },
  {
    type: 'updateItem',
    family: 'items',
    doc: [
      '- {"type":"updateItem","itemId","name"?,"enabled"?,"locked"?,"followPolicy"?}：改片段的名字（空字符串清掉）、启用、锁定与跟随策略。followPolicy 整个替换：{"kind":"follow-cuts"}（新建片段的缺省，跟着剪口移动、缩短）、{"kind":"sequence-fixed"}（固定在时间线的时刻上，剪口不动它）或 {"kind":"item-local","itemId":"目标片段 ID"}（保持相对那个片段的位置：目标移动、拆开、修剪起点时跟着动，目标删掉时一起删，回执的 removedWithTarget）。按词跟随的 speech-anchor 求不出位置时片段留在原处，列在回执的 orphanedAnchors。',
    ],
    schema: op('updateItem', {
      itemId: idOf('片段 ID'),
      name: z.string().optional().describe('片段名；空字符串清掉'),
      enabled: z.boolean().optional().describe('启用'),
      locked: z.boolean().optional().describe('锁定'),
      followPolicy: z
        .object({
          kind: z.enum(['follow-cuts', 'sequence-fixed', 'item-local']).describe('follow-cuts、sequence-fixed 或 item-local'),
          itemId: idOf('item-local 时跟随的目标片段').optional(),
        })
        .optional()
        .describe('跟随策略，整个替换'),
      sequenceId,
    }),
    example: { type: 'updateItem', itemId: 'item_1', followPolicy: { kind: 'sequence-fixed' } },
  },
  {
    type: 'setSpeed',
    family: 'items',
    doc: [
      '- {"type":"setSpeed","itemId","rate":{"num":3,"den":2}}：视频、音频恒定变速（0.1–10 倍，分数须约分）；取用的素材范围不变，长度随之变化，盖住后面的片段时失败。',
    ],
    schema: op('setSpeed', {
      itemId: idOf('视频或音频片段 ID'),
      rate: z
        .object({ num: z.number().int().positive().describe('分子'), den: z.number().int().positive().describe('分母') })
        .describe('速率（约分过的分数），0.1–10 倍'),
      sequenceId,
    }),
    example: { type: 'setSpeed', itemId: 'item_1', rate: { num: 3, den: 2 } },
  },
  {
    type: 'setTransform',
    family: 'styles',
    doc: [
      '- {"type":"setTransform","itemId","x"?,"y"?,"w"?,"scale"?,"scaleY"?,"rot"?,"flipX"?,"flipY"?}：改画面上的摆法，按画幅的百分比：x、y 是框中心（0–100，50 为正中，向右、向下增大），w 是框宽占画幅宽的百分比，高按内容的宽高比推出；scale 等比缩放、scaleY 再乘在高上，rot 是绕中心顺时针的角度。只改给出的字段，给 null 回到按种类的缺省。铺满画布（mode 为 fullscreen）的视频与图片不看 x、y、w 与缩放，只看旋转与镜像；要让它们按位置摆放，先用 setStyle 把 mode 改成 pip。改画布尺寸时片段跟着画布走。字幕与音频没有。',
    ],
    schema: op('setTransform', {
      itemId: idOf('画面片段 ID'),
      x: nullableNumber('框中心的横向位置（画幅宽的百分比，50 为正中）'),
      y: nullableNumber('框中心的纵向位置（画幅高的百分比）'),
      w: nullableNumber('框宽占画幅宽的百分比'),
      scale: nullableNumber('等比缩放'),
      scaleY: nullableNumber('再乘在高上的缩放'),
      rot: nullableNumber('绕中心顺时针的角度'),
      flipX: z.boolean().optional().describe('水平镜像'),
      flipY: z.boolean().optional().describe('垂直镜像'),
      sequenceId,
    }),
    example: { type: 'setTransform', itemId: 'item_1', x: 75, y: 25, w: 30 },
  },
  {
    type: 'setStyle',
    family: 'styles',
    doc: [
      '- {"type":"setStyle","itemId","mode"?:"fullscreen"|"pip","fit"?:"cover"|"contain","bg"?:"blur"|"black"|"#RRGGBB","opacity"?,"radius"?,"mask"?:{"shape":"ellipse","feather"?},"crop"?:{"left","top","right","bottom"},"style"?:{…},"verticalAlign"?:"top"|"center"|"bottom"}：改片段的外观，只改给出的字段，给 null 回到缺省。mode 只用于视频、图片、素材贴纸、占位框与白板：fullscreen 铺满画布（画中画的位置与宽保留，切回 pip 时还原），pip 按 setTransform 的位置与宽摆放，缺省为 pip；fit 是铺满时裁切（cover）还是留边（contain），bg 是留边的底。opacity 在 0 到 1；radius 是圆角，按 540 短边下的像素；mask 的 feather 不小于 0；crop 每边是 0 到 1 的比例，左右、上下之和小于 1，只用于视频与图片。style 与 verticalAlign 只用于文字片段。',
    ],
    schema: op('setStyle', {
      itemId: idOf('画面片段 ID'),
      mode: z.enum(['fullscreen', 'pip']).nullable().optional().describe('fullscreen（铺满画布）或 pip（画中画）'),
      fit: z.enum(['cover', 'contain']).nullable().optional().describe('铺满时 cover（裁切）或 contain（留边）'),
      bg: z.string().nullable().optional().describe('留边的底：blur、black 或 #RRGGBB'),
      opacity: nullableNumber('不透明度，0 到 1'),
      radius: nullableNumber('圆角，540 短边下的像素'),
      mask: z
        .object({ shape: z.literal('ellipse').describe('ellipse'), feather: z.number().optional().describe('羽化，不小于 0') })
        .nullable()
        .optional()
        .describe('遮罩'),
      crop: z
        .object({
          left: z.number().describe('左边裁掉的比例'),
          top: z.number().describe('上边裁掉的比例'),
          right: z.number().describe('右边裁掉的比例'),
          bottom: z.number().describe('下边裁掉的比例'),
        })
        .nullable()
        .optional()
        .describe('裁剪（视频与图片），每边 0 到 1'),
      style: z.record(z.string(), z.unknown()).nullable().optional().describe('文字样式对象（只用于文字片段）'),
      verticalAlign: z.enum(['top', 'center', 'bottom']).nullable().optional().describe('文字的垂直对齐：top、center、bottom'),
      sequenceId,
    }),
    example: { type: 'setStyle', itemId: 'item_1', mode: 'pip', opacity: 0.8 },
  },
  {
    type: 'setText',
    family: 'styles',
    doc: [
      '- {"type":"setText","itemId","text"} 或 {"type":"setText","itemId","counter":{"mode":"countdown"|"countup","format"?:"s"|"mm:ss"|"hh:mm:ss"}}：改文字片段的文字，或改成计时读数；两者只给一个。',
    ],
    schema: op('setText', {
      itemId: idOf('文字片段 ID'),
      text: z.string().optional().describe('新的文字；与 counter 只给一个'),
      counter: z
        .object({
          mode: z.enum(['countdown', 'countup']).describe('countdown（倒计时）或 countup（正计时）'),
          format: z.enum(['s', 'mm:ss', 'hh:mm:ss']).optional().describe('s、mm:ss 或 hh:mm:ss'),
        })
        .optional()
        .describe('改成计时读数；与 text 只给一个'),
      sequenceId,
    }),
    example: { type: 'setText', itemId: 'item_1', text: '第一章' },
  },
  {
    type: 'setAudioMix',
    family: 'styles',
    doc: [
      '- {"type":"setAudioMix","itemId","muted"?,"volume"?,"fadeIn"?:秒,"fadeOut"?:秒}：改音频、视频或有声合成的声音；volume 是线性倍数，在 0 到 4，1 为原音量（0.5 约 -6 dB，2 约 +6 dB）；淡变 0 表示去掉。',
    ],
    schema: op('setAudioMix', {
      itemId: idOf('音频、视频或有声合成片段 ID'),
      muted: z.boolean().optional().describe('静音'),
      volume: z.number().min(0).max(4).optional().describe('线性倍数，0 到 4，1 为原音量'),
      fadeIn: seconds.optional().describe('淡入（秒），0 去掉'),
      fadeOut: seconds.optional().describe('淡出（秒），0 去掉'),
      sequenceId,
    }),
    example: { type: 'setAudioMix', itemId: 'item_1', volume: 0.5, fadeOut: 1 },
  },
  {
    type: 'setTransition',
    family: 'transitions-and-effects',
    doc: [
      '- {"type":"setTransition","leftItemId"?,"rightItemId"?,"kind","params"?,"duration"?:秒,"easing"?,"placement"?,"audioCrossfade"?}：设置转场。两个 ID 都给是同一轨道上首尾相接的两个画面片段之间；只给 rightItemId 是这个片段的入场，只给 leftItemId 是出场。kind：dissolve（溶解）、wipe（擦除）、slide（滑入）、zoom（缩放）、iris（圆形展开），不带 params，单侧两侧都可以；dip-to-color（params {"color":"#RRGGBB"}）与 push（params {"direction":"left"|"right"|"up"|"down"}）只用于两侧。easing：linear、ease-in、ease-out、ease-in-out；placement：center（默认）、start-at-cut、end-at-cut。同一条边上原有的转场被替换。两侧转场必须给 duration，不超过 10 秒；素材在剪切点两侧余量（handles）不够时失败（TRANSITION_HANDLES_INSUFFICIENT，details 给出缺几帧），先裁短片段或缩短转场。单侧转场只能居中、不能交叉淡化声音，duration 在 0.1–2 秒，不给时 0.5 秒；片段变短时生效的长度缩到片段长度的一半，回执的 shortenedTransitions 列出。之后移动、裁切、删除让转场不再成立时，引擎删掉它并在回执的 removedTransitions 里说明原因。',
    ],
    schema: op('setTransition', {
      leftItemId: idOf('左边（出场）的片段').optional(),
      rightItemId: idOf('右边（入场）的片段').optional(),
      kind: z
        .enum(['dissolve', 'wipe', 'slide', 'zoom', 'iris', 'dip-to-color', 'push'])
        .describe('dissolve、wipe、slide、zoom、iris；dip-to-color 与 push 只用于两侧'),
      params: z.record(z.string(), z.unknown()).optional().describe('dip-to-color 的 {"color"}、push 的 {"direction"}'),
      duration: time.optional().describe('长度；两侧转场必须给，不超过 10 秒'),
      easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional().describe('linear、ease-in、ease-out、ease-in-out'),
      placement: z.enum(['center', 'start-at-cut', 'end-at-cut']).optional().describe('center（缺省）、start-at-cut、end-at-cut'),
      audioCrossfade: z.boolean().optional().describe('同时交叉淡化声音（只用于两侧）'),
      ...timed,
    }),
    example: { type: 'setTransition', leftItemId: 'item_1', rightItemId: 'item_2', kind: 'dissolve', duration: 0.5 },
  },
  {
    type: 'removeTransition',
    family: 'transitions-and-effects',
    doc: ['- {"type":"removeTransition","transitionId"}：删除转场。'],
    schema: op('removeTransition', {
      transitionId: idOf('转场 ID'),
      sequenceId,
    }),
    example: { type: 'removeTransition', transitionId: 'transition_1' },
  },
  {
    type: 'setEffects',
    family: 'transitions-and-effects',
    doc: [
      '- {"type":"setEffects","itemId","fx":{…}|null}：整个替换视频、图片、贴纸、占位框、白板或合成片段的效果（fx），给 null 去掉；没写的字段不生效，保留已有的要一起带上。字段：brightness、exposure、contrast、saturation、temperature、hue（-1 到 1，0 为不变；hue 乘 180 度）；grayscale、sharpen、noise、vignette（0 到 1）；blur（0–100）；filterPreset（none、calm1、calm2、calm3、clean1–3、cottage1–3、peckham1–3）；effectPreset（none、invert、night_vision、thermal_vision、old、polaroid、filmic、snowy、box_blur、bokeh_blur）与 effectIntensity（0 到 1）；shadow {"offsetX","offsetY","blur","color","opacity"}；stroke {"width","color"}。长度都按 540 短边下的像素。',
    ],
    schema: op('setEffects', {
      itemId: idOf('画面片段 ID'),
      fx: z.record(z.string(), z.unknown()).nullable().describe('整个替换的效果对象；null 去掉'),
      sequenceId,
    }),
    example: { type: 'setEffects', itemId: 'item_1', fx: { brightness: 0.1, saturation: -0.2 } },
  },
  {
    type: 'setChapters',
    family: 'chapters-and-ducking',
    doc: [
      '- {"type":"setChapters","chapters":[{"chapterId"?,"at":秒,"title","summary"?,"thumbnail"?:"图片素材 ID"}]}：整个替换章节列表（按时间严格递增，第一章通常在 0）。章节固定在时间线的时刻上，不跟着片段移动。',
    ],
    schema: op('setChapters', {
      chapters: z
        .array(
          z.object({
            chapterId: idOf('沿用的章节 ID').optional(),
            at: time.describe('章节开始的时间'),
            title: z.string().describe('标题'),
            summary: z.string().optional().describe('摘要'),
            thumbnail: idOf('缩略图的图片素材 ID').optional(),
          }),
        )
        .describe('整份章节列表，按时间严格递增'),
      ...timed,
    }),
    example: {
      type: 'setChapters',
      chapters: [
        { at: 0, title: '开场' },
        { at: 42, title: '演示' },
      ],
    },
  },
  {
    type: 'upsertChapter',
    family: 'chapters-and-ducking',
    doc: [
      '- {"type":"upsertChapter","chapterId"?,"at"?:秒,"title"?,"summary"?,"thumbnail"?}：新建一章（不给 chapterId，须给 at 与 title）或修改一章；summary、thumbnail 给 null 去掉。',
    ],
    schema: op('upsertChapter', {
      chapterId: idOf('要改的章节；不给时新建').optional(),
      at: time.optional().describe('章节开始的时间；新建时必须给'),
      title: z.string().optional().describe('标题；新建时必须给'),
      summary: z.string().nullable().optional().describe('摘要；null 去掉'),
      thumbnail: idOf('缩略图的图片素材 ID').nullable().optional(),
      ...timed,
    }),
    example: { type: 'upsertChapter', at: 90, title: '总结' },
  },
  {
    type: 'removeChapter',
    family: 'chapters-and-ducking',
    doc: ['- {"type":"removeChapter","chapterId"}：删除一章。'],
    schema: op('removeChapter', {
      chapterId: idOf('章节 ID'),
      sequenceId,
    }),
    example: { type: 'removeChapter', chapterId: 'chapter_1' },
  },
  {
    type: 'setDucking',
    family: 'chapters-and-ducking',
    doc: [
      '- {"type":"setDucking","ruleId"?,"trigger":{"kind":"items","trackIds"?,"itemIds"?} 或 {"kind":"speech"},"target":{"trackIds"?,"itemIds"?},"depth"?,"attack"?:秒,"release"?:秒,"enabled"?,"name"?}：闪避，例如人声响起时把背景音乐压低。trigger 的 items 是这些轨道与片段发声时；speech 是有人说话时（按文稿，这一版还不压低）。不给 ruleId 时新建（须给 trigger 与 target），给了只改给出的字段。depth 是压低的 dB，在 0–60，默认 10；attack 默认 0.02 秒、release 默认 0.35 秒。触发组与目标组不能重叠。',
    ],
    schema: op('setDucking', {
      ruleId: idOf('要改的规则；不给时新建').optional(),
      trigger: z
        .object({
          kind: z.enum(['items', 'speech']).describe('items（这些轨道与片段发声时）或 speech（有人说话时）'),
          trackIds: z.array(z.string()).optional().describe('items 的轨道'),
          itemIds: z.array(z.string()).optional().describe('items 的片段'),
        })
        .optional()
        .describe('什么时候压低；新建时必须给'),
      target: z
        .object({
          trackIds: z.array(z.string()).optional().describe('被压低的轨道'),
          itemIds: z.array(z.string()).optional().describe('被压低的片段'),
        })
        .optional()
        .describe('压低谁；新建时必须给'),
      depth: z.number().min(0).max(60).optional().describe('压低的 dB，缺省 10'),
      attack: seconds.optional().describe('压下去的时间（秒），缺省 0.02'),
      release: seconds.optional().describe('恢复的时间（秒），缺省 0.35'),
      enabled: z.boolean().optional().describe('启用'),
      name: z.string().optional().describe('规则名'),
      sequenceId,
    }),
    example: {
      type: 'setDucking',
      trigger: { kind: 'items', trackIds: ['track_voice'] },
      target: { trackIds: ['track_music'] },
      depth: 12,
    },
  },
  {
    type: 'removeDucking',
    family: 'chapters-and-ducking',
    doc: ['- {"type":"removeDucking","ruleId"}：删除闪避规则。'],
    schema: op('removeDucking', {
      ruleId: idOf('规则 ID'),
      sequenceId,
    }),
    example: { type: 'removeDucking', ruleId: 'duck_1' },
  },
  {
    type: 'addCuts',
    family: 'speech',
    doc: [
      '- {"type":"addCuts","assetId":"被剪的素材 ID","cuts":[{"from":秒,"to":秒,"ref"?:"建议 ID"}]}：口播剪辑——在这个素材的剪口集合里记下删掉的源区间（素材自己的时钟上的秒，不是时间线上的秒），并按剪口重排：播放这个素材的视频、音频片段在剪口处拆开、删掉中间，它们所在轨道上之后的内容前移；其他轨道上跟随剪口（followPolicy 为 follow-cuts，新建片段的缺省；要固定在时间线上先用 updateItem 改成 sequence-fixed）的片段一起移动、缩短，整个落在剪掉范围里的删掉（回执的 removedByCuts）。与已有剪口间隔不超过 0.02 秒的合并。剪口集合的文档列在视频的 documents 里（kind 为 cut-set）。',
    ],
    schema: op('addCuts', {
      assetId: idOf('被剪的素材 ID'),
      cuts: z
        .array(
          z.object({
            from: seconds.describe('素材时钟上的起点（秒，不是时间线上的秒）'),
            to: seconds.describe('素材时钟上的终点（秒）'),
            ref: idOf('出处：剪辑建议的 ID').optional(),
          }),
        )
        .min(1)
        .describe('删掉的源区间'),
      sequenceId,
    }),
    example: { type: 'addCuts', assetId: 'asset_1', cuts: [{ from: 3.2, to: 4.1 }] },
  },
  {
    type: 'restoreCut',
    family: 'speech',
    doc: [
      '- {"type":"restoreCut","assetId":"素材 ID","cutId":"剪口 ID"}：恢复一个剪口，把删掉的部分放回接缝处、之后的内容后移；找不到接缝时只从剪口集合里去掉（回执的 cutsNotRelaid）。',
    ],
    schema: op('restoreCut', {
      assetId: idOf('素材 ID'),
      cutId: idOf('剪口 ID'),
      sequenceId,
    }),
    example: { type: 'restoreCut', assetId: 'asset_1', cutId: 'cut_1' },
  },
  {
    type: 'proposeCuts',
    family: 'speech',
    doc: [
      '- {"type":"proposeCuts","assetId":"素材 ID","speechDocumentId"?,"detect"?:{"pauses"?,"fillers"?,"minPause"?:秒,"compressTo"?:秒,"maxGap"?:秒,"fillerLanguage"?:"auto"|"en"|"zh","customFillers"?:["词"],"trimChapterStarts"?}}：按这个素材的转写检测口癖（嗯、呃、um 等，含「就是」「you know」这类只在断句处算的软口癖）与长停顿（缺省 0.8 秒以上、3 秒以下的停顿压缩到 0.3 秒，句末多留 0.1 秒），写成剪辑提案：视频的 documents 里 kind 为 editorial-proposal 的文档（每个素材一份，再提出时整份替换）。不改时间线；已经剪掉的不再提出；素材有几份转写时用 speechDocumentId 指明。用 documents_read 读提案：suggestions 每条有 id、kind（filler 或 pause）、源区间 t0/t1（按 timescale 的刻度）、text、reason 与 status。不检测重复的句子。',
    ],
    schema: op('proposeCuts', {
      assetId: idOf('素材 ID'),
      speechDocumentId: idOf('用哪份转写；素材有几份时指明').optional(),
      detect: z
        .object({
          pauses: z.boolean().optional().describe('检测长停顿，缺省 true'),
          fillers: z.boolean().optional().describe('检测口癖，缺省 true'),
          minPause: seconds.optional().describe('最短的停顿（秒），缺省 0.8'),
          compressTo: seconds.optional().describe('停顿压缩到（秒），缺省 0.3'),
          maxGap: seconds.optional().describe('更长的不算停顿（秒），缺省 3'),
          fillerLanguage: z.enum(['auto', 'en', 'zh']).optional().describe('口癖表：auto、en 或 zh'),
          customFillers: z.array(z.string()).optional().describe('另外当作口癖的词'),
          trimChapterStarts: z.boolean().optional().describe('章节之间的停顿也压缩'),
        })
        .optional()
        .describe('检测参数；不给的取缺省'),
    }),
    example: { type: 'proposeCuts', assetId: 'asset_1', detect: { minPause: 1 } },
  },
  {
    type: 'acceptCutSuggestions',
    family: 'speech',
    doc: [
      '- {"type":"acceptCutSuggestions","proposalId":"提案文档 ID","suggestionIds":["建议 ID"]}：接受提案里的建议，按建议的源区间剪掉（同 addCuts，剪口的 ref 是建议 ID），建议标成 accepted，一笔事务、可撤销。转写在提出之后改过时失败（details.rule 为 proposal-stale），先重新 proposeCuts。要改区间就不用这个，直接用 addCuts 并把建议 ID 写进 ref。',
    ],
    schema: op('acceptCutSuggestions', {
      proposalId: idOf('提案文档 ID'),
      suggestionIds: z.array(idOf('建议 ID')).min(1).describe('接受的建议'),
      sequenceId,
    }),
    example: { type: 'acceptCutSuggestions', proposalId: 'doc_proposal_1', suggestionIds: ['s1', 's2'] },
  },
  {
    type: 'replaceCodeBundle',
    family: 'code',
    doc: [
      '- {"type":"replaceCodeBundle","itemId":"合成片段 ID","assetRef":{"id":"代码包素材 ID","revision"},"prerender"?:{"id":"预渲染素材 ID","revision"}|null,"parameterValues"?:{…}}：原地换时间线上一个合成片段（代码画面）的代码包版本与预渲染：片段 ID、轨道、起点、位置与大小、不透明度、名字、效果、遮罩、关键帧、声音都不变。长度取新预渲染的长度（没有预渲染时取代码包清单的 intrinsic），变短就裁掉，变长撞上同轨后面的片段以 TIMELINE_OVERLAP 拒绝（先 moveItem 挪开或 deleteItems）。片段有参数而新包去掉或换了参数 Schema 时要同时给 parameterValues。回执的 impact.codeEdits 列出换掉的旧版本与前后的帧数。通常不用手写：compositions_import 带 replace 时就是这一步；第二笔失败时按它的 next 用这里完成。',
    ],
    schema: op('replaceCodeBundle', {
      itemId: idOf('要替换的合成片段（type 为 composition）'),
      assetRef: z
        .object({ id: idOf('代码包素材 ID'), revision: z.string().describe('素材版本') })
        .describe('新的代码包素材版本（compositions_import 返回的 bundle.assetId 与 bundle.revision）'),
      prerender: z
        .object({ id: idOf('预渲染素材 ID'), revision: z.string().describe('素材版本') })
        .nullable()
        .optional()
        .describe('新的预渲染（compositions_import 返回的 prerender.assetId 与 prerender.revision）；null 或省略是不要预渲染'),
      parameterValues: z.record(z.string(), z.unknown()).optional().describe('整个替换片段的参数；省略时保留原来的'),
      sequenceId,
    }),
    example: {
      type: 'replaceCodeBundle',
      itemId: 'item_lower_third',
      assetRef: { id: 'asset_bundle_2', revision: '1' },
      prerender: { id: 'asset_prerender_2', revision: '1' },
    },
  },
  {
    type: 'addTrack',
    family: 'tracks-and-sequences',
    doc: ['- {"type":"addTrack","kind":"visual"|"audio","name"?}：新增一条轨道。'],
    schema: op('addTrack', {
      kind: z.enum(['visual', 'audio']).describe('visual（画面）或 audio（声音）'),
      name: z.string().optional().describe('轨道名'),
      sequenceId,
    }),
    example: { type: 'addTrack', kind: 'audio', name: '背景音乐' },
  },
  {
    type: 'deleteTrack',
    family: 'tracks-and-sequences',
    doc: [
      '- {"type":"deleteTrack","trackId"}：删掉一条空轨道，其他轨道的上下顺序不变。轨道上还有片段时拒绝（details.itemIds 列出它们），先 deleteItems 删掉或 moveItem 挪到别的轨道，可以写在同一笔修改里；被闪避规则用着时也拒绝。',
    ],
    schema: op('deleteTrack', {
      trackId: idOf('轨道 ID'),
      sequenceId,
    }),
    example: { type: 'deleteTrack', trackId: 'track_2' },
  },
  {
    type: 'updateTrack',
    family: 'tracks-and-sequences',
    doc: ['- {"type":"updateTrack","trackId","locked"?,"visible"?,"muted"?,"name"?}：修改轨道。'],
    schema: op('updateTrack', {
      trackId: idOf('轨道 ID'),
      locked: z.boolean().optional().describe('锁定'),
      visible: z.boolean().optional().describe('可见'),
      muted: z.boolean().optional().describe('静音'),
      name: z.string().optional().describe('轨道名'),
      sequenceId,
    }),
    example: { type: 'updateTrack', trackId: 'track_1', muted: true },
  },
  {
    type: 'moveTrack',
    family: 'tracks-and-sequences',
    doc: [
      '- {"type":"moveTrack","trackId","target","position":"above"|"below"}：把一条轨道挪到同类的另一条轨道（target）上面或下面，片段跟着轨道走；别的种类的轨道不动。',
    ],
    schema: op('moveTrack', {
      trackId: idOf('轨道 ID'),
      target: idOf('作为参照的同类轨道 ID'),
      position: z.enum(['above', 'below']).describe('放在参照轨道的上面（above）还是下面（below）'),
      sequenceId,
    }),
    example: { type: 'moveTrack', trackId: 'track_2', target: 'track_1', position: 'below' },
  },
  {
    type: 'updateSequence',
    family: 'tracks-and-sequences',
    doc: [
      '- {"type":"updateSequence","name"?,"canvas"?:{"width","height"},"background"?:"#RRGGBB"}：改画布尺寸（像素）与底色（不透明的纯色）。片段的位置按画幅的百分比保存，改尺寸时跟着画布走。',
    ],
    schema: op('updateSequence', {
      name: z.string().optional().describe('序列名'),
      canvas: z
        .object({ width: z.number().int().describe('宽（像素）'), height: z.number().int().describe('高（像素）') })
        .optional()
        .describe('画布尺寸'),
      background: z.string().optional().describe('底色 #RRGGBB'),
      sequenceId,
    }),
    example: { type: 'updateSequence', canvas: { width: 1080, height: 1920 } },
  },
  {
    type: 'putDocument',
    family: 'documents-and-versions',
    doc: [
      '- {"type":"putDocument","documentId"?,"kind","name"?,"language"?,"sourceAsset"?:{"assetId"},"sourceDocument"?:{"documentId"},"body":{…},"summary"?}：写入一份文档（转写、译文等）的新版本，body 是完整的正文对象（先用 documents_read 读出当前正文再改）；给 documentId 时改那份文档（kind 不能变），不给时新建。译文用 kind "translation"，sourceDocument 指向它译自的文档。正文与原来相同时不产生新版本。',
    ],
    schema: op('putDocument', {
      documentId: idOf('要改的文档；不给时新建').optional(),
      kind: z.string().describe('文档种类：speech（转写）、translation（译文）等；改已有文档时不能变'),
      name: z.string().optional().describe('文档名'),
      language: z.string().optional().describe('语言（BCP 47），译文必须给'),
      sourceAsset: z
        .object({ assetId: idOf('素材 ID') })
        .optional()
        .describe('来源素材（转写）'),
      sourceDocument: z
        .object({ documentId: idOf('文档 ID') })
        .optional()
        .describe('来源文档（译文译自的转写）'),
      body: z.record(z.string(), z.unknown()).describe('完整的正文对象（先 documents_read 读出当前正文再改）'),
      summary: z.unknown().optional().describe('文档摘要'),
    }),
    example: {
      type: 'putDocument',
      documentId: 'doc_speech_1',
      kind: 'speech',
      body: { schema: 'baocut.speech/1', clock: 'source-asset', timescale: 1000, speakers: [], words: [], sentences: null, chapters: [] },
    },
  },
  {
    type: 'createCheckpoint',
    family: 'documents-and-versions',
    doc: ['- {"type":"createCheckpoint","name","note"?}：在历史里留一个检查点。'],
    schema: op('createCheckpoint', {
      name: z.string().describe('检查点名'),
      note: z.string().optional().describe('备注'),
    }),
    example: { type: 'createCheckpoint', name: '粗剪完成' },
  },
  {
    type: 'renameVideo',
    family: 'documents-and-versions',
    doc: ['- {"type":"renameVideo","name"}：改视频名（不改目录名）。'],
    schema: op('renameVideo', {
      name: z.string().describe('新的视频名（不改目录名）'),
    }),
    example: { type: 'renameVideo', name: '发布会精剪' },
  },
];

/** `edits_apply` 认得的操作种类，按上表的顺序。 */
export const OPERATION_TYPES = EDIT_OPERATIONS.map((spec) => spec.type) as [string, ...string[]];

/** `edits_ops` 的一项：说明、JSON Schema 与示例。 */
export function describeOperation(spec: EditOperationSpec) {
  const { $schema: _, ...schema } = z.toJSONSchema(spec.schema, { io: 'input' }) as Record<string, unknown>;
  return {
    type: spec.type,
    family: spec.family,
    description: spec.doc.map((line) => line.replace(/^- /, '')).join('\n'),
    schema,
    example: spec.example,
  };
}
