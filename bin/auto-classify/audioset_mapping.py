"""AudioSet (YAMNet) display name → Paperstem coarse SegmentType.

Kept in sync by hand with src/client/lib/auto-classify/audioset-mapping.ts.
If you change the rules here, mirror them there.
"""
from __future__ import annotations

MIN_CONFIDENCE = 0.1

# Coarse class → AudioSet display names that map to it. Curated set; extend
# as real-audio runs reveal which AudioSet classes actually fire on band
# practice audio. See scripts/poc/findings-phase-0.md.
_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("silence", ("Silence",)),
    ("tuning", ("Tuning fork", "Tuning instrument")),
    (
        "chatter",
        (
            "Speech",
            "Conversation",
            "Whispering",
            "Narration, monologue",
            "Male speech, man speaking",
            "Female speech, woman speaking",
        ),
    ),
    (
        "music",
        (
            "Music",
            "Singing",
            "Drum kit",
            "Drum",
            "Snare drum",
            "Bass drum",
            "Guitar",
            "Electric guitar",
            "Acoustic guitar",
            "Bass guitar",
            "Piano",
            "Keyboard (musical)",
            "Strum",
            "Plucked string instrument",
        ),
    ),
]


def _class_for(name: str) -> str | None:
    for paperstem, names in _RULES:
        if name in names:
            return paperstem
    return None


def map_top_classes_to_segment_type(top: list[tuple[str, float]]) -> str:
    """Map a window's top-K predictions (name, score) to a SegmentType."""
    if not top:
        return "unknown"
    name, score = top[0]
    if score < MIN_CONFIDENCE:
        return "unknown"
    return _class_for(name) or "unknown"
