import { Browser, BrowserContext, Page, CDPSession } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocket } from 'ws';

chromium.use(stealth());

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  cdpSession?: CDPSession;
  ws?: WebSocket;
  lastUsed: number;
  saveInterval?: NodeJS.Timeout;
}

/**
 * Find the Chromium executable by scanning known installation directories.
 * Checks PLAYWRIGHT_BROWSERS_PATH and the default ~/.cache/ms-playwright location.
 * Returns undefined if no binary is found (triggering auto-install fallback).
 */
function findChromiumExecutable(): string | undefined {
  const searchDirs = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/ms-playwright',
    path.join(process.env.HOME || '/root', '.cache', 'ms-playwright'),
  ].filter(Boolean) as string[];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (!entry.startsWith('chromium-')) continue;
        const candidates = [
          path.join(dir, entry, 'chrome-linux', 'chrome'),
          path.join(dir, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            console.log(`[BrowserService] Found Chromium at: ${candidate}`);
            return candidate;
          }
        }
      }
    } catch (e) {
      // ignore readdir errors, try next dir
    }
  }
  return undefined;
}

export class BrowserService {
  private browser: Browser | null = null;
  private sessions: Map<string, BrowserSession> = new Map();
  private isInitializing: boolean = false;
  private stateDir: string;

  constructor() {
    this.stateDir = path.join(process.cwd(), '.browser_sessions');
    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
    // Start idle cleanup interval to prevent memory leaks
    setInterval(() => this.cleanupIdleSessions(), 60000); // Check every minute
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (this.isInitializing) {
      // wait until initialized
      while (this.isInitializing) {
        await new Promise(r => setTimeout(r, 100));
      }
      if (this.browser) return this.browser;
    }

    this.isInitializing = true;
    try {
      console.log("[BrowserService] Launching Chromium...");
      const start = Date.now();

      const launchArgs = [
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-site-isolation-trials',
        '--disable-blink-features=AutomationControlled'
      ];

      // Find pre-installed Chromium binary directly (avoids dependency on env var)
      const executablePath = findChromiumExecutable();

      try {
        const launchOptions: any = {
          headless: true,
          args: launchArgs,
        };
        if (executablePath) {
          launchOptions.executablePath = executablePath;
          console.log(`[BrowserService] Using pre-installed Chromium: ${executablePath}`);
        }
        this.browser = await chromium.launch(launchOptions);
      } catch (err: any) {
        if (err.message && err.message.includes("Executable doesn't exist")) {
           console.log("Playwright executable missing, installing...");
           const child_process = await import('child_process');
           // Install to /ms-playwright explicitly
           child_process.execSync('PLAYWRIGHT_BROWSERS_PATH=/ms-playwright npx playwright install chromium', {
             stdio: 'inherit',
             env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '/ms-playwright' }
           });
           const retryPath = findChromiumExecutable();
           const retryOptions: any = {
             headless: true,
             args: launchArgs,
           };
           if (retryPath) retryOptions.executablePath = retryPath;
           this.browser = await chromium.launch(retryOptions);
        } else {
           throw err;
        }
      }
      console.log(`[BrowserService] Chromium launched successfully in ${Date.now() - start}ms.`);
    } catch (err) {
      console.error("[BrowserService] Failed to launch Chromium:", err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
    return this.browser!;
  }

  async init(): Promise<void> {
    console.log("[BrowserService] init called.");
    const startTime = Date.now();
    await this.ensureBrowser();
    console.log(`[BrowserService] init completed in ${Date.now() - startTime}ms.`);
  }

  async launch(loadStateId?: string, width: number = 1280, height: number = 800): Promise<string> {
    console.log(`[BrowserService] launch called. (loadStateId: ${loadStateId}, w: ${width}, h: ${height})`);
    const launchStart = Date.now();
    const browser = await this.ensureBrowser();
    console.log(`[BrowserService] browser ensured. Took ${Date.now() - launchStart}ms`);
    
    // Create isolated context for this session
    const isMobileBrowser = width < 768;
    const contextOptions: any = {
      viewport: { width, height },
      deviceScaleFactor: isMobileBrowser ? 2 : 1,
      isMobile: isMobileBrowser,
      hasTouch: isMobileBrowser,
      userAgent: isMobileBrowser 
        ? "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
        : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      locale: 'tr-TR', // Localized to seem natural
      timezoneId: 'Europe/Istanbul',
      permissions: ['geolocation'],
      colorScheme: 'dark'
    };
    
    // Load session state if provided or fallback to default single user profile
    const profileId = loadStateId || 'default-profile';
    const stateFile = path.join(this.stateDir, `${profileId}.json`);
    if (fs.existsSync(stateFile)) {
      try {
        contextOptions.storageState = stateFile;
        console.log(`[BrowserService] Loading state from ${stateFile}`);
      } catch (err) {
        console.warn(`[BrowserService] Failed to load prior state from ${stateFile}`, err);
      }
    }
    
    const contextStart = Date.now();
    const context = await browser.newContext(contextOptions);

    // Periodically save state to maintain login sessions
    const saveInterval = setInterval(async () => {
      try {
        await context.storageState({ path: stateFile });
      } catch(e) {
        // Ignore errors if context is closed
      }
    }, 5000);

    // Provide a binding to report input text boxes
    await context.exposeFunction('otobotReportInputs', (rects: any[]) => {
      // Find the session that owns this context
      for (const [sid, sess] of this.sessions.entries()) {
        if (sess.context === context && sess.ws && sess.ws.readyState === WebSocket.OPEN) {
          sess.ws.send(JSON.stringify({ type: 'inputRects', rects }));
          break;
        }
      }
    });

    // Add anti-bot evasions and input reporter
    await context.addInitScript(`
      // Webdriver evasion
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      
      // Chrome extension evasion
      window.chrome = { runtime: {} };
      
      // Plugins evasion
      if (!window.navigator.plugins.length) {
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      }
      
      // Languages evasion
      if (!window.navigator.languages.length) {
        Object.defineProperty(navigator, 'languages', { get: () => ['tr-TR', 'tr', 'en-US', 'en'] });
      }
      
      // Hardware and memory evasion
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => Math.floor(Math.random() * 8) + 4 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
      
      // Permissions evasion
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission } /* PermissionStatus */) :
          originalQuery(parameters)
      );
      
      // WebGL evasion
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter.apply(this, [parameter]);
      };
      
      // Hide Playwright and CDC variables
      let cache = Object.getOwnPropertyNames(window);
      for (let i = 0; i < cache.length; i++) {
        const key = cache[i];
        if (key.includes('cdc_') || key.includes('playwright')) {
          delete window[key];
        }
      }
      Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Array', { get: () => undefined });
      Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Promise', { get: () => undefined });
      Object.defineProperty(window, 'cdc_adoQpoasnfa76pfcZLmcfl_Symbol', { get: () => undefined });
      
      // Feature detections evasion
      window.navigator.chrome = { runtime: {} };

      // OTOBOT Input Tracking
      function sendRects() {
          const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]');
          const rects = [];
          for (let i = 0; i < inputs.length; i++) {
              const el = inputs[i];
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                  let val = '';
                  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                      val = el.value || '';
                  } else {
                      val = el.innerText || '';
                  }
                  rects.push({ x: r.x, y: r.y, w: r.width, h: r.height, val });
              }
          }
          if (window.otobotReportInputs) {
              window.otobotReportInputs(rects).catch(()=>{});
          }
      }
      
      window.addEventListener('resize', sendRects);
      window.addEventListener('scroll', sendRects, true);
      window.addEventListener('input', sendRects, true);
      window.addEventListener('click', () => setTimeout(sendRects, 150), true);
      document.addEventListener('DOMContentLoaded', sendRects);
      setInterval(sendRects, 1000);
    `);

    const page = await context.newPage();
    console.log(`[BrowserService] context and page created. Took ${Date.now() - contextStart}ms`);
    
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      context,
      page,
      lastUsed: Date.now(),
      saveInterval
    });

    return sessionId;
  }
  
  async saveSessionState(sessionId: string, customId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const statePath = path.join(this.stateDir, `${customId}.json`);
    await session.context.storageState({ path: statePath });
  }

  getSessionPage(sessionId: string): Page {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found or expired.`);
    }
    session.lastUsed = Date.now();
    return session.page;
  }

  async attachWebSocket(sessionId: string, ws: WebSocket) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      ws.close();
      return;
    }
    session.ws = ws;

    try {
      const cdpSession = await session.context.newCDPSession(session.page);
      session.cdpSession = cdpSession;

      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        everyNthFrame: 1
      });

      cdpSession.on('Page.screencastFrame', (e: any) => {
        if (session.ws && session.ws.readyState === WebSocket.OPEN) {
          session.ws.send(JSON.stringify({
            type: 'screencastFrame',
            data: e.data,
            metadata: e.metadata
          }));
        }
        
        // Acknowledge the frame to receive the next one
        cdpSession.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
      });

      session.page.on('framenavigated', (frame) => {
        if (frame === session.page.mainFrame() && session.ws && session.ws.readyState === WebSocket.OPEN) {
           session.ws.send(JSON.stringify({
             type: 'urlChanged',
             url: frame.url()
           }));
        }
      });

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'click') {
            await session.page.mouse.click(msg.x, msg.y);
          } else if (msg.type === 'mousedown') {
            await session.page.mouse.move(msg.x, msg.y);
            await session.page.mouse.down({ button: msg.button || 'left' });
          } else if (msg.type === 'mouseup') {
            await session.page.mouse.move(msg.x, msg.y);
            await session.page.mouse.up({ button: msg.button || 'left' });
          } else if (msg.type === 'mousemove') {
            await session.page.mouse.move(msg.x, msg.y);
          } else if (msg.type === 'wheel') {
            await session.page.mouse.wheel(msg.deltaX, msg.deltaY);
          } else if (msg.type === 'keydown') {
            // Map web keys to playwright keys
            const keyMap: any = {
                'Backspace': 'Backspace',
                'Enter': 'Enter',
                'Tab': 'Tab',
                'Escape': 'Escape',
                'Delete': 'Delete',
                'ArrowUp': 'ArrowUp',
                'ArrowDown': 'ArrowDown',
                'ArrowLeft': 'ArrowLeft',
                'ArrowRight': 'ArrowRight',
                'Control': 'Control',
                'Shift': 'Shift',
                'Alt': 'Alt',
                'Meta': 'Meta'
            };
            if (keyMap[msg.key]) {
                await session.page.keyboard.press(keyMap[msg.key]);
            } else if (msg.key.length === 1) {
                await session.page.keyboard.press(msg.key);
            }
          } else if (msg.type === 'insertText') {
            await session.page.keyboard.insertText(msg.text);
            if (msg.pressEnter) {
                await session.page.keyboard.press('Enter');
            }
          }
        } catch (err) {
          console.error("WS message error:", err);
        }
      });

      ws.on('close', async () => {
        try {
          await cdpSession.send('Page.stopScreencast');
          await cdpSession.detach();
        } catch (err) {}
        session.cdpSession = undefined;
        session.ws = undefined;
      });

    } catch (err) {
      console.error('Error attaching CDP session:', err);
      ws.close();
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        if (session.saveInterval) clearInterval(session.saveInterval);
        if (session.ws) session.ws.close();
        await session.page.close();
        await session.context.close();
      } catch(e) {
        console.error(`Error closing session ${sessionId}`, e);
      }
      this.sessions.delete(sessionId);
    }
  }

  async cleanupIdleSessions(): Promise<void> {
    const now = Date.now();
    const IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUsed > IDLE_TIMEOUT) {
        console.log(`Cleaning up idle session: ${sessionId}`);
        await this.closeSession(sessionId);
      }
    }
  }
}

export const browserService = new BrowserService();
