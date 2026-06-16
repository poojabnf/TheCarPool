module.exports = function(api) {
  api.cache(true);
  return {
    // expo-router's babel plugin is bundled into babel-preset-expo since SDK 50.
    presets: ['babel-preset-expo'],
  };
};
