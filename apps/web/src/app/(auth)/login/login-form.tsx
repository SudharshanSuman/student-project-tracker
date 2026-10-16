"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@iic/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/states";
import { api, errorMessage } from "@/lib/api-client";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    setError(null);
    try {
      await api("/auth/login", { body: values });
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sign in</CardTitle>
        <CardDescription>Use your institutional email. Accounts are created by invitation only.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" aria-invalid={!!formState.errors.email} {...register("email")} />
          </Field>
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register("password")} />
          </Field>
          {error ? (
            <p role="alert" className="rounded-md border border-foreground bg-destructive px-3 py-2 text-xs bg-destructive px-1 text-foreground">
              {error}
            </p>
          ) : null}
          <Button type="submit" className="w-full" disabled={formState.isSubmitting}>
            {formState.isSubmitting ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs">
            <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">
              Forgot password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
