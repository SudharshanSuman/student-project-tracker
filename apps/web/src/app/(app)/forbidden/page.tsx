import type { Metadata } from "next";
import { Forbidden } from "@/components/ui/states";

export const metadata: Metadata = { title: "Access restricted" };

export default function ForbiddenPage() {
  return <Forbidden message="Your role does not have access to that page or record. If you think this is wrong, contact an IIC admin." />;
}
