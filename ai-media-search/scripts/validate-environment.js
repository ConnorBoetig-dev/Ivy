// This script validates that all required environment variables are set
const requiredEnvVars = [
  'NEXT_PUBLIC_APP_URL',
  'DATABASE_URL',
  'REDIS_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'FIREBASE_ADMIN_PRIVATE_KEY',
  'STRIPE_SECRET_KEY',
  'OPENAI_API_KEY'
];

const optionalEnvVars = [
  'SENTRY_DSN',
  'CLOUDFLARE_ZONE_ID',
  'CLOUDFLARE_API_TOKEN',
  'JWT_SECRET',
  'ENCRYPTION_KEY',
  'SESSION_SECRET'
];

console.log('🔍 Validating environment variables...\n');

// Check required variables
const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);

if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingVars.forEach(envVar => console.error(`  - ${envVar}`));
  console.error('\nPlease set these variables in your .env.local file');
  process.exit(1);
}

console.log('✅ All required environment variables are set');

// Check optional variables
const missingOptional = optionalEnvVars.filter(envVar => !process.env[envVar]);

if (missingOptional.length > 0) {
  console.log('\n⚠️  Missing optional environment variables:');
  missingOptional.forEach(envVar => console.log(`  - ${envVar}`));
  console.log('\nThese are optional but recommended for production');
}

// Validate specific formats
const validationRules = {
  DATABASE_URL: (val) => val.startsWith('postgresql://'),
  REDIS_URL: (val) => val.startsWith('redis://'),
  OPENAI_API_KEY: (val) => val.startsWith('sk-'),
  STRIPE_SECRET_KEY: (val) => val.startsWith('sk_'),
};

console.log('\n🔍 Validating environment variable formats...');

let formatErrors = false;
Object.entries(validationRules).forEach(([envVar, validator]) => {
  const value = process.env[envVar];
  if (value && !validator(value)) {
    console.error(`❌ Invalid format for ${envVar}`);
    formatErrors = true;
  }
});

if (formatErrors) {
  console.error('\nPlease check the format of your environment variables');
  process.exit(1);
}

console.log('✅ All environment variable formats are valid\n');
console.log('✨ Environment validation complete!');