# Editable, redistributable stickers

382 stickers: 301 static SVGs (`*.svg`, 1–5 explicit editable fill colors) and 81
Lottie JSON animations (`anim/dyn-<pack>-NN.json`, Google Noto Animated Emoji,
CC BY 4.0). The prototype copy and the App copy hold the same 382 files.
The source file stays unchanged; each element saves its own color overrides
(`fillOverrides`, exact `#RRGGBB` matches against the flat fills of the SVG or the
Lottie). Internal animation does not remove color editing. No element animation
preset is added; Lottie stickers carry their own clock (`sticker.loop`: loop / once / hold).

Static sources are pinned Microsoft Fluent Emoji / Tabler Icons / Doodle Icons (MIT)
and Open Peeps (CC0); the 32 `cta-*.svg` buttons compose a Tabler filled icon with
label lettering outlined from bundled OFL fonts (`LICENSES/fonts-OFL.txt`). Animated
sources are pinned Noto Animated Emoji Lottie files (CC BY 4.0; attribution stays in
each file's `meta` block). Users can also import their
own stickers (Lottie JSON / GIF / SVG / PNG / WebP / JPEG) into the Brand kit.
Confetti is no longer shipped here as SVG (round 231): the prototype renders the ten
recipes procedurally as a `confetti` element (`app/model-confetti.js`, adapted from
react-confetti, party-js and js-confetti, MIT). The App and core render the same
recipes through the `confetti-v1` kernel; the ten `anim/dyn-confetti-*.svg` files are
gone from every copy, while the vendored upstream sources and licenses stay.
See `provenance.json`, `anim/provenance.json` and `LICENSES/`. Each SVG embeds its
applicable MIT/CC0 notice and each Lottie its CC BY 4.0 attribution, including when
copied to a project.

Canonical metadata and offline generators: `core/assets/elements/` and
`scripts/dev/elements/`. App and prototype bytes are generated together; Web copies
the App set. Ordinary builds never fetch external assets. Old project media is not
replaced or deleted. No GIPHY artwork is shipped in this catalogue.
