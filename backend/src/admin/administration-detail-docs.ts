import { applyDecorators } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { auditDetailSelect, eventsDetailSelect, feeRuleDetailSelect, ordersDetailSelect, payoutRequestsDetailSelect, profilesDetailSelect, refundRequestsDetailSelect } from './administration-details.js';

const contracts = {
  Event: { select: eventsDetailSelect, param: 'eventId', description: 'Event in any state, including past events and blocked organizers. Includes ticket configuration and ready media public URLs.' },
  Profile: { select: profilesDetailSelect, param: 'profileId', description: 'Profile with roles and nullable blocking administrator identity.' },
  Order: { select: ordersDetailSelect, param: 'orderId', description: 'Order with buyer, fee snapshot, lines and all payment attempts. Guest customerProfile may be null.' },
  Refund: { select: refundRequestsDetailSelect, param: 'refundRequestId', description: 'Refund with selected tickets, order monetary breakdown and nullable reviewer identity.' },
  Payout: { select: payoutRequestsDetailSelect, param: 'payoutRequestId', description: 'Payout with stored payable breakdown and nullable reviewer identity.' },
  FeeRule: { select: feeRuleDetailSelect, param: 'ruleId', description: 'Fee rule by ID, including historical and scheduled versions, with nullable changing administrator identity.' },
  AuditLog: { select: auditDetailSelect, param: 'auditLogId', description: 'Audit entry with structured details and nullable actor identity.' },
};
const arrays = new Set(['ticketTypes', 'media', 'lines', 'paymentAttempts', 'tickets', 'roles']);
const nullable = new Set(['blockedAt', 'blockedByProfileId', 'blockReason', 'blockedBy', 'buyerPhone', 'customerProfile', 'paidAt', 'initializedAt', 'verifiedAt', 'failureDetail', 'publishedAt', 'suspendedAt', 'suspendedReason', 'cancelledAt', 'cancelledReason', 'description', 'salesStartAt', 'salesEndAt', 'maxPerOrder', 'completedAt', 'percentageBasisPoints', 'fixedAmountKobo', 'platformFeePercentageBasisPoints', 'platformFeeFixedAmountKobo', 'reviewedAt', 'reviewedByProfileId', 'reviewer', 'reviewReason', 'gatewayRefundReference', 'gatewayStatus', 'processedAt', 'transferReference', 'transferDate', 'activeUntil', 'changedByProfileId', 'changedBy', 'actorProfileId', 'actor', 'details']);
// The schema follows the same explicit allowlist as the query, so documented fields cannot drift from the response.
function projectionSchema(select: object): SchemaObject {
  const properties: Record<string, SchemaObject> = {};
  for (const [field, value] of Object.entries(select)) {
    let schema: SchemaObject;
    if (value && typeof value === 'object' && 'select' in value) schema = projectionSchema(value.select);
    else if (field === 'details') schema = { type: 'object', additionalProperties: true, description: 'Structured audit metadata' };
    else if (/Kobo$|BasisPoints$/.test(field) || ['version', 'platformFeeRuleVersion', 'capacity', 'maxPerOrder', 'quantity', 'position', 'contentLength'].includes(field)) schema = { type: 'integer' };
    else if (['featured', 'isActive', 'isCover', 'appliesToFreeOrder'].includes(field)) schema = { type: 'boolean' };
    else schema = { type: 'string', ...(/At$|From$|Until$|Date$/.test(field) ? { format: 'date-time' } : {}) };
    if (arrays.has(field)) schema = { type: 'array', items: schema };
    properties[field] = { ...schema, ...(nullable.has(field) ? { nullable: true } : {}) };
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
export function AdminDetailResponse(resource: keyof typeof contracts) {
  const contract = contracts[resource];
  return applyDecorators(
    ApiOperation({ summary: `Get administration ${resource} by ID`, description: `${contract.description} Requires an active administrator. Returns one object; never a collection. Credentials, tokens, storage keys and raw provider payloads are excluded.` }),
    ApiParam({ name: contract.param, type: String, description: 'Record ID' }),
    ApiOkResponse({ description: 'Record found', schema: projectionSchema(contract.select) }),
    ApiNotFoundResponse({ description: 'Record ID does not exist' }),
    ApiUnauthorizedResponse({ description: 'Missing/invalid session, blocked account or administrator role required' }),
    ApiServiceUnavailableResponse({ description: 'Database/identity is not configured' }),
  );
}
