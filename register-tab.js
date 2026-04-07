// Register this tab with the background - runs once on page load
chrome.runtime.sendMessage({
  type: 'register_tab',
  url: window.location.href,
  title: document.title
});
