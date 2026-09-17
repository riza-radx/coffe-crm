import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

/** A row the actor may not see is reported as missing, so existence never leaks. */
export const notFound = (code = "NOT_FOUND") => new ApiError(404, code);
export const forbidden = (code = "FORBIDDEN") => new ApiError(403, code);
export const conflict = (code: string, details?: unknown) => new ApiError(409, code, details);
export const unprocessable = (code: string, details?: unknown) => new ApiError(422, code, details);

export function toResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return NextResponse.json(
      error.details === undefined ? { error: error.code } : { error: error.code, details: error.details },
      { status: error.status },
    );
  }
  throw error;
}

/** Wraps a handler body so thrown ApiErrors become their status codes. */
export async function respond(body: () => Promise<Response>): Promise<Response> {
  try {
    return await body();
  } catch (error) {
    return toResponse(error);
  }
}
