const http = require('http');
const { createProxyServer } = require('http-proxy');
const axios = require('axios');

const PROXY_TARGET = process.env.PROXY_TARGET || 'http://slkbullion.com:10001';
const BROADCAST_URL =
  process.env.BROADCAST_URL ||
  'http://bcast.suswanibullion.com:7767/VOTSBroadcastStreaming/Services/xml/GetLiveRateByTemplateID/suswani';

const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL || 'https://your-app-name.onrender.com';

// ========== RATE CACHE ==========
let currentRates = { gold: null, silver: null, inr: null };
let broadcastFailCount = 0;
const MAX_FAILS_BEFORE_FALLBACK = 5;

// ========== FETCH & PARSE BROADCAST ==========
async function fetchBroadcastRates() {
  try {
    const response = await axios.get(BROADCAST_URL, {
      timeout: 4000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShreeGoldBot/1.0)' }
    });
    const data = response.data;
    // Log first 150 chars to see what we got
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

      if (id === '6433' || name.includes('GOLD ($)')) goldPrice = price;
      if (id === '6434' || name === '59.56' || (name.includes('SILVER') && bid < 100)) {
        silverPrice = (bid > 0 && bid < 100) ? bid : (ask > 0 && ask < 100 ? ask : price);
      }
      if (id === '6435' || name.includes('INR')) inrRate = price;
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
    // If we've failed too many times, try fallback
    if (broadcastFailCount >= MAX_FAILS_BEFORE_FALLBACK) {
      console.log('[Broadcast] Using fallback APIs (temporary)');
      await fetchFallbackRates();
    }
  }
}

// ========== FALLBACK APIs (only when broadcast is down) ==========
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

// ========== POLLING ==========
setInterval(fetchBroadcastRates, 1000);
fetchBroadcastRates();

// ========== PROXY SETUP ==========
const proxy = createProxyServer({
  target: PROXY_TARGET,
  ws: true,
  changeOrigin: true,
});
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err.message);
  if (res && !res.headersSent && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: Target server unreachable');
  }
});

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }
  if (req.url === '/api/rates') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(currentRates));
    return;
  }
  proxy.web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 Proxy target: ${PROXY_TARGET}`);
  console.log(`📊 Rate endpoint: /api/rates`);
});

// ========== SMART KEEP-ALIVE ==========
setInterval(async () => {
  try {
    const now = new Date();
    const istString = now.toLocaleString('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'long',
      hour: 'numeric',
      hour12: false,
    });
    const [day, hourStr] = istString.split(', ');
    const hour = parseInt(hourStr);
    const isWeekday = !['Saturday', 'Sunday'].includes(day);
    const isWorkingHours = (hour >= 9 && hour <= 23);
    if (isWeekday && isWorkingHours) {
      await axios.get(RENDER_EXTERNAL_URL + '/health');
      console.log(`[Keep-Alive] ${day} ${hour}:00 IST - ping successful.`);
    } else {
      console.log(`[Keep-Alive] ${day} ${hour}:00 IST - outside window, sleeping.`);
    }
  } catch (err) {
    console.error('[Keep-Alive] Error:', err.message);
  }
}, 300000);
