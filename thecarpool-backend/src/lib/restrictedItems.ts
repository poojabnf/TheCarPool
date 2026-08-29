/**
 * What may not be carried on a shared ride.
 *
 * Defined here, on the server, so the rule has one source. A list hardcoded in
 * the app would drift the moment either store held an update back, and two
 * versions of the app would then be showing riders two different sets of rules
 * while the same booking endpoint recorded the same acknowledgement for both.
 *
 * This is a carpool between private individuals, not a licensed carrier. The
 * driver's own insurance covers a car with passengers in it, and nothing here
 * is negotiable at the kerb — a driver who finds one of these in a bag is
 * entitled to refuse the rider and keep the ride moving.
 *
 * NOT legal advice and not exhaustive. It is the plain-language list a rider
 * can actually read before they tap Pay, which is what makes an
 * acknowledgement worth recording.
 */

export interface RestrictedItemRule {
  /** Short label for the list. */
  label: string;
  /** Why, in one clause. People follow a rule they understand. */
  reason: string;
}

export const RESTRICTED_ITEMS: RestrictedItemRule[] = [
  {
    label: 'Illegal drugs or controlled substances',
    reason: 'the driver is liable for what is in their vehicle',
  },
  {
    label: 'Weapons, ammunition or explosives',
    reason: 'including licensed firearms, which need their own transport arrangements',
  },
  {
    label: 'Flammable or pressurised goods',
    reason: 'petrol cans, gas cylinders, fireworks and industrial chemicals',
  },
  {
    label: 'Live animals other than an agreed pet',
    reason: 'mention a pet in your note so the driver can agree to it first',
  },
  {
    label: 'Anything requiring a commercial transport permit',
    reason: 'goods for resale, bulk cargo, or hazardous materials',
  },
  {
    label: 'Stolen goods or unaccompanied parcels',
    reason: 'never carry a package for someone who is not travelling with you',
  },
];

/** One-line summary for a push or SMS, where a list will not fit. */
export const RESTRICTED_ITEMS_SUMMARY =
  'No drugs, weapons, flammable or pressurised goods, unaccompanied parcels, or anything needing a commercial transport permit.';

/** Shown above the acknowledgement at booking. */
export const RESTRICTED_ITEMS_HEADLINE = 'What you can bring';

export const RESTRICTED_ITEMS_ACK_LABEL =
  'I confirm I am not carrying any restricted item';

/**
 * The note that makes the rule real rather than decorative: a driver may
 * refuse, and refusing for this reason is not a cancellation against them.
 */
export const RESTRICTED_ITEMS_FOOTER =
  'Your driver can refuse to carry anything on this list, and can end the trip if it appears during the journey.';
