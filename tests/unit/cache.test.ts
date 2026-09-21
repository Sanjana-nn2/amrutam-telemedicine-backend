import { CacheService, CacheKeys } from '../../src/utils/cache';
import { redisClient } from '../../src/config/redis';

describe('Redis Cache-Aside Unit Tests (with Fallback Verification)', () => {
  it('should generate deterministic cache keys', () => {
    const key1 = CacheKeys.doctorProfile('doc-123');
    const key2 = CacheKeys.doctorProfile('doc-123');
    expect(key1).toBe('amrutam:doctor:profile:doc-123');
    expect(key1).toBe(key2);

    const listKey = CacheKeys.doctorList('hashabc');
    expect(listKey).toBe('amrutam:doctor:list:hashabc');

    const slotsKey = CacheKeys.doctorSlots('doc-123', 'hashxyz');
    expect(slotsKey).toBe('amrutam:slots:doc-123:hashxyz');
  });

  it('should safely return null and not throw when Redis is disconnected or unavailable', async () => {
    // CacheService is designed to fail-safe and never throw when Redis is down
    const result = await CacheService.get('any-key');
    expect(result).toBeNull();
  });

  it('should safely execute set, del, delByPattern without throwing when Redis is disconnected', async () => {
    await expect(CacheService.set('key', { data: 'test' }, 60)).resolves.not.toThrow();
    await expect(CacheService.del('key')).resolves.not.toThrow();
    await expect(CacheService.delByPattern('pattern*')).resolves.not.toThrow();
    await expect(CacheService.invalidateDoctorProfile('doc-123')).resolves.not.toThrow();
    await expect(CacheService.invalidateDoctorSlots('doc-123')).resolves.not.toThrow();
  });
});
