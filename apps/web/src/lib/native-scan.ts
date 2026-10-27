import { Capacitor } from "@capacitor/core";
import { BarcodeFormat, BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";

/** True only inside the Android app shell (apps/mobile); false in any browser. */
export function canScanNatively(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("BarcodeScanner");
}

/**
 * Pulls the check-in token out of a session QR code. QrPanel encodes
 * `<origin>/attendance/check-in?token=<token>`; the origin is ignored, so a code shown
 * from `localhost` still works because the app posts to its own server.
 */
export function tokenFromQr(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (!url.pathname.endsWith("/attendance/check-in")) return null;
    return url.searchParams.get("token") || null;
  } catch {
    return null;
  }
}

/** Opens the Google code scanner. Resolves to the raw QR text, or null if the user cancelled. */
export async function scanQrCode(): Promise<string | null> {
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
  if (!available) {
    // Normally preinstalled via the barcode_ui manifest entry; this only starts the download.
    await BarcodeScanner.installGoogleBarcodeScannerModule();
    throw new Error("The QR scanner is still downloading. Try again in a moment.");
  }
  try {
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return barcodes[0]?.rawValue ?? null;
  } catch (e) {
    if (e instanceof Error && /cancel/i.test(e.message)) return null;
    throw e;
  }
}
