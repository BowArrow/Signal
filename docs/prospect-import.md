# Importing prospects

In Sales, choose Lemonade or CineGen, then open **Import prospects**. Upload a
UTF-8 CSV or paste its contents. Preview the contacts and import them into the
selected business. Importing pauses that business's operation. Review the result
and use Run to resume its configured activities.

The preview supports 500 contacts and at most 1,000,000 characters. File uploads
also have a 1 MB byte limit. Use these headers (case-insensitive):

```csv
name,email,source,permission,consent,notes
Pat,pat@example.test,Website signup,opted-in,Marketing checkbox on 2026-09-15 for this business,Interested in document search
Lee,lee@example.test,Conference,unknown,,Research the fit before contacting
```

`email` and `source` are required. The other columns are optional. If name is
missing, the email is used. Permission defaults to `unknown`; initial outreach
requires `opted-in`. An opted-in row must supply a consent record describing
where and when the person agreed to marketing from this business. This is
owner-supplied evidence, not independent verification. Unknown permission must
not be upgraded merely because someone appears in an export.

`do-not-contact` creates a business-scoped suppression, stops matching follow-ups
and changes existing matching leads to do-not-contact. A new suppressed address
is recorded without adding a prospect. Other imports never overwrite an existing
lead's notes, stage, permission or follow-up date. Existing suppression wins over
an imported opt-in. New contacts matching known live Stripe purchase history are
added as customers, not prospects. CSV cannot declare a sale or campaign result.

Repeated imports do not create duplicate emails within a business. Duplicate
email rows inside a file are rejected, including case variants, so conflicting
consent cannot be silently resolved. Invalid rows reject the entire file. A
changed matching pipeline record or changed eligibility invalidates the preview;
preview again before committing. Database writes are atomic. A receipt stores
the import hash, counts and time; the raw CSV is not retained separately.

Source and consent remain in the local lead record. With GPT selected, relevant
lead details can later be included in outreach generation. The import itself
does not send email, run a model or contact a remote service. Records are text,
never executable HTML or spreadsheet formulas.

The parser follows [RFC 4180 quoting](https://www.rfc-editor.org/rfc/rfc4180),
including embedded commas/newlines and escaped quotes, and accepts a UTF-8 BOM
and LF endings common in exports. Unsupported or repeated headers and malformed
quoting are rejected with record numbers. A record can span multiple physical
lines.

This supplies existing prospects to Run. [Mailchimp ingestion](prospect-sources.md)
can keep a selected audience current automatically. Other CRM synchronization,
direct website-form ingestion and discovery of new prospects remain separate work.
