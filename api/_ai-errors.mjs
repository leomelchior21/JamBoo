export class AIConfigError extends Error {}

export class AIProviderError extends Error {
  constructor(message, { status = null, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

export class AITimeoutError extends Error {}

export class AIBudgetError extends Error {}

export class InvalidAIResponseError extends Error {}

export function providerHttpError(provider, status, detail = '') {
  const message = detail ? `${provider} HTTP ${status}: ${detail}` : `${provider} HTTP ${status}`;
  return new AIProviderError(message, {
    status,
    retryable: status === 429 || status >= 500,
  });
}
