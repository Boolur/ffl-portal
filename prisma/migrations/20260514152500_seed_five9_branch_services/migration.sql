-- Seeds the inactive Five9 branch-specific new-lead push services. Admins
-- must select the allowed users and enable each service before it dispatches.
WITH service_seed (
  "slug",
  "name",
  "description",
  "bodyTemplate"
) AS (
  VALUES
    (
      'new-leads-push-five9-crashouts',
      'New Leads Push - Five9 (Crashouts)',
      'Pushes newly assigned Lead Mailbox leads to the Five9 router middleware for the Crashouts branch.',
      '{
  "first_name": "{{lead.firstName}}",
  "last_name": "{{lead.lastName}}",
  "email": "{{lead.email}}",
  "number1": "{{lead.phone}}",
  "number2": "{{lead.homePhone}}",
  "number3": "{{lead.workPhone}}",

  "street": "{{lead.mailingAddress}}",
  "city": "{{lead.mailingCity}}",
  "state": "{{lead.mailingState}}",
  "zip": "{{lead.mailingZip}}",

  "property_value": "{{lead.propertyValue}}",
  "property_type": "{{lead.propertyType}}",
  "property_use": "{{lead.propertyUse}}",
  "property_ltv": "{{lead.propertyLtv}}",

  "loan_amount": "{{lead.loanAmount}}",
  "loan_rate": "{{lead.loanRate}}",
  "loan_term": "{{lead.loanTerm}}",
  "cash_out": "{{lead.cashOut}}",

  "credit_rating": "{{lead.creditRating}}",
  "current_balance": "{{lead.currentBalance}}",
  "current_payment": "{{lead.currentPayment}}",
  "current_rate": "{{lead.currentRate}}",

  "lead_id": "{{lead.vendorLeadId}}",
  "user_id": "{{user.id}}",
  "date_modified": "{{now.iso}}",

  "branch": "CRASHOUTS",
  "source": "LeadMailbox"
}'
    ),
    (
      'new-leads-push-five9-az',
      'New Leads Push - Five9 (AZ)',
      'Pushes newly assigned Lead Mailbox leads to the Five9 router middleware for the AZ branch.',
      '{
  "first_name": "{{lead.firstName}}",
  "last_name": "{{lead.lastName}}",
  "email": "{{lead.email}}",
  "number1": "{{lead.phone}}",
  "number2": "{{lead.homePhone}}",
  "number3": "{{lead.workPhone}}",

  "street": "{{lead.mailingAddress}}",
  "city": "{{lead.mailingCity}}",
  "state": "{{lead.mailingState}}",
  "zip": "{{lead.mailingZip}}",

  "property_value": "{{lead.propertyValue}}",
  "property_type": "{{lead.propertyType}}",
  "property_use": "{{lead.propertyUse}}",
  "property_ltv": "{{lead.propertyLtv}}",

  "loan_amount": "{{lead.loanAmount}}",
  "loan_rate": "{{lead.loanRate}}",
  "loan_term": "{{lead.loanTerm}}",
  "cash_out": "{{lead.cashOut}}",

  "credit_rating": "{{lead.creditRating}}",
  "current_balance": "{{lead.currentBalance}}",
  "current_payment": "{{lead.currentPayment}}",
  "current_rate": "{{lead.currentRate}}",

  "lead_id": "{{lead.vendorLeadId}}",
  "user_id": "{{user.id}}",
  "date_modified": "{{now.iso}}",

  "branch": "AZ",
  "source": "LeadMailbox"
}'
    )
)
INSERT INTO "IntegrationService" (
  "id",
  "slug",
  "name",
  "description",
  "type",
  "active",
  "config",
  "kind",
  "statusTrigger",
  "method",
  "urlTemplate",
  "bodyTemplate",
  "headersTemplate",
  "userScope",
  "userIds",
  "campaignScope",
  "campaignIds",
  "excludeSelected",
  "captureFields",
  "requiresBrandNew",
  "requiresNotBrandNew",
  "requiresAssignedUser",
  "requiresOAuth",
  "allowManualSend",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  service_seed."slug",
  service_seed."name",
  service_seed."description",
  'five9',
  false,
  '{}'::jsonb,
  'SERVER',
  'ON_ASSIGN',
  'POST_JSON',
  'https://lead-router-fedfirst.onrender.com/webhooks/leadmailbox',
  service_seed."bodyTemplate",
  'User-Agent: FFL-Portal/1.0 (+lead-distribution)',
  'SPECIFIC',
  ARRAY[]::text[],
  'ANY',
  ARRAY[]::text[],
  false,
  '[]'::jsonb,
  true,
  false,
  true,
  false,
  false,
  NOW(),
  NOW()
FROM service_seed
ON CONFLICT ("slug") DO NOTHING;
