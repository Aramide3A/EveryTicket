import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';

describe('order payment authorization', () => {
  it('authorizes a customer only for an order owned by that profile', async () => {
    const access = await import('../src/payments/order-payment-authorization.js');
    const findFirst = jest.fn(async () => ({ id: 'order-1' }));

    await expect(
      access.authorizeOrderPayment({
        database: { order: { findFirst } } as never,
        orderReference: 'ET-order',
        customerProfileId: 'profile-1',
        guestAccessToken: '',
      }),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { reference: 'ET-order', customerProfileId: 'profile-1' },
      select: { id: true },
    });
  });

  it('authorizes a guest only with the matching separate capability', async () => {
    const access = await import('../src/payments/order-payment-authorization.js');
    const findFirst = jest.fn(async () => ({ id: 'order-1' }));
    const token = 'guest-private-capability';

    await expect(
      access.authorizeOrderPayment({
        database: { order: { findFirst } } as never,
        orderReference: 'ET-order',
        customerProfileId: null,
        guestAccessToken: token,
      }),
    ).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        reference: 'ET-order',
        customerProfileId: null,
        guestAccessTokenDigest: createHash('sha256').update(token).digest('hex'),
      },
      select: { id: true },
    });
  });

  it('rejects guest payment access when no capability is supplied', async () => {
    const access = await import('../src/payments/order-payment-authorization.js');
    const findFirst = jest.fn(async () => ({ id: 'unsafe' }));

    await expect(
      access.authorizeOrderPayment({
        database: { order: { findFirst } } as never,
        orderReference: 'ET-order',
        customerProfileId: null,
        guestAccessToken: '',
      }),
    ).resolves.toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });
});
