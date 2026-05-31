import { Router } from 'express';
import { browserService } from '../browser/BrowserService';
import { DOMProcessor } from '../browser/DOMProcessor';
import { ActionEngine } from '../browser/ActionEngine';

const router = Router();

// POST /api/browser/init
router.post('/init', async (req, res) => {
  try {
    const { loadStateId, width, height } = req.body || {};
    const sessionWidth = width || 1280;
    const sessionHeight = height || 800;
    const sessionId = await browserService.launch(loadStateId, sessionWidth, sessionHeight);
    res.json({ success: true, sessionId });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/browser/state
router.post('/state', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const page = browserService.getSessionPage(sessionId);
    const state = await DOMProcessor.process(page);
    
    res.json({ success: true, state });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/browser/action
router.post('/action', async (req, res) => {
  try {
    const { sessionId, action, params } = req.body;
    if (!sessionId || !action) return res.status(400).json({ error: 'sessionId and action are required' });

    const page = browserService.getSessionPage(sessionId);

    switch (action) {
      case 'NAVIGATE':
        if (!params?.url) throw new Error('NAVIGATE requires url parameter');
        await ActionEngine.navigateTo(page, params.url);
        break;
      case 'CLICK':
        if (!params?.agentId) throw new Error('CLICK requires agentId parameter');
        await ActionEngine.clickElement(page, params.agentId);
        break;
      case 'TYPE':
        if (!params?.agentId || params?.text === undefined) throw new Error('TYPE requires agentId and text parameters');
        await ActionEngine.typeText(page, params.agentId, params.text);
        break;
      case 'SCROLL':
        const direction = params?.direction || 'down';
        const amount = params?.amount || 500;
        await ActionEngine.scroll(page, direction, amount);
        break;
      case 'WAIT':
        const ms = params?.ms || 2000;
        await ActionEngine.wait(ms);
        break;
      case 'GOOGLE_LOGIN':
        // If they provided it in params, use it, otherwise use env vars
        const email = params?.email || process.env.GMAIL_EMAIL;
        const password = params?.password || process.env.GMAIL_PASSWORD;
        await ActionEngine.autoGoogleLogin(page, email, password);
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    // Always return new state after action
    const state = await DOMProcessor.process(page);
    res.json({ success: true, state });

  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
