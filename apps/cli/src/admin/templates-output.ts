import {
  TEMPLATE_ID_PATTERN,
  live,
  templateExampleText,
  type TemplateDetail,
  type TemplateDiagnostic,
  type TemplateListResult,
  type TemplateSendRef,
  type TemplateSummary,
} from '@baocut/protocol';
import { M } from './templates-copy.ts';

/**
 * `baocut templates` 的输出（模板包规范 §6）。从 main.ts 分出来，单独可测。
 */

const KIND_LABELS: Readonly<Record<TemplateSummary['manifest']['kind'], string>> = live(() => M.kindLabels);
const ORIGIN_LABELS: Readonly<Record<TemplateSummary['origin'], string>> = live(() => M.originLabels);

/** 「16:9 · 60 秒」；没定的写「自动」。 */
function spec(template: TemplateSummary): string {
  const { ratio, durationSeconds } = template.manifest;
  return M.spec(ratio ?? null, durationSeconds || null);
}

/** 列表里的一行：`<id>  <种类>  <来源>  <画幅 · 时长>  <标题>：<一句话>`。 */
export function describeTemplate(template: TemplateSummary): string {
  const { manifest } = template;
  return `${manifest.id}  ${KIND_LABELS[manifest.kind]}  ${ORIGIN_LABELS[template.origin]}  ${spec(template)}  ${M.summaryLine(manifest.title, manifest.summary)}`;
}

export function describeDiagnostic(diagnostic: TemplateDiagnostic): string {
  const head = M.diagnosticHead(ORIGIN_LABELS[diagnostic.origin], diagnostic.dir, diagnostic.code, diagnostic.message);
  return [head, ...diagnostic.issues.map((issue) => `  - ${issue}`), M.folder(diagnostic.path)].join('\n');
}

/** `baocut templates`：先场景模板后作品示例，各按 id；跳过的模板在最后。 */
export function formatTemplateList(result: TemplateListResult): string[] {
  const order = (t: TemplateSummary) => (t.manifest.kind === 'scene' ? 0 : 1);
  const sorted = [...result.templates].sort((a, b) => order(a) - order(b) || a.manifest.id.localeCompare(b.manifest.id));
  const lines = sorted.length ? sorted.map(describeTemplate) : [M.none];
  if (result.diagnostics.length) {
    lines.push('', M.skipped(result.diagnostics.length), ...result.diagnostics.map(describeDiagnostic));
  }
  return lines;
}

/** `baocut templates show <id>`：清单要点与 `prompt.md` 全文。 */
export function formatTemplateDetail(detail: TemplateDetail): string[] {
  const { manifest, origin, files } = detail.template;
  const lines = [
    M.detailHead(manifest.title, manifest.id, manifest.version, KIND_LABELS[manifest.kind], ORIGIN_LABELS[origin]),
    manifest.summary,
    manifest.description,
    M.meta(manifest.category, spec(detail.template), manifest.language),
    M.author(manifest.author, manifest.source, manifest.license),
  ];
  if (manifest.tags.length) lines.push(M.tags(manifest.tags));
  if (manifest.brief) lines.push(M.sample(templateExampleText(manifest.brief, manifest.fields)));
  if (files.cover) lines.push(M.cover(manifest.cover.file ?? ''));
  if (files.preview) lines.push(M.preview(manifest.preview.file ?? ''));
  for (const asset of manifest.assets ?? []) lines.push(M.asset(asset.path, asset.type, asset.note));
  const check = manifest.verification;
  if (check) {
    lines.push(
      M.verification({
        date: check.date,
        engine: check.engine,
        version: check.version,
        outcome: check.outcome,
        output: check.output ? { ratio: check.output.ratio, seconds: check.output.durationSeconds } : null,
        missing: check.capabilities,
      }),
    );
  }
  lines.push('', '--- prompt.md ---', detail.prompt.trimEnd());
  return lines;
}

/**
 * `baocut chat --template <id>`：发送时挂的场景模板（模板包规范 §5.2）。只带 id，版本与素材交给 Runtime 按目录里当前的模板决定；
 * id 不是 kebab-case 时在本地就拒绝。作品示例能不能挂由 Runtime 判断（`TEMPLATE_NOT_SCENE`）。
 */
export function parseChatTemplate(value: string | undefined): TemplateSendRef | undefined {
  if (value === undefined) return undefined;
  const id = value.trim();
  if (!TEMPLATE_ID_PATTERN.test(id)) throw new Error(M.templateFlag(value));
  return { id };
}
