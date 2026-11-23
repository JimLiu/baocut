# Rendered from appcast-aarch64-apple-darwin.json by apps/desktop/tools/homebrew-cask.mjs; the macOS release
# flow rewrites it with the update feed. Copy it to Casks/baocut.rb in the BaoCut Homebrew tap.
cask "baocut" do
  version "3.20.2,100"
  sha256 "16a006c34277245f0dbd90e5d2447caaebf36c0741d02f0b7848ed4746a6d6b4"

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
