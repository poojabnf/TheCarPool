/**
 * Dispatching an emergency alert.
 *
 * What this replaces was not a partial implementation -- it was a lie. The SOS
 * endpoint pushed a job onto a Redis list nothing ever popped, sent one FCM
 * message to a topic named after the victim which no client has ever
 * subscribed to, and then returned:
 *
 *     dispatched_services: ['Corporate Security', 'Police PCR Control Room',
 *                           'Family Emergency Circle']
 *
 * hardcoded. Someone in danger pressed the button, was told the police had
 * been contacted, and nothing left the building. The emergency contacts they
 * had entered were sitting in users/{uid}/safety_contacts, never read.
 *
 * So: contacts are read and messaged over whatever channel is actually
 * configured, the alert is recorded, and the response says what genuinely went
 * out rather than what would sound reassuring.
 *
 * This does not contact the police. No integration exists, and claiming one
 * is how the original got dangerous.
 */
import { db } from './firestore';
import { notifyUser, isSmsConfigured, isWhatsAppConfigured } from './notify';

export interface SosInput {
  uid: string;
  rideId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Silent SOS: no push back to the victim's own handset. */
  silent?: boolean;
}

export interface SosOutcome {
  contactsFound: number;
  contactsAlerted: number;
  /** Channels that actually carried the alert, for the caller to report. */
  channels: string[];
  /** True when nobody could be reached -- the caller must say so plainly. */
  nobodyReached: boolean;
  eventId: string;
}

interface Log { error: (...a: any[]) => void; warn?: (...a: any[]) => void }

/** A location a person can act on, not a pair of numbers. */
function mapLink(lat?: number | null, lng?: number | null): string | null {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return `https://maps.google.com/?q=${lat},${lng}`;
}

export async function dispatchEmergencyAlerts(
  input: SosInput,
  log?: Log
): Promise<SosOutcome> {
  const { uid, rideId, latitude, longitude, silent } = input;

  const [userSnap, contactsSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('users').doc(uid).collection('safety_contacts').get(),
  ]);
  const user = userSnap.data() ?? {};
  const name = String(user.full_name || user.name || 'A TheCarPool user');

  const link = mapLink(latitude, longitude);
  const where = link ? `Last known location: ${link}` : 'Location unavailable.';
  const body = [
    `${name} has triggered an emergency alert on TheCarPool.`,
    where,
    rideId ? `Ride: ${rideId}` : null,
    'Please contact them, and call 112 if you cannot reach them.',
  ].filter(Boolean).join('\n');

  // Recorded before anything is sent. If dispatch fails halfway there must
  // still be a record that the button was pressed and when.
  const eventRef = db.collection('sos_events').doc();
  await eventRef.set({
    user_id: uid,
    ride_id: rideId ?? null,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    silent: silent === true,
    created_at: new Date().toISOString(),
    contacts_found: contactsSnap.size,
  });

  const channels = new Set<string>();
  let alerted = 0;

  // Sent one at a time and individually caught: one unreachable contact must
  // not stop the others being told.
  for (const doc of contactsSnap.docs) {
    const cd = doc.data();
    const phone = String(cd.phone || cd.phone_number || '').trim();
    if (!phone) continue;
    try {
      const res = await notifyUser(
        // No uid: an emergency contact is not necessarily a user of ours, and
        // must be reachable on their phone number alone.
        { uid: '', phone },
        { title: 'Emergency alert', body },
        { type: 'EMERGENCY_SOS', ride_id: String(rideId ?? '') },
        log
      );
      if (res.sms) channels.add('sms');
      if (res.whatsapp) channels.add('whatsapp');
      if (res.sms || res.whatsapp) alerted += 1;
    } catch (err) {
      log?.error({ err, contact: doc.id }, 'SOS: could not reach an emergency contact');
    }
  }

  // The victim's own devices, through the real token-based path -- not a topic
  // nobody subscribes to. Skipped for a silent SOS, where a buzzing phone is
  // the specific thing the user is trying to avoid.
  if (!silent) {
    try {
      const res = await notifyUser(
        { uid, phone: user.phone_number ?? user.phone ?? null },
        {
          title: 'Emergency alert sent',
          body: alerted > 0
            ? `We have alerted ${alerted} of your emergency contacts with your location.`
            : 'We could not reach your emergency contacts. Call 112 if you are in danger.',
        },
        { type: 'EMERGENCY_SOS', ride_id: String(rideId ?? '') },
        log
      );
      if (res.push) channels.add('push');
    } catch (err) {
      log?.error({ err, uid }, 'SOS: could not notify the user own devices');
    }
  }

  const nobodyReached = alerted === 0;
  if (nobodyReached) {
    // Loud in the logs on purpose: somebody pressed an emergency button and
    // no help left the system. That is an operational incident.
    log?.warn?.(
      { uid, rideId, contacts: contactsSnap.size, sms: isSmsConfigured(), whatsapp: isWhatsAppConfigured() },
      'SOS DISPATCHED TO NOBODY: no reachable emergency contacts'
    );
  }

  await eventRef.update({
    contacts_alerted: alerted,
    channels: [...channels],
    nobody_reached: nobodyReached,
  });

  return {
    contactsFound: contactsSnap.size,
    contactsAlerted: alerted,
    channels: [...channels],
    nobodyReached,
    eventId: eventRef.id,
  };
}
