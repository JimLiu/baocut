import type { TemplatesMessages } from './templates-copy.ts';

export const ko: TemplatesMessages = {
  help: `사용법:
  baocut templates                 사용할 수 있는 제작 템플릿 목록(내장 템플릿과 <BAOCUT_HOME>/templates의 템플릿),
                                   불러오지 못한 템플릿 폴더와 그 이유
  baocut templates show <id>       템플릿 매니페스트의 요점과 prompt.md 전문을 보여 줍니다`,
  kindLabels: { scene: '장면 템플릿', example: '예시' },
  originLabels: { builtin: '내장', user: '사용자' },
  spec: (ratio: string | null, seconds: number | null) => `${ratio ?? '비율 자동'} · ${seconds ? `${seconds}초` : '길이 자동'}`,
  summaryLine: (title: string, summary: string) => `${title}: ${summary}`,
  diagnosticHead: (origin: string, dir: string, code: string, message: string) => `${origin} 템플릿 ${dir}(${code}): ${message}`,
  folder: (path: string) => `  폴더: ${path}`,
  none: '사용할 수 있는 템플릿이 없습니다',
  skipped: (n: number) => `템플릿 폴더 ${n}개를 건너뛰었습니다:`,
  detailHead: (title: string, id: string, version: string, kind: string, origin: string) =>
    `${title}(${id} v${version}, ${kind}, ${origin})`,
  meta: (category: string, spec: string, language: string) => `분류: ${category}  비율과 길이: ${spec}  언어: ${language}`,
  author: (author: string, source: string, license: string) => `만든 이: ${author}(${source}, ${license})`,
  tags: (tags: readonly string[]) => `태그: ${tags.join(', ')}`,
  sample: (sample: string) => `이렇게 말해 보세요: ${sample}`,
  cover: (file: string) => `커버: ${file}`,
  preview: (file: string) => `미리보기: ${file}`,
  asset: (path: string, type: string, note: string) => `소재: ${path}(${type})${note ? ` ${note}` : ''}`,
  verification: (v: {
    date: string;
    engine: string;
    version: string;
    outcome: string;
    output: { ratio: string; seconds: number } | null;
    missing: readonly string[];
  }) =>
    `검증: ${v.date} ${v.engine} v${v.version} ${v.outcome}${v.output ? `, 내보내기 ${v.output.ratio} · ${v.output.seconds}초` : ''}${v.missing.length ? `, 누락 ${v.missing.join(', ')}` : ''}`,
  templateFlag: (value: string) => `--template에는 템플릿 id(kebab-case, baocut templates 참고)를 지정하세요: ${value}`,
};
