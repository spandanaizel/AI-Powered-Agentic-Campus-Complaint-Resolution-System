// Deterministic, non-AI fallbacks used when no provider is configured or a provider call fails.
// Every fallback result is labelled source:'fallback' so the UI never presents it as AI output.

export function summaryFallback(complaint) {
  const text = complaint.description.replace(/\s+/g, ' ').trim();
  const excerpt = text.length > 240 ? `${text.slice(0, 237).trimEnd()}…` : text;
  return {
    summary: excerpt,
    keyFacts: [],
    categoryHint: null,
    limitations: 'AI summary unavailable. This is an unedited excerpt of the original complaint, not an AI summary.',
  };
}

const RULES = [
  { priority: 'High', words: ['fire', 'smoke', 'gas leak', 'electric shock', 'sparking', 'exposed wire', 'injur', 'bleeding', 'unconscious', 'assault', 'harass', 'threat', 'flood', 'collapse', 'unsafe'] },
  { priority: 'Medium', words: ['not working', 'broken', 'no water', 'no power', 'power cut', 'outage', 'leak', 'blocked', 'down', 'stopped'] },
];

export function priorityFallback(complaint) {
  const text = `${complaint.title} ${complaint.description}`.toLowerCase();
  for (const rule of RULES) {
    const hits = rule.words.filter((w) => text.includes(w));
    if (hits.length) {
      return { priority: rule.priority, rationale: `Keyword rule (not AI): matched ${hits.map((h) => `"${h}"`).join(', ')}.`, confidence: null };
    }
  }
  return { priority: 'Low', rationale: 'Keyword rule (not AI): no urgency keywords matched.', confidence: null };
}

/** Least-loaded eligible staff; ties broken by name for determinism. */
export function assignmentFallback(candidates) {
  const sorted = [...candidates].sort((a, b) => a.openAssignments - b.openAssignments || a.name.localeCompare(b.name));
  const pick = sorted[0];
  return { staffId: String(pick._id), reason: `Rule-based: least open assignments (${pick.openAssignments}) among ${candidates.length} eligible staff.` };
}

export function responseFallback(complaint) {
  return {
    draft: `Hello,\n\nThank you for reporting "${complaint.title}". Your complaint is currently marked as ${complaint.status}. [Add the specific action taken or next step here.]\n\nWe will post further updates on this complaint as work progresses.\n\nRegards,\n[Your name]`,
    warnings: ['AI drafting unavailable: this is a fixed template, not an AI draft. Fill in the bracketed parts before sending.'],
  };
}

// ---------- Resolution and Response Agent fallbacks ----------

const STEPS_BY_CATEGORY = {
  Network: [
    ['Confirm the scope: one device, one room, or the whole area', 'staff'],
    ['Check the access point or switch for that location: power, status lights, recent alerts', 'staff'],
    ['Restart the affected access point if the network team allows it', 'staff'],
    ['Escalate to the network team if several access points or the uplink are affected', 'specialist'],
  ],
  Hostel: [
    ['Inspect the room or facility and confirm the problem in person', 'staff'],
    ['Check whether nearby rooms have the same problem (shared supply or fault)', 'staff'],
    ['Arrange the repair through maintenance and agree access with the resident', 'staff'],
  ],
  Infrastructure: [
    ['Inspect the item and note its asset tag or location', 'staff'],
    ['Check for a simple cause first (power, cables, settings, missing parts)', 'staff'],
    ['Raise a repair or replacement through facilities if it is damaged', 'specialist'],
  ],
  Security: [
    ['Assess whether anyone is at immediate risk; if so, follow the campus emergency procedure', 'staff'],
    ['Inspect the lock, door or access point and record what you find', 'staff'],
    ['Involve campus security for access-control or safety faults', 'specialist'],
  ],
  Electricity: [
    ['Do not touch exposed wiring; keep people away from the area', 'staff'],
    ['Check whether the fault is local (one socket or room) or wider (breaker, building supply)', 'staff'],
    ['Have a qualified electrician isolate and repair the fault', 'specialist'],
  ],
};
const GENERIC_STEPS = [
  ['Confirm the problem and its exact location with the student if anything is unclear', 'staff'],
  ['Inspect the area or item and record what you find in an internal note', 'staff'],
  ['Arrange the fix with the responsible team and tell the student what will happen next', 'staff'],
];
export const HAZARD_WORDS = ['fire', 'smoke', 'gas', 'spark', 'exposed wire', 'shock', 'flood', 'collapse', 'injur', 'unsafe'];

export const hazardsIn = (complaint) => {
  const text = `${complaint.title} ${complaint.description}`.toLowerCase();
  return HAZARD_WORDS.filter((w) => text.includes(w));
};
export const hazardNote = (hazards) => `The complaint mentions ${hazards.map((h) => `"${h}"`).join(', ')}. Treat it as a possible hazard and involve qualified staff before attempting a fix.`;

export function resolutionFallback(complaint) {
  const category = complaint.category?.name;
  const steps = (STEPS_BY_CATEGORY[category] || GENERIC_STEPS).map(([step, who]) => ({ step, who }));
  const hazards = hazardsIn(complaint);
  return {
    likelyCauses: [],
    troubleshootingSteps: steps,
    possibleResolutions: [],
    safetyNotes: hazards.length ? [hazardNote(hazards)] : [],
    informationNeeded: [],
    limitations: `AI suggestions unavailable. This is a standard checklist for the ${category || 'general'} category, not an analysis of this complaint.`,
  };
}

/**
 * Rule-based evidence review. It checks only that the expected records EXIST; it cannot judge whether
 * they are true or adequate, so it never returns 'likely_sufficient'.
 */
export function evidenceFallback({ resolutionNote, publicStaffReplies, workStarted, studentPhotos }) {
  const checks = [
    { item: 'A resolution note describes what was done', status: resolutionNote && resolutionNote.trim().length >= 20 ? 'present' : 'missing', note: resolutionNote ? null : 'Add a note saying what was fixed, by whom, and how it was checked.' },
    { item: 'The student was told about the outcome', status: publicStaffReplies > 0 ? 'present' : 'missing', note: publicStaffReplies > 0 ? null : 'Send the student a reply before closing.' },
    { item: 'Work was recorded as started (In Progress)', status: workStarted ? 'present' : 'unclear', note: null },
    { item: 'Photo evidence', status: 'unclear', note: studentPhotos ? 'The student attached a photo of the problem; there is no photo of the fix. Photos are not inspected.' : 'No photos are attached. Photos are not inspected in any case.' },
  ];
  return {
    assessment: checks.some((c) => c.status === 'missing') ? 'needs_more_information' : 'cannot_assess',
    checks,
    followUpQuestions: [],
    limitations: 'AI review unavailable. These rule-based checks only confirm that records exist, not that they are accurate.',
  };
}
