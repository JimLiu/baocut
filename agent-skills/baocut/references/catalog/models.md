---
description: 模型能力的机制：各能力可用的服务、模型与限制，本地模型包的安装与检查，能力没配置或要授权时怎么处理。遇到这类错误或要装模型包时读。
---

# 模型能力：查询、本地模型包与「没配置」的处理

## 何时用

- 动手前确认转写、语音合成、图片生成能不能用、限制是多少。
- 本机模型没装，要装或检查本地模型包。
- 收到 `CAPABILITY_NOT_CONFIGURED`、`GRANT_REQUIRED` 等要用户做事的错误。

## 前置检查

能力有五种：转写（`transcribe`）、语音合成（`synthesizeSpeech`）、图片生成（`generateImage`）、文本生成（`generateText`）、人声与背景分离（`separateAudio`）。

- **文本生成与你无关。** 它是工具页与固定流程（{{tool:translate}} 这类）用的文本模型；翻译、润色、总结由你自己做，它没配置不影响你，也不能经它调用别的模型。
- 人声分离只在本机，只给翻译配音的「分离背景声」用。

## 命令与例子

| 要做的事 | 调用 |
| --- | --- |
| 看各能力可用的服务、模型、限制与默认值 | {{tool:models_capabilities}}；只看一种给 {{arg:capability}} |
| 看本机模型包装没装、状态 | {{tool:models_list}} |
| 装本机模型包 | {{tool:models_install}}；不给 {{arg:bundleId}} 时装这台机器默认的转写模型包，本机语音合成与生图必须给 |
| 检查装好的模型包能不能用 | {{tool:models_test}}，{{arg:bundleId}} |

{{tool:models_install}} 下载几百 MB 到几 GB：

<!-- surface: cli -->
- 不带 `--yes` 时只报模型包与大小、不下载，以退出码 4 返回。先把大小告诉用户，同意后再带 `--yes`。
- 下载可能很久：按 [conventions](../conventions.md) 的「等任务结束」给等待设上限。
<!-- /surface -->
<!-- surface: agent -->
- 提交前 BaoCut 会把大小告诉用户并按访问模式确认；你不要替用户同意。
<!-- /surface -->
- 已经装好时不下载（`jobId` 为 null）；之前没下完的会续传。不要重复提交。

## 结果怎么读

{{tool:models_capabilities}} 的每种能力：

- `effective`：不指定服务时实际会用的；为 null 时不指定服务的调用会以 `CAPABILITY_NOT_CONFIGURED` 拒绝。
- 每个服务与模型：是否可用及原因、限制（文本长度 `maxInputChars`、提示词长度、尺寸、张数、音色、格式、语速范围、接不接受语气说明 `acceptsInstructions`）、默认值。
- 本机服务的「模型」就是本地模型包：转写在 `transcribe` 下，合成在 `synthesizeSpeech` 下，生图在 `generateImage` 下。

{{tool:models_list}} 的每个模型包：`bundleId`、能力、状态（`not-installed`、`downloading`、`installed`、`ready` 等）与原因、下载大小的估计、最近一次检查（`selfTest`）。

{{tool:models_install}}：返回 `jobId` 与大小（`downloadBytes`；未知时看 `estimatedBytes`），等到 `completed` 才算装好。之后再提交转写；本机合成与生图没有出厂默认，提交 {{tool:speak}} 或 {{tool:image}} 时带上 {{arg:provider}} `local` 与 {{arg:model}}（这个模型包）。

{{tool:models_test}}：`completed` 是通过；`failed` 时 `error.details.check` 是原因。

## 「没配置」与「要授权」怎么处理

| 情况 | 处理 |
| --- | --- |
| {{tool:translate}} 报 `CAPABILITY_NOT_CONFIGURED` | 自己翻译（[subtitles](subtitles.md) 的自译路径），**不**请用户去配置 |
| 转写、语音合成、图片生成报 `CAPABILITY_NOT_CONFIGURED`，`remedy.action` 为 `install-model` | 本机模型包没装：告诉用户要装哪个、多大，同意后 {{tool:models_install}}，装好再重提 |
| 同上，其他 `remedy` | 要用户启用一项在线服务或配置账号：照 `remedy` 与 `next` 告诉用户要在哪里启用哪项，停在这里 |
| `GRANT_REQUIRED`、`GRANT_REVOKED` | 要把数据发给在线服务，但用户没有授权：照 `remedy` 转告用户 |
| `BUDGET_EXCEEDED`、`TASK_BUDGET_EXCEEDED` | 超了预算：转告用户，由用户决定 |
| `MODELS_DIR_MISSING` | 模型目录不在（例如外置盘没接上）：请用户接上或改设置 |
| `MODEL_FILES_DAMAGED` | 模型文件损坏：请用户在 BaoCut 里修复 |
| `OFFLINE_STRICT` | 用户开了严格离线：只能用本机服务，告诉用户 |

无论哪种，都**不**用 shell、脚本、别的网站或别的服务商绕过，不碰 API key 与凭据，不替用户改设置。
<!-- surface: cli -->
启用服务、配置账号、设默认值属于「本机管理」命令（`baocut models configure` 等），给人用：要么请用户自己做，要么在用户明确同意后照 `next` 执行；密钥只由用户自己输入。
<!-- /surface -->
<!-- surface: agent -->
启用服务、配置账号、设默认值由用户在 BaoCut 的设置里完成，你只说明要改哪一项。
<!-- /surface -->

## 常见错误码

见上一节的表；其余照 [conventions](../conventions.md) 的「错误对象怎么用」。

## 下一步

- 能力就绪：回到原来的任务页（[subtitles](subtitles.md)、[voice](voice.md)、[media](media.md)）重新提交。
- 用户暂时不配置：告诉用户哪一步做不了，其余能做的照常做完。

## 验收

- 没有替用户配置、同意或输入密钥。
- 装模型包前把大小告诉了用户并得到同意；装好后用 {{tool:models_list}} 或 {{tool:models_test}} 确认状态。
