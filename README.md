# JutsuVerse

JutsuVerse is a real-time two-player hand-sign duel. A Phaser client performs
local YOLOX hand-sign recognition while an authoritative TypeScript WebSocket
server owns rooms, countdowns, sequences, clashes, shields, damage, and
rematches.

## Game flow

1. Create a room or join with its six-character code.
2. Both players enable their cameras.
3. Both players press **Start**.
4. The server runs the synchronized `3 → 2 → 1 → 0` countdown.
5. Players form server-validated jutsu sequences until one player's 20 HP
   reaches zero.
6. Both players press **Ready** to reset and begin another countdown.

## Combat rules

- Elements counter in this cycle: `Fire > Wind > Earth > Water > Fire`.
- Level 1 uses three signs and deals 1 base damage.
- Level 2 adds sign 12 and deals 2 base damage.
- Level 3 adds signs 12 and 13 and deals 4 base damage.
- Attacks performed within one second clash. Elemental advantage deals 15;
  otherwise the higher level deals the difference between base damages.
- An unopposed attack deals its base damage and clears the defender's stored
  signs.
- Shield is signs `13, 12`; sign 12 must remain held. It lasts at most three
  seconds, blocks one attack for zero damage, and consumes one of three shields.
- Every five attacks by both players combined, combat freezes for the **6-7
  contest**: both players perform the 6-7 gesture on camera and the first to 67
  reps restores 10 HP (nothing happens if they are already at full health). A
  60-second cap awards it to whoever leads, so a dropped camera cannot hang the
  match; a tie heals no one. The counter re-arms, so it triggers again at ten
  attacks, fifteen, and so on.

The attack definitions and image paths live in `shared/skills.ts`. The 14 valid
model classes (`0..13`) are mapped in `shared/handSigns.ts`; raw class 14 is an
ignored `unknown` output.

## Project structure

```text
packages/protocol/       Validated WebSocket messages and public state
shared/                  Hand-sign and jutsu catalogues shared by client/server
server/                  Authoritative TypeScript room and combat server
frontend/                Phaser UI, YOLOX camera recognition, and WebRTC video
frontend/src/lab/        MediaPipe 6-7 rep detection (its own lab page, reused in battle)
backend/                 Legacy Python prototype (not used by root scripts)
```

## Run locally

Install dependencies from the repository root:

```powershell
npm install
```

Start the server and Vite client together:

```powershell
npm run dev
```

Open `http://localhost:5173` in two browser windows. Vite proxies `/ws` to the
game server on port 8080.

## Verification

```powershell
npm run typecheck
npm -w server test
npm -w frontend run build
```
