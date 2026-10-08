/* Browser history is the navigation authority; BC_NAV keeps the bounded route
   journal for App rail return targets and the in-app back/forward controls. */
(function () {
  const N = window.BC_NAV;
  function create(host, saved, surface) {
    const id = () => host.crypto.randomUUID();
    const state = () => host.history.state?.bcRoute;
    const decoded = () => N.routeFromHref(host.location.hash);
    const valid = s => s && s.surface === surface && s.session === nav.session;
    const old = state();
    const oldPos = Array.isArray(saved.entries) ? saved.entries.indexOf(old?.entry) : -1;
    const resume = old && old.surface === surface && old.session === saved.session &&
      Array.isArray(saved.entries) && saved.entries.length === saved.stack.length && oldPos >= 0 &&
      N.isSame(saved.stack[oldPos], decoded());
    // A copied URL takes precedence over localStorage. A bare entry restores only
    // the last route, never a phantom browser history from an earlier session.
    let nav = resume ? {...saved, pos:oldPos} : {
      stack:[host.location.hash ? decoded() : N.routeFromHref(N.hrefFor(N.current(saved)))], pos:0, session:id(), entries:[id()]
    };
    const listeners = new Set();
    let listening = false;
    function write(method) {
      const bcRoute = {surface, session:nav.session, entry:nav.entries[nav.pos]};
      host.history[method]({...host.history.state, bcRoute}, '', N.hrefFor(N.current(nav)));
    }
    function notify() { listeners.forEach(fn => fn()); }
    function change(route, replace) {
      const clean = N.routeFromHref(N.hrefFor(route));
      const next = replace ? N.replace(nav, clean) : N.push(nav, clean);
      if (next === nav) return;
      const entries = replace ? nav.entries : nav.entries.slice(0, nav.pos + 1).concat(id()).slice(-50);
      nav = {...next, session:nav.session, entries};
      write(replace ? 'replaceState' : 'pushState');
      notify();
    }
    function onLocation() {
      const s = state(), pos = valid(s) ? nav.entries.indexOf(s.entry) : -1;
      if (pos >= 0 && N.isSame(nav.stack[pos], decoded())) {
        if (nav.pos !== pos) { nav = {...nav, pos}; notify(); }
        return;
      }
      // Manual hash edits already created a browser entry. Adopt it with
      // replaceState, so popstate + hashchange cannot append duplicate entries.
      const next = N.push(nav, decoded());
      if (next === nav) { write('replaceState'); return; }
      nav = {...next, session:nav.session, entries:nav.entries.slice(0,nav.pos + 1).concat(id()).slice(-50)};
      write('replaceState');
      notify();
    }
    return {
      getSnapshot: () => nav,
      subscribe(fn) {
        listeners.add(fn);
        if (!listening) {
          write('replaceState');
          host.addEventListener('popstate', onLocation);
          host.addEventListener('hashchange', onLocation);
          listening = true;
        }
        return () => {
          listeners.delete(fn);
          if (!listeners.size) {
            host.removeEventListener('popstate', onLocation);
            host.removeEventListener('hashchange', onLocation);
            listening = false;
          }
        };
      },
      go: route => change(route, false),
      replace: route => change(route, true),
      back: () => { if (N.canBack(nav)) host.history.back(); },
      fwd: () => { if (N.canFwd(nav)) host.history.forward(); },
    };
  }
  window.BC_BROWSER_NAV = {create};
})();
