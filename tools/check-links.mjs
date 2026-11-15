// Case-sensitive check of every relative link and asset path in the files that get published: Markdown links and
// images (rendered by GitHub), HTML href/src, CSS url(), ES-module imports and fetch() URLs of the browser code.
// Windows and macOS file systems ignore letter case, the GitHub Pages CDN does not: a link to `docs/Img.png` for
// `docs/img.png` works locally and breaks after publishing. Also flags links to files that .gitignore keeps out of the
// repository and root-relative URLs (`/data/...`), which break under the /<repo>/ prefix of a project Pages site.
// Usage: node tools/check-links.mjs [root=.]      exit code 1 when a problem is found (runs in CI)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? '.');

// Minimal .gitignore support, enough for this repository: `dir/`, `path/to/x`, `*.ext`, plain names (no negation).
const patterns = (() => {
  try {
    return fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map(s => s.trim())
      .filter(s => s && !s.startsWith('#') && !s.startsWith('!'));
  } catch { return []; }
})().concat(['.git/']);
const globRe = p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
const rules = patterns.map(p => {
  const q = p.replace(/^\/|\/$/g, '');
  if (q.includes('/')) return rel => rel === q || rel.startsWith(q + '/');   // path anchored at the root
  const re = globRe(q);
  return rel => rel.split('/').some(seg => re.test(seg));                  // name or glob at any depth
});
const ignored = rel => rules.some(r => r(rel));

/** Does `rel` exist with exactly this letter case? */
function existsExact(rel) {
  let cur = ROOT;
  for (const seg of rel.split('/').filter(Boolean)) {
    let names;
    try { names = fs.readdirSync(cur); } catch { return false; }
    if (!names.includes(seg)) return false;
    cur = path.join(cur, seg);
  }
  return true;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (ignored(rel)) continue;
    if (e.isDirectory()) walk(rel, out); else out.push(rel);
  }
  return out;
}

// external, in-page, placeholder ([LIVE URL]) and template targets are not files
const notAFile = t => !t || /^(https?:|mailto:|#|data:|blob:|javascript:|\[|\{|\/\/)/.test(t) || t.includes('${') || t.includes('`');
const problems = [], warnings = [];
let checked = 0;

function check(from, target, baseDir, kind, soft = false) {
  if (notAFile(target)) return;
  const clean = target.split('#')[0].split('?')[0];
  if (!clean) return;
  const report = msg => (soft ? warnings : problems).push(`${from}: ${kind} "${target}" ${msg}`);
  if (clean.startsWith('/')) return report('is root-relative (breaks under /<repo>/ on GitHub Pages)');
  let decoded;
  try { decoded = decodeURIComponent(clean); } catch { decoded = clean; }
  const rel = path.posix.normalize(path.posix.join(baseDir, decoded)).replace(/\/$/, '');
  checked++;
  if (rel.startsWith('..')) return report('points outside the repository');
  if (ignored(rel)) return report(`-> ${rel} is excluded by .gitignore (not published)`);
  if (!existsExact(rel)) return report(`-> ${rel} does not exist (letter case matters)`);
}

for (const file of walk('')) {
  const ext = path.extname(file).toLowerCase();
  if (!['.md', '.html', '.css', '.js', '.mjs'].includes(ext)) continue;
  const dir = path.posix.dirname(file) === '.' ? '' : path.posix.dirname(file);
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const each = (re, fn) => { for (const m of src.matchAll(re)) fn(m[1]); };
  // file names in script code (soft check: a string may name a file without loading it); HTML: inline scripts only
  const assetStrings = (base, code = src) => {
    for (const m of code.matchAll(/['"]((?:[\w-]+\/)*[\w.-]+\.(?:png|webp|jpg|svg|mp4|json|gz|pdf))['"]/g)) check(file, m[1], base, 'asset string', true);
  };
  if (ext === '.md') {
    each(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, t => check(file, t, dir, 'link'));
    each(/\b(?:src|href)="([^"]+)"/g, t => check(file, t, dir, 'html attribute'));
  } else if (ext === '.html') {
    each(/\b(?:href|src|poster)="([^"]+)"/g, t => check(file, t, dir, 'attribute'));
    each(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/g, t => check(file, t, dir, 'og:image'));
    each(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, t => check(file, t, dir, 'css url'));
    each(/fetch\(\s*['"]([^'"]+)['"]/g, t => check(file, t, dir, 'fetch'));
    for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) assetStrings(dir, m[1]);
  } else if (ext === '.css') {
    each(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, t => check(file, t, dir, 'css url'));
  } else {
    each(/\bfrom\s+['"](\.[^'"]*)['"]/g, t => check(file, t, dir, 'import'));
    each(/\bimport\(\s*['"](\.[^'"]*)['"]\s*\)/g, t => check(file, t, dir, 'dynamic import'));
    if (!file.startsWith('tools/')) {            // browser code: fetch() and assets resolve against index.html at the root
      each(/fetch\(\s*['"]([^'"]+)['"]/g, t => check(file, t, '', 'fetch'));
      assetStrings('');
    }
  }
}

console.log(`check-links: ${checked} relative references, ${problems.length} problem(s), ${warnings.length} warning(s)`);
for (const p of problems) console.log(`  PROBLEM  ${p}`);
for (const w of warnings) console.log(`  warning  ${w}`);
process.exit(problems.length ? 1 : 0);
