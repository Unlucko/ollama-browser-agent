var chatEl = document.getElementById('chat');
var welcomeEl = document.getElementById('welcome');
var inputEl = document.getElementById('input');
var sendBtn = document.getElementById('sendBtn');
var stopBtn = document.getElementById('stopBtn');
var modelEl = document.getElementById('model');
var dotEl = document.getElementById('dot');
var fileInput = document.getElementById('fileInput');
var attachmentsRow = document.getElementById('attachmentsRow');

var port = null;
var running = false;
var attachedFiles = [];
var chatHistory = [];
var myTabId = null; // THE tab this sidepanel controls

// --- Find and lock to current tab on startup ---
async function findMyTab() {
  var all = await chrome.tabs.query({});
  console.log('[SP] total tabs:', all.length);

  // Log everything for debug
  for (var i = 0; i < all.length; i++) {
    console.log('[SP] tab ' + i + ': id=' + all[i].id + ' url=' + all[i].url + ' title=' + all[i].title + ' status=' + all[i].status);
  }

  // 1. Try by URL
  for (var a = 0; a < all.length; a++) {
    var u = all[a].url || '';
    if (u.startsWith('http://') || u.startsWith('https://')) {
      console.log('[SP] found by URL:', all[a].id);
      return all[a].id;
    }
  }

  // 2. Try by title (if URL is hidden but title suggests a real page)
  for (var b = 0; b < all.length; b++) {
    var title = all[b].title || '';
    if (title && title !== 'Extensions' && title !== 'New Tab' && !title.startsWith('chrome://')) {
      console.log('[SP] found by title:', all[b].id, title);
      return all[b].id;
    }
  }

  // 3. Brute force: try to inject into each tab
  for (var c = 0; c < all.length; c++) {
    try {
      var results = await chrome.scripting.executeScript({
        target: { tabId: all[c].id },
        func: function() { return document.location.href; }
      });
      var href = results[0].result;
      console.log('[SP] inject test tab ' + all[c].id + ': ' + href);
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        return all[c].id;
      }
    } catch (e) {
      console.log('[SP] inject failed tab ' + all[c].id + ':', e.message);
    }
  }

  return null;
}

// --- UI helpers ---
function addMsg(text, cls) {
  if (welcomeEl) welcomeEl.style.display = 'none';
  var el = document.createElement('div');
  el.className = 'msg ' + cls;
  el.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

function addStep(text, cls) {
  if (welcomeEl) welcomeEl.style.display = 'none';
  var el = document.createElement('div');
  el.className = 'step-indicator ' + (cls || '');
  el.textContent = text;
  chatEl.appendChild(el);
  chatEl.scrollTop = chatEl.scrollHeight;
  return el;
}

function addPlan(planText, onApprove, onReject) {
  if (welcomeEl) welcomeEl.style.display = 'none';
  var box = document.createElement('div');
  box.className = 'plan-box';
  var lines = planText.split('\n').filter(function(l) { return l.trim(); });
  var html = '<h3>Proposed Plan</h3><ol>';
  lines.forEach(function(line) {
    var clean = line.replace(/^\d+[\.\)]\s*/, '').replace(/^[-*]\s*/, '');
    if (clean) html += '<li>' + escapeHtml(clean) + '</li>';
  });
  html += '</ol><div class="plan-actions">';
  html += '<button class="approve">Approve & Run</button>';
  html += '<button class="reject">Modify</button></div>';
  box.innerHTML = html;
  chatEl.appendChild(box);
  chatEl.scrollTop = chatEl.scrollHeight;
  box.querySelector('.approve').addEventListener('click', function() {
    box.querySelector('.plan-actions').innerHTML = '<span style="color:#22c55e;font-size:11px">Approved</span>';
    onApprove();
  });
  box.querySelector('.reject').addEventListener('click', function() {
    box.querySelector('.plan-actions').innerHTML = '<span style="color:#999;font-size:11px">Modify your request above</span>';
    setRunning(false);
    onReject();
  });
}

function escapeHtml(text) {
  var div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setRunning(val) {
  running = val;
  sendBtn.style.display = val ? 'none' : '';
  stopBtn.style.display = val ? '' : 'none';
  inputEl.disabled = val;
  dotEl.className = 'dot ' + (val ? 'running' : 'ok');
}

function autoResize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

// --- File handling ---
fileInput.addEventListener('change', function() {
  for (var i = 0; i < fileInput.files.length; i++) {
    handleFile(fileInput.files[i]);
  }
  fileInput.value = '';
});

async function handleFile(file) {
  try {
    var text = await window.extractFileText(file);
    attachedFiles.push({ name: file.name, text: text });
    showAttachments();
  } catch (e) {
    addMsg('Failed to read ' + file.name + ': ' + e.message, 'system');
  }
}

function showAttachments() {
  if (attachedFiles.length === 0) { attachmentsRow.style.display = 'none'; return; }
  attachmentsRow.style.display = 'flex';
  attachmentsRow.innerHTML = '';
  attachedFiles.forEach(function(f, idx) {
    var el = document.createElement('div');
    el.className = 'attachment';
    el.innerHTML = '<span>' + escapeHtml(f.name) + '</span><span class="remove" data-idx="' + idx + '">&times;</span>';
    attachmentsRow.appendChild(el);
  });
  attachmentsRow.querySelectorAll('.remove').forEach(function(btn) {
    btn.addEventListener('click', function() {
      attachedFiles.splice(parseInt(this.dataset.idx), 1);
      showAttachments();
    });
  });
}

// --- Port ---
function connectPort() {
  port = chrome.runtime.connect({ name: 'sidepanel' });
  // Immediately send the tab we're working with
  if (myTabId) {
    port.postMessage({ type: 'set_tab', tabId: myTabId });
  }
  port.onMessage.addListener(function(msg) {
    if (msg.type === 'agent_status') handleAgentStatus(msg);
    if (msg.type === 'chat_response') handleChatResponse(msg);
    if (msg.type === 'plan') handlePlanResponse(msg);
    if (msg.type === 'set_target') {
      myTabId = msg.tabId;
      console.log('[SP] target set via port:', msg.tabId, msg.url);
      addStep('Connected to: ' + (msg.title || msg.url), '');
    }
  });
  port.onDisconnect.addListener(function() {
    setTimeout(connectPort, 1000);
  });
}

function handleAgentStatus(msg) {
  switch (msg.status) {
    case 'thinking': addStep('Step ' + msg.step + ': thinking...', 'thinking'); break;
    case 'info': addStep(msg.message, ''); break;
    case 'step':
      if (msg.action) {
        addStep(msg.action.action + ' ' + (msg.action.ref_id || msg.action.url || ''), 'action');
      }
      if (msg.message) addStep('  -> ' + msg.message, '');
      break;
    case 'done':
      addStep('Done: ' + msg.message + ' (' + msg.steps + ' steps)', 'done');
      setRunning(false);
      break;
    case 'stopped': setRunning(false); break;
    case 'error':
      addStep('Error: ' + msg.message, 'error');
      if (!msg.step) setRunning(false);
      break;
    case 'started': addStep('Agent started...', ''); break;
  }
}

function handleChatResponse(msg) {
  addMsg(msg.text, 'assistant');
  chatHistory.push({ role: 'assistant', content: msg.text });
  if (!msg.agentRunning) setRunning(false);
}

function handlePlanResponse(msg) {
  addPlan(msg.plan, function() {
    port.postMessage({ type: 'approve_plan', tabId: myTabId });
  }, function() {});
}

// --- Send ---
function sendMessage() {
  var text = inputEl.value.trim();
  if (!text && attachedFiles.length === 0) return;
  // myTabId can be null - background will create a tab if needed
  var fullMsg = text;
  if (attachedFiles.length > 0) {
    attachedFiles.forEach(function(f) {
      fullMsg += '\n\n[File: ' + f.name + ']\n' + f.text.slice(0, 8000);
      if (f.text.length > 8000) fullMsg += '\n... (truncated)';
    });
    attachedFiles = [];
    showAttachments();
  }
  addMsg(text || '(file attached)', 'user');
  chatHistory.push({ role: 'user', content: fullMsg });
  inputEl.value = '';
  autoResize();
  setRunning(true);
  port.postMessage({
    type: 'chat_message',
    text: fullMsg,
    history: chatHistory,
    tabId: myTabId
  });
}

sendBtn.addEventListener('click', sendMessage);
stopBtn.addEventListener('click', function() {
  port.postMessage({ type: 'stop_task' });
  setRunning(false);
  addStep('Stopped', 'error');
});
inputEl.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey && !running) { e.preventDefault(); sendMessage(); }
});
inputEl.addEventListener('input', autoResize);

document.querySelectorAll('.tip').forEach(function(el) {
  el.addEventListener('click', function() {
    inputEl.value = this.dataset.msg;
    inputEl.focus();
    autoResize();
  });
});

modelEl.addEventListener('change', function() {
  if (port) port.postMessage({ type: 'set_model', model: modelEl.value });
});

// --- Init ---
async function init() {
  // 1. Check Ollama
  try {
    var res = await fetch('http://localhost:11434/api/tags');
    var data = await res.json();
    var models = data.models.map(function(m) { return m.name; });
    dotEl.className = 'dot ok';
    modelEl.innerHTML = '';
    models.forEach(function(m) {
      var opt = document.createElement('option');
      opt.value = m; opt.textContent = m;
      modelEl.appendChild(opt);
    });
    var preferred = models.find(function(m) { return m.indexOf('qwen') >= 0; }) ||
                    models.find(function(m) { return m.indexOf('llama') >= 0; }) ||
                    models[0];
    if (preferred) modelEl.value = preferred;
  } catch (e) {
    dotEl.className = 'dot';
    addMsg('Ollama not running at localhost:11434', 'system');
    return;
  }

  // 2. Get the tab from storage (set by background when icon was clicked)
  try {
    var stored = await chrome.storage.local.get('targetTabId');
    console.log('[SP] stored targetTabId:', stored.targetTabId);
    if (stored.targetTabId) {
      myTabId = stored.targetTabId;
    }
  } catch (e) {
    console.log('[SP] storage error:', e);
  }

  // 3. Fallback: brute force
  if (!myTabId) {
    myTabId = await findMyTab();
  }

  console.log('[SP] final myTabId:', myTabId);
  if (myTabId) {
    document.getElementById('connectBtn').style.display = 'none';
    document.getElementById('connectedMsg').style.display = 'block';
    document.getElementById('connectedMsg').textContent = 'Connected!';
  }

  // Connect button - manually grabs the tab
  document.getElementById('connectBtn').addEventListener('click', async function() {
    var btn = this;
    btn.textContent = 'Connecting...';
    btn.disabled = true;

    // Ask background to inject into all tabs and find one
    port.postMessage({ type: 'find_tab' });

    // Also try from sidepanel directly
    try {
      var tabs = await chrome.tabs.query({});
      for (var i = 0; i < tabs.length; i++) {
        try {
          var results = await chrome.scripting.executeScript({
            target: { tabId: tabs[i].id },
            func: function() { return { href: document.location.href, title: document.title }; }
          });
          var info = results[0].result;
          if (info.href && info.href.startsWith('http')) {
            myTabId = tabs[i].id;
            console.log('[SP] connected to:', myTabId, info.href);
            btn.style.display = 'none';
            document.getElementById('connectedMsg').style.display = 'block';
            document.getElementById('connectedMsg').textContent = 'Connected to: ' + info.title;
            port.postMessage({ type: 'set_tab', tabId: myTabId });
            return;
          }
        } catch (e) {
          // Skip non-injectable tabs
        }
      }
      btn.textContent = 'No webpage found - open one and retry';
      btn.disabled = false;
    } catch (e) {
      btn.textContent = 'Error: ' + e.message + ' - retry';
      btn.disabled = false;
    }
  });

  // 3. Connect to background
  connectPort();
}

init();
