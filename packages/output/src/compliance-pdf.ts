/**
 * Compliance PDF export (§2, §6 Phase 4).
 *
 *   "Compliance Record — timestamped, exportable (PDF), audit-grade. This is
 *    the actual product for the human-side module."
 *
 * Generated for EVERY compliance record, not just breaches — "audit-grade"
 * means consistent documentation exists whether or not anything fired, which
 * is the whole point of a liability record: proving nothing was missed, not
 * just proving something was caught.
 *
 * Deliberately plain rather than styled: a single Helvetica page, no logos,
 * no color beyond what's needed to make the action line legible. This is a
 * compliance document that has to hold up under scrutiny, not a marketing
 * artifact — the visual bar is "audit-grade," not "impressive."
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ComplianceRecord } from '@threshold/types';

export interface ComplianceContext {
  route_id: string;
}

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;

export async function renderCompliancePdf(
  record: ComplianceRecord,
  context: ComplianceContext,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_HEIGHT - MARGIN;

  page.drawText('THRESHOLD — HUMAN COMPLIANCE RECORD', {
    x: MARGIN,
    y,
    size: 16,
    font: bold,
    color: rgb(0.1, 0.15, 0.25),
  });
  y -= 18;
  page.drawText('Audit-grade documentation — generated automatically from the risk engine.', {
    x: MARGIN,
    y,
    size: 9,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  y -= 28;

  y = drawRule(page, y);
  y -= 20;

  y = field(page, font, bold, y, 'Record ID', record.record_id);
  y = field(page, font, bold, y, 'Driver ID', record.driver_id);
  y = field(page, font, bold, y, 'Route ID', context.route_id);
  y = field(page, font, bold, y, 'Source event', record.event_id);
  y = field(page, font, bold, y, 'Generated at', record.generated_at);
  y -= 10;

  y = drawRule(page, y);
  y -= 20;

  const heatIndexText =
    record.heat_index_c === null
      ? 'Unavailable — humidity was not obtainable for this reading; a conservative ' +
        'dry-bulb rule was applied instead of the NWS formula.'
      : `${record.heat_index_c}°C (NWS heat index)`;
  y = field(page, font, bold, y, 'Heat index', heatIndexText);

  const actionColor = actionColorFor(record.action);
  y -= 4;
  page.drawText('Action taken:', { x: MARGIN, y, size: 11, font: bold, color: rgb(0.15, 0.15, 0.15) });
  y -= 16;
  page.drawText(describeAction(record.action), {
    x: MARGIN,
    y,
    size: 13,
    font: bold,
    color: actionColor,
  });
  y -= 26;

  if (record.schedule.length === 0) {
    page.drawText('No rest or reduced-load period was scheduled at this exposure level.', {
      x: MARGIN,
      y,
      size: 10,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 18;
  } else {
    page.drawText('Scheduled periods:', { x: MARGIN, y, size: 11, font: bold });
    y -= 16;
    for (const entry of record.schedule) {
      page.drawText(
        `-  ${entry.type === 'rest' ? 'Rest' : 'Reduced load'}   ${entry.start} to ${entry.end}`,
        { x: MARGIN + 8, y, size: 10, font },
      );
      y -= 15;
    }
  }

  y -= 10;
  y = drawRule(page, y);
  y -= 20;
  page.drawText(
    'This record was produced automatically from a ThermalExposureEvent and is retained,',
    { x: MARGIN, y, size: 8, font, color: rgb(0.5, 0.5, 0.5) },
  );
  y -= 11;
  page.drawText(
    'unaltered, in Threshold’s append-only audit log. See event_id above to cross-reference.',
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
  page.drawText(value, { x: MARGIN + 130, y, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  return y - 16;
}

function drawRule(page: PDFPage, y: number): number {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });
  return y;
}

function describeAction(action: ComplianceRecord['action']): string {
  switch (action) {
    case 'none':
      return 'None required — conditions within OSHA caution band.';
    case 'rest_break_scheduled':
      return 'Rest break scheduled.';
    case 'work_limit_reduced':
      return 'Work limit reduced.';
  }
}

function actionColorFor(action: ComplianceRecord['action']): ReturnType<typeof rgb> {
  switch (action) {
    case 'none':
      return rgb(0.12, 0.45, 0.2);
    case 'rest_break_scheduled':
      return rgb(0.65, 0.45, 0.05);
    case 'work_limit_reduced':
      return rgb(0.7, 0.15, 0.1);
  }
}
