// Renders the PWA PNG icons from public/icon.svg using the pre-installed Chromium,
// so the glyph uses the same font the browser shows. Run: node apps/web/scripts/render-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(join(publicDir, "icon.svg"), "utf8");

const targets = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  // Same full-bleed art: the glyph sits in the centre, inside the 80% maskable safe zone.
  { file: "icon-maskable-512.png", size: 512 },
  // iOS ignores transparency and needs a PNG, so this uses the opaque black tile.
  { file: "apple-touch-icon.png", size: 180 },
];

// CHROMIUM_PATH optionally points at a Chromium binary when the Playwright-managed one isn't installed.
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  for (const { file, size } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">
         <div style="width:${size}px;height:${size}px">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</div>
       </body></html>`,
    );
    await page.screenshot({ path: join(publicDir, file), omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
    console.log("wrote", file);
  }
} finally {
  await browser.close();
}
