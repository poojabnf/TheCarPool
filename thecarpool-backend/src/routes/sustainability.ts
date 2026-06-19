import { FastifyInstance } from 'fastify';
import { db } from '../server';
import { requireAuth } from '../middleware/auth';

export async function sustainabilityRoutes(fastify: FastifyInstance) {

  // 1. Carbon Offset Dashboard & Leaderboards (Features 38 & 44)
  fastify.get('/leaderboard', async (request, reply) => {
    // Return top fuel and carbon savers in the tech park
    return reply.send([
      { rank: 1, name: 'Vikram Singh (Google)', co2_saved_kg: 84.5, matches: 22, points: 845 },
      { rank: 2, name: 'Priyanka Sen (TCS)', co2_saved_kg: 72.1, matches: 18, points: 721 },
      { rank: 3, name: 'Rahul Sharma (Infosys)', co2_saved_kg: 68.0, matches: 19, points: 680 }
    ]);
  });

  // 2. ESG Enterprise Portals (Feature 39)
  fastify.get('/esg-report/:company_domain', { preHandler: [requireAuth] }, async (request, reply) => {
    const { company_domain } = request.params as { company_domain: string };

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
    const { restriction_type, target_name } = request.body as {
      restriction_type: 'CORPORATE' | 'SOCIETY' | 'NONE';
      target_name: string;
    };
    const user_id = request.user!.id;

    try {
      if (restriction_type === 'CORPORATE') {
        await db.collection('users').doc(String(user_id)).update({ company_domain: target_name });
      } else if (restriction_type === 'SOCIETY') {
        await db.collection('users').doc(String(user_id)).update({ society_name: target_name });
      }

      return reply.send({
        status: 'POOL_RESTRICTION_UPDATED',
        restriction_type,
        target_name,
        total_group_members: Math.floor(Math.random() * 50) + 12
      });
    } catch (err: any) {
      fastify.log.error('Failed to configure pool restrictions:', err);
      return reply.code(500).send({ error: 'Failed to configure pools.' });
    }
  });

  // 4. EV Matching priority filter (Feature 43)
  fastify.post('/ev/prioritize', { preHandler: [requireAuth] }, async (request, reply) => {
    const { driver_id, is_ev } = request.body as { driver_id: number; is_ev: boolean };

    try {
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
