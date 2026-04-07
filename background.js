var OLLAMA_URL = 'http://localhost:11434';
var DEFAULT_MODEL = 'qwen2.5:7b';

var CHAT_SYSTEM = 'You are an AI browser agent. You control a web browser.\n\nWhen the user asks you to do something on the web, respond with a plan starting with "PLAN:".\n\nBe SPECIFIC. Use real URLs. Never say "search for the website" - navigate directly.\n\nExample - user says "find jobs on linkedin":\nPLAN:\n1. Navigate to https://www.linkedin.com/jobs\n2. Click the search box\n3. Type the job search query\n4. Click search button\n5. Browse and click on interesting results\n\nExample - user says "search for cats on google":\nPLAN:\n1. Navigate to https://www.google.com\n2. Click the search box\n3. Type "cats"\n4. Click Google Search button\n\nIf the user asks a question (not a web task), answer briefly.\nIf the user shares a file, summarize it.\nKeep responses under 80 words.';

var AGENT_SYSTEM = 'You are a smart browser automation agent. You see the current page and must decide what to do next.\n\nYou MUST respond in this exact format:\n\nTHINKING: (analyze the current page, what you see, what the task needs, and what step to take next)\nACTION: (the JSON action)\n\nAvailable actions:\n{"action": "click", "ref_id": "ref_X"}\n{"action": "type", "ref_id": "ref_X", "text": "..."}\n{"action": "clear_and_type", "ref_id": "ref_X", "text": "..."}\n{"action": "type_and_enter", "ref_id": "ref_X", "text": "..."} - Type text and press Enter (best for search boxes)\n{"action": "press_enter", "ref_id": "ref_X"}\n{"action": "navigate", "url": "https://full-url-here"}\n{"action": "scroll", "direction": "down"}\n{"action": "done", "result": "summary of what was accomplished"}\n\nRULES:\n1. THINK before acting. Analyze what you see on the page.\n2. Break complex tasks into small steps. For "apply to jobs on linkedin": first navigate to linkedin.com/jobs, then search for a role, then click a job posting, then find and click the Apply/Solicitud button.\n3. Navigate DIRECTLY to websites. Never search for a website on Google.\n4. For search boxes, use "type_and_enter" to type and submit in one step.\n5. Check your previous steps. NEVER repeat the same action. If something did not work, try a different approach.\n6. Look for buttons with text like "Apply", "Solicitud", "Submit", "Aplicar" and click them.\n7. If you are stuck or the task is impossible, use "done" and explain why.\n\nExample:\nTHINKING: I need to search for AI jobs. I see a search box [ref_5]. I will type my query and press Enter.\nACTION: {"action": "type_and_enter", "ref_id": "ref_5", "text": "AI Engineer remote"}';

var activeTask = null;
var taskHistory = [];
var currentModel = DEFAULT_MODEL;
var activeTabId = null;
var targetTabId = null;
var ports = [];
var pendingPlan = null;
var knownTabs = {}; // { tabId: { url, title } } - registered by content scripts

chrome.storage.local.get('model', function(data) {
  if (data.model) currentModel = data.model;
});

function isUsableUrl(url) {
  return url && (url.startsWith('http://') || url.startsWith('https://'));
}

// --- Port communication ---
chrome.runtime.onConnect.addListener(function(port) {
  if (port.name === 'sidepanel') {
    console.log('[OBA] sidepanel connected');
    ports.push(port);

    // Immediately send the current target tab if we have one
    if (targetTabId && knownTabs[targetTabId]) {
      console.log('[OBA] sending known tab to sidepanel:', targetTabId);
      port.postMessage({
        type: 'set_target',
        tabId: targetTabId,
        url: knownTabs[targetTabId].url,
        title: knownTabs[targetTabId].title
      });
    } else {
      // Send any known tab
      var ids = Object.keys(knownTabs);
      if (ids.length > 0) {
        var id = parseInt(ids[ids.length - 1]);
        targetTabId = id;
        console.log('[OBA] sending fallback tab to sidepanel:', id);
        port.postMessage({
          type: 'set_target',
          tabId: id,
          url: knownTabs[id].url,
          title: knownTabs[id].title
        });
      } else {
        console.log('[OBA] no known tabs yet');
      }
    }

    port.onDisconnect.addListener(function() {
      ports = ports.filter(function(p) { return p !== port; });
    });
    port.onMessage.addListener(function(msg) {
      handleMessage(msg, port);
    });
  }
});

function broadcast(msg) {
  console.log('[OBA] broadcast:', JSON.stringify(msg).slice(0, 200));
  ports.forEach(function(p) {
    try { p.postMessage(msg); } catch (e) {}
  });
}

function broadcastStatus(status, extra) {
  var msg = { type: 'agent_status', status: status };
  if (extra) { for (var k in extra) msg[k] = extra[k]; }
  broadcast(msg);
}

function broadcastChat(text, agentRunning) {
  broadcast({ type: 'chat_response', text: text, agentRunning: !!agentRunning });
}

// --- Message handling ---
function handleMessage(msg, port) {
  console.log('[OBA] msg:', msg.type);
  if (msg.type === 'chat_message') {
    handleChatMessage(msg);
  }
  if (msg.type === 'set_tab') {
    targetTabId = msg.tabId;
    console.log('[OBA] tab set by sidepanel:', msg.tabId);
  }
  if (msg.type === 'approve_plan') {
    if (pendingPlan) {
      var plan = pendingPlan;
      pendingPlan = null;
      executePlan(plan.task, msg.tabId || targetTabId);
    }
  }
  if (msg.type === 'stop_task') {
    activeTask = null;
    if (activeTabId) showIndicator(activeTabId, false);
  }
  if (msg.type === 'set_model') {
    currentModel = msg.model;
    chrome.storage.local.set({ model: msg.model });
  }
}

async function handleChatMessage(msg) {
  var text = msg.text;
  var history = msg.history || [];

  // Save tabId from sidepanel
  if (msg.tabId) {
    targetTabId = msg.tabId;
    console.log('[OBA] got tabId from sidepanel:', msg.tabId);
  }

  try {
    var pageContext = '';
    var tabId = msg.tabId || targetTabId;
    if (tabId) {
      try {
        var tab = await chrome.tabs.get(tabId);
        pageContext = '\n\nCurrent browser tab: ' + tab.url + ' - ' + tab.title;
      } catch (e) {}
    }

    var messages = [{ role: 'system', content: CHAT_SYSTEM + pageContext }];
    // Add recent history (last 10 messages)
    var recent = history.slice(-10);
    for (var i = 0; i < recent.length; i++) {
      messages.push({ role: recent[i].role, content: recent[i].content });
    }

    var response = await queryOllama(messages);
    console.log('[OBA] chat response:', response.slice(0, 200));

    // Check if it's a plan
    if (response.toUpperCase().indexOf('PLAN:') >= 0) {
      var planStart = response.toUpperCase().indexOf('PLAN:');
      var planText = response.slice(planStart + 5).trim();

      // Send the intro text before the plan (if any)
      var introText = response.slice(0, planStart).trim();
      if (introText) {
        broadcastChat(introText, true);
      }

      // Store pending plan
      pendingPlan = { task: text, plan: planText };

      // Send plan for approval
      broadcast({ type: 'plan', plan: planText });
    } else {
      // Regular response
      broadcastChat(response, false);
    }
  } catch (err) {
    console.error('[OBA] chat error:', err);
    broadcastChat('Error: ' + err.message, false);
  }
}

// --- Ollama ---
async function queryOllama(messages) {
  var controller = new AbortController();
  var timeout = setTimeout(function() { controller.abort(); }, 180000);
  try {
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: messages,
        stream: false,
        options: { temperature: 0.3, num_predict: 1024 }
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Ollama ' + res.status);
    var data = await res.json();
    return data.message.content;
  } finally {
    clearTimeout(timeout);
  }
}

function parseAction(text) {
  var match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch (e) { return null; }
}

// --- Content script injection ---
async function ensureContentScripts(tabId) {
  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() {
      return {
        tree: typeof window.__generateAccessibilityTree === 'function',
        indicator: typeof window.__ollamaIndicatorReady !== 'undefined'
      };
    }
  });
  var check = results[0].result;
  if (!check.tree) {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['accessibility-tree.js'] });
  }
  if (!check.indicator) {
    await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['visual-indicator.js'] });
  }
}

async function getPageState(tabId) {
  await ensureContentScripts(tabId);
  var results = await chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function() { return window.__generateAccessibilityTree('all', 12, 15000); }
  });
  if (!results || !results[0] || !results[0].result) {
    return { error: 'Failed to read page.', tree: '' };
  }
  return results[0].result;
}

async function waitForTabLoad(tabId, timeoutMs) {
  var deadline = Date.now() + (timeoutMs || 10000);
  while (Date.now() < deadline) {
    try {
      var tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') return true;
    } catch (e) {
      return false;
    }
    await new Promise(function(r) { setTimeout(r, 500); });
  }
  return true; // timeout but continue anyway
}

async function executeAction(tabId, action) {
  if (action.action === 'navigate') {
    try {
      await chrome.tabs.update(tabId, { url: action.url });
    } catch (e) {
      // Tab might be gone, create a new one
      var newTab = await chrome.tabs.create({ url: action.url });
      tabId = newTab.id;
      activeTabId = tabId;
      targetTabId = tabId;
    }
    await waitForTabLoad(tabId, 10000);
    // Re-inject scripts after navigation
    try { await ensureContentScripts(tabId); } catch (e) {}
    return { success: true, message: 'Navigated to ' + action.url, newTabId: tabId };
  }
  if (action.action === 'wait') {
    await new Promise(function(r) { setTimeout(r, action.ms || 1000); });
    return { success: true, message: 'Waited ' + action.ms + 'ms' };
  }
  if (action.action === 'done') {
    return { success: true, done: true, message: action.result };
  }
  if (action.ref_id) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(refId) { window.__ollamaHighlight(refId); },
        args: [action.ref_id]
      });
    } catch (e) {}
  }
  await new Promise(function(r) { setTimeout(r, 200); });
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(act) { return window.__ollamaExecuteAction(act); },
      args: [action]
    });
    var actionResult = results[0].result;
    // After click, wait for potential page navigation
    if (action.action === 'click') {
      await new Promise(function(r) { setTimeout(r, 1000); });
      await waitForTabLoad(tabId, 5000);
      try { await ensureContentScripts(tabId); } catch (e) {}
    }
    return actionResult;
  } catch (e) {
    return { success: false, message: 'Action failed: ' + e.message };
  }
}

async function showIndicator(tabId, show) {
  try {
    var tab = await chrome.tabs.get(tabId);
    if (!isUsableUrl(tab.url)) return;
    await chrome.tabs.sendMessage(tabId, {
      type: show ? 'SHOW_AGENT_ACTIVE' : 'HIDE_AGENT_ACTIVE'
    });
  } catch (e) {}
}

// --- Find target tab ---
async function findTargetTab() {
  if (targetTabId) {
    try {
      var tab = await chrome.tabs.get(targetTabId);
      if (isUsableUrl(tab.url)) return targetTabId;
    } catch (e) {}
    targetTabId = null;
  }
  var allTabs = await chrome.tabs.query({});
  for (var i = 0; i < allTabs.length; i++) {
    if (isUsableUrl(allTabs[i].url)) {
      targetTabId = allTabs[i].id;
      return targetTabId;
    }
  }
  return null;
}

// --- Execute approved plan ---
async function executePlan(task, providedTabId) {
  var tabId = providedTabId || targetTabId;

  // If no usable tab, create one with google.com
  if (!tabId || !knownTabs[tabId]) {
    var ids = Object.keys(knownTabs);
    if (ids.length > 0) {
      tabId = parseInt(ids[ids.length - 1]);
    } else {
      // Create a new tab with google.com
      broadcastStatus('info', { message: 'Opening new tab...' });
      var newTab = await chrome.tabs.create({ url: 'https://www.google.com' });
      tabId = newTab.id;
      targetTabId = tabId;
      // Wait for page to load
      await new Promise(function(r) { setTimeout(r, 2000); });
      // Inject scripts
      try {
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['register-tab.js'] });
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['accessibility-tree.js'] });
        await chrome.scripting.executeScript({ target: { tabId: tabId }, files: ['visual-indicator.js'] });
      } catch (e) {
        console.log('[OBA] inject into new tab error:', e);
      }
      knownTabs[tabId] = { url: 'https://www.google.com', title: 'Google' };
    }
  }
  if (!tabId) {
    broadcastStatus('error', { message: 'No tab found.' });
    broadcastChat('Could not find a browser tab to work with.', false);
    return;
  }

  activeTask = task;
  activeTabId = tabId;
  taskHistory = [];

  broadcastStatus('started', { task: task });

  try {
    await ensureContentScripts(tabId);
  } catch (err) {
    broadcastStatus('error', { message: 'Cannot access page: ' + err.message });
    broadcastChat('Cannot access this page. Try a different tab.', false);
    activeTask = null;
    return;
  }

  await showIndicator(tabId, true);

  var lastActions = []; // For loop detection
  var maxSteps = 100;
  var consecutiveErrors = 0;

  for (var step = 0; step < maxSteps; step++) {
    if (!activeTask) {
      broadcastStatus('stopped');
      await showIndicator(tabId, false);
      return;
    }

    try {
      broadcastStatus('thinking', { step: step + 1 });
      if (step > 0) await new Promise(function(r) { setTimeout(r, 1000); });

      // Verify tab still exists
      try {
        await chrome.tabs.get(tabId);
      } catch (e) {
        // Tab was closed - find or create a new one
        broadcastStatus('info', { message: 'Tab closed, finding another...' });
        var ids = Object.keys(knownTabs);
        if (ids.length > 0) {
          tabId = parseInt(ids[ids.length - 1]);
        } else {
          var newTab = await chrome.tabs.create({ url: 'https://www.google.com' });
          tabId = newTab.id;
          await new Promise(function(r) { setTimeout(r, 2000); });
          await ensureContentScripts(tabId);
          knownTabs[tabId] = { url: 'https://www.google.com', title: 'Google' };
        }
        activeTabId = tabId;
        targetTabId = tabId;
      }

      broadcastStatus('info', { message: 'Reading page...' });
      var pageState = await getPageState(tabId);
      if (pageState.error) {
        broadcastStatus('error', { message: pageState.error, step: step + 1 });
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          broadcastStatus('error', { message: 'Too many errors, stopping.' });
          break;
        }
        continue;
      }
      consecutiveErrors = 0;

      var elemCount = pageState.tree.split('\n').length;
      broadcastStatus('info', { message: elemCount + ' elements. Thinking...' });

      var currentTab = await chrome.tabs.get(tabId);
      var userMsg = 'Page: ' + currentTab.url + '\nTitle: ' + currentTab.title;
      userMsg += '\n\nAccessibility tree:\n' + pageState.tree;
      userMsg += '\n\nTask: ' + task;
      if (taskHistory.length > 0) {
        userMsg += '\n\nSteps done:\n' + taskHistory.map(function(h, i) { return (i + 1) + '. ' + h; }).join('\n');
      }
      userMsg += '\n\nRespond with THINKING: then ACTION: as described in your instructions.';

      var response = await queryOllama([
        { role: 'system', content: AGENT_SYSTEM },
        { role: 'user', content: userMsg }
      ]);

      console.log('[OBA] agent:', response);

      // Extract thinking
      var thinkingMatch = response.match(/THINKING:\s*([\s\S]*?)(?=ACTION:|$)/i);
      if (thinkingMatch) {
        broadcastStatus('info', { message: thinkingMatch[1].trim().slice(0, 200) });
      }

      var action = parseAction(response);
      if (!action) {
        broadcastStatus('error', { message: 'Bad output: ' + response.slice(0, 200), step: step + 1 });
        consecutiveErrors++;
        if (consecutiveErrors >= 3) break;
        continue;
      }

      // Loop detection
      var actionKey = JSON.stringify(action);
      lastActions.push(actionKey);
      if (lastActions.length > 5) lastActions.shift();
      var repeated = lastActions.filter(function(a) { return a === actionKey; }).length;
      if (repeated >= 5) {
        broadcastStatus('error', { message: 'Loop detected - same action repeated 3 times. Stopping.' });
        broadcastChat('I got stuck repeating the same action. Try giving me a more specific instruction.', false);
        break;
      }

      var result = await executeAction(tabId, action);
      // Update tabId if navigation created a new tab
      if (result.newTabId && result.newTabId !== tabId) {
        tabId = result.newTabId;
        activeTabId = tabId;
        targetTabId = tabId;
        knownTabs[tabId] = { url: action.url, title: '' };
      }
      taskHistory.push(action.action + (action.ref_id ? ' [' + action.ref_id + ']' : '') + ': ' + result.message);

      broadcastStatus('step', {
        step: step + 1,
        action: action,
        message: result.message,
        success: result.success
      });

      if (result.done) {
        activeTask = null;
        broadcastStatus('done', { message: result.message, steps: step + 1 });
        broadcastChat('Task completed: ' + result.message, false);
        await showIndicator(tabId, false);
        return;
      }
    } catch (err) {
      console.error('[OBA] step error:', err);
      broadcastStatus('error', { message: err.message });
      activeTask = null;
      await showIndicator(tabId, false);
      broadcastChat('Agent stopped due to error: ' + err.message, false);
      return;
    }
  }

  activeTask = null;
  broadcastStatus('done', { message: 'Max steps reached', steps: 20 });
  broadcastChat('Reached maximum steps (20). The task may be partially complete.', false);
  await showIndicator(tabId, false);
}

// --- Setup ---
// Click on icon -> save tab -> open side panel
chrome.action.onClicked.addListener(function(tab) {
  console.log('[OBA] icon clicked on tab:', tab.id, tab.url);
  // Only set target if it's a real webpage
  if (isUsableUrl(tab.url)) {
    targetTabId = tab.id;
    chrome.storage.local.set({ targetTabId: tab.id });
    broadcast({ type: 'set_target', tabId: tab.id, url: tab.url, title: tab.title });
  }
  chrome.sidePanel.open({ tabId: tab.id }).catch(function(e) {
    console.log('[OBA] sidePanel.open error:', e);
  });
});

chrome.tabs.onActivated.addListener(function(info) {
  // Only update target if this tab is a known webpage
  if (knownTabs[info.tabId]) {
    targetTabId = info.tabId;
    chrome.storage.local.set({ targetTabId: info.tabId });
    broadcast({ type: 'set_target', tabId: info.tabId, url: knownTabs[info.tabId].url, title: knownTabs[info.tabId].title });
  }
});

// Listen for tab registrations from content scripts
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'register_tab' && sender.tab) {
    var tabId = sender.tab.id;
    knownTabs[tabId] = { url: msg.url, title: msg.title };
    targetTabId = tabId; // Most recent page is the target
    console.log('[OBA] tab registered:', tabId, msg.url);
    // Notify sidepanels
    broadcast({ type: 'set_target', tabId: tabId, url: msg.url, title: msg.title });
    chrome.storage.local.set({ targetTabId: tabId });
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(function(tabId) {
  delete knownTabs[tabId];
  if (targetTabId === tabId) targetTabId = null;
});

// On startup, inject register-tab.js into ALL existing tabs
async function registerAllTabs() {
  var tabs = await chrome.tabs.query({});
  console.log('[OBA] injecting into', tabs.length, 'tabs');
  for (var i = 0; i < tabs.length; i++) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabs[i].id },
        files: ['register-tab.js']
      });
      console.log('[OBA] injected into tab', tabs[i].id);
    } catch (e) {
      console.log('[OBA] skip tab', tabs[i].id, e.message);
    }
  }
}
registerAllTabs();

console.log('[OBA] background loaded v3');
