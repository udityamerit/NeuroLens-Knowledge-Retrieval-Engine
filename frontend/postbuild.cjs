const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, 'dist', 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

// Find polyfill src
const polyfillMatch = html.match(/id="vite-legacy-polyfill"\s+src="([^"]+)"/);
// Find legacy entry data-src
const entryMatch = html.match(/id="vite-legacy-entry"\s+data-src="([^"]+)"/);

if (polyfillMatch && entryMatch) {
  const polyfillSrc = polyfillMatch[1];
  const entrySrc = entryMatch[1];
  console.log('Found polyfill src:', polyfillSrc);
  console.log('Found legacy entry src:', entrySrc);

  // Remove all <script type="module"> tags (both inline and src)
  html = html.replace(/<script type="module"[^>]*>([\s\S]*?)<\/script>/gi, '');
  html = html.replace(/<script type="module"[\s\S]*?><\/script>/gi, '');
  // Remove any modern entry script tags (e.g. index-*.js)
  html = html.replace(/<script[^>]*src="[^"]+assets\/index-[^"]+\.js"[^>]*><\/script>/gi, '');

  // Remove the Safari nomodule fix scripts and other nomodule tags
  html = html.replace(/<script nomodule[^>]*>([\s\S]*?)<\/script>/gi, '');
  html = html.replace(/<script nomodule[\s\S]*?><\/script>/gi, '');

  // Inject a clean legacy loader in body
  const replacement = `
    <script id="vite-legacy-polyfill" src="${polyfillSrc}"></script>
    <script id="vite-legacy-entry" data-src="${entrySrc}">
      System.import(document.getElementById('vite-legacy-entry').getAttribute('data-src'));
    </script>
  `;
  
  // Put replacement before </body>
  html = html.replace('</body>', replacement + '\n</body>');
  
  fs.writeFileSync(indexPath, html, 'utf8');
  console.log('Successfully rewrote index.html to use pure legacy loader.');
} else {
  console.error('Failed to find legacy assets in index.html');
  process.exit(1);
}
