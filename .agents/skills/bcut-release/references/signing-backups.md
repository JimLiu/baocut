# Signing credentials and backups

Read the canonical [signing and recovery guide](../../../../docs/macos-signing.md)
for current fingerprint, Team, backup location, Keychain locators and CI setup.
Only load the sections needed for identity/backup work or missing credentials.

The `macos-release` Environment holds the encrypted PKCS#12 identity and separate
Apple notarization credentials; allowed deployment refs are `main` and release
tags. Signing and notarization use different credentials: a certificate alone
cannot sign, and a copied profile name cannot authenticate a different machine.
Select the actual leaf certificate by full SHA-1; names may collide.

An explicit request to configure these GitHub Secrets authorizes that upload;
a request to save local backups alone does not. Never print password/private-key
values, export the whole login keychain or upload credentials as release artifacts.
Keep passwords separate from backup files and record restore/signing verification.

When changing CI credentials, use `desktop-macos.yml mode=validate` for an actual
import/sign/execute/fingerprint/Apple-access/cleanup check. A successful credential
check is not a packaged App or a published release. Report local backup, off-machine
recovery and actual CI execution separately. Backup/configuration requests do not
select a release mode or authorize a release tag or publication.
