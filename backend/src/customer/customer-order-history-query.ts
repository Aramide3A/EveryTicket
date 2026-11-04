import { BadRequestException } from '@nestjs/common';
import { customerOrderStatuses, type CustomerOrderStatus } from './customer-ticket-access.js';

export function readCustomerOrderHistoryQuery(status: unknown, page: unknown, pageSize: unknown): { status?: CustomerOrderStatus; page: number; pageSize: number } {
  if (status !== undefined && (typeof status !== 'string' || !customerOrderStatuses.includes(status as CustomerOrderStatus))) {
    throw new BadRequestException('status is invalid');
  }
  return {
    ...(status ? { status: status as CustomerOrderStatus } : {}),
    page: positiveInteger(page, 1, 1_000_000),
    pageSize: positiveInteger(pageSize, 20, 100),
  };
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new BadRequestException('pagination is invalid');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new BadRequestException('pagination is invalid');
  return parsed;
}
