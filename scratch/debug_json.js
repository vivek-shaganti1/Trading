const fs = require('fs');
try {
  const file = fs.readFileSync('db.json', 'utf8');
  JSON.parse(file);
  console.log('JSON parsed successfully!');
} catch (err) {
  console.error('Error parsing JSON:', err.message);
  if (err.message.includes('position')) {
    const pos = parseInt(err.message.match(/position (\d+)/)[1]);
    const file = fs.readFileSync('db.json', 'utf8');
    const start = Math.max(0, pos - 100);
    const end = Math.min(file.length, pos + 100);
    console.log('Context:', JSON.stringify(file.substring(start, end)));
  }
}
