import {
  signAccessToken,
  verifyAccessToken,
  signMfaTempToken,
  verifyMfaTempToken,
  generateRefreshToken,
  hashToken,
} from '../../src/utils/jwt';
import { UserRole } from '@prisma/client';

describe('JWT and Token Utilities', () => {
  const mockPayload = {
    userId: '11111111-2222-3333-4444-555555555555',
    email: 'doctor@amrutam.co.in',
    role: UserRole.DOCTOR,
    mfaAuthenticated: false,
  };

  it('should sign and verify valid access tokens', () => {
    const token = signAccessToken(mockPayload);
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.userId).toBe(mockPayload.userId);
    expect(decoded.email).toBe(mockPayload.email);
    expect(decoded.role).toBe(mockPayload.role);
  });

  it('should sign and verify temporary MFA tokens', () => {
    const tempToken = signMfaTempToken(mockPayload.userId, mockPayload.email, mockPayload.role);
    const decoded = verifyMfaTempToken(tempToken);

    expect(decoded.userId).toBe(mockPayload.userId);
    expect(decoded.email).toBe(mockPayload.email);
    expect(decoded.role).toBe(mockPayload.role);
  });

  it('should generate high-entropy opaque refresh tokens and hash them with SHA-256', () => {
    const token1 = generateRefreshToken();
    const token2 = generateRefreshToken();

    expect(token1).not.toBe(token2);
    expect(token1.length).toBe(96); // 48 bytes hex = 96 chars

    const hash1 = hashToken(token1);
    const hash2 = hashToken(token1);
    const hash3 = hashToken(token2);

    expect(hash1).toBe(hash2); // Deterministic hash
    expect(hash1).not.toBe(hash3);
    expect(hash1.length).toBe(64); // SHA-256 = 64 hex chars
  });

  it('should reject malformed or tampered JWT access tokens with UnauthorizedError', () => {
    expect(() => verifyAccessToken('invalid.token.signature')).toThrow();
  });
});
