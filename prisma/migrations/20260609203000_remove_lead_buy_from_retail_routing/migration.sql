UPDATE "PayrollSetting"
SET "value" = '["MAILER","WARM_TRANSFER"]',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'payroll.brokerRetailLeadSources';