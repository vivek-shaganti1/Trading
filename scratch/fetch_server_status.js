const http = require('http');

http.get('http://localhost:3000/api/status', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const status = JSON.parse(data);
      console.log('Top-level keys:', Object.keys(status));
      // Log individual fields that sound like portfolio/balance
      for (const k of Object.keys(status)) {
        if (k.toLowerCase().includes('portfolio') || k.toLowerCase().includes('balance') || k.toLowerCase().includes('valuation') || k.toLowerCase().includes('holding')) {
          console.log(`- ${k}:`, JSON.stringify(status[k], null, 2));
        }
      }
    } catch (e) {
      console.error('Failed to parse response:', e.message);
    }
  });
}).on('error', (err) => {
  console.error('Failed to query server:', err.message);
});
