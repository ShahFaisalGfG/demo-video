import argparse
import ctypes
import hashlib
import json
import math
import random
import sys
import time
from pathlib import Path


ACTIONS = {
    "wait", "move", "click", "doubleClick", "drag", "type", "hotkey", "press",
    "scroll", "screenshot", "imageClick", "assertImage", "waitImage",
}


def capture_settings(definition: dict) -> dict:
    """Merge the root capture settings with this platform's overrides."""
    capture = definition.get("capture", {})
    return {**capture, **capture.get("platforms", {}).get(sys.platform, {})}


def validate(definition: dict) -> None:
    """Validate desktop actions without importing display automation libraries."""
    if capture_settings(definition).get("motion", "human") not in {"human", "linear"}:
        raise ValueError('capture.motion must be "human" or "linear".')
    for index, step in enumerate(definition.get("steps", [])):
        action = step.get("action")
        if action not in ACTIONS:
            raise ValueError(f"Unsupported desktop action at step {index}: {action}")
        if action in {"imageClick", "assertImage", "waitImage"} and not step.get("image"):
            raise ValueError(f"Desktop step {index} requires image.")
        if action == "hotkey" and not step.get("keys"):
            raise ValueError(f"Desktop step {index} requires keys.")
        if action == "drag" and not {"toX", "toY"} <= step.keys():
            raise ValueError(f"Desktop step {index} requires toX and toY.")


def point(step: dict, screen: tuple[int, int]) -> tuple[int | None, int | None]:
    """Resolve absolute or normalized screen coordinates."""
    if "xRatio" in step or "yRatio" in step:
        return round(float(step.get("xRatio", 0)) * screen[0]), round(float(step.get("yRatio", 0)) * screen[1])
    if "x" in step or "y" in step:
        return int(step.get("x", 0)), int(step.get("y", 0))
    return None, None


def foreground_title() -> str:
    """Return the title of the window that receives input (Windows)."""
    user32 = ctypes.windll.user32
    window = user32.GetForegroundWindow()
    buffer = ctypes.create_unicode_buffer(user32.GetWindowTextLengthW(window) + 1)
    user32.GetWindowTextW(window, buffer, len(buffer))
    return buffer.value


def minimum_jerk(t: float) -> float:
    """Human reach speed profile: slow start, fast middle, gentle landing."""
    return t * t * t * (10 - 15 * t + 6 * t * t)


def move_duration(distance: float, size: float = 40) -> float:
    """Fitts-law movement time in seconds, matching the browser cursor."""
    return min(1.1, max(0.26, 0.18 + 0.12 * math.log2(1 + distance / max(12, size))))


def human_path(start: tuple[float, float], end: tuple[float, float], rng: random.Random,
               duration: float | None = None) -> tuple[float, list[tuple[float, float]]]:
    """Plan a curved reach with a small overshoot on long moves; returns its duration and equal-time samples."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    distance = math.hypot(dx, dy)
    if distance < 2:
        return 0.0, [end]
    duration = duration or move_duration(distance)
    ux, uy = dx / distance, dy / distance
    bend = rng.uniform(-1, 1) * min(0.18 * distance, 90)
    control = (start[0] + dx * 0.45 - uy * bend, start[1] + dy * 0.45 + ux * bend)
    overshoot = min(distance * 0.025, 10) * rng.uniform(0.6, 1.0) if distance > 280 else 0
    landing = (end[0] + ux * overshoot, end[1] + uy * overshoot)
    reach = 0.86 if overshoot else 1.0
    samples = max(12, round(duration * 60))
    points = []
    for index in range(1, samples + 1):
        t = index / samples
        if t <= reach:
            s = minimum_jerk(t / reach)
            points.append(((1 - s) ** 2 * start[0] + 2 * (1 - s) * s * control[0] + s * s * landing[0],
                           (1 - s) ** 2 * start[1] + 2 * (1 - s) * s * control[1] + s * s * landing[1]))
        else:
            s = minimum_jerk((t - reach) / (1 - reach))
            points.append((landing[0] + (end[0] - landing[0]) * s, landing[1] + (end[1] - landing[1]) * s))
    return duration, points


class Operator:
    """Replays input like a person: curved eased reaches, short dwells, varied key rhythm, stepped scrolling."""

    def __init__(self, pyautogui, capture: dict, seed: str):
        self.gui = pyautogui
        self.human = capture.get("motion", "human") == "human"
        self.window = capture.get("windowTitle")
        self.rng = random.Random(int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16))
        if self.window and sys.platform != "win32":
            print("[desktop-runner] capture.windowTitle is checked on Windows only; continuing without it.")
            self.window = None

    def guard(self) -> None:
        """Stop before any input when the expected window has lost the foreground."""
        if self.window:
            title = foreground_title()
            if self.window not in title:
                raise RuntimeError(f"Input stopped: the foreground window is {title!r}, not {self.window!r}.")

    def glide(self, x: float | None, y: float | None, duration: float | None = None) -> None:
        """Move the pointer to a screen point; no point keeps it where it is."""
        if x is None or y is None:
            return
        self.guard()
        if not self.human:
            self.gui.moveTo(x, y, duration=duration if duration is not None else 0.4)
            return
        start = self.gui.position()
        total, points = human_path(start, (x, y), self.rng, duration)
        width, height = self.gui.size()
        # The arc and overshoot never leave the area spanned by the endpoints and the primary screen,
        # and never touch the zero edge, where PyAutoGUI's fail-safe corner stops the take.
        low_x, low_y = min(start[0], x, 1), min(start[1], y, 1)
        high_x, high_y = max(start[0], x, width - 2), max(start[1], y, height - 2)
        started = time.perf_counter()
        for index, (px, py) in enumerate(points, start=1):
            px, py = min(high_x, max(low_x, px)), min(high_y, max(low_y, py))
            self.gui.moveTo(px, py, _pause=False)
            delay = started + total * index / len(points) - time.perf_counter()
            if delay > 0:
                time.sleep(delay)

    def press(self, button: str = "left") -> None:
        """One click with a human press length."""
        self.guard()
        if not self.human:
            self.gui.click(button=button)
            return
        self.gui.mouseDown(button=button, _pause=False)
        time.sleep(self.rng.uniform(0.06, 0.12))
        self.gui.mouseUp(button=button, _pause=False)

    def click(self, x: float | None, y: float | None, clicks: int = 1, button: str = "left",
              interval: float = 0.0) -> None:
        """Reach the target, settle briefly, then click; human repeat clicks keep a short gap when interval is 0."""
        if not self.human:
            self.guard()
            self.gui.click(x=x, y=y, clicks=clicks, interval=interval, button=button)
            return
        self.glide(x, y)
        time.sleep(self.rng.uniform(0.08, 0.18))
        for index in range(clicks):
            if index:
                time.sleep(interval or self.rng.uniform(0.08, 0.14))
            self.press(button)

    def drag(self, x: float | None, y: float | None, to_x: float, to_y: float, duration: float) -> None:
        """Press at one point and move to another with the button held."""
        if not self.human:
            self.guard()
            self.gui.moveTo(x, y, duration=0.2)
            self.gui.dragTo(to_x, to_y, duration=duration)
            return
        self.glide(x, y)
        self.guard()
        self.gui.mouseDown(_pause=False)
        try:
            time.sleep(self.rng.uniform(0.08, 0.14))
            self.glide(to_x, to_y, max(duration, 0.5))
            time.sleep(self.rng.uniform(0.06, 0.12))
        finally:
            self.gui.mouseUp(_pause=False)

    def type(self, text: str, interval: float) -> None:
        """Type with a varied rhythm and short pauses after words and punctuation; the mean stays near `interval`."""
        if not self.human:
            self.guard()
            self.gui.write(text, interval=interval)
            return
        for char in text:
            self.guard()
            self.gui.write(char, _pause=False)
            pause = interval * self.rng.uniform(0.55, 1.35)
            if char in " ,.;:!?":
                pause += interval * self.rng.uniform(0.6, 1.6)
            time.sleep(pause)

    def scroll(self, clicks: int, x: float | None, y: float | None) -> None:
        """Scroll the wheel in a few steps, the way a hand turns it."""
        if not self.human:
            self.guard()
            self.gui.scroll(clicks, x=x, y=y)
            return
        self.glide(x, y)
        self.guard()
        if abs(clicks) < 2:
            self.gui.scroll(clicks)
            return
        steps = min(8, abs(clicks))
        done = 0
        for index in range(1, steps + 1):
            target = round(clicks * index / steps)
            self.gui.scroll(target - done, _pause=False)
            done = target
            time.sleep(self.rng.uniform(0.05, 0.11))


def locate(gui, step: dict, source_directory: Path):
    """Wait for a reference image on screen and return its box, or None after the timeout."""
    timeout = float(step.get("timeout", 10))
    confidence = float(step.get("confidence", 0.88))
    image = Path(step["image"])
    image = image if image.is_absolute() else source_directory / image
    started = time.time()
    while time.time() - started < timeout:
        try:
            found = gui.locateOnScreen(str(image), confidence=confidence)
        except gui.ImageNotFoundException:
            found = None
        if found is not None:
            return found
        time.sleep(0.2)
    return None


def main() -> None:
    """Replay a validated native desktop action definition."""
    parser = argparse.ArgumentParser()
    parser.add_argument("definition")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    definition = json.loads(Path(args.definition).read_text(encoding="utf-8"))
    validate(definition)
    if args.validate:
        print(f"validated {len(definition.get('steps', []))} desktop steps")
        return

    # Imported only for a live run: validation must work on hosts without a display.
    import pyautogui

    capture = capture_settings(definition)
    pyautogui.FAILSAFE = capture.get("failSafe", True)
    pyautogui.PAUSE = capture.get("actionPauseSeconds", 0.15)
    screen = pyautogui.size()
    source_directory = Path(definition.get("sourceDirectory", Path(args.definition).parent))
    operator = Operator(pyautogui, capture, str(capture.get("seed", json.dumps(definition.get("steps", [])))))
    for step in definition.get("steps", []):
        action = step["action"]
        x, y = point(step, screen)
        if action == "wait":
            time.sleep(float(step.get("ms", 1000)) / 1000)
        elif action == "move":
            operator.glide(x, y, float(step["duration"]) if "duration" in step else None)
        elif action == "click":
            operator.click(x, y, int(step.get("clicks", 1)), step.get("button", "left"), float(step.get("interval", 0.0)))
        elif action == "doubleClick":
            operator.click(x, y, 2, interval=float(step.get("interval", 0.12)))
        elif action == "drag":
            operator.drag(x, y, int(step["toX"]), int(step["toY"]), float(step.get("duration", 0.6)))
        elif action == "type":
            operator.type(str(step.get("text", "")), float(step.get("interval", 0.09 if operator.human else 0.04)))
        elif action == "hotkey":
            operator.guard()
            pyautogui.hotkey(*step["keys"])
        elif action == "press":
            operator.guard()
            pyautogui.press(step["key"], presses=int(step.get("presses", 1)), interval=float(step.get("interval", 0.05)))
        elif action == "scroll":
            operator.scroll(int(step.get("clicks", 0)), x, y)
        elif action == "screenshot":
            screenshot = Path(step["path"])
            pyautogui.screenshot(screenshot if screenshot.is_absolute() else source_directory / screenshot)
        else:
            location = locate(pyautogui, step, source_directory)
            if location is None:
                raise RuntimeError(f"{'Clickable' if action == 'imageClick' else 'Required'} image was not visible: "
                                   f"{step['image']}")
            if action == "imageClick":
                center = pyautogui.center(location)
                operator.click(center.x, center.y)
        if action != "wait":
            time.sleep(float(step.get("pauseAfter", 500)) / 1000)


if __name__ == "__main__":
    main()
