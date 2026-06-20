import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json({
    ok: true,
    message: "Rota preparada. A atualização automática será ligada ao loop depois que os produtos estiverem importando corretamente.",
  });
}
