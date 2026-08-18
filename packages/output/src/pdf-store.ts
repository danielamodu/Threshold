/**
 * Where a generated PDF's bytes go, and what URL ends up in
 * `ComplianceRecord.exported_pdf_url`.
 *
 * This has to run BEFORE a record is logged, not after: `exported_pdf_url`
 * (and `claim_draft_id`) are fields ON the §3 record, and `audit_log` is
 * append-only — there is no "log it, then patch in the URL later." So PDF
 * generation and storage happen inline, while the record is still being
 * built, and only the finished record — URL already filled in — gets
 * appended to the audit log.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface PdfStore {
  /** Persist bytes under `filename`, return the URL a client can fetch it from. */
  save(filename: string, bytes: Uint8Array): Promise<string>;
}

/**
 * Writes PDFs to a local directory. Demo-appropriate storage — no cloud
 * bucket, no auth on the files, matches every other "keep it proportionate to
 * a hackathon demo" call made elsewhere in this codebase. Returns a relative
 * URL path (`urlPrefix/filename`) that the caller is responsible for actually
 * serving — this class only writes bytes to disk.
 */
export class LocalFilePdfStore implements PdfStore {
  constructor(
    private readonly baseDir: string,
    private readonly urlPrefix = '/pdfs',
  ) {}

  async save(filename: string, bytes: Uint8Array): Promise<string> {
    await mkdir(this.baseDir, { recursive: true });
    await writeFile(resolve(this.baseDir, filename), bytes);
    return `${this.urlPrefix}/${filename}`;
  }
}

/** Keeps bytes in memory. Default for tests and any run backed by a synthetic feed. */
export class InMemoryPdfStore implements PdfStore {
  private readonly files = new Map<string, Uint8Array>();

  save(filename: string, bytes: Uint8Array): Promise<string> {
    this.files.set(filename, bytes);
    return Promise.resolve(`memory://${filename}`);
  }

  get(filename: string): Uint8Array | undefined {
    return this.files.get(filename);
  }

  get size(): number {
    return this.files.size;
  }
}
