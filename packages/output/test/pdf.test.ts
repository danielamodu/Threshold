import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PDFDocument } from 'pdf-lib';
import type { CargoRiskAssessment, ComplianceRecord } from '@threshold/types';
import { renderCompliancePdf } from '../src/compliance-pdf.js';
import { renderClaimDraftPdf } from '../src/claim-pdf.js';
import { generateClaimDraft } from '../src/claim-draft.js';
import { InMemoryPdfStore, LocalFilePdfStore } from '../src/pdf-store.js';

function compliance(overrides: Partial<ComplianceRecord> = {}): ComplianceRecord {
  return {
    record_id: 'c1',
    driver_id: 'driver-42',
    event_id: 'e1',
    heat_index_c: 46.2,
    action: 'work_limit_reduced',
    schedule: [{ start: '2026-08-18T14:15:00.000Z', end: '2026-08-18T15:00:00.000Z', type: 'reduced_load' }],
    generated_at: '2026-08-18T14:05:00.000Z',
    exported_pdf_url: null,
    ...overrides,
  };
}

function assessment(overrides: Partial<CargoRiskAssessment> = {}): CargoRiskAssessment {
  return {
    assessment_id: 'g1',
    cargo_class: 'pharma',
    event_id: 'e1',
    cumulative_exposure_score: 14.5,
    threshold: 12,
    risk_level: 'breach',
    recommended_action: 'claim_draft',
    claim_draft_id: null,
    reroute_suggestion: null,
    ...overrides,
  };
}

describe('renderCompliancePdf', () => {
  it('produces bytes that parse back as a valid PDF', async () => {
    const bytes = await renderCompliancePdf(compliance(), { route_id: 'route-a' });
    assert.ok(bytes.length > 500, 'should be a real document, not an empty shell');
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1);
  });

  it('renders cleanly with no schedule (nominal / action: none)', async () => {
    const bytes = await renderCompliancePdf(
      compliance({ action: 'none', schedule: [], heat_index_c: 28 }),
      { route_id: 'route-a' },
    );
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1);
  });

  it('renders cleanly when heat_index_c is null (degraded humidity)', async () => {
    const bytes = await renderCompliancePdf(compliance({ heat_index_c: null }), { route_id: 'route-a' });
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1);
  });
});

describe('renderClaimDraftPdf', () => {
  it('produces bytes that parse back as a valid PDF', async () => {
    const draft = generateClaimDraft(assessment(), 'route-a', { newId: () => 'draft-1' });
    const bytes = await renderClaimDraftPdf(draft);
    assert.ok(bytes.length > 500);
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1);
  });

  it('handles a long incident summary without throwing (word-wrap)', async () => {
    const draft = generateClaimDraft(
      assessment({ cargo_class: 'general_reefer', cumulative_exposure_score: 87.333, threshold: 50 }),
      'route-with-a-very-long-descriptive-identifier-for-wrap-testing',
    );
    const bytes = await renderClaimDraftPdf(draft);
    const reloaded = await PDFDocument.load(bytes);
    assert.equal(reloaded.getPageCount(), 1);
  });
});

describe('InMemoryPdfStore', () => {
  it('round-trips saved bytes and returns a memory:// URL', async () => {
    const store = new InMemoryPdfStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const url = await store.save('test.pdf', bytes);
    assert.equal(url, 'memory://test.pdf');
    assert.deepEqual(store.get('test.pdf'), bytes);
    assert.equal(store.size, 1);
  });
});

describe('LocalFilePdfStore', () => {
  it('writes bytes to disk and returns a servable relative URL', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'threshold-pdf-test-'));
    try {
      const store = new LocalFilePdfStore(dir, '/pdfs');
      const bytes = new Uint8Array([80, 68, 70]); // "PDF"
      const url = await store.save('c1.pdf', bytes);
      assert.equal(url, '/pdfs/c1.pdf');

      const onDisk = await readFile(join(dir, 'c1.pdf'));
      assert.deepEqual(new Uint8Array(onDisk), bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
