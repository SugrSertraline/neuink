export const ASSISTANT_MODEL_BILLING_ERROR = '模型服务余额或额度不足，请检查服务商账户，或切换可用模型后重试。';

/** Persist and display fixed copy only; provider bodies and credentials are never included. */
export function safeAssistantModelError(error: unknown): string | null {
  try {
    if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 402) {
      return ASSISTANT_MODEL_BILLING_ERROR;
    }
    const message = typeof error === 'string' ? error : error instanceof Error ? error.message : null;
    return message === ASSISTANT_MODEL_BILLING_ERROR || message === 'Insufficient Balance'
      ? ASSISTANT_MODEL_BILLING_ERROR : null;
  } catch {
    return null;
  }
}
