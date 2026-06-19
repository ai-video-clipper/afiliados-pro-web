import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = {
  params: Promise<{
    code: string;
  }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { code } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("short_links")
    .select("destination_url, click_count")
    .eq("code", code)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.redirect(new URL("/", _request.url));
  }

  await supabase
    .from("short_links")
    .update({
      click_count: (data.click_count || 0) + 1,
    })
    .eq("code", code);

  return NextResponse.redirect(data.destination_url);
}