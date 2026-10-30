type StructuredLog = {
  formatRequestLog(input: {
    method: string;
    path: string;
    statusCode: number;
    requestId: string;
    durationMs: number;
  }): Record<string, unknown>;
};

async function loadStructuredLog(): Promise<StructuredLog | undefined> {
  try {
    return await import('../src/common/http/structured-log.js') as StructuredLog;
  } catch {
    return undefined;
  }
}

describe('structured request logging', () => {
  it('formats only operational metadata and never includes request payload or query data', async () => {
    const structuredLog = await loadStructuredLog();
    expect(structuredLog).toBeDefined();
    if (!structuredLog) throw new Error('structured logging is unavailable');

    expect(structuredLog.formatRequestLog({
      method: 'POST',
      path: '/customer/orders/order-123/resend-confirmation',
      statusCode: 201,
      requestId: 'request-123',
      durationMs: 24,
    })).toEqual({
      event: 'http_request_completed',
      method: 'POST',
      path: '/customer/orders/order-123/resend-confirmation',
      statusCode: 201,
      requestId: 'request-123',
      durationMs: 24,
    });
  });
});
