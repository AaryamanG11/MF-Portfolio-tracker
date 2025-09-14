// === process_sip_queue Edge Function ===
// Runs on Deno (Supabase Edge). It picks SIPs from the middle table (sip_queue)
// that are due today or overdue, fetches NAV from mfapi.in, and either inserts
// or (in this version) UPDATES a single aggregate SIP row per Holder+Scheme in
// your 'portfolio' table. It also retries failed rows up to 3 times.

import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Helper: convert 'dd-mm-yyyy' (mfapi) -> 'yyyy-mm-dd'
function dmyToIso(dmy: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dmy || "");
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

serve(async () => {
  try {
    // 0) Env + client (set these in Dashboard → Edge Functions → Secrets)
    //    Key names are PROJECT_URL and SERVICE_ROLE_KEY (no SUPABASE_ prefix)
    const SUPABASE_URL = Deno.env.get("PROJECT_URL")!;
    const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

    // 1) Build "today" in ISO (yyyy-mm-dd)
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayISO = `${yyyy}-${mm}-${dd}`;

    // 2) Load queue: include overdue "pending" and "failed" (retry < 3)
    //    This lets the worker catch up if a day was missed or mfapi had an outage.
    const { data: queue, error: qErr } = await sb
      .from("sip_queue")
      .select("*")
      .or(
        `and(status.eq.pending,scheduled_for.lte.${todayISO}),` +
        `and(status.eq.failed,scheduled_for.lte.${todayISO},retry_count.lt.3)`
      )
      .order("scheduled_for", { ascending: true });

    if (qErr) throw qErr;

    for (const q of queue || []) {
      try {
        // 3) Fetch latest NAV for this scheme_code
        const res = await fetch(`https://api.mfapi.in/mf/${q.scheme_code}`);
        const json = await res.json();
        const latest = json?.data?.[0];
        if (!latest?.nav) throw new Error("NAV missing from mfapi.in response");

        const nav = parseFloat(latest.nav);
        if (!Number.isFinite(nav) || nav <= 0) throw new Error("Invalid NAV from mfapi");
        const navDateISO = dmyToIso(latest.date) || todayISO;

        // 4) Compute BUY units for this month (SIP installment)
        const deltaUnits = Number(q.monthly_amount) / nav;

        // 5) UPSERT into portfolio: single aggregate SIP row per Holder+Scheme
        // Try to find existing SIP aggregate row (is_sip = true)
        const { data: existingRows, error: findErr } = await sb
          .from("portfolio")
          .select("id, units, buy_value, first_sip_date")
          .eq("holder_name", q.holder_name)
          .eq("scheme_code", q.scheme_code)
          .eq("is_sip", true)
          .limit(1);

        if (findErr) throw findErr;

        let portfolioId: number;

        if (existingRows && existingRows.length > 0) {
          // 5a) Update cumulative amounts on the existing aggregate row
          const row = existingRows[0];
          const newUnits = Number(row.units || 0) + deltaUnits;
          const newBuyValue = Number(row.buy_value || 0) + Number(q.monthly_amount);
          const newBuyPrice = newUnits > 0 ? newBuyValue / newUnits : nav; // weighted average
          const newCurrentValue = newUnits * nav;

          const { error: updErr } = await sb
            .from("portfolio")
            .update({
              transaction_type: "buy",          // for clarity
              units: newUnits,
              buy_price: newBuyPrice,           // weighted average
              buy_value: newBuyValue,           // total invested via SIP
              current_nav: nav,
              current_value: newCurrentValue,
              trade_date: q.scheduled_for,      // optional: last SIP date
              nav_date: navDateISO,
              fund_house: q.fund_house || null,
              fund_category: q.fund_category || null,
              fund_sub_category: q.fund_sub_category || null,
              last_sip_date: q.scheduled_for,
              first_sip_date: row.first_sip_date || q.scheduled_for
            })
            .eq("id", row.id);

          if (updErr) throw updErr;
          portfolioId = row.id;

        } else {
          // 5b) Insert a brand-new aggregate SIP row
          const units = deltaUnits;
          const buyValue = Number(q.monthly_amount);
          const currentValue = units * nav;

          const payload = {
            holder_name: q.holder_name,
            scheme_code: q.scheme_code,
            scheme_name: q.scheme_name,
            transaction_type: "buy",
            is_sip: true,                     // mark as SIP aggregate
            units,
            buy_price: nav,                   // first buy = today's nav
            buy_value: buyValue,              // invested so far
            current_nav: nav,
            current_value: currentValue,
            trade_date: q.scheduled_for,      // initial trade date
            nav_date: navDateISO,
            fund_house: q.fund_house || null,
            fund_category: q.fund_category || null,
            fund_sub_category: q.fund_sub_category || null,
            first_sip_date: q.scheduled_for,
            last_sip_date: q.scheduled_for
          };

          const { data: inserted, error: insErr } = await sb
            .from("portfolio")
            .insert([payload])
            .select("id")
            .single();

          if (insErr) throw insErr;
          portfolioId = inserted.id;
        }

        // 6) Mark queue row as completed (reset retry_count)
        await sb
          .from("sip_queue")
          .update({
            status: "completed",
            run_at: new Date().toISOString(),
            portfolio_row_id: portfolioId,
            retry_count: 0
          })
          .eq("id", q.id);

      } catch (e: any) {
        // Mark row as failed and bump retry_count
        await sb
          .from("sip_queue")
          .update({
            status: "failed",
            run_at: new Date().toISOString(),
            error: String(e?.message || e),
            retry_count: (q.retry_count ?? 0) + 1
          })
          .eq("id", q.id);
      }
    }

    return new Response("SIP queue processed", { status: 200 });
  } catch (e: any) {
    return new Response(String(e?.message || e), { status: 500 });
  }
});