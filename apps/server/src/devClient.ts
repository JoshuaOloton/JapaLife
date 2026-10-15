/**
 * Dev-only text client for play-testing the server before the real client
 * exists. Run it with `pnpm --filter @japalife/server dev:client [playerId]`
 * while the server is running. It sends intents like the real client will and
 * prints what the server says back.
 */
import { createInterface } from "node:readline/promises";
import { Client, type Room } from "@colyseus/sdk";
import {
  DISTRICT_ROOM_NAME,
  DEFAULT_SERVER_PORT,
  type InteractionMessage,
  type NoticeMessage,
  type RejectedMessage,
  type StatsMessage,
} from "@japalife/shared";
import { loadContent } from "./content/loadContent";

const playerId = process.argv[2] ?? "dev-player";
const url = process.env["NEXT_PUBLIC_SERVER_URL"] ?? `ws://localhost:${DEFAULT_SERVER_PORT}`;

const content = loadContent();
const district = content.cities["lagos"]!.districts[0]!;
const naira = (kobo: number): string => `N${(kobo / 100).toLocaleString("en-NG")}`;

const room: Room = await new Client(url).joinOrCreate(DISTRICT_ROOM_NAME, { playerId });
console.log(`joined ${district.name} as "${playerId}". Type "help".`);

let last: StatsMessage | undefined;
room.onMessage("stats", (s: StatsMessage) => {
  last = s;
});
room.onMessage("notice", (n: NoticeMessage) => console.log(`\n  [${n.kind}] ${n.title}: ${n.message}`));
room.onMessage("rejected", (r: RejectedMessage) => console.log(`\n  refused ${r.intent}: ${r.reason}`));
room.onMessage("interaction", (i: InteractionMessage) => console.log(`\n  ${i.targetId} is a ${i.kind}`));

const me = (): { x: number; z: number } => room.state.players.get(room.sessionId);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let moveSeq = 0;

function printStats(): void {
  if (!last) return console.log("  (no stats yet)");
  const s = last;
  const { x, z } = me();
  console.log(
    [
      `  money   ${naira(s.balanceKobo)}`,
      `  hunger  ${s.hunger}/100 (0 = starving)   energy ${s.energy}/100`,
      `  rent    ${naira(s.rentAmountKobo)} due ${s.rentDueAt} (${s.rentStatus})`,
      `  shifts  ${s.shiftsToday}/${s.maxShiftsToday} today` +
        (s.activeShift ? `, working until ${s.activeShift.endsAt}` : ""),
      s.blackoutEndsAt ? `  POWER CUT until ${s.blackoutEndsAt}` : "",
      s.foodPriceRisePercent ? `  food prices +${s.foodPriceRisePercent}%` : "",
      `  you are at (${x.toFixed(1)}, ${z.toFixed(1)})`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** Walks toward a target at full speed until within reach, like holding a joystick. */
async function walkTo(targetId: string): Promise<void> {
  const target = district.interactables.find((thing) => thing.id === targetId);
  if (!target) return console.log("  unknown place. Type 'places'.");
  for (let step = 0; step < 600; step++) {
    const { x, z } = me();
    const dx = target.position.x - x;
    const dz = target.position.z - z;
    const distance = Math.hypot(dx, dz);
    if (distance <= district.interactRadius * 0.6) break;
    room.send("move", { seq: ++moveSeq, dx: dx / distance, dz: dz / distance });
    await sleep(100);
  }
  room.send("move", { seq: ++moveSeq, dx: 0, dz: 0 });
  await sleep(150);
  console.log(`  arrived at ${targetId}`);
}

const HELP = `
  stats                  money, hunger, energy, rent, shifts
  places                 what is in this district
  walk <place>           walk to a place, e.g. walk yaba-office
  work                   start a shift (at the office)
  eat <food> [qty]       buy food (at the buka), e.g. eat jollof-rice
  rent                   pay rent (at home)
  interact <place>       ask what a place is
  foods                  food ids and prices
  quit`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
for (;;) {
  let line: string;
  try {
    line = await rl.question("\n> ");
  } catch {
    break; // input closed (Ctrl-D or piped input ended)
  }
  const [command, arg, extra] = line.trim().split(/\s+/);
  switch (command) {
    case "help":
      console.log(HELP);
      break;
    case "stats":
      printStats();
      break;
    case "places":
      for (const t of district.interactables) {
        console.log(`  ${t.id.padEnd(20)} ${t.kind.padEnd(13)} at (${t.position.x}, ${t.position.z})`);
      }
      break;
    case "foods":
      for (const f of content.ngn.food) console.log(`  ${f.id.padEnd(14)} ${naira(f.priceKobo)}  +${f.hungerRestored} hunger`);
      break;
    case "walk":
      await walkTo(arg ?? "");
      break;
    case "work":
      room.send("work", { jobId: "office-assistant" });
      break;
    case "eat":
      room.send("buyFood", { itemId: arg ?? "", quantity: Number(extra ?? 1) });
      break;
    case "rent":
      room.send("payRent", {});
      break;
    case "interact":
      room.send("interact", { targetId: arg ?? "" });
      break;
    case "quit":
    case "exit":
      await room.leave();
      rl.close();
      process.exit(0);
      break;
    default:
      console.log("  unknown command. Type 'help'.");
  }
  await sleep(300); // let the server's reply arrive before showing the prompt
  if (["work", "eat", "rent"].includes(command ?? "")) printStats();
}
await room.leave();
process.exit(0);
