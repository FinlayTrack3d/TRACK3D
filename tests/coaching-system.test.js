import test from "node:test";
import assert from "node:assert/strict";
import { BLAME_WORDING, buildCoachSystem, normaliseExperience, TONES } from "../lib/coaching/system.js";
import { CHAT_AREAS } from "../lib/coaching/chat-areas.js";

test("every coach area gets the shared safety rules and guidelines", () => {
  for (const [name, area] of Object.entries(CHAT_AREAS)) {
    const system = buildCoachSystem({ areaInstructions: area.instructions, kind: area.kind });
    assert.match(system, /Never diagnose/, name);
    assert.match(system, /Red flags/, name);
    assert.match(system, /COACHING GUIDELINES/, name);
    assert.match(system, /Quote the user's own targets/, name);
  }
});

test("the three tones are different, tone comes last, and the decision rule is shared", () => {
  const systems = Object.keys(TONES).map((personality) => buildCoachSystem({ areaInstructions: "Dashboard coach.", personality }));
  assert.equal(new Set(systems).size, 3);
  for (const system of systems) {
    assert.match(system, /TONE: [A-Z ]+\.[\s\S]*Example[\s\S]*Tone changes the wording only\. The decision, the numbers and any safety advice must be exactly the same whichever tone is selected\.$/);
    assert.ok(system.lastIndexOf("TONE:") > system.lastIndexOf("EXPERIENCE"), "tone after experience");
    assert.ok(system.lastIndexOf("TONE:") > system.lastIndexOf("APP DATA") || !system.includes("APP DATA"));
  }
  assert.match(TONES.supportive.spec, /Never blame/);
  assert.doesNotMatch(TONES.supportive.spec.split("Example")[1], BLAME_WORDING, "the BACK ME example has no blame wording");
  assert.match("or you've just confirmed that quitting is your new pattern.", BLAME_WORDING, "the review's shaming reply is caught");
});

test("structured builders get no tone; conversations get experience and tone", () => {
  const structured = buildCoachSystem({ areaInstructions: "Build JSON.", kind: "structured", personality: "strict", experienceLevel: "advanced" });
  assert.doesNotMatch(structured, /TONE:|EXPERIENCE:/);
  const advanced = buildCoachSystem({ areaInstructions: "x", experienceLevel: "advanced" });
  assert.match(advanced, /EXPERIENCE: ADVANCED[\s\S]*answer every part of the question/);
  const beginner = buildCoachSystem({ areaInstructions: "x", experienceLevel: "beginner" });
  assert.match(beginner, /Explain any training term the first time/);
});

test("active pain goes first, before everything else", () => {
  const system = buildCoachSystem({ areaInstructions: "x", activePain: [{ report: "shoulder pain", body_area: "shoulder" }] });
  assert.match(system, /^ACTIVE PAIN/);
});

test("experience answers map to a level", () => {
  assert.equal(normaliseExperience("New to training"), "beginner");
  assert.equal(normaliseExperience("Training for a few months"), "beginner");
  assert.equal(normaliseExperience("1–3 years of training"), "intermediate");
  assert.equal(normaliseExperience("3+ years of training"), "advanced");
  assert.equal(normaliseExperience("advanced"), "advanced");
  assert.equal(normaliseExperience("not sure"), null);
});
