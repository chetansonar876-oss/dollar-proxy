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

// Proxy middleware – client calls /api/broadcast
app.use(
  '/api/broadcast',
  createProxyMiddleware({
    target: TARGET_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/broadcast': '' },
    onError: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).send('Broadcast server unreachable');
    }
  })
);

// Health check for Render
app.get('/health', (req, res) => res.status(200).send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));

// Smart keep‑alive (Mon–Fri, 9 AM – 11:59 PM IST)
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
}, 600000);