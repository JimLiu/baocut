struct Params {
    gradient_x: vec4f, gradient_y: vec4f, axis: vec4f, settings: vec4f,
    offsets: array<vec4f, 9>, factors: array<vec4f, 33>, biases: array<vec4f, 33>, region: vec4f,
}
@group(0) @binding(0) var events: texture_2d<u32>;
@group(0) @binding(1) var coverages: texture_2d<u32>;
@group(0) @binding(2) var destination: texture_2d<f32>;
@group(0) @binding(3) var<uniform> p: Params;
@vertex fn vertex_main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
    var vertices=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    return vec4f(vertices[index],0,1);
}
fn offset(index:u32)->f32 { return p.offsets[index/4u][index%4u]; }
fn paint(world:vec2f)->vec4u {
    let count=u32(p.settings.x);
    var t=world.x*p.gradient_x.x+(world.y*p.gradient_x.y+p.gradient_x.z);
    if p.settings.w==1.0 {t=clamp(t,0.0,1.0);}
    var index=0u;
    for(var i=1u;i<count;i+=1u){if t>=offset(i){index+=1u;}}
    let color=t*p.factors[index]+p.biases[index];
    let rgba=clamp(color,vec4f(0),vec4f(1));
    if p.settings.z==1.0 {
        let straight=vec4u(floor(rgba*255.0+vec4f(0.5)));
        return vec4u((straight.rgb*straight.a+vec3u(255u))>>vec3u(8u),straight.a);
    }
    return vec4u(floor(vec4f(rgba.rgb*rgba.a,rgba.a)*255.0+vec4f(0.5)));
}
@fragment fn replay(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let world=pixel.xy+p.region.xy;
    var value=vec4u(floor(clamp(textureLoad(destination,vec2i(world),0),vec4f(0),vec4f(1))*255.0+vec4f(0.5)));
    let span=textureLoad(events,vec2i(pixel.xy),0).rg;
    let source=paint(world);
    let width=u32(textureDimensions(coverages).x);
    for(var i=0u;i<span.y;i+=1u) {
        let index=span.x+i;
        let coverage=textureLoad(coverages,vec2i(i32(index%width),i32(index/width)),0).r;
        if p.settings.y == 1.0 {
            value=(value*(255u-coverage)+source*coverage+vec4u(255u))>>vec4u(8u);
        } else {
            let scaled=(source*coverage+vec4u(255u))>>vec4u(8u);
            value=scaled+((value*(255u-scaled.a)+vec4u(255u))>>vec4u(8u));
        }
    }
    return vec4f(min(value,vec4u(255u)))/255.0;
}
@fragment fn copy_roi(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    return textureLoad(destination,vec2i(pixel.xy-p.region.xy),0);
}
