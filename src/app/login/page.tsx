import { Card } from "@/components/ui/field";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <h1 className="text-xl font-semibold">Rei CRM</h1>
        <p className="mb-6 mt-1 text-sm text-[var(--muted)]">
          Hyrja bëhet vetëm me ftesë. Nuk ka regjistrim publik.
        </p>
        <LoginForm />
      </Card>
    </main>
  );
}
