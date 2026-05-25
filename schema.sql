-- Enable PostGIS extension for spatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    phone VARCHAR(15) UNIQUE NOT NULL,
    gender VARCHAR(10) CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    company_domain VARCHAR(100), -- e.g. 'google.com'
    society_name VARCHAR(100),   -- e.g. 'DLF Phase 5'
    kyc_status VARCHAR(20) DEFAULT 'PENDING' CHECK (kyc_status IN ('PENDING', 'DOCUMENT_UPLOADED', 'FACE_VERIFIED', 'VERIFIED', 'FAILED')),
    aadhaar_face_token TEXT,
    linkedin_profile_url VARCHAR(255),
    linkedin_connections INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Drivers Table
CREATE TABLE IF NOT EXISTS drivers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_rc VARCHAR(20) UNIQUE,
    vehicle_make VARCHAR(50),
    dl_number VARCHAR(20) UNIQUE,
    is_ev BOOLEAN DEFAULT FALSE, -- EV Matching Priority support
    is_verified BOOLEAN DEFAULT FALSE,
    upi_payout_id VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Rides Table (Spatial route matches)
CREATE TABLE IF NOT EXISTS rides (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    route_line GEOMETRY(LineString, 4326) NOT NULL, -- Driver's spatial route vector
    seats_total INTEGER NOT NULL CHECK (seats_total > 0),
    seats_available INTEGER NOT NULL CHECK (seats_available >= 0),
    price_split DECIMAL(10, 2) NOT NULL,
    departure_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED')),
    vehicle_type VARCHAR(10) DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR', 'BIKE')),
    music_allowed BOOLEAN DEFAULT TRUE,
    smoking_allowed BOOLEAN DEFAULT FALSE,
    chattiness VARCHAR(20) DEFAULT 'MEDIUM' CHECK (chattiness IN ('QUIET', 'MEDIUM', 'TALKATIVE')),
    ac_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bookings Table (Rider requests & Escrow states)
CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    rider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seats_booked INTEGER NOT NULL DEFAULT 1 CHECK (seats_booked > 0),
    pickup_point GEOMETRY(Point, 4326) NOT NULL, -- Exact matched pickup location
    drop_point GEOMETRY(Point, 4326) NOT NULL,   -- Exact matched drop location
    payment_status VARCHAR(20) DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'ESCROW_LOCKED', 'RELEASED', 'REFUNDED')),
    escrow_status VARCHAR(20) DEFAULT 'INACTIVE' CHECK (escrow_status IN ('INACTIVE', 'HELD', 'SETTLED', 'DISPUTED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Real-Time Telemetry Coordinates
CREATE TABLE IF NOT EXISTS device_coordinates (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_location GEOMETRY(Point, 4326) NOT NULL,
    speed DECIMAL(5, 2),
    bearing DECIMAL(5, 2),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create spatial indices for performance optimization
CREATE INDEX IF NOT EXISTS idx_rides_route_line ON rides USING GIST(route_line);
CREATE INDEX IF NOT EXISTS idx_bookings_pickup_point ON bookings USING GIST(pickup_point);
CREATE INDEX IF NOT EXISTS idx_bookings_drop_point ON bookings USING GIST(drop_point);
CREATE INDEX IF NOT EXISTS idx_device_coordinates ON device_coordinates USING GIST(current_location);

-- 6. Recurring Rides Table
CREATE TABLE IF NOT EXISTS recurring_rides (
    id SERIAL PRIMARY KEY,
    driver_id INTEGER NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    route_line GEOMETRY(LineString, 4326) NOT NULL, -- Driver's spatial route vector
    seats_total INTEGER NOT NULL CHECK (seats_total > 0),
    price_split DECIMAL(10, 2) NOT NULL,
    departure_time_of_day TIME NOT NULL, -- Time of day, e.g. '08:45:00'
    days_of_week INTEGER[] NOT NULL, -- e.g. [1, 2, 3, 4, 5] for Mon-Fri
    vehicle_type VARCHAR(10) DEFAULT 'CAR' CHECK (vehicle_type IN ('CAR', 'BIKE')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_recurring_rides_route_line ON recurring_rides USING GIST(route_line);

-- 7. Classifieds Table (POOLit style board)
CREATE TABLE IF NOT EXISTS classifieds (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(30) NOT NULL CHECK (category IN ('FLATMATE', 'BUY_SELL', 'ITEM_SHARE', 'OTHER')),
    price DECIMAL(10, 2),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Countries Table (Top 20 GDP launch countries)
CREATE TABLE IF NOT EXISTS countries (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    iso_code VARCHAR(3) UNIQUE NOT NULL, -- e.g. 'IND', 'USA', 'GBR'
    phone_code VARCHAR(10) NOT NULL,    -- e.g. '+91', '+1', '+44'
    currency VARCHAR(10) DEFAULT 'INR'
);

-- 9. States Table (Major provinces/states per country)
CREATE TABLE IF NOT EXISTS states (
    id SERIAL PRIMARY KEY,
    country_id INTEGER NOT NULL REFERENCES countries(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(10)                   -- e.g. 'DL', 'CA', 'NY'
);

-- 10. Postal Codes (Pincodes / Zip codes)
CREATE TABLE IF NOT EXISTS postal_codes (
    id SERIAL PRIMARY KEY,
    state_id INTEGER NOT NULL REFERENCES states(id) ON DELETE CASCADE,
    postal_code VARCHAR(20) NOT NULL,   -- e.g. '110001', '90210'
    place_name VARCHAR(100) NOT NULL,   -- e.g. 'Connaught Place', 'Beverly Hills'
    location GEOMETRY(Point, 4326) NOT NULL -- Centroid of the pin code
);

-- Indices for performance
CREATE INDEX IF NOT EXISTS idx_postal_codes_location ON postal_codes USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_postal_codes_code ON postal_codes(postal_code);

