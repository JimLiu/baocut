# Rendered from appcast-aarch64-apple-darwin.json by apps/desktop/tools/homebrew-cask.mjs; the macOS release
# flow rewrites it with the update feed. Copy it to Casks/baocut.rb in the BaoCut Homebrew tap.
cask "baocut" do
  version "3.19.2,97"
  sha256 "f31d41518a75c4dffa635502fe2d44d5f7936bfa15c4d3a7f4edcec56e3680f5"

  url "https://github.com/jimliu/baocut/releases/download/baocut-v#{version.csv.first}-build.#{version.csv.second}/BaoCut-#{version.csv.first}-build.#{version.csv.second}-aarch64-apple-darwin.zip"
  name "BaoCut"
  desc "AI video agent that keeps every result in an editable timeline"
  homepage "https://baocut.com/"

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :sonoma

  app "BaoCut.app"
  binary "#{appdir}/BaoCut.app/Contents/MacOS/baocut-cli", target: "baocut"
end
