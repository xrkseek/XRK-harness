/**
 * Directly probe ctx.betterSidebar openTab / getTabs / panelOpen via CDP.
 */
import http from "node:http";

const port = Number(process.argv[2] || 9250);

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(d));
    }).on("error", reject);
  });
}

async function cdp(wsUrl, method, params = {}) {
  const { default: WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.on("open", () => {
      const send = (m, p) => {
        const i = ++id;
        return new Promise((res, rej) => {
          pending.set(i, { res, rej });
          ws.send(JSON.stringify({ id: i, method: m, params: p }));
        });
      };
      (async () => {
        try {
          await send("Runtime.enable");
          const expr = `
(() => {
  const root = document.getElementById('root');
  // Try to find betterSidebar via React fiber / window hooks
  // Walk window for debugging exports
  const keys = Object.keys(window).filter(k => /sidebar|better|dsh|xrk/i.test(k));
  // Click expand button if collapsed, then inspect via evaluating openTab through button's react props
  const findReactProps = (el) => {
    const key = Object.keys(el).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
    if (!key) return null;
    const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? el[fiberKey] : null;
    const chain = [];
    for (let i = 0; i < 40 && fiber; i++) {
      const t = fiber.type;
      const name = typeof t === 'function' ? (t.displayName || t.name) : typeof t === 'string' ? t : '';
      if (fiber.memoizedProps && (fiber.memoizedProps.openTab || fiber.memoizedProps.store || name.includes('Sidebar'))) {
        chain.push({ name, propKeys: Object.keys(fiber.memoizedProps || {}).slice(0, 20) });
      }
      // Look for inject face betterSidebar
      const p = fiber.memoizedProps;
      if (p?.openTab && typeof p.openTab === 'function') {
        return { via: 'props.openTab', name };
      }
      fiber = fiber.return;
    }
    return { chain: chain.slice(0, 8) };
  };

  const collapsed = document.querySelector('[data-dsh-sidebar-collapsed]');
  const expandBtn = [...document.querySelectorAll('button')].find(b =>
    (b.getAttribute('aria-label') || '').includes('展开侧边栏') ||
    (b.getAttribute('aria-label') || '').includes('Expand')
  );
  const collapseBtn = [...document.querySelectorAll('button')].find(b =>
    (b.getAttribute('aria-label') || '').includes('收起侧边栏') ||
    (b.getAttribute('aria-label') || '').includes('Collapse')
  );

  // Try to get store from collapse/expand button fiber
  const btn = collapseBtn || expandBtn;
  let storeSnap = null;
  let openTabResult = null;
  let tabsInfo = null;
  let err = null;
  let store = null;
  let openTab = null;
  let getTabs = null;
  if (btn) {
    const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber$'));
    let fiber = fiberKey ? btn[fiberKey] : null;
    for (let i = 0; i < 60 && fiber; i++) {
      const p = fiber.memoizedProps || {};
      if (p.store && typeof p.store.getSnapshot === 'function') store = p.store;
      if (p.openTab && typeof p.openTab === 'function') openTab = p.openTab;
      if (p.getTabs && typeof p.getTabs === 'function') getTabs = p.getTabs;
      // also check context-like
      const state = fiber.memoizedState;
      let s = state;
      for (let j = 0; j < 20 && s; j++) {
        const m = s.memoizedState;
        if (m && typeof m === 'object' && m.getSnapshot && m.reduce) store = m;
        s = s.next;
      }
      fiber = fiber.return;
    }
  }

  // Also search all buttons for store in fiber tree from sidebar root
  const sidebarRoot = document.querySelector('[data-dsh-sidebar], [class*="sidebar"], aside');
  const searchRoots = [sidebarRoot, document.body].filter(Boolean);
  for (const rootEl of searchRoots) {
    if (store && openTab) break;
    const fiberKey = Object.keys(rootEl).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'));
    let fiber = fiberKey ? rootEl[fiberKey] : null;
    if (fiber?.stateNode?.current) fiber = fiber.stateNode.current;
    const queue = fiber ? [fiber] : [];
    let steps = 0;
    while (queue.length && steps < 800) {
      steps++;
      const f = queue.shift();
      const p = f.memoizedProps || {};
      if (!store && p.store?.getSnapshot) store = p.store;
      if (!openTab && typeof p.openTab === 'function') openTab = p.openTab;
      if (!getTabs && typeof p.getTabs === 'function') getTabs = p.getTabs;
      // child / sibling
      if (f.child) queue.push(f.child);
      if (f.sibling) queue.push(f.sibling);
    }
  }

  if (store) {
    try {
      const snap = store.getSnapshot();
      storeSnap = {
        sessionId: snap?.sessionId,
        panelOpen: snap?.state?.panelOpen ?? snap?.panelOpen,
        keys: snap ? Object.keys(snap) : [],
        stateKeys: snap?.state ? Object.keys(snap.state) : [],
        tabCount: snap?.state?.tabs ? (Array.isArray(snap.state.tabs) ? snap.state.tabs.length : Object.keys(snap.state.tabs).length) : null,
      };
    } catch (e) { err = String(e); }
  }

  // Collapse first if open
  const wasCollapsed = !!document.querySelector('[data-dsh-sidebar-collapsed="true"], [data-dsh-sidebar-collapsed=""]');
  if (!wasCollapsed && collapseBtn) collapseBtn.click();

  // Call openTab like our code does
  if (openTab) {
    try {
      openTab({ type: 'editor' });
      openTabResult = 'called-editor';
    } catch (e) {
      openTabResult = 'error:' + String(e);
    }
  } else {
    openTabResult = 'no-openTab-found';
  }

  const afterSnap = store ? (() => {
    try {
      const snap = store.getSnapshot();
      return { panelOpen: snap?.state?.panelOpen ?? snap?.panelOpen, sessionId: snap?.sessionId };
    } catch (e) { return { err: String(e) }; }
  })() : null;

  if (getTabs) {
    try {
      const tabs = getTabs();
      tabsInfo = tabs.map(x => ({ id: x.id, keys: Object.keys(x).slice(0, 8) }));
    } catch (e) { tabsInfo = String(e); }
  }

  const fileBtn = [...document.querySelectorAll('[data-workbench-toggle]')].find(Boolean);
  // Also try calling via workbench openCommunity by simulating what index does —
  // find betterSidebar on window globals from plugin
  return {
    windowKeys: keys,
    hadStore: !!store,
    hadOpenTab: !!openTab,
    hadGetTabs: !!getTabs,
    storeSnap,
    afterSnap,
    openTabResult,
    tabsInfo,
    collapsedBeforeOpenTab: wasCollapsed || (!!collapseBtn && !document.querySelector('[aria-label*="收起"]')),
    collapsedAfter: !!document.querySelector('[data-dsh-sidebar-collapsed]'),
    expandAria: expandBtn?.getAttribute('aria-label') || collapseBtn?.getAttribute('aria-label'),
    fileYielded: fileBtn?.getAttribute('data-workbench-yielded'),
  };
})()
          `;
          const r = await send("Runtime.evaluate", {
            expression: expr,
            returnByValue: true,
            awaitPromise: false,
          });
          console.log(JSON.stringify(r.result?.result?.value ?? r, null, 2));
          ws.close();
          resolve();
        } catch (e) {
          reject(e);
        }
      })();
    });
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(msg.error);
        else res(msg);
      }
    });
    ws.on("error", reject);
  });
}

const list = JSON.parse(await get(`http://127.0.0.1:${port}/json`));
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("no page");
await cdp(page.webSocketDebuggerUrl);
