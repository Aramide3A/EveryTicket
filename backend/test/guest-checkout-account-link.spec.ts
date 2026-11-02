describe('guest checkout account linking', () => {
  it('uses a matching active profile id and leaves an unknown email unlinked', async () => {
    const checkout = await import('../src/checkout/guest-checkout-account-link.js');

    expect(checkout.guestCheckoutProfileId({ id: 'profile-1' })).toBe('profile-1');
    expect(checkout.guestCheckoutProfileId(null)).toBeUndefined();
  });

  it('normalizes valid buyer email addresses and rejects malformed values', async () => {
    const checkout = await import('../src/checkout/guest-checkout-account-link.js');

    expect(checkout.normalizeBuyerEmail(' Buyer@Example.COM ')).toBe('buyer@example.com');
    expect(checkout.normalizeBuyerEmail('not-an-email')).toBeNull();
    expect(checkout.normalizeBuyerEmail('   ')).toBeNull();
  });
});
