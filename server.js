// Wrapper to catch and log startup errors
try {
  require('./_server.js');
} catch (err) {
  console.error('=== STARTUP CRASH ===');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('=====================');
  
  // Start a minimal server so Render doesn't restart loop
  const express = require('express');
  const app = express();
  const PORT = process.env.PORT || 10000;
  app.get('*', (req, res) => {
    res.status(500).json({ 
      error: 'Server failed to start', 
      message: err.message,
      stack: err.stack?.split('\n').slice(0, 5)
    });
  });
  app.listen(PORT, () => {
    console.log(`Error server on port ${PORT} — check /health for details`);
  });
}
