import { BadRequestException } from '@nestjs/common';

export type Page<T> = { items: T[]; page: number; pageSize: number; total: number };

export function readPagination(pageValue?: string, pageSizeValue?: string): { page: number; pageSize: number; skip: number } {
  const page = pageValue === undefined ? 1 : Number(pageValue);
  const pageSize = pageSizeValue === undefined ? 20 : Number(pageSizeValue);
  if (!Number.isSafeInteger(page) || page < 1) throw new BadRequestException('page is invalid');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new BadRequestException('pageSize is invalid');
  return { page, pageSize, skip: (page - 1) * pageSize };
}
