// Visual indicator - shows glow border and stop button when agent is active
// Adapted from Claude's agent-visual-indicator.js
(function() {
  window.__ollamaIndicatorReady = true;
  let glowEl = null;
  let stopContainer = null;
  let active = false;

  function injectStyles() {
    if (document.getElementById('ollama-agent-styles')) return;
    const style = document.createElement('style');
    style.id = 'ollama-agent-styles';
    style.textContent = `
      @keyframes ollama-pulse {
        0%, 100% {
          box-shadow: inset 0 0 10px rgba(255, 107, 0, 0.5),
                      inset 0 0 20px rgba(255, 107, 0, 0.3),
                      inset 0 0 30px rgba(255, 107, 0, 0.1);
        }
        50% {
          box-shadow: inset 0 0 15px rgba(255, 107, 0, 0.7),
                      inset 0 0 25px rgba(255, 107, 0, 0.5),
                      inset 0 0 35px rgba(255, 107, 0, 0.2);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function show() {
    active = true;
    injectStyles();

    if (!glowEl) {
      glowEl = document.createElement('div');
      glowEl.id = 'ollama-agent-glow';
      glowEl.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        pointer-events: none; z-index: 2147483646;
        opacity: 0; transition: opacity 0.3s ease-in-out;
        animation: ollama-pulse 2s ease-in-out infinite;
      `;
      document.body.appendChild(glowEl);
    } else {
      glowEl.style.display = '';
    }

    if (!stopContainer) {
      stopContainer = document.createElement('div');
      stopContainer.id = 'ollama-agent-stop';
      stopContainer.style.cssText = `
        position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
        display: flex; justify-content: center; align-items: center;
        pointer-events: none; z-index: 2147483647;
      `;
      const btn = document.createElement('button');
      btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor" style="margin-right: 10px; vertical-align: middle;">
          <path d="M128,20A108,108,0,1,0,236,128,108.12,108.12,0,0,0,128,20Zm0,192a84,84,0,1,1,84-84A84.09,84.09,0,0,1,128,212Zm40-112v56a12,12,0,0,1-12,12H100a12,12,0,0,1-12-12V100a12,12,0,0,1,12-12h56A12,12,0,0,1,168,100Z"></path>
        </svg>
        <span style="vertical-align: middle;">Stop Agent</span>
      `;
      btn.style.cssText = `
        transform: translateY(100px); padding: 12px 16px;
        background: #1a1a1a; color: #e5e5e5;
        border: 1px solid rgba(255, 107, 0, 0.4); border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px; font-weight: 600; cursor: pointer;
        display: inline-flex; align-items: center; justify-content: center;
        box-shadow: 0 40px 80px rgba(255, 107, 0, 0.2), 0 4px 14px rgba(255, 107, 0, 0.2);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        opacity: 0; user-select: none; pointer-events: auto; white-space: nowrap;
      `;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#262626'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#1a1a1a'; });
      btn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'stop_task' });
      });
      stopContainer.appendChild(btn);
      document.body.appendChild(stopContainer);
    } else {
      stopContainer.style.display = '';
    }

    requestAnimationFrame(() => {
      if (glowEl) glowEl.style.opacity = '1';
      if (stopContainer) {
        const btn = stopContainer.querySelector('button');
        if (btn) { btn.style.transform = 'translateY(0)'; btn.style.opacity = '1'; }
      }
    });
  }

  function hide() {
    active = false;
    if (glowEl) glowEl.style.opacity = '0';
    if (stopContainer) {
      const btn = stopContainer.querySelector('button');
      if (btn) { btn.style.transform = 'translateY(100px)'; btn.style.opacity = '0'; }
    }
    setTimeout(() => {
      if (!active) {
        if (glowEl) { glowEl.remove(); glowEl = null; }
        if (stopContainer) { stopContainer.remove(); stopContainer = null; }
      }
    }, 300);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SHOW_AGENT_ACTIVE') { show(); sendResponse({ ok: true }); }
    if (msg.type === 'HIDE_AGENT_ACTIVE') { hide(); sendResponse({ ok: true }); }
  });
})();
