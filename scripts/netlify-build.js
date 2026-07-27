// Copia public/ a dist/ e inyecta GA_MEASUREMENT_ID en los HTML, igual que
// hace server.js server-side para el dev local con Express.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'public');
const DEST = path.join(__dirname, '..', 'dist');
const GA_MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID || '';

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else if (entry.name.endsWith('.html')) {
      const html = fs.readFileSync(srcPath, 'utf8');
      fs.writeFileSync(destPath, html.replace(/__GA_MEASUREMENT_ID__/g, GA_MEASUREMENT_ID));
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

fs.rmSync(DEST, { recursive: true, force: true });
copyDir(SRC, DEST);
console.log(`✔ dist/ generado desde public/ (GA_MEASUREMENT_ID ${GA_MEASUREMENT_ID ? 'configurado' : 'vacío'})`);
