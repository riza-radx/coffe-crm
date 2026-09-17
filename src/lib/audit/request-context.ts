/**
 * `audit_logs.ip_address` comes from the request, but services never see a
 * `Request`: route handlers read it here and pass the value down, so the service
 * layer stays callable from a job or a server component.
 */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip");
}
