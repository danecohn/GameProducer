'use strict';
// electron-builder afterPack hook. We have no Apple Developer ID, so macOS builds are signed ad hoc.
// Apple Silicon refuses to run a modified bundle whose signature no longer matches; an ad-hoc seal keeps it launchable.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;   // a real Developer ID is configured: electron-builder signs and notarizes instead
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('ad-hoc signed and verified ' + app);
};
