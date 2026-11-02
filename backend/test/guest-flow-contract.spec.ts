import { jest } from '@jest/globals';

describe('guest checkout end-to-end contracts', () => {
  it('rate limits exact guest checkout and organizer registration routes', async () => {
    const api = await import('../src/api.js');

    expect(api.sensitiveAction({ method: 'POST', url: '/api/v1/orders' } as never)).toBe('checkout');
    expect(api.sensitiveAction({ method: 'POST', url: '/api/v1/organizer-registration' } as never)).toBe('authentication');
  });

  it('looks up order status by its high-entropy reference without requiring a profile', async () => {
    const status = await import('../src/checkout/order-status.js');
    const findFirst = jest.fn(async (input: unknown) => {
      void input;
      return { reference: 'ET-secret', status: 'PAID', holdExpiresAt: new Date(0), paidAt: new Date(1) };
    });

    await status.getCustomerOrderStatus({ database: { order: { findFirst } } as never, orderReference: 'ET-secret' } as never);

    expect(Object.keys((findFirst.mock.calls[0]?.[0] as { where: object }).where)).toEqual(['reference']);
  });

  it('links historical guest orders only after the account email is verified', async () => {
    const linking = await import('../src/identity/guest-order-link.js');
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const database = { order: { updateMany } } as never;

    await linking.linkGuestOrdersForVerifiedUser({ database, user: { id: 'user-1', email: 'buyer@example.test', emailVerified: false }, profileId: 'profile-1' });
    expect(updateMany).not.toHaveBeenCalled();

    await linking.linkGuestOrdersForVerifiedUser({ database, user: { id: 'user-1', email: 'buyer@example.test', emailVerified: true }, profileId: 'profile-1' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { customerProfileId: null, buyerEmail: 'buyer@example.test' },
      data: { customerProfileId: 'profile-1' },
    });
  });

  it('finds the latest initialized payment by guest order reference', async () => {
    const access = await import('../src/payments/order-payment-access.js');
    const findUnique = jest.fn(async () => ({ paymentAttempts: [{ reference: 'ETP-secret' }] }));

    await expect(access.findLatestInitializedPaymentReference({
      database: { order: { findUnique } } as never,
      orderReference: 'ET-secret',
    })).resolves.toBe('ETP-secret');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { reference: 'ET-secret' } }));
  });
});
