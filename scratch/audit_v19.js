const fs = require('fs');
const files = [
  './backend/tradingBot.js',
  './backend/broker.js',
  './backend/agent17_execution.js'
];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  console.log(`\n=== File: ${file} ===`);
  
  lines.forEach((line, index) => {
    // Only search within trading logic
    if (line.includes('return') || line.includes('continue') || line.includes('catch') || line.includes('break')) {
      if (
        (line.includes('if') || line.includes('return') || line.includes('continue')) 
        && !line.includes('console.log') 
        && !line.includes('console.warn') 
        && !line.includes('console.error') 
        && !line.includes('alert')
      ) {
        let contextStart = Math.max(0, index - 5);
        let contextEnd = Math.min(lines.length - 1, index + 5);
        let hasOrderMethod = false;
        for (let i = contextStart; i <= contextEnd; i++) {
          if (lines[i].includes('placeOrder') || lines[i].includes('buyOrder') || lines[i].includes('sellOrder') || lines[i].includes('executeOrder')) {
            hasOrderMethod = true;
          }
        }
        if (hasOrderMethod) {
          console.log(`\nFound potential silent exit at line ${index + 1}:`);
          for (let i = contextStart; i <= contextEnd; i++) {
            console.log(`${i+1}: ${lines[i]}`);
          }
        }
      }
    }
  });
});
