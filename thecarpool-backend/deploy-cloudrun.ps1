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
#    - serviceAccountTokenCreator (on ITSELF) → sign KYC/classifieds upload URLs
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/datastore.user"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/firebaseauth.admin"
gcloud projects add-iam-policy-binding $PROJECT --member="serviceAccount:$RUNTIME_SA" --role="roles/storage.admin"
gcloud iam service-accounts add-iam-policy-binding $RUNTIME_SA --member="serviceAccount:$RUNTIME_SA" --role="roles/iam.serviceAccountTokenCreator"

# 2) Deploy from source (builds the Dockerfile via Cloud Build).
#    --session-affinity keeps Socket.IO connections sticky.
gcloud run deploy $SERVICE `
  --source . `
  --region $REGION `
  --allow-unauthenticated `
  --port 8080 `
  --session-affinity `
  --timeout 3600 `
  --cpu 1 --memory 512Mi `
  --min-instances 1 --max-instances 5 `
  --set-env-vars "NODE_ENV=production,GOOGLE_MAPS_API_KEY=AIzaSyBTkNesFuUVR-8u9FNOh4RmsuZn28DT5cM"

# 3) After it prints the Service URL (https://thecarpool-backend-xxxx.a.run.app):
#    - Set NEXT_PUBLIC_API_URL to that URL in Vercel (Project → Settings → Env Vars), redeploy web.
#    - Put it in thecarpool-mobile/eas.json (EXPO_PUBLIC_API_URL) for the mobile build.
#
#    Razorpay / Sentry secrets are best added via Secret Manager, e.g.:
#    gcloud run services update $SERVICE --region $REGION `
#      --set-env-vars "RAZORPAY_KEY_ID=...,RAZORPAY_KEY_SECRET=...,RAZORPAY_WEBHOOK_SECRET=...,SENTRY_DSN=..."
