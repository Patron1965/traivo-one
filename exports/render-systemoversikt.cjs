const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const exe = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1280, height: 720 } });
  const fileUrl = 'file://' + path.resolve('exports/systemoversikt.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });
  await page.pdf({
    path: 'exports/traivo-systemoversikt.pdf',
    width: '1280px',
    height: '720px',
    printBackground: true
  });
  await browser.close();
  console.log('done');
})().catch(e => { console.error('RENDER_ERROR', e); process.exit(1); });
