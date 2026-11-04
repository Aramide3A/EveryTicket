import { startApplication } from '../src/application-startup.js';

describe('combined application lifecycle', () => {
  it('starts background processing before serving requests and closes both on shutdown', async () => {
    const events: string[] = [];
    const application = await startApplication({
      createApi: async () => ({
        listen: async () => { events.push('listen'); },
        close: async () => { events.push('api close'); },
      }),
      startWorker: async () => {
        events.push('worker start');
        return { close: async () => { events.push('worker close'); } };
      },
      port: 3000,
    });

    expect(events).toEqual(['worker start', 'listen']);
    await application.close();
    expect(events).toEqual(['worker start', 'listen', 'worker close', 'api close']);
  });

  it('closes started resources when listening fails', async () => {
    const events: string[] = [];
    await expect(startApplication({
      createApi: async () => ({
        listen: async () => { throw new Error('port unavailable'); },
        close: async () => { events.push('api close'); },
      }),
      startWorker: async () => ({ close: async () => { events.push('worker close'); } }),
      port: 3000,
    })).rejects.toThrow('port unavailable');
    expect(events).toEqual(['worker close', 'api close']);
  });

  it('closes the API when background processing cannot start', async () => {
    const events: string[] = [];
    await expect(startApplication({
      createApi: async () => ({
        listen: async () => { events.push('listen'); },
        close: async () => { events.push('api close'); },
      }),
      startWorker: async () => { throw new Error('redis unavailable'); },
      port: 3000,
    })).rejects.toThrow('redis unavailable');
    expect(events).toEqual(['api close']);
  });

  it('closes the API even when the worker fails during shutdown', async () => {
    const events: string[] = [];
    const application = await startApplication({
      createApi: async () => ({
        listen: async () => undefined,
        close: async () => { events.push('api close'); },
      }),
      startWorker: async () => ({ close: async () => { throw new Error('redis close failed'); } }),
      port: 3000,
    });

    await expect(application.close()).rejects.toThrow('redis close failed');
    expect(events).toEqual(['api close']);
  });
});
