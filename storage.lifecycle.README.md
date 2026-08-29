# Storage bucket lifecycle

Applied with:

```
gcloud storage buckets update gs://<bucket> --lifecycle-file=storage.lifecycle.json
```

`storage.lifecycle.json` must stay strict JSON with no extra keys — gcloud
validates the schema and rejects anything it does not recognise, including a
`_comment` field. That is why this explanation lives here instead.

## Why the prefix is `kyc-documents/`

It matches what the backend actually wrote: ID documents went to
`kyc-documents/{uid}/{type}/...`. The `users/{uid}/kyc/` path in
`storage.rules` was defence-in-depth for direct client access and was never
used, so do **not** "correct" the prefix to match it — that would stop the
rule matching anything, and nothing would ever be deleted.

## Status

KYC document capture has been removed from the product. This rule is what is
still ageing out the documents captured before that, 15 days after upload.

Firestore fields (`id_document`, `kyc_status`) are **not** covered by it and
still need a one-off purge.

Note this is unrelated to the PAN collected for driver payouts, which is a
Firestore field on the user and involves no uploaded documents at all.
