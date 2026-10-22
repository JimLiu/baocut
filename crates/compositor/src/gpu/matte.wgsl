struct Params {
    mode: vec4u,
}

@group(0) @binding(0) var content: texture_2d<f32>;
@group(0) @binding(1) var matte: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

@vertex
fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}

fn rgba8(value: vec4f) -> vec4u {
    return vec4u(round(clamp(value, vec4f(0), vec4f(1)) * 255.0));
}

@fragment
fn fragment_main(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let position = vec2i(pixel.xy);
    let source = rgba8(textureLoad(content, position, 0));
    let mask = rgba8(textureLoad(matte, position, 0));
    var factor = mask.a;
    if params.mode.x >= 2u {
        factor = min(255u, (13933u * mask.r + 46871u * mask.g + 4732u * mask.b) >> 16u);
    }
    if (params.mode.x & 1u) != 0u {
        factor = 255u - factor;
    }
    // Quantize each associated channel independently: RGB may exceed alpha.
    let result = (source * factor + vec4u(127u)) / vec4u(255u);
    return vec4f(result) / 255.0;
}
