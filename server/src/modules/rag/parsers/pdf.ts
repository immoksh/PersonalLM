import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';
import type { ExtractedContent } from './types.js';

/** Reads a PDF file from disk, one segment per page. */
export async function readPdfPages(filePath: string): Promise<ExtractedContent> {
  return parsePdfBuffer(await fs.readFile(filePath));
}

/**
 * Extracts text from PDF bytes already in memory (a file upload, or a PDF
 * served over http). Each page becomes its own segment so a chunk drawn from it
 * carries the page number — which is what makes a PDF citation openable at the
 * right place rather than at the top of the document.
 */
export async function parsePdfBuffer(data: Uint8Array): Promise<ExtractedContent> {
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    const segments = result.pages
      .map((page) => ({ text: page.text, page: page.num }))
      // A scanned page with no text layer contributes nothing, and keeping it
      // would leave an empty span the chunker could still attribute a chunk to.
      .filter((segment) => segment.text.trim().length > 0);

    return { segments, pageCount: result.total };
  } finally {
    // Releases the underlying pdf.js document/worker for this parse.
    await parser.destroy();
  }
}
