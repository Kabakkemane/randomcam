const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");
const waiting = [];
const peers = new Map();
const clients = new Map();
const profiles = new Map();
const reports = [];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function iceServers() {
  if (!process.env.ICE_SERVERS) {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }

  try {
    return JSON.parse(process.env.ICE_SERVERS);
  } catch (error) {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

function emit(id, type, data = {}) {
  const client = clients.get(id)?.res;
  if (!client) return;
  client.write(`event: ${type}\n`);
  client.write(`data: ${JSON.stringify(data)}\n\n`);
}

function removeFromQueue(id) {
  const index = waiting.indexOf(id);
  if (index !== -1) waiting.splice(index, 1);
}

function endMatch(id, reason = "Partner ayrildi") {
  const partnerId = peers.get(id);
  peers.delete(id);
  removeFromQueue(id);

  if (!partnerId) return;

  peers.delete(partnerId);
  removeFromQueue(partnerId);
  emit(partnerId, "partner-left", { reason });
}

function publicProfile(id) {
  const profile = profiles.get(id) || {};
  return {
    name: profile.name || "Misafir",
    region: profile.region || "Farketmez"
  };
}

function tryMatch(id) {
  removeFromQueue(id);

  while (waiting.length > 0) {
    const partnerId = waiting.shift();
    if (!clients.has(partnerId) || peers.has(partnerId) || partnerId === id) continue;

    peers.set(id, partnerId);
    peers.set(partnerId, id);
    emit(id, "matched", { initiator: true, partner: publicProfile(partnerId) });
    emit(partnerId, "matched", { initiator: false, partner: publicProfile(id) });
    return;
  }

  waiting.push(id);
  emit(id, "waiting");
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const rawPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const filePath = path.resolve(publicDir, rawPath);
  const relativePath = path.relative(publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    res.end(content);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

async function handleAction(req, res) {
  try {
    const { id, action, payload } = await readBody(req);
    if (!id || !clients.has(id)) {
      sendJson(res, 400, { ok: false, error: "Unknown client" });
      return;
    }

    if (action === "find") {
      profiles.set(id, {
        name: String(payload.name || "").trim().slice(0, 28),
        region: String(payload.region || "Farketmez").trim().slice(0, 32)
      });
      endMatch(id, "Partner yeni eslesme ariyor");
      tryMatch(id);
    } else if (action === "cancel") {
      removeFromQueue(id);
      endMatch(id, "Partner aramayi iptal etti");
      emit(id, "idle");
    } else if (action === "next") {
      endMatch(id, "Partner sonraki sohbete gecti");
      tryMatch(id);
    } else if (action === "signal") {
      const partnerId = peers.get(id);
      if (partnerId) emit(partnerId, "signal", payload);
    } else if (action === "chat") {
      const partnerId = peers.get(id);
      if (partnerId) emit(partnerId, "chat", payload);
    } else if (action === "report") {
      const partnerId = peers.get(id);
      reports.push({
        reporter: id,
        reported: partnerId,
        reason: String(payload.reason || "Raporlandi").slice(0, 120),
        at: new Date().toISOString()
      });
      endMatch(id, "Partner raporlandi ve sohbet kapatildi");
      emit(id, "idle");
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: "Request failed" });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/events") {
    const id = crypto.randomUUID();
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });
    const heartbeat = setInterval(() => {
      res.write(`event: ping\n`);
      res.write(`data: ${Date.now()}\n\n`);
    }, 15000);
    clients.set(id, { res, heartbeat });
    emit(id, "ready", { id });
    req.on("close", () => {
      const client = clients.get(id);
      if (client) clearInterval(client.heartbeat);
      clients.delete(id);
      profiles.delete(id);
      endMatch(id);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/action") {
    handleAction(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/config.json") {
    sendJson(res, 200, { iceServers: iceServers() });
    return;
  }

  if (req.method === "GET") {
    serveStatic(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Random video chat running at http://localhost:${PORT}`);
});
