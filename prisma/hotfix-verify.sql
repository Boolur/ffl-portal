SELECT column_name FROM information_schema.columns WHERE table_name = 'Loan' AND column_name IN ('secondaryLoanOfficerId','visibilitySubmitterUserId') ORDER BY column_name;
