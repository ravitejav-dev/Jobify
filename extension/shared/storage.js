// Unified Chrome Storage Manager for Jobify Copilot
import {
  PROFILE_SCHEMA_VERSION,
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  DEFAULT_CREDENTIALS_VAULT,
  DEFAULT_SAVED_ANSWERS
} from "./default_profile.js";

export const STORAGE_KEYS = {
  PROFILE: "jobify_profile",
  SETTINGS: "jobify_settings",
  CREDENTIALS: "jobify_credentials_vault",
  SAVED_ANSWERS: "jobify_saved_answers",
  APPLICATIONS: "jobify_applications",
  TAILORED_RESUMES: "jobify_tailored_resumes",
  COVER_LETTERS: "jobify_cover_letters",
  AUTOPILOT_QUEUE: "jobify_autopilot_queue",
  AUTOPILOT_LOGS: "jobify_autopilot_logs",
  AUTO_APPLY_SESSION: "jobify_auto_apply_session"
};
const KEYS = STORAGE_KEYS;

let cachedLocalSecrets = null;
async function loadOptionalLocalSecrets() {
  if (cachedLocalSecrets !== null) return cachedLocalSecrets;
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
      const res = await fetch(chrome.runtime.getURL("shared/local_secrets.json"));
      if (res.ok) {
        cachedLocalSecrets = (await res.json()) || {};
        return cachedLocalSecrets;
      }
    }
  } catch (_) {}
  cachedLocalSecrets = {};
  return cachedLocalSecrets;
}

export async function ensureInitialized() {
  const secrets = await loadOptionalLocalSecrets();
  const existing = await chrome.storage.local.get(Object.values(KEYS));
  const patch = {};

  const seededSettings = {
    ...DEFAULT_SETTINGS,
    ...(secrets.geminiApiKey ? { geminiApiKey: secrets.geminiApiKey } : {})
  };
  const seededCreds = {
    ...DEFAULT_CREDENTIALS_VAULT,
    ...(secrets.portalEmail ? { portalEmail: secrets.portalEmail } : {}),
    ...(secrets.portalPassword ? { portalPassword: secrets.portalPassword } : {}),
    ...(secrets.gmailAppPassword ? { gmailAppPassword: secrets.gmailAppPassword } : {})
  };

  if (!existing[KEYS.PROFILE]) {
    patch[KEYS.PROFILE] = DEFAULT_PROFILE;
  } else if ((existing[KEYS.PROFILE].profileSchemaVersion || 1) < PROFILE_SCHEMA_VERSION) {
    const prev = existing[KEYS.PROFILE];
    const customResumes = (prev.resumes || []).filter((r) => r.customBase64);
    patch[KEYS.PROFILE] = {
      ...DEFAULT_PROFILE,
      ...prev,
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      personal: {
        ...prev.personal,
        ...DEFAULT_PROFILE.personal
      },
      workAuthAndEEO: {
        ...prev.workAuthAndEEO,
        ...DEFAULT_PROFILE.workAuthAndEEO
      },
      preferences: {
        ...prev.preferences,
        ...DEFAULT_PROFILE.preferences
      },
      resumes: [...customResumes, ...DEFAULT_PROFILE.resumes]
    };
  }

  if (!existing[KEYS.SETTINGS]) {
    patch[KEYS.SETTINGS] = seededSettings;
  } else if (!existing[KEYS.SETTINGS].geminiApiKey && secrets.geminiApiKey) {
    patch[KEYS.SETTINGS] = { ...existing[KEYS.SETTINGS], geminiApiKey: secrets.geminiApiKey };
  }

  if (!existing[KEYS.CREDENTIALS]) {
    patch[KEYS.CREDENTIALS] = seededCreds;
  } else if (!existing[KEYS.CREDENTIALS].portalPassword && secrets.portalPassword) {
    patch[KEYS.CREDENTIALS] = {
      ...existing[KEYS.CREDENTIALS],
      portalPassword: secrets.portalPassword,
      ...(secrets.gmailAppPassword ? { gmailAppPassword: secrets.gmailAppPassword } : {})
    };
  }

  if (!existing[KEYS.SAVED_ANSWERS]) {
    patch[KEYS.SAVED_ANSWERS] = DEFAULT_SAVED_ANSWERS;
  } else if ((existing[KEYS.PROFILE]?.profileSchemaVersion || 1) < PROFILE_SCHEMA_VERSION) {
    patch[KEYS.SAVED_ANSWERS] = existing[KEYS.SAVED_ANSWERS].map((sa) =>
      sa.id === "sa_salary" ? DEFAULT_SAVED_ANSWERS.find((d) => d.id === "sa_salary") || sa : sa
    );
  }
  if (!existing[KEYS.APPLICATIONS]) patch[KEYS.APPLICATIONS] = [];
  if (!existing[KEYS.TAILORED_RESUMES]) patch[KEYS.TAILORED_RESUMES] = [];
  if (!existing[KEYS.COVER_LETTERS]) patch[KEYS.COVER_LETTERS] = [];
  if (!existing[KEYS.AUTOPILOT_QUEUE]) patch[KEYS.AUTOPILOT_QUEUE] = [];
  if (!existing[KEYS.AUTOPILOT_LOGS]) patch[KEYS.AUTOPILOT_LOGS] = [];

  if (Object.keys(patch).length > 0) {
    await chrome.storage.local.set(patch);
  }
  return { ...existing, ...patch };
}

export async function getAllState() {
  const raw = await ensureInitialized();
  return {
    profile: raw[KEYS.PROFILE],
    settings: raw[KEYS.SETTINGS],
    credentials: raw[KEYS.CREDENTIALS],
    savedAnswers: raw[KEYS.SAVED_ANSWERS],
    applications: raw[KEYS.APPLICATIONS],
    tailoredResumes: raw[KEYS.TAILORED_RESUMES],
    coverLetters: raw[KEYS.COVER_LETTERS],
    autopilotQueue: raw[KEYS.AUTOPILOT_QUEUE],
    autopilotLogs: raw[KEYS.AUTOPILOT_LOGS]
  };
}

export async function updateProfile(nextProfile) {
  await chrome.storage.local.set({ [KEYS.PROFILE]: nextProfile });
  return nextProfile;
}

export async function updateSettings(partialSettings) {
  const state = await getAllState();
  const merged = { ...state.settings, ...partialSettings };
  await chrome.storage.local.set({ [KEYS.SETTINGS]: merged });
  return merged;
}

export async function updateCredentials(partialCreds) {
  const state = await getAllState();
  const merged = { ...state.credentials, ...partialCreds };
  await chrome.storage.local.set({ [KEYS.CREDENTIALS]: merged });
  return merged;
}

export async function upsertApplication(appEntry) {
  const state = await getAllState();
  const apps = [...state.applications];
  const normalizedUrl = (appEntry.url || "").split("#")[0];
  const idx = apps.findIndex(
    (a) =>
      (appEntry.id && a.id === appEntry.id) ||
      (normalizedUrl && (a.url || "").split("#")[0] === normalizedUrl)
  );

  const now = new Date().toISOString();
  if (idx >= 0) {
    const prev = apps[idx];
    const timeline = [...(prev.timeline || [])];
    if (appEntry.status && appEntry.status !== prev.status) {
      timeline.unshift({ date: now, event: `Status changed: ${prev.status} -> ${appEntry.status}` });
    }
    apps[idx] = {
      ...prev,
      ...appEntry,
      updatedAt: now,
      timeline
    };
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: apps });
    return apps[idx];
  } else {
    const created = {
      id: appEntry.id || `app_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      company: appEntry.company || "Unknown Company",
      role: appEntry.role || "Software / AI Engineer",
      location: appEntry.location || "United States",
      salary: appEntry.salary || "",
      ats: appEntry.ats || "Career Portal",
      url: appEntry.url || "",
      status: appEntry.status || "Bookmarked",
      matchScore: appEntry.matchScore ?? null,
      resumeUsed: appEntry.resumeUsed || "Raviteja_Velanati_Resume_1Page.pdf",
      notes: appEntry.notes || "",
      referrals: appEntry.referrals || [],
      createdAt: now,
      updatedAt: now,
      timeline: [{ date: now, event: `Added as ${appEntry.status || "Bookmarked"}` }]
    };
    apps.unshift(created);
    await chrome.storage.local.set({ [KEYS.APPLICATIONS]: apps });
    return created;
  }
}

export async function deleteApplication(appId) {
  const state = await getAllState();
  const filtered = state.applications.filter((a) => a.id !== appId);
  await chrome.storage.local.set({ [KEYS.APPLICATIONS]: filtered });
  return filtered;
}

export async function upsertSavedAnswer(entry) {
  const state = await getAllState();
  const list = [...state.savedAnswers];
  const idx = list.findIndex(
    (x) =>
      (entry.id && x.id === entry.id) ||
      x.questionLabel.toLowerCase().trim() === (entry.questionLabel || "").toLowerCase().trim()
  );
  const item = {
    id: entry.id || `sa_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    questionPattern:
      entry.questionPattern ||
      (entry.questionLabel || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .slice(0, 5)
        .join("|"),
    questionLabel: entry.questionLabel || "Custom Question",
    answer: entry.answer || "",
    tags: entry.tags || ["custom"],
    updatedAt: new Date().toISOString()
  };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.unshift(item);
  }
  await chrome.storage.local.set({ [KEYS.SAVED_ANSWERS]: list });
  return item;
}

export async function deleteSavedAnswer(id) {
  const state = await getAllState();
  const filtered = state.savedAnswers.filter((x) => x.id !== id);
  await chrome.storage.local.set({ [KEYS.SAVED_ANSWERS]: filtered });
  return filtered;
}

export async function saveTailoredResume(item) {
  const state = await getAllState();
  const list = [...state.tailoredResumes];
  const record = {
    id: item.id || `tr_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...item
  };
  list.unshift(record);
  await chrome.storage.local.set({ [KEYS.TAILORED_RESUMES]: list.slice(0, 30) });
  return record;
}

export async function saveCoverLetter(item) {
  const state = await getAllState();
  const list = [...state.coverLetters];
  const record = {
    id: item.id || `cl_${Date.now()}`,
    createdAt: new Date().toISOString(),
    ...item
  };
  list.unshift(record);
  await chrome.storage.local.set({ [KEYS.COVER_LETTERS]: list.slice(0, 30) });
  return record;
}

export async function updateAutopilotQueue(nextQueue) {
  await chrome.storage.local.set({ [KEYS.AUTOPILOT_QUEUE]: nextQueue });
  return nextQueue;
}

export async function appendAutopilotLog(message, level = "info") {
  const state = await getAllState();
  const logs = [
    { ts: new Date().toISOString(), level, message },
    ...(state.autopilotLogs || [])
  ].slice(0, 150);
  await chrome.storage.local.set({ [KEYS.AUTOPILOT_LOGS]: logs });
  return logs;
}

export { KEYS };
