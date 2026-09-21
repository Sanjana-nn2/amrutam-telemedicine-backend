import crypto from 'crypto';
import { env } from '../config/env';
import { AppError } from './errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES-GCM
const AUTH_TAG_LENGTH = 16; // 16 bytes for auth tag

/**
 * Derives a 32-byte Buffer key from the environment variable ENCRYPTION_KEY.
 * ENCRYPTION_KEY must be a 64-character hex string (32 bytes).
 */
const getEncryptionKey = (): Buffer => {
  const hexKey = env.ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new AppError('Invalid ENCRYPTION_KEY configuration: Must be a 64-character hex string (32 bytes)', 500);
  }
  return Buffer.from(hexKey, 'hex');
};

/**
 * Encrypts plaintext using AES-256-GCM.
 * Generates a unique random IV for every encryption call.
 * Format: ivHex:authTagHex:encryptedHex
 */
export const encrypt = (plaintext: string): string => {
  if (plaintext === null || plaintext === undefined) {
    return plaintext;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    throw new AppError('Encryption failed', 500, err instanceof Error ? err.message : undefined);
  }
};

/**
 * Decrypts a formatted ciphertext string (ivHex:authTagHex:encryptedHex) using AES-256-GCM.
 * Verifies authenticity tag to prevent tampering.
 * Safely handles malformed input.
 */
export const decrypt = (ciphertext: string): string => {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return ciphertext;
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 3) {
    // Return original if not in encrypted format (allows backward compatibility or unencrypted fallbacks)
    return ciphertext;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;

  try {
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid IV or auth tag length');
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new AppError('Decryption failed: Data may be corrupted or tampered with', 500);
  }
};
