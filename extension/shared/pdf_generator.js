// Dual-Engine ATS PDF Generator:
// 1. Uses local Companion Server (pdflatex) at http://127.0.0.1:18765/api/compile-pdf when running for publication-grade LaTeX output.
// 2. Falls back automatically to a built-in pure-JS PDF 1.4 writer (Helvetica + Helvetica-Bold, selectable text, single-column ATS layout).

function sanitizePdfText(str) {
  return String(str || "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/\u2192/g, "->")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function estimateTextWidth(text, fontSize, isBold = false) {
  const avgFactor = isBold ? 0.53 : 0.49;
  return String(text || "").length * fontSize * avgFactor;
}

function wrapTextLines(text, maxWidthPts, fontSize, isBold = false) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const lines = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (estimateTextWidth(candidate, fontSize, isBold) <= maxWidthPts) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function formatCompanyResumeFileName(companyName, fallbackSuffix = "Resume") {
  const raw = String(companyName || "").trim();
  const isGeneric =
    !raw ||
    /^(target(\s+company)?|company|unknown|job\s*portal|career\s*portal|careers?|active\s+browser\s+tab|application)$/i.test(
      raw
    );
  const cleanComp = isGeneric
    ? ""
    : raw
        .replace(/&/g, "and")
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 32);
  return `Raviteja_velanati_${cleanComp || fallbackSuffix}.pdf`;
}

export function buildPureJsResumePdfBase64(tailored, profile) {
  const p = profile.personal || {};
  const PAGE_W = 612; // 8.5 in
  const PAGE_H = 792; // 11 in
  const MARGIN_X = 34;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;

  const pages = [[]];
  let y = PAGE_H - 30;

  const currentOps = () => pages[pages.length - 1];
  const ensureSpace = (needed) => {
    if (y - needed < 26) {
      pages.push([]);
      y = PAGE_H - 32;
    }
  };

  const drawText = (txt, x, yPos, size = 8.4, bold = false) => {
    const fontRef = bold ? "/F2" : "/F1";
    currentOps().push(`BT ${fontRef} ${size.toFixed(1)} Tf 1 0 0 1 ${x.toFixed(1)} ${yPos.toFixed(1)} Tm (${sanitizePdfText(txt)}) Tj ET`);
  };

  const drawRightText = (txt, yPos, size = 8.2, bold = false) => {
    const w = estimateTextWidth(txt, size, bold);
    drawText(txt, Math.max(MARGIN_X + 200, PAGE_W - MARGIN_X - w), yPos, size, bold);
  };

  const drawSectionHeader = (title) => {
    ensureSpace(20);
    y -= 4.5;
    drawText(title.toUpperCase(), MARGIN_X, y, 9.2, true);
    y -= 2.8;
    currentOps().push(`0.2 0.25 0.35 RG 0.6 w ${MARGIN_X} ${y.toFixed(1)} m ${PAGE_W - MARGIN_X} ${y.toFixed(1)} l S`);
    y -= 9.5;
  };

  // Header Name + Exact Target Job Title + Contact
  const fullName = p.fullName || "Raviteja Velanati";
  const nameW = estimateTextWidth(fullName, 15.5, true);
  drawText(fullName, (PAGE_W - nameW) / 2, y, 15.5, true);
  y -= 11.5;

  const targetJobTitle = String(tailored?.targetJobTitle || "").trim();
  if (targetJobTitle) {
    const roleW = estimateTextWidth(targetJobTitle, 9.8, true);
    drawText(targetJobTitle, Math.max(MARGIN_X, (PAGE_W - roleW) / 2), y, 9.8, true);
    y -= 10.5;
  }

  const contactLine = [
    `${p.city || "Newark"}, ${p.stateCode || "CA"}`,
    p.email || "ravitejavelanati11@gmail.com",
    p.phone || "(774) 810-8481",
    (p.linkedin || "linkedin.com/in/raviteja-velanati").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""),
    (p.github || "github.com/ravitejav-dev").replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
  ].join("  |  ");
  const contactW = estimateTextWidth(contactLine, 8.2, false);
  drawText(contactLine, Math.max(MARGIN_X, (PAGE_W - contactW) / 2), y, 8.2, false);
  y -= 7;

  // Summary
  drawSectionHeader("Summary");
  const summaryText = tailored?.summary || profile.summaryShort || profile.summary || "";
  for (const line of wrapTextLines(summaryText, CONTENT_W, 8.3, false)) {
    ensureSpace(10);
    drawText(line, MARGIN_X, y, 8.3, false);
    y -= 9.5;
  }

  // Skills
  drawSectionHeader("Skills");
  const skillCats = tailored?.skillsCategories || profile.skillsCategories || {};
  for (const [cat, items] of Object.entries(skillCats)) {
    const lineStr = `${cat}: ${Array.isArray(items) ? items.join(", ") : items}`;
    const wrapped = wrapTextLines(lineStr, CONTENT_W, 8.2, false);
    for (let i = 0; i < wrapped.length; i++) {
      ensureSpace(10);
      drawText(wrapped[i], MARGIN_X, y, 8.2, false);
      y -= 9.3;
    }
  }

  // Experience
  drawSectionHeader("Experience");
  const expList = tailored?.experience || (profile.workExperience || []).map((w) => ({
    company: w.company,
    title: w.title,
    location: w.location,
    period: `${w.startDateDisplay} - ${w.endDateDisplay}`,
    bullets: w.highlights || []
  }));

  for (const exp of expList) {
    ensureSpace(22);
    drawText(`${exp.company} - ${exp.title}`, MARGIN_X, y, 8.7, true);
    drawRightText(`${exp.location ? exp.location + " | " : ""}${exp.period || ""}`, y, 8.1, false);
    y -= 10.0;

    for (const bullet of exp.bullets || []) {
      const wrapped = wrapTextLines(bullet, CONTENT_W - 12, 8.2, false);
      for (let i = 0; i < wrapped.length; i++) {
        ensureSpace(9.5);
        if (i === 0) drawText("-", MARGIN_X + 2, y, 8.2, true);
        drawText(wrapped[i], MARGIN_X + 10, y, 8.2, false);
        y -= 9.2;
      }
    }
    y -= 2;
  }

  // Projects
  const projList = (tailored?.projects || profile.projects || []).slice(0, 2);
  if (projList.length > 0) {
    drawSectionHeader("Projects");
    for (const proj of projList) {
      ensureSpace(18);
      drawText(`${proj.name}${proj.stack ? ` (${proj.stack})` : ""}`, MARGIN_X, y, 8.5, true);
      y -= 9.6;
      for (const b of proj.bullets || []) {
        const wrapped = wrapTextLines(b, CONTENT_W - 12, 8.1, false);
        for (let i = 0; i < wrapped.length; i++) {
          ensureSpace(9.5);
          if (i === 0) drawText("-", MARGIN_X + 2, y, 8.1, true);
          drawText(wrapped[i], MARGIN_X + 10, y, 8.1, false);
          y -= 9.1;
        }
      }
      y -= 1.8;
    }
  }

  // Education
  drawSectionHeader("Education");
  for (const edu of profile.education || []) {
    ensureSpace(12);
    drawText(
      `${edu.school} - ${edu.degreeShort || edu.degree}, ${edu.fieldOfStudy} (GPA ${edu.gpa}/${edu.gpaScale})`,
      MARGIN_X,
      y,
      8.3,
      true
    );
    drawRightText(`${edu.startYear} - ${edu.endYear}`, y, 8.1, false);
    y -= 9.8;
  }

  return assemblePdfFromPages(pages, PAGE_W, PAGE_H);
}

export function buildPureJsCoverLetterPdfBase64(coverLetterText, meta, profile) {
  const p = profile.personal || {};
  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN_X = 54;
  const CONTENT_W = PAGE_W - MARGIN_X * 2;
  const pages = [[]];
  let y = PAGE_H - 54;

  const currentOps = () => pages[pages.length - 1];
  const ensureSpace = (needed) => {
    if (y - needed < 48) {
      pages.push([]);
      y = PAGE_H - 54;
    }
  };
  const drawText = (txt, x, yPos, size = 10.5, bold = false) => {
    const fontRef = bold ? "/F2" : "/F1";
    currentOps().push(`BT ${fontRef} ${size.toFixed(1)} Tf 1 0 0 1 ${x.toFixed(1)} ${yPos.toFixed(1)} Tm (${sanitizePdfText(txt)}) Tj ET`);
  };

  drawText(p.fullName || "Raviteja Velanati", MARGIN_X, y, 15, true);
  y -= 14;
  drawText(
    `${p.city || "Newark"}, ${p.stateCode || "CA"} | ${p.email || "ravitejavelanati11@gmail.com"} | ${p.phone || "(774) 810-8481"}`,
    MARGIN_X,
    y,
    9.5,
    false
  );
  y -= 8;
  currentOps().push(`0.2 0.25 0.35 RG 0.7 w ${MARGIN_X} ${y.toFixed(1)} m ${PAGE_W - MARGIN_X} ${y.toFixed(1)} l S`);
  y -= 22;

  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  drawText(dateStr, MARGIN_X, y, 10, false);
  y -= 18;
  if (meta?.company) {
    drawText(`Hiring Team — ${meta.company}`, MARGIN_X, y, 10.5, true);
    y -= 14;
  }
  if (meta?.role) {
    drawText(`Re: ${meta.role}`, MARGIN_X, y, 10, false);
    y -= 20;
  }

  const paragraphs = String(coverLetterText || "").split(/\n\s*\n/);
  for (const para of paragraphs) {
    const lines = wrapTextLines(para, CONTENT_W, 10.2, false);
    for (const line of lines) {
      ensureSpace(15);
      drawText(line, MARGIN_X, y, 10.2, false);
      y -= 14;
    }
    y -= 8;
  }

  return assemblePdfFromPages(pages, PAGE_W, PAGE_H);
}

function assemblePdfFromPages(pages, pageW, pageH) {
  // Object IDs:
  // 1: Catalog
  // 2: Pages
  // 3: Font Helvetica (/F1)
  // 4: Font Helvetica-Bold (/F2)
  // For each page i: pageObjId = 5 + i*2, contentObjId = 6 + i*2
  const objects = [];
  const pageIds = pages.map((_, idx) => 5 + idx * 2);

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

  pages.forEach((ops, idx) => {
    const pageObjId = 5 + idx * 2;
    const contentObjId = 6 + idx * 2;
    const streamStr = ops.join("\n");
    objects[pageObjId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjId} 0 R >>`;
    objects[contentObjId] = `<< /Length ${streamStr.length} >>\nstream\n${streamStr}\nendstream`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 ${objects.length}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  // Encode ASCII string to base64 safely in both Worker and Window contexts
  return btoa(pdf);
}

export async function generateTailoredResumePdf(tailored, profile, settings) {
  const companionUrl = settings?.companionServerUrl || "http://127.0.0.1:18765";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const resp = await fetch(`${companionUrl}/api/compile-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "resume", tailored, profile }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.pdfBase64) {
        return { pdfBase64: data.pdfBase64, engine: "pdflatex" };
      }
    }
  } catch (_) {
    // Companion server offline — use pure-JS native PDF generator seamlessly
  }
  return {
    pdfBase64: buildPureJsResumePdfBase64(tailored, profile),
    engine: "jobify-native-pdf"
  };
}

export async function generateCoverLetterPdf(coverLetterText, meta, profile, settings) {
  const companionUrl = settings?.companionServerUrl || "http://127.0.0.1:18765";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const resp = await fetch(`${companionUrl}/api/compile-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "cover_letter", coverLetterText, meta, profile }),
      signal: ctrl.signal
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data?.pdfBase64) {
        return { pdfBase64: data.pdfBase64, engine: "pdflatex" };
      }
    }
  } catch (_) {
    // Fallback to pure-JS PDF generator
  }
  return {
    pdfBase64: buildPureJsCoverLetterPdfBase64(coverLetterText, meta, profile),
    engine: "jobify-native-pdf"
  };
}
