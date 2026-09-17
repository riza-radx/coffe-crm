// Next.js 16 renamed middleware.ts to proxy.ts; it runs on the Node.js runtime.
export { auth as proxy } from "@/auth";

export const config = {
  // Pages only. API routes authenticate themselves and answer 401/403 as JSON
  // instead of redirecting to the login page.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
