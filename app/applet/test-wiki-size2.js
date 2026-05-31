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
        // Keep only essential attributes
        const keepAttrs = ['href', 'placeholder', 'type', 'value', 'name', 'data-agent-id', 'alt', 'role', 'checked'];
        const attrsToRemove = [];
        for (let i = 0; i < el.attributes.length; i++) {
          const attrName = el.attributes[i].name;
          if (!keepAttrs.includes(attrName.toLowerCase())) {
            attrsToRemove.push(attrName);
          }
        }
        attrsToRemove.forEach(attr => el.removeAttribute(attr));
      });

     const interactiveList = Array.from(clone.querySelectorAll('[data-agent-id]'));
     
     const simplified = interactiveList.map(el => {
         if (el.textContent?.trim() === '' && !['input', 'textarea', 'select'].includes(el.tagName.toLowerCase())) {
            return null;
         }
         
          // Skip if it's already inside another [data-agent-id] (to avoid huge duplication)
          let parent = el.parentElement;
          let hasInteractiveParent = false;
          while (parent) {
             if (parent.hasAttribute('data-agent-id')) {
                hasInteractiveParent = true;
                break;
             }
             parent = parent.parentElement;
          }
          if (hasInteractiveParent) return null;

         return el.outerHTML;
     }).filter(Boolean).join('\n');

     return simplified;
  });
  
  console.log("Total characters:", result.length);
  
  const donateIndex = result.toLowerCase().indexOf("donate");
  console.log("Donate first index at:", donateIndex);
  
  await browser.close();
}
test();
