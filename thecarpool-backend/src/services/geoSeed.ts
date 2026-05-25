import { Pool } from 'pg';

interface CountryData {
  name: string;
  iso: string;
  phone: string;
  currency: string;
  states: {
    name: string;
    code: string;
    postalCodes: {
      code: string;
      place: string;
      lat: number;
      lng: number;
    }[];
  }[];
}

const countriesToSeed: CountryData[] = [
  {
    name: 'India',
    iso: 'IND',
    phone: '+91',
    currency: 'INR',
    states: [
      {
        name: 'Haryana',
        code: 'HR',
        postalCodes: [
          { code: '122002', place: 'DLF Phase 3, Gurugram', lat: 28.4962, lng: 77.0901 },
          { code: '122003', place: 'Sector 45, Gurugram', lat: 28.4418, lng: 77.0624 },
          { code: '122018', place: 'Sector 21, Gurugram', lat: 28.5029, lng: 77.0722 }
        ]
      },
      {
        name: 'Karnataka',
        code: 'KA',
        postalCodes: [
          { code: '560001', place: 'MG Road, Bengaluru', lat: 12.9734, lng: 77.6117 },
          { code: '560066', place: 'Whitefield, Bengaluru', lat: 12.9698, lng: 77.7499 },
          { code: '560103', place: 'Outer Ring Road, Bengaluru', lat: 12.9262, lng: 77.6762 }
        ]
      },
      {
        name: 'Delhi',
        code: 'DL',
        postalCodes: [
          { code: '110001', place: 'Connaught Place, New Delhi', lat: 28.6304, lng: 77.2177 },
          { code: '110021', place: 'Chanakyapuri, New Delhi', lat: 28.5921, lng: 77.1895 }
        ]
      },
      {
        name: 'Maharashtra',
        code: 'MH',
        postalCodes: [
          { code: '400001', place: 'Fort, Mumbai', lat: 18.9347, lng: 72.8358 },
          { code: '400050', place: 'Bandra West, Mumbai', lat: 19.0544, lng: 72.8402 },
          { code: '411057', place: 'Hinjawadi, Pune', lat: 18.5913, lng: 73.7389 }
        ]
      }
    ]
  },
  {
    name: 'United States',
    iso: 'USA',
    phone: '+1',
    currency: 'USD',
    states: [
      {
        name: 'California',
        code: 'CA',
        postalCodes: [
          { code: '95113', place: 'Downtown San Jose, Silicon Valley', lat: 37.3337, lng: -121.8907 },
          { code: '94102', place: 'Union Square, San Francisco', lat: 37.7879, lng: -122.4074 },
          { code: '90012', place: 'Downtown Los Angeles', lat: 34.0562, lng: -118.2410 }
        ]
      },
      {
        name: 'New York',
        code: 'NY',
        postalCodes: [
          { code: '10001', place: 'Chelsea, Manhattan', lat: 40.7501, lng: -73.9961 },
          { code: '11201', place: 'Brooklyn Heights', lat: 40.6972, lng: -73.9903 }
        ]
      },
      {
        name: 'Washington',
        code: 'WA',
        postalCodes: [
          { code: '98101', place: 'Downtown Seattle', lat: 47.6085, lng: -122.3395 },
          { code: '98004', place: 'Bellevue Tech Hub', lat: 47.6104, lng: -122.2007 }
        ]
      }
    ]
  },
  {
    name: 'United Kingdom',
    iso: 'GBR',
    phone: '+44',
    currency: 'GBP',
    states: [
      {
        name: 'England',
        code: 'ENG',
        postalCodes: [
          { code: 'EC1A', place: 'City of London', lat: 51.5204, lng: -0.0982 },
          { code: 'SW1A', place: 'Westminster, London', lat: 51.5010, lng: -0.1246 },
          { code: 'M1', place: 'Manchester Piccadilly', lat: 53.4808, lng: -2.2426 }
        ]
      }
    ]
  },
  {
    name: 'Germany',
    iso: 'DEU',
    phone: '+49',
    currency: 'EUR',
    states: [
      {
        name: 'Bavaria',
        code: 'BY',
        postalCodes: [
          { code: '80331', place: 'Altstadt, Munich', lat: 48.1374, lng: 11.5755 }
        ]
      },
      {
        name: 'Berlin',
        code: 'BE',
        postalCodes: [
          { code: '10115', place: 'Mitte, Berlin', lat: 52.5323, lng: 13.3846 }
        ]
      }
    ]
  },
  {
    name: 'France',
    iso: 'FRA',
    phone: '+33',
    currency: 'EUR',
    states: [
      {
        name: 'Île-de-France',
        code: 'IDF',
        postalCodes: [
          { code: '75001', place: 'Louvre, Paris', lat: 48.8625, lng: 2.3364 },
          { code: '92000', place: 'Nanterre / La Défense, Paris', lat: 48.8924, lng: 2.2153 }
        ]
      }
    ]
  },
  {
    name: 'Japan',
    iso: 'JPN',
    phone: '+81',
    currency: 'JPY',
    states: [
      {
        name: 'Tokyo',
        code: 'TYO',
        postalCodes: [
          { code: '160-0022', place: 'Shinjuku, Tokyo', lat: 35.6938, lng: 139.7034 }
        ]
      }
    ]
  },
  {
    name: 'Canada',
    iso: 'CAN',
    phone: '+1',
    currency: 'CAD',
    states: [
      {
        name: 'Ontario',
        code: 'ON',
        postalCodes: [
          { code: 'M5V', place: 'Downtown Toronto', lat: 43.6448, lng: -79.3941 }
        ]
      }
    ]
  },
  {
    name: 'Australia',
    iso: 'AUS',
    phone: '+61',
    currency: 'AUD',
    states: [
      {
        name: 'New South Wales',
        code: 'NSW',
        postalCodes: [
          { code: '2000', place: 'Sydney CBD', lat: -33.8688, lng: 151.2093 }
        ]
      }
    ]
  },
  {
    name: 'Brazil',
    iso: 'BRA',
    phone: '+55',
    currency: 'BRL',
    states: [
      {
        name: 'São Paulo',
        code: 'SP',
        postalCodes: [
          { code: '01000', place: 'Centro, São Paulo', lat: -23.5505, lng: -46.6333 }
        ]
      }
    ]
  },
  {
    name: 'Italy',
    iso: 'ITA',
    phone: '+39',
    currency: 'EUR',
    states: [
      {
        name: 'Lazio',
        code: 'RM',
        postalCodes: [
          { code: '00185', place: 'Roma Termini', lat: 41.9014, lng: 12.5009 }
        ]
      }
    ]
  },
  {
    name: 'Spain',
    iso: 'ESP',
    phone: '+34',
    currency: 'EUR',
    states: [
      {
        name: 'Madrid',
        code: 'MD',
        postalCodes: [
          { code: '28001', place: 'Recoletos, Madrid', lat: 40.4259, lng: -3.6876 }
        ]
      }
    ]
  },
  {
    name: 'Mexico',
    iso: 'MEX',
    phone: '+52',
    currency: 'MXN',
    states: [
      {
        name: 'Distrito Federal',
        code: 'DF',
        postalCodes: [
          { code: '06000', place: 'Centro Historico, CDMX', lat: 19.4326, lng: -99.1332 }
        ]
      }
    ]
  },
  {
    name: 'South Korea',
    iso: 'KOR',
    phone: '+82',
    currency: 'KRW',
    states: [
      {
        name: 'Seoul',
        code: 'SU',
        postalCodes: [
          { code: '06000', place: 'Gangnam-gu, Seoul', lat: 37.5172, lng: 127.0473 }
        ]
      }
    ]
  },
  {
    name: 'Netherlands',
    iso: 'NLD',
    phone: '+31',
    currency: 'EUR',
    states: [
      {
        name: 'North Holland',
        code: 'NH',
        postalCodes: [
          { code: '1012', place: 'Centrum, Amsterdam', lat: 52.3702, lng: 4.8952 }
        ]
      }
    ]
  },
  {
    name: 'Saudi Arabia',
    iso: 'SAU',
    phone: '+966',
    currency: 'SAR',
    states: [
      {
        name: 'Riyadh Province',
        code: 'RIY',
        postalCodes: [
          { code: '11564', place: 'Olaya, Riyadh', lat: 24.7136, lng: 46.6753 }
        ]
      }
    ]
  },
  {
    name: 'Turkey',
    iso: 'TUR',
    phone: '+90',
    currency: 'TRY',
    states: [
      {
        name: 'Istanbul',
        code: 'IST',
        postalCodes: [
          { code: '34330', place: 'Levent, Istanbul', lat: 41.0766, lng: 29.0142 }
        ]
      }
    ]
  },
  {
    name: 'Switzerland',
    iso: 'CHE',
    phone: '+41',
    currency: 'CHF',
    states: [
      {
        name: 'Zurich',
        code: 'ZH',
        postalCodes: [
          { code: '8001', place: 'Zurich Center', lat: 47.3769, lng: 8.5417 }
        ]
      }
    ]
  },
  {
    name: 'Indonesia',
    iso: 'IDN',
    phone: '+62',
    currency: 'IDR',
    states: [
      {
        name: 'Jakarta',
        code: 'JK',
        postalCodes: [
          { code: '10110', place: 'Gambir, Central Jakarta', lat: -6.1754, lng: 106.8272 }
        ]
      }
    ]
  },
  {
    name: 'Singapore',
    iso: 'SGP',
    phone: '+65',
    currency: 'SGD',
    states: [
      {
        name: 'Singapore Circle',
        code: 'SG',
        postalCodes: [
          { code: '018981', place: 'Marina Bay, Singapore', lat: 1.2823, lng: 103.8582 }
        ]
      }
    ]
  },
  {
    name: 'Sweden',
    iso: 'SWE',
    phone: '+46',
    currency: 'SEK',
    states: [
      {
        name: 'Stockholm County',
        code: 'AB',
        postalCodes: [
          { code: '11120', place: 'Norrmalm, Stockholm', lat: 59.3326, lng: 18.0649 }
        ]
      }
    ]
  }
];

export async function seedGeographicDataIfEmpty(pool: Pool) {
  try {
    // 1. Create tables if they do not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS countries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        iso_code VARCHAR(3) UNIQUE NOT NULL,
        phone_code VARCHAR(10) NOT NULL,
        currency VARCHAR(10) DEFAULT 'INR'
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS states (
        id SERIAL PRIMARY KEY,
        country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        code VARCHAR(10)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS postal_codes (
        id SERIAL PRIMARY KEY,
        state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
        postal_code VARCHAR(20) NOT NULL,
        place_name VARCHAR(100) NOT NULL,
        location GEOMETRY(Point, 4326) NOT NULL
      );
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_postal_codes_location ON postal_codes USING GIST(location);');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_postal_codes_code ON postal_codes(postal_code);');

    // 2. Check if countries table has rows
    const countRes = await pool.query('SELECT COUNT(*) FROM countries');
    const count = parseInt(countRes.rows[0].count, 10);

    if (count > 0) {
      console.log(`[GEO SEED] Countries table already has ${count} records. Skipping automatic seed.`);
      return;
    }

    console.log('[GEO SEED] Countries table is empty. Bootstrapping global geographic data...');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const country of countriesToSeed) {
        const countryRes = await client.query(
          `INSERT INTO countries (name, iso_code, phone_code, currency)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [country.name, country.iso, country.phone, country.currency]
        );
        const countryId = countryRes.rows[0].id;

        for (const state of country.states) {
          const stateRes = await client.query(
            `INSERT INTO states (country_id, name, code)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [countryId, state.name, state.code]
          );
          const stateId = stateRes.rows[0].id;

          for (const pc of state.postalCodes) {
            await client.query(
              `INSERT INTO postal_codes (state_id, postal_code, place_name, location)
               VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326))`,
              [stateId, pc.code, pc.place, pc.lng, pc.lat]
            );
          }
        }
      }

      await client.query('COMMIT');
      console.log('[GEO SEED] Global geographic database seeding completed successfully!');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[GEO SEED] Transaction failed, rolled back changes:', err);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[GEO SEED] Seeding check failed:', err);
  }
}
