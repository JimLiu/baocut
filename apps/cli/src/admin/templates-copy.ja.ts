import type { TemplatesMessages } from './templates-copy.ts';

export const ja: TemplatesMessages = {
  help: `使い方：
  baocut templates                 使える制作テンプレート（内蔵のものと <BAOCUT_HOME>/templates のもの）と、
                                   読み込めなかったテンプレートフォルダとその理由を一覧表示
  baocut templates show <id>       テンプレートのマニフェストの要点と prompt.md の全文を表示`,
  kindLabels: { scene: 'シーンテンプレート', example: '作例' },
  originLabels: { builtin: '内蔵', user: 'ユーザ' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? '比率は自動'} · ${seconds ? `${seconds} 秒` : '長さは自動'}`,
  summaryLine: (title: string, summary: string) => `${title}：${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) =>
    `テンプレート ${dir}（${origin}、${code}）：${message}`,
  folder: (path: string) => `  フォルダ：${path}`,
  none: '使えるテンプレートはありません',
  skipped: (n: number) => `${n} 個のテンプレートフォルダをスキップしました：`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) =>
    `${title}（${id} v${version}、${kind}、${origin}）`,
  meta: (category: string, spec: string, language: string) => `カテゴリ：${category}  比率と長さ：${spec}  言語：${language}`,
  author: (author: string, source: string, license: string) => `作者：${author}（${source}、${license}）`,
  tags: (tags: readonly string[]) => `タグ：${tags.join('、')}`,
  sample: (sample: string) => `話しかけ方の例：${sample}`,
  cover: (file: string) => `カバー：${file}`,
  preview: (file: string) => `プレビュー：${file}`,
  asset: (path: string, type: string, note: string) => `素材：${path}（${type}${note ? `、${note}` : ''}）`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `検証：${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `、書き出し ${v.output.ratio} · ${v.output.seconds} 秒` : ''}${v.missing.length ? `、不足 ${v.missing.join('、')}` : ''}`,
  templateFlag: (value: string) => `--template にはテンプレートの id（kebab-case。baocut templates を参照）を指定してください：${value}`,
};
