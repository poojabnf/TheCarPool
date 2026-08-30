/**
 * Over-the-air update delivery.
 *
 * The pieces were all in place and updates still never arrived, for a reason
 * that is entirely our own doing.
 *
 * `fallbackToCacheTimeout: 0` was set to kill an 8-second splash hang, and it
 * does: the app launches instantly from cache and downloads any new update in
 * the background. What it also does is defer applying that update until the
 * NEXT cold start. So an OTA needs two full launches to take effect — and on a
 * phone, "closing" an app usually means backgrounding it, which is not a cold
 * start at all. For anyone who never swipes the app away, the update is
 * downloaded and then simply sits there, indefinitely.
 *
 * Nothing in the app called the expo-updates JS API either, so there was no
 * second route in. The package was installed and never used.
 *
 * This restores the missing half: check and fetch on launch, so an update is
 * already downloaded and ready to apply on the next start rather than waiting
 * for a background check that may never run.
 *
 * It deliberately does NOT reload the app itself. See applyPendingUpdate().
 */
import * as Updates from 'expo-updates';

/**
 * Download a pending update so it is ready for the next launch.
 *
 * Returns true when something was downloaded. It does not restart the app —
 * see the note inside for why that turned out to matter more than speed.
 *
 * Silent by design: every failure path here is non-fatal. A device with no
 * connection, an update server having a bad minute, or a build running in
 * development — all of them should leave the user with a working app on the
 * code it already has, which is exactly what returning early does.
 */
export async function applyPendingUpdate(): Promise<boolean> {
  // False in Expo Go and in development builds, where updates do not apply and
  // checkForUpdateAsync throws rather than returning a useful answer.
  if (!Updates.isEnabled) return false;

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) return false;

    const fetched = await Updates.fetchUpdateAsync();
    if (!fetched.isNew) return false;

    // Downloaded, NOT applied here.
    //
    // This used to call Updates.reloadAsync() straight away, and that is
    // almost certainly why the app became unusable after an update. A reload
    // at launch turns a single bad bundle into a loop: launch, fetch, reload,
    // the new bundle fails to start or expo-updates rolls it back, launch,
    // fetch, reload — forever, with no way in from the user's side. The one
    // failure it cannot recover from is the one it creates.
    //
    // Downloading and letting the update apply on the next natural launch is
    // what expo-updates does by default, and it cannot loop: a bundle that
    // will not start is simply replaced on the following launch. The cost is
    // that an update lands one launch later than it might. That is a fair
    // price for an app that always opens.
    return true;
  } catch {
    // Offline, server unreachable, or a manifest we cannot use. The app keeps
    // running on the bundle it already has, which is the correct outcome.
    return false;
  }
}

/** What is actually running, for support and for the About screen. */
export function currentUpdateInfo(): {
  runtimeVersion: string | null;
  updateId: string | null;
  channel: string | null;
  isEmbedded: boolean;
} {
  return {
    runtimeVersion: Updates.runtimeVersion ?? null,
    // Null when running the bundle shipped inside the binary rather than an
    // OTA — which is itself the answer to "did the update arrive?".
    updateId: Updates.updateId ?? null,
    channel: Updates.channel ?? null,
    isEmbedded: Updates.isEmbeddedLaunch === true,
  };
}
