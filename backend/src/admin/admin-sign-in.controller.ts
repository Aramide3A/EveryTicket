import { BadRequestException, Body, Controller, Post, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { signInAdministrator } from '../identity/current-profile.js';

@ApiTags('Administration')
@Controller('admin')
export class AdminSignInController {
  @Post('sign-in')
  @ApiOperation({ summary: 'Sign in to platform administration' })
  @ApiBody({ schema: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', format: 'password' } } } })
  async signIn(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = readCredentials(body);
    const { auth, authDatabase } = await import('../identity/auth.js');
    const profile = await authDatabase.applicationProfile.findFirst({
      where: { status: 'ACTIVE', user: { email } },
      select: { role: true, roles: true },
    });
    const result = await (async () => {
      try {
        return await signInAdministrator(
          profile,
          () => auth.api.signInEmail({ body: { email, password }, returnHeaders: true }),
        );
      } catch (error) {
        rethrowInvalidAdministratorCredentials(error);
      }
    })();
    const cookies = result.headers.getSetCookie();
    if (cookies.length) response.setHeader('set-cookie', cookies);
    return result.response;
  }
}

export function rethrowInvalidAdministratorCredentials(error: unknown): never {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'APIError' &&
    (error as { statusCode?: unknown }).statusCode === 401 &&
    (error as { body?: { code?: unknown } }).body?.code === 'INVALID_EMAIL_OR_PASSWORD'
  ) {
    throw new UnauthorizedException('Email or password is incorrect.');
  }
  throw error;
}

function readCredentials(body: unknown): { email: string; password: string } {
  if (typeof body !== 'object' || body === null) throw new BadRequestException('email and password are required');
  const value = body as Record<string, unknown>;
  if (typeof value.email !== 'string' || !value.email.trim() || typeof value.password !== 'string' || !value.password) {
    throw new BadRequestException('email and password are required');
  }
  return { email: value.email.trim().toLowerCase(), password: value.password };
}
