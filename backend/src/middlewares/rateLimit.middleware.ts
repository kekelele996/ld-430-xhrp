import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const buckets = new Map<string, { count: number; expiresAt: number }>();

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const isDownload = req.path.includes('/downloads');
    const isClaim = /\/shared-packs\/claim\//.test(req.path);
    const limit = isDownload || isClaim ? 10 : req.path.includes('/assets') && req.method === 'POST' ? 20 : 120;
    const windowMs = isDownload || isClaim ? 60_000 : 3_600_000;
    const key = `${req.ip}:${isDownload ? 'download' : isClaim ? 'claim' : req.method}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt < now) {
      buckets.set(key, { count: 1, expiresAt: now + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) throw new HttpException('请求过于频繁', HttpStatus.TOO_MANY_REQUESTS);
    next();
  }
}
