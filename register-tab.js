// This content script runs on every http/https page
// It registers itself with the background so the sidepanel knows which tabs are available
chrome.runtime.sendMessage({
  type: 'register_tab',
  url: window.location.href,
  title: document.title
});

// Re-register on navigation
window.addEventListener('focus', function() {
  chrome.runtime.sendMessage({
    type: 'register_tab',
    url: window.location.href,
    title: document.title
  });
});
