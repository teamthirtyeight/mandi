import { NextResponse } from "next/server";
import { gbpInr } from "@/lib/fx";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await gbpInr());
}
