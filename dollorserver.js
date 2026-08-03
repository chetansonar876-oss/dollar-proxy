require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');

// --------------------------------------------
// 1. CONFIGURATION (all from environment)
// --------------------------------------------
const config = {
  // Broadcast server details (SECRETS – never exposed to client)
  targetHost: process.env.BROADCAST_HOST || 'http://bcast.suswanibullion.com',
  targetPort: process.env.BROADCAST_PORT || '7767',
  templateId: process.env.TEMPLATE_ID || 'suswani',

  // Security: only these domains can call your proxy
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['https://your-live-domain.com', 'https://www.your-live-domain.com'],

  // Keep‑alive: external URL that Render uses to route traffic to this app
  externalUrl: process.env.RENDER_EXTERNAL_URL || null,

  // Server port
  port: process.env.PORT || 3000,
};

// Construct the full target URL for the proxy
const TARGET_URL = `${config.targetHost}:${config.targetPort}/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/${config.templateId}`;

// --------------------------------------------
// 2. EXPRESS APP SETUP
// --------------------------------------------
const app = express();

// ---- 2a. Strict Origin Lockdown (prevents hotlinking / ZIP misuse) ----
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // Allow preflight OPTIONS requests (CORS)
  if (req.method === 'OPTIONS') {
    const allowed = origin && config.allowedOrigins.includes(origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    return res.sendStatus(allowed ? 200 : 403);
  }

  // Block requests with no origin (e.g., file://, curl, Postman without Origin header)
  if (!origin) {
    console.warn(`[SECURITY] Blocked request with no Origin header from IP: ${req.ip}`);
    return res.status(403).send('Access Denied: Missing origin header.');
  }

  // Block unauthorised origins
  if (!config.allowedOrigins.includes(origin)) {
    console.warn(`[SECURITY] Blocked unauthorised origin: ${origin} from IP: ${req.ip}`);
    return res.status(403).send('Access Denied: Unauthorised origin.');
  }

  // Allowed – set CORS header and proceed
  res.setHeader('Access-Control-Allow-Origin', origin);
  next();
});

// ---- 2b. Proxy Middleware (proxies requests to the hidden broadcast server) ----
app.use(
  '/api/broadcast',
  createProxyMiddleware({
    target: TARGET_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/broadcast': '' }, // strip /api/broadcast from the path
    onProxyReq: (proxyReq, req) => {
      // Log incoming requests (without exposing sensitive query strings)
      console.log(`[PROXY] Forwarding request to: ${TARGET_URL}`);
    },
    onError: (err, req, res) => {
      console.error(`[PROXY ERROR] ${err.message}`);
      res.status(502).send('Broadcast server unreachable');
    },
  })
);

// ---- 2c. Health Check (for Render's monitoring) ----
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// ---- 2d. Root endpoint (optional – shows service is running) ----
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'Proxy running',
    allowedOrigins: config.allowedOrigins,
    target: config.targetHost, // host only (port & template not shown for security)
  });
});

// --------------------------------------------
// 3. START THE SERVER
// --------------------------------------------
const server = app.listen(config.port, () => {
  console.log(`🚀 Proxy server running on port ${config.port}`);
  console.log(`🔒 Allowed origins: ${config.allowedOrigins.join(', ')}`);
  console.log(`🎯 Proxying to: ${config.targetHost}:${config.targetPort} (template: ${config.templateId})`);
});

// --------------------------------------------
// 4. SMART KEEP‑ALIVE (prevents Render from sleeping)
// --------------------------------------------
// Only run if an external URL is provided (required for Render free tier)
if (config.externalUrl) {
  const INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes

  const keepAlive = async () => {
    try {
      const now = new Date();

      // Get current time in IST (UTC+5:30) – simpler and more reliable than Intl
      const istOffset = 5.5 * 60 * 60 * 1000;
      const istTime = new Date(now.getTime() + istOffset);
      const day = istTime.toLocaleString('en-US', { weekday: 'long' });
      const hour = istTime.getHours();

      // Market hours: Monday–Friday, 9 AM – 11:59 PM IST
      const isWeekday = !['Saturday', 'Sunday'].includes(day);
      const isWorkingHours = (hour >= 9 && hour <= 23);

      if (isWeekday && isWorkingHours) {
        // Ping our own health endpoint via the external URL
        await axios.get(config.externalUrl, { timeout: 5000 });
        console.log(`[KEEP-ALIVE] ${day} ${hour}:00 IST – Ping successful (server awake)`);
      } else {
        console.log(`[KEEP-ALIVE] ${day} ${hour}:00 IST – Market closed (skipping ping)`);
      }
    } catch (err) {
      // Silently fail – we don't want the keep‑alive to crash the server
      console.warn('[KEEP-ALIVE] Ping failed (will retry next cycle)');
    }
  };

  // Run immediately on startup, then every interval
  keepAlive();
  setInterval(keepAlive, INTERVAL_MS);
} else {
  console.warn('⚠️  RENDER_EXTERNAL_URL not set – keep‑alive disabled. Your app may sleep on free tier.');
}

// --------------------------------------------
// 5. GRACEFUL SHUTDOWN (clean exit on SIGTERM)
// --------------------------------------------
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received – closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received – closing server gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
