import express from "express";
import { createServer as createHttpServer } from "http";
import { WebSocketServer } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import browserApi from "./src/server/routes/browserApi";
import aiApi from "./src/server/routes/aiApi";
import { browserService } from "./src/server/browser/BrowserService";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;
  
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: '/api/browser/stream' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');
    
    if (!sessionId) {
      ws.close();
      return;
    }
    
    // Attach WebSocket to session
    browserService.attachWebSocket(sessionId, ws);
  });

  app.use(express.json());

  // Pre-warm browser in the background
  browserService.init().catch(err => console.error("Failed to pre-warm browser", err));

  // Mount Headless Browser API
  app.use("/api/browser", browserApi);
  
  // Mount AI Proxy API
  app.use("/api/ai", aiApi);

  // Applet specific start page
  app.get("/start-page", (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html lang="tr">
      <head>
        <meta charset="UTF-8">
        <title>Otobot Search</title>
        <style>
          body {
            margin: 0;
            padding: 0;
            background-color: #0A0A0A;
            color: #FFFFFF;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          h1 {
            font-size: 4rem;
            margin-bottom: 2rem;
            background: linear-gradient(to right, #60A5FA, #A78BFA);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-weight: 800;
          }
          .search-box {
            width: 100%;
            max-width: 600px;
            display: flex;
            background: #1A1A1A;
            border-radius: 9999px;
            padding: 0.5rem;
            border: 1px solid #333;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          }
          .search-box:focus-within {
            border-color: #60A5FA;
          }
          input {
            flex-grow: 1;
            background: transparent;
            border: none;
            color: white;
            padding: 0.75rem 1.5rem;
            font-size: 1.1rem;
            outline: none;
          }
          button {
            background: #60A5FA;
            color: black;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 9999px;
            font-weight: bold;
            font-size: 1rem;
            cursor: pointer;
          }
          button:hover {
            background: #93C5FD;
          }
        </style>
      </head>
      <body>
        <h1>Otobot</h1>
        <div class="search-box">
          <input type="text" id="searchInput" placeholder="Web'de arama yapın veya URL girin...">
          <button id="searchButton" type="button" onclick="performSearch()">Git</button>
        </div>
        <script>
          function performSearch() {
            const val = document.getElementById('searchInput').value;
            if (val) {
              if (val.startsWith('http://') || val.startsWith('https://')) {
                window.location.href = val;
              } else {
                window.location.href = 'https://www.google.com/search?q=' + encodeURIComponent(val);
              }
            }
          }
          document.getElementById('searchInput').addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
              performSearch();
            }
          });
        </script>
      </body>
      </html>
    `);
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
