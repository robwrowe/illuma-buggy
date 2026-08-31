"""Data-driven effect taxonomy: cluster measured feature vectors.

Does not replace closed-vocabulary classification. Labels and notes are used
only after clustering, to suggest names. Does not write findings or rename xlsx.
"""

from __future__ import annotations

import csv
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .metadata_card import TrialMetadataCard

CLOSED_EFFECT_VOCAB = {
    "chase",
    "shimmer",
    "flicker",
    "pulse",
    "cycle",
    "strobe",
    "heartbeat",
    "cross-saw",
    "cross-fade",
    "crosssaw",
    "crossfade",
    "unique",
    "circle",
    "glow",
    "solid",
}

CAT_FIELDS = ("zone_model", "color_transition", "sync_status", "fade_curve", "chase_direction")
CONT_FIELDS = ("cycle_time_ms", "cycle_count_observed", "color_count", "fade_curve_confidence")

SILHOUETTE_WEAK = 0.25
PURITY_DEFAULT = 0.6


@dataclass
class FeatureVector:
    zone_model: str
    color_transition: str
    sync_status: str
    fade_curve: str
    chase_direction: str
    cycle_time_ms: float
    cycle_count_observed: float
    color_count: int
    fade_curve_confidence: float
    row_id: str
    hex_full: str
    effect_label: str | None
    inferred_label: str | None
    notes_matched_terms: list[str] = field(default_factory=list)
    exclude_reason: str = ""


@dataclass
class ClusterResult:
    method: str
    labels: list[int]
    silhouette: float | None
    k: int | None
    cluster_members: dict
    weak_structure: bool = False
    note: str = ""
    sample_silhouettes: list | None = None


@dataclass
class ClusterNameSuggestion:
    candidate_name: str
    feature_based_slug: str
    existing_label_hint: str | None
    label_purity: float | None
    notes_terms_hint: list[str]
    needs_human_review: bool


def _na_cat(value: str | None, na: str = "n/a") -> str:
    if value is None or not str(value).strip():
        return na
    text = str(value).strip()
    if text.lower().startswith("n/a"):
        return "n/a"
    return text


def _usable_cycle(card: TrialMetadataCard | None) -> bool:
    if card is None:
        return False
    return card.cycle_time_ms is not None and card.cycle_time_ms > 0


def build_feature_vectors(reports) -> tuple:
    """Split reports into usable FeatureVectors vs excluded cards/reports."""
    usable: list[FeatureVector] = []
    excluded: list = []
    for report in reports:
        card = getattr(report, "card", None)
        status = getattr(report, "status", "")
        cap = getattr(report, "capture_status", "")
        reason = ""
        if status == "capture_failed" or cap not in {"ok", ""}:
            reason = f"insufficient data ({cap or status})"
        elif not _usable_cycle(card):
            fade = getattr(card, "fade_curve", None) if card else None
            if fade == "flat":
                reason = "insufficient data (flat — no cycle)"
            else:
                reason = "insufficient data (no cycle_time_ms)"
        if reason:
            excluded.append((report, reason))
            continue
        trial = report.trial
        chase = getattr(report, "outer_chase_direction", None) or "n/a"
        n_col = trial.color_count
        if n_col is None:
            n_col = 0
        usable.append(
            FeatureVector(
                zone_model=_na_cat(card.zone_model, "single"),
                color_transition=_na_cat(card.color_transition),
                sync_status=_na_cat(card.sync_status),
                fade_curve=_na_cat(card.fade_curve, "irregular"),
                chase_direction=_na_cat(chase),
                cycle_time_ms=float(card.cycle_time_ms),
                cycle_count_observed=float(card.cycle_count_observed or 0.0),
                color_count=int(max(0, min(int(n_col), 7))),
                fade_curve_confidence=float(card.confidence or 0.0),
                row_id=trial.row_id,
                hex_full=trial.hex_full,
                effect_label=trial.effect_label,
                inferred_label=report.inferred_label,
                notes_matched_terms=list(card.notes_matched_terms or []),
            )
        )
    return usable, excluded


def _encode_matrix(vectors: list[FeatureVector]):
    from sklearn.preprocessing import OneHotEncoder, StandardScaler

    if not vectors:
        return np.zeros((0, 1)), None, None
    cat = np.array([[getattr(v, f) for f in CAT_FIELDS] for v in vectors], dtype=object)
    cont = np.array([[getattr(v, f) for f in CONT_FIELDS] for v in vectors], dtype=float)
    try:
        enc = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        enc = OneHotEncoder(handle_unknown="ignore", sparse=False)
    cat_x = enc.fit_transform(cat)
    scaler = StandardScaler()
    if cont.shape[0] == 1:
        cont_x = np.zeros_like(cont)
    else:
        cont_x = scaler.fit_transform(cont)
    return np.hstack([cat_x, cont_x]), enc, scaler


def _k_distance_eps(x: np.ndarray, min_samples: int) -> float:
    from sklearn.neighbors import NearestNeighbors

    n = x.shape[0]
    k = max(1, min(min_samples, n))
    nn = NearestNeighbors(n_neighbors=min(k, n))
    nn.fit(x)
    dists, _ = nn.kneighbors(x)
    kd = np.sort(dists[:, -1])
    if kd.size < 3:
        return float(np.median(kd)) if kd.size else 0.5
    jumps = np.diff(kd)
    elbow = int(np.argmax(jumps)) + 1
    eps = float(kd[min(elbow, kd.size - 1)])
    if eps <= 0:
        eps = float(np.percentile(kd, 75) or 0.5)
    return max(eps, 1e-6)


def cluster_trials(
    vectors: list[FeatureVector],
    *,
    method: str = "agglomerative",
    k_range: tuple = (4, 20),
    linkage: str = "average",
    min_samples: int = 3,
    silhouette_min: float = SILHOUETTE_WEAK,
    eps: float | None = None,
) -> ClusterResult:
    """Cluster encoded feature vectors. Lazy-imports sklearn."""
    from sklearn.cluster import AgglomerativeClustering, DBSCAN
    from sklearn.metrics import silhouette_samples, silhouette_score

    x, _enc, _scaler = _encode_matrix(vectors)
    n = x.shape[0]
    empty = ClusterResult(
        method=method,
        labels=[-1] * n,
        silhouette=None,
        k=None,
        cluster_members={-1: list(range(n))},
        weak_structure=True,
        note="not enough trials to cluster",
    )
    if n < 2:
        return empty

    if method == "dbscan":
        use_eps = eps if eps is not None else _k_distance_eps(x, min_samples)
        ms = min(min_samples, max(1, n))
        model = DBSCAN(eps=use_eps, min_samples=ms)
        labels = [int(v) for v in model.fit_predict(x)]
        members: dict = defaultdict(list)
        for i, lab in enumerate(labels):
            members[lab].append(i)
        sil = None
        clustered = [lab for lab in labels if lab >= 0]
        if len(set(clustered)) >= 2 and len(clustered) > 2:
            mask = np.array(labels) >= 0
            if mask.sum() > 2 and len(set(np.array(labels)[mask])) > 1:
                try:
                    sil = float(silhouette_score(x[mask], np.array(labels)[mask]))
                except Exception:
                    sil = None
        return ClusterResult(
            method="dbscan",
            labels=labels,
            silhouette=sil,
            k=len({lab for lab in labels if lab >= 0}) or None,
            cluster_members=dict(members),
            weak_structure=sil is not None and sil < silhouette_min,
            note=f"eps={use_eps:.4f} min_samples={ms}",
        )

    lo, hi = int(k_range[0]), int(k_range[1])
    lo = max(2, lo)
    hi = min(hi, n - 1)
    if hi < lo:
        return ClusterResult(
            method="agglomerative",
            labels=[0] * n,
            silhouette=None,
            k=1 if n else None,
            cluster_members={0: list(range(n))},
            weak_structure=True,
            note=f"too few trials (n={n}) for k in {k_range}",
        )

    best_k = lo
    best_sil = -1.0
    best_labels = None
    tried = []
    for k in range(lo, hi + 1):
        model = AgglomerativeClustering(n_clusters=k, linkage=linkage)
        labels_k = model.fit_predict(x)
        if len(set(labels_k)) < 2:
            continue
        try:
            sil = float(silhouette_score(x, labels_k))
        except Exception:
            continue
        tried.append((k, sil))
        if sil > best_sil:
            best_sil = sil
            best_k = k
            best_labels = labels_k

    if best_labels is None:
        return ClusterResult(
            method="agglomerative",
            labels=[0] * n,
            silhouette=None,
            k=None,
            cluster_members={0: list(range(n))},
            weak_structure=True,
            note="silhouette_score could not be computed for any k",
        )

    labels = [int(v) for v in best_labels]
    members = defaultdict(list)
    for i, lab in enumerate(labels):
        members[lab].append(i)
    samples = None
    try:
        samples = [float(v) for v in silhouette_samples(x, best_labels)]
    except Exception:
        samples = None
    weak = best_sil < silhouette_min
    note = f"tried k={lo}..{hi}; best silhouette={best_sil:.3f} at k={best_k}"
    if weak:
        note += (
            f" — silhouette below {silhouette_min} for every k is weak structure; "
            "treat these groups as tentative"
        )
    if tried and max(s for _, s in tried) < silhouette_min:
        note += " (all k below weak-structure threshold)"
    return ClusterResult(
        method="agglomerative",
        labels=labels,
        silhouette=best_sil,
        k=best_k,
        cluster_members=dict(members),
        weak_structure=weak,
        note=note,
        sample_silhouettes=samples,
    )


def _modal(values: list[str]) -> str:
    cleaned = [v for v in values if v]
    if not cleaned:
        return "n/a"
    return Counter(cleaned).most_common(1)[0][0]


def _speed_bucket(period_ms: float, edges: tuple) -> str:
    lo, hi = edges
    if period_ms < lo:
        return "fast"
    if period_ms > hi:
        return "slow"
    return "medium"


def corpus_speed_edges(vectors: list[FeatureVector]) -> tuple:
    times = [v.cycle_time_ms for v in vectors if v.cycle_time_ms]
    if len(times) < 3:
        return (500.0, 2000.0)
    q1, q2 = np.quantile(times, [1 / 3, 2 / 3])
    return (float(q1), float(q2))


def _zone_slug(zone_model: str) -> str:
    z = (zone_model or "").lower()
    if "five" in z:
        return "5zone"
    if "inner" in z:
        return "inner-outer"
    if "single" in z:
        return "1zone"
    return z.replace(" ", "-") or "zone"


def feature_based_slug(members: list[FeatureVector], speed_edges: tuple) -> str:
    zone = _zone_slug(_modal([v.zone_model for v in members]))
    sync = _modal([v.sync_status for v in members]).replace(" ", "-")
    fade = _modal([v.fade_curve for v in members]).replace(" ", "-")
    periods = [v.cycle_time_ms for v in members if v.cycle_time_ms]
    med = float(np.median(periods)) if periods else 0.0
    speed = _speed_bucket(med, speed_edges)
    return f"{zone}-{sync}-{fade}-{speed}"


def _label_counts(members: list[FeatureVector]) -> tuple:
    labels = [(v.effect_label or "").strip() for v in members]
    nonempty = [x for x in labels if x]
    if not nonempty:
        inferred = [(v.inferred_label or "").strip() for v in members]
        nonempty = [x for x in inferred if x]
        source = "inferred"
    else:
        source = "effect_label"
    if not nonempty:
        return None, None, source
    name, n = Counter(nonempty).most_common(1)[0]
    return name, n / len(members), source


def suggest_cluster_name(
    cluster_vectors: list[FeatureVector],
    *,
    speed_edges: tuple | None = None,
    min_label_purity: float = PURITY_DEFAULT,
) -> ClusterNameSuggestion:
    edges = speed_edges or corpus_speed_edges(cluster_vectors)
    slug = feature_based_slug(cluster_vectors, edges)
    hint, purity, _src = _label_counts(cluster_vectors)
    notes: list[str] = []
    for v in cluster_vectors:
        notes.extend(t.lower() for t in (v.notes_matched_terms or []))
    novel = [t for t, _n in Counter(notes).most_common() if t not in CLOSED_EFFECT_VOCAB]
    # Prefer a consistent out-of-vocab notes term (ping-pong, twinkle, …)
    notes_hint = novel[:5]
    candidate = slug
    if notes_hint:
        top = notes_hint[0]
        if Counter(notes)[top] >= max(2, math.ceil(0.5 * len(cluster_vectors))):
            candidate = top
    if hint and purity is not None and purity >= min_label_purity:
        candidate = hint
    needs = purity is None or purity < min_label_purity
    return ClusterNameSuggestion(
        candidate_name=candidate,
        feature_based_slug=slug,
        existing_label_hint=hint,
        label_purity=purity,
        notes_terms_hint=notes_hint,
        needs_human_review=needs,
    )


def write_taxonomy_csv(
    path: Path,
    vectors: list[FeatureVector],
    result: ClusterResult,
    names: dict,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(
            fh,
            fieldnames=[
                "row_id",
                "hex_full",
                "cluster_id",
                "candidate_name",
                "needs_human_review",
                "effect_label",
                "inferred_label",
                "label_agrees_with_cluster",
                "cycle_time_ms",
                "sync_status",
                "fade_curve",
                "zone_model",
            ],
        )
        w.writeheader()
        for i, vec in enumerate(vectors):
            cid = result.labels[i] if i < len(result.labels) else -1
            sug = names.get(cid)
            cand = sug.candidate_name if sug else ""
            labeled = (vec.effect_label or "").strip()
            agrees = ""
            if labeled and cand:
                agrees = str(labeled.lower() == cand.lower()).lower()
            w.writerow(
                {
                    "row_id": vec.row_id,
                    "hex_full": vec.hex_full,
                    "cluster_id": cid,
                    "candidate_name": cand,
                    "needs_human_review": "" if not sug else str(sug.needs_human_review).lower(),
                    "effect_label": vec.effect_label or "",
                    "inferred_label": vec.inferred_label or "",
                    "label_agrees_with_cluster": agrees,
                    "cycle_time_ms": f"{vec.cycle_time_ms:.1f}",
                    "sync_status": vec.sync_status,
                    "fade_curve": vec.fade_curve,
                    "zone_model": vec.zone_model,
                }
            )


def write_taxonomy_markdown(
    path: Path,
    *,
    result: ClusterResult,
    vectors: list[FeatureVector],
    names: dict,
    excluded: list,
    generated_at: str,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Effect taxonomy — {generated_at}",
        "",
        "Clusters are built from **measured** feature vectors only. Existing Effect "
        "labels and notes are naming hints after the fact, not clustering input.",
        "**Triage aid, not a finding.** Does not rename `Op_Codes_Captured.xlsx` "
        "or write into `docs/ble-packets-details/`.",
        "",
        f"method=`{result.method}`  k={result.k}  silhouette={'' if result.silhouette is None else f'{result.silhouette:.3f}'}  "
        f"n_clustered={len(vectors)}  excluded={len(excluded)}",
        "",
        result.note,
        "",
    ]
    if result.weak_structure:
        lines += [
            "> **Weak structure:** silhouette is below the confidence floor for this "
            "corpus size/diversity. Do not treat cluster names as confirmed families.",
            "",
        ]

    cluster_ids = sorted(c for c in result.cluster_members if c >= 0)
    for cid in cluster_ids:
        idxs = result.cluster_members[cid]
        members = [vectors[i] for i in idxs]
        sug = names[cid]
        review = " (needs review)" if sug.needs_human_review else ""
        sil_bit = "—"
        if result.sample_silhouettes:
            sil_bit = f"{float(np.mean([result.sample_silhouettes[i] for i in idxs])):.2f}"
        purity = "—" if sug.label_purity is None else f"{sug.label_purity:.2f}"
        hint = sug.existing_label_hint or "(none)"
        lines += [
            f"## Cluster {cid} — {sug.candidate_name}{review}",
            "",
            f"**Candidate name:** {sug.candidate_name}",
            f"**Feature slug:** `{sug.feature_based_slug}`",
            f"**Existing label hint:** {hint} (purity: {purity})",
            f"**Notes terms hint:** {sug.notes_terms_hint or '[]'}",
            f"**Members:** {len(members)} trials",
            f"**Silhouette contribution:** {sil_bit}",
            "",
            "| row_id | hex_full | effect_label | cycle_time_ms | sync_status | fade_curve |",
            "|---|---|---|---|---|---|",
        ]
        for v in members:
            hex_short = (v.hex_full or "").replace(" ", "")
            if len(hex_short) > 22:
                hex_short = hex_short[:22] + "…"
            lines.append(
                f"| `{v.row_id}` | `{hex_short}` | {v.effect_label or '—'} | "
                f"{v.cycle_time_ms:.0f} | {v.sync_status} | {v.fade_curve} |"
            )
        lines.append("")
        if sug.needs_human_review:
            lines += [
                f"_Flagged for review: mixed existing labels (purity {purity}) — this cluster "
                "may represent a distinct effect not yet named, or a real family the current "
                "label applies inconsistently. Compare against `discovered-patterns-*.md` by hand._",
                "",
            ]

    noise = result.cluster_members.get(-1) or []
    lines += ["## Unclustered / excluded", ""]
    if noise:
        lines += [
            f"DBSCAN noise / one-off: **{len(noise)}** trials (label -1).",
            "",
            "| row_id | hex_full | effect_label | cycle_time_ms | fade_curve |",
            "|---|---|---|---|---|",
        ]
        for i in noise:
            v = vectors[i]
            hex_short = (v.hex_full or "")[:22]
            lines.append(
                f"| `{v.row_id}` | `{hex_short}` | {v.effect_label or '—'} | "
                f"{v.cycle_time_ms:.0f} | {v.fade_curve} |"
            )
        lines.append("")
    if excluded:
        lines += [
            f"Excluded from clustering (insufficient measured data): **{len(excluded)}** trials.",
            "",
            "| row_id | reason |",
            "|---|---|",
        ]
        for report, reason in excluded:
            rid = getattr(getattr(report, "trial", None), "row_id", "?")
            lines.append(f"| `{rid}` | {reason} |")
        lines.append("")
    if not noise and not excluded:
        lines += ["_None._", ""]
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
