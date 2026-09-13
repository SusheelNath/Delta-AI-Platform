"""
Unified intent + entity parser for Delta AI chat.

Replaces the per-action regex approach with a single-pass parser that:
  1. Extracts entities (floor, space, number, category, mode, direction, etc.)
  2. Classifies all matching intents (supports chained commands)
  3. Maps intents × entities → deterministic actions

All entity dictionaries (floor aliases, heatmap modes, categories) live here.
"""

import re
from dataclasses import dataclass, field

from app.services.polygon_intelligence import FLOOR_NAMES, read_all_polygons

# ══════════════════════════════════════════════════════════════════════
# Entity dictionaries
# ══════════════════════════════════════════════════════════════════════

FLOOR_ORDER = ["H003", "H002", "H001", "H000", "H010", "H020", "H030", "H040", "H050"]

FLOOR_MAP = {
    "basement 3": "H003", "basement3": "H003", "basement three": "H003",
    "b3": "H003", "level -3": "H003", "minus 3": "H003", "minus three": "H003",
    "floor -3": "H003", "floor minus 3": "H003", "floor minus three": "H003",
    "basement 2": "H002", "basement2": "H002", "basement two": "H002",
    "b2": "H002", "level -2": "H002", "minus 2": "H002", "minus two": "H002",
    "floor -2": "H002", "floor minus 2": "H002", "floor minus two": "H002",
    "basement 1": "H001", "basement1": "H001", "basement one": "H001",
    "b1": "H001", "level -1": "H001", "minus 1": "H001", "minus one": "H001",
    "floor -1": "H001", "floor minus 1": "H001", "floor minus one": "H001",
    "ground floor": "H000", "ground": "H000", "level 0": "H000",
    "floor 1": "H010", "floor1": "H010", "first floor": "H010", "level 1": "H010", "1st floor": "H010",
    "floor one": "H010", "floor plus 1": "H010", "floor plus one": "H010", "floor +1": "H010",
    "floor 2": "H020", "floor2": "H020", "second floor": "H020", "level 2": "H020", "2nd floor": "H020",
    "floor two": "H020", "floor plus 2": "H020", "floor plus two": "H020", "floor +2": "H020",
    "floor 3": "H030", "floor3": "H030", "third floor": "H030", "level 3": "H030", "3rd floor": "H030",
    "floor three": "H030", "floor plus 3": "H030", "floor plus three": "H030", "floor +3": "H030",
    "floor 4": "H040", "floor4": "H040", "fourth floor": "H040", "level 4": "H040", "4th floor": "H040",
    "floor four": "H040", "floor plus 4": "H040", "floor plus four": "H040", "floor +4": "H040",
    "floor 5": "H050", "floor5": "H050", "fifth floor": "H050", "level 5": "H050", "5th floor": "H050",
    "floor five": "H050", "floor plus 5": "H050", "floor plus five": "H050", "floor +5": "H050",
}

HEATMAP_MODES = {
    "function": "function", "type": "function", "category": "function",
    "color by function": "function", "room types": "function",
    "area": "area", "size": "area", "color by area": "area", "color by size": "area",
    "utilization": "utilization", "usage": "utilization", "used": "utilization",
    "status": "status", "operational": "status",
    "area per bed": "area_per_bed", "bed ratio": "area_per_bed", "area_per_bed": "area_per_bed",
    "occupancy": "occupancy", "capacity": "occupancy", "people": "occupancy",
    "room capacity": "occupancy", "max occupancy": "occupancy",
    "density": "occupancy_density", "people per m2": "occupancy_density",
    "occupancy density": "occupancy_density", "people density": "occupancy_density",
    "evacuation": "evacuation", "emergency": "evacuation", "collection": "evacuation",
    "evacuation capacity": "evacuation", "collection points": "evacuation",
}

CATEGORY_INDICES = {
    "medical": 0, "clinical": 0,
    "circulation": 1,
    "office": 2, "administrative": 2,
    "lab": 3, "laboratory": 3,
    "support": 4,
    "storage": 5,
    "unassigned": 6,
}

DIRECTION_KEYWORDS = {
    "up": "up", "next": "up", "above": "up", "higher": "up", "upstairs": "up",
    "one up": "up", "go up": "up", "move up": "up",
    "down": "down", "previous": "down", "below": "down", "lower": "down", "downstairs": "down",
    "one down": "down", "go down": "down", "move down": "down",
}

UI_TARGETS = {
    "infrastructure": "mep", "mep": "mep", "pipes": "mep", "technical spaces": "mep",
    "directory": "panel_list", "room list": "panel_list", "room directory": "panel_list",
    "statistics": "panel_plan", "stats": "panel_plan",
}

RESET_KEYWORDS = {
    "normal view": "heatmap", "default view": "heatmap", "clear heatmap": "heatmap",
    "clear colors": "heatmap", "clear colours": "heatmap", "turn off heatmap": "heatmap",
    "remove heatmap": "heatmap", "no heatmap": "heatmap", "back to normal": "heatmap",
    "standard view": "heatmap", "plain view": "heatmap",
    "show all types": "filters", "reset filters": "filters", "all categories": "filters",
    "clear filters": "filters", "show all categories": "filters",
    "show all rooms": "filters", "all room types": "filters",
    "show everything": "filters", "unfilter": "filters",
}

CLEAR_PATTERNS = {
    "clear route": "route", "hide route": "route", "remove route": "route",
    "clear path": "route", "hide path": "route", "dismiss route": "route",
    "clear selection": "selection", "deselect": "selection",
    "clear selected": "selection", "unselect": "selection",
    "deselect all": "selection", "remove selection": "selection",
    "clear highlights": "highlights", "remove highlights": "highlights",
    "unhighlight": "highlights", "clear highlight": "highlights",
    "clear search": "search", "clear search results": "search",
    "reset search": "search", "remove search": "search",
}

ROUTE_KEYWORDS = {
    "elevator": "elevator", "lift": "elevator", "elevators": "elevator",
    "staircase": "staircase", "stairs": "staircase", "stairwell": "staircase",
    "stairway": "staircase", "steps": "staircase",
}

EVACUATION_KEYWORDS = [
    "evacuate", "evacuating", "evacuation", "emergency",
    "collect people", "collection point", "collection points",
    "gather people", "assembly point", "assembly area",
    "best rooms to collect", "where to collect",
    "shelter", "safe area",
]

CAPACITY_PLAN_KEYWORDS = [
    "conference room for", "meeting room for", "room for",
    "accommodate", "seat", "fit",
    "thinking to make", "convert to", "use as",
]

CAPACITY_FUNCTIONS = {
    "conference": "conference", "meeting": "meeting", "lecture": "lecture",
    "seminar": "seminar", "training": "training", "workshop": "workshop",
    "assembly": "assembly", "auditorium": "auditorium", "event": "event",
}

# ── New dictionaries for expanded action set ──

CLEAR_ALL_KEYWORDS = [
    "clear everything", "reset everything", "reset all", "clear all",
    "start over", "default everything", "undo everything", "wipe clean",
    "wipe everything", "remove all", "back to default",
]

ZOOM_KEYWORDS = {
    "zoom in": "in", "zoom closer": "in", "magnify": "in",
    "get closer": "in", "closer": "in", "enlarge": "in", "bigger": "in",
    "zoom out": "out", "zoom wider": "out", "zoom back": "out",
    "further out": "out", "smaller": "out", "shrink": "out", "wider view": "out",
    "reset view": "reset", "reset zoom": "reset", "fit view": "reset",
    "fit all": "reset", "zoom to fit": "reset", "see everything": "reset",
    "default zoom": "reset",
}

DRAWER_KEYWORDS = {
    "open toolkit": "open", "open drawer": "open", "open side panel": "open",
    "show toolkit": "open", "show drawer": "open",
    "open metadata": "open", "open space metadata": "open",
    "metadata panel": "open", "info panel": "open", "details panel": "open",
    "open space card": "open", "show space card": "open",
    "space details": "open", "space info": "open",
    "space metadata": "open",
    "pull up details": "open", "pull up metadata": "open",
    "show details": "open", "show info": "open",
    "close toolkit": "close", "close drawer": "close", "close side panel": "close",
    "hide toolkit": "close", "hide drawer": "close",
    "close metadata": "close", "close space card": "close",
    "close info panel": "close", "close details panel": "close",
    "collapse drawer": "close", "minimize drawer": "close",
    "dismiss drawer": "close", "collapse toolkit": "close",
}

TOOLKIT_SECTIONS = {
    "description": "description", "about this room": "description", "room details": "description",
    "room description": "description", "room info": "description",
    "metrics": "metrics", "room data": "metrics", "numbers": "metrics",
    "statistics": "metrics", "room metrics": "metrics", "room stats": "metrics",
    "furnishings": "furnishings", "furniture": "furnishings", "equipment": "furnishings",
    "what's inside": "furnishings", "inventory": "furnishings",
    "routing": "routing", "routes": "routing", "directions": "routing",
    "navigation": "routing", "wayfinding": "routing",
}

PROFILE_KEYWORDS = {
    "full profile": "full", "detailed view": "full", "expand profile": "full",
    "more details": "full", "show all details": "full",
    "full view": "full", "expanded view": "full", "complete profile": "full",
    "compact view": "compact", "compact": "compact", "less details": "compact",
    "summary view": "compact", "brief view": "compact", "minimal view": "compact",
    "condensed view": "compact",
}

CLOSE_CARD_KEYWORDS = [
    "close card", "dismiss card", "close metadata", "close info",
    "hide card", "close details", "remove card", "close the card",
    "dismiss info", "get rid of card",
]

NEW_SESSION_KEYWORDS = [
    "new chat", "start fresh", "new session", "fresh start",
    "new conversation", "start new", "begin new chat", "fresh chat",
    "clean slate", "start again",
]

LOAD_SESSION_KEYWORDS = [
    "load last session", "previous session", "load session",
    "last chat", "previous chat", "restore session",
    "resume session", "continue last chat", "go back to last chat",
    "open last session", "load previous",
]

CLEAR_LEARNINGS_KEYWORDS = [
    "clear learnings", "forget preferences", "forget learnings",
    "clear preferences", "reset learnings", "forget everything you learned",
    "erase learnings", "remove learnings", "wipe learnings",
    "forget what you know", "reset preferences",
]

COMPARE_MODE_KEYWORDS = {
    "enter compare mode": True, "compare mode on": True,
    "start comparing": True, "enable compare": True,
    "turn on compare": True, "activate compare": True,
    "exit compare mode": False, "compare mode off": False,
    "stop comparing": False, "disable compare": False,
    "turn off compare": False, "deactivate compare": False,
    "leave compare": False,
}

VOICE_KEYWORDS = {
    "voice on": "on", "activate voice": "on", "enable voice": "on",
    "start listening": "on", "turn on voice": "on",
    "listen to me": "on", "voice mode on": "on",
    "voice off": "off", "deactivate voice": "off", "disable voice": "off",
    "stop listening": "off", "turn off voice": "off", "mute": "off",
    "voice mode off": "off", "silence": "off",
}

FLOOR_VISIBILITY_VERBS = {
    "show": "show", "reveal": "show", "display": "show", "add": "show",
    "include": "show", "enable": "show",
    "hide": "hide", "remove": "hide", "exclude": "hide",
    "disable": "hide",
}

ZONE_ALIASES = {
    "surgical": "Surgical", "surgery": "Surgical",
    "inpatient": "Inpatient Care", "inpatient care": "Inpatient Care",
    "critical care": "Critical Care", "icu": "Critical Care", "intensive care": "Critical Care",
    "emergency": "Emergency", "er": "Emergency", "a&e": "Emergency",
    "maternity": "Maternity", "obstetrics": "Maternity",
    "outpatient": "Outpatient", "outpatient treatment": "Outpatient Treatment",
    "rehabilitation": "Rehabilitation", "rehab": "Rehabilitation",
    "diagnostics": "Diagnostics", "imaging": "Diagnostics", "radiology": "Diagnostics",
    "clinical support": "Clinical Support",
    "administrative": "Administrative", "admin": "Administrative",
    "operations": "Operations",
    "public": "Public",
    "amenity": "Amenity",
    "technical": "Technical",
    "circulation": "Circulation",
    "staff welfare": "Staff Welfare",
    "facility services": "Facility Services",
    "service": "Service",
    "departmental": "Departmental",
}

# ── Regex patterns ──

_RE_PEOPLE_COUNT = re.compile(
    r"\b(?:for|accommodate|seat|fit|hold)\s+(\d+)\s*(?:people|persons?|staff|seats?)?\b",
    re.IGNORECASE,
)
_RE_PEOPLE_COUNT_BROAD = re.compile(
    r"\b(\d+)\s+(?:people|persons?|staff|seats?)\b",
    re.IGNORECASE,
)

_WORD_ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5,
    "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
    "eleventh": 11, "twelfth": 12, "thirteenth": 13, "fourteenth": 14,
    "fifteenth": 15, "sixteenth": 16, "seventeenth": 17, "eighteenth": 18,
    "nineteenth": 19, "twentieth": 20,
    "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5,
    "6th": 6, "7th": 7, "8th": 8, "9th": 9, "10th": 10,
    "11th": 11, "12th": 12, "13th": 13, "14th": 14, "15th": 15,
    "16th": 16, "17th": 17, "18th": 18, "19th": 19, "20th": 20,
    "last": -1,
    # Voice transcription variants
    "forth": 4, "ford": 4, "fist": 1, "thirst": 1,
    "sick": 6, "sex": 6,
}

# Build ordinal regex pattern dynamically from _WORD_ORDINALS keys
_ORDINAL_RE = (
    "|".join(
        sorted(
            [re.escape(k) for k in _WORD_ORDINALS if not k[0].isdigit()],
            key=len, reverse=True,
        )
    )
    + r"|\d+(?:st|nd|rd|th)"
)

# Matches: "take me to the fifth storage room in the storage drop down please"
# Matches: "select the 3rd patient care room"
# Matches: "show me the second lab"
# Matches: "go to the first corridor room in corridors"
# Shared verb pattern for room selection regexes
_SELECT_VERBS = (
    r"(?:select|show|pick|choose|give|see|display|highlight|"
    r"go\s+to|take\s+me\s+to|navigate\s+to|open|click|click\s+on|"
    r"bring\s+me\s+to|pull\s+up|look\s+at|tell\s+me\s+about|"
    r"what\s+about|how\s+about|"
    r"view|check|check\s+out|inspect|explore|focus\s+on|get|try|"
    r"load|reveal|switch\s+to|zoom\s+to|zoom\s+in\s+on)"
)

_RE_SELECT_ROOM = re.compile(
    r"\b" + _SELECT_VERBS + r"\s+"
    r"(?:me\s+)?(?:the\s+)?"
    r"(" + _ORDINAL_RE + r")\s+"
    r"(.+?)"
    r"(?:\s+(?:room|space|unit))?"
    r"(?:\s+(?:in|from|of|on)\s+(?:the\s+)?(.+?))?"
    r"(?:\s+(?:drop(?:ped)?\s*-?\s*down|directory|list|group|category))?"
    r"(?:\s+please)?\s*$",
    re.IGNORECASE,
)

# Bare ordinal — "select the 4th one" / "open the third one" / "click on the 2nd element"
# Requires expanded_group context to resolve the function name.
_RE_SELECT_BARE_ORDINAL = re.compile(
    r"\b" + _SELECT_VERBS + r"\s+"
    r"(?:me\s+)?(?:the\s+)?"
    r"(" + _ORDINAL_RE + r")\s+"
    r"(?:one|element|item|entry|option|result|room|space|unit|thing|listing)"
    r"(?:\s+(?:in|from|of|on)\s+(?:the\s+)?(.+?))?"
    r"(?:\s+(?:drop(?:ped)?\s*-?\s*down|directory|list|group|category))?"
    r"(?:\s+please)?\s*$",
    re.IGNORECASE,
)

# "show me the next room" / "select the previous one" (with verb)
_RE_NEXT_PREV_VERB = re.compile(
    r"\b" + _SELECT_VERBS + r"\s+"
    r"(?:me\s+)?(?:the\s+)?"
    r"(next|previous|prev|following|preceding)\s+"
    r"(?:one|element|item|entry|option|result|room|space|unit|thing|listing)"
    r"(?:\s+please)?\s*$",
    re.IGNORECASE,
)

# Verb-at-end fallback: "third waiting room select" / "the 3rd item on storage dropdown select"
_SELECT_VERBS_TRAILING = (
    r"(?:select|pick|choose|open|click|show|view|check|inspect|get)"
)
_RE_SELECT_ROOM_VERB_END = re.compile(
    r"^\s*(?:the\s+)?"
    r"(" + _ORDINAL_RE + r")\s+"
    r"(.+?)"
    r"(?:\s+(?:room|space|unit))?"
    r"(?:\s+(?:in|from|of|on)\s+(?:the\s+)?(.+?))?"
    r"(?:\s+(?:drop(?:ped)?\s*-?\s*down|directory|list|group|category))?"
    r"\s+" + _SELECT_VERBS_TRAILING +
    r"(?:\s+(?:it|that|this|please))?\s*$",
    re.IGNORECASE,
)

# "next room" / "previous one" (bare, no verb)
_RE_NEXT_PREV_BARE = re.compile(
    r"^\s*(?:the\s+)?(next|previous|prev|following|preceding)\s+"
    r"(?:one|element|item|entry|option|result|room|space|unit|thing|listing)"
    r"(?:\s+please)?\s*$",
    re.IGNORECASE,
)

_EXPAND_VERBS = (
    r"(?:open|expand|show|select|pull\s+up|go\s+to|navigate\s+to|"
    r"take\s+me\s+to|bring\s+up|display|see|look\s+at|click|click\s+on|"
    r"give\s+me|get|find|browse|list|view|"
    r"explore|check|check\s+out|reveal|what'?s\s+in|what\s+is\s+in|"
    r"tell\s+me\s+about|inspect)"
)

_RE_EXPAND_GROUP = re.compile(
    r"\b" + _EXPAND_VERBS + r"\s+(?:me\s+)?(?:the\s+)?(.+?)\s+"
    r"(drop\s*-?\s*down|directory|list|group|category)\b",
    re.IGNORECASE,
)

# Fallback: "open/expand/show the <function>" without requiring a suffix word
# e.g. "open the waiting rooms", "expand offices", "show me the corridors"
_RE_EXPAND_GROUP_BARE = re.compile(
    r"\b" + _EXPAND_VERBS + r"\s+(?:me\s+)?(?:the\s+)?(?:all\s+)?(.+?)(?:\s+rooms?|\s+spaces?)?\s*$",
    re.IGNORECASE,
)

_RE_COMPARE = re.compile(
    r"\b(?:compare|diff|difference(?:s)?\s+between|side\s+by\s+side)\s+(.+?)\s+(?:and|with|to|&|vs|versus)\s+(.+)",
    re.IGNORECASE,
)

_RE_ALL_FLOORS = re.compile(
    r"\b(show\s+all\s+floors|all\s+floors|whole\s+building|entire\s+building|full\s+building|"
    r"every\s+floor|all\s+levels|see\s+the\s+whole\s+thing|bird'?s?\s*eye|"
    r"overview|full\s+view|building\s+overview|show\s+everything)\b",
    re.IGNORECASE,
)

_RE_SELECT_SPACE = re.compile(
    r"\b(go\s+to|navigate\s+to|show\s+me|select|inspect|zoom\s+(?:to|in\s+on)|"
    r"fly\s+to|take\s+me\s+to|bring\s+me\s+to|point\s+(?:me\s+)?to|"
    r"where\s+is|find\s+me|locate|tell\s+me\s+about|"
    r"view|check|check\s+out|focus\s+on|look\s+at|explore|switch\s+to)\s+"
    r"(?:the\s+)?(.+)",
    re.IGNORECASE,
)

_RE_HIGHLIGHT = re.compile(
    r"\b(?:highlight|mark|emphasize|light\s+up|point\s+out|color|colour)\s+(?:all\s+)?(.+)",
    re.IGNORECASE,
)

_RE_ADJACENT = re.compile(
    r"\b(?:what'?s?\s+(?:next|adjacent|near|close)\s+to|neighbors?\s+of|"
    r"adjacent\s+(?:to|spaces?\s+(?:of|to))|next\s+to|beside|"
    r"near(?:by)?\s+(?:to\s+)?|surrounding\s+(?:spaces?\s+(?:of|to|for)\s*)?|"
    r"around|bordering|close\s+to|whats\s+near)\s+(?:the\s+)?(.+)",
    re.IGNORECASE,
)

_RE_COUNT = re.compile(
    r"\b(?:how\s+many|count\s+(?:the\s+|all\s+)?|number\s+of|total\s+(?:number\s+of\s+)?|"
    r"how\s+much)\s*(.+)",
    re.IGNORECASE,
)

_RE_SEARCH = re.compile(
    r"\b(?:search\s+(?:for)?|look\s+(?:for|up)|look\s+up|locate\s+all|"
    r"where\s+are\s+(?:the\s+|all\s+)?)\s+(.+)",
    re.IGNORECASE,
)

_RE_FLOOR_VISIBILITY = re.compile(
    r"\b(show|hide|reveal|remove|add|display|exclude|include|enable|disable)\s+"
    r"(?:the\s+)?(.+?)\s+(?:in\s+(?:the\s+)?3d|in\s+(?:the\s+)?viewer|"
    r"from\s+(?:the\s+)?(?:3d|viewer|view))\b",
    re.IGNORECASE,
)

_RE_FLY_TO_ZONE = re.compile(
    r"\b(?:go\s+to|fly\s+to|navigate\s+to|show\s+me|take\s+me\s+to|"
    r"bring\s+me\s+to|jump\s+to|move\s+to|switch\s+to|zoom\s+to)\s+"
    r"(?:the\s+)?(.+?)\s+(?:zone|department|wing|ward|unit|section|area)\b",
    re.IGNORECASE,
)


# ══════════════════════════════════════════════════════════════════════
# ParsedIntent dataclass
# ══════════════════════════════════════════════════════════════════════

@dataclass
class ParsedIntent:
    intent_type: str = "query"
    # Navigation
    floor_ref: str | None = None
    direction: str | None = None
    show_all_floors: bool = False
    # Space selection
    space_name: str | None = None
    # Capacity planning
    target_capacity: int | None = None
    target_function: str | None = None
    # Heatmap
    heatmap_mode: str | None = None
    # Filter
    category_name: str | None = None
    category_index: int | None = None
    # UI control
    ui_target: str | None = None
    # Reset
    reset_target: str | None = None
    # Compare
    compare_floors: list[str] = field(default_factory=list)
    compare_action: bool | None = None  # True=enter, False=exit compare mode
    # Route
    route_target: str | None = None
    # Directory
    function_name: str | None = None
    room_index: int | None = None
    # Zoom
    zoom_action: str | None = None
    # Drawer
    drawer_action: str | None = None
    # Toolkit section
    toolkit_section: str | None = None
    # Profile
    profile_mode: str | None = None
    # Voice
    voice_action: str | None = None
    # Zone
    zone_name: str | None = None
    # Search
    search_query: str | None = None
    # Highlight
    highlight_filter: str | None = None
    highlight_target_space: str | None = None
    # Count
    count_query: str | None = None
    # Floor visibility (3D)
    floor_visibility_id: str | None = None
    floor_visibility_action: str | None = None


# ══════════════════════════════════════════════════════════════════════
# Floor resolution (word-boundary, longest-match-first)
# ══════════════════════════════════════════════════════════════════════

_FLOOR_FILLER = re.compile(
    r'(?:\b(?:number|no\.?|num|plus)\s+|[#+]\s*)', re.IGNORECASE,
)

def resolve_floor_id(text: str) -> str | None:
    """Extract a floor ID from natural language text."""
    text_lower = text.lower().strip()
    # Strip filler words: "floor number two" → "floor two"
    text_normalized = _FLOOR_FILLER.sub('', text_lower)
    for alias, fid in sorted(FLOOR_MAP.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(alias) + r'\b', text_normalized):
            return fid
        # Also check original text (in case normalization breaks a phrase)
        if re.search(r'\b' + re.escape(alias) + r'\b', text_lower):
            return fid
    return None


# ══════════════════════════════════════════════════════════════════════
# Polygon name matching (for select_space intent)
# ══════════════════════════════════════════════════════════════════════

def find_polygon_by_name(name: str, polygons: list[dict]) -> dict | None:
    """Find a polygon by name (exact then contains match)."""
    search = name.lower().strip()
    if not search or len(search) < 3:
        return None
    for p in polygons:
        if (p.get("space_name") or "").lower() == search:
            return p
    for p in polygons:
        if search in (p.get("space_name") or "").lower():
            return p
    for p in polygons:
        if search in (p.get("primary_function") or "").lower():
            return p
    return None


# ══════════════════════════════════════════════════════════════════════
# Main parser — returns list of intents (chained actions)
# ══════════════════════════════════════════════════════════════════════

def parse_intents(message: str, polygons: list[dict] | None = None, expanded_group: str | None = None) -> list[ParsedIntent]:
    """Parse a user message into one or more structured intents.

    Extracts all entities, then checks every classifier. Non-conflicting
    intents stack — "go to floor 2 and show occupancy" yields two intents.
    """
    msg = message.strip()
    if not msg:
        return [ParsedIntent()]

    # Clean voice transcription artifacts: trailing/stray punctuation, filler
    # "please? . ." → "please", "room, please." → "room please"
    msg = re.sub(r'[,;]+', ' ', msg)           # commas/semicolons → spaces
    msg = re.sub(r'[?!]+', '', msg)            # strip question/exclamation marks
    msg = re.sub(r'(?:\.\s*){2,}', ' ', msg)   # repeated dots (". . .") → single space
    msg = re.sub(r'\.\s*$', '', msg)           # strip trailing single dot
    msg = re.sub(r'\s{2,}', ' ', msg).strip()  # collapse multiple spaces
    # Strip filler / politeness wrapping (run twice to catch stacked filler)
    for _ in range(2):
        msg = re.sub(r'^(?:hey\s+delta|hi\s+delta|hello\s+delta|delta|'
                     r'can\s+you|could\s+you|would\s+you|will\s+you|do\s+you|'
                     r'i\s+want\s+(?:you\s+)?to|i(?:\'d|\s+would)\s+like\s+(?:you\s+)?to|'
                     r'i\s+need\s+(?:you\s+)?to|'
                     r'just|hey|hi|ok|okay|so|well|actually|basically)\s+',
                     '', msg, flags=re.IGNORECASE)
        msg = re.sub(r'\s+please\s*$', '', msg, flags=re.IGNORECASE)
        msg = re.sub(r'^\s*please\s+', '', msg, flags=re.IGNORECASE)
        msg = msg.strip()
    # Strip trailing voice noise words (leaked from mic)
    msg = re.sub(r'\s+(?:it|that|this|the|a|an|um|uh|eh|ah)\s*$', '', msg, flags=re.IGNORECASE)
    # Voice ordinal homophones: "the for X" → "the fourth X" (voice: "fourth" → "for")
    msg = re.sub(r'\bthe\s+for\b(?=\s+\w)', 'the fourth', msg, flags=re.IGNORECASE)

    msg_lower = msg.lower()
    intents: list[ParsedIntent] = []

    # ── Entity extraction (shared bag) ──

    floor_ref = resolve_floor_id(msg)

    target_capacity = None
    m = _RE_PEOPLE_COUNT.search(msg)
    if m:
        target_capacity = int(m.group(1))
    elif (m := _RE_PEOPLE_COUNT_BROAD.search(msg)):
        target_capacity = int(m.group(1))

    target_function = None
    for kw, fn in sorted(CAPACITY_FUNCTIONS.items(), key=lambda x: -len(x[0])):
        if kw in msg_lower:
            target_function = fn
            break

    direction = None
    words = msg_lower.split()
    for w in words:
        if w in DIRECTION_KEYWORDS:
            direction = DIRECTION_KEYWORDS[w]
            break

    heatmap_mode = None
    for alias, mode in sorted(HEATMAP_MODES.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower:
            heatmap_mode = mode
            break

    category_name = None
    category_index = None
    for cat, idx in sorted(CATEGORY_INDICES.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(cat) + r'\b', msg_lower):
            category_name = cat
            category_index = idx
            break

    ui_target = None
    for alias, target in sorted(UI_TARGETS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower:
            ui_target = target
            break

    reset_target = None
    for alias, target in sorted(RESET_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower:
            reset_target = target
            break

    route_target = None
    for kw, target in sorted(ROUTE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(kw) + r'\b', msg_lower):
            route_target = target
            break

    compare_floors = []
    m = _RE_COMPARE.search(msg)
    if m:
        f1 = resolve_floor_id(m.group(1))
        f2 = resolve_floor_id(m.group(2))
        if f1 and f2:
            compare_floors = [f1, f2]

    show_all_floors = bool(_RE_ALL_FLOORS.search(msg))

    _BARE_REF_WORDS = {
        "one", "element", "item", "entry", "option", "result",
        "room", "rooms", "space", "spaces", "unit", "units",
        "thing", "listing",
    }

    select_room_index = None
    select_room_fn = None
    m = _RE_SELECT_ROOM.search(msg)
    if m:
        ordinal_raw = m.group(1).lower()
        select_room_index = _WORD_ORDINALS.get(ordinal_raw)
        if select_room_index is None:
            # Digit ordinal like "5th" — extract the number
            select_room_index = int(re.match(r'\d+', ordinal_raw).group())
        # Function name: prefer the "in <group>" part (group 3), fall back to object (group 2)
        select_room_fn = (m.group(3) or m.group(2)).strip()
        # If "in <group>" captured a floor reference, use the main capture instead
        if m.group(3) and resolve_floor_id(m.group(3)):
            select_room_fn = m.group(2).strip()
        # Strip cross-floor references: "storage room on floor 2" → "storage room"
        select_room_fn = re.sub(r'\s+(?:on|in|from)\s+(?:the\s+)?(?:floor|level)\s+\S+$', '', select_room_fn, flags=re.IGNORECASE)
        # Clean trailing noise from function name
        select_room_fn = re.sub(r'\s+(rooms?|spaces?|units?)$', '', select_room_fn, flags=re.IGNORECASE)
        select_room_fn = re.sub(r'[\s,;.?!]+$', '', select_room_fn)  # trailing punctuation
        select_room_fn = re.sub(r'\s+(?:drop\s*-?\s*down|directory|list|group|category)$', '', select_room_fn, flags=re.IGNORECASE)
        select_room_fn = re.sub(r'\s+please$', '', select_room_fn, flags=re.IGNORECASE)
        # If function name is a bare reference word ("one", "element"), it's not a real function —
        # reset and let the bare ordinal fallback handle it
        if select_room_fn.lower() in _BARE_REF_WORDS:
            select_room_index = None
            select_room_fn = None

    # Bare ordinal fallback: "select the 4th one" or "select the 3rd item on the waiting room dropdown"
    # Uses expanded_group as function name, or extracts group from "on/in the X dropdown" suffix
    if select_room_index is None:
        m_bare = _RE_SELECT_BARE_ORDINAL.search(msg)
        if m_bare:
            ordinal_raw = m_bare.group(1).lower()
            select_room_index = _WORD_ORDINALS.get(ordinal_raw)
            if select_room_index is None:
                select_room_index = int(re.match(r'\d+', ordinal_raw).group())
            # Prefer inline group name ("on the waiting room dropdown") over expanded_group context
            inline_group = (m_bare.group(2) or "").strip() if m_bare.lastindex >= 2 else ""
            if inline_group:
                # Clean trailing room/space/unit noise
                inline_group = re.sub(r'\s+(rooms?|spaces?|units?)$', '', inline_group, flags=re.IGNORECASE)
                inline_group = re.sub(r'[\s,;.?!]+$', '', inline_group)
                select_room_fn = inline_group
            elif expanded_group:
                select_room_fn = expanded_group
            else:
                # No context — can't resolve, reset
                select_room_index = None

    # Verb-at-end fallback: "third waiting room select" / "the 3rd item on storage dropdown select"
    if select_room_index is None:
        m_end = _RE_SELECT_ROOM_VERB_END.search(msg)
        if m_end:
            ordinal_raw = m_end.group(1).lower()
            select_room_index = _WORD_ORDINALS.get(ordinal_raw)
            if select_room_index is None:
                select_room_index = int(re.match(r'\d+', ordinal_raw).group())
            # Prefer inline group (group 3), fall back to object (group 2)
            raw_fn = (m_end.group(3) or m_end.group(2)).strip()
            # If inline group is a floor reference, use object instead
            if m_end.group(3) and resolve_floor_id(m_end.group(3)):
                raw_fn = m_end.group(2).strip()
            raw_fn = re.sub(r'\s+(rooms?|spaces?|units?)$', '', raw_fn, flags=re.IGNORECASE)
            raw_fn = re.sub(r'[\s,;.?!]+$', '', raw_fn)
            raw_fn = re.sub(r'\s+(?:drop(?:ped)?\s*-?\s*down|directory|list|group|category)$', '', raw_fn, flags=re.IGNORECASE)
            if raw_fn.lower() in _BARE_REF_WORDS:
                # "item on the waiting room" — extract inline group from group 3
                inline = (m_end.group(3) or "").strip() if m_end.lastindex >= 3 else ""
                inline = re.sub(r'\s+(rooms?|spaces?|units?)$', '', inline, flags=re.IGNORECASE)
                inline = re.sub(r'[\s,;.?!]+$', '', inline)
                if inline:
                    select_room_fn = inline
                elif expanded_group:
                    select_room_fn = expanded_group
                else:
                    select_room_index = None
            else:
                select_room_fn = raw_fn

    expand_group_fn = None
    m = _RE_EXPAND_GROUP.search(msg)
    if m:
        expand_group_fn = m.group(1).strip()
    else:
        # Bare fallback: "open/expand <function>" without suffix word
        # Guard: skip if the text matches drawer/toolkit/panel keywords
        _drawer_guard = {"toolkit", "drawer", "side panel", "metadata",
                         "info panel", "details panel", "space card",
                         "space details", "space info", "space metadata",
                         "metadata panel", "details", "info"}
        _zoom_guard = {"closer", "further", "bigger", "smaller", "in", "out"}
        m2 = _RE_EXPAND_GROUP_BARE.search(msg)
        if m2:
            candidate = m2.group(1).strip()
            candidate_lower = candidate.lower()
            # Guard: skip if candidate resolves to a floor ("go to floor 1")
            _is_floor = resolve_floor_id(candidate) is not None
            if (not any(g in candidate_lower for g in _drawer_guard)
                    and candidate_lower not in _zoom_guard
                    and not _is_floor
                    and len(candidate) > 1):
                expand_group_fn = candidate

    # ── Intent classification (collect all matches) ──

    used_types = set()  # prevent duplicate type emissions

    # 0. Universal clear — "clear everything", "reset all"
    if any(kw in msg_lower for kw in CLEAR_ALL_KEYWORDS):
        intents.append(ParsedIntent(intent_type="clear_all"))
        used_types.add("clear_all")

    # 1. Route to elevator/staircase
    _has_route_verb = any(kw in msg_lower for kw in [
        "nearest", "closest", "route to", "path to", "bring me to",
        "point me to", "find me", "where is the",
        "navigate to the", "take me to the", "guide me to",
        "direct me to", "way to the", "directions to",
        "walk me to", "lead me to", "show me the way",
        "how do i get to", "how to get to",
    ])
    if route_target and _has_route_verb and "route" not in used_types:
        intents.append(ParsedIntent(intent_type="route", route_target=route_target))
        used_types.add("route")

    # 2. Clear/reset (specific targets)
    if reset_target and "reset" not in used_types and "clear_all" not in used_types:
        intents.append(ParsedIntent(intent_type="reset", reset_target=reset_target))
        used_types.add("reset")

    # Clear route/selection/highlights/search
    if "reset" not in used_types and "clear_all" not in used_types:
        for pattern, target in sorted(CLEAR_PATTERNS.items(), key=lambda x: -len(x[0])):
            if pattern in msg_lower:
                intents.append(ParsedIntent(intent_type="reset", reset_target=target))
                used_types.add("reset")
                break

    # 3. Compare floors (specific pair)
    if len(compare_floors) == 2 and "compare" not in used_types:
        intents.append(ParsedIntent(intent_type="compare", compare_floors=compare_floors))
        used_types.add("compare")

    # 4. Heatmap mode change
    #    Skip if a reset already consumed the keyword (e.g. "show all types" → reset_filters, not heatmap)
    _heatmap_verbs = ["heatmap", "heat map", "color by", "colour by", "show"]
    _heatmap_blocked_by_reset = "reset" in used_types and reset_target in ("heatmap", "filters")
    if heatmap_mode and any(v in msg_lower for v in _heatmap_verbs) and "heatmap" not in used_types and not _heatmap_blocked_by_reset:
        intents.append(ParsedIntent(intent_type="heatmap", heatmap_mode=heatmap_mode))
        used_types.add("heatmap")

    # 5. Evacuation / emergency (only if heatmap didn't already grab it)
    if "heatmap" not in used_types and any(kw in msg_lower for kw in EVACUATION_KEYWORDS):
        if "evacuate" not in used_types:
            intents.append(ParsedIntent(intent_type="evacuate"))
            used_types.add("evacuate")

    # 6. Capacity planning
    if target_capacity and (target_function or any(kw in msg_lower for kw in CAPACITY_PLAN_KEYWORDS)):
        if "capacity_plan" not in used_types:
            intents.append(ParsedIntent(
                intent_type="capacity_plan",
                target_capacity=target_capacity,
                target_function=target_function,
            ))
            used_types.add("capacity_plan")

    # 7. Function filter toggle
    _filter_verbs = ["show", "hide", "toggle", "filter", "only"]
    if category_name and any(v in msg_lower for v in _filter_verbs) and "filter" not in used_types:
        intents.append(ParsedIntent(
            intent_type="filter",
            category_name=category_name,
            category_index=category_index,
        ))
        used_types.add("filter")

    # 8. UI control (MEP, panel mode)
    _ui_verbs = ["show", "hide", "toggle", "open", "close", "switch"]
    if ui_target and any(v in msg_lower for v in _ui_verbs) and "ui_control" not in used_types:
        intents.append(ParsedIntent(intent_type="ui_control", ui_target=ui_target))
        used_types.add("ui_control")

    # 9. Show all floors
    if show_all_floors and "navigate" not in used_types:
        intents.append(ParsedIntent(intent_type="navigate", show_all_floors=True))
        used_types.add("navigate")

    # 10. Select room in group
    if select_room_index is not None and select_room_fn and "select_room" not in used_types:
        intents.append(ParsedIntent(
            intent_type="select_room",
            room_index=select_room_index,
            function_name=select_room_fn,
        ))
        used_types.add("select_room")

    # 10b. Next/previous room in group (relative navigation)
    if "select_room_relative" not in used_types and "select_room" not in used_types:
        m_np = _RE_NEXT_PREV_VERB.search(msg) or _RE_NEXT_PREV_BARE.search(msg)
        if m_np:
            np_dir = m_np.group(1).lower()
            if np_dir in ("prev", "preceding"):
                np_dir = "previous"
            elif np_dir == "following":
                np_dir = "next"
            intents.append(ParsedIntent(
                intent_type="select_room_relative",
                direction=np_dir,
                function_name=expanded_group,
            ))
            used_types.add("select_room_relative")

    # 11. Expand directory group
    if expand_group_fn and "expand_group" not in used_types and "select_room" not in used_types:
        intents.append(ParsedIntent(intent_type="expand_group", function_name=expand_group_fn))
        used_types.add("expand_group")

    # 12. Floor navigation (absolute or relative)
    #    Skip if compare already consumed the floor references
    if floor_ref and "navigate" not in used_types and "compare" not in used_types:
        intents.append(ParsedIntent(intent_type="navigate", floor_ref=floor_ref))
        used_types.add("navigate")
    elif direction and "navigate" not in used_types:
        _nav_words = ["floor", "level", "next floor", "previous floor", "go up", "go down"]
        if any(w in msg_lower for w in _nav_words):
            intents.append(ParsedIntent(intent_type="navigate", direction=direction))
            used_types.add("navigate")

    # 13. Select space (requires action verb + polygon name match)
    if "select_space" not in used_types and "navigate" not in used_types:
        m = _RE_SELECT_SPACE.search(msg)
        if m:
            space_text = m.group(2).strip().rstrip("?.!")
            if not resolve_floor_id(space_text) and len(space_text) > 2:
                if polygons is None:
                    polygons = read_all_polygons()
                poly = find_polygon_by_name(space_text, polygons)
                if poly:
                    intents.append(ParsedIntent(
                        intent_type="select_space",
                        space_name=poly.get("space_name", space_text),
                    ))
                    used_types.add("select_space")

    # ── New intent types ──

    # 14. Zoom view
    for alias, action in sorted(ZOOM_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower and "zoom" not in used_types:
            intents.append(ParsedIntent(intent_type="zoom", zoom_action=action))
            used_types.add("zoom")
            break

    # 15. Drawer open/close
    for alias, action in sorted(DRAWER_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower and "drawer" not in used_types:
            intents.append(ParsedIntent(intent_type="drawer", drawer_action=action))
            used_types.add("drawer")
            break

    # 16. Toolkit section
    _section_verbs = ["show", "open", "expand", "see", "view"]
    if any(v in msg_lower for v in _section_verbs) and "toolkit_section" not in used_types:
        for alias, section in sorted(TOOLKIT_SECTIONS.items(), key=lambda x: -len(x[0])):
            if alias in msg_lower:
                intents.append(ParsedIntent(intent_type="toolkit_section", toolkit_section=section))
                used_types.add("toolkit_section")
                break

    # 17. Profile toggle
    for alias, mode in sorted(PROFILE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower and "profile" not in used_types:
            intents.append(ParsedIntent(intent_type="profile", profile_mode=mode))
            used_types.add("profile")
            break

    # 18. Close card
    if any(kw in msg_lower for kw in CLOSE_CARD_KEYWORDS) and "close_card" not in used_types:
        intents.append(ParsedIntent(intent_type="close_card"))
        used_types.add("close_card")

    # 19. New session
    if any(kw in msg_lower for kw in NEW_SESSION_KEYWORDS) and "new_session" not in used_types:
        intents.append(ParsedIntent(intent_type="new_session"))
        used_types.add("new_session")

    # 20. Load session
    if any(kw in msg_lower for kw in LOAD_SESSION_KEYWORDS) and "load_session" not in used_types:
        intents.append(ParsedIntent(intent_type="load_session"))
        used_types.add("load_session")

    # 21. Clear learnings
    if any(kw in msg_lower for kw in CLEAR_LEARNINGS_KEYWORDS) and "clear_learnings" not in used_types:
        intents.append(ParsedIntent(intent_type="clear_learnings"))
        used_types.add("clear_learnings")

    # 22. Compare mode toggle (not pair — just on/off)
    for alias, action in sorted(COMPARE_MODE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower and "compare_toggle" not in used_types and "compare" not in used_types:
            intents.append(ParsedIntent(intent_type="compare_toggle", compare_action=action))
            used_types.add("compare_toggle")
            break

    # 23. Voice toggle
    for alias, action in sorted(VOICE_KEYWORDS.items(), key=lambda x: -len(x[0])):
        if alias in msg_lower and "voice" not in used_types:
            intents.append(ParsedIntent(intent_type="voice", voice_action=action))
            used_types.add("voice")
            break

    # 24. Floor visibility in 3D
    m = _RE_FLOOR_VISIBILITY.search(msg)
    if m and "floor_visibility" not in used_types:
        verb = m.group(1).lower()
        floor_text = m.group(2)
        fid = resolve_floor_id(floor_text)
        vis_action = FLOOR_VISIBILITY_VERBS.get(verb)
        if fid and vis_action:
            intents.append(ParsedIntent(
                intent_type="floor_visibility",
                floor_visibility_id=fid,
                floor_visibility_action=vis_action,
            ))
            used_types.add("floor_visibility")

    # 25. Fly to zone
    m = _RE_FLY_TO_ZONE.search(msg)
    if m and "fly_to_zone" not in used_types:
        zone_text = m.group(1).strip().lower()
        for alias, zone_name in sorted(ZONE_ALIASES.items(), key=lambda x: -len(x[0])):
            if alias in zone_text:
                intents.append(ParsedIntent(intent_type="fly_to_zone", zone_name=zone_name))
                used_types.add("fly_to_zone")
                break

    # 26. Highlight by query
    m = _RE_HIGHLIGHT.search(msg)
    if m and "highlight" not in used_types:
        filt = re.sub(r'\b(rooms?|spaces?)\b', '', m.group(1)).strip()
        if filt:
            intents.append(ParsedIntent(intent_type="highlight_spaces", highlight_filter=filt))
            used_types.add("highlight")

    # 27. Highlight adjacency
    m = _RE_ADJACENT.search(msg)
    if m and "highlight_adjacent" not in used_types:
        intents.append(ParsedIntent(
            intent_type="highlight_adjacent",
            highlight_target_space=m.group(1).strip().rstrip("?.!"),
        ))
        used_types.add("highlight_adjacent")

    # 28. Count / aggregate
    m = _RE_COUNT.search(msg)
    if m and "count" not in used_types:
        intents.append(ParsedIntent(
            intent_type="count",
            count_query=m.group(1).strip().rstrip("?.!"),
            category_name=category_name,
            category_index=category_index,
            floor_ref=floor_ref,
        ))
        used_types.add("count")

    # 29. Search (fallback — only if no other spatial intent matched)
    if not used_types or used_types == {"clear_all"}:
        m = _RE_SEARCH.search(msg)
        if m and "search" not in used_types:
            intents.append(ParsedIntent(intent_type="search", search_query=m.group(1).strip()))
            used_types.add("search")

    # Default: query (let the LLM handle it)
    if not intents:
        # Bare floor reference without action verb
        if floor_ref:
            intents.append(ParsedIntent(intent_type="navigate", floor_ref=floor_ref))
        else:
            intents.append(ParsedIntent())

    return intents


# Backward compat alias
def parse_intent(message: str, polygons: list[dict] | None = None) -> ParsedIntent:
    """Single-intent parse — returns the first (highest priority) intent."""
    results = parse_intents(message, polygons)
    return results[0] if results else ParsedIntent()


# ══════════════════════════════════════════════════════════════════════
# Intent → Action mapping
# ══════════════════════════════════════════════════════════════════════

def intents_to_actions(
    intent_or_list: "ParsedIntent | list[ParsedIntent]",
    selected_space: dict | None,
    active_floor_id: str | None = None,
) -> list[tuple[dict, str]]:
    """Map ParsedIntent(s) to (action_dict, confirmation_text) tuples.

    Accepts a single ParsedIntent or a list for chained actions.
    """
    if isinstance(intent_or_list, list):
        intent_list = intent_or_list
    else:
        intent_list = [intent_or_list]

    actions = []

    for intent in intent_list:
        t = intent.intent_type

        if t == "clear_all":
            actions.append(({"type": "clear_all"}, "Resetting everything to default."))

        elif t == "route":
            space_name = (selected_space or {}).get("space_name", "")
            target = intent.route_target or "elevator"
            if space_name:
                actions.append((
                    {"type": f"route_to_{target}", "space_name": space_name},
                    f"Routing to nearest {target} from **{space_name}**...",
                ))
            else:
                actions.append((
                    {"type": "no_selection_hint", "intent": target},
                    f"No room is currently selected. Please select a room first so I can route you to the nearest {target}.",
                ))

        elif t == "reset":
            target = intent.reset_target
            if target == "heatmap":
                actions.append(({"type": "reset_heatmap"}, "Resetting to default view."))
            elif target == "filters":
                actions.append(({"type": "reset_filters"}, "Showing all room types."))
            elif target == "selection":
                actions.append(({"type": "clear_selection"}, "Clearing selection."))
            elif target == "route":
                actions.append(({"type": "clear_route"}, "Clearing route."))
            elif target == "highlights":
                actions.append(({"type": "clear_highlights"}, "Clearing highlights."))
            elif target == "search":
                actions.append(({"type": "clear_search"}, "Clearing search."))

        elif t == "compare":
            f1, f2 = intent.compare_floors
            n1 = FLOOR_NAMES.get(f1, f1)
            n2 = FLOOR_NAMES.get(f2, f2)
            actions.append((
                {"type": "compare_floors", "floor_id_1": f1, "floor_id_2": f2},
                f"Comparing **{n1}** and **{n2}**...",
            ))

        elif t == "evacuate":
            actions.append((
                {"type": "set_heatmap", "mode": "evacuation"},
                "Activating **evacuation capacity** view -- brighter rooms can hold more people.",
            ))

        elif t == "capacity_plan":
            actions.append((
                {"type": "set_heatmap", "mode": "occupancy"},
                f"Showing **occupancy capacity** -- analysing rooms for {intent.target_capacity} people...",
            ))

        elif t == "heatmap":
            mode = intent.heatmap_mode
            mode_labels = {
                "function": "function", "area": "area", "utilization": "utilization",
                "status": "status", "area_per_bed": "area per bed",
                "occupancy": "occupancy capacity", "occupancy_density": "occupancy density",
                "evacuation": "evacuation capacity",
            }
            label = mode_labels.get(mode, mode)
            actions.append((
                {"type": "set_heatmap", "mode": mode},
                f"Switching to **{label}** heatmap.",
            ))

        elif t == "filter":
            cat = intent.category_name
            idx = intent.category_index
            if idx is not None:
                actions.append((
                    {"type": "toggle_function_filter", "category_index": idx, "category": cat.title()},
                    f"Toggling **{cat.title()}** spaces.",
                ))

        elif t == "ui_control":
            target = intent.ui_target
            if target == "mep":
                actions.append(({"type": "toggle_mep"}, "Toggling infrastructure layer."))
            elif target in ("panel_list", "panel_plan"):
                mode = "list" if target == "panel_list" else "plan"
                label = "directory" if mode == "list" else "statistics"
                actions.append((
                    {"type": "set_panel_mode", "mode": mode},
                    f"Switching to **{label}** view.",
                ))

        elif t == "navigate":
            if intent.show_all_floors:
                actions.append(({"type": "show_all_floors"}, "Showing all floors."))
            elif intent.floor_ref:
                fid = intent.floor_ref
                fname = FLOOR_NAMES.get(fid, fid)
                actions.append((
                    {"type": "set_floor", "floor_id": fid},
                    f"Navigating to **{fname}**...",
                ))
            elif intent.direction:
                if active_floor_id and active_floor_id in FLOOR_ORDER:
                    idx = FLOOR_ORDER.index(active_floor_id)
                    new_idx = idx + 1 if intent.direction == "up" else idx - 1
                    if 0 <= new_idx < len(FLOOR_ORDER):
                        fid = FLOOR_ORDER[new_idx]
                        fname = FLOOR_NAMES.get(fid, fid)
                        actions.append((
                            {"type": "set_floor", "floor_id": fid},
                            f"Navigating to **{fname}**...",
                        ))
                    else:
                        edge = "top" if intent.direction == "up" else "bottom"
                        actions.append((
                            {"type": "no_selection_hint", "intent": "floor_boundary"},
                            f"You're already at the {edge} floor.",
                        ))
                else:
                    actions.append((
                        {"type": "set_floor_relative", "direction": intent.direction},
                        f"Moving {'up' if intent.direction == 'up' else 'down'} one floor...",
                    ))

        elif t == "select_space":
            if intent.space_name:
                actions.append((
                    {"type": "select_space", "space_name": intent.space_name},
                    f"Selecting **{intent.space_name}**...",
                ))

        elif t == "select_room":
            idx = intent.room_index
            if idx == -1:
                actions.append((
                    {"type": "select_room_in_group", "function_name": intent.function_name, "room_index": -1},
                    f"Selecting the **last** room in **{intent.function_name}**...",
                ))
            else:
                actions.append((
                    {"type": "select_room_in_group", "function_name": intent.function_name, "room_index": idx},
                    f"Selecting room **#{idx}** in **{intent.function_name}**...",
                ))

        elif t == "select_room_relative":
            rel_dir = intent.direction or "next"
            rel_fn = intent.function_name or ""
            label = f" in **{rel_fn}**" if rel_fn else ""
            actions.append((
                {"type": "select_room_relative", "direction": rel_dir, "function_name": rel_fn},
                f"Selecting the **{rel_dir}** room{label}...",
            ))

        elif t == "expand_group":
            actions.append((
                {"type": "expand_directory_group", "function_name": intent.function_name},
                f"Opening **{intent.function_name}** directory...",
            ))

        elif t == "zoom":
            labels = {"in": "Zooming in.", "out": "Zooming out.", "reset": "Resetting view."}
            actions.append((
                {"type": "zoom_view", "action": intent.zoom_action},
                labels.get(intent.zoom_action, "Adjusting view."),
            ))

        elif t == "drawer":
            label = "Opening" if intent.drawer_action == "open" else "Closing"
            actions.append((
                {"type": "toggle_drawer", "action": intent.drawer_action},
                f"{label} toolkit panel.",
            ))

        elif t == "toolkit_section":
            actions.append((
                {"type": "open_toolkit_section", "section": intent.toolkit_section},
                f"Showing **{intent.toolkit_section}** section.",
            ))

        elif t == "profile":
            label = "full" if intent.profile_mode == "full" else "compact"
            actions.append((
                {"type": "toggle_profile", "mode": intent.profile_mode},
                f"Switching to **{label}** profile view.",
            ))

        elif t == "close_card":
            actions.append(({"type": "close_card"}, "Closing info card."))

        elif t == "new_session":
            actions.append(({"type": "new_session"}, "Starting a new chat session."))

        elif t == "load_session":
            actions.append(({"type": "load_session"}, "Loading previous session..."))

        elif t == "clear_learnings":
            actions.append(({"type": "clear_learnings"}, "Clearing all learned preferences."))

        elif t == "compare_toggle":
            if intent.compare_action:
                actions.append(({"type": "enter_compare_mode"}, "Entering compare mode."))
            else:
                actions.append(({"type": "exit_compare_mode"}, "Exiting compare mode."))

        elif t == "voice":
            if intent.voice_action == "on":
                actions.append(({"type": "voice_on"}, "Activating voice mode."))
            else:
                actions.append(({"type": "voice_off"}, "Deactivating voice mode."))

        elif t == "floor_visibility":
            fid = intent.floor_visibility_id
            fname = FLOOR_NAMES.get(fid, fid)
            verb = "Showing" if intent.floor_visibility_action == "show" else "Hiding"
            actions.append((
                {"type": "set_floor_visibility", "floor_id": fid, "visible": intent.floor_visibility_action == "show"},
                f"{verb} **{fname}** in 3D viewer.",
            ))

        elif t == "fly_to_zone":
            actions.append((
                {"type": "fly_to_zone", "zone_name": intent.zone_name},
                f"Navigating to **{intent.zone_name}** zone...",
            ))

        elif t == "highlight_spaces":
            actions.append((
                {"type": "highlight_spaces", "filter": intent.highlight_filter},
                f"Highlighting rooms matching: **{intent.highlight_filter}**...",
            ))

        elif t == "highlight_adjacent":
            actions.append((
                {"type": "highlight_adjacent", "space_name": intent.highlight_target_space},
                f"Highlighting spaces adjacent to **{intent.highlight_target_space}**...",
            ))

        elif t == "count":
            actions.append((
                {"type": "count_highlight", "query": intent.count_query,
                 "category_index": intent.category_index, "floor_id": intent.floor_ref},
                f"Counting and highlighting: **{intent.count_query}**...",
            ))

        elif t == "search":
            actions.append((
                {"type": "set_search", "query": intent.search_query},
                f"Searching for **{intent.search_query}**...",
            ))

        # "query" type produces no actions — LLM handles narratively

    return actions
