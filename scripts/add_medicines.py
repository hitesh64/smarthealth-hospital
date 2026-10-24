"""Adds a starter list of common over-the-counter medicines to the pharmacy (Admin > Medicine Stock
and the patient Medicine Store).

    python scripts/add_medicines.py                    -> the database in MONGO_URI (.env)
    set MONGO_URI=mongodb+srv://... & python scripts/add_medicines.py   -> another database (e.g. Atlas)

Only medicines that can be sold without a prescription are listed: the store has no prescription
upload. Prices are the approximate MRP of the pack - check them against the packs you stock and
correct them in Admin > Medicine Stock. A medicine already in the list (same name) is left as it is,
so the script can be run again safely.
Every medicine without a photo (also ones added by hand) gets a drawn pack picture, kept in the
database; replace it with a real photo in Admin > Medicine Stock whenever you like.
"""
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.db import db, next_id  # noqa: E402
from backend.med_art import pack_svg  # noqa: E402
from backend.utils import store_image  # noqa: E402

TODAY = date.today()


def expiry(months):
    """A realistic expiry date `months` from today (medicine packs carry 1.5-3 years)."""
    y, m = divmod(TODAY.month - 1 + months, 12)
    return f"{TODAY.year + y:04d}-{m + 1:02d}-28"


# name, category, unit, price (Rs. per unit), stock, reorder level, months to expiry, description
MEDICINES = [
    # ---- Fever & Pain
    ("Dolo 650 Tablet", "Fever & Pain", "strips", 33.60, 150, 30, 30,
     "Paracetamol 650 mg. Strip of 15 tablets. For fever, headache and body pain. Adults: 1 tablet every 6 hours if needed; not more than 4 tablets in 24 hours."),
    ("Crocin Advance 500 mg Tablet", "Fever & Pain", "strips", 20.00, 120, 30, 30,
     "Paracetamol 500 mg. Strip of 15 tablets. For fever and mild to moderate pain. Do not take with other paracetamol medicines."),
    ("Calpol 500 mg Tablet", "Fever & Pain", "strips", 15.00, 100, 25, 30,
     "Paracetamol 500 mg. Strip of 15 tablets. For fever and pain. Keep at least 4 hours between doses."),
    ("Combiflam Tablet", "Fever & Pain", "strips", 45.00, 80, 20, 24,
     "Ibuprofen 400 mg + Paracetamol 325 mg. Strip of 20 tablets. For pain, swelling and fever. Take after food; avoid with stomach ulcers, kidney disease or in pregnancy."),
    ("Saridon Tablet", "Fever & Pain", "strips", 42.00, 80, 20, 24,
     "Paracetamol, propyphenazone and caffeine. Strip of 10 tablets. For headache. Not more than 2 tablets a day; not for children under 12."),
    ("Volini Pain Relief Gel 30 g", "Fever & Pain", "tubes", 125.00, 40, 10, 24,
     "Diclofenac gel for muscle, joint and back pain. Apply a thin layer 3-4 times a day on unbroken skin only."),
    ("Moov Pain Relief Cream 50 g", "Fever & Pain", "tubes", 180.00, 30, 10, 30,
     "Ayurvedic cream with wintergreen oil for back pain and muscle aches. For external use only."),

    # ---- Cold & Cough
    ("Cetzine 10 mg Tablet", "Cold & Cough", "strips", 20.00, 120, 30, 30,
     "Cetirizine 10 mg. Strip of 10 tablets. For sneezing, runny nose and allergy. 1 tablet at night; may cause drowsiness."),
    ("Sinarest Tablet", "Cold & Cough", "strips", 50.00, 80, 20, 24,
     "Paracetamol, phenylephrine and chlorpheniramine. Strip of 10 tablets. For cold with blocked nose and fever. May cause drowsiness - do not drive."),
    ("Vicks VapoRub 50 ml", "Cold & Cough", "bottles", 155.00, 40, 10, 36,
     "Menthol, camphor and eucalyptus rub for blocked nose and cough. Rub on chest and back; not for children under 2 years."),
    ("Benadryl Cough Syrup 150 ml", "Cold & Cough", "bottles", 135.00, 40, 10, 24,
     "Diphenhydramine cough syrup for dry and allergic cough. Adults: 10 ml up to 3 times a day. Causes drowsiness."),
    ("Strepsils Honey & Lemon (8 lozenges)", "Cold & Cough", "packs", 45.00, 60, 15, 30,
     "Antiseptic lozenges for sore throat. Dissolve 1 lozenge slowly in the mouth every 2-3 hours; not more than 12 a day."),
    ("Otrivin Oxy Nasal Spray 10 ml", "Cold & Cough", "bottles", 120.00, 30, 10, 30,
     "Oxymetazoline nasal spray for blocked nose. 1-2 sprays in each nostril up to 2 times a day; do not use for more than 5 days."),

    # ---- Stomach & Digestion
    ("Electral ORS Powder 21.8 g", "Stomach & Digestion", "sachets", 22.00, 200, 40, 24,
     "WHO-formula oral rehydration salts. Mix 1 sachet in 1 litre of clean drinking water. For loose motions, vomiting and dehydration."),
    ("Digene Mint Tablet", "Stomach & Digestion", "strips", 26.00, 100, 25, 24,
     "Antacid with simethicone. Strip of 15 chewable tablets. For acidity, heartburn and gas. Chew 1-2 tablets after meals."),
    ("Gelusil MPS Liquid 200 ml", "Stomach & Digestion", "bottles", 130.00, 40, 10, 24,
     "Antacid suspension for acidity and gas. 10 ml after meals and at bedtime. Shake well before use."),
    ("ENO Fruit Salt Lemon 100 g", "Stomach & Digestion", "bottles", 165.00, 40, 10, 24,
     "Fast relief from acidity. Mix 1 teaspoon (5 g) in a glass of water and drink while it fizzes."),
    ("Pudin Hara Pearls", "Stomach & Digestion", "strips", 25.00, 80, 20, 24,
     "Ayurvedic mint oil pearls. Strip of 10. For indigestion, stomach ache and gas. 1-2 pearls with water."),

    # ---- Vitamins & Supplements
    ("Becosules Capsule", "Vitamins & Supplements", "strips", 52.00, 100, 25, 24,
     "Vitamin B-complex with vitamin C. Strip of 20 capsules. For weakness, mouth ulcers and recovery after illness. 1 capsule a day."),
    ("Limcee 500 mg Chewable Tablet", "Vitamins & Supplements", "strips", 24.00, 100, 25, 18,
     "Vitamin C 500 mg, orange flavour. Strip of 15 tablets. Supports immunity. Chew 1 tablet a day."),
    ("Shelcal 500 Tablet", "Vitamins & Supplements", "strips", 114.00, 60, 15, 24,
     "Calcium 500 mg + Vitamin D3 250 IU. Strip of 15 tablets. For bone health. 1 tablet a day after food."),
    ("Zincovit Tablet", "Vitamins & Supplements", "strips", 105.00, 60, 15, 24,
     "Multivitamin and multimineral with zinc. Strip of 15 tablets. 1 tablet a day after a meal."),
    ("Revital H Capsule (30)", "Vitamins & Supplements", "bottles", 345.00, 25, 8, 24,
     "Multivitamin with ginseng and minerals. Bottle of 30 capsules. For daily energy. 1 capsule a day after breakfast."),

    # ---- First Aid
    ("Dettol Antiseptic Liquid 125 ml", "First Aid", "bottles", 89.00, 50, 15, 36,
     "Antiseptic for cleaning cuts and wounds. Always dilute: 1 capful in half a mug of water for wounds."),
    ("Betadine 5% Ointment 20 g", "First Aid", "tubes", 130.00, 40, 10, 24,
     "Povidone-iodine ointment for minor cuts, burns and wounds. Apply on the cleaned wound 1-3 times a day."),
    ("Hansaplast Washproof Strips (20)", "First Aid", "packs", 50.00, 60, 15, 48,
     "Waterproof adhesive bandage strips for small cuts and scratches. Pack of 20."),
    ("Absorbent Cotton Roll 100 g", "First Aid", "packs", 60.00, 50, 15, 60,
     "Sterile-quality absorbent cotton for cleaning wounds and applying medicine."),
    ("Crepe Bandage 10 cm x 4 m", "First Aid", "packs", 110.00, 30, 10, 60,
     "Elastic crepe bandage for sprains and support of joints. Do not wrap too tight."),

    # ---- Skin Care
    ("Boroline Antiseptic Cream 20 g", "Skin Care", "tubes", 40.00, 60, 15, 36,
     "Ayurvedic antiseptic cream for cracked lips, dry skin, cracked heels and small cuts."),
    ("Lacto Calamine Lotion 120 ml", "Skin Care", "bottles", 140.00, 30, 10, 30,
     "Calamine lotion for oily skin, rashes and itching from sunburn or insect bites. Shake well; apply with cotton."),

    # ---- Diabetes (devices, no prescription needed)
    ("Accu-Chek Active Test Strips (50)", "Diabetes", "packs", 1265.00, 20, 5, 18,
     "50 blood glucose test strips for the Accu-Chek Active meter. Store below 30 C; use within the expiry printed on the box."),
    ("Accu-Chek Softclix Lancets (25)", "Diabetes", "packs", 150.00, 20, 5, 48,
     "25 sterile lancets for the Accu-Chek Softclix device. Use each lancet only once."),

    # ---- Baby Care
    ("Woodward's Gripe Water 130 ml", "Baby Care", "bottles", 65.00, 30, 10, 18,
     "For gas and colic in infants. Use the dose for the baby's age printed on the bottle."),
    ("Himalaya Diaper Rash Cream 20 g", "Baby Care", "tubes", 80.00, 30, 10, 24,
     "Herbal cream that soothes and protects against diaper rash. Apply at each diaper change."),

    # ---- General
    ("Dettol Hand Sanitizer 100 ml", "General", "bottles", 50.00, 60, 15, 30,
     "Alcohol-based hand sanitizer. Kills germs without water. Keep away from fire."),
    ("Dr Trust Digital Thermometer", "General", "packs", 199.00, 20, 5, 60,
     "Digital thermometer with beep and memory, 60-second reading. For oral or underarm use."),
]


def main():
    have = {(m.get("name") or "").strip().lower() for m in db.medicines.find({}, {"name": 1})}
    added = 0
    for name, cat, unit, price, stock, reorder, months, desc in MEDICINES:
        if name.lower() in have:
            continue
        db.medicines.insert_one({
            "_id": next_id("medicines"), "name": name, "stock": stock, "reorder_level": reorder, "unit": unit,
            "expiry_date": expiry(months), "price": float(price), "category": cat, "description": desc,
            "for_sale": 1, "image": None, "updated_at": datetime.now(timezone.utc)})
        added += 1
    print(f"Added {added} medicines ({len(MEDICINES) - added} were already there). Total now: {db.medicines.count_documents({})}")

    # a pack picture for every medicine that has no photo yet
    no_photo = {"$or": [{"image": None}, {"image": ""}, {"image": {"$exists": False}}]}
    drawn = 0
    for m in db.medicines.find(no_photo):
        svg = pack_svg(m["name"], m.get("unit"), m.get("category") or "General", m.get("description") or "")
        db.medicines.update_one({"_id": m["_id"], **no_photo},
                                {"$set": {"image": store_image(svg.encode("utf-8"), "svg", "medicines")}})
        drawn += 1
    print(f"Pack pictures added: {drawn}")


if __name__ == "__main__":
    main()
