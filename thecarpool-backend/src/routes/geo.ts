import { FastifyInstance } from 'fastify';
import { db, redisClient } from '../server';
import { requireAuth } from '../middleware/auth';
import { searchPlaces } from '../lib/maps';

interface SearchQuery {
  query?: string;
}

/**
 * In-process fallback cache for place lookups.
 *
 * The Redis cache below is the intended one, but REDIS_URL is not set in
 * production, so `redisClient.isOpen` is always false and EVERY keystroke
 * reached Google Places — a billed request per character typed. This keeps
 * repeated queries off the paid API even with no Redis.
 *
 * Deliberately tiny and process-local: the container is short-lived at
 * min-instances=0, so this is a burst cache (one user typing, several users
 * searching the same landmarks), not durable storage. Redis still wins when
 * configured, and this is skipped entirely in that case.
 */
const MEMO_TTL_MS = 5 * 60 * 1000;
const MEMO_MAX_ENTRIES = 500;
const memoCache = new Map<string, { at: number; payload: any }>();

function memoGet(key: string): any | null {
  const hit = memoCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > MEMO_TTL_MS) {
    memoCache.delete(key);
    return null;
  }
  // Refresh recency so the popular queries are the ones that survive eviction.
  memoCache.delete(key);
  memoCache.set(key, hit);
  return hit.payload;
}

function memoSet(key: string, payload: any): void {
  if (memoCache.size >= MEMO_MAX_ENTRIES) {
    // Map preserves insertion order, so the first key is the least recently used.
    const oldest = memoCache.keys().next().value;
    if (oldest !== undefined) memoCache.delete(oldest);
  }
  memoCache.set(key, { at: Date.now(), payload });
}

export async function geoRoutes(fastify: FastifyInstance) {

  // 1. Search for a postal code or place name in Firestore
  fastify.get('/search', { preHandler: [requireAuth] }, async (request, reply) => {
    const { query = '' } = request.query as SearchQuery;

    if (query.trim().length < 2) {
      return reply.send([]);
    }

    const lowerQuery = query.toLowerCase().trim();
    const cacheKey = `geo:search:${lowerQuery}`;

    try {
      // Cache-aside: geocoding results are highly repetitive, so cache them.
      if (redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return reply.send(JSON.parse(cached));
        }
      } else {
        // No Redis configured — fall back to the in-process cache rather than
        // paying Google for a query we already answered.
        const memo = memoGet(cacheKey);
        if (memo) return reply.send(memo);
      }

      // Never spend a paid Places lookup on something that cannot be a place.
      // Production logs showed an email being typed into a location field,
      // billing a Text Search request for every character of it.
      const looksLikeAPlace = !/@/.test(lowerQuery);

      // Prefer real Google Places results (coords included). Falls back to the
      // local postal_codes dataset when the Maps key lacks the Places API.
      const places = looksLikeAPlace ? await searchPlaces(query.trim()) : null;
      if (places && places.length > 0) {
        const mapped = places.map((p) => ({
          id: p.place_id || p.place_name,
          place_name: p.place_name,
          state_name: p.address, // shown after the name in the client suggestion row
          postal_code: '',
          longitude: p.longitude,
          latitude: p.latitude,
        }));
        if (redisClient.isOpen) {
          redisClient.setEx(cacheKey, 300, JSON.stringify(mapped)).catch((err) => {
            fastify.log.error('Redis geo cache write failed:', err);
          });
        } else {
          memoSet(cacheKey, mapped);
        }
        return reply.send(mapped);
      }

      const snap = await db.collection('postal_codes').get();
      const results: any[] = [];

      snap.forEach(doc => {
        const data = doc.data();
        if (
          (data.postal_code && data.postal_code.toLowerCase().includes(lowerQuery)) ||
          (data.place_name && data.place_name.toLowerCase().includes(lowerQuery))
        ) {
          results.push({
            id: doc.id,
            postal_code: data.postal_code,
            place_name: data.place_name,
            state_name: data.state_name,
            state_code: data.state_code,
            country_name: data.country_name,
            country_iso: data.country_iso,
            longitude: data.location?.lng ?? data.location?.longitude ?? 0,
            latitude: data.location?.lat ?? data.location?.latitude ?? 0
          });
        }
      });

      const sortedResults = results
        .sort((a, b) => a.postal_code.localeCompare(b.postal_code))
        .slice(0, 10);

      // Cache for 5 minutes — postal code data is effectively static.
      // Empty results are cached too, and deliberately: a query that matches
      // nothing (a half-typed word, or an email pasted into a location field)
      // would otherwise pay Google again on every repeat.
      if (redisClient.isOpen) {
        redisClient.setEx(cacheKey, 300, JSON.stringify(sortedResults)).catch(err => {
          fastify.log.error('Redis geo cache write failed:', err);
        });
      } else {
        memoSet(cacheKey, sortedResults);
      }

      return reply.send(sortedResults);
    } catch (err: any) {
      fastify.log.error('Geographic search query failed:', err);
      return reply.code(500).send({ error: 'Database failure performing geocoding lookup.' });
    }
  });

  // 2. Get list of active launch countries in Firestore
  fastify.get('/countries', { preHandler: [requireAuth] }, async (request, reply) => {
    try {
      const snap = await db.collection('countries').get();
      const results: any[] = [];
      snap.forEach(doc => {
        results.push({
          id: doc.id,
          ...doc.data()
        });
      });
      results.sort((a, b) => a.name.localeCompare(b.name));
      return reply.send(results);
    } catch (err: any) {
      fastify.log.error('Failed to list countries:', err);
      return reply.code(500).send({ error: 'Database failure listing countries.' });
    }
  });

  // 3. Meeting-point suggestions (roadmap Phase 1).
  // Instead of a strict door-to-door pickup that forces the driver to detour,
  // suggest up to 3 points ON the ride's existing route near the rider — the
  // rider walks a little, the driver doesn't deviate at all.
  fastify.post('/meeting-points', { preHandler: [requireAuth] }, async (request, reply) => {
    const { ride_id, lat, lng } = (request.body || {}) as { ride_id?: string; lat?: number; lng?: number };
    if (!ride_id || typeof lat !== 'number' || typeof lng !== 'number' ||
        lat > 90 || lat < -90 || lng > 180 || lng < -180) {
      return reply.code(400).send({ error: 'ride_id, lat and lng are required.' });
    }

    try {
      const rideDoc = await db.collection('rides').doc(String(ride_id)).get();
      if (!rideDoc.exists) return reply.code(404).send({ error: 'Ride not found.' });
      const route: Array<{ lat: number; lng: number }> = rideDoc.data()!.route_coords || [];
      if (route.length === 0) return reply.send({ ride_id, meeting_points: [] });

      const R = 6371e3;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dist = (aLat: number, aLng: number, bLat: number, bLng: number) => {
        const dp = toRad(bLat - aLat), dl = toRad(bLng - aLng);
        const x = Math.sin(dp / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dl / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
      };

      // Rank every route vertex by walking distance, then keep the closest 3
      // that are at least 150m apart from each other (distinct suggestions,
      // not three samples of the same street).
      const MAX_WALK_METERS = 2000;
      const MIN_SEPARATION_METERS = 150;
      const WALK_SPEED_M_PER_MIN = 80; // ~4.8 km/h

      const ranked = route
        .map((pt, index) => ({ ...pt, index, walk_meters: dist(lat, lng, pt.lat, pt.lng) }))
        .filter((p) => p.walk_meters <= MAX_WALK_METERS)
        .sort((a, b) => a.walk_meters - b.walk_meters);

      const picked: typeof ranked = [];
      for (const cand of ranked) {
        if (picked.length >= 3) break;
        if (picked.every((p) => dist(p.lat, p.lng, cand.lat, cand.lng) >= MIN_SEPARATION_METERS)) {
          picked.push(cand);
        }
      }

      return reply.send({
        ride_id,
        meeting_points: picked.map((p, i) => ({
          label: `Meeting point ${i + 1}`,
          latitude: p.lat,
          longitude: p.lng,
          walk_meters: Math.round(p.walk_meters),
          walk_minutes: Math.max(1, Math.round(p.walk_meters / WALK_SPEED_M_PER_MIN)),
          route_index: p.index,
        })),
      });
    } catch (err: any) {
      fastify.log.error(err, 'Meeting-point suggestion failed');
      return reply.code(500).send({ error: 'Failed to compute meeting points.' });
    }
  });
}
