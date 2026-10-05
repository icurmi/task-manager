import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'mt.melitafc.playingtime',
  appName: 'Playing Time',
  webDir: 'dist',
  ios: { contentInset: 'never' },
  android: { allowMixedContent: false },
};

export default config;
