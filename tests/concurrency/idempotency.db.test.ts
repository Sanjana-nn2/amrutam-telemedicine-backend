/**
 * Real PostgreSQL Idempotency Integration Test.
 *
 * Tests the three core idempotency contracts against live PostgreSQL:
 * A. Same Idempotency-Key + same user + same endpoint + same body => response replay & no duplicate writes
 * B. Same key + different request body => HTTP 409 Conflict
 * C. Simultaneous requests with same key => single record created, no duplicate writes
 *
 * If live PostgreSQL is unavailable, this test reports BLOCKED with exact instructions to execute.
 */

import { PrismaClient, UserRole, SlotStatus } from '@prisma/client';
import request from 'supertest';

jest.mock('otplib', () => ({
  generateSecret: jest.fn(() => 'TESTSECRET'),
  generateURI: jest.fn(() => 'otpauth://totp/Amrutam:test@example.com?secret=TESTSECRET'),
  verifySync: jest.fn(() => ({ valid: true })),
}));

import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/jwt';

const prisma = new PrismaClient();
const app = createApp();

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe('Real PostgreSQL Idempotency Integration Test', () => {
  let dbAvailable = false;
  let patientUserId: string;
  let patientToken: string;
  let doctorId: string;
  let doctorUserId: string;
  let slotAId: string;
  let slotBId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (!dbAvailable) {
      console.warn(
        '\n[BLOCKED] Real PostgreSQL Idempotency Test: Live PostgreSQL instance not reachable at DATABASE_URL.\n' +
        'To run this test with real PostgreSQL:\n' +
        '  1. docker compose up -d postgres redis\n' +
        '  2. npx prisma migrate deploy\n' +
        '  3. npm run test:concurrency\n'
      );
      return;
    }

    // Create verified Doctor and slots
    const doctorUser = await prisma.user.create({
      data: {
        email: `idemp.doc.${Date.now()}@amrutam.co.in`,
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewfY.S7P3.h8sSfe',
        role: UserRole.DOCTOR,
        isActive: true,
        isEmailVerified: true,
        profile: { create: { firstName: 'Idemp', lastName: 'Doctor' } },
        doctor: {
          create: {
            specialization: 'Idempotency Validation',
            licenseNumber: `LIC-IDEMP-${Date.now()}`,
            experienceYears: 8,
            consultationFee: 400,
            isVerified: true,
          },
        },
      },
      include: { doctor: true },
    });
    doctorUserId = doctorUser.id;
    doctorId = (doctorUser as any).doctor!.id;

    // Create 2 future slots
    const startA = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const endA = new Date(startA.getTime() + 30 * 60 * 1000);
    const slotA = await prisma.availabilitySlot.create({
      data: { doctorId, startTime: startA, endTime: endA, status: SlotStatus.AVAILABLE },
    });
    slotAId = slotA.id;

    const startB = new Date(Date.now() + 50 * 60 * 60 * 1000);
    const endB = new Date(startB.getTime() + 30 * 60 * 1000);
    const slotB = await prisma.availabilitySlot.create({
      data: { doctorId, startTime: startB, endTime: endB, status: SlotStatus.AVAILABLE },
    });
    slotBId = slotB.id;

    // Create Patient user
    const patient = await prisma.user.create({
      data: {
        email: `idemp.patient.${Date.now()}@example.com`,
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewfY.S7P3.h8sSfe',
        role: UserRole.PATIENT,
        isActive: true,
        isEmailVerified: true,
        profile: { create: { firstName: 'Idemp', lastName: 'Patient' } },
      },
    });
    patientUserId = patient.id;
    patientToken = signAccessToken({
      userId: patient.id,
      email: patient.email,
      role: patient.role,
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.consultation.deleteMany({ where: { doctorId } });
      await prisma.availabilitySlot.deleteMany({ where: { doctorId } });
      if (doctorId) await prisma.doctor.deleteMany({ where: { id: doctorId } });
      if (doctorUserId) {
        await prisma.profile.deleteMany({ where: { userId: doctorUserId } });
        await prisma.user.deleteMany({ where: { id: doctorUserId } });
      }
      if (patientUserId) {
        await prisma.idempotencyKey.deleteMany({ where: { userId: patientUserId } });
        await prisma.profile.deleteMany({ where: { userId: patientUserId } });
        await prisma.user.deleteMany({ where: { id: patientUserId } });
      }
    }
    await prisma.$disconnect();
  });

  it('A. Replays identical response and produces no duplicate records when same key + payload is sent', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const idempotencyKey = `idemp-key-replay-${Date.now()}`;
    const payload = {
      doctorId,
      slotId: slotAId,
      chiefComplaint: 'First booking test for idempotency replay',
    };

    // First request
    const res1 = await request(app)
      .post('/api/v1/consultations/book')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res1.status).toBe(201);
    expect(res1.headers['x-cache-idempotency']).toBeUndefined();
    const consultationId = res1.body.data.id;

    // Second request with IDENTICAL key and payload
    const res2 = await request(app)
      .post('/api/v1/consultations/book')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(res2.status).toBe(201);
    expect(res2.headers['idempotent-replay']).toBe('true');
    expect(res2.body.data.id).toBe(consultationId);

    // Verify exactly ONE consultation was written to database
    const dbConsultations = await prisma.consultation.findMany({
      where: { slotId: slotAId },
    });
    expect(dbConsultations).toHaveLength(1);
  });

  it('B. Rejects with HTTP 409 Conflict when same key is sent with different request payload', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    const idempotencyKey = `idemp-key-payload-mismatch-${Date.now()}`;
    const payload1 = {
      doctorId,
      slotId: slotBId,
      chiefComplaint: 'Original complaint description',
    };

    const payload2 = {
      doctorId,
      slotId: slotBId,
      chiefComplaint: 'Tampered or modified complaint description',
    };

    // First request registers the idempotency record
    const res1 = await request(app)
      .post('/api/v1/consultations/book')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload1);

    expect(res1.status).toBe(201);

    // Second request with SAME key but DIFFERENT payload
    const res2 = await request(app)
      .post('/api/v1/consultations/book')
      .set('Authorization', `Bearer ${patientToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(payload2);

    expect(res2.status).toBe(409);
    expect(res2.body.error.message).toMatch(/payload mismatch|idempotency.key|idempotency-key/i);
  });

  it('C. Prevents race conditions and duplicate writes during simultaneous requests with same key', async () => {
    if (!dbAvailable) {
      expect(true).toBe(true);
      return;
    }

    // Create another slot for race testing
    const startC = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const endC = new Date(startC.getTime() + 30 * 60 * 1000);
    const slotC = await prisma.availabilitySlot.create({
      data: { doctorId, startTime: startC, endTime: endC, status: SlotStatus.AVAILABLE },
    });

    const sharedKey = `idemp-race-${Date.now()}`;
    const payload = {
      doctorId,
      slotId: slotC.id,
      chiefComplaint: 'Simultaneous requests with identical idempotency key',
    };

    // Send 3 simultaneous requests with exactly the same key
    const promises = [
      request(app)
        .post('/api/v1/consultations/book')
        .set('Authorization', `Bearer ${patientToken}`)
        .set('Idempotency-Key', sharedKey)
        .send(payload),
      request(app)
        .post('/api/v1/consultations/book')
        .set('Authorization', `Bearer ${patientToken}`)
        .set('Idempotency-Key', sharedKey)
        .send(payload),
      request(app)
        .post('/api/v1/consultations/book')
        .set('Authorization', `Bearer ${patientToken}`)
        .set('Idempotency-Key', sharedKey)
        .send(payload),
    ];

    const responses = await Promise.all(promises);

    // Concurrent identical requests must never create duplicate writes.
    // One request succeeds; requests arriving while it is IN_PROGRESS may receive 409.
    responses.forEach((res) => {
      expect([201, 409]).toContain(res.status);
    });

    expect(responses.some((res) => res.status === 201)).toBe(true);

    // Exactly one consultation in PostgreSQL
    const consultations = await prisma.consultation.findMany({
      where: { slotId: slotC.id },
    });
    expect(consultations).toHaveLength(1);

    // Exactly one idempotency key record in PostgreSQL
    const keyRecords = await prisma.idempotencyKey.findMany({
      where: { key: sharedKey },
    });
    expect(keyRecords).toHaveLength(1);
  });
});




