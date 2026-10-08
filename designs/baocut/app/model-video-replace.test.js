const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('./model-video-replace.js');
const target = {id:'v1',kind:'video',asset:'old.mp4',srcId:'old',start:10,end:20,rate:2,srcStart:30,place:{x:45},style:{muted:true}};
const source = {id:'new',name:'new.mp4',dur:24,naturalW:1080,naturalH:1920};
// 主轨拆成的三段 + 另一条轨道上的 B-roll
const track = [
  {id:'a',kind:'video',asset:'main.mp4',srcId:'main',start:0,end:28,srcStart:0},
  {id:'b',kind:'video',asset:'main.mp4',srcId:'main',start:28,end:45.2,srcStart:28},
  {id:'c',kind:'video',asset:'main.mp4',srcId:'main',start:45.2,end:78,srcStart:45.2},
  {id:'broll',kind:'video',asset:'desk.mov',srcId:'desk',start:5,end:15,srcStart:0},
];
const main = {id:'main',name:'main.mp4',dur:206,naturalW:1920,naturalH:1080};
const output = {id:'out',name:'main-9x16.mp4',dur:206,naturalW:1080,naturalH:1920,crop:{sourceId:'main',sourceName:'main.mp4',range:{start:0,end:206},ratio:9/16}};

test('直接替换：不检查时长，片段长度跟着新素材走（按速度换算），摆位保留', () => {
  const p = R.plan({expected:R.snapshot(target),target,source,sourceStart:4});
  assert.equal(p.ok,true); assert.equal(p.mode,'full');
  assert.equal(p.newLen,10);                       // (24-4)/2
  assert.equal(p.patch.end,undefined);             // 一样长就不写 end
  const longer = R.plan({expected:R.snapshot(target),target,source:{...source,dur:60}});
  assert.equal(longer.patch.end,40); assert.equal(longer.delta,20);
  const shorter = R.plan({expected:R.snapshot(target),target,source:{...source,dur:6}});
  assert.equal(shorter.patch.end,13); assert.equal(shorter.delta,-7);
  assert.deepEqual(Object.keys(longer.patch).sort(),['asset','crop','end','naturalH','naturalW','srcId','srcStart']);
  assert.deepEqual(target.place,{x:45});
});
test('同轨 ripple：变长把后面的片段往后推，变短往前拉；别的轨道不动；独立轨道只改自己', () => {
  const docs = {};
  const longer = R.plan({expected:R.snapshot(track[0]),target:track[0],source:{id:'x',name:'x.mp4',dur:41},elements:track,docs});
  assert.equal(longer.delta,13); assert.equal(longer.alone,false);
  assert.deepEqual(longer.ripple,[{id:'b',start:41,end:58.2},{id:'c',start:58.2,end:91}]);
  const shorter = R.plan({expected:R.snapshot(track[1]),target:track[1],source:{id:'x',name:'x.mp4',dur:7.2},elements:track,docs});
  assert.equal(shorter.delta,-10); assert.deepEqual(shorter.ripple,[{id:'c',start:35.2,end:68}]);
  const broll = R.plan({expected:R.snapshot(track[3]),target:track[3],source:{id:'x',name:'x.mp4',dur:41},elements:track,docs});
  assert.equal(broll.alone,true); assert.deepEqual(broll.ripple,[]); assert.equal(broll.patch.end,46);
  // 文档层的 start/end 覆盖参与分道
  const moved = R.plan({expected:R.snapshot({...track[2],start:60,end:70}),target:{...track[2],start:60,end:70},source:{id:'x',name:'x.mp4',dur:20},
    elements:track,docs:{c:{start:60,end:70}}});
  assert.deepEqual(moved.ripple,[]);
  assert.match(R.describe(longer),/变长 13\.0 秒，同轨后面 2 段往后挪/);
  assert.match(R.describe(broll),/这条轨道跟着变长/);
});
test('拒绝的只有真错误：目标变了、锁定、没选素材、开始时间越界；同一素材从 0 秒起也照换；时长未知先保留原时长', () => {
  const args={expected:R.snapshot(target),target,source};
  assert.equal(R.plan({...args,target:{...target,place:{x:50}}}).ok,false);
  assert.equal(R.plan({...args,target:{...target,locked:true},expected:R.snapshot({...target,locked:true})}).ok,false);
  assert.equal(R.plan({...args,source:null}).ok,false);
  assert.equal(R.plan({...args,sourceStart:24}).ok,false);
  assert.equal(R.plan({...args,sourceStart:-1}).ok,false);
  const same = R.plan({...args,source:{id:'old',name:'old.mp4',dur:100}});
  assert.equal(same.ok,true); assert.equal(same.patch.srcStart,0); assert.equal(same.patch.end,60);
  const unknown = R.plan({...args,source:{...source,dur:0}});
  assert.equal(unknown.ok,true); assert.equal(unknown.mode,'keep'); assert.equal(unknown.patch.end,undefined);
});
test('同源成片盖住片段就按原片时间对齐、时长不变；没盖住就当普通视频换', () => {
  const p = R.plan({expected:R.snapshot(track[1]),target:track[1],source:output,sourceStart:R.initialStart(track[1],output),elements:track});
  assert.equal(p.mode,'aligned'); assert.equal(p.patch.srcStart,28); assert.equal(p.patch.end,undefined); assert.deepEqual(p.ripple,[]);
  const partial = {...output,dur:50,crop:{...output.crop,range:{start:0,end:50}}};
  assert.equal(R.covered(track[1],partial),true); assert.equal(R.covered(track[2],partial),false);
  const q = R.plan({expected:R.snapshot(track[2]),target:track[2],source:partial,sourceStart:0,elements:track});
  assert.equal(q.mode,'full'); assert.equal(q.patch.end,95.2);
  assert.equal(R.initialStart(target,{...source,crop:{sourceId:'old',range:{start:25,end:50}}}),5);
  assert.equal(R.initialStart(target,source),0);
});
test('一份成片换整段视频：同原片的所有片段一起换、剪口不动，范围外或锁定的片段留下', () => {
  const all = R.planSource({elements:track,docs:{},output});
  assert.deepEqual(all.replaced.map(r => [r.id,r.patch.srcStart,r.patch.end]),[['a',0,undefined],['b',28,undefined],['c',45.2,undefined]]);
  assert.deepEqual(all.outside,[]); assert.deepEqual(all.span,{start:0,end:78});
  const part = R.planSource({elements:track,docs:{b:{locked:true}},output:{...output,crop:{...output.crop,range:{start:0,end:50}}}});
  assert.deepEqual(part.replaced.map(r => r.id),['a']);
  assert.deepEqual(part.outside.map(e => e.id),['b','c']);
  assert.deepEqual(R.planSource({elements:track,output:{id:'plain'}}).replaced,[]);
  const swapped = R.planSource({elements:track,docs:{a:{srcId:'out',asset:'main-9x16.mp4'}},output});
  assert.deepEqual(swapped.already.map(e => e.id),['a']); assert.deepEqual(swapped.replaced.map(r => r.id),['b','c']);
});
test('保持画幅：新素材按高铺满居中，宽按比例算', () => {
  assert.deepEqual(R.keepPlace({x:1,w:100,h:100},9/16,16/9),{x:50,y:50,w:31.6,h:100,scale:1,rot:0});
  assert.equal(R.keepPlace({},16/9,9/16).w,100);
});
test('stable IDs take precedence over duplicate filenames and fullscreen PiP geometry is recognized', () => {
  assert.equal(R.sameSource(target,{id:'different',name:'old.mp4'}),false);
  assert.equal(R.aligned(target,{crop:{sourceId:'different',sourceName:'old.mp4'}}),false);
  assert.equal(R.fullFrame({mode:'pip',place:{w:100,x:50,y:50}}, {naturalW:1920,naturalH:1080}, '16:9'),true);
  assert.equal(R.fullFrame({mode:'pip',place:{w:34,x:50,y:50}}, {naturalW:1920,naturalH:1080}, '16:9'),false);
});
test('stage source resolution follows the chosen ID even when a local video has the same filename', () => {
  const first = {id:'old', name:'same.mp4', url:'https://example.test/old.mp4'};
  const local = {id:'local-new', name:'same.mp4', url:'blob:local-new'};
  const selected = {...target, asset:'same.mp4', srcId:local.id, sourceId:first.id};
  assert.equal(R.sourceFor(selected, [first, local]), local);
  assert.equal(R.sourceFor({...selected, srcId:'removed'}, [first, local]), null);
  assert.equal(R.sourceFor({asset:'legacy.mp4'}, [{id:'legacy',name:'legacy.mp4'}]).id, 'legacy');
});
test('fullscreen detection uses current pose after shrinking or enlarging a video', () => {
  const original = {naturalW:1920,naturalH:1080};
  const centered = {x:50,y:50,w:100,h:100,scale:1,rot:0};
  const shrunk = {place:centered, pose:{...centered,w:34,h:34}};
  assert.equal(R.fullFrame(shrunk, original, '16:9'), false);
  assert.equal(R.fullFrame({...shrunk,mode:'fullscreen'}, original, '16:9'), false);
  assert.equal(R.fullFrame({place:{...centered,w:34,h:34},pose:centered}, original, '16:9'), true);
  assert.equal(R.fullFrame({place:centered,pose:{...centered,scale:1.2}}, original, '16:9'), false);
});

test('replaceGroup：汇总换几段、原片名与画幅差异', () => {
  const track = [{id: 'a', kind: 'video', asset: 'main.mp4', start: 0, end: 100, srcStart: 0}, {id: 'b', kind: 'video', asset: 'main.mp4', start: 100, end: 206, srcStart: 100}];
  const g = R.replaceGroup({elements: track, docs: {}, sources: [{id: 'main', name: 'main.mp4'}, output], output, canvasRatio: 16 / 9});
  assert.equal(g.count, 2); assert.equal(g.replaced.length, 2); assert.equal(g.name, 'main.mp4');
  assert.equal(g.ratioDiffers, true); assert.equal(g.outRatio, 1080 / 1920);
  assert.equal(R.replaceGroup({elements: track, docs: {}, sources: [], output, canvasRatio: 9 / 16}).ratioDiffers, false);
});
