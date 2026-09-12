/**
 * Writes Netlify's _redirects at build time.
 *
 * 1. /api/* is proxied (status 200, not a redirect) to the API on Render.
 *    The browser only ever sees the Netlify origin, so the refresh-token
 *    cookie is first-party and works in Safari, which blocks cross-site
 *    cookies by default.
 * 2. Every other path serves index.html, so deep links such as
 *    /events/some-slug load the single-page app instead of a 404.
 *
 * API_ORIGIN must be set in the Netlify build environment, e.g.
 * https://gatherly-api.onrender.com (no trailing slash).
 */
import { writeFileSync } from 'node:fs';

const origin = process.env.API_ORIGIN?.replace(/\/+$/, '');
const lines = [];
if (origin) {
  lines.push(`/api/*  ${origin}/api/:splat  200`);
} else {
  console.warn('API_ORIGIN not set: /api will not be proxied (fine for local preview only).');
}
lines.push('/*  /index.html  200');

writeFileSync(new URL('../dist/_redirects', import.meta.url), `${lines.join('\n')}\n`);
console.log(`Wrote dist/_redirects (${lines.length} rules)`);
