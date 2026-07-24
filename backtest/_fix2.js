var fs = require('fs');
var src = fs.readFileSync('run_v3.js', 'utf8');

// Fix broken string at line 367
var lines = src.split('\n');
for (var i = 0; i < lines.length; i++) {
  if (lines[i].indexOf('=== V11 vs V8 ===') >= 0 && lines[i].indexOf('lines.push') >= 0) {
    // This line has the broken string - fix it
    lines[i] = '  lines.push("\\n=== V11 vs V8 ===")';
  }
  // Fix V10 section using sV11 instead of sV10
  if (lines[i].indexOf('=== V10 vs V8 ===') >= 0) {
    // Mark start of V10 section
    for (var j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      lines[j] = lines[j].replace('opt = sV11[', 'opt = sV10[');
    }
  }
}

src = lines.join('\n');
fs.writeFileSync('run_v3.js', src, 'utf8');
console.log('Fixed line 367');
