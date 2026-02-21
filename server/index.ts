const path = require('path');
const fs = require('fs');

const compiledApp = path.resolve(__dirname, '..', 'server-dist', 'app.js');
if (fs.existsSync(compiledApp)) {
  require(compiledApp);
} else {
  require('./app');
}
