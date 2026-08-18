/**
 * Reroute Recommendation (§2, §6 Phase 4).
 *
 *   "advisory output, doesn't require a real routing provider integration
 *    for the demo (mock is fine, say so plainly if asked)."
 *
 * This IS the mock, said plainly: `mocked: true` is on every object this
 * returns, and the advice itself ("consider a cooler-hours departure or an
 * alternate corridor") is generic guidance, not a real routing computation
 * against real road/traffic data. Fills `CargoRiskAssessment.reroute_suggestion
 * : object | null` per §3.
 *
 * Only called when `recommended_action === 'reroute'` (elevated, not yet
 * breach) — a route already in breach gets a claim draft instead, not a
 * reroute suggestion for cargo that's already spoiled.
 */

export interface RerouteSuggestion {
  mocked: true;
  advisory: string;
  suggested_action: 'delay_departure' | 'alternate_corridor' | 'expedite_delivery';
  rationale: string;
}

export function generateRerouteSuggestion(
  cumulative_exposure_score: number,
  threshold: number,
): RerouteSuggestion {
  const fractionToBreach = threshold > 0 ? cumulative_exposure_score / threshold : 1;

  // Closer to breach → push toward finishing the trip faster; further from
  // it → there's room to wait out the heat instead. Two different mocked
  // pieces of advice so the demo doesn't show the same string every time.
  if (fractionToBreach >= 0.75) {
    return {
      mocked: true,
      advisory: 'Cumulative exposure is close to this cargo class’s breach threshold.',
      suggested_action: 'expedite_delivery',
      rationale:
        `At ${cumulative_exposure_score}/${threshold} degree-hours, there is little exposure budget ` +
        `left. Advisory only — a real implementation would compute an actual faster route against a ` +
        `routing provider, not suggest this string.`,
    };
  }

  return {
    mocked: true,
    advisory: 'Elevated ambient exposure detected along this route.',
    suggested_action: 'alternate_corridor',
    rationale:
      `At ${cumulative_exposure_score}/${threshold} degree-hours, there is still exposure budget ` +
      `remaining. Advisory only — a real implementation would query a routing provider for a cooler ` +
      `corridor or a delayed-departure window, not suggest this string.`,
  };
}
