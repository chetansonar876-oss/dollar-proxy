require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');

const app = express();

// Read sensitive settings from environment variables
const TARGET_HOST = process.env.BROADCAST_HOST || 'http://bcast.suswanibullion.com';
const TARGET_PORT = process.env.BROADCAST_PORT || '7767';
const TEMPLATE_ID = process.env.TEMPLATE_ID || 'suswani';

const TARGET_URL = `${TARGET_HOST}:${TARGET_PORT}/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/${TEMPLATE_ID}`;

// ----------------------------------------------
// 1. PROXY MIDDLEWARE (main proxy)
// ----------------------------------------------
app.use(
  '/api/broadcast',
  createProxyMiddleware({
    target: TARGET_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/broadcast': '' },
    // Increase timeouts to avoid premature ETIMEDOUT
    proxyTimeout: 30000,  // 30 seconds for the whole proxy
    timeout: 30000,       // 30 seconds for the socket
    onError: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).send('Broadcast server unreachable');
    }
  })
);

// ----------------------------------------------
// 2. TEST ENDPOINT – check connectivity from Render
// ----------------------------------------------
app.get('/test-target', async (req, res) => {
  try {
    const start = Date.now();
    // Try to fetch the target URL with a 5-second timeout
    const response = await axios.get(TARGET_URL, { timeout: 5000 });
    res.send(`✅ Target is REACHABLE! Took ${Date.now() - start}ms. Status: ${response.status}`);
  } catch (err) {
    // Show the exact error code and message
    res.status(500).send(`❌ Target UNREACHABLE. Error: ${err.code} - ${err.message}`);
  }
});

// ----------------------------------------------
// 3. HEALTH CHECK (for Render and uptime monitors)
// ----------------------------------------------
app.get('/health', (req, res) => res.status(200).send('OK'));

// ----------------------------------------------
// 4. START THE SERVER
// ----------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

// ----------------------------------------------
// 5. INTERNAL KEEP‑ALIVE (optional – you can keep or remove)
// ----------------------------------------------
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://your-app-name.onrender.com/health';

setInterval(async () => {
  try {
    const now = new Date();
    const options = { timeZone: 'Asia/Kolkata', hour12: false, weekday: 'long', hour: '2-digit' };
    const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(now);
    const day = parts.find(p => p.type === 'weekday').value;
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);

    const isWeekday = !['Saturday', 'Sunday'].includes(day);
    const isWorkingHours = (hour >= 9 && hour <= 23);

    if (isWeekday && isWorkingHours) {
      await axios.get(RENDER_EXTERNAL_URL);
      console.log(`[${day} ${hour}:00 IST] Ping Successful – Server Kept Awake`);
    } else {
      console.log(`[${day} ${hour}:00 IST] Market Closed – Saving Render hours`);
    }
  } catch (err) {
    console.log('Keep‑Alive check performed');
  }
}, 600000); // every 10 minutes
