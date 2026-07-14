// register.js — Link Lead Native Messaging Host Registry Installer
// Automatically configures the host manifest and registers it in the Windows Registry

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const batPath = path.join(__dirname, 'host.bat');
const templatePath = path.join(__dirname, 'com.linklead.automation.json');

if (!fs.existsSync(batPath)) {
  console.error(`Error: Cannot find host.bat at ${batPath}`);
  process.exit(1);
}

try {
  // 1. Read and update the manifest JSON with absolute path
  let manifest = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  // Escape backslashes for Windows path in JSON
  manifest.path = batPath.replace(/\\/g, '\\\\');
  
  fs.writeFileSync(templatePath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`✓ Updated manifest JSON path to: ${batPath}`);

  // 2. Register key in Windows Registry using reg add
  // HKCU does not require administrator privileges!
  const registryKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.linklead.automation';
  const cmd = `reg add "${registryKey}" /ve /t REG_SZ /d "${templatePath}" /f`;
  
  execSync(cmd);
  console.log('✓ Successfully registered Native Messaging Host in Windows Registry!');
  console.log(`Key: ${registryKey}`);
  console.log(`Value: ${templatePath}`);
} catch (err) {
  console.error(`Failed to register host: ${err.message}`);
  process.exit(1);
}
