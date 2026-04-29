try {
  require('./server.js');
} catch (err) {
  console.error('CRASH:', err.message);
  console.error('STACK:', err.stack);
  const express = require('express');
  const app = express();
  app.get('*', (req, res) => res.status(500).json({ 
    error: err.message, 
    stack: err.stack?.split('\n').slice(0, 8)
  }));
  app.listen(process.env.PORT || 10000, () => console.log('Error server up'));
}
