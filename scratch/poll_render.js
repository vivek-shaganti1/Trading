const https = require('https');

function fetchStatus() {
  return new Promise((resolve) => {
    https.get('https://trading-s7ca.onrender.com/api/status', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ code: res.statusCode, data: json });
        } catch(e) {
          resolve({ code: res.statusCode, data: null });
        }
      });
    }).on('error', () => resolve({ code: 0, data: null }));
  });
}

async function poll() {
  console.log("Waiting for Render to deploy (checking every 10s)...");
  for (let i = 0; i < 30; i++) {
    const res = await fetchStatus();
    if (res.code === 200 && !res.data.error) {
      console.log("DEPLOYMENT LIVE!");
      console.log(JSON.stringify(res.data, null, 2));
      process.exit(0);
    }
    console.log(`Attempt ${i+1}: HTTP ${res.code} - waiting...`);
    await new Promise(r => setTimeout(r, 10000));
  }
  console.log("Timeout waiting for deployment.");
  process.exit(1);
}
poll();
