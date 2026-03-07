import { NextResponse } from "next/server";

import { syncAllUsers } from "@/lib/scheduler";

export async function GET() {
  const result = await syncAllUsers();
  return NextResponse.json(result);
}
