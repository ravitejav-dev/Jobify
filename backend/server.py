#!/usr/bin/env python3
"""Jobify Companion Local Server (Port 8765)
Provides:
1. /api/compile-pdf  -> Publication-grade single-column ATS LaTeX -> PDF via /usr/bin/pdflatex
2. /api/imap-otp     -> Gmail App Password IMAP verification code / magic link reader
3. /sandbox/greenhouse, /sandbox/workday, /sandbox/lever -> Realistic ATS test portals
"""

import base64
import email
import email.utils
import imaplib
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("JOBIFY_PORT", "18765"))
GEMINI_MODEL_COOLDOWN = {}
SANDBOX_OTP_STORE = {
    "otp": None,
    "verificationUrl": None,
    "accountVerified": False,
    "subject": "",
    "from": "",
    "timestampMs": 0,
}


def tex_escape(text: str) -> str:
    if not text:
        return ""
    s = str(text)
    s = s.replace("\u2013", "--").replace("\u2014", "---")
    s = s.replace("\u2192", "\x00ARROW\x00").replace("->", "\x00ARROW\x00")
    s = s.replace("\u2018", "'").replace("\u2019", "'").replace("\u201c", "``").replace("\u201d", "''")
    replacements = {
        "\\": r"\textbackslash{}",
        "&": r"\&",
        "%": r"\%",
        "$": r"\$",
        "#": r"\#",
        "_": r"\_",
        "{": r"\{",
        "}": r"\}",
        "~": r"$\sim$",
        "^": r"\textasciicircum{}",
        "<": r"\textless{}",
        ">": r"\textgreater{}",
    }
    out = []
    for ch in s:
        if ch == "\x00":
            out.append(ch)
        elif ch in replacements:
            out.append(replacements[ch])
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out).replace("\x00ARROW\x00", r"$\rightarrow$")


METRIC_BOLD_PATTERN = re.compile(
    r"("
    r"Ranked\s+(?:#1\s+of\s+11|first\s+among\s+11)\s+(?:engineers|developers)"
    r"|#1\s+of\s+11\s+(?:engineers|developers)"
    r"|13\s+(?:containerized\s+)?full-stack\s+sandbox(?:ed)?\s+(?:web\s+)?applications"
    r"|48\s+(?:multi-modal\s+)?(?:user\s+)?personas"
    r"|48\s+test\s+accounts"
    r"|9\s+cloud\s+(?:services|APIs)"
    r"|100%\s+(?:[a-z-]+\s+){0,2}(?:accuracy|integrity|pass\s+rates)"
    r"|1,800\+?\s+(?:[a-z-]+\s+)?recordings"
    r"|40,000\+?\s+(?:[a-z-]+\s+)?clips"
    r"|8\s+languages"
    r"|10x(?:\s+throughput\s+speedup|\s+throughput\s+acceleration|\s+speedup)?"
    r"|10\s+days"
    r"|2,000\+?\s+(?:ingestion\s+and\s+extraction\s+|ingestion\s+|data\s+)?batches"
    r"|460\+?\s+(?:evaluation\s+|production\s+|multi-stage\s+deduplication\s+)?workflows"
    r"|19\s+(?:custom\s+)?(?:React\s+and\s+TypeScript\s+|TypeScript\s+and\s+React\s+)?(?:Side-by-Side\s+(?:\(SxS\)\s+)?)?(?:evaluation\s+|multi-model\s+evaluation\s+|rating\s+)?(?:plugins|applications|interfaces)"
    r"|~?60%"
    r"|70%"
    r"|40\+?\s+edge\s+cases"
    r"|60\+?\s+FPS"
    r"|30\+?\s+(?:critical\s+)?integration\s+defects"
    r"|(?:10,000\+?|10K\+?)\s+(?:daily\s+)?test\s+cases(?:\s+daily)?"
    r"|12\+?\s+model\s+iterations"
    r"|95%\+?(?:\s+of\s+silent\s+(?:edge-case\s+)?failures)?"
    r"|95\s+percent\s+of\s+silent\s+failures"
    r"|40%"
    r"|8\+?\s+(?:engineering\s+)?teams"
    r"|30\+?\s+(?:modular\s+|schema\s+and\s+API\s+contract\s+verification\s+)?plugins"
    r"|3\.5\+?\s+years"
    r")",
    re.IGNORECASE,
)


def tex_escape_with_bold_metrics(text: str) -> str:
    if not text:
        return ""
    parts = []
    last_idx = 0
    s = str(text)
    for m in METRIC_BOLD_PATTERN.finditer(s):
        if m.start() > last_idx:
            parts.append(tex_escape(s[last_idx : m.start()]))
        parts.append(rf"\textbf{{{tex_escape(m.group(0))}}}")
        last_idx = m.end()
    if last_idx < len(s):
        parts.append(tex_escape(s[last_idx:]))
    return "".join(parts)


def build_resume_latex(tailored: dict, profile: dict) -> str:
    p = profile.get("personal", {})
    name = tex_escape(p.get("fullName", "Raviteja Velanati"))
    target_title = tex_escape((tailored.get("targetJobTitle") or "").strip())
    city_state = tex_escape(f"{p.get('city', 'Newark')}, {p.get('stateCode', 'CA')}")
    mail = tex_escape(p.get("email", "ravitejavelanati11@gmail.com"))
    phone = tex_escape(p.get("phone", "(774) 810-8481"))
    li = tex_escape(re.sub(r"^https?://(www\.)?", "", p.get("linkedin", "linkedin.com/in/raviteja-velanati")).rstrip("/"))
    gh = tex_escape(re.sub(r"^https?://(www\.)?", "", p.get("github", "github.com/ravitejav-dev")).rstrip("/"))
    summary = tex_escape_with_bold_metrics(
        tailored.get("summary") or profile.get("summaryShort") or profile.get("summary", "")
    )

    skills_cats = tailored.get("skillsCategories") or profile.get("skillsCategories") or {}
    skill_lines = []
    for cat, items in skills_cats.items():
        val_str = ", ".join(items) if isinstance(items, list) else str(items)
        skill_lines.append(rf"\textbf{{{tex_escape(cat)}:}} {tex_escape(val_str)}")
    skills_tex = " \\\\\n".join(skill_lines)

    exp_list = tailored.get("experience") or []
    exp_blocks = []
    for exp in exp_list:
        comp = tex_escape(exp.get("company", ""))
        title = tex_escape(exp.get("title", ""))
        loc = tex_escape(exp.get("location", ""))
        period = tex_escape(exp.get("period", ""))
        bullets = "\n".join([rf"  \item {tex_escape_with_bold_metrics(b)}" for b in (exp.get("bullets") or [])])
        exp_blocks.append(
            rf"\noindent\textbf{{{comp}}} --- \textbf{{{title}}} \hfill {{\footnotesize {loc} $|$ {period}}}\par"
            "\n"
            r"\begin{itemize}"
            "\n"
            f"{bullets}\n"
            r"\end{itemize}"
        )
    exp_tex = "\n\\vspace{1.8pt}\n".join(exp_blocks)

    proj_list = (tailored.get("projects") or profile.get("projects") or [])[:2]
    proj_blocks = []
    for pr in proj_list:
        pname = tex_escape(pr.get("name", ""))
        pstack = tex_escape(pr.get("stack", ""))
        stack_suffix = rf" {{\footnotesize ({pstack})}}" if pstack else ""
        pbullets = "\n".join([rf"  \item {tex_escape_with_bold_metrics(b)}" for b in (pr.get("bullets") or [])])
        proj_blocks.append(
            rf"\noindent\textbf{{{pname}}}{stack_suffix}\par"
            "\n"
            r"\begin{itemize}"
            "\n"
            f"{pbullets}\n"
            r"\end{itemize}"
        )
    proj_tex = "\n\\vspace{1.4pt}\n".join(proj_blocks)

    edu_lines = []
    for ed in profile.get("education", []):
        sch = tex_escape(ed.get("school", ""))
        deg = tex_escape(ed.get("degreeShort") or ed.get("degree", ""))
        fos = tex_escape(ed.get("fieldOfStudy", "Computer Science"))
        gpa = tex_escape(f"{ed.get('gpa', '')}/{ed.get('gpaScale', '4.0')}")
        yrs = tex_escape(f"{ed.get('startYear', '')} -- {ed.get('endYear', '')}")
        edu_lines.append(rf"\noindent\textbf{{{sch}}} --- {deg}, {fos} (GPA {gpa}) \hfill {{\footnotesize {yrs}}}\par")
    edu_tex = "\n".join(edu_lines)

    certs_raw = [
        "Google Gemini for Developers",
        "Microsoft Azure AI Essentials",
        "Pair Programming with AI",
        "Walmart USA -- Advanced Software Engineering",
        "Datacom -- Software Development",
    ]
    certs_tex = r" $\bullet$ ".join(certs_raw)

    title_line_tex = rf"{{\normalsize \textbf{{{target_title}}}}} \\[1.5pt]" + "\n  " if target_title else ""

    return rf"""\documentclass[10pt,letterpaper]{{article}}
\pdfobjcompresslevel=0
\usepackage[T1]{{fontenc}}
\usepackage{{helvet}}
\renewcommand{{\familydefault}}{{\sfdefault}}
\usepackage[left=0.36in,right=0.36in,top=0.28in,bottom=0.28in]{{geometry}}
\usepackage{{xcolor}}
\usepackage{{enumitem}}
\usepackage[hidelinks]{{hyperref}}
\definecolor{{hdrblue}}{{RGB}}{{20, 52, 104}}
\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}
\setlist[itemize]{{label=\textbullet,leftmargin=1.15em,itemsep=0.55pt,topsep=1.0pt,parsep=0pt,partopsep=0pt}}
\newcommand{{\secHdr}}[1]{{\vspace{{3.2pt}}\textcolor{{hdrblue}}{{\textbf{{\small \uppercase{{#1}}}}}}\vspace{{1pt}}{{\color{{hdrblue}}\hrule height 0.55pt}}\vspace{{2.2pt}}}}

\begin{{document}}
\fontsize{{8.45pt}}{{9.95pt}}\selectfont
\begin{{center}}
  {{\Large \textbf{{{name}}}}} \\[1.5pt]
  {title_line_tex}{{\footnotesize {city_state} $|$ {mail} $|$ {phone} $|$ {li} $|$ {gh}}}
\end{{center}}
\vspace{{-6.5pt}}

\secHdr{{Professional Summary}}
{summary}\par

\secHdr{{Technical Skills}}
{skills_tex}\par

\secHdr{{Professional Experience}}
{exp_tex}

\secHdr{{Selected Projects}}
{proj_tex}

\secHdr{{Education}}
{edu_tex}

\secHdr{{Certifications}}
{{\footnotesize {certs_tex}}}\par
\end{{document}}
"""


def build_cover_letter_latex(cl_text: str, meta: dict, profile: dict) -> str:
    p = profile.get("personal", {})
    name = tex_escape(p.get("fullName", "Raviteja Velanati"))
    contact = tex_escape(
        f"{p.get('city', 'Newark')}, {p.get('stateCode', 'CA')} | {p.get('email', '')} | {p.get('phone', '')}"
    )
    paras = [tex_escape(pr.strip()) for pr in re.split(r"\n\s*\n", cl_text or "") if pr.strip()]
    body_tex = "\n\n\\vspace{8pt}\n".join(paras)
    return rf"""\documentclass[11pt,letterpaper]{{article}}
\pdfobjcompresslevel=0
\usepackage[margin=0.85in]{{geometry}}
\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}
\begin{{document}}
{{\Large \textbf{{{name}}}}} \\[3pt]
{{\small {contact}}}
\vspace{{4pt}}\hrule\vspace{{18pt}}

{body_tex}
\end{{document}}
"""


def compile_latex_to_base64(tex_source: str) -> str:
    pdflatex = shutil.which("pdflatex")
    if not pdflatex:
        raise RuntimeError("pdflatex binary not found on system")
    with tempfile.TemporaryDirectory() as tmpdir:
        tex_path = os.path.join(tmpdir, "doc.tex")
        pdf_path = os.path.join(tmpdir, "doc.pdf")
        with open(tex_path, "w", encoding="utf-8") as f:
            f.write(tex_source)
        subprocess.run(
            [pdflatex, "-interaction=nonstopmode", "-halt-on-error", "doc.tex"],
            cwd=tmpdir,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
            check=True,
        )
        with open(pdf_path, "rb") as pf:
            return base64.b64encode(pf.read()).decode("ascii")


def extract_otp_from_email_text(subj: str, body_text: str) -> str | None:
    combined = f"{subj}\n{body_text}"
    # 1. Greenhouse 8-char alphanumeric security code ("paste this code into the security code field: Ab3x9K2m")
    gh_match = re.search(
        r"(?:security\s*code|verification\s*code|paste\s*this\s*code[^:]*:|passcode\s*(?:is|:))\s*([A-Za-z0-9]{6,8})\b",
        combined,
        re.IGNORECASE,
    )
    if gh_match:
        cand = gh_match.group(1)
        if re.search(r"\d", cand) and cand not in {"94560"}:
            return cand

    # 2. Contextual 6-8 digit numeric code near verification keywords
    ctx_num = re.search(
        r"(?:code|otp|passcode|verify|verification|pin)[^0-9]{0,40}\b(\d{6,8})\b",
        combined,
        re.IGNORECASE,
    )
    if ctx_num:
        return ctx_num.group(1)

    # 3. Any standalone 6-digit code in verification-themed emails
    if re.search(r"verify|verification|security\s*code|passcode|one-time|otp|confirm\s*your\s*email", combined, re.IGNORECASE):
        for m in re.finditer(r"\b(\d{6})\b", combined):
            val = m.group(1)
            if val not in {"120000", "140000", "115000", "150000", "180000", "000000"}:
                return val
    return None


def extract_verification_link_from_email(subj: str, body_text: str, raw_html: str = "") -> str | None:
    combined = f"{subj}\n{body_text}\n{raw_html}".replace("&amp;", "&").replace("&#38;", "&")
    if not re.search(r"verify|activate|confirm|workday|candidate|account|welcome", combined, re.IGNORECASE):
        return None
    href_urls = re.findall(r'href=["\'](https?://[^"\'>\s]+)["\']', raw_html or "", flags=re.IGNORECASE)
    text_urls = [m.group(0).rstrip(".,;!?") for m in re.finditer(r"https?://[^\s\"'<>)\]]+", f"{subj}\n{body_text}")]
    for u in href_urls + text_urls:
        if re.search(
            r"unsubscribe|privacy|terms|support\.google|linkedin\.com|twitter\.com|facebook\.com|\.(png|jpg|jpeg|gif|svg|css|ico)(\?|$)",
            u,
            re.IGNORECASE,
        ):
            continue
        if re.search(
            r"verify|activate|confirm|validation|token=|myworkdayjobs\.com|myworkdaysite\.com|wd\d+\.myworkday",
            u,
            re.IGNORECASE,
        ):
            return u
    return None


def fetch_latest_imap_otp(
    email_addr: str, app_password: str, sender_filter: str = "", since_epoch_ms: int = 0
) -> dict:
    clean_pw = (app_password or "").replace(" ", "")
    mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=12)
    mail.login(email_addr, clean_pw)
    mail.select("INBOX", readonly=True)
    _, data = mail.search(None, "ALL")
    ids = data[0].split()[-18:]
    ids.reverse()
    min_epoch_sec = (since_epoch_ms / 1000.0) - 120 if since_epoch_ms > 0 else 0
    for mid in ids:
        _, msg_data = mail.fetch(mid, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        frm = msg.get("From", "")
        subj = msg.get("Subject", "")
        date_hdr = msg.get("Date", "")
        if min_epoch_sec > 0 and date_hdr:
            try:
                dt = email.utils.parsedate_to_datetime(date_hdr)
                if dt and dt.timestamp() < min_epoch_sec:
                    continue
            except Exception:
                pass
        if sender_filter and sender_filter.lower() not in (frm + " " + subj).lower():
            continue
        plain_parts = []
        html_parts = []
        raw_html_parts = []
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                payload_bytes = part.get_payload(decode=True)
                if not payload_bytes:
                    continue
                decoded = payload_bytes.decode("utf-8", errors="ignore")
                if ctype == "text/plain":
                    plain_parts.append(decoded)
                elif ctype == "text/html":
                    raw_html_parts.append(decoded)
                    html_parts.append(re.sub(r"<[^>]+>", " ", decoded))
        else:
            raw_bytes = msg.get_payload(decode=True) or b""
            decoded = raw_bytes.decode("utf-8", errors="ignore")
            if msg.get_content_type() == "text/html":
                raw_html_parts.append(decoded)
                html_parts.append(re.sub(r"<[^>]+>", " ", decoded))
            else:
                plain_parts.append(decoded)
        body_text = "\n".join(plain_parts) if plain_parts else "\n".join(html_parts)
        raw_html = "\n".join(raw_html_parts)
        otp_val = extract_otp_from_email_text(subj, body_text)
        verify_url = extract_verification_link_from_email(subj, body_text, raw_html)
        if otp_val or verify_url:
            mail.logout()
            return {
                "otp": otp_val,
                "verificationUrl": verify_url,
                "subject": subj,
                "from": frm,
                "source": "imap",
            }
    mail.logout()
    return {
        "otp": None,
        "verificationUrl": None,
        "message": "Connected to Gmail INBOX; no matching verification code or link in recent emails.",
    }


GREENHOUSE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AI Platform & Evaluation Engineer - Anthropic | Greenhouse Sandbox</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 820px; margin: 32px auto; padding: 0 20px; color: #111827; background: #f8fafc; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    h1 { margin: 0 0 6px; font-size: 26px; }
    .meta { color: #475569; font-size: 14px; margin-bottom: 18px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 5px; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="url"], select, textarea {
      width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 14px;
    }
    textarea { min-height: 95px; }
    .btn-submit { background: #2563eb; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 15px; font-weight: 700; cursor: pointer; }
    #submit-banner { display: none; padding: 16px; background: #dcfce7; border: 1px solid #22c55e; border-radius: 9px; color: #14532d; font-weight: 700; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div data-company-name="Anthropic" style="font-weight:700;color:#4f46e5;">Anthropic</div>
    <h1 class="app-title" data-jobify-title>AI Platform &amp; Evaluation Engineer</h1>
    <div class="meta location" data-jobify-location>San Francisco, CA • Hybrid ($210,000 - $285,000)</div>
    <div id="content" data-jobify-jd>
      <p>We are seeking an AI Platform &amp; Evaluation Engineer to build autonomous agent evaluation sandboxes, large-scale synthetic user simulation pipelines, adversarial safety &amp; red-teaming suites, and real-time observability dashboards.</p>
      <p><strong>Key Qualifications:</strong> Python, TypeScript, React, LangGraph or multi-agent frameworks, Docker, Kubernetes, GCP or AWS, BigQuery, PyTorch, Playwright browser automation, RAG, Vector Databases, OpenTelemetry, and CI/CD.</p>
    </div>
  </div>

  <form id="application_form" class="card">
    <h2>Submit Your Application</h2>
    <div class="field"><label for="first_name">First Name *</label><input id="first_name" name="first_name" type="text" required /></div>
    <div class="field"><label for="last_name">Last Name *</label><input id="last_name" name="last_name" type="text" required /></div>
    <div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required /></div>
    <div class="field"><label for="phone">Phone *</label><input id="phone" name="phone" type="tel" required /></div>
    <div class="field"><label for="location_city">Current Location (City) *</label><input id="location_city" name="location" type="text" /></div>
    <div class="field"><label for="resume_file">Resume/CV *</label><input id="resume_file" name="resume" type="file" accept=".pdf,.doc,.docx" /></div>
    <div class="field"><label for="cover_file">Cover Letter</label><input id="cover_file" name="cover_letter" type="file" accept=".pdf,.txt" /></div>
    <div class="field"><label for="linkedin_url">LinkedIn Profile</label><input id="linkedin_url" name="linkedin_url" type="url" /></div>
    <div class="field"><label for="github_url">GitHub / Website</label><input id="github_url" name="github_url" type="url" /></div>
    <div class="field"><label for="curr_company">Current Company</label><input id="curr_company" name="current_company" type="text" /></div>
    <div class="field">
      <label for="work_auth">Are you legally authorized to work in the United States? *</label>
      <select id="work_auth" name="work_auth"><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>
    </div>
    <div class="field">
      <label for="sponsorship">Will you now or in the future require visa sponsorship? *</label>
      <select id="sponsorship" name="sponsorship"><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>
    </div>
    <div class="field">
      <label for="why_anthropic">Why are you excited to join Anthropic's AI Platform &amp; Evaluation team? *</label>
      <textarea id="why_anthropic" name="why_anthropic"></textarea>
    </div>
    <div class="field">
      <label for="complex_sys">Describe a complex evaluation platform or synthetic data system you architected. *</label>
      <textarea id="complex_sys" name="complex_sys"></textarea>
    </div>
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0;" />
    <h3>U.S. Equal Opportunity Employment Questions</h3>
    <div class="field">
      <label for="eeo_gender">Gender</label>
      <select id="eeo_gender"><option value="">Select...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Decline">Decline to self-identify</option></select>
    </div>
    <div class="field">
      <label for="eeo_race">Race / Ethnicity</label>
      <select id="eeo_race"><option value="">Select...</option><option value="Asian">Asian</option><option value="White">White</option><option value="Hispanic">Hispanic or Latino</option></select>
    </div>
    <div class="field">
      <label for="eeo_vet">Veteran Status</label>
      <select id="eeo_vet"><option value="">Select...</option><option value="I am not a protected veteran">I am not a protected veteran</option><option value="Protected veteran">I identify as a protected veteran</option></select>
    </div>
    <div class="field">
      <label for="eeo_dis">Disability Status</label>
      <select id="eeo_dis"><option value="">Select...</option><option value="No, I do not have a disability">No, I do not have a disability</option><option value="Yes">Yes, I have a disability</option></select>
    </div>
    <button type="submit" class="btn-submit">Submit Application</button>
    <div id="submit-banner">✅ Application Submitted Successfully! (Logged in Jobify Tracker)</div>
  </form>
  <script>
    document.getElementById("application_form").addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("submit-banner").style.display = "block";
    });
  </script>
</body>
</html>
"""

WORKDAY_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Senior GenAI Infrastructure Engineer - Databricks | Workday Sandbox</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 840px; margin: 32px auto; padding: 0 20px; background: #f1f5f9; color: #0f172a; }
    .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 26px; margin-bottom: 20px; }
    .field { margin-bottom: 14px; }
    label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 4px; }
    input[type="text"], input[type="email"], input[type="password"], input[type="tel"], select, textarea {
      width: 100%; box-sizing: border-box; padding: 8px 10px; border: 1px solid #94a3b8; border-radius: 6px;
    }
    .btn { background: #0284c7; color: #fff; border: none; padding: 11px 22px; border-radius: 7px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div data-automation-id="companyName" style="font-weight:700;color:#0284c7;">Databricks</div>
    <h1 data-automation-id="jobPostingHeader">Senior GenAI Infrastructure &amp; Evaluation Engineer</h1>
    <div data-automation-id="locations">Mountain View, CA • Hybrid ($195,000 - $260,000)</div>
    <div data-automation-id="jobPostingDescription" style="margin-top:10px;">
      Build distributed LLM evaluation pipelines, PySpark &amp; Python synthetic dataset frameworks, MLflow experiment tracking, and React/TypeScript developer tooling on Kubernetes, AWS, and GCP.
    </div>
  </div>

  <form id="wd-form">
    <div class="card" data-jobify-auth="true">
      <h3>Step 1: Create Workday Candidate Account</h3>
      <div class="field"><label for="wd-email">Email Address *</label><input id="wd-email" data-automation-id="email" type="email" /></div>
      <div class="field"><label for="wd-pw">Password *</label><input id="wd-pw" data-automation-id="password" type="password" /></div>
      <div class="field"><label for="wd-pw2">Verify Password *</label><input id="wd-pw2" data-automation-id="verifyPassword" type="password" /></div>
      <label><input type="checkbox" data-automation-id="createAccountCheckbox" /> I agree to create a candidate account and accept terms</label>
    </div>

    <div class="card">
      <h3>Step 2: My Information</h3>
      <div class="field"><label for="wd-fn">First Name *</label><input id="wd-fn" data-automation-id="legalNameSection_firstName" type="text" /></div>
      <div class="field"><label for="wd-ln">Last Name *</label><input id="wd-ln" data-automation-id="legalNameSection_lastName" type="text" /></div>
      <div class="field"><label for="wd-city">City *</label><input id="wd-city" data-automation-id="addressSection_city" type="text" /></div>
      <div class="field"><label for="wd-state">State *</label><input id="wd-state" data-automation-id="addressSection_countryRegion" type="text" /></div>
      <div class="field"><label for="wd-zip">Postal Code *</label><input id="wd-zip" data-automation-id="addressSection_postalCode" type="text" /></div>
      <div class="field"><label for="wd-phone">Phone Number *</label><input id="wd-phone" data-automation-id="phone-number" type="tel" /></div>
    </div>

    <div class="card" data-automation-id="workExperience-1">
      <h3>Step 3: Work Experience (Most Recent)</h3>
      <div class="field"><label>Job Title *</label><input type="text" name="exp_title" /></div>
      <div class="field"><label>Company *</label><input type="text" name="exp_company" /></div>
      <div class="field"><label>Location</label><input type="text" name="exp_location" /></div>
      <div class="field"><label>Role Description</label><textarea name="exp_desc" rows="4"></textarea></div>
    </div>

    <div class="card" data-automation-id="education-1">
      <h3>Step 4: Education</h3>
      <div class="field"><label>School or University *</label><input type="text" name="edu_school" /></div>
      <div class="field"><label>Degree *</label><input type="text" name="edu_degree" /></div>
      <div class="field"><label>Field of Study *</label><input type="text" name="edu_field" /></div>
      <div class="field"><label>Overall Result (GPA)</label><input type="text" name="edu_gpa" /></div>
    </div>

    <div class="card">
      <h3>Step 5: Resume Upload</h3>
      <div class="field"><label for="wd-res">Upload Resume PDF *</label><input id="wd-res" type="file" accept=".pdf" /></div>
      <button type="submit" class="btn" data-automation-id="bottom-navigation-next-button">Submit Workday Application</button>
      <div id="wd-done" style="display:none;margin-top:12px;color:#15803d;font-weight:700;">✅ Workday Application &amp; Account Submitted!</div>
    </div>
  </form>
  <script>
    document.getElementById("wd-form").addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("wd-done").style.display = "block";
    });
  </script>
</body>
</html>
"""

LEVER_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Autonomous Agents Engineer - Scale AI | Lever Sandbox</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 780px; margin: 32px auto; padding: 0 20px; background: #fff; color: #1e293b; }
    .section { border-bottom: 1px solid #e2e8f0; padding: 20px 0; }
    .field { margin-bottom: 14px; }
    label { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 5px; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea {
      width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #cbd5e1; border-radius: 6px;
    }
    .btn { background: #4f46e5; color: #fff; border: none; padding: 12px 24px; border-radius: 7px; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body class="posting-page">
  <div class="posting-headline section">
    <div data-company-name="Scale AI" style="color:#4f46e5;font-weight:700;">Scale AI</div>
    <h2>Autonomous Agents &amp; RLHF Platform Engineer</h2>
    <div class="posting-categories"><span class="location">San Francisco, CA / Remote ($180,000 - $245,000)</span></div>
  </div>
  <div class="section-wrapper section">
    Design human-in-the-loop (HITL) Side-by-Side LLM rating platforms, multi-turn trajectory pipelines, adversarial prompt injection benchmarks, and containerized browser-agent sandboxes using Python, TypeScript, React, FastAPI, Docker, and Kubernetes.
  </div>
  <form class="application-form section" id="lever-form">
    <div class="field"><label>Resume/CV *</label><input type="file" name="resume" accept=".pdf" /></div>
    <div class="field"><label>Full Name *</label><input type="text" name="name" /></div>
    <div class="field"><label>Email *</label><input type="email" name="email" /></div>
    <div class="field"><label>Phone *</label><input type="tel" name="phone" /></div>
    <div class="field"><label>Current Company</label><input type="text" name="org" /></div>
    <div class="field"><label>LinkedIn URL</label><input type="url" name="urls[LinkedIn]" /></div>
    <div class="field"><label>Desired Compensation</label><input type="text" name="salary_expectation" /></div>
    <div class="field"><label>Earliest Start Date / Notice Period</label><input type="text" name="start_date" /></div>
    <div class="field"><label>Tell us about your experience with LLM evaluations and HITL workflows *</label><textarea name="comments" rows="4"></textarea></div>
    <button type="submit" class="btn">Submit Application</button>
    <div id="lv-done" style="display:none;margin-top:12px;color:#15803d;font-weight:700;">✅ Lever Application Submitted!</div>
  </form>
  <script>
    document.getElementById("lever-form").addEventListener("submit", (e) => {
      e.preventDefault();
      document.getElementById("lv-done").style.display = "block";
    });
  </script>
</body>
</html>
"""


AUTO_APPLY_SANDBOX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>AI Evaluation &amp; Autonomous Agents Engineer - OpenAI | Career Portal</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 840px; margin: 32px auto; padding: 0 20px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 26px; margin-bottom: 20px; box-shadow: 0 2px 10px rgba(15,23,42,0.05); }
    .field { margin-bottom: 14px; }
    label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 5px; }
    input[type="text"], input[type="email"], input[type="password"], input[type="tel"], input[type="url"], input[type="number"], select, textarea {
      width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #94a3b8; border-radius: 7px; font-size: 14px;
    }
    textarea { min-height: 90px; }
    .btn { background: #4f46e5; color: #fff; border: none; padding: 11px 22px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; }
    .btn.secondary { background: #e2e8f0; color: #1e293b; margin-left: 8px; }
    .otp-row { display: flex; gap: 10px; margin: 14px 0; }
    .otp-box { width: 46px !important; height: 50px; text-align: center; font-size: 20px; font-weight: 700; }
    .err-box { display: none; background: #fee2e2; border: 1px solid #ef4444; color: #991b1b; padding: 10px 12px; border-radius: 7px; margin-bottom: 12px; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card" id="job-header-card">
    <div data-company-name="OpenAI" style="font-weight:700;color:#4f46e5;">OpenAI</div>
    <h1 class="app-title" data-jobify-title>AI Evaluation &amp; Autonomous Agents Engineer</h1>
    <div class="location" data-jobify-location>San Francisco, CA • Hybrid</div>
    <div id="content" data-jobify-jd style="margin-top:12px;line-height:1.55;color:#334155;">
      <p>We are hiring an AI Evaluation &amp; Autonomous Agents Engineer to build end-to-end browser-agent benchmarks, synthetic user state evaluation pipelines, adversarial red-teaming suites, and real-time OpenTelemetry reliability dashboards.</p>
      <p><strong>Tech Stack:</strong> Python, TypeScript, React, LangGraph, Playwright, Docker, Kubernetes, GCP, BigQuery, PyTorch, RAG, and Vector Databases.</p>
      <p><strong>Compensation:</strong> Base salary range for this role is $150,000 - $180,000 USD annually plus equity.</p>
      <p><strong>Application Note:</strong> Please attach a tailored cover letter describing your evaluation platform work along with your resume.</p>
    </div>
    <div id="stage-posting" style="margin-top:18px;">
      <button type="button" class="btn" id="btn-apply-now" data-jobify-apply-btn="true">Apply Now</button>
    </div>
  </div>

  <!-- Stage 2: Login -> Auto-Switch to Create Account + Verify Password -->
  <div class="card" id="stage-auth" style="display:none;" data-jobify-auth-step-only="true">
    <div id="signin-pane">
      <h2>Candidate Portal Sign In</h2>
      <div id="auth-err" class="err-box" role="alert">Account not found for this email address. Please create an account.</div>
      <div class="field"><label for="si_email">Email Address *</label><input id="si_email" type="email" autocomplete="username" /></div>
      <div class="field"><label for="si_pw">Password *</label><input id="si_pw" type="password" autocomplete="current-password" /></div>
      <button type="button" class="btn" id="btn-signin">Sign In</button>
      <button type="button" class="btn secondary" id="btn-switch-signup" data-jobify-switch-signup="true">Create Account</button>
    </div>

    <div id="signup-pane" style="display:none;">
      <h2>Create Candidate Account</h2>
      <div id="signup-err" class="err-box" role="alert"></div>
      <div class="field"><label for="su_email">Email Address *</label><input id="su_email" type="email" autocomplete="email" /></div>
      <div class="field"><label for="su_pw">Password *</label><input id="su_pw" name="password" type="password" autocomplete="new-password" /></div>
      <div class="field"><label for="su_pw2">Verify Password *</label><input id="su_pw2" name="verifyPassword" data-automation-id="verifyPassword" type="password" autocomplete="new-password" /></div>
      <div class="field">
        <label><input type="checkbox" id="su_terms" name="terms_consent" data-jobify-auth-consent="true" /> I agree to the Candidate Privacy Terms and Account Creation</label>
      </div>
      <button type="button" class="btn" id="btn-create-submit" data-jobify-auth-submit="true">Create Account</button>
    </div>
  </div>

  <!-- Stage 3: 6-Digit Email OTP Challenge -->
  <div class="card" id="stage-otp" style="display:none;">
    <h2>Verify Your Email Address</h2>
    <p style="font-size:13.5px;color:#475569;">We sent a 6-digit verification code to <strong>ravitejavelanati11@gmail.com</strong>. Enter the code below to continue.</p>
    <div id="otp-err" class="err-box" role="alert">Invalid verification code.</div>
    <div class="otp-row">
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="0" />
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="1" />
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="2" />
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="3" />
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="4" />
      <input type="text" maxlength="1" class="otp-box" data-otp-idx="5" />
    </div>
    <button type="button" class="btn" id="btn-verify-otp" data-jobify-otp-submit="true">Verify Code</button>
  </div>

  <!-- Stage 4: Multi-Step Application Wizard (Step 1 of 2) -->
  <form id="stage-step1" class="card" style="display:none;">
    <h2>Application — Step 1 of 2: Candidate Information &amp; Documents</h2>
    <div class="field"><label for="s1_fn">First Name *</label><input id="s1_fn" name="first_name" type="text" required /></div>
    <div class="field"><label for="s1_ln">Last Name *</label><input id="s1_ln" name="last_name" type="text" required /></div>
    <div class="field"><label for="s1_em">Email *</label><input id="s1_em" name="email" type="email" required /></div>
    <div class="field"><label for="s1_ph">Phone Number *</label><input id="s1_ph" name="phone" type="tel" required /></div>
    <div class="field"><label for="s1_st">Street Address *</label><input id="s1_st" name="street_address" type="text" required /></div>
    <div class="field"><label for="s1_ct">City *</label><input id="s1_ct" name="city" type="text" required /></div>
    <div class="field"><label for="s1_state">State *</label><input id="s1_state" name="state" type="text" required /></div>
    <div class="field"><label for="s1_zip">Zip / Postal Code *</label><input id="s1_zip" name="postal_code" type="text" required /></div>
    <div class="field"><label for="s1_li">LinkedIn Profile *</label><input id="s1_li" name="linkedin" type="url" required /></div>
    <div class="field"><label for="s1_gh">GitHub URL *</label><input id="s1_gh" name="github" type="url" required /></div>
    <div class="field"><label for="s1_pf">Portfolio Website *</label><input id="s1_pf" name="portfolio" type="url" required /></div>
    <div class="field">
      <label for="s1_wa">Are you legally authorized to work in the United States? *</label>
      <select id="s1_wa" required><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>
    </div>
    <div class="field">
      <label for="s1_sp">Will you now or in the future require visa sponsorship? *</label>
      <select id="s1_sp" required><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>
    </div>
    <div class="field">
      <label for="s1_visa">Current U.S. Visa / Immigration Status *</label>
      <select id="s1_visa" required><option value="">Select...</option><option value="U.S. Citizen">U.S. Citizen</option><option value="H-1B">H-1B</option><option value="F-1 OPT">F-1 OPT</option></select>
    </div>
    <div class="field"><label for="s1_cit">Country of Citizenship *</label><input id="s1_cit" name="citizenship" type="text" required /></div>
    <div class="field"><label for="s1_yoe_dec">Years of Professional Software &amp; AI Experience *</label><input id="s1_yoe_dec" type="number" step="0.5" required /></div>
    <div class="field"><label for="s1_yoe_int">Completed Full Years of Experience (Whole Number) *</label><input id="s1_yoe_int" type="number" step="1" required /></div>
    <div class="field"><label for="s1_sal">Desired Annual Base Salary *</label><input id="s1_sal" name="desired_salary" type="text" required /></div>
    <div class="field"><label for="s1_res">Resume / CV (PDF) *</label><input id="s1_res" name="resume" type="file" accept=".pdf" required /></div>
    <div class="field"><label for="s1_cl">Cover Letter (PDF) *</label><input id="s1_cl" name="cover_letter" type="file" accept=".pdf" required /></div>
    <button type="button" class="btn" id="btn-step1-next" data-jobify-next="true">Save &amp; Continue</button>
  </form>

  <!-- Stage 5: Multi-Step Application Wizard (Step 2 of 2) -->
  <form id="stage-step2" class="card" style="display:none;">
    <h2>Application — Step 2 of 2: Compliance, EEO &amp; Role Questions</h2>
    <div class="field">
      <label for="s2_gov">Have you previously worked for the U.S. Government or hold an active security clearance? *</label>
      <select id="s2_gov" required><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option></select>
    </div>
    <div class="field">
      <label for="s2_gen">Gender *</label>
      <select id="s2_gen" required><option value="">Select...</option><option value="Male">Male</option><option value="Female">Female</option><option value="Decline to self-identify">Decline to self-identify</option></select>
    </div>
    <div class="field">
      <label for="s2_so">Sexual Orientation *</label>
      <select id="s2_so" required><option value="">Select...</option><option value="Heterosexual / Straight">Heterosexual / Straight</option><option value="Gay or Lesbian">Gay or Lesbian</option><option value="Bisexual">Bisexual</option><option value="Prefer not to say">Prefer not to say</option></select>
    </div>
    <div class="field">
      <label for="s2_lgbtq">Do you identify as LGBTQ+? *</label>
      <select id="s2_lgbtq" required><option value="">Select...</option><option value="Yes">Yes</option><option value="No">No</option><option value="Prefer not to say">Prefer not to say</option></select>
    </div>
    <div class="field">
      <label for="s2_essay">Describe how you build reliable LLM evaluation and synthetic testing pipelines. *</label>
      <textarea id="s2_essay" required></textarea>
    </div>
    <div class="field">
      <label for="s2_opt_extra">Additional information or anything else you would like us to know (Optional)</label>
      <textarea id="s2_opt_extra"></textarea>
    </div>
    <button type="submit" class="btn" id="btn-final-submit" data-jobify-submit="true">Submit Application</button>
  </form>

  <div class="card" id="submit-banner" style="display:none;background:#dcfce7;border-color:#22c55e;color:#14532d;" data-jobify-submitted="true">
    <h2>Thank you for applying to OpenAI!</h2>
    <p>Your application has been submitted and confirmed.</p>
  </div>

  <script>
    window.__AUTO_APPLY_AUDIT__ = {
      clickedApplyNow: false,
      signInAttempted: false,
      switchedToSignup: false,
      signupVerifiedMatch: false,
      otpVerified: false,
      step1: null,
      step2: null,
      submitted: false
    };

    document.getElementById("btn-apply-now").addEventListener("click", () => {
      window.__AUTO_APPLY_AUDIT__.clickedApplyNow = true;
      document.getElementById("stage-posting").style.display = "none";
      document.getElementById("stage-auth").style.display = "block";
    });

    document.getElementById("btn-signin").addEventListener("click", () => {
      window.__AUTO_APPLY_AUDIT__.signInAttempted = true;
      document.getElementById("auth-err").style.display = "block";
    });

    document.getElementById("btn-switch-signup").addEventListener("click", () => {
      window.__AUTO_APPLY_AUDIT__.switchedToSignup = true;
      document.getElementById("signin-pane").style.display = "none";
      document.getElementById("signup-pane").style.display = "block";
    });

    document.getElementById("btn-create-submit").addEventListener("click", async () => {
      const em = document.getElementById("su_email").value.trim();
      const pw = document.getElementById("su_pw").value;
      const pw2 = document.getElementById("su_pw2").value;
      const terms = document.getElementById("su_terms").checked;
      const errEl = document.getElementById("signup-err");
      if (!em || pw.length < 8 || pw !== pw2 || !terms) {
        errEl.textContent = "Please fill email, matching passwords, and accept terms.";
        errEl.style.display = "block";
        return;
      }
      window.__AUTO_APPLY_AUDIT__.signupEmail = em;
      window.__AUTO_APPLY_AUDIT__.signupVerifiedMatch = pw === pw2 && pw.length >= 8 && terms;
      await fetch("/api/sandbox-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          otp: "482917",
          subject: "Your OpenAI Careers verification code is 482917",
          from: "no-reply@openai.com"
        })
      });
      document.getElementById("stage-auth").style.display = "none";
      document.getElementById("stage-otp").style.display = "block";
    });

    document.getElementById("btn-verify-otp").addEventListener("click", () => {
      const code = Array.from(document.querySelectorAll(".otp-box")).map((b) => b.value.trim()).join("");
      if (code !== "482917") {
        document.getElementById("otp-err").style.display = "block";
        return;
      }
      window.__AUTO_APPLY_AUDIT__.otpVerified = true;
      document.getElementById("stage-otp").style.display = "none";
      document.getElementById("stage-step1").style.display = "block";
    });

    document.getElementById("btn-step1-next").addEventListener("click", () => {
      window.__AUTO_APPLY_AUDIT__.step1 = {
        firstName: document.getElementById("s1_fn").value,
        lastName: document.getElementById("s1_ln").value,
        email: document.getElementById("s1_em").value,
        phone: document.getElementById("s1_ph").value,
        streetAddress: document.getElementById("s1_st").value,
        city: document.getElementById("s1_ct").value,
        state: document.getElementById("s1_state").value,
        zip: document.getElementById("s1_zip").value,
        linkedin: document.getElementById("s1_li").value,
        github: document.getElementById("s1_gh").value,
        portfolio: document.getElementById("s1_pf").value,
        workAuth: document.getElementById("s1_wa").value,
        sponsorship: document.getElementById("s1_sp").value,
        visaStatus: document.getElementById("s1_visa").value,
        citizenship: document.getElementById("s1_cit").value,
        yoeDecimal: document.getElementById("s1_yoe_dec").value,
        yoeInt: document.getElementById("s1_yoe_int").value,
        desiredSalary: document.getElementById("s1_sal").value,
        resumeFile: document.getElementById("s1_res").files[0]?.name || null,
        resumeBytes: document.getElementById("s1_res").files[0]?.size || 0,
        coverLetterFile: document.getElementById("s1_cl").files[0]?.name || null,
        coverLetterBytes: document.getElementById("s1_cl").files[0]?.size || 0
      };
      document.getElementById("stage-step1").style.display = "none";
      document.getElementById("stage-step2").style.display = "block";
    });

    document.getElementById("stage-step2").addEventListener("submit", (e) => {
      e.preventDefault();
      window.__AUTO_APPLY_AUDIT__.step2 = {
        govClearance: document.getElementById("s2_gov").value,
        gender: document.getElementById("s2_gen").value,
        sexualOrientation: document.getElementById("s2_so").value,
        lgbtq: document.getElementById("s2_lgbtq").value,
        requiredEssay: document.getElementById("s2_essay").value,
        optionalExtra: document.getElementById("s2_opt_extra").value
      };
      window.__AUTO_APPLY_AUDIT__.submitted = true;
      document.getElementById("stage-step2").style.display = "none";
      document.getElementById("submit-banner").style.display = "block";
    });
  </script>
</body>
</html>
"""

WORKDAY_FULL_E2E_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Principal AI Agents &amp; Evaluation Engineer | NVIDIA Workday Careers</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f3f5f8; color: #1f2937; margin: 0; padding: 0 0 80px; }
    header { background: #0b132b; color: #fff; padding: 12px 28px; display: flex; align-items: center; justify-content: space-between; }
    .hdr-right { display: flex; align-items: center; gap: 12px; }
    .hdr-search { padding: 7px 12px; border-radius: 6px; border: 1px solid #334155; font-size: 13px; }
    .util-signin { background: transparent; color: #fff; border: 1px solid #64748b; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; }
    .wrap { max-width: 820px; margin: 28px auto; padding: 0 20px; }
    .card { background: #fff; border: 1px solid #dbe1e8; border-radius: 12px; padding: 28px; box-shadow: 0 4px 16px rgba(15,23,42,0.05); }
    .btn-primary { background: #76b900; color: #0f172a; border: none; padding: 11px 22px; border-radius: 8px; font-weight: 700; font-size: 14px; cursor: pointer; text-decoration: none; display: inline-block; }
    .btn-outline { background: #fff; color: #1e293b; border: 1px solid #cbd5e1; padding: 11px 18px; border-radius: 8px; font-weight: 600; font-size: 14px; cursor: pointer; display: block; width: 100%; margin: 10px 0; text-align: center; text-decoration: none; box-sizing: border-box; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: none; align-items: center; justify-content: center; z-index: 9999; }
    .modal-box { background: #fff; border-radius: 12px; width: 420px; padding: 26px; box-shadow: 0 18px 40px rgba(0,0,0,0.22); }
    .row { margin-bottom: 15px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: #1e293b; }
    input[type="text"], input[type="email"], input[type="password"], input[type="url"], input[type="tel"], select, textarea {
      width: 100%; padding: 9px 12px; border: 1px solid #cbd5e1; border-radius: 7px; font-size: 14px; box-sizing: border-box;
    }
    .click-filter-wrap { position: relative; display: inline-block; width: 100%; margin-top: 12px; }
    .wd-hidden-submit { width: 100%; padding: 11px; background: #0284c7; color: #fff; border: none; border-radius: 8px; font-weight: 700; font-size: 14px; }
    .wd-click-filter { position: absolute; inset: 0; opacity: 0; cursor: pointer; z-index: 5; }
    .err-box { display: none; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
    .verify-banner { display: none; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 10px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
    .prompt-menu { border: 1px solid #cbd5e1; border-radius: 7px; margin-top: 4px; background: #fff; display: none; }
    .prompt-opt { padding: 8px 12px; cursor: pointer; font-size: 13px; }
    .prompt-opt:hover { background: #f1f5f9; }
    .chip { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
    .spin-row { display: flex; gap: 10px; }
    .spin-row input { width: 90px; text-align: center; }
  </style>
</head>
<body data-automation-id="workdayApplicationRoot">
  <header role="banner">
    <div><strong data-automation-id="companyName">NVIDIA</strong> Workday Careers</div>
    <div class="hdr-right">
      <input id="keywordSearchInput" class="hdr-search" type="text" placeholder="Search for Jobs" />
      <button type="button" data-automation-id="utilityButtonSignIn" class="util-signin" id="hdr-signin-trap">Sign In</button>
    </div>
  </header>

  <div class="wrap">
    <!-- STAGE 1: WORKDAY JOB POSTING -->
    <div id="wd-stage-job" class="card">
      <div style="font-size:12px; font-weight:700; color:#4d7c0f;">NVIDIA EXTERNAL CAREER SITE</div>
      <h2 data-automation-id="jobPostingHeader" style="margin:6px 0;">Principal AI Agents &amp; Evaluation Engineer</h2>
      <div data-automation-id="locations" style="font-size:13px; color:#475569; margin-bottom:14px;">Santa Clara, CA • Hybrid • Base Salary Range: $185,000 - $235,000 USD</div>
      <div data-automation-id="jobPostingDescription" style="font-size:14px; line-height:1.55; margin-bottom:20px;">
        NVIDIA is hiring a Principal AI Agents &amp; Evaluation Engineer to build autonomous browser and multi-agent evaluation pipelines,
        synthetic data sandboxes, distributed telemetry, and LLM tooling. Required skills: Python, TypeScript, React, FastAPI, LangGraph,
        Docker, Kubernetes, GCP, PyTorch, Playwright, RAG, and CI/CD.
      </div>
      <a href="#apply" role="button" data-automation-id="adventureButton" id="wd-adventure-btn" class="btn-primary">Apply</a>
    </div>

    <!-- ASYNC WORKDAY "START YOUR APPLICATION" MODAL -->
    <div id="wd-apply-modal" class="modal-backdrop" data-automation-id="wd-popup-frame" role="dialog" aria-label="Start Your Application">
      <div class="modal-box">
        <h3 style="margin-top:0;">Start Your Application</h3>
        <p style="font-size:13px; color:#475569;">Principal AI Agents &amp; Evaluation Engineer</p>
        <a href="#autofill" role="button" data-automation-id="autofillWithResume" id="wd-opt-autofill" class="btn-outline">Autofill with Resume</a>
        <a href="#manual" role="button" data-automation-id="applyManually" id="wd-opt-manual" class="btn-outline">Apply Manually</a>
        <a href="#last" role="button" data-automation-id="useMyLastApplication" id="wd-opt-last" class="btn-outline">Use My Last Application</a>
        <button type="button" data-automation-id="applyWithLinkedIn" id="wd-opt-linkedin" class="btn-outline">Apply with LinkedIn</button>
      </div>
    </div>

    <!-- STAGE 2: WORKDAY SSO GATE ("Sign in with email") -->
    <div id="wd-stage-sso" class="card" style="display:none;">
      <h2 style="margin-top:0;">Sign In to Apply</h2>
      <p style="font-size:13px; color:#475569;">Choose how you would like to sign in to your NVIDIA Candidate Account</p>
      <button type="button" id="wd-sso-google" class="btn-outline">Sign in with Google</button>
      <button type="button" id="wd-sso-linkedin" class="btn-outline">Sign in with LinkedIn</button>
      <button type="button" data-automation-id="SignInWithEmailButton" id="wd-sso-email" class="btn-outline" style="border-color:#0284c7; color:#0284c7;">Sign in with email</button>
    </div>

    <!-- STAGE 3: WORKDAY signInContent (Sign In <-> Create Account + Read More + opacity:0 Checkbox + opacity:0 click_filter + Email Verify Link) -->
    <div id="wd-stage-auth" class="card" data-automation-id="signInContent" style="display:none;">
      <h2 id="wd-auth-heading" style="margin-top:0;">Sign In</h2>
      <div id="wd-auth-err" data-automation-id="errorMessage" role="alert" class="err-box"></div>
      <div id="wd-verify-banner" class="verify-banner">
        Verify your email address — check your email to activate your account before signing in.
      </div>

      <!-- SIGN IN VIEW -->
      <div id="wd-signin-view">
        <div class="row">
          <label for="wd-si-email">Email Address *</label>
          <input id="wd-si-email" type="text" autocomplete="email" data-automation-id="email" />
        </div>
        <div class="row">
          <label for="wd-si-pw">Password *</label>
          <input id="wd-si-pw" type="password" data-automation-id="password" />
        </div>
        <div class="click-filter-wrap">
          <button type="submit" aria-hidden="true" tabindex="-1" data-automation-id="signInSubmitButton" class="wd-hidden-submit">Sign In</button>
          <div role="button" aria-label="Submit" data-automation-id="click_filter" id="wd-signin-click-filter" class="wd-click-filter"></div>
        </div>
        <div style="margin-top:14px; font-size:13px;">
          Don't have an account yet?
          <button type="button" data-automation-id="createAccountLink" id="wd-to-create" style="background:none;border:none;color:#0284c7;font-weight:700;cursor:pointer;">Create Account</button>
        </div>
      </div>

      <!-- CREATE ACCOUNT VIEW -->
      <div id="wd-create-view" style="display:none;">
        <div class="row">
          <label for="wd-ca-email">Email Address *</label>
          <input id="wd-ca-email" type="text" autocomplete="email" data-automation-id="email" />
        </div>
        <div class="row">
          <label for="wd-ca-pw">Password *</label>
          <input id="wd-ca-pw" type="password" data-automation-id="password" />
        </div>
        <div class="row">
          <label for="wd-ca-pw2">Verify New Password *</label>
          <input id="wd-ca-pw2" type="password" data-automation-id="verifyPassword" />
        </div>
        <div class="row" style="background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0; font-size:12px;">
          <div>Candidate Privacy Notice: By creating an account you consent to processing your application data...</div>
          <button type="button" data-automation-id="createAccountExpandButton" id="wd-read-more" style="background:none;border:none;color:#0284c7;font-weight:700;padding:4px 0;cursor:pointer;">Read More</button>
        </div>
        <div class="row" style="position:relative; display:flex; align-items:center; gap:8px;">
          <input id="wd-terms-cb" type="checkbox" data-automation-id="createAccountCheckbox" style="opacity:0; position:absolute; width:16px; height:16px;" />
          <label for="wd-terms-cb" style="margin:0; cursor:pointer; padding-left:22px;">Yes, I have read and consent to the terms and conditions *</label>
        </div>
        <div class="click-filter-wrap">
          <button type="submit" aria-hidden="true" tabindex="-1" data-automation-id="createAccountSubmitButton" class="wd-hidden-submit">Create Account</button>
          <div role="button" aria-label="Create Account" data-automation-id="click_filter" id="wd-create-click-filter" class="wd-click-filter"></div>
        </div>
        <div style="margin-top:14px; font-size:13px;">
          Already have an account?
          <button type="button" data-automation-id="signInLink" id="wd-to-signin" style="background:none;border:none;color:#0284c7;font-weight:700;cursor:pointer;">Sign In</button>
        </div>
      </div>
    </div>

    <!-- STAGE 4: WORKDAY WIZARD STEP 1 (My Information) -->
    <div id="wd-stage-w1" class="card" data-automation-id="applyFlowPage" style="display:none;">
      <h2 style="margin-top:0;">My Information (Step 1 of 3)</h2>
      <div class="row" data-automation-id="formField-sourcePrompt">
        <label for="wd-source-search">How Did You Hear About Us? *</label>
        <div data-automation-id="multiSelectContainer" id="wd-source-container">
          <div id="wd-source-chip-holder"></div>
          <input id="wd-source-search" data-automation-id="searchBox" type="text" placeholder="Search" />
          <div id="wd-source-menu" class="prompt-menu" role="listbox">
            <div class="prompt-opt" role="option" data-automation-id="promptOption" data-val="LinkedIn">LinkedIn</div>
            <div class="prompt-opt" role="option" data-automation-id="promptOption" data-val="Company Website">Company Website</div>
            <div class="prompt-opt" role="option" data-automation-id="promptOption" data-val="Employee Referral">Employee Referral</div>
          </div>
        </div>
      </div>
      <div class="row"><label for="legalNameSection_firstName">First Name *</label><input id="legalNameSection_firstName" type="text" required /></div>
      <div class="row"><label for="legalNameSection_lastName">Last Name *</label><input id="legalNameSection_lastName" type="text" required /></div>
      <div class="row"><label for="addressSection_addressLine1">Address Line 1 *</label><input id="addressSection_addressLine1" type="text" required /></div>
      <div class="row"><label for="addressSection_city">City *</label><input id="addressSection_city" type="text" required /></div>
      <div class="row">
        <label for="addressSection_countryRegion">State *</label>
        <select id="addressSection_countryRegion" required>
          <option value="">Select One</option>
          <option value="California">California</option>
          <option value="Massachusetts">Massachusetts</option>
          <option value="New York">New York</option>
          <option value="Texas">Texas</option>
        </select>
      </div>
      <div class="row"><label for="addressSection_postalCode">Postal Code *</label><input id="addressSection_postalCode" type="text" required /></div>
      <div class="row">
        <label for="phone-device-type">Phone Device Type *</label>
        <select id="phone-device-type" required>
          <option value="">Select One</option>
          <option value="Cellular">Cellular</option>
          <option value="Landline">Landline</option>
        </select>
      </div>
      <div class="row"><label for="phone-number">Phone Number *</label><input id="phone-number" type="tel" required /></div>
      <button type="button" data-automation-id="bottom-navigation-next-button" id="wd-w1-next" class="btn-primary">Save and Continue</button>
    </div>

    <!-- STAGE 5: WORKDAY WIZARD STEP 2 (My Experience & Disclosures) -->
    <div id="wd-stage-w2" class="card" data-automation-id="applyFlowPage" style="display:none;">
      <h2 style="margin-top:0;">My Experience &amp; Voluntary Disclosures (Step 2 of 3)</h2>
      <div class="row"><label for="wd-e2e-resume">Resume / CV (PDF) *</label><input id="wd-e2e-resume" type="file" accept=".pdf" required /></div>
      <div class="row"><label for="wd-e2e-linkedin">LinkedIn Profile URL *</label><input id="wd-e2e-linkedin" type="url" required /></div>
      <div class="row">
        <label for="wd-e2e-auth">Are you legally authorized to work in the United States? *</label>
        <select id="wd-e2e-auth" required><option value="">Select One</option><option value="Yes">Yes</option><option value="No">No</option></select>
      </div>
      <div class="row">
        <label for="wd-e2e-sponsor">Will you now or in the future require visa sponsorship? *</label>
        <select id="wd-e2e-sponsor" required><option value="">Select One</option><option value="Yes">Yes</option><option value="No">No</option></select>
      </div>
      <div class="row">
        <label for="wd-e2e-gender">Gender *</label>
        <select id="wd-e2e-gender" required><option value="">Select One</option><option value="Male">Male</option><option value="Female">Female</option><option value="Decline to Self-Identify">Decline to Self-Identify</option></select>
      </div>
      <fieldset class="row" style="border:1px solid #e2e8f0; border-radius:8px; padding:12px;">
        <legend style="font-size:13px; font-weight:600;">Voluntary Self-Identification of Disability (Form CC-305) *</legend>
        <div class="row"><label for="selfIdentifiedDisabilityData--name">Name *</label><input id="selfIdentifiedDisabilityData--name" type="text" required /></div>
        <div class="row"><label for="selfIdentifiedDisabilityData--employeeId">Employee ID (if applicable)</label><input id="selfIdentifiedDisabilityData--employeeId" type="text" /></div>
        <div class="row">
          <label for="selfIdentifiedDisabilityData--disabilityStatus">Disability Status *</label>
          <select id="selfIdentifiedDisabilityData--disabilityStatus" required>
            <option value="">Select One</option>
            <option value="Yes, I have a disability, or have had one in the past">Yes, I have a disability, or have had one in the past</option>
            <option value="No, I do not have a disability and have not had one in the past">No, I do not have a disability and have not had one in the past</option>
            <option value="I do not want to answer">I do not want to answer</option>
          </select>
        </div>
        <div class="spin-row">
          <div><label for="selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input">MM</label><input id="selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input" role="spinbutton" type="text" required /></div>
          <div><label for="selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-input">DD</label><input id="selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-input" role="spinbutton" type="text" required /></div>
          <div><label for="selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-input">YYYY</label><input id="selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-input" role="spinbutton" type="text" required /></div>
        </div>
      </fieldset>
      <div class="row">
        <label for="wd-e2e-optional">Additional Optional Comments (Optional)</label>
        <textarea id="wd-e2e-optional" rows="2" placeholder="Optional note — leave blank unless needed"></textarea>
      </div>
      <button type="button" data-automation-id="bottom-navigation-next-button" id="wd-w2-next" class="btn-primary">Save and Continue</button>
    </div>

    <!-- STAGE 6: WORKDAY WIZARD STEP 3 (Review & Submit) -->
    <div id="wd-stage-w3" class="card" data-automation-id="applyFlowPage" style="display:none;">
      <h2 style="margin-top:0;">Review Your Application (Step 3 of 3)</h2>
      <p style="font-size:14px; color:#334155;">All required fields have been validated. Click Submit below to complete your NVIDIA application.</p>
      <button type="button" data-automation-id="bottom-navigation-next-button" id="wd-w3-submit" class="btn-primary">Submit</button>
    </div>

    <!-- STAGE 7: CONFIRMATION -->
    <div id="wd-stage-done" class="card" data-automation-id="thankYouMessage" style="display:none; border-color:#22c55e;">
      <h2 style="color:#15803d; margin-top:0;">Congratulations! Thank you for submitting your application to NVIDIA.</h2>
      <p>Your candidate profile for Principal AI Agents &amp; Evaluation Engineer has been received.</p>
    </div>
  </div>

  <script>
    window.__WD_E2E_AUDIT__ = {
      headerSignInTrapClicked: false,
      usedLinkedInOrLastAppTrap: false,
      clickedAdventure: false,
      clickedApplyManually: false,
      clickedSignInWithEmail: false,
      triedSignInFirst: false,
      switchedToCreateAccount: false,
      readMoreExpanded: false,
      termsChecked: false,
      accountCreatedViaClickFilter: false,
      emailLinkVerified: false,
      signedInAfterCreateViaClickFilter: false,
      howDidYouHear: "",
      step1: null,
      step2: null,
      submitted: false
    };

    let registeredEmail = null;
    let registeredPw = null;

    document.getElementById("hdr-signin-trap").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.headerSignInTrapClicked = true;
    });

    document.getElementById("wd-adventure-btn").addEventListener("click", (e) => {
      e.preventDefault();
      window.__WD_E2E_AUDIT__.clickedAdventure = true;
      // Realistic async Workday modal mount (850ms)
      setTimeout(() => {
        document.getElementById("wd-apply-modal").style.display = "flex";
      }, 850);
    });

    for (const trapId of ["wd-opt-autofill", "wd-opt-last", "wd-opt-linkedin"]) {
      document.getElementById(trapId).addEventListener("click", (e) => {
        e.preventDefault();
        window.__WD_E2E_AUDIT__.usedLinkedInOrLastAppTrap = true;
      });
    }

    document.getElementById("wd-opt-manual").addEventListener("click", (e) => {
      e.preventDefault();
      window.__WD_E2E_AUDIT__.clickedApplyManually = true;
      document.getElementById("wd-apply-modal").style.display = "none";
      document.getElementById("wd-stage-job").style.display = "none";
      document.getElementById("wd-stage-sso").style.display = "block";
    });

    document.getElementById("wd-sso-email").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.clickedSignInWithEmail = true;
      document.getElementById("wd-stage-sso").style.display = "none";
      document.getElementById("wd-stage-auth").style.display = "block";
    });

    document.getElementById("wd-to-create").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.switchedToCreateAccount = true;
      document.getElementById("wd-auth-err").style.display = "none";
      document.getElementById("wd-auth-heading").textContent = "Create Account";
      document.getElementById("wd-signin-view").style.display = "none";
      document.getElementById("wd-create-view").style.display = "block";
    });

    document.getElementById("wd-to-signin").addEventListener("click", () => {
      document.getElementById("wd-auth-err").style.display = "none";
      document.getElementById("wd-auth-heading").textContent = "Sign In";
      document.getElementById("wd-create-view").style.display = "none";
      document.getElementById("wd-signin-view").style.display = "block";
    });

    document.getElementById("wd-read-more").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.readMoreExpanded = true;
      document.getElementById("wd-read-more").textContent = "Show Less";
    });

    document.getElementById("wd-create-click-filter").addEventListener("click", async () => {
      const em = document.getElementById("wd-ca-email").value.trim();
      const pw = document.getElementById("wd-ca-pw").value;
      const pw2 = document.getElementById("wd-ca-pw2").value;
      const cb = document.getElementById("wd-terms-cb").checked;
      const errBox = document.getElementById("wd-auth-err");
      if (!em || !pw || pw !== pw2 || !cb) {
        errBox.textContent = "Unable to create account: please fill matching passwords and accept terms.";
        errBox.style.display = "block";
        return;
      }
      registeredEmail = em.toLowerCase();
      registeredPw = pw;
      window.__WD_E2E_AUDIT__.termsChecked = cb;
      window.__WD_E2E_AUDIT__.accountCreatedViaClickFilter = true;

      // Publish email activation link to sandbox mailbox
      await fetch("/api/sandbox-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          verificationUrl: "http://127.0.0.1:18765/sandbox/verify-account?token=wd_nvidia_99",
          accountVerified: false,
          subject: "Verify your NVIDIA Workday Candidate Account",
          from: "nvidia@myworkday.com"
        })
      });

      // Transition to Step 2: Sign In with email verification banner (exact two-stage Workday flow!)
      errBox.style.display = "none";
      document.getElementById("wd-create-view").style.display = "none";
      document.getElementById("wd-signin-view").style.display = "block";
      document.getElementById("wd-auth-heading").textContent = "Sign In";
      document.getElementById("wd-verify-banner").style.display = "block";
    });

    document.getElementById("wd-signin-click-filter").addEventListener("click", async () => {
      const em = document.getElementById("wd-si-email").value.trim().toLowerCase();
      const pw = document.getElementById("wd-si-pw").value;
      const errBox = document.getElementById("wd-auth-err");

      if (!registeredEmail || em !== registeredEmail || pw !== registeredPw) {
        window.__WD_E2E_AUDIT__.triedSignInFirst = true;
        errBox.textContent = "Invalid username or password. Please try again or create an account.";
        errBox.style.display = "block";
        return;
      }

      const st = await fetch("/api/sandbox-otp").then(r => r.json()).catch(() => ({}));
      if (!st.accountVerified) {
        errBox.textContent = "Your account has not been verified yet. Please click the link in the email we sent you.";
        errBox.style.display = "block";
        return;
      }

      window.__WD_E2E_AUDIT__.emailLinkVerified = true;
      window.__WD_E2E_AUDIT__.signedInAfterCreateViaClickFilter = true;
      errBox.style.display = "none";
      document.getElementById("wd-stage-auth").style.display = "none";
      document.getElementById("wd-stage-w1").style.display = "block";
    });

    // Workday multiSelectContainer searchBox behavior
    const srcInp = document.getElementById("wd-source-search");
    const srcMenu = document.getElementById("wd-source-menu");
    srcInp.addEventListener("focus", () => { srcMenu.style.display = "block"; });
    srcInp.addEventListener("click", () => { srcMenu.style.display = "block"; });
    srcInp.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        srcMenu.style.display = "block";
      }
    });
    document.querySelectorAll("#wd-source-menu .prompt-opt").forEach((opt) => {
      opt.addEventListener("click", () => {
        const val = opt.dataset.val;
        window.__WD_E2E_AUDIT__.howDidYouHear = val;
        document.getElementById("wd-source-chip-holder").innerHTML =
          `<span class="chip" data-automation-id="selectedItem">${val}</span>`;
        srcInp.value = "";
        srcMenu.style.display = "none";
      });
    });

    document.getElementById("wd-w1-next").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.step1 = {
        howDidYouHear: window.__WD_E2E_AUDIT__.howDidYouHear,
        firstName: document.getElementById("legalNameSection_firstName").value,
        lastName: document.getElementById("legalNameSection_lastName").value,
        streetAddress: document.getElementById("addressSection_addressLine1").value,
        city: document.getElementById("addressSection_city").value,
        state: document.getElementById("addressSection_countryRegion").value,
        postalCode: document.getElementById("addressSection_postalCode").value,
        phoneDeviceType: document.getElementById("phone-device-type").value,
        phone: document.getElementById("phone-number").value
      };
      if (!window.__WD_E2E_AUDIT__.step1.firstName || !window.__WD_E2E_AUDIT__.step1.state) return;
      document.getElementById("wd-stage-w1").style.display = "none";
      document.getElementById("wd-stage-w2").style.display = "block";
    });

    document.getElementById("wd-w2-next").addEventListener("click", () => {
      const rf = document.getElementById("wd-e2e-resume").files[0];
      window.__WD_E2E_AUDIT__.step2 = {
        resumeFile: rf ? rf.name : null,
        resumeBytes: rf ? rf.size : 0,
        linkedin: document.getElementById("wd-e2e-linkedin").value,
        workAuth: document.getElementById("wd-e2e-auth").value,
        sponsorship: document.getElementById("wd-e2e-sponsor").value,
        gender: document.getElementById("wd-e2e-gender").value,
        cc305Name: document.getElementById("selfIdentifiedDisabilityData--name").value,
        cc305EmployeeId: document.getElementById("selfIdentifiedDisabilityData--employeeId").value,
        cc305Disability: document.getElementById("selfIdentifiedDisabilityData--disabilityStatus").value,
        signMonth: document.getElementById("selfIdentifiedDisabilityData--dateSignedOn-dateSectionMonth-input").value,
        signDay: document.getElementById("selfIdentifiedDisabilityData--dateSignedOn-dateSectionDay-input").value,
        signYear: document.getElementById("selfIdentifiedDisabilityData--dateSignedOn-dateSectionYear-input").value,
        optionalComments: document.getElementById("wd-e2e-optional").value
      };
      if (!rf || !window.__WD_E2E_AUDIT__.step2.workAuth) return;
      document.getElementById("wd-stage-w2").style.display = "none";
      document.getElementById("wd-stage-w3").style.display = "block";
    });

    document.getElementById("wd-w3-submit").addEventListener("click", () => {
      window.__WD_E2E_AUDIT__.submitted = true;
      document.getElementById("wd-stage-w3").style.display = "none";
      document.getElementById("wd-stage-done").style.display = "block";
    });
  </script>
</body>
</html>
"""


TRICKY_SUBMIT_SANDBOX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Senior Autonomous Agents Engineer - Perplexity AI | Ashby Portal</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 820px; margin: 28px auto; padding: 0 20px 80px; background: #f8fafc; color: #0f172a; }
    .card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; padding: 26px; margin-bottom: 20px; }
    .field { margin-bottom: 16px; position: relative; }
    label.q-lbl { display: block; font-weight: 600; font-size: 13.5px; margin-bottom: 6px; color: #1e293b; }
    label._required_star::after { content: " *"; color: #dc2626; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="url"], textarea {
      width: 100%; box-sizing: border-box; padding: 9px 11px; border: 1px solid #94a3b8; border-radius: 7px; font-size: 14px;
    }
    .yesno-wrap { display: flex; gap: 10px; align-items: center; position: relative; }
    . _option_btn { padding: 8px 18px; border: 1px solid #94a3b8; background: #fff; border-radius: 7px; cursor: pointer; font-weight: 600; }
    ._option_yesno { padding: 8px 18px; border: 1px solid #94a3b8; background: #fff; border-radius: 7px; cursor: pointer; font-weight: 600; }
    ._option_yesno.active { background: #4f46e5; color: #fff; border-color: #4f46e5; }
    .ashby-application-form-field-error { display: none; color: #dc2626; font-size: 12.5px; font-weight: 600; margin-top: 5px; }
    .ashby-application-form-submit-button {
      background: #0f172a; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 14.5px; font-weight: 700; cursor: pointer;
    }
    .ashby-application-form-submit-button:disabled { opacity: 0.45; cursor: not-allowed; }
    #onetrust-consent-sdk { position: fixed; bottom: 0; left: 0; right: 0; background: #1e293b; color: #fff; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center; z-index: 900; font-size: 12px; }
  </style>
</head>
<body>
  <!-- Trap 1: Cookie Consent Banner -->
  <div id="onetrust-consent-sdk">
    <span>We use cookies for analytics. <label><input type="checkbox" id="ot-cookie-chk" /> Marketing Cookies</label></span>
    <button type="button" id="onetrust-accept-btn-handler">Accept Cookies</button>
  </div>

  <div class="card">
    <div data-company-name="Perplexity AI" style="font-weight:700;color:#0284c7;">Perplexity AI</div>
    <h1 data-jobify-title>Senior Autonomous Agents &amp; Search Evaluation Engineer</h1>
    <div data-jobify-location style="color:#475569;font-size:14px;">San Francisco, CA • Hybrid ($200,000 - $265,000)</div>
    <div data-jobify-jd style="margin-top:10px;line-height:1.55;color:#334155;">
      Architect real-time web retrieval agents, browser execution sandboxes, LLM evaluation harnesses, and distributed Python/TypeScript/React inference services on Kubernetes and AWS/GCP.
    </div>
  </div>

  <!-- Non-<form> Ashby SPA Container -->
  <div class="card ashby-application-form-container" id="ashby-app-root">
    <h2>Submit Your Application</h2>
    <div class="field"><label class="q-lbl _required_star" for="ab_name">Full Legal Name</label><input id="ab_name" type="text" /></div>
    <div class="field"><label class="q-lbl _required_star" for="ab_email">Email</label><input id="ab_email" type="email" /></div>
    <div class="field"><label class="q-lbl _required_star" for="ab_phone">Phone</label><input id="ab_phone" type="tel" /></div>
    <div class="field"><label class="q-lbl _required_star" for="ab_resume">Resume</label><input id="ab_resume" type="file" accept=".pdf" /></div>
    <div class="field"><label class="q-lbl _required_star" for="ab_code">Please share samples of your code or engineering portfolio</label><input id="ab_code" type="url" /></div>

    <!-- Trap 2: CSS ::after required text input WITHOUT '?' in label or DOM required attribute -->
    <div class="field">
      <label class="q-lbl _required_star" for="ab_exceptional">Please provide an example or evidence of your exceptional ability.</label>
      <input id="ab_exceptional" type="text" />
    </div>

    <!-- Trap 3: Ashby []-labeled-checkbox- multi-checkbox group -->
    <fieldset class="field" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px;">
      <legend style="font-weight:600;font-size:13.5px;">How did you hear about us? *</legend>
      <div><input type="checkbox" id="hear[]-labeled-checkbox-0" value="Job Board" /> <label for="hear[]-labeled-checkbox-0">Job Board</label></div>
      <div><input type="checkbox" id="hear[]-labeled-checkbox-1" value="LinkedIn" /> <label for="hear[]-labeled-checkbox-1">LinkedIn</label></div>
      <div><input type="checkbox" id="hear[]-labeled-checkbox-2" value="Recruiter" /> <label for="hear[]-labeled-checkbox-2">Recruiter</label></div>
      <div><input type="checkbox" id="hear[]-labeled-checkbox-3" value="Word of mouth" /> <label for="hear[]-labeled-checkbox-3">Word of mouth</label></div>
    </fieldset>

    <!-- Trap 4: Ashby Yes/No pill buttons + backing opacity:0 checkbox -->
    <div class="field">
      <label class="q-lbl _required_star">Are you legally authorized to work in the United States?</label>
      <div class="yesno-wrap">
        <input type="checkbox" id="ab_auth_backing" style="opacity:0;position:absolute;width:1px;height:1px;" />
        <button type="button" class="_option_yesno" id="ab_auth_yes">Yes</button>
        <button type="button" class="_option_yesno" id="ab_auth_no">No</button>
      </div>
    </div>

    <!-- Trap 5: Unmarked backend-required field (no *, no required, no _required_) -> fails 1st submit -> healed on retry! -->
    <div class="field">
      <label class="q-lbl" for="tricky_unmarked_team">Preferred engineering pod or systems focus area</label>
      <input id="tricky_unmarked_team" type="text" />
      <div class="ashby-application-form-field-error" id="tricky_team_err">Please provide a response for preferred engineering pod before submitting.</div>
    </div>

    <!-- Clean-mode check: Optional publications should stay blank -->
    <div class="field">
      <label class="q-lbl" for="ab_opt_pubs">Optional: Please share any publications, papers or research</label>
      <textarea id="ab_opt_pubs" rows="2"></textarea>
    </div>

    <!-- Trap 6: opacity:0 consent checkbox without * or required attribute -->
    <div class="field" style="position:relative;padding-left:24px;">
      <input type="checkbox" id="ab_privacy_confirm" style="opacity:0;position:absolute;left:0;top:2px;width:18px;height:18px;" />
      <label for="ab_privacy_confirm" style="cursor:pointer;font-size:13px;">I confirm I have read the above Candidate Privacy Notice.</label>
      <div class="ashby-application-form-field-error" id="ab_privacy_err">You must confirm you have read the privacy notice.</div>
    </div>

    <!-- Trap 7: Non-form button with trailing arrow + async 320ms blur re-validation disable -->
    <button type="button" class="ashby-application-form-submit-button" id="ab_submit_btn">Submit Application →</button>
  </div>

  <div class="card ashby-application-form-success" id="ab-success-card" style="display:none;background:#dcfce7;border-color:#22c55e;color:#14532d;">
    <h2>Thank you for applying to Perplexity AI!</h2>
    <p>We have received your application and will review it shortly.</p>
  </div>

  <script>
    window.__TRICKY_AUDIT__ = {
      cookieClicked: false,
      cookieChecked: false,
      authYesSelected: false,
      submitClicks: 0,
      firstSubmitRejectedUnmarkedField: false,
      healedAndSubmittedOnRetry: false,
      submitted: false,
      finalValues: null
    };

    document.getElementById("onetrust-accept-btn-handler").addEventListener("click", () => {
      window.__TRICKY_AUDIT__.cookieClicked = true;
    });

    document.getElementById("ab_auth_yes").addEventListener("click", () => {
      window.__TRICKY_AUDIT__.authYesSelected = true;
      document.getElementById("ab_auth_yes").classList.add("active");
      document.getElementById("ab_auth_no").classList.remove("active");
    });
    document.getElementById("ab_auth_no").addEventListener("click", () => {
      window.__TRICKY_AUDIT__.authYesSelected = false;
      document.getElementById("ab_auth_no").classList.add("active");
      document.getElementById("ab_auth_yes").classList.remove("active");
    });

    // Simulate async blur validation temporarily disabling Submit for 320ms
    const subBtn = document.getElementById("ab_submit_btn");
    document.querySelectorAll("#ashby-app-root input").forEach((inp) => {
      inp.addEventListener("blur", () => {
        subBtn.disabled = true;
        setTimeout(() => { subBtn.disabled = false; }, 320);
      });
    });

    subBtn.addEventListener("click", () => {
      if (subBtn.disabled) return;
      window.__TRICKY_AUDIT__.submitClicks += 1;
      const unmarkedInp = document.getElementById("tricky_unmarked_team");
      const teamErr = document.getElementById("tricky_team_err");
      const privChk = document.getElementById("ab_privacy_confirm");
      const privErr = document.getElementById("ab_privacy_err");

      let hasErr = false;
      if (!privChk.checked) {
        privErr.style.display = "block";
        privChk.setAttribute("aria-invalid", "true");
        hasErr = true;
      } else {
        privErr.style.display = "none";
        privChk.removeAttribute("aria-invalid");
      }

      if (!unmarkedInp.value.trim()) {
        window.__TRICKY_AUDIT__.firstSubmitRejectedUnmarkedField = true;
        teamErr.style.display = "block";
        unmarkedInp.setAttribute("aria-invalid", "true");
        hasErr = true;
      } else {
        teamErr.style.display = "none";
        unmarkedInp.removeAttribute("aria-invalid");
      }

      if (hasErr) return;

      const checkedSources = Array.from(document.querySelectorAll("input[id^='hear[]-labeled-checkbox-']"))
        .filter((c) => c.checked)
        .map((c) => c.value);

      window.__TRICKY_AUDIT__.cookieChecked = document.getElementById("ot-cookie-chk").checked;
      window.__TRICKY_AUDIT__.healedAndSubmittedOnRetry = window.__TRICKY_AUDIT__.submitClicks >= 2;
      window.__TRICKY_AUDIT__.submitted = true;
      window.__TRICKY_AUDIT__.finalValues = {
        fullName: document.getElementById("ab_name").value,
        email: document.getElementById("ab_email").value,
        resumeName: document.getElementById("ab_resume").files[0]?.name || null,
        codeSampleUrl: document.getElementById("ab_code").value,
        exceptionalAbility: document.getElementById("ab_exceptional").value,
        checkedSources,
        unmarkedTeamHealedValue: unmarkedInp.value,
        optionalPubs: document.getElementById("ab_opt_pubs").value,
        privacyChecked: privChk.checked
      };
      document.getElementById("ashby-app-root").style.display = "none";
      document.getElementById("ab-success-card").style.display = "block";
    });
  </script>
</body>
</html>
"""

AI_ERROR_HEAL_SANDBOX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Staff AI Platform Engineer at Mistral AI</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 780px; margin: 32px auto; padding: 0 20px; color: #0f172a; background: #f8fafc; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 18px; }
    .field-box { margin-bottom: 16px; }
    label { display: block; font-size: 13.5px; font-weight: 600; margin-bottom: 6px; color: #1e293b; }
    input[type="text"], input[type="email"], input[type="tel"], textarea {
      width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px;
    }
    .aria-radio-btn, .aria-chk-btn {
      padding: 8px 16px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; font-weight: 600; margin-right: 8px;
    }
    .aria-radio-btn[aria-checked="true"], .aria-chk-btn[aria-checked="true"] {
      background: #4f46e5; color: #fff; border-color: #4f46e5;
    }
    .submit-primary {
      background: #0f172a; color: #fff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 15px; font-weight: 700; cursor: pointer;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="company-name" style="font-weight:700;color:#4f46e5;">Mistral AI</div>
    <h1>Staff AI Platform Engineer</h1>
    <div class="location" style="color:#64748b;margin-bottom:10px;">San Francisco, CA</div>
    <p>
      Mistral AI is hiring a Staff AI Platform Engineer to architect distributed LLM serving, automated evaluation pipelines,
      high-throughput Python &amp; FastAPI microservices, Kubernetes GPU orchestration, and production telemetry on GCP and AWS.
      Compensation Range: $180,000 - $210,000 USD base salary plus equity.
    </p>
  </div>

  <div class="card" id="mh-form-root">
    <h2>Apply for this Role</h2>

    <div class="field-box">
      <label for="mh_name">Full Name *</label>
      <input id="mh_name" type="text" required />
    </div>

    <div class="field-box">
      <label for="mh_email">Email Address *</label>
      <input id="mh_email" type="email" required />
    </div>

    <div class="field-box">
      <label for="mh_resume">Resume/CV *</label>
      <input id="mh_resume" type="file" accept=".pdf" required />
    </div>

    <!-- Trap 1: Rejects formatted phone (774) 810-8481 with pure CSS-in-JS red text (NO .error class, NO aria-invalid!) -->
    <div class="field-box">
      <label for="mh_phone">Mobile Phone *</label>
      <input id="mh_phone" type="tel" required />
      <p id="mh_phone_err" style="display:none;color:rgb(220, 38, 38);font-size:12px;margin:5px 0 0;">
        Phone number must be 10 digits only with no spaces, parentheses, or dashes (e.g. 7748108481)
      </p>
    </div>

    <!-- Trap 2: Rejects plain numeric 195000 with pure CSS-in-JS red text requiring leading $ and comma ($195,000) -->
    <div class="field-box">
      <label for="mh_salary">Expected Base Salary (USD) *</label>
      <input id="mh_salary" type="text" required />
      <p id="mh_salary_err" style="display:none;color:rgb(220, 38, 38);font-size:12px;margin:5px 0 0;">
        Please format currency with a leading $ and comma (for example: $195,000)
      </p>
    </div>

    <!-- Trap 3: Custom ARIA radiogroup (button[role='radio'], zero native <input type='radio'>) -->
    <div class="field-box">
      <div role="radiogroup" aria-label="Are you legally authorized to work in the United States? *">
        <div style="font-size:13.5px;font-weight:600;margin-bottom:6px;color:#1e293b;">
          Are you legally authorized to work in the United States? *
        </div>
        <button type="button" role="radio" class="aria-radio-btn" id="mh_auth_yes" aria-checked="false">Yes</button>
        <button type="button" role="radio" class="aria-radio-btn" id="mh_auth_no" aria-checked="false">No</button>
      </div>
      <p id="mh_auth_err" style="display:none;color:rgb(220, 38, 38);font-size:12px;margin:5px 0 0;">
        Please select your US work authorization status
      </p>
    </div>

    <!-- Trap 4: Unmarked field labeled Optional in placeholder that reveals a required error ONLY on Submit #1 -->
    <div class="field-box">
      <label for="mh_unmarked_pod">Preferred Engineering Pod</label>
      <input id="mh_unmarked_pod" type="text" placeholder="Optional note unless applying to Platform" />
      <p id="mh_pod_err" style="display:none;color:rgb(220, 38, 38);font-size:12px;margin:5px 0 0;">
        Please specify which Mistral AI engineering pod you want to join and why (minimum 30 characters)
      </p>
    </div>

    <!-- Trap 5: Custom ARIA checkbox (button[role='checkbox'], zero native <input type='checkbox'>) -->
    <div class="field-box">
      <button type="button" role="checkbox" class="aria-chk-btn" id="mh_consent_chk" aria-checked="false">
        I acknowledge Mistral AI's candidate data privacy policy *
      </button>
      <p id="mh_consent_err" style="display:none;color:rgb(220, 38, 38);font-size:12px;margin:5px 0 0;">
        You must acknowledge the candidate privacy policy before submitting
      </p>
    </div>

    <button type="button" class="submit-primary" id="mh_submit_btn">Submit Application</button>
  </div>

  <div class="card" id="mh-success-card" style="display:none;background:#dcfce7;border-color:#22c55e;color:#14532d;">
    <h2>Application Submitted — Thank you for applying to Mistral AI!</h2>
    <p>Your application for Staff AI Platform Engineer has been received.</p>
  </div>

  <script>
    window.__AI_HEAL_AUDIT__ = {
      submitClicks: 0,
      firstSubmitErrors: [],
      firstSubmitValues: null,
      submitted: false,
      finalValues: null
    };

    const authYes = document.getElementById("mh_auth_yes");
    const authNo = document.getElementById("mh_auth_no");
    const consentChk = document.getElementById("mh_consent_chk");

    authYes.addEventListener("click", () => {
      authYes.setAttribute("aria-checked", "true");
      authNo.setAttribute("aria-checked", "false");
    });
    authNo.addEventListener("click", () => {
      authNo.setAttribute("aria-checked", "true");
      authYes.setAttribute("aria-checked", "false");
    });
    consentChk.addEventListener("click", () => {
      const next = consentChk.getAttribute("aria-checked") !== "true";
      consentChk.setAttribute("aria-checked", next ? "true" : "false");
    });

    document.getElementById("mh_submit_btn").addEventListener("click", () => {
      window.__AI_HEAL_AUDIT__.submitClicks += 1;
      const phoneVal = document.getElementById("mh_phone").value.trim();
      const salaryVal = document.getElementById("mh_salary").value.trim();
      const podVal = document.getElementById("mh_unmarked_pod").value.trim();
      const isAuthYes = authYes.getAttribute("aria-checked") === "true";
      const isConsent = consentChk.getAttribute("aria-checked") === "true";

      if (window.__AI_HEAL_AUDIT__.submitClicks === 1) {
        window.__AI_HEAL_AUDIT__.firstSubmitValues = {
          phone: phoneVal,
          salary: salaryVal,
          pod: podVal,
          authYes: isAuthYes,
          consentChecked: isConsent
        };
      }

      const errs = [];
      const phoneOk = /^\\d{10}$/.test(phoneVal);
      document.getElementById("mh_phone_err").style.display = phoneOk ? "none" : "block";
      if (!phoneOk) errs.push("phone_format");

      const salaryOk = /^\\$\\d{2,3},\\d{3}$/.test(salaryVal);
      document.getElementById("mh_salary_err").style.display = salaryOk ? "none" : "block";
      if (!salaryOk) errs.push("salary_format");

      document.getElementById("mh_auth_err").style.display = isAuthYes ? "none" : "block";
      if (!isAuthYes) errs.push("missing_auth_radio");

      const podOk = podVal.length >= 30;
      document.getElementById("mh_pod_err").style.display = podOk ? "none" : "block";
      if (!podOk) errs.push("unmarked_pod");

      document.getElementById("mh_consent_err").style.display = isConsent ? "none" : "block";
      if (!isConsent) errs.push("missing_consent_checkbox");

      if (window.__AI_HEAL_AUDIT__.submitClicks === 1) {
        window.__AI_HEAL_AUDIT__.firstSubmitErrors = errs.slice();
      }

      if (errs.length > 0) return;

      window.__AI_HEAL_AUDIT__.submitted = true;
      window.__AI_HEAL_AUDIT__.finalValues = {
        fullName: document.getElementById("mh_name").value.trim(),
        email: document.getElementById("mh_email").value.trim(),
        resumeName: document.getElementById("mh_resume").files[0]?.name || null,
        phone: phoneVal,
        salary: salaryVal,
        pod: podVal,
        authYes: isAuthYes,
        consentChecked: isConsent
      };
      document.getElementById("mh-form-root").style.display = "none";
      document.getElementById("mh-success-card").style.display = "block";
    });
  </script>
</body>
</html>
"""

GOOGLE_OAUTH_POPUP_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Sign in - Google Accounts</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 32px; display: flex; justify-content: center; }
    .oauth-card { background: #fff; border: 1px solid #cbd5e1; border-radius: 12px; width: 420px; padding: 28px; box-shadow: 0 10px 25px rgba(0,0,0,0.08); }
    .google-badge { font-size: 13px; font-weight: 700; color: #2563eb; margin-bottom: 8px; }
    h1 { font-size: 20px; margin: 0 0 6px; }
    .sub { font-size: 13px; color: #475569; margin-bottom: 18px; }
    .acct-tile { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; }
    .acct-tile:hover { background: #eff6ff; border-color: #93c5fd; }
    .acct-name { font-size: 14px; font-weight: 700; color: #0f172a; }
    .acct-email { font-size: 12.5px; color: #475569; }
    .btn-row { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
    .btn { padding: 9px 18px; border-radius: 8px; font-weight: 600; font-size: 13.5px; cursor: pointer; border: 1px solid #cbd5e1; background: #fff; }
    .btn-primary { background: #1a73e8; color: #fff; border-color: #1a73e8; }
  </style>
</head>
<body data-jobify-oauth-provider="google">
  <div class="oauth-card">
    <div class="google-badge">Sign in with Google</div>

    <!-- STEP 1: GOOGLE ACCOUNT CHOOSER -->
    <div id="oauth-step-chooser">
      <h1>Choose an account</h1>
      <div class="sub">to continue to <strong>Microsoft Careers</strong></div>

      <div role="link" tabindex="0" class="acct-tile" data-identifier="ravitejavelanati11@gmail.com" data-email="ravitejavelanati11@gmail.com" id="google-tile-ravi">
        <span class="acct-name">Raviteja Velanati</span>
        <span class="acct-email">ravitejavelanati11@gmail.com</span>
      </div>

      <div role="link" tabindex="0" class="acct-tile" data-identifier="other_account" id="google-tile-other">
        <span class="acct-name">Use another account</span>
      </div>
    </div>

    <!-- STEP 2: GOOGLE OAUTH CONSENT / CONTINUE -->
    <div id="oauth-step-consent" style="display:none;">
      <h1>Sign in to Microsoft Careers</h1>
      <div class="sub">Google will share your name and email address (<strong>ravitejavelanati11@gmail.com</strong>) with Microsoft Careers.</div>
      <div class="btn-row">
        <button type="button" class="btn" id="oauth-consent-cancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="oauth-consent-continue">Continue</button>
      </div>
    </div>
  </div>

  <script>
    let chosenEmail = "";
    document.getElementById("google-tile-ravi").addEventListener("click", () => {
      chosenEmail = "ravitejavelanati11@gmail.com";
      document.getElementById("oauth-step-chooser").style.display = "none";
      document.getElementById("oauth-step-consent").style.display = "block";
    });

    document.getElementById("oauth-consent-continue").addEventListener("click", () => {
      const payload = {
        type: "MS_GOOGLE_OAUTH_SUCCESS",
        email: chosenEmail || "ravitejavelanati11@gmail.com",
        name: "Raviteja Velanati",
        timestamp: Date.now()
      };
      try {
        localStorage.setItem("ms_sso_oauth_result", JSON.stringify(payload));
      } catch (_) {}
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, "*");
        }
      } catch (_) {}
      setTimeout(() => {
        window.close();
      }, 120);
    });
  </script>
</body>
</html>
"""

MICROSOFT_SSO_SANDBOX_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Senior AI Agents &amp; Copilot Runtime Engineer - Microsoft Careers</title>
  <style>
    body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; background: #f3f2f1; color: #201f1e; margin: 0; }
    header { background: #ffffff; border-bottom: 1px solid #edebe9; padding: 14px 32px; display: flex; justify-content: space-between; align-items: center; }
    .ms-brand { font-weight: 700; font-size: 16px; display: flex; align-items: center; gap: 8px; }
    .nav-signin { background: transparent; border: 1px solid #8a8886; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; }
    .container { max-width: 820px; margin: 28px auto; padding: 0 20px; }
    .card { background: #fff; border-radius: 8px; padding: 28px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); margin-bottom: 20px; border: 1px solid #edebe9; }
    .btn-ms-primary { background: #0067b8; color: #fff; border: none; padding: 11px 24px; border-radius: 4px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .sso-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.52); display: none; align-items: center; justify-content: center; z-index: 9999; }
    .sso-modal { background: #fff; border-radius: 10px; width: 420px; padding: 28px; box-shadow: 0 20px 45px rgba(0,0,0,0.25); }
    .sso-btn { width: 100%; padding: 11px 16px; margin: 8px 0; border-radius: 6px; border: 1px solid #cbd5e1; background: #fff; font-size: 14px; font-weight: 600; color: #1e293b; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .sso-btn:hover { background: #f8fafc; border-color: #0067b8; }
    .row { margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="url"], select, textarea {
      width: 100%; padding: 9px 12px; border: 1px solid #8a8886; border-radius: 4px; font-size: 14px; box-sizing: border-box;
    }
  </style>
</head>
<body>
  <header role="banner">
    <div class="ms-brand"><span class="company-name">Microsoft</span> Careers</div>
    <div>
      <button type="button" class="nav-signin" id="ms-nav-signin-trap">Sign in</button>
    </div>
  </header>

  <div class="container">
    <!-- STAGE 1: MICROSOFT JOB POSTING -->
    <div class="card" id="ms-stage-job">
      <div style="font-size:12px; font-weight:700; color:#0067b8;">MICROSOFT AI &amp; COPILOT PLATFORM</div>
      <h1 style="margin:6px 0 8px; font-size:24px;">Senior AI Agents &amp; Copilot Runtime Engineer</h1>
      <div class="location" style="font-size:13.5px; color:#605e5c; margin-bottom:14px;">Redmond, WA • Hybrid • Base Salary Range: $182,000 - $238,000 USD</div>
      <p style="font-size:14px; line-height:1.6; margin-bottom:20px;">
        Microsoft is hiring a Senior AI Agents &amp; Copilot Runtime Engineer to architect multi-agent LLM orchestration,
        RAG retrieval pipelines, FastAPI &amp; Python inference services, TypeScript/React developer consoles, Playwright browser
        evaluation harnesses, and Kubernetes/Azure/GCP distributed telemetry.
      </p>
      <button type="button" class="btn-ms-primary" id="ms-apply-btn">Apply</button>
    </div>

    <!-- STAGE 2: MICROSOFT MULTI-PROVIDER SIGN-IN MODAL (Sign in with Google / Microsoft / LinkedIn / Facebook) -->
    <div class="sso-modal-backdrop" id="ms-sso-modal" role="dialog" aria-modal="true" aria-label="Sign in to apply">
      <div class="sso-modal">
        <h2 style="margin:0 0 6px; font-size:20px;">Sign in to apply</h2>
        <p style="font-size:13px; color:#605e5c; margin:0 0 16px;">Choose an account provider to continue your Microsoft Careers application</p>
        <button type="button" class="sso-btn" id="ms-sso-google" data-provider="google">Sign in with Google</button>
        <button type="button" class="sso-btn" id="ms-sso-microsoft" data-provider="microsoft">Sign in with Microsoft</button>
        <button type="button" class="sso-btn" id="ms-sso-linkedin" data-provider="linkedin">Sign in with LinkedIn</button>
        <button type="button" class="sso-btn" id="ms-sso-facebook" data-provider="facebook">Sign in with Facebook</button>
      </div>
    </div>

    <!-- STAGE 3: POST-OAUTH PRIVACY & TERMS CONSENT GATE -->
    <div class="card" id="ms-stage-privacy" style="display:none;">
      <h2 style="margin-top:0;">Microsoft Careers Data Privacy Statement</h2>
      <p style="font-size:13.5px; color:#323130; line-height:1.5;">
        Signed in with Google as <strong id="ms-authed-user-badge">ravitejavelanati11@gmail.com</strong>. Before starting your application, please review and accept the Microsoft Candidate Privacy Statement.
      </p>
      <div class="row" style="display:flex; align-items:center; gap:8px; margin:16px 0;">
        <input type="checkbox" id="ms-privacy-cb" required />
        <label for="ms-privacy-cb" style="margin:0; cursor:pointer;">I have read and agree to the Microsoft Careers Candidate Privacy Statement and Terms *</label>
      </div>
      <div id="ms-privacy-err" style="display:none; color:#d13438; font-size:12.5px; margin-bottom:10px;">
        Please accept the Candidate Privacy Statement to continue.
      </div>
      <button type="button" class="btn-ms-primary" id="ms-privacy-continue">Agree &amp; Continue</button>
    </div>

    <!-- STAGE 4: MICROSOFT CANDIDATE APPLICATION FORM -->
    <div class="card" id="ms-stage-form" style="display:none;">
      <h2 style="margin-top:0;">Complete Your Microsoft Application</h2>
      <div class="row"><label for="ms_first_name">First Name *</label><input id="ms_first_name" type="text" required /></div>
      <div class="row"><label for="ms_last_name">Last Name *</label><input id="ms_last_name" type="text" required /></div>
      <div class="row"><label for="ms_email">Email Address *</label><input id="ms_email" type="email" required /></div>
      <div class="row"><label for="ms_phone">Phone Number *</label><input id="ms_phone" type="tel" required /></div>
      <div class="row"><label for="ms_resume">Resume / CV (PDF) *</label><input id="ms_resume" type="file" accept=".pdf" required /></div>
      <div class="row"><label for="ms_linkedin">LinkedIn Profile URL *</label><input id="ms_linkedin" type="url" required /></div>
      <div class="row">
        <label for="ms_work_auth">Are you legally authorized to work in the United States? *</label>
        <select id="ms_work_auth" required>
          <option value="">Select One</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>
      <div class="row">
        <label for="ms_sponsorship">Will you now or in the future require visa sponsorship? *</label>
        <select id="ms_sponsorship" required>
          <option value="">Select One</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      </div>
      <div id="ms-form-err" style="display:none; color:#d13438; font-size:13px; margin-bottom:12px;"></div>
      <button type="button" class="btn-ms-primary" id="ms_submit_btn">Submit Application</button>
    </div>

    <!-- STAGE 5: CONFIRMATION -->
    <div class="card" id="ms-stage-done" style="display:none; border-color:#107c10; background:#f1faf1;">
      <h2 style="color:#107c10; margin-top:0;">Thank you for applying to Microsoft!</h2>
      <p>Your application for <strong>Senior AI Agents &amp; Copilot Runtime Engineer</strong> has been submitted.</p>
    </div>
  </div>

  <script>
    try { localStorage.removeItem("ms_sso_oauth_result"); } catch (_) {}

    window.__MS_SSO_AUDIT__ = {
      navSignInTrapClicked: false,
      applyClicked: false,
      ssoProviderClicked: null,
      oauthCompletedEmail: null,
      privacyAccepted: false,
      submitted: false,
      finalValues: null
    };

    document.getElementById("ms-nav-signin-trap").addEventListener("click", () => {
      window.__MS_SSO_AUDIT__.navSignInTrapClicked = true;
    });

    document.getElementById("ms-apply-btn").addEventListener("click", () => {
      window.__MS_SSO_AUDIT__.applyClicked = true;
      setTimeout(() => {
        document.getElementById("ms-sso-modal").style.display = "flex";
      }, 300);
    });

    function onGoogleOAuthSuccess(email) {
      if (window.__MS_SSO_AUDIT__.oauthCompletedEmail) return;
      window.__MS_SSO_AUDIT__.oauthCompletedEmail = email || "ravitejavelanati11@gmail.com";
      document.getElementById("ms-sso-modal").style.display = "none";
      document.getElementById("ms-stage-job").style.display = "none";
      document.getElementById("ms-authed-user-badge").textContent = window.__MS_SSO_AUDIT__.oauthCompletedEmail;
      document.getElementById("ms_email").value = window.__MS_SSO_AUDIT__.oauthCompletedEmail;
      document.getElementById("ms-stage-privacy").style.display = "block";
    }

    window.addEventListener("message", (ev) => {
      if (ev.data && ev.data.type === "MS_GOOGLE_OAUTH_SUCCESS") {
        onGoogleOAuthSuccess(ev.data.email);
      }
    });

    setInterval(() => {
      try {
        const raw = localStorage.getItem("ms_sso_oauth_result");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.type === "MS_GOOGLE_OAUTH_SUCCESS") {
            onGoogleOAuthSuccess(parsed.email);
          }
        }
      } catch (_) {}
    }, 300);

    document.getElementById("ms-sso-google").addEventListener("click", () => {
      window.__MS_SSO_AUDIT__.ssoProviderClicked = "google";
      window.open("/sandbox/google-oauth-popup", "google_oauth_popup", "width=500,height=640");
    });

    for (const otherId of ["ms-sso-microsoft", "ms-sso-linkedin", "ms-sso-facebook"]) {
      document.getElementById(otherId).addEventListener("click", (e) => {
        window.__MS_SSO_AUDIT__.ssoProviderClicked = e.currentTarget.getAttribute("data-provider");
      });
    }

    document.getElementById("ms-privacy-continue").addEventListener("click", () => {
      const cb = document.getElementById("ms-privacy-cb");
      if (!cb.checked) {
        document.getElementById("ms-privacy-err").style.display = "block";
        return;
      }
      window.__MS_SSO_AUDIT__.privacyAccepted = true;
      document.getElementById("ms-stage-privacy").style.display = "none";
      document.getElementById("ms-stage-form").style.display = "block";
    });

    document.getElementById("ms_submit_btn").addEventListener("click", () => {
      const fn = document.getElementById("ms_first_name").value.trim();
      const ln = document.getElementById("ms_last_name").value.trim();
      const em = document.getElementById("ms_email").value.trim();
      const ph = document.getElementById("ms_phone").value.trim();
      const resFile = document.getElementById("ms_resume").files[0]?.name || "";
      const li = document.getElementById("ms_linkedin").value.trim();
      const wa = document.getElementById("ms_work_auth").value;
      const sp = document.getElementById("ms_sponsorship").value;

      if (!fn || !ln || !em || !ph || !resFile || !li || !wa || !sp) {
        const errEl = document.getElementById("ms-form-err");
        errEl.textContent = "Please complete all required candidate fields and attach your tailored PDF resume.";
        errEl.style.display = "block";
        return;
      }
      window.__MS_SSO_AUDIT__.submitted = true;
      window.__MS_SSO_AUDIT__.finalValues = {
        firstName: fn,
        lastName: ln,
        email: em,
        phone: ph,
        resumeName: resFile,
        linkedin: li,
        workAuth: wa,
        sponsorship: sp
      };
      document.getElementById("ms-stage-form").style.display = "none";
      document.getElementById("ms-stage-done").style.display = "block";
    });
  </script>
</body>
</html>
"""

LIVE_JOBS_CACHE = {"timestamp": 0.0, "jobs": []}

CANDIDATE_CORE_SKILLS = [
    "Python",
    "TypeScript",
    "JavaScript",
    "React",
    "Next.js",
    "FastAPI",
    "Node.js",
    "LangGraph",
    "LLM",
    "RAG",
    "Multi-Agent",
    "PyTorch",
    "Docker",
    "Kubernetes",
    "GCP",
    "AWS",
    "Playwright",
    "PostgreSQL",
    "CI/CD",
    "Distributed Systems",
]


def _score_and_classify_job(title: str, company: str, location: str, ats: str, url: str, description: str, badge: str = "") -> dict:
    blob = f"{title} {company} {description}".lower()
    if any(k in blob for k in ("agent", "llm", "genai", "generative", "ai", "ml", "machine learning", "copilot", "evaluation", "rag")):
        archetype = "AI Agents & LLM Systems"
        base_score = 93
    elif any(k in blob for k in ("full stack", "fullstack", "frontend", "react", "typescript", "product engineer", "web")):
        archetype = "Full-Stack & Product Eng"
        base_score = 90
    elif any(k in blob for k in ("data", "analytics", "pipeline", "spark", "platform")):
        archetype = "ML & Data Platform"
        base_score = 88
    else:
        archetype = "Backend & Cloud Infra"
        base_score = 87

    matched = [s for s in CANDIDATE_CORE_SKILLS if s.lower() in blob]
    if len(matched) < 5:
        for fallback_sk in ("Python", "TypeScript", "Distributed Systems", "LLM", "FastAPI", "React", "Kubernetes"):
            if fallback_sk not in matched:
                matched.append(fallback_sk)
            if len(matched) >= 6:
                break

    missing = [s for s in ("Rust", "CUDA", "Go", "Terraform", "Kafka") if s.lower() in blob][:2]
    score = min(99, base_score + min(6, len(matched) // 2))
    job_id = re.sub(r"[^a-zA-Z0-9]+", "_", f"{company}_{title}_{url[-18:]}").strip("_").lower()[:64]
    return {
        "id": job_id,
        "title": title,
        "company": company,
        "location": location or "United States (Hybrid / Remote)",
        "ats": ats,
        "url": url,
        "archetype": archetype,
        "matchScore": score,
        "matchedKeywords": matched[:7],
        "missingKeywords": missing,
        "badge": badge or ("Live ATS Feed" if not url.startswith("http://127.0.0.1") else "Interactive E2E Portal"),
        "description": description[:1200],
    }


def aggregate_live_jobs(force_refresh: bool = False) -> list:
    now = time.time()
    if not force_refresh and LIVE_JOBS_CACHE["jobs"] and (now - LIVE_JOBS_CACHE["timestamp"] < 180):
        return LIVE_JOBS_CACHE["jobs"]

    curated_and_live = [
        _score_and_classify_job(
            title="Senior AI Agents & Copilot Runtime Engineer",
            company="Microsoft",
            location="Redmond, WA • Hybrid ($182K - $238K)",
            ats="Microsoft Careers (Google SSO)",
            url=f"http://127.0.0.1:{PORT}/sandbox/microsoft-sso",
            description=(
                "Microsoft is hiring a Senior AI Agents & Copilot Runtime Engineer to architect multi-agent LLM orchestration, "
                "RAG retrieval pipelines, FastAPI & Python inference services, TypeScript/React developer consoles, Playwright "
                "browser evaluation harnesses, and Kubernetes/Azure/GCP distributed telemetry."
            ),
            badge="Microsoft Google SSO Ready",
        ),
        _score_and_classify_job(
            title="Principal AI Agents & Evaluation Engineer",
            company="NVIDIA",
            location="Santa Clara, CA • Hybrid ($185K - $235K)",
            ats="Workday (Full Auth + 3-Step Wizard)",
            url=f"http://127.0.0.1:{PORT}/sandbox/workday-full-e2e",
            description=(
                "NVIDIA is hiring a Principal AI Agents & Evaluation Engineer to build autonomous browser and multi-agent evaluation "
                "pipelines, synthetic data sandboxes, distributed telemetry, and LLM tooling. Required skills: Python, TypeScript, "
                "React, FastAPI, LangGraph, Docker, Kubernetes, GCP, PyTorch, Playwright, RAG, and CI/CD."
            ),
            badge="Workday Auto-Login Ready",
        ),
        _score_and_classify_job(
            title="AI Engineer, Agent Systems",
            company="Anthropic",
            location="San Francisco, CA • Hybrid ($190K - $240K)",
            ats="Greenhouse",
            url=f"http://127.0.0.1:{PORT}/sandbox/greenhouse",
            description=(
                "Anthropic is looking for an AI Engineer to build reliable multi-agent systems, LLM evaluation pipelines, "
                "high-throughput Python & TypeScript backends, React observability dashboards, and distributed inference infrastructure "
                "on GCP and AWS using FastAPI, LangGraph, PyTorch, Docker, and Kubernetes."
            ),
            badge="1-Click Auto-Submit Ready",
        ),
        _score_and_classify_job(
            title="Staff AI Platform Engineer",
            company="Mistral AI",
            location="San Francisco, CA • Hybrid ($180K - $210K)",
            ats="Ashby / Custom React",
            url=f"http://127.0.0.1:{PORT}/sandbox/ai-error-heal",
            description=(
                "Mistral AI is hiring a Staff AI Platform Engineer to architect distributed LLM serving, automated evaluation "
                "pipelines, high-throughput Python & FastAPI microservices, Kubernetes GPU orchestration, and production telemetry on GCP and AWS."
            ),
            badge="AI Self-Healing Ready",
        ),
    ]

    # Pull live real-world jobs from public Greenhouse & Ashby boards (with fast timeout)
    greenhouse_boards = [
        ("anthropic", "Anthropic"),
        ("scaleai", "Scale AI"),
        ("stripe", "Stripe"),
        ("databricks", "Databricks"),
        ("togetherai", "Together AI"),
        ("vercel", "Vercel"),
    ]
    role_filter = re.compile(
        r"\b(software|ai|ml|machine learning|agent|full[- ]?stack|backend|platform|data|research engineer|applied ai|forward deployed)\b",
        re.I,
    )
    loc_filter = re.compile(r"\b(united states|us|remote|san francisco|new york|seattle|redmond|boston|austin|mountain view|palo alto|sunnyvale|california|wa|ny|ma|tx)\b", re.I)

    for slug, company_label in greenhouse_boards:
        try:
            req = urllib.request.Request(
                f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true",
                headers={"User-Agent": "JobifyAggregator/2.3"},
            )
            with urllib.request.urlopen(req, timeout=2.8) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                count_for_company = 0
                for jb in data.get("jobs", []):
                    title = (jb.get("title") or "").strip()
                    loc = (jb.get("location", {}) or {}).get("name") or "United States"
                    if not role_filter.search(title):
                        continue
                    if not loc_filter.search(loc):
                        continue
                    raw_html = jb.get("content") or ""
                    clean_desc = re.sub(r"<[^>]+>", " ", html_lib.unescape(raw_html))
                    clean_desc = re.sub(r"\s+", " ", clean_desc).strip()
                    abs_url = jb.get("absolute_url") or ""
                    if not abs_url:
                        continue
                    curated_and_live.append(
                        _score_and_classify_job(
                            title=title,
                            company=company_label,
                            location=loc,
                            ats="Greenhouse",
                            url=abs_url,
                            description=clean_desc or f"{company_label} {title} role building scalable AI and software systems.",
                            badge="Live Greenhouse API",
                        )
                    )
                    count_for_company += 1
                    if count_for_company >= 3:
                        break
        except Exception:
            pass

    # Fallback real external links if offline or rate-limited so feed always has rich live roles
    if len(curated_and_live) < 8:
        fallback_external = [
            (
                "Software Engineer, AI Platform & Agents",
                "Microsoft",
                "Redmond, WA • Hybrid",
                "Microsoft Careers",
                "https://jobs.careers.microsoft.com/global/en/search?q=AI%20Engineer",
                "Build production Copilot agent runtime, Python/TypeScript services, Azure/GCP inference pipelines, and evaluation tooling.",
            ),
            (
                "Software Engineer, Applied AI",
                "OpenAI",
                "San Francisco, CA",
                "Ashby",
                "https://openai.com/careers/search",
                "Architect agentic workflows, multimodal APIs, distributed Python & FastAPI services, and React developer experiences.",
            ),
            (
                "Forward Deployed AI Engineer, GenAI",
                "Scale AI",
                "San Francisco, CA / New York, NY",
                "Greenhouse",
                "https://scale.com/careers",
                "Build enterprise GenAI applications, RLHF & evaluation pipelines, RAG architectures, and Python/TypeScript microservices.",
            ),
            (
                "Senior Software Engineer, AI Systems",
                "Databricks",
                "Mountain View, CA / Seattle, WA",
                "Greenhouse",
                "https://www.databricks.com/company/careers/open-positions",
                "Design Mosaic AI agent serving, LLM evaluation frameworks, distributed data pipelines, and cloud infrastructure.",
            ),
        ]
        for t, c, l, a, u, d in fallback_external:
            curated_and_live.append(_score_and_classify_job(t, c, l, a, u, d, badge="Live Career Board"))

    curated_and_live.sort(key=lambda x: x.get("matchScore", 0), reverse=True)
    LIVE_JOBS_CACHE["timestamp"] = now
    LIVE_JOBS_CACHE["jobs"] = curated_and_live
    return curated_and_live


JOBIFY_WEBAPP_HTML = """<!DOCTYPE html>
<html lang="en" data-jobify-webapp="true">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Jobify AI — Autonomous Job Discovery, ATS Resume Tailoring &amp; 1-Click Auto-Apply</title>
  <style>
    :root {
      --bg: #0b1020;
      --card: #131b31;
      --card-hover: #18233f;
      --border: #263459;
      --text: #f8fafc;
      --muted: #94a3b8;
      --accent: #6366f1;
      --accent-2: #06b6d4;
      --green: #10b981;
      --amber: #f59e0b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: radial-gradient(circle at top right, #1e1b4b 0%, #0b1020 55%);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(11, 16, 32, 0.88);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      padding: 14px 32px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 36px; height: 36px; border-radius: 10px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; font-size: 18px; color: #fff;
    }
    .brand-title { font-size: 18px; font-weight: 800; letter-spacing: -0.3px; }
    .brand-sub { font-size: 12px; color: var(--muted); }
    .hdr-actions { display: flex; align-items: center; gap: 12px; }
    .ext-pill {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 7px 14px; border-radius: 999px; font-size: 12.5px; font-weight: 700;
      background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);
    }
    .ext-pill.warn {
      background: rgba(245, 158, 11, 0.14); color: #fbbf24; border-color: rgba(245, 158, 11, 0.35);
    }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .container { max-width: 1240px; margin: 0 auto; padding: 26px 28px 60px; }

    /* Hero Custom URL Auto-Apply Launcher */
    .hero-launcher {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.16), rgba(6, 182, 212, 0.10));
      border: 1px solid rgba(99, 102, 241, 0.45);
      border-radius: 16px;
      padding: 22px 24px;
      margin-bottom: 22px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
    }
    .hero-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px; }
    .hero-title { font-size: 18px; font-weight: 800; margin: 0; }
    .hero-sub { font-size: 13px; color: var(--muted); margin: 2px 0 0; }
    .url-bar { display: flex; gap: 10px; flex-wrap: wrap; }
    .url-input {
      flex: 1; min-width: 280px; padding: 12px 16px; border-radius: 10px;
      border: 1px solid var(--border); background: rgba(15, 23, 42, 0.85); color: #fff; font-size: 14px;
    }
    .btn {
      padding: 10px 18px; border-radius: 10px; font-weight: 700; font-size: 13.5px;
      cursor: pointer; border: 1px solid var(--border); background: var(--card); color: #fff;
      display: inline-flex; align-items: center; gap: 8px; transition: all 0.15s ease;
    }
    .btn:hover { border-color: var(--accent); transform: translateY(-1px); }
    .btn-primary {
      background: linear-gradient(135deg, var(--accent), #4f46e5);
      border-color: transparent; color: #fff;
    }
    .btn-emerald {
      background: linear-gradient(135deg, #10b981, #059669);
      border-color: transparent; color: #fff;
    }

    /* Live Telemetry Banner */
    .live-hud {
      display: none;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--accent-2);
      border-radius: 14px;
      padding: 16px 20px;
      margin-bottom: 22px;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .live-hud.active { display: flex; }
    .hud-step { font-size: 15px; font-weight: 800; color: #38bdf8; }
    .hud-detail { font-size: 13px; color: var(--muted); margin-top: 3px; }

    /* Filter Bar */
    .toolbar {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      margin-bottom: 18px; flex-wrap: wrap;
    }
    .filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .search-in, .select-in {
      padding: 9px 13px; border-radius: 9px; border: 1px solid var(--border);
      background: var(--card); color: #fff; font-size: 13px;
    }

    /* Main Grid */
    .layout-grid { display: grid; grid-template-columns: 1fr 340px; gap: 22px; align-items: start; }
    @media (max-width: 980px) { .layout-grid { grid-template-columns: 1fr; } }

    .jobs-list { display: flex; flex-direction: column; gap: 14px; }
    .job-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px 20px;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .job-card:hover { border-color: #4f46e5; background: var(--card-hover); }
    .jc-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .jc-title { font-size: 16.5px; font-weight: 800; color: #fff; margin: 0 0 4px; }
    .jc-meta { font-size: 13px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .match-badge {
      padding: 5px 11px; border-radius: 999px; font-size: 12.5px; font-weight: 800;
      background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35);
      white-space: nowrap;
    }
    .kw-row { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .kw-chip {
      font-size: 11.5px; padding: 3px 9px; border-radius: 6px;
      background: rgba(99, 102, 241, 0.14); color: #a5b4fc; border: 1px solid rgba(99, 102, 241, 0.28);
    }
    .kw-chip.portal {
      background: rgba(6, 182, 212, 0.14); color: #67e8f9; border-color: rgba(6, 182, 212, 0.3);
    }
    .jc-actions { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; }

    .side-panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      position: sticky;
      top: 78px;
    }
    .side-h { font-size: 14.5px; font-weight: 800; margin: 0 0 12px; display: flex; justify-content: space-between; align-items: center; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }
    .stat-box { background: rgba(15, 23, 42, 0.65); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
    .stat-num { font-size: 20px; font-weight: 800; color: #38bdf8; }
    .stat-lbl { font-size: 11.5px; color: var(--muted); }
    .app-item {
      padding: 10px 12px; border-radius: 9px; background: rgba(15, 23, 42, 0.55);
      border: 1px solid var(--border); margin-bottom: 8px; font-size: 12.5px;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-logo">J</div>
      <div>
        <div class="brand-title">Jobify AI Web Platform</div>
        <div class="brand-sub">Live Multi-Board Job Aggregator • 1-Page LaTeX Resume Tailoring • Universal SSO &amp; Login Auto-Apply</div>
      </div>
    </div>
    <div class="hdr-actions">
      <div id="ext-status-pill" class="ext-pill warn">
        <span class="dot"></span>
        <span id="ext-status-text">Connecting to Jobify Chrome Extension...</span>
      </div>
      <button type="button" class="btn" id="btn-refresh-jobs">🔄 Refresh Live Jobs</button>
      <button type="button" class="btn" id="btn-open-ext-hub">⚙️ Extension Hub</button>
    </div>
  </header>

  <div class="container">
    <!-- Top Custom URL Launcher -->
    <div class="hero-launcher">
      <div class="hero-top">
        <div>
          <h1 class="hero-title">Paste Any Job URL for Autonomous Tailor + Login Bypass + Auto-Apply</h1>
          <p class="hero-sub">Supports Microsoft Careers (Sign in with Google / OAuth Popup), Workday, Greenhouse, Ashby, Lever, Eightfold &amp; Custom Portals</p>
        </div>
      </div>
      <div class="url-bar">
        <input type="url" id="custom-job-url" class="url-input" placeholder="https://jobs.careers.microsoft.com/... or any Greenhouse / Workday / Ashby / Lever job URL" />
        <button type="button" class="btn btn-primary" id="btn-launch-custom-url">🚀 Tailor &amp; Auto-Apply URL</button>
      </div>
    </div>

    <!-- Live Auto-Apply Telemetry HUD -->
    <div class="live-hud" id="web-live-hud">
      <div>
        <div class="hud-step" id="web-hud-step">🤖 Jobify Autonomous Agent Active</div>
        <div class="hud-detail" id="web-hud-detail">Initializing workflow...</div>
      </div>
      <button type="button" class="btn" id="btn-stop-web-apply" style="border-color:#ef4444;color:#fca5a5;">⏹ Stop</button>
    </div>

    <!-- Filter & Batch Action Bar -->
    <div class="toolbar">
      <div class="filters">
        <input type="text" id="filter-search" class="search-in" placeholder="Search role, company, or skill (e.g. Microsoft, Agent, Python)..." style="width:280px;" />
        <select id="filter-archetype" class="select-in">
          <option value="ALL">All Role Archetypes</option>
          <option value="AI Agents & LLM Systems">AI Agents &amp; LLM Systems</option>
          <option value="Full-Stack & Product Eng">Full-Stack &amp; Product Eng</option>
          <option value="Backend & Cloud Infra">Backend &amp; Cloud Infra</option>
          <option value="ML & Data Platform">ML &amp; Data Platform</option>
        </select>
        <select id="filter-ats" class="select-in">
          <option value="ALL">All Portals / ATS</option>
          <option value="Microsoft">Microsoft Careers (SSO)</option>
          <option value="Workday">Workday</option>
          <option value="Greenhouse">Greenhouse</option>
          <option value="Ashby">Ashby</option>
        </select>
      </div>
      <div style="display:flex; gap:10px; align-items:center;">
        <button type="button" class="btn btn-emerald" id="btn-batch-apply">🚀 Batch Auto-Apply Selected (<span id="selected-count">0</span>)</button>
      </div>
    </div>

    <div class="layout-grid">
      <div class="jobs-list" id="jobs-feed-container">
        <div class="job-card">Loading live jobs across Greenhouse, Ashby, Workday &amp; Microsoft Careers...</div>
      </div>

      <aside class="side-panel">
        <h3 class="side-h">
          <span>📊 Synced Extension Telemetry</span>
        </h3>
        <div class="stat-grid">
          <div class="stat-box">
            <div class="stat-num" id="stat-live-jobs">0</div>
            <div class="stat-lbl">Live Jobs Pulled</div>
          </div>
          <div class="stat-box">
            <div class="stat-num" id="stat-applied-count">0</div>
            <div class="stat-lbl">Applications Logged</div>
          </div>
          <div class="stat-box">
            <div class="stat-num" id="stat-resumes-count">0</div>
            <div class="stat-lbl">Tailored 1-Page PDFs</div>
          </div>
          <div class="stat-box">
            <div class="stat-num" id="stat-candidate-email" style="font-size:12px; word-break:break-all;">ravitejavelanati11@gmail.com</div>
            <div class="stat-lbl">Active SSO / Vault Email</div>
          </div>
        </div>

        <h3 class="side-h" style="margin-top:18px;">✅ Recent Auto-Applications</h3>
        <div id="recent-apps-list">
          <div class="app-item" style="color:var(--muted);">No applications yet — click <strong>⚡ 1-Click Tailor &amp; Auto-Apply</strong> on any job card.</div>
        </div>
      </aside>
    </div>
  </div>

  <script>
    let allJobs = [];
    let selectedJobIds = new Set();
    let extensionConnected = false;
    const pendingRpc = new Map();

    function sendExtensionRpc(type, payload = {}, timeoutMs = 60000) {
      return new Promise((resolve) => {
        const reqId = "req_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
        const timer = setTimeout(() => {
          pendingRpc.delete(reqId);
          resolve({ ok: false, error: "Extension RPC timed out." });
        }, timeoutMs);
        pendingRpc.set(reqId, (resp) => {
          clearTimeout(timer);
          resolve(resp);
        });
        window.postMessage({ source: "jobify-webapp", type, reqId, payload }, "*");
      });
    }

    window.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "jobify-extension") return;
      if (data.type === "JOBIFY_EXT_READY") {
        markExtensionConnected();
        syncExtensionState();
      } else if (data.type === "JOBIFY_EXT_RESPONSE" && data.reqId && pendingRpc.has(data.reqId)) {
        const cb = pendingRpc.get(data.reqId);
        pendingRpc.delete(data.reqId);
        cb(data.payload);
      } else if (data.type === "JOBIFY_EXT_PROGRESS" && data.payload) {
        renderLiveProgress(data.payload);
      }
    });

    function markExtensionConnected() {
      extensionConnected = true;
      document.documentElement.setAttribute("data-jobify-extension-connected", "true");
      const pill = document.getElementById("ext-status-pill");
      const txt = document.getElementById("ext-status-text");
      pill.classList.remove("warn");
      txt.textContent = "Chrome Extension Connected (v2.3 Universal Auth)";
    }

    function renderLiveProgress(st) {
      const hud = document.getElementById("web-live-hud");
      const stepEl = document.getElementById("web-hud-step");
      const detEl = document.getElementById("web-hud-detail");
      hud.classList.add("active");
      stepEl.textContent = st.stepLabel || "Jobify Auto-Apply Active";
      detEl.textContent = st.detail || "";
      if (st.completed || st.stage === "completed" || st.stage === "error") {
        setTimeout(() => syncExtensionState(), 450);
      }
    }

    async function syncExtensionState() {
      const res = await sendExtensionRpc("JOBIFY_WEB_GET_STATE", {}, 4500);
      if (res && res.ok && res.state) {
        markExtensionConnected();
        const apps = res.state.applications || [];
        const resumes = res.state.tailoredResumes || [];
        document.getElementById("stat-applied-count").textContent = String(apps.length);
        document.getElementById("stat-resumes-count").textContent = String(resumes.length);
        if (res.state.credentials?.portalEmail) {
          document.getElementById("stat-candidate-email").textContent = res.state.credentials.portalEmail;
        }
        const listEl = document.getElementById("recent-apps-list");
        if (apps.length > 0) {
          listEl.innerHTML = apps.slice(0, 6).map((a) => `
            <div class="app-item">
              <div style="font-weight:700;color:#fff;">${escapeHtml(a.company)} — ${escapeHtml(a.role)}</div>
              <div style="color:#34d399;font-size:11.5px;margin-top:2px;">Status: ${escapeHtml(a.status || "Applied")} • ${escapeHtml(a.resumeUsed || "Tailored PDF")}</div>
            </div>
          `).join("");
        }
      }
    }

    function escapeHtml(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    async function loadJobs(force = false) {
      const resp = await fetch(`/api/jobs${force ? "?refresh=1" : ""}`);
      const data = await resp.json();
      allJobs = data.jobs || [];
      document.getElementById("stat-live-jobs").textContent = String(allJobs.length);
      renderJobs();
    }

    function renderJobs() {
      const q = document.getElementById("filter-search").value.trim().toLowerCase();
      const arch = document.getElementById("filter-archetype").value;
      const ats = document.getElementById("filter-ats").value;

      const filtered = allJobs.filter((j) => {
        if (arch !== "ALL" && j.archetype !== arch) return false;
        if (ats !== "ALL" && !String(j.ats || "").toLowerCase().includes(ats.toLowerCase())) return false;
        if (q) {
          const hay = `${j.title} ${j.company} ${j.location} ${j.ats} ${(j.matchedKeywords || []).join(" ")}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });

      const container = document.getElementById("jobs-feed-container");
      if (filtered.length === 0) {
        container.innerHTML = `<div class="job-card">No matching jobs found for the active filter.</div>`;
        return;
      }

      container.innerHTML = filtered.map((j) => {
        const checked = selectedJobIds.has(j.id) ? "checked" : "";
        return `
          <div class="job-card" data-job-id="${escapeHtml(j.id)}" data-job-company="${escapeHtml(j.company)}">
            <div class="jc-top">
              <div style="display:flex; gap:12px; align-items:flex-start;">
                <input type="checkbox" class="job-select-cb" data-id="${escapeHtml(j.id)}" ${checked} style="margin-top:4px; width:16px; height:16px; cursor:pointer;" />
                <div>
                  <h2 class="jc-title">${escapeHtml(j.title)}</h2>
                  <div class="jc-meta">
                    <strong style="color:#e2e8f0;">${escapeHtml(j.company)}</strong>
                    <span>•</span>
                    <span>${escapeHtml(j.location)}</span>
                    <span>•</span>
                    <span style="color:#38bdf8;">${escapeHtml(j.ats)}</span>
                  </div>
                </div>
              </div>
              <span class="match-badge">${j.matchScore}% ATS Match</span>
            </div>

            <div class="kw-row">
              <span class="kw-chip portal">${escapeHtml(j.archetype)}</span>
              <span class="kw-chip portal">${escapeHtml(j.badge || "Live Role")}</span>
              ${(j.matchedKeywords || []).map((k) => `<span class="kw-chip">✓ ${escapeHtml(k)}</span>`).join("")}
            </div>

            <div style="font-size:13px; color:var(--muted); line-height:1.5;">
              ${escapeHtml((j.description || "").slice(0, 220))}...
            </div>

            <div class="jc-actions">
              <div style="font-size:12px; color:var(--muted);">
                Tailors <code style="color:#a5b4fc;">Raviteja_velanati_${escapeHtml(j.company.replace(/[^a-zA-Z0-9]+/g, "_"))}.pdf</code> + Bypasses SSO/Login
              </div>
              <div style="display:flex; gap:8px;">
                <a href="${escapeHtml(j.url)}" target="_blank" class="btn" style="text-decoration:none;">↗ View Posting</a>
                <button type="button" class="btn btn-primary btn-web-auto-apply" data-jobify-web-apply-btn="true" data-job-id="${escapeHtml(j.id)}" data-job-url="${escapeHtml(j.url)}">
                  ⚡ 1-Click Tailor &amp; Auto-Apply
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("");

      container.querySelectorAll(".job-select-cb").forEach((cb) => {
        cb.addEventListener("change", (e) => {
          const id = e.currentTarget.getAttribute("data-id");
          if (e.currentTarget.checked) selectedJobIds.add(id);
          else selectedJobIds.delete(id);
          document.getElementById("selected-count").textContent = String(selectedJobIds.size);
        });
      });

      container.querySelectorAll(".btn-web-auto-apply").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          const jobId = e.currentTarget.getAttribute("data-job-id");
          const job = allJobs.find((x) => x.id === jobId);
          if (!job) return;
          await triggerWebAutoApply(job, e.currentTarget);
        });
      });
    }

    async function triggerWebAutoApply(job, btnEl) {
      const origText = btnEl ? btnEl.innerHTML : "";
      if (btnEl) {
        btnEl.disabled = true;
        btnEl.innerHTML = "⏳ Launching Auto-Apply...";
      }
      renderLiveProgress({
        stepLabel: `🚀 Launching Tailor & Auto-Apply for ${job.company}`,
        detail: `Opening ${job.url} and engaging Universal Login/SSO + Form Autofill...`
      });

      const res = await sendExtensionRpc(
        "JOBIFY_WEB_AUTO_APPLY",
        {
          url: job.url,
          active: true,
          awaitCompletion: false,
          options: {
            autoSubmit: true,
            tailorResume: true,
            jobMeta: {
              title: job.title,
              company: job.company,
              location: job.location,
              ats: job.ats,
              url: job.url,
              description: job.description
            }
          }
        },
        15000
      );

      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = res?.ok ? "✅ Auto-Apply Running" : origText;
      }
    }

    document.getElementById("btn-launch-custom-url").addEventListener("click", async () => {
      const url = document.getElementById("custom-job-url").value.trim();
      if (!url) return;
      await triggerWebAutoApply(
        {
          id: "custom_" + Date.now(),
          title: "Target Role",
          company: "Target Company",
          location: "",
          ats: "Career Portal",
          url,
          description: ""
        },
        document.getElementById("btn-launch-custom-url")
      );
    });

    document.getElementById("btn-batch-apply").addEventListener("click", async () => {
      const chosen = allJobs.filter((j) => selectedJobIds.has(j.id));
      if (chosen.length === 0) return;
      renderLiveProgress({
        stepLabel: `🚀 Enqueued ${chosen.length} Job(s) in Autopilot Batch`,
        detail: "Running sequential Tailor + SSO Bypass + Auto-Apply across selected jobs..."
      });
      await sendExtensionRpc("JOBIFY_WEB_ENQUEUE_BATCH", { jobs: chosen, startNow: true }, 10000);
    });

    document.getElementById("btn-stop-web-apply").addEventListener("click", async () => {
      await sendExtensionRpc("JOBIFY_WEB_STOP_AUTO_APPLY", {}, 5000);
      document.getElementById("web-live-hud").classList.remove("active");
    });

    document.getElementById("btn-refresh-jobs").addEventListener("click", () => loadJobs(true));
    document.getElementById("btn-open-ext-hub").addEventListener("click", () => {
      sendExtensionRpc("JOBIFY_WEB_OPEN_HUB", { tab: "autopilot" }, 5000);
    });
    document.getElementById("filter-search").addEventListener("input", renderJobs);
    document.getElementById("filter-archetype").addEventListener("change", renderJobs);
    document.getElementById("filter-ats").addEventListener("change", renderJobs);

    (async () => {
      await loadJobs(false);
      if (document.documentElement.getAttribute("data-jobify-extension-connected") === "true") {
        markExtensionConnected();
      }
      const ping = await sendExtensionRpc("JOBIFY_WEB_PING", {}, 2500);
      if (ping?.ok) {
        markExtensionConnected();
        await syncExtensionState();
      }
    })();
  </script>
</body>
</html>
"""


class JobifyHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def _send_json(self, code: int, payload: dict):
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self._send_cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _send_html(self, html: str):
        raw = html.encode("utf-8")
        self.send_response(200)
        self._send_cors()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        path = self.path.split("?")[0]
        query = self.path.split("?")[1] if "?" in self.path else ""
        if path in ("/", "/app"):
            return self._send_html(JOBIFY_WEBAPP_HTML)
        if path in ("/health", "/api/health"):
            return self._send_json(200, {"status": "ok", "pdflatex": bool(shutil.which("pdflatex"))})
        if path == "/api/jobs":
            force = "refresh=1" in query
            jobs = aggregate_live_jobs(force_refresh=force)
            return self._send_json(200, {"ok": True, "count": len(jobs), "jobs": jobs})
        if path == "/sandbox/microsoft-sso":
            return self._send_html(MICROSOFT_SSO_SANDBOX_HTML)
        if path == "/sandbox/google-oauth-popup":
            return self._send_html(GOOGLE_OAUTH_POPUP_HTML)
        if path == "/sandbox/greenhouse":
            return self._send_html(GREENHOUSE_HTML)
        if path == "/sandbox/workday":
            return self._send_html(WORKDAY_HTML)
        if path == "/sandbox/workday-full-e2e":
            SANDBOX_OTP_STORE["otp"] = None
            SANDBOX_OTP_STORE["verificationUrl"] = None
            SANDBOX_OTP_STORE["accountVerified"] = False
            return self._send_html(WORKDAY_FULL_E2E_HTML)
        if path == "/sandbox/verify-account":
            SANDBOX_OTP_STORE["accountVerified"] = True
            return self._send_html(
                "<!DOCTYPE html><html><body><h2>Candidate Account Email Verified!</h2><p>You may return to Workday and sign in.</p></body></html>"
            )
        if path == "/sandbox/lever":
            return self._send_html(LEVER_HTML)
        if path == "/sandbox/auto-apply":
            SANDBOX_OTP_STORE["otp"] = None
            SANDBOX_OTP_STORE["verificationUrl"] = None
            SANDBOX_OTP_STORE["accountVerified"] = False
            return self._send_html(AUTO_APPLY_SANDBOX_HTML)
        if path == "/sandbox/tricky-submit":
            return self._send_html(TRICKY_SUBMIT_SANDBOX_HTML)
        if path == "/sandbox/ai-error-heal":
            return self._send_html(AI_ERROR_HEAL_SANDBOX_HTML)
        if path == "/api/sandbox-otp":
            return self._send_json(200, {"ok": True, **SANDBOX_OTP_STORE})
        return self._send_json(
            200,
            {
                "service": "Jobify Companion Server",
                "webapp": f"http://127.0.0.1:{PORT}/",
                "sandboxes": [
                    f"http://127.0.0.1:{PORT}/sandbox/microsoft-sso",
                    f"http://127.0.0.1:{PORT}/sandbox/greenhouse",
                    f"http://127.0.0.1:{PORT}/sandbox/workday",
                    f"http://127.0.0.1:{PORT}/sandbox/workday-full-e2e",
                    f"http://127.0.0.1:{PORT}/sandbox/lever",
                    f"http://127.0.0.1:{PORT}/sandbox/auto-apply",
                    f"http://127.0.0.1:{PORT}/sandbox/tricky-submit",
                    f"http://127.0.0.1:{PORT}/sandbox/ai-error-heal",
                ],
            },
        )

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")

        if self.path == "/api/compile-pdf":
            try:
                doc_type = body.get("type", "resume")
                if doc_type == "cover_letter":
                    tex = build_cover_letter_latex(
                        body.get("coverLetterText", ""),
                        body.get("meta", {}),
                        body.get("profile", {}),
                    )
                else:
                    tex = build_resume_latex(body.get("tailored", {}), body.get("profile", {}))
                pdf_b64 = compile_latex_to_base64(tex)
                return self._send_json(200, {"ok": True, "pdfBase64": pdf_b64, "engine": "pdflatex"})
            except Exception as exc:
                return self._send_json(500, {"ok": False, "error": str(exc)})

        if self.path == "/api/sandbox-otp":
            if "otp" in body:
                SANDBOX_OTP_STORE["otp"] = body.get("otp")
            if "verificationUrl" in body:
                SANDBOX_OTP_STORE["verificationUrl"] = body.get("verificationUrl")
            if "accountVerified" in body:
                SANDBOX_OTP_STORE["accountVerified"] = bool(body.get("accountVerified"))
            SANDBOX_OTP_STORE["subject"] = body.get("subject", "Sandbox OTP")
            SANDBOX_OTP_STORE["from"] = body.get("from", "no-reply@sandbox.local")
            SANDBOX_OTP_STORE["timestampMs"] = int(time.time() * 1000)
            return self._send_json(200, {"ok": True, **SANDBOX_OTP_STORE})

        if self.path == "/api/imap-otp":
            try:
                res = fetch_latest_imap_otp(
                    body.get("email", ""),
                    body.get("appPassword", ""),
                    body.get("senderFilter", ""),
                    int(body.get("sinceEpochMs") or 0),
                )
                return self._send_json(200, {"ok": True, **res})
            except Exception as exc:
                return self._send_json(400, {"ok": False, "error": str(exc)})

        if self.path == "/api/gemini-generate":
            api_key = (body.get("apiKey") or "").strip()
            raw_models = body.get("models") or [
                "gemini-3.5-flash",
                "gemini-3-flash-preview",
                "gemini-3.5-flash-lite",
                "gemini-flash-lite-latest",
            ]
            now_s = time.time()
            healthy_models = [m for m in raw_models if GEMINI_MODEL_COOLDOWN.get(m, 0) <= now_s]
            models = healthy_models or raw_models
            base_req_body = body.get("requestBody") or {}
            trace = []
            for mdl in models:
                mdl_body = json.loads(json.dumps(base_req_body))
                gen_cfg = mdl_body.setdefault("generationConfig", {})
                if re.match(r"^gemini-3(\.\d+)?-flash(-preview)?$", mdl, re.I) and not re.search(
                    r"lite|pro|image|tts", mdl, re.I
                ):
                    gen_cfg["thinkingConfig"] = {"thinkingBudget": 0}
                else:
                    gen_cfg.pop("thinkingConfig", None)

                url = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(mdl)}:generateContent?key={urllib.parse.quote(api_key)}"
                req = urllib.request.Request(
                    url,
                    data=json.dumps(mdl_body).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                try:
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        data = json.loads(resp.read().decode("utf-8"))
                        parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                        txt = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                        if txt:
                            return self._send_json(200, {"ok": True, "text": txt, "modelUsed": mdl})
                        GEMINI_MODEL_COOLDOWN[mdl] = time.time() + 45
                        trace.append(f"{mdl}: empty")
                except urllib.error.HTTPError as he:
                    err_raw = he.read().decode("utf-8", errors="ignore")[:140]
                    trace.append(f"{mdl}: HTTP {he.code} {err_raw}")
                    if he.code in (404, 429, 503):
                        GEMINI_MODEL_COOLDOWN[mdl] = time.time() + (300 if he.code == 404 else 60)
                        continue
                    break
                except Exception as exc:
                    GEMINI_MODEL_COOLDOWN[mdl] = time.time() + 60
                    trace.append(f"{mdl}: {exc}")
            return self._send_json(502, {"ok": False, "error": " | ".join(trace)})

        return self._send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chmod(__file__, 0o755)
    print(f"⚡ Jobify Companion Server listening on http://127.0.0.1:{PORT}")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), JobifyHandler)
    server.serve_forever()
