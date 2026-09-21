import { PrismaClient, UserRole, SlotStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Standard bcrypt hash for "Password123!" (cost factor 12)
const DEFAULT_PASSWORD_HASH =
  '$2b$12$VDbvxsrRwSXC25gYE1DzkuANyDQlJYLEpi9X2EKilSNYIgUpaR.yu';

async function main() {
  console.log('Seeding Amrutam Telemedicine database...');

  // 1. Clean existing records in reverse dependency order
  await prisma.payment.deleteMany();
  await prisma.prescription.deleteMany();
  await prisma.consultation.deleteMany();
  await prisma.availabilitySlot.deleteMany();
  await prisma.doctor.deleteMany();
  await prisma.profile.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.idempotencyKey.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();

  console.log('Cleared existing records.');

  // 2. Create System Admin
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@amrutam.co.in',
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.ADMIN,
      isActive: true,
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Amrutam',
          lastName: 'Administrator',
          phone: '+919876543210',
          gender: 'Other',
        },
      },
    },
  });
  console.log(`Created Admin user: ${adminUser.email}`);

  // 3. Create Patient User
  const patientUser = await prisma.user.create({
    data: {
      email: 'patient.demo@amrutam.co.in',
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.PATIENT,
      isActive: true,
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Rahul',
          lastName: 'Sharma',
          phone: '+919811122233',
          gender: 'Male',
          bloodGroup: 'B+',
          dateOfBirth: new Date('1992-05-14T00:00:00.000Z'),
          emergencyContact: '+919811122299',
        },
      },
    },
  });
  console.log(`Created Patient user: ${patientUser.email}`);

  // 4. Create Doctor 1
  const doctor1User = await prisma.user.create({
    data: {
      email: 'dr.priya@amrutam.co.in',
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.DOCTOR,
      isActive: true,
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Priya',
          lastName: 'Nair',
          phone: '+919822233344',
          gender: 'Female',
        },
      },
      doctor: {
        create: {
          specialization: 'Kayachikitsa (Internal Medicine)',
          licenseNumber: 'AYUR-KA-2015-8891',
          experienceYears: 11,
          bio: 'Specialist in chronic gut health, metabolic disorders, and traditional Ayurvedic pulse diagnosis (Nadi Pariksha).',
          consultationFee: 750.0,
          languages: ['English', 'Hindi', 'Malayalam'],
          isVerified: true,
          averageRating: 4.9,
          totalReviews: 128,
        },
      },
    },
    include: { doctor: true },
  });
  console.log(`Created Doctor 1: ${doctor1User.email}`);

  // 5. Create Doctor 2
  const doctor2User = await prisma.user.create({
    data: {
      email: 'dr.anand@amrutam.co.in',
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: UserRole.DOCTOR,
      isActive: true,
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Anand',
          lastName: 'Vaidya',
          phone: '+919833344455',
          gender: 'Male',
        },
      },
      doctor: {
        create: {
          specialization: 'Panchakarma',
          licenseNumber: 'AYUR-MH-2012-4521',
          experienceYears: 14,
          bio: 'Senior Ayurvedic consultant focusing on joint rejuvenation, detoxification therapies, and stress management.',
          consultationFee: 900.0,
          languages: ['English', 'Hindi', 'Marathi'],
          isVerified: true,
          averageRating: 4.8,
          totalReviews: 95,
        },
      },
    },
    include: { doctor: true },
  });
  console.log(`Created Doctor 2: ${doctor2User.email}`);

  // 6. Generate Availability Slots for Doctor 1
  if (doctor1User.doctor) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const slotData = [];

    for (let i = 0; i < 6; i++) {
      const start = new Date(
        tomorrow.getTime() + i * 45 * 60 * 1000
      );
      const end = new Date(
        start.getTime() + 30 * 60 * 1000
      );

      slotData.push({
        doctorId: doctor1User.doctor.id,
        startTime: start,
        endTime: end,
        status: SlotStatus.AVAILABLE,
      });
    }

    await prisma.availabilitySlot.createMany({
      data: slotData,
    });

    console.log(
      `Created ${slotData.length} availability slots for Dr. Priya Nair`
    );
  }

  // 7. Generate Availability Slots for Doctor 2
  if (doctor2User.doctor) {
    const slotDay = new Date();

    slotDay.setDate(slotDay.getDate() + 2);
    slotDay.setHours(14, 0, 0, 0);

    const slotData = [];

    for (let i = 0; i < 4; i++) {
      const start = new Date(
        slotDay.getTime() + i * 45 * 60 * 1000
      );
      const end = new Date(
        start.getTime() + 30 * 60 * 1000
      );

      slotData.push({
        doctorId: doctor2User.doctor.id,
        startTime: start,
        endTime: end,
        status: SlotStatus.AVAILABLE,
      });
    }

    await prisma.availabilitySlot.createMany({
      data: slotData,
    });

    console.log(
      `Created ${slotData.length} availability slots for Dr. Anand Vaidya`
    );
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });