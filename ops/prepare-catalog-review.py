"""Read the two catalog workbooks and the offline media audit without modifying them."""
import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook

FIELDS = (
    ("NAME", "არსებული სახელი", "v2 სახელი", "დასახელების ერთიანი ფორმით წარმოდგენა მოდელისა და პროდუქტის ტიპის სწრაფად წაკითხვაში დაგვეხმარება."),
    ("SHORT", "არსებული მოკლე აღწერა", "v2 მოკლე აღწერა", "მოკლე ვერსიაში პროდუქტის დანიშნულება და ძველ წყაროში მოცემული ძირითადი ინფორმაცია ერთ ადგილას ჩანს."),
    ("FULL", "არსებული სრული აღწერა", "v2 სრული აღწერა", "სრული ვერსია ძველი ინფორმაციის დალაგებულად წაკითხვასა და ცალკეული ჩანაწერების გადამოწმებას აადვილებს."),
)
STATUSES = {"გამოქვეყნებული": "PUBLISHED", "დრაფტი": "DRAFT"}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def xlsx(path, sheet):
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = iter(workbook[sheet].values)
        headers = next(rows)
        result = {}
        for row in rows:
            if not row or row[0] is None:
                continue
            if type(row[0]) is not int or row[0] in result:
                raise ValueError(f"Invalid or duplicate WordPress ID in {path.name}")
            result[row[0]] = dict(zip(headers, row, strict=True))
        return result
    finally:
        workbook.close()


def csv_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as source:
        return list(csv.DictReader(source))


def index(rows, key):
    result = {row[key]: row for row in rows}
    if len(result) != len(rows):
        raise ValueError(f"Duplicate {key} in photo audit")
    return result


def prepare(baseline_path, review_path, downloader, selection):
    media = downloader / "AgroTrade_Legacy_Media"
    paths = {
        "baseline": baseline_path, "review_v1_1": review_path,
        "image_links": downloader / "product_image_links.csv",
        "product_audit": media / "audit/product_audit.csv",
        "image_audit": media / "audit/image_audit.csv",
        "photo_queue": media / "audit/photo_review_queue.csv",
        "duplicate_pairs": media / "audit/similar_image_candidates.csv",
    }
    baseline = xlsx(baseline_path, "საწყისი კატალოგი")
    review = xlsx(review_path, "განხილვა")
    products = index(csv_rows(paths["product_audit"]), "legacy_product_id")
    images = index(csv_rows(paths["image_audit"]), "asset_key")
    queue = index(csv_rows(paths["photo_queue"]), "legacy_product_id")
    links = defaultdict(list)
    for row in csv_rows(paths["image_links"]):
        links[int(row["legacy_product_id"])].append(row)

    if baseline.keys() != review.keys() or set(products) != set(map(str, baseline)) or len(baseline) != 248:
        raise ValueError("The two workbooks and product audit must contain the same 248 WordPress IDs")
    if len(images) != 456 or sum(map(len, links.values())) != 685 or not links.keys() <= baseline.keys():
        raise ValueError("Photo inventory does not match the verified audit")
    if len(selection) != 20 or not selection.keys() <= baseline.keys():
        raise ValueError("Missing pilot product")

    result = []
    for wp_id, original in baseline.items():
        draft = review[wp_id]
        status = STATUSES[original["სტატუსი ძველ საიტზე"]]
        audit = products[str(wp_id)]
        if status != STATUSES[draft["სტატუსი"]] or status != audit["wordpress_status"]:
            raise ValueError(f"Conflicting WordPress statuses for {wp_id}")
        if any(original[key] != draft[key] for _, key, _, _ in FIELDS):
            raise ValueError(f"Conflicting original text for {wp_id}")

        references = sorted(links[wp_id], key=lambda link: int(link["product_image_position"]))
        if int(audit["image_references"]) != len(references) or int(original["ფოტოების რაოდენობა"] or 0) != len(references):
            raise ValueError(f"Photo counts differ for {wp_id}")
        for position, link in enumerate(references, start=1):
            evidence = images[link["asset_key"]]
            if int(link["product_image_position"]) != position or any(
                link[key] != evidence[key] for key in ("original_url", "output_relative_path")
            ):
                raise ValueError(f"Photo provenance differs for {wp_id} at {position}")

        record = {
            "wordpressId": wp_id, "status": status, "baseline": original, "reviewSource": draft,
            "productAudit": audit, "queue": queue.get(str(wp_id)), "photos": [], "proposals": [],
        }
        result.append(record)
        if wp_id not in selection:
            continue
        record["photos"] = [
            {"position": int(link["product_image_position"]), "audit": images[link["asset_key"]]}
            for link in references
        ]
        selected = selection[wp_id]
        observation = selected["observation"]
        for field, original_key, proposed_key, rationale in FIELDS:
            proposed = draft[proposed_key]
            if not isinstance(proposed, str) or not proposed.strip() or proposed == original[original_key]:
                continue
            note = selected.get("rationaleNotes", {}).get(field)
            if note:
                rationale = f"{rationale} {note}"
            record["proposals"].append({
                "field": field, "original": original[original_key], "proposed": proposed,
                "observation": observation, "rationale": rationale, "proposedPhotoKey": None,
            })

        photo_proposal = None
        if not references:
            photo_observation = "ძველ გვერდს ფოტო არ აქვს."
            rationale = "ახალი ფოტო დაგვეხმარება ამ ჩანაწერისა და მსგავსი პროდუქტის გარჩევაში."
        elif selected.get("checkPhotoMatch"):
            photo_observation = "ძველი ფოტოსა და პროდუქტის ზუსტი შესაბამისობა დასადგენია."
            rationale = "შეადარეთ ფოტოები პროდუქტს და მონიშნეთ ის ვარიანტი, რომელიც ნამდვილად ამ ჩანაწერს ეკუთვნის."
        else:
            main = record["photos"][0]["audit"]
            clean = next((p for p in record["photos"] if not p["audit"]["quality_flags"]), None)
            if not main["quality_flags"]:
                photo_observation = "ძველი მთავარი ფოტო იხსნება და ავტომატურ შემოწმებას გაფრთხილება არ დაუფიქსირებია."
                rationale = "შევინარჩუნოთ არსებული მთავარი ფოტო, თუ პროდუქტი მასზე სწორად ჩანს."
                photo_proposal = main["asset_key"]
            elif clean:
                photo_observation = "მთავარ ფოტოზე ხარისხის გაფრთხილებაა. გალერეაში კიდევ ერთი ვარიანტია."
                rationale = "შეადარეთ მონიშნული ვარიანტი მთავარ ფოტოს და შეარჩიეთ, რომელზე ჩანს პროდუქტი უფრო მკაფიოდ."
                photo_proposal = clean["audit"]["asset_key"]
            else:
                photo_observation = "ხელმისაწვდომ ფოტოებზე ხარისხის გაფრთხილებებია."
                rationale = "გადახედეთ ფოტოებს და გადაწყვიტეთ, რომელი გამოგვადგება ან გვჭირდება თუ არა ახალი."
        record["proposals"].append({
            "field": "PHOTO", "original": None, "proposed": None,
            "observation": photo_observation, "rationale": rationale, "proposedPhotoKey": photo_proposal,
        })

    if Counter(row["status"] for row in result) != {"PUBLISHED": 217, "DRAFT": 31}:
        raise ValueError("Unexpected source status distribution")
    return {
        "version": 1,
        "sources": {name: sha(path) for name, path in paths.items()},
        "products": result,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--media-downloader", type=Path, required=True)
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    selection = {int(key): value for key, value in json.loads(args.selection.read_text(encoding="utf-8")).items()}
    if any(not isinstance(row, dict) or not isinstance(row.get("observation"), str)
           or not row["observation"].strip() for row in selection.values()):
        raise ValueError("Every pilot product requires an observation")
    bundle = prepare(args.baseline, args.review, args.media_downloader, selection)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(bundle, output, ensure_ascii=False, indent=2)
        output.write("\n")
    pilot = [p for p in bundle["products"] if p["proposals"]]
    print(f"{len(bundle['products'])} staged rows, {len(pilot)} pilot products, "
          f"{sum(len(p['proposals']) for p in pilot)} proposals, "
          f"{sum(len(p['photos']) for p in pilot)} photo links")


if __name__ == "__main__":
    main()
