struct Params {rect:vec4u,values:vec4f}
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var field:texture_2d<f32>;
@group(0) @binding(2) var<uniform> p:Params;
@vertex fn vertex_main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
    var positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[index],0,1);
}
fn smooth_band(lo:f32,hi:f32,value:f32)->f32 {let t=clamp((value-lo)/(hi-lo),0.0,1.0);return t*t*(3.0-2.0*t);}
@fragment fn noisy(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let xy=vec2i(pixel.xy);let local=xy-vec2i(p.rect.xy);
    if any(local<vec2i(0))||any(local>=vec2i(p.rect.zw)){return vec4f(0);}
    let values=textureLoad(field,local,0).xy;let position=p.values.x;
    let band=smooth_band(position-0.09,position,values.x)*smooth_band(1.0-position-0.05,1.0-position,1.0-values.x);
    if (p.values.y>0.5 && values.x<=position)||values.y+band>=1.2 {return textureLoad(source,xy,0);}
    return vec4f(0);
}
