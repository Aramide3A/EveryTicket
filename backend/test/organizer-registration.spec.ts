describe('organizer registration roles', () => {
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
