const fs = require('fs');
const path = require('path');

// 1. Fix backend/ files
const backendDir = path.join(__dirname, '../backend');
if (fs.existsSync(backendDir)) {
  const files = fs.readdirSync(backendDir);
  files.forEach(file => {
    if (file.endsWith('.js')) {
      const filePath = path.join(backendDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes("require('./config')")) {
        content = content.replace(/require\('\.\/config'\)/g, "require('../shared/config')");
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated config import in: backend/${file}`);
      }
    }
  });
}

// 2. Fix scratch/ files
const scratchDir = __dirname;
if (fs.existsSync(scratchDir)) {
  const files = fs.readdirSync(scratchDir);
  files.forEach(file => {
    if (file.endsWith('.js')) {
      const filePath = path.join(scratchDir, file);
      let content = fs.readFileSync(filePath, 'utf8');
      if (content.includes("require('../shared/config')")) {
        content = content.replace(/require\('\.\.\/config'\)/g, "require('../shared/config')");
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated config import in: scratch/${file}`);
      }
    }
  });
}

console.log('Config import updates completed successfully!');
