"""The laboratory's standard tests, their reference ranges, and how a result is flagged.

Reference ranges are common adult ranges used by Indian pathology labs. Every lab should check them
against its own analysers - the admin can change any range in Admin > Laboratory > Test catalogue.

A parameter is a dict:
    key      short id used in results            name   shown on the report
    unit     unit shown on the report            type   number | choice | text
    range    [low, high] or {"M": [..], "F": [..]}   (either end may be None)
    ref      reference text when a range cannot say it all (e.g. diabetes cut-offs)
    calc     formula from other keys of the same test, filled in automatically (e.g. "tc - hdl - tg / 5")
    calc_if  condition for the formula (e.g. "tg < 400")
    choices  options for a choice parameter      normal  the choices that are not abnormal
    decimals digits shown for a number
"""
import ast
import operator

P = dict  # short alias for readability below


def num(key, name, unit, rng, decimals=1, **extra):
    return P(key=key, name=name, unit=unit, type="number", range=rng, decimals=decimals, **extra)


def choice(key, name, choices, normal, **extra):
    return P(key=key, name=name, unit="", type="choice", choices=choices, normal=normal, **extra)


def text_field(key, name, **extra):
    return P(key=key, name=name, unit="", type="text", **extra)


NEG_POS = ["Negative", "Positive"]
NIL_PLUS = ["Nil", "Trace", "1+", "2+", "3+", "4+"]

TESTS = [
    # ------------------------------------------------------------ haematology
    P(code="CBC", name="Complete Blood Count (CBC)", category="Haematology", sample="Blood (EDTA tube)", price=350,
      tat_hours=12, fasting_hours=0, home=True, popular=True,
      description="Checks red cells, white cells and platelets - for anaemia, infection, weakness and general health.",
      preparation="No fasting needed.",
      parameters=[
          num("hb", "Haemoglobin", "g/dL", {"M": [13.0, 17.0], "F": [12.0, 15.0]}),
          num("rbc", "RBC Count", "million/µL", {"M": [4.5, 5.5], "F": [3.8, 4.8]}, 2),
          num("pcv", "Haematocrit (PCV)", "%", {"M": [40, 50], "F": [36, 46]}),
          num("mcv", "MCV", "fL", [83, 101], calc="pcv * 10 / rbc"),
          num("mch", "MCH", "pg", [27, 32], calc="hb * 10 / rbc"),
          num("mchc", "MCHC", "g/dL", [31.5, 34.5], calc="hb * 100 / pcv"),
          num("rdw", "RDW-CV", "%", [11.6, 14.0]),
          num("wbc", "Total WBC Count", "cells/µL", [4000, 11000], 0),
          num("neut", "Neutrophils", "%", [40, 80], 0),
          num("lymph", "Lymphocytes", "%", [20, 40], 0),
          num("mono", "Monocytes", "%", [2, 10], 0),
          num("eos", "Eosinophils", "%", [1, 6], 0),
          num("baso", "Basophils", "%", [0, 2], 0),
          num("plt", "Platelet Count", "cells/µL", [150000, 410000], 0),
      ]),
    P(code="ESR", name="ESR (Erythrocyte Sedimentation Rate)", category="Haematology", sample="Blood (EDTA tube)", price=120,
      tat_hours=6, fasting_hours=0, home=True, popular=False,
      description="A general marker of inflammation or infection in the body.",
      preparation="No fasting needed.",
      parameters=[num("esr", "ESR (Westergren)", "mm/hr", {"M": [0, 15], "F": [0, 20]}, 0)]),

    # ------------------------------------------------------------ diabetes
    P(code="FBS", name="Blood Sugar - Fasting (FBS)", category="Diabetes", sample="Blood (Fluoride tube)", price=100,
      tat_hours=6, fasting_hours=8, home=True, popular=True,
      description="Blood glucose after an overnight fast - screens for diabetes and prediabetes.",
      preparation="Fast for 8-10 hours (water is allowed). Take diabetes medicines only after the sample.",
      parameters=[num("fbs", "Glucose, Fasting", "mg/dL", [70, 99], 0,
                      ref="70-99 Normal · 100-125 Prediabetes · 126 or more Diabetes")]),
    P(code="PPBS", name="Blood Sugar - Post Prandial (PPBS)", category="Diabetes", sample="Blood (Fluoride tube)", price=100,
      tat_hours=6, fasting_hours=0, home=True, popular=False,
      description="Blood glucose 2 hours after a meal - shows how the body handles sugar after eating.",
      preparation="Give the sample exactly 2 hours after starting a normal meal.",
      parameters=[num("ppbs", "Glucose, 2 h Post Prandial", "mg/dL", [70, 139], 0,
                      ref="Below 140 Normal · 140-199 Prediabetes · 200 or more Diabetes")]),
    P(code="HBA1C", name="HbA1c (Glycated Haemoglobin)", category="Diabetes", sample="Blood (EDTA tube)", price=450,
      tat_hours=24, fasting_hours=0, home=True, popular=True,
      description="Average blood sugar of the last 2-3 months. The main test to diagnose and follow diabetes.",
      preparation="No fasting needed.",
      parameters=[
          num("hba1c", "HbA1c", "%", [4.0, 5.6], 1, ref="Below 5.7 Normal · 5.7-6.4 Prediabetes · 6.5 or more Diabetes"),
          num("eag", "Estimated Average Glucose (eAG)", "mg/dL", [None, None], 0, calc="28.7 * hba1c - 46.7",
              ref="Calculated from HbA1c"),
      ]),

    # ------------------------------------------------------------ heart
    P(code="LIPID", name="Lipid Profile", category="Heart", sample="Blood (Serum)", price=600,
      tat_hours=12, fasting_hours=10, home=True, popular=True,
      description="Cholesterol and triglycerides - the main test for heart and stroke risk.",
      preparation="Fast for 10-12 hours (water is allowed). Avoid alcohol and fatty food the evening before.",
      parameters=[
          num("tc", "Total Cholesterol", "mg/dL", [None, 199], 0, ref="Below 200 Desirable · 200-239 Borderline · 240 or more High"),
          num("tg", "Triglycerides", "mg/dL", [None, 149], 0, ref="Below 150 Normal · 150-199 Borderline · 200-499 High"),
          num("hdl", "HDL Cholesterol", "mg/dL", {"M": [40, None], "F": [50, None]}, 0),
          num("ldl", "LDL Cholesterol (calculated)", "mg/dL", [None, 99], 0, calc="tc - hdl - tg / 5", calc_if="tg < 400",
              ref="Below 100 Optimal · 100-129 Near optimal · 130-159 Borderline · 160 or more High"),
          num("vldl", "VLDL Cholesterol (calculated)", "mg/dL", [None, 30], 0, calc="tg / 5", calc_if="tg < 400"),
          num("nonhdl", "Non-HDL Cholesterol", "mg/dL", [None, 129], 0, calc="tc - hdl"),
          num("ratio", "Total Cholesterol / HDL Ratio", "", [None, 5.0], 1, calc="tc / hdl"),
      ]),
    P(code="ECG", name="ECG (12-lead Electrocardiogram)", category="Imaging & ECG", sample="No sample (done at the hospital)", price=300,
      tat_hours=2, fasting_hours=0, home=False, popular=False,
      description="Records the heart's electrical activity - for chest pain, palpitations and heart check-ups.",
      preparation="Wear loose clothing. Avoid applying oil or lotion on the chest.",
      parameters=[
          num("hr", "Heart Rate", "bpm", [60, 100], 0),
          choice("rhythm", "Rhythm", ["Normal sinus rhythm", "Sinus tachycardia", "Sinus bradycardia", "Atrial fibrillation", "Other arrhythmia"],
                 ["Normal sinus rhythm"]),
          text_field("impression", "Impression"),
      ]),

    # ------------------------------------------------------------ liver
    P(code="LFT", name="Liver Function Test (LFT)", category="Liver", sample="Blood (Serum)", price=700,
      tat_hours=12, fasting_hours=0, home=True, popular=True,
      description="Bilirubin, liver enzymes and proteins - for jaundice, fatty liver, alcohol and medicine effects.",
      preparation="No fasting needed; a light breakfast is fine. Avoid alcohol for 24 hours before the test.",
      parameters=[
          num("tbil", "Bilirubin - Total", "mg/dL", [0.3, 1.2], 2),
          num("dbil", "Bilirubin - Direct", "mg/dL", [0.0, 0.3], 2),
          num("ibil", "Bilirubin - Indirect", "mg/dL", [0.1, 1.0], 2, calc="tbil - dbil"),
          num("ast", "SGOT (AST)", "U/L", [5, 40], 0),
          num("alt", "SGPT (ALT)", "U/L", [7, 56], 0),
          num("alp", "Alkaline Phosphatase (ALP)", "U/L", [44, 147], 0),
          num("ggt", "Gamma GT (GGT)", "U/L", {"M": [8, 61], "F": [5, 36]}, 0),
          num("tp", "Total Protein", "g/dL", [6.0, 8.3]),
          num("alb", "Albumin", "g/dL", [3.5, 5.2]),
          num("glob", "Globulin", "g/dL", [2.0, 3.5], calc="tp - alb"),
          num("ag", "A/G Ratio", "", [1.1, 2.5], calc="alb / glob"),
      ]),

    # ------------------------------------------------------------ kidney
    P(code="KFT", name="Kidney Function Test (KFT / RFT)", category="Kidney", sample="Blood (Serum)", price=650,
      tat_hours=12, fasting_hours=0, home=True, popular=True,
      description="Urea, creatinine, uric acid and electrolytes - how well the kidneys filter the blood.",
      preparation="No fasting needed. Drink water normally.",
      parameters=[
          num("urea", "Blood Urea", "mg/dL", [17, 43], 0),
          num("bun", "Blood Urea Nitrogen (BUN)", "mg/dL", [7, 20], 1, calc="urea / 2.14"),
          num("creat", "Serum Creatinine", "mg/dL", {"M": [0.7, 1.3], "F": [0.6, 1.1]}, 2),
          num("uric", "Uric Acid", "mg/dL", {"M": [3.5, 7.2], "F": [2.6, 6.0]}),
          num("na", "Sodium", "mmol/L", [136, 145], 0),
          num("k", "Potassium", "mmol/L", [3.5, 5.1]),
          num("cl", "Chloride", "mmol/L", [98, 107], 0),
          num("ca", "Calcium", "mg/dL", [8.6, 10.2]),
      ]),

    # ------------------------------------------------------------ thyroid
    P(code="THYROID", name="Thyroid Profile (T3, T4, TSH)", category="Thyroid", sample="Blood (Serum)", price=500,
      tat_hours=24, fasting_hours=0, home=True, popular=True,
      description="Thyroid hormones - for weight change, tiredness, hair fall and irregular periods.",
      preparation="No fasting needed. Give the sample before taking your thyroid tablet that morning.",
      parameters=[
          num("t3", "Total T3", "ng/dL", [80, 200], 0),
          num("t4", "Total T4", "µg/dL", [5.1, 14.1]),
          num("tsh", "TSH (Ultrasensitive)", "µIU/mL", [0.27, 4.20], 2),
      ]),
    P(code="TSH", name="TSH (Ultrasensitive)", category="Thyroid", sample="Blood (Serum)", price=300,
      tat_hours=24, fasting_hours=0, home=True, popular=False,
      description="The single best screening test for an under- or over-active thyroid.",
      preparation="No fasting needed. Give the sample before taking your thyroid tablet that morning.",
      parameters=[num("tsh", "TSH (Ultrasensitive)", "µIU/mL", [0.27, 4.20], 2)]),

    # ------------------------------------------------------------ vitamins
    P(code="VITD", name="Vitamin D (25-OH)", category="Vitamins", sample="Blood (Serum)", price=1200,
      tat_hours=24, fasting_hours=0, home=True, popular=True,
      description="Vitamin D level - for bone pain, weakness, low immunity. Deficiency is very common in India.",
      preparation="No fasting needed.",
      parameters=[num("vitd", "25-Hydroxy Vitamin D", "ng/mL", [30, 100], 1,
                      ref="Below 20 Deficient · 20-29 Insufficient · 30-100 Sufficient · above 100 Risk of toxicity")]),
    P(code="VITB12", name="Vitamin B12", category="Vitamins", sample="Blood (Serum)", price=900,
      tat_hours=24, fasting_hours=0, home=True, popular=False,
      description="Vitamin B12 level - for tingling, numbness, tiredness and some anaemias.",
      preparation="Fasting for 6-8 hours is preferred.",
      parameters=[num("b12", "Vitamin B12", "pg/mL", [211, 911], 0)]),

    # ------------------------------------------------------------ infection
    P(code="CRP", name="C-Reactive Protein (CRP), Quantitative", category="Infection", sample="Blood (Serum)", price=450,
      tat_hours=6, fasting_hours=0, home=True, popular=False,
      description="A marker of infection and inflammation; used to follow fever and infections.",
      preparation="No fasting needed.",
      parameters=[num("crp", "CRP", "mg/L", [0, 5], 1)]),
    P(code="DENGUE", name="Dengue NS1 Antigen", category="Infection", sample="Blood (Serum)", price=600,
      tat_hours=6, fasting_hours=0, home=True, popular=True,
      description="Detects dengue in the first 1-5 days of fever.",
      preparation="No fasting needed. Best done within the first 5 days of fever.",
      parameters=[choice("ns1", "Dengue NS1 Antigen", NEG_POS, ["Negative"])]),
    P(code="MALARIA", name="Malaria Antigen (P. falciparum / P. vivax)", category="Infection", sample="Blood (EDTA tube)", price=400,
      tat_hours=4, fasting_hours=0, home=True, popular=False,
      description="Rapid test for the two common malaria parasites.",
      preparation="No fasting needed. Best done while you have fever.",
      parameters=[choice("pf", "P. falciparum antigen", NEG_POS, ["Negative"]),
                  choice("pv", "P. vivax antigen", NEG_POS, ["Negative"])]),

    # ------------------------------------------------------------ urine
    P(code="URINE", name="Urine Routine & Microscopy", category="Urine", sample="Urine (sterile container)", price=150,
      tat_hours=6, fasting_hours=0, home=True, popular=True,
      description="For urinary infection, kidney problems, sugar or protein in the urine.",
      preparation="Collect the first morning urine, mid-stream, in the sterile container given to you.",
      parameters=[
          choice("colour", "Colour", ["Pale yellow", "Yellow", "Dark yellow", "Red", "Brown"], ["Pale yellow", "Yellow"]),
          choice("appearance", "Appearance", ["Clear", "Slightly turbid", "Turbid"], ["Clear"]),
          num("ph", "pH", "", [4.6, 8.0]),
          num("sg", "Specific Gravity", "", [1.005, 1.030], 3),
          choice("protein", "Protein", NIL_PLUS, ["Nil"]),
          choice("glucose", "Glucose", NIL_PLUS, ["Nil"]),
          choice("ketones", "Ketone Bodies", ["Negative", "Trace", "Positive"], ["Negative"]),
          choice("bilirubin", "Bilirubin", NEG_POS, ["Negative"]),
          num("pus", "Pus Cells", "/hpf", [0, 5], 0),
          num("urbc", "Red Blood Cells", "/hpf", [0, 2], 0),
          num("epi", "Epithelial Cells", "/hpf", [0, 5], 0),
          choice("casts", "Casts", ["Not seen", "Present"], ["Not seen"]),
          choice("crystals", "Crystals", ["Not seen", "Present"], ["Not seen"]),
      ]),

    # ------------------------------------------------------------ imaging
    P(code="XRAY", name="Chest X-Ray (PA view)", category="Imaging & ECG", sample="No sample (done at the hospital)", price=450,
      tat_hours=4, fasting_hours=0, home=False, popular=False,
      description="Picture of the lungs and heart - for cough, breathlessness, chest infection.",
      preparation="Remove metal items (chains, belts). Tell the staff if you may be pregnant.",
      parameters=[text_field("findings", "Findings"), text_field("impression", "Impression")]),

    # ------------------------------------------------------------ packages
    P(code="PKG-BASIC", name="Basic Health Checkup", category="Health Packages", price=999, popular=True,
      description="A yearly check of blood counts, sugar, cholesterol, thyroid and urine.",
      includes=["CBC", "FBS", "LIPID", "TSH", "URINE"]),
    P(code="PKG-DIABETES", name="Diabetes Care Package", category="Health Packages", price=999, popular=True,
      description="Everything a diabetic needs every 3 months: sugar, HbA1c, kidneys and urine.",
      includes=["FBS", "PPBS", "HBA1C", "KFT", "URINE"]),
    P(code="PKG-FEVER", name="Fever Panel", category="Health Packages", price=1299, popular=True,
      description="For fever lasting more than 2 days: blood counts, inflammation, dengue, malaria and urine.",
      includes=["CBC", "ESR", "CRP", "DENGUE", "MALARIA", "URINE"]),
    P(code="PKG-FULL", name="Full Body Checkup", category="Health Packages", price=2499, popular=True,
      description="Complete check of blood, sugar, heart, liver, kidneys, thyroid and vitamins - 11 tests.",
      includes=["CBC", "ESR", "FBS", "HBA1C", "LIPID", "LFT", "KFT", "THYROID", "VITD", "VITB12", "URINE"]),
]

CATEGORY_ORDER = ["Health Packages", "Haematology", "Diabetes", "Heart", "Liver", "Kidney", "Thyroid",
                  "Vitamins", "Infection", "Urine", "Imaging & ECG"]


# ---------------------------------------------------------------- results

def range_for(param, gender):
    rng = param.get("range")
    if isinstance(rng, dict):
        if gender in rng:
            return rng[gender]
        # no gender given: the widest range of the two, so nothing is flagged by mistake
        lows = [r[0] for r in rng.values() if r[0] is not None]
        highs = [r[1] for r in rng.values() if r[1] is not None]
        return [min(lows) if lows else None, max(highs) if highs else None]
    return rng or [None, None]


def fmt_num(v, decimals):
    if v is None:
        return ""
    if decimals == 0:
        return f"{int(round(v)):,}"
    return f"{v:.{decimals}f}"


def ref_text(param, gender=""):
    if param.get("ref"):
        return param["ref"]
    if param["type"] == "choice":
        return " / ".join(param.get("normal") or [])
    if param["type"] != "number":
        return ""
    d = param.get("decimals", 1)

    def one(r):
        lo, hi = r
        if lo is not None and hi is not None:
            return f"{fmt_num(lo, d)} - {fmt_num(hi, d)}"
        if lo is not None:
            return f"{fmt_num(lo, d)} or more"
        if hi is not None:
            return f"up to {fmt_num(hi, d)}"
        return ""
    rng = param.get("range")
    if isinstance(rng, dict):
        if gender in rng:
            return one(rng[gender])
        return " · ".join(f"{'Male' if g == 'M' else 'Female'}: {one(r)}" for g, r in rng.items())
    return one(rng or [None, None])


def flag_for(param, value, gender=""):
    """'L' below range, 'H' above range, 'A' abnormal finding, '' normal or no value."""
    if value is None or value == "":
        return ""
    if param["type"] == "number":
        try:
            v = float(value)
        except (TypeError, ValueError):
            return ""
        lo, hi = range_for(param, gender)
        if lo is not None and v < lo:
            return "L"
        if hi is not None and v > hi:
            return "H"
        return ""
    if param["type"] == "choice" and param.get("normal"):
        normal = [n.lower() for n in param["normal"]]
        return "" if str(value).strip().lower() in normal else "A"
    return ""


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Lt: operator.lt, ast.LtE: operator.le, ast.Gt: operator.gt, ast.GtE: operator.ge}


def _eval(expr, values):
    """Evaluates a small formula such as 'tc - hdl - tg / 5' with only + - * / and comparisons."""
    def walk(node):
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.Compare) and len(node.ops) == 1 and type(node.ops[0]) in _OPS:
            return _OPS[type(node.ops[0])](walk(node.left), walk(node.comparators[0]))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -walk(node.operand)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.Name):
            v = values.get(node.id)
            if v is None:
                raise KeyError(node.id)
            return v
        raise ValueError("unsupported formula")
    return walk(ast.parse(expr, mode="eval"))


def fill_calculated(parameters, raw):
    """Number values of a test (str -> float), with calculated parameters filled in where the
    technician left them empty."""
    values = {}
    for p in parameters:
        if p["type"] == "number":
            try:
                values[p["key"]] = float(str(raw.get(p["key"], "")).replace(",", "").strip())
            except ValueError:
                values[p["key"]] = None
    for p in parameters:
        if p["type"] == "number" and p.get("calc") and values.get(p["key"]) is None:
            try:
                if p.get("calc_if") and not _eval(p["calc_if"], values):
                    continue
                v = _eval(p["calc"], values)
                values[p["key"]] = round(v, p.get("decimals", 1) + 1)
            except (KeyError, ZeroDivisionError, ValueError):
                pass
    return values
