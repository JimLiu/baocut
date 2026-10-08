// CI credentials stay in a temporary keychain; never echo subprocess output or secret arguments.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const temporary = process.env.RUNNER_TEMP;
if (process.platform !== 'darwin' || !temporary || !path.isAbsolute(temporary)) throw new Error('Requires a macOS runner and RUNNER_TEMP');
const keychain = path.join(temporary, 'baocut-signing.keychain-db');
const previousFile = path.join(temporary, 'baocut-keychains-before.json');
const p12 = path.join(temporary, 'baocut-signing.p12');
const p8 = path.join(temporary, 'baocut-notary.p8');
const probe = path.join(temporary, 'baocut-signing-probe');
const prefix = path.join(temporary, 'baocut-probe-cert-');

function run(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed; credentials and command output withheld`);
  return result.stdout;
}
function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing configuration: ${name}`);
  return value;
}

if (process.argv[2] === 'prepare') {
  const sha1 = required('BAOCUT_MAC_SIGNING_SHA1');
  const team = required('BAOCUT_APPLE_TEAM_ID');
  if (!/^[A-F0-9]{40}$/.test(sha1) || !/^[A-Z0-9]{10}$/.test(team)) throw new Error('Invalid signing fingerprint or Team ID');
  const previous = [...run('security', ['list-keychains', '-d', 'user']).matchAll(/"([^"\n]+)"/g)].map((m) => m[1]);
  if (!previous.length) throw new Error('Could not record the previous keychain search list');
  writeFileSync(previousFile, JSON.stringify(previous), { mode: 0o600 });
  writeFileSync(p12, Buffer.from(required('BAOCUT_MAC_CERTIFICATE_BASE64'), 'base64'), { mode: 0o600 });
  const password = required('BAOCUT_MAC_KEYCHAIN_PASSWORD');
  run('security', ['create-keychain', '-p', password, keychain]);
  run('security', ['set-keychain-settings', '-lut', '21600', keychain]);
  run('security', ['unlock-keychain', '-p', password, keychain]);
  run('security', ['import', p12, '-k', keychain, '-P', required('BAOCUT_MAC_CERTIFICATE_PASSWORD'), '-f', 'pkcs12', '-T', '/usr/bin/codesign']);
  run('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
  run('security', ['list-keychains', '-d', 'user', '-s', keychain, ...previous]);
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
  if (!identities.split('\n').some((line) => line.includes(sha1) && line.includes('Developer ID Application:') && line.includes(`(${team})`))) throw new Error('Selected Developer ID identity or Team unavailable');
  const credentials = ['notarytool', 'store-credentials', 'baocut-notary', '--keychain', keychain];
  if (process.env.BAOCUT_NOTARY_API_KEY_BASE64) {
    writeFileSync(p8, Buffer.from(process.env.BAOCUT_NOTARY_API_KEY_BASE64, 'base64'), { mode: 0o600 });
    credentials.push('--key', p8, '--key-id', required('BAOCUT_NOTARY_KEY_ID'), '--issuer', required('BAOCUT_NOTARY_ISSUER_ID'));
  } else {
    credentials.push('--apple-id', required('BAOCUT_NOTARY_APPLE_ID'), '--password', required('BAOCUT_NOTARY_APP_PASSWORD'), '--team-id', team);
  }
  run('xcrun', credentials);
  run('xcrun', ['notarytool', 'history', '--keychain-profile', 'baocut-notary', '--keychain', keychain, '--output-format', 'json']);
  // Test possession of the private key, exact signer and trusted secure timestamp.
  run('cp', ['/usr/bin/true', probe]);
  run('codesign', ['--force', '--sign', sha1, '--keychain', keychain, '--timestamp', '--options', 'runtime', probe]);
  run('codesign', ['--verify', '--strict', probe]);
  run('codesign', ['-d', `--extract-certificates=${prefix}`, probe]);
  const fingerprint = run('openssl', ['x509', '-inform', 'DER', '-in', `${prefix}0`, '-noout', '-fingerprint', '-sha1']).trim().split('=')[1]?.replaceAll(':', '');
  if (fingerprint !== sha1) throw new Error('Signing probe certificate differs');
  run(probe, []);
  console.log('Developer ID private-key signing, exact fingerprint and Apple notarization access passed.');
} else if (process.argv[2] === 'cleanup') {
  let failed = false;
  if (existsSync(previousFile)) {
    try { run('security', ['list-keychains', '-d', 'user', '-s', ...JSON.parse(readFileSync(previousFile, 'utf8'))]); } catch { failed = true; }
  }
  if (existsSync(keychain)) {
    try { run('security', ['delete-keychain', keychain]); } catch { failed = true; }
  }
  for (const file of [p12, p8, probe, previousFile, `${prefix}0`, `${prefix}1`, `${prefix}2`]) rmSync(file, { force: true });
  if (failed) throw new Error('Temporary keychain cleanup failed');
  console.log('Temporary signing and notarization credentials removed.');
} else throw new Error('Expected prepare or cleanup');
