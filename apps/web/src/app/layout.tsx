import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "IIC Platform", template: "%s · IIC Platform" },
  description: "University Innovation Incubation Cell management platform",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#090D16", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
        <Toaster theme="dark" position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
