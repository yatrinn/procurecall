/** Screenshot dry-run of the 7 tech-video scenes. Run: pnpm tsx scripts/preview-scenes.ts */
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const GH = 'https://github.com/yatrinn/procurecall/blob/main';
const PROD = 'https://procurecall.vercel.app';
const OUT = '/tmp/pc-tech-video/preview';

const urls: Array<[string, string]> = [
  ['s1-truth', `${GH}/src/core/truth-layer.ts#L47-L71`],
  ['s2-levers', `${GH}/src/negotiation/buyer-tools.ts#L226-L240`],
  ['s3-policy', `${GH}/data/supplier-policies/equipment-rental-stuttgart.json#L64-L80`],
  ['s4-voice-board', `${PROD}/board/435cffab-b7b2-4e21-8f33-658db364cf97`],
  ['s5-decision', `${PROD}/decision/1251040d-6b6d-4ab0-a726-1616dbc599c0`],
  ['s6-lab', `${PROD}/lab`],
  ['s7-request', `${PROD}/request`],
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const [id, url] of urls) {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(id.startsWith('s4') || id.startsWith('s5') ? 4000 : 2000);
    if (id === 's4-voice-board') await page.mouse.wheel(0, 300);
    if (id === 's6-lab') await page.mouse.wheel(0, 500);
    await page.screenshot({ path: `${OUT}/${id}.png` });
    console.log('shot', id);
  }
  await browser.close();
}

void main();
