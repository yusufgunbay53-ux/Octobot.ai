import { chromium } from 'playwright';

async function test() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto("https://en.wikipedia.org/wiki/Main_Page", { waitUntil: 'domcontentloaded' }); // Go to english Wikipedia
  
  const result = await page.evaluate(() => {
     const allElements = document.querySelectorAll('*');
     let counter = 1;

     Array.from(allElements).forEach((el) => {
       if (el instanceof HTMLElement || el instanceof SVGElement) {
         const tag = el.tagName.toLowerCase();
         const role = el.getAttribute('role');
         const hasClick = el.hasAttribute('onclick');
         
         let isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                             role === 'button' || role === 'link' || hasClick;

         if (!isInteractive && el instanceof HTMLElement) {
           const style = window.getComputedStyle(el);
           if (style.cursor === 'pointer') {
             isInteractive = true;
           }
         }

         if (isInteractive) {
           const rect = el.getBoundingClientRect();
           const isVisible = rect.width > 0 && rect.height > 0 && 
                             rect.bottom >= 0 && rect.right >= 0 && 
                             rect.top <= (window.innerHeight || document.documentElement.clientHeight) && 
                             rect.left <= (window.innerWidth || document.documentElement.clientWidth);
           
           if (isVisible) {
             const oldId = el.getAttribute('data-agent-id');
             if (!oldId) {
               el.setAttribute('data-agent-id', `el_${counter++}`);
             }
           }
         }
       }
     });
     
     const clone = document.body.cloneNode(true);
     const elementsToRemove = clone.querySelectorAll('script, style, svg, noscript, iframe, img, video, audio, canvas, path, meta, link, head');
     elementsToRemove.forEach(el => el.remove());

     const allCloneElements = clone.querySelectorAll('*');
     allCloneElements.forEach(el => {
       el.removeAttribute('class');
       el.removeAttribute('id');
       el.removeAttribute('style');
     });

     const interactiveList = Array.from(clone.querySelectorAll('[data-agent-id]'));
     
     const simplified = interactiveList.map(el => {
         if (el.textContent?.trim() === '' && !['input', 'textarea', 'select'].includes(el.tagName.toLowerCase())) {
            return null;
         }
         return el.outerHTML;
     }).filter(Boolean).join('\n');

     return simplified;
  });
  
  console.log("Donate in result?", result.toLowerCase().includes("donate"));
  console.log("Donate count:", (result.toLowerCase().match(/donate/g) || []).length);
  const donateLines = result.split('\n').filter(l => l.toLowerCase().includes("donate"));
  console.log("Donate lines:\n" + donateLines.join('\n'));
  
  await browser.close();
}
test();
