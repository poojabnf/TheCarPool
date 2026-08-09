// Jest is the project test runner; describe/it/expect are globals.
import {
  verificationLevel,
  hasVerifiedLicence,
  canBookRide,
  canOfferRide,
  verificationSummary,
} from '../verification';

const PHONE_ONLY = {};
const ID_VERIFIED = { id_document_verified: true };
const PARTNER = { id_document_verified: true, driver_licence_verified: true };
const LEGACY = { kyc_status: 'VERIFIED' };

describe('verificationLevel', () => {
  it('is 1 for a phone-only signup', () => {
    expect(verificationLevel(PHONE_ONLY)).toBe(1);
    expect(verificationLevel(null)).toBe(1);
    expect(verificationLevel(undefined)).toBe(1);
  });

  it('is 2 once a government ID is verified', () => {
    expect(verificationLevel(ID_VERIFIED)).toBe(2);
  });

  it('grandfathers users verified before tiers existed', () => {
    // They have kyc_status and nothing else; demoting them would lock existing
    // users out of booking.
    expect(verificationLevel(LEGACY)).toBe(2);
    expect(verificationLevel({ kyc_status: 'verified' })).toBe(2);
  });

  it('is 1 for a pending or rejected status', () => {
    expect(verificationLevel({ kyc_status: 'PENDING' })).toBe(1);
    expect(verificationLevel({ kyc_status: 'REJECTED' })).toBe(1);
  });
});

describe('canBookRide', () => {
  it('needs a government ID and nothing more', () => {
    expect(canBookRide(ID_VERIFIED).allowed).toBe(true);
    // A rider must NOT need a driving licence to book.
    expect(canBookRide(ID_VERIFIED).required).toBeNull();
  });

  it('blocks a phone-only user and points at ID verification', () => {
    const g = canBookRide(PHONE_ONLY);
    expect(g.allowed).toBe(false);
    expect(g.required).toBe('VERIFY_ID');
    expect(g.code).toBe('VERIFICATION_REQUIRED');
  });

  it('lets legacy verified users keep booking', () => {
    expect(canBookRide(LEGACY).allowed).toBe(true);
  });

  it('does not care about a licence either way', () => {
    expect(canBookRide(PARTNER).allowed).toBe(true);
  });
});

describe('canOfferRide', () => {
  it('allows a partner with ID and licence', () => {
    expect(canOfferRide(PARTNER).allowed).toBe(true);
  });

  it('asks an ID-verified rider for a licence', () => {
    // The whole point: a rider becoming a partner is asked for the licence
    // at this moment, not during signup.
    const g = canOfferRide(ID_VERIFIED);
    expect(g.allowed).toBe(false);
    expect(g.required).toBe('ADD_LICENCE');
    expect(g.code).toBe('LICENCE_REQUIRED');
  });

  it('asks a phone-only user for ID FIRST, not a licence', () => {
    // Order matters — demanding a licence from someone who has verified
    // nothing is a confusing dead end.
    const g = canOfferRide(PHONE_ONLY);
    expect(g.required).toBe('VERIFY_ID');
  });

  it('rejects a simulated KYC pass for driver privileges', () => {
    const g = canOfferRide({ id_document_verified: true, kyc_simulated: true, driver_licence_verified: true });
    expect(g.allowed).toBe(false);
    expect(g.required).toBe('REAL_KYC');
  });

  it('requires a licence from legacy verified users too', () => {
    // Deliberate: existing drivers must add a licence. Documented as a
    // migration consequence rather than an accident.
    expect(canOfferRide(LEGACY).required).toBe('ADD_LICENCE');
  });
});

describe('enforcement switch (testing mode)', () => {
  it('waves everyone through when enforcement is off', () => {
    // Used while testing so the tiers can be disabled without deleting them.
    expect(canBookRide(PHONE_ONLY, { enforced: false }).allowed).toBe(true);
    expect(canOfferRide(PHONE_ONLY, { enforced: false }).allowed).toBe(true);
  });

  it('reports the relaxed state in the summary too', () => {
    // The app renders the summary, so it must unlock in step with the server.
    const s = verificationSummary(PHONE_ONLY, { enforced: false });
    expect(s.can_book).toBe(true);
    expect(s.can_offer_rides).toBe(true);
    // The underlying facts stay honest — they genuinely aren't verified.
    expect(s.level).toBe(1);
    expect(s.id_verified).toBe(false);
    expect(s.licence_verified).toBe(false);
  });

  it('enforces by default, so forgetting the flag fails safe', () => {
    expect(canBookRide(PHONE_ONLY).allowed).toBe(false);
    expect(canBookRide(PHONE_ONLY, {}).allowed).toBe(false);
    expect(canOfferRide(PHONE_ONLY, { enforced: true }).allowed).toBe(false);
  });
});

describe('hasVerifiedLicence', () => {
  it('is true only when explicitly verified', () => {
    expect(hasVerifiedLicence(PARTNER)).toBe(true);
    expect(hasVerifiedLicence(ID_VERIFIED)).toBe(false);
    expect(hasVerifiedLicence(null)).toBe(false);
  });
});

describe('verificationSummary', () => {
  it('describes a phone-only user', () => {
    expect(verificationSummary(PHONE_ONLY)).toEqual({
      level: 1, id_verified: false, licence_verified: false,
      can_book: false, can_offer_rides: false,
    });
  });

  it('describes a rider', () => {
    expect(verificationSummary(ID_VERIFIED)).toEqual({
      level: 2, id_verified: true, licence_verified: false,
      can_book: true, can_offer_rides: false,
    });
  });

  it('describes a partner', () => {
    expect(verificationSummary(PARTNER)).toEqual({
      level: 2, id_verified: true, licence_verified: true,
      can_book: true, can_offer_rides: true,
    });
  });
});
