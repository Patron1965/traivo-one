process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
process.on('SIGTERM', () => {
  console.log('Received SIGTERM');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('Received SIGINT');
  process.exit(0);
});
require('./server-dist/app.js');
