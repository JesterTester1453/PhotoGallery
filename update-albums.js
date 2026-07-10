// update-gallery.js
// Scans /photos (one subfolder = one album) and keeps index.html in sync.
//
// Rules this script follows:
//  - Every immediate subfolder of /photos is an album.
//  - New photo in an album folder -> a new <figure> is appended to that
//    album's section, with an empty caption for you to fill in.
//  - Photo removed from an album folder -> only that photo's <figure> is
//    removed. Existing captions on every other photo are left untouched.
//  - New album folder -> a new button + a new gallery section are created
//    automatically (inserted after the existing ones).
//  - Album folders are NEVER auto-removed from index.html, even if the
//    folder is deleted or renamed on disk. This is intentional (per your
//    answer to Q3/Q5) so you never lose captions by accident. If a folder
//    disappears or is renamed, the script just leaves the old section
//    alone (and tells you about it) and creates a new section for the new
//    folder name if there is one. Delete the old section by hand if you
//    actually want it gone.
//
// Run manually with: node update-gallery.js

const fs = require('fs');
const path = require('path');

const PHOTOS_DIR = path.join(__dirname, 'photos');
const INDEX_FILE = path.join(__dirname, 'index.html');
const ALL_GALLERIES_END = '<!-- ALL GALLERIES PLACEHOLDER END -->';
const VALID_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// ---------- helpers ----------

function slugify(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function toLabel(name) {
  return name
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w.length ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function getAlbumFolders() {
  if (!fs.existsSync(PHOTOS_DIR)) return [];
  return fs
    .readdirSync(PHOTOS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function getPhotoFiles(folderName) {
  const dir = path.join(PHOTOS_DIR, folderName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => VALID_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .sort();
}

function buildFigureBlock(id, folderName, filename) {
  const alt = path
    .basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .trim();

  return `<figure class="photo">
                <input type="checkbox" id="${id}" class="photo-toggle">
                <label for="${id}" class="photo-tap">
                  <img src="photos/${folderName}/${filename}" alt="${alt}" loading="lazy">
                  <figcaption></figcaption>
                </label>
              </figure>`;
}

function extractFigureBlocks(region) {
  const figureRegex = /<figure class="photo">[\s\S]*?<\/figure>/g;
  return region.match(figureRegex) || [];
}

function getFilenameFromBlock(block) {
  const match = block.match(/src="([^"]+)"/);
  if (!match) return null;
  return match[1].split('/').pop();
}

function getMaxSlugId(text, slug) {
  const regex = new RegExp(`id="${slug}_p(\\d+)"`, 'g');
  let max = 0;
  let m;
  while ((m = regex.exec(text))) {
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

function getExistingAlbumSlugs(html) {
  const regex = /<div id="([a-zA-Z0-9_]+)_gallery" class="gallery-grid gallery/g;
  const slugs = new Set();
  let m;
  while ((m = regex.exec(html))) {
    slugs.add(m[1]);
  }
  return slugs;
}

// ---------- syncing photos inside an existing album ----------

function syncAlbumPhotos(html, slug, folderName) {
  const openTag = `<div id="${slug}_gallery"`;
  const openIdx = html.indexOf(openTag);
  if (openIdx === -1) return { html, added: [], removed: [] };

  const closeMatch = /<\/div>\s*<\/div>/.exec(html.slice(openIdx));
  if (!closeMatch) return { html, added: [], removed: [] };
  const blockEndIdx = openIdx + closeMatch.index + closeMatch[0].length;
  const block = html.slice(openIdx, blockEndIdx);

  const markerMatch = block.match(/<!--\s*([\w-]+)\s+PLACEHOLDER START\s*-->/);
  if (!markerMatch) return { html, added: [], removed: [] };
  const markerName = markerMatch[1];
  const startMarker = `<!-- ${markerName} PLACEHOLDER START -->`;
  const endMarker = `<!-- ${markerName} PLACEHOLDER END -->`;

  const startIdx = block.indexOf(startMarker);
  const endIdx = block.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) return { html, added: [], removed: [] };

  const before = block.slice(0, startIdx + startMarker.length);
  const oldFiguresRegion = block.slice(startIdx + startMarker.length, endIdx);
  const after = block.slice(endIdx);

  const diskFiles = getPhotoFiles(folderName);
  const diskFilesSet = new Set(diskFiles);

  const existingBlocks = extractFigureBlocks(oldFiguresRegion);
  const keptBlocks = [];
  const removed = [];

  existingBlocks.forEach((fig) => {
    const filename = getFilenameFromBlock(fig);
    if (filename && diskFilesSet.has(filename)) {
      keptBlocks.push(fig);
    } else {
      removed.push(filename);
    }
  });

  const keptFilenames = new Set(
    keptBlocks.map(getFilenameFromBlock).filter(Boolean)
  );
  const newFiles = diskFiles.filter((f) => !keptFilenames.has(f));

  let nextId = getMaxSlugId(block, slug) + 1;
  const newBlocks = newFiles.map((file) => {
    const b = buildFigureBlock(`${slug}_p${nextId}`, folderName, file);
    nextId += 1;
    return b;
  });

  const allBlocks = [...keptBlocks, ...newBlocks];
  const newFiguresRegion = allBlocks.length
    ? `\n              ${allBlocks.join('\n\n              ')}\n\n            `
    : '\n            ';

  const newBlock = `${before}${newFiguresRegion}${after}`;
  const newHtml = html.slice(0, openIdx) + newBlock + html.slice(blockEndIdx);

  return { html: newHtml, added: newFiles, removed };
}

// ---------- creating a brand new album ----------

function buildNewAlbumSection(slug, folderName, files) {
  const label = toLabel(folderName);
  const figureBlocks = files.map((file, i) =>
    buildFigureBlock(`${slug}_p${i + 1}`, folderName, file)
  );
  const figuresRegion = figureBlocks.length
    ? `\n              ${figureBlocks.join('\n\n              ')}\n\n            `
    : '\n            ';

  const button = `            <button class="album-btn"
                    onclick="showGallery('${slug}_gallery', this)">
                ${label}
            </button>`;

  const div = `    <!-- ${label} -->
    <div id="${slug}_gallery" class="gallery-grid gallery">
        <div class="gallery-grid">

            <!-- ${slug} PLACEHOLDER START -->${figuresRegion}<!-- ${slug} PLACEHOLDER END -->

            </div>
        </div>`;

  return { button, div };
}

function insertButton(html, buttonHtml) {
  const selectorOpenMarker = '<div class="album-selector">';
  const openIdx = html.indexOf(selectorOpenMarker);
  if (openIdx === -1) throw new Error('Could not find <div class="album-selector"> in index.html');
  const closeIdx = html.indexOf('</div>', openIdx);
  return html.slice(0, closeIdx) + '\n\n' + buttonHtml + '\n' + html.slice(closeIdx);
}

function insertAlbumDiv(html, divHtml) {
  const idx = html.indexOf(ALL_GALLERIES_END);
  if (idx === -1) throw new Error('Could not find "ALL GALLERIES PLACEHOLDER END" marker in index.html');
  return html.slice(0, idx) + divHtml + '\n\n\n' + html.slice(idx);
}

// ---------- main ----------

function updateGallery() {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');

  const albumFolders = getAlbumFolders();
  const existingSlugs = getExistingAlbumSlugs(html);

  const synced = [];
  const created = [];

  albumFolders.forEach((folderName) => {
    const slug = slugify(folderName);

    if (existingSlugs.has(slug)) {
      const result = syncAlbumPhotos(html, slug, folderName);
      html = result.html;
      if (result.added.length || result.removed.length) {
        synced.push({ folderName, added: result.added, removed: result.removed });
      }
    } else {
      const files = getPhotoFiles(folderName);
      const { button, div } = buildNewAlbumSection(slug, folderName, files);
      html = insertButton(html, button);
      html = insertAlbumDiv(html, div);
      created.push({ folderName, photoCount: files.length });
      existingSlugs.add(slug); // so a duplicate-named folder later in the loop won't double-create
    }
  });

  const diskSlugs = new Set(albumFolders.map(slugify));
  const orphaned = [...existingSlugs].filter((slug) => !diskSlugs.has(slug));

  fs.writeFileSync(INDEX_FILE, html, 'utf8');

  // ---------- report ----------
  if (created.length === 0 && synced.length === 0) {
    console.log('No changes: gallery already matches the photos folder.');
  }
  created.forEach((c) => {
    console.log(`+ New album "${c.folderName}" created with ${c.photoCount} photo(s).`);
  });
  synced.forEach((s) => {
    if (s.added.length) console.log(`+ [${s.folderName}] added: ${s.added.join(', ')}`);
    if (s.removed.length) console.log(`- [${s.folderName}] removed: ${s.removed.join(', ')}`);
  });
  if (orphaned.length) {
    console.log(
      `\nNote: these albums still exist in index.html but their folder is missing (renamed or deleted): ${orphaned.join(
        ', '
      )}. They were left untouched on purpose. Delete their section manually if you no longer want them.`
    );
  }
}

updateGallery();