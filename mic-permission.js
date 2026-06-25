document.getElementById('allowBtn').addEventListener('click', function() {
  var status = document.getElementById('status');
  status.textContent = 'Requesting permission... (check for browser popup)';
  status.style.color = '#aaa';
  
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(function(stream) {
      // Release the mic immediately - we only needed the permission
      stream.getTracks().forEach(function(t) { t.stop(); });
      
      status.textContent = 'Permission granted! Closing tab...';
      status.style.color = '#22c55e';
      
      setTimeout(function() {
        window.close();
      }, 1500);
    })
    .catch(function(err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        status.textContent = 'Permission denied. Please click the 🔒 icon in the URL bar and allow Microphone access.';
      } else {
        status.textContent = 'Error: ' + err.message;
      }
      status.style.color = '#ef4444';
    });
});
