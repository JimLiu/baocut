// Compensated float pairs preserve low uniform bits for discontinuous decisions.
struct Transform { x:vec4f, x_low:vec4f, y:vec4f, y_low:vec4f }
struct Params { input_domain:vec4f, output_domain:vec4f, output_low:vec4f, limits:vec4u, distance:vec4f, transforms:array<Transform,32> }
@group(0) @binding(0) var source:texture_2d<f32>;
@group(0) @binding(1) var<uniform> p:Params;
@vertex fn vertex_main(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
    var positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));
    return vec4f(positions[index],0,1);
}
// Host packs x.w as zero. A runtime integer XOR is an identity rounding
// barrier whose value the compiler cannot prove, preventing Metal fast-math
// from reassociating away the compensated residuals.
fn rounded(value:f32)->f32 {
    return bitcast<f32>(bitcast<u32>(value)^bitcast<u32>(p.transforms[0].x.w));
}
fn pair(a:f32,b:f32)->vec2f {
    let sum=rounded(a+b);let virtual_b=rounded(sum-a);
    let left=rounded(a-rounded(sum-virtual_b));let right=rounded(b-virtual_b);
    return vec2f(sum,rounded(left+right));
}
fn add(a:vec2f,b:vec2f)->vec2f {
    let s=pair(a.x,b.x);return pair(s.x,rounded(rounded(s.y+a.y)+b.y));
}
fn sub(a:vec2f,b:vec2f)->vec2f {return add(a,-b);}
fn mul(a:vec2f,b:vec2f)->vec2f {
    let product=rounded(a.x*b.x);
    let sa=rounded(4097.0*a.x);let ah=rounded(sa-rounded(sa-a.x));let al=rounded(a.x-ah);
    let sb=rounded(4097.0*b.x);let bh=rounded(sb-rounded(sb-b.x));let bl=rounded(b.x-bh);
    let e0=rounded(rounded(ah*bh)-product);
    let e1=rounded(e0+rounded(ah*bl));let e2=rounded(e1+rounded(al*bh));
    let error=rounded(e2+rounded(al*bl));
    let cross=rounded(rounded(error+rounded(a.x*b.y))+rounded(a.y*b.x));
    return pair(product,rounded(cross+rounded(a.y*b.y)));
}
fn divide(a:vec2f,b:vec2f)->vec2f {
    let first=a.x/b.x;let residual=sub(a,mul(b,vec2f(first,0)));
    let result=pair(first,(residual.x+residual.y)/b.x);
    let residual2=sub(a,mul(b,result));
    return add(result,vec2f((residual2.x+residual2.y)/b.x,0));
}
fn less(a:vec2f,b:vec2f)->bool {return a.x<b.x || (a.x==b.x && a.y<b.y);}
fn root(a:vec2f)->vec2f {
    if a.x==0.0 && a.y==0.0 {return vec2f(0);}
    let first=sqrt(max(a.x,0.0));let r=sub(a,mul(vec2f(first,0),vec2f(first,0)));
    return pair(first,(r.x+r.y)/(2.0*first));
}
fn transform(index:u32,uv:vec4f)->vec4f {
    let m=p.transforms[index];
    let x=add(add(mul(vec2f(m.x.x,m.x_low.x),uv.xy),mul(vec2f(m.x.y,m.x_low.y),uv.zw)),vec2f(m.x.z,m.x_low.z));
    let y=add(add(mul(vec2f(m.y.x,m.y_low.x),uv.xy),mul(vec2f(m.y.y,m.y_low.y),uv.zw)),vec2f(m.y.z,m.y_low.z));
    return vec4f(x,y);
}
fn bilinear(uv:vec2f)->vec4f {
    let point=clamp(p.input_domain.xy+uv*p.input_domain.zw-vec2f(0.5),p.input_domain.xy,p.input_domain.xy+p.input_domain.zw-vec2f(1));
    let lo=vec2i(floor(point));let hi=min(lo+vec2i(1),vec2i(p.input_domain.xy+p.input_domain.zw)-vec2i(1));let f=fract(point);
    return mix(mix(textureLoad(source,lo,0),textureLoad(source,vec2i(hi.x,lo.y),0),f.x),mix(textureLoad(source,vec2i(lo.x,hi.y),0),textureLoad(source,hi,0),f.x),f.y);
}
@fragment fn affine(@builtin(position) pixel:vec4f)->@location(0) vec4f {
    let dx=sub(vec2f(pixel.x,0),vec2f(p.output_domain.x,p.output_low.x));let dy=sub(vec2f(pixel.y,0),vec2f(p.output_domain.y,p.output_low.y));
    let width=vec2f(p.output_domain.z,p.output_low.z);let height=vec2f(p.output_domain.w,p.output_low.w);
    if less(dx,vec2f(0)) || less(dy,vec2f(0)) || !less(dx,width) || !less(dy,height) {return vec4f(0);}
    let uv=vec4f(divide(dx,width),divide(dy,height));
    var points:array<vec4f,32>;
    for(var index=0u;index<32u;index+=1u) {if index>=p.limits.x {break;}points[index]=transform(index,uv);}
    let first=points[0];let last=points[p.limits.x-1u];let tx=sub(last.xy,first.xy);let ty=sub(last.zw,first.zw);
    let distance=root(add(mul(tx,tx),mul(ty,ty)));let lower=vec2f(p.distance.x,p.distance.z);let upper=vec2f(p.distance.y,p.distance.w);
    var t=divide(sub(distance,lower),sub(upper,lower));if less(t,vec2f(0)) {t=vec2f(0);}if less(vec2f(1,0),t) {t=vec2f(1,0);}
    let eased=mul(mul(t,t),sub(vec2f(3,0),mul(vec2f(2,0),t)));
    let density=add(vec2f(f32(p.limits.y),0),mul(vec2f(f32(p.limits.z-p.limits.y),0),eased));var rounded=floor(density.x);
    if less(density,vec2f(rounded,0)) {rounded-=1.0;}else if !less(density,vec2f(rounded+1.0,0)) {rounded+=1.0;}
    let count=u32(clamp(rounded,f32(p.limits.y),f32(p.limits.z)));var color=vec4f(0);var weight=0u;
    for(var i=0u;i<256u;i+=1u) {
        if i>=count {break;}var q=first;
        if i==count-1u {q=last;}else if i!=0u {
            let numerator=i*(p.limits.x-1u);let segment=min(numerator/(count-1u),p.limits.x-2u);
            let phase=divide(vec2f(f32(numerator%(count-1u)),0),vec2f(f32(count-1u),0));let reverse=sub(vec2f(1,0),phase);
            q=vec4f(add(mul(points[segment].xy,reverse),mul(points[segment+1u].xy,phase)),add(mul(points[segment].zw,reverse),mul(points[segment+1u].zw,phase)));
        }
        let valid=!less(q.xy,vec2f(0)) && !less(vec2f(1,0),q.xy) && !less(q.zw,vec2f(0)) && !less(vec2f(1,0),q.zw);
        if valid || p.limits.w==1u {color+=bilinear(clamp(vec2f(q.x+q.y,q.z+q.w),vec2f(0),vec2f(1)));weight+=1u;}
        else if p.limits.w==2u {weight+=1u;}
    }
    if weight==0u {return vec4f(0);}let value=color/f32(weight);
    return floor(clamp(value,vec4f(0),vec4f(1))*255.0+vec4f(0.5))/255.0;
}
