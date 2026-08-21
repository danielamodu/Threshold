import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { canRead, canWrite, mayReadRecord, permissionsFor, type Role } from '../src/roles.js';

const ALL_ROLES: Role[] = ['dispatcher', 'compliance_officer', 'driver', 'org_admin'];

describe('role permission matrix (§11, signed off)', () => {
  it('append-only resources never grant write to any role', () => {
    for (const role of ALL_ROLES) {
      assert.equal(canWrite(role, 'compliance_records'), 'none', `${role} must not write compliance_records`);
      assert.equal(canWrite(role, 'audit_log'), 'none', `${role} must not write audit_log`);
    }
  });

  describe('dispatcher', () => {
    it('reads and writes routes org-wide', () => {
      assert.equal(canRead('dispatcher', 'routes'), 'org_wide');
      assert.equal(canWrite('dispatcher', 'routes'), 'org_wide');
    });
    it('can act on cargo assessments (reroute) but not create org_management', () => {
      assert.equal(canWrite('dispatcher', 'cargo_assessments'), 'org_wide');
      assert.equal(canRead('dispatcher', 'org_management'), 'none');
    });
  });

  describe('compliance_officer', () => {
    it('reads everything org-wide but writes nothing operational', () => {
      for (const resource of ['routes', 'thermal_events', 'compliance_records', 'cargo_assessments', 'audit_log'] as const) {
        assert.equal(canRead('compliance_officer', resource), 'org_wide', `should read ${resource} org-wide`);
      }
      assert.equal(canWrite('compliance_officer', 'routes'), 'none', 'separation of duties: no dispatch write access');
      assert.equal(canWrite('compliance_officer', 'cargo_assessments'), 'none');
    });
  });

  describe('driver', () => {
    it('sees only its own records, never org-wide', () => {
      assert.equal(canRead('driver', 'compliance_records'), 'own');
      assert.equal(canRead('driver', 'thermal_events'), 'own');
      assert.equal(canRead('driver', 'routes'), 'none');
      assert.equal(canRead('driver', 'cargo_assessments'), 'none', 'no legitimate need for cargo/financial data');
    });

    it('mayReadRecord: only matches when the record belongs to the caller', () => {
      assert.equal(mayReadRecord('driver', 'compliance_records', 'driver-42', 'driver-42'), true);
      assert.equal(mayReadRecord('driver', 'compliance_records', 'driver-99', 'driver-42'), false);
      assert.equal(mayReadRecord('driver', 'compliance_records', null, 'driver-42'), false);
    });

    it('mayReadRecord: a resource driver cannot read at all is false regardless of ownership', () => {
      assert.equal(mayReadRecord('driver', 'cargo_assessments', 'driver-42', 'driver-42'), false);
    });
  });

  describe('org_admin', () => {
    it('inherits dispatcher-level operational visibility', () => {
      for (const resource of ['routes', 'thermal_events', 'compliance_records', 'cargo_assessments', 'audit_log'] as const) {
        assert.deepEqual(permissionsFor('org_admin', resource), permissionsFor('dispatcher', resource));
      }
    });

    it('is the only role with org_management access', () => {
      assert.equal(canRead('org_admin', 'org_management'), 'org_wide');
      assert.equal(canWrite('org_admin', 'org_management'), 'org_wide');
      for (const role of ALL_ROLES) {
        if (role === 'org_admin') continue;
        assert.equal(canRead(role, 'org_management'), 'none', `${role} must not see org_management`);
      }
    });

    it('mayReadRecord: org-wide access means ownership never matters', () => {
      assert.equal(mayReadRecord('org_admin', 'compliance_records', 'anyone', null), true);
    });
  });

  it('org_wide access always reads true regardless of owner/caller identity', () => {
    assert.equal(mayReadRecord('dispatcher', 'routes', null, null), true);
  });
});
