/**
 * Verification tiers. Pure — no I/O — so what each action requires is
 * unit-testable and identical on every code path that gates one.
 *
 *   Level 1  — phone verified (everyone who signs up via OTP).
 *              Browse and search only.
 *   Level 2  — a government ID has been checked against its uploaded copy.
 *              Required to BOOK a ride.
 *   Partner  — Level 2 plus a verified driving licence.
 *              Required to OFFER a ride.
 *
 * A rider only ever needs a government ID. The licence is asked for at the
 * moment they try to offer a ride, not up front — most riders never will, and
 * demanding it during signup costs sign-ups for nothing.
 */

export type VerificationLevel = 1 | 2;

export interface VerifiableUser {
  /** Set once a government ID passed /kyc/document. */
  id_document_verified?: boolean;
  /** Set once a driving licence passed /kyc/document with purpose DRIVING_LICENCE. */
  driver_licence_verified?: boolean;
  /**
   * Legacy field. Users verified before tiers existed have this and nothing
   * else — they must not be demoted and locked out of booking.
   */
  kyc_status?: string;
  /** A simulated KYC pass is not sufficient for driver privileges. */
  kyc_simulated?: boolean;
}

/** Phone alone is Level 1; a checked government ID promotes to Level 2. */
export function verificationLevel(user: VerifiableUser | null | undefined): VerificationLevel {
  if (!user) return 1;
  if (user.id_document_verified === true) return 2;
  // Grandfather anyone verified under the old single-tier scheme.
  if (String(user.kyc_status).toUpperCase() === 'VERIFIED') return 2;
  return 1;
}

/** Has a driving licence been verified for this user? */
export function hasVerifiedLicence(user: VerifiableUser | null | undefined): boolean {
  return user?.driver_licence_verified === true;
}

export type RequiredAction = 'VERIFY_ID' | 'ADD_LICENCE' | 'REAL_KYC' | null;

export interface Gate {
  allowed: boolean;
  /** What the user must do next, for the UI to route them straight there. */
  required: RequiredAction;
  /** Machine-readable code for the client. */
  code?: 'VERIFICATION_REQUIRED' | 'LICENCE_REQUIRED' | 'REAL_VERIFICATION_REQUIRED';
  message?: string;
}

const ALLOWED: Gate = { allowed: true, required: null };

/** Booking a seat needs a government ID — nothing more. */
export function canBookRide(user: VerifiableUser | null | undefined): Gate {
  if (verificationLevel(user) < 2) {
    return {
      allowed: false,
      required: 'VERIFY_ID',
      code: 'VERIFICATION_REQUIRED',
      message: 'Verify a government ID to book a ride.',
    };
  }
  return ALLOWED;
}

/**
 * Offering a ride needs the government ID AND a driving licence.
 *
 * Checked in that order so a rider who has done neither is told to verify their
 * ID first, rather than being asked for a licence out of nowhere.
 */
export function canOfferRide(user: VerifiableUser | null | undefined): Gate {
  if (verificationLevel(user) < 2) {
    return {
      allowed: false,
      required: 'VERIFY_ID',
      code: 'VERIFICATION_REQUIRED',
      message: 'Verify a government ID before offering a ride.',
    };
  }
  if (user?.kyc_simulated === true) {
    return {
      allowed: false,
      required: 'REAL_KYC',
      code: 'REAL_VERIFICATION_REQUIRED',
      message: 'A simulated verification is not sufficient to offer rides.',
    };
  }
  if (!hasVerifiedLicence(user)) {
    return {
      allowed: false,
      required: 'ADD_LICENCE',
      code: 'LICENCE_REQUIRED',
      message: 'Add your driving licence to start offering rides.',
    };
  }
  return ALLOWED;
}

/** Everything the client needs to render the right verification prompt. */
export function verificationSummary(user: VerifiableUser | null | undefined) {
  const level = verificationLevel(user);
  return {
    level,
    id_verified: level >= 2,
    licence_verified: hasVerifiedLicence(user),
    can_book: canBookRide(user).allowed,
    can_offer_rides: canOfferRide(user).allowed,
  };
}
