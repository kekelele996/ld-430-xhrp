import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '../types/enums';

@Injectable()
export class RbacMiddleware implements NestMiddleware {
  use(req: Request & { user?: { role: UserRole } }, _res: Response, next: NextFunction) {
    const routePath = req.originalUrl ?? req.url ?? req.path;
    // 领取动作语义上等同下载，任何登录角色（含 Viewer）均可凭码领取
    const isClaimAction = req.method === 'POST' && /\/shared-packs\/claim\//.test(routePath);
    if ((req.method === 'POST' && routePath.includes('/downloads')) || isClaimAction) {
      return next();
    }
    const writeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (writeMethod && req.user?.role === UserRole.Viewer) {
      throw new ForbiddenException('Viewer 只能浏览和下载免费素材');
    }
    next();
  }
}
