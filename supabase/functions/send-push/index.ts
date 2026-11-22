import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const privateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const sender = Deno.env.get("VAPID_SUBJECT") || "https://myselfardor-dev.github.io/ugr-messenger/";
    if (!url || !anonKey || !serviceKey || !publicKey || !privateKey) return json({ error: "Push function is not configured" }, 500);

    const authClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: authData, error: authError } = await authClient.auth.getUser();
    if (authError || !authData.user) return json({ error: "Unauthorized" }, 401);

    const { conversation_id, message_id } = await req.json();
    if (typeof conversation_id !== "string" || typeof message_id !== "string") return json({ error: "Invalid payload" }, 400);

    const admin = createClient(url, serviceKey);
    const { data: message, error: messageError } = await admin.from("messages")
      .select("id,conversation_id,sender_id").eq("id", message_id)
      .eq("conversation_id", conversation_id).maybeSingle();
    if (messageError || !message || message.sender_id !== authData.user.id) return json({ error: "Message not found or not owned by caller" }, 403);

    const { data: members, error: membersError } = await admin.from("conversation_members")
      .select("user_id").eq("conversation_id", conversation_id);
    if (membersError) throw membersError;
    const recipientIds = (members || []).map((m) => m.user_id).filter((id) => id !== authData.user.id);
    if (!recipientIds.length) return json({ sent: 0 });

    const { data: subscriptions, error: subscriptionsError } = await admin.from("ugr_push_subscriptions")
      .select("id,user_id,endpoint,subscription").in("user_id", recipientIds);
    if (subscriptionsError) throw subscriptionsError;
    if (!subscriptions?.length) return json({ sent: 0 });

    webpush.setVapidDetails(sender, publicKey, privateKey);
    const payload = JSON.stringify({ title: "UGR MESSENGER", body: "Вам пришло сообщение! Откройте UGR, чтобы посмотреть.", url: "./" });
    let sent = 0;
    const staleIds: number[] = [];
    await Promise.all(subscriptions.map(async (row) => {
      try { await webpush.sendNotification(row.subscription, payload, { TTL: 3600 }); sent++; }
      catch (error) { const status = (error as { statusCode?: number }).statusCode; if (status === 404 || status === 410) staleIds.push(row.id); else console.error("Push delivery failed:", status || error); }
    }));
    if (staleIds.length) await admin.from("ugr_push_subscriptions").delete().in("id", staleIds);
    return json({ sent });
  } catch (error) {
    console.error("send-push:", error);
    return json({ error: "Push delivery failed" }, 500);
  }
});
