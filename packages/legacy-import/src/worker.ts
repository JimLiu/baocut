import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { planBcutProject } from './bcut-project.ts';
import { planV1Project } from './v1-project.ts';
import { EngineHost } from './engine-host.ts';
import { writeVideo } from './video-writer.ts';

async function main(): Promise<void> {
  const [requestFile] = process.argv.slice(2);
  if (!requestFile) throw new Error('Missing import request');
  const request = JSON.parse(readFileSync(requestFile, 'utf8'));
  if (process.platform === 'win32' && request.version !== 2) throw new Error('Windows supports legacy v2 projects only');
  const plan =
    request.version === 1
      ? planV1Project(request.source, request.entry, path.join(request.target, 'legacy-media'))
      : planBcutProject(request.source, new Set());
  if (!plan) throw new Error('Invalid legacy project');
  plan.dirName = 'video';
  mkdirSync(request.target, { recursive: true });
  // Fail before creating a partial video when media is offline. Restoring the
  // media can then retry without changing already-committed document steps.
  const missing = plan.assets.flatMap((asset) =>
    !existsSync(asset.path)
      ? [asset.path]
      : (asset.include ?? []).map((file) => path.join(asset.path, file)).filter((file) => !existsSync(file)),
  );
  if (missing.length) {
    plan.report.assets.missing = missing;
    writeFileSync(path.join(request.target, 'import-report.json'), JSON.stringify(plan.report, null, 2), { mode: 0o600 });
    throw new Error('Legacy media unavailable');
  }
  const host = new EngineHost(request.engine, process.env.BAOCUT_FFPROBE || 'ffprobe');
  process.on('message', (message) => {
    if ((message as { type?: string })?.type === 'stop') {
      host.close();
      process.exitCode = 1;
    }
  });
  process.on('SIGTERM', () => {
    host.close();
    process.exitCode = 1;
  });
  let finished = false;
  process.on('disconnect', () => {
    if (!finished) {
      host.close();
      process.exitCode = 1;
    }
  });
  try {
    await host.request('host.hello', {});
    await writeVideo(host, plan, request.target, false);
  } finally {
    host.close();
    writeFileSync(path.join(request.target, 'import-report.json'), JSON.stringify(plan.report, null, 2), { mode: 0o600 });
  }
  finished = true;
  if (process.connected) process.disconnect();
  if (plan.report.failed.length || plan.report.assets.missing.length) throw new Error('Incomplete legacy import');
}
main().catch(() => {
  if (process.connected) process.disconnect();
  process.stderr.write('Legacy project import failed; inspect import-report.json.\n');
  process.exitCode = 1;
});
