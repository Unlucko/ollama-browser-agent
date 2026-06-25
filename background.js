var OLLAMA_URL = 'http://localhost:11434';
var DEFAULT_MODEL = 'qwen2.5:7b';

var CHAT_SYSTEM = 'You are an AI browser agent. You control a web browser.\n\nWhen the user asks you to do something on the web, respond with a plan starting with "PLAN:".\n\nBe SPECIFIC. Use real URLs. Never say "search for the website" - navigate directly.\n\nExample - user says "find jobs on linkedin":\nPLAN:\n1. Navigate to https://www.linkedin.com/jobs\n2. Click the search box\n3. Type the job search query\n4. Click search button\n5. Browse and click on interesting results\n\nExample - user says "search for cats on google":\nPLAN:\n1. Navigate to https://www.google.com\n2. Click the search box\n3. Type "cats"\n4. Click Google Search button\n\nIf the user asks a question (not a web task), answer briefly.\nIf the user shares a file, summarize it.\nKeep responses under 80 words.';

var AGENT_SYSTEM = 'You are a smart browser automation agent. You see the current page and must decide what to do next.\n\nYou MUST respond in this exact format:\n\nTHINKING: (analyze the current page, what you see, what the task needs, and what step to take next)\nACTION: (the JSON action)\n\nAvailable actions:\n{"action": "click", "ref_id": "ref_X"}\n{"action": "type", "ref_id": "ref_X", "text": "..."}\n{"action": "clear_and_type", "ref_id": "ref_X", "text": "..."}\n{"action": "type_and_enter", "ref_id": "ref_X", "text": "..."} - Type text and press Enter (best for search boxes)\n{"action": "press_enter", "ref_id": "ref_X"}\n{"action": "select", "ref_id": "ref_X", "value": "..."} - Select an option in a dropdown\n{"action": "hover", "ref_id": "ref_X"}\n{"action": "extract", "ref_id": "ref_X"} - Extract text from an element\n{"action": "navigate", "url": "https://full-url-here"}\n{"action": "scroll", "direction": "down|up"}\n{"action": "wait", "ms": 2000} - Wait for page loads\n{"action": "ask_user", "question": "..."} - Ask the user a question if you are stuck (e.g. need a password, captcha, or clarification)\n{"action": "done", "result": "summary of what was accomplished"}\n\nRULES:\n1. THINK before acting. Analyze what you see on the page.\n2. Break complex tasks into small steps. For "apply to jobs on linkedin": first navigate to linkedin.com/jobs, then search for a role, then click a job posting, then find and click the Apply/Solicitud button.\n3. Navigate DIRECTLY to websites. Never search for a website on Google.\n4. For search boxes, use "type_and_enter" to type and submit in one step.\n5. Check your previous steps. NEVER repeat the same action. If something did not work, try a different approach.\n6. Look for buttons with text like "Apply", "Solicitud", "Submit", "Aplicar" and click them.\n7. If you are stuck or need human help, use "ask_user".\n\nExample:\nTHINKING: I need to search for AI jobs. I see a search box [ref_5]. I will type my query and press Enter.\nACTION: {"action": "type_and_enter", "ref_id": "ref_5", "text": "AI Engineer remote"}';

var AGENT_SYSTEM_NO_THINK = 'You are a smart browser automation agent. You see the current page and must decide what to do next.\n\nYou MUST respond in this exact format:\n\nACTION: (the JSON action)\n\nAvailable actions:\n{"action": "click", "ref_id": "ref_X"}\n{"action": "type", "ref_id": "ref_X", "text": "..."}\n{"action": "clear_and_type", "ref_id": "ref_X", "text": "..."}\n{"action": "type_and_enter", "ref_id": "ref_X", "text": "..."} - Type text and press Enter (best for search boxes)\n{"action": "press_enter", "ref_id": "ref_X"}\n{"action": "select", "ref_id": "ref_X", "value": "..."} - Select an option in a dropdown\n{"action": "hover", "ref_id": "ref_X"}\n{"action": "extract", "ref_id": "ref_X"} - Extract text from an element\n{"action": "navigate", "url": "https://full-url-here"}\n{"action": "scroll", "direction": "down|up"}\n{"action": "wait", "ms": 2000} - Wait for page loads\n{"action": "ask_user", "question": "..."} - Ask the user a question if you are stuck (e.g. need a password, captcha, or clarification)\n{"action": "done", "result": "summary of what was accomplished"}\n\nRULES:\n1. Respond with ACTION: followed by the action JSON immediately. No thinking, no reasoning, no explanations, no text before or after ACTION:.\n2. Break complex tasks into small steps. For "apply to jobs on linkedin": first navigate to linkedin.com/jobs, then search for a role, then click a job posting, then find and click the Apply/Solicitud button.\n3. Navigate DIRECTLY to websites. Never search for a website on Google.\n4. For search boxes, use "type_and_enter" to type and submit in one step.\n5. Check your previous steps. NEVER repeat the same action. If something did not work, try a different approach.\n6. Look for buttons with text like "Apply", "Solicitud", "Submit", "Aplicar" and click them.\n7. If you are stuck or need human help, use "ask_user".\n\nExample:\nACTION: {"action": "type_and_enter", "ref_id": "ref_5", "text": "AI Engineer remote"}';

// --- Qwen3 thinking mode switching ---
// For Qwen3 models running in Ollama/llama.cpp, thinking mode is toggled via
// soft-switch tokens appended to the user message:
//   /think    -> model uses <think>...</think> chain-of-thought before answering
//   /no_think -> model skips thinking, answers directly (empty <think></think> block)
// Recommended sampling parameters (per https://huggingface.co/unsloth/Qwen3-4B-GGUF):
//   Thinking mode:    Temperature=0.6, TopP=0.95, TopK=20, MinP=0
//   Non-thinking mode: Temperature=0.7, TopP=0.8,  TopK=20, MinP=0

var activeTask = null;
var taskHistory = [];
var currentModel = DEFAULT_MODEL;
var activeTabId = null;
var targetTabId = null;
var ports = [];
var pendingPlan = null;
var pendingAskUserResolve = null;
var ollamaAbortController = null;
var chatBusy = false; // guard against concurrent chat calls
var knownTabs = {}; // { tabId: { url, title } } - registered by content scripts

chrome.storage.local.get(['model', 'knownTabs', 'targetTabId'], function(data) {
  if (data.model) currentModel = data.model;
  if (data.knownTabs) knownTabs = data.knownTabs;
  if (data.targetTabId) targetTabId = data.targetTabId;
  registerAllTabs();
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

function stopTask() {
  activeTask = null;
  if (ollamaAbortController) {
    try { ollamaAbortController.abort(); } catch (e) {}
  }
  if (pendingAskUserResolve) {
    var resolve = pendingAskUserResolve;
    pendingAskUserResolve = null;
    resolve({ success: false, message: 'Task stopped by user', done: false });
  }
  if (activeTabId) {
    showIndicator(activeTabId, false);
  }
  chatBusy = false;
  broadcastStatus('stopped');
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
    stopTask();
  }
  if (msg.type === 'set_model') {
    currentModel = msg.model;
    chrome.storage.local.set({ model: msg.model });
  }
}

async function handleChatMessage(msg) {
  if (pendingAskUserResolve) {
    var resolve = pendingAskUserResolve;
    pendingAskUserResolve = null;
    broadcastChat(msg.text, true);
    resolve({ success: true, message: 'User replied: ' + msg.text });
    return;
  }

  if (chatBusy) {
    broadcastChat('Still processing previous message, please wait…', false);
    return;
  }
  chatBusy = true;

  var text = msg.text;
  var history = msg.history || [];

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
    var recent = history.slice(-10);
    for (var i = 0; i < recent.length; i++) {
      messages.push({ role: recent[i].role, content: recent[i].content });
    }

    // --- Streaming chat: show response word-by-word ---
    var streamAccum = '';
    var streamVisible = '';
    var chatStreamCallback = function(chunk, fullText) {
      streamAccum = fullText;
      // Strip <think>...</think> blocks in real-time for display
      var visible = streamAccum.replace(/<think>[\s\S]*?<\/think>/gi, '');
      // Hide currently-open (incomplete) <think> block
      var openIdx = visible.indexOf('<think>');
      if (openIdx >= 0) visible = visible.slice(0, openIdx);
      visible = visible.trim();
      if (visible !== streamVisible) {
        streamVisible = visible;
        // Only stream if there's non-think content to show
        if (visible && visible.toUpperCase().indexOf('PLAN:') < 0) {
          broadcast({ type: 'chat_stream', text: visible });
        }
      }
    };

    var response = await queryOllama(messages, { num_predict: 1024 }, chatStreamCallback);
    console.log('[OBA] chat response:', response.slice(0, 200));

    response = response.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    if (response.toUpperCase().indexOf('PLAN:') >= 0) {
      var planStart = response.toUpperCase().indexOf('PLAN:');
      var planText = response.slice(planStart + 5).trim();
      var introText = response.slice(0, planStart).trim();

      // Signal sidepanel to clear the streaming bubble (plan takes over)
      broadcast({ type: 'chat_stream_cancel' });

      if (introText) broadcastChat(introText, true);
      if (pendingPlan) broadcastChat('Previous plan cancelled — new plan ready.', true);
      pendingPlan = { task: text, plan: planText };
      broadcast({ type: 'plan', plan: planText });
    } else {
      // Finalize the streamed bubble
      broadcast({ type: 'chat_stream_done', text: response });
    }
  } catch (err) {
    console.error('[OBA] chat error:', err);
    broadcast({ type: 'chat_stream_cancel' });
    broadcastChat('Error: ' + err.message, false);
  } finally {
    chatBusy = false;
  }
}

async function queryOllama(messages, options, onChunk) {
  if (ollamaAbortController) ollamaAbortController.abort();
  ollamaAbortController = new AbortController();
  var controller = ollamaAbortController;
  var timeout = setTimeout(function() { controller.abort(); }, 180000);
  var bodyOptions = { temperature: 0.3, num_predict: 1024 };
  if (options) {
    Object.assign(bodyOptions, options);
  }
  try {
    var res = await fetch(OLLAMA_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: currentModel,
        messages: messages,
        stream: !!onChunk,
        options: bodyOptions
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error('Ollama ' + res.status);
    
    let reader = null;
    if (onChunk) {
      reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            try {
              const data = JSON.parse(buffer);
              if (data.message && data.message.content) {
                fullText += data.message.content;
                onChunk(data.message.content, fullText);
              }
            } catch (e) {}
          }
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.trim()) {
            try {
              const data = JSON.parse(line);
              if (data.message && data.message.content) {
                fullText += data.message.content;
                onChunk(data.message.content, fullText);
              }
            } catch (e) {}
          }
        }
      }
      return fullText;
    } else {
      var data = await res.json();
      return data.message.content;
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      console.log('[OBA] query aborted');
      // Cancel the reader to release the underlying TCP connection
      if (reader) { try { reader.cancel(); } catch (ce) {} }
      return '';
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    if (ollamaAbortController === controller) {
      ollamaAbortController = null;
    }
  }
}

function parseAction(text) {
  // Strip native thinking tags to avoid matching JSON examples inside reasoning blocks
  var cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // Use greedy match to capture the largest valid JSON object
  var match = cleanText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  // Try to parse; if it fails, try trimming from last }
  try { return JSON.parse(match[0]); } catch (e) {
    // Walk backwards to find the last valid JSON object
    var str = match[0];
    for (var end = str.length - 1; end > 0; end--) {
      if (str[end] === '}') {
        try { return JSON.parse(str.slice(0, end + 1)); } catch (e2) {}
      }
    }
    return null;
  }
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

async function getPageState(tabId, fastMode) {
  await ensureContentScripts(tabId);
  // Wait for dynamic content to render (LinkedIn, SPAs, etc)
  // Fast mode: shorter wait; normal mode: slightly longer for heavy SPAs
  await new Promise(function(r) { setTimeout(r, fastMode ? 150 : 300); });

  // Smaller char limits = fewer input tokens = faster model inference
  var charLimit = fastMode ? 8000 : 12000;

  var attempts = fastMode ? [
    { filter: 'interactive', depth: 8 },
    { filter: 'interactive', depth: 5 }
  ] : [
    { filter: 'all', depth: 10 },
    { filter: 'all', depth: 7 },
    { filter: 'interactive', depth: 8 },
    { filter: 'interactive', depth: 5 }
  ];

  for (var i = 0; i < attempts.length; i++) {
    var attempt = attempts[i];
    try {
      var results = await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: function(f, d, limit) { return window.__generateAccessibilityTree(f, d, limit); },
        args: [attempt.filter, attempt.depth, charLimit]
      });
      if (results && results[0] && results[0].result) {
        var res = results[0].result;
        if (!res.error) {
          return res;
        }
        console.log('[OBA] getPageState attempt ' + i + ' (filter=' + attempt.filter + ', depth=' + attempt.depth + ') exceeded limit: ' + res.error);
      }
    } catch (e) {
      console.log('[OBA] getPageState attempt ' + i + ' error:', e);
    }
  }

  // Final fallback: interactive only, depth 4, no character limit so we get something
  try {
    var finalResults = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function() { return window.__generateAccessibilityTree('interactive', 4, 0); }
    });
    if (finalResults && finalResults[0] && finalResults[0].result) {
      var finalRes = finalResults[0].result;
      if (!finalRes.error) {
        return finalRes;
      }
    }
  } catch (e) {
    console.log('[OBA] getPageState fallback error:', e);
  }

  return { error: 'Failed to read page. DOM is too large.', tree: '' };
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
    await new Promise(function(r) { setTimeout(r, 300); });
    if (!activeTask) return false;
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
    // Update knownTabs with the actual post-load URL and title (BUG 8 fix)
    try {
      var loadedTab = await chrome.tabs.get(tabId);
      var actualUrl = loadedTab.url || action.url;
      var actualTitle = loadedTab.title || '';
      knownTabs[tabId] = { url: actualUrl, title: actualTitle };
      chrome.storage.local.set({ knownTabs: knownTabs });
      broadcast({ type: 'set_target', tabId: tabId, url: actualUrl, title: actualTitle });
    } catch (e) {}
    return { success: true, message: 'Navigated to ' + action.url, newTabId: tabId };
  }
  if (action.action === 'wait') {
    await new Promise(function(r) { setTimeout(r, action.ms || 1000); });
    return { success: true, message: 'Waited ' + action.ms + 'ms' };
  }
  if (action.action === 'ask_user') {
    broadcastStatus('ask_user', { question: action.question || 'Please provide input.' });
    return new Promise(function(resolve) {
      pendingAskUserResolve = resolve;
    });
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
  await new Promise(function(r) { setTimeout(r, 50); });
  try {
    var results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: function(act) { return window.__ollamaExecuteAction(act); },
      args: [action]
    });
    var actionResult = results[0].result;
    // After click, wait for potential page navigation
    if (action.action === 'click') {
      await new Promise(function(r) { setTimeout(r, 400); });
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
      chrome.storage.local.set({ knownTabs: knownTabs });
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

  // Smart pre-navigation: if the task mentions a known site, go there first
  var taskLower = task.toLowerCase();
  var siteMap = {
    'linkedin': 'https://www.linkedin.com',
    'github': 'https://www.github.com',
    'youtube': 'https://www.youtube.com',
    'twitter': 'https://www.twitter.com',
    'amazon': 'https://www.amazon.com',
    'google': 'https://www.google.com',
    'facebook': 'https://www.facebook.com',
    'instagram': 'https://www.instagram.com',
    'reddit': 'https://www.reddit.com',
    'indeed': 'https://www.indeed.com',
    'glassdoor': 'https://www.glassdoor.com'
  };
  var currentUrl = '';
  try { var ct = await chrome.tabs.get(tabId); currentUrl = ct.url || ''; } catch (e) {}
  for (var siteName in siteMap) {
    if (taskLower.indexOf(siteName) >= 0 && currentUrl.indexOf(siteName) < 0) {
      var targetUrl = siteMap[siteName];
      // Add /jobs for linkedin job tasks
      if (siteName === 'linkedin' && (taskLower.indexOf('job') >= 0 || taskLower.indexOf('trabajo') >= 0 || taskLower.indexOf('empleo') >= 0 || taskLower.indexOf('aplic') >= 0)) {
        targetUrl = 'https://www.linkedin.com/jobs';
      }
      broadcastStatus('info', { message: 'Navigating to ' + targetUrl + '...' });
      try {
        await chrome.tabs.update(tabId, { url: targetUrl });
        await waitForTabLoad(tabId, 10000);
        await ensureContentScripts(tabId);
        taskHistory.push('navigate: Went to ' + targetUrl);
      } catch (e) {
        console.log('[OBA] pre-nav error:', e);
      }
      break;
    }
  }

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
      return;
    }

    try {
      var storedThinking = await chrome.storage.local.get(['thinkingMode', 'fastMode']);
      var thinkingMode = storedThinking.thinkingMode !== false;
      var settingsData = storedThinking;

      broadcastStatus('thinking', { step: step + 1, mode: thinkingMode ? 'thinking' : 'deciding' });
      if (step > 0) await new Promise(function(r) { setTimeout(r, 200); });

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

      if (!activeTask) return;

      // Re-inject content scripts and show indicator (in case page navigated/reloaded)
      try {
        await ensureContentScripts(tabId);
        await showIndicator(tabId, true);
      } catch (e) {
        console.log('[OBA] indicator show error:', e);
      }

      // Default fastMode to true if not yet stored (fresh install)
      var fastMode = storedThinking.fastMode !== false;
      broadcastStatus('info', { message: 'Reading page...' });
      var pageState = await getPageState(tabId, fastMode);
      
      if (!activeTask) return;

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
      broadcastStatus('info', { message: elemCount + ' elements found.' });

      var currentTab = await chrome.tabs.get(tabId);
      var userMsg = 'Page: ' + currentTab.url + '\nTitle: ' + currentTab.title;
      userMsg += '\n\nAccessibility tree:\n' + pageState.tree;
      userMsg += '\n\nTask: ' + task;
      if (taskHistory.length > 0) {
        userMsg += '\n\nSteps done:\n' + taskHistory.map(function(h, i) { return (i + 1) + '. ' + h; }).join('\n');
      }
      
      // Qwen3 soft-switch: append /think or /no_think to the user message.
      // This is the official Ollama/llama.cpp mechanism for Qwen3 models.
      // For non-Qwen3 models we fall back to separate system prompts.
      // Qwen3 best-practice temperatures:
      //   thinking mode  -> temp=0.6, top_p=0.95, top_k=20
      //   no-think mode  -> temp=0.7, top_p=0.8,  top_k=20
      var isQwen3 = currentModel.toLowerCase().indexOf('qwen3') >= 0;
      var thinkSuffix = thinkingMode ? ' /think' : ' /no_think';

      var agentOptions = thinkingMode
        ? { num_predict: 1024, temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 }
        : { num_predict: 512,  temperature: 0.7, top_p: 0.8,  top_k: 20, min_p: 0 };

      var finalUserMsg = isQwen3 ? userMsg + thinkSuffix : userMsg;

      if (!isQwen3) {
        // Legacy system-prompt mode for non-Qwen3 models
        if (thinkingMode) {
          finalUserMsg += '\n\nRespond with THINKING: then ACTION: as described in your instructions.';
        } else {
          finalUserMsg += '\n\nRespond with ACTION: as described in your instructions. Do NOT include any THINKING block or reasoning.';
        }
      }

      var systemPrompt = thinkingMode ? AGENT_SYSTEM : AGENT_SYSTEM_NO_THINK;
      var onChunkCallback = null;
      if (thinkingMode) {
        onChunkCallback = function(chunk, fullText) {
          var thinkStream = '';
          var thinkTagMatch = fullText.match(/<think>([\s\S]*?)(?:<\/think>|$)/i);
          if (thinkTagMatch) {
            thinkStream = thinkTagMatch[1];
          } else {
            var thinkingMatch = fullText.match(/THINKING:\s*([\s\S]*?)(?=ACTION:|$)/i);
            if (thinkingMatch) {
              thinkStream = thinkingMatch[1];
            } else {
              thinkStream = fullText;
            }
          }
          if (thinkStream.trim()) {
            broadcastStatus('think_update', { text: thinkStream.replace(/<[^>]*>/g, '').trim() });
          }
        };
      }

      var response = await queryOllama([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: finalUserMsg }
      ], agentOptions, onChunkCallback);

      if (!activeTask) return;

      console.log('[OBA] agent:', response);

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
      if (repeated >= 3) {
        broadcastStatus('error', { message: 'Loop detected — same action repeated 3 times. Stopping.' });
        broadcastChat('I got stuck repeating the same action. Try giving me a more specific instruction.', false);
        break;
      }

      var result = await executeAction(tabId, action);
      
      if (!activeTask) return;

      // Update tabId if navigation created a new tab
      if (result.newTabId && result.newTabId !== tabId) {
        tabId = result.newTabId;
        activeTabId = tabId;
        targetTabId = tabId;
        knownTabs[tabId] = { url: action.url, title: '' };
        chrome.storage.local.set({ knownTabs: knownTabs });
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
        // Browser notification so user knows even if they tabbed away
        try {
          chrome.notifications.create('task-done-' + Date.now(), {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Task Completed ✅',
            message: result.message || 'Your task finished successfully.',
            priority: 1
          });
        } catch (e) {}
        return;
      }
    } catch (err) {
      if (!activeTask) return;
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
  broadcastChat('Reached maximum steps (' + maxSteps + '). The task may be partially complete.', false);
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

// Listen for tab registrations and runtime messages from popup/UI
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'register_tab' && sender.tab) {
    var tabId = sender.tab.id;
    knownTabs[tabId] = { url: msg.url, title: msg.title };
    targetTabId = tabId; // Most recent page is the target
    console.log('[OBA] tab registered:', tabId, msg.url);
    // Notify sidepanels
    broadcast({ type: 'set_target', tabId: tabId, url: msg.url, title: msg.title });
    chrome.storage.local.set({ targetTabId: tabId, knownTabs: knownTabs });
  } else if (msg.type === 'check_ollama') {
    fetch(OLLAMA_URL + '/api/tags')
      .then(function(res) { return res.json(); })
      .then(function(data) {
        var models = data.models.map(function(m) { return m.name; });
        sendResponse({ ok: true, models: models });
      })
      .catch(function(err) {
        sendResponse({ ok: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  } else if (msg.type === 'get_state') {
    sendResponse({ model: currentModel });
  } else if (msg.type === 'set_model') {
    currentModel = msg.model;
    chrome.storage.local.set({ model: msg.model });
    sendResponse({ ok: true });
  } else if (msg.type === 'run_task') {
    executePlan(msg.task);
    sendResponse({ ok: true });
  } else if (msg.type === 'stop_task') {
    stopTask();
    sendResponse({ ok: true });
  }
});

// Clean up when tabs close
chrome.tabs.onRemoved.addListener(function(tabId) {
  delete knownTabs[tabId];
  if (targetTabId === tabId) targetTabId = null;
  chrome.storage.local.set({ knownTabs: knownTabs, targetTabId: targetTabId });
});

// On startup, inject register-tab.js into ALL existing tabs
async function registerAllTabs() {
  try {
    var tabs = await chrome.tabs.query({});
    var tabIds = new Set(tabs.map(function(t) { return t.id; }));

    // Clean up stale tabs in knownTabs
    var changed = false;
    for (var idStr in knownTabs) {
      var id = parseInt(idStr);
      if (!tabIds.has(id)) {
        delete knownTabs[id];
        changed = true;
      }
    }
    if (changed) {
      chrome.storage.local.set({ knownTabs: knownTabs });
    }

    console.log('[OBA] checking injection status for', tabs.length, 'tabs');
    for (var i = 0; i < tabs.length; i++) {
      var tab = tabs[i];
      if (isUsableUrl(tab.url) && !knownTabs[tab.id]) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['register-tab.js']
          });
          console.log('[OBA] injected register-tab.js into tab', tab.id);
        } catch (e) {
          console.log('[OBA] skip tab', tab.id, e.message);
        }
      }
    }
  } catch (err) {
    console.error('[OBA] registerAllTabs error:', err);
  }
}

console.log('[OBA] background loaded v3');
