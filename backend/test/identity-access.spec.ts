type Profile = {
  role: 'CUSTOMER' | 'ORGANIZER' | 'ADMIN';
  roles: Array<'CUSTOMER' | 'ORGANIZER' | 'ADMIN'>;
};

describe('profile role access', () => {
  it('permits any role assigned to a multi-role profile', async () => {
    const module = await import('../src/identity/current-profile.js');
    const profile: Profile = { role: 'ORGANIZER', roles: ['CUSTOMER', 'ORGANIZER'] };

    expect(module.profileHasRole(profile, 'CUSTOMER')).toBe(true);
    expect(module.profileHasRole(profile, 'ORGANIZER')).toBe(true);
    expect(module.profileHasRole(profile, 'ADMIN')).toBe(false);
  });

  it('continues to honor the legacy primary role while old profiles are migrated', async () => {
    const module = await import('../src/identity/current-profile.js');
    const profile: Profile = { role: 'ADMIN', roles: ['CUSTOMER'] };

    expect(module.profileHasRole(profile, 'ADMIN')).toBe(true);
  });

  it('builds a database predicate that accepts a primary or secondary role', async () => {
    const module = await import('../src/identity/current-profile.js');

    expect(module.profileRoleFilter('ORGANIZER')).toEqual({
      OR: [
        { role: 'ORGANIZER' },
        { roles: { has: 'ORGANIZER' } },
      ],
    });
  });

  it('rejects a customer before an administrator session can be created', async () => {
    const module = await import('../src/identity/current-profile.js');
    let sessionCreated = false;

    await expect(module.signInAdministrator(
      { role: 'CUSTOMER', roles: ['CUSTOMER'] },
      async () => {
        sessionCreated = true;
        return { token: 'session-token' };
      },
    )).rejects.toThrow('administrator access is required');

    expect(sessionCreated).toBe(false);
  });

  it('maps Better Auth invalid credentials to a neutral unauthorized response', async () => {
    const module = await import('../src/admin/admin-sign-in.controller.js');
    const unexpected = new Error('database unavailable');

    expect(() => module.rethrowInvalidAdministratorCredentials({
      name: 'APIError',
      statusCode: 401,
      body: { code: 'INVALID_EMAIL_OR_PASSWORD' },
    })).toThrow('Email or password is incorrect.');
    expect(() => module.rethrowInvalidAdministratorCredentials(unexpected)).toThrow(unexpected);
  });
});

describe('organizer registration identity helpers', () => {
  it('creates an organizer profile that retains customer access', async () => {
    const registration = await import('../src/organizer/organizer-registration.js');

    expect(registration.organizerRegistrationRoles()).toEqual(['CUSTOMER', 'ORGANIZER']);
  });

  it('preserves Better Auth session cookies from organizer registration', async () => {
    const registration = await import('../src/organizer/organizer-registration.js');
    const headers = new Headers();
    headers.append('set-cookie', 'better-auth.session_token=secret; Path=/; HttpOnly');

    expect(registration.registrationCookies(headers)).toEqual(['better-auth.session_token=secret; Path=/; HttpOnly']);
  });
});
