import {
  OnboardingFieldType,
  OnboardingItemOwner,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { prisma } from './prisma';

export const ONBOARDING_TEMPLATE_NAME = 'BISU New Hire Onboarding';
export const ONBOARDING_TEMPLATE_VERSION = 1;

type TemplateItem = {
  category: string;
  label: string;
  owner: OnboardingItemOwner;
  fieldType?: OnboardingFieldType;
  fieldKey?: string;
  required?: boolean;
  description?: string;
};

export const ONBOARDING_TEMPLATE_ITEMS: TemplateItem[] = [
  { category: 'New Hire Information', label: 'First Name', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'firstName' },
  { category: 'New Hire Information', label: 'Last Name', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'lastName' },
  { category: 'New Hire Information', label: 'Preferred First Name', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'preferredFirstName', required: false },
  { category: 'New Hire Information', label: 'Date of Birth', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.DATE, fieldKey: 'dateOfBirth' },
  { category: 'New Hire Information', label: 'Mobile Phone', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'mobilePhone' },
  { category: 'New Hire Information', label: 'Personal Email Address', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'personalEmail' },
  { category: 'New Hire Information', label: 'Home Address', owner: OnboardingItemOwner.NEW_HIRE, fieldType: OnboardingFieldType.TEXT, fieldKey: 'homeAddress' },
  { category: 'New Hire Information', label: 'Offer Date', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.DATE, fieldKey: 'offerDate' },
  { category: 'New Hire Information', label: 'Start Date', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.DATE, fieldKey: 'startDate' },
  { category: 'New Hire Information', label: 'Job Title', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.TEXT, fieldKey: 'jobTitle' },
  { category: 'New Hire Information', label: 'Manager', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.TEXT, fieldKey: 'managerName' },
  { category: 'New Hire Information', label: 'Base Pay', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.TEXT, fieldKey: 'basePay' },
  { category: 'New Hire Information', label: 'Compensation Plan', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.TEXT, fieldKey: 'compensationPlan' },
  { category: 'New Hire Information', label: 'Location (Remote, LV, or CA)', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.SELECT, fieldKey: 'location' },
  { category: 'New Hire Information', label: 'Department', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.TEXT, fieldKey: 'department' },
  { category: 'Offer Package', label: 'Draft & Execution of documents', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.FILE },
  { category: 'HR Documents', label: 'Draft & Execution of documents', owner: OnboardingItemOwner.MANAGEMENT, fieldType: OnboardingFieldType.FILE },
  { category: 'Gusto Profile Creation', label: 'Data Input', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Seat#', owner: OnboardingItemOwner.INTERNAL, fieldType: OnboardingFieldType.TEXT },
  { category: 'Employee Setup', label: 'Work Email', owner: OnboardingItemOwner.INTERNAL, fieldType: OnboardingFieldType.TEXT },
  { category: 'Employee Setup', label: 'Work Phone Number', owner: OnboardingItemOwner.INTERNAL, fieldType: OnboardingFieldType.TEXT },
  { category: 'Employee Setup', label: 'Security Group', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Sales Shared Drive', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Shared Folders', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Email Groups / Distribution Lists', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Lender Credentials (Multiple)', owner: OnboardingItemOwner.INTERNAL },
  { category: 'Employee Setup', label: 'Other Details', owner: OnboardingItemOwner.INTERNAL, required: false },
  ...[
    'Desktop Computer',
    'Laptop Computer',
    'Wireless Headphones',
    'Desktop Speakers',
    'Webcam',
    'Wireless Keyboard',
    'Wireless Mouse',
    'Desk Phone',
    'Laptop Docking Station',
    'MFP Printer',
  ].map((label) => ({ category: 'Equipment', label, owner: OnboardingItemOwner.INTERNAL, required: false })),
  ...[
    'Microsoft 365',
    'Microsoft Office',
    'Microsoft Teams',
    'Adobe Acrobat Reader',
    'Arive',
    'Five9',
    'Bonzo',
    'Bisu Portal',
    'Jarodesk Credentials',
    'Xactus Credentials',
    'Lender Portal Logins',
    'Other Software (DocuSign)',
  ].map((label) => ({
    category: 'Software',
    label,
    owner: OnboardingItemOwner.INTERNAL,
    required: label === 'Bisu Portal',
    description: label === 'Arive'
      ? 'Capture full name, internal and external title, email, retail loan officer or broker designation, and NMLS when applicable.'
      : undefined,
  })),
  ...['Lending Tree', 'Lead Point', 'Free Rate Update'].map((label) => ({
    category: 'Marketing Account',
    label,
    owner: OnboardingItemOwner.INTERNAL,
    required: false,
  })),
  { category: 'Website', label: 'Add profile & Pic', owner: OnboardingItemOwner.INTERNAL, required: false },
  { category: 'Licensing', label: 'Sponsorship Request', owner: OnboardingItemOwner.INTERNAL, required: false },
];

type PrismaLike = PrismaClient | Prisma.TransactionClient;

export async function ensureOnboardingTemplate(client: PrismaLike = prisma) {
  const template = await client.onboardingTemplate.upsert({
    where: {
      name_version: {
        name: ONBOARDING_TEMPLATE_NAME,
        version: ONBOARDING_TEMPLATE_VERSION,
      },
    },
    update: { active: true },
    create: {
      name: ONBOARDING_TEMPLATE_NAME,
      version: ONBOARDING_TEMPLATE_VERSION,
    },
  });

  const itemCount = await client.onboardingTemplateItem.count({
    where: { templateId: template.id },
  });
  if (itemCount === 0) {
    await client.onboardingTemplateItem.createMany({
      data: ONBOARDING_TEMPLATE_ITEMS.map((item, index) => ({
        templateId: template.id,
        category: item.category,
        label: item.label,
        description: item.description,
        owner: item.owner,
        fieldType: item.fieldType ?? OnboardingFieldType.CHECKBOX,
        fieldKey: item.fieldKey,
        required: item.required ?? true,
        sortOrder: index + 1,
        options: item.fieldKey === 'location' ? ['Remote', 'LV', 'CA'] : undefined,
      })),
    });
  }

  return client.onboardingTemplate.findUniqueOrThrow({
    where: { id: template.id },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}
