const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Scarlet Technical is starting up...', env: process.env.NODE_ENV });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

app.listen(PORT, () => {
  console.log(`Minimal test server running on port ${PORT}`);
});
