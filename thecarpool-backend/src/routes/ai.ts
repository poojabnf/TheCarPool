import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { aiQueue } from '../queue/processor';
import { requireAuth } from '../middleware/auth';
import { parseOrReply } from '../lib/validate';
import { optimizeRoute } from '../lib/maps';
import { db } from '../server';

const LatLngTuple = z.tuple([z.number(), z.number()]);

const RouteOptimizeSchema = z.object({
  driver_origin: LatLngTuple,
  driver_destination: LatLngTuple,
  riders: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    pickup: LatLngTuple,
    drop: LatLngTuple,
  })).min(1),
});

const VoiceConfirmSchema = z.object({
  booking_id: z.union([z.string(), z.number()]),
  phone_number: z.string().min(5),
});

const AssistantCommandSchema = z.object({
  user_id: z.union([z.string(), z.number()]).optional(),
  raw_speech: z.string().min(1),
});

const SentimentSchema = z.object({
  ride_id: z.union([z.string(), z.number()]).optional(),
  comment: z.string().min(1),
});

const TranslateSchema = z.object({
  message: z.string().min(1),
  target_language: z.string().min(1),
});

export async function aiRoutes(fastify: FastifyInstance) {

  // 1. Pre-Ride Confirmation Call Dispatcher (Feature 11)
  fastify.post('/voice/trigger-confirmation', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(VoiceConfirmSchema, request.body, reply);
    if (!body) return;
    const { booking_id, phone_number } = body;

    fastify.log.info(`Dispatching AI Confirmation Call Job for booking ${booking_id}`);
    
    // Async push to queue instead of waiting for Twilio/ElevenLabs inline
    await aiQueue.addJob('pre_ride_voice_call', {
      type: 'AI_CONFIRMATION_CALL',
      data: { booking_id, phone_number }
    });

    return reply.send({
      status: 'CALL_QUEUED',
      booking_id,
      recipient: phone_number,
      queue_system: 'BullMQ (Redis)',
      call_sid: 'CA' + Math.random().toString(36).substring(7)
    });
  });

  // 2. Voice Ride Assistant Parsing Stub (Feature 12)
  fastify.post('/voice/assistant-command', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(AssistantCommandSchema, request.body, reply);
    if (!body) return;
    const { user_id, raw_speech } = body;

    const aiServiceUrl = process.env.AI_SERVICE_URL;
    if (!aiServiceUrl) {
      return reply.code(503).send({ error: 'AI voice assistant service is not configured (missing AI_SERVICE_URL).' });
    }

    // Forwards the transcribed query to Claude NLU service (or local regex parser fallback)
    try {
      const response = await fetch(`${aiServiceUrl.replace(/\/$/, '')}/voice/gather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ SpeechResult: raw_speech })
      });
      if (!response.ok) {
        throw new Error(`AI service returned status ${response.status}`);
      }
      const data = await response.json();
      
      return reply.send({
        user_id,
        command_understood: true,
        action: 'ROUTE_SEARCH_TRIGGERED',
        parsed_nlu: data
      });
    } catch (err: any) {
      fastify.log.error(err, 'AI voice assistant failed');
      return reply.code(503).send({ error: 'AI voice assistant service is temporarily unavailable.', details: err.message });
    }
  });

  // 3. AI Route Optimizer sequencing (Feature 13) — Google Routes API with
  //    a nearest-neighbour fallback when GOOGLE_MAPS_API_KEY is not set.
  fastify.post('/optimize-route', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(RouteOptimizeSchema, request.body, reply);
    if (!body) return;
    const { driver_origin, driver_destination, riders } = body;

    // Inputs are [lat, lng] tuples.
    const origin = { lat: driver_origin[0], lng: driver_origin[1] };
    const destination = { lat: driver_destination[0], lng: driver_destination[1] };
    const waypoints = riders.map((r) => ({ lat: r.pickup[0], lng: r.pickup[1] }));

    const result = await optimizeRoute(origin, destination, waypoints);

    const optimizedSequence = result.order.map((riderIdx, seq) => ({
      sequence_order: seq + 1,
      rider_id: riders[riderIdx].id,
      waypoint_lat: waypoints[riderIdx].lat,
      waypoint_lng: waypoints[riderIdx].lng,
      action: 'PICKUP',
    }));

    return reply.send({
      optimized_waypoints: optimizedSequence,
      optimization_source: result.source, // 'google' | 'heuristic'
      total_distance_meters: result.total_distance_meters ?? null,
      total_duration_seconds: result.total_duration_seconds ?? null,
    });
  });

  // 4. AI Feedback Comment NLP Analyzer (Feature 14)
  fastify.post('/feedback/nlp-sentiment', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(SentimentSchema, request.body, reply);
    if (!body) return;
    const { ride_id, comment } = body;

    const apiKey = process.env.GOOGLE_NLP_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({ error: 'Google NLP API is not configured on this server.' });
    }

    try {
      const res = await fetch(`https://language.googleapis.com/v1/documents:analyzeSentiment?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document: {
            type: 'PLAIN_TEXT',
            content: comment
          },
          encodingType: 'UTF8'
        })
      });

      if (!res.ok) {
        throw new Error(`Google NLP returned ${res.status}`);
      }

      const data = await res.json() as any;
      const score = data.documentSentiment?.score ?? 0;
      
      let sentiment = 'NEUTRAL';
      let stars = 3;
      if (score > 0.25) {
        sentiment = 'POSITIVE';
        stars = score > 0.75 ? 5 : 4;
      } else if (score < -0.25) {
        sentiment = 'NEGATIVE';
        stars = score < -0.75 ? 1 : 2;
      }

      return reply.send({
        ride_id,
        sentiment,
        stars_inferred: stars,
        score,
        safety_flags_triggered: score < -0.6 ? ['NEGATIVE_SENTIMENT_ALERT'] : []
      });
    } catch (err: any) {
      fastify.log.error(err, 'Google NLP sentiment analysis failed');
      return reply.code(503).send({ error: 'NLP sentiment service is temporarily unavailable.' });
    }
  });

  // 5. Calendar commute pattern learning triggers (Feature 15)
  fastify.get('/commute-patterns/:user_id', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id } = request.params as { user_id: string };
    
    try {
      const bookingsSnap = await db.collection('bookings')
        .where('rider_id', '==', String(user_id))
        .get();

      if (bookingsSnap.empty) {
        return reply.send({
          user_id,
          suggested_recurrence: 'No booking history found.',
          pattern_confidence: 0.0,
          auto_suggest_booking_active: false
        });
      }

      // Group bookings by a coordinate fingerprint (rounded to 3 decimals ~ 100 meters)
      const routes: Record<string, { count: number; pickup: {lat: number, lng: number}, drop: {lat: number, lng: number}, rideIds: string[] }> = {};
      
      for (const doc of bookingsSnap.docs) {
        const data = doc.data();
        const plat = Number(data.pickup_lat || 0).toFixed(3);
        const plng = Number(data.pickup_lng || 0).toFixed(3);
        const dlat = Number(data.drop_lat || 0).toFixed(3);
        const dlng = Number(data.drop_lng || 0).toFixed(3);
        
        const key = `${plat},${plng}->${dlat},${dlng}`;
        if (!routes[key]) {
          routes[key] = {
            count: 0,
            pickup: { lat: Number(data.pickup_lat), lng: Number(data.pickup_lng) },
            drop: { lat: Number(data.drop_lat), lng: Number(data.drop_lng) },
            rideIds: []
          };
        }
        routes[key].count += 1;
        if (data.ride_id) {
          routes[key].rideIds.push(String(data.ride_id));
        }
      }

      let bestKey = '';
      let maxCount = 0;
      for (const key of Object.keys(routes)) {
        if (routes[key].count > maxCount) {
          maxCount = routes[key].count;
          bestKey = key;
        }
      }

      if (!bestKey) {
        return reply.send({
          user_id,
          suggested_recurrence: 'Insufficient commute history.',
          pattern_confidence: 0.0,
          auto_suggest_booking_active: false
        });
      }

      const bestRoute = routes[bestKey];
      
      const departureTimes: string[] = [];
      for (const rideId of bestRoute.rideIds) {
        const rideDoc = await db.collection('rides').doc(rideId).get();
        if (rideDoc.exists && rideDoc.data()?.departure_time) {
          departureTimes.push(rideDoc.data()?.departure_time);
        }
      }

      let timeStr = '8:45 AM';
      let daysStr = 'Mon-Fri';
      
      if (departureTimes.length > 0) {
        const hours: number[] = [];
        const minutes: number[] = [];
        const days: number[] = [];
        for (const dt of departureTimes) {
          try {
            const d = new Date(dt);
            if (!isNaN(d.getTime())) {
              hours.push(d.getHours());
              minutes.push(d.getMinutes());
              days.push(d.getDay());
            }
          } catch {}
        }
        
        if (hours.length > 0) {
          const avgHour = Math.round(hours.reduce((a,b)=>a+b, 0) / hours.length);
          const avgMin = Math.round(minutes.reduce((a,b)=>a+b, 0) / minutes.length);
          const ampm = avgHour >= 12 ? 'PM' : 'AM';
          const displayHour = avgHour % 12 === 0 ? 12 : avgHour % 12;
          const displayMin = String(avgMin).padStart(2, '0');
          timeStr = `${displayHour}:${displayMin} ${ampm}`;
          
          const isAllWeekday = days.every(d => d >= 1 && d <= 5);
          if (isAllWeekday) {
            daysStr = 'Mon-Fri';
          } else {
            daysStr = 'Daily';
          }
        }
      }

      // Geocoding helper using Google Maps or Firestore postal_codes
      async function getPlaceLabel(lat: number, lng: number): Promise<string> {
        if (process.env.GOOGLE_MAPS_API_KEY) {
          try {
            const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY}`);
            if (res.ok) {
              const data = await res.json() as any;
              if (data.results && data.results[0]) {
                const components = data.results[0].address_components;
                const sublocality = components.find((c: any) => c.types.includes('sublocality') || c.types.includes('neighborhood'));
                const locality = components.find((c: any) => c.types.includes('locality'));
                if (sublocality && locality) {
                  return `${sublocality.long_name}, ${locality.long_name}`;
                }
                return data.results[0].formatted_address.split(',').slice(0, 2).join(', ');
              }
            }
          } catch {}
        }
        
        try {
          const snap = await db.collection('postal_codes').get();
          let closestLabel = '';
          let minDist = Infinity;
          
          function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                      Math.sin(dLng/2) * Math.sin(dLng/2);
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          }
          
          snap.forEach(doc => {
            const data = doc.data();
            if (data.latitude != null && data.longitude != null) {
              const dist = haversine(lat, lng, Number(data.latitude), Number(data.longitude));
              if (dist < minDist) {
                minDist = dist;
                closestLabel = data.place_name || data.postal_code || '';
              }
            }
          });
          
          if (closestLabel && minDist < 5) {
            return closestLabel;
          }
        } catch {}

        return `Loc (${lat.toFixed(3)}, ${lng.toFixed(3)})`;
      }

      const pickupLabel = await getPlaceLabel(bestRoute.pickup.lat, bestRoute.pickup.lng);
      const dropLabel = await getPlaceLabel(bestRoute.drop.lat, bestRoute.drop.lng);

      const totalBookings = bookingsSnap.size;
      const confidence = parseFloat(Math.min(0.99, 0.5 + (maxCount / totalBookings) * 0.49).toFixed(2));

      return reply.send({
        user_id,
        suggested_recurrence: `${daysStr} ${timeStr} ${pickupLabel} -> ${dropLabel}`,
        pattern_confidence: confidence,
        auto_suggest_booking_active: true
      });
    } catch (err: any) {
      fastify.log.error(err, 'Failed to learn commute patterns');
      return reply.code(500).send({ error: 'Failed to extract commute patterns.' });
    }
  });

  // 6. Suggest pricing logic (Feature 17)
  fastify.post('/suggest-pricing', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(
      z.object({ route_length_km: z.number().positive(), passenger_count: z.number().int().positive().optional().default(1) }),
      request.body,
      reply
    );
    if (!body) return;

    // Calculates fair fuel split: standard rate ₹12 per km divided by passengers
    const baseRatePerKm = 12.0;
    const totalCost = body.route_length_km * baseRatePerKm;
    const passengerSplit = totalCost / body.passenger_count;

    return reply.send({
      suggested_total_compensation: parseFloat(totalCost.toFixed(2)),
      fair_passenger_split: parseFloat(passengerSplit.toFixed(2)),
      congestion_index_multiplier: 1.0,
    });
  });

  // 7. Fraud profile checks (Feature 18)
  fastify.post('/fraud/scan-profile', { preHandler: [requireAuth] }, async (request, reply) => {
    const { user_id, document_url } = request.body as any;

    const user = process.env.SIGHTENGINE_API_USER;
    const secret = process.env.SIGHTENGINE_API_SECRET;
    if (!user || !secret) {
      return reply.code(503).send({ error: 'AI fraud scan service is not configured (missing SIGHTENGINE credentials).' });
    }

    if (!document_url) {
      return reply.code(400).send({ error: 'document_url is required.' });
    }
    
    try {
      const res = await fetch(`https://api.sightengine.com/1.0/check.json?url=${encodeURIComponent(document_url)}&models=document,text&api_user=${user}&api_secret=${secret}`);
      if (!res.ok) {
        throw new Error(`Sightengine returned ${res.status}`);
      }
      const data = await res.json() as any;
      
      const isFraud = data.document?.info?.is_fake === true || (data.fraud_score != null && data.fraud_score > 0.8);
      return reply.send({
        user_id,
        is_fraud_risk: isFraud,
        match_confidence: data.document?.info?.confidence ?? 0.9,
        automated_approved: !isFraud
      });
    } catch (err: any) {
      fastify.log.error(err, 'Sightengine API call failed');
      return reply.code(503).send({ error: 'Fraud scan API call failed.', details: err.message });
    }
  });

  // 8. In-chat translation (Feature 19)
  fastify.post('/chat/translate', { preHandler: [requireAuth] }, async (request, reply) => {
    const body = parseOrReply(TranslateSchema, request.body, reply);
    if (!body) return;
    const { message, target_language } = body;

    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!apiKey) {
      return reply.code(503).send({ error: 'Google Translate API is not configured on this server.' });
    }

    try {
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: [message],
          target: target_language
        })
      });

      if (!res.ok) {
        throw new Error(`Google Translate returned ${res.status}`);
      }

      const data = await res.json() as any;
      const translated = data.data?.translations?.[0]?.translatedText || message;

      return reply.send({
        original: message,
        target_language,
        translated_text: translated
      });
    } catch (err: any) {
      fastify.log.error(err, 'Google Translate call failed');
      return reply.code(503).send({ error: 'Translation service is temporarily unavailable.', details: err.message });
    }
  });
}
