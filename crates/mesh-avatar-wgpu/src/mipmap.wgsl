@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var image_sampler: sampler;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
    let p = array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0))[index];
    var out: VertexOutput;
    out.position = vec4f(p,0.0,1.0);
    out.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    return out;
}
@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    return textureSampleLevel(image,image_sampler,in.uv,0.0);
}
