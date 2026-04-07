// Floating panel - fallback for browsers without side panel support (Arc, etc)
// Adapted from Claude's floating-panel.js
(function() {
  const STORAGE_KEY = 'ollama-panel-state';
  const DEFAULTS = { x: null, y: 80, width: 400, height: 650, open: false };
  const MIN_W = 340, MIN_H = 400;

  let state = { ...DEFAULTS };
  let panelEl = null, shadow = null, container = null, iframe = null, visible = false;

  async function loadState() {
    try {
      const r = await chrome.storage.local.get(STORAGE_KEY);
      if (r[STORAGE_KEY]) state = { ...DEFAULTS, ...r[STORAGE_KEY] };
    } catch {}
  }

  function saveState() {
    try { chrome.storage.local.set({ [STORAGE_KEY]: state }); } catch {}
  }

  function createPanel() {
    if (panelEl) return;
    panelEl = document.createElement('ollama-floating-panel');
    shadow = panelEl.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .panel {
        position: fixed; z-index: 2147483647;
        border-radius: 12px; overflow: hidden;
        display: flex; flex-direction: column;
        background: #0a0a0a;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,107,0,0.15);
        opacity: 0; transform: scale(0.95);
        pointer-events: none;
        transition: opacity 0.2s ease-out, transform 0.2s ease-out;
      }
      .panel.visible { opacity: 1; transform: scale(1); pointer-events: auto; }
      .bar {
        height: 38px; background: #141414;
        display: flex; align-items: center;
        padding: 0 8px 0 14px;
        cursor: grab; user-select: none;
        flex-shrink: 0;
        border-bottom: 1px solid #222;
      }
      .bar:active { cursor: grabbing; }
      .title {
        flex: 1; font-size: 13px; font-weight: 600; color: #ff6b00;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        display: flex; align-items: center; gap: 6px;
      }
      .btn {
        width: 28px; height: 28px; border: none;
        background: transparent; border-radius: 6px;
        cursor: pointer; display: flex;
        align-items: center; justify-content: center;
        color: #999; transition: all 0.15s; padding: 0;
      }
      .btn:hover { background: #222; color: #e5e5e5; }
      .btn svg { width: 16px; height: 16px; }
      iframe { flex: 1; border: none; width: 100%; background: #0a0a0a; }
      .resize {
        position: absolute; bottom: 0; right: 0;
        width: 18px; height: 18px; cursor: nwse-resize; z-index: 1;
      }
      .resize::after {
        content: ''; position: absolute; bottom: 4px; right: 4px;
        width: 7px; height: 7px;
        border-right: 2px solid rgba(255,107,0,0.3);
        border-bottom: 2px solid rgba(255,107,0,0.3);
        border-radius: 0 0 2px 0;
      }
      .edge-r { position: absolute; top: 38px; right: 0; bottom: 18px; width: 5px; cursor: ew-resize; }
      .edge-l { position: absolute; top: 38px; left: 0; bottom: 18px; width: 5px; cursor: ew-resize; }
      .edge-b { position: absolute; bottom: 0; left: 18px; right: 18px; height: 5px; cursor: ns-resize; }
    `;
    shadow.appendChild(style);

    container = document.createElement('div');
    container.className = 'panel';

    // Header bar
    const bar = document.createElement('div');
    bar.className = 'bar';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = 'Ollama Agent';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M15.15 4.15a.5.5 0 01.7.7L10.71 10l5.14 5.15a.5.5 0 01-.7.7L10 10.71l-5.15 5.14a.5.5 0 01-.7-.7L9.29 10 4.15 4.85a.5.5 0 01.7-.7L10 9.29l5.15-5.14z"/></svg>';
    closeBtn.addEventListener('click', () => hide());

    bar.appendChild(title);
    bar.appendChild(closeBtn);

    // Iframe
    iframe = document.createElement('iframe');

    // Resize handles
    const resizeBR = document.createElement('div'); resizeBR.className = 'resize';
    const edgeR = document.createElement('div'); edgeR.className = 'edge-r';
    const edgeL = document.createElement('div'); edgeL.className = 'edge-l';
    const edgeB = document.createElement('div'); edgeB.className = 'edge-b';

    container.append(bar, iframe, resizeBR, edgeR, edgeL, edgeB);
    shadow.appendChild(container);
    document.documentElement.prepend(panelEl);

    setupDrag(bar);
    setupResize(resizeBR, 'br');
    setupResize(edgeR, 'r');
    setupResize(edgeL, 'l');
    setupResize(edgeB, 'b');
  }

  function setupDrag(bar) {
    bar.addEventListener('mousedown', e => {
      if (e.target.closest('.btn')) return;
      e.preventDefault();
      const sx = e.clientX, sy = e.clientY;
      const rect = container.getBoundingClientRect();
      const sl = rect.left, st = rect.top;

      const move = e => {
        e.preventDefault();
        iframe.style.pointerEvents = 'none';
        let nl = sl + e.clientX - sx;
        let nt = st + e.clientY - sy;
        nl = Math.max(0, Math.min(nl, window.innerWidth - container.offsetWidth));
        nt = Math.max(0, Math.min(nt, window.innerHeight - container.offsetHeight));
        container.style.left = nl + 'px';
        container.style.top = nt + 'px';
        container.style.right = 'auto';
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        iframe.style.pointerEvents = '';
        const r = container.getBoundingClientRect();
        state.x = r.left; state.y = r.top;
        saveState();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function setupResize(handle, dir) {
    handle.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      const sx = e.clientX, sy = e.clientY;
      const rect = container.getBoundingClientRect();
      const sw = rect.width, sh = rect.height, sl = rect.left;

      const move = e => {
        e.preventDefault();
        iframe.style.pointerEvents = 'none';
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (dir === 'br') {
          container.style.width = Math.max(MIN_W, sw + dx) + 'px';
          container.style.height = Math.max(MIN_H, sh + dy) + 'px';
        } else if (dir === 'r') {
          container.style.width = Math.max(MIN_W, sw + dx) + 'px';
        } else if (dir === 'l') {
          const nw = Math.max(MIN_W, sw - dx);
          container.style.width = nw + 'px';
          container.style.left = (sl + sw - nw) + 'px';
          container.style.right = 'auto';
        } else if (dir === 'b') {
          container.style.height = Math.max(MIN_H, sh + dy) + 'px';
        }
      };
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        iframe.style.pointerEvents = '';
        const r = container.getBoundingClientRect();
        state.width = r.width; state.height = r.height;
        state.x = r.left; state.y = r.top;
        saveState();
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  function applyPos() {
    container.style.width = state.width + 'px';
    container.style.height = state.height + 'px';
    if (state.x !== null) {
      const mx = window.innerWidth - state.width;
      const my = window.innerHeight - state.height;
      container.style.left = Math.max(0, Math.min(state.x, mx)) + 'px';
      container.style.top = Math.max(0, Math.min(state.y, my)) + 'px';
      container.style.right = 'auto';
    } else {
      container.style.right = '16px';
      container.style.top = state.y + 'px';
    }
  }

  function show() {
    if (!panelEl) createPanel();
    const src = `chrome-extension://${chrome.runtime.id}/sidepanel.html`;
    if (iframe.src !== src) iframe.src = src;
    applyPos();
    requestAnimationFrame(() => container.classList.add('visible'));
    visible = true; state.open = true; saveState();
  }

  function hide() {
    if (!container) return;
    container.classList.remove('visible');
    visible = false; state.open = false; saveState();
    setTimeout(() => { if (!visible && iframe) iframe.src = 'about:blank'; }, 250);
  }

  function toggle() { visible ? hide() : show(); }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && visible) hide();
  });

  window.addEventListener('resize', () => {
    if (!visible || !container) return;
    const r = container.getBoundingClientRect();
    if (r.left > window.innerWidth - r.width)
      container.style.left = Math.max(0, window.innerWidth - r.width) + 'px';
    if (r.top > window.innerHeight - r.height)
      container.style.top = Math.max(0, window.innerHeight - r.height) + 'px';
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'TOGGLE_FLOATING_PANEL') {
      toggle();
      sendResponse({ ok: true });
    }
  });

  loadState();
})();
