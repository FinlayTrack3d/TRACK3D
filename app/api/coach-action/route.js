import { createClient } from "@supabase/supabase-js";

function supabaseForRequest(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false },
  });
}

export async function POST(request) {
  try {
    const supabase = supabaseForRequest(request);
    if (!supabase) return Response.json({ error: "Coach data service is not configured" }, { status: 503 });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Unauthorised" }, { status: 401 });
    const { actionId, decision } = await request.json();
    if (!actionId || !["apply", "approve", "reject"].includes(decision)) return Response.json({ error: "Invalid action request" }, { status: 400 });

    if (decision === "reject") {
      const { error } = await supabase.from("coach_actions").update({ status: "rejected" }).eq("id", actionId).eq("user_id", user.id);
      return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ status: "rejected" });
    }

    const { data, error } = await supabase.rpc("apply_coach_action", { action_uuid: actionId, approve_permanent: decision === "approve" });
    return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ action: data });
  } catch (error) {
    console.error("Coach action route error:", error.message);
    return Response.json({ error: "Could not update Coach action" }, { status: 500 });
  }
}
