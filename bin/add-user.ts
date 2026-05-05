import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { stmts } from '../src/server/db.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    'display-name': { type: 'string' },
  },
  strict: true,
});

const email = values.email?.trim().toLowerCase();
if (!email) {
  console.error('Usage: tsx bin/add-user.ts --email <email> [--display-name <name>]');
  process.exit(1);
}
const displayName = values['display-name']?.trim() || null;

const existing = stmts.findUserByEmail.get(email);
if (existing) {
  if (displayName && displayName !== existing.display_name) {
    stmts.upsertUser.run(existing.id, email, displayName, existing.created_at);
    console.log(`Updated user ${existing.id} <${email}> display_name=${displayName}`);
  } else {
    console.log(`User already exists: ${existing.id} <${email}>`);
  }
  process.exit(0);
}

const id = randomUUID();
const createdAt = Math.floor(Date.now() / 1000);
stmts.insertUser.run(id, email, displayName, createdAt);
console.log(`Created user ${id} <${email}>`);
