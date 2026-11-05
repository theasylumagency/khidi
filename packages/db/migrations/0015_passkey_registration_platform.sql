ALTER TABLE user_passkeys ADD COLUMN registration_platform TEXT
  CHECK (registration_platform IN ('IPHONE', 'IPAD', 'ANDROID', 'WINDOWS', 'MAC', 'CHROMEOS', 'LINUX', 'OTHER'));
