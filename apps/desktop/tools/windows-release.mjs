// Publish only artifacts already validated by the native Windows build workflow.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLE_ID, feedFileName, parseManifest } from '../src/main/app-update-rules.ts';

const TARGET = 'x86_64-pc-windows-msvc';
const VARIANTS = ['cpu', 'cuda', 'vulkan'];
const invariant = (ok, message) => { if (!ok) throw new Error(message); };

export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export function validateCandidate(run, jobs, mac, variants, workflowId, repo) {
  invariant(run.status === 'completed', 'Candidate run is not complete');
  invariant(run.workflow_id === workflowId && run.event === 'workflow_dispatch', 'Unexpected candidate workflow');
  invariant(run.head_sha === mac.sourceCommit, 'Candidate source differs from the Mac build');
  invariant(run.head_repository?.full_name?.toLowerCase() === repo.toLowerCase(), 'Candidate belongs to another repository');
  for (const variant of variants) {
    invariant(VARIANTS.includes(variant), `Unsupported variant: ${variant}`);
    invariant(jobs.some((job) => job.name === `Package Windows x64 (${variant})` && job.conclusion === 'success'), `Native validation did not pass: ${variant}`);
  }
}

export async function validatePackage(directory, mac, tag, variant, repo) {
  invariant(VARIANTS.includes(variant), 'Unsupported package variant');
  const suffix = variant === 'cpu' ? '' : `-${variant}`;
  const stem = `BaoCut-${mac.version}-build.${mac.build}-win-x64${suffix}`;
  const reportFile = `${stem}-release.json`;
  const report = JSON.parse(readFileSync(path.join(directory, reportFile), 'utf8'));
  invariant(report.version === mac.version && report.build === mac.build, 'Windows release identity differs');
  invariant(report.appId === BUNDLE_ID && report.target === TARGET && report.variant === variant && report.unsigned === true, 'Unexpected Windows package identity');
  for (const [kind, file, format] of [['installer', `${stem}-setup.exe`, 'exe'], ['portable', `${stem}.zip`, 'zip']]) {
    const facts = report[kind];
    invariant(facts?.file === file && facts.format === format, 'Unexpected artifact name or format');
    const input = path.join(directory, file);
    invariant(statSync(input).isFile() && statSync(input).size === facts.size, `Artifact size differs: ${file}`);
    invariant(await fileHash(input) === facts.sha256, `Artifact checksum differs: ${file}`);
  }
  const feedName = feedFileName(TARGET, variant);
  invariant(report.feed === feedName, 'Unexpected update feed name');
  const text = readFileSync(path.join(directory, feedName), 'utf8');
  const parsed = parseManifest(text, TARGET, false, variant);
  invariant(parsed.ok, 'Windows appcast rejected by the App parser');
  const feed = JSON.parse(text);
  const url = new URL(feed.app.url);
  const parts = url.pathname.split('/').filter(Boolean);
  invariant(url.protocol === 'https:' && url.hostname === 'github.com' && !url.search && !url.hash && parts.length === 6 &&
    `${parts[0]}/${parts[1]}`.toLowerCase() === repo.toLowerCase() && parts[2] === 'releases' && parts[3] === 'download' && parts[4] === tag && parts[5] === report.installer.file, 'Appcast does not point to this GitHub release');
  invariant(feed.version === mac.version && feed.build === mac.build && feed.app.size === report.installer.size && feed.app.sha256 === report.installer.sha256, 'Appcast artifact differs from the installer');
  return { report, reportFile, feed, feedName, directory };
}

function command(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout;
}
const api = (endpoint) => JSON.parse(command('gh', ['api', endpoint]));

export async function publishWindows(env = process.env) {
  const repo = env.GITHUB_REPOSITORY || 'JimLiu/baocut';
  const runId = env.CANDIDATE_RUN_ID;
  const tag = env.RELEASE_TAG;
  const variants = (env.VARIANTS || 'cpu').split(',');
  invariant(/^\d+$/.test(runId || ''), 'Candidate run ID must be numeric');
  invariant(/^baocut-v\d+\.\d+\.\d+-build\.\d+$/.test(tag || ''), 'Invalid release tag');
  invariant(variants.length > 0 && new Set(variants).size === variants.length && variants.every((v) => VARIANTS.includes(v)), 'Invalid variant selection');
  const output = path.join(env.RUNNER_TEMP || tmpdir(), `baocut-windows-publish-${runId}`);
  mkdirSync(output, { recursive: true });
  const release = api(`repos/${repo}/releases/tags/${tag}`);
  invariant(!release.draft, 'Mac release must already be public');
  const latest = api(`repos/${repo}/releases/latest`).id;
  const macFile = path.join(output, 'mac-release.json');
  command('gh', ['release', 'download', tag, '--repo', repo, '--pattern', 'app-release.json', '--output', macFile]);
  const mac = JSON.parse(readFileSync(macFile, 'utf8'));
  invariant(mac.appId === BUNDLE_ID && mac.target === 'aarch64-apple-darwin' && mac.notarized === true && /^[a-f0-9]{40}$/.test(mac.sourceCommit), 'Invalid Mac release identity');
  invariant(tag === `baocut-v${mac.version}-build.${mac.build}`, 'Tag differs from the Mac release');
  const run = api(`repos/${repo}/actions/runs/${runId}`);
  const jobs = api(`repos/${repo}/actions/runs/${runId}/jobs?per_page=100`).jobs;
  const workflowId = api(`repos/${repo}/actions/workflows/desktop-windows.yml`).id;
  validateCandidate(run, jobs, mac, variants, workflowId, repo);
  const packages = [];
  for (const variant of variants) {
    const directory = path.join(output, variant);
    mkdirSync(directory, { recursive: true });
    command('gh', ['run', 'download', runId, '--repo', repo, '--name', `baocut-desktop-windows-x64-${variant}`, '--dir', directory]);
    const item = await validatePackage(directory, mac, tag, variant, repo);
    item.report.sourceCommit = mac.sourceCommit;
    item.report.candidateRunId = Number(runId);
    item.report.candidateRunUrl = run.html_url;
    item.report.releaseToolingCommit = env.GITHUB_SHA || command('git', ['rev-parse', 'HEAD']).trim();
    item.report.checks = { nativeWorkflow: 'passed', installedAndZipSelfCheck: 'passed', realGpuInference: 'not-run' };
    const previousReport = release.assets.find((asset) => asset.name === item.reportFile);
    if (previousReport) {
      const previous = path.join(output, `previous-${item.reportFile}`);
      command('gh', ['release', 'download', tag, '--repo', repo, '--pattern', item.reportFile, '--output', previous]);
      const content = readFileSync(previous, 'utf8');
      const existing = JSON.parse(content);
      invariant(existing.sourceCommit === mac.sourceCommit && existing.version === mac.version && existing.build === mac.build &&
        existing.variant === variant && existing.appId === BUNDLE_ID && existing.unsigned === true &&
        JSON.stringify(existing.installer) === JSON.stringify(item.report.installer) && JSON.stringify(existing.portable) === JSON.stringify(item.report.portable), 'Existing supplemental report differs from this candidate');
      writeFileSync(path.join(directory, item.reportFile), content);
    } else writeFileSync(path.join(directory, item.reportFile), `${JSON.stringify(item.report, null, 2)}\n`);
    for (const facts of [item.report.installer, item.report.portable]) writeFileSync(path.join(directory, `${facts.file}.sha256`), `${facts.sha256}  ${facts.file}\n`);
    packages.push(item);
  }
  // Validate the complete selected set before any external mutation.
  for (const item of packages) {
    const names = [item.report.installer.file, item.report.portable.file, `${item.report.installer.file}.sha256`, `${item.report.portable.file}.sha256`, item.reportFile, item.feedName];
    for (const name of names) {
      const local = path.join(item.directory, name);
      const existing = release.assets.find((asset) => asset.name === name);
      if (existing) {
        const downloaded = path.join(output, `existing-${name}`);
        command('gh', ['release', 'download', tag, '--repo', repo, '--pattern', name, '--output', downloaded]);
        invariant(await fileHash(downloaded) === await fileHash(local), `Existing immutable asset differs: ${name}`);
      } else {
        command('gh', ['release', 'upload', tag, '--repo', repo, local]);
      }
      const readback = path.join(output, `public-${name}`);
      command('curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '2', '--max-time', '300', `https://github.com/${repo}/releases/download/${tag}/${name}`, '--output', readback]);
      invariant(await fileHash(readback) === await fileHash(local), `Public read-back differs: ${name}`);
    }
  }
  const after = api(`repos/${repo}/releases/${release.id}`);
  for (const before of release.assets) invariant(after.assets.some((asset) => asset.id === before.id && asset.name === before.name && asset.size === before.size && asset.digest === before.digest), `Existing release asset changed: ${before.name}`);
  const marker = `<!-- baocut-windows-${runId} -->`;
  if (!(after.body || '').includes(marker)) {
    const notes = path.join(output, 'release-notes.md');
    writeFileSync(notes, `${after.body || ''}\n\n${marker}\n### Windows x64\n\nVariants: ${variants.join(', ')}. NSIS installers and portable ZIPs are unsigned. Windows credential storage is currently unsupported; model/Agent/GPU inference was not exercised by the installer tests.\n\nNative build and installer verification: ${run.html_url}\n`);
    command('gh', ['release', 'edit', tag, '--repo', repo, '--title', `BaoCut ${mac.version} (Build ${mac.build}) — macOS and Windows`, '--notes-file', notes, '--latest=false']);
  }
  invariant(api(`repos/${repo}/releases/latest`).id === latest, 'Latest release changed');
  // Advance only Windows pins, after public archive read-back, on the newest main.
  command('git', ['fetch', 'origin', 'main']);
  command('git', ['checkout', '--detach', 'origin/main']);
  const pins = [];
  for (const item of packages) {
    const target = path.join('apps/desktop/releases', item.feedName);
    const content = `${JSON.stringify(item.feed, null, 2)}\n`;
    if (existsSync(target) && readFileSync(target, 'utf8') === content) continue;
    if (existsSync(target)) invariant(JSON.parse(readFileSync(target, 'utf8')).build < mac.build, 'Do not replace a different feed at the same or newer build');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    pins.push(target);
  }
  if (pins.length) {
    command('git', ['config', 'user.name', 'github-actions[bot]']);
    command('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    command('git', ['add', '--', ...pins]);
    command('git', ['diff', '--cached', '--check']);
    command('git', ['commit', '-m', `Publish Windows ${mac.version} build ${mac.build} update feeds`]);
    command('gh', ['auth', 'setup-git']);
    command('git', ['push', 'origin', 'HEAD:main']);
  }
  for (const item of packages) {
    const downloaded = path.join(output, `live-${item.feedName}`);
    command('curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--max-time', '60', `https://raw.githubusercontent.com/${repo}/main/apps/desktop/releases/${item.feedName}`, '--output', downloaded]);
    invariant(parseManifest(readFileSync(downloaded, 'utf8'), TARGET, false, item.report.variant).ok, 'Live Windows feed rejected');
    invariant(await fileHash(downloaded) === await fileHash(path.join('apps/desktop/releases', item.feedName)), 'Live Windows pointer differs');
  }
  console.log(`Published Windows ${mac.version} build ${mac.build}: ${variants.join(', ')} — ${after.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishWindows().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
