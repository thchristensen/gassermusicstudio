'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/thchristensen/eleventy-cms-admin/main';

const FILES = [
  { url: `${BASE}/admin/index.html`,              dest: 'admin/index.html' },
  { url: `${BASE}/admin/admin.js`,                dest: 'admin/admin.js' },
  { url: `${BASE}/admin/admin.css`,               dest: 'admin/admin.css' },
  { url: `${BASE}/admin/update.js`,               dest: 'admin/update.js' },
  { url: `${BASE}/functions/github-proxy.js`,     dest: 'netlify/functions/github-proxy.js' },
];

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return get(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');

  const version = await get(`${BASE}/VERSION`).then(v => v.trim()).catch(() => 'unknown');
  console.log(`Updating eleventy-cms-admin to v${version}...`);

  for (const { url, dest } of FILES) {
    const content = await get(url);
    const destPath = path.join(projectRoot, dest);
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, content, 'utf8');
    console.log('  ' + dest);
  }

  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
