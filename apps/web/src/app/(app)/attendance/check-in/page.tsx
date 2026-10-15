import type { Metadata } from "next";
import { CheckIn } from "./check-in";

export const metadata: Metadata = { title: "Check in" };

export default async function CheckInPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <CheckIn token={token ?? ""} />;
}
