// The Homebrew cask for the BaoCut tap, rendered from the macOS update feed so both point at the same archive.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const CASK_FILE = 'homebrew/baocut.rb';
const TARGET = 'aarch64-apple-darwin';
const REPO = 'jimliu/baocut';
const ensure = (ok, message) => { if (!ok) throw new Error(message); };

/** Cask text for one published feed. The URL uses Homebrew's version interpolation and must equal the feed's. */
export function renderHomebrewCask(feed) {
  ensure(feed?.target === TARGET && feed.app?.format === 'zip', 'Homebrew cask needs the Apple Silicon zip feed');
  ensure(/^\d+\.\d+\.\d+$/.test(feed.version) && Number.isSafeInteger(feed.build) && feed.build > 0, 'Unexpected feed version or build');
  ensure(/^[a-f0-9]{64}$/.test(feed.app.sha256), 'Unexpected feed checksum');
  const expand = (version, build) =>
    `https://github.com/${REPO}/releases/download/baocut-v${version}-build.${build}/BaoCut-${version}-build.${build}-${TARGET}.zip`;
  ensure(expand(feed.version, feed.build) === feed.app.url, 'Feed URL does not follow the release asset naming');
  const url = expand('#{version.csv.first}', '#{version.csv.second}');
  return `# Rendered from appcast-${TARGET}.json by apps/desktop/tools/homebrew-cask.mjs; the macOS release
# flow rewrites it with the update feed. Copy it to Casks/baocut.rb in the BaoCut Homebrew tap.
cask "baocut" do
  version "${feed.version},${feed.build}"
  sha256 "${feed.app.sha256}"

  url "${url}"
  name "BaoCut"
  desc "AI video agent that keeps every result in an editable timeline"
  homepage "https://baocut.com/"

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: ">= :sonoma"

  app "BaoCut.app"
  binary "#{appdir}/BaoCut.app/Contents/MacOS/baocut-cli", target: "baocut"
end
`;
}

// `node apps/desktop/tools/homebrew-cask.mjs` prints the cask for the pinned feed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const releases = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases');
  process.stdout.write(renderHomebrewCask(JSON.parse(readFileSync(path.join(releases, `appcast-${TARGET}.json`), 'utf8'))));
}
