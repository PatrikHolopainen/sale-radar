#!/usr/bin/env node
/**
  fetchSales.mjs – Multi‑point crawler
  -----------------------------------------------------------------------------
  • Accepts an array of coordinate pairs (10 in this demo).
  • For **each point**: Google Places Nearby Search (radius 200 m, max 20 stores).
  • De‑duplicates the combined result set by Google `id` (place ID).
  • Sends unique sites to OpenAI (web_search_preview) to decide whether a
    clearance / major sale is advertised and extracts a headline/discount.
  • Writes a single stores.geojson containing every store flagged with a sale.
  • Logs: #locations queried, total stores returned, unique stores scanned,
    and final #sales written.

  -----------------------------------------------------------------------------
  ENV (.env + dotenv)
  -----------------------------------------------------------------------------
  GOOGLE_API_KEY   – Google Places key
  OPENAI_API_KEY   – OpenAI key (gpt‑4.1)

  npm i openai dotenv           # (node-fetch if < Node 18)
*/

import 'dotenv/config';
import fs from 'fs/promises';
import OpenAI from 'openai';
// For Node < 18 uncomment:
// import fetch from 'node-fetch';

const { GOOGLE_API_KEY, OPENAI_API_KEY } = process.env;
if (!GOOGLE_API_KEY || !OPENAI_API_KEY) throw new Error('Missing API keys in .env');

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// -----------------------------------------------------------------------------
// CONFIG – tweak here
// -----------------------------------------------------------------------------

const INCLUDED_TYPES = [
  'bicycle_store', 'book_store', 'cell_phone_store',
  'clothing_store', 'department_store', 'discount_store', 'electronics_store',
  'furniture_store', 'gift_shop', 'hardware_store', 'home_goods_store',
  'home_improvement_store', 'jewelry_store', 'shoe_store', 'shopping_mall',
  'sporting_goods_store'
];

const LOCATIONS = [                    // <- replace with your 10 coordinate pairs
  { lat: 60.169168, lng: 24.930956 },  // Kamppi
  { lat: 60.168984, lng: 24.938293 },
  { lat: 60.169759, lng: 24.944180 },
  { lat: 60.167177, lng: 24.945747 },
  { lat: 60.162641, lng: 24.939496 },
  { lat: 60.156900, lng: 24.919279 },
  { lat: 60.160070, lng: 24.880104 },
  { lat: 60.187699, lng: 24.979896 },
  { lat: 60.198076, lng: 24.930052 },
  { lat: 60.181829, lng: 24.950918 }
];

const RADIUS       = 300;   // metres
const MAX_RESULTS  = 20;    // per Google query

const KW = [ 'loppuunmyynti', 'kevätale', 'tyhjennysmyynti', 'alennus', 'ale',
             'clearance', '% off', 'sale' ];

// -----------------------------------------------------------------------------
// Google Places Nearby Search for one coordinate
// -----------------------------------------------------------------------------
async function queryPlaces({ lat, lng }) {
  const body = {
    includedTypes: INCLUDED_TYPES,
    maxResultCount: MAX_RESULTS,
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius: RADIUS }
    }
  };

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.location,places.displayName,places.websiteUri'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).places ?? [];
}

// -----------------------------------------------------------------------------
// Analyse a site with OpenAI – returns {sale, headline?, discount?}
// -----------------------------------------------------------------------------
async function analyzeSite(url) {
  const prompt = `Visit ${url}. If it clearly advertises a store‑wide sale or clearance (Finnish: ${KW.slice(0,5).join(', ')}, English: clearance, % off), return JSON like {"sale":true,"headline":"-70% loppuunmyynti","discount":"70%"}. Otherwise {"sale":false}. Return ONLY JSON.`;
  const resp   = await client.responses.create({
    model: 'gpt-4.1',
    tools: [{ type: 'web_search_preview' }],
    input: prompt
  });
  try { return JSON.parse(resp.output_text.trim()); }
  catch { return { sale: false }; }
}

// -----------------------------------------------------------------------------
// MAIN FLOW
// -----------------------------------------------------------------------------
(async () => {
  console.log(`Querying ${LOCATIONS.length} locations × ${MAX_RESULTS} results, radius ${RADIUS} m…`);

  let rawCount = 0;
  const byId = new Map();   // id -> place object (dedup)

  // 1. Collect & deduplicate --------------------------------------------------
  for (const loc of LOCATIONS) {
    const places = await queryPlaces(loc);
    rawCount += places.length;
    for (const p of places) {
      if (p.id && !byId.has(p.id)) byId.set(p.id, p);
    }
  }

  console.log(`Google returned ${rawCount} places; ${byId.size} unique with websites.`);

  // 2. Analyse each unique store ---------------------------------------------
  const features = [];
  for (const p of byId.values()) {
    if (!p.websiteUri) continue;              // nothing to check
    const name = p.displayName?.text || '(unnamed)';
    process.stdout.write(`${name.padEnd(35)} → `);

    try {
      const info = await analyzeSite(p.websiteUri);
      if (info.sale) {
        console.log('SALE');
        features.push({
          type: 'Feature',
          properties: {
            name,
            website: p.websiteUri,
            headline: info.headline || 'Sale',
            discount: info.discount || null
          },
          geometry: {
            type: 'Point',
            coordinates: [p.location.longitude, p.location.latitude]
          }
        });
      } else {
        console.log('-');
      }
    } catch (e) {
      console.log('error:', e.message);
    }
  }

  // 3. Write GeoJSON ----------------------------------------------------------
  await fs.writeFile('stores.geojson', JSON.stringify({ type: 'FeatureCollection', features }, null, 2));
  console.log(`\nSaved ${features.length} sale(s) to stores.geojson`);
})();
