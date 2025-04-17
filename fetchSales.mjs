#!/usr/bin/env node
/**
  fetchSales.mjs – Build stores.geojson with sale details for map pop‑ups
  -----------------------------------------------------------------------------
  • Uses Google Places Nearby Search to get stores near Kamppi (Helsinki).
  • For each store that has a website, asks OpenAI (web_search_preview) to:
        1. Decide if the site advertises a big sale.
        2. Extract a short headline / discount snippet.
  • Outputs stores.geojson with extra properties so the front‑end can show
    marker pop‑ups like: "UFF Vintage – Up to 70 % off (loppuunmyynti)".

  -----------------------------------------------------------------------------
  .env variables (loaded with dotenv):
      GOOGLE_API_KEY   – Google Places key
      OPENAI_API_KEY   – OpenAI key (gpt‑4.1 with web_search_preview)

  npm install openai dotenv          # (node-fetch if Node < 18)
*/

import 'dotenv/config';
import fs from 'fs/promises';
import OpenAI from 'openai';
// If using Node 16–17, uncomment:
// import fetch from 'node-fetch';

const { GOOGLE_API_KEY, OPENAI_API_KEY } = process.env;
if (!GOOGLE_API_KEY || !OPENAI_API_KEY) {
  throw new Error('GOOGLE_API_KEY and OPENAI_API_KEY must be set in .env');
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// -----------------------------------------------------------------------------
// Config – adjust freely
// -----------------------------------------------------------------------------
const center = { lat: 60.169168, lng: 24.930956 }; // Kamppi centre
const radius = 500;   // metres
const maxResults = 10;

// Finnish + English sale words we care about (for the OpenAI prompt context)
const KW = ['loppuunmyynti', 'kevätale', 'tyhjennysmyynti', 'alennus', 'ale',
            'clearance', '% off', 'sale'];

// -----------------------------------------------------------------------------
// Google Places Nearby Search helper
// -----------------------------------------------------------------------------
async function queryPlaces() {
  const body = {
    includedTypes: ['store'],
    maxResultCount: maxResults,
    locationRestriction: {
      circle: {
        center: { latitude: center.lat, longitude: center.lng },
        radius
      }
    }
  };

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': 'places.location,places.displayName,places.websiteUri'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).places ?? [];
}

// -----------------------------------------------------------------------------
// Ask OpenAI to analyse the page and return JSON about the sale
// -----------------------------------------------------------------------------
async function analyzeSite(url) {
  const prompt = `Visit the page at ${url}. ` +
    `If the page clearly advertises a store‑wide sale or clearance (Finnish words: ${KW.join(', ')}, or English words: clearance, sale, % off), return JSON like:\n` +
    `{"sale":true,"headline":"Loppuunmyynti – kaikki -70%","discount":"70%"}. ` +
    `If there is no such sale, return {"sale":false}. ` +
    `Return ONLY the JSON, no extra text.`;

  const resp = await client.responses.create({
    model: 'gpt-4.1',
    tools: [{ type: 'web_search_preview' }],
    input: prompt
  });

  // The model should comply; be defensive anyway
  const txt = resp.output_text.trim();
  try {
    return JSON.parse(txt);
  } catch (err) {
    console.warn('⚠️  Non‑JSON from OpenAI, ignoring:', txt.slice(0,80));
    return { sale: false };
  }
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------
(async () => {
  const places = await queryPlaces();
  const features = [];

  for (const p of places) {
    if (!p.websiteUri) continue;
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

  const geojson = { type: 'FeatureCollection', features };
  await fs.writeFile('stores.geojson', JSON.stringify(geojson, null, 2));
  console.log(`\nWrote ${features.length} sale(s) to stores.geojson`);
})();
