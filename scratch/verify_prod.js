const https = require('https');

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({status: res.statusCode, body: JSON.parse(data)}); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  const url = 'https://trading-s7ca.onrender.com';
  console.log('Testing', url);
  try {
    const res = await fetchJSON(`${url}/api/status`);
    console.log(JSON.stringify(res.body, null, 2));
  } catch (err) {
    console.error('Failed', err);
  }
}
run();
