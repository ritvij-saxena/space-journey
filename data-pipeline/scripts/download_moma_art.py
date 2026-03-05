#!/usr/bin/env python3
"""
Bulk download diverse artworks from open-access museum collections,
process them into art_states.bin, and clean up raw images.

Sources:
  - Metropolitan Museum of Art (~50k public domain works with images)
  - Art Institute of Chicago (~30k public domain works)
  - Wikimedia Commons (curated famous works)

Usage:
    # Download 500 images and process immediately (recommended)
    python scripts/download_moma_art.py --count 500 --process --cleanup

    # Just download (to preview images before processing)
    python scripts/download_moma_art.py --count 200

    # Download then run pipeline manually
    python scripts/download_moma_art.py --count 500
    python scripts/process_art.py
"""

import argparse
import json
import os
import random
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import List, Optional, Tuple

USER_AGENT = "ArtTributeDataPipeline/1.0 (educational, open-access only)"
REQUEST_DELAY = 0.25  # seconds between requests (be polite)

# ──────────────────────────────────────────────────────────────
# Curated famous works from Wikimedia Commons
# ──────────────────────────────────────────────────────────────
WIKIMEDIA_WORKS = [
    ("starry_night.jpg",
     "Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
     "Van Gogh - The Starry Night"),
    ("water_lilies.jpg",
     "Claude_Monet_-_Water_Lilies_-_1906,_Ryerson.jpg",
     "Monet - Water Lilies"),
    ("dream_rousseau.jpg",
     "Henri_Rousseau_-_Le_Rêve_-_Google_Art_Project.jpg",
     "Rousseau - The Dream"),
    ("composition_kandinsky.jpg",
     "Vassily_Kandinsky,_1923_-_Composition_8,_huile_sur_toile,_140_cm_x_201_cm,_Musée_Guggenheim,_New_York.jpg",
     "Kandinsky - Composition VIII"),
    ("sleeping_gypsy.jpg",
     "Henri_Rousseau_-_The_Sleeping_Gypsy_-_Google_Art_Project.jpg",
     "Rousseau - Sleeping Gypsy"),
    ("dance_matisse.jpg",
     "La_Danse_(I)_by_Henri_Matisse.jpg",
     "Matisse - Dance (I)"),
    ("golconda.jpg",
     "Golconde.jpg",
     "Magritte - Golconde"),
    ("menaced_assassin.jpg",
     "Rene_Magritte_-_The_Menaced_Assassin_-_Google_Art_Project.jpg",
     "Magritte - The Menaced Assassin"),
    ("les_demoiselles.jpg",
     "Les_Demoiselles_d%27Avignon.jpg",
     "Picasso - Les Demoiselles d'Avignon"),
    ("broadway_boogie.jpg",
     "Piet_Mondrian_-_Broadway_Boogie-Woogie_-_Google_Art_Project.jpg",
     "Mondrian - Broadway Boogie-Woogie"),
    ("persistence_of_memory.jpg",
     "The_Persistence_of_Memory.jpg",
     "Dalí - The Persistence of Memory"),
    ("birth_of_venus.jpg",
     "Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg",
     "Botticelli - Birth of Venus"),
    ("las_meninas.jpg",
     "Las_Meninas,_by_Diego_Velázquez,_from_Prado_in_Google_Earth.jpg",
     "Velázquez - Las Meninas"),
    ("night_watch.jpg",
     "The_Night_Watch_-_HD.jpg",
     "Rembrandt - The Night Watch"),
    ("whistlers_mother.jpg",
     "Whistlers_Mother_high_res.jpg",
     "Whistler - Arrangement in Grey and Black"),
    ("american_gothic.jpg",
     "Grant_Wood_-_American_Gothic_-_Google_Art_Project.jpg",
     "Grant Wood - American Gothic"),
    ("sunday_afternoon.jpg",
     "A_Sunday_on_La_Grande_Jatte,_Georges_Seurat,_1884-86.jpg",
     "Seurat - Sunday Afternoon"),
    ("olympia_manet.jpg",
     "Edouard_Manet_-_Olympia_-_Google_Art_Project_3.jpg",
     "Manet - Olympia"),
    ("liberty_leading.jpg",
     "Eugène_Delacroix_-_La_liberté_guidant_le_peuple.jpg",
     "Delacroix - Liberty Leading the People"),
    ("third_of_may.jpg",
     "El_Tres_de_Mayo,_by_Francisco_de_Goya,_from_Prado_thin_black_margin.jpg",
     "Goya - The Third of May"),
]

# ──────────────────────────────────────────────────────────────
# Art Institute of Chicago searches
# ──────────────────────────────────────────────────────────────
AIC_SEARCHES = [
    "impressionism",
    "american art",
    "landscape",
    "modernism",
    "abstract",
    "european painting",
    "post-impressionism",
    "decorative arts",
    "asian art",
    "photography",
]


# ──────────────────────────────────────────────────────────────
# HTTP helpers
# ──────────────────────────────────────────────────────────────

def api_get(url: str, timeout: int = 15) -> Optional[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception:
        return None


def download_bytes(url: str, timeout: int = 30) -> Optional[bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except Exception:
        return None


def is_valid_image(data: bytes) -> bool:
    return (len(data) > 15_000 and
            (data[:3] == b'\xff\xd8\xff' or  # JPEG
             data[:8] == b'\x89PNG\r\n\x1a\n'))  # PNG


# ──────────────────────────────────────────────────────────────
# Wikimedia Commons
# ──────────────────────────────────────────────────────────────

def wikimedia_url(commons_filename: str) -> Optional[str]:
    api = (
        f"https://commons.wikimedia.org/w/api.php?action=query"
        f"&titles=File:{commons_filename}"
        f"&prop=imageinfo&iiprop=url&iiurlwidth=1400&format=json"
    )
    data = api_get(api)
    if not data:
        return None
    try:
        pages = data["query"]["pages"]
        page = next(iter(pages.values()))
        info = page.get("imageinfo", [{}])[0]
        return info.get("thumburl") or info.get("url")
    except Exception:
        return None


def fetch_wikimedia(input_dir: Path) -> int:
    print(f"\n── Wikimedia Commons ({len(WIKIMEDIA_WORKS)} curated works) ──")
    success = 0
    for save_name, commons_name, label in WIKIMEDIA_WORKS:
        dest = input_dir / save_name
        if dest.exists() and dest.stat().st_size > 50_000:
            success += 1
            continue
        url = wikimedia_url(commons_name)
        if not url:
            time.sleep(REQUEST_DELAY)
            continue
        data = download_bytes(url)
        if data and is_valid_image(data):
            dest.write_bytes(data)
            print(f"  ✓ {label} ({len(data)//1024}KB)")
            success += 1
        time.sleep(REQUEST_DELAY)
    print(f"  {success}/{len(WIKIMEDIA_WORKS)} downloaded")
    return success


# ──────────────────────────────────────────────────────────────
# Art Institute of Chicago — bulk pagination (random pages)
# ──────────────────────────────────────────────────────────────

def fetch_aic_bulk(input_dir: Path, target: int, seed: int) -> int:
    """
    Fetch up to `target` images from AIC by sampling random pages
    across their 130k+ public domain collection.
    """
    print(f"\n── Art Institute of Chicago bulk (target: {target} works) ──")

    existing = len([p for p in input_dir.glob("aicb_*.jpg") if p.stat().st_size > 15_000])
    if existing >= target:
        print(f"  Already have {existing} AIC-bulk images, skipping")
        return existing

    rng = random.Random(seed)

    # Discover total pages (limit=100 per page)
    probe = api_get(
        "https://api.artic.edu/api/v1/artworks"
        "?fields=id&is_public_domain=true&limit=1&page=1"
    )
    total = probe["pagination"]["total"] if probe else 60000
    page_size = 100
    total_pages = max(1, total // page_size)
    print(f"  AIC total public domain artworks: {total:,} (~{total_pages} pages)")

    # Sample random page numbers spread across the full collection
    pages = list(range(1, total_pages + 1))
    rng.shuffle(pages)

    need = target - existing
    success = 0
    tried_artworks = 0

    for page_num in pages:
        if success >= need:
            break

        result = api_get(
            f"https://api.artic.edu/api/v1/artworks"
            f"?fields=id,title,artist_display,image_id"
            f"&is_public_domain=true&limit={page_size}&page={page_num}"
        )
        if not result or not result.get("data"):
            time.sleep(REQUEST_DELAY)
            continue

        artworks = result["data"]
        rng.shuffle(artworks)

        for art in artworks:
            if success >= need:
                break
            image_id = art.get("image_id")
            if not image_id:
                continue

            tried_artworks += 1
            img_url = f"https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg"
            title = str(art.get("title") or "untitled")[:35].replace("/", "-").replace(" ", "_")
            artist = str(art.get("artist_display") or "unknown")[:20].replace(" ", "_")
            art_id = art.get("id", 0)
            fname = f"aicb_{art_id}_{artist}_{title}.jpg"
            fname = "".join(c for c in fname if c.isalnum() or c in "._-")[:80]
            dest = input_dir / fname

            if dest.exists() and dest.stat().st_size > 15_000:
                success += 1
                continue

            data = download_bytes(img_url)
            if data and is_valid_image(data):
                dest.write_bytes(data)
                success += 1
            time.sleep(REQUEST_DELAY)

        if success % 50 == 0 and success > 0:
            print(f"  Progress: {success}/{need} downloaded", flush=True)

    print(f"  ✓ {success} AIC-bulk images downloaded ({tried_artworks} tried)")
    return success


# ──────────────────────────────────────────────────────────────
# Art Institute of Chicago
# ──────────────────────────────────────────────────────────────

def fetch_aic(input_dir: Path, target: int, seed: int) -> int:
    """Fetch up to `target` images from AIC's public domain collection."""
    print(f"\n── Art Institute of Chicago (target: {target} works) ──")

    existing = len([p for p in input_dir.glob("aic_*.jpg") if p.stat().st_size > 15_000])
    if existing >= target:
        print(f"  Already have {existing} AIC images, skipping")
        return existing

    rng = random.Random(seed + 1)
    need = target - existing
    success = 0

    for search in AIC_SEARCHES:
        if success >= need:
            break
        url = (
            f"https://api.artic.edu/api/v1/artworks/search"
            f"?q={urllib.parse.quote(search)}"
            f"&fields=id,title,artist_display,image_id"
            f"&is_public_domain=true&limit=100"
        )
        result = api_get(url)
        if not result or not result.get("data"):
            time.sleep(REQUEST_DELAY)
            continue

        artworks = result["data"]
        rng.shuffle(artworks)

        for art in artworks:
            if success >= need:
                break
            image_id = art.get("image_id")
            if not image_id:
                continue

            img_url = f"https://www.artic.edu/iiif/2/{image_id}/full/843,/0/default.jpg"
            title = str(art.get("title") or "untitled")[:35].replace("/", "-").replace(" ", "_")
            artist = str(art.get("artist_display") or "unknown")[:20].replace(" ", "_")
            art_id = art.get("id", 0)
            fname = f"aic_{art_id}_{artist}_{title}.jpg"
            fname = "".join(c for c in fname if c.isalnum() or c in "._-")[:80]
            dest = input_dir / fname

            if dest.exists() and dest.stat().st_size > 15_000:
                success += 1
                continue

            data = download_bytes(img_url)
            if data and is_valid_image(data):
                dest.write_bytes(data)
                success += 1
            time.sleep(REQUEST_DELAY)

    print(f"  ✓ {success} AIC images downloaded")
    return success


# ──────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Download artworks from open-access museums and optionally process them",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Download 500, process immediately, delete raw images after
  python scripts/download_moma_art.py --count 500 --process --cleanup

  # Download 200 for preview
  python scripts/download_moma_art.py --count 200

  # Download 1000 and process without cleanup
  python scripts/download_moma_art.py --count 1000 --process
        """
    )
    parser.add_argument("--count", type=int, default=200,
                        help="Target total image count (default: 200)")
    parser.add_argument("--aic-bulk-share", type=float, default=0.7,
                        help="Fraction from AIC bulk pagination (default: 0.7)")
    parser.add_argument("--aic-share", type=float, default=0.1,
                        help="Fraction from AIC search queries (default: 0.1)")
    parser.add_argument("--process", action="store_true",
                        help="Run process_art.py after downloading")
    parser.add_argument("--cleanup", action="store_true",
                        help="Delete raw images after processing (requires --process)")
    parser.add_argument("--output-dir", type=Path,
                        default=Path(__file__).parent.parent / "input")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if args.cleanup and not args.process:
        parser.error("--cleanup requires --process")

    random.seed(args.seed)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Remove tiny placeholder images
    for name in ["mona_lisa.jpg", "the_scream.jpg", "girl_pearl.jpg"]:
        p = args.output_dir / name
        if p.exists() and p.stat().st_size < 400_000:
            p.unlink()

    # Allocate targets across sources
    wikimedia_count = len(WIKIMEDIA_WORKS)  # always fetch all curated works
    aic_bulk_target = int(args.count * args.aic_bulk_share)
    aic_search_target = int(args.count * args.aic_share)

    print(f"Downloading {args.count} artworks:")
    print(f"  Wikimedia Commons: {wikimedia_count} curated works")
    print(f"  Art Institute of Chicago (bulk pagination): ~{aic_bulk_target}")
    print(f"  Art Institute of Chicago (search diversity): ~{aic_search_target}")

    fetch_wikimedia(args.output_dir)
    fetch_aic_bulk(args.output_dir, aic_bulk_target, args.seed)
    fetch_aic(args.output_dir, aic_search_target, args.seed)

    # Final count
    all_images = [
        p for p in list(args.output_dir.glob("*.jpg")) + list(args.output_dir.glob("*.png"))
        if p.name != ".gitkeep" and p.stat().st_size > 15_000
    ]
    print(f"\n{'═'*55}")
    print(f"Total images ready: {len(all_images)}")

    if len(all_images) < 5:
        print("⚠  Too few images to process. Exiting.")
        sys.exit(1)

    if not args.process:
        print(f"\nTo process: cd data-pipeline && python3 scripts/process_art.py")
        print(f"To process+cleanup: python3 scripts/download_moma_art.py --process --cleanup")
        return

    # Run pipeline
    print(f"\n── Running art processing pipeline on {len(all_images)} images ──")
    pipeline = Path(__file__).parent / "process_art.py"
    result = subprocess.run([sys.executable, str(pipeline)], check=False)

    if result.returncode != 0:
        print("⚠  Pipeline failed. Raw images preserved.")
        sys.exit(1)

    # Copy to frontend
    bin_src = Path(__file__).parent.parent / "output" / "art_states.bin"
    bin_dst = Path(__file__).parent.parent.parent / "frontend" / "public" / "data" / "art_states.bin"
    if bin_src.exists() and bin_dst.parent.exists():
        import shutil
        shutil.copy2(bin_src, bin_dst)
        print(f"✓ Copied art_states.bin → frontend/public/data/ ({bin_src.stat().st_size // 1024}KB)")

    # Cleanup
    if args.cleanup:
        print(f"\n── Cleaning up {len(all_images)} raw images ──")
        deleted = 0
        for img in all_images:
            try:
                img.unlink()
                deleted += 1
            except Exception:
                pass
        print(f"  Deleted {deleted} raw images. Disk space reclaimed.")

    print(f"\n✓ Done. Reload the browser to see new art data.")


if __name__ == "__main__":
    main()
