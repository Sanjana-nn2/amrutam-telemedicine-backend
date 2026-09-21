import { encrypt, decrypt } from '../../src/utils/encryption';

describe('AES-256-GCM Encryption Utility', () => {
  const sampleText = 'Sensitive Patient Health Information: BP 120/80, Ayurvedic dosha Vata-Pitta';

  it('should encrypt plaintext into IV:AuthTag:Ciphertext format', () => {
    const encrypted = encrypt(sampleText);
    expect(typeof encrypted).toBe('string');

    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    expect(parts[0].length).toBe(32); // 16 bytes IV = 32 hex chars
    expect(parts[1].length).toBe(32); // 16 bytes auth tag = 32 hex chars
    expect(parts[2].length).toBeGreaterThan(0);
  });

  it('should successfully decrypt ciphertext back to original plaintext', () => {
    const encrypted = encrypt(sampleText);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(sampleText);
  });

  it('should generate distinct IVs for identical plaintexts (non-deterministic)', () => {
    const encrypted1 = encrypt(sampleText);
    const encrypted2 = encrypt(sampleText);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decrypt(encrypted1)).toBe(sampleText);
    expect(decrypt(encrypted2)).toBe(sampleText);
  });

  it('should reject tampered ciphertext and fail auth tag validation', () => {
    const encrypted = encrypt(sampleText);
    const parts = encrypted.split(':');

    // Tamper with the ciphertext byte
    const tamperedCiphertext = parts[2].slice(0, -2) + (parts[2].slice(-2) === 'aa' ? 'bb' : 'aa');
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

    expect(() => decrypt(tampered)).toThrow();
  });

  it('should safely handle empty or unencrypted fallback values', () => {
    expect(decrypt('')).toBe('');
    expect(decrypt('plain-unencrypted-value')).toBe('plain-unencrypted-value');
  });
});
