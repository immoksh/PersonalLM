import fs from 'node:fs/promises';
import { PDFParse } from 'pdf-parse';

/** Reads a PDF file from disk and returns its concatenated page text. */
export async function readPdfText(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    // Releases the underlying pdf.js document/worker for this parse.
    await parser.destroy();
  }
}
