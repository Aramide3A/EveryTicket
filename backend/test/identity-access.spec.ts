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
});
