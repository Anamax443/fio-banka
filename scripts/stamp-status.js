const fs = require('fs');
const { execSync } = require('child_process');

const file = 'docs/project-status.html';
let html = fs.readFileSync(file, 'utf-8');

const commit = execSync('git rev-parse --short HEAD').toString().trim();
const now = new Date().toLocaleString('cs-CZ', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});

html = html.replace(/__BUILD_COMMIT__/g, commit);
html = html.replace(/__BUILD_TIME__/g, now);

fs.writeFileSync(file, html);
console.log(`Stamped: commit=${commit}, time=${now}`);
