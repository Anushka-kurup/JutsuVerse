"""
Player client — run one of these per player (separate machine or separate
webcam). All it does is: capture, classify the hand sign, send it to the
server, and render whatever state the server broadcasts back.

Usage:
    python player_client.py --server ws://localhost:8000 --room match1 --player p1
"""

import argparse
import asyncio
import json
import threading
import time

import cv2
import mediapipe as mp
import websockets

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils


# ── reused directly from the original script ──────────────────────
def classify_sign(lm):
    def fu(tip, pip):
        return lm[tip].y < lm[pip].y
    idx = fu(8, 6); mid = fu(12, 10); rng = fu(16, 14); pnk = fu(20, 18)
    if idx and mid and not rng and not pnk: return "SNAKE"
    if idx and not mid and not rng and pnk: return "RAM"
    if not idx and mid and rng and not pnk: return "BOAR"
    if idx and mid and rng and pnk: return "BIRD"
    if not idx and not mid and not rng and not pnk: return "MONKEY"
    if idx and not mid and not rng and not pnk: return "HORSE"
    if not idx and not mid and rng and pnk: return "DOG"
    if idx and mid and not rng and pnk: return "OX"
    if not idx and mid and not rng and not pnk: return "TIGER"
    if not idx and not mid and not rng and pnk: return "HARE"
    return "UNKNOWN"


latest_state = {"match": None}
outgoing_signs = asyncio.Queue()


async def ws_client(uri, room, player, loop):
    url = f"{uri}/ws/{room}/{player}"
    async with websockets.connect(url) as ws:
        async def sender():
            while True:
                sign = await outgoing_signs.get()
                await ws.send(json.dumps({"type": "sign", "sign": sign}))

        async def receiver():
            async for message in ws:
                data = json.loads(message)
                if data.get("type") == "state":
                    latest_state["match"] = data["match"]

        await asyncio.gather(sender(), receiver())


def start_ws_thread(uri, room, player):
    loop = asyncio.new_event_loop()

    def run():
        asyncio.set_event_loop(loop)
        loop.run_until_complete(ws_client(uri, room, player, loop))

    t = threading.Thread(target=run, daemon=True)
    t.start()
    return loop


def draw_bar(frame, x, y, w, h, frac, color, label):
    cv2.rectangle(frame, (x, y), (x + w, y + h), (50, 50, 50), -1)
    cv2.rectangle(frame, (x, y), (x + int(w * max(0, frac)), y + h), color, -1)
    cv2.rectangle(frame, (x, y), (x + w, y + h), (200, 200, 200), 1)
    cv2.putText(frame, label, (x, y - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)


def draw_hud(frame, player_id, match):
    if not match:
        cv2.putText(frame, "Waiting for opponent...", (10, 30),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 200, 255), 2)
        return

    me = match["p1"] if match["p1"]["player_id"] == player_id else match["p2"]
    opp = match["p2"] if match["p1"]["player_id"] == player_id else match["p1"]
    w = frame.shape[1]

    draw_bar(frame, 10, 30, 220, 16, me["hp"] / 100, (0, 0, 255), f"YOU HP {me['hp']:.0f}")
    draw_bar(frame, 10, 60, 220, 12, me["energy"] / 100, (0, 200, 255), f"Energy {me['energy']:.0f}")
    draw_bar(frame, w - 230, 30, 220, 16, opp["hp"] / 100, (0, 0, 255), f"OPP HP {opp['hp']:.0f}")
    draw_bar(frame, w - 230, 60, 220, 12, opp["energy"] / 100, (0, 200, 255), f"Energy {opp['energy']:.0f}")

    cv2.putText(frame, f"Sign: {me['current_sign']}  Effect: {me['active_effect'] or '-'}",
                (10, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 120), 1)
    cv2.putText(frame, f"Reflect x{me['reflect_uses_left']}  Protect x{me['protect_uses_left']}",
                (10, 112), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (200, 200, 0), 1)

    if match.get("winner"):
        h = frame.shape[0]
        text = "YOU WIN!" if match["winner"] == player_id else "YOU DIED"
        color = (0, 255, 0) if match["winner"] == player_id else (0, 0, 255)
        cv2.putText(frame, text, (w // 2 - 120, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.4, color, 4, cv2.LINE_AA)

    for i, line in enumerate(match.get("log", [])[-4:]):
        cv2.putText(frame, line, (10, frame.shape[0] - 15 - i * 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (160, 160, 160), 1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", default="ws://localhost:8000")
    parser.add_argument("--room", default="match1")
    parser.add_argument("--player", required=True, help="unique player id, e.g. p1 or p2")
    args = parser.parse_args()

    ws_loop = start_ws_thread(args.server, args.room, args.player)

    hands = mp_hands.Hands(max_num_hands=1, min_detection_confidence=0.7, min_tracking_confidence=0.6)
    cap = cv2.VideoCapture(0)

    last_sent = ""
    print(f"\nConnecting as {args.player} to room '{args.room}' on {args.server}")
    print("TIGER=FIRE  SNAKE=WATER  BIRD=WIND  RAM=REFLECT  BOAR=PROTECT")
    print("Hold a sign ~1s to confirm. Q to quit.\n")

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        res = hands.process(rgb)

        sign = "UNKNOWN"
        if res.multi_hand_landmarks:
            hand_lm = res.multi_hand_landmarks[0]
            mp_draw.draw_landmarks(frame, hand_lm, mp_hands.HAND_CONNECTIONS)
            sign = classify_sign(hand_lm.landmark)

        if sign != last_sent:
            last_sent = sign
            try:
                asyncio.run_coroutine_threadsafe(outgoing_signs.put(sign), ws_loop)
            except Exception:
                pass

        draw_hud(frame, args.player, latest_state["match"])
        cv2.imshow(f"Duel - {args.player}", frame)
        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
