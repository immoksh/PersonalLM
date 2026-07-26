import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { logger } from '../../../utils/logger.js';
import { ExtractionError } from './types.js';

const WEBSITE_FETCH_TIMEOUT_MS = 15_000;
const MAX_WEBSITE_BYTES = 5 * 1024 * 1024;

/** Fetches a web page and extracts its main readable text. */
export async function fetchWebsiteText(url: string): Promise<string> {
  await assertPublicUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'PersonalLM/0.1 (+content-ingest)' },
    });
    if (!response.ok) {
      throw new ExtractionError(`Fetching the page failed with status ${response.status}`);
    }
    const html = (await response.text()).slice(0, MAX_WEBSITE_BYTES);
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer, noscript, svg').remove();
    const main = $('main').text() || $('article').text() || $('body').text();
    return main.replace(/[ \t]+/g, ' ');
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(`Could not fetch the page: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Basic SSRF guard for user-supplied website URLs: only http(s), and the
 * resolved address must be public. Without this, a signed-in user could make
 * the server fetch internal services (cloud metadata, localhost admin panels).
 */
async function assertPublicUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ExtractionError('Invalid website URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ExtractionError('Only http and https URLs can be ingested');
  }

  const { address } = await dns.lookup(url.hostname).catch(() => {
    throw new ExtractionError(`Could not resolve host ${url.hostname}`);
  });
  if (isPrivateAddress(address)) {
    logger.warn('Blocked website ingest to non-public address', { host: url.hostname, address });
    throw new ExtractionError('Refusing to fetch a private or loopback address');
  }
}

function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  // IPv6: loopback, unique-local (fc00::/7), link-local (fe80::/10), and mapped v4.
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb'))
    return true;
  return false;
}
