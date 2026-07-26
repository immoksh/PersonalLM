import * as cheerio from 'cheerio';

/** Strips tags from the editor's rich-text HTML, keeping block boundaries as newlines. */
export function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $('script, style').remove();
  // Turn block elements into line breaks so paragraphs don't run together.
  $('p, br, div, li, h1, h2, h3, h4, h5, h6, tr').each((_, el) => {
    $(el).append('\n');
  });
  return $.root().text();
}
