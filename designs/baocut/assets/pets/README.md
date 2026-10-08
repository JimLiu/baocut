# Codex Pet assets

Sprite-sheet pets in the format used by the Codex desktop app, wired into the
prototype's "动态贴纸 › Pet" section (round 242). BaoCut does not change the
format; it only plays it.

## Format

Each pet is a folder with two files:

- `pet.json` — `displayName`, `description`, `spriteVersionNumber` (absent or `1`
  = v1, `2` = v2), `spritesheetPath` (relative path to the sheet inside the folder).
- `spritesheet.webp` — an 8-column atlas, 192×208 px per cell. v1 sheets are
  1536×1872 (9 rows), v2 sheets are 1536×2288 (11 rows). Rows, top to bottom:
  idle, running-right, running-left, waving, jumping, failed, waiting, running,
  review, and on v2 two extra "look" rows (0–157° and 180–337°). The idle row
  plays its six cells at 280/110/110/140/140/320 ms; the row-0/col-0 cell is the
  thumbnail.

The pure model that knows the geometry, state table, frame stepping and zip
validation is [`../../app/model-pet.js`](../../app/model-pet.js); the catalogue
is generated into [`../../app/model-pet-catalog.js`](../../app/model-pet-catalog.js).

## `official/` — 9 bundled pets

`bsod`, `codex`, `dewey`, `fireball`, `hoots`, `null-signal`, `rocky`, `seedy`,
`stacky` — the pets that ship inside the Codex desktop client, all v2. The
`spritesheet.webp` bytes are byte-for-byte copies of the assets found in the
app bundle; `pet.json` was reconstructed to the custom-pet schema. Source paths,
sizes and SHA-256 digests are recorded in [`provenance.json`](provenance.json).

**Licence caveat.** These pets are OpenAI's; no redistribution licence has been
published for them. They are bundled here only as demo material for the internal
prototype and the desktop App's development build. Shipping them in a product
release needs an explicit decision (permission, replacement with own artwork, or
removal) — do not treat their presence in this tree as clearance.

## Community pets — not bundled

The "社区" tab browses the index of
[awesome-codex-pet](https://github.com/legeling/awesome-codex-pet) (239 pets in
11 categories at the time of generation). Nothing from it is stored in this
repository: thumbnails are loaded from `codexpet.top` at view time and the sprite
sheet is fetched from `raw.githubusercontent.com` only when a pet is added to the
timeline. Those pets are CC BY-NC 4.0 unless a pet declares otherwise, so every
tile shows "author · licence" and the stage keeps the attribution in the
element's `pet` bag.

## Regenerating

The scratch script `gen-pets.py` (kept with the task notes, not in the repo)
copies the official pets from a local extraction, checks each sheet's dimensions
against its version, writes `provenance.json`, and rebuilds the catalogue module
from the upstream `pets.json` / `categories.json`. With `--app` it also mirrors
`official/` and `provenance.json` into `apps/baocut/assets/pets/`.
