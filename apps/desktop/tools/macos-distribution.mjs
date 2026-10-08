// 签名与公证只在这里完成；electron-builder 先产出目录，最终归档来自已 staple 的 App。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, createReadStream, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function runMac(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} (${result.status}): ${result.stderr || result.stdout}`);
  return `${result.stdout}${result.stderr}`;
}

export function signingPreflight(sha1, profile, keychain) {
  if (!/^[A-F0-9]{40}$/.test(sha1 ?? '')) throw new Error('--sign-sha1 requires a full uppercase certificate SHA-1');
  const identities = runMac('security', ['find-identity', '-v', '-p', 'codesigning', ...(keychain ? [keychain] : [])]);
  if (!identities.split('\n').some((line) => line.includes(sha1) && line.includes('Developer ID Application:'))) {
    throw new Error('The selected Developer ID Application identity is unavailable');
  }
  runMac('xcrun', ['notarytool', 'history', '--keychain-profile', profile, ...(keychain ? ['--keychain', keychain] : []), '--output-format', 'json']);
}

export function verifyMacIdentity(app, expected) {
  const info = JSON.parse(runMac('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')]));
  if (info.CFBundleIdentifier !== expected.appId || info.CFBundleShortVersionString !== expected.version || String(info.CFBundleVersion) !== String(expected.build)) {
    throw new Error('Packaged App bundle ID, version or build differs from the release');
  }
  const details = runMac('codesign', ['-d', '--verbose=4', app]);
  if (!details.includes('Authority=Developer ID Application:') || !details.includes('flags=0x10000(runtime)') || !details.includes('Timestamp=')) {
    throw new Error('Missing Developer ID, hardened runtime or secure timestamp');
  }
  // Signer names can collide. Read the actual leaf certificate, then check its fingerprint.
  const prefix = path.join(expected.output, 'signer-');
  runMac('codesign', ['-d', `--extract-certificates=${prefix}`, app]);
  const sha1 = runMac('openssl', ['x509', '-inform', 'DER', '-in', `${prefix}0`, '-noout', '-fingerprint', '-sha1']).trim().split('=')[1].replaceAll(':', '');
  if (sha1 !== expected.signingSha1) throw new Error('App was signed with a different certificate');
  runMac('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  return details;
}

async function facts(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return { file: path.basename(file), size: statSync(file).size, sha256: hash.digest('hex') };
}

export async function distributeMac({ app, output, stem, version, build, appId, signingSha1, profile, keychain, executables, entitlements }) {
  const { signAsync } = await import('@electron/osx-sign');
  for (const binary of executables) {
    for (const line of runMac('otool', ['-L', binary]).split('\n').slice(1)) {
      const dependency = line.trim().split(' ')[0];
      if (dependency && !dependency.startsWith('/System/Library/') && !dependency.startsWith('/usr/lib/')) {
        throw new Error(`Unbundled native dependency in ${binary}: ${dependency}`);
      }
    }
  }
  await signAsync({
    app, platform: 'darwin', identity: signingSha1, identityValidation: false,
    ...(keychain ? { keychain } : {}),
    preAutoEntitlements: false, preEmbedProvisioningProfile: false,
    ignore: [(file) => {
      if (file.endsWith('.app') || file.endsWith('.framework')) return false;
      // Resource blobs are sealed by their enclosing bundle. Only sign Mach-O code.
      const fd = openSync(file, 'r');
      try {
        const magic = Buffer.alloc(4);
        if (readSync(fd, magic, 0, 4, 0) !== 4) return true;
        return ![0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe,
          0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic.readUInt32BE());
      } finally { closeSync(fd); }
    }],
    optionsForFile: () => ({ entitlements, hardenedRuntime: true }),
  });
  const expected = { appId, version, build, signingSha1, output };
  writeFileSync(path.join(output, 'app-signature.txt'), verifyMacIdentity(app, expected));
  const submission = path.join(output, 'notary-submission.zip');
  runMac('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, submission]);
  const raw = runMac('xcrun', ['notarytool', 'submit', submission, '--keychain-profile', profile,
    ...(keychain ? ['--keychain', keychain] : []), '--wait', '--output-format', 'json']);
  writeFileSync(path.join(output, 'notary-result.json'), raw);
  const notary = JSON.parse(raw);
  runMac('xcrun', ['notarytool', 'log', notary.id, '--keychain-profile', profile,
    ...(keychain ? ['--keychain', keychain] : []), path.join(output, 'notary-log.json')]);
  if (notary.status !== 'Accepted') throw new Error(`Notarization ${notary.status}; see notary-log.json`);
  runMac('xcrun', ['stapler', 'staple', app]);
  runMac('xcrun', ['stapler', 'validate', app]);
  runMac('spctl', ['--assess', '--type', 'execute', '--verbose=4', app]);
  const zip = path.join(output, `${stem}.zip`);
  runMac('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, zip]);
  const extracted = path.join(output, 'verified-extraction');
  mkdirSync(extracted);
  runMac('ditto', ['-x', '-k', zip, extracted]);
  const verifiedApp = path.join(extracted, 'BaoCut.app');
  verifyMacIdentity(verifiedApp, expected);
  runMac('xcrun', ['stapler', 'validate', verifiedApp]);
  runMac('spctl', ['--assess', '--type', 'execute', '--verbose=4', verifiedApp]);
  const dmgRoot = path.join(output, 'dmg-root');
  mkdirSync(dmgRoot);
  runMac('ditto', [app, path.join(dmgRoot, 'BaoCut.app')]);
  runMac('ln', ['-s', '/Applications', path.join(dmgRoot, 'Applications')]);
  const dmg = path.join(output, `${stem}.dmg`);
  runMac('hdiutil', ['create', '-volname', `BaoCut ${version}`, '-srcfolder', dmgRoot, '-ov', '-format', 'UDZO', dmg]);
  runMac('codesign', ['--sign', signingSha1, '--timestamp', ...(keychain ? ['--keychain', keychain] : []), dmg]);
  const dmgRaw = runMac('xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', profile,
    ...(keychain ? ['--keychain', keychain] : []), '--wait', '--output-format', 'json']);
  const dmgNotary = JSON.parse(dmgRaw);
  writeFileSync(path.join(output, 'dmg-notary-result.json'), dmgRaw);
  if (dmgNotary.status !== 'Accepted') throw new Error(`DMG notarization ${dmgNotary.status}`);
  runMac('xcrun', ['stapler', 'staple', dmg]);
  runMac('xcrun', ['stapler', 'validate', dmg]);
  runMac('codesign', ['--verify', '--strict', dmg]);
  const portable = { format: 'zip', ...await facts(zip) };
  const installer = { format: 'dmg', ...await facts(dmg) };
  for (const item of [portable, installer]) writeFileSync(path.join(output, `${item.file}.sha256`), `${item.sha256}  ${item.file}\n`);
  return { portable, installer, notarySubmissionId: notary.id, dmgNotarySubmissionId: dmgNotary.id,
    notarized: true, unsigned: false, signingSha1, verifiedApp };
}
