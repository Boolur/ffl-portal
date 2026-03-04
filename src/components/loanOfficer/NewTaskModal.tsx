'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ClipboardCheck, ShieldCheck, Loader2, FileText, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createSubmissionTask } from '@/app/actions/taskActions';
import { createTaskAttachmentUploadUrl, finalizeTaskAttachment } from '@/app/actions/attachmentActions';
import { TaskAttachmentPurpose } from '@prisma/client';
import { attachClientDocumentsToTask, getClientFolderForLoan, getMyPipelineClients } from '@/app/actions/clientFolderActions';

type NewTaskModalProps = {
  open: boolean;
  onClose: () => void;
  loanOfficerName: string;
  initialType?: SubmissionType;
};

type SubmissionType = 'DISCLOSURES' | 'QC';
type PipelineLoanOption = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  borrowerPhone: string | null;
  borrowerEmail: string | null;
};
type ClientFolderDocOption = { id: string; filename: string; createdAt: Date };

const investorOptions = ['UWM', 'Kind', 'EPM', 'Sun West', 'Button'];
const buttonPricingOptions = [
  'Max Comp',
  'Max Comp 2',
  '3.0% Comp',
  'Default',
  'Buydown 1',
  'Buydown 2',
  'Buydown 3',
];

export function NewTaskModal({ open, onClose, loanOfficerName }: NewTaskModalProps) {
  const type: SubmissionType = 'DISCLOSURES';
  const [showQcComingSoon, setShowQcComingSoon] = useState(false);
  const router = useRouter();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleClose = useCallback(() => {
    setShowQcComingSoon(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={handleClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-3xl bg-white rounded-2xl shadow-xl border border-slate-200 p-6 max-h-[85vh] overflow-hidden flex flex-col"
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">New Task Submission</h2>
            <p className="text-sm text-slate-500 mt-1">
              Choose a submission type and complete the required fields.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="app-icon-btn"
            onClick={handleClose}
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-6 flex gap-3">
          <TypeButton
            active={type === 'DISCLOSURES'}
            icon={ClipboardCheck}
            title="Submit for Disclosures"
            description="Send loan info to the Disclosure Team"
            onClick={() => setShowQcComingSoon(false)}
          />
          <TypeButton
            active={false}
            icon={ShieldCheck}
            title="Submit for QC"
            description="Send loan to Quality Control"
            disabled
            comingSoon
            onClick={() => setShowQcComingSoon(true)}
          />
        </div>

        {showQcComingSoon && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
            Submit for QC is coming soon. It is temporarily disabled.
          </div>
        )}

        <div className="mt-6 overflow-y-auto pr-1">
          {type === 'DISCLOSURES' ? (
            <DisclosuresForm
              loanOfficerName={loanOfficerName}
              onSubmitted={() => {
                handleClose();
                router.refresh();
              }}
            />
          ) : (
            <QcForm
              loanOfficerName={loanOfficerName}
              onSubmitted={() => {
                handleClose();
                router.refresh();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type MismoPrefill = {
  loanOfficer?: string;
  borrowerFirstName?: string;
  borrowerLastName?: string;
  borrowerPhone?: string;
  borrowerEmail?: string;
  arriveLoanNumber?: string;
  channel?: string;
  investor?: string;
  loanType?: string;
  loanProgram?: string;
  loanAmount?: string;
  homeValue?: string;
  employerName?: string;
  employerAddress?: string;
  employerDurationLineOfWork?: string;
  yearBuiltProperty?: string;
  originalCost?: string;
  yearAquired?: string;
  mannerInWhichTitleWillBeHeld?: string;
  incomeProfile?: MismoIncomeProfile;
};

type MismoIncomeProfile = {
  hasAnyIncomeItems: boolean;
  hasEmploymentIncome: boolean;
  hasNonEmploymentIncome: boolean;
  employmentFieldsRequired: boolean;
};

const DEFAULT_MISMO_INCOME_PROFILE: MismoIncomeProfile = {
  hasAnyIncomeItems: false,
  hasEmploymentIncome: false,
  hasNonEmploymentIncome: false,
  employmentFieldsRequired: true,
};

function isMismoValidationErrorMessage(message: string) {
  const trimmed = message.trim();
  return (
    trimmed.startsWith('MISMO is missing required fields:') ||
    trimmed.startsWith('Borrower Phone and Borrower Email are required from MISMO')
  );
}

function parseMismoXml(xmlText: string, sourceFilename?: string): MismoPrefill {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML');
  }

  const isGuidLike = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim()
    );
  const extractLoanNumberFromFilename = (filename?: string) => {
    if (!filename) return '';
    const stem = filename.replace(/\.[^/.]+$/, '');
    const allNumericRuns = stem.match(/\d{6,}/g);
    if (!allNumericRuns || allNumericRuns.length === 0) return '';
    // Prefer the longest numeric token; if tied, use the last occurrence.
    return allNumericRuns.sort((a, b) => b.length - a.length).at(0) || '';
  };

  const getText = (parent: Element | Document | null, localName: string) => {
    if (!parent) return '';
    const el = parent.getElementsByTagNameNS('*', localName)[0];
    return el?.textContent?.trim() ?? '';
  };

  const getTextFromElement = (el: Element | null, localName: string) => {
    if (!el) return '';
    const node = el.getElementsByTagNameNS('*', localName)[0];
    return node?.textContent?.trim() ?? '';
  };

  const getFirstText = (parent: Element | Document | null, localNames: string[]) => {
    for (const localName of localNames) {
      const value = getText(parent, localName);
      if (value) return value;
    }
    return '';
  };

  const parseBooleanText = (value: string) => {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return null;
  };

  const findPartyByRole = (roleType: string) => {
    const parties = Array.from(doc.getElementsByTagNameNS('*', 'PARTY'));
    for (const party of parties) {
      const roleTypes = Array.from(party.getElementsByTagNameNS('*', 'PartyRoleType')).map(
        (n) => n.textContent?.trim()
      );
      if (roleTypes.includes(roleType)) return party;
    }
    return null;
  };

  const findPartiesByRole = (roleType: string) => {
    const parties = Array.from(doc.getElementsByTagNameNS('*', 'PARTY'));
    return parties.filter((party) => {
      const roleTypes = Array.from(party.getElementsByTagNameNS('*', 'PartyRoleType')).map((n) =>
        n.textContent?.trim()
      );
      return roleTypes.includes(roleType);
    });
  };

  const borrowerParties = findPartiesByRole('Borrower');
  const borrowerParty = borrowerParties[0] ?? null;
  const loanOriginatorParty = findPartyByRole('LoanOriginator');
  const employerParty = findPartyByRole('Employer');
  const primaryEmployer =
    doc.getElementsByTagNameNS('*', 'EMPLOYER')[0] ?? null;
  const primaryEmployment =
    doc.getElementsByTagNameNS('*', 'EMPLOYMENT')[0] ?? null;

  const nonEmploymentIncomeTypes = new Set([
    'ALIMONY',
    'ANNUITY',
    'CHILDSUPPORT',
    'DISABILITY',
    'INTERESTANDDIVIDENDS',
    'MILITARYENTITLEMENT',
    'MORTGAGECREDITCERTIFICATE',
    'NOTESRECEIVABLE',
    'PENSION',
    'PUBLICASSISTANCE',
    'RETIREMENT',
    'ROYALTYPAYMENTS',
    'SOCIALSECURITY',
    'TRUST',
    'UNEMPLOYMENT',
    'VABENEFITSNONEDUCATIONAL',
    'VABENEFITSEDUCATIONAL',
  ]);

  const employmentIncomeTypes = new Set([
    'BASE',
    'BONUS',
    'COMMISSION',
    'EMPLOYMENT',
    'MILITARYBASEPAY',
    'OTHER',
    'OVERTIME',
    'SELFEMPLOYED',
    'TIPINCOME',
    'WAGES',
  ]);

  let incomeItemCount = 0;
  let hasEmploymentIncome = false;
  let hasNonEmploymentIncome = false;
  for (const party of borrowerParties) {
    const incomeDetails = Array.from(
      party.getElementsByTagNameNS('*', 'CURRENT_INCOME_ITEM_DETAIL')
    );
    for (const detail of incomeDetails) {
      incomeItemCount += 1;
      const employmentIndicator = parseBooleanText(
        getTextFromElement(detail, 'EmploymentIncomeIndicator')
      );
      const incomeType = getTextFromElement(detail, 'IncomeType');
      const incomeTypeNormalized = incomeType.trim().toUpperCase();

      let isEmploymentIncome = true;
      if (employmentIndicator === true) {
        isEmploymentIncome = true;
      } else if (employmentIndicator === false) {
        isEmploymentIncome = false;
      } else if (incomeTypeNormalized && nonEmploymentIncomeTypes.has(incomeTypeNormalized)) {
        isEmploymentIncome = false;
      } else if (incomeTypeNormalized && employmentIncomeTypes.has(incomeTypeNormalized)) {
        isEmploymentIncome = true;
      }

      if (isEmploymentIncome) {
        hasEmploymentIncome = true;
      } else {
        hasNonEmploymentIncome = true;
      }
    }
  }
  const hasAnyIncomeItems = incomeItemCount > 0;
  const incomeProfile: MismoIncomeProfile = {
    hasAnyIncomeItems,
    hasEmploymentIncome,
    hasNonEmploymentIncome,
    // Fail-safe: if income is unavailable/ambiguous, keep employer fields required.
    employmentFieldsRequired: hasAnyIncomeItems ? hasEmploymentIncome : true,
  };

  const borrowerFirstName = getTextFromElement(borrowerParty, 'FirstName');
  const borrowerLastName = getTextFromElement(borrowerParty, 'LastName');
  const borrowerPhone =
    getFirstText(borrowerParty, [
      'ContactPointTelephoneValue',
      'TelephoneNumber',
      'PhoneNumber',
      'PhoneNumberValue',
      'BorrowerHomeTelephoneNumber',
    ]) ||
    getFirstText(doc, [
      'ContactPointTelephoneValue',
      'TelephoneNumber',
      'PhoneNumber',
      'PhoneNumberValue',
      'BorrowerHomeTelephoneNumber',
    ]);
  const borrowerEmail =
    getFirstText(borrowerParty, [
      'ContactPointEmailValue',
      'EmailAddressText',
      'Email',
      'BorrowerEmailAddress',
    ]) ||
    getFirstText(doc, [
      'ContactPointEmailValue',
      'EmailAddressText',
      'Email',
      'BorrowerEmailAddress',
    ]);
  const loanOfficer = getTextFromElement(loanOriginatorParty, 'FullName') ||
    [getTextFromElement(loanOriginatorParty, 'FirstName'), getTextFromElement(loanOriginatorParty, 'LastName')].filter(Boolean).join(' ');

  const loanIdentifiers = Array.from(doc.getElementsByTagNameNS('*', 'LOAN_IDENTIFIER'));
  let arriveLoanNumber = '';
  const identifierCandidates: string[] = [];
  for (const id of loanIdentifiers) {
    const type = getTextFromElement(id, 'LoanIdentifierType');
    const identifier = getTextFromElement(id, 'LoanIdentifier');
    if (identifier) identifierCandidates.push(identifier);
    if (type === 'LenderLoan') {
      arriveLoanNumber = identifier;
      break;
    }
  }
  if (!arriveLoanNumber) {
    // Prefer a non-GUID candidate when no explicit LenderLoan identifier exists.
    arriveLoanNumber =
      identifierCandidates.find((value) => value && !isGuidLike(value)) || '';
  }
  if (!arriveLoanNumber) {
    arriveLoanNumber = getFirstText(doc, [
      'LoanNumber',
      'MortgageLoanNumber',
      'LenderLoanNumber',
      'AgencyCaseIdentifier',
    ]);
  }
  const filenameLoanNumber = extractLoanNumberFromFilename(sourceFilename);
  if ((!arriveLoanNumber || isGuidLike(arriveLoanNumber)) && filenameLoanNumber) {
    // Last-resort fallback for exports where XML stores only opaque GUID identifiers.
    arriveLoanNumber = filenameLoanNumber;
  }

  const loanOriginatorType = getText(doc, 'LoanOriginatorType');
  const channel = loanOriginatorType === 'Broker' || loanOriginatorType === 'Correspondent'
    ? loanOriginatorType
    : '';

  const investor = getText(doc, 'ProductProviderName');

  const mortgageType = getText(doc, 'MortgageType');
  const loanType =
    ['Conventional', 'FHA', 'VA'].includes(mortgageType) ? mortgageType : '';

  const loanProgram = '';
  const loanAmount =
    getText(doc, 'BaseLoanAmount') || getText(doc, 'NoteAmount');
  const homeValue =
    getText(doc, 'PropertyEstimatedValueAmount') ||
    getText(doc, 'EstimatedValueAmount');

  const employerName =
    getFirstText(primaryEmployment, ['EmployerName', 'LegalEntityName']) ||
    getFirstText(primaryEmployer, [
      'EmployerName',
      'LegalEntityName',
      'FullName',
      'Name',
    ]) ||
    getFirstText(employerParty, ['FullName', 'Name']);
  const employerAddressParts = [
    getFirstText(primaryEmployer, ['AddressLineText']),
    getFirstText(primaryEmployer, ['CityName']),
    getFirstText(primaryEmployer, ['StateCode']),
    getFirstText(primaryEmployer, ['PostalCode']),
    getFirstText(primaryEmployment, ['AddressLineText']),
    getFirstText(primaryEmployment, ['CityName']),
    getFirstText(primaryEmployment, ['StateCode']),
    getFirstText(primaryEmployment, ['PostalCode']),
  ].filter(Boolean);
  const employerAddress =
    employerAddressParts.join(', ') ||
    getFirstText(employerParty, ['AddressLineText']) ||
    getFirstText(doc, ['EmployerAddress']);
  const employerDurationLineOfWork = getFirstText(doc, [
    'EmploymentTimeInLineOfWorkMonthsCount',
    'EmploymentMonthsOnJobCount',
    'EmploymentMonthsInCurrentJobCount',
    'BorrowerTotalYearsInLineOfWorkCount',
  ]);
  const yearBuiltProperty = getFirstText(doc, [
    'PropertyStructureBuiltYear',
    'BuiltYear',
    'YearBuilt',
  ]);
  const originalCost = getFirstText(doc, [
    'PropertyOriginalCostAmount',
    'OriginalCostAmount',
    'OriginalPurchasePriceAmount',
    'PurchasePriceAmount',
  ]);
  const yearAquired = getFirstText(doc, [
    'PropertyAcquiredYear',
    'AcquiredYear',
    'PropertyPurchaseYear',
  ]);
  const mannerInWhichTitleWillBeHeld = getFirstText(doc, [
    'EstateHeldInNameType',
    'MannerOfTitleHeldType',
    'TitleHeldDescription',
    'PropertyEstateType',
  ]);

  return {
    loanOfficer,
    borrowerFirstName,
    borrowerLastName,
    borrowerPhone,
    borrowerEmail,
    arriveLoanNumber,
    channel,
    investor,
    loanType,
    loanProgram,
    loanAmount,
    homeValue,
    employerName,
    employerAddress,
    employerDurationLineOfWork,
    yearBuiltProperty,
    originalCost,
    yearAquired,
    mannerInWhichTitleWillBeHeld,
    incomeProfile,
  };
}

function TypeButton({
  active,
  icon: Icon,
  title,
  description,
  disabled = false,
  comingSoon = false,
  onClick,
}: {
  active: boolean;
  icon: React.ElementType;
  title: string;
  description: string;
  disabled?: boolean;
  comingSoon?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={comingSoon ? `${title} is coming soon.` : undefined}
      className={`flex-1 text-left p-4 rounded-xl border transition-all ${
        disabled
          ? 'border-slate-200 bg-slate-50 text-slate-500 cursor-not-allowed'
          : active
          ? 'border-blue-500 bg-blue-50 shadow-sm'
          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            disabled
              ? 'bg-slate-200 text-slate-500'
              : active
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <p className={`font-semibold ${disabled ? 'text-slate-600' : 'text-slate-900'}`}>
              {title}
            </p>
            {comingSoon && (
              <span className="inline-flex items-center rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                Coming Soon
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{description}</p>
        </div>
      </div>
    </button>
  );
}

function DisclosuresForm({
  loanOfficerName,
  onSubmitted,
}: {
  loanOfficerName: string;
  onSubmitted: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [disclosureStep, setDisclosureStep] = useState<1 | 2>(1);
  const [isParsingMismo, setIsParsingMismo] = useState(false);
  const [mismoFilename, setMismoFilename] = useState('');
  const [form, setForm] = useState({
    qualificationStatus: '',
    loanOfficer: loanOfficerName,
    borrowerFirstName: '',
    borrowerLastName: '',
    borrowerPhone: '',
    borrowerEmail: '',
    arriveLoanNumber: '',
    channel: '',
    investor: '',
    loanType: '',
    loanProgram: '',
    loanAmount: '',
    homeValue: '',
    employerName: '',
    employerAddress: '',
    employerDurationLineOfWork: '',
    yearBuiltProperty: '',
    originalCost: '',
    yearAquired: '',
    mannerInWhichTitleWillBeHeld: '',
    runId: '',
    pricingOption: '',
    aus: '',
    creditReportType: '',
    notes: '',
  });
  const [importError, setImportError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [mismoIncomeProfile, setMismoIncomeProfile] = useState<MismoIncomeProfile>(
    DEFAULT_MISMO_INCOME_PROFILE
  );
  const [overrideEmployerFields, setOverrideEmployerFields] = useState(false);
  const mimoRequiredFieldsRef = useRef<HTMLDivElement | null>(null);
  const [buttonFiles, setButtonFiles] = useState<{
    avm: File | null;
    titleSheet: File | null;
    pricingSheet: File | null;
  }>({
    avm: null,
    titleSheet: null,
    pricingSheet: null,
  });

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const isButtonInvestor = form.investor === 'Button';
  const hasAllButtonAttachments =
    !!buttonFiles.avm && !!buttonFiles.titleSheet && !!buttonFiles.pricingSheet;
  const employerReadonlyFields: ReadonlyArray<{ key: keyof typeof form; label: string }> = [
    { key: 'employerName', label: 'Employer Name' },
    { key: 'employerAddress', label: 'Employer Address' },
    { key: 'employerDurationLineOfWork', label: 'Employer - Duration in Line of Work' },
  ];
  const coreReadonlyFields: ReadonlyArray<{ key: keyof typeof form; label: string }> = [
    { key: 'yearBuiltProperty', label: 'Year Built (Property)' },
    { key: 'originalCost', label: 'Original Cost' },
    { key: 'yearAquired', label: 'Year Aquired' },
    { key: 'mannerInWhichTitleWillBeHeld', label: 'Manner in Which Title Will be Held' },
  ];
  const requiredReadonlyFields: ReadonlyArray<{ key: keyof typeof form; label: string }> = [
    ...(mismoIncomeProfile.employmentFieldsRequired ? employerReadonlyFields : []),
    ...coreReadonlyFields,
  ];
  const missingReadonlyKeys = new Set(
    requiredReadonlyFields
      .filter(({ key }) => !String(form[key] ?? '').trim())
      .map(({ key }) => key)
  );
  const missingReadonlyLabels = requiredReadonlyFields
    .filter(({ key }) => !String(form[key] ?? '').trim())
    .map(({ label }) => label);
  const missingMismoLabels = [
    !form.borrowerPhone.trim() ? 'Borrower Phone' : null,
    !form.borrowerEmail.trim() ? 'Borrower Email' : null,
    ...missingReadonlyLabels,
  ].filter(Boolean) as string[];

  const uploadDisclosureAttachment = async (
    taskId: string,
    file: File,
    labeledFilename: string
  ) => {
    const upload = await createTaskAttachmentUploadUrl({
      taskId,
      purpose: TaskAttachmentPurpose.OTHER,
      filename: labeledFilename,
    });

    if (!upload.success || !upload.signedUrl || !upload.path) {
      throw new Error(upload.error || 'Failed to initialize file upload.');
    }

    const put = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });

    if (!put.ok) {
      throw new Error('Failed to upload file.');
    }

    const saved = await finalizeTaskAttachment({
      taskId,
      purpose: TaskAttachmentPurpose.OTHER,
      storagePath: upload.path,
      filename: labeledFilename,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    });

    if (!saved.success) {
      throw new Error(saved.error || 'Failed to save uploaded file.');
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError('');

    if (!form.notes.trim()) {
      setSubmitError('Notes / Special Instructions is required before submitting.');
      return;
    }

    if (form.qualificationStatus !== 'Yes') {
      setSubmitError('Qualification Status must be set to Yes before submitting.');
      return;
    }

    if (!form.borrowerPhone.trim() || !form.borrowerEmail.trim()) {
      const phoneEmailError =
        'Borrower Phone and Borrower Email are required from MISMO before submitting.';
      setSubmitError(phoneEmailError);
      mimoRequiredFieldsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.alert(
        `${phoneEmailError} Please complete the missing items in Arrive, export a new MISMO 3.4 file, and re-upload it.`
      );
      return;
    }

    if (missingReadonlyLabels.length > 0) {
      const missingReadonlyError = `MISMO is missing required fields: ${missingReadonlyLabels.join(
        ', '
      )}.`;
      setSubmitError(
        `${missingReadonlyError} Please complete them in Arrive before exporting MISMO 3.4.`
      );
      mimoRequiredFieldsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.alert(
        `${missingReadonlyError} Please complete these items in Arrive, export a fresh MISMO 3.4 file, and re-upload it.`
      );
      return;
    }

    if (isButtonInvestor) {
      if (!form.runId.trim() || !form.pricingOption.trim()) {
        setSubmitError('Run ID and Pricing Option are required for Button.');
        return;
      }
      if (!hasAllButtonAttachments) {
        setSubmitError(
          'Attach AVM, Title Sheet, and Pricing Sheet for Button submissions.'
        );
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await createSubmissionTask({
        submissionType: 'DISCLOSURES',
        loanOfficerName: form.loanOfficer,
        borrowerFirstName: form.borrowerFirstName,
        borrowerLastName: form.borrowerLastName,
        borrowerPhone: form.borrowerPhone,
        borrowerEmail: form.borrowerEmail,
        arriveLoanNumber: form.arriveLoanNumber,
        loanAmount: form.loanAmount,
        notes: form.notes,
        submissionData: form,
      });

      if (res.success) {
        if (isButtonInvestor && res.taskId) {
          if (!buttonFiles.avm || !buttonFiles.titleSheet || !buttonFiles.pricingSheet) {
            throw new Error('Missing required Button attachment(s).');
          }
          await uploadDisclosureAttachment(
            res.taskId,
            buttonFiles.avm,
            `Attach AVM - ${buttonFiles.avm.name}`
          );
          await uploadDisclosureAttachment(
            res.taskId,
            buttonFiles.titleSheet,
            `Attach Title Sheet - ${buttonFiles.titleSheet.name}`
          );
          await uploadDisclosureAttachment(
            res.taskId,
            buttonFiles.pricingSheet,
            `Attach Pricing Sheet - ${buttonFiles.pricingSheet.name}`
          );
        }
        onSubmitted();
      } else {
        setSubmitError(res.error || 'Could not submit this disclosure request.');
        setIsSubmitting(false);
      }
    } catch {
      setSubmitError('Could not submit this disclosure request.');
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    setIsParsingMismo(true);
    try {
      const text = await file.text();
      const prefill = parseMismoXml(text, file.name);
      const parsedIncomeProfile = prefill.incomeProfile || DEFAULT_MISMO_INCOME_PROFILE;
      const readonlyFieldsForThisImport: ReadonlyArray<{ key: keyof typeof form; label: string }> =
        [
          ...(parsedIncomeProfile.employmentFieldsRequired ? employerReadonlyFields : []),
          ...coreReadonlyFields,
        ];
      setImportError('');
      setSubmitError('');
      setMismoFilename(file.name);
      setOverrideEmployerFields(false);
      setMismoIncomeProfile(parsedIncomeProfile);
      setForm((prev) => ({
        ...prev,
        loanOfficer: prefill.loanOfficer || prev.loanOfficer,
        borrowerFirstName: prefill.borrowerFirstName || prev.borrowerFirstName,
        borrowerLastName: prefill.borrowerLastName || prev.borrowerLastName,
        borrowerPhone: prefill.borrowerPhone || prev.borrowerPhone,
        borrowerEmail: prefill.borrowerEmail || prev.borrowerEmail,
        arriveLoanNumber: prefill.arriveLoanNumber || prev.arriveLoanNumber,
        channel: prefill.channel || prev.channel,
        investor: prefill.investor || prev.investor,
        loanType: prefill.loanType || prev.loanType,
        loanProgram: prefill.loanProgram || prev.loanProgram,
        loanAmount: prefill.loanAmount || prev.loanAmount,
        homeValue: prefill.homeValue || prev.homeValue,
        employerName: prefill.employerName || prev.employerName,
        employerAddress: prefill.employerAddress || prev.employerAddress,
        employerDurationLineOfWork:
          prefill.employerDurationLineOfWork || prev.employerDurationLineOfWork,
        yearBuiltProperty: prefill.yearBuiltProperty || prev.yearBuiltProperty,
        originalCost: prefill.originalCost || prev.originalCost,
        yearAquired: prefill.yearAquired || prev.yearAquired,
        mannerInWhichTitleWillBeHeld:
          prefill.mannerInWhichTitleWillBeHeld || prev.mannerInWhichTitleWillBeHeld,
      }));
      const merged = {
        ...form,
        borrowerPhone: prefill.borrowerPhone || form.borrowerPhone,
        borrowerEmail: prefill.borrowerEmail || form.borrowerEmail,
        employerName: prefill.employerName || form.employerName,
        employerAddress: prefill.employerAddress || form.employerAddress,
        employerDurationLineOfWork:
          prefill.employerDurationLineOfWork || form.employerDurationLineOfWork,
        yearBuiltProperty: prefill.yearBuiltProperty || form.yearBuiltProperty,
        originalCost: prefill.originalCost || form.originalCost,
        yearAquired: prefill.yearAquired || form.yearAquired,
        mannerInWhichTitleWillBeHeld:
          prefill.mannerInWhichTitleWillBeHeld || form.mannerInWhichTitleWillBeHeld,
      };
      const missingFromMismo = [
        !String(merged.borrowerPhone ?? '').trim() ? 'Borrower Phone' : null,
        !String(merged.borrowerEmail ?? '').trim() ? 'Borrower Email' : null,
        ...readonlyFieldsForThisImport
          .filter(({ key }) => !String(merged[key] ?? '').trim())
          .map(({ label }) => label),
      ].filter(Boolean) as string[];
      if (missingFromMismo.length > 0) {
        const warningMessage = `MISMO is missing required fields: ${missingFromMismo.join(
          ', '
        )}. Please complete these in Arrive, export a new MISMO 3.4 file, and re-upload.`;
        setSubmitError(warningMessage);
        window.alert(warningMessage);
      }
      setDisclosureStep(2);
    } catch {
      setImportError('Could not read this MISMO file. Please verify the XML export.');
      setOverrideEmployerFields(false);
      setMismoIncomeProfile(DEFAULT_MISMO_INCOME_PROFILE);
      setDisclosureStep(1);
    } finally {
      setIsParsingMismo(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {disclosureStep === 1 ? (
        <DisclosureMismoStep
          onFileSelected={handleFileUpload}
          isParsing={isParsingMismo}
          importError={importError}
        />
      ) : (
        <>
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Step 1 Complete
                </p>
                <p className="text-sm font-semibold text-slate-900">
                  MISMO 3.4 uploaded: {mismoFilename || 'Imported file'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDisclosureStep(1);
                  setSubmitError('');
                  setOverrideEmployerFields(false);
                  setMismoIncomeProfile(DEFAULT_MISMO_INCOME_PROFILE);
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Replace MISMO File
              </button>
            </div>
          </div>

          <SectionTitle title="Step 2) Complete Disclosure Submission Details" />
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <RadioGroup
              label="Is this Loan in Qualification Status?"
              value={form.qualificationStatus}
              onChange={(v) => update('qualificationStatus', v)}
              options={['Yes', 'No']}
              required
            />
            <p className="mt-1 text-xs font-medium text-slate-500">
              Required: this must be Yes to continue.
            </p>
          </div>
          {importError && (
            <p className="text-xs text-red-600">{importError}</p>
          )}
          {submitError && !isMismoValidationErrorMessage(submitError) && (
            <p className="text-xs text-red-600">{submitError}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Loan Officer" value={form.loanOfficer} onChange={(v) => update('loanOfficer', v)} />
        <Input label="Arrive Loan Number" value={form.arriveLoanNumber} onChange={(v) => update('arriveLoanNumber', v)} required />
        <Input label="Borrower First Name" value={form.borrowerFirstName} onChange={(v) => update('borrowerFirstName', v)} required />
        <Input label="Borrower Last Name" value={form.borrowerLastName} onChange={(v) => update('borrowerLastName', v)} required />
        <Input label="Borrower Phone" value={form.borrowerPhone} onChange={(v) => update('borrowerPhone', v)} required />
        <Input label="Borrower Email" value={form.borrowerEmail} onChange={(v) => update('borrowerEmail', v)} required />
        <Select label="Loan Type" value={form.loanType} onChange={(v) => update('loanType', v)} options={['Conventional', 'FHA', 'VA', 'Heloc', 'Heloan', 'Non QM']} required />
        <Select label="Loan Program" value={form.loanProgram} onChange={(v) => update('loanProgram', v)} options={['Cash out', 'Rate and Term', 'IRRRL', 'Streamline', 'Purchase']} required />
        <Input label="Loan Amount" value={form.loanAmount} onChange={(v) => update('loanAmount', v)} required />
        <Input label="Home Value" value={form.homeValue} onChange={(v) => update('homeValue', v)} required />
        <Select label="AUS" value={form.aus} onChange={(v) => update('aus', v)} options={['DU', 'LP', 'Manual UW']} required />
        <Select label="Credit Report Type" value={form.creditReportType} onChange={(v) => update('creditReportType', v)} options={['Soft Check', 'Hard Report']} required />
        <Select label="Channel" value={form.channel} onChange={(v) => update('channel', v)} options={['Broker', 'Correspondent']} required />
        <Select
          label="Investor"
          value={form.investor}
          onChange={(v) => update('investor', v)}
          options={investorOptions}
          required
        />
        {isButtonInvestor && (
          <>
            <Input
              label="Run ID"
              value={form.runId}
              onChange={(v) => update('runId', v)}
              required
            />
            <Select
              label="Pricing Option"
              value={form.pricingOption}
              onChange={(v) => update('pricingOption', v)}
              options={buttonPricingOptions}
              required
            />
          </>
        )}
          </div>
          <div
            ref={mimoRequiredFieldsRef}
            className="rounded-xl border border-slate-200 bg-slate-50 p-4"
          >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">MISMO Required Fields (Read-Only)</p>
            <p className="text-xs text-slate-600">
              These are auto-populated from MISMO and must be present before submission.
              Employer fields are required only when MISMO includes employment income.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOverrideEmployerFields((prev) => !prev)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              overrideEmployerFields
                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
            }`}
          >
            {overrideEmployerFields ? 'Disable Override' : 'Override Employer Fields'}
          </button>
        </div>
        {!mismoIncomeProfile.employmentFieldsRequired && mismoIncomeProfile.hasAnyIncomeItems && (
          <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
            Other Income/Loan Type detected in the MISMO File. Employer Fields Not Required.
          </div>
        )}
        {missingMismoLabels.length > 0 && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            Missing MISMO fields: {missingMismoLabels.join(', ')}. Re-upload MISMO after
            completing these in Arrive.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {overrideEmployerFields ? (
            <>
              <Input
                label="Employer Name"
                value={form.employerName}
                onChange={(v) => update('employerName', v)}
                required={mismoIncomeProfile.employmentFieldsRequired}
              />
              <Input
                label="Employer Address"
                value={form.employerAddress}
                onChange={(v) => update('employerAddress', v)}
                required={mismoIncomeProfile.employmentFieldsRequired}
              />
              <Input
                label="Employer - Duration in Line of Work"
                value={form.employerDurationLineOfWork}
                onChange={(v) => update('employerDurationLineOfWork', v)}
                required={mismoIncomeProfile.employmentFieldsRequired}
              />
            </>
          ) : (
            <>
              <ReadonlyRequiredField
                label="Employer Name"
                value={form.employerName}
                required={mismoIncomeProfile.employmentFieldsRequired}
                isMissing={missingReadonlyKeys.has('employerName')}
              />
              <ReadonlyRequiredField
                label="Employer Address"
                value={form.employerAddress}
                required={mismoIncomeProfile.employmentFieldsRequired}
                isMissing={missingReadonlyKeys.has('employerAddress')}
              />
              <ReadonlyRequiredField
                label="Employer - Duration in Line of Work"
                value={form.employerDurationLineOfWork}
                required={mismoIncomeProfile.employmentFieldsRequired}
                isMissing={missingReadonlyKeys.has('employerDurationLineOfWork')}
              />
              <ReadonlyRequiredField
                label="Year Built (Property)"
                value={form.yearBuiltProperty}
                isMissing={missingReadonlyKeys.has('yearBuiltProperty')}
              />
              <ReadonlyRequiredField
                label="Original Cost"
                value={form.originalCost}
                isMissing={missingReadonlyKeys.has('originalCost')}
              />
              <ReadonlyRequiredField
                label="Year Aquired"
                value={form.yearAquired}
                isMissing={missingReadonlyKeys.has('yearAquired')}
              />
              <ReadonlyRequiredField
                label="Manner in Which Title Will be Held"
                value={form.mannerInWhichTitleWillBeHeld}
                isMissing={missingReadonlyKeys.has('mannerInWhichTitleWillBeHeld')}
              />
            </>
          )}
        </div>
      </div>
          {isButtonInvestor && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="mb-3">
            <p className="text-sm font-semibold text-blue-900">Button Required Attachments</p>
            <p className="text-xs text-blue-700">Upload all 3 files before submitting.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <AttachmentRequiredCard
              label="Attach AVM"
              file={buttonFiles.avm}
              onFileSelected={(file) => setButtonFiles((prev) => ({ ...prev, avm: file }))}
            />
            <AttachmentRequiredCard
              label="Attach Title Sheet"
              file={buttonFiles.titleSheet}
              onFileSelected={(file) =>
                setButtonFiles((prev) => ({ ...prev, titleSheet: file }))
              }
            />
            <AttachmentRequiredCard
              label="Attach Pricing Sheet"
              file={buttonFiles.pricingSheet}
              onFileSelected={(file) =>
                setButtonFiles((prev) => ({ ...prev, pricingSheet: file }))
              }
            />
          </div>
            </div>
          )}
          <Textarea
            label="Notes / Special Instructions"
            value={form.notes}
            onChange={(v) => update('notes', v)}
            required
          />

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {isSubmitting ? 'Processing...' : 'Submit for Disclosures'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}

function QcForm({
  loanOfficerName,
  onSubmitted,
}: {
  loanOfficerName: string;
  onSubmitted: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stipFiles, setStipFiles] = useState<File[]>([]);
  const [stipError, setStipError] = useState('');
  const [pipelineLoans, setPipelineLoans] = useState<PipelineLoanOption[]>([]);
  const [selectedPipelineLoanId, setSelectedPipelineLoanId] = useState<string>('');
  const [clientFolderDocs, setClientFolderDocs] = useState<ClientFolderDocOption[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [form, setForm] = useState({
    preApproved: '',
    loanOfficer: loanOfficerName,
    secondaryLoanOfficer: '',
    borrowerFirstName: '',
    borrowerLastName: '',
    borrowerPhone: '',
    borrowerEmail: '',
    arriveLoanNumber: '',
    channel: '',
    investor: '',
    loanType: '',
    loanProgram: '',
    loanAmount: '',
    cashBack: '',
    projectedRevenue: '',
    aus: '',
    creditReportType: '',
    uwmFreeCreditUsed: '',
    communityPropertyState: '',
    creditReportNotesExp: '',
    creditReportNotesEqf: '',
    creditReportNotesTui: '',
    titleCompany: '',
    appraisalWaiver: '',
    notesGoals: '',
  });
  const [importError, setImportError] = useState('');
  const [submitError, setSubmitError] = useState('');

  const update = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    const load = async () => {
      const result = await getMyPipelineClients();
      if (result.success && Array.isArray(result.loans)) {
        setPipelineLoans(
          result.loans.map((l) => ({
            id: l.id,
            loanNumber: l.loanNumber,
            borrowerName: l.borrowerName,
            borrowerPhone: l.borrowerPhone ?? null,
            borrowerEmail: l.borrowerEmail ?? null,
          }))
        );
      }
    };
    load();
  }, []);

  useEffect(() => {
    if (!selectedPipelineLoanId) {
      return;
    }

    const loadDocs = async () => {
      const folder = await getClientFolderForLoan(selectedPipelineLoanId);
      if (folder.success && Array.isArray(folder.documents)) {
        setClientFolderDocs(
          folder.documents.map((d) => ({
            id: d.id,
            filename: d.filename,
            createdAt: d.createdAt,
          }))
        );
      } else {
        setClientFolderDocs([]);
      }
    };
    loadDocs();
  }, [selectedPipelineLoanId, pipelineLoans]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setSubmitError('');

    if (stipFiles.length < 1) {
      setStipError('Initial STIPs are required (upload at least 1 file).');
      return;
    }

    setStipError('');
    setIsSubmitting(true);

    try {
      const res = await createSubmissionTask({
        submissionType: 'QC',
        loanOfficerName: form.loanOfficer,
        borrowerFirstName: form.borrowerFirstName,
        borrowerLastName: form.borrowerLastName,
        borrowerPhone: form.borrowerPhone,
        borrowerEmail: form.borrowerEmail,
        arriveLoanNumber: form.arriveLoanNumber,
        loanAmount: form.loanAmount,
        notes: form.notesGoals,
        submissionData: form,
      });

      if (!res.success || !res.taskId) {
        setSubmitError(res.error || 'Failed to submit QC task.');
        setIsSubmitting(false);
        return;
      }

      // Upload required STIPs and attach to task
      for (const file of stipFiles) {
        const upload = await createTaskAttachmentUploadUrl({
          taskId: res.taskId,
          purpose: TaskAttachmentPurpose.STIP,
          filename: file.name,
        });

        if (!upload.success || !upload.signedUrl || !upload.path) {
          setSubmitError(upload.error || 'Failed to create upload URL.');
          setIsSubmitting(false);
          return;
        }

        const put = await fetch(upload.signedUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        });

        if (!put.ok) {
          setSubmitError('Failed to upload a STIP file. Please try again.');
          setIsSubmitting(false);
          return;
        }

        const saved = await finalizeTaskAttachment({
          taskId: res.taskId,
          purpose: TaskAttachmentPurpose.STIP,
          storagePath: upload.path,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });

        if (!saved.success) {
          setSubmitError(saved.error || 'Failed to save uploaded file.');
          setIsSubmitting(false);
          return;
        }
      }

      if (selectedDocIds.length > 0) {
        const attached = await attachClientDocumentsToTask({
          taskId: res.taskId,
          documentIds: selectedDocIds,
          purpose: TaskAttachmentPurpose.STIP,
        });
        if (!attached.success) {
          setSubmitError(attached.error || 'Failed to attach client documents.');
          setIsSubmitting(false);
          return;
        }
      }

      onSubmitted();
    } catch (error) {
      console.error(error);
      setSubmitError('Failed to submit QC task.');
      setIsSubmitting(false);
    }
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const prefill = parseMismoXml(text, file.name);
      setImportError('');
      setForm((prev) => ({
        ...prev,
        loanOfficer: prefill.loanOfficer || prev.loanOfficer,
        borrowerFirstName: prefill.borrowerFirstName || prev.borrowerFirstName,
        borrowerLastName: prefill.borrowerLastName || prev.borrowerLastName,
        arriveLoanNumber: prefill.arriveLoanNumber || prev.arriveLoanNumber,
        channel: prefill.channel || prev.channel,
        investor: prefill.investor || prev.investor,
        loanType: prefill.loanType || prev.loanType,
        loanProgram: prefill.loanProgram || prev.loanProgram,
        loanAmount: prefill.loanAmount || prev.loanAmount,
      }));
    } catch {
      setImportError('Could not read this MISMO file. Please verify the XML export.');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <SectionTitle title="QC Submission Details" />
      <FileUpload onFileSelected={handleFileUpload} />
      {importError && (
        <p className="text-xs text-red-600">{importError}</p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm font-semibold text-slate-900">Select Client (optional)</p>
        <p className="text-xs text-slate-500 mt-0.5">
          Pick a client from your pipeline to auto-fill and optionally include docs from their folder.
        </p>
        <select
          value={selectedPipelineLoanId}
          onChange={(e) => {
            const nextLoanId = e.target.value;
            setSelectedPipelineLoanId(nextLoanId);
            if (!nextLoanId) {
              setClientFolderDocs([]);
              setSelectedDocIds([]);
              return;
            }
            const loan = pipelineLoans.find((l) => l.id === nextLoanId);
            if (!loan) return;
            const parts = (loan.borrowerName || '').trim().split(/\s+/).filter(Boolean);
            const first = parts[0] || '';
            const last = parts.length > 1 ? parts.slice(1).join(' ') : '';
            setForm((prev) => ({
              ...prev,
              borrowerFirstName: first || prev.borrowerFirstName,
              borrowerLastName: last || prev.borrowerLastName,
              arriveLoanNumber: loan.loanNumber || prev.arriveLoanNumber,
              borrowerPhone: loan.borrowerPhone || prev.borrowerPhone,
              borrowerEmail: loan.borrowerEmail || prev.borrowerEmail,
            }));
          }}
          disabled={isSubmitting}
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-60"
        >
          <option value="">No selection</option>
          {pipelineLoans.map((l) => (
            <option key={l.id} value={l.id}>
              {l.borrowerName} • {l.loanNumber}
            </option>
          ))}
        </select>

        {clientFolderDocs.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
              Include from Client Folder
            </p>
            <div className="mt-2 max-h-36 overflow-y-auto space-y-2 pr-1">
              {clientFolderDocs.map((d) => {
                const checked = selectedDocIds.includes(d.id);
                return (
                  <label
                    key={d.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-700 truncate">{d.filename}</p>
                      <p className="text-[10px] text-slate-400">
                        {new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setSelectedDocIds((prev) =>
                          checked ? prev.filter((id) => id !== d.id) : [...prev, d.id]
                        );
                      }}
                      disabled={isSubmitting}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Initial STIPs (required)</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Upload at least 1 file (PDF/Image/Doc). These will be attached to the QC task.
            </p>
          </div>
          <span className="text-xs font-semibold text-slate-700 rounded-full border border-slate-200 bg-white px-2 py-1">
            {stipFiles.length} selected
          </span>
        </div>

        <div className="mt-3">
          <input
            type="file"
            multiple
            accept="application/pdf,image/*,.doc,.docx"
            disabled={isSubmitting}
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setStipFiles(files);
              if (files.length) setStipError('');
              e.currentTarget.value = '';
            }}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-60"
          />
          {stipError && <p className="mt-2 text-xs text-red-600">{stipError}</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input label="Loan Officer" value={form.loanOfficer} onChange={(v) => update('loanOfficer', v)} />
        <Input label="Secondary Loan Officer" value={form.secondaryLoanOfficer} onChange={(v) => update('secondaryLoanOfficer', v)} />
        <Input label="Borrower First Name" value={form.borrowerFirstName} onChange={(v) => update('borrowerFirstName', v)} required />
        <Input label="Borrower Last Name" value={form.borrowerLastName} onChange={(v) => update('borrowerLastName', v)} required />
        <Input label="Borrower Phone (recommended)" value={form.borrowerPhone} onChange={(v) => update('borrowerPhone', v)} />
        <Input label="Borrower Email" value={form.borrowerEmail} onChange={(v) => update('borrowerEmail', v)} />
        <Input label="Arrive Loan Number" value={form.arriveLoanNumber} onChange={(v) => update('arriveLoanNumber', v)} required />
        <RadioGroup
          label="Is loan in Pre-Approved Status in Arrive?"
          value={form.preApproved}
          onChange={(v) => update('preApproved', v)}
          options={['Yes', 'No']}
          required
        />
        <Select label="Loan Type" value={form.loanType} onChange={(v) => update('loanType', v)} options={['Conventional', 'FHA', 'VA', 'Heloc', 'Heloan', 'Non QM']} required />
        <Select label="Loan Program" value={form.loanProgram} onChange={(v) => update('loanProgram', v)} options={['Cash out', 'Rate and Term', 'IRRRL', 'Streamline', 'Purchase']} required />
        <Input label="Loan Amount" value={form.loanAmount} onChange={(v) => update('loanAmount', v)} required />
        <Input label="Cash Back" value={form.cashBack} onChange={(v) => update('cashBack', v)} />
        <Input label="Projected Revenue" value={form.projectedRevenue} onChange={(v) => update('projectedRevenue', v)} />
        <Select label="AUS" value={form.aus} onChange={(v) => update('aus', v)} options={['DU', 'LP', 'Manual UW']} required />
        <Select label="Credit Report Type" value={form.creditReportType} onChange={(v) => update('creditReportType', v)} options={['Soft Check', 'Hard Report']} required />
        <Select label="Channel" value={form.channel} onChange={(v) => update('channel', v)} options={['Broker', 'Correspondent']} required />
        <Select
          label="Investor"
          value={form.investor}
          onChange={(v) => update('investor', v)}
          options={investorOptions}
          required
        />
        <RadioGroup
          label="Was UWM free credit used?"
          value={form.uwmFreeCreditUsed}
          onChange={(v) => update('uwmFreeCreditUsed', v)}
          options={['Yes', 'No']}
          required
        />
        <RadioGroup
          label="Community Property State - is NBS credit pulled and in liabilities? (FHA/VA)"
          value={form.communityPropertyState}
          onChange={(v) => update('communityPropertyState', v)}
          options={['Yes', 'No']}
          required
        />
        <CreditReportNotes
          label="Credit Report Notes (scores/bureaus used)"
          exp={form.creditReportNotesExp}
          eqf={form.creditReportNotesEqf}
          tui={form.creditReportNotesTui}
          onChange={(field, value) =>
            update(
              field === 'EXP'
                ? 'creditReportNotesExp'
                : field === 'EQF'
                ? 'creditReportNotesEqf'
                : 'creditReportNotesTui',
              value
            )
          }
        />
        <Select label="Title" value={form.titleCompany} onChange={(v) => update('titleCompany', v)} options={['Acrisure', 'Unisource', 'BCHH', 'ServiceLink']} required />
        <RadioGroup
          label="Appraisal Waiver"
          value={form.appraisalWaiver}
          onChange={(v) => update('appraisalWaiver', v)}
          options={['Yes', 'No']}
          required
        />
      </div>
      <Textarea label="Notes / Goals" value={form.notesGoals} onChange={(v) => update('notesGoals', v)} />
      {submitError && (
        <p className="text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 px-3 py-2">
          {submitError}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isSubmitting ? 'Processing...' : 'Submit for QC'}
        </button>
      </div>
    </form>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="text-sm font-semibold text-slate-900">{title}</h3>;
}

function DisclosureMismoStep({
  onFileSelected,
  isParsing,
  importError,
}: {
  onFileSelected: (file: File | null) => void | Promise<void>;
  isParsing: boolean;
  importError: string;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedName, setSelectedName] = useState('');

  const handlePickedFile = async (file: File | null) => {
    if (!file) return;
    setSelectedName(file.name);
    await onFileSelected(file);
  };

  return (
    <div className="space-y-4">
      <SectionTitle title="Step 1) Upload MISMO 3.4 File" />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0] || null;
          void handlePickedFile(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 transition ${
          dragActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-slate-300 bg-gradient-to-br from-slate-50 to-white'
        }`}
      >
        <div className="mx-auto max-w-xl text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
            <Upload className="h-6 w-6" />
          </span>
          <p className="mt-3 text-base font-semibold text-slate-900">
            Drag and drop MISMO 3.4 XML here
          </p>
          <p className="mt-1 text-sm text-slate-500">
            or choose a file to auto-fill submission details
          </p>
          <label className="mt-5 inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
            Choose File
            <input
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                void handlePickedFile(file);
              }}
            />
          </label>
          <p className="mt-3 text-xs font-medium text-slate-500">
            Accepted format: .xml (MISMO 3.4)
          </p>
          {(selectedName || isParsing) && (
            <p className="mt-2 text-xs font-semibold text-slate-700">
              {isParsing ? 'Importing MISMO file...' : `Selected: ${selectedName}`}
            </p>
          )}
        </div>
      </div>
      {importError && (
        <p className="text-xs text-red-600">{importError}</p>
      )}
    </div>
  );
}

function FileUpload({ onFileSelected }: { onFileSelected: (file: File | null) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
        Upload MISMO 3.4 (.xml) to auto-fill
      </span>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="file"
          accept=".xml"
          onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
          className="text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
        />
      </div>
    </label>
  );
}

function AttachmentRequiredCard({
  label,
  file,
  onFileSelected,
}: {
  label: string;
  file: File | null;
  onFileSelected: (file: File | null) => void;
}) {
  return (
    <label className="block rounded-xl border border-slate-200 bg-white p-3 shadow-sm cursor-pointer hover:border-blue-300 hover:shadow">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
          <FileText className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold text-slate-900">{label}</span>
      </div>
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700">
        <Upload className="h-3.5 w-3.5" />
        {file ? 'Replace File' : 'Upload File'}
      </div>
      <p className="mt-2 truncate text-xs text-slate-500">
        {file ? file.name : 'No file selected'}
      </p>
      <input
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
        className="hidden"
        onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
      />
    </label>
  );
}

function ReadonlyRequiredField({
  label,
  value,
  required = true,
  isMissing = false,
}: {
  label: string;
  value: string;
  required?: boolean;
  isMissing?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className={isMissing ? 'font-medium text-red-700' : 'text-slate-700 font-medium'}>
        {label}
        {required ? ' *' : ' (Optional)'}
      </span>
      <input
        value={value}
        readOnly
        disabled
        placeholder="Populated from MISMO import"
        className={`w-full rounded-lg px-3 py-2 text-sm cursor-not-allowed ${
          isMissing
            ? 'border border-red-300 bg-red-50 text-red-700'
            : 'border border-slate-200 bg-slate-100 text-slate-600'
        }`}
      />
    </label>
  );
}

function Input({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</span>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm block">
      <span className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</span>
      <textarea
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 min-h-[96px]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</span>
      <select
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

function RadioGroup({
  label,
  value,
  onChange,
  options,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  required?: boolean;
}) {
  return (
    <fieldset className="space-y-2 text-sm">
      <legend className="text-slate-700 font-medium">{label}{required ? ' *' : ''}</legend>
      <div className="flex flex-wrap gap-4">
        {options.map((opt) => (
          <label key={opt} className="inline-flex items-center gap-2 text-slate-600">
            <input
              type="radio"
              name={label}
              value={opt}
              checked={value === opt}
              onChange={(e) => onChange(e.target.value)}
              required={required}
            />
            {opt}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function CreditReportNotes({
  label,
  exp,
  eqf,
  tui,
  onChange,
}: {
  label: string;
  exp: string;
  eqf: string;
  tui: string;
  onChange: (field: 'EXP' | 'EQF' | 'TUI', value: string) => void;
}) {
  return (
    <div className="space-y-1 text-sm md:col-span-1">
      <span className="text-slate-700 font-medium block">{label}</span>
      <div className="grid grid-cols-3 gap-2">
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="EXP"
          maxLength={3}
          value={exp}
          onChange={(e) => onChange('EXP', e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="EQF"
          maxLength={3}
          value={eqf}
          onChange={(e) => onChange('EQF', e.target.value)}
        />
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-center"
          placeholder="TUI"
          maxLength={3}
          value={tui}
          onChange={(e) => onChange('TUI', e.target.value)}
        />
      </div>
    </div>
  );
}
