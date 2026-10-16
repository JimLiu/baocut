# Bundled stickers

The sticker packs shown in the editor's Elements panel. There are 301 static SVGs (`<pack>-<file>.svg`) and 81 Lottie animations (`anim/dyn-<pack>-NN.json`).

- The catalogue (packs, files and search words) is `packages/protocol/src/sticker-packs.ts`. Pack names are in the UI's `sticker-pack-copy.*.ts`.
- The Runtime finds this directory through `resolveStickerPacksDir`. The lookup order is `BAOCUT_STICKERS_DIR`, then `<resources>/stickers` in the packaged app, then this directory.
- Adding a sticker copies its bytes into the video (`stickers.applyToVideo`, managed storage). A video never points back here.
- The prototype keeps a byte-identical copy in `designs/baocut/assets/stickers/`. `packages/runtime-core/src/templates/sticker-packs.test.ts` checks that the two copies match.

Static SVGs keep their flat fills, so each element can recolor them (`sticker.fillOverrides`, keyed by the source `#RRGGBB`). Lottie stickers carry their own clock (`sticker.loop`).

Sources and licenses:

- Microsoft Fluent Emoji, Tabler Icons and Doodle Icons are MIT; Open Peeps is CC0.
- The 32 `cta-*.svg` buttons are original compositions (MIT). Their lettering is outlined from OFL fonts; see `LICENSES/fonts-OFL.txt` and `LICENSES/fonts-NOTICE.md`.
- The Lottie files are Google Noto Animated Emoji (CC BY 4.0). Each file keeps its attribution in its `meta` block.
- Every SVG embeds its applicable notice.
- Per-file source URLs, hashes and modifications are in `provenance.json` and `anim/provenance.json`.
- Full license texts are in `LICENSES/`.
