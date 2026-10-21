struct Params {rect:vec4f,mapping:vec4f,viewport:vec4f}
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;
@vertex fn vertex_main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
    var positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(positions[index],0,1);
}
@fragment fn image(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let local=(pixel.xy-p.rect.xy)/p.rect.zw;
    if any(local<vec2f(0))||any(local>=vec2f(1)){return vec4f(0);}
    let uv=clamp((local-vec2f(0.5))/p.mapping.xy+vec2f(0.5)+p.mapping.zw,vec2f(0),vec2f(1));
    let size=vec2i(textureDimensions(source));let pos=clamp(uv*vec2f(size)-vec2f(0.5),vec2f(0),vec2f(size)-vec2f(1));
    let lo=vec2i(floor(pos));let hi=min(lo+vec2i(1),size-vec2i(1));let f=fract(pos);
    let sampled=mix(mix(textureLoad(source,lo,0),textureLoad(source,vec2i(hi.x,lo.y),0),f.x),mix(textureLoad(source,vec2i(lo.x,hi.y),0),textureLoad(source,hi,0),f.x),f.y);
    if p.viewport.w>1.5 {
        // CPU Normal source groups use the Pattern highp pipeline: gather the
        // same pixel and retain f32 opacity until the destination store.
        return textureLoad(source,vec2i(pixel.xy),0)*p.viewport.z;
    }
    let result=sampled*p.viewport.z;
    if p.viewport.w>0.5 {return floor(clamp(result,vec4f(0),vec4f(1))*255.0+vec4f(0.5))/255.0;}
    return result;
}
