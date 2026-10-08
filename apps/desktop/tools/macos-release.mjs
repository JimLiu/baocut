// Native candidates and public read-back share the App's actual update parser.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUNDLE_ID, feedFileName, parseManifest } from '../src/main/app-update-rules.ts';
import { fileHash } from './windows-release.mjs';
import { runMac, verifyMacIdentity } from './macos-distribution.mjs';
import { validateReleaseRef } from './desktop-release-rules.mjs';

const TARGET = 'aarch64-apple-darwin';
const FEED = feedFileName(TARGET, null);
const ensure = (ok, message) => { if (!ok) throw new Error(message); };
function command(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
const api = (endpoint) => JSON.parse(command('gh', ['api', endpoint]));

/** GitHub's by-tag endpoint excludes drafts; authenticated release lists include them. */
export function findMacRelease(repo, tag, get = api) {
  const releases = get(`repos/${repo}/releases?per_page=100`);
  return releases.find((release) => release.tag_name === tag);
}

export function publicReport(report) {
  const sanitized = Object.fromEntries(['schema', 'product', 'appId', 'version', 'build', 'target', 'sourceCommit', 'minimumSystemVersion',
    'portable', 'installer', 'notarySubmissionId', 'dmgNotarySubmissionId', 'notarized', 'unsigned', 'signingSha1',
    'workflowCommit', 'candidateRunId', 'candidateRunUrl', 'checks'].map((key) => [key, report[key]]));
  for (const kind of ['portable', 'installer']) sanitized[kind] = Object.fromEntries(['format', 'file', 'size', 'sha256'].map((key) => [key, report[kind]?.[key]]));
  return sanitized;
}

export async function validateMacPackage(directory, expected) {
  const report = JSON.parse(readFileSync(path.join(directory, 'app-release.json'), 'utf8'));
  ensure(report.appId === BUNDLE_ID && report.target === TARGET && report.product === 'BaoCut', 'Unexpected Mac package identity');
  ensure(/^\d+\.\d+\.\d+$/.test(report.version) && Number.isSafeInteger(report.build) && report.build > 0, 'Invalid version or build');
  ensure(report.notarized === true && report.unsigned === false && report.signingSha1 === expected.signingSha1, 'Mac notarization or signing identity differs');
  ensure(/^[a-f0-9]{40}$/.test(report.sourceCommit) && report.sourceCommit === expected.sourceCommit, 'Mac source commit differs');
  ensure(/^[a-f0-9-]{36}$/.test(report.notarySubmissionId) && /^[a-f0-9-]{36}$/.test(report.dmgNotarySubmissionId), 'Missing notarization IDs');
  const tag = `baocut-v${report.version}-build.${report.build}`;
  for (const [kind, format] of [['portable', 'zip'], ['installer', 'dmg']]) {
    const facts = report[kind];
    const name = `BaoCut-${report.version}-build.${report.build}-${TARGET}.${format}`;
    ensure(facts?.file === name && facts.format === format && Number.isSafeInteger(facts.size) && facts.size > 0, 'Unexpected Mac archive facts');
    const file = path.join(directory, name);
    ensure(statSync(file).isFile() && statSync(file).size === facts.size && await fileHash(file) === facts.sha256, 'Mac archive hash or size differs');
    ensure(readFileSync(`${file}.sha256`, 'utf8') === `${facts.sha256}  ${name}\n`, 'Mac checksum file differs');
  }
  const feedText = readFileSync(path.join(directory, FEED), 'utf8');
  const feed = JSON.parse(feedText);
  ensure(parseManifest(feedText, TARGET, false).ok, 'Mac feed rejected by the App parser');
  ensure(feed.version === report.version && feed.build === report.build && feed.app.format === 'zip' &&
    feed.app.size === report.portable.size && feed.app.sha256 === report.portable.sha256 &&
    feed.app.url === `https://github.com/jimliu/baocut/releases/download/${tag}/${report.portable.file}`, 'Mac feed points to another release or archive');
  return { report, tag, feed, feedText, names: [report.portable.file, report.installer.file,
    `${report.portable.file}.sha256`, `${report.installer.file}.sha256`, 'app-release.json', FEED] };
}

async function prepareCandidate(directory, env) {
  const item = await validateMacPackage(directory, { sourceCommit: env.GITHUB_SHA, signingSha1: env.BAOCUT_MAC_SIGNING_SHA1 });
  ensure(item.report.sourceCommit === command('git', ['rev-parse', 'HEAD']).trim(), 'Checkout differs from workflow commit');
  const report = publicReport({ ...item.report, workflowCommit: env.GITHUB_SHA, candidateRunId: Number(env.GITHUB_RUN_ID),
    candidateRunUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    checks: { runtimeSelfCheck: 'passed', nativeWorkerProbes: 'passed', signingAndGatekeeper: 'passed',
      uiAndExport: 'not-run', realModelInference: 'not-run', paidAgentRequests: 'not-run' } });
  writeFileSync(path.join(directory, 'app-release.json'), `${JSON.stringify(report, null, 2)}\n`);
  const publicDirectory = path.join(env.RUNNER_TEMP, 'mac-release-public');
  mkdirSync(publicDirectory);
  for (const name of item.names) command('cp', [path.join(directory, name), path.join(publicDirectory, name)]);
  console.log('Prepared six verified public files; temporary signing credentials and intermediate submissions excluded.');
}

async function publishCandidate(directory, env) {
  ensure(process.platform === 'darwin' && process.arch === 'arm64', 'Public Mac read-back requires native Apple Silicon');
  const repo = env.GITHUB_REPOSITORY;
  ensure(repo?.toLowerCase() === 'jimliu/baocut', 'Publish only from the owning repository');
  const item = await validateMacPackage(directory, { sourceCommit: env.GITHUB_SHA, signingSha1: env.BAOCUT_MAC_SIGNING_SHA1 });
  const { report, tag } = item;
  validateReleaseRef(env.GITHUB_REF, tag);
  command('git', ['fetch', 'origin', 'main']);
  command('git', ['merge-base', '--is-ancestor', report.sourceCommit, 'origin/main']);
  ensure(report.workflowCommit === env.GITHUB_SHA && report.candidateRunId === Number(env.GITHUB_RUN_ID) &&
    report.checks?.nativeWorkerProbes === 'passed' && report.checks?.signingAndGatekeeper === 'passed', 'Missing native candidate provenance or verification');
  const latestId = api(`repos/${repo}/releases/latest`).id;
  let release = findMacRelease(repo, tag);
  // Create the exact lightweight tag explicitly; a draft release may not create it yet.
  const remoteTag = command('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]).trim();
  if (!remoteTag) {
    ensure(!release || (release.draft && release.target_commitish === report.sourceCommit), 'Existing draft has a different target');
    command('gh', ['api', '--method', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/tags/${tag}`, '-f', `sha=${report.sourceCommit}`]);
  }
  command('git', ['fetch', 'origin', `refs/tags/${tag}:refs/tags/${tag}`]);
  ensure(command('git', ['rev-parse', `${tag}^{commit}`]).trim() === report.sourceCommit, 'Release tag differs from the build source');
  if (!release) {
    const notes = path.join(env.RUNNER_TEMP, 'mac-release-notes.md');
    writeFileSync(notes, `BaoCut ${report.version} (Build ${report.build}) for Apple Silicon, macOS 14+.\n\nBundle ID: com.baocut.app. Developer ID signed, hardened runtime and Apple notarization accepted for both App and DMG.\n\nRuntime and native Worker startup, signer fingerprint, staple and Gatekeeper checks passed. UI/export, real model inference and paid Agent calls were not exercised by this workflow. ffmpeg/ffprobe and an agent engine are external dependencies.\n\nSource: ${report.sourceCommit}\nActions: ${report.candidateRunUrl}\n`);
    command('gh', ['release', 'create', tag, '--repo', repo, '--target', report.sourceCommit, '--draft', '--latest=false',
      '--title', `BaoCut ${report.version} (Build ${report.build}) — macOS`, '--notes-file', notes]);
    release = findMacRelease(repo, tag);
    ensure(release, 'Created draft release is not visible yet; retry publication with the same candidate');
  }
  // Tags and existing assets are immutable, including partially completed uploads.
  for (const name of item.names) {
    const file = path.join(directory, name);
    const previous = release.assets.find((asset) => asset.name === name);
    if (previous) {
      const existing = path.join(env.RUNNER_TEMP, `existing-${name}`);
      command('gh', ['release', 'download', tag, '--repo', repo, '--pattern', name, '--output', existing]);
      ensure(await fileHash(existing) === await fileHash(file), `Existing immutable asset differs: ${name}`);
    } else command('gh', ['release', 'upload', tag, '--repo', repo, file]);
  }
  command('gh', ['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=false']);
  const readback = path.join(env.RUNNER_TEMP, 'mac-public-readback');
  mkdirSync(readback);
  for (const name of item.names) {
    command('curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--max-time', '300',
      `https://github.com/${repo}/releases/download/${tag}/${name}`, '--output', path.join(readback, name)]);
    ensure(await fileHash(path.join(readback, name)) === await fileHash(path.join(directory, name)), `Public read-back differs: ${name}`);
  }
  await validateMacPackage(readback, { sourceCommit: report.sourceCommit, signingSha1: report.signingSha1 });
  const extracted = path.join(readback, 'extracted');
  mkdirSync(extracted);
  runMac('ditto', ['-x', '-k', path.join(readback, report.portable.file), extracted]);
  const app = path.join(extracted, 'BaoCut.app');
  verifyMacIdentity(app, { ...report, output: readback });
  runMac('xcrun', ['stapler', 'validate', app]);
  runMac('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  command(process.execPath, ['apps/desktop/tools/check-packaged-app.mjs', app]);
  const dmg = path.join(readback, report.installer.file);
  runMac('codesign', ['--verify', '--strict', dmg]);
  runMac('xcrun', ['stapler', 'validate', dmg]);
  runMac('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', dmg]);
  ensure(api(`repos/${repo}/releases/latest`).id === latestId, 'Historical Latest release changed');
  const after = api(`repos/${repo}/releases/${release.id}`);
  for (const previous of release.assets) ensure(after.assets.some((asset) => asset.id === previous.id && asset.digest === previous.digest && asset.size === previous.size), 'Existing release asset changed');
  // Advance the pointer only after fresh public download and native validation.
  command('git', ['fetch', 'origin', 'main']);
  command('git', ['checkout', '--detach', 'origin/main']);
  const pin = path.join('apps/desktop/releases', FEED);
  if (!existsSync(pin) || readFileSync(pin, 'utf8') !== item.feedText) {
    if (existsSync(pin)) ensure(JSON.parse(readFileSync(pin, 'utf8')).build < report.build, 'Do not replace a different same/newer Mac feed');
    writeFileSync(pin, item.feedText);
    command('git', ['config', 'user.name', 'github-actions[bot]']);
    command('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    command('git', ['add', '--', pin]);
    command('git', ['diff', '--cached', '--check']);
    command('git', ['commit', '-m', `Publish macOS ${report.version} build ${report.build} update feed`]);
    command('gh', ['auth', 'setup-git']);
    command('git', ['push', 'origin', 'HEAD:main']);
  }
  const live = path.join(readback, 'live-appcast.json');
  command('curl', ['--disable', '--fail', '--location', '--silent', '--show-error', '--retry', '3', '--max-time', '60',
    `https://raw.githubusercontent.com/${repo}/main/${pin}`, '--output', live]);
  ensure(readFileSync(live, 'utf8') === item.feedText && parseManifest(readFileSync(live, 'utf8'), TARGET, false).ok, 'Live Mac feed differs');
  console.log(`Published and verified: ${after.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const action = process.argv[2];
  const directory = path.resolve(process.argv[3]);
  (action === 'prepare' ? prepareCandidate(directory, process.env) : action === 'publish' ? publishCandidate(directory, process.env) : Promise.reject(new Error('Expected prepare or publish')))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
