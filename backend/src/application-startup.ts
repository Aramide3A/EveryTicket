type Closable = { close(): Promise<unknown> };
type Api = Closable & { listen(port: number): Promise<unknown> };

export async function startApplication({ createApi, startWorker, port }: {
  createApi(): Promise<Api>;
  startWorker(): Promise<Closable>;
  port: number;
}): Promise<Closable> {
  const api = await createApi();
  let worker: Closable | undefined;
  try {
    worker = await startWorker();
    await api.listen(port);
  } catch (error) {
    try {
      if (worker) await worker.close();
    } finally {
      await api.close();
    }
    throw error;
  }

  return {
    close: async () => {
      try {
        await worker.close();
      } finally {
        await api.close();
      }
    },
  };
}
