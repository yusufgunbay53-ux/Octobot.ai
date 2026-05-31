import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

chromium.use(stealth());

async function check() {
  try {
    console.log("Launching...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto('https://example.com');
    console.log("Title:", await page.title());
    await browser.close();
    console.log("Success");
  } catch (e) {
    console.error("Failed:", e);
  }
}
check();
