import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getUserPageIds,
  checkoutSummary,
  paymentOutcome,
  checkoutStage,
} from '../everythingticket-end-user/dist/model.mjs';
import {
  getOrganiserPageIds,
  scannerResult,
  payoutEligibility,
  eventWizardStage,
} from '../everythingticket-organiser/dist/model.mjs';
import {
  getAdminPageIds,
  refundTransition,
  feePreview,
  paidExceptionDecision,
} from '../everythingticket-admin/dist/model.mjs';

test('end-user site exposes the complete purchase and account journey', () => {
  assert.deepEqual(getUserPageIds(), [
    'home', 'discover', 'event', 'checkout', 'payment', 'tickets', 'ticket', 'account',
  ]);
});

test('checkout keeps ticket amount, platform fee, and total distinct', () => {
  assert.deepEqual(checkoutSummary(2, 10000, 500), {
    quantity: 2,
    ticketAmount: 20000,
    platformFee: 500,
    total: 20500,
  });
});

test('a late verified payment never pretends the order failed', () => {
  assert.equal(paymentOutcome({ verified: true, holdExpired: true, capacityAvailable: false }), 'PAID_NEEDS_RESOLUTION');
  assert.equal(paymentOutcome({ verified: true, holdExpired: false, capacityAvailable: true }), 'PAID');
});

test('checkout advances only when the current production form is complete', () => {
  assert.equal(checkoutStage('tickets', { quantity: 0 }), 'tickets');
  assert.equal(checkoutStage('tickets', { quantity: 2 }), 'details');
  assert.equal(checkoutStage('details', { name: '', email: 'amara@example.com' }), 'details');
  assert.equal(checkoutStage('details', { name: 'Amara Okafor', email: 'amara@example.com' }), 'payment');
});

test('organiser site exposes event, sales, guest, gate, refund, and payout operations', () => {
  assert.deepEqual(getOrganiserPageIds(), [
    'overview', 'events', 'create', 'orders', 'attendees', 'guests', 'scanner', 'refunds', 'payouts', 'media',
  ]);
});

test('scanner returns stable admission outcomes', () => {
  assert.equal(scannerResult('active'), 'VALID');
  assert.equal(scannerResult('used'), 'ALREADY_USED');
  assert.equal(scannerResult('revoked'), 'REVOKED');
  assert.equal(scannerResult('wrong-event'), 'WRONG_EVENT');
  assert.equal(scannerResult('unknown'), 'INVALID');
});

test('payout is unavailable until the event has ended', () => {
  assert.deepEqual(payoutEligibility({ ended: false, ticketSubtotal: 8000000, refunds: 0, priorPaid: 0 }), {
    eligible: false,
    amount: 0,
  });
  assert.deepEqual(payoutEligibility({ ended: true, ticketSubtotal: 8000000, refunds: 250000, priorPaid: 1000000 }), {
    eligible: true,
    amount: 6750000,
  });
});

test('event creation wizard stays on the first incomplete production step', () => {
  assert.equal(eventWizardStage({ basics: false, tickets: false, media: false }), 'basics');
  assert.equal(eventWizardStage({ basics: true, tickets: false, media: false }), 'tickets');
  assert.equal(eventWizardStage({ basics: true, tickets: true, media: false }), 'media');
  assert.equal(eventWizardStage({ basics: true, tickets: true, media: true }), 'review');
});

test('admin site exposes platform operations and audit controls', () => {
  assert.deepEqual(getAdminPageIds(), [
    'overview', 'events', 'users', 'orders', 'refunds', 'payouts', 'fees', 'reconciliation', 'jobs', 'audit',
  ]);
});

test('refund approval and processing remain separate states', () => {
  assert.equal(refundTransition('REQUESTED', 'approve'), 'APPROVED');
  assert.equal(refundTransition('APPROVED', 'start'), 'PROCESSING');
  assert.equal(refundTransition('PROCESSING', 'gateway-success'), 'PROCESSED');
});

test('fee preview uses integer kobo arithmetic and does not alter history', () => {
  assert.deepEqual(feePreview(1850000, { mode: 'percentage', basisPoints: 350 }), {
    fee: 64750,
    total: 1914750,
  });
  assert.deepEqual(feePreview(1850000, { mode: 'fixed', amount: 50000 }), {
    fee: 50000,
    total: 1900000,
  });
});

test('admin paid exception decisions preserve verified money state', () => {
  assert.equal(paidExceptionDecision('fulfil'), 'PAID');
  assert.equal(paidExceptionDecision('refund'), 'REFUND_REQUESTED');
  assert.equal(paidExceptionDecision('ignore'), 'PAID_NEEDS_RESOLUTION');
});
