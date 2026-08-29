/**
 * Razorpay Route — paying drivers by splitting the rider's payment.
 *
 * Why this and not RazorpayX: RazorpayX is not available to individual
 * merchants, so `sendPayout` can never work on this account. Route takes a
 * different shape — instead of sending money OUT of our balance, it splits an
 * INCOMING payment to a linked account, and Razorpay settles it onward.
 *
 * That happens to fit the escrow model better than what it replaces:
 *
 *   booking paid   → transfer created with on_hold: true   (Razorpay holds it)
 *   hold matures   → PATCH on_hold: false                  (Razorpay settles it)
 *   disputed       → the transfer simply stays held
 *
 * The money never sits in our own ledger pretending to be escrow, which
 * matters for an individual merchant with no payment-aggregator licence.
 *
 * A transfer is created against a captured PAYMENT, so this path only applies
 * to Razorpay-funded bookings. Wallet-funded bookings keep the existing
 * wallet-credit route — see settleDueBookingsForRide.
 */

const API = 'https://api.razorpay.com/v1';

/** Route rides on the ordinary Razorpay keys — no separate product to enable. */
export function isRouteConfigured(): boolean {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function authHeader(): string {
  const pair = `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`;
  return `Basic ${Buffer.from(pair).toString('base64')}`;
}

/** Razorpay works in paise; a transfer must be at least 100 of them. */
export const MIN_TRANSFER_PAISE = 100;

export interface RouteTransfer {
  id: string;
  status: string;
  amount: number;
  on_hold: boolean;
}

/**
 * Create a Route linked account for a driver.
 *
 * This is the step that was previously done by hand in the Razorpay dashboard
 * and pasted back through an admin endpoint — which meant, in practice, that
 * no driver ever had one and the whole Route path was dead code.
 *
 * Razorpay models a linked account as a sub-merchant, so the payload is
 * business-shaped even for one person driving their own car: `business_type:
 * 'individual'` with the driver as the legal entity. The PAN goes in as the
 * legal identifier.
 *
 * IMPORTANT — what "created" does and does not mean: a successful call returns
 * an `acc_…` id and lets us create transfers against it. It does NOT mean
 * Razorpay has finished KYC or that settlements to the driver's bank are
 * switched on. Razorpay may hold settlement pending its own checks, and a
 * transfer to an unactivated account stays with Razorpay rather than failing
 * loudly. Callers must treat this as "submitted", not "verified".
 */
export interface LinkedAccount {
  id: string;
  status?: string;
}

export async function createLinkedAccount(opts: {
  /** Distinguishes one driver's account from another in the Razorpay dashboard. */
  referenceId: string;
  email: string;
  phone?: string | null;
  name: string;
  pan: string;
}): Promise<LinkedAccount> {
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: opts.email,
      phone: opts.phone || undefined,
      type: 'route',
      reference_id: opts.referenceId,
      legal_business_name: opts.name,
      business_type: 'individual',
      contact_name: opts.name,
      profile: {
        // Ride-hailing / passenger transport. Razorpay requires a category on
        // every linked account; an unrecognised one is rejected outright.
        category: 'transport',
        subcategory: 'cabs',
      },
      legal_info: {
        pan: opts.pan,
      },
    }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Linked account creation failed (${res.status}): ${data?.error?.description || 'unknown'}`
    );
  }
  if (!data?.id) throw new Error('Linked account creation returned no account id');
  return { id: String(data.id), status: data.status ? String(data.status) : undefined };
}

/**
 * Split a captured payment to the driver's linked account, held.
 *
 * Deliberately created WITHOUT `on_hold_until`: at booking time we do not know
 * when the ride will finish, and an indefinite hold released explicitly is
 * safer than a timestamp guessed hours in advance — a transfer that
 * auto-released while a dispute was open would be very hard to claw back.
 *
 * Returns null when the amount is too small to transfer, so the caller falls
 * back to the wallet rather than failing the booking.
 */
export async function createHeldTransfer(opts: {
  paymentId: string;
  accountId: string;
  amountRupees: number;
  notes?: Record<string, string>;
}): Promise<RouteTransfer> {
  const paise = Math.round(opts.amountRupees * 100);
  if (!Number.isFinite(paise) || paise < MIN_TRANSFER_PAISE) {
    throw new Error(`Transfer amount too small: ${opts.amountRupees}`);
  }

  const res = await fetch(`${API}/payments/${encodeURIComponent(opts.paymentId)}/transfers`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transfers: [{
        account: opts.accountId,
        amount: paise,
        currency: 'INR',
        on_hold: true,
        notes: opts.notes ?? {},
      }],
    }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Route transfer failed (${res.status}): ${data?.error?.description || 'unknown'}`);
  }
  const item = data?.items?.[0];
  if (!item?.id) throw new Error('Route transfer returned no transfer id');
  return { id: item.id, status: item.status, amount: item.amount, on_hold: item.on_hold };
}

/**
 * Release a held transfer so Razorpay settles it to the driver.
 * Settlement lands with the linked account by the next working day.
 */
export async function releaseTransfer(transferId: string): Promise<RouteTransfer> {
  const res = await fetch(`${API}/transfers/${encodeURIComponent(transferId)}`, {
    method: 'PATCH',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ on_hold: false }),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Route release failed (${res.status}): ${data?.error?.description || 'unknown'}`);
  }
  return { id: data.id, status: data.status, amount: data.amount, on_hold: data.on_hold };
}

/**
 * Reverse a held transfer, returning the money to the platform balance so the
 * rider can be refunded from it. Used when a driver-cancel or dispute refund
 * happens after a transfer already exists.
 */
export async function reverseTransfer(transferId: string, amountRupees?: number): Promise<void> {
  const body = amountRupees !== undefined
    ? JSON.stringify({ amount: Math.round(amountRupees * 100) })
    : JSON.stringify({});
  const res = await fetch(`${API}/transfers/${encodeURIComponent(transferId)}/reversals`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body,
  });
  if (!res.ok) {
    const data: any = await res.json().catch(() => ({}));
    throw new Error(`Route reversal failed (${res.status}): ${data?.error?.description || 'unknown'}`);
  }
}
