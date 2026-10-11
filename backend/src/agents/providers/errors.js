// Provider-neutral error used by agents to pick a fallback and record an error category.
// Categories: timeout | rate_limited | quota_exceeded | auth_error | blocked | provider_error | truncated | malformed_output
export class ProviderError extends Error {
  constructor(category, message) { super(message); this.category = category; }
}
