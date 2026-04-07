// Accessibility tree generator - adapted from Claude's approach
// Builds a structured representation of interactive page elements with ref_ids
(function() {
  window.__ollamaElementMap || (window.__ollamaElementMap = {});
  window.__ollamaRefCounter || (window.__ollamaRefCounter = 0);

  window.__generateAccessibilityTree = function(filter, maxDepth, maxLength) {
    const lines = [];
    const depth = maxDepth ?? 15;

    function getRole(el) {
      const role = el.getAttribute('role');
      if (role) return role;
      const tag = el.tagName.toLowerCase();
      const type = el.getAttribute('type');
      const roleMap = {
        a: 'link', button: 'button', select: 'combobox', textarea: 'textbox',
        h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
        img: 'image', nav: 'navigation', main: 'main', header: 'banner',
        footer: 'contentinfo', section: 'region', article: 'article',
        aside: 'complementary', form: 'form', table: 'table',
        ul: 'list', ol: 'list', li: 'listitem', label: 'label'
      };
      if (tag === 'input') {
        if (type === 'submit' || type === 'button') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'file') return 'button';
        return 'textbox';
      }
      return roleMap[tag] || 'generic';
    }

    function getName(el) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'select') {
        const opt = el.querySelector('option[selected]') || el.options[el.selectedIndex];
        if (opt?.textContent) return opt.textContent.trim();
      }
      for (const attr of ['aria-label', 'placeholder', 'title', 'alt']) {
        const val = el.getAttribute(attr);
        if (val?.trim()) return val.trim();
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      if (tag === 'input') {
        const type = el.getAttribute('type') || '';
        if (type === 'submit' && el.getAttribute('value')?.trim()) return el.getAttribute('value').trim();
        if (el.value?.length < 50 && el.value?.trim()) return el.value.trim();
      }
      if (['button', 'a', 'summary'].includes(tag)) {
        let text = '';
        for (const child of el.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
        }
        if (text.trim()) return text.trim();
      }
      if (tag.match(/^h[1-6]$/)) {
        return (el.textContent || '').trim().substring(0, 100);
      }
      let directText = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) directText += child.textContent;
      }
      if (directText.trim().length >= 3) {
        return directText.trim().substring(0, 100);
      }
      return '';
    }

    function isVisible(el) {
      try {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        // Be lenient - some elements have 0 dimensions but are still interactive
        if (el.offsetWidth > 0 || el.offsetHeight > 0) return true;
        // Check bounding rect as fallback
        const rect = el.getBoundingClientRect();
        return rect.width > 0 || rect.height > 0;
      } catch (e) {
        return false;
      }
    }

    function isInteractive(el) {
      const tag = el.tagName.toLowerCase();
      return ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'].includes(tag) ||
             el.getAttribute('onclick') !== null ||
             el.getAttribute('tabindex') !== null ||
             el.getAttribute('role') === 'button' ||
             el.getAttribute('role') === 'link' ||
             el.getAttribute('contenteditable') === 'true';
    }

    function isRelevant(el) {
      const tag = el.tagName.toLowerCase();
      if (['script', 'style', 'meta', 'link', 'title', 'noscript', 'svg', 'path'].includes(tag)) return false;
      // Don't skip aria-hidden for interactive elements (some sites misuse it)
      if (el.getAttribute('aria-hidden') === 'true' && !isInteractive(el)) return false;
      if (!isVisible(el)) return false;
      if (filter === 'interactive') return isInteractive(el);
      if (isInteractive(el)) return true;
      if (getName(el).length > 0) return true;
      const role = getRole(el);
      return role !== 'generic' && role !== 'image';
    }

    function walk(el, level) {
      if (level > depth || !el?.tagName) return;
      const relevant = isRelevant(el);
      if (relevant) {
        const role = getRole(el);
        const name = getName(el);
        // Find or create ref_id
        let refId = null;
        for (const [id, ref] of Object.entries(window.__ollamaElementMap)) {
          if (ref.deref() === el) { refId = id; break; }
        }
        if (!refId) {
          refId = 'ref_' + (++window.__ollamaRefCounter);
          window.__ollamaElementMap[refId] = new WeakRef(el);
        }
        let line = '  '.repeat(level) + role;
        if (name) {
          line += ' "' + name.replace(/\s+/g, ' ').substring(0, 100).replace(/"/g, '\\"') + '"';
        }
        line += ' [' + refId + ']';
        if (el.getAttribute('href')) line += ' href="' + el.getAttribute('href') + '"';
        if (el.getAttribute('type')) line += ' type="' + el.getAttribute('type') + '"';
        if (el.getAttribute('placeholder')) line += ' placeholder="' + el.getAttribute('placeholder') + '"';
        lines.push(line);
      }
      if (el.children && level < depth) {
        for (const child of el.children) {
          walk(child, relevant ? level + 1 : level);
        }
      }
    }

    if (document.body) walk(document.body, 0);

    // FALLBACK: if we found very few elements, do a brute-force scan
    if (lines.length < 5) {
      var selectors = 'a, button, input, textarea, select, [role="button"], [role="link"], [onclick], [tabindex]';
      var allEls = document.querySelectorAll(selectors);
      for (var fi = 0; fi < allEls.length && fi < 100; fi++) {
        var fel = allEls[fi];
        try {
          var frect = fel.getBoundingClientRect();
          if (frect.width === 0 && frect.height === 0) continue;
          if (frect.top > window.innerHeight * 2) continue;
          var fRole = getRole(fel);
          var fName = getName(fel);
          var fRefId = null;
          for (var fid in window.__ollamaElementMap) {
            if (window.__ollamaElementMap[fid].deref() === fel) { fRefId = fid; break; }
          }
          if (!fRefId) {
            fRefId = 'ref_' + (++window.__ollamaRefCounter);
            window.__ollamaElementMap[fRefId] = new WeakRef(fel);
          }
          var fLine = fRole;
          if (fName) fLine += ' "' + fName.replace(/\s+/g, ' ').substring(0, 80).replace(/"/g, '\\"') + '"';
          fLine += ' [' + fRefId + ']';
          if (fel.href) fLine += ' href="' + fel.href.substring(0, 100) + '"';
          lines.push(fLine);
        } catch (e) {}
      }
    }

    // Cleanup dead refs
    for (const id of Object.keys(window.__ollamaElementMap)) {
      if (!window.__ollamaElementMap[id].deref()) delete window.__ollamaElementMap[id];
    }
    const result = lines.join('\n');
    if (maxLength && result.length > maxLength) {
      return { error: `Output exceeds ${maxLength} chars (${result.length}). Try smaller depth.`, tree: '' };
    }
    return { tree: result, viewport: { width: window.innerWidth, height: window.innerHeight } };
  };

  // Action executor using ref_ids
  window.__ollamaExecuteAction = function(action) {
    if (action.action === 'scroll') {
      window.scrollBy(0, action.direction === 'up' ? -500 : 500);
      return { success: true, message: `Scrolled ${action.direction}` };
    }

    if (!action.ref_id) {
      return { success: false, message: 'No ref_id provided' };
    }

    const weakRef = window.__ollamaElementMap[action.ref_id];
    if (!weakRef) return { success: false, message: `Unknown ref: ${action.ref_id}` };
    const el = weakRef.deref();
    if (!el) return { success: false, message: `Element gone: ${action.ref_id}` };

    switch (action.action) {
      case 'click':
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        setTimeout(() => el.click(), 200);
        return { success: true, message: `Clicked [${action.ref_id}]` };
      case 'type':
        el.focus();
        el.value = action.text || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: `Typed "${action.text}" into [${action.ref_id}]` };
      case 'clear_and_type':
        el.focus();
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = action.text || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, message: `Cleared and typed "${action.text}" into [${action.ref_id}]` };
      case 'type_and_enter':
        el.focus();
        el.value = action.text || '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(function() {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          if (el.form) el.form.submit();
        }, 100);
        return { success: true, message: `Typed "${action.text}" and pressed Enter` };
      case 'press_enter':
        el.focus();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return { success: true, message: `Pressed Enter on [${action.ref_id}]` };
      case 'extract':
        const text = el.textContent?.trim().slice(0, 1000) || '';
        return { success: true, message: text };
      case 'hover':
        el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        return { success: true, message: `Hovered [${action.ref_id}]` };
      case 'select':
        if (el.tagName.toLowerCase() === 'select') {
          el.value = action.value || '';
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { success: true, message: `Selected "${action.value}" in [${action.ref_id}]` };
        }
        return { success: false, message: 'Not a select element' };
      default:
        return { success: false, message: `Unknown action: ${action.action}` };
    }
  };

  // Highlight an element briefly
  window.__ollamaHighlight = function(refId) {
    const weakRef = window.__ollamaElementMap[refId];
    if (!weakRef) return;
    const el = weakRef.deref();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: (rect.top - 3) + 'px',
      left: (rect.left - 3) + 'px',
      width: (rect.width + 6) + 'px',
      height: (rect.height + 6) + 'px',
      border: '2px solid #ff6b00',
      borderRadius: '4px',
      background: 'rgba(255, 107, 0, 0.12)',
      zIndex: '2147483647',
      pointerEvents: 'none',
      transition: 'opacity 0.3s'
    });
    document.body.appendChild(overlay);
    setTimeout(() => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }, 1200);
  };
})();
