const $ = id => document.getElementById(id);
const log = $('log');
const task = $('task');
const run = $('run');
const stop = $('stop');
const model = $('model');
const dot = $('dot');
const status = $('status');
const steps = $('steps');
const modelTag = $('modelTag');
let running = false;

function addLog(text, cls) {
  const el = document.createElement('div');
  el.className = `entry ${cls}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function setRunning(val) {
  running = val;
  run.style.display = val ? 'none' : '';
  stop.style.display = val ? '' : 'none';
  task.disabled = val;
  model.disabled = val;
  dot.className = `dot ${val ? 'running' : 'ok'}`;
}

// Init
chrome.runtime.sendMessage({ type: 'check_ollama' }, res => {
  if (!res?.ok) {
    status.textContent = 'Ollama not running (localhost:11434)';
    return;
  }
  dot.className = 'dot ok';
  status.textContent = `${res.models.length} model(s)`;
  model.innerHTML = '';
  res.models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m; opt.textContent = m;
    model.appendChild(opt);
  });
  run.disabled = false;

  chrome.runtime.sendMessage({ type: 'get_state' }, state => {
    if (state?.model) model.value = state.model;
    modelTag.textContent = model.value;
  });
});

model.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'set_model', model: model.value });
  modelTag.textContent = model.value;
});

run.addEventListener('click', () => {
  const t = task.value.trim();
  if (!t) return;
  log.innerHTML = '';
  steps.textContent = '';
  setRunning(true);
  chrome.runtime.sendMessage({ type: 'set_model', model: model.value });
  chrome.runtime.sendMessage({ type: 'run_task', task: t });
  addLog(`Task: ${t}`, 'info');
});

stop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'stop_task' });
  setRunning(false);
  addLog('Stopped', 'error');
});

task.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !running && !run.disabled) run.click();
});

// Status updates
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type !== 'agent_status') return;
  switch (msg.status) {
    case 'thinking':
      addLog(`Step ${msg.step}: thinking...`, 'thinking');
      steps.textContent = `Step ${msg.step}`;
      break;
    case 'step':
      if (msg.action) {
        const detail = msg.action.ref_id || msg.action.url || '';
        addLog(`${msg.action.action} ${detail}`, 'step');
      }
      if (msg.message) addLog(`  -> ${msg.message}`, 'info');
      break;
    case 'done':
      addLog(`Done: ${msg.message} (${msg.steps} steps)`, 'done');
      steps.textContent = `${msg.steps} steps`;
      setRunning(false);
      break;
    case 'stopped':
      setRunning(false);
      break;
    case 'error':
      addLog(`Error: ${msg.message}`, 'error');
      if (!msg.step) setRunning(false);
      break;
  }
});
