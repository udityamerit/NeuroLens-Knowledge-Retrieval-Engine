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

  // Recusive directory copy helper
  function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) {
      fs.mkdirSync(to, { recursive: true });
    }
    fs.readdirSync(from).forEach(element => {
      const fromPath = path.join(from, element);
      const toPath = path.join(to, element);
      if (fs.lstatSync(fromPath).isDirectory()) {
        copyFolderSync(fromPath, toPath);
      } else {
        fs.copyFileSync(fromPath, toPath);
      }
    });
  }

  // Copy dist folder to Android assets/www
  const assetsWwwPath = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'www');
  try {
    if (fs.existsSync(assetsWwwPath)) {
      fs.rmSync(assetsWwwPath, { recursive: true, force: true });
      console.log('Cleaned old Android assets/www folder.');
    }
    copyFolderSync(path.join(__dirname, 'dist'), assetsWwwPath);
    console.log('Successfully copied all built assets to:', assetsWwwPath);
  } catch (err) {
    console.error('Failed to copy built assets to Android assets folder:', err);
    process.exit(1);
  }

} else {
  console.error('Failed to find legacy assets in index.html');
  process.exit(1);
}
