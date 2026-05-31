import { JSDOM } from 'jsdom';
const dom = new JSDOM(`
<body>
  <div>
    <h1>Hello</h1>
    <a href="/test" data-agent-id="el_1"><div><span>Test Link</span></div></a>
    <button data-agent-id="el_2">Click me</button>
    <div onclick="alert('test')" data-agent-id="el_3">Clickable div</div>
  </div>
</body>
`);
const document = dom.window.document;
const interactiveElements = Array.from(document.querySelectorAll('[data-agent-id]'));
let html = "";
interactiveElements.forEach(el => {
  const clone = el.cloneNode(true);
  html += clone.outerHTML + "\n";
});
console.log(html);
