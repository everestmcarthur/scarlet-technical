-- ============================================================================
-- Migration 020: Agent system overhaul
-- Fixes schema mismatches, adds override PIN, unlock requests, device tokens
-- ============================================================================

-- 1. Add device_token to enrolled_devices (agents authenticate with this, not device_id)
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS device_token VARCHAR(255) UNIQUE;

-- 2. Add override PIN columns
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin VARCHAR(10);
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin_expires_at TIMESTAMPTZ;
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS override_pin_attempts INTEGER DEFAULT 0;

-- 3. Add ip_address, uptime, battery, etc. for richer heartbeat data
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS ip_address VARCHAR(100);
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS uptime TEXT;
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS cpu_usage NUMERIC;
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS memory_usage NUMERIC;
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS disk_usage NUMERIC;
ALTER TABLE enrolled_devices ADD COLUMN IF NOT EXISTS battery NUMERIC;

-- 4. Fix device_commands: add lock_message if missing, add params column
ALTER TABLE device_commands ADD COLUMN IF NOT EXISTS params JSONB DEFAULT '{}';

-- 5. Create the enrollment_tokens table that routes actually reference
-- (migration 013 created device_enrollment_tokens, but all routes use enrollment_tokens)
CREATE TABLE IF NOT EXISTS enrollment_tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(255) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  label VARCHAR(255),
  max_devices INTEGER DEFAULT 1,
  created_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 days',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Unlock requests table (customers can request unlock from the lock screen)
CREATE TABLE IF NOT EXISTS unlock_requests (
  id SERIAL PRIMARY KEY,
  device_id INTEGER NOT NULL REFERENCES enrolled_devices(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  reason TEXT,
  contact_info VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','expired')),
  reviewed_by INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unlock_requests_device ON unlock_requests(device_id, status);
CREATE INDEX IF NOT EXISTS idx_unlock_requests_status ON unlock_requests(status, created_at DESC);

-- 7. Generate tokens for any existing devices that don't have one
UPDATE enrolled_devices SET device_token = encode(gen_random_bytes(24), 'hex')
  WHERE device_token IS NULL;

