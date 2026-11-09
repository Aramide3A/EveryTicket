export async function withInitialPayment<
  TOrder,
  TPayment,
>(
  order: TOrder,
  initialize: () => Promise<TPayment>,
): Promise<TOrder | (TOrder & { payment: TPayment })> {
  try {
    const payment = await initialize();
    return { ...order, payment };
  } catch {
    return order;
  }
}
