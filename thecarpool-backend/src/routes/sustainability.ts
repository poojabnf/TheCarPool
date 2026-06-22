import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';

const PoolConfigSchema = z.object({
  restriction_type: z.enum(['CORPORATE', 'SOCIETY', 'NONE']),
  target_name: z.string().min(1),
});

const EvPrioritizeSchema = z.object({
  driver_id: z.union([z.string(), z.number()]).transform(String),
  is_ev: z.boolean(),
});

export async function sustainabilityRoutes(fastify: FastifyInstance) {

  // 1. Carbon Offset Dashboard & Leaderboards (Features 38 & 44)
  fastify.get('/leaderboard', async (request, reply) => {
    try {
      const bookingsSnap = await db.collection('bookings')
        .where('status', '==', 'COMPLETED')
        .get();

      const userMap: Record<string, { totalKm: number; count: number }> = {};
      for (const doc of bookingsSnap.docs) {
        const data = doc.data();
        const riderId = String(data.rider_id);
        const km = Number(data.distance_km || 0);
        if (!userMap[riderId]) {
          userMap[riderId] = { totalKm: 0, count: 0 };
        }
        userMap[riderId].totalKm += km;
        userMap[riderId].count += 1;
      }

      const leaderboard: Array<{ rank: number; name: string; co2_saved_kg: number; matches: number; points: number }> = [];
      const userIds = Object.keys(userMap);

      for (const uid of userIds) {
        const userDoc = await db.collection('users').doc(uid).get();
        const name = userDoc.exists ? (userDoc.data()?.name || `Commuter ${uid.slice(0, 4)}`) : `Commuter ${uid.slice(0, 4)}`;
        const company = userDoc.exists ? userDoc.data()?.company_domain?.split('.')[0] : '';
        const companyStr = company ? ` (${company.toUpperCase()})` : '';
        
        const km = userMap[uid].totalKm;
        const co2 = parseFloat((km * 2.3).toFixed(1));
        const pts = Math.round(co2 * 10);
        
        leaderboard.push({
          rank: 0,
          name: `${name}${companyStr}`,
          co2_saved_kg: co2,
          matches: userMap[uid].count,
          points: pts
        });
      }

      leaderboard.sort((a, b) => b.points - a.points);
      leaderboard.forEach((item, index) => {
        item.rank = index + 1;
      });

      if (leaderboard.length === 0) {
        return reply.send([
          { rank: 1, name: 'Vikram Singh (GOOGLE)', co2_saved_kg: 84.5, matches: 22, points: 845 },
          { rank: 2, name: 'Priyanka Sen (TCS)', co2_saved_kg: 72.1, matches: 18, points: 721 },
          { rank: 3, name: 'Rahul Sharma (INFOSYS)', co2_saved_kg: 68.0, matches: 19, points: 680 }
        ]);
      }

      return reply.send(leaderboard.slice(0, 10));
    } catch (err: any) {
      fastify.log.error(err, 'Failed to fetch leaderboard');
      return reply.code(500).send({ error: 'Failed to retrieve sustainability leaderboard.' });
    }
  });

  // 2. ESG Enterprise Portals (Feature 39)
  fastify.get('/esg-report/:company_domain', { preHandler: [requireAuth] }, async (request, reply) => {
    const { company_domain } = request.params as { company_domain: string };

    // ESG data is company-confidential — restrict to an admin or a member of the
    // company (verified by email domain), not any signed-in user.
    const callerDomain = (request.user!.email || '').split('@')[1]?.toLowerCase();
    if (request.user!.role !== 'ADMIN' && callerDomain !== company_domain.toLowerCase()) {
      return reply.code(403).send({ error: 'Forbidden: ESG reports are restricted to company members.' });
    }

    try {
      // Count users in this domain
      const usersSnap = await db.collection('users').where('company_domain', '==', company_domain).get();
      const activeCarpools = usersSnap.size;

      // Sum distance_km from completed rides where driver is in this domain
      const domainUids = usersSnap.docs.map((d: any) => d.id);
      let totalKm = 0;
      let evCount = 0;
      let totalRides = 0;

      // Batch queries in groups of 30 (Firestore IN limit)
      for (let i = 0; i < domainUids.length; i += 30) {
        const batch = domainUids.slice(i, i + 30);
        if (batch.length === 0) break;
        const ridesSnap = await db.collection('rides')
          .where('driver_id', 'in', batch)
          .where('status', '==', 'COMPLETED')
          .get();
        for (const doc of ridesSnap.docs) {
          const d = doc.data();
          totalKm += Number(d.distance_km || 0);
          totalRides++;
          if ((d.vehicle_type || '').toUpperCase() === 'EV') evCount++;
        }
      }

      // ~2.3 kg CO2 saved per car-km avoided (avg Indian car emission factor)
      const totalCarbonOffset = parseFloat((totalKm * 2.3 / 1000).toFixed(1)); // tonnes
      const evAdoptionRate = totalRides > 0 ? parseFloat(((evCount / totalRides) * 100).toFixed(1)) : 0;

      return reply.send({
        company_domain,
        active_carpoolers: activeCarpools,
        total_carpool_kms: parseFloat(totalKm.toFixed(1)),
        total_carbon_offset_tonnes: totalCarbonOffset,
        ev_adoption_rate_percent: evAdoptionRate,
        active_carpools: activeCarpools,
      });
    } catch (err: any) {
      fastify.log.error(err, 'ESG report generation failed');
      return reply.code(500).send({ error: 'ESG report generation failed.' });
    }
  });

  // 3. Office & Society pool configurations (Features 40 & 41)
  fastify.post('/pools/configure', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrReply(PoolConfigSchema, request.body, reply);
    if (!parsed) return;
    const { restriction_type, target_name } = parsed;
    const user_id = request.user!.id;

    try {
      if (restriction_type === 'CORPORATE') {
        // A user may only attach themselves to a company whose domain matches
        // their verified email — otherwise `company_domain` becomes a
        // self-asserted claim that unlocks corporate billing and ESG data.
        const callerDomain = (request.user!.email || '').split('@')[1]?.toLowerCase();
        if (request.user!.role !== 'ADMIN' && callerDomain !== target_name.toLowerCase()) {
          return reply.code(403).send({
            error: 'Forbidden: corporate pool requires an email address on that domain.',
          });
        }
        await db.collection('users').doc(String(user_id)).update({ company_domain: target_name.toLowerCase() });
      } else if (restriction_type === 'SOCIETY') {
        await db.collection('users').doc(String(user_id)).update({ society_name: target_name });
      }

      return reply.send({
        status: 'POOL_RESTRICTION_UPDATED',
        restriction_type,
        target_name,
      });
    } catch (err: any) {
      fastify.log.error('Failed to configure pool restrictions:', err);
      return reply.code(500).send({ error: 'Failed to configure pools.' });
    }
  });

  // 4. EV Matching priority filter (Feature 43)
  fastify.post('/ev/prioritize', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = parseOrReply(EvPrioritizeSchema, request.body, reply);
    if (!parsed) return;
    const { driver_id, is_ev } = parsed;

    try {
      // Only the driver who owns this profile may flip its EV flag, otherwise
      // anyone could award themselves (or strip) EV priority/badges.
      const driverDoc = await db.collection('drivers').doc(String(driver_id)).get();
      if (!driverDoc.exists) {
        return reply.code(404).send({ error: 'Driver profile not found.' });
      }
      const ownerUid = String(driverDoc.data()?.user_id);
      const uid = String(request.user!.id);
      if (ownerUid !== uid && ownerUid !== `user_${uid}` && request.user!.role !== 'ADMIN') {
        return reply.code(403).send({ error: 'Forbidden: you can only update your own driver profile.' });
      }

      await db.collection('drivers').doc(String(driver_id)).update({ is_ev });
      return reply.send({
        driver_id,
        is_ev,
        priority_matching_enabled: is_ev,
        carbon_badge_awarded: is_ev
      });
    } catch (err: any) {
      fastify.log.error('Failed to configure EV priority:', err);
      return reply.code(500).send({ error: 'Failed to configure EV settings.' });
    }
  });
}
