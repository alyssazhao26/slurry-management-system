from dataclasses import dataclass


@dataclass
class Analysis:
    severity: str
    status: str
    summary: str
    evidence: dict


def analyse_production(planned: float, actual: float, qualified: float, threshold: float) -> Analysis:
    yield_rate = qualified / actual if actual > 0 else 0
    variance = actual - planned
    flags = []
    if qualified > actual:
        flags.append("Qualified quantity cannot exceed actual quantity.")
    if actual <= 0:
        flags.append("Actual quantity must be greater than zero.")
    if actual > 0 and yield_rate < threshold:
        flags.append(f"Yield {yield_rate:.1%} is below the {threshold:.1%} threshold.")
    if planned > 0 and actual < planned * 0.8:
        flags.append("Actual quantity is more than 20% below plan.")
    return Analysis("high" if len(flags) > 1 else "medium", "open" if flags else "normal",
                    " ".join(flags) if flags else "Production result is within configured pilot thresholds.",
                    {"yield_rate": round(yield_rate, 4), "plan_variance": round(variance, 2), "flags": flags})


def analyse_abnormality(event_type: str, severity: str, duration_minutes: int, description: str) -> Analysis:
    risk = severity.lower()
    flags = []
    if risk == "high": flags.append("High-severity event requires supervisor review.")
    if duration_minutes >= 60: flags.append("Downtime exceeds 60 minutes.")
    if not description.strip(): flags.append("Event description is missing.")
    status = "open" if flags else "normal"
    return Analysis("high" if risk == "high" else "medium", status,
                    " ".join(flags) if flags else f"{event_type} is recorded with no automatic escalation.",
                    {"event_type": event_type, "duration_minutes": duration_minutes, "flags": flags})
