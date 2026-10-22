# Compositor

Shared retained GPU executor, ported from BaoCut v2 `bcut-compositor` with its
conformance tests. It consumes `timeline-render::SceneFrame`; layout,
word timing, semantic clocks and animation evaluation remain in `subtitle-render`.
The renderer never parses template recipes or lays text out independently.

- Native: `--features gpu` (wgpu Metal, DX12, Vulkan).
- Browser: `--features gpu-webgpu` or `--features gpu-webgl`.
- No features: scene scheduling and atlas contracts only; CPU WASM does not link wgpu.

The executor draws cached alpha/color glyph atlases, per-glyph transforms and
paints, rounded rectangles, vectors, images, shader quads, grouped box blur and
ordered composition. `ComponentRenderer` additionally executes associated RGBA
Gaussian passes with shared CPU validation/weights, gamma, boundary modes and
resizing; RGB greater than alpha is preserved. It has a per-pass sampling budget
and bounded uniform slots. The host still owns graph-wide surface/work budgets.
Its live APIs encode directly into the host texture/view,
with one submission and no pixel readback. `OfflineCompositor::render_rgba` is an
explicit readback API for tests and hosts that require CPU bytes.

GPU support is not inferred from a template name or the presence of an adapter.
Unsupported scene operations return an error. The host must keep the CPU reference
available, report fallback reasons, and recreate the compositor and resources on a
new device after loss. Software adapters are not selected automatically by the
native executor. Limits are based on baseline WebGL2 requirements plus actual
resolution/alignment limits, without requesting optional device features.

Glyph atlases have fixed capacity and retire unused glyphs under pressure. Idle
render targets have both a per-key count limit and a global 64 MiB cache limit;
this is **not** a total GPU-memory limit. Active material surfaces, external media,
and host swapchain allocations must be budgeted separately by the host.

`CaptionGpuRenderer` executes an evaluated `MaterialFrame` in one GPU submission:
local glyph/bitmap sources, image quads, noisy sweep, Gaussian passes, affine UV paths, glow cascades
and ordered associated source-over/Screen against the host's actual backdrop.
`ScenePlan::record_material_plan` shares its parameter and image-sequence resolver
with the CPU executor. Noisy sweep caches a geometry-dependent libm noise field;
position/reveal and pixel masking execute on the GPU. Geometry changes rebuild that
resource. The viewport-free `RetainedDrawCache::prepare` keeps cached 4× local
geometric masks with transform/color uniforms. Caption Draw sources instead use
`prepare_for_canvas`: 1× device coverage with the original CPU scanning phase.

Draw sources retain their operation order, fill rules, complete stroke geometry
and nested normal isolation. CPU resource preparation strokes the original local
path using the original transform's resolution scale, then scans the complete
original device coordinates. Curve subdivision itself is f32 translation-sensitive,
so translating curves to a small tile before scanning is insufficient. On a cache
miss, viewport-sized A8 preparation scratch preserves the CPU scanner, including
its large-canvas tiling; only the cropped glyph coverage is retained and uploaded.
This prepares one glyph resource, never a CPU-composited animated scene/frame.

Solid and pad linear paints execute on the GPU over these alpha glyphs. Up to 32
stops retain independent alpha, hard stops and original path-local coordinates.
Paint follows the CPU byte-lane order: Solid premultiplies then quantizes; Linear
quantizes straight channels then premultiplies; AA follows both. Normal source
groups gather their composed children and apply f32 opacity, matching the CPU
Pattern highp pipeline. Generic retained scenes and final associated material
compositing keep their existing precision policy. Hardware blending outside
ordered stroke replay can still differ; successful admission does not establish
pixel-exact parity with any other renderer.

Zero-width and positive device hairlines use ordered coverage events, not a
precomposed RGBA tile. A tile loses destination-dependent byte rounding when
multiple blits revisit a pixel. A separate additive tiny-skia coverage fork
retains the unchanged scanner, original device transform, cap subdivisions and
large-canvas tile order; the registry CPU renderer remains unchanged. Preparation
retains per-pixel offset/count pairs and ordered u8 coverage. GPU integer replay
reads the current source-group destination, evaluates Solid/Linear paint and
applies each event in order. Opaque original paint follows Source/Lerp with a
single combined rounding; nonopaque paint follows premultiplied SourceOver.
A small ROI texture is evaluated and overwritten onto the source group, without
sampling and writing the same texture in one pass. No CPU scene composition,
full-frame upload, storage buffers or optional GPU features are used.

Normal coverage keys include geometry, stroke/fill rule, full f32 transform and
viewport; paint colors reuse coverage. Ordered hairline keys include geometry,
cap, full transform and viewport, but exclude paint and width-derived opacity.
Integer translations are not normalized away. `prepare_for_canvas` still exposes
RGBA hairline tiles to standalone retained-cache callers; this compatibility
preparation does not provide destination-aware replay. The viewport-free
`prepare` retains its prior 4× local mask strategy.

Each coverage ROI is at most 2046×2046. Glyph cache and glyph preparation scratch
have separate 64 MiB bounds. Ordered event cache, active unique programs and
preparation temporaries each have separate 64 MiB bounds; at most 262144 spans,
4 Mi coverage events, 65536 events per pixel and 128 stroke operations per frame
are admitted. GPU estimates include cached event textures, active unique event
textures and every live ROI; LRU eviction does not release encoder references.
`prepared_masks` counts glyph preparation; `prepared_strokes` counts newly
prepared event programs. Source group depth is at most 32, with at most 128
linear paints and 128 isolation composites. All resource/work limits reject
before submission without reducing resolution. Unsupported operations fail
explicitly so hosts can use their complete CPU reference.

The low-level `GaussianPass` can sample an integer texel subview into a fractional
output rectangle without an extra resampling pass. Boundaries clamp/normalize
against that subview; outside the output rectangle is transparent. The GPU uses
a scissor for the output region. Recursive spacing ramps can explicitly choose
positive-first tap order, required when reflecting their coordinate axis. The scene JSON binding exposes these through `gaussian-axis.sampling` and
`spacingRamp.sampleOrder`, gated by `caption-gaussian-sampling/1`. Omitting them
retains whole surfaces and negative-first order.

The GPU Gaussian sampler caches the previous bilinear cell separately for its
positive and negative tap streams. Matching and adjacent cells reuse exact source
values; interpolation, gamma, weights and accumulation order remain unchanged.
For fixed spacing, the work budget counts a conservative bound of supported texel
loads, including uploaded f32 domains and arithmetic uncertainty. Recursive ramps
retain the full tap bound. The single-pass 256 Mi read and total 512 Mi work limits
remain unchanged; source support scans retain emissive RGB at zero alpha.

This is an admitted execution subset, not complete template coverage. Non-normal
source layer blends, clips/mattes, radial paints and the remaining material kinds still
return explicit unsupported errors. CPU remains the reference/fallback. The optional
[`caption-gpu`](../../bindings/caption-gpu/README.md) browser binding consumes the same
plan; product preview/export host wiring and broader device testing remain pending.

Run `cargo test --locked -p compositor --features gpu`. GPU tests may skip when no
adapter is available; acceptance runs set `BAOCUT_REQUIRE_GPU=1` to fail instead.
Native tests do not establish Windows, browser, or another GPU vendor's conformance.


Draw-source alpha and luma mattes use pixel-aligned RGBA8 integer products on the GPU, including inverted modes. Each matte reads the current isolated content and a separate mask surface, writes a third surface, then copies it back before subsequent drawing. Normal group opacity is applied once when the group is composited. Direct and grouped nested mattes reserve distinct live surfaces and one globally bounded copy slot per matte; linear paint scratch is outside the maximum live isolation depth. Root mattes, mismatched closes and invalid modes fail before submission. Associated SourceOver `DrawEmissiveBitmap` preserves RGB greater than alpha; unsupported blend combinations remain rejected. Shader translation checks do not substitute for WebGPU/WebGL2 device testing.
