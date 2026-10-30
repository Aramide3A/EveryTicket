export type RequestLogInput = {
  method: string;
  path: string;
  statusCode: number;
  requestId: string;
  durationMs: number;
};

export function formatRequestLog(input: RequestLogInput): Record<string, string | number> {
  return {
    event: 'http_request_completed',
    method: input.method,
    path: input.path,
    statusCode: input.statusCode,
    requestId: input.requestId,
    durationMs: input.durationMs,
  };
}

export function writeRequestLog(input: RequestLogInput, sink: (message: string) => void = console.info): void {
  sink(JSON.stringify(formatRequestLog(input)));
}
