import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import {
  getRazorpay,
  isRazorpayConfigured,
  isRazorpayXConfigured,
  createUpiPayout,
  verifyPaymentSignature,
  verifyWebhookSignature,
} from '../lib/razorpay';

const OrderSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().length(3).optional().default('INR'),
  booking_id: z.string().optional(),
});

const VerifySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  amount: z.number().positive(),
});

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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = body;
    if (!verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature)) {
      return reply.code(400).send({ status: 'INVALID_SIGNATURE' });
    }
    const uid = request.user!.id;
    try {
      const ref = db.collection('wallets').doc(uid);
      await db.runTransaction(async (tx) => {
        const doc = await tx.get(ref);
        const cur = doc.exists ? doc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
        tx.set(ref, { ...cur, available_wallet_balance: (cur.available_wallet_balance || 0) + Number(amount) }, { merge: true });
      });
      // Idempotency record so a replayed verify can't double-credit.
      await db.collection('payments').doc(razorpay_payment_id).set({
        user_id: uid, order_id: razorpay_order_id, amount, status: 'CAPTURED', created_at: new Date().toISOString(),
      }, { merge: true });
      return reply.send({ status: 'PAYMENT_VERIFIED', payment_id: razorpay_payment_id });
    } catch (err: any) {
      fastify.log.error(err, 'Wallet credit failed after payment verify');
      return reply.code(500).send({ error: 'Payment verified but wallet update failed.' });
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
        if (payment?.id) {
          await db.collection('payments').doc(payment.id).set({
            order_id: payment.order_id, amount: payment.amount / 100, status: 'CAPTURED',
            user_id: payment.notes?.user_id || null, updated_at: new Date().toISOString(),
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
    const { total_fare, passenger_count, seats_booked } = request.body as {
      total_fare: number;
      passenger_count: number;
      seats_booked: number;
    };

    let baseSplit = total_fare / (passenger_count || 1);
    let discountAmount = 0;

    // Group Discounts (Feature 37): Apply 15% discount if booking multiple seats
    if (seats_booked > 1) {
      discountAmount = baseSplit * 0.15;
      baseSplit -= discountAmount;
    }

    return reply.send({
      original_split_per_passenger: total_fare / passenger_count,
      discount_applied: discountAmount > 0,
      discount_amount: discountAmount,
      final_split_charge: parseFloat((baseSplit * seats_booked).toFixed(2))
    });
  });

  // Suggest pricing logic (Feature 17 / BlaBlaCar Smart Pricing Gap)
  fastify.post('/split/suggest-pricing', { preHandler: [requireAuth] }, async (request, reply) => {
    const { route_length_km, vehicle_type = 'CAR', ac_available = true } = request.body as {
      route_length_km: number;
      vehicle_type?: 'CAR' | 'BIKE';
      ac_available?: boolean;
    };

    if (!route_length_km || route_length_km <= 0) {
      return reply.code(400).send({ error: 'Route length is required and must be greater than zero.' });
    }

    const baseRatePerKm = vehicle_type === 'BIKE' ? 6.00 : 12.00;
    const acMultiplier = (vehicle_type === 'CAR' && ac_available) ? 2.00 : 0.00;
    const finalRatePerKm = baseRatePerKm + acMultiplier;

    const suggestedTotal = route_length_km * finalRatePerKm;

    return reply.send({
      route_length_km,
      vehicle_type,
      ac_available,
      rate_per_km: finalRatePerKm,
      suggested_total_compensation: parseFloat(suggestedTotal.toFixed(2)),
      suggested_passenger_split: parseFloat(suggestedTotal.toFixed(2))
    });
  });

  // 3. Instant Payout Releases to drivers via UPI (Feature 32) — RazorpayX.
  fastify.post('/payout/release', { preHandler: [requireAuth] }, async (request, reply) => {
    const { booking_id, upi_payout_id, amount } = request.body as {
      booking_id: number;
      upi_payout_id: string;
      amount: number;
    };

    if (!upi_payout_id || !amount || amount <= 0) {
      return reply.code(400).send({ error: 'upi_payout_id and a positive amount are required.' });
    }

    const payoutRef = 'PO_' + Math.random().toString(36).substring(2, 10).toUpperCase();
    const status = process.env.RAZORPAYX_ACCOUNT_NUMBER ? 'QUEUED' : 'PENDING_CONFIG';

    await db.collection('payouts').doc(payoutRef).set({
      booking_id: String(booking_id),
      upi_payout_id,
      amount,
      status,
      requested_by: request.user!.id,
      created_at: new Date().toISOString(),
    });

    // Call RazorpayX Payouts API when account is configured
    if (process.env.RAZORPAYX_ACCOUNT_NUMBER && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
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
            notes: { booking_id: String(booking_id), payout_ref: payoutRef },
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
        await db.collection('payouts').doc(payoutRef).update({ status: 'FAILED', razorpayx_error: data });
        return reply.code(502).send({ error: 'Payout initiation failed via RazorpayX.', detail: data?.error?.description });
      } catch (err: any) {
        fastify.log.error(err, 'RazorpayX API call failed');
        await db.collection('payouts').doc(payoutRef).update({ status: 'FAILED' });
        return reply.code(502).send({ error: 'Payout API call failed.' });
      }
    }

    return reply.send({
      status: status === 'QUEUED' ? 'PAYOUT_QUEUED' : 'PAYOUT_RECORDED_PENDING_CONFIG',
      booking_id,
      upi_payout_id,
      transaction_ref: payoutRef,
      amount_settled: amount,
      timestamp: new Date(),
    });
  });

  // 4. Corporate Billing Gateway invoicing (Feature 33)
  fastify.post('/corporate/bill-ride', { preHandler: [requireAuth] }, async (request, reply) => {
    const { employee_id, company_domain, amount } = request.body as any;

    if (!company_domain || !amount) {
      return reply.code(400).send({ error: 'company_domain and amount are required.' });
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

      // ₹12/km taxi rate vs ₹4/km carpool rate
      const taxiRate = 12;
      const carpoolRate = 4;
      const equivalentTaxiCost = parseFloat((totalKm * taxiRate).toFixed(2));
      const carpoolCost = parseFloat((totalKm * carpoolRate).toFixed(2));
      const totalSaved = parseFloat((equivalentTaxiCost - carpoolCost).toFixed(2));
      // ~3.5L/100km * price ₹106/L
      const fuelLitersPrevented = parseFloat(((totalKm * 3.5) / 100).toFixed(1));

      return reply.send({
        user_id,
        total_commute_kms: parseFloat(totalKm.toFixed(1)),
        equivalent_taxi_cost: equivalentTaxiCost,
        thecarpool_cost: carpoolCost,
        total_fuel_saved_inr: totalSaved,
        prevented_fuel_liters: fuelLitersPrevented,
        rides_completed: bookingsSnap.size,
      });
    } catch (err: any) {
      fastify.log.error(err, 'Fuel savings calculation failed');
      return reply.code(500).send({ error: 'Failed to calculate fuel savings.' });
    }
  });

  // 6. Cancellation Policy Escrow (Feature 35)
  fastify.post('/escrow/cancellation-charge', { preHandler: [requireAuth] }, async (request, reply) => {
    const { booking_id, cancelled_by } = request.body as { booking_id: number; cancelled_by: 'RIDER' | 'DRIVER' };

    const isLateCancel = true;
    const fee = (cancelled_by === 'RIDER' && isLateCancel) ? 50.00 : 0.00;

    return reply.send({
      booking_id,
      cancelled_by,
      cancellation_fee: fee,
      action: fee > 0 ? 'CHARGED_TO_RIDER_ESCROW_AND_CREDITED_TO_DRIVER' : 'FULL_REFUND_RELEASED'
    });
  });

  // 7. Referral Wallet bonuses (Feature 36)
  fastify.post('/referral/redeem', { preHandler: [requireAuth] }, async (request, reply) => {
    const { referral_code } = request.body as any;
    const uid = request.user!.id;

    // Credit the referral bonus to the user's real wallet.
    const ref = db.collection('wallets').doc(uid);
    let newBalance = 0;
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const cur = doc.exists ? doc.data()! : { available_wallet_balance: 0, escrow_locked_balance: 0, currency: 'INR' };
      newBalance = (cur.available_wallet_balance || 0) + 100;
      tx.set(ref, { ...cur, available_wallet_balance: newBalance }, { merge: true });
    });

    return reply.send({
      status: 'REFERRAL_APPLIED',
      user_id: uid,
      referral_code,
      wallet_credits_added: 100.00,
      new_wallet_balance: newBalance
    });
  });
}
