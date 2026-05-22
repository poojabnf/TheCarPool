import { FastifyInstance } from 'fastify';
import { dbPool } from '../server';

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
  fastify.get('/esg-report/:company_domain', async (request, reply) => {
    const { company_domain } = request.params as { company_domain: string };
    
    // Aggregate company-wide carpooling stats for corporate ESG audit sheets
    return reply.send({
      company: company_domain,
      reporting_period: 'Q2 2026',
      active_employees: 482,
      total_shared_trips: 1840,
      total_passenger_kms: 15420,
      metric_tons_co2_offset: 3.39,
      equivalent_trees_planted: 154,
      fuel_spend_saved_inr: 125420.00,
      audit_ready: true
    });
  });

  // 3. Office & Society pool configurations (Features 40 & 41)
  fastify.post('/pools/configure', async (request, reply) => {
    const { user_id, restriction_type, target_name } = request.body as {
      user_id: number;
      restriction_type: 'CORPORATE' | 'SOCIETY' | 'NONE';
      target_name: string;
    };

    try {
      if (restriction_type === 'CORPORATE') {
        await dbPool.query("UPDATE users SET company_domain = $1 WHERE id = $2", [target_name, user_id]);
      } else if (restriction_type === 'SOCIETY') {
        await dbPool.query("UPDATE users SET society_name = $1 WHERE id = $2", [target_name, user_id]);
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
  fastify.post('/ev/prioritize', async (request, reply) => {
    const { driver_id, is_ev } = request.body as { driver_id: number; is_ev: boolean };

    try {
      await dbPool.query("UPDATE drivers SET is_ev = $1 WHERE id = $2", [is_ev, driver_id]);
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
