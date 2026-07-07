const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const exe = process.env.REPLIT_PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch(exe ? { executablePath: exe } : {});
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1480, height: 1000 } });
  const fileUrl = 'file://' + path.resolve('exports/grundmodell.html');
  await page.goto(fileUrl, { waitUntil: 'networkidle' });

  const dims = await page.evaluate(() => ({
    w: 1480,
    h: Math.ceil(document.body.scrollHeight)
  }));
  await page.setViewportSize({ width: dims.w, height: dims.h });

  await page.screenshot({ path: 'exports/traivo-grundmodell.png', fullPage: true });
  await page.pdf({
    path: 'exports/traivo-grundmodell.pdf',
    width: dims.w + 'px',
    height: (dims.h + 2) + 'px',
    printBackground: true,
    pageRanges: '1'
  });

  await browser.close();
  console.log('rendered', JSON.stringify(dims));
})().catch(e => { console.error('RENDER_ERROR', e); process.exit(1); });
