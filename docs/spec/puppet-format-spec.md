# BaoCut 分层角色格式规范

> 分层角色是一种素材：一张角色拆成几十张整块的分层（后发、身体、光头的脸、眼白、眼珠、几帧嘴、表情补丁、侧发、刘海、眉毛……），按一组参数（转头、点头、眨眼、视线、张嘴、元音、笑……）逐帧形变网格再画出来，用来做对口型的卡通主播。本规范定义角色包（`.bcpuppet`）、动作轨（`baocut-puppet-track` JSON）与按时刻出帧的语义。

格式标识：角色包里 `model.json` 的 `"format": "baocut-puppet", "version": 1`；动作轨的 `"format": "baocut-puppet-track", "version": 1`。

视频里怎么用（素材种类、角色贴纸的 `motionRef` 与 `motionIn`、拆分与合并）见[视频格式规范](video-format-spec.md) §3.7、§4.1；实现在 `crates/puppet`。用语见[文档约定](../README.md#文档约定)。

## 目录

- [1. 范围与来源](#1-范围与来源)
- [2. 角色包](#2-角色包)
- [3. 参数与表情](#3-参数与表情)
- [4. 动作轨](#4-动作轨)
- [5. 出帧语义](#5-出帧语义)
- [6. 错误代码](#6-错误代码)
- [7. 与 LivLiv v4 的差异](#7-与-livliv-v4-的差异)
- [8. 待评审事项](#8-待评审事项)

---

## 1. 范围与来源

- 角色的结构、形变与物理移植自 [LivLiv Player](https://github.com/livliv-dev/player)（Apache-2.0）的 model format v4 与它的运行时；`model.json` 的字段名与含义沿用 v4（`schema/livliv-model-v4.json`、`FORMAT.md`），本规范只写 BaoCut 读哪些字段、怎样校验、哪里不同（§7）。
- BaoCut 不读 `.livliv` 文件：格式头不同，读到 `"format": "livliv-model"` 一律拒绝（`puppet-invalid`）。
- 角色包与动作轨分开：同一个角色换一段配音只换动作轨。动作轨由配音的音频分析生成（嘴型、元音、点头），也可以手写。
- 内置技能 `virtual-host` 带两样生成工具：`puppet-build.mjs` 把一张正面像和几张只改一处的改图（光头、嘴的几帧、闭眼、表情）拆成角色包，不写 `rig` 与 `tuning`，取缺省；`lipsync.mjs` 按逐字时间与配音的音量算动作轨，只写 `mouthOpen`、`vowel`、`angleX` `angleY` `angleZ` 与 `faces.json` 给的表情，眨眼与视线留给待机动作（§5）。用法见技能的 `references/art.md` 与 `references/lipsync.md`。
- 渲染只用 CPU，预览（preview.wasm）与导出用同一份实现，同一个时刻画出来逐像素相同。

## 2. 角色包

### 2.1 布局

- 角色包是一个 zip：根上是 `model.json`，贴图在 `textures/` 下。整个包可以多套一层目录（直接压缩一个文件夹的结果），这时 `model.json` 与 `textures/` 都在那一层目录里。
- 条目可以存储或 deflate；加密与 zip64 不支持（`puppet-not-zip`）。
- 贴图路径写成 `textures/<名字>.png` 或 `textures/<名字>.webp`：名字以字母、数字或 `_` 开头，只含字母、数字与 `_ . -`，不含 `..` 与子目录。`model.json` 引用的每张贴图都要在包里（`puppet-missing-file`）；包里多出来的文件不读。
- 贴图读进来就预乘 alpha 并生成 mipmap（每级边长减半，2×2 取平均），绘制时三线性采样。眼白的 `mask` 应是无损的（PNG 或无损 WebP）：读的时候不检查，有损压缩的边缘会让眼珠漏到眼白外面。
- 文件扩展名 `.bcpuppet`，媒体类型 `application/x-baocut-puppet+zip`。

### 2.2 `model.json`

```ts
interface PuppetModel {
  format: 'baocut-puppet';
  version: 1;
  name?: string;
  canvas: [number, number];            // 画布宽高（像素），每边 [16, 8192]；所有坐标都在这个空间里，原点左上，y 向下
  profile?: { id?: string; facing?: string; glasses?: boolean };   // 画风：anime_half、chibi、mascot、painterly；不认识的按通用角色
  anchors: Anchors;                    // 头的椭圆、脸框、脖子、发际线、眼睛、眉毛、下巴、胸口（v4 的 anchors）
  rig?: RigDef;                        // 转头、点头、歪头的幅度，鼓起，头发与身体的弹簧，呼吸，链条（v4 的 rig）；缺的字段取缺省
  tuning?: TuningDef;                  // turn、nod、hair、hair_front、hair_back、breath、gaze，1 是缺省，负数与非有限值按缺省
  expressions?: Array<{ id: string }>; // 表情，按界面列出的顺序
  layers: LayerDef[];                  // 按绘制顺序，底层在前
}
```

- 字段名用 v4 的 snake_case（`neck_y`、`hair_root_y`、`brow_lines`、`fall_end`……）。未知字段忽略。
- `anchors.head`（`cx cy rx ry`）与 `anchors.face`（`[x0, y0, x1, y1]`）必须是有限数、半径与宽高为正；`neck_y`、`top_y`、`bottom_y`、`hair_root_y` 必须是有限数。
- `rig.chains` 最多 64 条，每条 2–256 个有限的点，`k`、`damp`、`drive`、`hang`、`wind` 都是有限数。

### 2.3 层

每层是 v4 的一个 layer：`id`、`texture`、层框 `x y w h`（模型像素）、`group`（`head`、`body`、`hair_back`、`hair_side`、`hair_front`、`hair_inner`，不认识的拒绝）与按需的 `depth`、`role`、`expression`、`frames`、`visemes`、`mask`、`talk`、`brow_tex`、`pivot`、`clip`、`range`、`brows`、`bones`、`rigid`、`blush`、`show`、`hide`、`fall`、`fall_end`。

- `id` 在包里唯一。层框可以伸出画布，但不超过一个画布远：`x ≥ −宽`、`y ≥ −高`、`x + w ≤ 2 × 宽`、`y + h ≤ 2 × 高`，`w`、`h` 为正。
- 读的 `role`：`mouth`（嘴，`frames` 是各帧，`visemes` 标出每帧是 `closed`、`half`、`open`、`round`、`wide` 还是 `shut`，两者等长；没有 `visemes` 时前三帧按 `closed half open`）、`expr` 与 `expr_brows`（表情补丁与它的眉毛，属于 `expression` 指的表情，缺省 `smile`）、`eye_L` `eye_R`（眼白，带 `mask`）、`iris_L` `iris_R` `shine_L` `shine_R`（眼珠与高光，被眼白裁切，`range` 是行程）、`lid_L` `lid_R`、`blush`、`neck_shadow`。别的 `role` 按普通层画。`id` 为 `brows` 的层是中性的眉毛。`expr` 层的 `talk` 是说话时换用的贴图（嘴的位置是皮肤，表情自己画的嘴比原嘴宽时整张嘴都是皮肤），这时嘴挪到最后一个 `expr` 层之后画；`expr` 层的 `brow_tex` 是表情自己画的眉毛（与层框同大），在最后一个 `id` 为 `brows` 或 `role` 为 `expr_brows` 的层之后按表情的不透明度画一次，跟着刘海动，盖在刘海上，包里没有这样的层时不画；`brows` 为 `"redrawn"` 时表情自己画了眉毛，中性眉毛按这些表情里最大的不透明度淡出。
- 所有层的网格共用一张格子，格子边长是 `max(6, round(max(画布宽, 画布高) / 128))` 模型像素；同一个格点在每一层上按同样的方式移动，重叠的层不会错开。每层只在它的贴图（嘴还有 `frames`）有不透明像素的格子和它们旁边一格上铺网格，`talk` 与 `brow_tex` 也只画在这些格子里：表情贴图在它画的眉毛底下要不透明。

### 2.4 上限

| 项 | 上限 |
| --- | --- |
| 层数 | 512 |
| 所有层的网格顶点（按层框在格子上算） | 2²¹ |
| 贴图边长 | 8192 |
| 全部贴图的像素数 | 64 Mi |
| `model.json` | 4 MiB |
| 单个条目解压后 | 128 MiB |
| 整个包解压后 | 512 MiB |
| 导入视频的角色包文件（视频格式规范 §4.1） | 64 MiB |

超过上限是 `puppet-too-large`。

## 3. 参数与表情

角色每一刻由 17 个参数决定，超出范围的值截到范围内：

| 参数 | 范围 | 含义 |
| --- | --- | --- |
| `angleX` `angleY` `angleZ` | [−30, 30] | 转头、点头、歪头（度） |
| `eyeLOpen` `eyeROpen` | [0, 1] | 眼睛睁开多少，0 是闭上 |
| `eyeBallX` `eyeBallY` | [−1, 1] | 视线 |
| `browLY` `browRY` | [−1, 1] | 眉毛高低 |
| `mouthOpen` | [0, 1] | 张嘴（响度）：越过 0.12、0.5 换半张、张开的嘴帧，两侧回差 0.04，每帧至少停 55 ms |
| `vowel` | [−1, 1] | 元音提示：张着嘴时低于 −0.65 换圆嘴（`round`）、高于 0.65 换扁嘴（`wide`），回到 ±0.35 以内换回按响度的嘴帧；没有这两帧的角色不受影响 |
| `smile` | [0, 1] | 笑 |
| `bodyX` `bodyZ` | [−10, 10] | 身体的转与歪 |
| `breath` | [0, 1] | 呼吸 |
| `moveX` `moveY` | [−0.5, 0.5] | 整个画面的平移，画布宽、高的份额（`moveY` 向上为正）：说话时的轻跳、`hop` 动作。角色画到画布底边（`anchors.bottom_y ≥ canvas[1] − 4`，半身角色）时 `moveY` 只往下生效，往上按 0 算，不露出切口 |

- 表情按 `id` 给权重，[0, 1]。表情补丁的不透明度是 `smoothstep(0.3, 0.7, 权重)`。`smile` 既是参数也是表情：两路取大的。角色没有的表情不画。
- 头、头发、身体、链条的弹簧与滞后由参数的变化驱动（§5），不是参数。

## 4. 动作轨

```ts
interface PuppetTrack {
  format: 'baocut-puppet-track';
  version: 1;
  fps: number;                         // (0, 240]
  duration: number;                    // 秒，(0, 21600]
  params?: Record<ParamName, number[]>;        // §3 的参数名；每个通道 1 到 ⌈duration × fps⌉ + 1 个采样
  offsets?: Record<ParamName, number[]>;       // 同上：加在待机动作与 params 之上的量
  expressions?: Record<string, number[]>;      // 表情 id → 权重采样；最多 64 个，id 1–64 字节
}
```

- 第 `i` 个采样是 `i / fps` 秒的值，采样之间线性插值，最后一个采样之后保持最后的值。未知的参数名、空通道、采样太多都拒绝；不允许别的顶层字段。
- 所有通道合计最多 2²⁵ 个采样，JSON 最多 64 MiB。
- `params` 的通道取代待机动作的那个参数；轨里没有的参数由待机动作给出（§5）：只给 `mouthOpen` 的动作轨照样眨眼、呼吸、游移、做小动作。
- `offsets` 的通道加在上面（结果仍截到 §3 的范围）：说话时的点头与朝向、一次性动作（点头、摇头、歪头、轻跳、害羞）写成偏移，待机的游移、眨眼、视线照常。这与 LivLiv 的播放器把说话动作与动作叠在待机上一致。头、眼睛、眉毛最好只写 `offsets`，不写进 `params`。
- 文件扩展名 `.json`，媒体类型 `application/x-baocut-puppet-track+json`；导入时顶层 `format` 是 `baocut-puppet-track` 的 JSON 按动作轨校验（视频格式规范 §4.1）。

## 5. 出帧语义

**角色时钟**。动作轨的第 0 秒是角色时钟的 0 秒。视频里的实例把自己的局部时间映射到角色时钟（视频格式规范 §3.7 的 `motionIn`）。

- **固定步长重放**。物理按 1/120 秒的固定步长走。重放从 `origin = min(实例开头的角色时钟, 0)` 开始，按步长向下取整；开头先按起点的参数预走 0.5 秒，弹簧和身体不会从静止猛地弹起。所以开头不早于 0 的实例，画出来只看角色时钟的时刻：拆开的两段在接缝处逐像素相同。
- **任意 seek 结果相同**。时刻 `t` 走到第 `round((max(t − origin, 0) + 0.5) × 120)` 步。往前 seek 接着走；往回 seek 从不晚于目标的最近一份快照接着走（每 1200 步，即 10 秒存一份），没有快照就从头走。同一时刻不论按什么顺序 seek、预览还是导出，状态与像素都相同。
- **待机动作**。移植自 LivLiv 播放器的待机（`LivelyIdle` 的 `attend` 风格，没有指针）：头和身体在平滑的值噪声上游移、经阻尼弹簧跟随，转头有软上限（左右约 13 度）；眼睛先动，每 0.6–2.2 秒一次小扫视，视线限在横 0.78、竖 0.55 的椭圆里，大的视线跳动带一次眨眼；呼吸吸 40%、呼 48%、停一下，每轮 3.2–4.6 秒；眨眼 75 ms 合上、120 ms 睁开，间隔 1.8–5.6 秒，约六次里一次连眨两下，眉毛随眨眼微沉；安静 10–20 秒后做一个小动作（瞥一眼、左右看、晃、想事情、低头看一眼），不连着两次同一个、随机左右镜像。所有随机数来自固定种子的 splitmix64（噪声的格点值也用整数哈希），种子由宿主给（视频格式规范 §3.7）；同一个种子每次都一样。
- **说话**。待机动作按动作轨的 `mouthOpen` 判断角色在说话：上一步嘴张过 0.05 时不开始小动作，正在做的在 0.4 秒里淡出，此后至少 3 秒才开始下一个；嘴张过 0.2 后“说话程度”很快升到 1，停下后约一秒落下，说话时视线回到镜头（只留 30%）；说话程度落过 0.6、停顿超过 0.4 秒时眨一次眼。这三件事与 LivLiv `TalkMotion` 交给播放器的一致；点头、朝向、扬眉、轻跳由生成动作轨的一方写进 `offsets`。
- **与动作轨的交接**。角色时钟早于 0 时，动作轨的值在 −0.5 秒到 0 秒之间从待机渐渐过渡过来，更早完全是待机；动作轨结束后 0.5 秒内渐渐交回待机。完全是待机的时刻不读动作轨，画面与没有动作轨时逐像素相同。没有动作轨的角色一直是待机动作。
- **合成顺序**。每一步：待机动作 → `params` 取代（含与待机的交接）→ 加 `offsets`（乘以交接的权重）→ 截到 §3 的范围 → 表情权重（同样乘以交接的权重，`smile` 两路取大的）。
- **输出**。一帧画到 `w × h` 的预乘 RGBA8 缓冲：先清成透明，角色按画布等比缩放、居中，再按 `moveX` `moveY` 平移（§3 的切口规则）。三角形光栅按像素中心采样、左上填充规则，预乘混合，与 WebGL2 的结果一致到取整误差。

## 6. 错误代码

读角色包与动作轨出错时给宿主的稳定代码（导出与预览的跳过报告用）：

| 代码 | 情形 |
| --- | --- |
| `puppet-not-zip` | 不是 zip，或用了加密、zip64 |
| `puppet-invalid` | 内容不合格式：格式头不对、缺字段、数值越界、贴图路径不对、动作轨的通道不对 |
| `puppet-unsupported` | 版本比实现新 |
| `puppet-too-large` | 超过 §2.4 或 §4 的上限 |
| `puppet-missing-file` | `model.json` 引用的贴图不在包里 |
| `puppet-image` | 贴图不是能解码的 PNG 或 WebP |

上表是角色包的代码。视频里的角色贴纸画不出来时，导出预检、导出与预览的跳过原因（`EXPORT_UNSUPPORTED_CONTENT` 的 `reason`）是：角色包解不开时用上表的代码；角色包的字节读不到（没有冻结、文件不见了、预览还在取）是 `puppet-asset-missing`；动作轨的字节读不到是 `puppet-track-missing`；动作轨解不开（上表任何一种）是 `puppet-track-invalid`。这几种都是整层不画（`scope: 'asset'`），不会退回只画待机动作。

## 7. 与 LivLiv v4 的差异

- 格式头是 `baocut-puppet`，不读 v4 的 `meta`、`requires`、`files`，也不读 keyforms（转头的实测修正）；`profile.id` 只用来选画风相关的缺省。
- 渲染用 CPU 三角形光栅代替 WebGL2；眼珠的模板与软遮罩合成一张屏幕空间的覆盖图。
- 待机动作用固定种子的伪随机数（LivLiv 用 `Math.random`）；不跟随指针，也没有 `lookAt`：视频里没有观众的指针。
- 说话动作（LivLiv `TalkMotion` 的点头、朝向、漂移、扬眉、轻跳）与一次性动作不在播放器里实时算，由生成动作轨的一方预先写进 `offsets`；视线回看与停顿眨眼由播放器按 `mouthOpen` 算（§5）。“动作进行中”（LivLiv 的 `busy`）只看嘴：静音里的一次性动作不挡待机的小动作。
- 没有 `away`（离开：闭眼低头、慢呼吸）这个状态。
- 物理按固定 1/120 秒步长从角色时钟的 0 秒重放并存快照（LivLiv 按真实帧间隔走），任意时刻 seek 结果都一样。
- 链条（`rig.chains` 与层的 `bones`）照 LivLiv 的绳子模拟移植，状态按 f32 取整。

## 8. 待评审事项

- 是否读 v4 的 keyforms，让大角度转头更准。
- 角色包是否带封面（v4 的 `files.cover`），用于素材库的缩略图；现在角色包没有缩略图。
