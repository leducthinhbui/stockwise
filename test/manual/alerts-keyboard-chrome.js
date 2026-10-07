// SIT774 Task 10.3HD - keyboard behaviour of the alerts page in real Chrome
//
// Drives a REAL Chrome (headless, throwaway profile) through the Portfolio News
// Alerts page, so the parts a unit test cannot reach are actually exercised:
// the service worker, the push subscription with Chrome's push service, and the
// notification Chrome shows.
//
// How to run:
//   1. npm start                      (server on http://localhost:3000)
//   2. npm install --no-save puppeteer-core
//   3. node test/manual/alerts-keyboard-chrome.js
// Set CHROME_PATH if Chrome is not at the macOS default location. Push needs
// internet access (Chrome contacts its push service). Not part of `npm test`.

const puppeteer = require('puppeteer-core'); const fs=require('fs'), os=require('os');
const ORIGIN='http://localhost:3000'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const browser = await puppeteer.launch({executablePath:(process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),headless:true,userDataDir:fs.mkdtempSync(os.tmpdir()+'/sw-e2e-')});
  const ctx = browser.defaultBrowserContext(); await ctx.overridePermissions(ORIGIN,['notifications']);
  const page = await ctx.newPage();
  await page.goto(ORIGIN+'/alerts.html',{waitUntil:'networkidle0'});
  await page.click('[data-user-id="1"]'); await page.waitForSelector('#signedIn:not(.d-none)');
  await page.evaluate(()=>fetch('/api/alerts',{method:'DELETE'})); await page.reload({waitUntil:'networkidle0'}); await sleep(1000);
  const st = () => page.evaluate(()=>({focus:document.activeElement.id||document.activeElement.tagName, lockChecked:document.getElementById('showOnLock').checked, lockAria:document.getElementById('showOnLock').getAttribute('aria-disabled'), notifyChecked:document.getElementById('notifyImmediately').checked}));
  await page.focus('#notifyImmediately');
  await page.keyboard.press('Tab');
  console.log('1. Tab from "Notify" lands on:', JSON.stringify(await st()));
  await page.keyboard.press('Space'); await sleep(300);
  console.log('2. Space on the inert lock box (alerts off) changes nothing:', JSON.stringify(await st()));
  const described = await page.evaluate(()=>{ const i=document.getElementById('showOnLock'); const ids=i.getAttribute('aria-describedby').split(' '); return ids.map(id=>[id, (document.getElementById(id)||{}).textContent]); });
  console.log('3. Screen-reader description of the inert box:', JSON.stringify(described));
  await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
  await page.keyboard.press('Space'); await sleep(4500);
  console.log('4. Space on "Notify" turns alerts on:', JSON.stringify(await st()));
  await page.keyboard.press('Tab'); await page.keyboard.press('Space'); await sleep(800);
  console.log('5. Tab, Space on the lock box now ticks it:', JSON.stringify(await st()));
  const labels = await page.evaluate(()=>[...document.querySelectorAll('input,button,select,textarea')].filter(e=>!e.closest('.d-none')).map(e=>({id:e.id||e.className.slice(0,20), name:(e.labels&&e.labels[0]?e.labels[0].textContent:(e.getAttribute('aria-label')||e.textContent)).trim().slice(0,45)})).filter(x=>!x.name));
  console.log('6. Visible controls with NO accessible name:', JSON.stringify(labels));
  await browser.close();
})();
