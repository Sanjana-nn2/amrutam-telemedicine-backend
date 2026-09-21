import {
  createDoctorSchema,
  updateDoctorSchema,
  verifyDoctorSchema,
  doctorSearchQuerySchema,
} from '../../src/modules/doctors/doctor.schema';
import {
  createSlotsSchema,
  doctorSlotsQuerySchema,
} from '../../src/modules/availability/availability.schema';

describe('Phase 3 Validation Schemas', () => {
  describe('Doctor Schemas', () => {
    it('should validate complete valid doctor creation payload', async () => {
      const validDoc = {
        specialization: 'Ayurveda & Panchakarma',
        licenseNumber: 'AYUR-MH-2024-9912',
        experienceYears: 10,
        consultationFee: 850,
        languages: ['English', 'Hindi', 'Marathi'],
        bio: 'Senior Ayurvedic physician with 10 years clinical experience.',
      };

      const parsed = await createDoctorSchema.parseAsync(validDoc);
      expect(parsed.specialization).toBe('Ayurveda & Panchakarma');
      expect(parsed.consultationFee).toBe(850);
      expect(parsed.languages).toHaveLength(3);
    });

    it('should reject invalid or negative consultation fees', async () => {
      const negativeFee = {
        specialization: 'Ayurveda',
        licenseNumber: 'AYUR-9999',
        experienceYears: 5,
        consultationFee: -100,
        languages: ['English'],
      };

      await expect(createDoctorSchema.parseAsync(negativeFee)).rejects.toThrow(
        'Consultation fee must be greater than zero'
      );
    });

    it('should reject unrealistic experience years', async () => {
      const badExp = {
        specialization: 'Ayurveda',
        licenseNumber: 'AYUR-9999',
        experienceYears: 85,
        consultationFee: 500,
        languages: ['English'],
      };

      await expect(createDoctorSchema.parseAsync(badExp)).rejects.toThrow();
    });

    it('should reject empty languages list', async () => {
      const emptyLang = {
        specialization: 'Ayurveda',
        licenseNumber: 'AYUR-9999',
        experienceYears: 5,
        consultationFee: 500,
        languages: [],
      };

      await expect(createDoctorSchema.parseAsync(emptyLang)).rejects.toThrow(
        'At least one language must be specified'
      );
    });

    it('should validate doctor search query parameters with defaults', async () => {
      const query = {
        specialization: 'Kayachikitsa',
        minFee: '500',
        maxFee: '2000',
        minRating: '4.5',
        page: '2',
        limit: '20',
        sortBy: 'fee_asc',
      };

      const parsed = await doctorSearchQuerySchema.parseAsync(query);
      expect(parsed.specialization).toBe('Kayachikitsa');
      expect(parsed.minFee).toBe(500);
      expect(parsed.maxFee).toBe(2000);
      expect(parsed.minRating).toBe(4.5);
      expect(parsed.page).toBe(2);
      expect(parsed.limit).toBe(20);
      expect(parsed.sortBy).toBe('fee_asc');
    });

    it('should reject invalid rating (> 5) in search query', async () => {
      await expect(
        doctorSearchQuerySchema.parseAsync({ minRating: '6' })
      ).rejects.toThrow('minRating must be between 0 and 5');
    });

    it('should enforce limit protection in doctor search (max 50)', async () => {
      await expect(
        doctorSearchQuerySchema.parseAsync({ limit: '100' })
      ).rejects.toThrow('limit must be between 1 and 50');
    });

    it('should require boolean isVerified in verifyDoctorSchema', async () => {
      const valid = await verifyDoctorSchema.parseAsync({ isVerified: true });
      expect(valid.isVerified).toBe(true);

      await expect(verifyDoctorSchema.parseAsync({ isVerified: 'not-a-bool' })).rejects.toThrow();
    });
  });

  describe('Availability Slot Schemas & Overlap Verification', () => {
    const futureDate1 = new Date(Date.now() + 24 * 60 * 60 * 1000); // +24h
    const futureDate2 = new Date(Date.now() + 25 * 60 * 60 * 1000); // +25h
    const futureDate3 = new Date(Date.now() + 26 * 60 * 60 * 1000); // +26h
    const futureDate4 = new Date(Date.now() + 27 * 60 * 60 * 1000); // +27h

    it('should accept non-overlapping valid future slots batch', async () => {
      const batch = {
        slots: [
          {
            startTime: futureDate1.toISOString(),
            endTime: futureDate2.toISOString(),
          },
          {
            startTime: futureDate3.toISOString(),
            endTime: futureDate4.toISOString(),
          },
        ],
      };

      const parsed = await createSlotsSchema.parseAsync(batch);
      expect(parsed.slots).toHaveLength(2);
    });

    it('should reject slots where endTime is before or equal to startTime', async () => {
      const invalidTime = {
        slots: [
          {
            startTime: futureDate2.toISOString(),
            endTime: futureDate1.toISOString(), // end before start
          },
        ],
      };

      await expect(createSlotsSchema.parseAsync(invalidTime)).rejects.toThrow(
        'endTime must be strictly after startTime'
      );
    });

    it('should reject past slots', async () => {
      const pastTime = {
        slots: [
          {
            startTime: new Date(Date.now() - 3600000).toISOString(),
            endTime: new Date(Date.now() + 3600000).toISOString(),
          },
        ],
      };

      await expect(createSlotsSchema.parseAsync(pastTime)).rejects.toThrow(
        'startTime cannot be in the past'
      );
    });

    it('should reject slots with duration less than 15 minutes', async () => {
      const tooShort = {
        slots: [
          {
            startTime: futureDate1.toISOString(),
            endTime: new Date(futureDate1.getTime() + 10 * 60 * 1000).toISOString(), // 10 mins
          },
        ],
      };

      await expect(createSlotsSchema.parseAsync(tooShort)).rejects.toThrow(
        'Slot duration must be between 15 minutes and 4 hours'
      );
    });

    it('should reject identical/duplicate slots within batch', async () => {
      const duplicateBatch = {
        slots: [
          {
            startTime: futureDate1.toISOString(),
            endTime: futureDate2.toISOString(),
          },
          {
            startTime: futureDate1.toISOString(),
            endTime: futureDate2.toISOString(),
          },
        ],
      };

      await expect(createSlotsSchema.parseAsync(duplicateBatch)).rejects.toThrow(
        'Slots within the submitted batch contain overlapping or duplicate intervals'
      );
    });

    it('should reject OVERLAPPING intervals within batch (start < nextEnd AND end > nextStart)', async () => {
      // Slot 1: [T+24h to T+26h]
      // Slot 2: [T+25h to T+27h] -> OVERLAPS with Slot 1 between T+25h and T+26h
      const overlappingBatch = {
        slots: [
          {
            startTime: futureDate1.toISOString(),
            endTime: futureDate3.toISOString(),
          },
          {
            startTime: futureDate2.toISOString(),
            endTime: futureDate4.toISOString(),
          },
        ],
      };

      await expect(createSlotsSchema.parseAsync(overlappingBatch)).rejects.toThrow(
        'Slots within the submitted batch contain overlapping or duplicate intervals'
      );
    });

    it('should validate doctor slots query with date filters and pagination', async () => {
      const query = {
        startDate: futureDate1.toISOString(),
        endDate: futureDate4.toISOString(),
        page: '1',
        limit: '25',
      };

      const parsed = await doctorSlotsQuerySchema.parseAsync(query);
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(25);
    });
  });
});
