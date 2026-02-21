const path = require('path');
const fs = require('fs');

const compiledPath = path.join(__dirname, 'server-dist', 'index.js');
if (fs.existsSync(compiledPath)) {
  require(compiledPath);
} else {
  require('./server/index.ts');
}
