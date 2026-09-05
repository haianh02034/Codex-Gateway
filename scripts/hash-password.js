'use strict';

/**
 * Turns a password into the bcrypt hash that belongs in ADMIN_PASSWORD_HASH.
 *
 *   npm run auth:hash -- "your-password"
 *
 * The plaintext is never written anywhere — copy the hash into .env yourself.
 */

const bcrypt = require('bcryptjs');

const COST = 12;
const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run auth:hash -- "your-password"');
  process.exit(1);
}

if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

console.log(bcrypt.hashSync(password, COST));
