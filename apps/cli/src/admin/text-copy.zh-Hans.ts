import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const zhHans: TextMessages = {
  help: `用法：
  baocut text <提示> [选项]        调用一次文本模型；提示为 - 时从标准输入读。全文打到 stdout（给了 --out 时写进文件，
                                   stdout 改为任务与产物的 JSON）；任务进度、警告与模型版本打到 stderr
    --system <说明>                系统消息
    --json-schema <文件>           结构化输出：按这个 JSON Schema（根是 object）返回并校验，不合时任务以
                                   MODEL_OUTPUT_INVALID 失败
    --provider <id>                openai、google、anthropic 等目录里的服务商或 custom:<名字>；不给时用默认值（这种能力没有出厂默认）
    --model <id>                   模型；不给时用该 Provider 的默认模型
    --max-output-tokens <n>        输出上限；不给时用模型的上限。纯文本被截断时照样输出，带 output-truncated 警告
    --effort <${TEXT_EFFORTS.join('|')}>
                                   推理强度；模型没有这一档时换成最接近的，不能调节时忽略（stderr 有说明）
    --temperature <0–2>            只有接受的模型可以给
    --seed <n>                     只有接受的模型可以给
    --out <文件>                   把全文写进这个文件`,
  stdinPromptHint: '输入提示后按 Ctrl-D 结束：',
  missingPrompt: '缺少提示',
  jsonSchemaUnreadable: (file, reason) => `读不了 JSON Schema ${file}：${reason}`,
  jsonSchemaNotObject: '--json-schema 的文件要是一个 JSON 对象',
  singleModel: 'text 只接受一个 --model',
  maxOutputTokensInvalid: '--max-output-tokens 要是正整数',
  effortChoices: (efforts) => `--effort 可选 ${efforts.join('、')}`,
  temperatureRange: '--temperature 要在 0 到 2 之间',
  seedInvalid: '--seed 要是整数',
  noTextResult: '任务完成了，但没有文本结果',
  fetchOutputFailed: (artifactId, status) => `取回产物 ${artifactId} 失败：HTTP ${status}`,
  written: (file) => `已写入 ${file}`,
  modelLine: (provider, model, usage) => `${provider} / ${model}${usage ? `，输入 ${usage.input} / 输出 ${usage.output} token` : ''}`,
};
