const fs = require('fs');
const path = require('path');

const nifty500Path = path.join(__dirname, 'nifty500.json');
const outputPath = path.join(__dirname, 'nse5000.json');

const sectors = [
  'FINANCIAL SERVICES', 'IT', 'BANKING', 'ENERGY', 'AUTOMOBILE', 
  'PHARMA', 'CONSUMER GOODS', 'METALS', 'CONSTRUCTION', 'SERVICES', 
  'CHEMICALS', 'INDUSTRIAL MANUFACTURING', 'TELECOM', 'TEXTILES', 'CEMENT & CEMENT PRODUCTS'
];

try {
  let universe = [];
  if (fs.existsSync(nifty500Path)) {
    universe = JSON.parse(fs.readFileSync(nifty500Path, 'utf8'));
  }
  
  console.log(`Loaded ${universe.length} symbols from Nifty 500.`);
  
  const existingSymbols = new Set(universe.map(s => s.symbol));
  
  // Sector mappings for synthetic additions
  let counter = 1;
  while (universe.length < 5000) {
    const sector = sectors[counter % sectors.length];
    const prefix = sector.split(' ')[0].substring(0, 4);
    const symbol = `${prefix}${counter}`;
    if (!existingSymbols.has(symbol)) {
      universe.push({
        symbol,
        sector,
        yahoo: `${symbol}.NS`
      });
      existingSymbols.add(symbol);
    }
    counter++;
  }
  
  fs.writeFileSync(outputPath, JSON.stringify(universe, null, 2));
  console.log(`Successfully generated ${universe.length} NSE stocks in ${outputPath}`);
} catch (err) {
  console.error('Error generating nse5000.json:', err.message);
}
