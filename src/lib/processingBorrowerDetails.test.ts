import { describe, expect, it } from 'vitest';
import {
  isSensitivePaymentKey,
  normalizeProcessingProperty,
  readSubmissionNotes,
  readSubmissionString,
  sanitizeProcessingSubmissionData,
  validateProcessingBorrowerContact,
} from './processingBorrowerDetails';

describe('processing borrower detail helpers', () => {
  it('reads the first useful historical submission fallback', () => {
    expect(
      readSubmissionString(
        { propertyAddress: '', subjectPropertyAddress: '123 Main St' },
        'propertyAddress',
        'subjectPropertyAddress',
      ),
    ).toBe('123 Main St');
  });

  it('redacts payment credentials recursively', () => {
    expect(isSensitivePaymentKey('creditCardNumber')).toBe(true);
    expect(isSensitivePaymentKey('card_cvc')).toBe(true);
    expect(
      sanitizeProcessingSubmissionData({
        borrowerEmail: 'borrower@example.com',
        creditCardNumber: '4111111111111111',
        nested: { cvc: '123', appraisalNotes: 'Rush order' },
      }),
    ).toEqual({
      borrowerEmail: 'borrower@example.com',
      nested: { appraisalNotes: 'Rush order' },
    });
  });

  it('normalizes submission notes for the activity timeline', () => {
    expect(
      readSubmissionNotes({
        notesHistory: [
          {
            author: 'Loan Officer',
            role: 'LOAN_OFFICER',
            message: 'Initial submission note',
            date: '2026-08-17T12:00:00.000Z',
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        author: 'Loan Officer',
        message: 'Initial submission note',
      }),
    ]);
  });

  it('normalizes complete processing property details', () => {
    expect(
      normalizeProcessingProperty({
        street: ' 123 Main St ',
        unit: 'Unit 4',
        city: 'Orlando',
        state: 'fl',
        zip: '32801',
      }),
    ).toEqual({
      success: true,
      street: '123 Main St',
      unit: 'Unit 4',
      city: 'Orlando',
      state: 'FL',
      zip: '32801',
      address: '123 Main St Unit 4, Orlando, FL 32801',
    });
    expect(
      normalizeProcessingProperty({
        street: '',
        city: 'Orlando',
        state: 'FL',
        zip: '32801',
      }).success,
    ).toBe(false);
  });

  it('accepts and formats an unhyphenated 9-digit ZIP+4', () => {
    expect(
      normalizeProcessingProperty({
        street: '123 Main St',
        city: 'Orlando',
        state: 'FL',
        zip: '328011234',
      }),
    ).toEqual({
      success: true,
      street: '123 Main St',
      unit: '',
      city: 'Orlando',
      state: 'FL',
      zip: '32801-1234',
      address: '123 Main St, Orlando, FL 32801-1234',
    });
  });

  it('returns a ZIP-specific error for an invalid ZIP', () => {
    expect(
      normalizeProcessingProperty({
        street: '123 Main St',
        city: 'Orlando',
        state: 'FL',
        zip: '3280',
      }),
    ).toEqual({
      success: false,
      error: 'Subject Property ZIP must be 5 digits or a 9-digit ZIP+4.',
    });
  });

  it('requires a valid borrower contact email', () => {
    expect(
      validateProcessingBorrowerContact({
        phone: '407-555-0100',
        email: 'borrower@example.com',
      }),
    ).toEqual({
      success: true,
      phone: '407-555-0100',
      email: 'borrower@example.com',
    });
    expect(
      validateProcessingBorrowerContact({
        phone: '407-555-0100',
        email: 'not-an-email',
      }).success,
    ).toBe(false);
  });
});
