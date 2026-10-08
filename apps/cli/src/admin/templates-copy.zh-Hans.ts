import type { TemplatesMessages } from './templates-copy.ts';

export const zhHans: TemplatesMessages = {
  help: `用法：
  baocut templates                 列出可用的创作模板（内置的与 <BAOCUT_HOME>/templates 里的），以及没能加载的模板目录与原因
  baocut templates show <id>       显示一个模板的清单要点与 prompt.md 全文`,
  kindLabels: { scene: '场景模板', example: '作品示例' },
  originLabels: { builtin: '内置', user: '用户' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? '画幅自动'} · ${seconds ? `${seconds} 秒` : '时长自动'}`,
  summaryLine: (title: string, summary: string) => `${title}：${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin}模板 ${dir}（${code}）：${message}`,
  folder: (path: string) => `  目录：${path}`,
  none: '没有可用的模板',
  skipped: (n: number) => `跳过了 ${n} 个模板目录：`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) => `${title}（${id} v${version}，${kind}，${origin}）`,
  meta: (category: string, spec: string, language: string) => `分类：${category}  画幅与时长：${spec}  语言：${language}`,
  author: (author: string, source: string, license: string) => `作者：${author}（${source}，${license}）`,
  tags: (tags: readonly string[]) => `标签：${tags.join('、')}`,
  sample: (sample: string) => `可以这样说：${sample}`,
  cover: (file: string) => `封面：${file}`,
  preview: (file: string) => `预览：${file}`,
  asset: (path: string, type: string, note: string) => `素材：${path}（${type}）${note}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `验证：${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `，成片 ${v.output.ratio} · ${v.output.seconds} 秒` : ''}${v.missing.length ? `，缺 ${v.missing.join('、')}` : ''}`,
  templateFlag: (value: string) => `--template 要给模板 id（kebab-case，见 baocut templates）：${value}`,
};
