struct Params {
    sizes: vec4u,
    kernel: vec4f,
    counts: vec4u,
    ramp_domain: vec4f,
    ramp: vec4f,
    input_domain: vec4f,
    output_domain: vec4f,
    source_support: vec4u,
    weights: array<vec4f, 256>,
}
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var<uniform> p: Params;
@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var positions = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
    return vec4f(positions[index], 0, 1);
}
// Bounds describe all four components, including emissive RGB at alpha zero.
// Returning exact zero outside proven support leaves interpolation and kernel
// normalization unchanged while avoiding unnecessary texture fetches.
fn supported_load(point: vec2i) -> vec4f {
    if any(point < vec2i(p.source_support.xy)) || any(point >= vec2i(p.source_support.zw)) {
        return vec4f(0);
    }
    return textureLoad(source, point, 0);
}
fn bilinear(point: vec2f) -> vec4f {
    let pos = clamp(point, p.input_domain.xy, p.input_domain.xy+p.input_domain.zw - vec2f(1));
    let lo = vec2i(floor(pos));
    let hi = min(lo + vec2i(1), vec2i(p.input_domain.xy+p.input_domain.zw) - vec2i(1));
    let f = fract(pos);
    return mix(mix(supported_load(lo), supported_load(vec2i(hi.x,lo.y)), f.x),
               mix(supported_load(vec2i(lo.x,hi.y)),supported_load(hi), f.x), f.y);
}
fn encoded(point: vec2f) -> vec4f {
    let value = bilinear(point);
    return vec4f(pow(value.rgb, vec3f(p.kernel.y)), value.a);
}
struct Cell { indices: vec4i, a: vec4f, b: vec4f, c: vec4f, d: vec4f }
struct Sample { cell: Cell, value: vec4f }
fn cached_load(point: vec2i, cell: Cell) -> vec4f {
    if all(point == cell.indices.xy) { return cell.a; }
    if all(point == cell.indices.zy) { return cell.b; }
    if all(point == cell.indices.xw) { return cell.c; }
    if all(point == cell.indices.zw) { return cell.d; }
    return supported_load(point);
}
fn cached_sample(point: vec2f, previous: Cell) -> Sample {
    let pos = clamp(point, p.input_domain.xy, p.input_domain.xy+p.input_domain.zw - vec2f(1));
    let lo = vec2i(floor(pos));
    let hi = min(lo + vec2i(1), vec2i(p.input_domain.xy+p.input_domain.zw) - vec2i(1));
    var next: Cell;
    next.indices = vec4i(lo, hi);
    next.a = cached_load(lo, previous);
    if hi.x == lo.x { next.b = next.a; } else { next.b = cached_load(vec2i(hi.x,lo.y), previous); }
    if hi.y == lo.y { next.c = next.a; } else { next.c = cached_load(vec2i(lo.x,hi.y), previous); }
    if hi.x == lo.x { next.d = next.c; }
    else if hi.y == lo.y { next.d = next.b; }
    else { next.d = cached_load(hi, previous); }
    let f = fract(pos);
    // Preserve the original interpolation expression and tap accumulation order.
    return Sample(next, mix(mix(next.a,next.b,f.x),mix(next.c,next.d,f.x),f.y));
}
fn spacing_factor(point: vec2f) -> f32 {
    let uv = (point + vec2f(0.5) - p.ramp_domain.xy) / p.ramp_domain.zw;
    var coordinate = select(uv.x,uv.y,p.ramp.z>0.5);
    if p.ramp.w>0.5 { coordinate = 1.0-coordinate; }
    return 1.0-smoothstep(p.ramp.x,p.ramp.y,coordinate);
}
@fragment fn gaussian(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    if any(pixel.xy<p.output_domain.xy) || any(pixel.xy>=p.output_domain.xy+p.output_domain.zw) { return vec4f(0); }
    var center = pixel.xy * vec2f(p.sizes.xy) / vec2f(p.sizes.zw) - vec2f(0.5);
    if (p.counts.w & 2u)!=0u {center=(pixel.xy-p.output_domain.xy)/p.output_domain.zw*p.input_domain.zw+p.input_domain.xy-vec2f(0.5);}
    if p.counts.y != 0u && spacing_factor(center)==0.0 {
        return floor(clamp(bilinear(center),vec4f(0),vec4f(1))*255.0+vec4f(0.5))/255.0;
    }
    let initial = cached_sample(center, Cell(vec4i(-1),vec4f(0),vec4f(0),vec4f(0),vec4f(0)));
    var negative_cache = initial.cell;
    var positive_cache = initial.cell;
    var color = vec4f(pow(initial.value.rgb,vec3f(p.kernel.y)),initial.value.a);
    var sum = 1.0;
    var previous = center;
    for (var i=0u; i<p.counts.x; i+=1u) {
        let weight = p.weights[i/4u][i%4u];
        for (var side=0u; side<2u; side+=1u) {
            var factor = 1.0;
            if p.counts.y != 0u {
                let at = select(center,previous,p.counts.z!=0u);
                factor = spacing_factor(at);
            }
            let distance = f32(i+1u) * p.kernel.x * factor;
            let delta = select(vec2f(distance,0),vec2f(0,distance),p.kernel.z>0.5);
            let positive = (side==1u) != ((p.counts.w & 1u)!=0u);
            let point = center + select(-delta,delta,positive);
            previous = point;
            if p.kernel.w == 1.0 { previous = clamp(point,p.input_domain.xy-vec2f(0.5),p.input_domain.xy+p.input_domain.zw-vec2f(0.5)); }
            let valid = all(point >= p.input_domain.xy-vec2f(0.5)) && all(point <= p.input_domain.xy+p.input_domain.zw-vec2f(0.5));
            if valid || p.kernel.w == 1.0 {
                var sample: Sample;
                if positive { sample = cached_sample(point, positive_cache); positive_cache = sample.cell; }
                else { sample = cached_sample(point, negative_cache); negative_cache = sample.cell; }
                color += weight * vec4f(pow(sample.value.rgb,vec3f(p.kernel.y)),sample.value.a);
                sum += weight;
            }
            else if p.kernel.w == 2.0 { sum += weight; }
        }
    }
    let value = color / sum;
    let decoded = vec4f(pow(value.rgb, vec3f(1.0/p.kernel.y)),value.a);
    return floor(clamp(decoded,vec4f(0),vec4f(1))*255.0+vec4f(0.5))/255.0;
}
