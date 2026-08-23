/**
 * Claim draft PDF export (§4 tech stack: "PDF export | pdf-lib | Compliance
 * record + claim draft rendering" — both artifacts get PDF rendering, not
 * just the compliance side).
 *
 * Same plain, audit-grade visual bar as compliance-pdf.ts. The blank/"Not
 * available" loss-value line is deliberate, not an oversight — see
 * claim-draft.ts's file header for why a real figure is never fabricated.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ClaimDraft } from '@threshold/types';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 56;

export async function renderClaimDraftPdf(draft: ClaimDraft): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('THRESHOLD — CARGO CLAIM DRAFT', {
    x: MARGIN,
    y,
    size: 16,
    font: bold,
    color: rgb(0.55, 0.12, 0.08),
  });
  y -= 18;
  page.drawText('DRAFT — generated automatically, not submitted. Requires human review.', {
    x: MARGIN,
    y,
    size: 9,
    font,
    color: rgb(0.6, 0.3, 0.05),
  });
  y -= 28;

  y = rule(page, y);
  y -= 20;

  y = field(page, font, bold, y, 'Claim draft ID', draft.claim_draft_id);
  y = field(page, font, bold, y, 'Assessment ID', draft.assessment_id);
  y = field(page, font, bold, y, 'Route ID', draft.route_id);
  y = field(page, font, bold, y, 'Source event', draft.event_id);
  y = field(page, font, bold, y, 'Cargo class', draft.cargo_class);
  y = field(page, font, bold, y, 'Risk level', draft.risk_level.toUpperCase());
  y = field(
    page,
    font,
    bold,
    y,
    'Cumulative exposure',
    `${draft.cumulative_exposure_score} / ${draft.threshold} °C·h`,
  );
  y = field(page, font, bold, y, 'Generated at', draft.generated_at);
  y -= 10;

  y = rule(page, y);
  y -= 20;

  page.drawText('Incident summary:', { x: MARGIN, y, size: 11, font: bold });
  y -= 16;
  y = wrapText(page, font, draft.incident_summary, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 10, 13);
  y -= 14;

  page.drawText('Estimated loss value:', { x: MARGIN, y, size: 11, font: bold });
  y -= 16;
  page.drawText('Not available', { x: MARGIN, y, size: 11, font: bold, color: rgb(0.5, 0.5, 0.5) });
  y -= 14;
  y = wrapText(page, font, draft.estimated_loss_note, MARGIN, y, PAGE_WIDTH - 2 * MARGIN, 9, 12);

  y -= 16;
  y = rule(page, y);
  y -= 20;
  page.drawText(
    'This draft is structured evidence, not a submitted claim. A human must review before',
    { x: MARGIN, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) },
  );
  y -= 11;
  page.drawText(
    'it is sent to an insurer. See event_id above to cross-reference the full audit trail.',
    { x: MARGIN, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) },
  );

  return doc.save();
}

function field(
  page: PDFPage,
  font: PDFFont,
  bold: PDFFont,
  y: number,
  label: string,
  value: string,
): number {
  page.drawText(`${label}:`, { x: MARGIN, y, size: 10, font: bold, color: rgb(0.2, 0.2, 0.2) });
  page.drawText(value, { x: MARGIN + 150, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  return y - 16;
}

function rule(page: PDFPage, y: number): number {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  return y;
}

/** Naive word-wrap by character-width estimate — good enough for a plain report page. */
function wrapText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  startY: number,
  maxWidth: number,
  size: number,
  lineHeight: number,
): number {
  const words = text.split(' ');
  let line = '';
  let y = startY;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
      y -= lineHeight;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color: rgb(0.25, 0.25, 0.25) });
    y -= lineHeight;
  }
  return y;
}
