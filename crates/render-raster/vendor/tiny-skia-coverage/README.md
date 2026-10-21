# tiny-skia-coverage

This is an additive coverage-scanning fork of **tiny-skia 0.11.4** by
Yevhenii Reizner, based on the Skia code attributed in the original source.
The original CPU renderer continues to use the registry `tiny-skia` package.
This package has a separate name and source identity and is not a crates.io patch.

## Provenance and license

Upstream: https://github.com/RazrFalcon/tiny-skia, crates.io package
`tiny-skia` version `0.11.4`.

Published `.crate` SHA-256, verified against the locally cached archive:
`83d13394d44dae3207b52a326c0c85a8bf87f1541f23b0d143811088497b09ab`.

[UPSTREAM-SHA256.txt](UPSTREAM-SHA256.txt) records the original SHA-256 of
all 44 upstream `src/` files, `Cargo.toml.orig`, and `LICENSE`. Its own SHA-256 is
`7305b22ce145597cef9a283bda139995b76fc2c06b1b096f0ad4e7014e678e0b`.
The copied upstream source was also compared byte-for-byte with the published
archive. The inventory describes upstream bytes, before the additive module
export below.

All upstream algorithms and CPU drawing entry points are unchanged. The only
change to an existing source file is the addition of the documented
`pub mod coverage` export in `src/lib.rs`. `src/coverage.rs` is new. The active
manifest renames the package to `tiny-skia-coverage`, uses an independent empty
workspace, and depends on registry `tiny-skia-path =0.11.4`; `Cargo.toml.orig`
retains the original manifest. Upstream tests, examples, and PNG media outside
`src/` are not copied. The original inline test declarations remain in the source;
this directory is consumed as a dependency, and is not a standalone copy of the
upstream test fixture distribution.

The fork remains **BSD-3-Clause**. [LICENSE](LICENSE) and the copyright/license
notices in the source are retained. Binary distributions must reproduce the
license and notices; copyright-holder names do not imply endorsement.

## Additive API

`coverage::trace_aa_hairline(&Path, LineCap, Transform, [width, height], sink)`
traces the unchanged anti-aliased hairline scanner into a `CoverageSink`:

```rust
trait CoverageSink {
    fn span(&mut self, x: u32, y: u32, width: u32, alpha: u8) -> bool;
}
```

Coordinates are global destination pixels. Horizontal spans are emitted in
scanner order, including separate events that revisit the same pixel. A vertical
blit or rectangle is expanded row by row. Sparse AA arrays advance by each run's
length, not by one array element. Zero-alpha spans are omitted because they do not
change CPU pixels. Events are never merged across blit calls or composited into a
coverage bitmap. The adapter implements every internal `Blitter` method; an
unrepresentable two-byte mask or malformed span produces an explicit error.

Return `false` before accepting a span that exceeds the caller's budget. No later
span is emitted or allocated by the adapter, and tracing returns `Limit`. The
current scanner invocation can finish without recording; subsequent canvas tiles
are not scanned after failure. Any partially recorded trace must be discarded.
The callback owns recording and indexing; this API does not allocate event arrays
or destination pixels. As in the original geometry branch, tracing clones and
transforms the path and the scanner can allocate its internal geometry buffers.

The complete original f32 transform is applied before scanning. Dimensions above
8191 use the original `DrawTiler` in its original row-major order. Each tile uses
`translate(-origin)`, the original local canvas clip, then `translate(+origin)` on
the same evolving path; it is not regenerated from the original path per tile.
This preserves translation-sensitive curve subdivision and accumulated f32
mapping. The adapter adds tile origins to callback coordinates.

The API rejects non-finite transforms, zero or signed-coordinate-overflow canvas
dimensions, invalid transformed paths, and device bounds beyond the CPU safe-math
range. This is an explicit coverage API restriction; it does not alter the
upstream painter's behavior.

Width classification, width-derived paint-opacity quantization, paint evaluation,
dash preparation, clip masks, and destination blending are caller responsibilities.
The caller must apply hairline width opacity to the original paint before its
byte conversion, rather than multiplying a finished white mask. This API always
traces AA hairline geometry; it does not select between ordinary stroke and
hairline or evaluate joins/miter limits. For large canvases, paint evaluation must
also respect the CPU's per-tile shader transform arithmetic; global coverage
coordinates alone do not establish bit-exact gradient colors.

The registry `tiny-skia-path =0.11.4` dependency is shared with the original
`tiny-skia` library, so `Path`, `LineCap`, and `Transform` are the same Rust types.
Fork-owned `Paint`, `Color`, and `Shader` types are not used by this API.
