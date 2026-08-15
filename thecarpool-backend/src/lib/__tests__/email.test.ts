import {
  buildRideOfferedEmail,
  buildRiderBookingEmail,
  buildDriverPassengerBookedEmail,
  isEmailConfigured,
} from '../email';

describe('email templates and configuration', () => {
  it('identifies unconfigured email when env vars are absent', () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SENDGRID_API_KEY;
    expect(isEmailConfigured()).toBe(false);
  });

  it('builds ride offered email with correct pricing and details', () => {
    const result = buildRideOfferedEmail({
      driverName: 'Vikram',
      rideId: 'ride_12345',
      seatsTotal: 3,
      pricePerSeat: 150,
      departureTime: '2026-08-20T08:30:00.000Z',
      vehicle: {
        make: 'Hyundai',
        model: 'Creta',
        plate: 'DL01AB1234',
        type: 'CAR',
      },
      pickupPoints: [{ label: 'Cyber Hub Gate 2' }, { label: 'IFFCO Chowk' }],
      distanceKm: 24.5,
    });

    expect(result.subject).toContain('Ride Offered Successfully');
    expect(result.subject).toContain('Hyundai Creta');
    expect(result.html).toContain('Vikram');
    expect(result.html).toContain('₹150.00');
    expect(result.html).toContain('₹450.00'); // max potential earnings
    expect(result.html).toContain('Cyber Hub Gate 2');
    expect(result.html).toContain('24.5 km');
  });

  it('builds rider booking email with boarding code and full fare breakdown', () => {
    const result = buildRiderBookingEmail({
      riderName: 'Pooja',
      bookingId: 'booking_9999',
      rideId: 'ride_12345',
      driverName: 'Vikram',
      seatsBooked: 2,
      fareAmount: 300,
      insurancePremium: 4,
      convenienceFee: 0,
      totalPaid: 304,
      boardingOtp: '7482',
      departureTime: '2026-08-20T08:30:00.000Z',
      vehicle: {
        make: 'Hyundai',
        model: 'Creta',
        plate: 'DL01AB1234',
        type: 'CAR',
      },
    });

    expect(result.subject).toContain('Booking Confirmed');
    expect(result.subject).toContain('7482');
    expect(result.html).toContain('Pooja');
    expect(result.html).toContain('7482');
    expect(result.html).toContain('₹300.00');
    expect(result.html).toContain('₹304.00');
    expect(result.html).toContain('Vikram');
  });

  it('builds driver passenger alert email', () => {
    const result = buildDriverPassengerBookedEmail({
      driverName: 'Vikram',
      riderName: 'Pooja',
      bookingId: 'booking_9999',
      seatsBooked: 2,
      fareAmount: 300,
      departureTime: '2026-08-20T08:30:00.000Z',
    });

    expect(result.subject).toContain('New Passenger Booked');
    expect(result.html).toContain('Vikram');
    expect(result.html).toContain('Pooja');
    expect(result.html).toContain('2');
    expect(result.html).toContain('₹300.00');
  });
});
