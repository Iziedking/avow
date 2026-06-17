// Find the admin cap a connected wallet holds for a given mandate.
//
// Only the mandate's cap holder may add an auditor. We look through the wallet's owned
// MandateCap objects for the one whose mandate_id matches, and use it to gate the owner panel.

import { suiClient } from "./records";
import { PACKAGE_ID } from "./config";

export async function findCapForMandate(
  address: string,
  mandateId: string,
): Promise<string | null> {
  const client = suiClient();
  const res = await client.getOwnedObjects({
    owner: address,
    filter: { StructType: `${PACKAGE_ID}::mandate::MandateCap` },
    options: { showContent: true },
  });
  for (const o of res.data) {
    const content = o.data?.content;
    if (content && content.dataType === "moveObject") {
      const fields = content.fields as Record<string, unknown>;
      if (String(fields.mandate_id) === mandateId) {
        return o.data?.objectId ?? null;
      }
    }
  }
  return null;
}
