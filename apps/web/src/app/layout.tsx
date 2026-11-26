import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { RegisterServiceWorker } from "@/components/pwa/register-sw";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IIC Platform", template: "%s · IIC Platform" },
  description: "University Innovation Incubation Cell management platform",
  applicationName: "IIC Platform",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iOS "Add to Home Screen" ignores the manifest and needs this PNG.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: { capable: true, title: "IIC", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#FFFFFF", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster theme="light" position="bottom-right" richColors closeButton />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
