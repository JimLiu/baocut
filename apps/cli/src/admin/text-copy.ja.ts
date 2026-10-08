import { TEXT_EFFORTS } from '@baocut/protocol';
import type { TextMessages } from './text-copy.ts';

export const ja: TextMessages = {
  help: `使い方：
  baocut text <prompt> [options]   テキストモデルを 1 回呼び出す。プロンプトが - の場合は標準入力から読み込みます。全文は
                                   stdout に出力（--out を指定するとファイルに書き込み、stdout にはタスクと生成物の
                                   JSON を出力）。タスクの進行状況、警告、モデルのバージョンは stderr に出力
    --system <text>                システムメッセージ
    --json-schema <file>           構造化出力：この JSON Schema（最上位はオブジェクト）に従って返し、検証します。
                                   一致しない場合、タスクは MODEL_OUTPUT_INVALID で失敗
    --provider <id>                openai、google、anthropic などのカタログのプロバイダ、または custom:<name>。
                                   省略すると既定を使用（この機能には初期設定の既定はありません）
    --model <id>                   モデル。省略するとプロバイダの既定のモデル
    --max-output-tokens <n>        出力の上限。省略するとモデルの上限。プレーンテキストが途中で切れても
                                   そのまま出力し、output-truncated の警告を付けます
    --effort <${TEXT_EFFORTS.join('|')}>
                                   推論強度。モデルにこのレベルがなければ最も近いレベルを使い、
                                   調整できないモデルでは無視します（stderr で説明）
    --temperature <0–2>            対応しているモデルのみ
    --seed <n>                     対応しているモデルのみ
    --out <file>                   全文をこのファイルに書き込む`,
  stdinPromptHint: 'プロンプトを入力し、Ctrl-D で終了してください：',
  missingPrompt: 'プロンプトがありません',
  jsonSchemaUnreadable: (file, reason) => `JSON Schema ${file} を読み取れません：${reason}`,
  jsonSchemaNotObject: '--json-schema のファイルには JSON オブジェクトが必要です',
  singleModel: 'text で指定できる --model は 1 つだけです',
  maxOutputTokensInvalid: '--max-output-tokens には正の整数を指定してください',
  effortChoices: (efforts) => `--effort には ${efforts.join('、')} のいずれかを指定してください`,
  temperatureRange: '--temperature には 0 から 2 までの値を指定してください',
  seedInvalid: '--seed には整数を指定してください',
  noTextResult: 'タスクは完了しましたが、テキストが返されませんでした',
  fetchOutputFailed: (artifactId, status) => `生成物 ${artifactId} を取得できませんでした：HTTP ${status}`,
  written: (file) => `${file} に書き込みました`,
  modelLine: (provider, model, usage) =>
    `${provider} / ${model}${usage ? `、入力 ${usage.input} / 出力 ${usage.output} トークン` : ''}`,
};
