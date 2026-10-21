# Caption GPU binding

Optional browser GPU session over `ScenePlan` and `CaptionGpuRenderer`. This is a
low-level scene-input boundary, not a second implementation of project document
projection, layout or timing. The host supplies an inline caption scene style,
resolved cues/words in seconds, presentation parameters and a stable instance ID.

Build separate WebGPU and WebGL2 artifacts with `--no-default-features --features
webgpu` or `webgl`, targeting `wasm32-unknown-unknown`. Use the wasm-bindgen CLI
version matching Cargo.lock. Generated JS/WASM stay outside source control.

`GpuCaptions.create(canvas, width, height, backend)` uses portable device limits and
no optional GPU features. Add frozen font bytes with `addFont`, asset bytes keyed by
`id@revision` with `setAsset`, and an opaque associated-RGBA backdrop with
`setBackdrop`. `load(JSON)` compiles the shared scene. `render(seconds)` submits and
presents; await `completed()` when measuring completed GPU work. There is no frame
pixel readback in this path.

WebGL2 uses wgpu-core callbacks: while awaiting `completed()`, the host calls
`pollCompletion()` on later browser event-loop turns (for example a short timer).
This polls the GPU fence without waiting or reading pixels. Do not block the
browser thread or treat command submission as completion. Browser WebGPU schedules
completion callbacks itself and does not need this polling.

Input fields are `style`, optional `presentation`, `instanceId`, and `cues`.
Each cue has `id`, `documentId`, `text`, `start`, `end`, and optional `words`;
each word has `id`, `text`, `start`, `end`. Invalid/unresolved scenes are rejected.
This binding currently requires an opaque backdrop so emission and Screen are not
silently flattened to a transparent browser overlay. Native callers can render over
an existing GPU video target directly through `CaptionGpuRenderer`.

Device loss and validation errors are surfaced. The host must stop submission,
recreate a session on a fresh canvas from frozen inputs, or explicitly use the CPU
reference. Unsupported materials/operations are never silently omitted. WebGPU
compilation is not evidence of browser execution or of WebGL2/Windows conformance.
