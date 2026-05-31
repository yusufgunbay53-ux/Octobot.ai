import fs from 'fs';

const files = [
  'src/App.tsx',
  'src/server/routes/browserApi.ts',
  'src/server/browser/BrowserService.ts',
  'src/lib/gemini.ts'
];

files.forEach(f => {
  let content = fs.readFileSync(f, 'utf-8');
  content = content.replace(/\\`/g, '\`');
  content = content.replace(/\\\$/g, '\$');
  fs.writeFileSync(f, content);
  console.log('Fixed', f);
});
