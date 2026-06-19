import { getSuiClient } from "avow-sdk";
const sui = getSuiClient();
async function main() {
  const mod: any = await sui.getNormalizedMoveModule({ package: "0x82593828ed3fcb8c6a235eac9abd0adbe9c5f9bbffa9b1e7a45cdd884481ef9f", module: "wal_exchange" });
  for (const [name, fn] of Object.entries<any>(mod.exposedFunctions)) {
    if (/exchange|wal/i.test(name)) {
      console.log(name, "(", fn.parameters.map((p:any)=>typeof p==="string"?p:JSON.stringify(p)).join(", "), ")", fn.isEntry?"[entry]":"");
    }
  }
}
main().catch(e=>console.error((e as Error).message));
