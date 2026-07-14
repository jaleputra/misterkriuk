import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY
);

async function check() {
  const since = new Date();
  since.setHours(0,0,0,0);
  console.log("since.toISOString():", since.toISOString());

  const txRes = await supabase
    .from("transactions")
    .select("*")
    .gte("created_at", since.toISOString());

  if (txRes.error) {
    console.error("tx error:", txRes.error);
    return;
  }

  console.log("tx count:", txRes.data.length);
  if (txRes.data.length > 0) {
    console.log("First transaction:", txRes.data[0]);
    const txIds = txRes.data.map(t => t.id);
    const itemsRes = await supabase
      .from("transaction_items")
      .select("*")
      .in("transaction_id", txIds);
    if (itemsRes.error) {
      console.error("items error:", itemsRes.error);
    } else {
      console.log("items count:", itemsRes.data.length);
      if (itemsRes.data.length > 0) {
        console.log("First item:", itemsRes.data[0]);
      }
    }
  }
}

check();
