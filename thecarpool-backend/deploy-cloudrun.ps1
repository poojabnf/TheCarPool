# ─────────────────────────────────────────────────────────────
# TheCarPool backend → Google Cloud Run deploy
# Run from the thecarpool-backend directory.
# ─────────────────────────────────────────────────────────────

$PROJECT = "thecarpool-fe636"
$REGION  = "asia-south1"          # match your Storage/users region
$SERVICE = "thecarpool-backend"
$RUNTIME_SA = "953521578640-compute@developer.gserviceaccount.com"

gcloud config set project $PROJECT

# 1) Runtime IAM — the Cloud Run service account needs:
#    - datastore.user        → Firestore read/write
#    - firebaseauth.admin    → deleteUser / setCustomUserClaims
#    - storage.admin         → read/write the Storage bucket
#    - firebasecloudmessaging.admin → send FCM push notifications
#    - serviceAccountTokenCreator (on ITSELF) → sign KYC/classifieds upload URLs
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/firebaseauth.admin"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/storage.admin"
# Without this every push silently fails with "Permission
# 'cloudmessaging.messages.create' denied" — which firebase-admin surfaces as
# the misleading code 'messaging/mismatched-credential', sending you off to
# check project ids that were never wrong. 100% of notifications were lost.
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/firebasecloudmessaging.admin"
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA --member="serviceAccount:$RUNTIME_SA" --role="roles/iam.serviceAccountTokenCreator"

# 2) Deploy from source (builds the Dockerfile via Cloud Build).
#    --session-affinity keeps Socket.IO connections sticky.
#
#    --min-instances 0, NOT 1: a warm idle instance bills around the clock
#    whether or not anyone is using the app. This was 1, and every deploy
#    silently reinstated it — a standing charge on a project that is meant to
#    sit inside the free tier. The cost is a cold start (~2-5s) on the first
#    request after idle; raise this only if that latency becomes a real
#    problem, and expect the bill to follow.
#
#    --update-env-vars, NOT --set-env-vars: `--set-env-vars` REPLACES the
#    service's entire plain env-var list, so every variable not repeated on
#    this line is silently dropped by the deploy. That is exactly how
#    RAZORPAY_KEY_ID and CORS_ALLOWED_ORIGINS were lost (revision 33 → 34),
#    taking payments and web CORS down until they were restored by hand.
#    Secret Manager-backed vars are unaffected either way — only plain ones
#    are at risk, which is what made the breakage easy to miss.
gcloud run deploy $SERVICE `
  --source . `
  --region $REGION `
  --allow-unauthenticated `
  --port 8080 `
  --session-affinity `
  --timeout 3600 `
  --cpu 1 --memory 512Mi `
  --min-instances 0 --max-instances 5 `
  --update-env-vars "NODE_ENV=production,GOOGLE_MAPS_API_KEY=AIzaSyBTkNesFuUVR-8u9FNOh4RmsuZn28DT5cM"

# 3) After it prints the Service URL (https://thecarpool-backend-xxxx.a.run.app):
#    - Set NEXT_PUBLIC_API_URL to that URL in Vercel (Project → Settings → Env Vars), redeploy web.
#    - Put it in thecarpool-mobile/eas.json (EXPO_PUBLIC_API_URL) for the mobile build.
#
#    Razorpay / Sentry secrets are best added via Secret Manager, e.g.:
#    gcloud run services update $SERVICE --region $REGION `
#      --update-env-vars "RAZORPAY_KEY_ID=...,SENTRY_DSN=..."
#
#    Again --update-env-vars, never --set-env-vars: the latter would drop
#    every variable not named on that one line.
#
#    For a value containing commas (e.g. CORS_ALLOWED_ORIGINS), choose a
#    different delimiter with a ^delim^ prefix so the commas are not read
#    as separators:
#    gcloud run services update $SERVICE --region $REGION `
#      --update-env-vars "^@^CORS_ALLOWED_ORIGINS=https://a.example,https://b.example"
