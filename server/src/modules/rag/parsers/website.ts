import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { logger } from '../../../utils/logger.js';
import { parsePdfBuffer } from './pdf.js';
import { asSingleSegment, ExtractionError, type ExtractedContent } from './types.js';

const WEBSITE_FETCH_TIMEOUT_MS = 15_000;
const MAX_WEBSITE_BYTES = 5 * 1024 * 1024;

/**
 * Fetches a URL and extracts its readable text. A "website" URL does not always
 * serve HTML — plenty of the links people paste point straight at a PDF — so the
 * body is dispatched on its actual type. Anything else binary is rejected rather
 * than decoded as text, because mojibake chunks embed happily and then poison
 * retrieval with content nobody can read.
 */
export async function fetchWebsiteContent(url: string): Promise<ExtractedContent> {
  await assertPublicUrl(url);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'PersonalLM/0.1 (+content-ingest)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5',
      },
    });
    if (!response.ok) {
      throw new ExtractionError(`Fetching the page failed with status ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const mime = contentType.split(';')[0]!.trim().toLowerCase();
    const body = await readCappedBody(response);

    // A link that points straight at a PDF is paginated like any other, so it
    // keeps its per-page segments and cites page numbers just as an upload does.
    if (mime === 'application/pdf' || looksLikePdf(body)) {
      return await parsePdfBuffer(body);
    }
    if (mime && !isTextualMime(mime)) {
      throw new ExtractionError(`This URL serves ${mime}, which has no readable text to ingest`);
    }

    const text = decodeBody(body, contentType);
    return asSingleSegment(mime === 'text/plain' ? text : htmlToReadableText(text));
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(`Could not fetch the page: ${(error as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function htmlToReadableText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, noscript, svg').remove();
  const main = $('main').text() || $('article').text() || $('body').text();
  return main.replace(/[ \t]+/g, ' ');
}

/** Mime types whose bodies are text we can strip tags from (or use as-is). */
function isTextualMime(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/xhtml+xml' ||
    mime === 'application/xml' ||
    mime === 'application/json'
  );
}

function looksLikePdf(body: Uint8Array): boolean {
  // "%PDF" — covers servers that mislabel PDFs as octet-stream or text/html.
  return body[0] === 0x25 && body[1] === 0x50 && body[2] === 0x44 && body[3] === 0x46;
}

/**
 * Reads the body but stops once `MAX_WEBSITE_BYTES` have arrived, so an
 * unexpectedly huge (or endless) response can't exhaust memory. The previous
 * `text().slice()` capped characters only after the whole body was buffered.
 */
async function readCappedBody(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();

  const parts: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
      if (total >= MAX_WEBSITE_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const body = new Uint8Array(Math.min(total, MAX_WEBSITE_BYTES));
  let offset = 0;
  for (const part of parts) {
    if (offset >= body.length) break;
    const slice = part.subarray(0, body.length - offset);
    body.set(slice, offset);
    offset += slice.length;
  }
  return body;
}

/** Decodes using the charset the server declared, falling back to UTF-8. */
function decodeBody(body: Uint8Array, contentType: string): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  try {
    // fatal:false so a truncated multi-byte char at the cap becomes U+FFFD
    // rather than throwing away the whole page.
    return new TextDecoder(charset ?? 'utf-8').decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
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
