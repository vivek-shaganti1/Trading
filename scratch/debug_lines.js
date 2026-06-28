const fs = require('fs');
const readline = require('readline');

async function debugLines() {
  const logFile = '/Users/vivekshaganti/.gemini/antigravity/brain/cc833874-e9e0-46c3-b4b0-105907c84b59/.system_generated/logs/transcript.jsonl';
  const fileStream = fs.createReadStream(logFile);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let lineCount = 0;
  for await (const line of rl) {
    lineCount++;
    if (lineCount === 3006 || lineCount === 3007 || lineCount === 3269 || lineCount === 4260 || lineCount === 6507) {
      console.log(`Line ${lineCount}:`);
      console.log(line.substring(0, 500));
    }
  }
}
debugLines();
