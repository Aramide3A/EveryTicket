type RuntimeConfig = {
  port: number;
  publicAppUrl?: string;
};

type RuntimeConfigReader = (environment: NodeJS.ProcessEnv) => RuntimeConfig;

async function loadRuntimeConfigReader(): Promise<RuntimeConfigReader | undefined> {
  try {
    const modulePath = '../src/config/runtime-config.js';
    return (await import(modulePath) as { readRuntimeConfig: RuntimeConfigReader }).readRuntimeConfig;
  } catch (error) {
    if (String(error).includes("Cannot find module '../src/config/runtime-config.js'")) {
      return undefined;
    }

    throw error;
  }
}

describe('runtime configuration', () => {
  it('uses port 3000 when PORT is not provided', async () => {
    const readRuntimeConfig = await loadRuntimeConfigReader();

    expect(readRuntimeConfig?.({})).toEqual({ port: 3000 });
  });

  it.each(['0', '65536', 'not-a-number', '3000.5'])('rejects invalid PORT value %s', async (port) => {
    const readRuntimeConfig = await loadRuntimeConfigReader();

    expect(() => readRuntimeConfig?.({ PORT: port })).toThrow();
  });

  it('reads the HTTPS public application URL when configured', async () => {
    const readRuntimeConfig = await loadRuntimeConfigReader();

    expect(
      readRuntimeConfig?.({
        PUBLIC_APP_URL: 'https://app.everythingticket.example'
      })
    ).toEqual({
      port: 3000,
      publicAppUrl: 'https://app.everythingticket.example'
    });
  });

  it.each([
    'http://app.everythingticket.example',
    'not-a-url',
    'https://user:password@app.everythingticket.example'
  ])('rejects unsafe PUBLIC_APP_URL value %s', async (publicAppUrl) => {
    const readRuntimeConfig = await loadRuntimeConfigReader();

    expect(() => readRuntimeConfig?.({ PUBLIC_APP_URL: publicAppUrl })).toThrow();
  });
});
