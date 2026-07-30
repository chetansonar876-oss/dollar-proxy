require('dotenv').config();
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const axios = require('axios');

const app = express();

// ========== CONFIGURATION ==========
const BROADCAST_HOST = process.env.BROADCAST_HOST || 'http://bcast.suswanibullion.com';
const BROADCAST_PORT = process.env.BROADCAST_PORT || '7767';
const TEMPLATE_ID = process.env.TEMPLATE_ID || 'suswani';
const BROADCAST_URL = `${BROADCAST_HOST}:${BROADCAST_PORT}/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/${TEMPLATE_ID}`;

// ========== RATE CACHE ==========
let currentRates = {
  gold: null,   // USD/oz
  silver: null, // USD/oz
  inr: null,    // USD/INR
};
let broadcastFailCount = 0;
const MAX_FAILS_BEFORE_FALLBACK = 5;

// ========== FETCH & PARSE BROADCAST (same logic as client) ==========
async function fetchBroadcastRates() {
  try {
    const response = await axios.get(BROADCAST_URL, {
      timeout: 4000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShreeGoldBot/1.0)' }
    });
    const data = response.data;

    // Log first 150 chars to help debug
    console.log('[Broadcast] Raw data:', data.substring(0, 150) + '...');

    const rows = data.trim().split('\n');
    let goldPrice = null, silverPrice = null, inrRate = null;

    rows.forEach(row => {
      const cols = row.split('\t');
      if (cols.length < 5) return;
      const id = cols[0]?.trim() || '';
      const name = cols[2]?.trim() || '';
      const bid = parseFloat(cols[3]) || 0;
      const ask = parseFloat(cols[4]) || 0;
      const price = ask > 0 ? ask : bid;

      // --- GOLD ---
      if (id === '6433' || name.includes('GOLD ($)')) {
        goldPrice = price;
      }
      // --- SILVER ---
      if (id === '6434' || name === '59.56' || (name.includes('SILVER') && bid < 100)) {
        silverPrice = (bid > 0 && bid < 100) ? bid : (ask > 0 && ask < 100 ? ask : price);
      }
      // --- USD/INR ---
      if (id === '6435' || name.includes('INR')) {
        inrRate = price;
      }
    });

    // Update cache if we got at least one value
    if (goldPrice !== null) currentRates.gold = goldPrice;
    if (silverPrice !== null) currentRates.silver = silverPrice;
    if (inrRate !== null) currentRates.inr = inrRate;

    // Reset fail counter on success
    broadcastFailCount = 0;
    console.log(`[Broadcast] ✅ Updated: GOLD=${goldPrice}, SILVER=${silverPrice}, INR=${inrRate}`);
  } catch (err) {
    broadcastFailCount++;
    console.warn(`[Broadcast] ❌ Attempt ${broadcastFailCount} failed:`, err.message);
    // Only fall back after consecutive failures
    if (broadcastFailCount >= MAX_FAILS_BEFORE_FALLBACK) {
      console.log('[Broadcast] Using fallback APIs (temporary)');
      await fetchFallbackRates();
    }
  }
}

// ========== FALLBACK APIs (when broadcast is down) ==========
async function fetchFallbackRates() {
  try {
    const [goldRes, silverRes, inrRes] = await Promise.all([
      axios.get('https://api.gold-api.com/price/XAU', { timeout: 5000 }),
      axios.get('https://api.gold-api.com/price/XAG', { timeout: 5000 }),
      axios.get('https://api.exchangerate-api.com/v4/latest/USD', { timeout: 5000 }),
    ]);
    currentRates.gold = goldRes.data.price;
    currentRates.silver = silverRes.data.price;
    currentRates.inr = inrRes.data.rates.INR;
    console.log('[Fallback] Updated rates from public APIs.');
  } catch (e) {
    console.error('[Fallback] All APIs failed:', e.message);
  }
}

// ========== START POLLING EVERY SECOND ==========
setInterval(fetchBroadcastRates, 1000);
fetchBroadcastRates(); // initial fetch

// ========== PROXY MIDDLEWARE (for backward compatibility) ==========
app.use(
  '/api/broadcast',
  createProxyMiddleware({
    target: BROADCAST_URL,
    changeOrigin: true,
    pathRewrite: { '^/api/broadcast': '' },
    onError: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).send('Broadcast server unreachable');
    }
  })
);

// ========== NEW RATE ENDPOINT ==========
app.get('/api/rates', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json(currentRates);
});

// ========== HEALTH CHECK ==========
app.get('/health', (req, res) => res.status(200).send('OK'));

// ========== START SERVER ==========
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 Proxy broadcast at /api/broadcast`);
  console.log(`📊 Rate endpoint at /api/rates`);
});

// ========== SMART KEEP-ALIVE (Mon–Fri, 9 AM – 11:59 PM IST) ==========
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
      console.log(`[Keep-Alive] ${day} ${hour}:00 IST - Ping successful.`);
    } else {
      console.log(`[Keep-Alive] ${day} ${hour}:00 IST - Outside window, sleeping.`);
    }
  } catch (err) {
    console.log('[Keep-Alive] Check performed (may have failed)');
  }
}, 600000);
