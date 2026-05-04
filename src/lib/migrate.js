// Upload base64 images from a list of items to Storage, update state + DB.
import { sb } from "./supabase.js";

export async function migrateImages(items, setItemsFn, saveLocalFn) {
  for (const item of items) {
    try {
      const url = await sb.uploadImage(item.id, item.image);
      const updated = { ...item, image: url };
      await sb.upsert(updated);
      if (setItemsFn) {
        setItemsFn(prev => {
          const next = prev.map(it => it.id === item.id ? updated : it);
          saveLocalFn(next);
          return next;
        });
      }
    } catch {
      // Keep base64 as fallback if upload fails
    }
  }
}

// Upload images + push metadata to Supabase — processes sequentially to avoid rate limits.
export async function migrateAndSync(items, setItemsFn, flashSyncFn) {
  flashSyncFn("syncing");
  let failed = 0;
  for (const item of items) {
    try {
      let toSave = item;
      if (item.image?.startsWith("data:")) {
        try {
          const url = await sb.uploadImage(item.id, item.image);
          toSave = { ...item, image: url };
          if (setItemsFn) {
            setItemsFn(prev => prev.map(it => it.id === item.id ? toSave : it));
          }
        } catch { /* keep base64 in state, upsert without image */ }
      }
      await sb.upsert(toSave);
    } catch { failed++; }
    await new Promise(r => setTimeout(r, 150));
  }
  failed > 0 ? flashSyncFn("error") : flashSyncFn("synced");
}
