import { NextResponse } from "next/server";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

export const runtime = "nodejs";

/** The Sui testnet faucet does not allow browser origins, so the request is made server side. */
export async function POST(request: Request) {
  let address = "";
  try {
    address = ((await request.json()) as { address?: string }).address ?? "";
  } catch {
    return NextResponse.json({ error: "Send a JSON body with a Sui address." }, { status: 400 });
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(address ?? "")) {
    return NextResponse.json({ error: "That is not a Sui address." }, { status: 400 });
  }
  try {
    await requestSuiFromFaucetV2({ host: getFaucetHost("testnet"), recipient: address });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The faucet did not respond.";
    // The faucet limits by client, not by recipient: "Too many requests from this client".
    const rateLimited = /rate.?limit|too many/i.test(message);
    return NextResponse.json(
      { error: rateLimited ? "The Sui testnet faucet is rate limiting this network. Claim it at faucet.sui.io instead, which has a separate quota, or wait a few minutes." : message },
      { status: rateLimited ? 429 : 502 },
    );
  }
}
