-- Five9 historically read only the mailing address columns. Many inbound
-- vendors populate only propertyAddress/propertyCity/propertyState/propertyZip,
-- so use mailing-first computed tokens that fall back to those columns.
UPDATE "IntegrationService"
SET
  "bodyTemplate" = replace(
    replace(
      replace(
        replace(
          "bodyTemplate",
          '{{lead.mailingAddress}}',
          '{{lead.mailingOrPropertyAddress}}'
        ),
        '{{lead.mailingCity}}',
        '{{lead.mailingOrPropertyCity}}'
      ),
      '{{lead.mailingState}}',
      '{{lead.mailingOrPropertyState}}'
    ),
    '{{lead.mailingZip}}',
    '{{lead.mailingOrPropertyZip}}'
  ),
  "updatedAt" = NOW()
WHERE "type" = 'five9';
