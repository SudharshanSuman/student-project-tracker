"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { passwordSchema } from "@iic/shared";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

const schema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  if (!token) {
    return (
      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground">
          This reset link is incomplete. <Link className="text-link" href="/forgot-password">Request a new one</Link>.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Choose a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={handleSubmit(async (v) => {
            setError(null);
            try {
              await api("/auth/password/reset", { body: { token, password: v.password } });
              toast.success("Password updated. Sign in with your new password.");
              router.replace("/login");
            } catch (e) {
              setError(errorMessage(e));
            }
          })}
        >
          <Field label="New password" htmlFor="password" error={formState.errors.password?.message} hint="10+ characters with upper, lower case and a number">
            <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} />
          </Field>
          {error ? <p role="alert" className="text-xs bg-destructive px-1 text-foreground">{error}</p> : null}
          <Button className="w-full" disabled={formState.isSubmitting}>Update password</Button>
        </form>
      </CardContent>
    </Card>
  );
}
