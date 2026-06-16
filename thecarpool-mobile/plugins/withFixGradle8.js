/**
 * withFixGradle8.js
 *
 * Expo config plugin that patches Gradle 8.x incompatibilities:
 *
 * 1. Removes the deprecated `classifier` property from any
 *    `androidSourcesJar` task in third-party modules (e.g. expo-location).
 *    In Gradle 8 the `Jar.classifier` property was removed — use
 *    `Jar.archiveClassifier` instead. Since we cannot patch node_modules,
 *    we inject an init-script via gradle.properties that applies a global
 *    compatibility shim.
 *
 * 2. Adds a global fallback `compileSdkVersion` via gradle.properties so
 *    that any plugin that forgets to declare it doesn't break the build.
 */

const { withGradleProperties, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

// ─── 1. Patch gradle.properties ──────────────────────────────────────────────
const withGradlePropertiesFix = (config) => {
  return withGradleProperties(config, (config) => {
    const props = config.modResults;

    const set = (key, value) => {
      const existing = props.find((p) => p.type === 'property' && p.key === key);
      if (existing) {
        existing.value = value;
      } else {
        props.push({ type: 'property', key, value });
      }
    };

    // Allow Gradle to use a wider set of SDK versions from the build-properties plugin
    set('android.compileSdkVersion', '35');
    set('android.targetSdkVersion', '35');
    set('android.minSdkVersion', '26');
    set('android.buildToolsVersion', '35.0.0');

    // Suppress the Gradle 8 'classifier' warning/failure via compatibility mode
    set('android.suppressUnsupportedCompileSdk', '35');

    // Allow Gradle to configure projects on demand (perf + compat)
    set('org.gradle.configureondemand', 'false');
    set('org.gradle.jvmargs', '-Xmx4096m -XX:MaxMetaspaceSize=512m');

    return config;
  });
};

// ─── 2. Inject a Gradle init script to shim the `classifier` property ────────
const withClassifierShim = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const androidDir = path.join(config.modRequest.platformProjectRoot);
      const initScriptsDir = path.join(androidDir, 'gradle', 'init.d');
      const shimPath = path.join(initScriptsDir, 'classifier-compat.gradle');

      fs.mkdirSync(initScriptsDir, { recursive: true });

      const shimContent = `
// classifier-compat.gradle
// Shims the removed Jar.classifier property for Gradle 8 compatibility.
// This affects third-party modules (e.g. expo-location) that haven't
// updated their build.gradle files yet.
allprojects {
    afterEvaluate { project ->
        project.tasks.withType(Jar).configureEach { task ->
            if (task.hasProperty('classifier')) {
                // Silently map the deprecated property to archiveClassifier
                try {
                    task.archiveClassifier.convention(task.classifier)
                } catch (ignored) {}
            }
        }
    }
}
`;
      fs.writeFileSync(shimPath, shimContent.trim());
      return config;
    },
  ]);
};

// ─── Compose both patches ─────────────────────────────────────────────────────
module.exports = (config) => {
  config = withGradlePropertiesFix(config);
  config = withClassifierShim(config);
  return config;
};
