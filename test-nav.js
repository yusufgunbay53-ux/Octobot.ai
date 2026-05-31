async function run() {
  const r1 = await fetch('http://localhost:3000/api/browser/init', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'});
  const session = await r1.json();
  const sessionId = session.sessionId;
  console.log("Got session:", sessionId);
  
  const r2 = await fetch('http://localhost:3000/api/browser/action', {
    method: 'POST', 
    headers: {'content-type': 'application/json'}, 
    body: JSON.stringify({sessionId, action: 'NAVIGATE', params: {url: 'https://news.ycombinator.com'}})
  });
  console.log("Nav result:", await r2.text());
}
run();
