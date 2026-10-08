const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {};
require('./model-nav.js');
require('./browser-nav.js');
const N = window.BC_NAV, B = window.BC_BROWSER_NAV;
function browser(hash = '') {
  let index = 0, serial = 0;
  const entries = [{hash, state:null}], handlers = new Map();
  const emit = type => handlers.get(type)?.forEach(fn => fn());
  const host = {
    location:{hash}, crypto:{randomUUID:() => 'test-' + ++serial},
    addEventListener(type, fn) { if (!handlers.has(type)) handlers.set(type,new Set()); handlers.get(type).add(fn); },
    removeEventListener(type, fn) { handlers.get(type)?.delete(fn); },
    history:{
      get state() { return entries[index].state; },
      pushState(state, title, hash) { entries.splice(index+1); entries.push({state,hash}); index++; host.location.hash=hash; },
      replaceState(state, title, hash) { entries[index]={state,hash}; host.location.hash=hash; },
      back() { if(index) { index--; host.location.hash=entries[index].hash; emit('popstate'); emit('hashchange'); } },
      forward() { if(index<entries.length-1) { index++; host.location.hash=entries[index].hash; emit('popstate'); emit('hashchange'); } },
      get length() { return entries.length; }
    },
    hashEdit(hash) { this.history.pushState(null,'',hash); emit('popstate'); emit('hashchange'); },
    listenerCount: () => [...handlers.values()].reduce((n,set)=>n+set.size,0)
  };
  return host;
}
const mount = (host, saved=N.fresh(), surface='app') => {
  const controller = B.create(host,saved,surface);
  controller.dispose = controller.subscribe(()=>{});
  return controller;
};
test('URL codec preserves encoded IDs, filters, settings tabs and editor seek time', () => {
  for (const route of [
    {r:'agent',id:'中文 / a?&=+'}, {r:'agent',dir:'d1'},
    {r:'projects',id:'dir a',sec:'movies',from:'p1'}, {r:'task',id:'j1'},
    {r:'settings',sec:'agent',tab:'models'}, {r:'services',id:'mcp',tab:'access'},
    {r:'editor',id:'p1',via:'space',tab:'subtitle',t:12.4}, {r:'none'}
  ]) assert.deepEqual(N.routeFromHref(N.hrefFor(route)),route);
});
test('malformed and unknown links fall back safely; legacy routes still resolve', () => {
  for (const hash of ['#/wat','#/movie','#/task','#/agent/%E0%A4%A','#/home/a/b']) assert.deepEqual(N.routeFromHref(hash),{r:'home'});
  assert.deepEqual(N.routeFromHref('#/tools/remote'),{r:'services',id:'remote'});
  assert.deepEqual(N.routeFromHref('#/skill'),{r:'settings',sec:'skills'});
  assert.deepEqual(N.routeFromHref('#/movie/p1?t=NaN'),{r:'editor',id:'p1'});
  assert.deepEqual(N.routeFromHref('#/movie/p1?t=-1'),{r:'editor',id:'p1'});
});
test('explicit URL wins; bare URL restores last page without phantom back history', () => {
  const saved=N.push(N.fresh(),{r:'tasks'});
  const h=browser('#/settings?sec=general'),c=mount(h,saved);
  assert.equal(N.current(c.getSnapshot()).r,'settings');
  assert.equal(N.canBack(c.getSnapshot()),false);
  const bare=browser(),d=mount(bare,saved);
  assert.equal(bare.location.hash,'#/tasks');
  assert.equal(N.canBack(d.getSnapshot()),false);
});
test('go/replace and browser back/forward share one stack; repeated events do not duplicate', () => {
  const h=browser('#/home'),c=mount(h);
  c.go({r:'projects'}); c.go({r:'settings',sec:'general'}); c.replace({r:'settings',sec:'agent',tab:'models'});
  assert.equal(h.history.length,3);
  h.history.back();
  assert.equal(N.current(c.getSnapshot()).r,'projects');
  assert.ok(N.canFwd(c.getSnapshot()));
  c.fwd(); assert.equal(N.current(c.getSnapshot()).sec,'agent');
  c.back(); c.go({r:'tools'});
  assert.equal(N.canFwd(c.getSnapshot()),false);
  c.go({r:'tools'}); assert.equal(h.history.length,3);
});
test('refresh preserves both back and forward within the same browser session', () => {
  const h=browser('#/home'),c=mount(h);
  c.go({r:'projects'});c.go({r:'tasks'});c.back();
  const saved=JSON.parse(JSON.stringify(c.getSnapshot()));c.dispose();
  const d=mount(h,saved);assert.equal(N.current(d.getSnapshot()).r,'projects');
  d.fwd();assert.equal(N.current(d.getSnapshot()).r,'tasks');
  d.back();d.back();assert.equal(h.location.hash,'#/home');
});
test('editing hash adopts existing entry once; unsubscribe cleans browser listeners', () => {
  const h=browser('#/home'),c=mount(h);
  h.hashEdit('#/movie/p1?via=space&t=20');
  assert.equal(h.history.length,2);assert.equal(c.getSnapshot().stack.length,2);
  assert.equal(N.current(c.getSnapshot()).t,20);
  c.back();assert.equal(h.location.hash,'#/home');
  c.fwd();assert.equal(N.current(c.getSnapshot()).id,'p1');
  c.dispose();assert.equal(h.listenerCount(),0);
});
test('journal trimming and App/Web isolation remain valid', () => {
  const h=browser('#/home'),c=mount(h);
  for(let i=0;i<70;i++) c.go({r:'editor',id:'p'+i});
  assert.equal(c.getSnapshot().stack.length,50);
  assert.equal(c.getSnapshot().entries.length,50);
  c.back();assert.equal(N.current(c.getSnapshot()).id,'p68');
  const saved=c.getSnapshot();c.dispose();
  const d=mount(h,saved,'web');assert.equal(d.getSnapshot().stack.length,1);
  assert.notEqual(d.getSnapshot().session,saved.session);
});
test('broken stored history metadata and fractional positions do not crash startup', () => {
  const h=browser('#/home');assert.doesNotThrow(()=>mount(h,{...N.fresh(),entries:3}));
  assert.deepEqual(N.load({getItem:()=>JSON.stringify({stack:[{r:'home'}],pos:0.5})}),N.fresh());
});
