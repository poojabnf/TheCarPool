const { withAppDelegate } = require('@expo/config-plugins');

module.exports = function withFirebaseAppDelegate(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language === 'objc' || config.modResults.language === 'objcpp') {
      // Add the import
      if (!config.modResults.contents.includes('#import <Firebase.h>')) {
        config.modResults.contents = config.modResults.contents.replace(
          '#import "AppDelegate.h"',
          '#import "AppDelegate.h"\n#import <Firebase.h>'
        );
      }
      // Add the configuration call
      if (!config.modResults.contents.includes('[FIRApp configure]')) {
        config.modResults.contents = config.modResults.contents.replace(
          /didFinishLaunchingWithOptions:\(NSDictionary \*\)launchOptions\s*\{/,
          'didFinishLaunchingWithOptions:(NSDictionary *)launchOptions\n{\n  [FIRApp configure];'
        );
      }
    }
    return config;
  });
};
