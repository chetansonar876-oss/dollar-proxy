const http = require("http");
const axios = require("axios");
const { createProxyServer } = require("http-proxy");

// ==============================
// TARGET SERVER
// ==============================
const TARGET = "http://bcast.suswanibullion.com:7767";

// ==============================
// PROXY
// ==============================
const proxy = createProxyServer({
    target: TARGET,
    changeOrigin: true,
    ws: true
});

// Proxy Error
proxy.on("error", (err, req, res) => {
    console.error("Proxy Error:", err.message);

    if (res && !res.headersSent) {
        res.writeHead(502, {
            "Content-Type": "text/plain"
        });

        res.end("Proxy Error");
    }
});

// ==============================
// HTTP SERVER
// ==============================
const server = http.createServer((req, res) => {

    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") {
        res.writeHead(200);
        return res.end();
    }

    // Health Check
    if (req.url === "/health") {
        res.writeHead(200, {
            "Content-Type": "text/plain"
        });
        return res.end("OK");
    }

    console.log("Proxy Request:", req.url);

    proxy.web(req, res);
});

// ==============================
// WEBSOCKET SUPPORT
// ==============================
server.on("upgrade", (req, socket, head) => {
    proxy.ws(req, socket, head);
});

// ==============================
// START SERVER
// ==============================
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("Bullion Broadcast Proxy Running");
    console.log("Target :", TARGET);
    console.log("Port   :", PORT);
    console.log("--------------------------------");
});

// ==============================
// KEEP ALIVE
// ==============================

const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

if (RENDER_URL) {

    setInterval(async () => {

        try {

            await axios.get(`${RENDER_URL}/health`);

            console.log("Keep Alive Success");

        } catch (err) {

            console.log("Keep Alive Failed :", err.message);

        }

    }, 300000); // Every 5 Minutes

}
