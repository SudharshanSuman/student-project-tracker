import type { CapacitorConfig } from "@capacitor/cli";

// The APK is a thin native shell: it loads the deployed IIC web app from this URL,
// so every page, login and API call is served by the existing Next.js + Express stack.
// Set CAP_SERVER_URL before `npm run sync` (or the GitHub Actions input) to change it.
// The default is the dev machine's LAN address; for production use the HTTPS URL.
const serverUrl = process.env.CAP_SERVER_URL ?? "http://192.168.83.45:3000";

const config: CapacitorConfig = {
  appId: "edu.karunya.iic",
  appName: "IIC Platform",
  webDir: "www",
  server: {
    url: serverUrl,
    // Plain HTTP is only allowed for a LAN dev server; production should be https://.
    cleartext: serverUrl.startsWith("http://"),
  },
};

export default config;
