import { NextResponse } from "next/server";
import { resolveApiUrl } from "@/lib/api";

export async function GET() {
  const response = await fetch(resolveApiUrl("/api/v1/dashboard/summary"), {
    cache: "no-store",
  });

  const body = await response.text();
  return new NextResponse(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "application/json",
    },
  });
}
