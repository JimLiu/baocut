struct Params {
    output_gain: vec4f,
    tint_opacity: vec4f,
    matrix0: vec4f,
    matrix1: vec4f,
    matrix2: vec4f,
    flags: vec4u,
}
@group(0) @binding(0) var original: texture_2d<f32>;
@group(0) @binding(1) var level0: texture_2d<f32>;
@group(0) @binding(2) var level1: texture_2d<f32>;
@group(0) @binding(3) var level2: texture_2d<f32>;
@group(0) @binding(4) var level3: texture_2d<f32>;
@group(0) @binding(5) var level4: texture_2d<f32>;
@group(0) @binding(6) var level5: texture_2d<f32>;
@group(0) @binding(7) var level6: texture_2d<f32>;
@group(0) @binding(8) var<uniform> p: Params;
@vertex fn vertex_main(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
    var positions = array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    return vec4f(positions[index],0,1);
}
fn bilinear(tex: texture_2d<f32>, uv: vec2f) -> vec4f {
    let size = vec2i(textureDimensions(tex));
    let pos = clamp(uv*vec2f(size)-vec2f(0.5),vec2f(0),vec2f(size)-vec2f(1));
    let lo = vec2i(floor(pos));
    let hi = min(lo+vec2i(1),size-vec2i(1));
    let f = fract(pos);
    return mix(mix(textureLoad(tex,lo,0),textureLoad(tex,vec2i(hi.x,lo.y),0),f.x),
               mix(textureLoad(tex,vec2i(lo.x,hi.y),0),textureLoad(tex,hi,0),f.x),f.y);
}
fn sample_level(i: u32, uv: vec2f) -> vec4f {
    switch i {
        case 0u: {return bilinear(level0,uv);}
        case 1u: {return bilinear(level1,uv);}
        case 2u: {return bilinear(level2,uv);}
        case 3u: {return bilinear(level3,uv);}
        case 4u: {return bilinear(level4,uv);}
        case 5u: {return bilinear(level5,uv);}
        default: {return bilinear(level6,uv);}
    }
}
@fragment fn glow(@builtin(position) pixel: vec4f) -> @location(0) vec4f {
    let uv = pixel.xy/p.output_gain.xy;
    let gain = p.output_gain.z;
    let src = bilinear(original,uv)*p.tint_opacity.w;
    var product = vec4f(1);
    for(var i=0u; i<p.flags.x; i+=1u) {
        product *= vec4f(1)-clamp(sample_level(i,uv)*gain,vec4f(0),vec4f(1));
    }
    let combined = clamp((vec4f(1)-product)*max(gain,1.0),vec4f(0),vec4f(1));
    let rgb = combined.rgb*p.tint_opacity.rgb;
    let transformed = clamp(vec3f(dot(p.matrix0.xyz,rgb),dot(p.matrix1.xyz,rgb),dot(p.matrix2.xyz,rgb)),vec3f(0),vec3f(1));
    let light = vec4f(transformed,combined.a);
    var result = src + light*(1.0-src.a);
    if p.flags.y == 1u { result = vec4f(1)-(vec4f(1)-light)*(vec4f(1)-src); }
    return floor(clamp(result,vec4f(0),vec4f(1))*255.0+vec4f(0.5))/255.0;
}
