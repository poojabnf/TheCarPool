const fs = require('fs');
const files = ['GRAPH_REPORT.md', 'graph.json', 'manifest.json'];

files.forEach(f => {
  const p = 'graphify-out/' + f;
  if (fs.existsSync(p)) {
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace(/SafarMate/g, 'TheCarPool')
         .replace(/Safarmate/g, 'TheCarPool')
         .replace(/safarmate/g, 'thecarpool');
    fs.writeFileSync(p, c);
  }
});
console.log('Update complete.');
