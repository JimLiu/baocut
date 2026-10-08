import type { TemplatesMessages } from './templates-copy.ts';

export const zhHant: TemplatesMessages = {
  help: `用法：
  baocut templates                 列出可用的創作範本（內建的與 <BAOCUT_HOME>/templates 中的），
                                   以及未能載入的範本資料夾與原因
  baocut templates show <id>       顯示範本資訊清單的重點與完整的 prompt.md`,
  kindLabels: { scene: '場景範本', example: '作品範例' },
  originLabels: { builtin: '內建', user: '使用者' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? '自動長寬比'} · ${seconds ? `${seconds} 秒` : '自動長度'}`,
  summaryLine: (title: string, summary: string) => `${title}：${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin}範本 ${dir}（${code}）：${message}`,
  folder: (path: string) => `  資料夾：${path}`,
  none: '沒有可用的範本',
  skipped: (n: number) => `已略過 ${n} 個範本資料夾：`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) =>
    `${title}（${id} v${version}，${kind}，${origin}）`,
  meta: (category: string, spec: string, language: string) => `分類：${category}  長寬比與長度：${spec}  語言：${language}`,
  author: (author: string, source: string, license: string) => `作者：${author}（${source}，${license}）`,
  tags: (tags: readonly string[]) => `標籤：${tags.join('、')}`,
  sample: (sample: string) => `試著這樣說：${sample}`,
  cover: (file: string) => `封面：${file}`,
  preview: (file: string) => `預覽：${file}`,
  asset: (path: string, type: string, note: string) => `素材：${path}（${type}）${note}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `驗證：${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `，成品 ${v.output.ratio} · ${v.output.seconds} 秒` : ''}${v.missing.length ? `，缺少 ${v.missing.join('、')}` : ''}`,
  templateFlag: (value: string) => `--template 需要範本 id（kebab-case，請見 baocut templates）：${value}`,
};
