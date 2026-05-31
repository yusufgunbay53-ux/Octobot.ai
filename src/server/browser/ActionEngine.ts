import { Page } from 'playwright';

export class ActionEngine {
  
  static async navigateTo(page: Page, url: string): Promise<void> {
    // Add protocol if missing
    let finalUrl = url;
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'https://' + finalUrl;
    }
    await page.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.wait(1000); // Small wait for dynamic content
  }

  static async clickElement(page: Page, agentId: string): Promise<void> {
    const normalizedId = String(agentId).startsWith('el_') ? String(agentId) : `el_${agentId}`;
    const selector = `[data-agent-id="${normalizedId}"]`;
    const locator = page.locator(selector).first();
    
    // Scroll into view if needed
    await locator.scrollIntoViewIfNeeded();
    
    // Execute click and try to capture any triggered navigation
    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 5000 }).catch(() => {}),
        locator.click({ delay: ActionEngine.getRandomDelay(50, 150) })
      ]);
    } catch (e) {
      console.error("Navigation after click timeout or error:", e);
    }
    
    // Wait for any additional fetch requests or DOM changes
    await this.wait(2000); 
  }

  static async typeText(page: Page, agentId: string, text: string): Promise<void> {
    const normalizedId = String(agentId).startsWith('el_') ? String(agentId) : `el_${agentId}`;
    const selector = `[data-agent-id="${normalizedId}"]`;
    const locator = page.locator(selector).first();
    
    await locator.scrollIntoViewIfNeeded();
    await locator.fill(''); // Clear first
    
    // Type with delay to simulate human
    await locator.type(text, { delay: ActionEngine.getRandomDelay(30, 100) });
  }

  static async scroll(page: Page, direction: 'up' | 'down', amount: number = 500): Promise<void> {
    const scrollAmount = direction === 'down' ? amount : -amount;
    await page.evaluate((y) => {
      window.scrollBy({ top: y, left: 0, behavior: 'smooth' });
    }, scrollAmount);
    await this.wait(1000);
  }

  static async autoGoogleLogin(page: Page, email?: string, password?: string): Promise<void> {
    await this.navigateTo(page, 'https://accounts.google.com/');
    await this.wait(2000);
    
    if (!email) return;
    
    try {
      // Find email input
      const emailInput = page.locator('input[type="email"]').first();
      if (await emailInput.isVisible({ timeout: 2000 })) {
        await emailInput.fill('');
        await emailInput.type(email, { delay: this.getRandomDelay(30, 80) });
        await page.keyboard.press('Enter');
        await this.wait(3000); // Wait for transition
        
        if (password) {
           const passInput = page.locator('input[type="password"]').first();
           if (await passInput.isVisible({ timeout: 5000 })) {
              await passInput.fill('');
              await passInput.type(password, { delay: this.getRandomDelay(30, 80) });
              await page.keyboard.press('Enter');
              await this.wait(4000); // Wait for login
           }
        }
      }
    } catch(e) {
      console.error("Auto Google Login failed:", e);
    }
  }

  static async wait(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private static getRandomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
