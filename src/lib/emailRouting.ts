import type { EmailSenderCategory } from './email';

export type TaskEmailDesk = 'DISCLOSURE' | 'QC' | 'VA' | 'JR';

export function getTaskEmailSenderCategory(
  desk: TaskEmailDesk
): Extract<EmailSenderCategory, 'disclosures' | 'processing'> {
  return desk === 'DISCLOSURE' || desk === 'QC'
    ? 'disclosures'
    : 'processing';
}
