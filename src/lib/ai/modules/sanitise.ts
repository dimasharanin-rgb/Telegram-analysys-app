/**
 * Prose hygiene for the optional modules.
 *
 * `sanitiseAnalysis` does this for the base pass. Each module has its own
 * shape, so each needs its own pass - but they all obey the same two rules:
 * no internal identifiers in anything a reader sees, and no finding stated
 * twice.
 *
 * The cross-module pass is the one that matters most. Every module reads the
 * same conversation against the same statistics, so left alone they converge
 * on the same few observations - "longer messages during conflict" turns up
 * as an interaction pattern, an emotional observation and a timeline change,
 * and the report reads as though it has one idea. `withoutEcho` keeps the
 * first section to say something and strips it from the ones that follow.
 */

import {
  DUPLICATE_THRESHOLD,
  dedupeStatements,
  statementSimilarity,
  tidyProse,
} from "@/lib/ai/prose";
import type {
  ConflictFindings,
  EmotionalFindings,
  InteractionFindings,
  ProfileFindings,
  TimelineFindings,
} from "./schemas";

/** A finding's text as one string, for comparing it against another's. */
type Statement = string;

export function tidyInteraction(findings: InteractionFindings): InteractionFindings {
  return {
    ...findings,
    summary: tidyProse(findings.summary),
    patterns: dedupeStatements(
      findings.patterns.map((pattern) => ({
        ...pattern,
        title: tidyProse(pattern.title),
        observation: tidyProse(pattern.observation),
        interpretation: tidyProse(pattern.interpretation),
        uncertainty: tidyProse(pattern.uncertainty),
      })),
      { statement: (pattern) => `${pattern.title} ${pattern.observation}` },
    ),
  };
}

export function tidyEmotional(findings: EmotionalFindings): EmotionalFindings {
  return {
    ...findings,
    summary: tidyProse(findings.summary),
    observations: dedupeStatements(
      findings.observations.map((observation) => ({
        ...observation,
        title: tidyProse(observation.title),
        observation: tidyProse(observation.observation),
        interpretation: tidyProse(observation.interpretation),
      })),
      { statement: (entry) => `${entry.title} ${entry.observation}` },
    ),
  };
}

export function tidyConflicts(findings: ConflictFindings): ConflictFindings {
  return {
    ...findings,
    summary: tidyProse(findings.summary),
    conflicts: dedupeStatements(
      findings.conflicts.map((conflict) => ({
        ...conflict,
        title: tidyProse(conflict.title),
        trigger: tidyProse(conflict.trigger),
        escalation: tidyProse(conflict.escalation),
        repair: tidyProse(conflict.repair),
        recurrence: tidyProse(conflict.recurrence),
        responses: conflict.responses.map((response) => ({
          ...response,
          description: tidyProse(response.description),
        })),
      })),
      // Two write-ups of the same shortlisted exchange are the same finding,
      // whatever they are called.
      { statement: (conflict) => `${conflict.candidateId} ${conflict.title}` },
    ),
  };
}

export function tidyTimeline(findings: TimelineFindings): TimelineFindings {
  return {
    ...findings,
    summary: tidyProse(findings.summary),
    changes: dedupeStatements(
      findings.changes.map((change) => ({
        ...change,
        title: tidyProse(change.title),
        earlier: tidyProse(change.earlier),
        later: tidyProse(change.later),
        interpretation: tidyProse(change.interpretation),
      })),
      { statement: (change) => `${change.title} ${change.earlier} ${change.later}` },
    ),
  };
}

export function tidyProfiles(findings: ProfileFindings): ProfileFindings {
  return {
    ...findings,
    profiles: findings.profiles.map((profile) => ({
      ...profile,
      headline: tidyProse(profile.headline),
      traits: profile.traits.map((trait) => ({
        ...trait,
        label: tidyProse(trait.label),
        basis: tidyProse(trait.basis),
      })),
      strengths: profile.strengths.map(tidyProse),
      watchouts: profile.watchouts.map(tidyProse),
    })),
  };
}

/* -------------------------------------------------------------------------
 * Cross-module repetition
 * ---------------------------------------------------------------------- */

/**
 * Drops entries that restate something an earlier section already said.
 *
 * `claimed` is everything the sections ahead of this one have already put in
 * front of the reader. Anything here that overlaps with it goes, because the
 * reader has read it. The surviving entries are added to `claimed` so the
 * next section is measured against them too.
 */
export function withoutEcho<T>(
  items: T[],
  claimed: Statement[],
  statement: (item: T) => Statement,
): T[] {
  const kept: T[] = [];
  for (const item of items) {
    const text = statement(item);
    const echoes = claimed.some(
      (existing) => statementSimilarity(existing, text) >= DUPLICATE_THRESHOLD,
    );
    if (echoes) continue;
    kept.push(item);
    claimed.push(text);
  }
  return kept;
}

export interface CrossModuleInput {
  basePatternStatements: Statement[];
  interaction: InteractionFindings | null;
  emotional: EmotionalFindings | null;
  timeline: TimelineFindings | null;
}

export interface CrossModuleOutput {
  interaction: InteractionFindings | null;
  emotional: EmotionalFindings | null;
  timeline: TimelineFindings | null;
}

/**
 * Removes findings the reader has already met in an earlier section.
 *
 * Order is the priority order: the base insights are what the reader sees
 * first, so they keep every finding, and each later section yields to the
 * ones before it. Conflicts and profiles are exempt - a difficult moment is
 * about one specific exchange and a profile is per-person, so overlap with a
 * general pattern there is the point rather than a repetition.
 */
export function removeCrossModuleEcho(input: CrossModuleInput): CrossModuleOutput {
  const claimed = [...input.basePatternStatements];

  const interaction = input.interaction
    ? {
        ...input.interaction,
        patterns: withoutEcho(
          input.interaction.patterns,
          claimed,
          (pattern) => `${pattern.title} ${pattern.observation}`,
        ),
      }
    : null;

  const emotional = input.emotional
    ? {
        ...input.emotional,
        observations: withoutEcho(
          input.emotional.observations,
          claimed,
          (entry) => `${entry.title} ${entry.observation}`,
        ),
      }
    : null;

  const timeline = input.timeline
    ? {
        ...input.timeline,
        changes: withoutEcho(
          input.timeline.changes,
          claimed,
          // A timeline entry earns its place by what changed, so it is
          // compared on the change rather than on the label.
          (change) => `${change.title} ${change.earlier} ${change.later}`,
        ),
      }
    : null;

  return { interaction, emotional, timeline };
}
