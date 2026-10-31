#!/usr/bin/env python3
"""Jobify Companion Local Server (Port 8765)
Provides:
1. /api/compile-pdf  -> Publication-grade single-column ATS LaTeX -> PDF via /usr/bin/pdflatex
2. /api/imap-otp     -> Gmail App Password IMAP verification code / magic link reader
3. /sandbox/greenhouse, /sandbox/workday, /sandbox/lever -> Realistic ATS test portals
"""

import base64
import email
import imaplib
import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("JOBIFY_PORT", "18765"))


def tex_escape(text: str) -> str:
    if not text:
        return ""
    s = str(text)
    s = s.replace("\u2013", "--").replace("\u2014", "---").replace("\u2192", "$\\rightarrow$")
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
        "~": r"\textasciitilde{}",
        "^": r"\textasciicircum{}",
    }
    out = []
    for ch in s:
        if ch in replacements:
            out.append(replacements[ch])
        elif ord(ch) < 128:
            out.append(ch)
        else:
            out.append(" ")
    return "".join(out).replace(r"\textbackslash{}rightarrow\$", r"$\rightarrow$")


def build_resume_latex(tailored: dict, profile: dict) -> str:
    p = profile.get("personal", {})
    name = tex_escape(p.get("fullName", "Raviteja Velanati"))
    city_state = tex_escape(f"{p.get('city', 'Newark')}, {p.get('stateCode', 'CA')}")
    mail = tex_escape(p.get("email", "ravitejavelanati11@gmail.com"))
    phone = tex_escape(p.get("phone", "(774) 810-8481"))
    li = tex_escape(re.sub(r"^https?://(www\.)?", "", p.get("linkedin", "linkedin.com/in/ravitejavelanati")))
    summary = tex_escape(tailored.get("summary") or profile.get("summaryShort") or profile.get("summary", ""))

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
        bullets = "\n".join([rf"  \item {tex_escape(b)}" for b in (exp.get("bullets") or [])])
        exp_blocks.append(
            rf"\noindent\textbf{{{comp}}} \hfill {loc}\\"
            "\n"
            rf"\textit{{{title}}} \hfill {period}\par"
            "\n"
            r"\begin{itemize}"
            "\n"
            f"{bullets}\n"
            r"\end{itemize}"
        )
    exp_tex = "\n\\vspace{3pt}\n".join(exp_blocks)

    proj_list = tailored.get("projects") or profile.get("projects") or []
    proj_items = []
    for pr in proj_list[:2]:
        pname = tex_escape(pr.get("name", ""))
        pstack = tex_escape(pr.get("stack", ""))
        pbul = " ".join([tex_escape(b) for b in (pr.get("bullets") or [])])
        proj_items.append(rf"  \item \textbf{{{pname}}} ({pstack}): {pbul}")
    proj_tex = "\n".join(proj_items)

    edu_lines = []
    for ed in profile.get("education", []):
        sch = tex_escape(ed.get("school", ""))
        deg = tex_escape(ed.get("degreeShort") or ed.get("degree", ""))
        fos = tex_escape(ed.get("fieldOfStudy", "CS"))
        gpa = tex_escape(f"{ed.get('gpa', '')}/{ed.get('gpaScale', '4.0')}")
        yrs = tex_escape(f"{ed.get('startYear', '')} -- {ed.get('endYear', '')}")
        edu_lines.append(rf"\noindent\textbf{{{sch}}} -- {deg}, {fos} (GPA {gpa}) \hfill {yrs}\par")
    edu_tex = "\n".join(edu_lines)

    certs = " $\\bullet$ ".join([tex_escape(c) for c in (profile.get("certifications") or [])[:5]])

    return rf"""\documentclass[10pt,letterpaper]{{article}}
\usepackage[left=0.45in,right=0.45in,top=0.4in,bottom=0.4in]{{geometry}}
\usepackage{{enumitem}}
\usepackage[hidelinks]{{hyperref}}
\pagestyle{{empty}}
\setlength{{\parindent}}{{0pt}}
\setlist[itemize]{{leftmargin=1.2em,itemsep=1.5pt,topsep=2pt,parsep=0pt}}
\newcommand{{\secHdr}}[1]{{\vspace{{5pt}}\textbf{{\normalsize \uppercase{{#1}}}}\vspace{{1.5pt}}\hrule\vspace{{4pt}}}}

\begin{{document}}
\begin{{center}}
  {{\LARGE \textbf{{{name}}}}} \\[2pt]
  \small {city_state} $|$ {mail} $|$ {phone} $|$ {li}
\end{{center}}
\vspace{{-4pt}}

\secHdr{{Professional Summary}}
\small {summary}\par

\secHdr{{Technical Skills}}
\small
{skills_tex}\par

\secHdr{{Professional Experience}}
\small
{exp_tex}

\secHdr{{Selected Projects}}
\small
\begin{{itemize}}
{proj_tex}
\end{{itemize}}

\secHdr{{Education}}
\small
{edu_tex}

\secHdr{{Certifications}}
\small {certs}\par
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


def fetch_latest_imap_otp(email_addr: str, app_password: str, sender_filter: str = "") -> dict:
    clean_pw = (app_password or "").replace(" ", "")
    mail = imaplib.IMAP4_SSL("imap.gmail.com", timeout=12)
    mail.login(email_addr, clean_pw)
    mail.select("INBOX", readonly=True)
    _, data = mail.search(None, "ALL")
    ids = data[0].split()[-15:]
    ids.reverse()
    for mid in ids:
        _, msg_data = mail.fetch(mid, "(RFC822)")
        msg = email.message_from_bytes(msg_data[0][1])
        frm = msg.get("From", "")
        subj = msg.get("Subject", "")
        if sender_filter and sender_filter.lower() not in (frm + " " + subj).lower():
            continue
        body_text = ""
        if msg.is_multipart():
            for part in msg.walk():
                if part.get_content_type() == "text/plain":
                    body_text += part.get_payload(decode=True).decode("utf-8", errors="ignore")
        else:
            body_text = msg.get_payload(decode=True).decode("utf-8", errors="ignore")
        otp_match = re.search(r"\b(\d{6})\b", subj + " " + body_text)
        if otp_match:
            mail.logout()
            return {"otp": otp_match.group(1), "subject": subj, "from": frm}
    mail.logout()
    return {"otp": None, "message": "Connected to Gmail INBOX; no 6-digit code in last 15 emails."}


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
        if path == "/health":
            return self._send_json(200, {"status": "ok", "pdflatex": bool(shutil.which("pdflatex"))})
        if path == "/sandbox/greenhouse":
            return self._send_html(GREENHOUSE_HTML)
        if path == "/sandbox/workday":
            return self._send_html(WORKDAY_HTML)
        if path == "/sandbox/lever":
            return self._send_html(LEVER_HTML)
        return self._send_json(
            200,
            {
                "service": "Jobify Companion Server",
                "sandboxes": [
                    f"http://127.0.0.1:{PORT}/sandbox/greenhouse",
                    f"http://127.0.0.1:{PORT}/sandbox/workday",
                    f"http://127.0.0.1:{PORT}/sandbox/lever",
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

        if self.path == "/api/imap-otp":
            try:
                res = fetch_latest_imap_otp(
                    body.get("email", ""),
                    body.get("appPassword", ""),
                    body.get("senderFilter", ""),
                )
                return self._send_json(200, {"ok": True, **res})
            except Exception as exc:
                return self._send_json(400, {"ok": False, "error": str(exc)})

        return self._send_json(404, {"ok": False, "error": "Unknown endpoint"})

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    os.chmod(__file__, 0o755)
    print(f"⚡ Jobify Companion Server listening on http://127.0.0.1:{PORT}")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), JobifyHandler)
    server.serve_forever()
