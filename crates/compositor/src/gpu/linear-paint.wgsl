struct Params {
    gradient_x: vec4f,
    gradient_y: vec4f,
    axis: vec4f,
    settings: vec4f,
    offsets: array<vec4f, 9>,
    factors: array<vec4f, 33>,
    biases: array<vec4f, 33>,
}
@group(0) @binding(0) var coverage: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: Params;
@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var vertices = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(vertices[index], 0, 1);
}
fn offset(index: u32) -> f32 { return p.offsets[index / 4u][index % 4u]; }
@fragment fn fragment_main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let count = u32(p.settings.x);
    // CPU lowp: x*sx + (y*kx + tx), then F*t+B. Do not replace with
    // inverse-point projection, dot(), mix(), or explicitly fused fma().
    var t = pixel.x * p.gradient_x.x + (pixel.y * p.gradient_x.y + p.gradient_x.z);
    if p.settings.w == 1.0 { t = clamp(t, 0.0, 1.0); }
    var index = 0u;
    for (var i = 1u; i < count; i += 1u) { if t >= offset(i) { index += 1u; } }
    let color = t * p.factors[index] + p.biases[index];
    let mask = textureLoad(coverage, vec2i(pixel.xy), 0).a;
    let rgba = clamp(color, vec4f(0), vec4f(1));
    var bytes = floor(vec4f(rgba.rgb * rgba.a, rgba.a) * 255.0 + vec4f(0.5));
    if p.settings.z == 1.0 {
        // CPU gradients quantize unassociated channels, premultiply in byte
        // lanes, then apply AA. Degenerate gradients use SolidColor instead.
        let straight = floor(rgba * 255.0 + vec4f(0.5));
        bytes = vec4f(floor((straight.rgb * straight.a + vec3f(255.0)) / 256.0), straight.a);
    }
    let coverage_byte = floor(clamp(mask, 0.0, 1.0) * 255.0 + 0.5);
    return floor((bytes * coverage_byte + vec4f(255.0)) / 256.0) / 255.0;
}
