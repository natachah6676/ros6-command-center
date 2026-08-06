/**
 * Attendre le statut Vercel d’un commit puis vérifier le logo live.
 * node scripts/wait-vercel.js <sha>
 */
const sha = process.argv[2] || '0788925';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status() {
  const res = await fetch(
    `https://api.github.com/repos/natachah6676/ros6-command-center/commits/${sha}/status`
  );
  return res.json();
}

async function main() {
  for (let i = 1; i <= 36; i += 1) {
    const j = await status();
    const s = j.statuses && j.statuses[0];
    console.log(`[${i}] state=${j.state} desc=${s?.description || '—'}`);
    if (j.state === 'success' && String(s?.description || '').includes('completed')) break;
    if (j.state === 'failure' || j.state === 'error') {
      console.error('Déploiement en échec');
      process.exit(1);
    }
    await sleep(8000);
  }

  const logo = await fetch('https://warops.vercel.app/assets/branding/warops-logo.png');
  const buf = Buffer.from(await logo.arrayBuffer());
  console.log(`logo_http=${logo.status} size=${buf.length}`);

  const page = await fetch('https://warops.vercel.app/');
  const html = await page.text();
  for (const c of [
    'assets/branding/warops-logo.png',
    'brand-logo--login',
    'brand-logo--nav',
    'css/styles.css?v=20260806-brand3',
  ]) {
    console.log(`${html.includes(c) ? 'FOUND' : 'MISSING'}: ${c}`);
  }

  if (logo.status !== 200 || buf.length < 1000) process.exit(1);
  console.log('VERCEL_OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
