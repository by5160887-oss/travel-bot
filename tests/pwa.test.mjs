// Zero-dependency PWA integrity tests — run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const html = readFileSync(new URL("../1-index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const manifest = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));

test("page links the manifest, theme color, and iOS install metadata", () => {
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<meta name="theme-color" content="#071a2d">/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /serviceWorker.*register\('\.\/sw\.js'\)/s);
});

test("manifest is installable: standalone, icons 192+512+maskable, start_url, rtl hebrew", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.lang, "he");
  assert.equal(manifest.dir, "rtl");
  assert.ok(manifest.start_url);
  const sizes = manifest.icons.map((i) => i.sizes + ":" + (i.purpose || "any"));
  assert.ok(sizes.some((s) => s.startsWith("192x192")));
  assert.ok(sizes.some((s) => s.startsWith("512x512")));
  assert.ok(manifest.icons.some((i) => i.purpose === "maskable"));
  for (const icon of manifest.icons) {
    assert.ok(existsSync(new URL("../" + icon.src, import.meta.url)), icon.src);
  }
});

test("service worker NEVER caches AI traffic: /api/ bypass comes before any cache logic", () => {
  const apiBypass = sw.indexOf('/api/');
  const cachePut = sw.indexOf("cache.put(");
  const cacheMatch = sw.indexOf("caches.match(");
  assert.ok(apiBypass > -1, "no /api/ rule found");
  assert.ok(apiBypass < cachePut, "/api/ bypass must precede cache writes");
  assert.ok(apiBypass < cacheMatch, "/api/ bypass must precede cache reads");
  assert.match(sw, /req\.method !== "GET"\)\s*return/, "non-GET requests must pass through");
  assert.doesNotMatch(sw, /GEMINI|api[-_]?key/i, "worker must not reference secrets");
});

test("service worker caches only the static shell, not chat content", () => {
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  assert.match(shell, /1-index\.html/);
  assert.match(shell, /manifest\.webmanifest/);
  assert.match(shell, /icon-192\.png/);
  assert.doesNotMatch(shell, /api|chat\.json|history/i);
  assert.match(sw, /caches\.delete/, "old caches must be cleaned on activate");
});

test("PWA uses versioned network-first navigation with offline fallback", () => {
  assert.match(sw, /travel-bot-shell-v3/);
  assert.match(sw, /request\.mode === "navigate"/);
  const nav = sw.indexOf('request.mode === "navigate"');
  const network = sw.indexOf('fetch(request)', nav);
  const cache = sw.indexOf('caches.match(request', nav);
  assert.ok(network > nav && network < cache, "navigation must try network before cache");
  assert.match(sw, /caches\.match\("\.\/1-index\.html"\)/);
});

test("PWA exposes a visible update and refresh path", () => {
  assert.match(sw, /TRAVEL_BOT_UPDATED/);
  assert.match(html, /id="updateNotice"/);
  assert.match(html, /רענון עכשיו/);
  assert.match(html, /controllerchange/);
  assert.match(html, /location\.reload\(\)/);
});


test("client honors the exact owner Travelor source label without trusting arbitrary labels", () => {
  assert.match(html, /owner_travelor:"באתר שלך"/);
  assert.match(html, /item\.sourceType==="owner_travelor"&&item\.sourceLabel==="באתר שלך"/);
  assert.doesNotMatch(html, /sourceLabel=item\.sourceLabel\|\|/);
});
