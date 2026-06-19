import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { creditWalletForPayment } from '../lib/wallet';
import { calculateSplit, suggestPricing, fuelSavings } from '../lib/pricing';
import {
  getRazorpay,
  isRazorpayConfigured,
  isRazorpayXConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../lib/razorpay';

const OrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).optional().default('INR'),
  booking_id: z.string().optional(),
});

// Note: amount is intentionally NOT taken from the client on verify — it is
// fetched from Razorpay so a caller can't claim more than they actually paid.
const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

const SplitSchema = z.object({
  total_fare: z.number().nonnegative(),
  passenger_count: z.number().int().positive(),
  seats_booked: z.number().int().positive(),
});

const PricingSchema = z.object({
  route_length_km: z.number().positive(),
  vehicle_type: z.enum(['CAR', 'BIKE']).optional().default('CAR'),
  ac_available: z.boolean().optional().default(true),
});

const PayoutSchema = z.object({
  upi_payout_id: z.string().min(3), // the payee VPA, e.g. name@bank
  amount: z.number().positive(),
  booking_id: z.union([z.string(), z.number()]).optional(),
});

const CorporateBillSchema = z.object({
  company_domain: z.string().min(1),
  amount: z.number().positive(),
  employee_id: z.string().optional(),
});

const CancellationSchema = z.object({
  booking_id: z.string().min(1),
});

const ReferralSchema = z.object({
  referral_code: z.string().min(3),
});

const REFERRAL_BONUS = 100; // ₹ credited to a user redeeming a valid referral.
// A cancellation counts as "late" within this window before departure.
const LATE_CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000;
const LATE_CANCEL_FEE = 50;

// Read (or lazily create) a user's wallet document.
async function getWallet(uid: string) {
  const ref = db.collection('wallets').doc(uid);
  const doc = await ref.get();
  if (!doc.exists) {
    const initial = { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
    await ref.set(initial);
    return initial;
  }
  return doc.data() as { available_wallet_balance: number; escrow_locked_balance: number; currency: string };
}

export async function paymentRoutes(fastify: FastifyInstance) {

  // 1. Wallet balance — real, persisted in Firestore.
  fastify.get('/wallet/:user_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    if (String(request.user!.id) !== String(user_id)) {
      return reply.code(403).send({ error: 'Forbidden: you can only view your own wallet.' });
    }
    const wallet = await getWallet(String(user_id));
    return reply.send({ user_id, ...wallet });
  });

  // 1a-ii. Transaction history — wallet credits (payments) + ride settlements.
  fastify.get('/history/:user_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    if (String(request.user!.id) !== String(user_id)) {
      return reply.code(403).send({ error: 'Forbidden: you can only view your own history.' });
    }
    try {
      const [paymentsSnap, bookingsSnap] = await Promise.all([
        db.collection('payments').where('user_id', '==', String(user_id)).get(),
        db.collection('bookings').where('rider_id', '==', String(user_id)).where('escrow_status', '==', 'SETTLED').get(),
      ]);

      const credits = paymentsSnap.docs.map((d) => {
        const p = d.data();
        return { id: d.id, type: 'CREDIT', label: 'Wallet top-up', amount: p.amount || 0, status: p.status || 'CAPTURED', at: p.created_at || null };
      });
      const debits = bookingsSnap.docs.map((d) => {
        const b = d.data();
        return { id: d.id, type: 'DEBIT', label: 'Ride payment', amount: -(b.settled_amount || 0), status: 'SETTLED', at: b.settled_at || b.created_at || null };
      });

      const transactions = [...credits, ...debits].sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return reply.send({ user_id, transactions });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch transaction history');
      return reply.code(500).send({ error: 'Failed to fetch transaction history.' });
    }
  });

  // 1b. Create a Razorpay order for a booking/top-up. The client uses the
  // returned order_id + key_id with Razorpay Checkout, then calls /verify.
  fastify.post('/order', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(OrderSchema, request.body, reply);
    if (!body) return;
    const { amount, currency, booking_id } = body;
    if (!isRazorpayConfigured()) {
      return reply.code(503).send({ error: 'Payments are not configured on this server.' });
    }
    try {
      const order = await getRazorpay().orders.create({
        amount: Math.round(amount * 100), // paise
        currency,
        notes: { user_id: request.user!.id, booking_id: booking_id || '' },
      });
      return reply.send({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: process.env.RAZORPAY_KEY_ID });
    } catch (err: any) {
      fastify.log.error(err, 'Razorpay order creation failed');
      return reply.code(502).send({ error: 'Failed to create payment order.' });
    }
  });

  // 1c. Verify a completed checkout and credit the user's wallet.
  fastify.post('/verify', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(VerifySchema, request.body, reply);
    if (!body) return;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return reply.code(400).send({ status: 'INVALID_SIGNATURE' });
    }
    if (!isRazorpayConfigured()) {
      return reply.code(503).send({ error: 'Payments are not configured on this server.' });
    }
    const uid = request.user!.id;
    try {
      // Trust Razorpay for the amount/status, never the client. This closes the
      // hole where a client could pay ₹1 and claim a large wallet credit.
      const payment: any = await getRazorpay().payments.fetch(razorpay_payment_id);
      if (!payment || payment.order_id !== razorpay_order_id) {
        return reply.code(400).send({ status: 'ORDER_MISMATCH' });
      }
      if (payment.status !== 'captured' && payment.status !== 'authorized') {
        return reply.code(400).send({ status: 'NOT_CAPTURED', payment_status: payment.status });
      }
      const amountRupees = Number(payment.amount) / 100;
      const { credited } = await creditWalletForPayment({
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id,
        uid,
        amountRupees,
      });
      return reply.send({
        status: 'PAYMENT_VERIFIED',
        payment_id: razorpay_payment_id,
        amount: amountRupees,
        wallet_credited: credited, // false if a prior verify/webhook already applied it
      });
    } catch (err: any) {
      fastify.log.error(err, 'Wallet credit failed after payment verify');
      return reply.code(500).send({ error: 'Payment verification failed.' });
    }
  });

  // 1d. Razorpay webhook — signature-verified, no bearer auth. Handles
  // asynchronous payment events as the source of truth.
  fastify.post('/webhook', async (request, reply) => {
    const signature = request.headers['x-razorpay-signature'] as string | undefined;
    const raw = (request as any).rawBody as Buffer | undefined;
    if (!signature || !raw || !verifyWebhookSignature(raw.toString('utf8'), signature)) {
      return reply.code(400).send({ error: 'Invalid webhook signature.' });
    }
    const event = request.body as any;
    try {
      if (event.event === 'payment.captured') {
        const payment = event.payload?.payment?.entity;
        const uid = payment?.notes?.user_id || null;
        if (payment?.id && uid) {
          // Source-of-truth credit. Idempotent: if /verify already credited
          // this payment, creditWalletForPayment is a no-op.
          await creditWalletForPayment({
            paymentId: payment.id,
            orderId: payment.order_id,
            uid,
            amountRupees: Number(payment.amount) / 100,
          });
        } else if (payment?.id) {
          // No user_id in notes — record the payment but flag it for manual
          // reconciliation rather than silently dropping it.
          await db.collection('payments').doc(payment.id).set({
            order_id: payment.order_id, amount: Number(payment.amount) / 100, status: 'CAPTURED',
            user_id: null, needs_reconciliation: true, updated_at: new Date().toISOString(),
          }, { merge: true });
        }
      }
      return reply.send({ received: true });
    } catch (err: any) {
      fastify.log.error(err, 'Webhook processing failed');
      return reply.code(500).send({ error: 'Webhook processing failed.' });
    }
  });

  // 2. Automated Split Engine & Group Discounts (Features 31 & 37)
  fastify.post('/split/calculate', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(SplitSchema, request.body, reply);
    if (!body) return;
    return reply.send(calculateSplit(body.total_fare, body.passenger_count, body.seats_booked));
  });

  // Suggest pricing logic (Feature 17 / BlaBlaCar Smart Pricing Gap)
  fastify.post('/split/suggest-pricing', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(PricingSchema, request.body, reply);
    if (!body) return;
    return reply.send(suggestPricing(body.route_length_km, body.vehicle_type, body.ac_available));
  });

  // 3. Instant Payout Releases via UPI (Feature 32) — RazorpayX.
  //
  // Security: a user may only withdraw from THEIR OWN wallet, only up to their
  // available balance, and the balance is debited atomically BEFORE the payout
  // is initiated. If RazorpayX rejects the payout the debit is refunded. This
  // closes the prior hole where any authenticated user could send arbitrary
  // amounts to arbitrary VPAs from the platform float.
  fastify.post('/payout/release', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(PayoutSchema, request.body, reply);
    if (!body) return;
    const { upi_payout_id, amount, booking_id } = body;
    const uid = request.user!.id;

    if (!isRazorpayXConfigured()) {
      return reply.code(503).send({ error: 'Instant payouts are not configured on this server.' });
    }

    const payoutRef = 'PO_' + Math.random().toString(36).substring(2, 10).toUpperCase();

    // Atomically reserve the funds from the caller's own wallet.
    try {
      await db.runTransaction(async (tx) => {
        const walletRef = db.collection('wallets').doc(uid);
        const walletDoc = await tx.get(walletRef);
        const available = Number(walletDoc.data()?.available_wallet_balance || 0);
        if (available < amount) {
          throw new Error('INSUFFICIENT_FUNDS');
        }
        tx.set(walletRef, { available_wallet_balance: available - amount }, { merge: true });
        tx.set(db.collection('payouts').doc(payoutRef), {
          booking_id: booking_id != null ? String(booking_id) : null,
          upi_payout_id,
          amount,
          status: 'RESERVED',
          requested_by: uid,
          created_at: new Date().toISOString(),
        });
      });
    } catch (err: any) {
      if (err.message === 'INSUFFICIENT_FUNDS') {
        return reply.code(402).send({ error: 'Insufficient wallet balance for this payout.' });
      }
      fastify.log.error(err, 'Payout fund reservation failed');
      return reply.code(500).send({ error: 'Failed to reserve payout funds.' });
    }

    // Funds reserved — now initiate the RazorpayX payout.
    const refundReservation = async () => {
      await db.runTransaction(async (tx) => {
        const walletRef = db.collection('wallets').doc(uid);
        const walletDoc = await tx.get(walletRef);
        const available = Number(walletDoc.data()?.available_wallet_balance || 0);
        tx.set(walletRef, { available_wallet_balance: available + amount }, { merge: true });
      });
    };

    try {
      const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
      const res = await fetch('https://api.razorpay.com/v1/payouts', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
          'X-Payout-Idempotency': payoutRef,
        },
        body: JSON.stringify({
          account_number: process.env.RAZORPAYX_ACCOUNT_NUMBER,
          fund_account: { account_type: 'vpa', vpa: { address: upi_payout_id } },
          amount: Math.round(amount * 100), // paise
          currency: 'INR',
          mode: 'UPI',
          purpose: 'payout',
          notes: { booking_id: booking_id != null ? String(booking_id) : '', payout_ref: payoutRef, user_id: uid },
        }),
      });
      const data = await res.json() as any;
      if (res.ok && data.id) {
        await db.collection('payouts').doc(payoutRef).update({
          status: 'PROCESSING',
          razorpayx_payout_id: data.id,
        });
        return reply.send({
          status: 'PAYOUT_PROCESSING',
          booking_id,
          upi_payout_id,
          transaction_ref: payoutRef,
          razorpayx_payout_id: data.id,
          amount_settled: amount,
        });
      }
      fastify.log.error(data, 'RazorpayX payout failed');
      await refundReservation();
      await db.collection('payouts').doc(payoutRef).update({ status: 'FAILED', razorpayx_error: data });
      return reply.code(502).send({ error: 'Payout initiation failed via RazorpayX.', detail: data?.error?.description });
    } catch (err: any) {
      fastify.log.error(err, 'RazorpayX API call failed');
      await refundReservation();
      await db.collection('payouts').doc(payoutRef).update({ status: 'FAILED' });
      return reply.code(502).send({ error: 'Payout API call failed.' });
    }
  });

  // 4. Corporate Billing Gateway invoicing (Feature 33)
  fastify.post('/corporate/bill-ride', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(CorporateBillSchema, request.body, reply);
    if (!body) return;
    const { employee_id, company_domain, amount } = body;

    // Membership check: only an admin, or a user whose verified email belongs to
    // the company, may bill that corporate account. Without this any user could
    // drain any company's budget.
    const callerDomain = (request.user!.email || '').split('@')[1]?.toLowerCase();
    if (request.user!.role !== 'ADMIN' && callerDomain !== company_domain.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden: you may only bill your own corporate account.' });
    }

    try {
      const accountDoc = await db.collection('corporate_accounts').doc(company_domain).get();
      if (!accountDoc.exists) {
        return reply.code(404).send({ error: `No corporate account found for domain: ${company_domain}` });
      }
      const account = accountDoc.data() as { monthly_budget: number; spent_this_month: number; currency: string };
      const remaining = (account.monthly_budget || 0) - (account.spent_this_month || 0);

      if (amount > remaining) {
        return reply.code(402).send({
          error: 'Monthly corporate budget exceeded.',
          budget_remaining: remaining,
        });
      }

      await db.collection('corporate_accounts').doc(company_domain).update({
        spent_this_month: (account.spent_this_month || 0) + Number(amount),
      });

      await db.collection('corporate_billing').add({
        employee_id: employee_id || null,
        company_domain,
        amount: Number(amount),
        billed_by: request.user!.id,
        billed_at: new Date().toISOString(),
      });

      return reply.send({
        status: 'BILLED_TO_CORPORATE_ALLOWANCE',
        employee_id,
        company: company_domain,
        charged_amount: amount,
        monthly_budget_remaining: parseFloat((remaining - amount).toFixed(2)),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Corporate billing failed');
      return reply.code(500).send({ error: 'Corporate billing failed.' });
    }
  });

  // 5. Fuel Savings Tracker (Feature 34)
  fastify.get('/savings/fuel/:user_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    if (String(request.user!.id) !== String(user_id)) {
      return reply.code(403).send({ error: 'Forbidden: you can only view your own savings.' });
    }

    try {
      const bookingsSnap = await db.collection('bookings')
        .where('rider_id', '==', String(user_id))
        .where('status', '==', 'COMPLETED')
        .get();

      let totalKm = 0;
      for (const doc of bookingsSnap.docs) {
        const data = doc.data();
        totalKm += Number(data.distance_km || 0);
      }

      return reply.send({
        user_id,
        ...fuelSavings(totalKm),
        rides_completed: bookingsSnap.size,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Fuel savings calculation failed');
      return reply.code(500).send({ error: 'Failed to calculate fuel savings.' });
    }
  });

  // 6. Cancellation Policy Escrow (Feature 35)
  //
  // Real cancellation: the caller must be the rider or the ride's driver on the
  // booking. Whether it's a "late" cancel is derived from the ride's actual
  // departure time (not hardcoded). The booking is flipped to CANCELLED, the
  // seats are returned to the ride, and any late fee is credited to the driver.
  fastify.post('/escrow/cancellation-charge', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(CancellationSchema, request.body, reply);
    if (!body) return;
    const { booking_id } = body;
    const uid = String(request.user!.id);

    try {
      const bookingRef = db.collection('bookings').doc(booking_id);
      const bookingDoc = await bookingRef.get();
      if (!bookingDoc.exists) {
        return reply.code(404).send({ error: 'Booking not found.' });
      }
      const booking = bookingDoc.data()!;

      const rideRef = db.collection('rides').doc(String(booking.ride_id));
      const rideDoc = await rideRef.get();
      const ride = rideDoc.exists ? rideDoc.data()! : {};

      // Resolve the driver's user id to authorise driver-initiated cancels.
      let driverUid: string | null = ride.driver_uid || null;
      if (!driverUid && ride.driver_id) {
        const drvDoc = await db.collection('drivers').doc(String(ride.driver_id)).get();
        driverUid = drvDoc.exists ? String(drvDoc.data()?.user_id) : null;
      }

      const isRider = uid === String(booking.rider_id);
      const isDriver = driverUid != null && uid === String(driverUid);
      if (!isRider && !isDriver) {
        return reply.code(403).send({ error: 'Forbidden: only the rider or driver can cancel this booking.' });
      }
      const cancelled_by: 'RIDER' | 'DRIVER' = isRider ? 'RIDER' : 'DRIVER';

      if (booking.escrow_status !== 'HELD') {
        return reply.code(400).send({ error: 'Booking is not in a cancellable state.' });
      }

      // Late if we're within the late-cancel window of departure (rider only).
      const departureMs = ride.departure_time ? new Date(ride.departure_time).getTime() : NaN;
      const isLateCancel = Number.isFinite(departureMs)
        ? departureMs - Date.now() < LATE_CANCEL_WINDOW_MS
        : false;
      const fare = Number(ride.price_split || 0) * Number(booking.seats_booked || 1);
      const fee = cancelled_by === 'RIDER' && isLateCancel ? Math.min(LATE_CANCEL_FEE, fare || LATE_CANCEL_FEE) : 0;

      await db.runTransaction(async (tx) => {
        // All reads first (Firestore requires reads before writes).
        const fresh = await tx.get(bookingRef);
        if (fresh.data()?.escrow_status !== 'HELD') {
          throw new Error('ALREADY_RESOLVED');
        }
        const walletRef = fee > 0 && driverUid ? db.collection('wallets').doc(driverUid) : null;
        const walletDoc = walletRef ? await tx.get(walletRef) : null;

        // Writes.
        if (rideDoc.exists) {
          const seatsAvail = Number(ride.seats_available || 0) + Number(booking.seats_booked || 1);
          tx.update(rideRef, { seats_available: seatsAvail });
        }
        tx.update(bookingRef, {
          escrow_status: 'CANCELLED',
          payment_status: fee > 0 ? 'CANCELLED_WITH_FEE' : 'CANCELLED_REFUNDED',
          cancelled_by,
          cancellation_fee: fee,
          cancelled_at: new Date().toISOString(),
        });
        // Credit the late fee to the driver's wallet.
        if (walletRef) {
          const cur = walletDoc?.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
          tx.set(walletRef, { ...cur, available_wallet_balance: (cur.available_wallet_balance || 0) + fee }, { merge: true });
        }
      });

      return reply.send({
        booking_id,
        cancelled_by,
        late_cancellation: isLateCancel,
        cancellation_fee: fee,
        action: fee > 0 ? 'CHARGED_TO_RIDER_AND_CREDITED_TO_DRIVER' : 'FULL_REFUND_RELEASED',
      });
    } catch (err: any) {
      if (err.message === 'ALREADY_RESOLVED') {
        return reply.code(400).send({ error: 'Booking has already been cancelled or settled.' });
      }
      fastify.log.error(err, 'Cancellation processing failed');
      return reply.code(500).send({ error: 'Failed to process cancellation.' });
    }
  });

  // 7. Referral Wallet bonuses (Feature 36)
  //
  // Hardened: the code must resolve to a *different* real user, the redeemer can
  // only ever claim one referral bonus (enforced atomically via a
  // referral_redemptions/{uid} marker), and the whole thing runs in one
  // transaction so it can't be replayed to mint unlimited balance.
  fastify.post('/referral/redeem', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(ReferralSchema, request.body, reply);
    if (!body) return;
    const code = body.referral_code.trim();
    const uid = request.user!.id;

    try {
      // Resolve the referral code to its owner. Codes are stored on user docs as
      // `referral_code`; fall back to treating the code as a user id.
      let referrerUid: string | null = null;
      const byCode = await db.collection('users').where('referral_code', '==', code).limit(1).get();
      if (!byCode.empty) {
        referrerUid = byCode.docs[0].id;
      } else {
        const asUser = await db.collection('users').doc(code).get();
        if (asUser.exists) referrerUid = asUser.id;
      }

      if (!referrerUid) {
        return reply.code(404).send({ error: 'Invalid referral code.' });
      }
      if (referrerUid === uid) {
        return reply.code(400).send({ error: 'You cannot redeem your own referral code.' });
      }

      const redemptionRef = db.collection('referral_redemptions').doc(uid);
      const walletRef = db.collection('wallets').doc(uid);
      let newBalance = 0;

      await db.runTransaction(async (tx) => {
        const redemptionDoc = await tx.get(redemptionRef);
        if (redemptionDoc.exists) {
          throw new Error('ALREADY_REDEEMED');
        }
        const walletDoc = await tx.get(walletRef);
        const cur = walletDoc.exists ? walletDoc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
        newBalance = (cur.available_wallet_balance || 0) + REFERRAL_BONUS;
        tx.set(walletRef, { ...cur, available_wallet_balance: newBalance }, { merge: true });
        tx.set(redemptionRef, {
          user_id: uid,
          referrer_uid: referrerUid,
          referral_code: code,
          bonus: REFERRAL_BONUS,
          redeemed_at: new Date().toISOString(),
        });
      });

      return reply.send({
        status: 'REFERRAL_APPLIED',
        user_id: uid,
        referral_code: code,
        wallet_credits_added: REFERRAL_BONUS,
        new_wallet_balance: newBalance,
      });
    } catch (err: any) {
      if (err.message === 'ALREADY_REDEEMED') {
        return reply.code(409).send({ error: 'You have already redeemed a referral bonus.' });
      }
      fastify.log.error(err, 'Referral redemption failed');
      return reply.code(500).send({ error: 'Failed to redeem referral code.' });
    }
  });
}
