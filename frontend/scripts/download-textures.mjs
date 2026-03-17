/**
 * download-textures.mjs
 *
 * Downloads free planet & space textures from Solar System Scope (CC BY 4.0)
 * into frontend/public/textures/ so they can be served by the Vite dev server.
 *
 * Run once:  node scripts/download-textures.mjs
 */

import https from 'node:https';
import http  from 'node:http';
import fs    from 'node:fs';
import path  from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../public/textures');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// Solar System Scope — CC BY 4.0 — https://www.solarsystemscope.com/textures/
const BASE = 'https://www.solarsystemscope.com/textures/download/';
const TEXTURES = [
  ['milky_way.jpg',    BASE + '2k_stars_milky_way.jpg'],
  ['sun.jpg',          BASE + '2k_sun.jpg'],
  ['mercury.jpg',      BASE + '2k_mercury.jpg'],
  ['venus.jpg',        BASE + '2k_venus_atmosphere.jpg'],
  ['earth.jpg',        BASE + '2k_earth_daymap.jpg'],
  ['earth_night.jpg',  BASE + '2k_earth_nightmap.jpg'],
  ['earth_clouds.jpg', BASE + '2k_earth_clouds.jpg'],
  ['moon.jpg',         BASE + '2k_moon.jpg'],
  ['mars.jpg',         BASE + '2k_mars.jpg'],
  ['jupiter.jpg',      BASE + '2k_jupiter.jpg'],
  ['saturn.jpg',       BASE + '2k_saturn.jpg'],
  ['saturn_ring.png',  BASE + '2k_saturn_ring_alpha.png'],
  ['uranus.jpg',       BASE + '2k_uranus.jpg'],
  ['neptune.jpg',      BASE + '2k_neptune.jpg'],
];

function download(url, dest, redirects = 8) {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(dest)) {
      process.stdout.write(`  skip  ${path.basename(dest)}\n`);
      resolve(false);
      return;
    }

    const tmp  = dest + '.tmp';
    const file = fs.createWriteStream(tmp);
    const proto = url.startsWith('https:') ? https : http;

    proto.get(url, { headers: { 'User-Agent': 'space-journey-texture-downloader/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        file.destroy();
        fs.rmSync(tmp, { force: true });
        if (redirects > 0 && res.headers.location) {
          download(res.headers.location, dest, redirects - 1).then(resolve).catch(reject);
        } else {
          reject(new Error(`Redirect loop or missing Location for ${url}`));
        }
        return;
      }
      if (res.statusCode !== 200) {
        file.destroy();
        fs.rmSync(tmp, { force: true });
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        fs.renameSync(tmp, dest);
        process.stdout.write(`  ✓     ${path.basename(dest)}\n`);
        resolve(true);
      });
    }).on('error', (err) => {
      file.destroy();
      fs.rmSync(tmp, { force: true });
      reject(err);
    });
  });
}

console.log(`Downloading space textures → ${OUT}\n`);
let ok = 0, fail = 0;
for (const [name, url] of TEXTURES) {
  try {
    const downloaded = await download(url, path.join(OUT, name));
    if (downloaded !== false) ok++;
  } catch (e) {
    process.stdout.write(`  ✗     ${name}: ${e.message}\n`);
    fail++;
  }
}
console.log(`\nDone: ${ok} downloaded, ${fail} failed.`);
console.log('Textures are served at /textures/<name> in the Vite dev server.');
