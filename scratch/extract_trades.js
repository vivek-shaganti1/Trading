const fs = require('fs');
const readline = require('readline');
const path = require('path');

async function extract() {
  const logFile = '/Users/vivekshaganti/.gemini/antigravity/brain/cc833874-e9e0-46c3-b4b0-105907c84b59/.system_generated/logs/transcript.jsonl';
  if (!fs.existsSync(logFile)) {
    console.error('Log file does not exist:', logFile);
    return;
  }
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    // Let's search for any completed_trades array
    // Since it might be escaped or in JSON, let's do a loose regex search
    if (line.includes('completed_trades') && (line.includes('net_pnl') || line.includes('gross_pnl'))) {
      // Find JSON arrays that contain objects with symbol
      // Let's parse the line
      try {
        const obj = JSON.parse(line);
        // Find any completed_trades array recursively
        function findTrades(o) {
          if (!o) return;
          if (typeof o === 'object') {
            if (Array.isArray(o.completed_trades) && o.completed_trades.length > 0) {
              console.log(`Line ${lineCount}: Found completed_trades of length ${o.completed_trades.length}`);
              fs.writeFileSync(`scratch/completed_trades_line_${lineCount}.json`, JSON.stringify(o.completed_trades, null, 2));
            }
            if (o.data && Array.isArray(o.data.completed_trades) && o.data.completed_trades.length > 0) {
              console.log(`Line ${lineCount} (data): Found completed_trades of length ${o.data.completed_trades.length}`);
              fs.writeFileSync(`scratch/completed_trades_line_${lineCount}_data.json`, JSON.stringify(o.data.completed_trades, null, 2));
            }
            for (const k of Object.keys(o)) {
              findTrades(o[k]);
            }
          }
        }
        findTrades(obj);
      } catch (e) {
        // failed to parse line, let's search raw string using regex
        const regex = /"completed_trades"\s*:\s*(\[[\s\S]*?\])/g;
        let match;
        while ((match = regex.exec(line)) !== null) {
          try {
            // Replace escaped quotes if necessary
            let rawJson = match[1];
            if (rawJson.includes('\\"')) {
              rawJson = rawJson.replace(/\\"/g, '"');
            }
            const arr = JSON.parse(rawJson);
            if (Array.isArray(arr) && arr.length > 0) {
              console.log(`Line ${lineCount} (regex): Found completed_trades array of length ${arr.length}`);
              fs.writeFileSync(`scratch/completed_trades_line_${lineCount}_regex.json`, JSON.stringify(arr, null, 2));
            }
          } catch (err) {}
        }
      }
    }
  }
}

extract().then(() => console.log('Extraction done.'));
