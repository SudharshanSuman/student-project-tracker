"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

const schema = z
  .object({
    name: z.string().trim().min(1, "Required").max(120),
    department: z.string().trim().max(120).optional(),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function AcceptInvitationForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        try {
          await api("/auth/invitations/accept", { body: { token, name: v.name, department: v.department || null, password: v.password } });
          router.replace("/onboarding");
          router.refresh();
        } catch (e) {
          setError(errorMessage(e));
        }
      })}
    >
      <Field label="Email" htmlFor="email">
        <Input id="email" value={email} disabled readOnly />
      </Field>
      <Field label="Full name" htmlFor="name" error={formState.errors.name?.message}>
        <Input id="name" autoComplete="name" {...register("name")} />
      </Field>
      <Field label="Department (optional)" htmlFor="department">
        <Input id="department" {...register("department")} />
      </Field>
      <Field label="Password" htmlFor="password" error={formState.errors.password?.message} hint="10+ characters with upper, lower case and a number">
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} />
      </Field>
      {error ? <p role="alert" className="text-xs text-red-400">{error}</p> : null}
      <Button className="w-full" disabled={formState.isSubmitting}>Create account</Button>
    </form>
  );
}
