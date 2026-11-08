struct Uniforms {
    scale_offset: vec4f,
    rect: vec4f,
    flags: vec4f,
    eye_box: array<vec4f, 2>,
    eye_top: array<vec4f, 12>,
    eye_bot: array<vec4f, 12>,
    eyes: array<vec4f, 2>,
    mouth: vec4f,
    mouth_state: vec4f,
    cheeks: vec4f,
};
@group(0) @binding(0) var<uniform> u: Uniforms;
@group(1) @binding(0) var image: texture_2d<f32>;
@group(1) @binding(1) var image_sampler: sampler;
struct VertexOutput { @builtin(position) position: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@location(0) position: vec2f, @location(1) uv: vec2f) -> VertexOutput {
    var out: VertexOutput;
    out.position = vec4f(position * u.scale_offset.xy + u.scale_offset.zw, 0.0, 1.0);
    out.uv = uv;
    return out;
}
fn curve(e: u32, top: bool, value: f32) -> f32 {
    let f = clamp(value, 0.0, 1.0) * 23.0;
    let i = min(u32(floor(f)), 22u);
    let t = f - f32(i);
    let k = e * 24u + i;
    if top { return mix(u.eye_top[k / 4u][k % 4u], u.eye_top[(k + 1u) / 4u][(k + 1u) % 4u], t); }
    return mix(u.eye_bot[k / 4u][k % 4u], u.eye_bot[(k + 1u) / 4u][(k + 1u) % 4u], t);
}
fn eye_lids_raw(e: u32, input: f32) -> vec2f {
    let value = clamp(input, 0.0, 1.0);
    let state = u.eyes[e];
    let top = curve(e, true, value);
    let bot = curve(e, false, value);
    let b = 1.0 - state.x;
    let hump = 4.0 * value * (1.0 - value);
    let height = curve(e, false, 0.5) - curve(e, true, 0.5);
    let arc = mix(u.eye_top[e * 6u].x, u.eye_top[e * 6u + 5u].w, value) - 0.3 * height * hump;
    let closed = max(top, bot + 1.0 + (arc - bot - 1.0) * state.y);
    return vec2f((closed - top) * max(b, -0.07), select(0.0, (closed - bot) * b * state.y, b > 0.0));
}
fn eye_lids(e: u32, value: f32, top: f32, bot: f32) -> vec2f {
    let box = u.eye_box[e];
    let du = 5.0 / (box.y - box.x);
    let raw = eye_lids_raw(e, value);
    let d = (eye_lids_raw(e, value - 2.0 * du) + 2.0 * eye_lids_raw(e, value - du) + 3.0 * raw
        + 2.0 * eye_lids_raw(e, value + du) + eye_lids_raw(e, value + 2.0 * du)) / 9.0;
    return vec2f(top + max(d.x, raw.x), bot + min(d.y, raw.y));
}
fn tex_at(p: vec2f) -> vec4f { return textureSample(image, image_sampler, (p - u.rect.xy) / u.rect.zw); }
// Keep the painted half lids anchored while the iris follows the eye's slope.
fn half_eye_uv(e: u32, p: vec2f, uv: vec2f) -> vec2f {
    let gaze = u.eyes[e].zw;
    let box = u.eye_box[e].xy;
    let span = box.y - box.x;
    let value = (p.x - box.x) / span;
    if all(gaze == vec2f(0.0)) || value <= 0.0 || value >= 1.0 { return uv; }
    let top = curve(e, true, value);
    let height = curve(e, false, value) - top;
    if height < 2.0 { return uv; }
    let v = (p.y - top) / height;
    let w = smoothstep(0.18, 0.34, v) * (1.0 - smoothstep(0.70, 0.85, v))
          * smoothstep(0.0, 0.23, min(value, 1.0 - value));
    if w == 0.0 { return uv; }
    let x = p.x - clamp(gaze.x * 0.8, -0.08 * span, 0.08 * span) * w;
    let source_u = (x - box.x) / span;
    let dy = clamp(gaze.y / height, -0.05, 0.05) * w;
    let y = mix(curve(e, true, source_u), curve(e, false, source_u), v - dy);
    return (vec2f(x, y) - u.rect.xy) / u.rect.zw;
}
fn eye_ball(e: u32, p: vec2f) -> vec4f {
    let box = u.eye_box[e];
    let state = u.eyes[e];
    let value = clamp((p.x - box.x) / (box.y - box.x), 0.0, 1.0);
    let top = curve(e, true, value);
    let bot = curve(e, false, value);
    let lids = eye_lids(e, value, top, bot);
    let v = clamp((p.y - top) / max(bot - top, 1.0), 0.0, 1.0);
    let w = sqrt(4.0 * value * (1.0 - value)) * sqrt(4.0 * v * (1.0 - v));
    let c = tex_at(p - state.zw * w);
    return c * smoothstep(lids.x - 1.0, lids.x + 0.5, p.y) * (1.0 - smoothstep(lids.y - 0.9, lids.y + 0.6, p.y));
}
fn painted_mouth(p: vec2f, base: vec4f) -> vec4f {
    let open = u.mouth_state.x;
    if open < 0.01 { return base; }
    let d = vec2f(cos(u.mouth.z), sin(u.mouth.z));
    let n = vec2f(-d.y, d.x);
    let r = p - u.mouth.xy;
    let s = dot(r, d) / u.mouth.w;
    let t = dot(r, n);
    let form = u.mouth_state.y;
    let wf = mix(0.78, 0.46, clamp(form * 0.5 + 0.5, 0.0, 1.0));
    let k = 1.0 - (s / wf) * (s / wf);
    if k <= 0.0 { return base; }
    let line = u.mouth_state.z * (1.0 - s * s);
    let hk = pow(k, mix(0.55, 0.85, clamp(form, 0.0, 1.0)));
    let height = mix(20.0, 26.0, clamp(form, 0.0, 1.0));
    let up = line - 0.6 - open * 2.5 * hk;
    let lo = line + open * height * hk;
    let cov = smoothstep(-0.7, 0.7, t - up) * smoothstep(-0.7, 0.7, lo - t);
    if cov <= 0.0 { return base; }
    let tv = clamp((t - up) / max(lo - up, 1.0), 0.0, 1.0);
    var col = mix(vec3f(0.24, 0.05, 0.08), vec3f(0.48, 0.15, 0.19), tv);
    let tongue = smoothstep(0.5, 0.78, tv) * (1.0 - smoothstep(0.45, 0.8, abs(s) / wf));
    col = mix(col, vec3f(0.86, 0.44, 0.47), tongue * 0.9);
    let teeth = (1.0 - smoothstep(0.12, 0.22, tv)) * smoothstep(0.25, 0.45, open) * (1.0 - smoothstep(0.55, 0.85, abs(s) / wf));
    col = mix(col, vec3f(0.99, 0.96, 0.94), teeth);
    let rim = 1.0 - smoothstep(0.6, 1.8, lo - t);
    col = mix(col, vec3f(0.36, 0.09, 0.11), rim * 0.85);
    return vec4f(mix(base.rgb, col, cov), 1.0);
}
@fragment fn fs(in: VertexOutput) -> @location(0) vec4f {
    let p = u.rect.xy + in.uv * u.rect.zw;
    var c: vec4f;
    if u.flags.x == 1.0 {
        c = painted_mouth(p, tex_at(p));
        let a = (p - u.cheeks.xy) / vec2f(48.0, 22.0);
        let b = (p - u.cheeks.zw) / vec2f(40.0, 20.0);
        let blush = exp(-dot(a, a)) + exp(-dot(b, b));
        c = vec4f(mix(c.rgb, c.rgb * vec3f(1.0, 0.62, 0.64), clamp(blush * u.flags.z * 0.55, 0.0, 1.0) * c.a), c.a);
    } else if u.flags.x >= 4.0 {
        c = textureSample(image, image_sampler, half_eye_uv(u32(u.flags.x) - 4u, p, in.uv));
    } else if u.flags.x >= 2.0 { c = eye_ball(u32(u.flags.x) - 2u, p); }
    else { c = tex_at(p); }
    return c * u.flags.y;
}
