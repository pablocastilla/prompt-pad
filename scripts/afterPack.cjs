const fs = require('node:fs');
const path = require('node:path');

function toWindowsVersion(version) {
  const numericParts = version
    .split(/[.-]/)
    .map(part => Number.parseInt(part, 10))
    .filter(Number.isFinite)
    .slice(0, 4);

  while (numericParts.length < 4) {
    numericParts.push(0);
  }

  return numericParts.join('.');
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return;
  }

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.join(context.packager.projectDir, 'resources', 'icon.ico');

  if (!fs.existsSync(exePath)) {
    throw new Error(`Expected Windows executable at ${exePath}`);
  }

  if (!fs.existsSync(iconPath)) {
    throw new Error(`Expected Windows icon at ${iconPath}`);
  }

  const { rcedit } = await import('rcedit');
  const productName = context.packager.appInfo.productName;
  const productFilename = context.packager.appInfo.productFilename;
  const fileVersion = toWindowsVersion(context.packager.appInfo.version);
  const requestedExecutionLevel = context.packager.platformSpecificBuildOptions.requestedExecutionLevel || 'asInvoker';

  await rcedit(exePath, {
    'version-string': {
      FileDescription: productName,
      ProductName: productName,
      OriginalFilename: exeName,
      InternalName: context.packager.appInfo.productName,
      InternalFilename: productFilename,
    },
    'file-version': fileVersion,
    'product-version': fileVersion,
    icon: iconPath,
    'requested-execution-level': requestedExecutionLevel,
  });
}

module.exports = afterPack;
module.exports.default = afterPack;

