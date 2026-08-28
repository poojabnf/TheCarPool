// Jest is the project test runner; describe/it/expect are globals.
import {
  scrubContact, shortName, modeLabel, stopLines,
  riderBookingConfirmed, riderRequestSubmitted, driverBookingRequested,
  driverBookingConfirmed, riderRequestDeclined, riderBoardingSoon,
} from '../rideMessages';

describe('scrubContact', () => {
  it('removes phone numbers in the shapes people actually write', () => {
    expect(scrubContact('call me on 9876543210')).not.toMatch(/9876543210/);
    expect(scrubContact('+91 98765 43210 anytime')).not.toMatch(/98765/);
    expect(scrubContact('ring 098-765-43210')).not.toMatch(/765/);
  });

  it('removes emails', () => {
    expect(scrubContact('mail pooja@example.com')).toBe('mail [hidden]');
  });

  it('leaves short numbers alone — OTPs and seat counts must survive', () => {
    expect(scrubContact('Your boarding code: 4821')).toContain('4821');
    expect(scrubContact('Seats: 3')).toContain('3');
  });
});

describe('shortName', () => {
  it('keeps only the first name', () => {
    expect(shortName('Pooja Yadav')).toBe('Pooja');
  });

  it('falls back when there is no name', () => {
    expect(shortName('', 'your driver')).toBe('your driver');
    expect(shortName(null)).toBe('your co-traveller');
    expect(shortName(undefined)).toBe('your co-traveller');
  });
});

describe('modeLabel', () => {
  it('maps the stored enums to words', () => {
    expect(modeLabel('BIKE_POOL')).toBe('Bike pool');
    expect(modeLabel('CAR_POOL')).toBe('Car pool');
    expect(modeLabel('COMMUTE')).toBe('Car pool');
    expect(modeLabel(null)).toBe('Car pool');
  });
});

describe('stopLines', () => {
  it('marks computed times approximate but not driver-given ones', () => {
    const lines = stopLines([
      { label: 'Sipri Bazar', eta: '2026-08-28T09:30:00.000Z', driver_specified: true },
      { label: 'Civil Lines', eta: '2026-08-28T10:00:00.000Z', driver_specified: false },
      { label: 'No time yet' },
    ]);
    expect(lines[0]).not.toContain('approx');
    expect(lines[1]).toContain('approx');
    expect(lines[2]).toBe('• No time yet');
  });

  it('returns nothing for an empty list', () => {
    expect(stopLines([])).toEqual([]);
    expect(stopLines(undefined)).toEqual([]);
  });
});

describe('message bodies never leak contact details', () => {
  // The whole point of the module: a name or vehicle field carrying a phone
  // number must not become a contact-sharing channel.
  const hostile = {
    driver_name: 'Raj 9876543210',
    rider_name: 'Sara sara@example.com',
    vehicle: 'Swift — call 9998887777',
    origin: 'Jhansi',
    destination: 'Gwalior',
    departure_time: '2026-08-28T09:00:00.000Z',
    otp: '4821',
    seats: 2,
  };

  for (const [name, build] of Object.entries({
    riderBookingConfirmed,
    riderRequestSubmitted,
    driverBookingRequested,
    driverBookingConfirmed,
    riderRequestDeclined,
  })) {
    it(`${name} strips numbers and emails`, () => {
      const { body } = (build as any)(hostile);
      expect(body).not.toMatch(/9876543210/);
      expect(body).not.toMatch(/9998887777/);
      expect(body).not.toMatch(/sara@example\.com/);
    });
  }

  it('riderBoardingSoon strips them too', () => {
    const { body } = riderBoardingSoon(hostile, 30);
    expect(body).not.toMatch(/9876543210/);
    expect(body).not.toMatch(/9998887777/);
  });
});

describe('riderBookingConfirmed', () => {
  it('includes the OTP, which only this rider receives', () => {
    const { body } = riderBookingConfirmed({ otp: '4821', driver_name: 'Raj' });
    expect(body).toContain('4821');
  });

  it('says how to make contact without giving a number', () => {
    const { body } = riderBookingConfirmed({ driver_name: 'Raj' });
    expect(body).toContain('in the app');
  });
});

describe('driverBookingRequested', () => {
  it('names the rider and the boarding point, not their contact', () => {
    const { title, body } = driverBookingRequested({
      rider_name: 'Sara Khan', pickup_point: 'Sipri Bazar', seats: 2,
    });
    expect(title).toBe('New seat request');
    expect(body).toContain('Sara');
    expect(body).not.toContain('Khan');
    expect(body).toContain('Sipri Bazar');
    expect(body).toContain('2 seats');
  });
});

describe('riderBoardingSoon', () => {
  it('leads with the minutes and where to stand', () => {
    const { body } = riderBoardingSoon(
      { driver_name: 'Raj Kumar', pickup_point: 'Sipri Bazar', vehicle: 'White Swift' },
      30
    );
    expect(body).toContain('30 minutes');
    expect(body).toContain('Sipri Bazar');
    expect(body).toContain('White Swift');
  });
});
