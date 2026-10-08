// 把 baocut-app 的 `.bcut` 项目与外部视频项目导入成视频。用法见同目录的 README.md。
//
//   node scripts/legacy-import/import.ts --bcut <旧项目目录> --external <外部项目目录> --out <项目文件夹> [--dry-run] [--replace] [--only <名字片段>]

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { planBcutProject } from './bcut-project.ts';
import { EngineHost } from './engine-host.ts';
import { planExternalProject } from './external-project.ts';
import { count } from './video-plan.ts';
import type { ProjectPlan, ProjectReport } from './video-plan.ts';
import { IMPORTER, dryAssets, planContent, writeVideo } from './video-writer.ts';

const { values } = parseArgs({
  options: {
    bcut: { type: 'string', multiple: true, default: [] },
    external: { type: 'string', multiple: true, default: [] },
    out: { type: 'string' },
    report: { type: 'string' },
    only: { type: 'string', multiple: true, default: [] },
    'dry-run': { type: 'boolean', default: false },
    replace: { type: 'boolean', default: false },
    engine: { type: 'string' },
    ffprobe: { type: 'string' },
  },
});

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const dryRun = values['dry-run'];
const outRoot = values.out ? path.resolve(values.out) : undefined;
const reportDir = values.report ? path.resolve(values.report) : outRoot;
if (!dryRun && !outRoot) fail('要写视频，用 --out 指定项目文件夹；只想看会导入什么，加 --dry-run');
if (!reportDir) fail('用 --report 指定报告写到哪里（预演时没有 --out）');
if (values.bcut.length + values.external.length === 0) fail('用 --bcut <目录> 或 --external <目录> 指定要导入的旧项目');

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// ── 收集计划 ──────────────────────────────────────────────────────────
const taken = new Set<string>();
const plans: ProjectPlan[] = [];
const skipped: string[] = [];
for (const root of values.bcut.map((dir) => path.resolve(dir))) {
  // 既可以给单个 `.bcut` 目录，也可以给装着它们的目录。
  const dirs = existsSync(path.join(root, 'project.json'))
    ? [root]
    : readdirSync(root)
        .sort((a, b) => a.localeCompare(b))
        .map((entry) => path.join(root, entry));
  for (const dir of dirs) {
    if (path.basename(dir).startsWith('.')) continue;
    const plan = statSync(dir).isDirectory() ? planBcutProject(dir, taken) : null;
    if (plan) plans.push(plan);
    else skipped.push(dir);
  }
}
for (const dir of values.external.map((d) => path.resolve(d))) {
  const plan = planExternalProject(dir, taken);
  if (plan) plans.push(plan);
  else skipped.push(dir);
}
const wanted = values.only.map((text) => text.toLowerCase());
const selected = wanted.length === 0 ? plans : plans.filter((plan) => wanted.some((text) => plan.key.toLowerCase().includes(text)));
if (selected.length === 0) fail('没有选中任何项目');

// ── 执行 ──────────────────────────────────────────────────────────────
const started = Date.now();
if (dryRun) {
  for (const plan of selected) {
    try {
      const content = planContent(plan, dryAssets(plan));
      // 预演把每个视频会写进去的内容留一份，方便逐个检查；文档正文只留概要。
      const documents = content.documents.map(({ body, ...doc }) => ({ ...doc, bodyBytes: JSON.stringify(body).length }));
      mkdirSync(path.join(reportDir, 'plans'), { recursive: true });
      writeFileSync(path.join(reportDir, 'plans', `${plan.dirName}.json`), `${JSON.stringify({ ...content, documents }, null, 2)}\n`);
    } catch (error) {
      plan.report.failed.push(`计划失败：${(error as Error).message}`);
    }
    progress(plan);
  }
} else {
  const engine = values.engine ?? path.join(repoRoot, 'target', 'release', 'engine-host');
  if (!existsSync(engine)) fail(`找不到 engine-host：${engine}\n先运行 cargo build --release -p engine-host`);
  const ffprobe = values.ffprobe ?? process.env.BAOCUT_FFPROBE ?? execFileSync('which', ['ffprobe'], { encoding: 'utf8' }).trim();
  mkdirSync(outRoot as string, { recursive: true });
  const host = new EngineHost(engine, ffprobe);
  await host.request('host.hello', {});
  for (const plan of selected) {
    try {
      await writeVideo(host, plan, outRoot as string, values.replace);
    } catch (error) {
      plan.report.failed.push(`导入中断：${(error as Error).message}`);
    }
    progress(plan);
  }
  host.close();
}

function progress(plan: ProjectPlan): void {
  const r = plan.report;
  const items = Object.values(r.items).reduce((a, b) => a + b, 0);
  const flags = [
    r.assets.missing.length ? `缺 ${r.assets.missing.length} 个素材` : '',
    r.failed.length ? `失败 ${r.failed.length}` : '',
  ].filter(Boolean);
  process.stderr.write(`${r.failed.length ? '✗' : '✓'} ${plan.key} · ${r.kind} · ${items} 个实例 ${flags.join(' · ')}\n`);
}

// ── 报告 ──────────────────────────────────────────────────────────────
const reports = selected.map((plan) => plan.report);
const suffix = dryRun ? '.dry-run' : '';
mkdirSync(reportDir, { recursive: true });
const summary = {
  importer: IMPORTER,
  mode: dryRun ? 'dry-run' : 'import',
  generatedAt: new Date().toISOString(),
  elapsedSeconds: Math.round((Date.now() - started) / 1000),
  sources: { bcut: values.bcut, external: values.external },
  out: outRoot ?? null,
  skipped,
  projects: reports,
};
writeFileSync(path.join(reportDir, `import-report${suffix}.json`), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(path.join(reportDir, `import-report${suffix}.md`), markdown(reports));
process.stderr.write(`报告：${path.join(reportDir, `import-report${suffix}.md`)}\n`);
if (reports.some((r) => r.failed.length > 0)) process.exitCode = 1;

function markdown(all: ProjectReport[]): string {
  const total = (pick: (r: ProjectReport) => Record<string, number>): Record<string, number> => {
    const sum: Record<string, number> = {};
    for (const r of all) for (const [key, n] of Object.entries(pick(r))) count(sum, key, n);
    return sum;
  };
  const list = (table: Record<string, number>): string =>
    Object.entries(table)
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => `${key} ${n}`)
      .join('，') || '无';
  const sum = (pick: (r: ProjectReport) => number): number => all.reduce((n, r) => n + pick(r), 0);
  const kinds: Record<string, number> = {};
  for (const r of all) count(kinds, r.kind);
  const fpsText = (r: ProjectReport): string => (r.fps.rate.den === 1 ? String(r.fps.rate.num) : `${r.fps.rate.num}/${r.fps.rate.den}`);
  const seconds = (r: ProjectReport): string =>
    r.durationFrames == null ? '—' : `${((r.durationFrames * r.fps.rate.den) / r.fps.rate.num).toFixed(1)}s`;
  const cell = (text: string): string => text.replaceAll('|', '\\|');

  const lines: string[] = [];
  lines.push(`# 旧项目导入报告${dryRun ? '（预演，没有写任何视频）' : ''}`, '');
  lines.push(`- 生成时间：${summary.generatedAt}；导入器 ${IMPORTER.name} v${IMPORTER.version}`);
  if (outRoot) lines.push(`- 项目文件夹：\`${outRoot}\``);
  lines.push(`- 项目：${all.length} 个（${list(kinds)}）；有失败项的 ${all.filter((r) => r.failed.length > 0).length} 个`);
  lines.push(
    `- 素材：登记 ${sum((r) => r.assets.linked)} 个（全部按原路径链接），同内容复用 ${sum((r) => r.assets.reused)} 个，` +
      `找不到文件 ${sum((r) => r.assets.missing.length)} 个，内容与旧项目记录的摘要不一致 ${sum((r) => r.assets.hashChanged.length)} 个`,
  );
  lines.push(`- 文档：${list(total((r) => r.documents))}`);
  lines.push(`- 实例：${list(total((r) => r.items))}；轨道 ${sum((r) => r.tracks)} 条`);
  lines.push(
    `- 时间：画面吸附到帧的最大偏移 ${Math.max(0, ...all.map((r) => r.time.maxSnapMs)).toFixed(2)} ms；尾部收进素材时长 ${sum((r) => r.time.clampedTails)} 处`,
  );
  lines.push(`- 写进序列的对象：${list(total((r) => r.written))}`);
  lines.push(
    `- 词锚点：求出 ${sum((r) => r.anchors.resolved)} 个元素（写成 speech-anchor），求不出 ${sum((r) => r.anchors.unresolved)} 个（没有导入）`,
  );
  lines.push(`- 生效长度比写入短的单侧转场：${sum((r) => r.shortenedTransitions.length)} 条`);
  lines.push(`- 超出取值范围、夹进范围的：${list(total((r) => r.clamped))}`);
  lines.push(`- 新格式不接受、没有带过来的：${list(total((r) => r.dropped))}`);
  lines.push(`- 没有对应字段、原样留在扩展里的：${list(total((r) => r.unmapped))}`);
  lines.push(`- 不适用（新格式里没有这种行为或对应，键里写原因）：${list(total((r) => r.notApplicable))}`);
  lines.push(`- 导入时估算的：${list(total((r) => r.estimated))}`, '');

  lines.push(
    '## 各项目',
    '',
    '| 项目 | 类型 | 帧率 | 画布 | 素材 | 文档 | 实例 | 时长 | 提示 | 失败 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of all) {
    const assets = `${r.assets.linked + r.assets.reused}${r.assets.missing.length ? `（缺 ${r.assets.missing.length}）` : ''}`;
    const docs = Object.values(r.documents).reduce((a, b) => a + b, 0);
    const items = Object.values(r.items).reduce((a, b) => a + b, 0);
    lines.push(
      `| ${cell(path.basename(r.source))} | ${r.kind} | ${fpsText(r)} | ${r.canvas.width}×${r.canvas.height} | ${assets} | ${docs} | ${items} | ${seconds(r)} | ${r.warnings.length} | ${r.failed.length} |`,
    );
  }
  lines.push('');

  const noted = all.filter(
    (r) =>
      r.failed.length + r.warnings.length + r.shortenedTransitions.length + r.assets.missing.length + r.assets.hashChanged.length > 0 ||
      r.fps.note ||
      r.canvas.note,
  );
  if (noted.length > 0) lines.push('## 需要留意的项目', '');
  for (const r of noted) {
    lines.push(`### ${path.basename(r.source)}`, '');
    if (r.fps.note) lines.push(`- 帧率：${r.fps.note}（旧值 ${r.fps.legacy ?? '无'}）`);
    if (r.canvas.note) lines.push(`- 画布：${r.canvas.note}`);
    for (const text of r.failed) lines.push(`- **失败**：${text}`);
    for (const file of r.assets.missing) lines.push(`- 找不到素材文件：\`${file}\``);
    for (const file of r.assets.hashChanged) lines.push(`- 文件内容与旧项目记录的摘要不一致：\`${file}\``);
    for (const t of r.shortenedTransitions)
      lines.push(`- 实例 ${t.sourceId} 的 ${t.side} 转场写入 ${t.durationFrames} 帧，实例太短，生效 ${t.effectiveFrames} 帧`);
    for (const text of r.warnings) lines.push(`- ${text}`);
    lines.push('');
  }

  const left: Record<string, number> = {};
  for (const r of all) for (const text of r.notImported) count(left, text);
  if (Object.keys(left).length > 0) {
    lines.push('## 没有导入的旧数据', '');
    for (const [text, n] of Object.entries(left).sort((a, b) => b[1] - a[1])) lines.push(`- ${text}（${n} 个项目）`);
    lines.push('');
  }
  if (skipped.length > 0) {
    lines.push('## 不是项目、跳过的条目', '');
    for (const dir of skipped) lines.push(`- \`${dir}\``);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
