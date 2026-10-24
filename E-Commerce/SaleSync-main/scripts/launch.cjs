const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(command, [url], { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => console.log('Open the address shown above in your browser.'));
  child.unref();
}

function prepareDependencies() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('Install Node.js 24 or later, then reopen the starter.');
  const fingerprint = createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'package-lock.json'))).digest('hex');
  const stamp = path.join(ROOT, 'node_modules', '.salesync-lock');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === fingerprint && fs.existsSync(path.join(ROOT, 'node_modules/nodemailer/package.json'))) return;
  console.log('Installing the locked dependencies (internet is required on first start)...');
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd ci'], { cwd: ROOT, stdio: 'inherit', windowsHide: true })
    : spawnSync('npm', ['ci'], { cwd: ROOT, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error('Dependency installation failed. Check your internet connection and Node.js installation, then reopen the starter.');
  fs.writeFileSync(stamp, fingerprint);
}

async function main(mode) {
  if (!['app', 'demo', 'presentation'].includes(mode)) throw Error('Choose app, demo or presentation.');
  process.chdir(ROOT);
  prepareDependencies();
  if (mode === 'demo' || mode === 'presentation') {
    const { pathToFileURL } = require('node:url');
    const demo = await require('./local-demo.cjs').startDemo(mode === 'presentation' ? { directory: path.join(ROOT, 'data/presentation'), port: 3002, presentation: true } : {});
    console.log(`\nLOCAL DEMO: ${demo.config.origin}\nAccounts: ${demo.accountsFile}\nLocal email inbox: ${demo.inboxFile}\nKeep this window open. Press Ctrl+C to stop.\n`);
    openBrowser(pathToFileURL(demo.accountsFile).href);
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await demo.close(); process.exit(0); });
    return;
  }
  const envFile = path.join(ROOT, '.env');
  if (!fs.existsSync(envFile)) fs.copyFileSync(path.join(ROOT, '.env.example'), envFile, fs.constants.COPYFILE_EXCL);
  process.loadEnvFile(envFile);
  const origin = process.env.APP_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
  console.log('Starting SaleSync. Gmail is optional for starting the site, but account verification and password reset emails will not be sent until Gmail is configured in this computer’s local .env file.');
  const child = spawn(process.execPath, ['backend/start.cjs'], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  let ended = false;
  child.once('error', error => { ended = true; console.error(error.message); process.exitCode = 1; });
  child.once('exit', code => { ended = true; process.exitCode = code || 0; });
  for (let attempt = 0; attempt < 30 && !ended; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    if (ended) break;
    try {
      const response = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1000) });
      if (response.ok && !ended) { openBrowser(origin); break; }
    } catch {}
  }
}

if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepareDependencies, main };
