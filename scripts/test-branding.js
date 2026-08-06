/**
 * Vérifie l’intégration du logo WarOps.
 * node scripts/test-branding.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
let ok = 0;
let ko = 0;

function assert(cond, msg) {
  if (cond) {
    ok += 1;
    console.log('  ✓', msg);
  } else {
    ko += 1;
    console.error('  ✗', msg);
  }
}

const logoPath = path.join(root, 'public/assets/branding/warops-logo.png');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

console.log('\n=== Branding ===');
assert(fs.existsSync(logoPath), 'warops-logo.png présent');
const logoBuf = fs.readFileSync(logoPath);
assert(logoBuf.length > 1000, `taille logo (${logoBuf.length})`);
assert(
  logoBuf[0] === 0x89 && logoBuf[1] === 0x50 && logoBuf[2] === 0x4e && logoBuf[3] === 0x47,
  'signature PNG'
);
assert(html.includes('assets/branding/warops-logo.png'), 'chemin HTML');
assert(html.includes('rel="icon"'), 'favicon');
assert(html.includes('brand-logo--login'), 'classe login');
assert(html.includes('brand-logo--nav'), 'classe nav');
assert(html.includes('data-brand-logo'), 'data-brand-logo');
assert(html.includes("addEventListener('error'"), 'handler error fallback');
assert(css.includes('object-fit: contain'), 'object-fit contain');
assert(css.includes('background: transparent'), 'fond transparent CSS');
assert(css.includes('auth-brand.has-brand-logo'), 'titre secours login');
assert(css.includes('@media (max-width: 520px)'), 'media mobile');

function serveOnce() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent((req.url || '/').split('?')[0]);
      // Comme Vercel : le contenu de /public est servi à la racine.
      let rel = url === '/' ? 'index.html' : url.replace(/^\//, '');
      if (rel.startsWith('assets/')) rel = path.join('public', rel);
      const file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) {
        res.writeHead(403);
        res.end();
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('missing');
          return;
        }
        const ext = path.extname(file);
        const types = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.png': 'image/png',
          '.js': 'text/javascript',
        };
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      Promise.all([
        fetch(`${base}/assets/branding/warops-logo.png`),
        fetch(`${base}/`),
      ])
        .then(async ([logoRes, pageRes]) => {
          const bytes = (await logoRes.arrayBuffer()).byteLength;
          const pageHtml = await pageRes.text();
          assert(logoRes.status === 200, `HTTP logo 200 (got ${logoRes.status})`);
          assert(logoRes.headers.get('content-type')?.includes('png'), 'content-type png');
          assert(bytes === logoBuf.length, 'HTTP bytes = fichier');
          assert(pageRes.status === 200, 'HTTP page 200');
          assert(pageHtml.includes('brand-logo--login'), 'page sert le markup logo');
          server.close(() => resolve());
        })
        .catch((error) => {
          server.close(() => reject(error));
        });
    });
  });
}

serveOnce()
  .then(() => {
    console.log(`\n=== Résultat ===\n${ok} OK · ${ko} KO`);
    process.exit(ko ? 1 : 0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
