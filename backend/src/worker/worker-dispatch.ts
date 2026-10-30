export async function executeWorkerJob({
  name,
  handlers,
}: {
  name: string;
  handlers: {
    reconcilePayments(): Promise<void>;
    deliverNotifications(): Promise<void>;
    generateTicketDocuments(): Promise<void>;
    removeExpiredMedia(): Promise<void>;
  };
}): Promise<void> {
  if (name === 'payment-reconciliation') return handlers.reconcilePayments();
  if (name === 'notification-delivery') return handlers.deliverNotifications();
  if (name === 'ticket-document-delivery') return handlers.generateTicketDocuments();
  if (name === 'expired-media-cleanup') return handlers.removeExpiredMedia();
  throw new Error(`unknown worker job: ${name}`);
}
