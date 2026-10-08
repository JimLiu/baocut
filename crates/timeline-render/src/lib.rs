/*!
 * bcut-timeline-render —— **契约层 × 图元层的交汇层**。
 *
 * Timeline 元素（`bcut-timeline` 的 `ElementKind` + 四组 Props + 几何默认表）
 * → DrawOp 指令流（`bcut-render` 的 `FrameBuilder`）以及同源的实时
 * [`SceneFrame`] / [`SceneNode`]。纯函数、无 I/O：不读盘、不起进程、不认识
 * 任何 host 的类型，因此 `apps/cli`、`bcut-wasm` 与 compositor 用的是**同一份**
 * 实现。
 *
 * 设计依据：[docs/design/bcf/bcut-element-render-foundation-design.md] §9.1（P6 要把
 * `render_plan.rs` 的纯几何 / DrawOp 组装下沉到 core 才能编进 wasm）与 §10 P6
 * 的验收标准（wasm 的 `fingerprintAt(t)` 与 CLI 的 DrawOp 指纹逐位相同）。
 * 「为什么是新 crate 而不是把 `bcut-timeline` 接进 `bcut-render`」写在
 * `Cargo.toml` 的注释里。
 *
 * ## 边界
 *
 * [`push_element`] 只画**矢量直出**的元素：`shape` / `visualizer` / `progress`，
 * 以及 **`template` 源的 `sticker`**（P7b：内置模板库是归一化 path，不是
 * SVG 字节，所以不需要 resvg）。实时 scene 另可由 [`external_media_scene_nodes`]
 * 接受 host 注入的自然尺寸，产出不含平台句柄的 texture node；解码与纹理上传
 * 仍归 host。`text` 仍需共享排版/glyph scene，`audio` 不出画面。
 */

pub mod draw;
pub mod element;
#[cfg(feature = "external-media-scene")]
pub mod media;
pub mod scene;
#[cfg(feature = "scene-wire")]
pub mod scene_wire;

pub use draw::{
    ElementBox, ElementPose, element_transform, parse_color, push_draw_ops,
    push_media_placeholder_ops, push_placeholder_ops, push_shape_ops, push_sticker_ops,
};
pub use element::{
    ElementDraw, EvaluatedSceneElement, Stage, WarnSink, element_aspect, element_frame,
    element_opacity, evaluate_scene_element, push_confetti_element, push_draw_element,
    push_element, push_element_placeholder, push_placeholder_element, push_progress_element,
    push_shape_element, push_sticker_element, push_visualizer_element, visualizer_audio_source,
    whiteboard_draw_seconds, whiteboard_hand, whiteboard_paper, whiteboard_params,
    whiteboard_progress,
};
#[cfg(feature = "external-media-scene")]
pub use media::{
    EXTERNAL_MEDIA_TILE_NODE_LIMIT, ExternalMediaElement, ExternalMediaMetadata,
    external_media_scene_nodes, external_media_scene_nodes_at, external_media_scene_nodes_in_span,
};
pub use scene::{
    BlurredGroup, GLYPH_RUN_UNIFORM_LIMIT, GlyphCompositeMode, GlyphEffect, GlyphInstance,
    GlyphKey, GlyphMask, GlyphPaint, GlyphPixels, GlyphRun, GlyphRunUniform, GlyphTexture,
    GlyphTextureKey, RoundedRectNode, SCENE_BLUR_RADIUS_LIMIT, SCENE_GLYPH_STROKE_WIDTH_LIMIT,
    SCENE_GLYPH_TEXTURE_SIZE_LIMIT, SCENE_NODE_LIMIT, SceneCompositeMode, SceneCurveSolver,
    SceneFrame, SceneMotion, SceneNode, ScenePose, post_concat_mat6,
};
#[cfg(feature = "external-media-scene")]
pub use scene::{
    TEXTURE_EFFECT_LIMIT, TextureBackground, TextureEffect, TextureFit, TextureMaskShape,
    TextureNode,
};
#[cfg(feature = "scene-wire")]
pub use scene_wire::{decode_scene_frame, encode_scene_frame};
