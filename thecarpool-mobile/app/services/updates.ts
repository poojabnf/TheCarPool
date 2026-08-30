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
 * This restores the missing half: check on launch, fetch, and reload once —
 * so an update lands on the first relaunch rather than the second or never,
 * while the instant launch is kept.
 */
import * as Updates from 'expo-updates';

/**
 * Fetch and apply a pending update, if there is one.
 *
 * Deliberately called only at app start. Reloading mid-session would tear the
 * screen out from under someone who might be halfway through paying for a
 * seat, and no update is worth that. At launch there is nothing in flight, so
 * a reload costs a blink.
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

    await Updates.reloadAsync();
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
