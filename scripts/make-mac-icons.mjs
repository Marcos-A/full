// Draws the Mac app icon and the document icons as .icns files in src-tauri/icons/, from the brand
// mark in public/icon.svg. The results are committed, so this only runs when the art changes:
// scripts/in-docker.sh node scripts/make-mac-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const out = 'src-tauri/icons';
const brand = readFileSync('public/icon.svg', 'utf8');

// macOS expects the shape to fill 824 of 1024 pixels, or it looks too big beside other icons.
const inner = brand.replace(/^<svg[^>]*>|<\/svg>\s*$/g, '');
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(100 100) scale(1.609375)">${inner}</g></svg>`;

const mark = '<path d="M184 400V136A24 24 0 0 1 208 112H296L344 160V176H248V400Z" fill="#6B4FC4"/><path d="M296 112V160H344Z" fill="#000" fill-opacity=".3"/><rect x="240" y="224" width="104" height="64" fill="#6B4FC4"/>';

/** A page with a folded corner, the brand mark and, where it can be read, the file type. */
const documentIcon = (label) => (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <path d="M232 64H652L872 284V904A56 56 0 0 1 816 960H232A56 56 0 0 1 176 904V120A56 56 0 0 1 232 64Z" fill="#FBFAFE" stroke="#000" stroke-opacity=".18" stroke-width="8"/>
    <path d="M652 64L872 284H692A40 40 0 0 1 652 244Z" fill="#DCD3F5"/>
    <g transform="translate(524 ${size >= 64 ? 470 : 540}) scale(${size >= 64 ? 1.05 : 1.45}) translate(-264 -256)">${mark}</g>
    ${size >= 64 ? `<text x="524" y="860" text-anchor="middle" font-family="Liberation Sans, Arial, sans-serif" font-weight="700" font-size="150" fill="#6B4FC4">${label}</text>` : ''}
  </svg>`;

// PNG-based entries, which every macOS this app supports reads.
const ENTRIES = [
  ['icp4', 16],
  ['icp5', 32],
  ['ic11', 32],
  ['icp6', 64],
  ['ic12', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic13', 256],
  ['ic09', 512],
  ['ic14', 512],
  ['ic10', 1024],
];

function icns(chunks) {
  const parts = chunks.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

async function write(name, draw) {
  const rendered = new Map();
  for (const [, size] of ENTRIES) if (!rendered.has(size)) rendered.set(size, await render(draw(size), size));
  writeFileSync(`${out}/${name}.icns`, icns(ENTRIES.map(([type, size]) => [type, rendered.get(size)])));
  writeFileSync(`test-results/${name}.png`, rendered.get(512));
}

await write('icon', () => appIcon);
await write('document-markdown', documentIcon('MD'));
await write('document-csv', documentIcon('CSV'));
await write('document-text', documentIcon('TXT'));
await browser.close();
