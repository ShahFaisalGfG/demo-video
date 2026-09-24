import argparse
import json
import time
from pathlib import Path


ACTIONS = {
    "wait", "move", "click", "doubleClick", "drag", "type", "hotkey", "press",
    "scroll", "screenshot", "imageClick", "assertImage", "waitImage",
}


def validate(definition: dict) -> None:
    """Validate desktop actions without importing display automation libraries."""
    for index, step in enumerate(definition.get("steps", [])):
        action = step.get("action")
        if action not in ACTIONS:
            raise ValueError(f"Unsupported desktop action at step {index}: {action}")
        if action in {"imageClick", "assertImage", "waitImage"} and not step.get("image"):
            raise ValueError(f"Desktop step {index} requires image.")
        if action == "hotkey" and not step.get("keys"):
            raise ValueError(f"Desktop step {index} requires keys.")


def point(step: dict, screen: tuple[int, int]) -> tuple[int | None, int | None]:
    """Resolve absolute or normalized screen coordinates."""
    if "xRatio" in step or "yRatio" in step:
        return round(float(step.get("xRatio", 0)) * screen[0]), round(float(step.get("yRatio", 0)) * screen[1])
    if "x" in step or "y" in step:
        return int(step.get("x", 0)), int(step.get("y", 0))
    return None, None


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

    import pyautogui

    pyautogui.FAILSAFE = definition.get("capture", {}).get("failSafe", True)
    pyautogui.PAUSE = definition.get("capture", {}).get("actionPauseSeconds", 0.15)
    screen = pyautogui.size()
    source_directory = Path(definition.get("sourceDirectory", Path(args.definition).parent))
    for step in definition.get("steps", []):
        action = step["action"]
        x, y = point(step, screen)
        if action == "wait":
            time.sleep(float(step.get("ms", 1000)) / 1000)
        elif action == "move":
            pyautogui.moveTo(x, y, duration=float(step.get("duration", 0.4)))
        elif action == "click":
            pyautogui.click(x=x, y=y, clicks=int(step.get("clicks", 1)), button=step.get("button", "left"))
        elif action == "doubleClick":
            pyautogui.doubleClick(x=x, y=y, interval=float(step.get("interval", 0.12)))
        elif action == "drag":
            pyautogui.moveTo(x, y, duration=0.2)
            pyautogui.dragTo(int(step["toX"]), int(step["toY"]), duration=float(step.get("duration", 0.6)))
        elif action == "type":
            pyautogui.write(str(step.get("text", "")), interval=float(step.get("interval", 0.04)))
        elif action == "hotkey":
            pyautogui.hotkey(*step["keys"])
        elif action == "press":
            pyautogui.press(step["key"], presses=int(step.get("presses", 1)), interval=float(step.get("interval", 0.05)))
        elif action == "scroll":
            pyautogui.scroll(int(step.get("clicks", 0)), x=x, y=y)
        elif action == "screenshot":
            screenshot = Path(step["path"])
            pyautogui.screenshot(screenshot if screenshot.is_absolute() else source_directory / screenshot)
        else:
            timeout = float(step.get("timeout", 10))
            confidence = float(step.get("confidence", 0.88))
            started = time.time()
            location = None
            image = Path(step["image"])
            image = image if image.is_absolute() else source_directory / image
            while time.time() - started < timeout and location is None:
                location = pyautogui.locateOnScreen(str(image), confidence=confidence)
                if location is None:
                    time.sleep(0.2)
            if action in {"assertImage", "waitImage"} and location is None:
                raise RuntimeError(f"Required image was not visible: {image}")
            if action == "imageClick":
                if location is None:
                    raise RuntimeError(f"Clickable image was not visible: {image}")
                pyautogui.click(pyautogui.center(location))
        if action != "wait":
            time.sleep(float(step.get("pauseAfter", 500)) / 1000)


if __name__ == "__main__":
    main()
