'use strict';
// Default model per tier and provider. Settings can override any agent's model; the Settings page lists what the key can use.
const TIERS = {
  anthropic: { smart: 'claude-opus-5-5', work: 'claude-sonnet-5-5', fast: 'claude-haiku-5-5' },
  openai: { smart: 'gpt-5', work: 'gpt-5-mini', fast: 'gpt-5-nano' },
  mock: { smart: 'demo-crew', work: 'demo-crew', fast: 'demo-crew' },
};
// Director plans and judges, so it gets the strongest tier; the specialists work in the middle tier.
const AGENT_TIER = { director: 'smart', sking: 'work', forge: 'work', molder: 'work', palette: 'work', noteie: 'work', summarizer: 'fast' };

function modelFor(provider, agentId, settings) {
  const override = settings && settings.models && settings.models[agentId];
  if (override) return override;
  const t = TIERS[provider] || TIERS.anthropic;
  return t[AGENT_TIER[agentId] || 'work'];
}

module.exports = { TIERS, AGENT_TIER, modelFor };
