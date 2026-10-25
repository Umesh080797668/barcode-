/**
 * Seed script — run ONCE to create the first owner account.
 *
 * Usage:
 *   MONGO_URI="mongodb+srv://..." OWNER_PASSWORD="your-secure-password" npx ts-node scripts/seed-owner.ts
 *
 * Or with ts-node-esm / tsx:
 *   MONGO_URI="..." OWNER_PASSWORD="..." npx tsx scripts/seed-owner.ts
 */
import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGO_URI environment variable is required');
  process.exit(1);
}

const OWNER_USERNAME = process.env.OWNER_USERNAME || 'Imantha';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
if (!OWNER_PASSWORD || OWNER_PASSWORD.length < 8) {
  console.error('ERROR: OWNER_PASSWORD env var is required and must be ≥8 chars');
  process.exit(1);
}
const OWNER_NAME = process.env.OWNER_NAME || 'Imantha';

const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password_hash: { type: String, required: true },
  role: { type: String, enum: ['owner', 'cashier'], default: 'cashier' },
  display_name: { type: String, required: true },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
});

const User = mongoose.model('User', UserSchema);

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI!);

  const existing = await User.findOne({ username: OWNER_USERNAME });
  if (existing) {
    console.log(`User "${OWNER_USERNAME}" already exists — skipping. Delete manually if you want to reset.`);
    await mongoose.disconnect();
    process.exit(0);
  }

  const password_hash = await bcrypt.hash(OWNER_PASSWORD!, 12);
  await User.create({
    username: OWNER_USERNAME,
    password_hash,
    role: 'owner',
    display_name: OWNER_NAME,
    active: true,
  });

  console.log(`✅  Owner account created: username="${OWNER_USERNAME}"`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
