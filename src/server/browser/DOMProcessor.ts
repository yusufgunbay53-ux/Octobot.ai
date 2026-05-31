import { Page } from 'playwright';

export class DOMProcessor {
  /**
   * Tags interactive elements in the real DOM, takes a screenshot,
   * then clones the DOM to strip non-essential data for the LLM.
   * Returns both the optimized HTML and the Base64 screenshot.
   */
  static async process(page: Page): Promise<{ html: string, screenshot: string, url: string }> {
    // 1. Tag elements in the real DOM
    await page.evaluate(() => {
      const allElements = document.querySelectorAll('*');
      
      // Clear old IDs
      allElements.forEach(el => el.removeAttribute('data-agent-id'));

      let counter = 1;

      // Ensure we don't double-tag if already tagged, but since pages change,
      // we might just re-tag or increment correctly. For simplicity, retag everything.
      Array.from(allElements).forEach((el) => {
        if (el instanceof HTMLElement || el instanceof SVGElement) {
          const tag = el.tagName.toLowerCase();
          const role = el.getAttribute('role');
          const hasClick = el.hasAttribute('onclick');
          
          let isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(tag) ||
                              role === 'button' || role === 'link' || hasClick;

          // Check styling for cursor: pointer
          if (!isInteractive && el instanceof HTMLElement) {
            const style = window.getComputedStyle(el);
            if (style.cursor === 'pointer') {
              isInteractive = true;
            }
          }

          if (isInteractive) {
            // Check visibility
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
    });

    // 2. Take screenshot of the REAL DOM (now with data-agent-id hypothetically present but invisible)
    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    const screenshot = screenshotBuffer.toString('base64');

    // 3. Create a clean stripped HTML version for the LLM
    const cleanHtml = await page.evaluate(() => {
      // Clone the body to avoid destroying the real page
      const clone = document.body.cloneNode(true) as HTMLElement;

      // Remove useless tags from the clone
      const elementsToRemove = clone.querySelectorAll('script, style, svg, noscript, iframe, img, video, audio, canvas, path, meta, link, head');
      elementsToRemove.forEach(el => el.remove());

      // Clean up attributes on all elements
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

      // Extract interactive elements
      const interactiveList = Array.from(clone.querySelectorAll('[data-agent-id]'));
      
      const simplified = interactiveList.map(el => {
          // If it's empty and not an input, button, or link, ignore it
          const keepTagsIfEmpty = ['input', 'textarea', 'select', 'button', 'a'];
          if (el.textContent?.trim() === '' && !keepTagsIfEmpty.includes(el.tagName.toLowerCase())) {
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

    return {
      html: cleanHtml,
      screenshot: screenshot,
      url: page.url()
    };
  }
}
