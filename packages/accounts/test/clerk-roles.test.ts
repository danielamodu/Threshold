import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { roleFromClerk, UnrecognizedClerkRoleError } from '../src/clerk-roles.js';

describe('roleFromClerk', () => {
  it('maps org_admin onto Clerk\'s built-in org:admin — no custom role needed', () => {
    assert.equal(roleFromClerk('org:admin'), 'org_admin');
  });

  it('maps the three custom roles', () => {
    assert.equal(roleFromClerk('org:dispatcher'), 'dispatcher');
    assert.equal(roleFromClerk('org:compliance_officer'), 'compliance_officer');
    assert.equal(roleFromClerk('org:driver'), 'driver');
  });

  it('throws rather than silently defaulting on an unrecognized role', () => {
    assert.throws(() => roleFromClerk('org:member'), UnrecognizedClerkRoleError);
    assert.throws(() => roleFromClerk('something-unexpected'), UnrecognizedClerkRoleError);
    assert.throws(() => roleFromClerk(''), UnrecognizedClerkRoleError);
  });

  it('the error message names every valid role, so a misconfigured dashboard is easy to fix', () => {
    try {
      roleFromClerk('org:bogus');
      assert.fail('should have thrown');
    } catch (error) {
      assert.ok(error instanceof UnrecognizedClerkRoleError);
      assert.match(error.message, /org:admin/);
      assert.match(error.message, /org:dispatcher/);
      assert.match(error.message, /org:compliance_officer/);
      assert.match(error.message, /org:driver/);
    }
  });
});
