import nodemailer from 'nodemailer';

let transporter: nodemailer.Transporter | null = null;

export function isEmailConfigured(): boolean {
  return Boolean(
    (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) ||
    process.env.SENDGRID_API_KEY
  );
}

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else if (process.env.SENDGRID_API_KEY) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }

  return transporter;
}

export async function getUserEmail(uid: string): Promise<{ email: string; name: string } | null> {
  try {
    const { db } = await import('../server');
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) return null;
    const data = doc.data()!;
    const email = data.email || data.corporate_email || null;
    const name = data.name || data.displayName || 'CarPool Member';
    if (!email || !email.includes('@')) return null;
    return { email, name };
  } catch (err) {
    console.error('Error fetching user email for %s:', uid, err);
    return null;
  }
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(opts: SendEmailOptions): Promise<boolean> {
  const mailer = getTransporter();
  if (!mailer) {
    console.warn(`[Email Notification Skipped] SMTP not configured. Would have sent: "${opts.subject}" to ${opts.to}`);
    return false;
  }

  const from = process.env.EMAIL_FROM || 'TheCarPool <no-reply@thecarpool.in>';

  try {
    await mailer.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return true;
  } catch (err) {
    console.error('Failed to send email to %s:', opts.to, err);
    return false;
  }
}

/** Format currency */
function formatRupees(n: number): string {
  return `₹${n.toFixed(2)}`;
}

/** 1. Ride Offered Email Template */
export function buildRideOfferedEmail(params: {
  driverName: string;
  rideId: string;
  seatsTotal: number;
  pricePerSeat: number;
  departureTime: string;
  vehicle: { make?: string; model?: string; plate?: string; type?: string };
  pickupPoints: Array<{ label?: string | null }>;
  distanceKm?: number | null;
}): { subject: string; html: string; text: string } {
  const { driverName, rideId, seatsTotal, pricePerSeat, departureTime, vehicle, pickupPoints, distanceKm } = params;
  const departureDate = new Date(departureTime).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const vehicleDesc = [vehicle.make, vehicle.model, vehicle.plate ? `(${vehicle.plate})` : ''].filter(Boolean).join(' ') || vehicle.type || 'Car';
  const pickupList = pickupPoints.length > 0
    ? pickupPoints.map((p, idx) => `• Stop ${idx + 1}: ${p.label || 'Designated Point'}`).join('<br>')
    : 'Standard Route Pickups';

  const subject = `🚗 Ride Offered Successfully - ${vehicleDesc} on ${departureDate}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9fa; margin: 0; padding: 24px; color: #1a202c; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: #059669; padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 24px; }
    .section-title { font-size: 16px; font-weight: 600; margin-top: 20px; margin-bottom: 10px; color: #2d3748; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 10px; font-size: 14px; }
    .detail-label { color: #718096; font-weight: 500; }
    .detail-value { color: #1a202c; font-weight: 600; text-align: right; }
    .badge { display: inline-block; background: #e6fffa; color: #047857; font-weight: 700; padding: 4px 10px; border-radius: 6px; font-size: 13px; }
    .pickup-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; font-size: 13.5px; line-height: 1.6; margin-top: 8px; }
    .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚗 Ride Offer Confirmed</h1>
      <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Your ride is live and ready for passengers</p>
    </div>
    <div class="content">
      <p style="font-size: 15px; margin-top: 0;">Hi <strong>${driverName}</strong>,</p>
      <p style="font-size: 14px; color: #4a5568; line-height: 1.5;">
        Your commute pool has been published to TheCarPool network. We will notify you instantly as soon as co-workers or nearby verified riders book a seat.
      </p>

      <div class="section-title">Ride Summary</div>
      <div class="detail-row">
        <span class="detail-label">Departure Time</span>
        <span class="detail-value">${departureDate} (IST)</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Vehicle</span>
        <span class="detail-value">${vehicleDesc}</span>
      </div>
      ${distanceKm ? `
      <div class="detail-row">
        <span class="detail-label">Estimated Distance</span>
        <span class="detail-value">${distanceKm} km</span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label">Seats Offered</span>
        <span class="detail-value">${seatsTotal} seat(s)</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Price per Seat</span>
        <span class="detail-value" style="color: #059669; font-size: 16px;">${formatRupees(pricePerSeat)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Max Potential Earnings</span>
        <span class="detail-value" style="color: #059669;">${formatRupees(pricePerSeat * seatsTotal)}</span>
      </div>

      <div class="section-title">Route & Pickups</div>
      <div class="pickup-box">
        ${pickupList}
      </div>

      <p style="font-size: 12.5px; color: #718096; margin-top: 20px; line-height: 1.4;">
        🔒 <strong>Escrow Protection:</strong> When passengers book, their payments are locked in escrow and released directly to your verified payout method once the ride completes.
      </p>
    </div>
    <div class="footer">
      TheCarPool • Ride ID: ${rideId}<br>
      Clean Commutes & Verified Workplace Carpooling
    </div>
  </div>
</body>
</html>
  `;

  const text = `Hi ${driverName},\n\nYour ride offer (ID: ${rideId}) is live on TheCarPool!\n\nDeparture: ${departureDate}\nVehicle: ${vehicleDesc}\nSeats: ${seatsTotal}\nPrice: ${formatRupees(pricePerSeat)}/seat\nPotential Earnings: ${formatRupees(pricePerSeat * seatsTotal)}\n\nSafe driving!\nTeam TheCarPool`;

  return { subject, html, text };
}

/** 2. Booking Confirmed Email Template (For Rider) */
export function buildRiderBookingEmail(params: {
  riderName: string;
  bookingId: string;
  rideId: string;
  driverName?: string;
  seatsBooked: number;
  fareAmount: number;
  insurancePremium: number;
  convenienceFee: number;
  totalPaid: number;
  boardingOtp: string;
  departureTime: string;
  vehicle: { make?: string; model?: string; plate?: string; type?: string };
}): { subject: string; html: string; text: string } {
  const {
    riderName, bookingId, driverName, seatsBooked,
    fareAmount, insurancePremium, convenienceFee, totalPaid,
    boardingOtp, departureTime, vehicle
  } = params;

  const departureDate = new Date(departureTime).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const vehicleDesc = [vehicle.make, vehicle.model, vehicle.plate ? `(${vehicle.plate})` : ''].filter(Boolean).join(' ') || vehicle.type || 'Car';
  const subject = `✅ Booking Confirmed #${bookingId.slice(-6)} - Boarding Code: ${boardingOtp}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9fa; margin: 0; padding: 24px; color: #1a202c; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: #2563eb; padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 24px; }
    .otp-card { background: #eff6ff; border: 2px dashed #3b82f6; border-radius: 10px; padding: 16px; text-align: center; margin: 20px 0; }
    .otp-code { font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #1d4ed8; font-family: monospace; }
    .section-title { font-size: 15px; font-weight: 600; margin-top: 20px; margin-bottom: 10px; color: #2d3748; border-bottom: 1px solid #edf2f7; padding-bottom: 6px; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .detail-label { color: #718096; font-weight: 500; }
    .detail-value { color: #1a202c; font-weight: 600; text-align: right; }
    .total-row { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 10px; border-top: 2px solid #e2e8f0; font-size: 16px; font-weight: 700; }
    .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Booking Confirmed</h1>
      <p style="margin: 6px 0 0 0; opacity: 0.9; font-size: 14px;">Your seat is reserved with escrow protection</p>
    </div>
    <div class="content">
      <p style="font-size: 15px; margin-top: 0;">Hi <strong>${riderName}</strong>,</p>
      <p style="font-size: 14px; color: #4a5568; line-height: 1.5;">
        Your booking is confirmed! When you board the vehicle, share your 4-digit boarding code with your driver.
      </p>

      <div class="otp-card">
        <div style="font-size: 12px; text-transform: uppercase; letter-spacing: 1px; color: #64748b; font-weight: 600; margin-bottom: 4px;">Your Boarding Code</div>
        <div class="otp-code">${boardingOtp}</div>
        <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Share this code with the driver upon pickup</div>
      </div>

      <div class="section-title">Trip Details</div>
      <div class="detail-row">
        <span class="detail-label">Departure</span>
        <span class="detail-value">${departureDate} (IST)</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Driver</span>
        <span class="detail-value">${driverName || 'Verified Driver'}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Vehicle</span>
        <span class="detail-value">${vehicleDesc}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Seats Booked</span>
        <span class="detail-value">${seatsBooked} seat(s)</span>
      </div>

      <div class="section-title">Payment Summary</div>
      <div class="detail-row">
        <span class="detail-label">Ride Fare (${seatsBooked} seat(s))</span>
        <span class="detail-value">${formatRupees(fareAmount)}</span>
      </div>
      ${insurancePremium > 0 ? `
      <div class="detail-row">
        <span class="detail-label">Ride Insurance</span>
        <span class="detail-value">${formatRupees(insurancePremium)}</span>
      </div>` : ''}
      <div class="detail-row">
        <span class="detail-label">Convenience Fee</span>
        <span class="detail-value">${convenienceFee > 0 ? formatRupees(convenienceFee) : 'Free (₹0)'}</span>
      </div>
      <div class="total-row">
        <span>Total Paid</span>
        <span style="color: #2563eb;">${formatRupees(totalPaid)}</span>
      </div>

      <p style="font-size: 12.5px; color: #718096; margin-top: 20px; line-height: 1.4;">
        🛡️ <strong>Safety Guarantee:</strong> Your payment is held safely in escrow and only released to the driver after you have reached your destination.
      </p>
    </div>
    <div class="footer">
      TheCarPool • Booking ID: ${bookingId}<br>
      Need help? Reach out at support@thecarpool.in
    </div>
  </div>
</body>
</html>
  `;

  const text = `Hi ${riderName},\n\nYour booking #${bookingId} is confirmed!\n\nBoarding Code: ${boardingOtp}\nDeparture: ${departureDate}\nDriver: ${driverName || 'Verified Driver'}\nVehicle: ${vehicleDesc}\nSeats: ${seatsBooked}\nTotal Paid: ${formatRupees(totalPaid)}\n\nHave a safe commute!\nTeam TheCarPool`;

  return { subject, html, text };
}

/** 3. Driver Alert on New Booking */
export function buildDriverPassengerBookedEmail(params: {
  driverName: string;
  riderName: string;
  bookingId: string;
  seatsBooked: number;
  fareAmount: number;
  departureTime: string;
}): { subject: string; html: string; text: string } {
  const { driverName, riderName, bookingId, seatsBooked, fareAmount, departureTime } = params;
  const departureDate = new Date(departureTime).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const subject = `🎉 New Passenger Booked - ${riderName} reserved ${seatsBooked} seat(s)`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f7f9fa; margin: 0; padding: 24px; color: #1a202c; }
    .container { max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
    .header { background: #059669; padding: 24px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .content { padding: 24px; }
    .detail-row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
    .detail-label { color: #718096; font-weight: 500; }
    .detail-value { color: #1a202c; font-weight: 600; text-align: right; }
    .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 12px; color: #a0aec0; border-top: 1px solid #edf2f7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 New Passenger Booked!</h1>
    </div>
    <div class="content">
      <p style="font-size: 15px; margin-top: 0;">Hi <strong>${driverName}</strong>,</p>
      <p style="font-size: 14px; color: #4a5568; line-height: 1.5;">
        <strong>${riderName}</strong> has just booked <strong>${seatsBooked} seat(s)</strong> on your scheduled ride leaving at <strong>${departureDate} (IST)</strong>.
      </p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <div class="detail-row">
          <span class="detail-label">Passenger Name</span>
          <span class="detail-value">${riderName}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Seats Reserved</span>
          <span class="detail-value">${seatsBooked}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Escrow Fare Credited</span>
          <span class="detail-value" style="color: #059669; font-size: 16px;">${formatRupees(fareAmount)}</span>
        </div>
      </div>

      <p style="font-size: 13px; color: #718096; line-height: 1.4;">
        ⚠️ Remember to ask the passenger for their 4-digit boarding code when they get in the car to verify their pickup.
      </p>
    </div>
    <div class="footer">
      TheCarPool • Booking Reference: ${bookingId}<br>
      Clean Commutes & Verified Workplace Carpooling
    </div>
  </div>
</body>
</html>
  `;

  const text = `Hi ${driverName},\n\n${riderName} has booked ${seatsBooked} seat(s) on your ride (${departureDate}).\n\nFare in Escrow: ${formatRupees(fareAmount)}\n\nTeam TheCarPool`;

  return { subject, html, text };
}
